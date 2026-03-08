import { useState, useCallback, useMemo } from 'react';
import { StockBalance, StockAdjustment } from '@/types/stock';
import { GoodsReceipt } from '@/types/goods-receipt';
import { SKU } from '@/types/sku';
import { Price } from '@/types/price';

export function useStockData(
  skus: SKU[],
  receipts: GoodsReceipt[],
  prices: Price[]
) {
  const [openingStocks, setOpeningStocks] = useState<Record<string, number>>({});
  const [adjustments, setAdjustments] = useState<StockAdjustment[]>([]);

  const rmSkus = useMemo(() => skus.filter(s => s.type === 'RM'), [skus]);

  const stockBalances = useMemo((): StockBalance[] => {
    return rmSkus.map(sku => {
      const opening = openingStocks[sku.id] ?? 0;
      const totalReceived = receipts
        .filter(r => r.skuId === sku.id)
        .reduce((sum, r) => sum + r.quantityReceived, 0);
      const totalConsumed = 0; // future: Production module
      const skuAdjustments = adjustments.filter(a => a.skuId === sku.id);
      const netAdjustment = skuAdjustments.reduce((sum, a) => sum + a.quantity, 0);
      const currentStock = opening + totalReceived - totalConsumed + netAdjustment;

      return {
        skuId: sku.id,
        openingStock: opening,
        totalReceived,
        totalConsumed,
        adjustments: skuAdjustments,
        currentStock,
      };
    });
  }, [rmSkus, receipts, openingStocks, adjustments]);

  const setOpeningStock = useCallback((skuId: string, qty: number) => {
    setOpeningStocks(prev => ({ ...prev, [skuId]: qty }));
  }, []);

  const addAdjustment = useCallback((adj: Omit<StockAdjustment, 'id'>) => {
    const newAdj: StockAdjustment = { ...adj, id: crypto.randomUUID() };
    setAdjustments(prev => [newAdj, ...prev]);
  }, []);

  const getStdUnitPrice = useCallback((skuId: string): number => {
    const active = prices.find(p => p.skuId === skuId && p.isActive);
    return active?.pricePerUsageUom ?? 0;
  }, [prices]);

  const getLastReceiptDate = useCallback((skuId: string): string | null => {
    const skuReceipts = receipts.filter(r => r.skuId === skuId);
    if (skuReceipts.length === 0) return null;
    return skuReceipts.reduce((latest, r) =>
      r.receiptDate > latest ? r.receiptDate : latest, skuReceipts[0].receiptDate
    );
  }, [receipts]);

  return {
    stockBalances,
    setOpeningStock,
    addAdjustment,
    getStdUnitPrice,
    getLastReceiptDate,
    openingStocks,
  };
}
