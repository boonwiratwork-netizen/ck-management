import { addSaleUsage, type UsageContext } from "@/lib/sale-usage";

/**
 * Food cost for a period, kept apart from the screen so it can be tested:
 *
 * - standard: sales × recipes through the one usage engine (sale-usage.ts), priced
 *   at the standard price, less any recorded corrections (usage_corrections)
 * - actual: opening count + received − closing count, priced at what was paid
 *   (CLAUDE.md "Food Cost Act Qty"; adjustments are not added, closing has them)
 * - things worth a look: what the numbers can tell without anyone hunting
 */

export interface FcSale {
  sale_date: string;
  branch_id: string;
  menu_code: string;
  menu_name: string | null;
  qty: number | string;
  net_amount: number | string | null;
  receipt_no: string | null;
}

/** A recorded fix to standard usage (Shiro's old POS counted noodles twice) */
export interface UsageCorrection {
  id: string;
  branchId: string;
  skuId: string;
  dateFrom: string;
  dateTo: string;
  qty: number;
  reason: string;
}

export interface MenuInfo {
  code: string;
  name: string;
  category: string;
}

export interface SkuInfo {
  id: string;
  code: string;
  name: string;
  type: string;
  uom: string;
}

export interface MenuRow {
  code: string;
  name: string;
  category: string;
  qty: number;
  revenue: number;
  stdCost: number;
  /** stdCost ÷ revenue × 100 (0 when nothing was charged) */
  pct: number;
  perServing: number;
}

export interface CorrectionApplied {
  qty: number;
  reasons: string[];
}

export interface SkuRow {
  skuId: string;
  code: string;
  name: string;
  type: string;
  uom: string;
  /** Standard usage after corrections */
  stdQty: number;
  stdPrice: number;
  stdCost: number;
  correction: CorrectionApplied | null;
}

export interface DayRow {
  date: string;
  revenue: number;
  stdCost: number;
  bills: number;
}

export interface Standard {
  revenue: number;
  bills: number;
  stdCost: number;
  menus: MenuRow[];
  skus: SkuRow[];
  days: DayRow[];
  /** Sales lines whose menu isn't set up (no usage counted) */
  unknownMenus: { code: string; name: string; qty: number; revenue: number }[];
}

const num = (v: unknown) => Number(v) || 0;
const dayCount = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;

/** Share of a correction's dates that falls inside the period (whole month = 1) */
export function overlapShare(c: { dateFrom: string; dateTo: string }, from: string, to: string): number {
  const a = c.dateFrom > from ? c.dateFrom : from;
  const b = c.dateTo < to ? c.dateTo : to;
  if (a > b) return 0;
  return dayCount(a, b) / dayCount(c.dateFrom, c.dateTo);
}

