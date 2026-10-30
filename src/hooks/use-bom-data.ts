import { useState, useCallback, useEffect } from 'react';
import { loadWithDeviceCopy } from "@/lib/base-cache";
import { fetchAllRows } from "@/lib/fetch-all";
import { BOMHeader, BOMLine, BOMStep } from '@/types/bom';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const toHeader = (r: any): BOMHeader => ({
  id: r.id, smSkuId: r.sm_sku_id, productionType: r.production_type,
  bomMode: r.bom_mode, batchSize: r.batch_size, yieldPercent: r.yield_percent,
});
const toLine = (r: any): BOMLine => ({
  id: r.id, bomHeaderId: r.bom_header_id, rmSkuId: r.rm_sku_id,
  qtyPerBatch: r.qty_per_batch, yieldPercent: r.yield_percent ?? 1.0,
  stepId: r.step_id ?? undefined,
  qtyType: r.qty_type ?? undefined, percentOfInput: r.percent_of_input ?? undefined,
});
const toStep = (r: any): BOMStep => ({
  id: r.id, bomHeaderId: r.bom_header_id, stepNumber: r.step_number,
  stepName: r.step_name, yieldPercent: r.yield_percent,
});

export function useBomData() {
  const [headers, setHeaders] = useState<BOMHeader[]>([]);
  const [lines, setLines] = useState<BOMLine[]>([]);
  const [steps, setSteps] = useState<BOMStep[]>([]);

  const reload = useCallback(async () => {
    // Device copies first, fresh in the background (see base-cache)
    await Promise.all([loadWithDeviceCopy('bom_headers', () => fetchAllRows((a, b) => supabase.from('bom_headers').select('*').order('created_at', { ascending: false }).order('id').range(a, b)), (rows) => setHeaders(rows.map(toHeader))),
    loadWithDeviceCopy('bom_lines', () => fetchAllRows((a, b) => supabase.from('bom_lines').select('*').order('created_at', { ascending: false }).order('id').range(a, b)), (rows) => setLines(rows.map(toLine))),
    loadWithDeviceCopy('bom_steps', () => fetchAllRows((a, b) => supabase.from('bom_steps').select('*').order('step_number', { ascending: true }).order('id').range(a, b)), (rows) => setSteps(rows.map(toStep)))]);
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const addHeader = useCallback(async (data: Omit<BOMHeader, 'id'>): Promise<string> => {
    const { data: row, error } = await supabase.from('bom_headers').insert({
      sm_sku_id: data.smSkuId, production_type: data.productionType,
      bom_mode: data.bomMode, batch_size: data.batchSize, yield_percent: data.yieldPercent,
    }).select().single();
    if (error) { toast.error('Failed to add BOM: ' + error.message); return ''; }
    setHeaders(prev => [toHeader(row), ...prev]);
    return row.id;
  }, []);

  const updateHeader = useCallback(async (id: string, data: Partial<Omit<BOMHeader, 'id'>>): Promise<boolean> => {
    const d: any = {};
    if (data.smSkuId !== undefined) d.sm_sku_id = data.smSkuId;
    if (data.productionType !== undefined) d.production_type = data.productionType;
    if (data.bomMode !== undefined) d.bom_mode = data.bomMode;
    if (data.batchSize !== undefined) d.batch_size = data.batchSize;
    if (data.yieldPercent !== undefined) d.yield_percent = data.yieldPercent;
    const { error } = await supabase.from('bom_headers').update(d).eq('id', id);
    if (error) { toast.error('Failed to update BOM: ' + error.message); return false; }
    setHeaders(prev => prev.map(h => h.id === id ? { ...h, ...data } : h));
    return true;
  }, []);

  const deleteHeader = useCallback(async (id: string): Promise<boolean> => {
    // Delete lines and steps first (cascade should handle but be safe)
    await supabase.from('bom_lines').delete().eq('bom_header_id', id);
    await supabase.from('bom_steps').delete().eq('bom_header_id', id);
    const { error } = await supabase.from('bom_headers').delete().eq('id', id);
    if (error) { toast.error('Failed to delete BOM: ' + error.message); return false; }
    setHeaders(prev => prev.filter(h => h.id !== id));
    setLines(prev => prev.filter(l => l.bomHeaderId !== id));
    setSteps(prev => prev.filter(s => s.bomHeaderId !== id));
    return true;
  }, []);

  const addLine = useCallback(async (data: Omit<BOMLine, 'id'>): Promise<boolean> => {
    const { data: row, error } = await supabase.from('bom_lines').insert({
      bom_header_id: data.bomHeaderId, rm_sku_id: data.rmSkuId,
      qty_per_batch: data.qtyPerBatch, yield_percent: data.yieldPercent ?? 1.0,
      step_id: data.stepId ?? null,
      qty_type: data.qtyType ?? null, percent_of_input: data.percentOfInput ?? null,
    }).select().single();
    if (error) { toast.error('Failed to add BOM line: ' + error.message); return false; }
    setLines(prev => [...prev, toLine(row)]);
    return true;
  }, []);

  const updateLine = useCallback(async (id: string, data: Partial<Omit<BOMLine, 'id' | 'bomHeaderId'>>): Promise<boolean> => {
    const d: any = {};
    if (data.rmSkuId !== undefined) d.rm_sku_id = data.rmSkuId;
    if (data.qtyPerBatch !== undefined) d.qty_per_batch = data.qtyPerBatch;
    if (data.yieldPercent !== undefined) d.yield_percent = data.yieldPercent;
    if (data.stepId !== undefined) d.step_id = data.stepId ?? null;
    if (data.qtyType !== undefined) d.qty_type = data.qtyType;
    if (data.percentOfInput !== undefined) d.percent_of_input = data.percentOfInput;
    const { error } = await supabase.from('bom_lines').update(d).eq('id', id);
    if (error) { toast.error('Failed to update BOM line: ' + error.message); return false; }
    setLines(prev => prev.map(l => l.id === id ? { ...l, ...data } : l));
    return true;
  }, []);

  const deleteLine = useCallback(async (id: string): Promise<boolean> => {
    const { error } = await supabase.from('bom_lines').delete().eq('id', id);
    if (error) { toast.error('Failed to delete BOM line: ' + error.message); return false; }
    setLines(prev => prev.filter(l => l.id !== id));
    return true;
  }, []);

  const getLinesForHeader = useCallback((headerId: string) => {
    return lines.filter(l => l.bomHeaderId === headerId);
  }, [lines]);

  const addStep = useCallback(async (data: Omit<BOMStep, 'id'>): Promise<string> => {
    const { data: row, error } = await supabase.from('bom_steps').insert({
      bom_header_id: data.bomHeaderId, step_number: data.stepNumber,
      step_name: data.stepName, yield_percent: data.yieldPercent,
    }).select().single();
    if (error) { toast.error('Failed to add step: ' + error.message); return ''; }
    setSteps(prev => [...prev, toStep(row)]);
    return row.id;
  }, []);

  const updateStep = useCallback(async (id: string, data: Partial<Omit<BOMStep, 'id' | 'bomHeaderId'>>): Promise<boolean> => {
    const d: any = {};
    if (data.stepNumber !== undefined) d.step_number = data.stepNumber;
    if (data.stepName !== undefined) d.step_name = data.stepName;
    if (data.yieldPercent !== undefined) d.yield_percent = data.yieldPercent;
    const { error } = await supabase.from('bom_steps').update(d).eq('id', id);
    if (error) { toast.error('Failed to update step: ' + error.message); return false; }
    setSteps(prev => prev.map(s => s.id === id ? { ...s, ...data } : s));
    return true;
  }, []);

  const deleteStep = useCallback(async (id: string): Promise<boolean> => {
    const { error: lineError } = await supabase.from('bom_lines').delete().eq('step_id', id);
    if (lineError) { toast.error('Failed to delete step: ' + lineError.message); return false; }
    const { error } = await supabase.from('bom_steps').delete().eq('id', id);
    if (error) { toast.error('Failed to delete step: ' + error.message); return false; }
    setSteps(prev => prev.filter(s => s.id !== id));
    setLines(prev => prev.filter(l => l.stepId !== id));
    return true;
  }, []);

  const getStepsForHeader = useCallback((headerId: string) => {
    return steps.filter(s => s.bomHeaderId === headerId).sort((a, b) => a.stepNumber - b.stepNumber);
  }, [steps]);

  const getLinesForStep = useCallback((stepId: string) => {
    return lines.filter(l => l.stepId === stepId);
  }, [lines]);

  return {
    headers, lines, steps, reload,
    addHeader, updateHeader, deleteHeader,
    addLine, updateLine, deleteLine, getLinesForHeader,
    addStep, updateStep, deleteStep, getStepsForHeader, getLinesForStep,
  };
}
