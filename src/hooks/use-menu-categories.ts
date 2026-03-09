import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface MenuCategory {
  id: string;
  name: string;
}

export function useMenuCategories() {
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from('menu_categories').select('id, name').order('name')
      .then(({ data, error }) => {
        if (error) toast.error('Failed to load categories');
        else setCategories(data || []);
        setLoading(false);
      });
  }, []);

  const addCategory = useCallback(async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (categories.some(c => c.name.toLowerCase() === trimmed.toLowerCase())) {
      toast.error('Category already exists');
      return;
    }
    const { data, error } = await supabase.from('menu_categories')
      .insert({ name: trimmed }).select('id, name').single();
    if (error) { toast.error('Failed to add category: ' + error.message); return; }
    setCategories(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
    toast.success(`Category "${trimmed}" added`);
  }, [categories]);

  const deleteCategory = useCallback(async (id: string) => {
    const { error } = await supabase.from('menu_categories').delete().eq('id', id);
    if (error) { toast.error('Failed to delete category'); return; }
    setCategories(prev => prev.filter(c => c.id !== id));
  }, []);

  return { categories, loading: loading, addCategory, deleteCategory };
}
