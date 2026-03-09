import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { SKU } from '@/types/sku';
import { MenuBomLine } from '@/types/menu-bom';
import { ModifierRule } from '@/types/modifier-rule';
import { SpBomLine } from '@/types/sp-bom';
import { Menu } from '@/types/menu';
import { Branch } from '@/types/branch';

export interface DailyStockCountRow {
  id: string;
  branchId: string;
  countDate: string;
  skuId: string;
  openingBalance: number;
  receivedFromCk: number;
  receivedExternal: number;
  expectedUsage: number;
  calculatedBalance: number;
  physicalCount: number | null;
  variance: number;
  isSubmitted: boolean;
  submittedAt: string | null;
}

const toLocal = (r: any): DailyStockCountRow => ({
  id: r.id,
  branchId: r.branch_id,
  countDate: r.count_date,
  skuId: r.sku_id,
  openingBalance: Number(r.opening_balance),
  receivedFromCk: Number(r.received_from_ck),
  receivedExternal: Number(r.received_external),
  expectedUsage: Number(r.expected_usage),
  calculatedBalance: Number(r.calculated_balance),
  physicalCount: r.physical_count !== null ? Number(r.physical_count) : null,
  variance: Number(r.variance),
  isSubmitted: r.is_submitted,
  submittedAt: r.submitted_at,
});

interface UseDailyStockCountProps {
  skus: SKU[];
  menuBomLines: MenuBomLine[];
  modifierRules: ModifierRule[];
  spBomLines: SpBomLine[];
  menus: Menu[];
  branches: Branch[];
}

