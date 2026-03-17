import { useState, useCallback, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { toLocalDateStr } from '@/lib/utils';
import { useBranchSmStock, BranchSmStockStatus } from '@/hooks/use-branch-sm-stock';

export interface TRLine {
  skuId: string;
  skuCode: string;
  skuName: string;
  uom: string;
  packSize: number;
  requestedQty: number;
  suggestedQty: number;
  suggestedBatches: number;
  stockOnHand: number;
  avgDailyUsage: number;
  peakDailyUsage: number;
  rop: number;
  parstock: number;
  status: BranchSmStockStatus;
}

export interface TRHistoryRow {
  id: string;
  trNumber: string;
  branchId: string;
  branchName: string;
  requestedDate: string;
  requiredDate: string;
  status: string;
  notes: string;
  itemCount: number;
  createdAt: string;
}

export interface TRDetailLine {
  id: string;
  skuId: string;
  skuCode: string;
  skuName: string;
  uom: string;
  packSize: number;
  requestedQty: number;
  suggestedQty: number;
  stockOnHand: number;
  avgDailyUsage: number;
  peakDailyUsage: number;
  rop: number;
  parstock: number;
}

const statusOrder: Record<BranchSmStockStatus, number> = {
  'critical': 0,
  'low': 1,
  'sufficient': 2,
  'no-data': 3,
};

export function useTransferRequest(branchId: string | null, profileId: string | null) {
  const { smStock, smSkuList, loading: stockLoading, refresh: refreshStock } = useBranchSmStock(branchId);
  const [lines, setLines] = useState<TRLine[]>([]);
  const [requiredDate, setRequiredDate] = useState<Date | undefined>(undefined);
  const [notes, setNotes] = useState('');
  const [history, setHistory] = useState<TRHistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Build lines from smStock + smSkuList
  useEffect(() => {
    if (smSkuList.length === 0) { setLines([]); return; }
    const newLines: TRLine[] = smSkuList.map(sku => {
      const stock = smStock[sku.skuId] || {
        stockOnHand: 0, avgDailyUsage: 0, peakDailyUsage: 0,
        rop: 0, parstock: 0, suggestedOrder: 0, status: 'no-data' as BranchSmStockStatus,
      };
      const ps = sku.packSize || 1;
      return {
        skuId: sku.skuId,
        skuCode: sku.skuCode,
        skuName: sku.skuName,
        uom: sku.uom,
        packSize: ps,
        requestedQty: 0, // No pre-fill — empty by default
        suggestedQty: stock.suggestedOrder,
        suggestedBatches: stock.suggestedOrder > 0 ? Math.ceil(stock.suggestedOrder / ps) : 0,
        stockOnHand: stock.stockOnHand,
        avgDailyUsage: stock.avgDailyUsage,
        peakDailyUsage: stock.peakDailyUsage,
        rop: stock.rop,
        parstock: stock.parstock,
        status: stock.status,
      };
    });
    // Sort: critical → low → sufficient → no-data
    newLines.sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);
    setLines(newLines);
  }, [smStock, smSkuList]);

  // Update line by batches — stores requestedQty in grams (batches × packSize)
  const updateLineQty = useCallback((skuId: string, batches: number) => {
    setLines(prev => prev.map(l => {
      if (l.skuId !== skuId) return l;
      const b = Math.max(0, Math.round(batches));
      return { ...l, requestedQty: b * l.packSize };
    }));
  }, []);

  const itemsToOrder = useMemo(() => lines.filter(l => l.requestedQty > 0).length, [lines]);

  const canSubmit = useMemo(() => {
    return !!requiredDate && itemsToOrder > 0;
  }, [requiredDate, itemsToOrder]);

  const submitTR = useCallback(async (): Promise<{ trNumber: string } | { error: string }> => {
    if (!branchId) return { error: 'No branch assigned' };
    if (!requiredDate) return { error: 'Required date must be set' };
    if (itemsToOrder === 0) return { error: 'At least one item must have quantity > 0' };

    try {
      const now = new Date();
      const { data: trNumber, error: rpcError } = await supabase
        .rpc('next_doc_number', {
          p_type: 'TR',
          p_year: now.getFullYear(),
          p_month: now.getMonth() + 1,
        });
      if (rpcError || !trNumber) return { error: rpcError?.message || 'Failed to generate TR number' };

      const { data: trRow, error: trError } = await supabase
        .from('transfer_requests')
        .insert({
          tr_number: trNumber,
          branch_id: branchId,
          requested_by: profileId,
          requested_date: toLocalDateStr(now),
          required_date: toLocalDateStr(requiredDate),
          status: 'Submitted',
          notes: notes,
        })
        .select('id')
        .single();
      if (trError || !trRow) return { error: trError?.message || 'Failed to create TR' };

      const lineInserts = lines
        .filter(l => l.requestedQty > 0)
        .map(l => ({
          tr_id: trRow.id,
          sku_id: l.skuId,
          requested_qty: l.requestedQty,
          uom: l.uom,
          suggested_qty: l.suggestedQty,
          stock_on_hand: l.stockOnHand,
          avg_daily_usage: l.avgDailyUsage,
          peak_daily_usage: l.peakDailyUsage,
          rop: l.rop,
          parstock: l.parstock,
          notes: '',
        }));

      const { error: linesError } = await supabase
        .from('transfer_request_lines')
        .insert(lineInserts);
      if (linesError) return { error: linesError.message };

      setRequiredDate(undefined);
      setNotes('');
      refreshStock();
      fetchHistory();
      return { trNumber };
    } catch (e: any) {
      return { error: e.message || 'Unknown error' };
    }
  }, [branchId, profileId, requiredDate, notes, lines, itemsToOrder, refreshStock]);

  // ─── History ───
  const fetchHistory = useCallback(async (filters?: {
    branchId?: string;
    status?: string;
    dateFrom?: string;
    dateTo?: string;
  }) => {
    setHistoryLoading(true);
    let query = supabase
      .from('transfer_requests')
      .select('id, tr_number, branch_id, requested_date, required_date, status, notes, created_at')
      .order('created_at', { ascending: false });

    const filterBranch = filters?.branchId || branchId;
    if (filterBranch) query = query.eq('branch_id', filterBranch);
    if (filters?.status && filters.status !== 'All') query = query.eq('status', filters.status);
    if (filters?.dateFrom) query = query.gte('requested_date', filters.dateFrom);
    if (filters?.dateTo) query = query.lte('requested_date', filters.dateTo);

    const { data, error } = await query;
    if (error) { toast.error('Failed to load TR history'); setHistoryLoading(false); return; }

    const trIds = (data || []).map(d => d.id);
    let lineCounts: Record<string, number> = {};
    if (trIds.length > 0) {
      const { data: lineData } = await supabase
        .from('transfer_request_lines')
        .select('tr_id')
        .in('tr_id', trIds);
      for (const l of lineData || []) {
        lineCounts[l.tr_id] = (lineCounts[l.tr_id] || 0) + 1;
      }
    }

    const branchIds = [...new Set((data || []).map(d => d.branch_id))];
    let branchNames: Record<string, string> = {};
    if (branchIds.length > 0) {
      const { data: branches } = await supabase
        .from('branches')
        .select('id, branch_name')
        .in('id', branchIds);
      for (const b of branches || []) {
        branchNames[b.id] = b.branch_name;
      }
    }

    setHistory((data || []).map(d => ({
      id: d.id,
      trNumber: d.tr_number,
      branchId: d.branch_id,
      branchName: branchNames[d.branch_id] || '',
      requestedDate: d.requested_date,
      requiredDate: d.required_date,
      status: d.status,
      notes: d.notes,
      itemCount: lineCounts[d.id] || 0,
      createdAt: d.created_at,
    })));
    setHistoryLoading(false);
  }, [branchId]);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  const fetchTRDetail = useCallback(async (trId: string): Promise<TRDetailLine[]> => {
    const { data, error } = await supabase
      .from('transfer_request_lines')
      .select('id, sku_id, requested_qty, uom, suggested_qty, stock_on_hand, avg_daily_usage, peak_daily_usage, rop, parstock')
      .eq('tr_id', trId);
    if (error || !data) return [];

    const skuIds = data.map(d => d.sku_id);
    const { data: skus } = await supabase
      .from('skus')
      .select('id, sku_id, name, pack_size')
      .in('id', skuIds);
    const skuMap: Record<string, { code: string; name: string; packSize: number }> = {};
    for (const s of skus || []) {
      skuMap[s.id] = { code: s.sku_id, name: s.name, packSize: s.pack_size };
    }

    return data.map(d => ({
      id: d.id,
      skuId: d.sku_id,
      skuCode: skuMap[d.sku_id]?.code || '',
      skuName: skuMap[d.sku_id]?.name || '',
      uom: d.uom,
      requestedQty: d.requested_qty,
      suggestedQty: d.suggested_qty,
      stockOnHand: d.stock_on_hand,
      avgDailyUsage: d.avg_daily_usage,
      peakDailyUsage: d.peak_daily_usage,
      rop: d.rop,
      parstock: d.parstock,
    }));
  }, []);

  const cancelTR = useCallback(async (trId: string) => {
    const { error } = await supabase
      .from('transfer_requests')
      .update({ status: 'Cancelled' })
      .eq('id', trId);
    if (error) { toast.error('Failed to cancel TR'); return; }
    toast.success('TR cancelled');
    fetchHistory();
  }, [fetchHistory]);

  return {
    lines,
    updateLineQty,
    isLoading: stockLoading,
    requiredDate,
    setRequiredDate,
    notes,
    setNotes,
    submitTR,
    canSubmit,
    itemsToOrder,
    history,
    historyLoading,
    fetchHistory,
    fetchTRDetail,
    cancelTR,
  };
}
