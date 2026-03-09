import { useState, useCallback, useEffect } from 'react';
import { ProductionPlan, ProductionRecord, PlanStatus, getWeekStart, getWeekEnd, getISOWeekNumber } from '@/types/production';
import { BOMHeader, BOMLine } from '@/types/bom';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const toPlan = (r: any): ProductionPlan => ({
  id: r.id, weekNumber: r.week_number, weekStartDate: r.week_start_date,
  weekEndDate: r.week_end_date, smSkuId: r.sm_sku_id, targetQtyKg: r.target_qty_kg,
  numBatches: r.num_batches, status: r.status,
});
const toRecord = (r: any): ProductionRecord => ({
  id: r.id, planId: r.plan_id, productionDate: r.production_date,
  smSkuId: r.sm_sku_id, batchesProduced: r.batches_produced, actualOutputKg: r.actual_output_kg,
});

interface StockDeduction {
  skuId: string;
  quantity: number;
  reason: string;
}

export function useProductionData(
  bomHeaders: BOMHeader[],
  bomLines: BOMLine[],
  addStockAdjustment: (adj: { skuId: string; date: string; quantity: number; reason: string }) => void
) {
  const [plans, setPlans] = useState<ProductionPlan[]>([]);
  const [records, setRecords] = useState<ProductionRecord[]>([]);

  useEffect(() => {
    Promise.all([
      supabase.from('production_plans').select('*').order('created_at', { ascending: false }),
      supabase.from('production_records').select('*').order('created_at', { ascending: false }),
    ]).then(([p, r]) => {
      if (!p.error) setPlans((p.data || []).map(toPlan));
      if (!r.error) setRecords((r.data || []).map(toRecord));
    });
  }, []);

  const getOutputPerBatch = useCallback((smSkuId: string): number => {
    const header = bomHeaders.find(h => h.smSkuId === smSkuId);
    if (!header) return 0;
    return header.batchSize * header.yieldPercent;
  }, [bomHeaders]);

  const addPlan = useCallback(async (data: { smSkuId: string; targetQtyKg: number; status: PlanStatus; weekDate: string }): Promise<string> => {
    const weekStart = getWeekStart(data.weekDate);
    const weekEnd = getWeekEnd(weekStart);
    const weekNumber = getISOWeekNumber(data.weekDate);
    const outputPerBatch = getOutputPerBatch(data.smSkuId);
    const numBatches = outputPerBatch > 0 ? Math.ceil((data.targetQtyKg * 1000) / outputPerBatch) : 0;

    const { data: row, error } = await supabase.from('production_plans').insert({
      week_number: weekNumber, week_start_date: weekStart, week_end_date: weekEnd,
      sm_sku_id: data.smSkuId, target_qty_kg: data.targetQtyKg, num_batches: numBatches, status: data.status,
    }).select().single();
    if (error) { toast.error('Failed to add plan: ' + error.message); return ''; }
    setPlans(prev => [toPlan(row), ...prev]);
    return row.id;
  }, [getOutputPerBatch]);

  const updatePlan = useCallback(async (id: string, data: Partial<{ smSkuId: string; targetQtyKg: number; status: PlanStatus; weekDate: string }>) => {
    const plan = plans.find(p => p.id === id);
    if (!plan) return;
    const updated = { ...plan };
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

    const { error } = await supabase.from('production_plans').update({
      week_number: updated.weekNumber, week_start_date: updated.weekStartDate,
      week_end_date: updated.weekEndDate, sm_sku_id: updated.smSkuId,
      target_qty_kg: updated.targetQtyKg, num_batches: updated.numBatches, status: updated.status,
    }).eq('id', id);
    if (error) { toast.error('Failed to update plan: ' + error.message); return; }
    setPlans(prev => prev.map(p => p.id === id ? updated : p));
  }, [plans, getOutputPerBatch]);

  const deletePlan = useCallback(async (id: string) => {
    await supabase.from('production_records').delete().eq('plan_id', id);
    const { error } = await supabase.from('production_plans').delete().eq('id', id);
    if (error) { toast.error('Failed to delete plan: ' + error.message); return; }
    setPlans(prev => prev.filter(p => p.id !== id));
    setRecords(prev => prev.filter(r => r.planId !== id));
  }, []);

  const addRecord = useCallback(async (data: Omit<ProductionRecord, 'id' | 'smSkuId'> & { smSkuId?: string }): Promise<string | undefined> => {
    const plan = plans.find(p => p.id === data.planId);
    if (!plan) return;

    const { data: row, error } = await supabase.from('production_records').insert({
      plan_id: data.planId, production_date: data.productionDate,
      sm_sku_id: plan.smSkuId, batches_produced: data.batchesProduced, actual_output_kg: data.actualOutputKg,
    }).select().single();
    if (error) { toast.error('Failed to add record: ' + error.message); return; }
    setRecords(prev => [toRecord(row), ...prev]);

    // Auto-deduct RM stock
    const bomHeader = bomHeaders.find(h => h.smSkuId === plan.smSkuId);
    if (bomHeader) {
      const bLines = bomLines.filter(l => l.bomHeaderId === bomHeader.id);
      bLines.forEach(line => {
        addStockAdjustment({
          skuId: line.rmSkuId, date: data.productionDate,
          quantity: -(line.qtyPerBatch * data.batchesProduced),
          reason: `Production: ${data.batchesProduced} batches of ${plan.smSkuId}`,
        });
      });
    }
    return row.id;
  }, [plans, bomHeaders, bomLines, addStockAdjustment]);

  const deleteRecord = useCallback(async (id: string) => {
    const { error } = await supabase.from('production_records').delete().eq('id', id);
    if (error) { toast.error('Failed to delete record: ' + error.message); return; }
    setRecords(prev => prev.filter(r => r.id !== id));
  }, []);

  const getRecordsForPlan = useCallback((planId: string) => records.filter(r => r.planId === planId), [records]);
  const getTotalProducedForPlan = useCallback((planId: string) => records.filter(r => r.planId === planId).reduce((s, r) => s + r.actualOutputKg, 0), [records]);

  return { plans, records, addPlan, updatePlan, deletePlan, addRecord, deleteRecord, getRecordsForPlan, getTotalProducedForPlan, getOutputPerBatch };
}
