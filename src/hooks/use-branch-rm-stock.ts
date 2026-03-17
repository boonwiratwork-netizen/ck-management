import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toLocalDateStr } from '@/lib/utils';

export type BranchRmStockStatus = 'critical' | 'low' | 'sufficient' | 'no-data';

export interface BranchRmStockEntry {
  stockOnHand: number;
  avgDailyUsage: number;
  peakDailyUsage: number;
  rop: number;
  parstock: number;
  suggestedOrder: number;
  suggestedBatches: number;
  status: BranchRmStockStatus;
}

export interface BranchRmSkuInfo {
  skuId: string;
  skuCode: string;
  skuName: string;
  purchaseUom: string;
  usageUom: string;
  packSize: number;
  leadTime: number;
}

export function useBranchRmStock(branchId: string | null, supplierId: string | null) {
  const [rmStock, setRmStock] = useState<Record<string, BranchRmStockEntry>>({});
  const [rmSkuList, setRmSkuList] = useState<BranchRmSkuInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [zeroLeadTimeCount, setZeroLeadTimeCount] = useState(0);

  const calculate = useCallback(async () => {
    if (!branchId || !supplierId) { setRmStock({}); setRmSkuList([]); setZeroLeadTimeCount(0); return; }
    setLoading(true);

    try {
      // 1. Get branch brand_name
      const { data: branch } = await supabase
        .from('branches')
        .select('brand_name')
        .eq('id', branchId)
        .single();
      if (!branch) { setRmStock({}); setRmSkuList([]); setLoading(false); return; }

      // 2. Get active menus for this brand
      const { data: menus } = await supabase
        .from('menus')
        .select('id')
        .eq('brand_name', branch.brand_name)
        .eq('status', 'Active');
      const menuIds = (menus || []).map(m => m.id);
      if (menuIds.length === 0) { setRmStock({}); setRmSkuList([]); setLoading(false); return; }

      // 3. Get SM sku_ids from menu_bom
      const { data: bomEntries } = await supabase
        .from('menu_bom')
        .select('sku_id')
        .in('menu_id', menuIds);
      const smSkuIds = [...new Set((bomEntries || []).map(b => b.sku_id))];

      // 4. Get RM ingredients from sp_bom for those SM SKUs
      let rmFromSpBom: string[] = [];
      if (smSkuIds.length > 0) {
        const { data: spBomLines } = await supabase
          .from('sp_bom')
          .select('ingredient_sku_id')
          .in('sp_sku_id', smSkuIds);
        rmFromSpBom = (spBomLines || []).map(l => l.ingredient_sku_id);
      }

      // Also get direct RM ingredients from menu_bom (type=RM)
      const allBomSkuIds = [...new Set([...smSkuIds, ...rmFromSpBom])];
      if (allBomSkuIds.length === 0) { setRmStock({}); setRmSkuList([]); setLoading(false); return; }

      // 5. Filter to active RM SKUs where supplier1 or supplier2 matches
      const { data: rmSkus } = await supabase
        .from('skus')
        .select('id, sku_id, name, purchase_uom, usage_uom, pack_size, lead_time, supplier1, supplier2, type')
        .eq('status', 'Active')
        .in('id', allBomSkuIds);
      
      // Filter: must be RM type AND supplier matches
      const filtered = (rmSkus || []).filter(s => 
        s.type === 'RM' && (s.supplier1 === supplierId || s.supplier2 === supplierId)
      );
      
      if (filtered.length === 0) { setRmStock({}); setRmSkuList([]); setLoading(false); return; }

      // Count zero lead times
      let zeroLtCount = 0;

      // Build SKU info list
      setRmSkuList(filtered.map(s => {
        const lt = Number(s.lead_time) || 0;
        if (lt === 0) zeroLtCount++;
        return {
          skuId: s.id,
          skuCode: s.sku_id,
          skuName: s.name,
          purchaseUom: s.purchase_uom,
          usageUom: s.usage_uom,
          packSize: Number(s.pack_size) || 1,
          leadTime: lt,
        };
      }));
      setZeroLeadTimeCount(zeroLtCount);

      const skuIds = filtered.map(s => s.id);

      // 6. Get last 7 days of submitted daily_stock_counts for this branch
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

      // 7. Group by SKU
      const grouped: Record<string, typeof counts> = {};
      for (const row of counts || []) {
        if (!grouped[row.sku_id]) grouped[row.sku_id] = [];
        grouped[row.sku_id]!.push(row);
      }

      // Build lead time map
      const ltMap: Record<string, number> = {};
      for (const s of filtered) {
        ltMap[s.id] = Number(s.lead_time) || 1; // fallback to 1 if 0
      }

      // 8. Calculate per SKU
      const result: Record<string, BranchRmStockEntry> = {};

      for (const skuId of skuIds) {
        const rows = grouped[skuId];
        const skuInfo = filtered.find(s => s.id === skuId);
        const packSize = Number(skuInfo?.pack_size) || 1;
        const leadTime = ltMap[skuId] || 1;

        if (!rows || rows.length < 1) {
          result[skuId] = {
            stockOnHand: 0,
            avgDailyUsage: 0,
            peakDailyUsage: 0,
            rop: 0,
            parstock: 0,
            suggestedOrder: 0,
            suggestedBatches: 0,
            status: 'no-data',
          };
          continue;
        }

        // Most recent row
        const latest = rows[0];
        const stockOnHand = latest.physical_count != null
          ? Number(latest.physical_count)
          : Number(latest.calculated_balance);

        // Usage stats
        const usages = rows.map(r => Number(r.expected_usage));
        const avgDailyUsage = usages.reduce((a, b) => a + b, 0) / 7;
        const peakDailyUsage = Math.max(...usages);

        // ROP/parstock
        const rop = avgDailyUsage * leadTime;
        const parstock = avgDailyUsage * (leadTime * 2);
        const suggestedOrder = Math.max(0, parstock - stockOnHand);
        const suggestedBatches = suggestedOrder > 0 ? Math.ceil(suggestedOrder / packSize) : 0;

        // Status
        let status: BranchRmStockStatus;
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
          suggestedBatches,
          status,
        };
      }

      setRmStock(result);
    } catch {
      setRmStock({});
      setRmSkuList([]);
    } finally {
      setLoading(false);
    }
  }, [branchId, supplierId]);

  useEffect(() => { calculate(); }, [calculate]);

  return { rmStock, rmSkuList, loading, zeroLeadTimeCount, refresh: calculate };
}
