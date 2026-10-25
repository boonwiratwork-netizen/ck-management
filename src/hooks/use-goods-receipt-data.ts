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
  createdAt: row.created_at,
});

function getNinetyDaysAgo(): string {
  const d = new Date();
  d.setDate(d.getDate() - 90);
  return d.toISOString().split('T')[0];
}

export function useGoodsReceiptData(enabled = true) {
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
    // Kitchen data loads only once a kitchen page is opened (see Index)
    if (!enabled) return;
    fetchReceipts(false);
  }, [fetchReceipts, enabled]);

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

  /** A whole bill in one insert: either every line is saved or none is */
  const addReceipts = useCallback(async (
    rows: { data: Omit<GoodsReceipt, 'id' | 'weekNumber' | 'usageUom' | 'stdUnitPrice' | 'standardPrice' | 'priceVariance' | 'actualUnitPrice'>; sku: SKU | undefined }[],
    prices: Price[]
  ): Promise<boolean> => {
    if (rows.length === 0) return true;
    const { data, error } = await supabase.from('goods_receipts').insert(rows.map((r) => buildDbRow(r.data, r.sku, prices))).select();
    if (error) { toast.error('บันทึกบิลไม่สำเร็จ: ' + error.message); return false; }
    setReceipts(prev => [...(data || []).map(toLocal), ...prev]);
    return true;
  }, []);

  const updateReceipt = useCallback(async (
    id: string,
    data: Omit<GoodsReceipt, 'id' | 'weekNumber' | 'usageUom' | 'stdUnitPrice' | 'standardPrice' | 'priceVariance' | 'actualUnitPrice'>,
    sku: SKU | undefined,
    prices: Price[]
  ) => {
    const dbRow = buildDbRow(data, sku, prices);
    const { error } = await supabase.from('goods_receipts').update(dbRow).eq('id', id);
    if (error) { toast.error('แก้รายการไม่สำเร็จ: ' + error.message); return false; }
    setReceipts(prev => prev.map(r => r.id === id ? { ...r, ...toLocal({ id, created_at: r.createdAt, ...dbRow }) } : r));
    return true;
  }, []);

  /**
   * Fix a saved line: quantity, amount, note. Keeps the standard price stored on
   * the line (a later price change must not rewrite an old line's variance).
   */
  const editReceipt = useCallback(async (r: GoodsReceipt, qty: number, total: number, note: string): Promise<boolean> => {
    const standard = r.stdUnitPrice * qty;
    const patch = {
      quantity_received: qty,
      actual_total: total,
      actual_unit_price: qty > 0 ? total / qty : 0,
      standard_price: standard,
      price_variance: total - standard,
      note,
    };
    const { error } = await supabase.from('goods_receipts').update(patch).eq('id', r.id);
    if (error) { toast.error('แก้รายการไม่สำเร็จ: ' + error.message); return false; }
    setReceipts(prev => prev.map(x => x.id === r.id ? { ...x, quantityReceived: qty, actualTotal: total, actualUnitPrice: patch.actual_unit_price, standardPrice: standard, priceVariance: patch.price_variance, note } : x));
    return true;
  }, []);

  const deleteReceipt = useCallback(async (id: string) => {
    const { error } = await supabase.from('goods_receipts').delete().eq('id', id);
    if (error) { toast.error('ลบรายการรับของไม่สำเร็จ: ' + error.message); return false; }
    setReceipts(prev => prev.filter(r => r.id !== id));
    return true;
  }, []);

  return { receipts, addReceipt, addReceipts, updateReceipt, editReceipt, deleteReceipt, isFullHistory, loadAllHistory, isLoadingAll, fetchReceipts };
}
