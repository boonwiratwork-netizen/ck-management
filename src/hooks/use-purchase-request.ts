import { useState, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { toLocalDateStr } from "@/lib/utils";

export interface PRHistoryRow {
  id: string;
  prNumber: string;
  branchId: string;
  branchName: string;
  requestedDate: string;
  requiredDate: string;
  status: string;
  notes: string;
  itemCount: number;
  supplierId: string | null;
  supplierName: string;
  createdAt: string;
}

export interface PRDetailLine {
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
  rop: number;
  supplierId: string | null;
  packUnit: string;
}

export function usePurchaseRequest(branchId: string | null) {
  const [history, setHistory] = useState<PRHistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const fetchHistory = useCallback(
    async (filters?: { branchId?: string; status?: string; dateFrom?: string; dateTo?: string }) => {
      setHistoryLoading(true);
      let query = supabase
        .from("purchase_requests")
        .select("id, pr_number, branch_id, requested_date, required_date, status, notes, created_at, requested_by")
        .order("created_at", { ascending: false });

      const filterBranch = filters?.branchId || branchId;
      if (filterBranch) query = query.eq("branch_id", filterBranch);
      if (filters?.status && filters.status !== "All") query = query.eq("status", filters.status);
      if (filters?.dateFrom) query = query.gte("requested_date", filters.dateFrom);
      if (filters?.dateTo) query = query.lte("requested_date", filters.dateTo);

      const { data, error } = await query;
      if (error) {
        toast.error("Failed to load PR history");
        setHistoryLoading(false);
        return;
      }

      const prIds = (data || []).map((d) => d.id);
      let lineCounts: Record<string, number> = {};
      let prSupplierMap: Record<string, string | null> = {};
      if (prIds.length > 0) {
        const { data: lineData } = await supabase
          .from("purchase_request_lines")
          .select("pr_id, supplier_id")
          .in("pr_id", prIds);
        for (const l of lineData || []) {
          lineCounts[l.pr_id] = (lineCounts[l.pr_id] || 0) + 1;
          if (!prSupplierMap[l.pr_id] && l.supplier_id) prSupplierMap[l.pr_id] = l.supplier_id;
        }
      }

      // Resolve branch names
      const branchIds = [...new Set((data || []).map((d) => d.branch_id))];
      let branchNames: Record<string, string> = {};
      if (branchIds.length > 0) {
        const { data: branches } = await supabase.from("branches").select("id, branch_name").in("id", branchIds);
        for (const b of branches || []) branchNames[b.id] = b.branch_name;
      }

      // Resolve supplier names
      const supplierIds = [...new Set(Object.values(prSupplierMap).filter(Boolean) as string[])];
      let supplierNames: Record<string, string> = {};
      if (supplierIds.length > 0) {
        const { data: suppliers } = await supabase.from("suppliers").select("id, name").in("id", supplierIds);
        for (const s of suppliers || []) supplierNames[s.id] = s.name;
      }

      setHistory(
        (data || []).map((d) => ({
          id: d.id,
          prNumber: d.pr_number,
          branchId: d.branch_id,
          branchName: branchNames[d.branch_id] || "",
          requestedDate: d.requested_date,
          requiredDate: d.required_date,
          status: d.status,
          notes: d.notes || "",
          itemCount: lineCounts[d.id] || 0,
          supplierId: prSupplierMap[d.id] || null,
          supplierName: prSupplierMap[d.id] ? supplierNames[prSupplierMap[d.id]!] || "" : "",
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

  const fetchPRDetail = useCallback(async (prId: string): Promise<PRDetailLine[]> => {
    const { data, error } = await supabase
      .from("purchase_request_lines")
      .select(
        "id, sku_id, requested_qty, uom, suggested_qty, stock_on_hand, avg_daily_usage, rop, pack_size, supplier_id",
      )
      .eq("pr_id", prId);
    if (error || !data) return [];

    const skuIds = data.map((d) => d.sku_id);
    const { data: skus } = await supabase
      .from("skus")
      .select("id, sku_id, name, pack_size, pack_unit")
      .in("id", skuIds);
    const skuMap: Record<string, { code: string; name: string; packSize: number; packUnit: string }> = {};
    for (const s of skus || []) {
      skuMap[s.id] = { code: s.sku_id, name: s.name, packSize: s.pack_size, packUnit: s.pack_unit || "แพ็ค" };
    }

    return data.map((d) => ({
      id: d.id,
      skuId: d.sku_id,
      skuCode: skuMap[d.sku_id]?.code || "",
      skuName: skuMap[d.sku_id]?.name || "",
      uom: d.uom,
      packSize: d.pack_size || skuMap[d.sku_id]?.packSize || 1,
      requestedQty: d.requested_qty,
      suggestedQty: d.suggested_qty || 0,
      stockOnHand: d.stock_on_hand || 0,
      avgDailyUsage: d.avg_daily_usage || 0,
      rop: d.rop || 0,
      supplierId: d.supplier_id,
      packUnit: skuMap[d.sku_id]?.packUnit || "แพ็ค",
    }));
  }, []);

  const cancelPR = useCallback(
    async (prId: string) => {
      const { error } = await supabase.from("purchase_requests").update({ status: "Cancelled" }).eq("id", prId);
      if (error) {
        toast.error("Failed to cancel PR");
        return;
      }
      toast.success("PR cancelled");
      fetchHistory();
    },
    [fetchHistory],
  );

  // Get count of pending PRs per supplier
  const getPendingPRCountsBySupplier = useCallback(
    async (targetBranchId?: string): Promise<Record<string, number>> => {
      const bid = targetBranchId || branchId;
      if (!bid) return {};

      let query = supabase
        .from("purchase_requests")
        .select("id")
        .eq("branch_id", bid)
        .in("status", ["Submitted", "Acknowledged"]);

      const { data: prs } = await query;
      if (!prs || prs.length === 0) return {};

      const prIds = prs.map((p) => p.id);
      const { data: lines } = await supabase
        .from("purchase_request_lines")
        .select("pr_id, supplier_id")
        .in("pr_id", prIds);

      const counts: Record<string, number> = {};
      const prSupplier: Record<string, string> = {};
      for (const l of lines || []) {
        if (l.supplier_id && !prSupplier[l.pr_id]) {
          prSupplier[l.pr_id] = l.supplier_id;
        }
      }
      // Count unique PRs per supplier
      for (const [prId, sid] of Object.entries(prSupplier)) {
        counts[sid] = (counts[sid] || 0) + 1;
      }
      return counts;
    },
    [branchId],
  );

  return {
    history,
    historyLoading,
    fetchHistory,
    fetchPRDetail,
    cancelPR,
    getPendingPRCountsBySupplier,
  };
}
