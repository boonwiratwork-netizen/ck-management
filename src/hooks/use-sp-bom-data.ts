import { useState, useCallback, useEffect } from 'react';
import { SpBomLine } from '@/types/sp-bom';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const toLocal = (row: any): SpBomLine => ({
  id: row.id,
  spSkuId: row.sp_sku_id,
  ingredientSkuId: row.ingredient_sku_id,
  qtyPerBatch: Number(row.qty_per_batch),
  uom: row.uom,
  batchYieldQty: Number(row.batch_yield_qty),
  batchYieldUom: row.batch_yield_uom,
  costPerUnit: Number(row.cost_per_unit),
});

export function useSpBomData() {
  const [lines, setLines] = useState<SpBomLine[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from('sp_bom').select('*').order('created_at')
      .then(({ data, error }) => {
        if (error) toast.error('Failed to load SP BOM');
        else setLines((data || []).map(toLocal));
        setLoading(false);
      });
  }, []);

  const getLinesForSp = useCallback((spSkuId: string) => {
    return lines.filter(l => l.spSkuId === spSkuId);
  }, [lines]);

  const addLine = useCallback(async (data: Omit<SpBomLine, 'id'>) => {
    const { data: row, error } = await supabase.from('sp_bom').insert({
      sp_sku_id: data.spSkuId,
      ingredient_sku_id: data.ingredientSkuId,
      qty_per_batch: data.qtyPerBatch,
      uom: data.uom,
      batch_yield_qty: data.batchYieldQty,
      batch_yield_uom: data.batchYieldUom,
      cost_per_unit: data.costPerUnit,
    }).select().single();
    if (error) { toast.error('Failed to add ingredient: ' + error.message); return; }
    setLines(prev => [...prev, toLocal(row)]);
  }, []);

  const updateLine = useCallback(async (id: string, data: Partial<Omit<SpBomLine, 'id'>>) => {
    const dbData: any = {};
    if (data.ingredientSkuId !== undefined) dbData.ingredient_sku_id = data.ingredientSkuId;
    if (data.qtyPerBatch !== undefined) dbData.qty_per_batch = data.qtyPerBatch;
    if (data.uom !== undefined) dbData.uom = data.uom;
    if (data.batchYieldQty !== undefined) dbData.batch_yield_qty = data.batchYieldQty;
    if (data.batchYieldUom !== undefined) dbData.batch_yield_uom = data.batchYieldUom;
    if (data.costPerUnit !== undefined) dbData.cost_per_unit = data.costPerUnit;

    const { error } = await supabase.from('sp_bom').update(dbData).eq('id', id);
    if (error) { toast.error('Failed to update ingredient: ' + error.message); return; }
    setLines(prev => prev.map(l => l.id === id ? { ...l, ...data } : l));
  }, []);

  const updateBatchYield = useCallback(async (spSkuId: string, batchYieldQty: number, batchYieldUom: string) => {
    const spLines = lines.filter(l => l.spSkuId === spSkuId);
    if (spLines.length === 0) return;
    
    const { error } = await supabase.from('sp_bom')
      .update({ batch_yield_qty: batchYieldQty, batch_yield_uom: batchYieldUom })
      .eq('sp_sku_id', spSkuId);
    if (error) { toast.error('Failed to update batch yield: ' + error.message); return; }
    
    setLines(prev => prev.map(l => 
      l.spSkuId === spSkuId ? { ...l, batchYieldQty, batchYieldUom } : l
    ));
  }, [lines]);

  const deleteLine = useCallback(async (id: string) => {
    const { error } = await supabase.from('sp_bom').delete().eq('id', id);
    if (error) { toast.error('Failed to delete ingredient: ' + error.message); return; }
    setLines(prev => prev.filter(l => l.id !== id));
  }, []);

  return { lines, loading, getLinesForSp, addLine, updateLine, updateBatchYield, deleteLine };
}