export function computeStandard(input: {
  sales: FcSale[];
  ctx: UsageContext;
  stdPrice: Map<string, number>;
  menuByCode: Map<string, MenuInfo>;
  skuById: Map<string, SkuInfo>;
  corrections: UsageCorrection[];
  branchIds: Set<string>;
  from: string;
  to: string;
}): Standard {
  const { sales, ctx, stdPrice, menuByCode, skuById } = input;
  const usage = new Map<string, number>();
  const menus = new Map<string, MenuRow>();
  const days = new Map<string, DayRow & { billSet: Set<string> }>();
  const unknown = new Map<string, { code: string; name: string; qty: number; revenue: number }>();
  const bills = new Set<string>();
  let revenue = 0;

  for (const s of sales) {
    const qty = num(s.qty);
    const amount = num(s.net_amount);
    revenue += amount;
    const bill = s.receipt_no ? `${s.branch_id}|${s.sale_date}|${s.receipt_no}` : null;
    if (bill) bills.add(bill);
    const day = days.get(s.sale_date) ?? { date: s.sale_date, revenue: 0, stdCost: 0, bills: 0, billSet: new Set<string>() };
    day.revenue += amount;
    if (bill) day.billSet.add(bill);
    days.set(s.sale_date, day);

    let cost = 0;
    const known = addSaleUsage(ctx, s, (skuId, q) => {
      usage.set(skuId, (usage.get(skuId) ?? 0) + q);
      cost += q * (stdPrice.get(skuId) ?? 0);
    });
    day.stdCost += cost;
    if (!known) {
      const u = unknown.get(s.menu_code) ?? { code: s.menu_code, name: s.menu_name ?? "", qty: 0, revenue: 0 };
      u.qty += qty;
      u.revenue += amount;
      unknown.set(s.menu_code, u);
      continue;
    }
    const info = menuByCode.get(s.menu_code);
    const m = menus.get(s.menu_code) ?? { code: s.menu_code, name: info?.name ?? s.menu_name ?? s.menu_code, category: info?.category ?? "", qty: 0, revenue: 0, stdCost: 0, pct: 0, perServing: 0 };
    m.qty += qty;
    m.revenue += amount;
    m.stdCost += cost;
    menus.set(s.menu_code, m);
  }

  // Recorded corrections for these branches, by the share of their dates in this period
  const corr = new Map<string, CorrectionApplied>();
  for (const c of input.corrections) {
    if (!input.branchIds.has(c.branchId)) continue;
    const share = overlapShare(c, input.from, input.to);
    if (share <= 0) continue;
    const a = corr.get(c.skuId) ?? { qty: 0, reasons: [] };
    a.qty += c.qty * share;
    if (!a.reasons.includes(c.reason)) a.reasons.push(c.reason);
    corr.set(c.skuId, a);
  }

  const skuIds = new Set([...usage.keys(), ...corr.keys()]);
  const skus: SkuRow[] = [];
  for (const id of skuIds) {
    const c = corr.get(id) ?? null;
    // A correction can't take usage below nothing (its months may have sold less here)
    const raw = usage.get(id) ?? 0;
    const qty = c ? Math.max(0, raw + c.qty) : raw;
    if (Math.abs(qty) < 1e-9 && !c) continue;
    const info = skuById.get(id);
    const price = stdPrice.get(id) ?? 0;
    skus.push({ skuId: id, code: info?.code ?? "", name: info?.name ?? id, type: info?.type ?? "", uom: info?.uom ?? "", stdQty: qty, stdPrice: price, stdCost: qty * price, correction: c });
  }
  skus.sort((a, b) => b.stdCost - a.stdCost);

  const menuRows = [...menus.values()].map((m) => ({ ...m, pct: m.revenue > 0 ? (m.stdCost / m.revenue) * 100 : 0, perServing: m.qty > 0 ? m.stdCost / m.qty : 0 }));
  const stdCost = skus.reduce((t, r) => t + r.stdCost, 0);
  return {
    revenue,
    bills: bills.size,
    stdCost,
    menus: menuRows.sort((a, b) => b.pct - a.pct),
    skus,
    days: [...days.values()].map(({ billSet, ...d }) => ({ ...d, bills: billSet.size })).sort((a, b) => a.date.localeCompare(b.date)),
    unknownMenus: [...unknown.values()].sort((a, b) => b.revenue - a.revenue),
  };
}

// ─── Actual (one branch, one closed month) ───

export interface CountRow {
  sku_id: string;
  count_date: string;
  physical_count: number | null;
  calculated_balance: number | null;
}

export interface ReceiptRow {
  sku_id: string;
  receipt_date: string;
  qty_received: number;
  actual_unit_price: number | null;
  /** Baht paid for the line (preferred over unit price × qty) */
  actual_total?: number | null;
  /** From a kitchen transfer: already in usage units (no converter), as StockCard */
  transfer_order_id?: string | null;
}

/** A receipt in usage units and baht, whatever kind of receipt it was */
export function receiptUsage(r: ReceiptRow, converter: number): { qty: number; paid: number } {
  const qty = num(r.qty_received) * (r.transfer_order_id ? 1 : converter || 1);
  const paid = r.actual_total != null ? num(r.actual_total) : num(r.actual_unit_price) * num(r.qty_received);
  return { qty, paid };
}

export interface CountPick {
  qty: number;
  date: string;
  /** Not counted on the day itself: the nearest count within 3 days */
  nearby: boolean;
  /** No physical count, the calculated balance was used */
  estimated: boolean;
}

/** The count closest to a date (physical counts first), within the rows given */
export function pickCount(rows: CountRow[], target: string): CountPick | null {
  if (!rows.length) return null;
  const physical = rows.filter((r) => r.physical_count !== null);
  const pool = physical.length ? physical : rows;
  const t = Date.parse(target);
  // Closest; on a tie (a day before and a day after) the later one, as the old page did
  const dist = (r: CountRow) => Math.abs(Date.parse(r.count_date) - t);
  const best = pool.reduce((a, b) => (dist(b) < dist(a) || (dist(b) === dist(a) && b.count_date > a.count_date) ? b : a));
  const estimated = best.physical_count === null;
  return { qty: num(estimated ? best.calculated_balance : best.physical_count), date: best.count_date, nearby: best.count_date !== target, estimated };
}

export interface ActualRow extends SkuRow {
  opening: CountPick | null;
  received: number;
  receipts: number;
  closing: CountPick | null;
  actQty: number | null;
  actPrice: number;
  actCost: number | null;
  qtyVar: number | null;
  priceVar: number | null;
  totalVar: number | null;
}

export interface Actual {
  rows: ActualRow[];
  actCost: number;
  totalVar: number;
  priceVar: number;
  usageVar: number;
  withCounts: number;
}

