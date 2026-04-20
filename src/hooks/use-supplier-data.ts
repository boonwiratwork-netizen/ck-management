import { useState, useCallback, useEffect } from 'react';
import { Supplier } from '@/types/supplier';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/use-auth';

const toLocal = (row: any): Supplier => ({
  id: row.id,
  name: row.name,
  leadTime: row.lead_time,
  moq: row.moq,
  moqUnit: row.moq_unit,
  contactPerson: row.contact_person ?? '',
  phone: row.phone ?? '',
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
  const { isManagement, isCkManager, sessionLoading, profileLoading } = useAuth();

  useEffect(() => {
    if (sessionLoading || profileLoading) return;
    // Skip if already loaded — prevents re-fetch on tab focus / auth re-emit
    if (suppliers.length > 0) return;

    // Management & CK can read full table (including phone, contact_person)
    // Other roles use the safe view that excludes sensitive columns
    const canReadFull = isManagement || isCkManager;
    const runQuery = () =>
      canReadFull
        ? supabase.from('suppliers').select('*').order('created_at', { ascending: false })
        : supabase.from('suppliers_safe' as any).select('*').order('created_at', { ascending: false });

    let cancelled = false;
    const attempt = async (isRetry: boolean) => {
      const { data, error }: any = await runQuery();
      if (cancelled) return;
      if (error) {
        if (!isRetry) {
          setTimeout(() => { if (!cancelled) attempt(true); }, 2000);
        } else {
          toast.error('Failed to load suppliers');
        }
        return;
      }
      setSuppliers((data || []).map(toLocal));
    };
    attempt(false);

    return () => { cancelled = true; };
  }, [isManagement, isCkManager, sessionLoading, profileLoading, suppliers.length]);

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
