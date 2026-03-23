import { useState, useMemo, useCallback, useEffect } from "react";
import { useLanguage } from "@/hooks/use-language";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, eachDayOfInterval } from "date-fns";
import { Calculator, TrendingDown, TrendingUp, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { UnitLabel } from "@/components/ui/unit-label";
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
    const m = new Map<string, MenuBomLine[]>();
    menuBomLines.forEach((l) => {
      const arr = m.get(l.menuId) || [];
      arr.push(l);
      m.set(l.menuId, arr);
    });
    return m;
  }, [menuBomLines]);

  const spBomBySpSku = useMemo(() => {
    const m = new Map<string, SpBomLine[]>();
    spBomLines.forEach((l) => {
      const arr = m.get(l.spSkuId) || [];
      arr.push(l);
      m.set(l.spSkuId, arr);
    });
    return m;
  }, [spBomLines]);

  const activeRules = useMemo(() => modifierRules.filter((r) => r.isActive), [modifierRules]);

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
          if (menuName.includes(rule.keyword)) {
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
          if (menuName.includes(rule.keyword)) {
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
          };
        })
        .sort((a, b) => b.stdFcPct - a.stdFcPct);
    },
    [menuByCode, bomByMenuId, spBomBySpSku, skuMap, stdPriceMap, activeRules],
  );

  const handleCalculate = useCallback(async () => {
    setLoading(true);
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
      return {
        date: dayStr,
        label: format(day, "dd/MM"),
        revenue: dayRev,
        stdFoodCost: dayStdCost,
        stdFcPct: dayRev > 0 ? (dayStdCost / dayRev) * 100 : 0,
      };
    });

    const menuRows = calcMenuCosts(sales);

    setTotalRevenue(rev);
    setTotalStdCost(totalCost);
    setDailyData(dailyRows);
    setSkuBreakdown(skuRows);
    setMenuBreakdown(menuRows);
    setCalculated(true);
    setLoading(false);
  }, [dateFrom, dateTo, selectedBranch, calcUsage, calcMenuCosts, skuMap, stdPriceMap]);

  // Auto-calculate when preset buttons change
  useEffect(() => {
    if (autoCalcTrigger > 0) {
      handleCalculate();
    }
  }, [autoCalcTrigger]); // eslint-disable-line react-hooks/exhaustive-deps

  const stdFcPct = totalRevenue > 0 ? (totalStdCost / totalRevenue) * 100 : 0;
  const fmt = (n: number) => n.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  // Top 10 highest FC% menus
  const top10Menus = menuBreakdown.slice(0, 10);

  // Export CSV
  const handleExportCSV = () => {
    const lines: string[] = [];
    lines.push("Type,Code,Name,Expected Usage,UOM,Std Unit Price,Std Cost");
    skuBreakdown.forEach((r) => {
      lines.push(
        `SKU,${r.skuCode},"${r.skuName}",${r.expectedUsage.toFixed(2)},${r.uom},${r.stdUnitPrice.toFixed(4)},${r.stdCost.toFixed(2)}`,
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

            <DatePicker
              value={dateFrom}
              onChange={(d) => {
                if (d) {
                  setDateFrom(d);
                  setPreset("custom");
                }
              }}
              placeholder="From date"
              label="From"
              labelPosition="left"
              align="start"
            />

            <DatePicker
              value={dateTo}
              onChange={(d) => {
                if (d) {
                  setDateTo(d);
                  setPreset("custom");
                }
              }}
              placeholder="To date"
              label="To"
              labelPosition="left"
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
                        domain={[0, 100]}
                        tickFormatter={(v: number) => `${v}%`}
                      />
                      <Tooltip
                        formatter={(value: number, name: string) => {
                          if (name === "FC%") return [`${value.toFixed(1)}%`, name];
                          return [`฿${value.toLocaleString("th-TH", { minimumFractionDigits: 2 })}`, name];
                        }}
                      />
                      <Legend />
                      <Bar yAxisId="left" dataKey="revenue" name="Revenue" fill="hsl(var(--primary))" opacity={0.3} />
                      <Bar
                        yAxisId="left"
                        dataKey="stdFoodCost"
                        name="Food Cost"
                        fill="hsl(var(--destructive))"
                        opacity={0.5}
                      />
                      <Line
                        yAxisId="right"
                        type="monotone"
                        dataKey="stdFcPct"
                        name="FC%"
                        stroke="hsl(var(--primary))"
                        strokeWidth={3}
                        dot={{ r: 4, fill: "hsl(var(--primary))" }}
                        label={{
                          position: "top",
                          fontSize: 10,
                          fill: "hsl(var(--primary))",
                          formatter: (v: number) => `${v.toFixed(1)}%`,
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
                          <TableCell className="px-3 py-2 text-sm font-mono text-right">{m.qtySold}</TableCell>
                          <TableCell className="px-3 py-2 text-sm font-mono text-right">฿{fmt(m.revenue)}</TableCell>
                          <TableCell className="px-3 py-2 text-sm font-mono text-right">
                            ฿{fmt(m.stdFoodCost)}
                          </TableCell>
                          <TableCell className="px-3 py-2 text-right">
                            <Badge
                              variant={
                                m.stdFcPct > FC_AMBER_MAX
                                  ? "destructive"
                                  : m.stdFcPct > FC_GREEN_MAX
                                    ? "secondary"
                                    : "default"
                              }
                              className="text-xs"
                            >
                              {m.stdFcPct.toFixed(1)}%
                            </Badge>
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
          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-semibold">SKU Ingredient Breakdown</CardTitle>
            </CardHeader>
            <CardContent className="p-0 overflow-hidden">
              <div className="overflow-y-auto max-h-[400px]">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-background">
                    <TableRow className="bg-table-header border-b">
                      <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {t("col.skuCode")}
                      </TableHead>
                      <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {t("col.skuName")}
                      </TableHead>
                      <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {t("col.type")}
                      </TableHead>
                      <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground text-right">
                        {t("col.expectedUsage")}
                      </TableHead>
                      <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {t("col.uom")}
                      </TableHead>
                      <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground text-right">
                        {t("col.stdUnitPrice")}
                      </TableHead>
                      <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground text-right">
                        {t("col.stdCost")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {skuBreakdown.map((r) => (
                      <TableRow
                        key={r.skuId}
                        className="border-b border-table-border hover:bg-table-hover transition-colors"
                      >
                        <TableCell className="px-3 py-2 font-mono text-xs">{r.skuCode}</TableCell>
                        <TableCell className="px-3 py-2 text-sm">{r.skuName}</TableCell>
                        <TableCell className="px-3 py-2">
                          <Badge variant="outline" className="text-xs">
                            {r.type}
                          </Badge>
                        </TableCell>
                        <TableCell className="px-3 py-2 text-sm font-mono text-right">
                          {r.expectedUsage.toFixed(2)}
                        </TableCell>
                        <TableCell className="px-3 py-2">
                          <UnitLabel unit={r.uom} />
                        </TableCell>
                        <TableCell className="px-3 py-2 text-sm font-mono text-right">
                          ฿{r.stdUnitPrice.toFixed(4)}
                        </TableCell>
                        <TableCell className="px-3 py-2 text-sm font-mono text-right font-medium">
                          ฿{fmt(r.stdCost)}
                        </TableCell>
                      </TableRow>
                    ))}
                    {skuBreakdown.length === 0 && (
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
                          <Badge
                            variant={
                              m.stdFcPct > FC_AMBER_MAX
                                ? "destructive"
                                : m.stdFcPct > FC_GREEN_MAX
                                  ? "secondary"
                                  : "default"
                            }
                            className="text-xs"
                          >
                            {m.stdFcPct.toFixed(1)}%
                          </Badge>
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
