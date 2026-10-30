import { fetchAllRows } from "@/lib/fetch-all";
import { useState, useCallback, useEffect } from "react";
import { loadUsageContext, usageOf, type UsageSaleRow } from "@/lib/usage-context-db";
import { supabase } from "@/integrations/supabase/client";
import { toLocalDateStr } from "@/lib/utils";

export type BranchRmStockStatus = "critical" | "low" | "sufficient" | "no-data";

export interface BranchRmStockEntry {
  stockOnHand: number;
  avgDailyUsage: number;
  peakDailyUsage: number;
  rop: number;
  parstock: number;
  suggestedOrder: number;
  suggestedBatches: number;
  status: BranchRmStockStatus;
}

export interface BranchRmSkuInfo {
  skuId: string;
  skuCode: string;
  skuName: string;
  purchaseUom: string;
  usageUom: string;
  packSize: number;
  packUnit: string;
  leadTime: number;
}

export function useBranchRmStock(branchId: string | null, supplierId: string | null) {
  const [rmStock, setRmStock] = useState<Record<string, BranchRmStockEntry>>({});
  const [rmSkuList, setRmSkuList] = useState<BranchRmSkuInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [zeroLeadTimeCount, setZeroLeadTimeCount] = useState(0);

  const calculate = useCallback(async () => {
    if (!branchId || !supplierId) {
      setRmStock({});
      setRmSkuList([]);
      setZeroLeadTimeCount(0);
      return;
    }
    setLoading(true);

    try {
      // 1. Get branch brand_name
      const { data: branch } = await supabase.from("branches").select("brand_name").eq("id", branchId).single();
      if (!branch) {
        setRmStock({});
        setRmSkuList([]);
        setLoading(false);
        return;
      }

      // 2. Get active menus for this brand + branch overrides
      const [menusRes, overridesRes] = await Promise.all([
        supabase.from("menus").select("id").eq("brand_name", branch.brand_name).eq("status", "Active"),
        supabase.from("branch_menu_overrides").select("menu_id").eq("branch_id", branchId).eq("is_active", false),
      ]);
      const suppressedMenuIds = new Set((overridesRes.data || []).map((o) => o.menu_id));
      const menuIds = (menusRes.data || []).map((m) => m.id).filter((id) => !suppressedMenuIds.has(id));
      if (menuIds.length === 0) {
        setRmStock({});
        setRmSkuList([]);
        setLoading(false);
        return;
      }

      // 3. Get SM sku_ids from menu_bom
      const { data: bomEntries } = await supabase.from("menu_bom").select("sku_id").in("menu_id", menuIds);
      const smSkuIds = [...new Set((bomEntries || []).map((b) => b.sku_id))];

      // 4. Get RM ingredients from sp_bom for those SM SKUs
      let rmFromSpBom: string[] = [];
      if (smSkuIds.length > 0) {
        const { data: spBomLines } = await supabase
          .from("sp_bom")
          .select("ingredient_sku_id")
          .in("sp_sku_id", smSkuIds);
        rmFromSpBom = (spBomLines || []).map((l) => l.ingredient_sku_id);
      }

      // Also get direct RM ingredients from menu_bom (type=RM)
      const allBomSkuIds = [...new Set([...smSkuIds, ...rmFromSpBom])];
      if (allBomSkuIds.length === 0) {
        setRmStock({});
        setRmSkuList([]);
        setLoading(false);
        return;
      }

      // 5. Get RM SKU IDs that have active prices for this supplier
      const { data: priceRows } = await supabase
        .from("prices")
        .select("sku_id")
        .eq("supplier_id", supplierId)
        .eq("is_active", true)
        .in("sku_id", allBomSkuIds);

      const supplierSkuIds = [...new Set((priceRows || []).map((p) => p.sku_id))];
      if (supplierSkuIds.length === 0) {
        setRmStock({});
        setRmSkuList([]);
        setLoading(false);
        return;
      }

      // Fetch SKU details for those IDs
      const { data: rmSkus } = await supabase
        .from("skus")
        .select("id, sku_id, name, purchase_uom, usage_uom, pack_size, lead_time, type, pack_unit")
        .eq("status", "Active")
        .in("type", ["RM", "PK"])
        .in("id", supplierSkuIds);

      const filtered = rmSkus || [];
      if (filtered.length === 0) {
        setRmStock({});
        setRmSkuList([]);
        setLoading(false);
        return;
      }

      // Count zero lead times
      let zeroLtCount = 0;

      // Build SKU info list
      setRmSkuList(
        filtered.map((s) => {
          const lt = Number(s.lead_time) || 0;
          if (lt === 0) zeroLtCount++;
          return {
            skuId: s.id,
            skuCode: s.sku_id,
            skuName: s.name,
            purchaseUom: s.purchase_uom,
            usageUom: s.usage_uom,
            packSize: Number(s.pack_size) || 1,
            leadTime: lt,
            packUnit: s.pack_unit || "แพ็ค",
          };
        }),
      );
      setZeroLeadTimeCount(zeroLtCount);

      const skuIds = filtered.map((s) => s.id);

      // 6. Get avg daily usage from sales_entries (last 7 days) via menu_bom + sp_bom
      const today = new Date();
      const sevenDaysAgo = new Date(today);
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const dateFrom = toLocalDateStr(sevenDaysAgo);

      // Get sales for this branch last 7 days
      const { data: salesRows } = await fetchAllRows((a, b) =>
        supabase
          .from("sales_entries")
          .select("menu_code, menu_name, qty, sale_date")
          .eq("branch_id", branchId)
          .gte("sale_date", dateFrom)
          .order("id")
          .range(a, b),
      );

      // Usage through the one engine (sale-usage.ts): recipe → SP → rules, as Food Cost
      // and the count sheet count it
      const ctx = await loadUsageContext();
      const usage = usageOf(ctx, (salesRows || []) as UsageSaleRow[], branchId, new Set(skuIds));

      // Fetch waste from daily_stock_counts
      const todayStr = toLocalDateStr(today);
      const { data: wasteRows } = await supabase
        .from("daily_stock_counts")
        .select("sku_id, waste, count_date")
        .eq("branch_id", branchId)
        .gte("count_date", dateFrom)
        .lte("count_date", todayStr)
        .gt("waste", 0)
        .in("sku_id", skuIds);
      const totalWasteBySkuId: Record<string, number> = {};
      const dailyWasteBySkuId: Record<string, Record<string, number>> = {};
      for (const row of wasteRows || []) {
        totalWasteBySkuId[row.sku_id] = (totalWasteBySkuId[row.sku_id] || 0) + Number(row.waste);
        if (!dailyWasteBySkuId[row.sku_id]) dailyWasteBySkuId[row.sku_id] = {};
        dailyWasteBySkuId[row.sku_id][row.count_date] =
          (dailyWasteBySkuId[row.sku_id][row.count_date] || 0) + Number(row.waste);
      }

      // Total usage per SKU over the 7 days
      const totalUsageBySkuId: Record<string, number> = { ...usage.total };

      // Add waste to total usage
      for (const [wSkuId, wTotal] of Object.entries(totalWasteBySkuId)) {
        totalUsageBySkuId[wSkuId] = (totalUsageBySkuId[wSkuId] || 0) + wTotal;
      }

      // 7. Get latest stock on hand from daily_stock_counts
      // Remove is_submitted filter — matches StoreStock/DSC behaviour (not submitted-gated)
      const { data: latestCounts } = await supabase
        .from("daily_stock_counts")
        .select("sku_id, physical_count, calculated_balance")
        .eq("branch_id", branchId)
        .in("sku_id", skuIds)
        .order("count_date", { ascending: false });

      // Keep only latest row per SKU — prefer physical_count, fall back to calculated_balance
      const latestBySkuId: Record<string, { physical_count: number | null; calculated_balance: number }> = {};
      for (const row of latestCounts || []) {
        if (!latestBySkuId[row.sku_id]) {
          latestBySkuId[row.sku_id] = {
            physical_count: row.physical_count,
            calculated_balance: Number(row.calculated_balance),
          };
        }
      }

      // Build lead time map
      const ltMap: Record<string, number> = {};
      for (const s of filtered) {
        ltMap[s.id] = Number(s.lead_time) || 1;
      }

      // 8. Calculate per SKU
      const result: Record<string, BranchRmStockEntry> = {};

      // Per-day usage per SKU (for the peak day)
      const dailyUsageBySkuId: Record<string, Record<string, number>> = Object.fromEntries(Object.entries(usage.byDay).map(([k, v]) => [k, { ...v }]));

      // Add waste to daily usage
      for (const [wSkuId, dates] of Object.entries(dailyWasteBySkuId)) {
        if (!dailyUsageBySkuId[wSkuId]) dailyUsageBySkuId[wSkuId] = {};
        for (const [date, waste] of Object.entries(dates)) {
          dailyUsageBySkuId[wSkuId][date] = (dailyUsageBySkuId[wSkuId][date] || 0) + waste;
        }
      }

      for (const skuId of skuIds) {
        const skuInfo = filtered.find((s) => s.id === skuId);
        const packSize = Number(skuInfo?.pack_size) || 1;
        const leadTime = ltMap[skuId] || 1;
        const activeDays = new Set((salesRows || []).map((s: any) => s.sale_date)).size || 1;
        const avgDailyUsage = (totalUsageBySkuId[skuId] || 0) / activeDays;
        const latest = latestBySkuId[skuId];
        const stockOnHand = latest
          ? latest.physical_count != null
            ? Number(latest.physical_count)
            : latest.calculated_balance
          : 0;

        const dailyValues = Object.values(dailyUsageBySkuId[skuId] || {});
        const peakDailyUsage = dailyValues.length > 0 ? Math.max(...dailyValues) : avgDailyUsage;
        const safetyStock = (peakDailyUsage - avgDailyUsage) * leadTime;
        const rop = avgDailyUsage * leadTime + safetyStock;
        const parstock = avgDailyUsage + peakDailyUsage * leadTime;
        const suggestedOrder = Math.max(0, parstock - stockOnHand);
        const suggestedBatches = suggestedOrder > 0 ? Math.ceil(suggestedOrder / packSize) : 0;

        let status: BranchRmStockStatus;
        if (avgDailyUsage === 0) status = "no-data";
        else if (stockOnHand === 0) status = "critical";
        else if (stockOnHand < rop) status = "low";
        else if (stockOnHand >= parstock) status = "sufficient";
        else status = "low";

        result[skuId] = {
          stockOnHand,
          avgDailyUsage: Math.round(avgDailyUsage * 100) / 100,
          peakDailyUsage: Math.round(peakDailyUsage * 100) / 100,
          rop: Math.round(rop * 100) / 100,
          parstock: Math.round(parstock * 100) / 100,
          suggestedOrder: Math.round(suggestedOrder * 100) / 100,
          suggestedBatches,
          status,
        };
      }

      setRmStock(result);
    } catch {
      setRmStock({});
      setRmSkuList([]);
    } finally {
      setLoading(false);
    }
  }, [branchId, supplierId]);

  useEffect(() => {
    calculate();
  }, [calculate]);

  return { rmStock, rmSkuList, loading, zeroLeadTimeCount, refresh: calculate };
}
