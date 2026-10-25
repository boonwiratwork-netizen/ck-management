import { useCallback, useEffect, useRef, useState } from "react";
import { addDays, format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { fetchAllRows } from "@/lib/fetch-all";
import type { BranchReceipt } from "@/hooks/use-branch-receipt-data";
import { CK_SUPPLIER_NAME, transferOrderStatusAfter, type ReceiptRow } from "@/lib/receive-rows";

/**
 * Everything the Receive page reads and writes. On open, pending transfer orders,
 * due purchase requests and the history window load together (one round each,
 * in parallel — each Supabase request costs ~0.5 s). Saves insert and keep the
 * returned rows instead of re-reading the whole receipts table.
 */

export interface PendingTOLine {
  id: string;
  skuId: string;
  plannedQty: number;
  actualQty: number;
  uom: string;
  unitCost: number;
  notes: string;
}
export interface PendingTO {
  id: string;
  toNumber: string;
  deliveryDate: string;
  trId: string | null;
  lines: PendingTOLine[];
}
export interface PRGroup {
  supplierId: string;
  prIds: string[];
  prNumbers: string[];
  /** Requested qty per SKU, in stored (usage) units, summed over the PRs */
  lines: { skuId: string; suggestedQty: number }[];
}
export interface HistoryReceipt extends BranchReceipt {
  toNumber: string | null;
}

const RECEIPT_SELECT = "*, transfer_orders(to_number)";

const toLocal = (row: any): HistoryReceipt => ({
  id: row.id,
  branchId: row.branch_id,
  receiptDate: row.receipt_date,
  skuId: row.sku_id,
  supplierName: row.supplier_name,
  qtyReceived: Number(row.qty_received),
  uom: row.uom,
  actualUnitPrice: Number(row.actual_unit_price),
  actualTotal: Number(row.actual_total),
  stdUnitPrice: Number(row.std_unit_price),
  stdTotal: Number(row.std_total),
  priceVariance: Number(row.price_variance),
  notes: row.notes ?? "",
  createdAt: row.created_at,
  transferOrderId: row.transfer_order_id,
  toNumber: row.transfer_orders?.to_number ?? null,
});

const toInsert = (r: ReceiptRow) => ({
  branch_id: r.branchId,
  receipt_date: r.receiptDate,
  sku_id: r.skuId,
  supplier_name: r.supplierName,
  qty_received: r.qtyReceived,
  uom: r.uom,
  actual_unit_price: r.actualUnitPrice,
  actual_total: r.actualTotal,
  std_unit_price: r.stdUnitPrice,
  std_total: r.stdTotal,
  price_variance: r.priceVariance,
  notes: r.notes,
  transfer_order_id: r.transferOrderId || null,
});

export function useReceiveData(opts: {
  /** Branch being received into (pending TOs / PRs); null = none chosen yet */
  branchId: string | null;
  /** Branches whose history to show */
  historyBranchIds: string[];
  historyFrom: string;
  historyTo: string;
}) {
  const { branchId, historyBranchIds, historyFrom, historyTo } = opts;
  const [pendingTOs, setPendingTOs] = useState<PendingTO[]>([]);
  const [prGroups, setPrGroups] = useState<PRGroup[]>([]);
  const [history, setHistory] = useState<HistoryReceipt[]>([]);
  const [loading, setLoading] = useState(true);
  const historyKey = `${historyBranchIds.join(",")}|${historyFrom}|${historyTo}`;
  const latest = useRef(0);

  const load = useCallback(async () => {
    const run = ++latest.current;
    setLoading(true);
    const today = format(new Date(), "yyyy-MM-dd");
    const [tos, prs, hist] = await Promise.all([
      branchId
        ? supabase
            .from("transfer_orders")
            .select("id, to_number, delivery_date, tr_id, transfer_order_lines!to_id(id, sku_id, planned_qty, actual_qty, uom, unit_cost, notes)")
            .eq("branch_id", branchId)
            .eq("status", "Sent")
            .order("delivery_date")
            .order("id")
        : Promise.resolve({ data: [], error: null }),
      branchId
        ? supabase
            .from("purchase_requests")
            .select("id, pr_number, purchase_request_lines(sku_id, requested_qty, supplier_id)")
            .eq("branch_id", branchId)
            .in("status", ["Submitted", "Acknowledged"])
            .lte("required_date", today)
            .order("id")
        : Promise.resolve({ data: [], error: null }),
      historyBranchIds.length
        ? fetchAllRows((a, b) =>
            supabase
              .from("branch_receipts")
              .select(RECEIPT_SELECT)
              .in("branch_id", historyBranchIds)
              .gte("receipt_date", historyFrom)
              .lte("receipt_date", historyTo)
              .order("receipt_date", { ascending: false })
              .order("id")
              .range(a, b),
          )
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (run !== latest.current) return;
    if (tos.error || prs.error || hist.error) toast.error("โหลดข้อมูลรับของไม่ครบ ลองรีเฟรช");

    setPendingTOs(
      ((tos.data ?? []) as any[]).map((to) => ({
        id: to.id,
        toNumber: to.to_number,
        deliveryDate: to.delivery_date,
        trId: to.tr_id ?? null,
        lines: (to.transfer_order_lines ?? []).map((l: any) => ({
          id: l.id,
          skuId: l.sku_id,
          plannedQty: Number(l.planned_qty),
          actualQty: Number(l.actual_qty),
          uom: l.uom,
          unitCost: Number(l.unit_cost),
          notes: l.notes || "",
        })),
      })),
    );

    // Same grouping as the old batch receive: by supplier, qty summed per SKU
    const groups = new Map<string, { prIds: Set<string>; prNumbers: Set<string>; qty: Map<string, number> }>();
    for (const pr of (prs.data ?? []) as any[]) {
      for (const l of pr.purchase_request_lines ?? []) {
        if (!l.supplier_id) continue;
        const g = groups.get(l.supplier_id) ?? { prIds: new Set(), prNumbers: new Set(), qty: new Map() };
        g.prIds.add(pr.id);
        if (pr.pr_number) g.prNumbers.add(pr.pr_number);
        g.qty.set(l.sku_id, (g.qty.get(l.sku_id) ?? 0) + (Number(l.requested_qty) || 0));
        groups.set(l.supplier_id, g);
      }
    }
    setPrGroups(
      [...groups.entries()].map(([supplierId, g]) => ({
        supplierId,
        prIds: [...g.prIds],
        prNumbers: [...g.prNumbers],
        lines: [...g.qty.entries()].map(([skuId, suggestedQty]) => ({ skuId, suggestedQty })),
      })),
    );
    setHistory(((hist.data ?? []) as any[]).map(toLocal));
    setLoading(false);
  }, [branchId, historyKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load();
  }, [load]);

  const keepNew = (rows: any[]) => {
    const fresh = rows.map(toLocal).filter((r) => historyBranchIds.includes(r.branchId) && r.receiptDate >= historyFrom && r.receiptDate <= historyTo);
    if (fresh.length) setHistory((prev) => [...fresh, ...prev].sort((a, b) => b.receiptDate.localeCompare(a.receiptDate)));
  };

  /** Insert receipt rows; returns how many were saved (0 = failed, already toasted) */
  const saveRows = useCallback(
    async (rows: ReceiptRow[]): Promise<number> => {
      if (rows.length === 0) return 0;
      const { data, error } = await supabase.from("branch_receipts").insert(rows.map(toInsert)).select(RECEIPT_SELECT);
      if (error) {
        toast.error("บันทึกรับของไม่สำเร็จ: " + error.message);
        return 0;
      }
      keepNew(data ?? []);
      return rows.length;
    },
    [historyKey], // eslint-disable-line react-hooks/exhaustive-deps
  );

  /** Receive a transfer order: rows, then its status and its request, like before */
  const receiveTransferOrder = useCallback(
    async (to: PendingTO, rows: ReceiptRow[], receivedByLine: Map<string, number>): Promise<number> => {
      const count = await saveRows(rows);
      if (!count) return 0;
      const status = transferOrderStatusAfter(to.lines, receivedByLine);
      const [toUpd, trUpd] = await Promise.all([
        supabase.from("transfer_orders").update({ status }).eq("id", to.id),
        to.trId ? supabase.from("transfer_requests").update({ status: "Fulfilled" }).eq("id", to.trId) : Promise.resolve({ error: null }),
      ]);
      if (toUpd.error) {
        toast.error("รับของสำเร็จ แต่อัปเดตสถานะใบโอนไม่ได้: " + toUpd.error.message);
        return count;
      }
      if (trUpd.error) toast.error("รับของสำเร็จ แต่อัปเดตใบขอเบิกไม่ได้: " + trUpd.error.message);
      if (status !== "Sent") setPendingTOs((prev) => prev.filter((t) => t.id !== to.id));
      return count;
    },
    [saveRows],
  );

  const declineTransferOrder = useCallback(async (to: PendingTO, reason: string): Promise<boolean> => {
    const { error } = await supabase
      .from("transfer_orders")
      .update({ status: "Declined", decline_reason: reason.trim() || null })
      .eq("id", to.id);
    if (error) {
      toast.error("ปฏิเสธใบโอนไม่สำเร็จ: " + error.message);
      return false;
    }
    setPendingTOs((prev) => prev.filter((t) => t.id !== to.id));
    return true;
  }, []);

  /** Mark purchase requests fulfilled after their goods were received */
  const fulfilPurchaseRequests = useCallback(async (supplierId: string, prIds: string[]) => {
    if (prIds.length === 0) return;
    const { error } = await supabase.from("purchase_requests").update({ status: "Fulfilled" }).in("id", prIds);
    if (error) {
      toast.error("รับของสำเร็จ แต่ปิดใบขอซื้อไม่ได้: " + error.message);
      return;
    }
    setPrGroups((prev) => prev.filter((g) => g.supplierId !== supplierId));
  }, []);

  /**
   * Kitchen goods entered twice (once without a transfer order, once with) double
   * the branch's stock. Finds kitchen receipts within ±2 days with the same SKU and
   * qty, on the other side (with/without a transfer order). Same check as before.
   */
  const findKitchenDoubles = useCallback(
    async (date: Date, lines: { skuId: string; qty: number }[], againstTransferOrders: boolean): Promise<HistoryReceipt[]> => {
      if (!branchId || lines.length === 0) return [];
      const qtyBySku = new Map(lines.map((l) => [l.skuId, l.qty]));
      let q = supabase
        .from("branch_receipts")
        .select(RECEIPT_SELECT)
        .eq("branch_id", branchId)
        .eq("supplier_name", CK_SUPPLIER_NAME)
        .in("sku_id", [...qtyBySku.keys()])
        .gte("receipt_date", format(addDays(date, -2), "yyyy-MM-dd"))
        .lte("receipt_date", format(addDays(date, 2), "yyyy-MM-dd"));
      q = againstTransferOrders ? q.not("transfer_order_id", "is", null) : q.is("transfer_order_id", null);
      const { data } = await q.order("receipt_date").order("id");
      return ((data ?? []) as any[]).map(toLocal).filter((r) => r.qtyReceived === qtyBySku.get(r.skuId));
    },
    [branchId],
  );

  /** Edit qty / total / notes; recomputes unit price, std total and variance like before */
  const updateReceipt = useCallback(async (r: HistoryReceipt, edit: { qtyReceived: number; actualTotal: number; notes: string }) => {
    const actualUnitPrice = edit.qtyReceived > 0 ? edit.actualTotal / edit.qtyReceived : 0;
    const stdTotal = edit.qtyReceived * r.stdUnitPrice;
    const priceVariance = edit.actualTotal - stdTotal;
    const { error } = await supabase
      .from("branch_receipts")
      .update({
        qty_received: edit.qtyReceived,
        actual_total: edit.actualTotal,
        actual_unit_price: actualUnitPrice,
        std_total: stdTotal,
        price_variance: priceVariance,
        notes: edit.notes,
      })
      .eq("id", r.id);
    if (error) {
      toast.error("แก้รายการไม่สำเร็จ: " + error.message);
      return false;
    }
    setHistory((prev) => prev.map((x) => (x.id === r.id ? { ...x, ...edit, actualUnitPrice, stdTotal, priceVariance } : x)));
    return true;
  }, []);

  const deleteReceipt = useCallback(async (r: HistoryReceipt) => {
    const { error } = await supabase.from("branch_receipts").delete().eq("id", r.id);
    if (error) {
      toast.error("ลบรายการไม่สำเร็จ: " + error.message);
      return false;
    }
    setHistory((prev) => prev.filter((x) => x.id !== r.id));
    return true;
  }, []);

  return {
    pendingTOs,
    prGroups,
    history,
    loading,
    reload: load,
    saveRows,
    receiveTransferOrder,
    declineTransferOrder,
    fulfilPurchaseRequests,
    findKitchenDoubles,
    updateReceipt,
    deleteReceipt,
  };
}
