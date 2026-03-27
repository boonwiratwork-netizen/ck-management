import { useState, useCallback, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toLocalDateStr } from "@/lib/utils";

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
  forecastSource: "forecast" | "historical" | "assumption";
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

export interface SmSkuInfo {
  skuId: string;
  skuCode: string;
  skuName: string;
}

export interface MenuInfo {
  menuId: string;
  menuCode: string;
  menuName: string;
}

interface HookReturn {
  branches: PlanningBranch[];
  suggestions: PlanSuggestion[];
  smSkusByBrand: Record<string, SmSkuInfo[]>;
  menusByBrand: Record<string, MenuInfo[]>;
  menuBomByMenuId: Record<string, Array<{ skuId: string; effectiveQty: number }>>;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  recalculateWithOverrides: (overrides: Record<string, number>) => void;
}

// ─── Cached data from the initial fetch ─────────────────────────────────────

interface CachedData {
  allBranches: Array<{ id: string; branch_name: string; brand_name: string; avg_selling_price: number | null }>;
  forecastByBranch: Map<string, any>;
  salesByBranch: Map<string, Array<{ menu_code: string; qty: number; branch_id: string; sale_date: string }>>;
  menuCodeToId: Map<string, string>;
  bomByMenu: Map<string, Array<{ skuId: string; effectiveQty: number }>>;
  smSkuMap: Map<string, { code: string; name: string }>;
  menuBrandMap: Map<string, string>; // menuId → brand_name
  // Per-branch ramen menu mix ratios for override recalculation
  // branchId → Map<menuId, ratio> where ratio = menuQty / totalRamenBowls
  menuMixByBranch: Map<string, Map<string, number>>;
  // Per-branch days with sales for scaling
  daysWithSalesByBranch: Map<string, number>;
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function usePlanningAgent({ smStockBalances, getOutputPerBatch }: HookInput): HookReturn {
  const smStockRef = useRef(smStockBalances);
  smStockRef.current = smStockBalances;
  const getOutputRef = useRef(getOutputPerBatch);
  getOutputRef.current = getOutputPerBatch;

  const [branches, setBranches] = useState<PlanningBranch[]>([]);
  const [suggestions, setSuggestions] = useState<PlanSuggestion[]>([]);
  const [smSkusByBrand, setSmSkusByBrand] = useState<Record<string, SmSkuInfo[]>>({});
  const [menusByBrand, setMenusByBrand] = useState<Record<string, MenuInfo[]>>({});
  const [menuBomByMenuId, setMenuBomByMenuId] = useState<
    Record<string, Array<{ skuId: string; effectiveQty: number }>>
  >({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const cachedDataRef = useRef<CachedData | null>(null);

  // ── Shared aggregation logic ────────────────────────────────────────────

  const aggregate = useCallback((cached: CachedData, bowlsOverrides: Record<string, number> | null) => {
    const { allBranches, forecastByBranch, salesByBranch, menuCodeToId, bomByMenu, smSkuMap, menuMixByBranch, daysWithSalesByBranch } = cached;

    const weeklyDemandBySku = new Map<string, number>();
    const resultBranches: PlanningBranch[] = [];

    for (const br of allBranches) {
      const branchId = br.id;
      const forecast = forecastByBranch.get(branchId) ?? null;
      const branchSales = salesByBranch.get(branchId) ?? [];
      const hasSalesHistory = branchSales.length > 0;
      const avgPrice = br.avg_selling_price ?? 0;

      let bowlsPerDay = 0;
      let forecastSource: PlanningBranch["forecastSource"] = "historical";
      let misconfigured = false;

      // ── Determine bowlsPerDay & weekly demand ───────────────────────
      if (forecast) {
        // Forecast branch — use bowls/day × grams_per_bowl as before
        if (forecast.forecast_unit === "thb_per_day") {
          if (!avgPrice || avgPrice <= 0) {
            misconfigured = true;
          } else {
            bowlsPerDay = forecast.forecast_value / avgPrice;
            forecastSource = "forecast";
          }
        } else {
          bowlsPerDay = forecast.forecast_value;
          forecastSource = "forecast";
        }

        // Apply override if provided
        if (bowlsOverrides && branchId in bowlsOverrides) {
          bowlsPerDay = bowlsOverrides[branchId];
        }

        // For forecast branches with assumption_mix, use grams_per_bowl approach
        if (forecast.assumption_mix && !hasSalesHistory) {
          forecastSource = "assumption";
          const mix = forecast.assumption_mix as Record<string, number>;
          if (!misconfigured) {
            for (const [skuId, gpb] of Object.entries(mix)) {
              if (typeof gpb === "number") {
                const weeklyG = gpb * bowlsPerDay * 7;
                weeklyDemandBySku.set(skuId, (weeklyDemandBySku.get(skuId) ?? 0) + weeklyG);
              }
            }
          }
        } else if (hasSalesHistory && !misconfigured) {
          // Forecast branch WITH sales history — use menu mix for SM demand
          const mixMap = menuMixByBranch.get(branchId);
          if (mixMap) {
            for (const [menuId, ratio] of mixMap) {
              const ingredients = bomByMenu.get(menuId);
              if (!ingredients) continue;
              for (const ing of ingredients) {
                const weeklyG = ratio * bowlsPerDay * 7 * ing.effectiveQty;
                weeklyDemandBySku.set(ing.skuId, (weeklyDemandBySku.get(ing.skuId) ?? 0) + weeklyG);
              }
            }
          }
        }
      } else if (hasSalesHistory) {
        // ── Historical branch — direct SM grams from sales × BOM ──────
        forecastSource = "historical";
        const daysWithSales = daysWithSalesByBranch.get(branchId) ?? 7;

        // Sum SM grams directly and count ramen bowls
        const totalSmGrams = new Map<string, number>();
        let totalRamenBowls = 0;

        for (const sale of branchSales) {
          const menuId = menuCodeToId.get(sale.menu_code);
          if (!menuId) continue;
          const ingredients = bomByMenu.get(menuId);
          if (!ingredients) continue;
          // This menu has SM BOM entries — it's a "ramen" menu
          totalRamenBowls += sale.qty;
          for (const ing of ingredients) {
            totalSmGrams.set(ing.skuId, (totalSmGrams.get(ing.skuId) ?? 0) + sale.qty * ing.effectiveQty);
          }
        }

        bowlsPerDay = daysWithSales > 0 ? totalRamenBowls / daysWithSales : 0;

        // Apply override if provided — recalculate using menu mix ratios
        if (bowlsOverrides && branchId in bowlsOverrides) {
          const overrideBowls = bowlsOverrides[branchId];
          bowlsPerDay = overrideBowls;
          const mixMap = menuMixByBranch.get(branchId);
          if (mixMap) {
            for (const [menuId, ratio] of mixMap) {
              const ingredients = bomByMenu.get(menuId);
              if (!ingredients) continue;
              for (const ing of ingredients) {
                const weeklyG = ratio * overrideBowls * 7 * ing.effectiveQty;
                weeklyDemandBySku.set(ing.skuId, (weeklyDemandBySku.get(ing.skuId) ?? 0) + weeklyG);
              }
            }
          }
        } else {
          // No override — weekly demand = (totalGrams / daysWithSales) × 7
          for (const [skuId, grams] of totalSmGrams) {
            const weeklyG = daysWithSales > 0 ? (grams / daysWithSales) * 7 : 0;
            weeklyDemandBySku.set(skuId, (weeklyDemandBySku.get(skuId) ?? 0) + weeklyG);
          }
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
    const stockMap = new Map(smStockRef.current.map((s) => [s.skuId, s.currentStock]));

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

    resultSuggestions.sort((a, b) => b.suggestedBatches - a.suggestedBatches);

    return { resultBranches, resultSuggestions };
  }, []);

  // ── Initial fetch + calculate ─────────────────────────────────────────

  const calculate = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const today = new Date();
      const todayStr = toLocalDateStr(today);
      const sevenAgo = new Date(today);
      sevenAgo.setDate(sevenAgo.getDate() - 7);
      const sevenAgoStr = toLocalDateStr(sevenAgo);

      const [branchRes, forecastRes, salesRes, menuRes, bomRes, skuRes] = await Promise.all([
        supabase.from("branches").select("id, branch_name, brand_name, avg_selling_price").eq("status", "Active"),
        supabase
          .from("branch_forecasts")
          .select("*")
          .gte("expires_at", todayStr)
          .order("created_at", { ascending: false }),
        supabase
          .from("sales_entries")
          .select("menu_code, qty, branch_id, sale_date")
          .gte("sale_date", sevenAgoStr)
          .lte("sale_date", todayStr),
        supabase.from("menus").select("id, menu_code, menu_name, brand_name"),
        supabase.from("menu_bom").select("menu_id, sku_id, effective_qty"),
        supabase.from("skus").select("id, sku_id, name, type").eq("type", "SM"),
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
      const smSkuIdSet = new Set(smSkus.map((s) => s.id));
      const smSkuMap = new Map(smSkus.map((s) => [s.id, { code: s.sku_id, name: s.name }]));
      const menuCodeToId = new Map(allMenus.map((m) => [m.menu_code, m.id]));
      const menuBrandMap = new Map(allMenus.map((m) => [m.id, m.brand_name]));

      const smBom = allBom.filter((b) => smSkuIdSet.has(b.sku_id));
      const bomByMenu = new Map<string, Array<{ skuId: string; effectiveQty: number }>>();
      for (const b of smBom) {
        const arr = bomByMenu.get(b.menu_id) ?? [];
        arr.push({ skuId: b.sku_id, effectiveQty: b.effective_qty });
        bomByMenu.set(b.menu_id, arr);
      }

      const salesByBranch = new Map<string, typeof allSales>();
      for (const s of allSales) {
        const arr = salesByBranch.get(s.branch_id) ?? [];
        arr.push(s);
        salesByBranch.set(s.branch_id, arr);
      }

      const forecastByBranch = new Map<string, (typeof allForecasts)[0]>();
      for (const f of allForecasts) {
        if (!forecastByBranch.has(f.branch_id)) {
          forecastByBranch.set(f.branch_id, f);
        }
      }

      // ── Derive smSkusByBrand ──────────────────────────────────────────
      const brandSkuSet = new Map<string, Set<string>>();
      for (const [menuId, ingredients] of bomByMenu) {
        const brand = menuBrandMap.get(menuId);
        if (!brand) continue;
        const set = brandSkuSet.get(brand) ?? new Set();
        for (const ing of ingredients) set.add(ing.skuId);
        brandSkuSet.set(brand, set);
      }
      const derivedSmSkusByBrand: Record<string, SmSkuInfo[]> = {};
      for (const [brand, skuIds] of brandSkuSet) {
        derivedSmSkusByBrand[brand] = Array.from(skuIds)
          .map((id) => {
            const info = smSkuMap.get(id);
            return info ? { skuId: id, skuCode: info.code, skuName: info.name } : null;
          })
          .filter((x): x is SmSkuInfo => x !== null)
          .sort((a, b) => a.skuCode.localeCompare(b.skuCode));
      }
      setSmSkusByBrand(derivedSmSkusByBrand);

      // ── Derive menusByBrand ──────────────────────────────────────────
      const derivedMenusByBrand: Record<string, MenuInfo[]> = {};
      for (const m of allMenus) {
        const brand = m.brand_name;
        if (!brand) continue;
        if (!bomByMenu.has(m.id)) continue;
        const arr = derivedMenusByBrand[brand] ?? [];
        arr.push({ menuId: m.id, menuCode: m.menu_code, menuName: m.menu_name });
        derivedMenusByBrand[brand] = arr;
      }
      for (const brand of Object.keys(derivedMenusByBrand)) {
        derivedMenusByBrand[brand].sort((a, b) => a.menuCode.localeCompare(b.menuCode));
      }
      setMenusByBrand(derivedMenusByBrand);

      // ── Derive menuBomByMenuId ───────────────────────────────────────
      const derivedMenuBom: Record<string, Array<{ skuId: string; effectiveQty: number }>> = {};
      for (const [menuId, ingredients] of bomByMenu) {
        derivedMenuBom[menuId] = ingredients;
      }
      setMenuBomByMenuId(derivedMenuBom);

      // ── Precompute per-branch menu mix ratios & days with sales ──────
      const menuMixByBranch = new Map<string, Map<string, number>>();
      const daysWithSalesByBranch = new Map<string, number>();

      for (const [branchId, sales] of salesByBranch) {
        // Count distinct sale dates
        const dateSet = new Set(sales.map(s => s.sale_date));
        daysWithSalesByBranch.set(branchId, dateSet.size);

        // Count ramen bowls per menu (menus with SM BOM entries)
        const qtyByMenu = new Map<string, number>();
        let totalRamenBowls = 0;
        for (const sale of sales) {
          const menuId = menuCodeToId.get(sale.menu_code);
          if (!menuId) continue;
          if (!bomByMenu.has(menuId)) continue;
          qtyByMenu.set(menuId, (qtyByMenu.get(menuId) ?? 0) + sale.qty);
          totalRamenBowls += sale.qty;
        }

        if (totalRamenBowls > 0) {
          const ratioMap = new Map<string, number>();
          for (const [menuId, qty] of qtyByMenu) {
            ratioMap.set(menuId, qty / totalRamenBowls);
          }
          menuMixByBranch.set(branchId, ratioMap);
        }
      }

      // Cache for recalculation
      const cached: CachedData = {
        allBranches,
        forecastByBranch,
        salesByBranch,
        menuCodeToId,
        bomByMenu,
        smSkuMap,
        menuBrandMap,
        menuMixByBranch,
        daysWithSalesByBranch,
      };
      cachedDataRef.current = cached;

      const { resultBranches, resultSuggestions } = aggregate(cached, null);

      setBranches(resultBranches);
      setSuggestions(resultSuggestions);
    } catch (err: any) {
      setError(err.message ?? "Failed to calculate planning data");
    } finally {
      setIsLoading(false);
    }
  }, [aggregate]);

  useEffect(() => {
    calculate();
  }, [calculate]);

  // ── Recalculate with bowlsPerDay overrides (no re-fetch) ──────────────

  const recalculateWithOverrides = useCallback(
    (overrides: Record<string, number>) => {
      const cached = cachedDataRef.current;
      if (!cached) return;
      const { resultBranches, resultSuggestions } = aggregate(cached, overrides);
      setBranches(resultBranches);
      setSuggestions(resultSuggestions);
    },
    [aggregate],
  );

  return {
    branches,
    suggestions,
    smSkusByBrand,
    menusByBrand,
    menuBomByMenuId,
    isLoading,
    error,
    refetch: calculate,
    recalculateWithOverrides,
  };
}
