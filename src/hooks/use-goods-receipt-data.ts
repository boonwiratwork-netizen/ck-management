import { useState, useCallback } from 'react';
import { GoodsReceipt, getWeekNumber } from '@/types/goods-receipt';
import { SKU } from '@/types/sku';
import { Price } from '@/types/price';

export function useGoodsReceiptData() {
  const [receipts, setReceipts] = useState<GoodsReceipt[]>([]);

  const getStdUnitPrice = (skuId: string, supplierId: string, prices: Price[]): number => {
    const active = prices.find(p => p.skuId === skuId && p.supplierId === supplierId && p.isActive);
    return active?.pricePerUsageUom ?? 0;
  };

  const buildReceipt = (
    id: string,
    data: Omit<GoodsReceipt, 'id' | 'weekNumber' | 'usageUom' | 'stdUnitPrice' | 'standardPrice' | 'priceVariance' | 'actualUnitPrice'>,
    sku: SKU | undefined,
    prices: Price[]
  ): GoodsReceipt => {
    const stdUnit = getStdUnitPrice(data.skuId, data.supplierId, prices);
    const standardPrice = stdUnit * data.quantityReceived;
    const actualUnitPrice = data.quantityReceived > 0 ? data.actualTotal / data.quantityReceived : 0;
    return {
      ...data,
      id,
      weekNumber: getWeekNumber(data.receiptDate),
      usageUom: sku?.usageUom ?? '',
      stdUnitPrice: stdUnit,
      actualUnitPrice,
      standardPrice,
      priceVariance: data.actualTotal - standardPrice,
    };
  };

  const addReceipt = useCallback((
    data: Omit<GoodsReceipt, 'id' | 'weekNumber' | 'usageUom' | 'stdUnitPrice' | 'standardPrice' | 'priceVariance' | 'actualUnitPrice'>,
    sku: SKU | undefined,
    prices: Price[]
  ) => {
    const receipt = buildReceipt(crypto.randomUUID(), data, sku, prices);
    setReceipts(prev => [receipt, ...prev]);
  }, []);

  const updateReceipt = useCallback((
    id: string,
    data: Omit<GoodsReceipt, 'id' | 'weekNumber' | 'usageUom' | 'stdUnitPrice' | 'standardPrice' | 'priceVariance' | 'actualUnitPrice'>,
    sku: SKU | undefined,
    prices: Price[]
  ) => {
    setReceipts(prev => prev.map(r =>
      r.id === id ? buildReceipt(id, data, sku, prices) : r
    ));
  }, []);

  const deleteReceipt = useCallback((id: string) => {
    setReceipts(prev => prev.filter(r => r.id !== id));
  }, []);

  return { receipts, addReceipt, updateReceipt, deleteReceipt };
}