export function computeActual(input: {
  skus: SkuRow[];
  openingRows: CountRow[];
  closingRows: CountRow[];
  receipts: ReceiptRow[];
  /** Usage units per purchase unit, per SKU */
  converter: Map<string, number>;
  /** Average paid before this month, for items not bought this month */
  pastPrice: Map<string, number>;
  openingDate: string;
  closingDate: string;
}): Actual {
  const group = (rows: CountRow[]) => {
    const m = new Map<string, CountRow[]>();
    for (const r of rows) m.set(r.sku_id, [...(m.get(r.sku_id) ?? []), r]);
    return m;
  };
  const openBy = group(input.openingRows);
  const closeBy = group(input.closingRows);
  const bought = new Map<string, { qty: number; value: number; n: number }>();
  for (const r of input.receipts) {
    // Usage units as the stock pages count them; price = what was paid ÷ that (the old
    // page multiplied unit price by the converted qty: wrong for ml → g items)
    const { qty, paid } = receiptUsage(r, input.converter.get(r.sku_id) || 1);
    const b = bought.get(r.sku_id) ?? { qty: 0, value: 0, n: 0 };
    b.qty += qty;
    b.value += paid;
    b.n += 1;
    bought.set(r.sku_id, b);
  }

  let actCost = 0;
  let totalVar = 0;
  let priceVar = 0;
  let withCounts = 0;
  const rows: ActualRow[] = input.skus.map((s) => {
    const opening = pickCount(openBy.get(s.skuId) ?? [], input.openingDate);
    const closing = pickCount(closeBy.get(s.skuId) ?? [], input.closingDate);
    const b = bought.get(s.skuId);
    const received = b?.qty ?? 0;
    const actPrice = b && b.qty > 0 ? b.value / b.qty : input.pastPrice.get(s.skuId) ?? s.stdPrice;
    const hasCounts = !!opening || !!closing;
    const actQty = hasCounts ? (opening?.qty ?? 0) + received - (closing?.qty ?? 0) : null;
    const cost = actQty !== null ? actQty * actPrice : null;
    const pv = actQty !== null ? (actPrice - s.stdPrice) * actQty : null;
    const tv = cost !== null ? cost - s.stdCost : null;
    if (tv !== null) {
      actCost += cost!;
      totalVar += tv;
      priceVar += pv ?? 0;
      withCounts += 1;
    }
    return { ...s, opening, received, receipts: b?.n ?? 0, closing, actQty, actPrice, actCost: cost, qtyVar: actQty !== null ? actQty - s.stdQty : null, priceVar: pv, totalVar: tv };
  });
  rows.sort((a, b) => Math.abs(b.totalVar ?? 0) - Math.abs(a.totalVar ?? 0));
  return { rows, actCost, totalVar, priceVar, usageVar: totalVar - priceVar, withCounts };
}

// ─── Things worth a look ───

export type Tone = "red" | "amber" | "info";
export interface Attention {
  key: string;
  tone: Tone;
  title: string;
  detail: string;
  /** Opens the ingredient (its sheet) or the menu in Cost Center */
  skuId?: string;
  menuCode?: string;
}

/** Above this, a menu's standard cost is flagged */
export const FC_TARGET = 35;

const n0 = (n: number) => Math.round(n).toLocaleString("th-TH");
const baht = (n: number) => `${n < 0 ? "−" : "+"}฿${n0(Math.abs(n))}`;

