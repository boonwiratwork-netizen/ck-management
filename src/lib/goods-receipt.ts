/**
 * Rules for the central kitchen's goods receipt (รับของเข้าครัว), apart from the
 * screens so they can be tested: which products to show first for a supplier,
 * receipts grouped into bills, the checks before saving, and standard prices that
 * no longer match what is paid. The stored row is still built by
 * use-goods-receipt-data.ts (buildDbRow), unchanged.
 */
import { format } from "date-fns";
import type { GoodsReceipt } from "@/types/goods-receipt";

/** Local day and time of a stored timestamp (stored in UTC) */
const localDay = (iso: string) => format(new Date(iso), "yyyy-MM-dd");
const localTime = (iso: string) => format(new Date(iso), "HH:mm");

/** Paid this much off the standard price (either way) → "แพงกว่าปกติ / ถูกกว่าปกติ" */
export const PRICE_OFF = 0.2;
/** Paid off the standard by this much on recent receipts → the standard looks old */
export const STALE_OFF = 0.15;

export interface LastBuy {
  qty: number;
  total: number;
  date: string;
}

/** A supplier's products in the order they are bought (most often first), with the last purchase */
export function frequentFor(receipts: GoodsReceipt[], supplierId: string): { skuId: string; count: number; last: LastBuy }[] {
  const by = new Map<string, { count: number; last: LastBuy }>();
  for (const r of receipts) {
    // Bought from the supplier itself, not "ซื้อที่อื่น" lines filed under it
    if (r.supplierId !== supplierId || placeOf(r.note)) continue;
    const cur = by.get(r.skuId);
    const buy = { qty: r.quantityReceived, total: r.actualTotal, date: r.receiptDate };
    if (!cur) by.set(r.skuId, { count: 1, last: buy });
    else {
      cur.count++;
      if (r.receiptDate > cur.last.date) cur.last = buy;
    }
  }
  return [...by.entries()].map(([skuId, v]) => ({ skuId, ...v })).sort((a, b) => b.count - a.count || b.last.date.localeCompare(a.last.date));
}

