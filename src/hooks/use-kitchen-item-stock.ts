import { useState, useCallback, useMemo, useEffect } from "react";
import { afterCount, type CountAnchor } from "@/lib/count-anchor";
import { fetchAllRows } from "@/lib/fetch-all";
import { StockBalance, StockAdjustment } from "@/types/stock";
import { SKU } from "@/types/sku";
import { Price } from "@/types/price";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/** Days of real outflow behind "uses per day" (production + sent to branches) */
export const USAGE_WINDOW_DAYS = 28;

interface Receipt {
  skuId: string;
  date: string;
  qty: number;
  supplierId: string;
}

/**
 * Kitchen stock of bought items (RM or PK) — one hook for both (they were two copies).
 * Balance = last count + receipts × converter + adjustments after the count (the
 * pooled-anchor formula, count day per count-anchor.ts). "Stock Count" adjustments
 * are skipped (the count itself is the anchor).
 *
 * Receipts are read in full here (paged): the shared receipts list only holds 90 days,
 * which dropped older receipts from items not counted since.
 */
export function useKitchenItemStock(type: "RM" | "PK", skus: SKU[], prices: Price[], enabled = true) {
  const [openingStocks, setOpeningStocksState] = useState<Record<string, number>>({});
  const [adjustments, setAdjustments] = useState<StockAdjustment[]>([]);
  const [anchorMap, setAnchorMap] = useState<Record<string, { physical_qty: number } & CountAnchor>>({});
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const [obRes, adjRes, grRes] = await Promise.all([
      supabase.from("stock_opening_balances").select("*"),
      // Paged: production and transfers write several rows a day (well past 1,000)
      fetchAllRows<any>((f, t) =>
        supabase.from("stock_adjustments").select("*").eq("stock_type", type).is("branch_id", null).order("created_at", { ascending: false }).order("id").range(f, t),
      ),
      fetchAllRows<any>((f, t) =>
        supabase.from("goods_receipts").select("sku_id, receipt_date, quantity_received, supplier_id").order("receipt_date", { ascending: false }).order("id").range(f, t),
      ),
    ]);
    if (obRes.data) {
      const map: Record<string, number> = {};
      obRes.data.forEach((r: any) => (map[r.sku_id] = r.quantity));
      setOpeningStocksState(map);
    }
    if (!adjRes.error)
      setAdjustments(adjRes.data.map((r: any) => ({ id: r.id, skuId: r.sku_id, date: r.adjustment_date, quantity: r.quantity, reason: r.reason, createdAt: r.created_at })));
    if (!grRes.error) setReceipts(grRes.data.map((r: any) => ({ skuId: r.sku_id, date: r.receipt_date, qty: Number(r.quantity_received) || 0, supplierId: r.supplier_id })));

    // Latest physical count per SKU of this type
    const { data: sessions } = await supabase.from("stock_count_sessions").select("id, count_date, completed_at, count_timing").eq("status", "Completed").is("deleted_at", null);
    if (sessions && sessions.length) {
      const byId: Record<string, any> = {};
      sessions.forEach((s: any) => (byId[s.id] = s));
      // Paged: counted lines pass 1,000 rows; a capped read could miss the latest count
      const { data: lines, error } = await fetchAllRows<any>((f, t) =>
        supabase
          .from("stock_count_lines")
          .select("id, session_id, sku_id, physical_qty, type")
          .eq("type", type)
          .not("physical_qty", "is", null)
          .in("session_id", sessions.map((s: any) => s.id))
          .order("id")
          .range(f, t),
      );
      if (lines && !error) {
        const map: Record<string, { physical_qty: number } & CountAnchor> = {};
        lines.forEach((l: any) => {
          const ss = byId[l.session_id];
          if (!ss) return;
          const existing = map[l.sku_id];
          if (!existing || ss.count_date > existing.count_date)
            map[l.sku_id] = { physical_qty: Number(l.physical_qty), count_date: ss.count_date, completed_at: ss.completed_at, timing: ss.count_timing ?? null };
        });
        setAnchorMap(map);
      }
    }
    setLoaded(true);
  }, [type]);

  useEffect(() => {
    // Kitchen data loads only once a kitchen page is opened (see Index)
    if (enabled) load();
  }, [enabled, load]);

  const typeSkus = useMemo(() => skus.filter((s) => s.type === type), [skus, type]);
  const receiptsBySku = useMemo(() => {
    const m = new Map<string, Receipt[]>();
    for (const r of receipts) {
      if (!m.has(r.skuId)) m.set(r.skuId, []);
      m.get(r.skuId)!.push(r);
    }
    return m;
  }, [receipts]);
  const adjBySku = useMemo(() => {
    const m = new Map<string, StockAdjustment[]>();
    for (const a of adjustments) {
      if (!m.has(a.skuId)) m.set(a.skuId, []);
      m.get(a.skuId)!.push(a);
    }
    return m;
  }, [adjustments]);

  const isCountAdj = (a: StockAdjustment) => (a.reason ?? "").includes("Stock Count");

  const stockBalances = useMemo((): StockBalance[] => {
    return typeSkus.map((sku) => {
      const opening = openingStocks[sku.id] ?? 0;
      const skuAdj = adjBySku.get(sku.id) ?? [];
      const skuRec = receiptsBySku.get(sku.id) ?? [];
      const anchor = anchorMap[sku.id];
      const conv = sku.converter ?? 1;
      let totalReceived: number;
      let currentStock: number;
      if (anchor) {
        totalReceived = skuRec.filter((r) => afterCount(anchor, r.date)).reduce((s, r) => s + r.qty * conv, 0);
        const net = skuAdj.filter((a) => afterCount(anchor, a.date) && !isCountAdj(a)).reduce((s, a) => s + a.quantity, 0);
        currentStock = anchor.physical_qty + totalReceived + net;
      } else {
        totalReceived = skuRec.reduce((s, r) => s + r.qty * conv, 0);
        const net = skuAdj.reduce((s, a) => s + a.quantity, 0);
        currentStock = Math.max(0, opening) + totalReceived + net;
      }
      return { skuId: sku.id, openingStock: opening, totalReceived, totalConsumed: 0, adjustments: skuAdj, currentStock };
    });
  }, [typeSkus, openingStocks, adjBySku, receiptsBySku, anchorMap]);

  const setOpeningStock = useCallback(async (skuId: string, qty: number) => {
    const { error } = await supabase.from("stock_opening_balances").upsert({ sku_id: skuId, quantity: qty }, { onConflict: "sku_id" });
    if (error) {
      toast.error("Failed to set opening stock: " + error.message);
      return;
    }
    setOpeningStocksState((prev) => ({ ...prev, [skuId]: qty }));
  }, []);

  /** Saves one adjustment; true only when it is really in the database */
  const addAdjustment = useCallback(
    async (adj: Omit<StockAdjustment, "id">): Promise<boolean> => {
      const { data: row, error } = await supabase
        .from("stock_adjustments")
        .insert({ sku_id: adj.skuId, adjustment_date: adj.date, quantity: adj.quantity, reason: adj.reason, stock_type: type })
        .select()
        .single();
      if (error || !row) {
        toast.error("บันทึกปรับยอดไม่ได้: " + (error?.message ?? ""));
        return false;
      }
      setAdjustments((prev) => [{ id: row.id, skuId: row.sku_id, date: row.adjustment_date, quantity: row.quantity, reason: row.reason, createdAt: row.created_at }, ...prev]);
      return true;
    },
    [type],
  );

  const getStdUnitPrice = useCallback(
    (skuId: string): number => {
      // The standard: newest active price (prices are newest first)
      const active = prices.find((p) => p.skuId === skuId && p.isActive);
      return active?.pricePerUsageUom ?? 0;
    },
    [prices],
  );

  /** Latest receipt: date and who it came from */
  const getLastReceipt = useCallback((skuId: string): Receipt | null => (receiptsBySku.get(skuId) ?? [])[0] ?? null, [receiptsBySku]);
  const getLastReceiptDate = useCallback((skuId: string): string | null => getLastReceipt(skuId)?.date ?? null, [getLastReceipt]);

  const getAnchor = useCallback((skuId: string): ({ physical_qty: number } & CountAnchor) | null => anchorMap[skuId] ?? null, [anchorMap]);

  /** Receipts and adjustments since the last count (what the balance is built from) */
  const movesAfterCount = useCallback(
    (skuId: string): number => {
      const anchor = anchorMap[skuId];
      const rec = receiptsBySku.get(skuId) ?? [];
      const adj = (adjBySku.get(skuId) ?? []).filter((a) => !isCountAdj(a));
      if (!anchor) return rec.length + adj.length;
      return rec.filter((r) => afterCount(anchor, r.date)).length + adj.filter((a) => afterCount(anchor, a.date)).length;
    },
    [anchorMap, receiptsBySku, adjBySku],
  );

  /** What really went out per day: into production + sent to branches, last 28 days */
  const usagePerDay = useCallback(
    (skuId: string, today: string): number => {
      const from = new Date(today + "T00:00:00");
      from.setDate(from.getDate() - USAGE_WINDOW_DAYS);
      const fromIso = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, "0")}-${String(from.getDate()).padStart(2, "0")}`;
      // Net of production rows (its corrections give back what an edit or delete undid)
      // and deliveries; by-product rows aren't use
      const isUse = (r: string) => (r.startsWith("Production") && !r.startsWith("Production by-product")) || r.startsWith("Distribution:");
      const net = (adjBySku.get(skuId) ?? []).filter((a) => a.date > fromIso && a.date <= today && isUse(a.reason ?? "")).reduce((s, a) => s + a.quantity, 0);
      return Math.max(0, -net) / USAGE_WINDOW_DAYS;
    },
    [adjBySku],
  );

  return {
    stockBalances,
    setOpeningStock,
    addAdjustment,
    getStdUnitPrice,
    getLastReceipt,
    getLastReceiptDate,
    getAnchor,
    movesAfterCount,
    usagePerDay,
    openingStocks,
    loaded,
    reload: load,
  };
}

export type KitchenItemStock = ReturnType<typeof useKitchenItemStock>;
