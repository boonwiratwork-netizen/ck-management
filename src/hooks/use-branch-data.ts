import { useState, useCallback, useEffect } from 'react';
import { Branch } from '@/types/branch';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const toLocal = (row: any): Branch => ({
  id: row.id,
  branchName: row.branch_name,
  brandName: row.brand_name,
  location: row.location,
  status: row.status,
  avgSellingPrice: row.avg_selling_price ?? null,
});

export function useBranchData() {
  const [branches, setBranches] = useState<Branch[]>([]);

  useEffect(() => {
    supabase.from('branches').select('*').order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) { toast.error('Failed to load branches'); return; }
        setBranches((data || []).map(toLocal));
      });
  }, []);

  const addBranch = useCallback(async (data: Omit<Branch, 'id'>) => {
    const { data: row, error } = await supabase.from('branches').insert({
      branch_name: data.branchName,
      brand_name: data.brandName,
      location: data.location,
      status: data.status,
    }).select().single();
    if (error) { toast.error('Failed to add branch: ' + error.message); return; }
    setBranches(prev => [toLocal(row), ...prev]);
  }, []);

  const updateBranch = useCallback(async (id: string, data: Partial<Omit<Branch, 'id'>>) => {
    const dbData: any = {};
    if (data.branchName !== undefined) dbData.branch_name = data.branchName;
    if (data.brandName !== undefined) dbData.brand_name = data.brandName;
    if (data.location !== undefined) dbData.location = data.location;
    if (data.status !== undefined) dbData.status = data.status;

    const { error } = await supabase.from('branches').update(dbData).eq('id', id);
    if (error) { toast.error('Failed to update branch: ' + error.message); return; }
    setBranches(prev => prev.map(b => b.id === id ? { ...b, ...data } : b));
  }, []);

  const deleteBranch = useCallback(async (id: string) => {
    const { error } = await supabase.from('branches').delete().eq('id', id);
    if (error) { toast.error('Failed to delete branch: ' + error.message); return; }
    setBranches(prev => prev.filter(b => b.id !== id));
  }, []);

  return { branches, addBranch, updateBranch, deleteBranch };
}
