import { useState, useCallback, useMemo, useEffect } from "react";
import { afterCount, producedAfterCount, type CountAnchor, type CountTiming } from "@/lib/count-anchor";
import { fetchAllRows, fetchAllRowsOrThrow } from "@/lib/fetch-all";
import { StockAdjustment } from "@/types/stock";
import { SKU } from "@/types/sku";
import { ProductionRecord } from "@/types/production";
import { Delivery } from "@/types/delivery";
import { BOMHeader, BOMLine, BOMStep } from "@/types/bom";
import { BomByproduct } from "@/types/byproduct";
import { Price } from "@/types/price";
import { supabase } from "@/integrations/supabase/client";
import { writeError, writeTimeout } from "@/lib/write-timeout";
import { toast } from "sonner";
import { TO_DELIVERED_STATUSES, computeToLineQty } from "@/lib/to-line-qty";

export interface SMStockBalance {
  skuId: string;
  openingStock: number;
  totalProduced: number;
  totalDelivered: number;
  adjustments: StockAdjustment[];
  currentStock: number;
}

interface AnchorData extends CountAnchor {
  physical_qty: number;
  count_date: string;
  completed_at: string;
}

type DeliveredLine = { sku_id: string; qty: number; delivery_date: string; sent_at?: string };

/**
 * What the kitchen has sent to branches, per SM product and per line (for the balance and the
 * moves after a count). Both reads are paged and ordered by id: one unpaged read of every
 * transfer order line ever stopped silently at the row limit, understating sends and so
 * overstating kitchen stock. A failed page fails the whole read (throws): never a partial total.
 */
async function readDelivered(): Promise<{ delivered: Record<string, number>; lineDetails: DeliveredLine[] }> {
  const [lines, orders] = await Promise.all([
    fetchAllRowsOrThrow<{ sku_id: string; planned_qty: number; actual_qty: number; to_id: string }>((a, b) =>
      supabase.from("transfer_order_lines").select("id, sku_id, planned_qty, actual_qty, to_id").order("id").range(a, b) as never,
    ),
    fetchAllRowsOrThrow<{ id: string; status: string; delivery_date: string; sent_at: string }>((a, b) =>
      supabase.from("transfer_orders").select("id, status, delivery_date, sent_at").in("status", TO_DELIVERED_STATUSES).order("id").range(a, b) as never,
    ),
  ]);
  // Only lines of orders that went out (the status read above)
  const byId = new Map(orders.map((t) => [t.id, t]));
  const delivered: Record<string, number> = {};
  const lineDetails: DeliveredLine[] = [];
  for (const line of lines) {
    const to = byId.get(line.to_id);
    if (!to) continue;
    const qty = computeToLineQty(line.actual_qty, line.planned_qty, to.status);
    delivered[line.sku_id] = (delivered[line.sku_id] || 0) + qty;
    // sent_at: when the order was last changed — the send, or a later receive (close enough to place it against a count)
    lineDetails.push({ sku_id: line.sku_id, qty, delivery_date: to.delivery_date, sent_at: to.sent_at });
  }
  return { delivered, lineDetails };
}

/**
 * The kitchen's SM adjustments (production in/out, counts, manual), newest first. Paged with
 * id as the tiebreaker: one unpaged read stopped silently at the row limit, dropping the oldest
 * moves from the balance. A failed page fails the read (throws): never a partial list.
 */
async function readSmAdjustments(): Promise<StockAdjustment[]> {
  const rows = await fetchAllRowsOrThrow<{ id: string; sku_id: string; adjustment_date: string; quantity: number; reason: string; created_at: string }>((a, b) =>
    supabase.from("stock_adjustments").select("*").eq("stock_type", "SM").is("branch_id", null).order("created_at", { ascending: false }).order("id").range(a, b) as never,
  );
  return rows.map((r) => ({ id: r.id, skuId: r.sku_id, date: r.adjustment_date, quantity: r.quantity, reason: r.reason, createdAt: r.created_at }));
}

