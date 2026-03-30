import { useState, useEffect } from "react";
import { SKU } from "@/types/sku";
import { supabase } from "@/integrations/supabase/client";

/**
 * Sales-based daily SM SKU usage over last 7 days.
 * sales_entries × menu_bom effective_qty ÷ 7
 * Shared between Dashboard and SM Stock pages.
 */
export function useSmDailyUsage(skus: SKU[]) {
  const [smDailyUsage, setSmDailyUsage] = useState<Record<string, number>>({});

  useEffect(() => {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const dateStr = sevenDaysAgo.toISOString().split("T")[0];

    Promise.all([
      supabase.from("sales_entries").select("menu_code, qty, sale_date").gte("sale_date", dateStr),
      supabase.from("menu_bom").select("menu_id, sku_id, effective_qty"),
      supabase.from("menus").select("id, menu_code"),
    ]).then(([salesRes, bomRes, menusRes]) => {
      if (!salesRes.data || !bomRes.data || !menusRes.data) return;
      const menuCodeToId = new Map(menusRes.data.map((m: any) => [m.menu_code, m.id]));
      const smSkuIds = new Set(skus.filter((s) => s.type === "SM").map((s) => s.id));
      const usage: Record<string, number> = {};
      // Build per-SKU active days: count distinct sale dates for menus that use each SM SKU
      const skuActiveDays: Record<string, Set<string>> = {};
      salesRes.data.forEach((sale: any) => {
        const menuId = menuCodeToId.get(sale.menu_code);
        if (!menuId) return;
        bomRes
          .data!.filter((l: any) => l.menu_id === menuId && smSkuIds.has(l.sku_id))
          .forEach((line: any) => {
            if (!skuActiveDays[line.sku_id]) skuActiveDays[line.sku_id] = new Set();
            skuActiveDays[line.sku_id].add(sale.sale_date);
          });
      });

      salesRes.data.forEach((sale: any) => {
        const menuId = menuCodeToId.get(sale.menu_code);
        if (!menuId) return;
        bomRes
          .data!.filter((l: any) => l.menu_id === menuId && smSkuIds.has(l.sku_id))
          .forEach((line: any) => {
            const activeDays = Math.max(1, skuActiveDays[line.sku_id]?.size ?? 1);
            usage[line.sku_id] = (usage[line.sku_id] || 0) + (line.effective_qty * Number(sale.qty)) / activeDays;
          });
      });
      setSmDailyUsage(usage);
    });
  }, [skus]);

  return smDailyUsage;
}
