import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toLocalDateStr } from "@/lib/utils";
import { fetchAllRows } from "@/lib/fetch-all";
import { writeError, writeTimeout } from "@/lib/write-timeout";
import { UNKNOWN_STOCK_NOTE, freshPending, type Pending } from "@/lib/request-lines";

/** One product on a request, with the figures saved alongside it (as before) */
export interface RequestItem {
  skuId: string;
  code: string;
  name: string;
  packSize: number;
  /** Usage unit (ก., มล.) */
  uom: string;
  packUnit: string;
  /** Purchase unit, stored on supplier order lines (old page used purchaseUom) */
  purchaseUom?: string;
  stockOnHand: number;
  avgDailyUsage: number;
  peakDailyUsage: number;
  rop: number;
  parstock: number;
  /** The old suggestion (grams to parstock), still stored on the line */
  suggestedQty: number;
  skuType: "SM" | "RM" | "PK";
  /** The branch's stock couldn't be read: on hand and the suggestion are not known */
  stockUnknown?: boolean;
}

export interface SupplierOption {
  id: string;
  name: string;
  /** Sells something this branch's menus use */
  relevant: boolean;
  pendingCount: number;
}

type Result = { number: string } | { error: string };
type PendingRow<K extends string> = { sku_id: string; requested_qty: number } & Record<K, { required_date: string }>;

/**
 * Writes and side data for the request page. The inserts are the old page's
 * (transfer_requests/_lines for the kitchen, purchase_requests/_lines for a
 * supplier), taking quantities as arguments instead of hook state.
 */
