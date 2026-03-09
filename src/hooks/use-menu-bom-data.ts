import { useState, useCallback, useEffect } from 'react';
import { MenuBomLine } from '@/types/menu-bom';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const toLocal = (row: any): MenuBomLine => ({
  id: row.id,
  menuId: row.menu_id,
  skuId: row.sku_id,
  qtyPerServing: Number(row.qty_per_serving),
  uom: row.uom,
  yieldPct: Number(row.yield_pct),
  effectiveQty: Number(row.effective_qty),
  costPerServing: Number(row.cost_per_serving),
});

export function useMenuBomData() {
  const [lines, setLines] = useState<MenuBomLine[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from('menu_bom').select('*').order('created_at')
      .then(({ data, error }) => {
        if (error) toast.error('Failed to load Menu BOM');
        else setLines((data || []).map(toLocal));
        setLoading(false);
      });
  }, []);

  const getLinesForMenu = useCallback((menuId: string) => {
    return lines.filter(l => l.menuId === menuId);
  }, [lines]);

  const addLine = useCallback(async (data: Omit<MenuBomLine, 'id'>) => {
    const { data: row, error } = await supabase.from('menu_bom').insert({
      menu_id: data.menuId,
      sku_id: data.skuId,
      qty_per_serving: data.qtyPerServing,
      uom: data.uom,
      yield_pct: data.yieldPct,
      effective_qty: data.effectiveQty,
      cost_per_serving: data.costPerServing,
    }).select().single();
    if (error) { toast.error('Failed to add ingredient: ' + error.message); return; }
    setLines(prev => [...prev, toLocal(row)]);
  }, []);

  const updateLine = useCallback(async (id: string, data: Partial<Omit<MenuBomLine, 'id'>>) => {
    const dbData: any = {};
    if (data.skuId !== undefined) dbData.sku_id = data.skuId;
    if (data.qtyPerServing !== undefined) dbData.qty_per_serving = data.qtyPerServing;
    if (data.uom !== undefined) dbData.uom = data.uom;
    if (data.yieldPct !== undefined) dbData.yield_pct = data.yieldPct;
    if (data.effectiveQty !== undefined) dbData.effective_qty = data.effectiveQty;
    if (data.costPerServing !== undefined) dbData.cost_per_serving = data.costPerServing;

    const { error } = await supabase.from('menu_bom').update(dbData).eq('id', id);
    if (error) { toast.error('Failed to update ingredient: ' + error.message); return; }
    setLines(prev => prev.map(l => l.id === id ? { ...l, ...data } : l));
  }, []);

  const deleteLine = useCallback(async (id: string) => {
    const { error } = await supabase.from('menu_bom').delete().eq('id', id);
    if (error) { toast.error('Failed to delete ingredient: ' + error.message); return; }
    setLines(prev => prev.filter(l => l.id !== id));
  }, []);

  return { lines, loading, getLinesForMenu, addLine, updateLine, deleteLine };
}
