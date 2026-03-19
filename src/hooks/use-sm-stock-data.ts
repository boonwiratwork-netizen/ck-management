import { useState, useCallback, useMemo, useEffect } from 'react';
import { StockAdjustment } from '@/types/stock';
import { SKU } from '@/types/sku';
import { ProductionRecord } from '@/types/production';
import { Delivery } from '@/types/delivery';
import { BOMHeader, BOMLine, BOMStep } from '@/types/bom';
import { BomByproduct } from '@/types/byproduct';
import { Price } from '@/types/price';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface SMStockBalance {
  skuId: string;
  openingStock: number;
  totalProduced: number;
  totalDelivered: number;
  adjustments: StockAdjustment[];
  currentStock: number;
}

export function useSmStockData(
  skus: SKU[],
  productionRecords: ProductionRecord[],
  deliveries: Delivery[],
  bomHeaders: BOMHeader[],
  bomLines: BOMLine[],
  prices: Price[],
  bomSteps: BOMStep[] = [],
  bomByproducts: BomByproduct[] = []
) {
  const [openingStocks, setOpeningStocksState] = useState<Record<string, number>>({});
  const [adjustments, setAdjustments] = useState<StockAdjustment[]>([]);
  const [isStockDataReady, setIsStockDataReady] = useState(false);
  // TO-based delivered quantities per SKU
  const [toDelivered, setToDelivered] = useState<Record<string, number>>({});
  // Local production records for immediate refresh after addRecord
  const [localProductionRecords, setLocalProductionRecords] = useState<ProductionRecord[]>(productionRecords);

  // Sync from prop when it changes
  useEffect(() => {
    setLocalProductionRecords(productionRecords);
  }, [productionRecords]);

  useEffect(() => {
    setIsStockDataReady(false);
    Promise.all([
      supabase.from('stock_opening_balances').select('*'),
      supabase.from('stock_adjustments').select('*').eq('stock_type', 'SM').order('created_at', { ascending: false }),
      // Fetch TO lines with their parent TO status
      supabase
        .from('transfer_order_lines')
        .select('sku_id, planned_qty, actual_qty, to_id'),
      supabase
        .from('transfer_orders')
        .select('id, status')
        .in('status', ['Sent', 'Received']),
    ]).then(([obRes, adjRes, toLineRes, toRes]) => {
      if (obRes.data) {
        const map: Record<string, number> = {};
        obRes.data.forEach((r: any) => { map[r.sku_id] = r.quantity; });
        setOpeningStocksState(map);
      }
      if (adjRes.data) {
        setAdjustments(adjRes.data.map((r: any) => ({
          id: r.id, skuId: r.sku_id, date: r.adjustment_date, quantity: r.quantity, reason: r.reason,
        })));
      }

      // Calculate TO-based delivered quantities
      const validToIds = new Set((toRes.data || []).map((t: any) => t.id));
      const toStatusMap: Record<string, string> = {};
      for (const t of toRes.data || []) {
        toStatusMap[t.id] = t.status;
      }

      const delivered: Record<string, number> = {};
      for (const line of toLineRes.data || []) {
        if (!validToIds.has(line.to_id)) continue;
        const qty = (line.actual_qty > 0) ? line.actual_qty
          : (toStatusMap[line.to_id] === 'Sent' ? line.planned_qty : 0);
        delivered[line.sku_id] = (delivered[line.sku_id] || 0) + qty;
      }
      setToDelivered(delivered);

      setIsStockDataReady(true);
    });
  }, []);

  const smSkus = useMemo(() => skus.filter(s => s.type === 'SM'), [skus]);

  const stockBalances = useMemo((): SMStockBalance[] => {
    return smSkus.map(sku => {
      const opening = openingStocks[sku.id] ?? 0;
      const totalProduced = localProductionRecords.filter(r => r.smSkuId === sku.id).reduce((sum, r) => sum + r.actualOutputG, 0);
      // Use TO-based delivery instead of deliveries table
      const totalDelivered = toDelivered[sku.id] ?? 0;
      const skuAdjustments = adjustments.filter(a => a.skuId === sku.id);
      const netAdjustment = skuAdjustments.reduce((sum, a) => sum + a.quantity, 0);
      const currentStock = opening + totalProduced - totalDelivered + netAdjustment;
      return { skuId: sku.id, openingStock: opening, totalProduced, totalDelivered, adjustments: skuAdjustments, currentStock };
    });
  }, [smSkus, localProductionRecords, toDelivered, openingStocks, adjustments]);

  const setOpeningStock = useCallback(async (skuId: string, qty: number) => {
    const { error } = await supabase.from('stock_opening_balances').upsert(
      { sku_id: skuId, quantity: qty },
      { onConflict: 'sku_id' }
    );
    if (error) { toast.error('Failed to set opening stock: ' + error.message); return; }
    setOpeningStocksState(prev => ({ ...prev, [skuId]: qty }));
  }, []);

  const addAdjustment = useCallback(async (adj: Omit<StockAdjustment, 'id'>) => {
    const { data: row, error } = await supabase.from('stock_adjustments').insert({
      sku_id: adj.skuId, adjustment_date: adj.date, quantity: adj.quantity, reason: adj.reason, stock_type: 'SM',
    }).select().single();
    if (error) { toast.error('Failed to add adjustment: ' + error.message); return; }
    setAdjustments(prev => [{ id: row.id, skuId: row.sku_id, date: row.adjustment_date, quantity: row.quantity, reason: row.reason }, ...prev]);
  }, []);

  const getBomCostPerGram = useCallback((skuId: string): number => {
    const bomHeader = bomHeaders.find(h => h.smSkuId === skuId);
    if (!bomHeader) return 0;

    let totalCost = 0;
    let mainOutput = 0;

    if (bomHeader.bomMode === 'multistep') {
      const steps = bomSteps.filter(s => s.bomHeaderId === bomHeader.id).sort((a, b) => a.stepNumber - b.stepNumber);
      const allLines = bomLines.filter(l => l.bomHeaderId === bomHeader.id);
      if (steps.length === 0) return 0;

      let prevOutput = 0;
      steps.forEach((step, idx) => {
        const sLines = allLines.filter(l => l.stepId === step.id);
        const inputQty = idx === 0 ? sLines.reduce((s, l) => s + l.qtyPerBatch, 0) : prevOutput;
        const addedQty = idx === 0 ? 0 : sLines.reduce((s, l) => {
          if (l.qtyType === 'percent' && l.percentOfInput) return s + l.percentOfInput * inputQty;
          return s + l.qtyPerBatch;
        }, 0);
        const effectiveInput = idx === 0 ? inputQty : inputQty + addedQty;
        prevOutput = effectiveInput * step.yieldPercent;

        totalCost += sLines.reduce((s, l) => {
          let qty = l.qtyPerBatch;
          if (l.qtyType === 'percent' && l.percentOfInput) qty = l.percentOfInput * inputQty;
          const ap = prices.find(p => p.skuId === l.rmSkuId && p.isActive);
          return s + qty * (ap?.pricePerUsageUom ?? 0);
        }, 0);
      });
      mainOutput = prevOutput;
    } else {
      const bLines = bomLines.filter(l => l.bomHeaderId === bomHeader.id);
      totalCost = bLines.reduce((s, line) => {
        const ap = prices.find(p => p.skuId === line.rmSkuId && p.isActive);
        return s + line.qtyPerBatch * (ap?.pricePerUsageUom ?? 0);
      }, 0);
      mainOutput = bomHeader.batchSize * bomHeader.yieldPercent;
    }

    const headerByproducts = bomByproducts.filter(bp => bp.bomHeaderId === bomHeader.id);
    const totalByproductPct = headerByproducts.reduce((s, bp) => s + bp.costAllocationPct, 0);
    const mainPct = Math.max(0, 100 - totalByproductPct);
    const allocatedCost = totalCost * (mainPct / 100);

    return mainOutput > 0 ? allocatedCost / mainOutput : 0;
  }, [bomHeaders, bomLines, bomSteps, prices, bomByproducts]);

  const getLastProductionDate = useCallback((skuId: string): string | null => {
    const recs = localProductionRecords.filter(r => r.smSkuId === skuId);
    if (recs.length === 0) return null;
    return recs.reduce((latest, r) => r.productionDate > latest ? r.productionDate : latest, recs[0].productionDate);
  }, [localProductionRecords]);

  // Re-fetch production records from DB for immediate stock update
  const refreshProductionRecords = useCallback(async () => {
    const [prodRes, adjRes] = await Promise.all([
      supabase.from('production_records').select('*').order('created_at', { ascending: false }),
      supabase.from('stock_adjustments').select('*').eq('stock_type', 'SM').order('created_at', { ascending: false }),
    ]);
    if (prodRes.data) {
      setLocalProductionRecords(prodRes.data.map((r: any) => ({
        id: r.id, planId: r.plan_id, productionDate: r.production_date,
        smSkuId: r.sm_sku_id, batchesProduced: r.batches_produced, actualOutputG: r.actual_output_g,
      })));
    }
    if (adjRes.data) {
      setAdjustments(adjRes.data.map((r: any) => ({
        id: r.id, skuId: r.sku_id, date: r.adjustment_date, quantity: r.quantity, reason: r.reason,
      })));
    }
  }, []);

  // Refresh TO delivered data (call after sending a TO)
  const refreshToDelivered = useCallback(async () => {
    const [toLineRes, toRes] = await Promise.all([
      supabase.from('transfer_order_lines').select('sku_id, planned_qty, actual_qty, to_id'),
      supabase.from('transfer_orders').select('id, status').in('status', ['Sent', 'Received']),
    ]);
    const validToIds = new Set((toRes.data || []).map((t: any) => t.id));
    const toStatusMap: Record<string, string> = {};
    for (const t of toRes.data || []) toStatusMap[t.id] = t.status;
    const delivered: Record<string, number> = {};
    for (const line of toLineRes.data || []) {
      if (!validToIds.has(line.to_id)) continue;
      const qty = (line.actual_qty > 0) ? line.actual_qty
        : (toStatusMap[line.to_id] === 'Sent' ? line.planned_qty : 0);
      delivered[line.sku_id] = (delivered[line.sku_id] || 0) + qty;
    }
    setToDelivered(delivered);
  }, []);

  return { stockBalances, setOpeningStock, addAdjustment, getBomCostPerGram, getLastProductionDate, openingStocks, isStockDataReady, refreshToDelivered, refreshProductionRecords };
}
