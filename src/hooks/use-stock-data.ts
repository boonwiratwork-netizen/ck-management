import { useState, useCallback, useMemo, useEffect } from 'react';
import { StockBalance, StockAdjustment } from '@/types/stock';
import { GoodsReceipt } from '@/types/goods-receipt';
import { SKU } from '@/types/sku';
import { Price } from '@/types/price';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export function useStockData(
  skus: SKU[],
  receipts: GoodsReceipt[],
  prices: Price[]
) {
  const [openingStocks, setOpeningStocksState] = useState<Record<string, number>>({});
  const [adjustments, setAdjustments] = useState<StockAdjustment[]>([]);

  // Load opening balances and adjustments
  useEffect(() => {
    supabase.from('stock_opening_balances').select('*')
      .then(({ data }) => {
        if (data) {
          const map: Record<string, number> = {};
          data.forEach((r: any) => { map[r.sku_id] = r.quantity; });
          setOpeningStocksState(map);
        }
      });
    supabase.from('stock_adjustments').select('*').eq('stock_type', 'RM').order('created_at', { ascending: false })
      .then(({ data }) => {
        if (data) setAdjustments(data.map((r: any) => ({
          id: r.id, skuId: r.sku_id, date: r.adjustment_date, quantity: r.quantity, reason: r.reason,
        })));
      });
  }, []);

  const rmSkus = useMemo(() => skus.filter(s => s.type === 'RM'), [skus]);

  const stockBalances = useMemo((): StockBalance[] => {
    return rmSkus.map(sku => {
      const opening = openingStocks[sku.id] ?? 0;
      const totalReceived = receipts
        .filter(r => r.skuId === sku.id)
        .reduce((sum, r) => sum + r.quantityReceived, 0);
      const totalConsumed = 0;
      const skuAdjustments = adjustments.filter(a => a.skuId === sku.id);
      const netAdjustment = skuAdjustments.reduce((sum, a) => sum + a.quantity, 0);
      const currentStock = opening + totalReceived - totalConsumed + netAdjustment;
      return { skuId: sku.id, openingStock: opening, totalReceived, totalConsumed, adjustments: skuAdjustments, currentStock };
    });
  }, [rmSkus, receipts, openingStocks, adjustments]);

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
      sku_id: adj.skuId, adjustment_date: adj.date, quantity: adj.quantity, reason: adj.reason, stock_type: 'RM',
    }).select().single();
    if (error) { toast.error('Failed to add adjustment: ' + error.message); return; }
    setAdjustments(prev => [{ id: row.id, skuId: row.sku_id, date: row.adjustment_date, quantity: row.quantity, reason: row.reason }, ...prev]);
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

  return { stockBalances, setOpeningStock, addAdjustment, getStdUnitPrice, getLastReceiptDate, openingStocks };
}
