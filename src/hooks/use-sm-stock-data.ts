import { useState, useCallback, useMemo, useEffect } from 'react';
import { StockAdjustment } from '@/types/stock';
import { SKU } from '@/types/sku';
import { ProductionRecord } from '@/types/production';
import { Delivery } from '@/types/delivery';
import { BOMHeader } from '@/types/bom';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface SMStockBalance {
  skuId: string;
  openingStock: number;
  totalProduced: number;
  totalDelivered: number;
  adjustments: StockAdjustment[];
  currentStock: number;
}

export function useSmStockData(
  skus: SKU[],
  productionRecords: ProductionRecord[],
  deliveries: Delivery[],
  bomHeaders: BOMHeader[]
) {
  const [openingStocks, setOpeningStocksState] = useState<Record<string, number>>({});
  const [adjustments, setAdjustments] = useState<StockAdjustment[]>([]);

  useEffect(() => {
    // SM opening stocks use same table, just filter SM skus on client
    supabase.from('stock_opening_balances').select('*')
      .then(({ data }) => {
        if (data) {
          const map: Record<string, number> = {};
          data.forEach((r: any) => { map[r.sku_id] = r.quantity; });
          setOpeningStocksState(map);
        }
      });
    supabase.from('stock_adjustments').select('*').eq('stock_type', 'SM').order('created_at', { ascending: false })
      .then(({ data }) => {
        if (data) setAdjustments(data.map((r: any) => ({
          id: r.id, skuId: r.sku_id, date: r.adjustment_date, quantity: r.quantity, reason: r.reason,
        })));
      });
  }, []);

  const smSkus = useMemo(() => skus.filter(s => s.type === 'SM'), [skus]);

  const stockBalances = useMemo((): SMStockBalance[] => {
    return smSkus.map(sku => {
      const opening = openingStocks[sku.id] ?? 0;
      const totalProduced = productionRecords.filter(r => r.smSkuId === sku.id).reduce((sum, r) => sum + r.actualOutputG, 0);
      const totalDelivered = deliveries.filter(d => d.smSkuId === sku.id).reduce((sum, d) => sum + d.qtyDeliveredG, 0);
      const skuAdjustments = adjustments.filter(a => a.skuId === sku.id);
      const netAdjustment = skuAdjustments.reduce((sum, a) => sum + a.quantity, 0);
      const currentStock = opening + totalProduced - totalDelivered + netAdjustment;
      return { skuId: sku.id, openingStock: opening, totalProduced, totalDelivered, adjustments: skuAdjustments, currentStock };
    });
  }, [smSkus, productionRecords, deliveries, openingStocks, adjustments]);

  const setOpeningStock = useCallback(async (skuId: string, qty: number) => {
    const { error } = await supabase.from('stock_opening_balances').upsert(
      { sku_id: skuId, quantity: qty },
      { onConflict: 'sku_id' }
    );
    if (error) { toast.error('Failed to set opening stock: ' + error.message); return; }
    setOpeningStocksState(prev => ({ ...prev, [skuId]: qty }));
  }, []);

  const addAdjustment = useCallback(async (adj: Omit<StockAdjustment, 'id'>) => {
    const { data: row, error } = await supabase.from('stock_adjustments').insert({
      sku_id: adj.skuId, adjustment_date: adj.date, quantity: adj.quantity, reason: adj.reason, stock_type: 'SM',
    }).select().single();
    if (error) { toast.error('Failed to add adjustment: ' + error.message); return; }
    setAdjustments(prev => [{ id: row.id, skuId: row.sku_id, date: row.adjustment_date, quantity: row.quantity, reason: row.reason }, ...prev]);
  }, []);

  const getBomCostPerGram = useCallback((_skuId: string): number => 0, []);

  const getLastProductionDate = useCallback((skuId: string): string | null => {
    const recs = productionRecords.filter(r => r.smSkuId === skuId);
    if (recs.length === 0) return null;
    return recs.reduce((latest, r) => r.productionDate > latest ? r.productionDate : latest, recs[0].productionDate);
  }, [productionRecords]);

  return { stockBalances, setOpeningStock, addAdjustment, getBomCostPerGram, getLastProductionDate, openingStocks };
}
