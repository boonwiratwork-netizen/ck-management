import { useState, useCallback, useEffect } from 'react';
import { Menu } from '@/types/menu';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const toLocal = (row: any): Menu => ({
  id: row.id,
  menuCode: row.menu_code,
  menuName: row.menu_name,
  category: row.category,
  sellingPrice: row.selling_price,
  status: row.status,
  brandName: row.brand_name || '',
  isMaindish: row.is_maindish ?? false,
});

export function useMenuData() {
  const [menus, setMenus] = useState<Menu[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from('menus').select('*').order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) { toast.error('Failed to load menus'); }
        else { setMenus((data || []).map(toLocal)); }
        setLoading(false);
      });
  }, []);

  const getNextCode = useCallback((): string => {
    const nums = menus
      .map(m => m.menuCode.match(/^MN-(\d+)$/))
      .filter(Boolean)
      .map(m => parseInt(m![1], 10));
    const next = nums.length > 0 ? Math.max(...nums) + 1 : 1;
    return `MN-${String(next).padStart(3, '0')}`;
  }, [menus]);

  const addMenu = useCallback(async (data: Omit<Menu, 'id'>) => {
    const { data: row, error } = await supabase.from('menus').insert({
      menu_code: data.menuCode,
      menu_name: data.menuName,
      category: data.category,
      selling_price: data.sellingPrice,
      status: data.status,
      brand_name: data.brandName,
    }).select().single();
    if (error) { toast.error('Failed to add menu: ' + error.message); return; }
    setMenus(prev => [toLocal(row), ...prev]);
  }, []);

  const updateMenu = useCallback(async (id: string, data: Partial<Omit<Menu, 'id'>>) => {
    const dbData: any = {};
    if (data.menuCode !== undefined) dbData.menu_code = data.menuCode;
    if (data.menuName !== undefined) dbData.menu_name = data.menuName;
    if (data.category !== undefined) dbData.category = data.category;
    if (data.sellingPrice !== undefined) dbData.selling_price = data.sellingPrice;
    if (data.status !== undefined) dbData.status = data.status;
    if (data.brandName !== undefined) dbData.brand_name = data.brandName;

    const { error } = await supabase.from('menus').update(dbData).eq('id', id);
    if (error) { toast.error('Failed to update menu: ' + error.message); return; }
    setMenus(prev => prev.map(m => m.id === id ? { ...m, ...data } : m));
  }, []);

  const deleteMenu = useCallback(async (id: string) => {
    const { error } = await supabase.from('menus').delete().eq('id', id);
    if (error) { toast.error('Failed to delete menu: ' + error.message); return; }
    setMenus(prev => prev.filter(m => m.id !== id));
  }, []);

  const bulkAddMenus = useCallback(async (rows: Omit<Menu, 'id'>[]) => {
    const dbRows = rows.map(r => ({
      menu_code: r.menuCode,
      menu_name: r.menuName,
      category: r.category,
      selling_price: r.sellingPrice,
      status: r.status,
      brand_name: r.brandName,
    }));
    const { data, error } = await supabase.from('menus').insert(dbRows).select();
    if (error) { toast.error('Bulk insert failed: ' + error.message); return 0; }
    setMenus(prev => [...(data || []).map(toLocal), ...prev]);
    return data?.length || 0;
  }, []);

  return { menus, loading, getNextCode, addMenu, updateMenu, deleteMenu, bulkAddMenus };
}
