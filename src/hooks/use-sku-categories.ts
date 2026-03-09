import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface SkuCategory {
  id: string;
  code: string;
  nameEn: string;
  nameTh: string;
}

export function useSkuCategories() {
  const [categories, setCategories] = useState<SkuCategory[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from('sku_categories').select('*').order('code')
      .then(({ data, error }) => {
        if (error) { toast.error('Failed to load SKU categories'); }
        else setCategories((data || []).map(r => ({
          id: r.id,
          code: r.code,
          nameEn: r.name_en,
          nameTh: r.name_th,
        })));
        setLoading(false);
      });
  }, []);

  const addCategory = useCallback(async (code: string, nameEn: string, nameTh: string) => {
    const trimCode = code.trim().toUpperCase();
    const trimEn = nameEn.trim();
    const trimTh = nameTh.trim();
    if (!trimCode || !trimEn) { toast.error('Code and English name are required'); return null; }
    if (categories.some(c => c.code === trimCode)) {
      toast.error('Category code already exists');
      return null;
    }
    const { data, error } = await supabase.from('sku_categories')
      .insert({ code: trimCode, name_en: trimEn, name_th: trimTh || trimEn })
      .select().single();
    if (error) { toast.error('Failed to add category: ' + error.message); return null; }
    const cat: SkuCategory = { id: data.id, code: data.code, nameEn: data.name_en, nameTh: data.name_th };
    setCategories(prev => [...prev, cat].sort((a, b) => a.code.localeCompare(b.code)));
    return cat;
  }, [categories]);

  const updateCategory = useCallback(async (id: string, nameEn: string, nameTh: string) => {
    const { error } = await supabase.from('sku_categories')
      .update({ name_en: nameEn.trim(), name_th: nameTh.trim() }).eq('id', id);
    if (error) { toast.error('Failed to update category'); return; }
    setCategories(prev => prev.map(c => c.id === id ? { ...c, nameEn: nameEn.trim(), nameTh: nameTh.trim() } : c));
  }, []);

  const deleteCategory = useCallback(async (id: string) => {
    const { error } = await supabase.from('sku_categories').delete().eq('id', id);
    if (error) { toast.error('Failed to delete category'); return; }
    setCategories(prev => prev.filter(c => c.id !== id));
  }, []);

  const bulkEnsureCategories = useCallback(async (codes: string[]): Promise<string[]> => {
    const newCodes: string[] = [];
    for (const code of codes) {
      const trimmed = code.trim().toUpperCase();
      if (!trimmed) continue;
      if (categories.some(c => c.code === trimmed)) continue;
      const { data, error } = await supabase.from('sku_categories')
        .insert({ code: trimmed, name_en: trimmed, name_th: trimmed })
        .select().single();
      if (!error && data) {
        const cat: SkuCategory = { id: data.id, code: data.code, nameEn: data.name_en, nameTh: data.name_th };
        setCategories(prev => [...prev, cat].sort((a, b) => a.code.localeCompare(b.code)));
        newCodes.push(trimmed);
      }
    }
    return newCodes;
  }, [categories]);

  const getCategoryLabel = useCallback((code: string) => {
    const cat = categories.find(c => c.code === code);
    return cat ? cat.nameEn : code;
  }, [categories]);

  return { categories, loading, addCategory, updateCategory, deleteCategory, bulkEnsureCategories, getCategoryLabel };
}
