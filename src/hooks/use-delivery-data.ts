import { useState, useCallback } from 'react';
import { Delivery } from '@/types/delivery';
import { getWeekNumber } from '@/types/goods-receipt';

export function useDeliveryData() {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);

  const addDelivery = useCallback((data: Omit<Delivery, 'id' | 'weekNumber'>) => {
    const delivery: Delivery = {
      ...data,
      id: crypto.randomUUID(),
      weekNumber: getWeekNumber(data.deliveryDate),
    };
    setDeliveries(prev => [...prev, delivery]);
    return delivery.id;
  }, []);

  const updateDelivery = useCallback((id: string, data: Omit<Delivery, 'id' | 'weekNumber'>) => {
    setDeliveries(prev => prev.map(d =>
      d.id === id ? { ...d, ...data, weekNumber: getWeekNumber(data.deliveryDate) } : d
    ));
  }, []);

  const deleteDelivery = useCallback((id: string) => {
    setDeliveries(prev => prev.filter(d => d.id !== id));
  }, []);

  return { deliveries, addDelivery, updateDelivery, deleteDelivery };
}
