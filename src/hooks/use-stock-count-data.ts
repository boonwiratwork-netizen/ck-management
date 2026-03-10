import { useState, useCallback, useEffect } from 'react';
import { StockCountSession, StockCountLine } from '@/types/stock-count';
import { StockBalance, StockAdjustment } from '@/types/stock';
import { SMStockBalance } from '@/hooks/use-sm-stock-data';
import { SKU } from '@/types/sku';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const toSession = (r: any): StockCountSession => ({
  id: r.id, date: r.count_date, note: r.note, status: r.status,
  createdAt: r.created_at, completedAt: r.completed_at ?? undefined,
  deletedAt: r.deleted_at ?? undefined,
});
const toLine = (r: any): StockCountLine => ({
  id: r.id, sessionId: r.session_id, skuId: r.sku_id, type: r.type,
  systemQty: r.system_qty, physicalQty: r.physical_qty, variance: r.variance, note: r.note,
});

interface UseStockCountDataProps {
  skus: SKU[];
  rmStockBalances: StockBalance[];
  smStockBalances: SMStockBalance[];
  addRmAdjustment: (adj: Omit<StockAdjustment, 'id'>) => void;
  addSmAdjustment: (adj: Omit<StockAdjustment, 'id'>) => void;
  getStdUnitPrice: (skuId: string) => number;
}

export function useStockCountData({
  skus, rmStockBalances, smStockBalances, addRmAdjustment, addSmAdjustment, getStdUnitPrice,
}: UseStockCountDataProps) {
  const [sessions, setSessions] = useState<StockCountSession[]>([]);
  const [lines, setLines] = useState<StockCountLine[]>([]);

  useEffect(() => {
    Promise.all([
      supabase.from('stock_count_sessions').select('*').is('deleted_at', null).order('created_at', { ascending: false }),
      supabase.from('stock_count_lines').select('*').order('created_at', { ascending: false }),
    ]).then(([s, l]) => {
      if (!s.error) setSessions((s.data || []).map(toSession));
      if (!l.error) setLines((l.data || []).map(toLine));
    });
  }, []);

  const createSession = useCallback(async (date: string, note: string): Promise<string> => {
    const { data: sessionRow, error } = await supabase.from('stock_count_sessions').insert({
      count_date: date, note, status: 'Draft',
    }).select().single();
    if (error) { toast.error('Failed to create session: ' + error.message); return ''; }

    const id = sessionRow.id;
    // Include all 4 types: RM, SM, SP, PK
    const activeSkus = skus.filter(s => s.status === 'Active' && ['RM', 'SM', 'SP', 'PK'].includes(s.type));

    const newLines = activeSkus.map(sku => {
      let systemQty = 0;
      if (sku.type === 'RM') {
        systemQty = rmStockBalances.find(b => b.skuId === sku.id)?.currentStock ?? 0;
      } else if (sku.type === 'SM') {
        systemQty = smStockBalances.find(b => b.skuId === sku.id)?.currentStock ?? 0;
      }
      // SP and PK: systemQty stays 0 (no stock tracking for them yet)
      return {
        session_id: id, sku_id: sku.id, type: sku.type as string,
        system_qty: systemQty, physical_qty: null as number | null, variance: 0, note: '',
      };
    });

    if (newLines.length > 0) {
      const { data: insertedLines, error: lineError } = await supabase.from('stock_count_lines').insert(newLines).select();
      if (lineError) { toast.error('Failed to create count lines: ' + lineError.message); }
      if (insertedLines) setLines(prev => [...insertedLines.map(toLine), ...prev]);
    }

    setSessions(prev => [toSession(sessionRow), ...prev]);
    return id;
  }, [skus, rmStockBalances, smStockBalances]);

  const updateLine = useCallback(async (lineId: string, physicalQty: number | null, noteText?: string) => {
    const line = lines.find(l => l.id === lineId);
    if (!line) return;
    const variance = physicalQty !== null ? physicalQty - line.systemQty : 0;
    const updates: any = { physical_qty: physicalQty, variance };
    if (noteText !== undefined) updates.note = noteText;

    const { error } = await supabase.from('stock_count_lines').update(updates).eq('id', lineId);
    if (error) { toast.error('Failed to update line: ' + error.message); return; }
    setLines(prev => prev.map(l => l.id === lineId ? {
      ...l, physicalQty, variance, note: noteText !== undefined ? noteText : l.note,
    } : l));
  }, [lines]);

  const confirmSession = useCallback(async (sessionId: string) => {
    const sessionLines = lines.filter(l => l.sessionId === sessionId);
    const session = sessions.find(s => s.id === sessionId);
    if (!session || session.status === 'Completed') return;

    for (const line of sessionLines) {
      if (line.variance === 0 || line.physicalQty === null) continue;
      const adj: Omit<StockAdjustment, 'id'> = {
        skuId: line.skuId, date: session.date, quantity: line.variance,
        reason: `Stock Count ${session.date}${line.note ? ': ' + line.note : ''}`,
      };
      if (line.type === 'RM') { await addRmAdjustment(adj); } else if (line.type === 'SM') { await addSmAdjustment(adj); }
    }

    const { error } = await supabase.from('stock_count_sessions').update({
      status: 'Completed', completed_at: new Date().toISOString(),
    }).eq('id', sessionId);
    if (error) { toast.error('Failed to confirm session: ' + error.message); return; }
    setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, status: 'Completed' as const, completedAt: new Date().toISOString() } : s));
  }, [lines, sessions, addRmAdjustment, addSmAdjustment]);

  const softDeleteSession = useCallback(async (sessionId: string) => {
    const session = sessions.find(s => s.id === sessionId);
    if (!session) return;

    // If session was Completed, reverse the stock adjustments
    if (session.status === 'Completed') {
      const sessionLines = lines.filter(l => l.sessionId === sessionId);
      for (const line of sessionLines) {
        if (line.variance === 0 || line.physicalQty === null) continue;
        const reverseAdj: Omit<StockAdjustment, 'id'> = {
          skuId: line.skuId, date: new Date().toISOString().slice(0, 10),
          quantity: -line.variance,
          reason: `Reversed: Stock Count ${session.date}`,
        };
        if (line.type === 'RM') { await addRmAdjustment(reverseAdj); }
        else if (line.type === 'SM') { await addSmAdjustment(reverseAdj); }
      }
    }

    const now = new Date().toISOString();
    const { error } = await supabase.from('stock_count_sessions').update({
      deleted_at: now,
    }).eq('id', sessionId);
    if (error) { toast.error('Failed to delete session: ' + error.message); return; }

    setSessions(prev => prev.filter(s => s.id !== sessionId));
    setLines(prev => prev.filter(l => l.sessionId !== sessionId));
  }, [sessions, lines, addRmAdjustment, addSmAdjustment]);

  const getLinesForSession = useCallback((sessionId: string) => lines.filter(l => l.sessionId === sessionId), [lines]);

  return { sessions, lines, createSession, updateLine, confirmSession, softDeleteSession, getLinesForSession };
}
