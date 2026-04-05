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

      const { data: salesRows } = await supabase
        .from("sales_entries")
        .select("menu_code, menu_name, qty, sale_date")
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
      let bomRows: { menu_id: string; sku_id: string; effective_qty: number }[] = [];
      if (salesMenuIds.length > 0) {
        const { data: bom } = await supabase
          .from("menu_bom")
          .select("menu_id, sku_id, effective_qty")
          .in("menu_id", salesMenuIds)
          .in("sku_id", skuIds);
        bomRows = (bom || []) as { menu_id: string; sku_id: string; effective_qty: number }[];
      }

      // Fetch modifier rules
      const [modRulesRes, modRuleMenusRes] = await Promise.all([
        supabase.from("menu_modifier_rules").select("*").eq("is_active", true),
        supabase.from("modifier_rule_menus").select("rule_id, menu_id"),
      ]);
      const ruleMenuMap: Record<string, string[]> = {};
      for (const rm of modRuleMenusRes.data || []) {
        if (!ruleMenuMap[rm.rule_id]) ruleMenuMap[rm.rule_id] = [];
        ruleMenuMap[rm.rule_id].push(rm.menu_id);
      }
      const modifierRules = (modRulesRes.data || []).map(r => ({
        id: r.id,
        keyword: r.keyword,
        skuId: r.sku_id,
        qtyPerMatch: Number(r.qty_per_match),
        ruleType: r.rule_type as string,
        swapSkuId: r.swap_sku_id,
        submenuId: r.submenu_id,
        menuIds: ruleMenuMap[r.id] || [],
        branchIds: (r.branch_ids || []) as string[],
      }));

      // For submenu rules, fetch BOM lines for submenu menus (SM SKUs only)
      const submenuIdList = [...new Set(modifierRules
        .filter(r => r.ruleType === "submenu" && r.submenuId)
        .map(r => r.submenuId!))];
      let submenuBomLines: { menu_id: string; sku_id: string; effective_qty: number }[] = [];
      if (submenuIdList.length > 0) {
        const { data: sbom } = await supabase
          .from("menu_bom")
          .select("menu_id, sku_id, effective_qty")
          .in("menu_id", submenuIdList)
          .in("sku_id", skuIds);
        submenuBomLines = (sbom || []) as any[];
      }

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

      const totalUsageBySkuId: Record<string, number> = {};

      for (const bom of bomRows) {
        const soldQty = qtySoldByMenuId[bom.menu_id] || 0;
        if (soldQty === 0) continue;
        totalUsageBySkuId[bom.sku_id] = (totalUsageBySkuId[bom.sku_id] || 0) + soldQty * bom.effective_qty;
      }

      // Apply modifier rules to total usage
      for (const sale of salesRows || []) {
        const mid = menuCodeToId[sale.menu_code];
        if (!mid) continue;
        const menuName = (sale.menu_name || "").toLowerCase();
        const saleQty = Number(sale.qty);
        for (const rule of modifierRules) {
          if (rule.branchIds.length > 0 && !rule.branchIds.includes(branchId!)) continue;
          if (rule.menuIds.length > 0 && !rule.menuIds.includes(mid)) continue;
          if (rule.ruleType === "submenu") {
            if (sale.menu_code !== rule.keyword) continue;
            for (const sbom of submenuBomLines) {
              if (sbom.menu_id !== rule.submenuId) continue;
              totalUsageBySkuId[sbom.sku_id] = (totalUsageBySkuId[sbom.sku_id] || 0) + saleQty * sbom.effective_qty;
            }
          } else if (rule.ruleType === "swap") {
            if (!menuName.includes(rule.keyword.toLowerCase())) continue;
            if (rule.swapSkuId && skuIds.includes(rule.swapSkuId)) {
              const swapBom = bomRows.find(b => b.menu_id === mid && b.sku_id === rule.swapSkuId);
              if (swapBom) {
                totalUsageBySkuId[rule.swapSkuId] = (totalUsageBySkuId[rule.swapSkuId] || 0) - saleQty * swapBom.effective_qty;
              }
            }
            if (rule.skuId && skuIds.includes(rule.skuId)) {
              totalUsageBySkuId[rule.skuId] = (totalUsageBySkuId[rule.skuId] || 0) + saleQty * rule.qtyPerMatch;
            }
          } else if (rule.ruleType === "add") {
            if (!menuName.includes(rule.keyword.toLowerCase())) continue;
            if (rule.skuId && skuIds.includes(rule.skuId)) {
              totalUsageBySkuId[rule.skuId] = (totalUsageBySkuId[rule.skuId] || 0) + saleQty * rule.qtyPerMatch;
            }
          }
        }
      }

      // Build daily usage map for peak calculation
      const dailyUsageBySkuId: Record<string, Record<string, number>> = {};
      for (const sale of salesRows || []) {
        const mid = menuCodeToId[(sale as any).menu_code];
        if (!mid) continue;
        const date = (sale as any).sale_date;
        if (!date) continue;
        const relatedBoms = bomRows.filter((b) => b.menu_id === mid);
        for (const bom of relatedBoms) {
          if (!dailyUsageBySkuId[bom.sku_id]) dailyUsageBySkuId[bom.sku_id] = {};
          dailyUsageBySkuId[bom.sku_id][date] =
            (dailyUsageBySkuId[bom.sku_id][date] || 0) + Number(sale.qty) * bom.effective_qty;
        }
      }

      // Apply modifier rules to daily usage
      for (const sale of salesRows || []) {
        const mid = menuCodeToId[sale.menu_code];
        if (!mid) continue;
        const date = sale.sale_date;
        if (!date) continue;
        const menuName = (sale.menu_name || "").toLowerCase();
        const saleQty = Number(sale.qty);
        for (const rule of modifierRules) {
          if (rule.branchIds.length > 0 && !rule.branchIds.includes(branchId!)) continue;
          if (rule.menuIds.length > 0 && !rule.menuIds.includes(mid)) continue;
          if (rule.ruleType === "submenu") {
            if (sale.menu_code !== rule.keyword) continue;
            for (const sbom of submenuBomLines) {
              if (sbom.menu_id !== rule.submenuId) continue;
              if (!dailyUsageBySkuId[sbom.sku_id]) dailyUsageBySkuId[sbom.sku_id] = {};
              dailyUsageBySkuId[sbom.sku_id][date] = (dailyUsageBySkuId[sbom.sku_id][date] || 0) + saleQty * sbom.effective_qty;
            }
          } else if (rule.ruleType === "swap") {
            if (!menuName.includes(rule.keyword.toLowerCase())) continue;
            if (rule.swapSkuId && skuIds.includes(rule.swapSkuId)) {
              const swapBom = bomRows.find(b => b.menu_id === mid && b.sku_id === rule.swapSkuId);
              if (swapBom) {
                if (!dailyUsageBySkuId[rule.swapSkuId]) dailyUsageBySkuId[rule.swapSkuId] = {};
                dailyUsageBySkuId[rule.swapSkuId][date] = (dailyUsageBySkuId[rule.swapSkuId][date] || 0) - saleQty * swapBom.effective_qty;
              }
            }
            if (rule.skuId && skuIds.includes(rule.skuId)) {
              if (!dailyUsageBySkuId[rule.skuId]) dailyUsageBySkuId[rule.skuId] = {};
              dailyUsageBySkuId[rule.skuId][date] = (dailyUsageBySkuId[rule.skuId][date] || 0) + saleQty * rule.qtyPerMatch;
            }
          } else if (rule.ruleType === "add") {
            if (!menuName.includes(rule.keyword.toLowerCase())) continue;
            if (rule.skuId && skuIds.includes(rule.skuId)) {
              if (!dailyUsageBySkuId[rule.skuId]) dailyUsageBySkuId[rule.skuId] = {};
              dailyUsageBySkuId[rule.skuId][date] = (dailyUsageBySkuId[rule.skuId][date] || 0) + saleQty * rule.qtyPerMatch;
            }
          }
        }
      }

      // 6. Snap + ledger balance: find most recent physical_count per SKU
      const { data: countData } = await supabase
        .from("daily_stock_counts")
        .select("sku_id, physical_count, count_date")
        .eq("branch_id", branchId)
        .lte("count_date", todayStr)
        .in("sku_id", skuIds)
        .order("count_date", { ascending: false });

      const snapBySku: Record<string, { balance: number; date: string }> = {};
      for (const row of countData || []) {
        if (snapBySku[row.sku_id]) continue; // already have more recent
        if (row.physical_count !== null) {
          snapBySku[row.sku_id] = { balance: Number(row.physical_count), date: row.count_date };
        }
      }

      // Find earliest snap date for transaction queries
      let earliestSnap = "2020-01-01";
      const snapValues = Object.values(snapBySku);
      if (snapValues.length > 0) {
        earliestSnap = snapValues.reduce((min, s) => (s.date < min ? s.date : min), snapValues[0].date);
      }

      // 6b. Fetch CK receipts (transfer_order_lines) and external receipts after snap
      const [ckRes, extRes, postSnapSalesRes] = await Promise.all([
        supabase
          .from("branch_receipts")
          .select("sku_id, qty_received, receipt_date")
          .eq("branch_id", branchId)
          .not("transfer_order_id", "is", null)
          .gt("receipt_date", earliestSnap)
          .lte("receipt_date", todayStr)
          .in("sku_id", skuIds),
        supabase
          .from("branch_receipts")
          .select("sku_id, qty_received, receipt_date")
          .eq("branch_id", branchId)
          .is("transfer_order_id", null)
          .gt("receipt_date", earliestSnap)
          .lte("receipt_date", todayStr)
          .in("sku_id", skuIds),
        supabase
          .from("sales_entries")
          .select("menu_code, menu_name, qty, sale_date")
          .eq("branch_id", branchId)
          .gt("sale_date", earliestSnap)
          .lte("sale_date", todayStr),
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

      // Build usage per SKU after snap from post-snap sales
      const postSnapUsageBySku: Record<string, number> = {};
      {
        // Group sales by date
        const salesByDate = new Map<string, { menu_code: string; qty: number }[]>();
        for (const s of postSnapSalesRes.data || []) {
          const arr = salesByDate.get(s.sale_date) || [];
          arr.push({ menu_code: s.menu_code, qty: Number(s.qty) });
          salesByDate.set(s.sale_date, arr);
        }

        // Get all menu_bom for SM skuIds
        let allBomRows: { menu_id: string; sku_id: string; effective_qty: number }[] = [];
        const allSalesMenuCodes = [...new Set((postSnapSalesRes.data || []).map((s: any) => s.menu_code))];
        if (allSalesMenuCodes.length > 0) {
          const { data: menuLookup } = await supabase
            .from("menus")
            .select("id, menu_code")
            .in("menu_code", allSalesMenuCodes);
          const codeToId: Record<string, string> = {};
          for (const m of menuLookup || []) codeToId[m.menu_code] = m.id;

          const allMenuIds = [...new Set(Object.values(codeToId))];
          if (allMenuIds.length > 0) {
            const { data: bom } = await supabase
              .from("menu_bom")
              .select("menu_id, sku_id, effective_qty")
              .in("menu_id", allMenuIds)
              .in("sku_id", skuIds);
            allBomRows = (bom || []) as { menu_id: string; sku_id: string; effective_qty: number }[];
          }

          // Calculate usage per SKU per date, only counting after that SKU's snap
          const bomByMenuId = new Map<string, { sku_id: string; effective_qty: number }[]>();
          for (const b of allBomRows) {
            const arr = bomByMenuId.get(b.menu_id) || [];
            arr.push({ sku_id: b.sku_id, effective_qty: b.effective_qty });
            bomByMenuId.set(b.menu_id, arr);
          }

          for (const [date, dateSales] of salesByDate) {
            for (const sale of dateSales) {
              const mid = codeToId[sale.menu_code];
              if (!mid) continue;
              const lines = bomByMenuId.get(mid) || [];
              for (const line of lines) {
                const snap = snapBySku[line.sku_id];
                if (snap && date <= snap.date) continue;
                postSnapUsageBySku[line.sku_id] =
                  (postSnapUsageBySku[line.sku_id] || 0) + line.effective_qty * sale.qty;
              }
            }
          }
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

        // Snap + ledger balance
        const snap = snapBySku[skuId];
        const base = snap?.balance ?? 0;
        const ckIn = ckInBySku[skuId] || 0;
        const extIn = extInBySku[skuId] || 0;
        const usageOut = postSnapUsageBySku[skuId] || 0;
        const stockOnHand = Math.max(0, base + ckIn + extIn - usageOut);

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
