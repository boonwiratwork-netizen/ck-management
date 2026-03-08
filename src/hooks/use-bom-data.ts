import { useState, useCallback } from 'react';
import { BOMHeader, BOMLine } from '@/types/bom';

export function useBomData() {
  const [headers, setHeaders] = useState<BOMHeader[]>([]);
  const [lines, setLines] = useState<BOMLine[]>([]);

  const addHeader = useCallback((data: Omit<BOMHeader, 'id'>) => {
    const newHeader: BOMHeader = { ...data, id: crypto.randomUUID() };
    setHeaders(prev => [...prev, newHeader]);
    return newHeader.id;
  }, []);

  const updateHeader = useCallback((id: string, data: Partial<Omit<BOMHeader, 'id'>>) => {
    setHeaders(prev => prev.map(h => h.id === id ? { ...h, ...data } : h));
  }, []);

  const deleteHeader = useCallback((id: string) => {
    setHeaders(prev => prev.filter(h => h.id !== id));
    setLines(prev => prev.filter(l => l.bomHeaderId !== id));
  }, []);

  const addLine = useCallback((data: Omit<BOMLine, 'id'>) => {
    const newLine: BOMLine = { ...data, id: crypto.randomUUID() };
    setLines(prev => [...prev, newLine]);
  }, []);

  const updateLine = useCallback((id: string, data: Partial<Omit<BOMLine, 'id' | 'bomHeaderId'>>) => {
    setLines(prev => prev.map(l => l.id === id ? { ...l, ...data } : l));
  }, []);

  const deleteLine = useCallback((id: string) => {
    setLines(prev => prev.filter(l => l.id !== id));
  }, []);

  const getLinesForHeader = useCallback((headerId: string) => {
    return lines.filter(l => l.bomHeaderId === headerId);
  }, [lines]);

  return { headers, lines, addHeader, updateHeader, deleteHeader, addLine, updateLine, deleteLine, getLinesForHeader };
}
