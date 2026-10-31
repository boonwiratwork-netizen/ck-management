import { useState, useCallback, useEffect } from 'react';
import { loadWithDeviceCopy } from "@/lib/base-cache";
import { fetchAllRows } from "@/lib/fetch-all";
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

  const reload = useCallback(async () => {
    await loadWithDeviceCopy(
      'sp_bom',
      () => fetchAllRows((a, b) => supabase.from('sp_bom').select('*').order('created_at').order('id').range(a, b)),
      (rows, fromDevice) => {
        setLines(rows.map(toLocal));
        if (fromDevice) setLoading(false);
      },
    ).then(({ error }) => {
      if (error) toast.error('Failed to load SP BOM');
      setLoading(false);
    });
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const getLinesForSp = useCallback((spSkuId: string) => {
    return lines.filter(l => l.spSkuId === spSkuId);
  }, [lines]);

  const addLine = useCallback(async (data: Omit<SpBomLine, 'id'>): Promise<boolean> => {
    const { data: row, error } = await supabase.from('sp_bom').insert({
      sp_sku_id: data.spSkuId,
      ingredient_sku_id: data.ingredientSkuId,
      qty_per_batch: data.qtyPerBatch,
      uom: data.uom,
      batch_yield_qty: data.batchYieldQty,
      batch_yield_uom: data.batchYieldUom,
      cost_per_unit: data.costPerUnit,
    }).select().single();
    if (error) { toast.error('Failed to add ingredient: ' + error.message); return false; }
    setLines(prev => [...prev, toLocal(row)]);
    return true;
  }, []);

  const updateLine = useCallback(async (id: string, data: Partial<Omit<SpBomLine, 'id'>>): Promise<boolean> => {
    const dbData: any = {};
    if (data.ingredientSkuId !== undefined) dbData.ingredient_sku_id = data.ingredientSkuId;
    if (data.qtyPerBatch !== undefined) dbData.qty_per_batch = data.qtyPerBatch;
    if (data.uom !== undefined) dbData.uom = data.uom;
    if (data.batchYieldQty !== undefined) dbData.batch_yield_qty = data.batchYieldQty;
    if (data.batchYieldUom !== undefined) dbData.batch_yield_uom = data.batchYieldUom;
    if (data.costPerUnit !== undefined) dbData.cost_per_unit = data.costPerUnit;

    const { error } = await supabase.from('sp_bom').update(dbData).eq('id', id);
    if (error) { toast.error('Failed to update ingredient: ' + error.message); return false; }
    setLines(prev => prev.map(l => l.id === id ? { ...l, ...data } : l));
    return true;
  }, []);

  const updateBatchYield = useCallback(async (spSkuId: string, batchYieldQty: number, batchYieldUom: string): Promise<boolean> => {
    const spLines = lines.filter(l => l.spSkuId === spSkuId);
    if (spLines.length === 0) return false;
    
    const { error } = await supabase.from('sp_bom')
      .update({ batch_yield_qty: batchYieldQty, batch_yield_uom: batchYieldUom })
      .eq('sp_sku_id', spSkuId);
    if (error) { toast.error('Failed to update batch yield: ' + error.message); return false; }
    
    setLines(prev => prev.map(l => 
      l.spSkuId === spSkuId ? { ...l, batchYieldQty, batchYieldUom } : l
    ));
    return true;
  }, [lines]);

  const deleteLine = useCallback(async (id: string): Promise<boolean> => {
    const { error } = await supabase.from('sp_bom').delete().eq('id', id);
    if (error) { toast.error('Failed to delete ingredient: ' + error.message); return false; }
    setLines(prev => prev.filter(l => l.id !== id));
    return true;
  }, []);

  // An SP's whole recipe swapped for new lines (import), same order as menu
  // recipes: all new lines in one insert, the old ones out only after that
  const replaceLines = useCallback(async (spSkuId: string, next: Omit<SpBomLine, 'id'>[]) => {
    const { data: rows, error } = await supabase.from('sp_bom').insert(next.map((l) => ({
      sp_sku_id: l.spSkuId,
      ingredient_sku_id: l.ingredientSkuId,
      qty_per_batch: l.qtyPerBatch,
      uom: l.uom,
      batch_yield_qty: l.batchYieldQty,
      batch_yield_uom: l.batchYieldUom,
      cost_per_unit: l.costPerUnit,
    }))).select();
    if (error || !rows) { toast.error('บันทึกสูตร SP ไม่สำเร็จ: ' + (error?.message ?? '')); return false; }
    const added = rows.map((r) => r.id as string);
    const del = await supabase.from('sp_bom').delete().eq('sp_sku_id', spSkuId).not('id', 'in', `(${added.join(',')})`);
    if (del.error) {
      const undo = await supabase.from('sp_bom').delete().in('id', added);
      toast.error(undo.error ? `สูตร SP มีทั้งของเก่าและของใหม่ · เปิด SP นี้ใน Cost Center แล้วลบบรรทัดที่ซ้ำ (${del.error.message})` : 'บันทึกสูตร SP ไม่สำเร็จ สูตรเดิมยังอยู่: ' + del.error.message);
      if (undo.error) setLines(prev => [...prev, ...rows.map(toLocal)]);
      return false;
    }
    setLines(prev => [...prev.filter(l => l.spSkuId !== spSkuId), ...rows.map(toLocal)]);
    return true;
  }, []);

  return { lines, loading, getLinesForSp, addLine, updateLine, updateBatchYield, deleteLine, reload, replaceLines };
}
