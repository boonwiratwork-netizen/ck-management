import { useState, useCallback, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { toLocalDateStr } from '@/lib/utils';

export interface PendingTR {
  trId: string;
  trNumber: string;
  branchId: string;
  branchName: string;
  requestedDate: string;
  requiredDate: string;
  itemCount: number;
  lines: PendingTRLine[];
}

export interface PendingTRLine {
  id: string;
  skuId: string;
  skuCode: string;
  skuName: string;
  uom: string;
  requestedQty: number;
  skuType: 'SM' | 'RM';
}

export interface TOLine {
  id: string;
  skuId: string;
  skuCode: string;
  skuName: string;
  plannedQty: number;
  actualQty: number;
  uom: string;
  unitCost: number;
  lineValue: number;
  note: string;
  trLineId: string | null;
}

export interface TOHistoryRow {
  id: string;
  toNumber: string;
  deliveryDate: string;
  branchId: string;
  branchName: string;
  trRef: string;
  itemCount: number;
  totalValue: number;
  status: string;
  createdAt: string;
}

export function useTransferOrder(
  getBomCostPerGram?: (skuId: string) => number
) {
  const [pendingTRs, setPendingTRs] = useState<PendingTR[]>([]);
  const [toHistory, setToHistory] = useState<TOHistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // ─── Load pending TRs ───
  const fetchPendingTRs = useCallback(async () => {
    const { data: trs, error } = await supabase
      .from('transfer_requests')
      .select('id, tr_number, branch_id, requested_date, required_date, status')
      .eq('status', 'Submitted')
      .order('required_date', { ascending: true });
    if (error || !trs) { setPendingTRs([]); return; }

    if (trs.length === 0) { setPendingTRs([]); return; }

    // Get branch names
    const branchIds = [...new Set(trs.map(t => t.branch_id))];
    const { data: branches } = await supabase
      .from('branches')
      .select('id, branch_name')
      .in('id', branchIds);
    const bMap: Record<string, string> = {};
    for (const b of branches || []) bMap[b.id] = b.branch_name;

    // Get TR lines
    const trIds = trs.map(t => t.id);
    const { data: allLines } = await supabase
      .from('transfer_request_lines')
      .select('id, tr_id, sku_id, requested_qty, uom, sku_type')
      .in('tr_id', trIds);

    // Get SKU info
    const skuIds = [...new Set((allLines || []).map(l => l.sku_id))];
    let skuMap: Record<string, { code: string; name: string }> = {};
    if (skuIds.length > 0) {
      const { data: skus } = await supabase
        .from('skus')
        .select('id, sku_id, name')
        .in('id', skuIds);
      for (const s of skus || []) skuMap[s.id] = { code: s.sku_id, name: s.name };
    }

    setPendingTRs(trs.map(tr => {
      const trLines = (allLines || []).filter(l => l.tr_id === tr.id);
      return {
        trId: tr.id,
        trNumber: tr.tr_number,
        branchId: tr.branch_id,
        branchName: bMap[tr.branch_id] || '',
        requestedDate: tr.requested_date,
        requiredDate: tr.required_date,
        itemCount: trLines.length,
        lines: trLines.map(l => ({
          id: l.id,
          skuId: l.sku_id,
          skuCode: skuMap[l.sku_id]?.code || '',
          skuName: skuMap[l.sku_id]?.name || '',
          uom: l.uom,
          requestedQty: l.requested_qty,
        })),
      };
    }));
  }, []);

  useEffect(() => { fetchPendingTRs(); }, [fetchPendingTRs]);

  // ─── Create TO ───
  const createTO = useCallback(async (params: {
    trId?: string;
    branchId: string;
    deliveryDate: string;
    notes?: string;
    profileId?: string;
    trLines?: PendingTRLine[];
  }): Promise<{ toId: string; toNumber: string; lines: TOLine[] } | { error: string }> => {
    try {
      const now = new Date();
      const { data: toNumber, error: rpcError } = await supabase.rpc('next_doc_number', {
        p_type: 'TO',
        p_year: now.getFullYear(),
        p_month: now.getMonth() + 1,
      });
      if (rpcError || !toNumber) return { error: rpcError?.message || 'Failed to generate TO number' };

      const { data: toRow, error: toError } = await supabase
        .from('transfer_orders')
        .insert({
          to_number: toNumber,
          tr_id: params.trId || null,
          branch_id: params.branchId,
          status: 'Draft',
          delivery_date: params.deliveryDate,
          notes: params.notes || '',
          created_by: params.profileId || null,
          total_value: 0,
        })
        .select('id')
        .single();
      if (toError || !toRow) return { error: toError?.message || 'Failed to create TO' };

      let toLines: TOLine[] = [];

      if (params.trId && params.trLines && params.trLines.length > 0) {
        const lineInserts = params.trLines.map(l => {
          const costPerG = getBomCostPerGram?.(l.skuId) ?? 0;
          return {
            to_id: toRow.id,
            sku_id: l.skuId,
            planned_qty: l.requestedQty,
            actual_qty: l.requestedQty,
            uom: l.uom,
            unit_cost: costPerG,
            line_value: l.requestedQty * costPerG,
            notes: '',
            tr_line_id: l.id,
          };
        });

        const { data: insertedLines, error: lErr } = await supabase
          .from('transfer_order_lines')
          .insert(lineInserts)
          .select();
        if (lErr) return { error: lErr.message };

        toLines = (insertedLines || []).map(il => {
          const trLine = params.trLines!.find(tl => tl.skuId === il.sku_id);
          return {
            id: il.id,
            skuId: il.sku_id,
            skuCode: trLine?.skuCode || '',
            skuName: trLine?.skuName || '',
            plannedQty: il.planned_qty,
            actualQty: il.actual_qty,
            uom: il.uom,
            unitCost: il.unit_cost,
            lineValue: il.line_value,
            note: il.notes,
            trLineId: il.tr_line_id,
          };
        });

        // Update TR status to Acknowledged
        await supabase
          .from('transfer_requests')
          .update({ status: 'Acknowledged' })
          .eq('id', params.trId);
      }

      fetchPendingTRs();
      return { toId: toRow.id, toNumber, lines: toLines };
    } catch (e: any) {
      return { error: e.message || 'Unknown error' };
    }
  }, [getBomCostPerGram, fetchPendingTRs]);

  // ─── Update TO line ───
  const updateTOLine = useCallback(async (lineId: string, actualQty: number, note?: string) => {
    const costUpdate: any = { actual_qty: actualQty };
    if (note !== undefined) costUpdate.notes = note;
    // line_value will be recalculated on send
    const { error } = await supabase
      .from('transfer_order_lines')
      .update(costUpdate)
      .eq('id', lineId);
    if (error) toast.error('Failed to update line');
    return !error;
  }, []);

  // ─── Send TO ───
  const sendTO = useCallback(async (toId: string, lines: TOLine[]): Promise<{ error?: string }> => {
    // Recalculate line values
    let totalValue = 0;
    for (const line of lines) {
      const lv = line.actualQty * line.unitCost;
      totalValue += lv;
      await supabase
        .from('transfer_order_lines')
        .update({ actual_qty: line.actualQty, line_value: lv, notes: line.note })
        .eq('id', line.id);
    }

    // Get TO to check for TR
    const { data: to } = await supabase
      .from('transfer_orders')
      .select('tr_id')
      .eq('id', toId)
      .single();

    // Update TO status
    const { error } = await supabase
      .from('transfer_orders')
      .update({ status: 'Sent', total_value: totalValue })
      .eq('id', toId);
    if (error) return { error: error.message };

    // Update linked TR to Fulfilled
    if (to?.tr_id) {
      await supabase
        .from('transfer_requests')
        .update({ status: 'Fulfilled' })
        .eq('id', to.tr_id);
    }

    fetchPendingTRs();
    return {};
  }, [fetchPendingTRs]);

  // ─── Cancel TO ───
  const cancelTO = useCallback(async (toId: string) => {
    const { error } = await supabase
      .from('transfer_orders')
      .update({ status: 'Cancelled' })
      .eq('id', toId);
    if (error) { toast.error('Failed to cancel TO'); return; }
    toast.success('TO cancelled');
    fetchHistory();
  }, []);

  // ─── History ───
  const fetchHistory = useCallback(async (filters?: {
    branchId?: string;
    status?: string;
    dateFrom?: string;
    dateTo?: string;
  }) => {
    setHistoryLoading(true);
    let query = supabase
      .from('transfer_orders')
      .select('id, to_number, delivery_date, branch_id, tr_id, total_value, status, notes, created_at')
      .order('created_at', { ascending: false });

    if (filters?.branchId) query = query.eq('branch_id', filters.branchId);
    if (filters?.status && filters.status !== 'All') query = query.eq('status', filters.status);
    if (filters?.dateFrom) query = query.gte('delivery_date', filters.dateFrom);
    if (filters?.dateTo) query = query.lte('delivery_date', filters.dateTo);

    const { data, error } = await query;
    if (error) { toast.error('Failed to load TO history'); setHistoryLoading(false); return; }

    // Branch names
    const branchIds = [...new Set((data || []).map(d => d.branch_id))];
    let bMap: Record<string, string> = {};
    if (branchIds.length > 0) {
      const { data: branches } = await supabase.from('branches').select('id, branch_name').in('id', branchIds);
      for (const b of branches || []) bMap[b.id] = b.branch_name;
    }

    // TR numbers
    const trIds = [...new Set((data || []).map(d => d.tr_id).filter(Boolean))];
    let trMap: Record<string, string> = {};
    if (trIds.length > 0) {
      const { data: trs } = await supabase.from('transfer_requests').select('id, tr_number').in('id', trIds as string[]);
      for (const t of trs || []) trMap[t.id] = t.tr_number;
    }

    // Line counts
    const toIds = (data || []).map(d => d.id);
    let lineCounts: Record<string, number> = {};
    if (toIds.length > 0) {
      const { data: lineData } = await supabase.from('transfer_order_lines').select('to_id').in('to_id', toIds);
      for (const l of lineData || []) lineCounts[l.to_id] = (lineCounts[l.to_id] || 0) + 1;
    }

    setToHistory((data || []).map(d => ({
      id: d.id,
      toNumber: d.to_number,
      deliveryDate: d.delivery_date,
      branchId: d.branch_id,
      branchName: bMap[d.branch_id] || '',
      trRef: d.tr_id ? (trMap[d.tr_id] || '—') : '—',
      itemCount: lineCounts[d.id] || 0,
      totalValue: d.total_value,
      status: d.status,
      createdAt: d.created_at,
    })));
    setHistoryLoading(false);
  }, []);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  // ─── Fetch TO detail lines ───
  const fetchTODetail = useCallback(async (toId: string): Promise<TOLine[]> => {
    const { data, error } = await supabase
      .from('transfer_order_lines')
      .select('id, sku_id, planned_qty, actual_qty, uom, unit_cost, line_value, notes, tr_line_id')
      .eq('to_id', toId);
    if (error || !data) return [];

    const skuIds = [...new Set(data.map(d => d.sku_id))];
    let skuMap: Record<string, { code: string; name: string }> = {};
    if (skuIds.length > 0) {
      const { data: skus } = await supabase.from('skus').select('id, sku_id, name').in('id', skuIds);
      for (const s of skus || []) skuMap[s.id] = { code: s.sku_id, name: s.name };
    }

    return data.map(d => ({
      id: d.id,
      skuId: d.sku_id,
      skuCode: skuMap[d.sku_id]?.code || '',
      skuName: skuMap[d.sku_id]?.name || '',
      plannedQty: d.planned_qty,
      actualQty: d.actual_qty,
      uom: d.uom,
      unitCost: d.unit_cost,
      lineValue: d.line_value,
      note: d.notes,
      trLineId: d.tr_line_id,
    }));
  }, []);

  // ─── Add standalone line ───
  const addTOLine = useCallback(async (toId: string, skuId: string, skuCode: string, skuName: string, uom: string): Promise<TOLine | null> => {
    const costPerG = getBomCostPerGram?.(skuId) ?? 0;
    const { data, error } = await supabase
      .from('transfer_order_lines')
      .insert({
        to_id: toId,
        sku_id: skuId,
        planned_qty: 0,
        actual_qty: 0,
        uom,
        unit_cost: costPerG,
        line_value: 0,
        notes: '',
        tr_line_id: null,
      })
      .select()
      .single();
    if (error || !data) { toast.error('Failed to add item'); return null; }
    return {
      id: data.id,
      skuId: data.sku_id,
      skuCode,
      skuName,
      plannedQty: 0,
      actualQty: 0,
      uom,
      unitCost: costPerG,
      lineValue: 0,
      note: '',
      trLineId: null,
    };
  }, [getBomCostPerGram]);

  // ─── Delete TO line ───
  const deleteTOLine = useCallback(async (lineId: string) => {
    const { error } = await supabase
      .from('transfer_order_lines')
      .delete()
      .eq('id', lineId);
    if (error) { toast.error('Failed to delete line'); return false; }
    return true;
  }, []);

  return {
    pendingTRs,
    toHistory,
    historyLoading,
    isLoading,
    createTO,
    updateTOLine,
    sendTO,
    cancelTO,
    fetchHistory,
    fetchTODetail,
    fetchPendingTRs,
    addTOLine,
    deleteTOLine,
  };
}
