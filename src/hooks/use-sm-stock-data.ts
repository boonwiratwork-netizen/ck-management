import { useState, useCallback, useMemo } from 'react';
import { StockAdjustment } from '@/types/stock';
import { SKU } from '@/types/sku';
import { ProductionRecord } from '@/types/production';
import { Delivery } from '@/types/delivery';
import { BOMHeader } from '@/types/bom';

export interface SMStockBalance {
  skuId: string;
  openingStock: number;
  totalProduced: number;       // sum of production record outputs (kg)
  totalDelivered: number;      // sum of deliveries (kg)
  adjustments: StockAdjustment[];
  currentStock: number;        // opening + produced - delivered + adjustments
}

export function useSmStockData(
  skus: SKU[],
  productionRecords: ProductionRecord[],
  deliveries: Delivery[],
  bomHeaders: BOMHeader[]
) {
  const [openingStocks, setOpeningStocks] = useState<Record<string, number>>({});
  const [adjustments, setAdjustments] = useState<StockAdjustment[]>([]);

  const smSkus = useMemo(() => skus.filter(s => s.type === 'SM'), [skus]);

  const stockBalances = useMemo((): SMStockBalance[] => {
    return smSkus.map(sku => {
      const opening = openingStocks[sku.id] ?? 0;
      const totalProduced = productionRecords
        .filter(r => r.smSkuId === sku.id)
        .reduce((sum, r) => sum + r.actualOutputKg, 0);
      const totalDelivered = deliveries
        .filter(d => d.smSkuId === sku.id)
        .reduce((sum, d) => sum + d.qtyDeliveredKg, 0);
      const skuAdjustments = adjustments.filter(a => a.skuId === sku.id);
      const netAdjustment = skuAdjustments.reduce((sum, a) => sum + a.quantity, 0);
      const currentStock = opening + totalProduced - totalDelivered + netAdjustment;

      return {
        skuId: sku.id,
        openingStock: opening,
        totalProduced,
        totalDelivered,
        adjustments: skuAdjustments,
        currentStock,
      };
    });
  }, [smSkus, productionRecords, deliveries, openingStocks, adjustments]);

  const setOpeningStock = useCallback((skuId: string, qty: number) => {
    setOpeningStocks(prev => ({ ...prev, [skuId]: qty }));
  }, []);

  const addAdjustment = useCallback((adj: Omit<StockAdjustment, 'id'>) => {
    const newAdj: StockAdjustment = { ...adj, id: crypto.randomUUID() };
    setAdjustments(prev => [newAdj, ...prev]);
  }, []);

  const getBomCostPerGram = useCallback((skuId: string): number => {
    // BOM cost per gram = we'd need price data; for now return 0
    // This would be calculated from BOM lines costs / output qty
    return 0;
  }, []);

  const getLastProductionDate = useCallback((skuId: string): string | null => {
    const records = productionRecords.filter(r => r.smSkuId === skuId);
    if (records.length === 0) return null;
    return records.reduce((latest, r) =>
      r.productionDate > latest ? r.productionDate : latest, records[0].productionDate
    );
  }, [productionRecords]);

  return {
    stockBalances,
    setOpeningStock,
    addAdjustment,
    getBomCostPerGram,
    getLastProductionDate,
    openingStocks,
  };
}
