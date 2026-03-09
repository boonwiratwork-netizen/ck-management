import { useState, useCallback, useEffect } from 'react';
import { SKU, SKUType } from '@/types/sku';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const toLocal = (row: any): SKU => ({
  id: row.id,
  skuId: row.sku_id,
  name: row.name,
  type: row.type,
  category: row.category,
  status: row.status,
  specNote: row.spec_note,
  packSize: row.pack_size,
  packUnit: row.pack_unit,
  purchaseUom: row.purchase_uom,
  usageUom: row.usage_uom,
  converter: row.converter,
  storageCondition: row.storage_condition,
  shelfLife: row.shelf_life,
  vat: row.vat,
  supplier1: row.supplier1,
  supplier2: row.supplier2,
  leadTime: row.lead_time,
});

const toDb = (data: Omit<SKU, 'id' | 'skuId'>, skuId?: string) => {
  const obj: any = {
    name: data.name,
    type: data.type,
    category: data.category,
    status: data.status,
    spec_note: data.specNote,
    pack_size: data.packSize,
    pack_unit: data.packUnit,
    purchase_uom: data.purchaseUom,
    usage_uom: data.usageUom,
    converter: data.converter,
    storage_condition: data.storageCondition,
    shelf_life: data.shelfLife,
    vat: data.vat,
    supplier1: data.supplier1,
    supplier2: data.supplier2,
    lead_time: data.leadTime,
  };
  if (skuId) obj.sku_id = skuId;
  return obj;
};

export function useSkuData() {
  const [skus, setSkus] = useState<SKU[]>([]);

  useEffect(() => {
    supabase.from('skus').select('*').order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) { toast.error('Failed to load SKUs'); return; }
        setSkus((data || []).map(toLocal));
      });
  }, []);

  const generateSkuId = (type: SKUType, existing: SKU[]): string => {
    const count = existing.filter(s => s.type === type).length;
    return `${type}-${String(count + 1).padStart(4, '0')}`;
  };

  const addSku = useCallback(async (data: Omit<SKU, 'id' | 'skuId'>) => {
    // Generate skuId based on current state
    const skuId = generateSkuId(data.type, skus);
    const { data: row, error } = await supabase.from('skus').insert(toDb(data, skuId)).select().single();
    if (error) { toast.error('Failed to add SKU: ' + error.message); return; }
    setSkus(prev => [toLocal(row), ...prev]);
  }, [skus]);

  const updateSku = useCallback(async (id: string, data: Partial<Omit<SKU, 'id' | 'skuId'>>) => {
    const dbData: any = {};
    if (data.name !== undefined) dbData.name = data.name;
    if (data.type !== undefined) dbData.type = data.type;
    if (data.category !== undefined) dbData.category = data.category;
    if (data.status !== undefined) dbData.status = data.status;
    if (data.specNote !== undefined) dbData.spec_note = data.specNote;
    if (data.packSize !== undefined) dbData.pack_size = data.packSize;
    if (data.packUnit !== undefined) dbData.pack_unit = data.packUnit;
    if (data.purchaseUom !== undefined) dbData.purchase_uom = data.purchaseUom;
    if (data.usageUom !== undefined) dbData.usage_uom = data.usageUom;
    if (data.converter !== undefined) dbData.converter = data.converter;
    if (data.storageCondition !== undefined) dbData.storage_condition = data.storageCondition;
    if (data.shelfLife !== undefined) dbData.shelf_life = data.shelfLife;
    if (data.vat !== undefined) dbData.vat = data.vat;
    if (data.supplier1 !== undefined) dbData.supplier1 = data.supplier1;
    if (data.supplier2 !== undefined) dbData.supplier2 = data.supplier2;
    if (data.leadTime !== undefined) dbData.lead_time = data.leadTime;

    const { error } = await supabase.from('skus').update(dbData).eq('id', id);
    if (error) { toast.error('Failed to update SKU: ' + error.message); return; }
    setSkus(prev => prev.map(s => s.id === id ? { ...s, ...data } : s));
  }, []);

  const deleteSku = useCallback(async (id: string) => {
    const { error } = await supabase.from('skus').delete().eq('id', id);
    if (error) { toast.error('Failed to delete SKU: ' + error.message); return; }
    setSkus(prev => prev.filter(s => s.id !== id));
  }, []);

  return { skus, addSku, updateSku, deleteSku };
}
