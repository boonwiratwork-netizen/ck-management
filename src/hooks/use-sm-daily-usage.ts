import { useState, useEffect } from "react";
import { SKU } from "@/types/sku";
import { supabase } from "@/integrations/supabase/client";
import { addSaleUsage, buildUsageContext } from "@/lib/sale-usage";

/**
 * Sales-based daily SM SKU usage over the last 7 days, counted the same way as
 * Food Cost (branch recipe lines, SP expansion, modifier rules incl. toppings and
 * set items), then divided by the days each SKU was actually used per branch.
 * Shared between Dashboard and SM Stock pages.
 */

// Supabase returns at most 1,000 rows per request; a week of sales is more than that
async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await build(from, from + 999);
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

export function useSmDailyUsage(skus: SKU[]) {
  const [smDailyUsage, setSmDailyUsage] = useState<Record<string, number>>({});

  useEffect(() => {
    if (skus.length === 0) return;
    let cancelled = false;
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const dateStr = sevenDaysAgo.toISOString().split("T")[0];

    (async () => {
      const [sales, bom, menus, rules, ruleMenus, sp] = await Promise.all([
        fetchAll<any>((a, b) =>
          supabase
            .from("sales_entries")
            .select("id, menu_code, menu_name, qty, sale_date, branch_id")
            .gte("sale_date", dateStr)
            .order("id")
            .range(a, b),
        ),
        fetchAll<any>((a, b) =>
          supabase.from("menu_bom").select("id, menu_id, sku_id, effective_qty, branch_id").order("id").range(a, b),
        ),
        fetchAll<any>((a, b) => supabase.from("menus").select("id, menu_code").order("id").range(a, b)),
        fetchAll<any>((a, b) => supabase.from("menu_modifier_rules").select("*").eq("is_active", true).order("id").range(a, b)),
        fetchAll<any>((a, b) => supabase.from("modifier_rule_menus").select("id, rule_id, menu_id").order("id").range(a, b)),
        fetchAll<any>((a, b) =>
          supabase.from("sp_bom").select("id, sp_sku_id, ingredient_sku_id, qty_per_batch, batch_yield_qty").order("id").range(a, b),
        ),
      ]);
      if (cancelled) return;

      const menusByRule = new Map<string, string[]>();
      for (const rm of ruleMenus) menusByRule.set(rm.rule_id, [...(menusByRule.get(rm.rule_id) ?? []), rm.menu_id]);
      const ctx = buildUsageContext({
        menus: menus.map((m) => ({ id: m.id, menuCode: m.menu_code })),
        bomLines: bom.map((l) => ({ menuId: l.menu_id, skuId: l.sku_id, effectiveQty: Number(l.effective_qty), branchId: l.branch_id })),
        rules: rules.map((r) => ({
          id: r.id,
          ruleType: r.rule_type,
          keyword: r.keyword,
          skuId: r.sku_id,
          swapSkuId: r.swap_sku_id,
          submenuId: r.submenu_id,
          qtyPerMatch: Number(r.qty_per_match) || 0,
          isActive: r.is_active,
          branchIds: r.branch_ids ?? [],
          menuIds: menusByRule.get(r.id) ?? [],
        })),
        spLines: sp.map((l) => ({
          spSkuId: l.sp_sku_id,
          ingredientSkuId: l.ingredient_sku_id,
          qtyPerBatch: Number(l.qty_per_batch),
          batchYieldQty: Number(l.batch_yield_qty) || 1,
        })),
        skus,
      });

      const smSkuIds = new Set(skus.filter((s) => s.type === "SM").map((s) => s.id));
      // usage and active days per SKU × branch
      const qtyByKey: Record<string, number> = {};
      const daysByKey: Record<string, Set<string>> = {};
      for (const sale of sales) {
        addSaleUsage(ctx, sale, (skuId, q) => {
          if (!smSkuIds.has(skuId)) return;
          const key = `${skuId}__${sale.branch_id}`;
          qtyByKey[key] = (qtyByKey[key] || 0) + q;
          (daysByKey[key] ??= new Set()).add(sale.sale_date);
        });
      }
      const usage: Record<string, number> = {};
      for (const [key, q] of Object.entries(qtyByKey)) {
        const skuId = key.split("__")[0];
        usage[skuId] = (usage[skuId] || 0) + q / Math.max(1, daysByKey[key]?.size ?? 1);
      }
      setSmDailyUsage(usage);
    })();
    return () => {
      cancelled = true;
    };
  }, [skus]);

  return smDailyUsage;
}
