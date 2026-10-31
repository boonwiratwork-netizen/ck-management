import { useState, useCallback, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { toLocalDateStr } from "@/lib/utils";
import { useBranchSmStock, BranchSmStockStatus } from "@/hooks/use-branch-sm-stock";
import { useBranchRmStock, BranchRmStockStatus } from "@/hooks/use-branch-rm-stock";
import { loadBranchStock, sharedBranchRead, type BranchStockData } from "@/hooks/use-branch-stock";
import { branchFigures, receiptConverter } from "@/lib/branch-stock";
import { dailyUseWindow } from "@/lib/daily-use";
import { requestFigures } from "@/lib/request-lines";

export type TRLineSkuType = "SM" | "RM" | "PK";

export interface TRLine {
  skuId: string;
  skuCode: string;
  skuName: string;
  uom: string;
  packSize: number;
  requestedQty: number;
  suggestedQty: number;
  suggestedBatches: number;
  stockOnHand: number;
  avgDailyUsage: number;
  peakDailyUsage: number;
  rop: number;
  parstock: number;
  status: BranchSmStockStatus;
  skuType: TRLineSkuType;
  /** The stock read failed: on hand and the suggestion are not known (retry) */
  stockUnknown?: boolean;
}

export interface TRHistoryRow {
  id: string;
  trNumber: string;
  branchId: string;
  branchName: string;
  requestedDate: string;
  requiredDate: string;
  status: string;
  notes: string;
  itemCount: number;
  createdAt: string;
}

export interface TRDetailLine {
  id: string;
  skuId: string;
  skuCode: string;
  skuName: string;
  uom: string;
  packSize: number;
  requestedQty: number;
  suggestedQty: number;
  stockOnHand: number;
  avgDailyUsage: number;
  peakDailyUsage: number;
  rop: number;
  parstock: number;
  declineReason: string | null;
  declinedAt: string | null;
  /** UNKNOWN_STOCK_NOTE when the stock wasn't known as it was sent */
  notes?: string | null;
}

const statusOrder: Record<BranchSmStockStatus, number> = {
  critical: 0,
  low: 1,
  sufficient: 2,
  "no-data": 3,
};

// Distributable RM uses a special sentinel supplier ID to avoid the supplier filter in useBranchRmStock
const DISTRIBUTABLE_SENTINEL = "__distributable__";

export function useTransferRequest(branchId: string | null, profileId: string | null) {
  const { smStock, smSkuList, loading: stockLoading, refresh: refreshStock, stockError: smStockError } = useBranchSmStock(branchId);

  // Fetch distributable RM stock data
  const [rmLines, setRmLines] = useState<TRLine[]>([]);
  const [rmLoading, setRmLoading] = useState(false);
  const [rmStockError, setRmStockError] = useState(false);

  const fetchDistributableRm = useCallback(async () => {
    if (!branchId) {
      setRmLines([]);
      return;
    }
    setRmLoading(true);
    setRmStockError(false);
    const today = toLocalDateStr(new Date());
    // The branch's counts and recipes, shared with the kitchen-made list (use-branch-sm-stock)
    const shared = sharedBranchRead(branchId, today);
    try {
      // Get branch brand
      const { data: branch } = await supabase.from("branches").select("brand_name").eq("id", branchId).single();
      if (!branch) {
        setRmLines([]);
        setRmLoading(false);
        return;
      }

      // Get active menus for this brand
      const { data: menus } = await supabase
        .from("menus")
        .select("id")
        .eq("brand_name", branch.brand_name)
        .eq("status", "Active");
      const menuIds = (menus || []).map((m) => m.id);
      if (menuIds.length === 0) {
        setRmLines([]);
        setRmLoading(false);
        return;
      }

      // Get BOM sku_ids
      const { data: bomEntries } = await supabase.from("menu_bom").select("sku_id").in("menu_id", menuIds);
      const bomSkuIds = [...new Set((bomEntries || []).map((b) => b.sku_id))];

      // Get RM ingredients via sp_bom
      let rmFromSpBom: string[] = [];
      if (bomSkuIds.length > 0) {
        const { data: spBomLines } = await supabase
          .from("sp_bom")
          .select("ingredient_sku_id")
          .in("sp_sku_id", bomSkuIds);
        rmFromSpBom = (spBomLines || []).map((l) => l.ingredient_sku_id);
      }

      // Also fetch all distributable PK SKUs directly (PK has no BOM)
      const { data: pkSkus } = await supabase
        .from("skus")
        .select("id")
        .eq("type", "PK")
        .eq("status", "Active")
        .eq("is_distributable", true);
      const pkSkuIds = (pkSkus || []).map((s) => s.id);

      const allRelevantIds = [...new Set([...bomSkuIds, ...rmFromSpBom, ...pkSkuIds])];
      if (allRelevantIds.length === 0) {
        setRmLines([]);
        setRmLoading(false);
        return;
      }

      // Get distributable RM SKUs that are relevant to this brand's menus
      const { data: rmSkus } = await supabase
        .from("skus")
        .select("id, sku_id, name, usage_uom, pack_size, lead_time, type, purchase_uom, converter")
        .in("type", ["RM", "PK"])
        .eq("status", "Active")
        .eq("is_distributable", true)
        .in("id", allRelevantIds);

      const filtered = rmSkus || [];
      if (filtered.length === 0) {
        setRmLines([]);
        setRmLoading(false);
        return;
      }

      // On hand and use per day exactly as the branch stock page works them out
      // (lib/branch-stock.ts; the same read as the kitchen-made list, use-branch-sm-stock). This
      // used to take the latest count row as it was, with nothing received, used or
      // wasted since: on days a branch didn't count it ordered from an old figure.
      let stock: BranchStockData | null = null;
      try {
        stock = await loadBranchStock(branchId, today, new Set(filtered.map((s) => s.id)), shared, { prices: false });
      } catch {
        // The products stay on the list with their stock unknown, to retry
        setRmStockError(true);
      }
      const conv = new Map(filtered.map((s) => [s.id, receiptConverter({ purchaseUom: s.purchase_uom, usageUom: s.usage_uom, converter: s.converter })]));
      const figures = stock ? branchFigures({ ...stock, window: dailyUseWindow(today), converter: (id) => conv.get(id) ?? 1 }) : new Map();

      // Build RM lines
      const lines: TRLine[] = filtered.map((s) => {
        const ps = Number(s.pack_size) || 1;
        const leadTime = Number(s.lead_time) || 1;
        const f = requestFigures(figures.get(s.id), { leadTime });
        return {
          skuId: s.id,
          skuCode: s.sku_id,
          skuName: s.name,
          uom: s.usage_uom,
          packSize: ps,
          requestedQty: 0,
          suggestedQty: f.suggestedOrder,
          suggestedBatches: f.suggestedOrder > 0 ? Math.ceil(f.suggestedOrder / ps) : 0,
          stockOnHand: f.stockOnHand,
          avgDailyUsage: f.avgDailyUsage,
          peakDailyUsage: f.peakDailyUsage,
          rop: f.rop,
          parstock: f.parstock,
          status: f.status,
          skuType: (s.type === "PK" ? "PK" : "RM") as TRLineSkuType,
          stockUnknown: !stock || !f.stockKnown,
        };
      });
      setRmLines(lines);
    } catch {
      setRmLines([]);
      setRmStockError(true);
    } finally {
      setRmLoading(false);
    }
  }, [branchId]);

  useEffect(() => {
    fetchDistributableRm();
  }, [fetchDistributableRm]);

  const [lines, setLines] = useState<TRLine[]>([]);
  const [requiredDate, setRequiredDate] = useState<Date | undefined>(undefined);
  const [notes, setNotes] = useState("");
  const [history, setHistory] = useState<TRHistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Build lines from smStock + smSkuList + distributable RM
  useEffect(() => {
    const smLines: TRLine[] = smSkuList.map((sku) => {
      const stock = smStock[sku.skuId] || {
        stockOnHand: 0,
        avgDailyUsage: 0,
        peakDailyUsage: 0,
        rop: 0,
        parstock: 0,
        suggestedOrder: 0,
        status: "no-data" as BranchSmStockStatus,
      };
      const ps = sku.packSize || 1;
      return {
        skuId: sku.skuId,
        skuCode: sku.skuCode,
        skuName: sku.skuName,
        uom: sku.uom,
        packSize: ps,
        requestedQty: 0,
        suggestedQty: stock.suggestedOrder,
        suggestedBatches: stock.suggestedOrder > 0 ? Math.ceil(stock.suggestedOrder / ps) : 0,
        stockOnHand: stock.stockOnHand,
        avgDailyUsage: stock.avgDailyUsage,
        peakDailyUsage: stock.peakDailyUsage,
        rop: stock.rop,
        parstock: stock.parstock,
        status: stock.status,
        skuType: "SM" as TRLineSkuType,
        stockUnknown: smStockError || stock.stockKnown === false,
      };
    });
    // Merge SM + distributable RM + PK
    const allLines = [...smLines, ...rmLines];
    // Sort: SM/RM by status first, PK always last
    const typeOrder = (type: string) => (type === "PK" ? 1 : 0);
    allLines.sort((a, b) => {
      const typeDiff = typeOrder(a.skuType) - typeOrder(b.skuType);
      if (typeDiff !== 0) return typeDiff;
      return statusOrder[a.status] - statusOrder[b.status];
    });
    setLines(allLines);
  }, [smStock, smSkuList, rmLines, smStockError]);

  // Update line by batches — stores requestedQty in grams (batches × packSize)
  const updateLineQty = useCallback((skuId: string, batches: number) => {
    setLines((prev) =>
      prev.map((l) => {
        if (l.skuId !== skuId) return l;
        const b = Math.max(0, Math.round(batches));
        return { ...l, requestedQty: b * l.packSize };
      }),
    );
  }, []);

  const itemsToOrder = useMemo(() => lines.filter((l) => l.requestedQty > 0).length, [lines]);

  const canSubmit = useMemo(() => {
    return !!requiredDate && itemsToOrder > 0;
  }, [requiredDate, itemsToOrder]);

  const submitTR = useCallback(async (): Promise<{ trNumber: string } | { error: string }> => {
    if (!branchId) return { error: "No branch assigned" };
    if (!requiredDate) return { error: "Required date must be set" };
    if (itemsToOrder === 0) return { error: "At least one item must have quantity > 0" };

    try {
      const now = new Date();
      const { data: trNumber, error: rpcError } = await supabase.rpc("next_doc_number", {
        p_type: "TR",
        p_year: now.getFullYear(),
        p_month: now.getMonth() + 1,
      });
      if (rpcError || !trNumber) return { error: rpcError?.message || "Failed to generate TR number" };

      const { data: trRow, error: trError } = await supabase
        .from("transfer_requests")
        .insert({
          tr_number: trNumber,
          branch_id: branchId,
          requested_by: profileId,
          requested_date: toLocalDateStr(now),
          required_date: toLocalDateStr(requiredDate),
          status: "Submitted",
          notes: notes,
        })
        .select("id")
        .single();
      if (trError || !trRow) return { error: trError?.message || "สร้างใบขอเบิกไม่สำเร็จ" };

      const lineInserts = lines
        .filter((l) => l.requestedQty > 0)
        .map((l) => ({
          tr_id: trRow.id,
          sku_id: l.skuId,
          requested_qty: l.requestedQty,
          uom: l.uom,
          suggested_qty: l.suggestedQty,
          stock_on_hand: l.stockOnHand,
          avg_daily_usage: l.avgDailyUsage,
          peak_daily_usage: l.peakDailyUsage,
          rop: l.rop,
          parstock: l.parstock,
          sku_type: l.skuType,
          notes: "",
        }));

      const { error: linesError } = await supabase.from("transfer_request_lines").insert(lineInserts);
      if (linesError) return { error: linesError.message };

      setRequiredDate(undefined);
      setNotes("");
      refreshStock();
      fetchHistory();
      return { trNumber };
    } catch (e: any) {
      return { error: e.message || "Unknown error" };
    }
  }, [branchId, profileId, requiredDate, notes, lines, itemsToOrder, refreshStock]);

  // ─── History ───
  const fetchHistory = useCallback(
    async (filters?: { branchId?: string; status?: string; dateFrom?: string; dateTo?: string }) => {
      setHistoryLoading(true);
      let query = supabase
        .from("transfer_requests")
        .select("id, tr_number, branch_id, requested_date, required_date, status, notes, created_at")
        .order("created_at", { ascending: false });

      const filterBranch = filters?.branchId || branchId;
      if (filterBranch) query = query.eq("branch_id", filterBranch);
      if (filters?.status && filters.status !== "All") query = query.eq("status", filters.status);
      if (filters?.dateFrom) query = query.gte("requested_date", filters.dateFrom);
      if (filters?.dateTo) query = query.lte("requested_date", filters.dateTo);

      const { data, error } = await query;
      if (error) {
        toast.error("โหลดประวัติใบขอเบิกไม่สำเร็จ");
        setHistoryLoading(false);
        return;
      }

      const trIds = (data || []).map((d) => d.id);
      let lineCounts: Record<string, number> = {};
      if (trIds.length > 0) {
        const { data: lineData } = await supabase.from("transfer_request_lines").select("tr_id").in("tr_id", trIds);
        for (const l of lineData || []) {
          lineCounts[l.tr_id] = (lineCounts[l.tr_id] || 0) + 1;
        }
      }

      const branchIds = [...new Set((data || []).map((d) => d.branch_id))];
      let branchNames: Record<string, string> = {};
      if (branchIds.length > 0) {
        const { data: branches } = await supabase.from("branches").select("id, branch_name").in("id", branchIds);
        for (const b of branches || []) {
          branchNames[b.id] = b.branch_name;
        }
      }

      setHistory(
        (data || []).map((d) => ({
          id: d.id,
          trNumber: d.tr_number,
          branchId: d.branch_id,
          branchName: branchNames[d.branch_id] || "",
          requestedDate: d.requested_date,
          requiredDate: d.required_date,
          status: d.status,
          notes: d.notes,
          itemCount: lineCounts[d.id] || 0,
          createdAt: d.created_at,
        })),
      );
      setHistoryLoading(false);
    },
    [branchId],
  );

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const fetchTRDetail = useCallback(async (trId: string): Promise<TRDetailLine[]> => {
    const { data, error } = await supabase
      .from("transfer_request_lines")
      .select(
        "id, sku_id, requested_qty, uom, suggested_qty, stock_on_hand, avg_daily_usage, peak_daily_usage, rop, parstock, decline_reason, declined_at, notes",
      )
      .eq("tr_id", trId);
    if (error || !data) return [];

    const skuIds = data.map((d) => d.sku_id);
    const { data: skus } = await supabase.from("skus").select("id, sku_id, name, pack_size").in("id", skuIds);
    const skuMap: Record<string, { code: string; name: string; packSize: number }> = {};
    for (const s of skus || []) {
      skuMap[s.id] = { code: s.sku_id, name: s.name, packSize: s.pack_size };
    }

    return data.map((d) => ({
      id: d.id,
      skuId: d.sku_id,
      skuCode: skuMap[d.sku_id]?.code || "",
      skuName: skuMap[d.sku_id]?.name || "",
      uom: d.uom,
      packSize: skuMap[d.sku_id]?.packSize || 1,
      requestedQty: d.requested_qty,
      suggestedQty: d.suggested_qty,
      stockOnHand: d.stock_on_hand,
      avgDailyUsage: d.avg_daily_usage,
      peakDailyUsage: d.peak_daily_usage,
      rop: d.rop,
      parstock: d.parstock,
      declineReason: d.decline_reason,
      declinedAt: d.declined_at,
      notes: d.notes,
    }));
  }, []);

  const cancelTR = useCallback(
    async (trId: string) => {
      const { error } = await supabase.from("transfer_requests").update({ status: "Cancelled" }).eq("id", trId);
      if (error) {
        toast.error("ยกเลิกใบขอเบิกไม่สำเร็จ");
        return;
      }
      toast.success("TR cancelled");
      fetchHistory();
    },
    [fetchHistory],
  );

  // Both lists read the branch's stock again (after a failed read)
  const retryStock = useCallback(() => {
    refreshStock();
    fetchDistributableRm();
  }, [refreshStock, fetchDistributableRm]);

  return {
    lines,
    updateLineQty,
    isLoading: stockLoading || rmLoading,
    /** The stock read failed for some lines: on hand / suggestions unknown */
    stockError: smStockError || rmStockError,
    retryStock,
    requiredDate,
    setRequiredDate,
    notes,
    setNotes,
    submitTR,
    canSubmit,
    itemsToOrder,
    history,
    historyLoading,
    fetchHistory,
    fetchTRDetail,
    cancelTR,
  };
}
