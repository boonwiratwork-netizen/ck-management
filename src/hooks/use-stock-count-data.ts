import { useState, useCallback } from 'react';
import { StockCountSession, StockCountLine } from '@/types/stock-count';
import { StockBalance, StockAdjustment } from '@/types/stock';
import { SMStockBalance } from '@/hooks/use-sm-stock-data';
import { SKU } from '@/types/sku';

interface UseStockCountDataProps {
  skus: SKU[];
  rmStockBalances: StockBalance[];
  smStockBalances: SMStockBalance[];
  addRmAdjustment: (adj: Omit<StockAdjustment, 'id'>) => void;
  addSmAdjustment: (adj: Omit<StockAdjustment, 'id'>) => void;
  getStdUnitPrice: (skuId: string) => number;
}

export function useStockCountData({
  skus,
  rmStockBalances,
  smStockBalances,
  addRmAdjustment,
  addSmAdjustment,
  getStdUnitPrice,
}: UseStockCountDataProps) {
  const [sessions, setSessions] = useState<StockCountSession[]>([]);
  const [lines, setLines] = useState<StockCountLine[]>([]);

  const createSession = useCallback((date: string, note: string): string => {
    const id = crypto.randomUUID();
    const activeSkus = skus.filter(s => s.status === 'Active' && (s.type === 'RM' || s.type === 'SM'));

    const newLines: StockCountLine[] = activeSkus.map(sku => {
      let systemQty = 0;
      if (sku.type === 'RM') {
        systemQty = rmStockBalances.find(b => b.skuId === sku.id)?.currentStock ?? 0;
      } else {
        systemQty = smStockBalances.find(b => b.skuId === sku.id)?.currentStock ?? 0;
      }
      return {
        id: crypto.randomUUID(),
        sessionId: id,
        skuId: sku.id,
        type: sku.type as 'RM' | 'SM',
        systemQty,
        physicalQty: null,
        variance: 0,
        note: '',
      };
    });

    setSessions(prev => [{
      id,
      date,
      note,
      status: 'Draft',
      createdAt: new Date().toISOString(),
    }, ...prev]);

    setLines(prev => [...newLines, ...prev]);
    return id;
  }, [skus, rmStockBalances, smStockBalances]);

  const updateLine = useCallback((lineId: string, physicalQty: number | null, note?: string) => {
    setLines(prev => prev.map(l => {
      if (l.id !== lineId) return l;
      const pq = physicalQty;
      return {
        ...l,
        physicalQty: pq,
        variance: pq !== null ? pq - l.systemQty : 0,
        note: note !== undefined ? note : l.note,
      };
    }));
  }, []);

  const confirmSession = useCallback((sessionId: string) => {
    const sessionLines = lines.filter(l => l.sessionId === sessionId);
    const session = sessions.find(s => s.id === sessionId);
    if (!session || session.status === 'Completed') return;

    // Create adjustments for lines with variance != 0
    sessionLines.forEach(line => {
      if (line.variance === 0 || line.physicalQty === null) return;
      const adj: Omit<StockAdjustment, 'id'> = {
        skuId: line.skuId,
        date: session.date,
        quantity: line.variance,
        reason: `Stock Count ${session.date}${line.note ? ': ' + line.note : ''}`,
      };
      if (line.type === 'RM') {
        addRmAdjustment(adj);
      } else {
        addSmAdjustment(adj);
      }
    });

    setSessions(prev => prev.map(s =>
      s.id === sessionId ? { ...s, status: 'Completed' as const, completedAt: new Date().toISOString() } : s
    ));
  }, [lines, sessions, addRmAdjustment, addSmAdjustment]);

  const deleteSession = useCallback((sessionId: string) => {
    setSessions(prev => prev.filter(s => s.id !== sessionId));
    setLines(prev => prev.filter(l => l.sessionId !== sessionId));
  }, []);

  const getLinesForSession = useCallback((sessionId: string) => {
    return lines.filter(l => l.sessionId === sessionId);
  }, [lines]);

  return {
    sessions,
    lines,
    createSession,
    updateLine,
    confirmSession,
    deleteSession,
    getLinesForSession,
  };
}
