import { useState, useMemo, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, eachDayOfInterval, parseISO } from 'date-fns';
import { CalendarIcon, Calculator, TrendingDown, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { BarChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ComposedChart, Legend } from 'recharts';
import { cn } from '@/lib/utils';
import { SKU } from '@/types/sku';
import { Price } from '@/types/price';
import { Menu } from '@/types/menu';
import { MenuBomLine } from '@/types/menu-bom';
import { ModifierRule } from '@/types/modifier-rule';
import { SpBomLine } from '@/types/sp-bom';
import { Branch } from '@/types/branch';
import { Supplier } from '@/types/supplier';
import { useAuth } from '@/hooks/use-auth';

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

type DatePreset = 'today' | 'this-week' | 'this-month' | 'custom';

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
  skus, prices, menus, menuBomLines, modifierRules, spBomLines, branches, suppliers,
}: FoodCostPageProps) {
  const { isManagement, isStoreManager, profile } = useAuth();
  const today = new Date();

  const [preset, setPreset] = useState<DatePreset>('today');
  const [dateFrom, setDateFrom] = useState<Date>(today);
  const [dateTo, setDateTo] = useState<Date>(today);
  const [selectedBranch, setSelectedBranch] = useState<string>(
    isStoreManager && profile?.branch_id ? profile.branch_id : 'all'
  );
  const [loading, setLoading] = useState(false);
  const [calculated, setCalculated] = useState(false);

  // Results
  const [dailyData, setDailyData] = useState<DailyData[]>([]);
  const [skuBreakdown, setSkuBreakdown] = useState<SkuBreakdown[]>([]);
  const [menuBreakdown, setMenuBreakdown] = useState<MenuBreakdown[]>([]);
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [totalStdCost, setTotalStdCost] = useState(0);

  const activeBranches = useMemo(
    () => branches.filter(b => b.status === 'Active'),
    [branches]
  );

  const handlePresetChange = (p: DatePreset) => {
    setPreset(p);
    if (p === 'today') { setDateFrom(today); setDateTo(today); }
    else if (p === 'this-week') { setDateFrom(startOfWeek(today, { weekStartsOn: 1 })); setDateTo(endOfWeek(today, { weekStartsOn: 1 })); }
    else if (p === 'this-month') { setDateFrom(startOfMonth(today)); setDateTo(endOfMonth(today)); }
  };

  // Build lookup maps
  const skuMap = useMemo(() => {
    const m = new Map<string, SKU>();
    skus.forEach(s => m.set(s.id, s));
    return m;
  }, [skus]);

  const stdPriceMap = useMemo(() => {
    const m = new Map<string, number>();
    prices.filter(p => p.isActive).forEach(p => {
      if (!m.has(p.skuId)) m.set(p.skuId, p.pricePerUsageUom);
    });
    return m;
  }, [prices]);

  const menuByCode = useMemo(() => {
    const m = new Map<string, Menu>();
    menus.forEach(menu => m.set(menu.menuCode, menu));
    return m;
  }, [menus]);

  const bomByMenuId = useMemo(() => {
    const m = new Map<string, MenuBomLine[]>();
    menuBomLines.forEach(l => {
      const arr = m.get(l.menuId) || [];
      arr.push(l);
      m.set(l.menuId, arr);
    });
    return m;
  }, [menuBomLines]);

  const spBomBySpSku = useMemo(() => {
    const m = new Map<string, SpBomLine[]>();
    spBomLines.forEach(l => {
      const arr = m.get(l.spSkuId) || [];
      arr.push(l);
      m.set(l.spSkuId, arr);
    });
    return m;
  }, [spBomLines]);

  const activeRules = useMemo(() => modifierRules.filter(r => r.isActive), [modifierRules]);

  // Calculate ingredient usage for a set of sales rows
  const calcUsage = useCallback((sales: any[]): Record<string, number> => {
    const usage: Record<string, number> = {};
    const add = (skuId: string, qty: number) => { usage[skuId] = (usage[skuId] || 0) + qty; };

    for (const sale of sales) {
      const qty = Number(sale.qty) || 0;
      if (qty === 0) continue;
      const menu = menuByCode.get(sale.menu_code);
      if (!menu) continue;

      const bomLines = bomByMenuId.get(menu.id) || [];
      for (const line of bomLines) {
        const ingredientQty = line.effectiveQty * qty;
        const sku = skuMap.get(line.skuId);
        if (sku && sku.type === 'SP') {
          const spLines = spBomBySpSku.get(line.skuId) || [];
          for (const sp of spLines) {
            add(sp.ingredientSkuId, (sp.qtyPerBatch / sp.batchYieldQty) * ingredientQty);
          }
        } else {
          add(line.skuId, ingredientQty);
        }
      }

      for (const rule of activeRules) {
        if (rule.menuId && rule.menuId !== menu.id) continue;
        const menuName = sale.menu_name || '';
        if (menuName.includes(rule.keyword)) {
          const modQty = rule.qtyPerMatch * qty;
          const modSku = skuMap.get(rule.skuId);
          if (modSku && modSku.type === 'SP') {
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
    return usage;
  }, [menuByCode, bomByMenuId, spBomBySpSku, skuMap, activeRules]);

  // Calculate menu-level costs for a set of sales
  const calcMenuCosts = useCallback((sales: any[]): MenuBreakdown[] => {
    const menuMap = new Map<string, { qtySold: number; revenue: number; stdCost: number }>();

    for (const sale of sales) {
      const qty = Number(sale.qty) || 0;
      if (qty === 0) continue;
      const menu = menuByCode.get(sale.menu_code);
      if (!menu) continue;

      const existing = menuMap.get(menu.menuCode) || { qtySold: 0, revenue: 0, stdCost: 0 };
      existing.qtySold += qty;
      existing.revenue += Number(sale.net_amount) || 0;

      // Calculate BOM cost for this sale
      let saleCost = 0;
      const bomLines = bomByMenuId.get(menu.id) || [];
      for (const line of bomLines) {
        const ingredientQty = line.effectiveQty * qty;
        const sku = skuMap.get(line.skuId);
        if (sku && sku.type === 'SP') {
          const spLines = spBomBySpSku.get(line.skuId) || [];
          for (const sp of spLines) {
            const rmQty = (sp.qtyPerBatch / sp.batchYieldQty) * ingredientQty;
            saleCost += rmQty * (stdPriceMap.get(sp.ingredientSkuId) || 0);
          }
        } else {
          saleCost += ingredientQty * (stdPriceMap.get(line.skuId) || 0);
        }
      }

      // Modifier costs
      for (const rule of activeRules) {
        if (rule.menuId && rule.menuId !== menu.id) continue;
        const menuName = sale.menu_name || '';
        if (menuName.includes(rule.keyword)) {
          const modQty = rule.qtyPerMatch * qty;
          const modSku = skuMap.get(rule.skuId);
          if (modSku && modSku.type === 'SP') {
            const spLines = spBomBySpSku.get(rule.skuId) || [];
            for (const sp of spLines) {
              saleCost += (sp.qtyPerBatch / sp.batchYieldQty) * modQty * (stdPriceMap.get(sp.ingredientSkuId) || 0);
            }
          } else {
            saleCost += modQty * (stdPriceMap.get(rule.skuId) || 0);
          }
        }
      }

      existing.stdCost += saleCost;
      menuMap.set(menu.menuCode, existing);
    }

    return Array.from(menuMap.entries()).map(([code, data]) => {
      const menu = menuByCode.get(code);
      return {
        menuCode: code,
        menuName: menu?.menuName || '',
        qtySold: data.qtySold,
        revenue: data.revenue,
        stdFoodCost: data.stdCost,
        stdFcPct: data.revenue > 0 ? (data.stdCost / data.revenue) * 100 : 0,
        costPerServing: data.qtySold > 0 ? data.stdCost / data.qtySold : 0,
      };
    }).sort((a, b) => b.stdFcPct - a.stdFcPct);
  }, [menuByCode, bomByMenuId, spBomBySpSku, skuMap, stdPriceMap, activeRules]);

  const handleCalculate = async () => {
    setLoading(true);
    const fromStr = format(dateFrom, 'yyyy-MM-dd');
    const toStr = format(dateTo, 'yyyy-MM-dd');

    // Fetch sales
    let q = supabase.from('sales_entries').select('*')
      .gte('sale_date', fromStr).lte('sale_date', toStr);
    if (selectedBranch !== 'all') q = q.eq('branch_id', selectedBranch);
    const { data: salesData, error } = await q.limit(5000);
    if (error) { toast.error('Failed to load sales data'); setLoading(false); return; }
    const sales = salesData || [];

    // Total revenue
    const rev = sales.reduce((sum, s) => sum + (Number(s.net_amount) || 0), 0);

    // SKU breakdown
    const usage = calcUsage(sales);
    const skuRows: SkuBreakdown[] = Object.entries(usage)
      .map(([skuId, expectedUsage]) => {
        const sku = skuMap.get(skuId);
        const stdPrice = stdPriceMap.get(skuId) || 0;
        return {
          skuId,
          skuCode: sku?.skuId || '',
          skuName: sku?.name || '',
          type: sku?.type || '',
          expectedUsage,
          uom: sku?.usageUom || '',
          stdUnitPrice: stdPrice,
          stdCost: expectedUsage * stdPrice,
        };
      })
      .filter(r => r.stdCost > 0 || r.expectedUsage > 0)
      .sort((a, b) => b.stdCost - a.stdCost);

    const totalCost = skuRows.reduce((sum, r) => sum + r.stdCost, 0);

    // Daily trend
    const days = eachDayOfInterval({ start: dateFrom, end: dateTo });
    const dailyRows: DailyData[] = days.map(day => {
      const dayStr = format(day, 'yyyy-MM-dd');
      const daySales = sales.filter(s => s.sale_date === dayStr);
      const dayRev = daySales.reduce((sum, s) => sum + (Number(s.net_amount) || 0), 0);
      const dayUsage = calcUsage(daySales);
      const dayStdCost = Object.entries(dayUsage).reduce(
        (sum, [skuId, qty]) => sum + qty * (stdPriceMap.get(skuId) || 0), 0
      );
      return {
        date: dayStr,
        label: format(day, 'dd/MM'),
        revenue: dayRev,
        stdFoodCost: dayStdCost,
        stdFcPct: dayRev > 0 ? (dayStdCost / dayRev) * 100 : 0,
      };
    });

    // Menu breakdown
    const menuRows = calcMenuCosts(sales);

    setTotalRevenue(rev);
    setTotalStdCost(totalCost);
    setDailyData(dailyRows);
    setSkuBreakdown(skuRows);
    setMenuBreakdown(menuRows);
    setCalculated(true);
    setLoading(false);
  };

  const stdFcPct = totalRevenue > 0 ? (totalStdCost / totalRevenue) * 100 : 0;

  const fmt = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-heading font-bold">Food Cost Report</h2>
        <p className="text-sm text-muted-foreground mt-0.5">Analyze standard food cost against revenue</p>
      </div>

      {/* Top Controls */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-3 items-end">
            {/* Preset */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Period</label>
              <Select value={preset} onValueChange={(v: DatePreset) => handlePresetChange(v)}>
                <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="today">Today</SelectItem>
                  <SelectItem value="this-week">This Week</SelectItem>
                  <SelectItem value="this-month">This Month</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Date From */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">From</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("w-[140px] justify-start text-left font-normal", !dateFrom && "text-muted-foreground")}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {format(dateFrom, 'dd/MM/yyyy')}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={dateFrom} onSelect={d => { if (d) { setDateFrom(d); setPreset('custom'); } }} className="p-3 pointer-events-auto" />
                </PopoverContent>
              </Popover>
            </div>

            {/* Date To */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">To</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("w-[140px] justify-start text-left font-normal", !dateTo && "text-muted-foreground")}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {format(dateTo, 'dd/MM/yyyy')}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={dateTo} onSelect={d => { if (d) { setDateTo(d); setPreset('custom'); } }} className="p-3 pointer-events-auto" />
                </PopoverContent>
              </Popover>
            </div>

            {/* Branch */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Branch</label>
              <Select value={selectedBranch} onValueChange={setSelectedBranch} disabled={isStoreManager}>
                <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {isManagement && <SelectItem value="all">All Branches</SelectItem>}
                  {activeBranches.map(b => (
                    <SelectItem key={b.id} value={b.id}>{b.branchName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button onClick={handleCalculate} disabled={loading}>
              <Calculator className="w-4 h-4 mr-1" />
              {loading ? 'Calculating...' : 'Calculate'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {calculated && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Total Revenue</CardTitle></CardHeader>
              <CardContent><p className="text-2xl font-bold">฿{fmt(totalRevenue)}</p></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Standard Food Cost</CardTitle></CardHeader>
              <CardContent><p className="text-2xl font-bold">฿{fmt(totalStdCost)}</p></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Standard FC%</CardTitle></CardHeader>
              <CardContent><p className="text-2xl font-bold">{stdFcPct.toFixed(1)}%</p></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">FC% Status</CardTitle></CardHeader>
              <CardContent>
                <Badge variant={stdFcPct <= 35 ? 'default' : 'destructive'} className={cn("text-sm px-3 py-1", stdFcPct <= 35 ? "bg-emerald-500/15 text-emerald-700 border-emerald-200" : "")}>
                  {stdFcPct <= 35 ? <TrendingDown className="w-4 h-4 mr-1" /> : <TrendingUp className="w-4 h-4 mr-1" />}
                  {stdFcPct.toFixed(1)}%
                </Badge>
              </CardContent>
            </Card>
          </div>

          {/* Daily Trend Chart */}
          {dailyData.length > 1 && (
            <Card>
              <CardHeader><CardTitle>Daily Trend</CardTitle></CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={dailyData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="label" className="text-xs" />
                      <YAxis yAxisId="left" className="text-xs" tickFormatter={v => `฿${(v / 1000).toFixed(0)}k`} />
                      <YAxis yAxisId="right" orientation="right" className="text-xs" tickFormatter={v => `${v}%`} />
                      <Tooltip
                        formatter={(value: number, name: string) =>
                          name === 'Std FC%' ? [`${value.toFixed(1)}%`, name] : [`฿${fmt(value)}`, name]
                        }
                      />
                      <Legend />
                      <Bar yAxisId="left" dataKey="revenue" name="Revenue" fill="hsl(var(--primary))" opacity={0.7} radius={[4, 4, 0, 0]} />
                      <Line yAxisId="right" type="monotone" dataKey="stdFcPct" name="Std FC%" stroke="hsl(var(--destructive))" strokeWidth={2} dot={{ r: 3 }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          {/* SKU Breakdown Table */}
          <Card>
            <CardHeader><CardTitle>Ingredient Usage Analysis</CardTitle></CardHeader>
            <CardContent>
              <div className="rounded-md border overflow-auto max-h-[400px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>SKU Code</TableHead>
                      <TableHead>SKU Name</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Expected Usage</TableHead>
                      <TableHead>UOM</TableHead>
                      <TableHead className="text-right">Std Unit Price</TableHead>
                      <TableHead className="text-right">Std Cost (฿)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {skuBreakdown.map(row => (
                      <TableRow key={row.skuId}>
                        <TableCell className="font-mono text-xs">{row.skuCode}</TableCell>
                        <TableCell>{row.skuName}</TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">{row.type}</Badge></TableCell>
                        <TableCell className="text-right">{fmt(row.expectedUsage)}</TableCell>
                        <TableCell>{row.uom}</TableCell>
                        <TableCell className="text-right">฿{fmt(row.stdUnitPrice)}</TableCell>
                        <TableCell className="text-right font-medium">฿{fmt(row.stdCost)}</TableCell>
                      </TableRow>
                    ))}
                    {skuBreakdown.length === 0 && (
                      <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No data</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Menu Profitability Table */}
          <Card>
            <CardHeader><CardTitle>Menu Cost Breakdown</CardTitle></CardHeader>
            <CardContent>
              <div className="rounded-md border overflow-auto max-h-[400px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Menu Code</TableHead>
                      <TableHead>Menu Name</TableHead>
                      <TableHead className="text-right">Qty Sold</TableHead>
                      <TableHead className="text-right">Revenue (฿)</TableHead>
                      <TableHead className="text-right">Std Food Cost (฿)</TableHead>
                      <TableHead className="text-right">Std FC%</TableHead>
                      <TableHead className="text-right">Cost/Serving (฿)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {menuBreakdown.map(row => (
                      <TableRow key={row.menuCode}>
                        <TableCell className="font-mono text-xs">{row.menuCode}</TableCell>
                        <TableCell>{row.menuName}</TableCell>
                        <TableCell className="text-right">{row.qtySold}</TableCell>
                        <TableCell className="text-right">฿{fmt(row.revenue)}</TableCell>
                        <TableCell className="text-right">฿{fmt(row.stdFoodCost)}</TableCell>
                        <TableCell className="text-right">
                          <Badge variant="outline" className={cn("text-xs", row.stdFcPct > 35 ? "text-destructive border-destructive/30" : "text-emerald-700 border-emerald-200")}>
                            {row.stdFcPct.toFixed(1)}%
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">฿{fmt(row.costPerServing)}</TableCell>
                      </TableRow>
                    ))}
                    {menuBreakdown.length === 0 && (
                      <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No data</TableCell></TableRow>
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
