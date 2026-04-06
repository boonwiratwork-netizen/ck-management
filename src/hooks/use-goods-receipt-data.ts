import { useState, useCallback, useEffect } from 'react';
import { GoodsReceipt, getWeekNumber } from '@/types/goods-receipt';
import { SKU } from '@/types/sku';
import { Price } from '@/types/price';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const toLocal = (row: any): GoodsReceipt => ({
  id: row.id,
  receiptDate: row.receipt_date,
  weekNumber: row.week_number,
  skuId: row.sku_id,
  supplierId: row.supplier_id,
  quantityReceived: row.quantity_received,
  usageUom: row.usage_uom,
  actualTotal: row.actual_total,
  actualUnitPrice: row.actual_unit_price,
  stdUnitPrice: row.std_unit_price,
  standardPrice: row.standard_price,
  priceVariance: row.price_variance,
  note: row.note,
});

function getNinetyDaysAgo(): string {
  const d = new Date();
  d.setDate(d.getDate() - 90);
  return d.toISOString().split('T')[0];
}

export function useGoodsReceiptData() {
  const [receipts, setReceipts] = useState<GoodsReceipt[]>([]);
  const [isFullHistory, setIsFullHistory] = useState(false);
  const [isLoadingAll, setIsLoadingAll] = useState(false);

  const fetchReceipts = useCallback(async (fullHistory: boolean) => {
    let query = supabase.from('goods_receipts').select('*').order('created_at', { ascending: false });
    if (!fullHistory) {
      query = query.gte('receipt_date', getNinetyDaysAgo());
    }
    const { data, error } = await query;
    if (error) { toast.error('Failed to load goods receipts'); return; }
    setReceipts((data || []).map(toLocal));
    setIsFullHistory(fullHistory);
  }, []);

  useEffect(() => {
    fetchReceipts(false);
  }, [fetchReceipts]);

  const loadAllHistory = useCallback(async () => {
    setIsLoadingAll(true);
    await fetchReceipts(true);
    setIsLoadingAll(false);
  }, [fetchReceipts]);

  const getStdUnitPrice = (skuId: string, supplierId: string, prices: Price[]): number => {
    const active = prices.find(p => p.skuId === skuId && p.supplierId === supplierId && p.isActive);
    return active?.pricePerUsageUom ?? 0;
  };

  const buildDbRow = (
    data: Omit<GoodsReceipt, 'id' | 'weekNumber' | 'usageUom' | 'stdUnitPrice' | 'standardPrice' | 'priceVariance' | 'actualUnitPrice'>,
    sku: SKU | undefined,
    prices: Price[]
  ) => {
    const stdUnit = getStdUnitPrice(data.skuId, data.supplierId, prices);
    const standardPrice = stdUnit * data.quantityReceived;
    const actualUnitPrice = data.quantityReceived > 0 ? data.actualTotal / data.quantityReceived : 0;
    return {
      receipt_date: data.receiptDate,
      week_number: getWeekNumber(data.receiptDate),
      sku_id: data.skuId,
      supplier_id: data.supplierId,
      quantity_received: data.quantityReceived,
      usage_uom: sku?.usageUom ?? '',
      actual_total: data.actualTotal,
      actual_unit_price: actualUnitPrice,
      std_unit_price: stdUnit,
      standard_price: standardPrice,
      price_variance: data.actualTotal - standardPrice,
      note: data.note,
    };
  };

  const addReceipt = useCallback(async (
    data: Omit<GoodsReceipt, 'id' | 'weekNumber' | 'usageUom' | 'stdUnitPrice' | 'standardPrice' | 'priceVariance' | 'actualUnitPrice'>,
    sku: SKU | undefined,
    prices: Price[]
  ) => {
    const dbRow = buildDbRow(data, sku, prices);
    const { data: row, error } = await supabase.from('goods_receipts').insert(dbRow).select().single();
    if (error) { toast.error('Failed to add receipt: ' + error.message); return; }
    setReceipts(prev => [toLocal(row), ...prev]);
  }, []);

  const updateReceipt = useCallback(async (
    id: string,
    data: Omit<GoodsReceipt, 'id' | 'weekNumber' | 'usageUom' | 'stdUnitPrice' | 'standardPrice' | 'priceVariance' | 'actualUnitPrice'>,
    sku: SKU | undefined,
    prices: Price[]
  ) => {
    const dbRow = buildDbRow(data, sku, prices);
    const { error } = await supabase.from('goods_receipts').update(dbRow).eq('id', id);
    if (error) { toast.error('Failed to update receipt: ' + error.message); return; }
    setReceipts(prev => prev.map(r => r.id === id ? { ...r, ...toLocal({ id, ...dbRow }) } : r));
  }, []);

  const deleteReceipt = useCallback(async (id: string) => {
    const { error } = await supabase.from('goods_receipts').delete().eq('id', id);
    if (error) { toast.error('Failed to delete receipt: ' + error.message); return; }
    setReceipts(prev => prev.filter(r => r.id !== id));
  }, []);

  return { receipts, addReceipt, updateReceipt, deleteReceipt, isFullHistory, loadAllHistory, isLoadingAll, fetchReceipts };
}
