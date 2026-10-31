import { useState, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toLocalDateStr } from "@/lib/utils";
import { loadBranchStock, sharedBranchRead, type BranchStockData } from "@/hooks/use-branch-stock";
import { branchFigures, receiptConverter } from "@/lib/branch-stock";
import { dailyUseWindow } from "@/lib/daily-use";
import { requestFigures, type RequestStatus } from "@/lib/request-lines";

export type BranchRmStockStatus = RequestStatus;

export interface BranchRmStockEntry {
  stockOnHand: number;
  /** On no count sheet in 5 weeks: on hand unknown (see requestFigures) */
  stockKnown?: boolean;
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
  /** The stock read failed: the list stays, its stock is unknown until a retry */
  const [stockError, setStockError] = useState(false);

  const calculate = useCallback(async () => {
    if (!branchId || !supplierId) {
      setRmStock({});
      setRmSkuList([]);
      setZeroLeadTimeCount(0);
      setStockError(false);
      return;
    }
    setLoading(true);
    setStockError(false);
    const today = toLocalDateStr(new Date());
    // The branch's counts and recipes start now, beside the product list below
    const shared = sharedBranchRead(branchId, today);

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
        .select("id, sku_id, name, purchase_uom, usage_uom, pack_size, lead_time, type, pack_unit, converter")
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

      // 6. On hand and use per day exactly as the branch stock page works them out
      // (lib/branch-stock.ts): each product's anchor + receipts + moves − sales usage − waste
      // after it. This used to take the latest count row as it was, nothing received or used since.
      let stock: BranchStockData;
      try {
        stock = await loadBranchStock(branchId, today, new Set(filtered.map((s) => s.id)), shared, { prices: false });
      } catch {
        // The products stay on the list with their stock unknown, to retry
        setRmStock({});
        setStockError(true);
        return;
      }
      const conv = new Map(filtered.map((s) => [s.id, receiptConverter({ purchaseUom: s.purchase_uom, usageUom: s.usage_uom, converter: s.converter })]));
      const figures = branchFigures({ ...stock, window: dailyUseWindow(today), converter: (id) => conv.get(id) ?? 1 });

      // 7. Per SKU (lead time 0 counts as 1 day, as before)
      const result: Record<string, BranchRmStockEntry> = {};
      for (const s of filtered) {
        const packSize = Number(s.pack_size) || 1;
        const f = requestFigures(figures.get(s.id), { leadTime: Number(s.lead_time) || 1 });
        result[s.id] = { ...f, suggestedBatches: f.suggestedOrder > 0 ? Math.ceil(f.suggestedOrder / packSize) : 0 };
      }

      setRmStock(result);
    } catch {
      setRmStock({});
      setRmSkuList([]);
      setStockError(true);
    } finally {
      setLoading(false);
    }
  }, [branchId, supplierId]);

  useEffect(() => {
    calculate();
  }, [calculate]);

  return { rmStock, rmSkuList, loading, zeroLeadTimeCount, refresh: calculate, stockError };
}
