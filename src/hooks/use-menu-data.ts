import { useState, useCallback, useEffect } from 'react';
import { loadWithDeviceCopy } from "@/lib/base-cache";
import { fetchAllRows } from "@/lib/fetch-all";
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
    loadWithDeviceCopy(
      'menus',
      () => fetchAllRows((a, b) => supabase.from('menus').select('*').order('created_at', { ascending: false }).order('id').range(a, b)),
      (rows, fromDevice) => {
        setMenus(rows.map(toLocal));
        if (fromDevice) setLoading(false);
      },
    ).then(({ error }) => {
      if (error) toast.error('Failed to load menus');
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

  // Returns the new menu (truthy) so callers can open it straight away
  const addMenu = useCallback(async (data: Omit<Menu, 'id'>): Promise<Menu | null> => {
    const { data: row, error } = await supabase.from('menus').insert({
      menu_code: data.menuCode,
      menu_name: data.menuName,
      category: data.category,
      selling_price: data.sellingPrice,
      status: data.status,
      brand_name: data.brandName,
      is_maindish: data.isMaindish,
    }).select().single();
    if (error) { toast.error('บันทึกเมนูไม่สำเร็จ: ' + error.message); return null; }
    const created = toLocal(row);
    setMenus(prev => [created, ...prev]);
    return created;
  }, []);

  const updateMenu = useCallback(async (id: string, data: Partial<Omit<Menu, 'id'>>): Promise<boolean> => {
    const dbData: any = {};
    if (data.menuCode !== undefined) dbData.menu_code = data.menuCode;
    if (data.menuName !== undefined) dbData.menu_name = data.menuName;
    if (data.category !== undefined) dbData.category = data.category;
    if (data.sellingPrice !== undefined) dbData.selling_price = data.sellingPrice;
    if (data.status !== undefined) dbData.status = data.status;
    if (data.brandName !== undefined) dbData.brand_name = data.brandName;
    if (data.isMaindish !== undefined) dbData.is_maindish = data.isMaindish;

    const { error } = await supabase.from('menus').update(dbData).eq('id', id);
    if (error) { toast.error('บันทึกเมนูไม่สำเร็จ: ' + error.message); return false; }
    setMenus(prev => prev.map(m => m.id === id ? { ...m, ...data } : m));
    return true;
  }, []);

  const deleteMenu = useCallback(async (id: string): Promise<boolean> => {
    // Deleting a menu that rules point at would silently turn a "this menu only"
    // rule into "every menu" (rule menus cascade away). Ask for Inactive instead.
    const [scoped, asSubmenu] = await Promise.all([
      supabase.from('modifier_rule_menus').select('id', { count: 'exact', head: true }).eq('menu_id', id),
      supabase.from('menu_modifier_rules').select('id', { count: 'exact', head: true }).eq('submenu_id', id),
    ]);
    const linked = (scoped.count ?? 0) + (asSubmenu.count ?? 0);
    if (linked > 0) {
      toast.error(`ลบไม่ได้: มีกฎพิเศษ ${linked} ตัวผูกกับเมนูนี้ · ให้เปลี่ยนสถานะเป็น Inactive แทน`);
      return false;
    }
    const { error } = await supabase.from('menus').delete().eq('id', id);
    if (error) { toast.error('ลบเมนูไม่สำเร็จ: ' + error.message); return false; }
    setMenus(prev => prev.filter(m => m.id !== id));
    return true;
  }, []);

  const bulkAddMenus = useCallback(async (rows: Omit<Menu, 'id'>[]) => {
    const dbRows = rows.map(r => ({
      menu_code: r.menuCode,
      menu_name: r.menuName,
      category: r.category,
      selling_price: r.sellingPrice,
      status: r.status,
      brand_name: r.brandName,
      is_maindish: r.isMaindish,
    }));
    const { data, error } = await supabase.from('menus').insert(dbRows).select();
    if (error) { toast.error('Bulk insert failed: ' + error.message); return 0; }
    setMenus(prev => [...(data || []).map(toLocal), ...prev]);
    return data?.length || 0;
  }, []);

  return { menus, loading, getNextCode, addMenu, updateMenu, deleteMenu, bulkAddMenus };
}
