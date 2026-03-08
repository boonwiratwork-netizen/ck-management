import { useState, useCallback } from 'react';
import { Price } from '@/types/price';
import { SKU } from '@/types/sku';

export function usePriceData() {
  const [prices, setPrices] = useState<Price[]>([]);

  const calcUsagePrice = (purchasePrice: number, sku: SKU | undefined): number => {
    if (!sku || sku.packSize === 0) return 0;
    return (purchasePrice / sku.packSize) * sku.converter;
  };

  const addPrice = useCallback((data: Omit<Price, 'id' | 'pricePerUsageUom'>, sku: SKU | undefined) => {
    setPrices(prev => {
      let updated = prev;
      // If setting as active, deactivate other prices for same SKU+supplier
      if (data.isActive) {
        updated = prev.map(p =>
          p.skuId === data.skuId && p.supplierId === data.supplierId
            ? { ...p, isActive: false }
            : p
        );
      }
      const newPrice: Price = {
        ...data,
        id: crypto.randomUUID(),
        pricePerUsageUom: calcUsagePrice(data.pricePerPurchaseUom, sku),
      };
      return [...updated, newPrice];
    });
  }, []);

  const updatePrice = useCallback((id: string, data: Omit<Price, 'id' | 'pricePerUsageUom'>, sku: SKU | undefined) => {
    setPrices(prev => {
      let updated = prev;
      // If setting as active, deactivate other prices for same SKU+supplier
      if (data.isActive) {
        updated = prev.map(p =>
          p.skuId === data.skuId && p.supplierId === data.supplierId && p.id !== id
            ? { ...p, isActive: false }
            : p
        );
      }
      return updated.map(p =>
        p.id === id
          ? { ...p, ...data, pricePerUsageUom: calcUsagePrice(data.pricePerPurchaseUom, sku) }
          : p
      );
    });
  }, []);

  const deletePrice = useCallback((id: string) => {
    setPrices(prev => prev.filter(p => p.id !== id));
  }, []);

  return { prices, addPrice, updatePrice, deletePrice };
}
