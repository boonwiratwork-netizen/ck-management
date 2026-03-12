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

export interface BranchSmSkuInfo {
  skuId: string;
  skuCode: string;
  skuName: string;
  uom: string;
  packSize: number;
}

export function useBranchSmStock(branchId: string | null) {
  const [smStock, setSmStock] = useState<Record<string, BranchSmStockEntry>>({});
  const [smSkuList, setSmSkuList] = useState<BranchSmSkuInfo[]>([]);
  const [loading, setLoading] = useState(false);

  const calculate = useCallback(async () => {
    if (!branchId) { setSmStock({}); setSmSkuList([]); return; }
    setLoading(true);

    try {
      // 1. Get branch brand_name
      const { data: branch } = await supabase
        .from('branches')
        .select('brand_name')
        .eq('id', branchId)
        .single();
      if (!branch) { setSmStock({}); setSmSkuList([]); setLoading(false); return; }

      // 2. Get active menus for this brand
      const { data: menus } = await supabase
        .from('menus')
        .select('id')
        .eq('brand_name', branch.brand_name)
        .eq('status', 'Active');
      const menuIds = (menus || []).map(m => m.id);
      if (menuIds.length === 0) { setSmStock({}); setSmSkuList([]); setLoading(false); return; }

      // 3. Get distinct SM sku_ids from menu_bom for those menus
      const { data: bomEntries } = await supabase
        .from('menu_bom')
        .select('sku_id')
        .in('menu_id', menuIds);
      const bomSkuIds = [...new Set((bomEntries || []).map(b => b.sku_id))];
      if (bomSkuIds.length === 0) { setSmStock({}); setSmSkuList([]); setLoading(false); return; }

      // 4. Filter to active SM SKUs only
      const { data: smSkus } = await supabase
        .from('skus')
        .select('id, sku_id, name, usage_uom, pack_size')
        .eq('type', 'SM')
        .eq('status', 'Active')
        .in('id', bomSkuIds);
      const skuRecords = smSkus || [];
      const skuIds = skuRecords.map(s => s.id);
      if (skuIds.length === 0) { setSmStock({}); setSmSkuList([]); setLoading(false); return; }

      // Build SKU info list
      setSmSkuList(skuRecords.map(s => ({
        skuId: s.id,
        skuCode: s.sku_id,
        skuName: s.name,
        uom: s.usage_uom,
      })));

      // 5. Get last 7 days of submitted daily_stock_counts for this branch
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

      // 6. Get CK lead time
      const { data: ckSupplier } = await supabase
        .from('suppliers')
        .select('lead_time')
        .eq('is_central_kitchen', true)
        .limit(1)
        .maybeSingle();
      const leadTime = ckSupplier?.lead_time ?? 1;

      // 7. Group by SKU
      const grouped: Record<string, typeof counts> = {};
      for (const row of counts || []) {
        if (!grouped[row.sku_id]) grouped[row.sku_id] = [];
        grouped[row.sku_id]!.push(row);
      }

      // 8. Calculate per SKU
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

        // ROP formula — use blended only when ≥3 data points
        const blended = usages.length >= 3
          ? avgDailyUsage * 0.7 + peakDailyUsage * 0.3
          : avgDailyUsage;
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
      setSmSkuList([]);
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => { calculate(); }, [calculate]);

  return { smStock, smSkuList, loading, refresh: calculate };
}
