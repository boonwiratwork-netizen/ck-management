import { useState, useCallback, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toLocalDateStr } from "@/lib/utils";
import { fetchAllRows } from "@/lib/fetch-all";
import { loadSmUse, type SmUseRead } from "@/hooks/use-sm-daily-usage";

// ─── Types ──────────────────────────────────────────────────────────────────

interface SmStockBalance {
  skuId: string;
  currentStock: number;
}

interface HookInput {
  smStockBalances: SmStockBalance[];
  getOutputPerBatch: (skuId: string) => number;
  /**
   * The kitchen's daily-use read (useSmDailyUsage), so the week of sales is read once and
   * both show the same numbers; not given = this hook reads it itself
   */
  smUse?: { read: SmUseRead | null; error: boolean };
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

/** A menu's kitchen-made recipe line; branchId null = every branch, else that branch only */
export type SmMenuLine = { skuId: string; effectiveQty: number; branchId: string | null };

interface HookReturn {
  branches: PlanningBranch[];
  suggestions: PlanSuggestion[];
  smSkusByBrand: Record<string, SmSkuInfo[]>;
  menusByBrand: Record<string, MenuInfo[]>;
  menuBomByMenuId: Record<string, SmMenuLine[]>;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  recalculateWithOverrides: (overrides: Record<string, number>) => void;
}

// ─── Cached data from the initial fetch ─────────────────────────────────────

interface CachedData {
  allBranches: Array<{ id: string; branch_name: string; brand_name: string; avg_selling_price: number | null }>;
  forecastByBranch: Map<string, any>;
  /** Branches that sold anything in the window */
  salesBranches: Set<string>;
  smSkuMap: Map<string, { code: string; name: string }>;
  // branchId → SM item → used per day: the kitchen stock / production figure (use-sm-daily-usage.ts)
  usePerDayByBranch: Map<string, Record<string, number>>;
  // branchId → bowls per selling day (sales of menus with a kitchen-made line), what a bowls override scales
  bowlsPerDayByBranch: Map<string, number>;
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function usePlanningAgent({ smStockBalances, getOutputPerBatch, smUse }: HookInput): HookReturn {
  const given = smUse !== undefined;
  const givenRead = smUse?.read ?? null;
  const givenError = !!smUse?.error;
  const smStockRef = useRef(smStockBalances);
  smStockRef.current = smStockBalances;
  const getOutputRef = useRef(getOutputPerBatch);
  getOutputRef.current = getOutputPerBatch;

  const [branches, setBranches] = useState<PlanningBranch[]>([]);
  const [suggestions, setSuggestions] = useState<PlanSuggestion[]>([]);
  const [smSkusByBrand, setSmSkusByBrand] = useState<Record<string, SmSkuInfo[]>>({});
  const [menusByBrand, setMenusByBrand] = useState<Record<string, MenuInfo[]>>({});
  const [menuBomByMenuId, setMenuBomByMenuId] = useState<Record<string, SmMenuLine[]>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const cachedDataRef = useRef<CachedData | null>(null);

  // ── Shared aggregation logic ────────────────────────────────────────────

  const aggregate = useCallback((cached: CachedData, bowlsOverrides: Record<string, number> | null) => {
    const { allBranches, forecastByBranch, salesBranches, smSkuMap, usePerDayByBranch, bowlsPerDayByBranch } = cached;

    const weeklyDemandBySku = new Map<string, number>();
    const resultBranches: PlanningBranch[] = [];

    for (const br of allBranches) {
      const branchId = br.id;
      const forecast = forecastByBranch.get(branchId) ?? null;
      const hasSalesHistory = salesBranches.has(branchId);
      const avgPrice = br.avg_selling_price ?? 0;
      const soldBowls = bowlsPerDayByBranch.get(branchId) ?? 0;
      // A week of the branch's own use per day (the number kitchen stock and production
      // show), scaled when the bowls planned differ from the bowls sold. It used to be
      // worked out here from recipe lines alone: no SP, no options or toppings, other
      // branches' own lines included, no waste, and at most one page of sales
      const addWeek = (bowls: number) => {
        const scale = soldBowls > 0 ? bowls / soldBowls : 1;
        for (const [skuId, q] of Object.entries(usePerDayByBranch.get(branchId) ?? {})) weeklyDemandBySku.set(skuId, (weeklyDemandBySku.get(skuId) ?? 0) + q * 7 * scale);
      };

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
          // Forecast branch WITH sales history — its own use, scaled to the forecast bowls
          addWeek(bowlsPerDay);
        }
      } else if (hasSalesHistory) {
        // ── Historical branch — its own use per day × 7 (an override scales it) ──
        forecastSource = "historical";
        bowlsPerDay = bowlsOverrides && branchId in bowlsOverrides ? bowlsOverrides[branchId] : soldBowls;
        addWeek(bowlsPerDay);
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
      const todayStr = toLocalDateStr(new Date());
      // The kitchen's read when given: still on its way = wait; failed = say so
      if (given && !givenRead) {
        if (givenError) {
          setError("โหลดยอดขาย 7 วันไม่สำเร็จ");
          setIsLoading(false);
        }
        return;
      }

      const [branchRes, forecastRes, menuRes, skuRes, use] = await Promise.all([
        supabase.from("branches").select("id, branch_name, brand_name, avg_selling_price").eq("status", "Active"),
        supabase
          .from("branch_forecasts")
          .select("*")
          .gte("expires_at", todayStr)
          .order("created_at", { ascending: false }),
        fetchAllRows<{ id: string; menu_code: string; menu_name: string; brand_name: string }>((a, b) => supabase.from("menus").select("id, menu_code, menu_name, brand_name").order("id").range(a, b) as never),
        supabase.from("skus").select("id, sku_id, name, type").eq("type", "SM"),
        // Sales, recipes and waste of the shared 7-day window, worked out as kitchen stock does
        givenRead ?? loadSmUse(todayStr),
      ]);

      if (branchRes.error) throw branchRes.error;
      if (forecastRes.error) throw forecastRes.error;
      if (menuRes.error) throw menuRes.error;
      if (skuRes.error) throw skuRes.error;

      const allBranches = branchRes.data ?? [];
      const allForecasts = forecastRes.data ?? [];
      const allMenus = menuRes.data;
      const smSkus = skuRes.data ?? [];

      // ── Lookup maps ─────────────────────────────────────────────────────
      const smSkuIdSet = new Set(smSkus.map((s) => s.id));
      const smSkuMap = new Map(smSkus.map((s) => [s.id, { code: s.sku_id, name: s.name }]));
      const menuCodeToId = new Map(allMenus.map((m) => [m.menu_code, m.id]));
      const menuBrandMap = new Map(allMenus.map((m) => [m.id, m.brand_name]));

      // Kitchen-made recipe lines per menu, each with its branch (null = every branch)
      const bomByMenu = new Map<string, SmMenuLine[]>();
      for (const [menuId, lines] of use.ctx.bomByMenu) {
        const sm = lines.filter((l) => smSkuIdSet.has(l.skuId)).map((l) => ({ skuId: l.skuId, effectiveQty: l.effectiveQty, branchId: l.branchId }));
        if (sm.length) bomByMenu.set(menuId, sm);
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
      const derivedMenuBom: Record<string, SmMenuLine[]> = {};
      for (const [menuId, ingredients] of bomByMenu) {
        derivedMenuBom[menuId] = ingredients;
      }
      setMenuBomByMenuId(derivedMenuBom);

      // ── Bowls per selling day per branch (what the ชาม/วัน box shows and scales) ──
      const bowlsByBranch = new Map<string, number>();
      for (const sale of use.sales) {
        const menuId = menuCodeToId.get(sale.menu_code);
        const lines = menuId ? bomByMenu.get(menuId) : undefined;
        // A menu with a kitchen-made line at this branch counts as a bowl
        if (!lines || !lines.some((l) => l.branchId === null || l.branchId === sale.branch_id)) continue;
        bowlsByBranch.set(sale.branch_id, (bowlsByBranch.get(sale.branch_id) ?? 0) + (Number(sale.qty) || 0));
      }
      const bowlsPerDayByBranch = new Map<string, number>();
      for (const [branchId, bowls] of bowlsByBranch) {
        const days = use.sellingDays.get(branchId) ?? 0;
        bowlsPerDayByBranch.set(branchId, days > 0 ? bowls / days : 0);
      }

      // Cache for recalculation
      const cached: CachedData = {
        allBranches,
        forecastByBranch,
        salesBranches: new Set(use.sales.map((s) => s.branch_id)),
        smSkuMap,
        usePerDayByBranch: use.perDay,
        bowlsPerDayByBranch,
      };
      cachedDataRef.current = cached;

      const { resultBranches, resultSuggestions } = aggregate(cached, null);

      setBranches(resultBranches);
      setSuggestions(resultSuggestions);
    } catch (err: any) {
      setError(err.message ?? "Failed to calculate planning data");
    } finally {
      // Still waiting for the kitchen's read: stay loading
      if (!given || givenRead) setIsLoading(false);
    }
  }, [aggregate, given, givenRead, givenError]);

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
