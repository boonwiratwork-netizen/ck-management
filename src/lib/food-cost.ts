import { addSaleUsage, type UsageContext } from "@/lib/sale-usage";
import { afterCount } from "@/lib/count-anchor";

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

/** The standard price on a day: price history, else today's standard price */
export const priceOnOf = (priceAt: ((skuId: string, date: string) => number | undefined) | undefined, stdPrice: Map<string, number>) => (skuId: string, date: string) => priceAt?.(skuId, date) ?? stdPrice.get(skuId) ?? 0;

export function computeStandard(input: {
  sales: FcSale[];
  ctx: UsageContext;
  stdPrice: Map<string, number>;
  /**
   * The standard price on a given day (price history), so a past month is priced
   * as it was then; falls back to stdPrice (today's) where there is no history
   */
  priceAt?: (skuId: string, date: string) => number | undefined;
  /** The recipes and option rules of a given day (recipe history); none = today's (ctx) */
  ctxAt?: (date: string) => UsageContext;
  menuByCode: Map<string, MenuInfo>;
  skuById: Map<string, SkuInfo>;
  corrections: UsageCorrection[];
  branchIds: Set<string>;
  from: string;
  to: string;
}): Standard {
  const { sales, ctx, stdPrice, menuByCode, skuById } = input;
  const priceOn = priceOnOf(input.priceAt, stdPrice);
  const usage = new Map<string, number>();
  // Baht of each item's usage, each sale at its own day's price
  const usageCost = new Map<string, number>();
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
    const known = addSaleUsage(input.ctxAt?.(s.sale_date) ?? ctx, s, (skuId, q) => {
      usage.set(skuId, (usage.get(skuId) ?? 0) + q);
      const c = q * priceOn(skuId, s.sale_date);
      usageCost.set(skuId, (usageCost.get(skuId) ?? 0) + c);
      cost += c;
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
    // Corrections are priced at the period's last day; the item's price shown is the
    // average over the period (one price when it didn't change)
    const endPrice = priceOn(id, input.to);
    const stdCost = qty <= 0 ? 0 : (usageCost.get(id) ?? 0) + (qty - raw) * endPrice;
    const price = qty > 0 ? stdCost / qty : endPrice;
    skus.push({ skuId: id, code: info?.code ?? "", name: info?.name ?? id, type: info?.type ?? "", uom: info?.uom ?? "", stdQty: qty, stdPrice: price, stdCost, correction: c });
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

// ─── The recipe over an item's own count span ───

export interface DayUse {
  qty: number;
  /** Baht at that day's standard price */
  cost: number;
}

/** Recipe usage per item per day of the sales given, each day with its own recipes and price (computeStandard's usage, kept by day) */
export function recipeByDay(input: { sales: FcSale[]; ctx: UsageContext; ctxAt?: (date: string) => UsageContext; priceOn: (skuId: string, date: string) => number }): Map<string, Map<string, DayUse>> {
  const out = new Map<string, Map<string, DayUse>>();
  for (const s of input.sales) {
    addSaleUsage(input.ctxAt?.(s.sale_date) ?? input.ctx, s, (skuId, q) => {
      const days = out.get(skuId) ?? new Map<string, DayUse>();
      const d = days.get(s.sale_date) ?? { qty: 0, cost: 0 };
      d.qty += q;
      d.cost += q * input.priceOn(skuId, s.sale_date);
      days.set(s.sale_date, d);
      out.set(skuId, days);
    });
  }
  return out;
}

/**
 * One item's recipe figure over a span (from … to, both days in), the way computeStandard
 * works out a period: each day at its own price, recorded corrections by their share of the
 * span (never below nothing), priced at the span's last day.
 */
export function recipeOver(days: Map<string, DayUse> | undefined, corrections: UsageCorrection[], from: string, to: string, endPrice: number): { qty: number; cost: number } {
  let raw = 0;
  let cost = 0;
  for (const [d, u] of days ?? []) {
    if (d < from || d > to) continue;
    raw += u.qty;
    cost += u.cost;
  }
  let corr: number | null = null;
  for (const c of corrections) {
    const share = overlapShare(c, from, to);
    if (share > 0) corr = (corr ?? 0) + c.qty * share;
  }
  const qty = corr !== null ? Math.max(0, raw + corr) : raw;
  return { qty, cost: qty <= 0 ? 0 : cost + (qty - raw) * endPrice };
}

const nextDay = (d: string) => {
  const x = new Date(`${d}T00:00:00`);
  x.setDate(x.getDate() + 1);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};

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
  /** Not counted on the span's last day (month end): the latest count before it */
  early: boolean;
  /** No physical count, the calculated balance was used */
  estimated: boolean;
}

/**
 * The last count of a span (CLAUDE.md "Food Cost Act Qty"): the latest physical count in
 * it, else — nothing typed in that span — the latest sheet's calculated balance. Rows
 * outside the span don't count: the nearest count ±3 days used to take the next month's
 * count as this month's closing while receipts stopped at month end.
 */
export function lastCount(rows: CountRow[], from: string, to: string): CountPick | null {
  const inSpan = rows.filter((r) => r.count_date >= from && r.count_date <= to);
  if (!inSpan.length) return null;
  const physical = inSpan.filter((r) => r.physical_count !== null);
  const pool = physical.length ? physical : inSpan;
  const best = pool.reduce((a, b) => (b.count_date > a.count_date ? b : a));
  const estimated = best.physical_count === null;
  return { qty: num(estimated ? best.calculated_balance : best.physical_count), date: best.count_date, early: best.count_date < to, estimated };
}

/**
 * A receipt counts between two branch counts when it's dated after the opening count's
 * day and up to the closing count's day: a branch count is the day's end (the count
 * sheet takes that day's receipts in before the count — the kitchen's count-anchor rule
 * for counts with no "counted before" mark), so the opening day's receipts are already in
 * the opening and the closing day's are in the closing.
 */
export const receivedBetween = (date: string, openingDate: string, closingDate: string) => afterCount({ count_date: openingDate }, date) && !afterCount({ count_date: closingDate }, date);

export interface ActualRow extends SkuRow {
  opening: CountPick | null;
  received: number;
  receipts: number;
  closing: CountPick | null;
  actQty: number | null;
  actPrice: number;
  actCost: number | null;
  /**
   * The recipe over this item's own count span — the day after its opening count up to its
   * closing count day, as receipts — which actual is compared with. The whole period when
   * it was counted on the month ends (stdQty / stdCost stay the period's figure).
   */
  recipeQty: number;
  recipeCost: number;
  span: { from: string; to: string };
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
  /** The recipe over the same spans as the counts (items with an actual): what actCost is compared with */
  recipeCost: number;
  /** The count days the actual comes from (items with an actual), first and last */
  openingDays: { first: string; last: string } | null;
  closingDays: { first: string; last: string } | null;
}

export function computeActual(input: {
  skus: SkuRow[];
  /** Count rows of the month before (the opening is its last count) */
  openingRows: CountRow[];
  /** Count rows of the period (the closing is its last count) */
  closingRows: CountRow[];
  /** Receipts from the start of the month before to the period's end; each item takes those between its two counts */
  receipts: ReceiptRow[];
  /** Usage units per purchase unit, per SKU */
  converter: Map<string, number>;
  /** Average paid before the receipts given, for items with none in them */
  pastPrice: Map<string, number>;
  /** The month before (opening) and the period (closing) */
  opening: { from: string; to: string };
  closing: { from: string; to: string };
  /** Recipe usage per item per day across both months (recipeByDay); none = compare with the period's figure */
  recipeDays?: Map<string, Map<string, DayUse>>;
  /** Recorded corrections of this branch across both months */
  corrections?: UsageCorrection[];
  priceOn?: (skuId: string, date: string) => number;
}): Actual {
  const group = (rows: CountRow[]) => {
    const m = new Map<string, CountRow[]>();
    for (const r of rows) m.set(r.sku_id, [...(m.get(r.sku_id) ?? []), r]);
    return m;
  };
  const openBy = group(input.openingRows);
  const closeBy = group(input.closingRows);
  const counted = (rows: CountRow[], span: { from: string; to: string }) => rows.some((r) => r.count_date >= span.from && r.count_date <= span.to);
  const openingCounted = counted(input.openingRows, input.opening);
  const closingCounted = counted(input.closingRows, input.closing);
  const receiptsBy = new Map<string, ReceiptRow[]>();
  for (const r of input.receipts) receiptsBy.set(r.sku_id, [...(receiptsBy.get(r.sku_id) ?? []), r]);
  // Usage units as the stock pages count them; price = what was paid ÷ that (the old
  // page multiplied unit price by the converted qty: wrong for ml → g items)
  const sum = (rows: ReceiptRow[]) =>
    rows.reduce(
      (b, r) => {
        const { qty, paid } = receiptUsage(r, input.converter.get(r.sku_id) || 1);
        return { qty: b.qty + qty, value: b.value + paid, n: b.n + 1 };
      },
      { qty: 0, value: 0, n: 0 },
    );

  let actCost = 0;
  let totalVar = 0;
  let priceVar = 0;
  let withCounts = 0;
  let recipeCost = 0;
  const days = { open: [] as string[], close: [] as string[] };
  const rows: ActualRow[] = input.skus.map((s) => {
    const opening = lastCount(openBy.get(s.skuId) ?? [], input.opening.from, input.opening.to);
    const closing = lastCount(closeBy.get(s.skuId) ?? [], input.closing.from, input.closing.to);
    // Received between the two counts (no count at one end: from the period's start / to its end)
    const lo = opening?.date ?? input.opening.to;
    const hi = closing?.date ?? input.closing.to;
    const all = receiptsBy.get(s.skuId) ?? [];
    const b = sum(all.filter((r) => receivedBetween(r.receipt_date, lo, hi)));
    const received = b.qty;
    // Paid for what came in between the counts; else for anything received around them; else before
    const around = b.qty > 0 ? b : sum(all);
    const actPrice = around.qty > 0 ? around.value / around.qty : input.pastPrice.get(s.skuId) ?? s.stdPrice;
    // An item on one month's sheets but none of the other's, while the branch counted that
    // month, wasn't carried then: 0. An item on no sheet in either month (packaging, a rule-only
    // item) or a month the branch didn't count at all says nothing: no actual, not a count of 0
    const onSheets = !!opening || !!closing;
    const openQty = opening ? opening.qty : openingCounted && onSheets ? 0 : null;
    const closeQty = closing ? closing.qty : closingCounted && onSheets ? 0 : null;
    const actQty = openQty !== null && closeQty !== null ? openQty + received - closeQty : null;
    // Compared with the recipe over the same days (sales on the opening count's day are in
    // that count, the closing day's in the closing): an early count used to be set against
    // the whole month and read as "the recipe counts twice"
    const span = { from: nextDay(lo), to: hi };
    const corr = (input.corrections ?? []).filter((c) => c.skuId === s.skuId);
    const recipe = input.recipeDays ? recipeOver(input.recipeDays.get(s.skuId), corr, span.from, span.to, input.priceOn?.(s.skuId, span.to) ?? s.stdPrice) : { qty: s.stdQty, cost: s.stdCost };
    const recipePrice = recipe.qty > 0 ? recipe.cost / recipe.qty : s.stdPrice;
    const cost = actQty !== null ? actQty * actPrice : null;
    const pv = actQty !== null ? (actPrice - recipePrice) * actQty : null;
    const tv = cost !== null ? cost - recipe.cost : null;
    if (tv !== null) {
      actCost += cost!;
      totalVar += tv;
      priceVar += pv ?? 0;
      recipeCost += recipe.cost;
      withCounts += 1;
      if (opening) days.open.push(opening.date);
      if (closing) days.close.push(closing.date);
    }
    return { ...s, opening, received, receipts: b.n, closing, actQty, actPrice, actCost: cost, recipeQty: recipe.qty, recipeCost: recipe.cost, span, qtyVar: actQty !== null ? actQty - recipe.qty : null, priceVar: pv, totalVar: tv };
  });
  rows.sort((a, b) => Math.abs(b.totalVar ?? 0) - Math.abs(a.totalVar ?? 0));
  const firstLast = (d: string[]) => (d.length ? { first: d.reduce((m, x) => (x < m ? x : m)), last: d.reduce((m, x) => (x > m ? x : m)) } : null);
  return { rows, actCost, totalVar, priceVar, usageVar: totalVar - priceVar, withCounts, recipeCost, openingDays: firstLast(days.open), closingDays: firstLast(days.close) };
}

/**
 * Actual as % of sales, comparable with the recipe %: the recipe % × actual ÷ the recipe
 * over the same items and days (the counts' spans). Dividing the counts' cost by the whole
 * month's sales read 37.3% against a recipe 20.0% with ฿0 difference.
 */
export function actualPct(std: { revenue: number; stdCost: number }, actual: { actCost: number; recipeCost: number }): number | null {
  if (std.revenue <= 0) return null;
  return actual.recipeCost > 0 ? (std.stdCost / std.revenue) * (actual.actCost / actual.recipeCost) * 100 : (actual.actCost / std.revenue) * 100;
}

/**
 * The named reads of a loader, each once per distinct arguments while it's in use: the
 * trend works out several months, and a month's sales and counts are also the next
 * month's "month before" (they used to be read again, one month after another).
 */
export function readOnce<T extends object>(loader: T, names: (keyof T)[]): T {
  const memo = new Map<string, unknown>();
  const out = { ...loader };
  for (const n of names) {
    const read = loader[n] as unknown as (...args: unknown[]) => unknown;
    (out as Record<keyof T, unknown>)[n] = (...args: unknown[]) => {
      const key = `${String(n)}|${JSON.stringify(args)}`;
      if (!memo.has(key)) memo.set(key, read(...args));
      return memo.get(key);
    };
  }
  return out;
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
    // (the recipe over the same days as the item's counts, not the whole month)
    const impossible = input.actual.rows
      .filter((r) => r.actQty !== null && r.opening && r.recipeQty > 0 && r.recipeQty > (r.opening.qty + r.received) * 1.1 + 1 && Math.abs(r.recipeCost - (r.actCost ?? 0)) >= 300)
      .sort((a, b) => Math.abs(b.recipeCost - (b.actCost ?? 0)) - Math.abs(a.recipeCost - (a.actCost ?? 0)));
    for (const r of impossible.slice(0, 3)) {
      out.push({
        key: `imp-${r.skuId}`,
        tone: "red",
        skuId: r.skuId,
        title: `${r.name}: สูตรบอกใช้ ${n0(r.recipeQty)} ${r.uom} แต่มีทั้งช่วงนับแค่ ${n0(r.opening!.qty + r.received)}`,
        detail: `ยกมา ${n0(r.opening!.qty)} + รับ ${n0(r.received)} · ใช้จริง ${n0(r.actQty!)} · สูตรน่าจะนับซ้ำหรือใส่จำนวนเกิน (${baht(r.totalVar ?? 0)})`,
      });
    }
    const shown = new Set(impossible.slice(0, 3).map((r) => r.skuId));
    const off = input.actual.rows.filter((r) => !shown.has(r.skuId) && r.qtyVar !== null && r.recipeQty > 0 && Math.abs(r.qtyVar) / r.recipeQty > 0.25 && Math.abs(r.totalVar ?? 0) >= 300);
    for (const r of off.slice(0, 3)) {
      const pct = Math.round((r.qtyVar! / r.recipeQty) * 100);
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
