import { useState, useCallback } from 'react';
import { ProductionPlan, ProductionRecord, PlanStatus, getWeekStart, getWeekEnd, getISOWeekNumber } from '@/types/production';
import { BOMHeader, BOMLine } from '@/types/bom';

interface StockDeduction {
  skuId: string;
  quantity: number; // negative = deduct
  reason: string;
}

export function useProductionData(
  bomHeaders: BOMHeader[],
  bomLines: BOMLine[],
  addStockAdjustment: (adj: { skuId: string; date: string; quantity: number; reason: string }) => void
) {
  const [plans, setPlans] = useState<ProductionPlan[]>([]);
  const [records, setRecords] = useState<ProductionRecord[]>([]);

  const getOutputPerBatch = useCallback((smSkuId: string): number => {
    const header = bomHeaders.find(h => h.smSkuId === smSkuId);
    if (!header) return 0;
    return header.batchSize * header.yieldPercent; // in grams
  }, [bomHeaders]);

  const addPlan = useCallback((data: { smSkuId: string; targetQtyKg: number; status: PlanStatus; weekDate: string }) => {
    const weekStart = getWeekStart(data.weekDate);
    const weekEnd = getWeekEnd(weekStart);
    const weekNumber = getISOWeekNumber(data.weekDate);
    const outputPerBatch = getOutputPerBatch(data.smSkuId);
    const numBatches = outputPerBatch > 0 ? Math.ceil((data.targetQtyKg * 1000) / outputPerBatch) : 0;

    const plan: ProductionPlan = {
      id: crypto.randomUUID(),
      weekNumber,
      weekStartDate: weekStart,
      weekEndDate: weekEnd,
      smSkuId: data.smSkuId,
      targetQtyKg: data.targetQtyKg,
      numBatches,
      status: data.status,
    };
    setPlans(prev => [...prev, plan]);
    return plan.id;
  }, [getOutputPerBatch]);

  const updatePlan = useCallback((id: string, data: Partial<{ smSkuId: string; targetQtyKg: number; status: PlanStatus; weekDate: string }>) => {
    setPlans(prev => prev.map(p => {
      if (p.id !== id) return p;
      const updated = { ...p };
      if (data.weekDate) {
        updated.weekStartDate = getWeekStart(data.weekDate);
        updated.weekEndDate = getWeekEnd(updated.weekStartDate);
        updated.weekNumber = getISOWeekNumber(data.weekDate);
      }
      if (data.smSkuId !== undefined) updated.smSkuId = data.smSkuId;
      if (data.targetQtyKg !== undefined) updated.targetQtyKg = data.targetQtyKg;
      if (data.status !== undefined) updated.status = data.status;

      const outputPerBatch = getOutputPerBatch(updated.smSkuId);
      updated.numBatches = outputPerBatch > 0 ? Math.ceil((updated.targetQtyKg * 1000) / outputPerBatch) : 0;
      return updated;
    }));
  }, [getOutputPerBatch]);

  const deletePlan = useCallback((id: string) => {
    setPlans(prev => prev.filter(p => p.id !== id));
    setRecords(prev => prev.filter(r => r.planId !== id));
  }, []);

  const addRecord = useCallback((data: Omit<ProductionRecord, 'id' | 'smSkuId'> & { smSkuId?: string }) => {
    const plan = plans.find(p => p.id === data.planId);
    if (!plan) return;

    const record: ProductionRecord = {
      id: crypto.randomUUID(),
      planId: data.planId,
      productionDate: data.productionDate,
      smSkuId: plan.smSkuId,
      batchesProduced: data.batchesProduced,
      actualOutputKg: data.actualOutputKg,
    };
    setRecords(prev => [...prev, record]);

    // Auto-deduct RM stock based on BOM × batches produced
    const bomHeader = bomHeaders.find(h => h.smSkuId === plan.smSkuId);
    if (bomHeader) {
      const lines = bomLines.filter(l => l.bomHeaderId === bomHeader.id);
      lines.forEach(line => {
        const deductQty = line.qtyPerBatch * data.batchesProduced;
        addStockAdjustment({
          skuId: line.rmSkuId,
          date: data.productionDate,
          quantity: -deductQty,
          reason: `Production: ${data.batchesProduced} batches of ${plan.smSkuId}`,
        });
      });
    }

    return record.id;
  }, [plans, bomHeaders, bomLines, addStockAdjustment]);

  const deleteRecord = useCallback((id: string) => {
    setRecords(prev => prev.filter(r => r.id !== id));
  }, []);

  const getRecordsForPlan = useCallback((planId: string) => {
    return records.filter(r => r.planId === planId);
  }, [records]);

  const getTotalProducedForPlan = useCallback((planId: string) => {
    return records.filter(r => r.planId === planId).reduce((s, r) => s + r.actualOutputKg, 0);
  }, [records]);

  return {
    plans,
    records,
    addPlan,
    updatePlan,
    deletePlan,
    addRecord,
    deleteRecord,
    getRecordsForPlan,
    getTotalProducedForPlan,
    getOutputPerBatch,
  };
}
