import { useState, useCallback } from 'react';
import { Branch, BranchStatus } from '@/types/branch';

export function useBranchData() {
  const [branches, setBranches] = useState<Branch[]>([]);

  const addBranch = useCallback((data: Omit<Branch, 'id'>) => {
    const branch: Branch = { ...data, id: crypto.randomUUID() };
    setBranches(prev => [branch, ...prev]);
  }, []);

  const updateBranch = useCallback((id: string, data: Partial<Omit<Branch, 'id'>>) => {
    setBranches(prev => prev.map(b => b.id === id ? { ...b, ...data } : b));
  }, []);

  const deleteBranch = useCallback((id: string) => {
    setBranches(prev => prev.filter(b => b.id !== id));
  }, []);

  return { branches, addBranch, updateBranch, deleteBranch };
}
