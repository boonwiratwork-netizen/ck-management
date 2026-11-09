import { useState, useCallback, useEffect, useRef } from 'react';
import { loadWithDeviceCopy } from "@/lib/base-cache";
import { fetchAllRows } from "@/lib/fetch-all";
import { MenuBomLine } from '@/types/menu-bom';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { isMissingColumn, noteSaveProblem, saveLineSpecNote } from '@/lib/recipe-note-db';
import { writeError, writeTimeout } from '@/lib/write-timeout';

/**
 * One menu recipe line's new amounts (yield and what follows from it, and qty when the
 * qty itself was edited). Left out = qty_per_serving isn't written at all: a bulk yield
 * change must never put back a qty from the screen's copy over a newer one.
 */
export interface MenuBomLineChange {
  id: string;
  qtyPerServing?: number;
  yieldPct: number;
  effectiveQty: number;
  costPerServing: number;
}

/** What a bulk write did: the ids written, and every line that wasn't with the reason (Thai) */
export interface MenuBomBulkResult {
  saved: string[];
  failed: { id: string; reason: string }[];
}

export type UpdateMenuBomLines = (changes: MenuBomLineChange[]) => Promise<MenuBomBulkResult>;

/** A few writes at a time: quick for 36 lines, gentle on the database */
const BULK_PARALLEL = 5;

/** Nothing came back from an update: row security filtered it out (no right to edit), or the row is gone */
export const NOT_UPDATED = 'ไม่มีสิทธิ์แก้ หรือถูกลบไปแล้ว';

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
  // Same: before the delivery_qty migration every line reads as "same as the shop"
  deliveryQty: row.delivery_qty === null || row.delivery_qty === undefined ? null : Number(row.delivery_qty),
  // Absent (migration not run) = an ordinary line
  deliveryOnly: row.delivery_only === true,
});

/** Told when the delivery amount couldn't be saved because the column isn't there yet */
const DELIVERY_COLUMN_MISSING = 'บันทึกสูตรแล้ว แต่ยังบันทึกปริมาณเดลิเวอรีไม่ได้: ฐานข้อมูลยังไม่มีช่องนี้ (ต้องรันไฟล์ปรับฐานข้อมูล menu_bom_delivery_qty ก่อน)';

