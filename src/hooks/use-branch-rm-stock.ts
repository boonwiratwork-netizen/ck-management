import { useState, useCallback, useEffect } from "react";
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
        .eq("type", "RM")
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

      // Get menu_bom for those menus
      let bomRows: { menu_id: string; sku_id: string; qty_per_serving: number; effective_qty: number }[] = [];
      if (salesMenuIds.length > 0) {
        const { data: bom } = await supabase
          .from("menu_bom")
          .select("menu_id, sku_id, qty_per_serving, effective_qty")
          .in("menu_id", salesMenuIds);
        bomRows = bom || [];
      }

      // Collect SP sku_ids from bom
      const spSkuIdsInBom = bomRows.filter((b) => !skuIds.includes(b.sku_id)).map((b) => b.sku_id);

      // Get sp_bom for those SP SKUs
      let spBomRows: {
        sp_sku_id: string;
        ingredient_sku_id: string;
        qty_per_batch: number;
        batch_yield_qty: number;
      }[] = [];
      if (spSkuIdsInBom.length > 0) {
        const { data: spb } = await supabase
          .from("sp_bom")
          .select("sp_sku_id, ingredient_sku_id, qty_per_batch, batch_yield_qty")
          .in("sp_sku_id", spSkuIdsInBom)
          .in("ingredient_sku_id", skuIds);
        spBomRows = spb || [];
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

      // For submenu rules, fetch BOM lines + SP expansion for RM ingredients
      const submenuIdList = [...new Set(modifierRules
        .filter(r => r.ruleType === "submenu" && r.submenuId)
        .map(r => r.submenuId!))];
      let submenuBomAll: { menu_id: string; sku_id: string; effective_qty: number }[] = [];
      let submenuSpBom: { sp_sku_id: string; ingredient_sku_id: string; qty_per_batch: number; batch_yield_qty: number }[] = [];
      if (submenuIdList.length > 0) {
        const { data: sbom } = await supabase
          .from("menu_bom")
          .select("menu_id, sku_id, effective_qty")
          .in("menu_id", submenuIdList);
        submenuBomAll = (sbom || []) as any[];
        const submenuSpSkuIds = [...new Set(submenuBomAll
          .filter(b => !skuIds.includes(b.sku_id))
          .map(b => b.sku_id))];
        if (submenuSpSkuIds.length > 0) {
          const { data: sspb } = await supabase
            .from("sp_bom")
            .select("sp_sku_id, ingredient_sku_id, qty_per_batch, batch_yield_qty")
            .in("sp_sku_id", submenuSpSkuIds)
            .in("ingredient_sku_id", skuIds);
          submenuSpBom = sspb || [];
        }
      }

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
        dailyWasteBySkuId[row.sku_id][row.count_date] = (dailyWasteBySkuId[row.sku_id][row.count_date] || 0) + Number(row.waste);
      }

      // Calculate avg daily usage per RM SKU
      const totalUsageBySkuId: Record<string, number> = {};

      for (const bom of bomRows) {
        const soldQty = qtySoldByMenuId[bom.menu_id] || 0;
        if (soldQty === 0) continue;

        if (skuIds.includes(bom.sku_id)) {
          // Direct RM in menu_bom
          totalUsageBySkuId[bom.sku_id] = (totalUsageBySkuId[bom.sku_id] || 0) + soldQty * bom.effective_qty;
        } else {
          // SP SKU — explode via sp_bom
          const spLines = spBomRows.filter((sb) => sb.sp_sku_id === bom.sku_id);
          for (const sp of spLines) {
            const batchYield = Number(sp.batch_yield_qty) || 1;
            totalUsageBySkuId[sp.ingredient_sku_id] =
              (totalUsageBySkuId[sp.ingredient_sku_id] || 0) +
              soldQty * bom.effective_qty * (sp.qty_per_batch / batchYield);
          }
        }
      }

      // Apply modifier rules to total usage
      for (const sale of salesRows || []) {
        const mid = menuCodeToId[(sale as any).menu_code];
        if (!mid) continue;
        const menuName = ((sale as any).menu_name || "").toLowerCase();
        const saleQty = Number(sale.qty);
        for (const rule of modifierRules) {
          if (rule.branchIds.length > 0 && !rule.branchIds.includes(branchId!)) continue;
          if (rule.menuIds.length > 0 && !rule.menuIds.includes(mid)) continue;
          if (rule.ruleType === "submenu") {
            if ((sale as any).menu_code !== rule.keyword) continue;
            for (const sbom of submenuBomAll) {
              if (sbom.menu_id !== rule.submenuId) continue;
              if (skuIds.includes(sbom.sku_id)) {
                totalUsageBySkuId[sbom.sku_id] = (totalUsageBySkuId[sbom.sku_id] || 0) + saleQty * sbom.effective_qty;
              } else {
                const spLines = submenuSpBom.filter(sp => sp.sp_sku_id === sbom.sku_id);
                for (const sp of spLines) {
                  const batchYield = Number(sp.batch_yield_qty) || 1;
                  totalUsageBySkuId[sp.ingredient_sku_id] = (totalUsageBySkuId[sp.ingredient_sku_id] || 0) +
                    saleQty * sbom.effective_qty * (sp.qty_per_batch / batchYield);
                }
              }
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

      // Add waste to total usage
      for (const [wSkuId, wTotal] of Object.entries(totalWasteBySkuId)) {
        totalUsageBySkuId[wSkuId] = (totalUsageBySkuId[wSkuId] || 0) + wTotal;
      }

      // 7. Get latest stock on hand from daily_stock_counts
      const { data: latestCounts } = await supabase
        .from("daily_stock_counts")
        .select("sku_id, physical_count, calculated_balance")
        .eq("branch_id", branchId)
        .eq("is_submitted", true)
        .in("sku_id", skuIds)
        .order("count_date", { ascending: false });

      // Keep only latest row per SKU
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

      // Peak daily usage per SKU — salesRows as outer loop to prevent double-count
      const dailyUsageBySkuId: Record<string, Record<string, number>> = {};
      for (const sale of salesRows || []) {
        const mid = menuCodeToId[(sale as any).menu_code];
        if (!mid) continue;
        const date = (sale as any).sale_date;
        if (!date) continue;
        for (const bom of bomRows) {
          if (bom.menu_id !== mid) continue;
          if (skuIds.includes(bom.sku_id)) {
            if (!dailyUsageBySkuId[bom.sku_id]) dailyUsageBySkuId[bom.sku_id] = {};
            dailyUsageBySkuId[bom.sku_id][date] =
              (dailyUsageBySkuId[bom.sku_id][date] || 0) + Number(sale.qty) * bom.effective_qty;
          } else {
            const spLines = spBomRows.filter((sb) => sb.sp_sku_id === bom.sku_id);
            for (const sp of spLines) {
              if (!dailyUsageBySkuId[sp.ingredient_sku_id]) dailyUsageBySkuId[sp.ingredient_sku_id] = {};
              const batchYield = Number(sp.batch_yield_qty) || 1;
              dailyUsageBySkuId[sp.ingredient_sku_id][date] =
                (dailyUsageBySkuId[sp.ingredient_sku_id][date] || 0) +
                Number(sale.qty) * bom.effective_qty * (sp.qty_per_batch / batchYield);
            }
          }
        }
      }

      // Apply modifier rules to daily usage
      for (const sale of salesRows || []) {
        const mid = menuCodeToId[(sale as any).menu_code];
        if (!mid) continue;
        const date = (sale as any).sale_date;
        if (!date) continue;
        const menuName = ((sale as any).menu_name || "").toLowerCase();
        const saleQty = Number(sale.qty);
        for (const rule of modifierRules) {
          if (rule.branchIds.length > 0 && !rule.branchIds.includes(branchId!)) continue;
          if (rule.menuIds.length > 0 && !rule.menuIds.includes(mid)) continue;
          if (rule.ruleType === "submenu") {
            if ((sale as any).menu_code !== rule.keyword) continue;
            for (const sbom of submenuBomAll) {
              if (sbom.menu_id !== rule.submenuId) continue;
              if (skuIds.includes(sbom.sku_id)) {
                if (!dailyUsageBySkuId[sbom.sku_id]) dailyUsageBySkuId[sbom.sku_id] = {};
                dailyUsageBySkuId[sbom.sku_id][date] = (dailyUsageBySkuId[sbom.sku_id][date] || 0) + saleQty * sbom.effective_qty;
              } else {
                const spLines = submenuSpBom.filter(sp => sp.sp_sku_id === sbom.sku_id);
                for (const sp of spLines) {
                  const batchYield = Number(sp.batch_yield_qty) || 1;
                  if (!dailyUsageBySkuId[sp.ingredient_sku_id]) dailyUsageBySkuId[sp.ingredient_sku_id] = {};
                  dailyUsageBySkuId[sp.ingredient_sku_id][date] = (dailyUsageBySkuId[sp.ingredient_sku_id][date] || 0) +
                    saleQty * sbom.effective_qty * (sp.qty_per_batch / batchYield);
                }
              }
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
