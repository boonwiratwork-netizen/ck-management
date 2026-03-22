import { useState, useMemo, useCallback } from 'react';
import { useLanguage } from '@/hooks/use-language';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusDot } from '@/components/ui/status-dot';
import { DatePicker } from '@/components/ui/date-picker';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn, toLocalDateStr } from '@/lib/utils';
import { formatNumber } from '@/lib/design-tokens';
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek } from 'date-fns';
import { SKU } from '@/types/sku';
import { ProductionPlan, ProductionRecord } from '@/types/production';
import { GoodsReceipt } from '@/types/goods-receipt';
import { BOMHeader, BOMLine } from '@/types/bom';
import { Price } from '@/types/price';
import { StockBalance } from '@/types/stock';
import { SMStockBalance } from '@/hooks/use-sm-stock-data';
import { useCkDashboardData } from '@/hooks/use-ck-dashboard-data';
import {
  Calculator, BarChart3, Package, Truck, UtensilsCrossed, ShoppingCart,
  AlertTriangle,
} from 'lucide-react';
import {
  PieChart, Pie, Cell as PieCell, Tooltip as PieTooltip,
  ResponsiveContainer,
} from 'recharts';

interface DashboardProps {
  skus: SKU[];
  smStockBalances: SMStockBalance[];
  rmStockBalances: StockBalance[];
  productionPlans: ProductionPlan[];
  productionRecords: ProductionRecord[];
  receipts: GoodsReceipt[];
  bomHeaders: BOMHeader[];
  bomLines: BOMLine[];
  prices: Price[];
  smDailyUsage: Record<string, number>;
  getTotalProducedForPlan: (planId: string) => number;
  getStdUnitPrice: (skuId: string) => number;
}

type PeriodMode = 'week' | 'month' | 'custom';

const fmt = (n: number) => formatNumber(n, 0);
const fmtBaht = (n: number) => `฿${formatNumber(n, 0)}`;

const DONUT_COLORS = [
  'hsl(24, 95%, 53%)',   // primary orange
  'hsl(200, 60%, 50%)',  // muted blue
  'hsl(142, 50%, 45%)',  // muted green
  'hsl(280, 40%, 55%)',  // muted purple
  'hsl(38, 70%, 55%)',   // muted amber
  'hsl(0, 0%, 65%)',     // gray for others
];

