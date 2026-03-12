import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toLocalDateStr } from '@/lib/utils';

export type BranchSmStockStatus = 'critical' | 'low' | 'sufficient' | 'no-data';

export interface BranchSmStockEntry {
  stockOnHand: number;
  avgDailyUsage: number;
  peakDailyUsage: number;
  rop: number;
  parstock: number;
  suggestedOrder: number;
  status: BranchSmStockStatus;
}

export function useBranchSmStock(branchId: string | null) {
  const [smStock, setSmStock] = useState<Record<string, BranchSmStockEntry>>({});
  const [loading, setLoading] = useState(false);

  const calculate = useCallback(async () => {
    if (!branchId) { setSmStock({}); return; }
    setLoading(true);

    try {
      // 1. Get active SM SKUs
      const { data: smSkus } = await supabase
        .from('skus')
        .select('id')
        .eq('type', 'SM')
        .eq('status', 'Active');
      const skuIds = (smSkus || []).map(s => s.id);
      if (skuIds.length === 0) { setSmStock({}); setLoading(false); return; }

      // 2. Get last 7 days of submitted daily_stock_counts for this branch
      const today = new Date();
      const sevenDaysAgo = new Date(today);
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const dateFrom = toLocalDateStr(sevenDaysAgo);

      const { data: counts } = await supabase
        .from('daily_stock_counts')
        .select('sku_id, count_date, expected_usage, calculated_balance, physical_count')
        .eq('branch_id', branchId)
        .eq('is_submitted', true)
        .gte('count_date', dateFrom)
        .in('sku_id', skuIds)
        .order('count_date', { ascending: false });

      // 3. Get CK lead time
      const { data: ckSupplier } = await supabase
        .from('suppliers')
        .select('lead_time')
        .eq('is_central_kitchen', true)
        .limit(1)
        .maybeSingle();
      const leadTime = ckSupplier?.lead_time ?? 1;

      // 4. Group by SKU
      const grouped: Record<string, typeof counts> = {};
      for (const row of counts || []) {
        if (!grouped[row.sku_id]) grouped[row.sku_id] = [];
        grouped[row.sku_id]!.push(row);
      }

      // 5. Calculate per SKU
      const result: Record<string, BranchSmStockEntry> = {};

      for (const skuId of skuIds) {
        const rows = grouped[skuId];
        if (!rows || rows.length < 1) {
          result[skuId] = {
            stockOnHand: 0,
            avgDailyUsage: 0,
            peakDailyUsage: 0,
            rop: 0,
            parstock: 0,
            suggestedOrder: 0,
            status: 'no-data',
          };
          continue;
        }

        // Most recent row (already sorted DESC)
        const latest = rows[0];
        const stockOnHand = latest.physical_count != null
          ? Number(latest.physical_count)
          : Number(latest.calculated_balance);

        // Usage stats from up to 7 rows
        const usages = rows.map(r => Number(r.expected_usage));
        const avgDailyUsage = usages.reduce((a, b) => a + b, 0) / 7;
        const peakDailyUsage = Math.max(...usages);

        // ROP formula
        const blended = avgDailyUsage * 0.7 + peakDailyUsage * 0.3;
        const rop = blended * leadTime;
        const parstock = blended * (leadTime + leadTime);
        const suggestedOrder = Math.max(0, parstock - stockOnHand);

        // Status
        let status: BranchSmStockStatus;
        if (stockOnHand === 0) status = 'critical';
        else if (stockOnHand < rop) status = 'low';
        else if (stockOnHand >= parstock) status = 'sufficient';
        else status = 'low';

        result[skuId] = {
          stockOnHand,
          avgDailyUsage: Math.round(avgDailyUsage * 100) / 100,
          peakDailyUsage,
          rop: Math.round(rop * 100) / 100,
          parstock: Math.round(parstock * 100) / 100,
          suggestedOrder: Math.round(suggestedOrder * 100) / 100,
          status,
        };
      }

      setSmStock(result);
    } catch {
      setSmStock({});
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => { calculate(); }, [calculate]);

  return { smStock, loading, refresh: calculate };
}
