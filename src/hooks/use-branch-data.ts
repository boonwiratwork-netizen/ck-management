import { useState, useCallback, useEffect } from 'react';
import { loadWithDeviceCopy } from "@/lib/base-cache";
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
    loadWithDeviceCopy('branches', () => supabase.from('branches').select('*').order('created_at', { ascending: false }), (rows) => setBranches(rows.map(toLocal)))
      .then(({ error }) => { if (error) toast.error('โหลดสาขาไม่สำเร็จ'); });
  }, []);

  const addBranch = useCallback(async (data: Omit<Branch, 'id'>) => {
    const { data: row, error } = await supabase.from('branches').insert({
      branch_name: data.branchName,
      brand_name: data.brandName,
      location: data.location,
      status: data.status,
    }).select().single();
    if (error) { toast.error('เพิ่มสาขาไม่สำเร็จ: ' + error.message); return false; }
    setBranches(prev => [toLocal(row), ...prev]);
    return true;
  }, []);

  const updateBranch = useCallback(async (id: string, data: Partial<Omit<Branch, 'id'>>) => {
    const dbData: any = {};
    if (data.branchName !== undefined) dbData.branch_name = data.branchName;
    if (data.brandName !== undefined) dbData.brand_name = data.brandName;
    if (data.location !== undefined) dbData.location = data.location;
    if (data.status !== undefined) dbData.status = data.status;

    const { error } = await supabase.from('branches').update(dbData).eq('id', id);
    if (error) { toast.error('บันทึกสาขาไม่สำเร็จ: ' + error.message); return false; }
    setBranches(prev => prev.map(b => b.id === id ? { ...b, ...data } : b));
    return true;
  }, []);

  const deleteBranch = useCallback(async (id: string) => {
    const { error } = await supabase.from('branches').delete().eq('id', id);
    if (error) { toast.error('ลบสาขาไม่สำเร็จ: ' + error.message); return; }
    setBranches(prev => prev.filter(b => b.id !== id));
  }, []);

  return { branches, addBranch, updateBranch, deleteBranch };
}
