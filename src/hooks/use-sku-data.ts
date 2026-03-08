import { useState, useCallback } from 'react';
import { SKU, SKUType, EMPTY_SKU } from '@/types/sku';

const generateId = () => crypto.randomUUID();

const generateSkuId = (type: SKUType, existing: SKU[]): string => {
  const prefix = type;
  const count = existing.filter(s => s.type === type).length;
  return `${prefix}-${String(count + 1).padStart(4, '0')}`;
};

export function useSkuData() {
  const [skus, setSkus] = useState<SKU[]>([]);

  const addSku = useCallback((data: Omit<SKU, 'id' | 'skuId'>) => {
    setSkus(prev => {
      const newSku: SKU = {
        ...data,
        id: generateId(),
        skuId: generateSkuId(data.type, prev),
      };
      return [...prev, newSku];
    });
  }, []);

  const updateSku = useCallback((id: string, data: Partial<Omit<SKU, 'id' | 'skuId'>>) => {
    setSkus(prev => prev.map(s => s.id === id ? { ...s, ...data } : s));
  }, []);

  const deleteSku = useCallback((id: string) => {
    setSkus(prev => prev.filter(s => s.id !== id));
  }, []);

  return { skus, addSku, updateSku, deleteSku };
}
