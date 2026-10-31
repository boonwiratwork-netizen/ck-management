import { supabase } from "@/integrations/supabase/client";
import { fetchAllRowsOrThrow } from "@/lib/fetch-all";
import { addSaleUsage, buildUsageContext, type UsageContext } from "@/lib/sale-usage";

/**
 * The usage engine's context read straight from the database, for hooks that don't
 * get menus/recipes/rules as props (branch stock, transfer requests, store stock).
 * Every branch's recipe lines are kept with their branch: the engine picks the
 * sale's own branch, so one context serves every branch.
 */
export async function loadUsageContext(): Promise<UsageContext> {
  // A failed page fails the read: half the recipes would quietly understate usage
  const all = <T,>(table: string, columns: string, filter?: (q: any) => any) => // eslint-disable-line @typescript-eslint/no-explicit-any
    fetchAllRowsOrThrow<T>((a, b) => {
      let q = supabase.from(table as "menus").select(columns);
      if (filter) q = filter(q);
      return q.order("id").range(a, b) as never;
    });

  const [menus, bom, rules, ruleMenus, sp, skus] = await Promise.all([
    all<{ id: string; menu_code: string }>("menus", "id, menu_code"),
    all<{ menu_id: string; sku_id: string; effective_qty: number; branch_id: string | null }>("menu_bom", "id, menu_id, sku_id, effective_qty, branch_id"),
    all<{ id: string; rule_type: string; keyword: string; sku_id: string | null; swap_sku_id: string | null; submenu_id: string | null; qty_per_match: number; is_active: boolean; branch_ids: string[] | null }>(
      "menu_modifier_rules",
      "id, rule_type, keyword, sku_id, swap_sku_id, submenu_id, qty_per_match, is_active, branch_ids",
      (q) => q.eq("is_active", true),
    ),
    all<{ rule_id: string; menu_id: string }>("modifier_rule_menus", "id, rule_id, menu_id"),
    all<{ sp_sku_id: string; ingredient_sku_id: string; qty_per_batch: number; batch_yield_qty: number }>("sp_bom", "id, sp_sku_id, ingredient_sku_id, qty_per_batch, batch_yield_qty"),
    all<{ id: string; type: string }>("skus", "id, type"),
  ]);
  const menusByRule = new Map<string, string[]>();
  for (const rm of ruleMenus) menusByRule.set(rm.rule_id, [...(menusByRule.get(rm.rule_id) ?? []), rm.menu_id]);
  return buildUsageContext({
    menus: menus.map((m) => ({ id: m.id, menuCode: m.menu_code })),
    bomLines: bom.map((l) => ({ menuId: l.menu_id, skuId: l.sku_id, effectiveQty: Number(l.effective_qty) || 0, branchId: l.branch_id })),
    rules: rules.map((r) => ({
      id: r.id,
      ruleType: r.rule_type,
      keyword: r.keyword,
      skuId: r.sku_id || null,
      swapSkuId: r.swap_sku_id,
      submenuId: r.submenu_id,
      qtyPerMatch: Number(r.qty_per_match) || 0,
      isActive: r.is_active,
      branchIds: r.branch_ids ?? [],
      menuIds: menusByRule.get(r.id) ?? [],
    })),
    spLines: sp.map((l) => ({ spSkuId: l.sp_sku_id, ingredientSkuId: l.ingredient_sku_id, qtyPerBatch: Number(l.qty_per_batch) || 0, batchYieldQty: Number(l.batch_yield_qty) || 1 })),
    skus,
  });
}

/**
 * Sales → usage of the given SKUs, in total and per day, through the one engine.
 * Lines whose menu isn't set up are skipped (no usage), as everywhere else.
 */
export type UsageSaleRow = { sale_date: string; menu_code: string; menu_name: string | null; qty: number | string };

export function usageOf(
  ctx: UsageContext,
  sales: UsageSaleRow[],
  branchId: string,
  /** Only these SKUs; null = every ingredient */
  skuIds: Set<string> | null,
): { total: Record<string, number>; byDay: Record<string, Record<string, number>> } {
  const total: Record<string, number> = {};
  const byDay: Record<string, Record<string, number>> = {};
  for (const s of sales) {
    addSaleUsage(ctx, { menu_code: s.menu_code, menu_name: s.menu_name, qty: s.qty, branch_id: branchId }, (id, q) => {
      if (skuIds && !skuIds.has(id)) return;
      total[id] = (total[id] || 0) + q;
      const d = (byDay[id] ??= {});
      d[s.sale_date] = (d[s.sale_date] || 0) + q;
    });
  }
  return { total, byDay };
}

