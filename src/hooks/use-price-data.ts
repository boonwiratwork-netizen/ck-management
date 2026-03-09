import { useState, useCallback, useEffect } from 'react';
import { Price } from '@/types/price';
import { SKU } from '@/types/sku';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

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
    const { data, error } = await supabase.from('prices').select('*').order('created_at', { ascending: false });
    if (error) { toast.error('Failed to load prices'); return; }
    setPrices((data || []).map(toLocal));
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const calcUsagePrice = (purchasePrice: number, sku: SKU | undefined): number => {
    if (!sku || sku.packSize === 0) return 0;
    return (purchasePrice / sku.packSize) / sku.converter;
  };

  const addPrice = useCallback(async (data: Omit<Price, 'id' | 'pricePerUsageUom'>, sku: SKU | undefined) => {
    const pricePerUsageUom = calcUsagePrice(data.pricePerPurchaseUom, sku);

    // If setting as active, deactivate others for same SKU+supplier
    if (data.isActive) {
      await supabase.from('prices').update({ is_active: false })
        .eq('sku_id', data.skuId).eq('supplier_id', data.supplierId);
    }

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

    if (error) { toast.error('Failed to add price: ' + error.message); return; }

    // Refresh all prices to get correct active states
    const { data: all } = await supabase.from('prices').select('*').order('created_at', { ascending: false });
    if (all) setPrices(all.map(toLocal));
  }, []);

  const updatePrice = useCallback(async (id: string, data: Omit<Price, 'id' | 'pricePerUsageUom'>, sku: SKU | undefined) => {
    const pricePerUsageUom = calcUsagePrice(data.pricePerPurchaseUom, sku);

    if (data.isActive) {
      await supabase.from('prices').update({ is_active: false })
        .eq('sku_id', data.skuId).eq('supplier_id', data.supplierId).neq('id', id);
    }

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

    if (error) { toast.error('Failed to update price: ' + error.message); return; }

    const { data: all } = await supabase.from('prices').select('*').order('created_at', { ascending: false });
    if (all) setPrices(all.map(toLocal));
  }, []);

  const deletePrice = useCallback(async (id: string) => {
    const { error } = await supabase.from('prices').delete().eq('id', id);
    if (error) { toast.error('Failed to delete price: ' + error.message); return; }
    setPrices(prev => prev.filter(p => p.id !== id));
  }, []);

  return { prices, addPrice, updatePrice, deletePrice, refreshPrices: fetchAll };
}
