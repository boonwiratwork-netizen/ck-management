import { useState, useCallback, useEffect } from 'react';
import { loadWithDeviceCopy } from "@/lib/base-cache";
import { fetchAllRows } from "@/lib/fetch-all";
import { Price } from '@/types/price';
import { SKU } from '@/types/sku';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { recostAndSave } from '@/lib/recost-db';

const toLocal = (row: any): Price => ({
  id: row.id,
  skuId: row.sku_id,
  supplierId: row.supplier_id,
  pricePerPurchaseUom: row.price_per_purchase_uom,
  pricePerUsageUom: row.price_per_usage_uom,
  vat: row.vat,
  isActive: row.is_active,
  effectiveDate: row.effective_date,
  note: row.note,
});

export function usePriceData() {
  const [prices, setPrices] = useState<Price[]>([]);

  const fetchAll = useCallback(async () => {
    // Device copy first, fresh in the background; price history can pass 1,000 rows
    const { error } = await loadWithDeviceCopy(
      'prices',
      () => fetchAllRows((a, b) => supabase.from('prices').select('*').order('created_at', { ascending: false }).order('id').range(a, b)),
      (rows) => setPrices(rows.map(toLocal)),
    );
    if (error) toast.error('Failed to load prices');
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // A price moved: recipes built on it (and recipes built on those) get their cost
  // worked out again, then everything is reloaded
  const afterPriceChange = useCallback(async (...skuIds: string[]) => {
    const r = await recostAndSave(skuIds);
    if (!r.ok) toast.error('คิดต้นทุนสูตรใหม่ไม่ครบ ลองบันทึกอีกครั้ง');
    else if (r.changed.length) toast.success(`คิดต้นทุนใหม่ ${r.changed.length} สูตร`);
    await fetchAll();
  }, [fetchAll]);

  const calcUsagePrice = (purchasePrice: number, sku: SKU | undefined): number => {
    if (!sku || sku.packSize === 0) return 0;
    return (purchasePrice / sku.packSize) / sku.converter;
  };

  // One standard price per item: once a price is saved as active, the item's other
  // prices are switched off, whichever supplier they're from. Done after the save
  // succeeds, so a failed save never leaves the item with no price.
  const keepOnlyActive = async (skuId: string, keepId: string) => {
    const { error } = await supabase.from('prices').update({ is_active: false }).eq('sku_id', skuId).eq('is_active', true).neq('id', keepId);
    if (error) toast.error('ปิดราคาเก่าไม่สำเร็จ: ' + error.message);
  };

  const addPrice = useCallback(async (data: Omit<Price, 'id' | 'pricePerUsageUom'>, sku: SKU | undefined, opts?: { batch?: boolean }): Promise<boolean> => {
    const pricePerUsageUom = calcUsagePrice(data.pricePerPurchaseUom, sku);
    const { data: row, error } = await supabase.from('prices').insert({
      sku_id: data.skuId,
      supplier_id: data.supplierId,
      price_per_purchase_uom: data.pricePerPurchaseUom,
      price_per_usage_uom: pricePerUsageUom,
      vat: data.vat,
      is_active: data.isActive,
      effective_date: data.effectiveDate,
      note: data.note,
    }).select().single();

    if (error || !row) { toast.error('Failed to add price: ' + (error?.message ?? '')); return false; }
    if (data.isActive) await keepOnlyActive(data.skuId, row.id);
    // Imports add many prices, then work costs out once (recostPrices)
    if (!opts?.batch) await afterPriceChange(data.skuId);
    return true;
  }, [afterPriceChange]);

  const updatePrice = useCallback(async (id: string, data: Omit<Price, 'id' | 'pricePerUsageUom'>, sku: SKU | undefined): Promise<boolean> => {
    const pricePerUsageUom = calcUsagePrice(data.pricePerPurchaseUom, sku);
    const before = prices.find(p => p.id === id)?.skuId;
    const { error } = await supabase.from('prices').update({
      sku_id: data.skuId,
      supplier_id: data.supplierId,
      price_per_purchase_uom: data.pricePerPurchaseUom,
      price_per_usage_uom: pricePerUsageUom,
      vat: data.vat,
      is_active: data.isActive,
      effective_date: data.effectiveDate,
      note: data.note,
    }).eq('id', id);

    if (error) { toast.error('Failed to update price: ' + error.message); return false; }
    if (data.isActive) await keepOnlyActive(data.skuId, id);
    // Moved to another item: the old one's recipes need costing again too
    await afterPriceChange(...new Set([data.skuId, before].filter((x): x is string => !!x)));
    return true;
  }, [prices, afterPriceChange]);

  const deletePrice = useCallback(async (id: string): Promise<boolean> => {
    const skuId = prices.find(p => p.id === id)?.skuId;
    const { error } = await supabase.from('prices').delete().eq('id', id);
    if (error) { toast.error('Failed to delete price: ' + error.message); return false; }
    setPrices(prev => prev.filter(p => p.id !== id));
    if (skuId) await afterPriceChange(skuId);
    return true;
  }, [prices, afterPriceChange]);

  return { prices, addPrice, updatePrice, deletePrice, refreshPrices: fetchAll, recostPrices: afterPriceChange };
}
