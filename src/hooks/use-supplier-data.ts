import { useState, useCallback } from 'react';
import { Supplier } from '@/types/supplier';

export function useSupplierData() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);

  const addSupplier = useCallback((data: Omit<Supplier, 'id'>) => {
    setSuppliers(prev => [...prev, { ...data, id: crypto.randomUUID() }]);
  }, []);

  const updateSupplier = useCallback((id: string, data: Partial<Omit<Supplier, 'id'>>) => {
    setSuppliers(prev => prev.map(s => s.id === id ? { ...s, ...data } : s));
  }, []);

  const deleteSupplier = useCallback((id: string) => {
    setSuppliers(prev => prev.filter(s => s.id !== id));
  }, []);

  return { suppliers, addSupplier, updateSupplier, deleteSupplier };
}