export function findAttention(input: {
  std: Standard;
  actual: Actual | null;
  /** Dates in the period (up to today) with no sales at a selected branch */
  missingDays: { branch: string; dates: string[] }[];
}): Attention[] {
  const out: Attention[] = [];
  for (const m of input.missingDays) {
    if (!m.dates.length) continue;
    out.push({
      key: `gap-${m.branch}`,
      tone: "amber",
      title: `${m.branch} ไม่มียอดขาย ${m.dates.length} วัน`,
      detail: `${dateRanges(m.dates)} · ต้นทุนช่วงนี้ไม่มียอดขายมาหาร ตัวเลขทั้งเดือนจะเพี้ยน`,
    });
  }
  if (input.actual) {
    // More used by the recipes than there ever was: the recipes count something twice
    // Only when it's worth money (฿300+): a few grams of pepper never stocked is noise
    const impossible = input.actual.rows
      .filter((r) => r.actQty !== null && r.opening && r.stdQty > 0 && r.stdQty > (r.opening.qty + r.received) * 1.1 + 1 && Math.abs(r.stdCost - (r.actCost ?? 0)) >= 300)
      .sort((a, b) => Math.abs(b.stdCost - (b.actCost ?? 0)) - Math.abs(a.stdCost - (a.actCost ?? 0)));
    for (const r of impossible.slice(0, 3)) {
      out.push({
        key: `imp-${r.skuId}`,
        tone: "red",
        skuId: r.skuId,
        title: `${r.name}: สูตรบอกใช้ ${n0(r.stdQty)} ${r.uom} แต่มีทั้งเดือนแค่ ${n0(r.opening!.qty + r.received)}`,
        detail: `ยกมา ${n0(r.opening!.qty)} + รับ ${n0(r.received)} · ใช้จริง ${n0(r.actQty!)} · สูตรน่าจะนับซ้ำหรือใส่จำนวนเกิน (${baht(r.totalVar ?? 0)})`,
      });
    }
    const shown = new Set(impossible.slice(0, 3).map((r) => r.skuId));
    const off = input.actual.rows.filter((r) => !shown.has(r.skuId) && r.qtyVar !== null && r.stdQty > 0 && Math.abs(r.qtyVar) / r.stdQty > 0.25 && Math.abs(r.totalVar ?? 0) >= 300);
    for (const r of off.slice(0, 3)) {
      const pct = Math.round((r.qtyVar! / r.stdQty) * 100);
      out.push({
        key: `var-${r.skuId}`,
        tone: "amber",
        skuId: r.skuId,
        title: `${r.name}: ใช้จริง${pct > 0 ? "มากกว่า" : "น้อยกว่า"}สูตร ${pct > 0 ? "+" : ""}${pct}%`,
        detail: `${r.qtyVar! > 0 ? "+" : "−"}${n0(Math.abs(r.qtyVar!))} ${r.uom} · ${baht(r.totalVar ?? 0)} · ${pct > 0 ? "ของเสีย / ตักเกิน / สูตรใส่น้อยไป" : "สูตรใส่เกิน / ไม่ได้ทำตามสูตร / นับไม่ครบ"}`,
      });
    }
  }
  const high = input.std.menus.filter((m) => m.pct > FC_TARGET && m.revenue > 0).slice(0, 3);
  for (const m of high) {
    out.push({
      key: `menu-${m.code}`,
      tone: "amber",
      menuCode: m.code,
      title: `${m.name}: ต้นทุน ${m.pct.toFixed(1)}% ของราคาขาย (เป้า ${FC_TARGET}%)`,
      detail: `ขาย ${n0(m.qty)} · ต้นทุน ฿${m.perServing.toFixed(2)}/ที่`,
    });
  }
  for (const r of input.std.skus.filter((s) => s.correction)) {
    out.push({
      key: `corr-${r.skuId}`,
      tone: "info",
      skuId: r.skuId,
      title: `${r.name}: ปรับ ${r.correction!.qty > 0 ? "+" : "−"}${n0(Math.abs(r.correction!.qty))} ${r.uom} จากที่สูตรนับ`,
      detail: r.correction!.reasons.join(" · "),
    });
  }
  // Sold with money but not set up (free option lines like "เค็มปกติ" don't matter)
  const unknownPaid = input.std.unknownMenus.filter((x) => x.revenue > 0);
  if (unknownPaid.length) {
    const u = unknownPaid;
    out.push({
      key: "unknown",
      tone: "amber",
      title: `ขายแล้วไม่มีในรายการเมนู ${u.length} รหัส · ยอด ฿${n0(u.reduce((t, x) => t + x.revenue, 0))} ไม่มีต้นทุน`,
      detail: u
        .slice(0, 3)
        .map((x) => `${x.code} ${x.name}`.trim())
        .join(" · "),
    });
  }
  return out;
}

/** 2026-10-09 … 2026-10-17 → "9–17 ต.ค." (consecutive days joined) */
export function dateRanges(dates: string[]): string {
  const sorted = [...dates].sort();
  const parts: string[] = [];
  const fmt = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("th-TH", { day: "numeric", month: "short" });
  let start = sorted[0];
  let prev = sorted[0];
  for (const d of [...sorted.slice(1), ""]) {
    if (d && Date.parse(d) - Date.parse(prev) === 86_400_000) {
      prev = d;
      continue;
    }
    parts.push(start === prev ? fmt(start) : `${new Date(`${start}T00:00:00`).getDate()}–${fmt(prev)}`);
    start = d;
    prev = d;
  }
  return parts.join(", ");
}

/** Dates from `from` to `to` (not after today) with no sales line at the branch */
export function datesWithoutSales(sales: FcSale[], branchId: string, from: string, to: string, today: string): string[] {
  const had = new Set(sales.filter((s) => s.branch_id === branchId).map((s) => s.sale_date));
  const end = to < today ? to : today;
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${end}T00:00:00Z`); t += 86_400_000) {
    const d = new Date(t).toISOString().slice(0, 10);
    if (!had.has(d)) out.push(d);
  }
  return out;
}
