import type { Standard } from "@/lib/food-cost";

/**
 * Food Cost's per-menu standard cost as rows of public.food_cost_menu_monthly, so
 * analysts can read it with SQL. Kept apart from the hook so it can be tested; the
 * write itself is in use-food-cost.ts.
 */

export interface MenuMonthRow {
  branch_id: string;
  branch_name: string;
  brand_name: string;
  /** First of the month, yyyy-mm-01 */
  month: string;
  menu_code: string;
  menu_name: string;
  category: string;
  qty: number;
  revenue: number;
  /** null = no recipe (menu not set up) */
  std_cost: number | null;
  cost_per_serving: number | null;
  cost_pct: number | null;
  has_recipe_cost: boolean;
  /** Sold on days this code had no recipe (normally 0; only with recipe history) */
  uncosted_qty: number;
  uncosted_revenue: number;
  is_closed_month: boolean;
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
// Stored to 4 decimals: sums still reconcile with the page, without float noise
const r4 = (v: number) => Math.round(v * 10_000) / 10_000;

/** The month's first day when from–to is exactly one calendar month, else null (a custom range) */
export function wholeMonthOf(from: string, to: string): string | null {
  const first = `${from.slice(0, 7)}-01`;
  if (from !== first) return null;
  const d = new Date(`${first}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return to === iso(new Date(d.getFullYear(), d.getMonth() + 1, 0)) ? first : null;
}

/**
 * One branch-month's rows: every menu on the page (same numbers as the menu tab) plus
 * menus not set up (std_cost null), so Σ revenue = the page's ยอดขาย. null = not a whole
 * month (never stored). A code can be both (no recipe on some days under recipe history):
 * one row, the costed part decides cost_pct/cost_per_serving as on the page.
 */
export function toMenuMonthRows(input: { std: Standard; branch: { id: string; name: string; brand: string }; from: string; to: string; today: string }): MenuMonthRow[] | null {
  const month = wholeMonthOf(input.from, input.to);
  if (!month) return null;
  const closed = input.to < input.today;
  const base = { branch_id: input.branch.id, branch_name: input.branch.name, brand_name: input.branch.brand, month, is_closed_month: closed };
  const out = new Map<string, MenuMonthRow>();
  for (const m of input.std.menus) {
    out.set(m.code, { ...base, menu_code: m.code, menu_name: m.name, category: m.category, qty: r4(m.qty), revenue: r4(m.revenue), std_cost: r4(m.stdCost), cost_per_serving: r4(m.perServing), cost_pct: r4(m.pct), has_recipe_cost: true, uncosted_qty: 0, uncosted_revenue: 0 });
  }
  for (const u of input.std.unknownMenus) {
    const code = u.code ?? "";
    const known = out.get(code);
    if (known) {
      known.qty = r4(known.qty + u.qty);
      known.revenue = r4(known.revenue + u.revenue);
      known.uncosted_qty = r4(u.qty);
      known.uncosted_revenue = r4(u.revenue);
      continue;
    }
    out.set(code, { ...base, menu_code: code, menu_name: u.name || code, category: "", qty: r4(u.qty), revenue: r4(u.revenue), std_cost: null, cost_per_serving: null, cost_pct: null, has_recipe_cost: false, uncosted_qty: r4(u.qty), uncosted_revenue: r4(u.revenue) });
  }
  // Stable order: the same month worked out twice gives the same rows (skip a re-write)
  return [...out.values()].sort((a, b) => a.menu_code.localeCompare(b.menu_code));
}

/**
 * Replacing one branch-month: everything new is upserted, then the codes already
 * stored that aren't in it any more are removed (never removed before the new rows are in).
 */
export function planMonthReplace(rows: MenuMonthRow[], storedCodes: string[]): { upsert: MenuMonthRow[]; remove: string[] } {
  const keep = new Set(rows.map((r) => r.menu_code));
  return { upsert: rows, remove: [...new Set(storedCodes)].filter((c) => !keep.has(c)).sort() };
}
