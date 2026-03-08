import { useState, useCallback } from 'react';
import { BOMHeader, BOMLine, BOMStep } from '@/types/bom';

export function useBomData() {
  const [headers, setHeaders] = useState<BOMHeader[]>([]);
  const [lines, setLines] = useState<BOMLine[]>([]);
  const [steps, setSteps] = useState<BOMStep[]>([]);

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
    setSteps(prev => prev.filter(s => s.bomHeaderId !== id));
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

  // Step operations
  const addStep = useCallback((data: Omit<BOMStep, 'id'>) => {
    const newStep: BOMStep = { ...data, id: crypto.randomUUID() };
    setSteps(prev => [...prev, newStep]);
    return newStep.id;
  }, []);

  const updateStep = useCallback((id: string, data: Partial<Omit<BOMStep, 'id' | 'bomHeaderId'>>) => {
    setSteps(prev => prev.map(s => s.id === id ? { ...s, ...data } : s));
  }, []);

  const deleteStep = useCallback((id: string) => {
    setSteps(prev => prev.filter(s => s.id !== id));
    setLines(prev => prev.filter(l => l.stepId !== id));
  }, []);

  const getStepsForHeader = useCallback((headerId: string) => {
    return steps.filter(s => s.bomHeaderId === headerId).sort((a, b) => a.stepNumber - b.stepNumber);
  }, [steps]);

  const getLinesForStep = useCallback((stepId: string) => {
    return lines.filter(l => l.stepId === stepId);
  }, [lines]);

  return {
    headers, lines, steps,
    addHeader, updateHeader, deleteHeader,
    addLine, updateLine, deleteLine, getLinesForHeader,
    addStep, updateStep, deleteStep, getStepsForHeader, getLinesForStep,
  };
}