/** Suppliers by how often the kitchen buys from them */
export function supplierRank(receipts: GoodsReceipt[]): string[] {
  const n = new Map<string, number>();
  for (const r of receipts) n.set(r.supplierId, (n.get(r.supplierId) || 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

export interface Bill {
  key: string;
  date: string;
  supplierId: string;
  /** A free-text place ("ซื้อที่อื่น") kept in the note as "[Supplier: …]" */
  place: string;
  lines: GoodsReceipt[];
  total: number;
  standard: number;
  variance: number;
  /** Entered after the day it was received */
  late: boolean;
}

/** "[Supplier: ตลาดคลองเตย] note" → "ตลาดคลองเตย" */
export const placeOf = (note: string) => /^\[Supplier: ([^\]]*)\]/.exec(note || "")?.[1] ?? "";
export const noteWithoutPlace = (note: string) => (note || "").replace(/^\[Supplier: [^\]]*\]\s*/, "");

/** Receipts grouped into bills: one per day, supplier (and free-text place), newest first */
export function billsOf(receipts: GoodsReceipt[]): Bill[] {
  const by = new Map<string, Bill>();
  for (const r of receipts) {
    const place = placeOf(r.note);
    // A "ซื้อที่อื่น" bill is one place even though each line sits under its product's usual supplier
    const key = place ? `${r.receiptDate}||${place}` : `${r.receiptDate}|${r.supplierId}|`;
    let b = by.get(key);
    if (!b) {
      b = { key, date: r.receiptDate, supplierId: r.supplierId, place, lines: [], total: 0, standard: 0, variance: 0, late: false };
      by.set(key, b);
    }
    b.lines.push(r);
    b.total += r.actualTotal || 0;
    b.standard += r.standardPrice || 0;
    b.variance += r.priceVariance || 0;
    if (r.createdAt && localDay(r.createdAt) > r.receiptDate) b.late = true;
  }
  return [...by.values()].sort((a, b) => b.date.localeCompare(a.date) || b.total - a.total);
}

/** What a line costs: the bill's amount, or the standard when none was typed (as before) */
export const lineTotal = (typed: number | null, stdUnit: number, qty: number) => (typed != null ? typed : stdUnit * qty);

/** Where a bill being typed is kept on this device until saved (BillEntry) */
export const billDraftKey = (date: string, supplierId: string | null) => `ck-gr-draft:${date}:${supplierId ?? "other"}`;

/** Lines typed into this day's bill and not saved yet (the page keeps its day while there are) */
export function hasBillDraft(date: string, supplierId: string | null): boolean {
  try {
    return localStorage.getItem(billDraftKey(date, supplierId)) !== null;
  } catch {
    return false;
  }
}

export interface DraftLine {
  key: string;
  skuId: string;
  name: string;
  qty: number;
  /** Amount on the bill; null = not typed (standard is used) */
  total: number | null;
  stdUnit: number;
}

export interface Check {
  key: string;
  name: string;
  kind: "price" | "again" | "nototal";
  /** What it is, in two or three words */
  label: string;
  /** The numbers */
  detail: string;
}

/** Things to look at again before saving a bill */
export function checksFor(lines: DraftLine[], sameDay: GoodsReceipt[], fmtUnit: (skuId: string, perUnit: number) => string, fmtQty: (skuId: string, qty: number) => string): Check[] {
  const out: Check[] = [];
  for (const l of lines) {
    if (l.qty <= 0) continue;
    if (l.total != null && l.total > 0 && l.stdUnit > 0) {
      const ratio = l.total / l.qty / l.stdUnit;
      if (Math.abs(ratio - 1) > PRICE_OFF)
        out.push({ key: l.key, name: l.name, kind: "price", label: ratio > 1 ? "แพงกว่าปกติ" : "ถูกกว่าปกติ", detail: `${fmtUnit(l.skuId, l.total / l.qty)} · มาตรฐาน ${fmtUnit(l.skuId, l.stdUnit)}` });
    }
    const before = sameDay.filter((r) => r.skuId === l.skuId);
    if (before.length) {
      const t = before.map((r) => r.createdAt ?? "").sort().pop();
      out.push({ key: l.key, name: l.name, kind: "again", label: "รับไปแล้ววันนี้", detail: `${fmtQty(l.skuId, before.reduce((s, r) => s + r.quantityReceived, 0))}${t ? ` ตอน ${localTime(t)}` : ""}` });
    }
    if (l.total == null) out.push({ key: l.key, name: l.name, kind: "nototal", label: "ไม่ได้ใส่ยอดเงิน", detail: `ใช้ราคามาตรฐาน ${fmtUnit(l.skuId, l.stdUnit)}` });
  }
  return out;
}

/**
 * Standard prices that no longer match what is paid: the last receipts (up to 4,
 * at least 2) of a product from a supplier, middle paid/standard ratio off by more
 * than 15%.
 */
export function stalePrices(receipts: GoodsReceipt[]): { skuId: string; supplierId: string; off: number; paid: number; std: number }[] {
  const by = new Map<string, GoodsReceipt[]>();
  for (const r of receipts) {
    if (!(r.stdUnitPrice > 0) || !(r.actualTotal > 0) || !(r.quantityReceived > 0)) continue;
    const k = `${r.skuId}|${r.supplierId}`;
    by.set(k, [...(by.get(k) || []), r]);
  }
  const out: { skuId: string; supplierId: string; off: number; paid: number; std: number }[] = [];
  for (const list of by.values()) {
    const last = [...list].sort((a, b) => a.receiptDate.localeCompare(b.receiptDate)).slice(-4);
    if (last.length < 2) continue;
    const ratios = last.map((r) => r.actualTotal / r.quantityReceived / r.stdUnitPrice).sort((a, b) => a - b);
    const mid = ratios[Math.floor(ratios.length / 2)];
    if (Math.abs(mid - 1) > STALE_OFF) {
      const r = last[last.length - 1];
      out.push({ skuId: r.skuId, supplierId: r.supplierId, off: mid - 1, paid: r.stdUnitPrice * mid, std: r.stdUnitPrice });
    }
  }
  return out.sort((a, b) => Math.abs(b.off) - Math.abs(a.off));
}

/** Price per unit for people: grams read per kg, ml per litre, anything else per unit */
export function perUnitText(perUsage: number, uom: string): string {
  const u = (uom || "").trim();
  const n = (v: number) => v.toLocaleString("th-TH", { maximumFractionDigits: v < 10 ? 2 : 0 });
  if (["ก.", "g", "กรัม"].includes(u)) return `฿${n(perUsage * 1000)}/กก.`;
  if (["มล.", "ml", "มิลลิลิตร"].includes(u)) return `฿${n(perUsage * 1000)}/ลิตร`;
  return `฿${n(perUsage)}/${u || "หน่วย"}`;
}

/** Quantity for people: 20,000 ก. → "20 กก." from 1,000 up */
export function qtyText(qty: number, uom: string): string {
  const u = (uom || "").trim();
  const n = (v: number) => v.toLocaleString("th-TH", { maximumFractionDigits: 2 });
  if (["ก.", "g", "กรัม"].includes(u) && qty >= 1000) return `${n(qty / 1000)} กก.`;
  if (["มล.", "ml"].includes(u) && qty >= 1000) return `${n(qty / 1000)} ลิตร`;
  return `${n(qty)} ${u}`.trim();
}
