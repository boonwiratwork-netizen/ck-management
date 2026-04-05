import { useState, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface BranchReceipt {
  id: string;
  branchId: string;
  receiptDate: string;
  skuId: string;
  supplierName: string;
  qtyReceived: number;
  uom: string;
  actualUnitPrice: number;
  actualTotal: number;
  stdUnitPrice: number;
  stdTotal: number;
  priceVariance: number;
  notes: string;
  createdAt: string;
  transferOrderId: string | null;
}

const toLocal = (row: any): BranchReceipt => ({
  id: row.id,
  branchId: row.branch_id,
  receiptDate: row.receipt_date,
  skuId: row.sku_id,
  supplierName: row.supplier_name,
  qtyReceived: row.qty_received,
  uom: row.uom,
  actualUnitPrice: row.actual_unit_price,
  actualTotal: row.actual_total,
  stdUnitPrice: row.std_unit_price,
  stdTotal: row.std_total,
  priceVariance: row.price_variance,
  notes: row.notes,
  createdAt: row.created_at,
  transferOrderId: row.transfer_order_id,
});

export function useBranchReceiptData() {
  const [receipts, setReceipts] = useState<BranchReceipt[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchReceipts = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("branch_receipts")
      .select("*")
      .order("receipt_date", { ascending: false });
    if (error) {
      toast.error("Failed to load branch receipts");
      setLoading(false);
      return;
    }
    setReceipts((data || []).map(toLocal));
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchReceipts();
  }, [fetchReceipts]);

  const saveReceipts = useCallback(
    async (rows: Omit<BranchReceipt, "id" | "createdAt">[]) => {
      const inserts = rows.map((r) => ({
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
      }));
      const { error } = await supabase.from("branch_receipts").insert(inserts);
      if (error) {
        toast.error("Failed to save receipts: " + error.message);
        return 0;
      }
      await fetchReceipts();
      return inserts.length;
    },
    [fetchReceipts],
  );

  const updateReceipt = useCallback(
    async (id: string, updates: { qtyReceived: number; actualTotal: number; notes: string; stdUnitPrice: number }) => {
      const actualUnitPrice = updates.qtyReceived > 0 ? updates.actualTotal / updates.qtyReceived : 0;
      const stdTotal = updates.qtyReceived * updates.stdUnitPrice;
      const priceVariance = updates.actualTotal - stdTotal;
      const { error } = await supabase
        .from("branch_receipts")
        .update({
          qty_received: updates.qtyReceived,
          actual_total: updates.actualTotal,
          actual_unit_price: actualUnitPrice,
          std_total: stdTotal,
          price_variance: priceVariance,
          notes: updates.notes,
        })
        .eq("id", id);
      if (error) {
        toast.error("Failed to update receipt");
        return false;
      }
      await fetchReceipts();
      return true;
    },
    [fetchReceipts],
  );

  const deleteReceipt = useCallback(async (id: string) => {
    const { error } = await supabase.from("branch_receipts").delete().eq("id", id);
    if (error) {
      toast.error("Failed to delete receipt");
      return;
    }
    setReceipts((prev) => prev.filter((r) => r.id !== id));
  }, []);

  return { receipts, loading, saveReceipts, updateReceipt, deleteReceipt, fetchReceipts };
}
