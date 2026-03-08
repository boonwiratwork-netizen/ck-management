import { useState, useCallback } from 'react';
import { GoodsReceipt, getWeekNumber } from '@/types/goods-receipt';
import { SKU } from '@/types/sku';
import { Price } from '@/types/price';

export function useGoodsReceiptData() {
  const [receipts, setReceipts] = useState<GoodsReceipt[]>([]);

  const getStandardPrice = (skuId: string, supplierId: string, prices: Price[]): number => {
    const active = prices.find(p => p.skuId === skuId && p.supplierId === supplierId && p.isActive);
    return active?.pricePerPurchaseUom ?? 0;
  };

  const addReceipt = useCallback((
    data: Omit<GoodsReceipt, 'id' | 'weekNumber' | 'purchaseUom' | 'standardPrice' | 'priceVariance'>,
    sku: SKU | undefined,
    prices: Price[]
  ) => {
    const standardPrice = getStandardPrice(data.skuId, data.supplierId, prices);
    const receipt: GoodsReceipt = {
      ...data,
      id: crypto.randomUUID(),
      weekNumber: getWeekNumber(data.receiptDate),
      purchaseUom: sku?.purchaseUom ?? '',
      standardPrice,
      priceVariance: data.actualPrice - standardPrice,
    };
    setReceipts(prev => [receipt, ...prev]);
  }, []);

  const updateReceipt = useCallback((
    id: string,
    data: Omit<GoodsReceipt, 'id' | 'weekNumber' | 'purchaseUom' | 'standardPrice' | 'priceVariance'>,
    sku: SKU | undefined,
    prices: Price[]
  ) => {
    const standardPrice = getStandardPrice(data.skuId, data.supplierId, prices);
    setReceipts(prev => prev.map(r =>
      r.id === id
        ? {
            ...r,
            ...data,
            weekNumber: getWeekNumber(data.receiptDate),
            purchaseUom: sku?.purchaseUom ?? '',
            standardPrice,
            priceVariance: data.actualPrice - standardPrice,
          }
        : r
    ));
  }, []);

  const deleteReceipt = useCallback((id: string) => {
    setReceipts(prev => prev.filter(r => r.id !== id));
  }, []);

  return { receipts, addReceipt, updateReceipt, deleteReceipt };
}
