import { useState, useCallback, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { toLocalDateStr } from "@/lib/utils";
import { useBranchSmStock, BranchSmStockStatus } from "@/hooks/use-branch-sm-stock";
import { useBranchRmStock, BranchRmStockStatus } from "@/hooks/use-branch-rm-stock";

export type TRLineSkuType = "SM" | "RM";

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
  const { smStock, smSkuList, loading: stockLoading, refresh: refreshStock } = useBranchSmStock(branchId);

  // Fetch distributable RM stock data
  const [rmLines, setRmLines] = useState<TRLine[]>([]);
  const [rmLoading, setRmLoading] = useState(false);

  const fetchDistributableRm = useCallback(async () => {
    if (!branchId) {
      setRmLines([]);
      return;
    }
    setRmLoading(true);
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

      const allRelevantIds = [...new Set([...bomSkuIds, ...rmFromSpBom])];
      if (allRelevantIds.length === 0) {
        setRmLines([]);
        setRmLoading(false);
        return;
      }

      // Get distributable RM SKUs that are relevant to this brand's menus
      const { data: rmSkus } = await supabase
        .from("skus")
        .select("id, sku_id, name, usage_uom, pack_size, lead_time")
        .eq("type", "RM")
        .eq("status", "Active")
        .eq("is_distributable", true)
        .in("id", allRelevantIds);

      const filtered = rmSkus || [];
      if (filtered.length === 0) {
        setRmLines([]);
        setRmLoading(false);
        return;
      }

      const skuIds = filtered.map((s) => s.id);

      // Avg daily usage from sales (last 7 days)
      const today = new Date();
      const sevenDaysAgo = new Date(today);
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const dateFrom = toLocalDateStr(sevenDaysAgo);

      const { data: salesRows } = await supabase
        .from("sales_entries")
        .select("menu_code, qty, sale_date")
        .eq("branch_id", branchId)
        .gte("sale_date", dateFrom);
      const menuCodes = [...new Set((salesRows || []).map((s) => s.menu_code))];
      let menuCodeToId: Record<string, string> = {};
      if (menuCodes.length > 0) {
        const { data: menuRows } = await supabase.from("menus").select("id, menu_code").in("menu_code", menuCodes);
        for (const m of menuRows || []) menuCodeToId[m.menu_code] = m.id;
      }
      const qtySoldByMenuId: Record<string, number> = {};
      for (const s of salesRows || []) {
        const mid = menuCodeToId[s.menu_code];
        if (!mid) continue;
        qtySoldByMenuId[mid] = (qtySoldByMenuId[mid] || 0) + Number(s.qty);
      }
      const salesMenuIds = Object.keys(qtySoldByMenuId);

      let bomRows: { menu_id: string; sku_id: string; qty_per_serving: number; effective_qty: number }[] = [];
      if (salesMenuIds.length > 0) {
        const { data: bom } = await supabase
          .from("menu_bom")
          .select("menu_id, sku_id, qty_per_serving, effective_qty")
          .in("menu_id", salesMenuIds);
        bomRows = bom || [];
      }
      const spSkuIdsInBom = bomRows.filter((b) => !skuIds.includes(b.sku_id)).map((b) => b.sku_id);
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

      const totalUsageBySkuId: Record<string, number> = {};
      for (const bom of bomRows) {
        const soldQty = qtySoldByMenuId[bom.menu_id] || 0;
        if (soldQty === 0) continue;
        if (skuIds.includes(bom.sku_id)) {
          totalUsageBySkuId[bom.sku_id] = (totalUsageBySkuId[bom.sku_id] || 0) + soldQty * bom.effective_qty;
        } else {
          const spLines = spBomRows.filter((sb) => sb.sp_sku_id === bom.sku_id);
          for (const sp of spLines) {
            const batchYield = Number(sp.batch_yield_qty) || 1;
            totalUsageBySkuId[sp.ingredient_sku_id] =
              (totalUsageBySkuId[sp.ingredient_sku_id] || 0) +
              soldQty * bom.effective_qty * (sp.qty_per_batch / batchYield);
          }
        }
      }

      // Latest stock on hand
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

      // Build RM lines
      const lines: TRLine[] = filtered.map((s) => {
        const ps = Number(s.pack_size) || 1;
        const leadTime = Number(s.lead_time) || 1;
        const activeDays = new Set((salesRows || []).map((s: any) => s.sale_date)).size || 1;
        const avgDailyUsage = (totalUsageBySkuId[s.id] || 0) / activeDays;
        const latest = latestBySkuId[s.id];
        const stockOnHand = latest
          ? latest.physical_count != null
            ? Number(latest.physical_count)
            : latest.calculated_balance
          : 0;
        const rop = avgDailyUsage * leadTime;
        const parstock = avgDailyUsage * (leadTime * 2);
        const suggestedOrder = Math.max(0, parstock - stockOnHand);
        const suggestedBatches = suggestedOrder > 0 ? Math.ceil(suggestedOrder / ps) : 0;

        let status: BranchSmStockStatus;
        if (avgDailyUsage === 0) status = "no-data";
        else if (stockOnHand === 0) status = "critical";
        else if (stockOnHand < rop) status = "low";
        else if (stockOnHand >= parstock) status = "sufficient";
        else status = "low";

        return {
          skuId: s.id,
          skuCode: s.sku_id,
          skuName: s.name,
          uom: s.usage_uom,
          packSize: ps,
          requestedQty: 0,
          suggestedQty: Math.round(suggestedOrder * 100) / 100,
          suggestedBatches,
          stockOnHand,
          avgDailyUsage: Math.round(avgDailyUsage * 100) / 100,
          peakDailyUsage: 0,
          rop: Math.round(rop * 100) / 100,
          parstock: Math.round(parstock * 100) / 100,
          status,
          skuType: "RM" as TRLineSkuType,
        };
      });
      setRmLines(lines);
    } catch {
      setRmLines([]);
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
      };
    });
    // Merge SM + distributable RM
    const allLines = [...smLines, ...rmLines];
    // Default sort: critical → low → sufficient → no-data
    allLines.sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);
    setLines(allLines);
  }, [smStock, smSkuList, rmLines]);

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
      if (trError || !trRow) return { error: trError?.message || "Failed to create TR" };

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
        toast.error("Failed to load TR history");
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
        "id, sku_id, requested_qty, uom, suggested_qty, stock_on_hand, avg_daily_usage, peak_daily_usage, rop, parstock",
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
    }));
  }, []);

  const cancelTR = useCallback(
    async (trId: string) => {
      const { error } = await supabase.from("transfer_requests").update({ status: "Cancelled" }).eq("id", trId);
      if (error) {
        toast.error("Failed to cancel TR");
        return;
      }
      toast.success("TR cancelled");
      fetchHistory();
    },
    [fetchHistory],
  );

  return {
    lines,
    updateLineQty,
    isLoading: stockLoading || rmLoading,
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
