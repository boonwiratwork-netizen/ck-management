import { fetchAllRows } from "@/lib/fetch-all";
import { useState, useCallback, useEffect } from "react";
import { loadUsageContext, usageOf, type UsageSaleRow } from "@/lib/usage-context-db";
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

      // 2. Get active menus for this brand + branch overrides
      const [menusRes, overridesRes] = await Promise.all([
        supabase.from("menus").select("id").eq("brand_name", branch.brand_name).eq("status", "Active"),
        supabase
          .from("branch_menu_overrides")
          .select("menu_id, is_active")
          .eq("branch_id", branchId)
          .eq("is_active", false),
      ]);
      const suppressedMenuIds = new Set((overridesRes.data || []).map((o) => o.menu_id));
      const menuIds = (menusRes.data || []).map((m) => m.id).filter((id) => !suppressedMenuIds.has(id));
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
      const todayStr = toLocalDateStr(today);
      const sevenDaysAgo = new Date(today);
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const dateFrom = toLocalDateStr(sevenDaysAgo);

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

      // Fetch waste per SKU per day for the same 7-day window
      const { data: wasteRows } = await supabase
        .from("daily_stock_counts")
        .select("sku_id, waste, count_date")
        .eq("branch_id", branchId)
        .gte("count_date", dateFrom)
        .lte("count_date", todayStr)
        .in("sku_id", skuIds);

      // Build waste map: skuId → { date → waste }
      const dailyWasteBySkuId: Record<string, Record<string, number>> = {};
      const totalWasteBySkuId: Record<string, number> = {};
      for (const row of wasteRows || []) {
        if (!row.waste || row.waste === 0) continue;
        totalWasteBySkuId[row.sku_id] = (totalWasteBySkuId[row.sku_id] || 0) + Number(row.waste);
        if (!dailyWasteBySkuId[row.sku_id]) dailyWasteBySkuId[row.sku_id] = {};
        dailyWasteBySkuId[row.sku_id][row.count_date] = Number(row.waste);
      }

      const totalUsageBySkuId: Record<string, number> = { ...usage.total };
      // Per-day usage per SKU (for the peak day)
      const dailyUsageBySkuId: Record<string, Record<string, number>> = Object.fromEntries(Object.entries(usage.byDay).map(([k, v]) => [k, { ...v }]));

      // 6. Snap + ledger balance: find most recent physical_count per SKU
      const { data: countData } = await supabase
        .from("daily_stock_counts")
        .select("sku_id, physical_count, calculated_balance, count_date")
        .eq("branch_id", branchId)
        .lte("count_date", todayStr)
        .in("sku_id", skuIds)
        .order("count_date", { ascending: false });

      const snapBySku: Record<string, { balance: number; date: string }> = {};
      for (const row of countData || []) {
        if (snapBySku[row.sku_id]) continue; // already have more recent
        // Prefer physical_count; fall back to calculated_balance (matches StoreStock/DSC behaviour)
        if (row.physical_count !== null) {
          snapBySku[row.sku_id] = { balance: Number(row.physical_count), date: row.count_date };
        } else if (row.calculated_balance !== null && row.calculated_balance !== undefined) {
          snapBySku[row.sku_id] = { balance: Number(row.calculated_balance), date: row.count_date };
        }
      }

      // Find earliest snap date for transaction queries — null (no lower bound) when
      // NO SKU in this batch has ever been counted, rather than a hardcoded date
      // standing in for "the beginning of time" (same anti-pattern as StoreStock's
      // removed 90-day cutoff, though this one doesn't roll forward and cut off real
      // history the way a relative-day cutoff would).
      let earliestSnap: string | null = null;
      const snapValues = Object.values(snapBySku);
      if (snapValues.length > 0) {
        earliestSnap = snapValues.reduce((min, s) => (s.date < min ? s.date : min), snapValues[0].date);
      }

      // 6b. Fetch CK receipts, external receipts, sales, and adjustments after snap
      let ckQuery = supabase
        .from("branch_receipts")
        .select("sku_id, qty_received, receipt_date")
        .eq("branch_id", branchId)
        .not("transfer_order_id", "is", null)
        .lte("receipt_date", todayStr)
        .in("sku_id", skuIds);
      if (earliestSnap) ckQuery = ckQuery.gt("receipt_date", earliestSnap);

      let extQuery = supabase
        .from("branch_receipts")
        .select("sku_id, qty_received, receipt_date")
        .eq("branch_id", branchId)
        .is("transfer_order_id", null)
        .lte("receipt_date", todayStr)
        .in("sku_id", skuIds);
      if (earliestSnap) extQuery = extQuery.gt("receipt_date", earliestSnap);

      // Sales since the earliest count can be many thousands of rows: page through all
      const salesQuery = fetchAllRows((a, b) => {
        let q = supabase
          .from("sales_entries")
          .select("menu_code, menu_name, qty, sale_date")
          .eq("branch_id", branchId)
          .lte("sale_date", todayStr);
        if (earliestSnap) q = q.gt("sale_date", earliestSnap);
        return q.order("id").range(a, b);
      });

      let adjQuery = supabase
        .from("stock_adjustments")
        .select("sku_id, quantity, adjustment_date, reason")
        .eq("branch_id", branchId)
        .lte("adjustment_date", todayStr)
        .in("sku_id", skuIds);
      if (earliestSnap) adjQuery = adjQuery.gt("adjustment_date", earliestSnap);

      const [ckRes, extRes, postSnapSalesRes, adjRes] = await Promise.all([
        ckQuery,
        extQuery,
        salesQuery,
        adjQuery,
      ]);

      // Build CK receipt totals per SKU after each SKU's snap date
      const ckInBySku: Record<string, number> = {};
      for (const line of ckRes.data || []) {
        const snap = snapBySku[line.sku_id];
        if (snap && line.receipt_date <= snap.date) continue;
        ckInBySku[line.sku_id] = (ckInBySku[line.sku_id] || 0) + Number(line.qty_received);
      }

      // Build external receipt totals per SKU after snap date
      const extInBySku: Record<string, number> = {};
      for (const r of extRes.data || []) {
        const snap = snapBySku[r.sku_id];
        if (snap && r.receipt_date <= snap.date) continue;
        extInBySku[r.sku_id] = (extInBySku[r.sku_id] || 0) + Number(r.qty_received);
      }

      // Build adjustment net per SKU after each SKU's snap date. Excludes "Stock
      // Count" reason rows, matching the canonical anchor-based formulas
      // (use-sm-stock-data.ts / use-stock-data.ts / StockCard.tsx) — a Stock Count
      // adjustment represents the count itself, not a real movement, so counting it
      // here too would double-count against the snap it's already reflected in.
      const adjNetBySku: Record<string, number> = {};
      for (const a of adjRes.data || []) {
        const snap = snapBySku[a.sku_id];
        if (snap && a.adjustment_date <= snap.date) continue;
        if ((a.reason || "").includes("Stock Count")) continue;
        adjNetBySku[a.sku_id] = (adjNetBySku[a.sku_id] || 0) + Number(a.quantity);
      }

      // Usage per SKU after its own count, from the sales since (same engine)
      const postSnapUsageBySku: Record<string, number> = {};
      {
        const after = usageOf(ctx, (postSnapSalesRes.data || []) as UsageSaleRow[], branchId, new Set(skuIds));
        for (const [skuId, days] of Object.entries(after.byDay)) {
          const snap = snapBySku[skuId];
          for (const [date, q] of Object.entries(days)) if (!snap || date > snap.date) postSnapUsageBySku[skuId] = (postSnapUsageBySku[skuId] || 0) + q;
        }
      }

      // 7. Get CK lead time
      const { data: ckSupplier } = await supabase
        .from("suppliers")
        .select("lead_time")
        .eq("is_central_kitchen", true)
        .limit(1)
        .maybeSingle();
      const leadTime = ckSupplier?.lead_time && ckSupplier.lead_time > 0 ? ckSupplier.lead_time : 1;

      // 8. Calculate per SKU — all values in grams
      const result: Record<string, BranchSmStockEntry> = {};

      for (const skuId of skuIds) {
        const activeDays = new Set((salesRows || []).map((s: any) => s.sale_date)).size || 1;
        const totalConsumption = (totalUsageBySkuId[skuId] || 0) + (totalWasteBySkuId[skuId] || 0);
        const avgDailyUsage = totalConsumption / activeDays;
        // Merge sales daily + waste daily for peak calculation
        const mergedDaily: Record<string, number> = { ...dailyUsageBySkuId[skuId] };
        for (const [date, w] of Object.entries(dailyWasteBySkuId[skuId] || {})) {
          mergedDaily[date] = (mergedDaily[date] || 0) + w;
        }
        const dailyValues = Object.values(mergedDaily);
        const peakDailyUsage = dailyValues.length > 0 ? Math.max(...dailyValues) : avgDailyUsage;
        const safetyStock = (peakDailyUsage - avgDailyUsage) * leadTime;

        // Snap + ledger balance — matches StoreStock formula: snap + ck + ext + adj - usage
        const snap = snapBySku[skuId];
        const base = snap?.balance ?? 0;
        const ckIn = ckInBySku[skuId] || 0;
        const extIn = extInBySku[skuId] || 0;
        const adjNet = adjNetBySku[skuId] || 0;
        const usageOut = postSnapUsageBySku[skuId] || 0;
        const stockOnHand = Math.max(0, base + ckIn + extIn + adjNet - usageOut);

        const rop = avgDailyUsage * leadTime + safetyStock;
        const parstock = avgDailyUsage + peakDailyUsage * leadTime;
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
          peakDailyUsage: Math.round(peakDailyUsage * 100) / 100,
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
