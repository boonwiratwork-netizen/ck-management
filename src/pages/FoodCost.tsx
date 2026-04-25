import { useState, useMemo, useCallback, useEffect } from "react";
import { useLanguage } from "@/hooks/use-language";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, eachDayOfInterval, subMonths, lastDayOfMonth, getDaysInMonth } from "date-fns";
import { Calculator, TrendingDown, TrendingUp, Download, Info, Plus, X } from "lucide-react";
import { Tooltip as ShadTooltip, TooltipContent as ShadTooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { UnitLabel } from "@/components/ui/unit-label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useSortableTable } from "@/hooks/use-sortable-table";
import { SortableHeader } from "@/components/SortableHeader";
import {
  BarChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ComposedChart,
  Legend,
} from "recharts";
import { cn } from "@/lib/utils";
import { SKU } from "@/types/sku";
import { Price } from "@/types/price";
import { Menu } from "@/types/menu";
import { MenuBomLine } from "@/types/menu-bom";
import { ModifierRule } from "@/types/modifier-rule";
import { SpBomLine } from "@/types/sp-bom";
import { Branch } from "@/types/branch";
import { Supplier } from "@/types/supplier";
import { useAuth } from "@/hooks/use-auth";
import { getCatBadgeClass } from "@/lib/design-tokens";

interface FoodCostPageProps {
  skus: SKU[];
  prices: Price[];
  menus: Menu[];
  menuBomLines: MenuBomLine[];
  modifierRules: ModifierRule[];
  spBomLines: SpBomLine[];
  branches: Branch[];
  suppliers: Supplier[];
}

type DatePreset = "today" | "this-week" | "this-month" | "custom";

interface DailyData {
  date: string;
  label: string;
  revenue: number;
  stdFoodCost: number;
  stdFcPct: number;
  avgTicketSize: number;
}

interface SkuBreakdown {
  skuId: string;
  skuCode: string;
  skuName: string;
  type: string;
  expectedUsage: number;
  uom: string;
  stdUnitPrice: number;
  stdCost: number;
}

interface MenuBreakdown {
  menuCode: string;
  menuName: string;
  qtySold: number;
  revenue: number;
  stdFoodCost: number;
  stdFcPct: number;
  costPerServing: number;
  isMaindish: boolean;
}

interface SkuVarianceRow {
  skuId: string;
  skuCode: string;
  skuName: string;
  type: string;
  uom: string;
  stdQty: number;
  stdCost: number;
  actQty: number | null;
  actPrice: number | null;
  actCost: number | null;
  qtyVar: number | null;
  priceVarThb: number | null;
  totalVarThb: number | null;
  movementDetail: {
    opening: number | null;
    received: number;
    closingActual: number | null;
    closingCalc: number | null;
  } | null;
}

export default function FoodCostPage({
  skus,
  prices,
  menus,
  menuBomLines,
  modifierRules,
  spBomLines,
  branches,
  suppliers,
}: FoodCostPageProps) {
  const { isManagement, isStoreManager, profile } = useAuth();
  const { t } = useLanguage();
  const today = new Date();

  const [preset, setPreset] = useState<DatePreset>("today");
  const [dateFrom, setDateFrom] = useState<Date>(today);
  const [dateTo, setDateTo] = useState<Date>(today);
  const [selectedBranch, setSelectedBranch] = useState<string>(
    isStoreManager && profile?.branch_id ? profile.branch_id : "all",
  );
  const [loading, setLoading] = useState(false);
  const [calculated, setCalculated] = useState(false);
  const [autoCalcTrigger, setAutoCalcTrigger] = useState(0);

  // Results
  const [dailyData, setDailyData] = useState<DailyData[]>([]);
  const [skuBreakdown, setSkuBreakdown] = useState<SkuBreakdown[]>([]);
  const [menuBreakdown, setMenuBreakdown] = useState<MenuBreakdown[]>([]);
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [totalStdCost, setTotalStdCost] = useState(0);
  const [totalReceiptCount, setTotalReceiptCount] = useState(0);

  // Ratio analysis metrics — keys: "avg_ticket" | "ratio:<category>"
  const RATIO_METRICS_KEY = "fc_ratio_metrics_v1";
  const [ratioMetrics, setRatioMetrics] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(RATIO_METRICS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return ["avg_ticket"];
  });
  useEffect(() => {
    try { localStorage.setItem(RATIO_METRICS_KEY, JSON.stringify(ratioMetrics)); } catch {}
  }, [ratioMetrics]);
  const [addMetricOpen, setAddMetricOpen] = useState(false);

  // Actual vs Standard Variance state
  const [actualVarianceData, setActualVarianceData] = useState<SkuVarianceRow[] | null>(null);
  const [varianceSummary, setVarianceSummary] = useState<{
    totalVariance: number;
    priceVariance: number;
    usageVariance: number;
    actualCost: number;
  } | null>(null);
  const [varianceDataCoverage, setVarianceDataCoverage] = useState<{
    skusWithActual: number;
    totalSkus: number;
    openingDate: string;
    closingDate: string;
  } | null>(null);

  // Check if selected period is a full calendar month
  const isMonthlyPeriod = useMemo(() => {
    const fromStr = format(dateFrom, "yyyy-MM-dd");
    const toStr = format(dateTo, "yyyy-MM-dd");
    const firstOfMonth = format(startOfMonth(dateFrom), "yyyy-MM-dd");
    const lastOfMonth = format(endOfMonth(dateFrom), "yyyy-MM-dd");
    return fromStr === firstOfMonth && toStr === lastOfMonth;
  }, [dateFrom, dateTo]);

  // Check if the selected month is in the past (not the current month)
  const isPastMonth = useMemo(() => {
    const todayMonth = format(new Date(), "yyyy-MM");
    const selectedMonth = format(dateFrom, "yyyy-MM");
    return selectedMonth < todayMonth;
  }, [dateFrom]);

  // Single source of truth for variance eligibility
  const canShowVariance = isMonthlyPeriod && isPastMonth && selectedBranch !== "all";

  // FC% threshold configuration
  const FC_GREEN_MAX = 30;
  const FC_AMBER_MAX = 35;

  const activeBranches = useMemo(() => branches.filter((b) => b.status === "Active"), [branches]);

  // Preset buttons now auto-calculate
  const handlePresetChange = (p: DatePreset) => {
    setPreset(p);
    if (p === "today") {
      setDateFrom(today);
      setDateTo(today);
    } else if (p === "this-week") {
      setDateFrom(startOfWeek(today, { weekStartsOn: 1 }));
      setDateTo(endOfWeek(today, { weekStartsOn: 1 }));
    } else if (p === "this-month") {
      setDateFrom(startOfMonth(today));
      setDateTo(endOfMonth(today));
    }
    if (p !== "custom") {
      setAutoCalcTrigger((prev) => prev + 1);
    }
  };

  // Build lookup maps
  const skuMap = useMemo(() => {
    const m = new Map<string, SKU>();
    skus.forEach((s) => m.set(s.id, s));
    return m;
  }, [skus]);

  const stdPriceMap = useMemo(() => {
    const m = new Map<string, number>();
    prices
      .filter((p) => p.isActive)
      .forEach((p) => {
        if (!m.has(p.skuId)) m.set(p.skuId, p.pricePerUsageUom);
      });
    return m;
  }, [prices]);

  const menuByCode = useMemo(() => {
    const m = new Map<string, Menu>();
    menus.forEach((menu) => m.set(menu.menuCode, menu));
    return m;
  }, [menus]);

  const bomByMenuId = useMemo(() => {
    const filtered = menuBomLines.filter(l => l.branchId === null || (selectedBranch !== 'all' && l.branchId === selectedBranch));
    const m = new Map<string, MenuBomLine[]>();
    filtered.forEach((l) => {
      const arr = m.get(l.menuId) || [];
      arr.push(l);
      m.set(l.menuId, arr);
    });
    return m;
  }, [menuBomLines, selectedBranch]);

  const spBomBySpSku = useMemo(() => {
    const m = new Map<string, SpBomLine[]>();
    spBomLines.forEach((l) => {
      const arr = m.get(l.spSkuId) || [];
      arr.push(l);
      m.set(l.spSkuId, arr);
    });
    return m;
  }, [spBomLines]);

  const activeRules = useMemo(() => modifierRules.filter((r) => {
    if (!r.isActive) return false;
    if (r.branchIds && r.branchIds.length > 0 && selectedBranch !== 'all' && !r.branchIds.includes(selectedBranch)) return false;
    return true;
  }), [modifierRules, selectedBranch]);

  const calcUsage = useCallback(
    (sales: any[]): Record<string, number> => {
      const usage: Record<string, number> = {};
      const add = (skuId: string, qty: number) => {
        usage[skuId] = (usage[skuId] || 0) + qty;
      };

      for (const sale of sales) {
        const qty = Number(sale.qty) || 0;
        if (qty === 0) continue;
        const menu = menuByCode.get(sale.menu_code);
        if (!menu) continue;

        const bomLines = bomByMenuId.get(menu.id) || [];
        for (const line of bomLines) {
          const ingredientQty = line.effectiveQty * qty;
          const sku = skuMap.get(line.skuId);
          if (sku && sku.type === "SP") {
            const spLines = spBomBySpSku.get(line.skuId) || [];
            for (const sp of spLines) {
              add(sp.ingredientSkuId, (sp.qtyPerBatch / sp.batchYieldQty) * ingredientQty);
            }
          } else {
            add(line.skuId, ingredientQty);
          }
        }

        for (const rule of activeRules) {
          if (rule.menuIds.length > 0 && !rule.menuIds.includes(menu.id)) continue;
          const menuName = sale.menu_name || "";
          const ruleMatches = rule.ruleType === "submenu"
            ? sale.menu_code === rule.keyword
            : menuName.includes(rule.keyword);
          if (ruleMatches) {
            if (rule.ruleType === "swap") {
              if (rule.swapSkuId) {
                const bomLines2 = bomByMenuId.get(menu.id) || [];
                for (const line of bomLines2) {
                  if (line.skuId === rule.swapSkuId) {
                    add(rule.swapSkuId, -(line.effectiveQty * qty));
                  }
                }
              }
              const modQty = rule.qtyPerMatch * qty;
              const modSku = skuMap.get(rule.skuId);
              if (modSku && modSku.type === "SP") {
                const spLines = spBomBySpSku.get(rule.skuId) || [];
                for (const sp of spLines) {
                  add(sp.ingredientSkuId, (sp.qtyPerBatch / sp.batchYieldQty) * modQty);
                }
              } else {
                add(rule.skuId, modQty);
              }
            } else if (rule.ruleType === "submenu") {
              if (rule.submenuId) {
                const subBomLines = bomByMenuId.get(rule.submenuId) || [];
                for (const line of subBomLines) {
                  const iq = line.effectiveQty * qty;
                  const sk = skuMap.get(line.skuId);
                  if (sk && sk.type === "SP") {
                    const spLines = spBomBySpSku.get(line.skuId) || [];
                    for (const sp of spLines) {
                      add(sp.ingredientSkuId, (sp.qtyPerBatch / sp.batchYieldQty) * iq);
                    }
                  } else {
                    add(line.skuId, iq);
                  }
                }
              }
            } else {
              const modQty = rule.qtyPerMatch * qty;
              const modSku = skuMap.get(rule.skuId);
              if (modSku && modSku.type === "SP") {
                const spLines = spBomBySpSku.get(rule.skuId) || [];
                for (const sp of spLines) {
                  add(sp.ingredientSkuId, (sp.qtyPerBatch / sp.batchYieldQty) * modQty);
                }
              } else {
                add(rule.skuId, modQty);
              }
            }
          }
        }
      }
      return usage;
    },
    [menuByCode, bomByMenuId, spBomBySpSku, skuMap, activeRules],
  );

  const calcMenuCosts = useCallback(
    (sales: any[]): MenuBreakdown[] => {
      const mMap = new Map<string, { qtySold: number; revenue: number; stdCost: number }>();

      for (const sale of sales) {
        const qty = Number(sale.qty) || 0;
        if (qty === 0) continue;
        const menu = menuByCode.get(sale.menu_code);
        if (!menu) continue;

        const existing = mMap.get(menu.menuCode) || { qtySold: 0, revenue: 0, stdCost: 0 };
        existing.qtySold += qty;
        existing.revenue += Number(sale.net_amount) || 0;

        let saleCost = 0;
        const bomLines = bomByMenuId.get(menu.id) || [];
        for (const line of bomLines) {
          const ingredientQty = line.effectiveQty * qty;
          const sku = skuMap.get(line.skuId);
          if (sku && sku.type === "SP") {
            const spLines = spBomBySpSku.get(line.skuId) || [];
            for (const sp of spLines) {
              saleCost +=
                (sp.qtyPerBatch / sp.batchYieldQty) * ingredientQty * (stdPriceMap.get(sp.ingredientSkuId) || 0);
            }
          } else {
            saleCost += ingredientQty * (stdPriceMap.get(line.skuId) || 0);
          }
        }

        for (const rule of activeRules) {
          if (rule.menuIds.length > 0 && !rule.menuIds.includes(menu.id)) continue;
          const menuName = sale.menu_name || "";
          const ruleMatches = rule.ruleType === "submenu"
            ? sale.menu_code === rule.keyword
            : menuName.includes(rule.keyword);
          if (ruleMatches) {
            if (rule.ruleType === "swap") {
              if (rule.swapSkuId) {
                const bomLines2 = bomByMenuId.get(menu.id) || [];
                for (const line of bomLines2) {
                  if (line.skuId === rule.swapSkuId) {
                    const removeQty = line.effectiveQty * qty;
                    const rmSku = skuMap.get(rule.swapSkuId);
                    if (rmSku && rmSku.type === "SP") {
                      const spLines = spBomBySpSku.get(rule.swapSkuId) || [];
                      for (const sp of spLines) {
                        saleCost -=
                          (sp.qtyPerBatch / sp.batchYieldQty) * removeQty * (stdPriceMap.get(sp.ingredientSkuId) || 0);
                      }
                    } else {
                      saleCost -= removeQty * (stdPriceMap.get(rule.swapSkuId) || 0);
                    }
                  }
                }
              }
              const modQty = rule.qtyPerMatch * qty;
              const modSku = skuMap.get(rule.skuId);
              if (modSku && modSku.type === "SP") {
                const spLines = spBomBySpSku.get(rule.skuId) || [];
                for (const sp of spLines) {
                  saleCost += (sp.qtyPerBatch / sp.batchYieldQty) * modQty * (stdPriceMap.get(sp.ingredientSkuId) || 0);
                }
              } else {
                saleCost += modQty * (stdPriceMap.get(rule.skuId) || 0);
              }
            } else if (rule.ruleType === "submenu") {
              if (rule.submenuId) {
                const subBomLines = bomByMenuId.get(rule.submenuId) || [];
                for (const line of subBomLines) {
                  const iq = line.effectiveQty * qty;
                  const sk = skuMap.get(line.skuId);
                  if (sk && sk.type === "SP") {
                    const spLines = spBomBySpSku.get(line.skuId) || [];
                    for (const sp of spLines) {
                      saleCost += (sp.qtyPerBatch / sp.batchYieldQty) * iq * (stdPriceMap.get(sp.ingredientSkuId) || 0);
                    }
                  } else {
                    saleCost += iq * (stdPriceMap.get(line.skuId) || 0);
                  }
                }
              }
            } else {
              const modQty = rule.qtyPerMatch * qty;
              const modSku = skuMap.get(rule.skuId);
              if (modSku && modSku.type === "SP") {
                const spLines = spBomBySpSku.get(rule.skuId) || [];
                for (const sp of spLines) {
                  saleCost += (sp.qtyPerBatch / sp.batchYieldQty) * modQty * (stdPriceMap.get(sp.ingredientSkuId) || 0);
                }
              } else {
                saleCost += modQty * (stdPriceMap.get(rule.skuId) || 0);
              }
            }
          }
        }

        existing.stdCost += saleCost;
        mMap.set(menu.menuCode, existing);
      }

      return Array.from(mMap.entries())
        .map(([code, data]) => {
          const menu = menuByCode.get(code);
          return {
            menuCode: code,
            menuName: menu?.menuName || "",
            qtySold: data.qtySold,
            revenue: data.revenue,
            stdFoodCost: data.stdCost,
            stdFcPct: data.revenue > 0 ? (data.stdCost / data.revenue) * 100 : 0,
            costPerServing: data.qtySold > 0 ? data.stdCost / data.qtySold : 0,
            isMaindish: menu?.isMaindish ?? false,
          };
        })
        .sort((a, b) => b.stdFcPct - a.stdFcPct);
    },
    [menuByCode, bomByMenuId, spBomBySpSku, skuMap, stdPriceMap, activeRules],
  );

  const skuConverterMap = useMemo(() => {
    const m = new Map<string, number>();
    skus.forEach((s) => m.set(s.id, s.converter));
    return m;
  }, [skus]);

  const fetchActualVarianceData = useCallback(
    async (fromStr: string, toStr: string, branchId: string, skuRows: SkuBreakdown[]) => {
      // Determine opening/closing dates
      const fromDate = new Date(fromStr + "T00:00:00");
      const prevMonth = subMonths(fromDate, 1);
      const openingDate = format(lastDayOfMonth(prevMonth), "yyyy-MM-dd");
      const closingDate = toStr;

      // Fetch opening, closing, and receipts in parallel
      const [openingRes, closingRes, receiptsRes] = await Promise.all([
        supabase
          .from("daily_stock_counts")
          .select("sku_id, physical_count, calculated_balance")
          .eq("branch_id", branchId)
          .eq("count_date", openingDate),
        supabase
          .from("daily_stock_counts")
          .select("sku_id, physical_count, calculated_balance")
          .eq("branch_id", branchId)
          .eq("count_date", closingDate),
        supabase
          .from("branch_receipts")
          .select("sku_id, qty_received, actual_unit_price, actual_total, uom")
          .eq("branch_id", branchId)
          .gte("receipt_date", fromStr)
          .lte("receipt_date", toStr),
      ]);

      // Build opening map
      const openingBySku = new Map<string, number>();
      for (const row of openingRes.data || []) {
        const val = row.physical_count !== null ? row.physical_count : row.calculated_balance;
        openingBySku.set(row.sku_id, val);
      }

      // Build closing map
      const closingBySku = new Map<string, { actual: number | null; calc: number | null }>();
      for (const row of closingRes.data || []) {
        closingBySku.set(row.sku_id, {
          actual: row.physical_count !== null ? row.physical_count : null,
          calc: row.calculated_balance,
        });
      }

      // Build purchase maps
      const purchaseQtyBySku = new Map<string, number>();
      const purchaseValueBySku = new Map<string, number>();
      for (const row of receiptsRes.data || []) {
        const converter = skuConverterMap.get(row.sku_id) || 1;
        const qtyInUsage = row.qty_received * converter;
        purchaseQtyBySku.set(row.sku_id, (purchaseQtyBySku.get(row.sku_id) || 0) + qtyInUsage);
        const value = row.actual_unit_price * qtyInUsage;
        purchaseValueBySku.set(row.sku_id, (purchaseValueBySku.get(row.sku_id) || 0) + value);
      }

      // For SKUs without current-month purchases, look back up to 6 months
      const skuIdsNeedingFallback = skuRows
        .filter((r) => !purchaseValueBySku.has(r.skuId))
        .map((r) => r.skuId);

      const fallbackPriceMap = new Map<string, number>();
      if (skuIdsNeedingFallback.length > 0) {
        const sixMonthsAgo = format(subMonths(fromDate, 6), "yyyy-MM-dd");
        const { data: fallbackReceipts } = await supabase
          .from("branch_receipts")
          .select("sku_id, qty_received, actual_unit_price")
          .eq("branch_id", branchId)
          .gte("receipt_date", sixMonthsAgo)
          .lt("receipt_date", fromStr)
          .in("sku_id", skuIdsNeedingFallback)
          .order("receipt_date", { ascending: false });

        const fbQty = new Map<string, number>();
        const fbVal = new Map<string, number>();
        for (const row of fallbackReceipts || []) {
          const converter = skuConverterMap.get(row.sku_id) || 1;
          const qtyInUsage = row.qty_received * converter;
          fbQty.set(row.sku_id, (fbQty.get(row.sku_id) || 0) + qtyInUsage);
          fbVal.set(row.sku_id, (fbVal.get(row.sku_id) || 0) + row.actual_unit_price * qtyInUsage);
        }
        for (const [skuId, totalQty] of fbQty.entries()) {
          if (totalQty > 0) {
            fallbackPriceMap.set(skuId, (fbVal.get(skuId) || 0) / totalQty);
          }
        }
      }

      // Build variance rows
      const varianceRows: SkuVarianceRow[] = [];
      let sumActCost = 0;
      let sumTotalVar = 0;
      let sumPriceVar = 0;
      let skusWithActual = 0;

      for (const sr of skuRows) {
        const opening = openingBySku.get(sr.skuId);
        const closing = closingBySku.get(sr.skuId);
        const purchases = purchaseQtyBySku.get(sr.skuId) || 0;

        const hasStockData = opening !== undefined || closing !== undefined;

        let actQty: number | null = null;
        if (hasStockData) {
          const openVal = opening ?? 0;
          const closeVal = closing
            ? closing.actual !== null
              ? closing.actual
              : closing.calc ?? 0
            : 0;
          actQty = openVal + purchases - closeVal;
        }

        // Determine actual price
        let actPrice: number | null = null;
        const pQty = purchaseQtyBySku.get(sr.skuId);
        const pVal = purchaseValueBySku.get(sr.skuId);
        if (pQty && pQty > 0 && pVal !== undefined) {
          actPrice = pVal / pQty;
        } else if (fallbackPriceMap.has(sr.skuId)) {
          actPrice = fallbackPriceMap.get(sr.skuId)!;
        } else {
          actPrice = sr.stdUnitPrice;
        }

        const actCost = actQty !== null && actPrice !== null ? actQty * actPrice : null;
        const stdPrice = sr.stdUnitPrice;
        const qtyVar = actQty !== null ? actQty - sr.expectedUsage : null;
        const priceVarThb =
          actQty !== null && actPrice !== null ? (actPrice - stdPrice) * actQty : null;
        const totalVarThb = actCost !== null ? actCost - sr.stdCost : null;

        if (totalVarThb !== null) {
          sumActCost += actCost!;
          sumTotalVar += totalVarThb;
          sumPriceVar += priceVarThb ?? 0;
          skusWithActual++;
        }

        varianceRows.push({
          skuId: sr.skuId,
          skuCode: sr.skuCode,
          skuName: sr.skuName,
          type: sr.type,
          uom: sr.uom,
          stdQty: sr.expectedUsage,
          stdCost: sr.stdCost,
          actQty,
          actPrice,
          actCost,
          qtyVar,
          priceVarThb,
          totalVarThb,
          movementDetail: hasStockData
            ? {
                opening: opening ?? null,
                received: purchases,
                closingActual: closing?.actual ?? null,
                closingCalc: closing?.calc ?? null,
              }
            : null,
        });
      }

      setActualVarianceData(varianceRows);
      setVarianceSummary({
        actualCost: sumActCost,
        totalVariance: sumTotalVar,
        priceVariance: sumPriceVar,
        usageVariance: sumTotalVar - sumPriceVar,
      });
      setVarianceDataCoverage({
        skusWithActual,
        totalSkus: skuRows.length,
        openingDate,
        closingDate,
      });
    },
    [skuConverterMap, stdPriceMap],
  );

  const handleCalculate = useCallback(async () => {
    setLoading(true);
    // Reset variance data
    setActualVarianceData(null);
    setVarianceSummary(null);
    setVarianceDataCoverage(null);

    const fromStr = format(dateFrom, "yyyy-MM-dd");
    const toStr = format(dateTo, "yyyy-MM-dd");

    let q = supabase
      .from("sales_entries")
      .select("*")
      .gte("sale_date", fromStr)
      .lte("sale_date", toStr)
      .order("sale_date", { ascending: true })
      .order("id", { ascending: true });
    if (selectedBranch !== "all") q = q.eq("branch_id", selectedBranch);

    let sales: any[] = [];
    let from = 0;
    const PAGE = 1000;
    while (true) {
      const { data, error } = await q.range(from, from + PAGE - 1);
      if (error) {
        toast.error("Failed to load sales data");
        setLoading(false);
        return;
      }
      sales = sales.concat(data || []);
      if (!data || data.length < PAGE) break;
      from += PAGE;
    }

    const rev = sales.reduce((sum, s) => sum + (Number(s.net_amount) || 0), 0);
    const usage = calcUsage(sales);
    const skuRows: SkuBreakdown[] = Object.entries(usage)
      .map(([skuId, expectedUsage]) => {
        const sku = skuMap.get(skuId);
        const stdPrice = stdPriceMap.get(skuId) || 0;
        return {
          skuId,
          skuCode: sku?.skuId || "",
          skuName: sku?.name || "",
          type: sku?.type || "",
          expectedUsage,
          uom: sku?.usageUom || "",
          stdUnitPrice: stdPrice,
          stdCost: expectedUsage * stdPrice,
        };
      })
      .filter((r) => r.stdCost > 0 || r.expectedUsage > 0)
      .sort((a, b) => b.stdCost - a.stdCost);

    const totalCost = skuRows.reduce((sum, r) => sum + r.stdCost, 0);

    const days = eachDayOfInterval({ start: dateFrom, end: dateTo });
    const dailyRows: DailyData[] = days.map((day) => {
      const dayStr = format(day, "yyyy-MM-dd");
      const daySales = sales.filter((s) => s.sale_date === dayStr);
      const dayRev = daySales.reduce((sum, s) => sum + (Number(s.net_amount) || 0), 0);
      const dayUsage = calcUsage(daySales);
      const dayStdCost = Object.entries(dayUsage).reduce(
        (sum, [skuId, qty]) => sum + qty * (stdPriceMap.get(skuId) || 0),
        0,
      );
      const dayReceiptSet = new Set<string>();
      for (const s of daySales) {
        if (s.receipt_no) dayReceiptSet.add(String(s.receipt_no));
      }
      const dayReceiptCount = dayReceiptSet.size;
      return {
        date: dayStr,
        label: format(day, "dd/MM"),
        revenue: dayRev,
        stdFoodCost: dayStdCost,
        stdFcPct: dayRev > 0 ? (dayStdCost / dayRev) * 100 : 0,
        avgTicketSize: dayReceiptCount > 0 ? dayRev / dayReceiptCount : 0,
      };
    });

    const menuRows = calcMenuCosts(sales);

    const receiptSet = new Set<string>();
    for (const s of sales) {
      if (s.receipt_no) receiptSet.add(String(s.receipt_no));
    }

    setTotalRevenue(rev);
    setTotalStdCost(totalCost);
    setTotalReceiptCount(receiptSet.size);
    setDailyData(dailyRows);
    setSkuBreakdown(skuRows);
    setMenuBreakdown(menuRows);
    setCalculated(true);

    // Fetch actual variance data for monthly periods with single branch
    const canFetchVariance = isMonthlyPeriod && isPastMonth && selectedBranch !== "all";
    if (canFetchVariance) {
      await fetchActualVarianceData(fromStr, toStr, selectedBranch, skuRows);
    }

    setLoading(false);
  }, [dateFrom, dateTo, selectedBranch, calcUsage, calcMenuCosts, skuMap, stdPriceMap, isMonthlyPeriod, isPastMonth, fetchActualVarianceData]);

  // Auto-calculate when preset buttons change
  useEffect(() => {
    if (autoCalcTrigger > 0) {
      handleCalculate();
    }
  }, [autoCalcTrigger]); // eslint-disable-line react-hooks/exhaustive-deps

  const stdFcPct = totalRevenue > 0 ? (totalStdCost / totalRevenue) * 100 : 0;
  const fmt = (n: number) => n.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  // ----- Sortable tables -----
  const skuStdComparators = useMemo(() => ({
    skuCode: (a: SkuBreakdown, b: SkuBreakdown) => a.skuCode.localeCompare(b.skuCode),
    skuName: (a: SkuBreakdown, b: SkuBreakdown) => a.skuName.localeCompare(b.skuName),
    type: (a: SkuBreakdown, b: SkuBreakdown) => a.type.localeCompare(b.type),
    expectedUsage: (a: SkuBreakdown, b: SkuBreakdown) => a.expectedUsage - b.expectedUsage,
    stdUnitPrice: (a: SkuBreakdown, b: SkuBreakdown) => a.stdUnitPrice - b.stdUnitPrice,
    stdCost: (a: SkuBreakdown, b: SkuBreakdown) => a.stdCost - b.stdCost,
  }), []);
  const {
    sorted: sortedSkuStd,
    sortKey: skuStdSortKey,
    sortDir: skuStdSortDir,
    handleSort: handleSkuStdSort,
  } = useSortableTable(skuBreakdown, skuStdComparators, "stdCost", "desc");

  const menuComparators = useMemo(() => ({
    menuCode: (a: MenuBreakdown, b: MenuBreakdown) => a.menuCode.localeCompare(b.menuCode),
    menuName: (a: MenuBreakdown, b: MenuBreakdown) => a.menuName.localeCompare(b.menuName),
    category: (a: MenuBreakdown, b: MenuBreakdown) => (menuByCode.get(a.menuCode)?.category || "").localeCompare(menuByCode.get(b.menuCode)?.category || ""),
    qtySold: (a: MenuBreakdown, b: MenuBreakdown) => a.qtySold - b.qtySold,
    revenue: (a: MenuBreakdown, b: MenuBreakdown) => a.revenue - b.revenue,
    stdFoodCost: (a: MenuBreakdown, b: MenuBreakdown) => a.stdFoodCost - b.stdFoodCost,
    stdFcPct: (a: MenuBreakdown, b: MenuBreakdown) => a.stdFcPct - b.stdFcPct,
    costPerServing: (a: MenuBreakdown, b: MenuBreakdown) => a.costPerServing - b.costPerServing,
  }), [menuByCode]);
  const {
    sorted: sortedMenuFull,
    sortKey: menuSortKey,
    sortDir: menuSortDir,
    handleSort: handleMenuSort,
  } = useSortableTable(menuBreakdown, menuComparators, "revenue", "desc");

  const {
    sorted: sortedMenuTop,
    sortKey: menuTopSortKey,
    sortDir: menuTopSortDir,
    handleSort: handleMenuTopSort,
  } = useSortableTable(menuBreakdown, menuComparators, "revenue", "desc");

  // Top 10 highest FC% menus (sorted view)
  const top10Menus = sortedMenuTop.slice(0, 10);

  // ----- Ratio Analysis computations -----
  const distinctMenuCategories = useMemo(() => {
    const set = new Set<string>();
    menus.forEach(m => { if (m.category) set.add(m.category); });
    return Array.from(set).sort();
  }, [menus]);

  const maindishQty = useMemo(
    () => menuBreakdown.filter(m => m.isMaindish).reduce((s, m) => s + m.qtySold, 0),
    [menuBreakdown],
  );
  const qtyByCategory = useMemo(() => {
    const m = new Map<string, number>();
    for (const row of menuBreakdown) {
      const cat = menuByCode.get(row.menuCode)?.category || "";
      if (!cat) continue;
      m.set(cat, (m.get(cat) || 0) + row.qtySold);
    }
    return m;
  }, [menuBreakdown, menuByCode]);
  const avgTicketSize = totalReceiptCount > 0 ? totalRevenue / totalReceiptCount : 0;

  const getMetricLabelValue = (key: string): { label: string; value: string } => {
    if (key === "avg_ticket") {
      return {
        label: "Avg. Ticket Size",
        value: totalReceiptCount > 0 ? `฿${avgTicketSize.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—",
      };
    }
    if (key.startsWith("ratio:")) {
      const cat = key.slice("ratio:".length);
      const catQty = qtyByCategory.get(cat) || 0;
      const value = maindishQty > 0 ? (catQty / maindishQty) * 100 : null;
      return {
        label: `% ${cat} / Maindish`,
        value: value === null ? "—" : `${value.toFixed(1)}%`,
      };
    }
    return { label: key, value: "—" };
  };

  const availableMetricsToAdd = useMemo(() => {
    const opts: { key: string; label: string }[] = [];
    if (!ratioMetrics.includes("avg_ticket")) {
      opts.push({ key: "avg_ticket", label: "Avg. Ticket Size" });
    }
    distinctMenuCategories.forEach(cat => {
      const key = `ratio:${cat}`;
      if (!ratioMetrics.includes(key)) opts.push({ key, label: `% ${cat} / Maindish` });
    });
    return opts;
  }, [ratioMetrics, distinctMenuCategories]);

  // Sort state for SKU variance table (default: |totalVarThb| DESC handled by null sortKey via custom sort)
  const [varSortKey, setVarSortKey] = useState<string | null>(null);
  const [varSortDir, setVarSortDir] = useState<"asc" | "desc" | null>(null);
  const handleVarSort = useCallback((key: string) => {
    setVarSortKey(prev => {
      if (prev !== key) {
        setVarSortDir("asc");
        return key;
      }
      setVarSortDir(d => (d === "asc" ? "desc" : null));
      return varSortDir === "desc" ? null : key;
    });
  }, [varSortDir]);

  // Export CSV
  const handleExportCSV = () => {
    const lines: string[] = [];
    lines.push("Type,Code,Name,Expected Usage,UOM,Std Unit Price,Std Cost");
    skuBreakdown.forEach((r) => {
      lines.push(
        `SKU,${r.skuCode},"${r.skuName}",${Math.round(r.expectedUsage).toLocaleString("en-US")},${r.uom},${r.stdUnitPrice.toFixed(4)},${r.stdCost.toFixed(2)}`,
      );
    });
    lines.push("");
    lines.push("Type,Menu Code,Menu Name,Qty Sold,Revenue,Std Food Cost,FC%,Cost/Serving");
    menuBreakdown.forEach((r) => {
      lines.push(
        `Menu,${r.menuCode},"${r.menuName}",${r.qtySold},${r.revenue.toFixed(2)},${r.stdFoodCost.toFixed(2)},${r.stdFcPct.toFixed(1)}%,${r.costPerServing.toFixed(2)}`,
      );
    });

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `food-cost-${format(dateFrom, "yyyy-MM-dd")}-to-${format(dateTo, "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("CSV exported");
  };

  // FC% color helper
  const getFcPctClass = (pct: number) => {
    if (pct <= FC_GREEN_MAX) return "text-success";
    if (pct <= FC_AMBER_MAX) return "text-warning";
    return "text-destructive";
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">{t("title.foodCost")}</h2>
        <p className="text-sm text-muted-foreground mt-0.5">Analyze standard food cost against revenue</p>
      </div>

      {/* Top Controls */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-3 items-end">
            {/* Preset buttons — auto-calculate on click */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">{t("title.quickPeriod")}</label>
              <div className="flex gap-1">
                {(["today", "this-week", "this-month"] as DatePreset[]).map((p) => (
                  <Button
                    key={p}
                    size="sm"
                    variant={preset === p ? "default" : "outline"}
                    onClick={() => handlePresetChange(p)}
                    className="text-xs h-8"
                  >
                    {p === "today" ? t("btn.today") : p === "this-week" ? t("btn.thisWeek") : t("btn.thisMonth")}
                  </Button>
                ))}
              </div>
            </div>

            <DateRangePicker
              from={dateFrom}
              to={dateTo}
              onChange={(r) => {
                if (r.from) {
                  setDateFrom(r.from);
                  setPreset("custom");
                }
                if (r.to) {
                  setDateTo(r.to);
                  setPreset("custom");
                }
              }}
              placeholder="From – To"
              align="start"
            />

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Branch</label>
              <Select value={selectedBranch} onValueChange={setSelectedBranch} disabled={isStoreManager}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {isManagement && <SelectItem value="all">All Branches</SelectItem>}
                  {activeBranches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.branchName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button onClick={handleCalculate} disabled={loading}>
              <Calculator className="w-4 h-4 mr-1" />
              {loading ? `${t("btn.calculate")}...` : t("btn.calculate")}
            </Button>

            {calculated && (
              <Button variant="outline" onClick={handleExportCSV}>
                <Download className="w-4 h-4 mr-1" /> {t("btn.exportCsv")}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {calculated && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <Card>
              <CardContent className="p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t("title.totalRevenue")}
                </p>
                <p className="text-2xl font-bold font-mono mt-1">฿{fmt(totalRevenue)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t("title.stdFoodCost")}
                </p>
                <p className="text-2xl font-bold font-mono mt-1">฿{fmt(totalStdCost)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t("title.stdFcPct")}
                </p>
                <p className={`text-2xl font-bold font-mono mt-1 ${getFcPctClass(stdFcPct)}`}>{stdFcPct.toFixed(1)}%</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t("title.fcStatus")}
                </p>
                <Badge
                  variant={stdFcPct <= FC_AMBER_MAX ? "default" : "destructive"}
                  className={cn(
                    "text-sm px-3 py-1 mt-1",
                    stdFcPct <= FC_AMBER_MAX ? "bg-success/15 text-success border-success/30" : "",
                  )}
                >
                  {stdFcPct <= FC_AMBER_MAX ? (
                    <TrendingDown className="w-4 h-4 mr-1" />
                  ) : (
                    <TrendingUp className="w-4 h-4 mr-1" />
                  )}
                  {stdFcPct.toFixed(1)}%
                </Badge>
              </CardContent>
            </Card>
          </div>

          {/* Ratio Analysis */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Ratio Analysis</h3>
              <Popover open={addMetricOpen} onOpenChange={setAddMetricOpen}>
                <PopoverTrigger asChild>
                  <Button size="sm" variant="outline" className="h-8 text-xs" disabled={availableMetricsToAdd.length === 0}>
                    <Plus className="w-3.5 h-3.5 mr-1" /> Add Metric
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-64 p-1 max-h-[320px] overflow-y-auto">
                  {availableMetricsToAdd.length === 0 ? (
                    <p className="text-xs text-muted-foreground p-2">All metrics added</p>
                  ) : (
                    availableMetricsToAdd.map(opt => (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => {
                          setRatioMetrics(prev => [...prev, opt.key]);
                          setAddMetricOpen(false);
                        }}
                        className="w-full text-left text-sm px-2 py-1.5 rounded hover:bg-accent"
                      >
                        {opt.label}
                      </button>
                    ))
                  )}
                </PopoverContent>
              </Popover>
            </div>
            {ratioMetrics.length === 0 ? (
              <p className="text-xs text-muted-foreground py-3">No metrics selected. Click "+ Add Metric" to add.</p>
            ) : (
              <div className="flex flex-wrap gap-3">
                {ratioMetrics.map(key => {
                  const { label, value } = getMetricLabelValue(key);
                  return (
                    <Card key={key} className="relative min-w-[180px] flex-1 max-w-[280px]">
                      <button
                        type="button"
                        onClick={() => setRatioMetrics(prev => prev.filter(k => k !== key))}
                        className="absolute top-2 right-2 text-muted-foreground hover:text-foreground rounded p-0.5"
                        aria-label="Remove metric"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                      <CardContent className="p-4 pr-7">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground truncate" title={label}>{label}</p>
                        <p className="text-2xl font-bold font-mono mt-1">{value}</p>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>

          {/* Variance Summary Cards — canShowVariance gate */}
          {canShowVariance && varianceSummary !== null && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("fc.actualCost")}</p>
                    <p className="text-2xl font-bold font-mono mt-1">฿{fmt(varianceSummary.actualCost)}</p>
                  </CardContent>
                </Card>
                {([
                  { label: t("fc.totalVariance"), value: varianceSummary.totalVariance },
                  { label: t("fc.priceVariance"), value: varianceSummary.priceVariance },
                  { label: t("fc.usageVariance"), value: varianceSummary.usageVariance },
                ] as const).map((card) => (
                  <Card key={card.label}>
                    <CardContent className="p-4">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{card.label}</p>
                      <p className={cn("text-2xl font-bold font-mono mt-1 flex items-center gap-1",
                        card.value > 0 ? "text-destructive" : card.value < 0 ? "text-success" : "text-muted-foreground"
                      )}>
                        {card.value > 0 ? "+" : ""}{fmt(card.value)} ฿
                        {card.value > 0 && <TrendingUp className="w-4 h-4" />}
                        {card.value < 0 && <TrendingDown className="w-4 h-4" />}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          )}

          {/* Banner states — exactly one renders based on priority */}
          {calculated && (() => {
            // Priority 1: has variance data with coverage
            if (canShowVariance && varianceDataCoverage !== null) {
              return (
                <p className="text-xs text-muted-foreground">
                  {t("fc.dataCoverage")}: {varianceDataCoverage.skusWithActual}/{varianceDataCoverage.totalSkus} SKUs · Opening: {varianceDataCoverage.openingDate} · Closing: {varianceDataCoverage.closingDate}
                </p>
              );
            }
            // Priority 2: past month but all-branch selected
            if (isMonthlyPeriod && isPastMonth && selectedBranch === "all") {
              return (
                <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/40 rounded-lg px-4 py-3">
                  <Info className="w-4 h-4 shrink-0 text-primary/60" />
                  <span>เลือก branch เดียวเพื่อดู Actual vs Standard variance</span>
                </div>
              );
            }
            // Priority 3: current month single branch
            if (isMonthlyPeriod && !isPastMonth && selectedBranch !== "all") {
              return (
                <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/40 rounded-lg px-4 py-3">
                  <Info className="w-4 h-4 shrink-0 text-primary/60" />
                  <span>Actual variance จะแสดงได้เมื่อสิ้นเดือน ({format(dateTo, "d MMM yyyy")}) และมี stock count ปิดเดือนแล้ว</span>
                </div>
              );
            }
            return null;
          })()}
          {/* Daily Trend Chart */}
          {dailyData.length > 1 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg font-semibold">{t("title.dailyTrend")}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={dailyData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="label" className="text-xs" />
                      <YAxis yAxisId="left" className="text-xs" />
                      <YAxis
                        yAxisId="right"
                        orientation="right"
                        className="text-xs"
                        tickFormatter={(v: number) => `฿${Math.round(v)}`}
                        label={{ value: "฿/bill", angle: -90, position: "insideRight", fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      />
                      <Tooltip
                        formatter={(value: number, name: string) => {
                          return [`฿${value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, name];
                        }}
                      />
                      <Legend />
                      <Bar yAxisId="left" dataKey="revenue" name="Revenue" fill="#378ADD" />
                      <Bar yAxisId="left" dataKey="stdFoodCost" name="Food Cost" fill="#D85A30" />
                      <Line
                        yAxisId="right"
                        type="monotone"
                        dataKey="avgTicketSize"
                        name="Avg Ticket Size"
                        stroke="#BA7517"
                        strokeWidth={3}
                        dot={{ r: 4, fill: "#BA7517" }}
                        label={{
                          position: "top",
                          fontSize: 10,
                          fill: "#BA7517",
                          formatter: (v: number) => `฿${Math.round(v)}`,
                        }}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Top 10 Highest FC% Menus */}
          {top10Menus.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg font-semibold">
                  <TrendingUp className="w-4 h-4 text-destructive" />
                  Top 10 Highest Food Cost Menus
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0 overflow-hidden">
                <div className="overflow-y-auto max-h-[400px]">
                  <Table>
                    <TableHeader className="sticky top-0 z-10 bg-background">
                      <TableRow className="bg-table-header border-b">
                        <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          #
                        </TableHead>
                        <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          {t("col.menuCode")}
                        </TableHead>
                        <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          {t("col.menuName")}
                        </TableHead>
                        <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground" style={{ width: 110 }}>
                          Category
                        </TableHead>
                        <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground text-right">
                          <SortableHeader label={t("col.qtySold")} sortKey="qtySold" activeSortKey={menuTopSortKey} sortDir={menuTopSortDir} onSort={handleMenuTopSort} className="justify-end" />
                        </TableHead>
                        <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground text-right">
                          <SortableHeader label={t("col.revenue")} sortKey="revenue" activeSortKey={menuTopSortKey} sortDir={menuTopSortDir} onSort={handleMenuTopSort} className="justify-end" />
                        </TableHead>
                        <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground text-right">
                          <SortableHeader label={t("col.stdCost")} sortKey="stdFoodCost" activeSortKey={menuTopSortKey} sortDir={menuTopSortDir} onSort={handleMenuTopSort} className="justify-end" />
                        </TableHead>
                        <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground text-right">
                          <SortableHeader label={t("col.fcPct")} sortKey="stdFcPct" activeSortKey={menuTopSortKey} sortDir={menuTopSortDir} onSort={handleMenuTopSort} className="justify-end" />
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {top10Menus.map((m, i) => (
                        <TableRow
                          key={m.menuCode}
                          className={`border-b border-table-border hover:bg-table-hover transition-colors ${m.stdFcPct > FC_AMBER_MAX ? "bg-destructive/5" : ""}`}
                        >
                          <TableCell className="px-3 py-2 text-sm font-mono text-muted-foreground">{i + 1}</TableCell>
                          <TableCell className="px-3 py-2 font-mono text-xs">{m.menuCode}</TableCell>
                          <TableCell className="px-3 py-2 text-sm">{m.menuName}</TableCell>
                          <TableCell className="px-3 py-2 text-sm text-muted-foreground">{menuByCode.get(m.menuCode)?.category || "—"}</TableCell>
                          <TableCell className="px-3 py-2 text-sm font-mono text-right">{m.qtySold}</TableCell>
                          <TableCell className="px-3 py-2 text-sm font-mono text-right">฿{fmt(m.revenue)}</TableCell>
                          <TableCell className="px-3 py-2 text-sm font-mono text-right">
                            ฿{fmt(m.stdFoodCost)}
                          </TableCell>
                          <TableCell className="px-3 py-2 text-right">
                            <span
                              className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${
                                m.stdFcPct > FC_AMBER_MAX
                                  ? "bg-[#FCEBEB] text-[#791F1F]"
                                  : m.stdFcPct > FC_GREEN_MAX
                                    ? "bg-[#FAEEDA] text-[#633806]"
                                    : "bg-[#EAF3DE] text-[#27500A]"
                              }`}
                            >
                              {m.stdFcPct.toFixed(1)}%
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* SKU Breakdown */}
          {(() => {
            const showVariance = canShowVariance && actualVarianceData !== null;

            // Build merged rows for variance mode
            const varianceMap = new Map<string, SkuVarianceRow>();
            if (showVariance && actualVarianceData) {
              actualVarianceData.forEach(v => varianceMap.set(v.skuId, v));
            }

            const mergedRows = showVariance
              ? skuBreakdown.map(r => ({ std: r, var: varianceMap.get(r.skuId) ?? null }))
              : null;

            if (mergedRows) {
              const cmpVal = (key: string, row: { std: SkuBreakdown; var: SkuVarianceRow | null }): number => {
                if (key === "skuCode") return 0; // handled below as string
                if (key === "stdCost") return row.std.stdCost;
                if (key === "actCost") return row.var?.actCost ?? -Infinity;
                if (key === "totalVarThb") return row.var?.totalVarThb ?? -Infinity;
                return 0;
              };
              if (varSortKey && varSortDir) {
                mergedRows.sort((a, b) => {
                  if (varSortKey === "skuCode") {
                    const r = a.std.skuCode.localeCompare(b.std.skuCode);
                    return varSortDir === "desc" ? -r : r;
                  }
                  const r = cmpVal(varSortKey, a) - cmpVal(varSortKey, b);
                  return varSortDir === "desc" ? -r : r;
                });
              } else {
                // Default sort: |totalVarThb| DESC
                mergedRows.sort((a, b) => {
                  const absA = a.var?.totalVarThb != null ? Math.abs(a.var.totalVarThb) : -1;
                  const absB = b.var?.totalVarThb != null ? Math.abs(b.var.totalVarThb) : -1;
                  return absB - absA;
                });
              }
            }

            const varColorClass = (v: number | null) =>
              v === null ? "text-muted-foreground" : v > 0 ? "text-destructive font-semibold" : v < 0 ? "text-success font-semibold" : "text-muted-foreground";

            const fmtVar = (v: number | null) => v === null ? "—" : `${v > 0 ? "+" : ""}${fmt(v)}`;

            const thCls = "text-xs font-medium uppercase tracking-wide text-muted-foreground";

            return (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg font-semibold">SKU Ingredient Breakdown</CardTitle>
                </CardHeader>
                <CardContent className="p-0 overflow-hidden">
                  <div className="overflow-y-auto max-h-[400px]">
                    {showVariance && mergedRows ? (
                      <table className="w-full text-sm table-fixed">
                        <colgroup>
                          <col style={{ width: 80 }} />
                          <col style={{ width: 180 }} />
                          <col style={{ width: 60 }} />
                          <col style={{ width: 90 }} />
                          <col style={{ width: 90 }} />
                          <col style={{ width: 90 }} />
                          <col style={{ width: 90 }} />
                          <col style={{ width: 100 }} />
                          <col style={{ width: 80 }} />
                          <col style={{ width: 80 }} />
                        </colgroup>
                        <thead className="sticky top-0 z-[5] bg-background">
                          <tr className="bg-table-header border-b">
                            <th className={`px-3 py-2 text-left ${thCls}`}>
                              <SortableHeader label={t("col.skuCode")} sortKey="skuCode" activeSortKey={varSortKey} sortDir={varSortDir} onSort={handleVarSort} />
                            </th>
                            <th className={`px-3 py-2 text-left ${thCls}`}>{t("col.skuName")}</th>
                            <th className={`px-3 py-2 text-left ${thCls}`}>{t("col.type")}</th>
                            <th className={`px-3 py-2 text-right ${thCls}`}>Std Qty</th>
                            <th className={`px-3 py-2 text-right ${thCls}`}>
                              <SortableHeader label={t("col.stdCost")} sortKey="stdCost" activeSortKey={varSortKey} sortDir={varSortDir} onSort={handleVarSort} className="justify-end" />
                            </th>
                            <th className={`px-3 py-2 text-right ${thCls}`}>{t("fc.actQty")}</th>
                            <th className={`px-3 py-2 text-right ${thCls}`}>
                              <SortableHeader label={t("fc.actCost")} sortKey="actCost" activeSortKey={varSortKey} sortDir={varSortDir} onSort={handleVarSort} className="justify-end" />
                            </th>
                            <th className={`px-3 py-2 text-right ${thCls}`}>{t("fc.qtyVar")}</th>
                            <th className={`px-3 py-2 text-right ${thCls}`}>{t("fc.priceVarThb")}</th>
                            <th className={`px-3 py-2 text-right ${thCls}`}>
                              <SortableHeader label={t("fc.totalVarThb")} sortKey="totalVarThb" activeSortKey={varSortKey} sortDir={varSortDir} onSort={handleVarSort} className="justify-end" />
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {mergedRows.map(({ std: r, var: v }) => (
                            <tr key={r.skuId} className="border-b border-table-border hover:bg-table-hover transition-colors">
                              <td className="px-3 py-2 font-mono text-xs">{r.skuCode}</td>
                              <td className="px-3 py-2 text-sm truncate">{r.skuName}</td>
                              <td className="px-3 py-2">
                                <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${getCatBadgeClass(r.type)}`}>{r.type}</span>
                              </td>
                              <td className="px-3 py-2 font-mono text-right">{Math.round(r.expectedUsage).toLocaleString("en-US")}</td>
                              <td className="px-3 py-2 font-mono text-right">฿{fmt(r.stdCost)}</td>
                              <td className="px-3 py-2 font-mono text-right">
                                {v && v.actQty !== null ? (
                                  <TooltipProvider delayDuration={200}>
                                    <ShadTooltip>
                                      <TooltipTrigger asChild>
                                        <span className="underline decoration-dotted cursor-help">
                                          {Math.round(v.actQty).toLocaleString("en-US")}
                                        </span>
                                      </TooltipTrigger>
                                      <ShadTooltipContent side="right" className="p-3 text-xs">
                                        {v.movementDetail ? (
                                          <div className="space-y-0.5 min-w-[160px]">
                                            <div className="flex justify-between gap-4">
                                              <span>{t("fc.opening")} ({varianceDataCoverage?.openingDate})</span>
                                              <span className="font-mono">{v.movementDetail.opening !== null ? `${Math.round(v.movementDetail.opening).toLocaleString("en-US")} ${r.uom}` : "—"}</span>
                                            </div>
                                            <div className="flex justify-between gap-4">
                                              <span>+ {t("fc.received")}</span>
                                              <span className="font-mono">{Math.round(v.movementDetail.received).toLocaleString("en-US")} {r.uom}</span>
                                            </div>
                                            <div className="flex justify-between gap-4">
                                              <span>− {t("fc.closing")} ({varianceDataCoverage?.closingDate})</span>
                                              <span className="font-mono">
                                                {v.movementDetail.closingActual !== null
                                                  ? `${Math.round(v.movementDetail.closingActual).toLocaleString("en-US")} ${r.uom}`
                                                  : v.movementDetail.closingCalc !== null
                                                    ? <>{Math.round(v.movementDetail.closingCalc).toLocaleString("en-US")} {r.uom} <span className="text-muted-foreground">(est.)</span></>
                                                    : "—"}
                                              </span>
                                            </div>
                                            <div className="border-t my-1" />
                                            <div className="flex justify-between gap-4 font-semibold">
                                              <span>= {t("fc.actUsed")}</span>
                                              <span className="font-mono">{Math.round(v.actQty!).toLocaleString("en-US")} {r.uom}</span>
                                            </div>
                                          </div>
                                        ) : (
                                          <span className="text-muted-foreground">ไม่มีข้อมูล stock</span>
                                        )}
                                      </ShadTooltipContent>
                                    </ShadTooltip>
                                  </TooltipProvider>
                                ) : (
                                  <span className="text-muted-foreground">—</span>
                                )}
                              </td>
                              <td className="px-3 py-2 font-mono text-right">{v?.actCost != null ? `฿${fmt(v.actCost)}` : <span className="text-muted-foreground">—</span>}</td>
                              <td className={cn("px-3 py-2 font-mono text-right", varColorClass(v?.qtyVar ?? null))}>{fmtVar(v?.qtyVar ?? null)}</td>
                              <td className={cn("px-3 py-2 font-mono text-right", varColorClass(v?.priceVarThb ?? null))}>{fmtVar(v?.priceVarThb ?? null)}</td>
                              <td className={cn("px-3 py-2 font-mono text-right", varColorClass(v?.totalVarThb ?? null))}>{fmtVar(v?.totalVarThb ?? null)}</td>
                            </tr>
                          ))}
                          {mergedRows.length === 0 && (
                            <tr><td colSpan={10} className="text-center py-6 text-muted-foreground">No data</td></tr>
                          )}
                        </tbody>
                      </table>
                    ) : (
                      <Table>
                        <TableHeader className="sticky top-0 z-10 bg-background">
                          <TableRow className="bg-table-header border-b">
                            <TableHead className={thCls}>{t("col.skuCode")}</TableHead>
                            <TableHead className={thCls}>{t("col.skuName")}</TableHead>
                            <TableHead className={thCls}>{t("col.type")}</TableHead>
                            <TableHead className={`${thCls} text-right`}>{t("col.expectedUsage")}</TableHead>
                            <TableHead className={thCls}>{t("col.uom")}</TableHead>
                            <TableHead className={`${thCls} text-right`}>{t("col.stdUnitPrice")}</TableHead>
                            <TableHead className={`${thCls} text-right`}>{t("col.stdCost")}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {skuBreakdown.map((r) => (
                            <TableRow key={r.skuId} className="border-b border-table-border hover:bg-table-hover transition-colors">
                              <TableCell className="px-3 py-2 font-mono text-xs">{r.skuCode}</TableCell>
                              <TableCell className="px-3 py-2 text-sm">{r.skuName}</TableCell>
                              <TableCell className="px-3 py-2">
                                <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${getCatBadgeClass(r.type)}`}>{r.type}</span>
                              </TableCell>
                              <TableCell className="px-3 py-2 text-sm font-mono text-right">{Math.round(r.expectedUsage).toLocaleString("en-US")}</TableCell>
                              <TableCell className="px-3 py-2"><UnitLabel unit={r.uom} /></TableCell>
                              <TableCell className="px-3 py-2 text-sm font-mono text-right">฿{r.stdUnitPrice.toFixed(4)}</TableCell>
                              <TableCell className="px-3 py-2 text-sm font-mono text-right font-medium">฿{fmt(r.stdCost)}</TableCell>
                            </TableRow>
                          ))}
                          {skuBreakdown.length === 0 && (
                            <TableRow>
                              <TableCell colSpan={7} className="text-center py-6 text-muted-foreground">No data</TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })()}

          {/* Full Menu Breakdown */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-semibold">Menu Breakdown (all)</CardTitle>
            </CardHeader>
            <CardContent className="p-0 overflow-hidden">
              <div className="overflow-y-auto max-h-[400px]">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-background">
                    <TableRow className="bg-table-header border-b">
                      <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {t("col.menuCode")}
                      </TableHead>
                      <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {t("col.menuName")}
                      </TableHead>
                      <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground text-right">
                        {t("col.qtySold")}
                      </TableHead>
                      <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground text-right">
                        {t("col.revenue")}
                      </TableHead>
                      <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground text-right">
                        {t("col.stdCost")}
                      </TableHead>
                      <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground text-right">
                        {t("col.fcPct")}
                      </TableHead>
                      <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground text-right">
                        {t("col.costPerServing")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {menuBreakdown.map((m) => (
                      <TableRow
                        key={m.menuCode}
                        className="border-b border-table-border hover:bg-table-hover transition-colors"
                      >
                        <TableCell className="px-3 py-2 font-mono text-xs">{m.menuCode}</TableCell>
                        <TableCell className="px-3 py-2 text-sm">{m.menuName}</TableCell>
                        <TableCell className="px-3 py-2 text-sm font-mono text-right">{m.qtySold}</TableCell>
                        <TableCell className="px-3 py-2 text-sm font-mono text-right">฿{fmt(m.revenue)}</TableCell>
                        <TableCell className="px-3 py-2 text-sm font-mono text-right">฿{fmt(m.stdFoodCost)}</TableCell>
                        <TableCell className="px-3 py-2 text-right">
                          <span
                            className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${
                              m.stdFcPct > FC_AMBER_MAX
                                ? "bg-[#FCEBEB] text-[#791F1F]"
                                : m.stdFcPct > FC_GREEN_MAX
                                  ? "bg-[#FAEEDA] text-[#633806]"
                                  : "bg-[#EAF3DE] text-[#27500A]"
                            }`}
                          >
                            {m.stdFcPct.toFixed(1)}%
                          </span>
                        </TableCell>
                        <TableCell className="px-3 py-2 text-sm font-mono text-right">
                          ฿{m.costPerServing.toFixed(2)}
                        </TableCell>
                      </TableRow>
                    ))}
                    {menuBreakdown.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-6 text-muted-foreground">
                          No data
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