export function useDailyStockCount({
  skus, menuBomLines, modifierRules, spBomLines, menus, branches,
}: UseDailyStockCountProps) {
  const [rows, setRows] = useState<DailyStockCountRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);

  // Fetch live receipt totals for a branch+date
  const fetchReceiptTotals = useCallback(async (branchId: string, date: string) => {
    const branch = branches.find(b => b.id === branchId);
    const branchName = branch?.branchName || '';

    // Branch receipts (external) - by branch_id + receipt_date
    const { data: brData } = await supabase
      .from('branch_receipts')
      .select('sku_id, qty_received')
      .eq('branch_id', branchId)
      .eq('receipt_date', date);
    
    const extBySku: Record<string, number> = {};
    (brData || []).forEach(r => {
      extBySku[r.sku_id] = (extBySku[r.sku_id] || 0) + Number(r.qty_received);
    });

    // CK deliveries - by branch_name + delivery_date
    const { data: dlData } = await supabase
      .from('deliveries')
      .select('sm_sku_id, qty_delivered_kg')
      .eq('branch_name', branchName)
      .eq('delivery_date', date);
    
    const ckBySku: Record<string, number> = {};
    (dlData || []).forEach(d => {
      ckBySku[d.sm_sku_id] = (ckBySku[d.sm_sku_id] || 0) + Number(d.qty_delivered_kg);
    });

    return { extBySku, ckBySku };
  }, [branches]);

  // Load existing count sheet — recalculate received columns live
  const loadSheet = useCallback(async (branchId: string, date: string) => {
    setLoading(true);
    const [sheetResult, receipts] = await Promise.all([
      supabase.from('daily_stock_counts').select('*').eq('branch_id', branchId).eq('count_date', date).order('created_at'),
      fetchReceiptTotals(branchId, date),
    ]);
    setLoading(false);
    if (sheetResult.error) { toast.error('Failed to load count sheet'); return; }
    const data = sheetResult.data || [];
    
    // Patch rows with live receipt data and recalc balance/variance
    const patched = data.map(r => {
      const ext = receipts.extBySku[r.sku_id] ?? Number(r.received_external);
      const ck = receipts.ckBySku[r.sku_id] ?? Number(r.received_from_ck);
      const calcBalance = Number(r.opening_balance) + ck + ext - Number(r.expected_usage);
      const variance = r.physical_count !== null ? Number(r.physical_count) - calcBalance : 0;
      return { ...r, received_external: ext, received_from_ck: ck, calculated_balance: calcBalance, variance };
    });
    
    // Update DB in background for any changed rows
    const updates = patched.filter((p, i) => 
      p.received_external !== Number(data[i].received_external) ||
      p.received_from_ck !== Number(data[i].received_from_ck)
    );
    if (updates.length > 0) {
      for (const u of updates) {
        supabase.from('daily_stock_counts').update({
          received_external: u.received_external,
          received_from_ck: u.received_from_ck,
          calculated_balance: u.calculated_balance,
          variance: u.variance,
        }).eq('id', u.id).then(() => {});
      }
    }
    
    setRows(patched.map(toLocal));
  }, [fetchReceiptTotals]);

  // Calculate expected usage from sales data
  const calculateExpectedUsage = useCallback(async (branchId: string, date: string): Promise<Record<string, number>> => {
    // Step 1: Get sales entries for branch + date
    const { data: salesData } = await supabase
      .from('sales_entries')
      .select('*')
      .eq('branch_id', branchId)
      .eq('sale_date', date);
    
    const sales = salesData || [];
    if (sales.length === 0) return {};

    // Build lookup maps
    const menuByCode = new Map<string, Menu>();
    menus.forEach(m => menuByCode.set(m.menuCode, m));
    
    const bomByMenuId = new Map<string, MenuBomLine[]>();
    menuBomLines.forEach(l => {
      const arr = bomByMenuId.get(l.menuId) || [];
      arr.push(l);
      bomByMenuId.set(l.menuId, arr);
    });

    const activeRules = modifierRules.filter(r => r.isActive);

    const spBomBySpSku = new Map<string, SpBomLine[]>();
    spBomLines.forEach(l => {
      const arr = spBomBySpSku.get(l.spSkuId) || [];
      arr.push(l);
      spBomBySpSku.set(l.spSkuId, arr);
    });

    const skuMap = new Map<string, SKU>();
    skus.forEach(s => skuMap.set(s.id, s));

    const usage: Record<string, number> = {};
    const addUsage = (skuId: string, qty: number) => {
      usage[skuId] = (usage[skuId] || 0) + qty;
    };

    // Step 2: For each sales row
    for (const sale of sales) {
      const qty = Number(sale.qty) || 0;
      if (qty === 0) continue;
      
      const menuCode = sale.menu_code;
      const menuName = sale.menu_name || '';
      const menu = menuByCode.get(menuCode);
      
      if (menu) {
        // Step 2a: Base BOM ingredients
        const bomLines = bomByMenuId.get(menu.id) || [];
        for (const line of bomLines) {
          const ingredientQty = line.effectiveQty * qty;
          const sku = skuMap.get(line.skuId);
          
          if (sku && sku.type === 'SP') {
            // Step 2c: Expand SP into RM ingredients
            const spLines = spBomBySpSku.get(line.skuId) || [];
            for (const spLine of spLines) {
              const rmQty = (spLine.qtyPerBatch / spLine.batchYieldQty) * ingredientQty;
              addUsage(spLine.ingredientSkuId, rmQty);
            }
          } else {
            addUsage(line.skuId, ingredientQty);
          }
        }

        // Step 2b: Modifier rules
        for (const rule of activeRules) {
          // Rule must be global (menuId null) or match this specific menu
          if (rule.menuId && rule.menuId !== menu.id) continue;
          
          if (menuName.includes(rule.keyword)) {
            const modQty = rule.qtyPerMatch * qty;
            const modSku = skuMap.get(rule.skuId);
            
            if (modSku && modSku.type === 'SP') {
              const spLines = spBomBySpSku.get(rule.skuId) || [];
              for (const spLine of spLines) {
                const rmQty = (spLine.qtyPerBatch / spLine.batchYieldQty) * modQty;
                addUsage(spLine.ingredientSkuId, rmQty);
              }
            } else {
              addUsage(rule.skuId, modQty);
            }
          }
        }
      }
    }

    return usage;
  }, [menus, menuBomLines, modifierRules, spBomLines, skus]);

  // Generate count sheet
  const generateSheet = useCallback(async (branchId: string, date: string) => {
    setGenerating(true);

    // Check if already exists
    const { data: existing } = await supabase
      .from('daily_stock_counts')
      .select('id')
      .eq('branch_id', branchId)
      .eq('count_date', date)
      .limit(1);
    
    if (existing && existing.length > 0) {
      toast.info('Count sheet already exists, loading...');
      await loadSheet(branchId, date);
      setGenerating(false);
      return;
    }

    // Calculate expected usage + fetch receipt totals in parallel
    const [expectedUsage, receipts] = await Promise.all([
      calculateExpectedUsage(branchId, date),
      fetchReceiptTotals(branchId, date),
    ]);

    // Get previous day's physical counts as opening balance
    const prevDate = new Date(date);
    prevDate.setDate(prevDate.getDate() - 1);
    const prevDateStr = prevDate.toISOString().slice(0, 10);
    
    const { data: prevCounts } = await supabase
      .from('daily_stock_counts')
      .select('sku_id, physical_count')
      .eq('branch_id', branchId)
      .eq('count_date', prevDateStr);
    
    const prevPhysical: Record<string, number> = {};
    (prevCounts || []).forEach(p => {
      if (p.physical_count !== null) {
        prevPhysical[p.sku_id] = Number(p.physical_count);
      }
    });

    // Build rows for all active RM and SM SKUs
    const activeSkus = skus.filter(s => s.status === 'Active' && (s.type === 'RM' || s.type === 'SM'));
    
    const insertRows = activeSkus.map(sku => {
      const opening = prevPhysical[sku.id] ?? 0;
      const fromCk = receipts.ckBySku[sku.id] ?? 0;
      const receivedExternal = receipts.extBySku[sku.id] ?? 0;
      const expUsage = expectedUsage[sku.id] ?? 0;
      const calcBalance = opening + fromCk + receivedExternal - expUsage;

      return {
        branch_id: branchId,
        count_date: date,
        sku_id: sku.id,
        opening_balance: opening,
        received_from_ck: fromCk,
        received_external: receivedExternal,
        expected_usage: expUsage,
        calculated_balance: calcBalance,
        physical_count: null as number | null,
        variance: 0,
        is_submitted: false,
      };
    });

    if (insertRows.length === 0) {
      toast.warning('No active RM/SM SKUs found');
      setGenerating(false);
      return;
    }

    // Insert in chunks
    const chunkSize = 500;
    const allInserted: any[] = [];
    for (let i = 0; i < insertRows.length; i += chunkSize) {
      const chunk = insertRows.slice(i, i + chunkSize);
      const { data: inserted, error } = await supabase
        .from('daily_stock_counts')
        .insert(chunk)
        .select();
      if (error) {
        toast.error('Failed to generate count sheet: ' + error.message);
        setGenerating(false);
        return;
      }
      if (inserted) allInserted.push(...inserted);
    }

    setRows(allInserted.map(toLocal));
    toast.success(`Count sheet generated with ${allInserted.length} SKUs`);
    setGenerating(false);
  }, [skus, calculateExpectedUsage, fetchReceiptTotals, loadSheet]);

  // Update physical count
  const updatePhysicalCount = useCallback(async (rowId: string, physicalCount: number | null) => {
    const row = rows.find(r => r.id === rowId);
    if (!row || row.isSubmitted) return;

    const variance = physicalCount !== null ? physicalCount - row.calculatedBalance : 0;
    const { error } = await supabase
      .from('daily_stock_counts')
      .update({ physical_count: physicalCount, variance })
      .eq('id', rowId);
    if (error) { toast.error('Failed to update'); return; }
    setRows(prev => prev.map(r => r.id === rowId ? { ...r, physicalCount, variance } : r));
  }, [rows]);

  // Submit count
  const submitSheet = useCallback(async (branchId: string, date: string) => {
    const now = new Date().toISOString();
    const { error } = await supabase
      .from('daily_stock_counts')
      .update({ is_submitted: true, submitted_at: now })
      .eq('branch_id', branchId)
      .eq('count_date', date);
    if (error) { toast.error('Failed to submit: ' + error.message); return; }
    setRows(prev => prev.map(r => ({ ...r, isSubmitted: true, submittedAt: now })));
    toast.success('Count sheet submitted');
  }, []);

  // Unlock (admin only)
  const unlockSheet = useCallback(async (branchId: string, date: string) => {
    const { error } = await supabase
      .from('daily_stock_counts')
      .update({ is_submitted: false, submitted_at: null })
      .eq('branch_id', branchId)
      .eq('count_date', date);
    if (error) { toast.error('Failed to unlock: ' + error.message); return; }
    setRows(prev => prev.map(r => ({ ...r, isSubmitted: false, submittedAt: null })));
    toast.success('Count sheet unlocked');
  }, []);

  return {
    rows, loading, generating,
    loadSheet, generateSheet, updatePhysicalCount,
    submitSheet, unlockSheet,
  };
}
