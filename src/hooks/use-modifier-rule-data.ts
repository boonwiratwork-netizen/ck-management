import { useState, useCallback, useEffect } from 'react';
import { ModifierRule } from '@/types/modifier-rule';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const toLocal = (row: any): ModifierRule => ({
  id: row.id,
  keyword: row.keyword,
  skuId: row.sku_id,
  qtyPerMatch: Number(row.qty_per_match),
  uom: row.uom,
  description: row.description,
  isActive: row.is_active,
});

export function useModifierRuleData() {
  const [rules, setRules] = useState<ModifierRule[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from('menu_modifier_rules').select('*').order('created_at')
      .then(({ data, error }) => {
        if (error) toast.error('Failed to load modifier rules');
        else setRules((data || []).map(toLocal));
        setLoading(false);
      });
  }, []);

  const addRule = useCallback(async (data: Omit<ModifierRule, 'id'>) => {
    const { data: row, error } = await supabase.from('menu_modifier_rules').insert({
      keyword: data.keyword,
      sku_id: data.skuId,
      qty_per_match: data.qtyPerMatch,
      uom: data.uom,
      description: data.description,
      is_active: data.isActive,
    }).select().single();
    if (error) { toast.error('Failed to add rule: ' + error.message); return; }
    setRules(prev => [...prev, toLocal(row)]);
  }, []);

  const updateRule = useCallback(async (id: string, data: Partial<Omit<ModifierRule, 'id'>>) => {
    const dbData: any = {};
    if (data.keyword !== undefined) dbData.keyword = data.keyword;
    if (data.skuId !== undefined) dbData.sku_id = data.skuId;
    if (data.qtyPerMatch !== undefined) dbData.qty_per_match = data.qtyPerMatch;
    if (data.uom !== undefined) dbData.uom = data.uom;
    if (data.description !== undefined) dbData.description = data.description;
    if (data.isActive !== undefined) dbData.is_active = data.isActive;

    const { error } = await supabase.from('menu_modifier_rules').update(dbData).eq('id', id);
    if (error) { toast.error('Failed to update rule: ' + error.message); return; }
    setRules(prev => prev.map(r => r.id === id ? { ...r, ...data } : r));
  }, []);

  const deleteRule = useCallback(async (id: string) => {
    const { error } = await supabase.from('menu_modifier_rules').delete().eq('id', id);
    if (error) { toast.error('Failed to delete rule: ' + error.message); return; }
    setRules(prev => prev.filter(r => r.id !== id));
  }, []);

  return { rules, loading, addRule, updateRule, deleteRule };
}
