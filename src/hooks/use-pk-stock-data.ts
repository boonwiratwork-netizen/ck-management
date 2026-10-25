import { useState, useCallback, useMemo, useEffect } from "react";
import { afterCount, type CountAnchor } from "@/lib/count-anchor";
import { fetchAllRows } from "@/lib/fetch-all";
import { StockBalance, StockAdjustment } from "@/types/stock";
import { GoodsReceipt } from "@/types/goods-receipt";
import { SKU } from "@/types/sku";
import { Price } from "@/types/price";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function usePkStockData(skus: SKU[], receipts: GoodsReceipt[], prices: Price[], enabled = true) {
  const [openingStocks, setOpeningStocksState] = useState<Record<string, number>>({});
  const [adjustments, setAdjustments] = useState<StockAdjustment[]>([]);
  const [anchorMap, setAnchorMap] = useState<Record<string, { physical_qty: number } & CountAnchor>>({});

  useEffect(() => {
    // Kitchen data loads only once a kitchen page is opened (see Index)
    if (!enabled) return;
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
    // Paged: production and transfers write several rows a day (well past 1,000)
    fetchAllRows<any>((f, t) =>
      supabase
        .from("stock_adjustments")
        .select("*")
        .eq("stock_type", "PK")
        .is("branch_id", null)
        .order("created_at", { ascending: false })
        .order("id")
        .range(f, t),
    ).then(({ data, error }) => {
      if (!error)
        setAdjustments(
          data.map((r: any) => ({
            id: r.id,
            skuId: r.sku_id,
            date: r.adjustment_date,
            quantity: r.quantity,
            reason: r.reason,
            createdAt: r.created_at,
          })),
        );
    });

    // Fetch latest physical count anchor per PK SKU
    (async () => {
      const { data: sessions } = await supabase
        .from("stock_count_sessions")
        .select("id, count_date, completed_at, count_timing")
        .eq("status", "Completed")
        .is("deleted_at", null);
      if (!sessions || sessions.length === 0) return;
      const sessionDateById: Record<string, string> = {};
      const sessionById: Record<string, any> = {};
      sessions.forEach((s: any) => {
        sessionDateById[s.id] = s.count_date;
        sessionById[s.id] = s;
      });
      // Paged: counted lines pass 1,000 rows (one monthly count adds ~120), and an
      // unordered capped read could miss the latest count
      const { data: lines, error: linesErr } = await fetchAllRows<any>((f, t) =>
        supabase
          .from("stock_count_lines")
          .select("id, session_id, sku_id, physical_qty, type")
          .eq("type", "PK")
          .not("physical_qty", "is", null)
          .in("session_id", sessions.map((s: any) => s.id))
          .order("id")
          .range(f, t),
      );
      // A partly read set could fall back to an older count: keep what we had
      if (!lines || linesErr) return;
      const map: Record<string, { physical_qty: number } & CountAnchor> = {};
      lines.forEach((l: any) => {
        const date = sessionDateById[l.session_id];
        if (!date) return;
        const existing = map[l.sku_id];
        if (!existing || date > existing.count_date) {
          const ss = sessionById[l.session_id];
          map[l.sku_id] = { physical_qty: Number(l.physical_qty), count_date: date, completed_at: ss.completed_at, timing: ss.count_timing ?? null };
        }
      });
      setAnchorMap(map);
    })();
  }, [enabled]);

  const pkSkus = useMemo(() => skus.filter((s) => s.type === "PK"), [skus]);

  const stockBalances = useMemo((): StockBalance[] => {
    return pkSkus.map((sku) => {
      const opening = openingStocks[sku.id] ?? 0;
      const skuAdjustments = adjustments.filter((a) => a.skuId === sku.id);
      const anchor = anchorMap[sku.id];

      let totalReceived: number;
      let netAdjustment: number;
      let currentStock: number;

      if (anchor) {
        totalReceived = receipts
          .filter((r) => r.skuId === sku.id && afterCount(anchor, r.receiptDate, r.createdAt))
          .reduce((sum, r) => sum + r.quantityReceived * (sku.converter ?? 1), 0);
        netAdjustment = skuAdjustments
          .filter((a) => afterCount(anchor, a.date, a.createdAt) && !(a.reason ?? "").startsWith("Stock Count"))
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
  }, [pkSkus, receipts, openingStocks, adjustments, anchorMap]);

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
        stock_type: "PK",
      })
      .select()
      .single();
    if (error) {
      toast.error("Failed to add adjustment: " + error.message);
      return;
    }
    setAdjustments((prev) => [
      { id: row.id, skuId: row.sku_id, date: row.adjustment_date, quantity: row.quantity, reason: row.reason, createdAt: row.created_at },
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
