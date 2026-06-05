import { useState, useCallback, useMemo, useEffect } from "react";
import { StockBalance, StockAdjustment } from "@/types/stock";
import { GoodsReceipt } from "@/types/goods-receipt";
import { SKU } from "@/types/sku";
import { Price } from "@/types/price";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function useStockData(skus: SKU[], receipts: GoodsReceipt[], prices: Price[]) {
  const [openingStocks, setOpeningStocksState] = useState<Record<string, number>>({});
  const [adjustments, setAdjustments] = useState<StockAdjustment[]>([]);
  const [anchorMap, setAnchorMap] = useState<Record<string, { physical_qty: number; count_date: string }>>({});

  // Load opening balances, adjustments, and stock count anchors
  useEffect(() => {
    supabase
      .from("stock_opening_balances")
      .select("*")
      .then(({ data }) => {
        if (data) {
          const map: Record<string, number> = {};
          data.forEach((r: any) => {
            map[r.sku_id] = r.quantity;
          });
          setOpeningStocksState(map);
        }
      });
    supabase
      .from("stock_adjustments")
      .select("*")
      .eq("stock_type", "RM")
      .is("branch_id", null)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (data)
          setAdjustments(
            data.map((r: any) => ({
              id: r.id,
              skuId: r.sku_id,
              date: r.adjustment_date,
              quantity: r.quantity,
              reason: r.reason,
            })),
          );
      });

    // Fetch latest physical count anchor per RM SKU
    (async () => {
      const { data: sessions } = await supabase
        .from("stock_count_sessions")
        .select("id, count_date")
        .eq("status", "Completed")
        .is("deleted_at", null);
      if (!sessions || sessions.length === 0) return;
      const sessionDateById: Record<string, string> = {};
      sessions.forEach((s: any) => {
        sessionDateById[s.id] = s.count_date;
      });
      const { data: lines } = await supabase
        .from("stock_count_lines")
        .select("session_id, sku_id, physical_qty, type")
        .eq("type", "RM")
        .not("physical_qty", "is", null)
        .in("session_id", sessions.map((s: any) => s.id));
      if (!lines) return;
      const map: Record<string, { physical_qty: number; count_date: string }> = {};
      lines.forEach((l: any) => {
        const date = sessionDateById[l.session_id];
        if (!date) return;
        const existing = map[l.sku_id];
        if (!existing || date > existing.count_date) {
          map[l.sku_id] = { physical_qty: Number(l.physical_qty), count_date: date };
        }
      });
      setAnchorMap(map);
    })();
  }, []);

  const rmSkus = useMemo(() => skus.filter((s) => s.type === "RM"), [skus]);

  const stockBalances = useMemo((): StockBalance[] => {
    return rmSkus.map((sku) => {
      const opening = openingStocks[sku.id] ?? 0;
      const skuAdjustments = adjustments.filter((a) => a.skuId === sku.id);
      const anchor = anchorMap[sku.id];

      let totalReceived: number;
      let netAdjustment: number;
      let currentStock: number;

      if (anchor) {
        totalReceived = receipts
          .filter((r) => r.skuId === sku.id && r.receiptDate > anchor.count_date)
          .reduce((sum, r) => sum + r.quantityReceived * (sku.converter ?? 1), 0);
        netAdjustment = skuAdjustments
          .filter((a) => a.date > anchor.count_date && !(a.reason ?? "").startsWith("Stock Count"))
          .reduce((sum, a) => sum + a.quantity, 0);
        currentStock = anchor.physical_qty + totalReceived + netAdjustment;
      } else {
        totalReceived = receipts
          .filter((r) => r.skuId === sku.id)
          .reduce((sum, r) => sum + r.quantityReceived * (sku.converter ?? 1), 0);
        netAdjustment = skuAdjustments.reduce((sum, a) => sum + a.quantity, 0);
        const openingClamped = Math.max(0, opening);
        currentStock = openingClamped + totalReceived + netAdjustment;
      }

      return {
        skuId: sku.id,
        openingStock: opening,
        totalReceived,
        totalConsumed: 0,
        adjustments: skuAdjustments,
        currentStock,
      };
    });
  }, [rmSkus, receipts, openingStocks, adjustments, anchorMap]);

  const setOpeningStock = useCallback(async (skuId: string, qty: number) => {
    const { error } = await supabase
      .from("stock_opening_balances")
      .upsert({ sku_id: skuId, quantity: qty }, { onConflict: "sku_id" });
    if (error) {
      toast.error("Failed to set opening stock: " + error.message);
      return;
    }
    setOpeningStocksState((prev) => ({ ...prev, [skuId]: qty }));
  }, []);

  const addAdjustment = useCallback(async (adj: Omit<StockAdjustment, "id">) => {
    const { data: row, error } = await supabase
      .from("stock_adjustments")
      .insert({
        sku_id: adj.skuId,
        adjustment_date: adj.date,
        quantity: adj.quantity,
        reason: adj.reason,
        stock_type: "RM",
      })
      .select()
      .single();
    if (error) {
      toast.error("Failed to add adjustment: " + error.message);
      return;
    }
    setAdjustments((prev) => [
      { id: row.id, skuId: row.sku_id, date: row.adjustment_date, quantity: row.quantity, reason: row.reason },
      ...prev,
    ]);
  }, []);

  const getStdUnitPrice = useCallback(
    (skuId: string): number => {
      const active = prices.find((p) => p.skuId === skuId && p.isActive);
      return active?.pricePerUsageUom ?? 0;
    },
    [prices],
  );

  const getLastReceiptDate = useCallback(
    (skuId: string): string | null => {
      const skuReceipts = receipts.filter((r) => r.skuId === skuId);
      if (skuReceipts.length === 0) return null;
      return skuReceipts.reduce(
        (latest, r) => (r.receiptDate > latest ? r.receiptDate : latest),
        skuReceipts[0].receiptDate,
      );
    },
    [receipts],
  );

  return { stockBalances, setOpeningStock, addAdjustment, getStdUnitPrice, getLastReceiptDate, openingStocks };
}