export function useRequestData(branchId: string | null, brandName: string | null) {
  const [pending, setPending] = useState<Map<string, Pending>>(new Map());
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);

  const loadPending = useCallback(async () => {
    if (!branchId) return setPending(new Map());
    const [tr, pr] = await Promise.all([
      fetchAllRows((a, b) =>
        supabase
          .from("transfer_request_lines")
          .select("id, sku_id, requested_qty, transfer_requests!inner(branch_id, status, required_date)")
          .eq("transfer_requests.branch_id", branchId)
          .in("transfer_requests.status", ["Submitted", "Acknowledged"])
          .order("id")
          .range(a, b),
      ),
      fetchAllRows((a, b) =>
        supabase
          .from("purchase_request_lines")
          .select("id, sku_id, requested_qty, purchase_requests!inner(branch_id, status, required_date)")
          .eq("purchase_requests.branch_id", branchId)
          .in("purchase_requests.status", ["Submitted", "Acknowledged"])
          .order("id")
          .range(a, b),
      ),
    ]);
    const rows = [
      ...(tr.data as PendingRow<"transfer_requests">[]).map((r) => ({ skuId: r.sku_id, qty: Number(r.requested_qty), requiredDate: r.transfer_requests.required_date })),
      ...(pr.data as PendingRow<"purchase_requests">[]).map((r) => ({ skuId: r.sku_id, qty: Number(r.requested_qty), requiredDate: r.purchase_requests.required_date })),
    ];
    setPending(freshPending(rows, toLocalDateStr(new Date())));
  }, [branchId]);
  useEffect(() => {
    loadPending();
  }, [loadPending]);

  // Suppliers: those selling this brand's ingredients first (the old dropdown's rule)
  const loadSuppliers = useCallback(async () => {
    if (!branchId || !brandName) return setSuppliers([]);
    // Everything but the recipes' lines in one round, then those lines (five rounds became two)
    const [{ data: menus }, { data: all }, counts, sp, prices] = await Promise.all([
      supabase.from("menus").select("id").eq("brand_name", brandName).eq("status", "Active"),
      supabase.from("suppliers_safe").select("id, name, is_central_kitchen, status").eq("status", "Active"),
      pendingPrCounts(branchId),
      fetchAllRows((a, b) => supabase.from("sp_bom").select("id, sp_sku_id, ingredient_sku_id").order("id").range(a, b)),
      fetchAllRows((a, b) => supabase.from("prices").select("id, sku_id, supplier_id").eq("is_active", true).order("id").range(a, b)),
    ]);
    const menuIds = (menus || []).map((m) => m.id);
    const ingredientIds = new Set<string>();
    if (menuIds.length) {
      const { data: bom } = await fetchAllRows((a, b) => supabase.from("menu_bom").select("id, sku_id").in("menu_id", menuIds).order("id").range(a, b));
      const ids = new Set((bom as { sku_id: string }[]).map((b) => b.sku_id));
      ids.forEach((id) => ingredientIds.add(id));
      for (const l of sp.data as { sp_sku_id: string; ingredient_sku_id: string }[]) if (ids.has(l.sp_sku_id)) ingredientIds.add(l.ingredient_sku_id);
    }
    const relevant = new Set((prices.data as { sku_id: string; supplier_id: string | null }[]).filter((p) => ingredientIds.has(p.sku_id)).map((p) => p.supplier_id).filter(Boolean));
    setSuppliers(
      (all || [])
        .filter((s) => !s.is_central_kitchen)
        .map((s) => ({ id: s.id, name: s.name, relevant: relevant.has(s.id), pendingCount: counts[s.id] || 0 }))
        .sort((a, b) => Number(b.relevant) - Number(a.relevant) || a.name.localeCompare(b.name)),
    );
  }, [branchId, brandName]);

  const nextNumber = async (type: "TR" | "PR") => {
    const now = new Date();
    const { data, error } = await supabase.rpc("next_doc_number", { p_type: type, p_year: now.getFullYear(), p_month: now.getMonth() + 1 }).abortSignal(writeTimeout());
    return error || !data ? { error: error?.message || `สร้างเลขที่ ${type} ไม่สำเร็จ` } : { number: data as string };
  };

  /** Kitchen request: the old submitTR, quantities passed in (packs × pack size) */
  const submitKitchen = useCallback(
    async (opts: { profileId: string | null; requiredDate: string; notes: string; items: { item: RequestItem; packs: number }[] }): Promise<Result> => {
      if (!branchId) return { error: "ยังไม่ได้เลือกสาขา" };
      const no = await nextNumber("TR");
      if ("error" in no) return no;
      const { data: head, error } = await supabase
        .from("transfer_requests")
        .insert({ tr_number: no.number, branch_id: branchId, requested_by: opts.profileId, requested_date: toLocalDateStr(new Date()), required_date: opts.requiredDate, status: "Submitted", notes: opts.notes })
        .select("id")
        .abortSignal(writeTimeout())
        .single();
      if (error || !head) return { error: (error && writeError(error)) || "สร้างใบขอเบิกไม่สำเร็จ" };
      const { error: linesError } = await supabase.from("transfer_request_lines").insert(
        opts.items.map(({ item: l, packs }) => ({
          tr_id: head.id,
          sku_id: l.skuId,
          requested_qty: packs * l.packSize,
          uom: l.uom,
          suggested_qty: l.suggestedQty,
          stock_on_hand: l.stockOnHand,
          avg_daily_usage: l.avgDailyUsage,
          peak_daily_usage: l.peakDailyUsage,
          rop: l.rop,
          parstock: l.parstock,
          sku_type: l.skuType,
          // stock_on_hand can't be empty: an unknown stock is said here, not saved as a real 0
          notes: l.stockUnknown ? UNKNOWN_STOCK_NOTE : "",
        })),
      ).abortSignal(writeTimeout());
      if (linesError) {
        // Don't leave an empty request behind for the kitchen to wonder about
        await supabase.from("transfer_requests").update({ status: "Cancelled" }).eq("id", head.id).abortSignal(writeTimeout());
        return { error: writeError(linesError) };
      }
      loadPending();
      return { number: no.number };
    },
    [branchId, loadPending],
  );

  /** Supplier order: the old handlePRSubmit */
  const submitSupplier = useCallback(
    async (opts: { profileId: string | null; supplierId: string; requiredDate: string; notes: string; items: { item: RequestItem; packs: number }[] }): Promise<Result> => {
      if (!branchId) return { error: "ยังไม่ได้เลือกสาขา" };
      const no = await nextNumber("PR");
      if ("error" in no) return no;
      const { data: head, error } = await supabase
        .from("purchase_requests")
        .insert({ pr_number: no.number, branch_id: branchId, requested_by: opts.profileId, requested_date: toLocalDateStr(new Date()), required_date: opts.requiredDate, status: "Submitted", notes: opts.notes })
        .select("id")
        .abortSignal(writeTimeout())
        .single();
      if (error || !head) return { error: (error && writeError(error)) || "สร้างใบสั่งซื้อไม่สำเร็จ" };
      const { error: linesError } = await supabase.from("purchase_request_lines").insert(
        opts.items.map(({ item: l, packs }) => ({
          pr_id: head.id,
          sku_id: l.skuId,
          supplier_id: opts.supplierId,
          requested_qty: packs * l.packSize,
          uom: l.purchaseUom ?? l.uom,
          suggested_qty: l.suggestedQty,
          stock_on_hand: l.stockOnHand,
          avg_daily_usage: l.avgDailyUsage,
          rop: l.rop,
          pack_size: l.packSize,
          notes: l.stockUnknown ? UNKNOWN_STOCK_NOTE : "",
        })),
      ).abortSignal(writeTimeout());
      if (linesError) {
        await supabase.from("purchase_requests").update({ status: "Cancelled" }).eq("id", head.id).abortSignal(writeTimeout());
        return { error: writeError(linesError) };
      }
      loadPending();
      return { number: no.number };
    },
    [branchId, loadPending],
  );

  return { pending, reloadPending: loadPending, suppliers, loadSuppliers, submitKitchen, submitSupplier };
}

async function pendingPrCounts(branchId: string): Promise<Record<string, number>> {
  // The open orders' lines in one read (the orders, then their lines, was two in a row)
  const { data: lines } = await supabase
    .from("purchase_request_lines")
    .select("pr_id, supplier_id, purchase_requests!inner(branch_id, status)")
    .eq("purchase_requests.branch_id", branchId)
    .in("purchase_requests.status", ["Submitted", "Acknowledged"]);
  const bySupplier: Record<string, Set<string>> = {};
  for (const l of lines || []) if (l.supplier_id) (bySupplier[l.supplier_id] ??= new Set()).add(l.pr_id);
  return Object.fromEntries(Object.entries(bySupplier).map(([k, v]) => [k, v.size]));
}

export type RequestData = ReturnType<typeof useRequestData>;
