import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Switch } from '@/components/ui/switch';
import { table } from '@/lib/design-tokens';
import { toast } from 'sonner';
import { useLanguage } from '@/hooks/use-language';

interface BranchMenu {
  menuId: string;
  menuCode: string;
  menuName: string;
  category: string;
  isActive: boolean;
  hasOverride: boolean;
}

interface Props {
  branchId: string;
  brandName: string;
}

export function BranchMenuAvailability({ branchId, brandName }: Props) {
  const { t } = useLanguage();
  const [menus, setMenus] = useState<BranchMenu[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);

  const fetchMenus = useCallback(async () => {
    setLoading(true);

    const [menusRes, overridesRes] = await Promise.all([
      supabase
        .from('menus')
        .select('id, menu_code, menu_name, category, status')
        .eq('brand_name', brandName)
        .eq('status', 'Active')
        .order('menu_code'),
      supabase
        .from('branch_menu_overrides')
        .select('menu_id, is_active')
        .eq('branch_id', branchId),
    ]);

    if (menusRes.error) {
      toast.error('Failed to load menus');
      setLoading(false);
      return;
    }

    const overrideMap = new Map<string, boolean>();
    (overridesRes.data || []).forEach((o) => {
      overrideMap.set(o.menu_id, o.is_active);
    });

    const list: BranchMenu[] = (menusRes.data || []).map((m) => {
      const hasOverride = overrideMap.has(m.id);
      return {
        menuId: m.id,
        menuCode: m.menu_code,
        menuName: m.menu_name,
        category: m.category,
        isActive: hasOverride ? overrideMap.get(m.id)! : true,
        hasOverride,
      };
    });

    setMenus(list);
    setLoading(false);
  }, [branchId, brandName]);

  useEffect(() => {
    fetchMenus();
  }, [fetchMenus]);

  const handleToggle = async (menuId: string, newValue: boolean) => {
    setToggling(menuId);

    const { error } = await supabase
      .from('branch_menu_overrides')
      .upsert(
        { branch_id: branchId, menu_id: menuId, is_active: newValue },
        { onConflict: 'branch_id,menu_id' }
      );

    if (error) {
      toast.error('Failed to update menu availability');
      setToggling(null);
      return;
    }

    setMenus((prev) =>
      prev.map((m) =>
        m.menuId === menuId ? { ...m, isActive: newValue, hasOverride: true } : m
      )
    );
    setToggling(null);
  };

  const activeCount = menus.filter((m) => m.isActive).length;

  if (loading) {
    return (
      <div className="space-y-3 py-4">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="flex items-center justify-between px-3">
            <div className={table.skeletonCellName} />
            <div className="h-6 w-11 bg-muted animate-pulse rounded-full" />
          </div>
        ))}
      </div>
    );
  }

  if (menus.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        No active menus for brand "{brandName}".
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <p className="text-xs text-muted-foreground">
          {activeCount} / {menus.length} menus active at this branch
        </p>
      </div>

      <div className={table.wrapper}>
        <table className={table.base}>
          <colgroup>
            <col width="90px" />
            <col width="auto" />
            <col width="120px" />
            <col width="70px" />
          </colgroup>
          <thead>
            <tr className={table.headerRow}>
              <th className={table.headerCell}>{t('col.code')}</th>
              <th className={table.headerCell}>{t('col.name')}</th>
              <th className={table.headerCell}>Category</th>
              <th className={`${table.headerCellCenter}`}>Active</th>
            </tr>
          </thead>
          <tbody>
            {menus.map((m) => (
              <tr key={m.menuId} className={table.dataRow}>
                <td className={`${table.dataCell} font-mono`}>{m.menuCode}</td>
                <td className={table.truncatedCell} title={m.menuName}>
                  {m.menuName}
                </td>
                <td className={table.dataCell}>{m.category}</td>
                <td className={`${table.dataCellCenter}`}>
                  <Switch
                    checked={m.isActive}
                    disabled={toggling === m.menuId}
                    onCheckedChange={(v) => handleToggle(m.menuId, v)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
