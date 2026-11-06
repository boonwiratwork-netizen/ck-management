import { useState, useCallback, useEffect, useRef } from 'react';
import { loadWithDeviceCopy } from "@/lib/base-cache";
import { fetchAllRows } from "@/lib/fetch-all";
import { MenuBomLine } from '@/types/menu-bom';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { isMissingColumn, noteSaveProblem, saveLineSpecNote } from '@/lib/recipe-note-db';

const toLocal = (row: any): MenuBomLine => ({
  id: row.id,
  menuId: row.menu_id,
  skuId: row.sku_id,
  qtyPerServing: Number(row.qty_per_serving),
  uom: row.uom,
  yieldPct: Number(row.yield_pct),
  effectiveQty: Number(row.effective_qty),
  costPerServing: Number(row.cost_per_serving),
  branchId: row.branch_id ?? null,
  // select('*'): before the spec_note migration the column is simply absent
  specNote: row.spec_note ?? '',
});

export function useMenuBomData() {
  const [lines, setLines] = useState<MenuBomLine[]>([]);
  // The lines as they are now, for replaceShared (keeps notes across an import)
  const linesRef = useRef<MenuBomLine[]>([]);
  linesRef.current = lines;
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadWithDeviceCopy(
      'menu_bom',
      () => fetchAllRows((a, b) => supabase.from('menu_bom').select('*').order('created_at').order('id').range(a, b)),
      (rows, fromDevice) => {
        setLines(rows.map(toLocal));
        if (fromDevice) setLoading(false);
      },
    ).then(({ error }) => {
      if (error) toast.error('โหลดสูตรเมนูไม่สำเร็จ');
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
      branch_id: data.branchId ?? null,
    }).select().single();
    if (error) { toast.error('เพิ่มวัตถุดิบไม่สำเร็จ: ' + error.message); return false; }
    setLines(prev => [...prev, toLocal(row)]);
    return true;
  }, []);

  const updateLine = useCallback(async (id: string, data: Partial<Omit<MenuBomLine, 'id'>>) => {
    const dbData: any = {};
    if (data.skuId !== undefined) dbData.sku_id = data.skuId;
    if (data.qtyPerServing !== undefined) dbData.qty_per_serving = data.qtyPerServing;
    if (data.uom !== undefined) dbData.uom = data.uom;
    if (data.yieldPct !== undefined) dbData.yield_pct = data.yieldPct;
    if (data.effectiveQty !== undefined) dbData.effective_qty = data.effectiveQty;
    if (data.costPerServing !== undefined) dbData.cost_per_serving = data.costPerServing;
    if (data.branchId !== undefined) dbData.branch_id = data.branchId;

    const { error } = await supabase.from('menu_bom').update(dbData).eq('id', id);
    if (error) { toast.error('แก้วัตถุดิบไม่สำเร็จ: ' + error.message); return false; }
    setLines(prev => prev.map(l => l.id === id ? { ...l, ...data } : l));
    return true;
  }, []);

  const deleteLine = useCallback(async (id: string) => {
    const { error } = await supabase.from('menu_bom').delete().eq('id', id);
    if (error) { toast.error('ลบวัตถุดิบไม่สำเร็จ: ' + error.message); return false; }
    setLines(prev => prev.filter(l => l.id !== id));
    return true;
  }, []);

  // A menu's whole shared recipe swapped for new lines (import): every new line in
  // one insert (all or nothing), the old shared lines out only after that worked,
  // so a failure never leaves the menu with no recipe or with both. A branch's own
  // lines stay.
  const replaceShared = useCallback(async (menuId: string, next: Omit<MenuBomLine, 'id' | 'menuId' | 'branchId'>[]) => {
    // A shop note stays with its item: the old shared line's note goes onto the new line
    // of the same item (an import file has no notes). Without the spec_note column (the
    // migration not run yet) the insert is sent again without it.
    const oldNotes = new Map(linesRef.current.filter((l) => l.menuId === menuId && !l.branchId && l.specNote).map((l) => [l.skuId, l.specNote!]));
    const build = (withNotes: boolean) => next.map((l) => ({
      menu_id: menuId,
      sku_id: l.skuId,
      qty_per_serving: l.qtyPerServing,
      uom: l.uom,
      yield_pct: l.yieldPct,
      effective_qty: l.effectiveQty,
      cost_per_serving: l.costPerServing,
      branch_id: null,
      ...(withNotes && { spec_note: l.specNote?.trim() || oldNotes.get(l.skuId) || null }),
    }));
    let { data: rows, error } = await supabase.from('menu_bom').insert(build(oldNotes.size > 0 || next.some((l) => l.specNote?.trim()))).select();
    if (error && isMissingColumn(error)) ({ data: rows, error } = await supabase.from('menu_bom').insert(build(false)).select());
    if (error || !rows) { toast.error('บันทึกสูตรเมนูไม่สำเร็จ: ' + (error?.message ?? '')); return false; }
    const added = rows.map((r) => r.id as string);
    // Every other shared line of the menu in the database, not just the ones on screen
    const del = await supabase.from('menu_bom').delete().eq('menu_id', menuId).is('branch_id', null).not('id', 'in', `(${added.join(',')})`);
    if (del.error) {
      // Take the new lines back out: the old recipe stays as it was
      const undo = await supabase.from('menu_bom').delete().in('id', added);
      toast.error(undo.error ? `สูตรเมนูมีทั้งของเก่าและของใหม่ · เปิดเมนูนี้ใน Cost Center แล้วลบบรรทัดที่ซ้ำ (${del.error.message})` : 'บันทึกสูตรเมนูไม่สำเร็จ สูตรเดิมยังอยู่: ' + del.error.message);
      if (undo.error) setLines(prev => [...prev, ...rows.map(toLocal)]);
      return false;
    }
    setLines(prev => [...prev.filter(l => !(l.menuId === menuId && !l.branchId)), ...rows.map(toLocal)]);
    return true;
  }, []);

  // The line's note for the shop (recipe sheet): its own write, so a missing column
  // (migration not run yet) never blocks saving the recipe itself
  const saveSpecNote = useCallback(async (id: string, note: string) => {
    const r = await saveLineSpecNote('menu_bom', id, note);
    const problem = noteSaveProblem(r);
    if (problem || r.kind !== 'ok') { toast.error(problem ?? ''); return false; }
    setLines(prev => prev.map(l => l.id === id ? { ...l, specNote: r.note } : l));
    return true;
  }, []);

  return { lines, loading, getLinesForMenu, addLine, updateLine, deleteLine, replaceShared, saveSpecNote };
}
