/**
 * Pure logic behind the request page (ขอเบิก / สั่งซื้อ): what each product's
 * situation is in words staff understand, how many packs to suggest, and the
 * LINE message. Kept apart from React and Supabase so it is tested.
 */

export interface StockFigures {
  stockOnHand: number;
  avgDailyUsage: number;
  rop: number;
  parstock: number;
  packSize: number;
}

export type RequestStatus = "critical" | "low" | "sufficient" | "no-data";

export interface RequestFigures {
  stockOnHand: number;
  /**
   * False: the product is on no count sheet in the last 5 weeks (packaging, a new item), so
   * nothing is known of what's there — on hand shows "—" and the suggestion assumes none
   */
  stockKnown: boolean;
  avgDailyUsage: number;
  peakDailyUsage: number;
  rop: number;
  parstock: number;
  suggestedOrder: number;
  status: RequestStatus;
}

/** Saved in a request line's notes when its stock wasn't known (the column can't be empty) */
export const UNKNOWN_STOCK_NOTE = "ไม่รู้ยอด";

/**
 * A product's figures on the request page, from its branch stock figure (lib/branch-stock.ts
 * branchFigures — the stock page's own numbers, so both pages agree). On hand is the
 * balance with a book shortfall taken as nothing left: a negative balance means sales
 * used more than the records show coming in, not stock owed, and ordering to fill it would
 * over-order. No anchor (on no sheet in 5 weeks) = nothing known: the suggestion assumes
 * none on hand (a full round), never the receipts of 5 weeks with nothing used.
 */
export function requestFigures(f: { balance: number; anchorDate: string | null; dailyUse: number; peakDailyUse: number } | undefined, opts: { leadTime: number }): RequestFigures {
  const known = !!f && f.anchorDate !== null;
  const stockOnHand = known ? Math.max(0, f!.balance) : 0;
  const avg = f?.dailyUse ?? 0;
  const peak = f?.peakDailyUse ?? 0;
  const lt = opts.leadTime;
  const safetyStock = (peak - avg) * lt;
  const rop = avg * lt + safetyStock;
  const parstock = avg + peak * lt;
  const suggestedOrder = Math.max(0, parstock - stockOnHand);
  let status: RequestStatus;
  if (avg === 0) status = "no-data";
  else if (stockOnHand === 0) status = "critical";
  else if (stockOnHand < rop) status = "low";
  else if (stockOnHand >= parstock) status = "sufficient";
  else status = "low";
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return { stockOnHand, stockKnown: known, avgDailyUsage: r2(avg), peakDailyUsage: r2(peak), rop: r2(rop), parstock: r2(parstock), suggestedOrder: r2(suggestedOrder), status };
}

/** Requested but not yet received, from requests still due (see freshPending) */
export interface Pending {
  qty: number;
  /** Earliest delivery date among those requests */
  due: string;
}

export type LineKind = "nodata" | "out" | "coming" | "low" | "ok";

export interface LineState {
  kind: LineKind;
  /** Days the stock (plus what is coming) lasts at the usual daily use; null without usage data */
  coverDays: number | null;
}

/**
 * Same thresholds as the old table: below the reorder point = ต้องสั่ง; a request
 * already on its way that lifts it back above = กำลังสั่ง.
 */
export function lineState(f: StockFigures, pendingQty = 0): LineState {
  if (f.avgDailyUsage <= 0) return { kind: "nodata", coverDays: null };
  const ropDays = f.rop / f.avgDailyUsage;
  const without = f.stockOnHand / f.avgDailyUsage;
  const withPending = (f.stockOnHand + pendingQty) / f.avgDailyUsage;
  if (f.stockOnHand <= 0 && pendingQty <= 0) return { kind: "out", coverDays: 0 };
  if (pendingQty > 0 && without < ropDays && withPending >= ropDays) return { kind: "coming", coverDays: withPending };
  if (withPending < ropDays) return { kind: f.stockOnHand <= 0 ? "out" : "low", coverDays: withPending };
  return { kind: "ok", coverDays: withPending };
}

/**
 * Packs to bring stock up to parstock. Unlike the old suggestion this takes off
 * what was already requested and is still coming, so a second request the next
 * evening doesn't order the same things again.
 */
export function suggestedPacks(f: StockFigures, pendingQty = 0): number {
  if (f.avgDailyUsage <= 0) return 0;
  const need = f.parstock - f.stockOnHand - pendingQty;
  return need > 0 ? Math.ceil(need / Math.max(1, f.packSize)) : 0;
}

/**
 * Pending lines count only while their request is still due (delivery date from
 * yesterday on). A request left "Submitted" for days would otherwise hide real
 * needs forever (TR-2026-10-013 at Shiro, 19 Oct 2026).
 */
export function freshPending(rows: { skuId: string; qty: number; requiredDate: string }[], today: string): Map<string, Pending> {
  const y = new Date(`${today}T00:00:00`);
  y.setDate(y.getDate() - 1);
  const yesterday = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, "0")}-${String(y.getDate()).padStart(2, "0")}`;
  const out = new Map<string, Pending>();
  for (const r of rows) {
    if (r.requiredDate < yesterday) continue;
    const p = out.get(r.skuId);
    out.set(r.skuId, { qty: (p?.qty ?? 0) + r.qty, due: p && p.due < r.requiredDate ? p.due : r.requiredDate });
  }
  return out;
}

// ── LINE message (same wording as before) ──

export interface MessageItem {
  name: string;
  packSize: number;
  uom: string;
  packs: number;
  /** "แพ็ค" for kitchen requests, the product's pack unit for supplier orders */
  packUnit: string;
}

const n0 = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

export function lineMessage(opts: { branch: string; date: string; notes?: string; items: MessageItem[]; alwaysPacks?: boolean }): string {
  return [
    `📦 [${opts.branch}] - สั่งวัตถุดิบ`,
    `วันส่งสินค้า: ${opts.date}`,
    ...(opts.notes ? [`หมายเหตุ: ${opts.notes}`] : []),
    ``,
    `🧾 รายการ:`,
    ...opts.items.map((i) =>
      opts.alwaysPacks || i.packSize > 1 ? `- ${i.name} — ${n0(i.packSize)} ${i.uom} x ${n0(i.packs)} ${i.packUnit}` : `- ${i.name} — ${n0(i.packs * i.packSize)} ${i.uom}`,
    ),
    ``,
    `🙏 ถ้าคอนเฟิร์ม ฝากยืนยันออเดอร์ด้วยนะคะ`,
  ].join("\n");
}

/** Status of a request in words for the branch */
export const statusLabel: Record<string, { text: string; tone: "wait" | "work" | "done" | "off" }> = {
  Submitted: { text: "รอครัวกลาง", tone: "wait" },
  Acknowledged: { text: "ครัวกลางรับเรื่องแล้ว", tone: "work" },
  Fulfilled: { text: "ได้ของแล้ว", tone: "done" },
  Cancelled: { text: "ยกเลิก", tone: "off" },
  Draft: { text: "ร่าง", tone: "off" },
};
export const prStatusLabel: Record<string, { text: string; tone: "wait" | "work" | "done" | "off" }> = {
  ...statusLabel,
  Submitted: { text: "ส่งแล้ว", tone: "wait" },
  Acknowledged: { text: "ร้านรับเรื่องแล้ว", tone: "work" },
};

/** A request can be cancelled until its goods arrive */
export const canCancel = (status: string) => status === "Submitted" || status === "Acknowledged";
