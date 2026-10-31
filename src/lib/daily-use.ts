import { addSaleUsage, type UsageContext } from "@/lib/sale-usage";
import { toLocalDateStr } from "@/lib/utils";

/**
 * "Used per day", one definition for every screen (branch stock, the request page, the
 * kitchen's SM cover day and the production plan): the last 7 days up to today in
 * Bangkok dates, (sales usage + waste) ÷ the days the branch sold anything
 * (CLAUDE.md avgDailyUsage). The request page used to average 8 days and the kitchen
 * a UTC week while branch stock used 7, so the same item read differently per page.
 */
export const DAILY_USE_DAYS = 7;

export interface DayWindow {
  from: string;
  to: string;
}

/** today−6 … today (today's sales usually arrive at closing; selling days count only days with sales) */
export function dailyUseWindow(today: string): DayWindow {
  const d = new Date(`${today}T00:00:00`);
  d.setDate(d.getDate() - (DAILY_USE_DAYS - 1));
  return { from: toLocalDateStr(d), to: today };
}

export const inWindow = (w: DayWindow, date: string) => date >= w.from && date <= w.to;

/** Days in the window with any sales line (one branch's sales) */
export function sellingDays(sales: { sale_date: string }[], w: DayWindow): number {
  return new Set(sales.filter((s) => inWindow(w, s.sale_date)).map((s) => s.sale_date)).size;
}

/** (used + wasted) ÷ selling days; nothing sold = 0 */
export const perDay = (used: number, wasted: number, days: number) => (days > 0 ? (used + wasted) / days : 0);

export interface BranchSaleRow {
  branch_id: string;
  sale_date: string;
  menu_code: string;
  menu_name: string | null;
  qty: number | string;
}
export interface BranchWasteRow {
  branch_id: string;
  sku_id: string;
  count_date: string;
  waste: number;
}

/**
 * Per branch, each item's use per day over the window: sales through the one usage
 * engine (the sale's own branch recipe lines, SP expansion, option rules) plus waste
 * typed on the count sheet, ÷ that branch's selling days. Rows outside the window are
 * left out. `skuIds` null = every item.
 */
export function branchUsePerDay(input: { ctx: UsageContext; sales: BranchSaleRow[]; waste: BranchWasteRow[]; skuIds: Set<string> | null; window: DayWindow }): {
  perDay: Map<string, Record<string, number>>;
  sellingDays: Map<string, number>;
} {
  const { ctx, skuIds, window: w } = input;
  const used = new Map<string, Record<string, number>>();
  const days = new Map<string, Set<string>>();
  const add = (branch: string, skuId: string, q: number) => {
    if (skuIds && !skuIds.has(skuId)) return;
    const b = used.get(branch) ?? {};
    b[skuId] = (b[skuId] || 0) + q;
    used.set(branch, b);
  };
  for (const s of input.sales) {
    if (!inWindow(w, s.sale_date)) continue;
    const d = days.get(s.branch_id) ?? new Set<string>();
    d.add(s.sale_date);
    days.set(s.branch_id, d);
    addSaleUsage(ctx, { menu_code: s.menu_code, menu_name: s.menu_name, qty: s.qty, branch_id: s.branch_id }, (id, q) => add(s.branch_id, id, q));
  }
  for (const x of input.waste) if (inWindow(w, x.count_date)) add(x.branch_id, x.sku_id, Number(x.waste) || 0);
  const perDayOut = new Map<string, Record<string, number>>();
  const sellingOut = new Map<string, number>();
  for (const [branch, totals] of used) {
    const n = days.get(branch)?.size ?? 0;
    sellingOut.set(branch, n);
    perDayOut.set(branch, Object.fromEntries(Object.entries(totals).map(([id, q]) => [id, perDay(q, 0, n)])));
  }
  for (const [branch, d] of days) if (!sellingOut.has(branch)) sellingOut.set(branch, d.size);
  return { perDay: perDayOut, sellingDays: sellingOut };
}

/** All branches together: the kitchen sends to every branch */
export function totalPerDay(perDayByBranch: Map<string, Record<string, number>>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const items of perDayByBranch.values()) for (const [id, q] of Object.entries(items)) out[id] = (out[id] || 0) + q;
  return out;
}
