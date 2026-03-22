import { useState, useCallback, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toLocalDateStr } from '@/lib/utils';

// ─── Types ──────────────────────────────────────────────────────────────────

interface SmStockBalance {
  skuId: string;
  currentStock: number;
}

interface HookInput {
  smStockBalances: SmStockBalance[];
  getOutputPerBatch: (skuId: string) => number;
}

export interface PlanningBranch {
  branchId: string;
  branchName: string;
  brandName: string;
  forecastSource: 'forecast' | 'historical' | 'assumption';
  bowlsPerDay: number;
  forecastValue?: number;
  forecastUnit?: string;
  expiresAt?: string;
  hasSalesHistory: boolean;
  misconfigured: boolean;
}

export interface PlanSuggestion {
  skuId: string;
  skuCode: string;
  skuName: string;
  weeklyDemandG: number;
  currentStockG: number;
  suggestedBatches: number;
  outputPerBatch: number;
}

interface HookReturn {
  branches: PlanningBranch[];
  suggestions: PlanSuggestion[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function usePlanningAgent({ smStockBalances, getOutputPerBatch }: HookInput): HookReturn {
  const smStockRef = useRef(smStockBalances);
  smStockRef.current = smStockBalances;
  const getOutputRef = useRef(getOutputPerBatch);
  getOutputRef.current = getOutputPerBatch;
  const [branches, setBranches] = useState<PlanningBranch[]>([]);
  const [suggestions, setSuggestions] = useState<PlanSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const calculate = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const today = new Date();
      const todayStr = toLocalDateStr(today);
      const sevenAgo = new Date(today);
      sevenAgo.setDate(sevenAgo.getDate() - 7);
      const sevenAgoStr = toLocalDateStr(sevenAgo);

      // ── Parallel fetches ────────────────────────────────────────────────
      const [branchRes, forecastRes, salesRes, menuRes, bomRes, skuRes] = await Promise.all([
        supabase.from('branches').select('id, branch_name, brand_name, avg_selling_price').eq('status', 'Active'),
        supabase.from('branch_forecasts').select('*').gte('expires_at', todayStr).order('created_at', { ascending: false }),
        supabase.from('sales_entries').select('menu_code, qty, branch_id, sale_date').gte('sale_date', sevenAgoStr).lte('sale_date', todayStr),
        supabase.from('menus').select('id, menu_code, brand_name'),
        supabase.from('menu_bom').select('menu_id, sku_id, effective_qty'),
        supabase.from('skus').select('id, sku_id, name, type').eq('type', 'SM'),
      ]);

      if (branchRes.error) throw branchRes.error;
      if (forecastRes.error) throw forecastRes.error;
      if (salesRes.error) throw salesRes.error;
      if (menuRes.error) throw menuRes.error;
      if (bomRes.error) throw bomRes.error;
      if (skuRes.error) throw skuRes.error;

      const allBranches = branchRes.data ?? [];
      const allForecasts = forecastRes.data ?? [];
      const allSales = salesRes.data ?? [];
      const allMenus = menuRes.data ?? [];
      const allBom = bomRes.data ?? [];
      const smSkus = skuRes.data ?? [];

      // ── Lookup maps ─────────────────────────────────────────────────────
      const smSkuIdSet = new Set(smSkus.map(s => s.id));
      const smSkuMap = new Map(smSkus.map(s => [s.id, { code: s.sku_id, name: s.name }]));

      // menu_code → menu id
      const menuCodeToId = new Map(allMenus.map(m => [m.menu_code, m.id]));

      // Filter BOM to SM-only ingredients
      const smBom = allBom.filter(b => smSkuIdSet.has(b.sku_id));

      // menu_id → Array<{ skuId, effectiveQty }>
      const bomByMenu = new Map<string, Array<{ skuId: string; effectiveQty: number }>>();
      for (const b of smBom) {
        const arr = bomByMenu.get(b.menu_id) ?? [];
        arr.push({ skuId: b.sku_id, effectiveQty: b.effective_qty });
        bomByMenu.set(b.menu_id, arr);
      }

      // Sales grouped by branch
      const salesByBranch = new Map<string, typeof allSales>();
      for (const s of allSales) {
        const arr = salesByBranch.get(s.branch_id) ?? [];
        arr.push(s);
        salesByBranch.set(s.branch_id, arr);
      }

      // Active forecast per branch (first = most recent due to order)
      const forecastByBranch = new Map<string, (typeof allForecasts)[0]>();
      for (const f of allForecasts) {
        if (!forecastByBranch.has(f.branch_id)) {
          forecastByBranch.set(f.branch_id, f);
        }
      }

      // ── Per-branch calculations ─────────────────────────────────────────
      const weeklyDemandBySku = new Map<string, number>();
      const resultBranches: PlanningBranch[] = [];

      for (const br of allBranches) {
        const branchId = br.id;
        const forecast = forecastByBranch.get(branchId) ?? null;
        const branchSales = salesByBranch.get(branchId) ?? [];
        const hasSalesHistory = branchSales.length > 0;
        const avgPrice = br.avg_selling_price ?? 0;

        let bowlsPerDay = 0;
        let forecastSource: PlanningBranch['forecastSource'] = 'historical';
        let misconfigured = false;

        // ── Determine bowlsPerDay ───────────────────────────────────────
        if (forecast) {
          if (forecast.forecast_unit === 'thb_per_day') {
            if (!avgPrice || avgPrice <= 0) {
              misconfigured = true;
              // Can't convert — skip this branch's demand contribution
            } else {
              bowlsPerDay = forecast.forecast_value / avgPrice;
              forecastSource = 'forecast';
            }
          } else {
            // bowls_per_day
            bowlsPerDay = forecast.forecast_value;
            forecastSource = 'forecast';
          }
        } else if (hasSalesHistory) {
          const totalQty = branchSales.reduce((sum, s) => sum + s.qty, 0);
          bowlsPerDay = totalQty / 7;
          forecastSource = 'historical';
        }
        // else bowlsPerDay stays 0

        // ── SM demand for this branch ───────────────────────────────────
        // Calculate grams-per-bowl from actual sales mix
        const smGramsPerBowl = new Map<string, number>();

        if (hasSalesHistory) {
          // Sum SM grams consumed and total bowls sold
          let totalBowls = 0;
          const totalSmGrams = new Map<string, number>();

          for (const sale of branchSales) {
            const menuId = menuCodeToId.get(sale.menu_code);
            if (!menuId) continue;
            totalBowls += sale.qty;
            const ingredients = bomByMenu.get(menuId);
            if (!ingredients) continue;
            for (const ing of ingredients) {
              totalSmGrams.set(ing.skuId, (totalSmGrams.get(ing.skuId) ?? 0) + sale.qty * ing.effectiveQty);
            }
          }

          if (totalBowls > 0) {
            for (const [skuId, grams] of totalSmGrams) {
              smGramsPerBowl.set(skuId, grams / totalBowls);
            }
          }
        } else if (forecast && forecast.assumption_mix) {
          // Use assumption_mix: { sku_id: grams_per_bowl }
          forecastSource = 'assumption';
          const mix = forecast.assumption_mix as Record<string, number>;
          for (const [skuId, gpb] of Object.entries(mix)) {
            if (typeof gpb === 'number') {
              smGramsPerBowl.set(skuId, gpb);
            }
          }
        }

        // Weekly demand = grams_per_bowl × bowls_per_day × 7
        if (!misconfigured) {
          for (const [skuId, gpb] of smGramsPerBowl) {
            const weeklyG = gpb * bowlsPerDay * 7;
            weeklyDemandBySku.set(skuId, (weeklyDemandBySku.get(skuId) ?? 0) + weeklyG);
          }
        }

        resultBranches.push({
          branchId,
          branchName: br.branch_name,
          brandName: br.brand_name,
          forecastSource,
          bowlsPerDay: Math.round(bowlsPerDay * 10) / 10,
          forecastValue: forecast?.forecast_value,
          forecastUnit: forecast?.forecast_unit,
          expiresAt: forecast?.expires_at,
          hasSalesHistory,
          misconfigured,
        });
      }

      // ── Stock balance map ───────────────────────────────────────────────
      const stockMap = new Map(smStockRef.current.map(s => [s.skuId, s.currentStock]));

      // ── Build suggestions ───────────────────────────────────────────────
      const resultSuggestions: PlanSuggestion[] = [];

      for (const [skuId, weeklyDemandG] of weeklyDemandBySku) {
        const info = smSkuMap.get(skuId);
        if (!info) continue;

        const currentStockG = Math.max(0, stockMap.get(skuId) ?? 0);
        const outputPerBatch = getOutputRef.current(skuId);
        const gap = weeklyDemandG - currentStockG;
        const suggestedBatches = outputPerBatch > 0 ? Math.max(0, Math.ceil(gap / outputPerBatch)) : 0;

        resultSuggestions.push({
          skuId,
          skuCode: info.code,
          skuName: info.name,
          weeklyDemandG: Math.round(weeklyDemandG),
          currentStockG: Math.round(currentStockG),
          suggestedBatches,
          outputPerBatch,
        });
      }

      // Sort by suggestedBatches desc
      resultSuggestions.sort((a, b) => b.suggestedBatches - a.suggestedBatches);

      if (resultBranches.length > 0 && resultSuggestions.length > 0) {
        console.log('[PlanningAgent]', { branches: resultBranches, suggestions: resultSuggestions });
      }

      setBranches(resultBranches);
      setSuggestions(resultSuggestions);
    } catch (err: any) {
      setError(err.message ?? 'Failed to calculate planning data');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { calculate(); }, [calculate]);

  return { branches, suggestions, isLoading, error, refetch: calculate };
}