/** A delivery-only line needs the delivery_only column: without it the row would land as a shop line */
const DELIVERY_ONLY_COLUMN_MISSING = 'เพิ่มวัตถุดิบเฉพาะเดลิเวอรีไม่ได้: ฐานข้อมูลยังไม่มีช่องนี้ (ต้องรันไฟล์ปรับฐานข้อมูล menu_bom_delivery_qty ก่อน) · สูตรหน้าร้านไม่ถูกแตะ';

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
    const base = {
      menu_id: data.menuId,
      sku_id: data.skuId,
      qty_per_serving: data.qtyPerServing,
      uom: data.uom,
      yield_pct: data.yieldPct,
      effective_qty: data.effectiveQty,
      cost_per_serving: data.costPerServing,
      branch_id: data.branchId ?? null,
    };
    // A delivery-only line: never retried without the column (it would become a shop line)
    if (data.deliveryOnly) {
      const { data: row, error } = await supabase.from('menu_bom').insert({ ...base, delivery_only: true }).select().single();
      if (error) { toast.error(isMissingColumn(error) ? DELIVERY_ONLY_COLUMN_MISSING : 'เพิ่มวัตถุดิบไม่สำเร็จ: ' + error.message); return false; }
      setLines(prev => [...prev, toLocal(row)]);
      return true;
    }
    // delivery_qty only when filled: a line without one never needs the new column
    const withDelivery = data.deliveryQty !== undefined && data.deliveryQty !== null;
    let { data: row, error } = await supabase.from('menu_bom').insert({ ...base, ...(withDelivery && { delivery_qty: data.deliveryQty }) }).select().single();
    let deliveryLost = false;
    if (error && withDelivery && isMissingColumn(error)) {
      ({ data: row, error } = await supabase.from('menu_bom').insert(base).select().single());
      deliveryLost = !error;
    }
    if (error) { toast.error('เพิ่มวัตถุดิบไม่สำเร็จ: ' + error.message); return false; }
    if (deliveryLost) toast.error(DELIVERY_COLUMN_MISSING);
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
    if (data.deliveryQty !== undefined) dbData.delivery_qty = data.deliveryQty;

    let { error } = await supabase.from('menu_bom').update(dbData).eq('id', id);
    let next = data;
    if (error && 'delivery_qty' in dbData && isMissingColumn(error)) {
      // Column not there yet (migration not run): save the rest; a filled delivery amount is lost, say so
      const { delivery_qty: lost, ...rest } = dbData;
      ({ error } = Object.keys(rest).length ? await supabase.from('menu_bom').update(rest).eq('id', id) : { error: null });
      next = { ...data };
      delete next.deliveryQty;
      if (!error && lost !== null) toast.error(DELIVERY_COLUMN_MISSING);
    }
    if (error) { toast.error('แก้วัตถุดิบไม่สำเร็จ: ' + error.message); return false; }
    setLines(prev => prev.map(l => l.id === id ? { ...l, ...next } : l));
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
    // of the same item (an import file has no notes). Without the spec_note / delivery_qty
    // column (a migration not run yet) the insert is sent again without either.
    // An import is the SHOP recipe: the menu's delivery-only lines stay as they are.
    const oldShared = linesRef.current.filter((l) => l.menuId === menuId && !l.branchId);
    // An item that is already a delivery-only line would be deducted twice by delivery
    // orders: refuse (the import check stops it first; this guards every other caller)
    const clash = oldShared.filter((l) => l.deliveryOnly && next.some((n) => n.skuId === l.skuId));
    if (clash.length) {
      toast.error(`บันทึกสูตรเมนูไม่ได้: มีวัตถุดิบ ${clash.length} ตัวที่อยู่ในสูตรเดลิเวอรี (เดลิเวอรีเท่านั้น) แล้ว · ลบที่สูตรเดลิเวอรีก่อน ไม่งั้นออเดอร์เดลิเวอรีจะตัดซ้ำ`);
      return false;
    }
    const oldNotes = new Map(oldShared.filter((l) => !l.deliveryOnly && l.specNote).map((l) => [l.skuId, l.specNote!]));
    // A delivery amount stays with its item the same way (an import file has none)
    const oldDelivery = new Map(oldShared.filter((l) => !l.deliveryOnly && l.deliveryQty != null).map((l) => [l.skuId, l.deliveryQty!]));
    const deliveryOf = (l: { skuId: string; deliveryQty?: number | null }) => l.deliveryQty ?? oldDelivery.get(l.skuId) ?? null;
    const withDelivery = next.some((l) => deliveryOf(l) !== null);
    const build = (withExtras: boolean) => next.map((l) => ({
      menu_id: menuId,
      sku_id: l.skuId,
      qty_per_serving: l.qtyPerServing,
      uom: l.uom,
      yield_pct: l.yieldPct,
      effective_qty: l.effectiveQty,
      cost_per_serving: l.costPerServing,
      branch_id: null,
      ...(withExtras && { spec_note: l.specNote?.trim() || oldNotes.get(l.skuId) || null }),
      ...(withExtras && withDelivery && { delivery_qty: deliveryOf(l) }),
    }));
    let { data: rows, error } = await supabase.from('menu_bom').insert(build(oldNotes.size > 0 || withDelivery || next.some((l) => l.specNote?.trim()))).select();
    if (error && isMissingColumn(error)) ({ data: rows, error } = await supabase.from('menu_bom').insert(build(false)).select());
    if (error || !rows) { toast.error('บันทึกสูตรเมนูไม่สำเร็จ: ' + (error?.message ?? '')); return false; }
    const added = rows.map((r) => r.id as string);
    // Every other shared SHOP line of the menu in the database, not just the ones on screen.
    // Delivery-only lines (an import never carries them) are left alone by the database
    // filter, so one added from another device stays too. Without the column (migration not
    // run) there are no delivery-only lines: the plain delete.
    const oldOut = () => supabase.from('menu_bom').delete().eq('menu_id', menuId).is('branch_id', null).not('id', 'in', `(${added.join(',')})`);
    let del = await oldOut().eq('delivery_only', false);
    if (del.error && isMissingColumn(del.error)) del = await oldOut();
    if (del.error) {
      // Take the new lines back out: the old recipe stays as it was
      const undo = await supabase.from('menu_bom').delete().in('id', added);
      toast.error(undo.error ? `สูตรเมนูมีทั้งของเก่าและของใหม่ · เปิดเมนูนี้ใน Cost Center แล้วลบบรรทัดที่ซ้ำ (${del.error.message})` : 'บันทึกสูตรเมนูไม่สำเร็จ สูตรเดิมยังอยู่: ' + del.error.message);
      if (undo.error) setLines(prev => [...prev, ...rows.map(toLocal)]);
      return false;
    }
    setLines(prev => [...prev.filter(l => !(l.menuId === menuId && !l.branchId && !l.deliveryOnly)), ...rows.map(toLocal)]);
    return true;
  }, []);

  // Many lines' yield, or one line's qty+yield (where-used matrix): each line its own write with a time limit,
  // counted by the rows the database says it changed — a write row security filtered out
  // (200, nothing changed) is a failure, never a success. Only lines that really changed
  // are changed on screen; the caller says how many of how many.
  const updateLines = useCallback<UpdateMenuBomLines>(async (changes) => {
    const saved: string[] = [];
    const failed: { id: string; reason: string }[] = [];
    const one = async (c: MenuBomLineChange) => {
      try {
        const { data, error } = await supabase
          .from('menu_bom')
          .update({
            ...(c.qtyPerServing !== undefined && { qty_per_serving: c.qtyPerServing }),
            yield_pct: c.yieldPct,
            effective_qty: c.effectiveQty,
            cost_per_serving: c.costPerServing,
          })
          .eq('id', c.id)
          .select('id')
          .abortSignal(writeTimeout());
        if (error) failed.push({ id: c.id, reason: writeError(error) || 'บันทึกไม่สำเร็จ' });
        else if (!data || data.length === 0) failed.push({ id: c.id, reason: NOT_UPDATED });
        else saved.push(c.id);
      } catch (e) {
        failed.push({ id: c.id, reason: writeError({ message: e instanceof Error ? e.message : String(e) }) });
      }
    };
    for (let i = 0; i < changes.length; i += BULK_PARALLEL) await Promise.all(changes.slice(i, i + BULK_PARALLEL).map(one));
    if (saved.length) {
      const done = new Map(changes.filter((c) => saved.includes(c.id)).map((c) => [c.id, c]));
      setLines(prev => prev.map(l => {
        const c = done.get(l.id);
        return c ? { ...l, qtyPerServing: c.qtyPerServing ?? l.qtyPerServing, yieldPct: c.yieldPct, effectiveQty: c.effectiveQty, costPerServing: c.costPerServing } : l;
      }));
    }
    return { saved, failed };
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

  return { lines, loading, getLinesForMenu, addLine, updateLine, deleteLine, replaceShared, saveSpecNote, updateLines };
}
