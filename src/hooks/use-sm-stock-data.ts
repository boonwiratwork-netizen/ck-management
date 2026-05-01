import { useState, useCallback, useMemo, useEffect } from "react";
import { StockAdjustment } from "@/types/stock";
import { SKU } from "@/types/sku";
import { ProductionRecord } from "@/types/production";
import { Delivery } from "@/types/delivery";
import { BOMHeader, BOMLine, BOMStep } from "@/types/bom";
import { BomByproduct } from "@/types/byproduct";
import { Price } from "@/types/price";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface SMStockBalance {
  skuId: string;
  openingStock: number;
  totalProduced: number;
  totalDelivered: number;
  adjustments: StockAdjustment[];
  currentStock: number;
}

interface AnchorData {
  physical_qty: number;
  count_date: string;
  completed_at: string;
}

export function useSmStockData(
  skus: SKU[],
  productionRecords: ProductionRecord[],
  deliveries: Delivery[],
  bomHeaders: BOMHeader[],
  bomLines: BOMLine[],
  prices: Price[],
  bomSteps: BOMStep[] = [],
  bomByproducts: BomByproduct[] = [],
) {
  const [openingStocks, setOpeningStocksState] = useState<Record<string, number>>({});
  const [adjustments, setAdjustments] = useState<StockAdjustment[]>([]);
  const [isStockDataReady, setIsStockDataReady] = useState(false);
  const [toDelivered, setToDelivered] = useState<Record<string, number>>({});
  // TO lines with delivery dates for anchor filtering
  const [toLineDetails, setToLineDetails] = useState<Array<{ sku_id: string; qty: number; delivery_date: string }>>([]);
  const [localProductionRecords, setLocalProductionRecords] = useState<ProductionRecord[]>(productionRecords);
  const [anchorMap, setAnchorMap] = useState<Record<string, AnchorData>>({});

  useEffect(() => {
    setLocalProductionRecords(productionRecords);
  }, [productionRecords]);

  const fetchAnchorData = useCallback(async () => {
    const { data: sessions } = await supabase
      .from("stock_count_sessions")
      .select("id, count_date, completed_at")
      .eq("status", "Completed")
      .is("deleted_at", null);

    const sessionIds = (sessions || []).map((s: any) => s.id);
    if (sessionIds.length === 0) {
      setAnchorMap({});
      return;
    }

    const sessionDateMap: Record<string, string> = {};
    const sessionCompletedAtMap: Record<string, string> = {};
    for (const s of sessions || []) {
      sessionDateMap[s.id] = s.count_date;
      sessionCompletedAtMap[s.id] = s.completed_at ?? s.count_date;
    }

    const { data: lines } = await supabase
      .from("stock_count_lines")
      .select("sku_id, physical_qty, session_id")
      .in("session_id", sessionIds)
      .eq("type", "SM")
      .not("physical_qty", "is", null);

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
        };
      }
    }
    setAnchorMap(map);
  }, []);

  useEffect(() => {
    setIsStockDataReady(false);
    Promise.all([
      supabase.from("stock_opening_balances").select("*"),
      supabase.from("stock_adjustments").select("*").eq("stock_type", "SM").order("created_at", { ascending: false }),
      supabase.from("transfer_order_lines").select("sku_id, planned_qty, actual_qty, to_id"),
      supabase.from("transfer_orders").select("id, status, delivery_date").in("status", ["Sent", "Received"]),
      fetchAnchorData(),
    ]).then(([obRes, adjRes, toLineRes, toRes]) => {
      if (obRes.data) {
        const map: Record<string, number> = {};
        obRes.data.forEach((r: any) => {
          map[r.sku_id] = r.quantity;
        });
        setOpeningStocksState(map);
      }
      if (adjRes.data) {
        setAdjustments(
          adjRes.data.map((r: any) => ({
            id: r.id,
            skuId: r.sku_id,
            date: r.adjustment_date,
            quantity: r.quantity,
            reason: r.reason,
          })),
        );
      }

      const validToIds = new Set((toRes.data || []).map((t: any) => t.id));
      const toStatusMap: Record<string, string> = {};
      const toDateMap: Record<string, string> = {};
      for (const t of toRes.data || []) {
        toStatusMap[t.id] = t.status;
        toDateMap[t.id] = t.delivery_date;
      }

      const delivered: Record<string, number> = {};
      const lineDetails: Array<{ sku_id: string; qty: number; delivery_date: string }> = [];
      for (const line of toLineRes.data || []) {
        if (!validToIds.has(line.to_id)) continue;
        const qty = line.actual_qty > 0 ? line.actual_qty : toStatusMap[line.to_id] === "Sent" ? line.planned_qty : 0;
        delivered[line.sku_id] = (delivered[line.sku_id] || 0) + qty;
        lineDetails.push({ sku_id: line.sku_id, qty, delivery_date: toDateMap[line.to_id] });
      }
      setToDelivered(delivered);
      setToLineDetails(lineDetails);

      setIsStockDataReady(true);
    });
  }, []);

  const smSkus = useMemo(() => skus.filter((s) => s.type === "SM"), [skus]);

  const stockBalances = useMemo((): SMStockBalance[] => {
    return smSkus.map((sku) => {
      const anchor = anchorMap[sku.id];

      if (anchor) {
        // Anchor-based: balance = anchor physical_qty + production after anchor - deliveries after anchor + non-StockCount adjustments after anchor
        const producedAfter = localProductionRecords
          .filter((r) => r.smSkuId === sku.id && r.productionDate >= anchor.count_date)
          .reduce((sum, r) => sum + r.actualOutputG, 0);

        const deliveredAfter = toLineDetails
          .filter((l) => l.sku_id === sku.id && l.delivery_date >= anchor.count_date)
          .reduce((sum, l) => sum + l.qty, 0);

        const skuAdjustments = adjustments.filter((a) => a.skuId === sku.id);
        const adjustmentsAfter = skuAdjustments
          .filter((a) => a.date > anchor.count_date && !a.reason.includes("Stock Count"))
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
        stock_type: "SM",
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

  const getBomCostPerGram = useCallback(
    (skuId: string): number => {
      const bomHeader = bomHeaders.find((h) => h.smSkuId === skuId);
      if (!bomHeader) return 0;

      let totalCost = 0;
      let mainOutput = 0;

      if (bomHeader.bomMode === "multistep") {
        const steps = bomSteps
          .filter((s) => s.bomHeaderId === bomHeader.id)
          .sort((a, b) => a.stepNumber - b.stepNumber);
        const allLines = bomLines.filter((l) => l.bomHeaderId === bomHeader.id);
        if (steps.length === 0) return 0;

        let prevOutput = 0;
        steps.forEach((step, idx) => {
          const sLines = allLines.filter((l) => l.stepId === step.id);
          const inputQty = idx === 0 ? sLines.reduce((s, l) => s + l.qtyPerBatch, 0) : prevOutput;
          const addedQty =
            idx === 0
              ? 0
              : sLines.reduce((s, l) => {
                  if (l.qtyType === "percent" && l.percentOfInput) return s + l.percentOfInput * inputQty;
                  return s + l.qtyPerBatch;
                }, 0);
          const effectiveInput = idx === 0 ? inputQty : inputQty + addedQty;
          prevOutput = effectiveInput * step.yieldPercent;

          totalCost += sLines.reduce((s, l) => {
            let qty = l.qtyPerBatch;
            if (l.qtyType === "percent" && l.percentOfInput) qty = l.percentOfInput * inputQty;
            const ap = prices.find((p) => p.skuId === l.rmSkuId && p.isActive);
            return s + qty * (ap?.pricePerUsageUom ?? 0);
          }, 0);
        });
        mainOutput = prevOutput;
      } else {
        const bLines = bomLines.filter((l) => l.bomHeaderId === bomHeader.id);
        totalCost = bLines.reduce((s, line) => {
          const ap = prices.find((p) => p.skuId === line.rmSkuId && p.isActive);
          return s + line.qtyPerBatch * (ap?.pricePerUsageUom ?? 0);
        }, 0);
        mainOutput = bomHeader.batchSize * bomHeader.yieldPercent;
      }

      const headerByproducts = bomByproducts.filter((bp) => bp.bomHeaderId === bomHeader.id);
      const totalByproductPct = headerByproducts.reduce((s, bp) => s + bp.costAllocationPct, 0);
      const mainPct = Math.max(0, 100 - totalByproductPct);
      const allocatedCost = totalCost * (mainPct / 100);

      return mainOutput > 0 ? allocatedCost / mainOutput : 0;
    },
    [bomHeaders, bomLines, bomSteps, prices, bomByproducts],
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
    const [prodRes, adjRes] = await Promise.all([
      supabase.from("production_records").select("*").order("created_at", { ascending: false }),
      supabase.from("stock_adjustments").select("*").eq("stock_type", "SM").order("created_at", { ascending: false }),
    ]);
    if (prodRes.data) {
      setLocalProductionRecords(
        prodRes.data.map((r: any) => ({
          id: r.id,
          planId: r.plan_id,
          productionDate: r.production_date,
          smSkuId: r.sm_sku_id,
          batchesProduced: r.batches_produced,
          actualOutputG: r.actual_output_g,
          createdAt: r.created_at,
        })),
      );
    }
    if (adjRes.data) {
      setAdjustments(
        adjRes.data.map((r: any) => ({
          id: r.id,
          skuId: r.sku_id,
          date: r.adjustment_date,
          quantity: r.quantity,
          reason: r.reason,
        })),
      );
    }
    // Also refresh anchor data
    await fetchAnchorData();
  }, [fetchAnchorData]);

  const refreshToDelivered = useCallback(async () => {
    const [toLineRes, toRes] = await Promise.all([
      supabase.from("transfer_order_lines").select("sku_id, planned_qty, actual_qty, to_id"),
      supabase.from("transfer_orders").select("id, status, delivery_date").in("status", ["Sent", "Received"]),
    ]);
    const validToIds = new Set((toRes.data || []).map((t: any) => t.id));
    const toStatusMap: Record<string, string> = {};
    const toDateMap: Record<string, string> = {};
    for (const t of toRes.data || []) {
      toStatusMap[t.id] = t.status;
      toDateMap[t.id] = t.delivery_date;
    }
    const delivered: Record<string, number> = {};
    const lineDetails: Array<{ sku_id: string; qty: number; delivery_date: string }> = [];
    for (const line of toLineRes.data || []) {
      if (!validToIds.has(line.to_id)) continue;
      const qty = line.actual_qty > 0 ? line.actual_qty : toStatusMap[line.to_id] === "Sent" ? line.planned_qty : 0;
      delivered[line.sku_id] = (delivered[line.sku_id] || 0) + qty;
      lineDetails.push({ sku_id: line.sku_id, qty, delivery_date: toDateMap[line.to_id] });
    }
    setToDelivered(delivered);
    setToLineDetails(lineDetails);
  }, []);

  return {
    stockBalances,
    setOpeningStock,
    addAdjustment,
    getBomCostPerGram,
    getLastProductionDate,
    openingStocks,
    isStockDataReady,
    refreshToDelivered,
    refreshProductionRecords,
  };
}
