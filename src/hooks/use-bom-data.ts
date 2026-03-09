import { useState, useCallback, useEffect } from 'react';
import { BOMHeader, BOMLine, BOMStep } from '@/types/bom';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const toHeader = (r: any): BOMHeader => ({
  id: r.id, smSkuId: r.sm_sku_id, productionType: r.production_type,
  bomMode: r.bom_mode, batchSize: r.batch_size, yieldPercent: r.yield_percent,
});
const toLine = (r: any): BOMLine => ({
  id: r.id, bomHeaderId: r.bom_header_id, rmSkuId: r.rm_sku_id,
  qtyPerBatch: r.qty_per_batch, stepId: r.step_id ?? undefined,
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

  useEffect(() => {
    Promise.all([
      supabase.from('bom_headers').select('*').order('created_at', { ascending: false }),
      supabase.from('bom_lines').select('*').order('created_at', { ascending: false }),
      supabase.from('bom_steps').select('*').order('step_number', { ascending: true }),
    ]).then(([h, l, s]) => {
      if (!h.error) setHeaders((h.data || []).map(toHeader));
      if (!l.error) setLines((l.data || []).map(toLine));
      if (!s.error) setSteps((s.data || []).map(toStep));
    });
  }, []);

  const addHeader = useCallback(async (data: Omit<BOMHeader, 'id'>): Promise<string> => {
    const { data: row, error } = await supabase.from('bom_headers').insert({
      sm_sku_id: data.smSkuId, production_type: data.productionType,
      bom_mode: data.bomMode, batch_size: data.batchSize, yield_percent: data.yieldPercent,
    }).select().single();
    if (error) { toast.error('Failed to add BOM: ' + error.message); return ''; }
    setHeaders(prev => [toHeader(row), ...prev]);
    return row.id;
  }, []);

  const updateHeader = useCallback(async (id: string, data: Partial<Omit<BOMHeader, 'id'>>) => {
    const d: any = {};
    if (data.smSkuId !== undefined) d.sm_sku_id = data.smSkuId;
    if (data.productionType !== undefined) d.production_type = data.productionType;
    if (data.bomMode !== undefined) d.bom_mode = data.bomMode;
    if (data.batchSize !== undefined) d.batch_size = data.batchSize;
    if (data.yieldPercent !== undefined) d.yield_percent = data.yieldPercent;
    const { error } = await supabase.from('bom_headers').update(d).eq('id', id);
    if (error) { toast.error('Failed to update BOM: ' + error.message); return; }
    setHeaders(prev => prev.map(h => h.id === id ? { ...h, ...data } : h));
  }, []);

  const deleteHeader = useCallback(async (id: string) => {
    // Delete lines and steps first (cascade should handle but be safe)
    await supabase.from('bom_lines').delete().eq('bom_header_id', id);
    await supabase.from('bom_steps').delete().eq('bom_header_id', id);
    const { error } = await supabase.from('bom_headers').delete().eq('id', id);
    if (error) { toast.error('Failed to delete BOM: ' + error.message); return; }
    setHeaders(prev => prev.filter(h => h.id !== id));
    setLines(prev => prev.filter(l => l.bomHeaderId !== id));
    setSteps(prev => prev.filter(s => s.bomHeaderId !== id));
  }, []);

  const addLine = useCallback(async (data: Omit<BOMLine, 'id'>) => {
    const { data: row, error } = await supabase.from('bom_lines').insert({
      bom_header_id: data.bomHeaderId, rm_sku_id: data.rmSkuId,
      qty_per_batch: data.qtyPerBatch, step_id: data.stepId ?? null,
      qty_type: data.qtyType ?? null, percent_of_input: data.percentOfInput ?? null,
    }).select().single();
    if (error) { toast.error('Failed to add BOM line: ' + error.message); return; }
    setLines(prev => [...prev, toLine(row)]);
  }, []);

  const updateLine = useCallback(async (id: string, data: Partial<Omit<BOMLine, 'id' | 'bomHeaderId'>>) => {
    const d: any = {};
    if (data.rmSkuId !== undefined) d.rm_sku_id = data.rmSkuId;
    if (data.qtyPerBatch !== undefined) d.qty_per_batch = data.qtyPerBatch;
    if (data.stepId !== undefined) d.step_id = data.stepId;
    if (data.qtyType !== undefined) d.qty_type = data.qtyType;
    if (data.percentOfInput !== undefined) d.percent_of_input = data.percentOfInput;
    const { error } = await supabase.from('bom_lines').update(d).eq('id', id);
    if (error) { toast.error('Failed to update BOM line: ' + error.message); return; }
    setLines(prev => prev.map(l => l.id === id ? { ...l, ...data } : l));
  }, []);

  const deleteLine = useCallback(async (id: string) => {
    const { error } = await supabase.from('bom_lines').delete().eq('id', id);
    if (error) { toast.error('Failed to delete BOM line: ' + error.message); return; }
    setLines(prev => prev.filter(l => l.id !== id));
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

  const updateStep = useCallback(async (id: string, data: Partial<Omit<BOMStep, 'id' | 'bomHeaderId'>>) => {
    const d: any = {};
    if (data.stepNumber !== undefined) d.step_number = data.stepNumber;
    if (data.stepName !== undefined) d.step_name = data.stepName;
    if (data.yieldPercent !== undefined) d.yield_percent = data.yieldPercent;
    const { error } = await supabase.from('bom_steps').update(d).eq('id', id);
    if (error) { toast.error('Failed to update step: ' + error.message); return; }
    setSteps(prev => prev.map(s => s.id === id ? { ...s, ...data } : s));
  }, []);

  const deleteStep = useCallback(async (id: string) => {
    await supabase.from('bom_lines').delete().eq('step_id', id);
    const { error } = await supabase.from('bom_steps').delete().eq('id', id);
    if (error) { toast.error('Failed to delete step: ' + error.message); return; }
    setSteps(prev => prev.filter(s => s.id !== id));
    setLines(prev => prev.filter(l => l.stepId !== id));
  }, []);

  const getStepsForHeader = useCallback((headerId: string) => {
    return steps.filter(s => s.bomHeaderId === headerId).sort((a, b) => a.stepNumber - b.stepNumber);
  }, [steps]);

  const getLinesForStep = useCallback((stepId: string) => {
    return lines.filter(l => l.stepId === stepId);
  }, [lines]);

  return {
    headers, lines, steps,
    addHeader, updateHeader, deleteHeader,
    addLine, updateLine, deleteLine, getLinesForHeader,
    addStep, updateStep, deleteStep, getStepsForHeader, getLinesForStep,
  };
}
