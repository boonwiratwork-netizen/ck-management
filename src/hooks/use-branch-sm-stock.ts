import { useState, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toLocalDateStr } from "@/lib/utils";

export type BranchSmStockStatus = "critical" | "low" | "sufficient" | "no-data";

export interface BranchSmStockEntry {
  stockOnHand: number;
  avgDailyUsage: number;
  peakDailyUsage: number;
  rop: number;
  parstock: number;
  suggestedOrder: number;
  status: BranchSmStockStatus;
}

export interface BranchSmSkuInfo {
  skuId: string;
  skuCode: string;
  skuName: string;
  uom: string;
  packSize: number;
}

export function useBranchSmStock(branchId: string | null) {
  const [smStock, setSmStock] = useState<Record<string, BranchSmStockEntry>>({});
  const [smSkuList, setSmSkuList] = useState<BranchSmSkuInfo[]>([]);
  const [loading, setLoading] = useState(false);

  const calculate = useCallback(async () => {
    if (!branchId) {
      setSmStock({});
      setSmSkuList([]);
      return;
    }
    setLoading(true);

    try {
      // 1. Get branch brand_name
      const { data: branch } = await supabase.from("branches").select("brand_name").eq("id", branchId).single();
      if (!branch) {
        setSmStock({});
        setSmSkuList([]);
        setLoading(false);
        return;
      }

      // 2. Get active menus for this brand
      const { data: menus } = await supabase
        .from("menus")
        .select("id")
        .eq("brand_name", branch.brand_name)
        .eq("status", "Active");
      const menuIds = (menus || []).map((m) => m.id);
      if (menuIds.length === 0) {
        setSmStock({});
        setSmSkuList([]);
        setLoading(false);
        return;
      }

      // 3. Get distinct SM sku_ids from menu_bom for those menus
      const { data: bomEntries } = await supabase.from("menu_bom").select("sku_id").in("menu_id", menuIds);
      const bomSkuIds = [...new Set((bomEntries || []).map((b) => b.sku_id))];
      if (bomSkuIds.length === 0) {
        setSmStock({});
        setSmSkuList([]);
        setLoading(false);
        return;
      }

      // 4. Filter to active SM SKUs only
      const { data: smSkus } = await supabase
        .from("skus")
        .select("id, sku_id, name, usage_uom, pack_size")
        .eq("type", "SM")
        .eq("status", "Active")
        .in("id", bomSkuIds);
      const skuRecords = smSkus || [];
      const skuIds = skuRecords.map((s) => s.id);
      if (skuIds.length === 0) {
        setSmStock({});
        setSmSkuList([]);
        setLoading(false);
        return;
      }

      // Build SKU info list
      setSmSkuList(
        skuRecords.map((s) => ({
          skuId: s.id,
          skuCode: s.sku_id,
          skuName: s.name,
          uom: s.usage_uom,
          packSize: Number(s.pack_size) || 1,
        })),
      );

      // 5. Get avg daily usage from sales_entries (last 7 days)
      const today = new Date();
      const sevenDaysAgo = new Date(today);
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const dateFrom = toLocalDateStr(sevenDaysAgo);

      const { data: salesRows } = await supabase
        .from("sales_entries")
        .select("menu_code, qty")
        .eq("branch_id", branchId)
        .gte("sale_date", dateFrom);

      // Get menu_id lookup from menu_code
      const menuCodes = [...new Set((salesRows || []).map((s) => s.menu_code))];
      let menuCodeToId: Record<string, string> = {};
      if (menuCodes.length > 0) {
        const { data: menuRows } = await supabase.from("menus").select("id, menu_code").in("menu_code", menuCodes);
        for (const m of menuRows || []) {
          menuCodeToId[m.menu_code] = m.id;
        }
      }

      // Sum qty sold per menu_id
      const qtySoldByMenuId: Record<string, number> = {};
      for (const s of salesRows || []) {
        const mid = menuCodeToId[s.menu_code];
        if (!mid) continue;
        qtySoldByMenuId[mid] = (qtySoldByMenuId[mid] || 0) + Number(s.qty);
      }

      const salesMenuIds = Object.keys(qtySoldByMenuId);

      // Get menu_bom for those menus — SM SKUs only
      let bomRows: { menu_id: string; sku_id: string; qty_per_serving: number }[] = [];
      if (salesMenuIds.length > 0) {
        const { data: bom } = await supabase
          .from("menu_bom")
          .select("menu_id, sku_id, qty_per_serving")
          .in("menu_id", salesMenuIds)
          .in("sku_id", skuIds);
        bomRows = bom || [];
      }

      // Calculate total usage per SM SKU over 7 days
      const totalUsageBySkuId: Record<string, number> = {};
      for (const bom of bomRows) {
        const soldQty = qtySoldByMenuId[bom.menu_id] || 0;
        if (soldQty === 0) continue;
        totalUsageBySkuId[bom.sku_id] = (totalUsageBySkuId[bom.sku_id] || 0) + soldQty * bom.qty_per_serving;
      }

      // 6. Get latest stock on hand from daily_stock_counts
      const { data: latestCounts } = await supabase
        .from("daily_stock_counts")
        .select("sku_id, physical_count, calculated_balance")
        .eq("branch_id", branchId)
        .eq("is_submitted", true)
        .in("sku_id", skuIds)
        .order("count_date", { ascending: false });

      const latestBySkuId: Record<string, { physical_count: number | null; calculated_balance: number }> = {};
      for (const row of latestCounts || []) {
        if (!latestBySkuId[row.sku_id]) {
          latestBySkuId[row.sku_id] = {
            physical_count: row.physical_count,
            calculated_balance: Number(row.calculated_balance),
          };
        }
      }

      // 7. Get CK lead time
      const { data: ckSupplier } = await supabase
        .from("suppliers")
        .select("lead_time")
        .eq("is_central_kitchen", true)
        .limit(1)
        .maybeSingle();
      const leadTime = ckSupplier?.lead_time ?? 1;

      // 8. Calculate per SKU — all values in grams
      const result: Record<string, BranchSmStockEntry> = {};

      for (const skuId of skuIds) {
        const skuInfo = skuRecords.find((s) => s.id === skuId);
        const packSize = Number(skuInfo?.pack_size) || 1;
        const avgDailyUsage = (totalUsageBySkuId[skuId] || 0) / 7;
        const latest = latestBySkuId[skuId];
        const stockOnHand = latest
          ? latest.physical_count != null
            ? Number(latest.physical_count)
            : latest.calculated_balance
          : 0;

        const rop = avgDailyUsage * leadTime;
        const parstock = avgDailyUsage * (leadTime * 2);
        const suggestedOrder = Math.max(0, parstock - stockOnHand);

        let status: BranchSmStockStatus;
        if (avgDailyUsage === 0) status = "no-data";
        else if (stockOnHand === 0) status = "critical";
        else if (stockOnHand < rop) status = "low";
        else if (stockOnHand >= parstock) status = "sufficient";
        else status = "low";

        result[skuId] = {
          stockOnHand,
          avgDailyUsage: Math.round(avgDailyUsage * 100) / 100,
          peakDailyUsage: 0,
          rop: Math.round(rop * 100) / 100,
          parstock: Math.round(parstock * 100) / 100,
          suggestedOrder: Math.round(suggestedOrder * 100) / 100,
          status,
        };
      }

      setSmStock(result);
    } catch {
      setSmStock({});
      setSmSkuList([]);
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => {
    calculate();
  }, [calculate]);

  return { smStock, smSkuList, loading, refresh: calculate };
}