const Dashboard = ({
  skus,
  smStockBalances,
  rmStockBalances,
  smDailyUsage,
}: DashboardProps) => {
  const { t } = useLanguage();
  const now = new Date();

  // Period state
  const [periodMode, setPeriodMode] = useState<PeriodMode>('month');
  const [customFrom, setCustomFrom] = useState<Date | undefined>(undefined);
  const [customTo, setCustomTo] = useState<Date | undefined>(undefined);
  const [hasCalculated, setHasCalculated] = useState(false);

  const { rangeStart, rangeEnd } = useMemo(() => {
    if (periodMode === 'week') {
      const ws = startOfWeek(now, { weekStartsOn: 1 });
      const we = endOfWeek(now, { weekStartsOn: 1 });
      return { rangeStart: toLocalDateStr(ws), rangeEnd: toLocalDateStr(we) };
    }
    if (periodMode === 'month') {
      return { rangeStart: toLocalDateStr(startOfMonth(now)), rangeEnd: toLocalDateStr(endOfMonth(now)) };
    }
    return {
      rangeStart: customFrom ? toLocalDateStr(customFrom) : toLocalDateStr(startOfMonth(now)),
      rangeEnd: customTo ? toLocalDateStr(customTo) : toLocalDateStr(endOfMonth(now)),
    };
  }, [periodMode, customFrom, customTo]);

  // Map stock balances to the shape the hook expects
  const rmBalancesForHook = useMemo(() =>
    rmStockBalances.map(b => ({ skuId: b.skuId, currentStock: b.currentStock })),
    [rmStockBalances]
  );
  const smBalancesForHook = useMemo(() =>
    smStockBalances.map(b => ({ skuId: b.skuId, currentStock: b.currentStock })),
    [smStockBalances]
  );

  const hook = useCkDashboardData({ rangeStart, rangeEnd, rmStockBalances: rmBalancesForHook, smStockBalances: smBalancesForHook });

  const handleCalculate = useCallback(() => {
    setHasCalculated(true);
    hook.refresh();
  }, [hook.refresh]);

  const skuMap = useMemo(() => {
    const m = new Map<string, SKU>();
    skus.forEach(s => m.set(s.id, s));
    return m;
  }, [skus]);

  // SM stock cover days for pills
  const smPills = useMemo(() => {
    return smStockBalances.map(bal => {
      const sku = skuMap.get(bal.skuId);
      const daily = smDailyUsage[bal.skuId] || 0;
      const cover = daily > 0 && bal.currentStock > 0 ? bal.currentStock / daily : null;
      return { skuId: bal.skuId, name: sku?.name ?? '—', coverDays: cover !== null ? Math.round(cover * 10) / 10 : null };
    });
  }, [smStockBalances, skuMap, smDailyUsage]);

  // Purchase donut data
  const donutData = useMemo(() => {
    const suppliers = hook.purchase.bySupplier;
    if (suppliers.length <= 6) return suppliers.map(s => ({ name: s.supplierName, value: s.totalActual }));
    const top5 = suppliers.slice(0, 5);
    const othersVal = suppliers.slice(5).reduce((s, x) => s + x.totalActual, 0);
    return [...top5.map(s => ({ name: s.supplierName, value: s.totalActual })), { name: 'Others', value: othersVal }];
  }, [hook.purchase]);

  const periodLabel = periodMode === 'week'
    ? `${format(startOfWeek(now, { weekStartsOn: 1 }), 'd MMM')} – ${format(endOfWeek(now, { weekStartsOn: 1 }), 'd MMM yyyy')}`
    : periodMode === 'month'
    ? format(now, 'MMMM yyyy')
    : customFrom && customTo
    ? `${format(customFrom, 'd MMM')} – ${format(customTo, 'd MMM yyyy')}`
    : t('ckd.periodCustomRange');

  // Data quality badges
  const beginRow = hook.productionCost[0];
  const beginDate = beginRow?.beginCountDate;
  const endDate = beginRow?.endCountDate;
  const beginEstimated = beginRow?.beginIsEstimated ?? true;
  const endEstimated = beginRow?.endIsEstimated ?? true;
  const anyEstimated = beginEstimated || endEstimated;

  // Inventory count warning
  const invCountWarning = hook.inventory.countDaysOld > 7;

  return (
    <div className="space-y-6">
      {/* ── HEADER ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('ckd.title')}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{periodLabel}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex rounded-lg border overflow-hidden">
            {(['week', 'month', 'custom'] as PeriodMode[]).map(m => (
              <button
                key={m}
                onClick={() => setPeriodMode(m)}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium transition-colors',
                  periodMode === m
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-background text-muted-foreground hover:bg-muted'
                )}
              >
                {m === 'week' ? t('ckd.periodThisWeek') : m === 'month' ? t('ckd.periodThisMonth') : t('ckd.periodCustom')}
              </button>
            ))}
          </div>
          {periodMode === 'custom' && (
            <div className="flex items-center gap-2">
              <DatePicker value={customFrom} onChange={setCustomFrom} placeholder="From" />
              <DatePicker value={customTo} onChange={setCustomTo} placeholder="To" />
            </div>
          )}
          <Button onClick={handleCalculate} className="gap-2">
            <Calculator className="w-4 h-4" />
            {t('btn.calculate')}
          </Button>
        </div>
      </div>

      {/* ── PRE-CALCULATE EMPTY STATE ── */}
      {!hasCalculated && !hook.loading && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-20">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
              <Calculator className="w-8 h-8 text-muted-foreground" />
            </div>
             <p className="text-lg font-semibold">{t('ckd.emptyTitle')}</p>
             <p className="text-sm text-muted-foreground mt-1">{t('ckd.emptySubtitle')}</p>
          </CardContent>
        </Card>
      )}

      {/* ── LOADING SKELETON ── */}
      {hook.loading && (
        <div className="space-y-6">
          <Card><CardContent className="p-6 space-y-4">
            <Skeleton className="h-6 w-60" />
            <div className="grid grid-cols-3 gap-4">
              <Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-24" />
            </div>
            <Skeleton className="h-48" />
          </CardContent></Card>
          <div className="grid grid-cols-3 gap-4">
            <Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" />
          </div>
          <div className="grid grid-cols-2 gap-6">
            <Skeleton className="h-64" /><Skeleton className="h-64" />
          </div>
        </div>
      )}

      {/* ── MAIN CONTENT ── */}
      {hasCalculated && !hook.loading && (
        <>
          {/* ═══ SECTION 1 — NORTH STAR ═══ */}
          <Card className="rounded-xl shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg font-semibold">
                <BarChart3 className="w-5 h-5 text-primary" />
                {t('dash.productionCostAnalysis')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* KPI tiles */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="rounded-lg bg-[#F1EFE8] p-4">
                  <p className="text-xs uppercase tracking-wide text-[#5F5E5A]">{t('ckd.targetCost')}</p>
                  <p className="text-3xl font-bold font-mono mt-1 text-[#2C2C2A]">{fmtBaht(hook.totalStandardCost)}</p>
                </div>
                <div className={cn('rounded-lg p-4', hook.totalVariance > 0 ? 'bg-destructive/10' : 'bg-success/10')}>
                  <p className="text-xs uppercase tracking-wide text-[#185FA5]">{t('ckd.actualSpend')}</p>
                  <p className="text-3xl font-bold font-mono mt-1 text-[#042C53]">{fmtBaht(hook.totalActualCost)}</p>
                </div>
                <div className="rounded-lg bg-[#F1EFE8] p-4 flex flex-col justify-center">
                  <p className="text-xs uppercase tracking-wide text-[#5F5E5A]">{t('ckd.vsStandard')}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <span className={cn(
                      'inline-flex items-center px-3 py-1 rounded-full text-lg font-bold font-mono',
                      hook.totalVariance > 0
                        ? 'bg-destructive/15 text-destructive'
                        : hook.totalVariance < 0
                        ? 'bg-success/15 text-success'
                        : 'bg-muted text-muted-foreground'
                    )}>
                      {hook.totalVariance > 0 ? '+' : ''}{fmtBaht(hook.totalVariance)}
                      <span className="text-sm ml-1.5">
                        ({hook.totalVariancePct > 0 ? '+' : ''}{formatNumber(hook.totalVariancePct, 1)}%)
                      </span>
                    </span>
                  </div>
                </div>
              </div>

              {/* Production cost breakdown table */}
              {hook.productionCost.length === 0 ? (
                <div className="flex flex-col items-center py-10 text-muted-foreground">
                  <BarChart3 className="w-10 h-10 mb-2 opacity-40" />
                  <p className="text-sm">{t('ckd.noProdInPeriod')}</p>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                      <tr className="border-b">
                        <th className="px-3 py-2 text-left text-xs font-medium uppercase text-muted-foreground">{t('col.smSku')}</th>
                        <th className="px-3 py-2 text-right text-xs font-medium uppercase text-muted-foreground">{t('dash.colOutput')}</th>
                        <th className="px-3 py-2 text-right text-xs font-medium uppercase text-muted-foreground">{t('dash.colStandard')}</th>
                        <th className="px-3 py-2 text-right text-xs font-medium uppercase text-muted-foreground">{t('dash.colActual')}</th>
                        <th className="px-3 py-2 text-right text-xs font-medium uppercase text-muted-foreground">{t('dash.variance')}</th>
                        <th className="px-3 py-2 text-right text-xs font-medium uppercase text-muted-foreground">{t('ckd.variancePct')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {hook.productionCost.map(row => {
                        const pct = row.totalVariancePct;
                        const varColor = row.totalVariance > 0
                          ? 'text-destructive'
                          : row.totalVariance < 0
                          ? 'text-success'
                          : 'text-muted-foreground';
                        const pctBg = pct > 5
                          ? 'bg-destructive/10 text-destructive'
                          : pct > 0
                          ? 'bg-warning/10 text-warning'
                          : pct < 0
                          ? 'bg-success/10 text-success'
                          : 'text-muted-foreground';
                        return (
                          <tr key={row.skuId} className="border-b border-muted/30 hover:bg-muted/30">
                            <td className="px-3 py-2 font-medium truncate max-w-[180px]" title={row.skuName}>{row.skuName}</td>
                            <td className="px-3 py-2 text-right font-mono">{formatNumber(row.actualOutputG, 0)}</td>
                            <td className="px-3 py-2 text-right font-mono">{fmt(row.standardCost)}</td>
                            <td className="px-3 py-2 text-right font-mono">{fmt(row.actualCost)}</td>
                            <td className={cn('px-3 py-2 text-right font-mono', varColor)}>{fmt(row.totalVariance)}</td>
                            <td className={cn('px-3 py-2 text-right font-mono rounded', pctBg)}>{formatNumber(pct, 1)}%</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Data quality strip */}
              {hook.productionCost.length > 0 && (
                <div className="space-y-2">
                  {anyEstimated && (
                    <div className="rounded-lg bg-warning/10 border border-warning/20 px-3 py-2 text-xs text-warning flex items-center gap-2">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      {t('ckd.inventoryWarning')}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                       <StatusDot status={beginEstimated ? 'amber' : 'green'} size="sm" />
                       {t('ckd.beginning')} {beginDate ?? '—'} {beginEstimated ? t('ckd.estimated') : t('ckd.counted')}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                       <StatusDot status={endEstimated ? 'amber' : 'green'} size="sm" />
                       {t('ckd.ending')} {endDate ?? '—'} {endEstimated ? t('ckd.estimated') : t('ckd.counted')}
                    </span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ═══ SECTION 2 — INVENTORY SNAPSHOT ═══ */}
          <div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
               {[
                 { label: t('ckd.rmProduction'), value: Math.max(0, hook.inventory.rmProduction), subtitle: t('ckd.atStdPrice'), icon: <Package className="w-5 h-5 text-warning" /> },
                 { label: t('ckd.rmDistribution'), value: Math.max(0, hook.inventory.rmDistribution), subtitle: t('ckd.atStdPrice'), icon: <Truck className="w-5 h-5 text-primary" /> },
                 { label: t('ckd.smStock'), value: Math.max(0, hook.inventory.sm), subtitle: t('ckd.atBomCost'), icon: <UtensilsCrossed className="w-5 h-5 text-success" /> },
              ].map(tile => (
                <Card key={tile.label} className="rounded-xl shadow-sm">
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">{tile.label}</p>
                        <p className="text-2xl font-bold font-mono mt-1">{fmtBaht(tile.value)}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{tile.subtitle}</p>
                      </div>
                      <div className="w-10 h-10 rounded-full bg-muted/50 flex items-center justify-center shrink-0">
                        {tile.icon}
                      </div>
                    </div>
                    {invCountWarning && hook.inventory.lastCountDate && (
                      <span className="inline-flex items-center gap-1 mt-2 text-xs px-2 py-0.5 rounded-full bg-warning/10 text-warning">
                        <AlertTriangle className="w-3 h-3" />
                        {t('ckd.lastCount')} {hook.inventory.lastCountDate} · {hook.inventory.countDaysOld} {t('ckd.daysOld')}
                      </span>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
            <div className="mt-2 text-right text-sm text-muted-foreground font-mono">
              {t('ckd.totalInventory')} {fmtBaht(Math.max(0, hook.inventory.total))}
            </div>
          </div>

          {/* ═══ SECTION 3 — PURCHASES + DISTRIBUTION ═══ */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Purchase Summary */}
            <Card className="rounded-xl shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-lg font-semibold">
                  <ShoppingCart className="w-5 h-5 text-warning" />
                  {t('dash.purchaseSummary')}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="text-3xl font-bold font-mono">{fmtBaht(hook.purchase.totalActualSpend)}</p>
                  <p className="text-xs text-muted-foreground">{t('ckd.totalSpendInPeriod')}</p>
                </div>

                {donutData.length > 0 ? (
                  <div className="relative" style={{ height: 220 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={donutData}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={100}
                          dataKey="value"
                          paddingAngle={2}
                        >
                          {donutData.map((_, i) => (
                            <PieCell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
                          ))}
                        </Pie>
                        <PieTooltip
                          content={({ active, payload }) => {
                            if (!active || !payload?.[0]) return null;
                            const d = payload[0].payload;
                            const pct = hook.purchase.totalActualSpend > 0
                              ? (d.value / hook.purchase.totalActualSpend * 100)
                              : 0;
                            return (
                              <div className="bg-popover border rounded-lg shadow-lg p-2 text-sm">
                                <p className="font-medium">{d.name}</p>
                                <p>{fmtBaht(d.value)} ({formatNumber(pct, 1)}%)</p>
                              </div>
                            );
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <span className="text-sm font-bold font-mono">{fmtBaht(hook.purchase.totalActualSpend)}</span>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center py-6 text-muted-foreground">
                    <ShoppingCart className="w-8 h-8 mb-2 opacity-40" />
                    <p className="text-sm">{t('ckd.noPurchasesInPeriod')}</p>
                  </div>
                )}

                {hook.purchase.bySupplier.length > 0 && (
                  <div className="overflow-x-auto rounded-lg border">
                    <table className="w-full text-sm">
                      <thead><tr className="border-b bg-muted/50">
                         <th className="px-3 py-2 text-left text-xs font-medium uppercase text-muted-foreground">{t('col.supplier')}</th>
                         <th className="px-3 py-2 text-right text-xs font-medium uppercase text-muted-foreground">{t('ckd.colAmountBaht')}</th>
                         <th className="px-3 py-2 text-right text-xs font-medium uppercase text-muted-foreground">{t('ckd.colPct')}</th>
                      </tr></thead>
                      <tbody>
                        {hook.purchase.bySupplier.slice(0, 6).map(s => (
                          <tr key={s.supplierName} className="border-b border-muted/30 last:border-0">
                            <td className="px-3 py-2 truncate max-w-[140px]" title={s.supplierName}>{s.supplierName}</td>
                            <td className="px-3 py-2 text-right font-mono">{fmt(s.totalActual)}</td>
                            <td className="px-3 py-2 text-right font-mono">{formatNumber(s.pct, 1)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Distribution Summary */}
            <Card className="rounded-xl shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-lg font-semibold">
                  <Truck className="w-5 h-5 text-primary" />
                  {t('ckd.distributionTitle')}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-lg bg-muted/40 p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">{t('ckd.smDistributed')}</p>
                    <p className="text-xl font-bold font-mono mt-1">{fmtBaht(hook.distribution.totalSmValue)}</p>
                  </div>
                  <div className="rounded-lg bg-muted/40 p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">{t('ckd.rmDistributed')}</p>
                    <p className="text-xl font-bold font-mono mt-1">{fmtBaht(hook.distribution.totalRmValue)}</p>
                  </div>
                </div>

                {hook.distribution.byBranch.length > 0 ? (
                  <div className="overflow-x-auto rounded-lg border">
                    <table className="w-full text-sm">
                      <thead><tr className="border-b bg-muted/50">
                         <th className="px-3 py-2 text-left text-xs font-medium uppercase text-muted-foreground">{t('col.branch')}</th>
                         <th className="px-3 py-2 text-right text-xs font-medium uppercase text-muted-foreground">{t('ckd.colSmBaht')}</th>
                         <th className="px-3 py-2 text-right text-xs font-medium uppercase text-muted-foreground">{t('ckd.colRmBaht')}</th>
                         <th className="px-3 py-2 text-right text-xs font-medium uppercase text-muted-foreground">{t('ckd.colTotalBaht')}</th>
                      </tr></thead>
                      <tbody>
                        {hook.distribution.byBranch.map(b => (
                          <tr key={b.branchName} className="border-b border-muted/30 last:border-0">
                            <td className="px-3 py-2">{b.branchName}</td>
                            <td className="px-3 py-2 text-right font-mono">{fmt(b.smValue)}</td>
                            <td className="px-3 py-2 text-right font-mono">{fmt(b.rmValue)}</td>
                            <td className="px-3 py-2 text-right font-mono font-semibold">{fmt(b.smValue + b.rmValue)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="flex flex-col items-center py-8 text-muted-foreground">
                    <Truck className="w-8 h-8 mb-2 opacity-40" />
                    <p className="text-sm">{t('ckd.noDistributions')}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* ═══ SECTION 4 — SM STOCK STATUS STRIP ═══ */}
          {smPills.length > 0 && (
            <div className="rounded-lg border px-4 py-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">{t('ckd.smStockStatus')}</p>
              <TooltipProvider>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {smPills.map(pill => {
                    const cd = pill.coverDays;
                    const pillClass = cd === null
                      ? 'bg-muted text-muted-foreground'
                      : cd < 2
                      ? 'bg-destructive/15 text-destructive'
                      : cd <= 5
                      ? 'bg-warning/15 text-warning'
                      : 'bg-success/15 text-success';
                    return (
                      <Tooltip key={pill.skuId}>
                        <TooltipTrigger asChild>
                          <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap shrink-0', pillClass)}>
                            {pill.name.length > 12 ? pill.name.slice(0, 12) + '…' : pill.name}
                            <span className="font-mono font-bold">{cd !== null ? cd : '—'}</span>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>{pill.name}</p>
                          <p className="font-mono">{cd !== null ? `${cd} ${t('ckd.daysCover')}` : t('ckd.noUsageData')}</p>
                        </TooltipContent>
                      </Tooltip>
                    );
                  })}
                </div>
              </TooltipProvider>
            </div>
          )}
        </>
      )}

      {/* Error display */}
      {hook.error && (
        <Card className="border-destructive">
          <CardContent className="p-4 text-sm text-destructive">{hook.error}</CardContent>
        </Card>
      )}
    </div>
  );
};

export default Dashboard;
