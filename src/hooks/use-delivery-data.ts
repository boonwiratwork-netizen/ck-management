import { useState, useCallback, useEffect } from 'react';
import { Delivery } from '@/types/delivery';
import { getWeekNumber } from '@/types/goods-receipt';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const toLocal = (row: any): Delivery => ({
  id: row.id,
  deliveryDate: row.delivery_date,
  weekNumber: row.week_number,
  branchName: row.branch_name,
  smSkuId: row.sm_sku_id,
  qtyDeliveredG: row.qty_delivered_g,
  note: row.note,
});

export function useDeliveryData() {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);

  useEffect(() => {
    supabase.from('deliveries').select('*').order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) { toast.error('Failed to load deliveries'); return; }
        setDeliveries((data || []).map(toLocal));
      });
  }, []);

  const addDelivery = useCallback(async (data: Omit<Delivery, 'id' | 'weekNumber'>) => {
    const weekNumber = getWeekNumber(data.deliveryDate);
    const { data: row, error } = await supabase.from('deliveries').insert({
      delivery_date: data.deliveryDate,
      week_number: weekNumber,
      branch_name: data.branchName,
      sm_sku_id: data.smSkuId,
      qty_delivered_g: data.qtyDeliveredG,
      note: data.note,
    }).select().single();
    if (error) { toast.error('Failed to add delivery: ' + error.message); return; }
    setDeliveries(prev => [toLocal(row), ...prev]);
    return row.id;
  }, []);

  const updateDelivery = useCallback(async (id: string, data: Omit<Delivery, 'id' | 'weekNumber'>) => {
    const weekNumber = getWeekNumber(data.deliveryDate);
    const { error } = await supabase.from('deliveries').update({
      delivery_date: data.deliveryDate,
      week_number: weekNumber,
      branch_name: data.branchName,
      sm_sku_id: data.smSkuId,
      qty_delivered_g: data.qtyDeliveredG,
      note: data.note,
    }).eq('id', id);
    if (error) { toast.error('Failed to update delivery: ' + error.message); return; }
    setDeliveries(prev => prev.map(d => d.id === id ? { ...d, ...data, weekNumber } : d));
  }, []);

  const deleteDelivery = useCallback(async (id: string) => {
    const { error } = await supabase.from('deliveries').delete().eq('id', id);
    if (error) { toast.error('Failed to delete delivery: ' + error.message); return; }
    setDeliveries(prev => prev.filter(d => d.id !== id));
  }, []);

  return { deliveries, addDelivery, updateDelivery, deleteDelivery };
}
