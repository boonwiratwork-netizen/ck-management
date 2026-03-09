import { useState, useCallback, useEffect } from 'react';
import { Supplier } from '@/types/supplier';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const toLocal = (row: any): Supplier => ({
  id: row.id,
  name: row.name,
  leadTime: row.lead_time,
  moq: row.moq,
  moqUnit: row.moq_unit,
  contactPerson: row.contact_person,
  phone: row.phone,
  creditTerms: row.credit_terms,
  status: row.status,
});

const toDb = (data: Omit<Supplier, 'id'>) => ({
  name: data.name,
  lead_time: data.leadTime,
  moq: data.moq,
  moq_unit: data.moqUnit,
  contact_person: data.contactPerson,
  phone: data.phone,
  credit_terms: data.creditTerms,
  status: data.status,
});

export function useSupplierData() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);

  useEffect(() => {
    supabase.from('suppliers').select('*').order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) { toast.error('Failed to load suppliers'); return; }
        setSuppliers((data || []).map(toLocal));
      });
  }, []);

  const addSupplier = useCallback(async (data: Omit<Supplier, 'id'>) => {
    const { data: row, error } = await supabase.from('suppliers').insert(toDb(data)).select().single();
    if (error) { toast.error('Failed to add supplier: ' + error.message); return; }
    setSuppliers(prev => [toLocal(row), ...prev]);
  }, []);

  const updateSupplier = useCallback(async (id: string, data: Partial<Omit<Supplier, 'id'>>) => {
    const dbData: any = {};
    if (data.name !== undefined) dbData.name = data.name;
    if (data.leadTime !== undefined) dbData.lead_time = data.leadTime;
    if (data.moq !== undefined) dbData.moq = data.moq;
    if (data.moqUnit !== undefined) dbData.moq_unit = data.moqUnit;
    if (data.contactPerson !== undefined) dbData.contact_person = data.contactPerson;
    if (data.phone !== undefined) dbData.phone = data.phone;
    if (data.creditTerms !== undefined) dbData.credit_terms = data.creditTerms;
    if (data.status !== undefined) dbData.status = data.status;

    const { error } = await supabase.from('suppliers').update(dbData).eq('id', id);
    if (error) { toast.error('Failed to update supplier: ' + error.message); return; }
    setSuppliers(prev => prev.map(s => s.id === id ? { ...s, ...data } : s));
  }, []);

  const deleteSupplier = useCallback(async (id: string) => {
    const { error } = await supabase.from('suppliers').delete().eq('id', id);
    if (error) { toast.error('Failed to delete supplier: ' + error.message); return; }
    setSuppliers(prev => prev.filter(s => s.id !== id));
  }, []);

  return { suppliers, addSupplier, updateSupplier, deleteSupplier };
}
