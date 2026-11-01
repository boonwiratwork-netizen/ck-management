import { useState, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toLocalDateStr } from "@/lib/utils";
import { loadBranchStock, sharedBranchRead, type BranchStockData } from "@/hooks/use-branch-stock";
import { branchFigures, receiptConverter } from "@/lib/branch-stock";
import { dailyUseWindow } from "@/lib/daily-use";
import { requestFigures, type RequestStatus } from "@/lib/request-lines";
import { brandMenuIds } from "@/lib/branch-menus-db";
import { fetchAllRowsOrThrow } from "@/lib/fetch-all";

export type BranchSmStockStatus = RequestStatus;

export interface BranchSmStockEntry {
  stockOnHand: number;
  /** On no count sheet in 5 weeks: on hand unknown (see requestFigures) */
  stockKnown?: boolean;
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
  /** The stock read failed: the list stays, its stock is unknown until a retry */
  const [stockError, setStockError] = useState(false);
  /** The branch the figures on hand are for (null = none read yet) */
  const [stockFor, setStockFor] = useState<string | null>(null);

  const calculate = useCallback(async () => {
    if (!branchId) {
      setSmStock({});
      setSmSkuList([]);
      setStockError(false);
      return;
    }
    setLoading(true);
    const today = toLocalDateStr(new Date());
    // The branch's counts and recipes start now, beside the product list below (one read
    // shared with the raw-material list of the same request page)
    const shared = sharedBranchRead(branchId, today);

    try {
      // 1. The branch's brand and its active menus, the branch's closed menus, the active SM
      // products and the kitchen's lead time — all in one round (they were five in a row)
      const [brand, overridesRes, smRes, ckRes] = await Promise.all([
        brandMenuIds(branchId),
        supabase
          .from("branch_menu_overrides")
          .select("menu_id, is_active")
          .eq("branch_id", branchId)
          .eq("is_active", false),
        fetchAllRowsOrThrow<{ id: string; sku_id: string; name: string; usage_uom: string; pack_size: number; purchase_uom: string; converter: number }>((a, b) =>
          supabase.from("skus").select("id, sku_id, name, usage_uom, pack_size, purchase_uom, converter").eq("type", "SM").eq("status", "Active").order("id").range(a, b),
        ).then((data) => ({ data })),
        supabase.from("suppliers").select("lead_time").eq("is_central_kitchen", true).limit(1).maybeSingle(),
      ]);
      if (!brand) {
        setSmStock({});
        setSmSkuList([]);
        setStockError(false);
        setLoading(false);
        return;
      }

      // 2. Active menus for this brand, less the ones closed at this branch
      const suppressedMenuIds = new Set((overridesRes.data || []).map((o) => o.menu_id));
      const menuIds = brand.menuIds.filter((id) => !suppressedMenuIds.has(id));
      if (menuIds.length === 0) {
        setSmStock({});
        setSmSkuList([]);
        setStockError(false);
        setLoading(false);
        return;
      }

      // 3. Get distinct SM sku_ids from menu_bom for those menus
      const { data: bomEntries } = await supabase.from("menu_bom").select("sku_id").in("menu_id", menuIds);
      const bomSkuIds = new Set((bomEntries || []).map((b) => b.sku_id));
      if (bomSkuIds.size === 0) {
        setSmStock({});
        setSmSkuList([]);
        setStockError(false);
        setLoading(false);
        return;
      }

      // 4. Active SM SKUs on those recipes only
      const skuRecords = (smRes.data || []).filter((s) => bomSkuIds.has(s.id));
      const skuIds = skuRecords.map((s) => s.id);
      if (skuIds.length === 0) {
        setSmStock({});
        setSmSkuList([]);
        setStockError(false);
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

      // 5. On hand and use per day exactly as the branch stock page works them out
      // (lib/branch-stock.ts): each product's anchor + receipts + moves − sales usage − waste
      // after it, use over the shared 7-day window. This hook used to keep its own copy,
      // which skipped waste after the count.
      // CK lead time (read in step 1)
      const ckSupplier = ckRes.data;
      const leadTime = ckSupplier?.lead_time && ckSupplier.lead_time > 0 ? ckSupplier.lead_time : 1;
      let stock: BranchStockData;
      try {
        stock = await loadBranchStock(branchId, today, new Set(skuIds), shared, { prices: false });
      } catch {
        // The products stay on the list with their stock unknown ("ไม่มีสินค้าให้ขอ" was wrong)
        setSmStock({});
        setStockError(true);
        return;
      }
      setStockError(false);
      const conv = new Map(skuRecords.map((s) => [s.id, receiptConverter({ purchaseUom: s.purchase_uom, usageUom: s.usage_uom, converter: s.converter })]));
      const figures = branchFigures({ ...stock, window: dailyUseWindow(today), converter: (id) => conv.get(id) ?? 1 });

      // 6. Per SKU — all values in grams
      const result: Record<string, BranchSmStockEntry> = {};
      for (const skuId of skuIds) result[skuId] = requestFigures(figures.get(skuId), { leadTime });

      setSmStock(result);
    } catch {
      setSmStock({});
      setSmSkuList([]);
      setStockError(true);
    } finally {
      setLoading(false);
      setStockFor(branchId);
    }
  }, [branchId]);

  useEffect(() => {
    calculate();
  }, [calculate]);

  return { smStock, smSkuList, loading, refresh: calculate, stockError, stockFor };
}