/** Every production run, newest first (paged the same way, for the same reason) */
async function readProductionRecords(): Promise<ProductionRecord[]> {
  const rows = await fetchAllRowsOrThrow<{ id: string; plan_id: string; production_date: string; sm_sku_id: string; batches_produced: number; actual_output_g: number; created_at: string }>((a, b) =>
    supabase.from("production_records").select("*").order("created_at", { ascending: false }).order("id").range(a, b) as never,
  );
  return rows.map((r) => ({ id: r.id, planId: r.plan_id, productionDate: r.production_date, smSkuId: r.sm_sku_id, batchesProduced: r.batches_produced, actualOutputG: r.actual_output_g, createdAt: r.created_at }));
}

const ADJUSTMENTS_FAILED = "อ่านรายการปรับยอดครัวผลิตไม่สำเร็จ ยอดคงเหลือครัวผลิต (SM) ยังไม่ถูก ลองรีเฟรช";

const DELIVERED_FAILED = "อ่านยอดที่ส่งให้สาขาไม่สำเร็จ ยอดคงเหลือครัวผลิต (SM) ยังไม่ถูก ลองรีเฟรช";

export function useSmStockData(
  skus: SKU[],
  productionRecords: ProductionRecord[],
  deliveries: Delivery[],
  bomHeaders: BOMHeader[],
  bomLines: BOMLine[],
  prices: Price[],
  bomSteps: BOMStep[] = [],
  bomByproducts: BomByproduct[] = [],
  enabled = true,
) {
  const [openingStocks, setOpeningStocksState] = useState<Record<string, number>>({});
  const [adjustments, setAdjustments] = useState<StockAdjustment[]>([]);
  const [isStockDataReady, setIsStockDataReady] = useState(false);
  const [toDelivered, setToDelivered] = useState<Record<string, number>>({});
  // TO lines with delivery dates for anchor filtering
  const [toLineDetails, setToLineDetails] = useState<Array<{ sku_id: string; qty: number; delivery_date: string; sent_at?: string }>>(
    [],
  );
  const [localProductionRecords, setLocalProductionRecords] = useState<ProductionRecord[]>(productionRecords);
  const [anchorMap, setAnchorMap] = useState<Record<string, AnchorData>>({});

  useEffect(() => {
    setLocalProductionRecords(productionRecords);
  }, [productionRecords]);

  const fetchAnchorData = useCallback(async () => {
    const { data: sessions } = await supabase
      .from("stock_count_sessions")
      .select("id, count_date, completed_at, count_timing")
      .eq("status", "Completed")
      .is("deleted_at", null);

    const sessionIds = (sessions || []).map((s: any) => s.id);
    if (sessionIds.length === 0) {
      setAnchorMap({});
      return;
    }

    const sessionDateMap: Record<string, string> = {};
    const sessionCompletedAtMap: Record<string, string> = {};
    const sessionTimingMap: Record<string, CountTiming | null> = {};
    for (const s of sessions || []) {
      sessionDateMap[s.id] = s.count_date;
      sessionCompletedAtMap[s.id] = s.completed_at ?? s.count_date;
      sessionTimingMap[s.id] = (s as { count_timing?: CountTiming | null }).count_timing ?? null;
    }

    // Paged: counted lines pass 1,000 rows over time; a capped read could miss the latest count
    const { data: lines, error: linesErr } = await fetchAllRows<any>((f, t) =>
      supabase
        .from("stock_count_lines")
        .select("id, sku_id, physical_qty, session_id")
        .in("session_id", sessionIds)
        .eq("type", "SM")
        .not("physical_qty", "is", null)
        .order("id")
        .range(f, t),
    );

    // A partly read set could fall back to an older count: keep what we had
    if (linesErr) return;
    const map: Record<string, AnchorData> = {};
    for (const row of lines || []) {
      const countDate = sessionDateMap[row.session_id];
      if (!countDate) continue;
      const existing = map[row.sku_id];
      if (!existing || countDate > existing.count_date) {
        map[row.sku_id] = {
          physical_qty: row.physical_qty,
          count_date: countDate,
          completed_at: sessionCompletedAtMap[row.session_id] ?? countDate,
          timing: sessionTimingMap[row.session_id] ?? null,
        };
      }
    }
    setAnchorMap(map);
  }, []);

  /** The first read failed: SM stock isn't ready; it says so, and tries again by itself (or on "ลองใหม่") */
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadTry, setLoadTry] = useState(0);
  const retryLoad = useCallback(() => setLoadTry((n) => n + 1), []);
  useEffect(() => {
    if (!loadFailed) return;
    const t = setTimeout(retryLoad, 15_000);
    return () => clearTimeout(t);
  }, [loadFailed, loadTry, retryLoad]);

  useEffect(() => {
    setIsStockDataReady(false);
    // Kitchen data loads only once a kitchen page is opened (see Index)
    if (!enabled) return;
    let cancelled = false;
    Promise.all([
      supabase.from("stock_opening_balances").select("*"),
      // A failed read stays null: the stock isn't marked ready on a partial list (said below)
      readSmAdjustments().catch(() => null),
      // A failed read stays null: the stock isn't marked ready on a partial total (said below)
      readDelivered().catch(() => null),
      fetchAnchorData(),
    ]).then(([obRes, adj, sent]) => {
      if (cancelled) return;
      if (obRes.data) {
        const map: Record<string, number> = {};
        obRes.data.forEach((r: any) => {
          map[r.sku_id] = r.quantity;
        });
        setOpeningStocksState(map);
      }
      if (!adj) {
        toast.error(ADJUSTMENTS_FAILED);
        setLoadFailed(true);
        return;
      }
      setAdjustments(adj);

      if (!sent) {
        toast.error(DELIVERED_FAILED);
        setLoadFailed(true);
        return;
      }
      setToDelivered(sent.delivered);
      setToLineDetails(sent.lineDetails);

      setLoadFailed(false);
      setIsStockDataReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, loadTry]);

  const smSkus = useMemo(() => skus.filter((s) => s.type === "SM"), [skus]);

  const stockBalances = useMemo((): SMStockBalance[] => {
    return smSkus.map((sku) => {
      const anchor = anchorMap[sku.id];

      if (anchor) {
        // Anchor-based: balance = anchor physical_qty + production after anchor (timestamp) - deliveries strictly after anchor date + non-StockCount adjustments after anchor
        const producedAfter = localProductionRecords
          .filter((r) => r.smSkuId === sku.id && producedAfterCount(anchor, r.productionDate, r.createdAt))
          .reduce((sum, r) => sum + r.actualOutputG, 0);

        const deliveredAfter = toLineDetails
          .filter((l) => l.sku_id === sku.id && afterCount(anchor, l.delivery_date))
          .reduce((sum, l) => sum + l.qty, 0);

        const skuAdjustments = adjustments.filter((a) => a.skuId === sku.id);
        const adjustmentsAfter = skuAdjustments
          .filter((a) => afterCount(anchor, a.date) && !a.reason.includes("Stock Count"))
          .reduce((sum, a) => sum + a.quantity, 0);

        const currentStock = anchor.physical_qty + producedAfter - deliveredAfter + adjustmentsAfter;

        return {
          skuId: sku.id,
          openingStock: anchor.physical_qty,
          totalProduced: producedAfter,
          totalDelivered: deliveredAfter,
          adjustments: skuAdjustments,
          currentStock,
        };
      }

      // Fallback: no anchor — use original calculation
      const opening = openingStocks[sku.id] ?? 0;
      const totalProduced = localProductionRecords
        .filter((r) => r.smSkuId === sku.id)
        .reduce((sum, r) => sum + r.actualOutputG, 0);
      const totalDelivered = toDelivered[sku.id] ?? 0;
      const skuAdjustments = adjustments.filter((a) => a.skuId === sku.id);
      const netAdjustment = skuAdjustments.reduce((sum, a) => sum + a.quantity, 0);
      const currentStock = opening + totalProduced - totalDelivered + netAdjustment;
      return {
        skuId: sku.id,
        openingStock: opening,
        totalProduced,
        totalDelivered,
        adjustments: skuAdjustments,
        currentStock,
      };
    });
  }, [smSkus, localProductionRecords, toDelivered, toLineDetails, openingStocks, adjustments, anchorMap]);

  const setOpeningStock = useCallback(async (skuId: string, qty: number) => {
    const { error } = await supabase
      .from("stock_opening_balances")
      .upsert({ sku_id: skuId, quantity: qty }, { onConflict: "sku_id" });
    if (error) {
      toast.error("ตั้งยอดยกมาไม่สำเร็จ: " + error.message);
      return;
    }
    setOpeningStocksState((prev) => ({ ...prev, [skuId]: qty }));
  }, []);

  const addAdjustment = useCallback(async (adj: Omit<StockAdjustment, "id">): Promise<boolean> => {
    const { data: row, error } = await supabase
      .from("stock_adjustments")
      .insert({
        sku_id: adj.skuId,
        adjustment_date: adj.date,
        quantity: adj.quantity,
        reason: adj.reason,
        stock_type: "SM",
      })
      .select()
      .abortSignal(writeTimeout())
      .single();
    if (error || !row) {
      toast.error("บันทึกปรับยอดไม่ได้: " + writeError(error));
      return false;
    }
    setAdjustments((prev) => [
      { id: row.id, skuId: row.sku_id, date: row.adjustment_date, quantity: row.quantity, reason: row.reason, createdAt: row.created_at },
      ...prev,
    ]);
    return true;
  }, []);

  // Cost per gram = the standard recipe cost Cost Center keeps (the saved "BOM
  // Calculation" price: line yields, SM inside SM and by-products' share counted). This
  // page used to sum the recipe itself without yields and gave by-products ฿0.
  const getBomCostPerGram = useCallback(
    (skuId: string): number => prices.find((p) => p.skuId === skuId && p.isActive)?.pricePerUsageUom ?? 0,
    [prices],
  );

  /** Last count of an SM, or null */
  const getAnchor = useCallback((skuId: string) => anchorMap[skuId] ?? null, [anchorMap]);

  /** Production, deliveries and adjustments since the last count */
  const movesAfterCount = useCallback(
    (skuId: string): number => {
      const anchor = anchorMap[skuId];
      const prod = localProductionRecords.filter((r) => r.smSkuId === skuId && (!anchor || producedAfterCount(anchor, r.productionDate, r.createdAt))).length;
      const out = toLineDetails.filter((l) => l.sku_id === skuId && (!anchor || afterCount(anchor, l.delivery_date))).length;
      const adj = adjustments.filter((a) => a.skuId === skuId && !a.reason.includes("Stock Count") && (!anchor || afterCount(anchor, a.date))).length;
      return prod + out + adj;
    },
    [anchorMap, localProductionRecords, toLineDetails, adjustments],
  );

  const getLastProductionDate = useCallback(
    (skuId: string): string | null => {
      const recs = localProductionRecords.filter((r) => r.smSkuId === skuId);
      if (recs.length === 0) return null;
      return recs.reduce(
        (latest, r) => (r.productionDate > latest ? r.productionDate : latest),
        recs[0].productionDate,
      );
    },
    [localProductionRecords],
  );

  const refreshProductionRecords = useCallback(async () => {
    // Both or neither: a run without its stock moves (or the reverse) would show a wrong balance.
    // On a failure the figures on screen stay as they were, and it says so
    try {
      const [records, adj] = await Promise.all([readProductionRecords(), readSmAdjustments()]);
      setLocalProductionRecords(records);
      setAdjustments(adj);
    } catch {
      toast.error(ADJUSTMENTS_FAILED);
    }
    // Also refresh anchor data
    await fetchAnchorData();
  }, [fetchAnchorData]);

  const refreshToDelivered = useCallback(async () => {
    try {
      const { delivered, lineDetails } = await readDelivered();
      setToDelivered(delivered);
      setToLineDetails(lineDetails);
    } catch {
      // The figures on screen stay as they were, and it says so (callers don't await an error)
      toast.error(DELIVERED_FAILED);
    }
  }, []);

  return {
    stockBalances,
    setOpeningStock,
    addAdjustment,
    getBomCostPerGram,
    getAnchor,
    movesAfterCount,
    getLastProductionDate,
    openingStocks,
    isStockDataReady,
    /** The first read failed (retrying by itself every 15 s); `retryLoad` tries now */
    loadFailed,
    retryLoad,
    refreshToDelivered,
    refreshProductionRecords,
  };
}
