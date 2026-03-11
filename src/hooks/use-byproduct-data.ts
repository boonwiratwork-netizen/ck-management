import { useState, useCallback, useEffect } from 'react';
import { BomByproduct } from '@/types/byproduct';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const toByproduct = (r: any): BomByproduct => ({
  id: r.id,
  bomHeaderId: r.bom_header_id,
  skuId: r.sku_id ?? null,
  name: r.name ?? '',
  outputQty: r.output_qty ?? 0,
  costAllocationPct: r.cost_allocation_pct ?? 0,
  tracksInventory: r.tracks_inventory ?? false,
});

export function useByproductData() {
  const [byproducts, setByproducts] = useState<BomByproduct[]>([]);

  useEffect(() => {
    supabase.from('bom_byproducts' as any).select('*').order('created_at', { ascending: true })
      .then(({ data, error }: any) => {
        if (!error && data) setByproducts(data.map(toByproduct));
      });
  }, []);

  const getByproductsForHeader = useCallback((headerId: string) => {
    return byproducts.filter(b => b.bomHeaderId === headerId);
  }, [byproducts]);

  const addByproduct = useCallback(async (data: Omit<BomByproduct, 'id'>) => {
    const { data: row, error } = await supabase.from('bom_byproducts' as any).insert({
      bom_header_id: data.bomHeaderId,
      sku_id: data.skuId,
      name: data.name,
      output_qty: data.outputQty,
      cost_allocation_pct: data.costAllocationPct,
      tracks_inventory: data.tracksInventory,
    } as any).select().single();
    if (error) { toast.error('Failed to add by-product: ' + error.message); return; }
    setByproducts(prev => [...prev, toByproduct(row)]);
  }, []);

  const updateByproduct = useCallback(async (id: string, data: Partial<Omit<BomByproduct, 'id' | 'bomHeaderId'>>) => {
    const d: any = {};
    if (data.skuId !== undefined) d.sku_id = data.skuId;
    if (data.name !== undefined) d.name = data.name;
    if (data.outputQty !== undefined) d.output_qty = data.outputQty;
    if (data.costAllocationPct !== undefined) d.cost_allocation_pct = data.costAllocationPct;
    if (data.tracksInventory !== undefined) d.tracks_inventory = data.tracksInventory;
    d.updated_at = new Date().toISOString();
    const { error } = await supabase.from('bom_byproducts' as any).update(d).eq('id', id);
    if (error) { toast.error('Failed to update by-product: ' + error.message); return; }
    setByproducts(prev => prev.map(b => b.id === id ? { ...b, ...data } : b));
  }, []);

  const deleteByproduct = useCallback(async (id: string) => {
    const { error } = await supabase.from('bom_byproducts' as any).delete().eq('id', id);
    if (error) { toast.error('Failed to delete by-product: ' + error.message); return; }
    setByproducts(prev => prev.filter(b => b.id !== id));
  }, []);

  // Bulk update allocation percentages for a header
  const bulkUpdateAllocations = useCallback(async (updates: { id: string; costAllocationPct: number }[]) => {
    for (const u of updates) {
      await supabase.from('bom_byproducts' as any).update({ cost_allocation_pct: u.costAllocationPct, updated_at: new Date().toISOString() } as any).eq('id', u.id);
    }
    setByproducts(prev => prev.map(b => {
      const upd = updates.find(u => u.id === b.id);
      return upd ? { ...b, costAllocationPct: upd.costAllocationPct } : b;
    }));
  }, []);

  return {
    byproducts,
    getByproductsForHeader,
    addByproduct,
    updateByproduct,
    deleteByproduct,
    bulkUpdateAllocations,
  };
}
