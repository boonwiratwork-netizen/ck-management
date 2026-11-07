/**
 * "วัตถุดิบใช้ในเมนูไหน" — the where-used matrix in Cost Center (pure logic, no React).
 *
 * Rows = menus that use any picked item, columns = the picked items. Only menu
 * recipes (menu_bom) are read and changed here; kitchen recipes (bom_lines) and
 * shop prep recipes (sp_bom) are never touched.
 *
 * Money math is the same as the recipe editor and the import:
 *   effective_qty    = qty ÷ (yield% ÷ 100)   (what stock is deducted per serving)
 *   cost_per_serving = effective_qty × the item's active price per usage unit
 */
import type { Menu } from "@/types/menu";
import type { MenuBomLine } from "@/types/menu-bom";
import type { Price } from "@/types/price";
import type { SKU } from "@/types/sku";
import { toLocalDateStr } from "@/lib/utils";

/** How many items can be picked at once (columns on a phone stay readable) */
export const MAX_PICKS = 6;

/** What stock is deducted per serving for `qty` at `yieldPct` % usable (0/negative yield: the qty as is, like the import) */
export function effectiveQty(qty: number, yieldPct: number): number {
  return yieldPct > 0 ? qty / (yieldPct / 100) : qty;
}

/** The item's active price per usage unit (first active one, as the import does); 0 when none */
export function activePrice(prices: Price[], skuId: string): number {
  return prices.find((p) => p.skuId === skuId && p.isActive)?.pricePerUsageUom ?? 0;
}

/** The columns written for one line at qty + yield */
export function lineValues(qty: number, yieldPct: number, price: number) {
  const eff = effectiveQty(qty, yieldPct);
  return { qtyPerServing: qty, yieldPct, effectiveQty: eff, costPerServing: eff * price };
}

/** Why an edit can't be saved (Thai, for the screen), or null when it can */
export function editProblem(qty: number, yieldPct: number): string | null {
  if (!Number.isFinite(qty) || qty <= 0) return "ปริมาณต่อจานต้องมากกว่า 0";
  if (!Number.isFinite(yieldPct) || yieldPct < 1 || yieldPct > 100) return "yield ต้องอยู่ระหว่าง 1–100%";
  return null;
}

/** Items that can be picked: active, and in at least one menu recipe — with how many menus use each */
export function pickableSkus(skus: SKU[], lines: MenuBomLine[]): { sku: SKU; menuCount: number }[] {
  const menusBySku = new Map<string, Set<string>>();
  for (const l of lines) {
    let set = menusBySku.get(l.skuId);
    if (!set) menusBySku.set(l.skuId, (set = new Set()));
    set.add(l.menuId);
  }
  return skus
    .filter((s) => s.status === "Active" && menusBySku.has(s.id))
    .map((sku) => ({ sku, menuCount: menusBySku.get(sku.id)!.size }))
    .sort((a, b) => a.sku.name.localeCompare(b.sku.name, "th"));
}

export interface MatrixRow {
  menu: Menu;
  active: boolean;
  /** skuId → the menu's lines of that item: the shared line first, then branch lines (never merged) */
  cells: Record<string, MenuBomLine[]>;
  /** Sold in the week (null while unknown) */
  soldWeek: number | null;
}

/**
 * One row per menu that uses any of `pickedSkuIds`. Open menus first, closed ones after
 * (each group by name). Lines whose menu isn't in `menus` are left out.
 */
export function buildMatrix(menus: Menu[], lines: MenuBomLine[], pickedSkuIds: string[], soldByCode: Record<string, number> | null): MatrixRow[] {
  const picked = new Set(pickedSkuIds);
  const byId = new Map(menus.map((m) => [m.id, m]));
  const rows = new Map<string, MatrixRow>();
  for (const l of lines) {
    if (!picked.has(l.skuId)) continue;
    const menu = byId.get(l.menuId);
    if (!menu) continue;
    let row = rows.get(menu.id);
    if (!row) rows.set(menu.id, (row = { menu, active: menu.status === "Active", cells: {}, soldWeek: soldByCode ? soldByCode[menu.menuCode] ?? 0 : null }));
    (row.cells[l.skuId] ??= []).push(l);
  }
  for (const row of rows.values())
    for (const cell of Object.values(row.cells)) cell.sort((a, b) => (a.branchId ? 1 : 0) - (b.branchId ? 1 : 0) || String(a.branchId ?? "").localeCompare(String(b.branchId ?? "")));
  return [...rows.values()].sort((a, b) => Number(b.active) - Number(a.active) || a.menu.menuName.localeCompare(b.menu.menuName, "th"));
}

export interface YieldChange {
  line: MenuBomLine;
  menu: Menu | undefined;
  oldYield: number;
  newYield: number;
  /** What the line becomes (qty unchanged) */
  next: ReturnType<typeof lineValues>;
}

/**
 * Every menu recipe line of `skuId` whose yield would change to `newYield`, with what each
 * becomes. Lines already at that yield are not in the list (they aren't written).
 */
export function bulkYieldPreview(lines: MenuBomLine[], menus: Menu[], skuId: string, newYield: number, price: number): YieldChange[] {
  const byId = new Map(menus.map((m) => [m.id, m]));
  return lines
    .filter((l) => l.skuId === skuId && Math.abs(l.yieldPct - newYield) > 1e-9)
    .map((line) => ({ line, menu: byId.get(line.menuId), oldYield: line.yieldPct, newYield, next: lineValues(line.qtyPerServing, newYield, price) }))
    .sort((a, b) => Number((b.menu?.status ?? "") === "Active") - Number((a.menu?.status ?? "") === "Active") || (a.menu?.menuName ?? "").localeCompare(b.menu?.menuName ?? "", "th"));
}

/** The last 7 finished days (yesterday and the 6 before it), as local dates */
export function lastWeek(today: Date = new Date()): { from: string; to: string } {
  const to = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const from = new Date(to.getFullYear(), to.getMonth(), to.getDate() - 6);
  return { from: toLocalDateStr(from), to: toLocalDateStr(to) };
}

/** Sales rows → qty per menu code (all branches) */
export function soldByMenuCode(rows: { menu_code: string | null; qty: number | string | null }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    if (!r.menu_code) continue;
    out[r.menu_code] = (out[r.menu_code] ?? 0) + (Number(r.qty) || 0);
  }
  return out;
}

/** "#usage/RM-0027,RM-0030" → the codes */
export function codesFromHash(hash: string): string[] {
  if (!hash.startsWith("usage/")) return [];
  return [...new Set(hash.slice("usage/".length).split(",").map((c) => c.trim()).filter(Boolean))].slice(0, MAX_PICKS);
}
