import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface SalesEntry {
  id: string;
  branchId: string;
  saleDate: string;
  receiptNo: string;
  menuCode: string;
  menuName: string;
  orderType: string;
  qty: number;
  unitPrice: number;
  netAmount: number;
  channel: string;
}

const toLocal = (r: any): SalesEntry => ({
  id: r.id,
  branchId: r.branch_id,
  saleDate: r.sale_date,
  receiptNo: r.receipt_no,
  menuCode: r.menu_code,
  menuName: r.menu_name,
  orderType: r.order_type,
  qty: Number(r.qty),
  unitPrice: Number(r.unit_price),
  netAmount: Number(r.net_amount),
  channel: r.channel,
});

export function useSalesEntryData() {
  const [entries, setEntries] = useState<SalesEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchEntries = useCallback(async (filters?: { branchId?: string; dateFrom?: string; dateTo?: string }) => {
    setLoading(true);
    let q = supabase.from('sales_entries').select('*').order('sale_date', { ascending: false }).order('created_at', { ascending: false });
    if (filters?.branchId) q = q.eq('branch_id', filters.branchId);
    if (filters?.dateFrom) q = q.gte('sale_date', filters.dateFrom);
    if (filters?.dateTo) q = q.lte('sale_date', filters.dateTo);
    const { data, error } = await q.limit(2000);
    if (error) { toast.error('Failed to load sales'); setLoading(false); return; }
    setEntries((data || []).map(toLocal));
    setLoading(false);
  }, []);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  const bulkInsert = useCallback(async (branchId: string, rows: Omit<SalesEntry, 'id' | 'branchId'>[]) => {
    // Build insert rows
    const insertRows = rows.map(r => ({
      branch_id: branchId,
      sale_date: r.saleDate,
      receipt_no: r.receiptNo,
      menu_code: r.menuCode,
      menu_name: r.menuName,
      order_type: r.orderType,
      qty: r.qty,
      unit_price: r.unitPrice,
      net_amount: r.netAmount,
      channel: r.channel,
    }));

    // Insert in chunks, using onConflict to skip duplicates
    let inserted = 0;
    let skipped = 0;
    const chunkSize = 500;
    for (let i = 0; i < insertRows.length; i += chunkSize) {
      const chunk = insertRows.slice(i, i + chunkSize);
      const { data, error } = await supabase
        .from('sales_entries')
        .upsert(chunk, { onConflict: 'branch_id,sale_date,receipt_no,menu_code', ignoreDuplicates: true })
        .select();
      if (error) {
        toast.error('Import error: ' + error.message);
        return { inserted, skipped };
      }
      inserted += (data?.length || 0);
    }
    skipped = rows.length - inserted;
    return { inserted, skipped };
  }, []);

  const deleteEntry = useCallback(async (id: string) => {
    const { error } = await supabase.from('sales_entries').delete().eq('id', id);
    if (error) { toast.error('Failed to delete'); return; }
    setEntries(prev => prev.filter(e => e.id !== id));
  }, []);

  return { entries, loading, fetchEntries, bulkInsert, deleteEntry };
}
