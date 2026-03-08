import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { SKU } from '@/types/sku';
import { ProductionPlan, ProductionRecord, getISOWeekNumber, getWeekStart, getWeekEnd } from '@/types/production';
import { GoodsReceipt } from '@/types/goods-receipt';
import { BOMHeader, BOMLine } from '@/types/bom';
import { Price } from '@/types/price';
import { Delivery } from '@/types/delivery';
import { StockBalance } from '@/types/stock';
import { SMStockBalance } from '@/hooks/use-sm-stock-data';
import { CalendarIcon, Clock, TrendingDown, TrendingUp, Package, Factory, ShoppingCart, BarChart3, Wallet, ChevronDown } from 'lucide-react';
import type { DateRange } from 'react-day-picker';

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
  deliveries: Delivery[];
  getTotalProducedForPlan: (planId: string) => number;
  getStdUnitPrice: (skuId: string) => number;
}

const Dashboard = ({
  skus,
  smStockBalances,
  rmStockBalances,
  productionPlans,
  productionRecords,
  receipts,
  bomHeaders,
  bomLines,
  prices,
  deliveries,
  getTotalProducedForPlan,
  getStdUnitPrice,
}: DashboardProps) => {
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const defaultStart = new Date(getWeekStart(todayStr));
  const defaultEnd = new Date(getWeekEnd(getWeekStart(todayStr)));

  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: defaultStart,
    to: defaultEnd,
  });

  const rangeStart = dateRange?.from ? format(dateRange.from, 'yyyy-MM-dd') : getWeekStart(todayStr);
  const rangeEnd = dateRange?.to ? format(dateRange.to, 'yyyy-MM-dd') : getWeekEnd(getWeekStart(todayStr));
  const lastUpdated = now.toLocaleString();

  const skuMap = useMemo(() => {
    const m = new Map<string, SKU>();
    skus.forEach(s => m.set(s.id, s));
    return m;
  }, [skus]);

  // Stock Value Overview
  const [stockDetailOpen, setStockDetailOpen] = useState(false);

  const stockValueOverview = useMemo(() => {
    let totalRmValue = 0;
    const rmRows: { name: string; stock: number; value: number; uom: string }[] = [];
    rmStockBalances.forEach(bal => {
      const sku = skuMap.get(bal.skuId);
      const price = getStdUnitPrice(bal.skuId);
      const value = bal.currentStock * price;
      totalRmValue += value;
      rmRows.push({ name: sku?.name ?? '—', stock: bal.currentStock, value, uom: sku?.usageUom ?? '' });
    });

    let totalSmValue = 0;
    const smRows: { name: string; stock: number; value: number }[] = [];
    smStockBalances.forEach(bal => {
      const sku = skuMap.get(bal.skuId);
      const bomHeader = bomHeaders.find(h => h.smSkuId === bal.skuId);
      let costPerGram = 0;
      if (bomHeader) {
        const bLines = bomLines.filter(l => l.bomHeaderId === bomHeader.id);
        const batchCost = bLines.reduce((s, line) => {
          const ap = prices.find(p => p.skuId === line.rmSkuId && p.isActive);
          return s + line.qtyPerBatch * (ap?.pricePerUsageUom ?? 0);
        }, 0);
        const outputPerBatch = bomHeader.batchSize * bomHeader.yieldPercent;
        costPerGram = outputPerBatch > 0 ? batchCost / outputPerBatch : 0;
      }
      const value = costPerGram * bal.currentStock * 1000; // stock in kg → grams
      totalSmValue += value;
      smRows.push({ name: sku?.name ?? '—', stock: bal.currentStock, value });
    });

    return { totalRmValue, totalSmValue, combined: totalRmValue + totalSmValue, rmRows, smRows };
  }, [rmStockBalances, smStockBalances, skuMap, getStdUnitPrice, bomHeaders, bomLines, prices]);

  // SM Stock Overview
  const smStockRows = useMemo(() => {
    return smStockBalances.map(bal => {
      const sku = skuMap.get(bal.skuId);
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const recentDeliveries = deliveries.filter(
        d => d.smSkuId === bal.skuId && d.deliveryDate >= thirtyDaysAgo.toISOString().slice(0, 10)
      );
      const totalDelivered30d = recentDeliveries.reduce((s, d) => s + d.qtyDeliveredKg, 0);
      const avgDailyDelivery = totalDelivered30d / 30;
      const coverDays = avgDailyDelivery > 0 ? bal.currentStock / avgDailyDelivery : 999;

      let color: 'destructive' | 'warning' | 'default' = 'default';
      if (coverDays < 2) color = 'destructive';
      else if (coverDays <= 5) color = 'warning';

      return {
        skuId: bal.skuId,
        name: sku?.name ?? '—',
        currentStock: bal.currentStock,
        coverDays: avgDailyDelivery > 0 ? Math.round(coverDays * 10) / 10 : null,
        color,
      };
    });
  }, [smStockBalances, skuMap, deliveries]);

  // Production Plans in range
  const rangePlans = useMemo(() => {
    return productionPlans.filter(p => p.weekStartDate <= rangeEnd && p.weekEndDate >= rangeStart);
  }, [productionPlans, rangeStart, rangeEnd]);

  const planSummary = useMemo(() => {
    const totalTarget = rangePlans.reduce((s, p) => s + p.targetQtyKg, 0);
    const totalProduced = rangePlans.reduce((s, p) => s + getTotalProducedForPlan(p.id), 0);
    return { totalTarget, totalProduced, progress: totalTarget > 0 ? (totalProduced / totalTarget) * 100 : 0 };
  }, [rangePlans, getTotalProducedForPlan]);

  // Purchase Summary in range
  const purchaseSummary = useMemo(() => {
    const rangeReceipts = receipts.filter(r => r.receiptDate >= rangeStart && r.receiptDate <= rangeEnd);
    const totalActual = rangeReceipts.reduce((s, r) => s + r.actualTotal, 0);
    const totalStandard = rangeReceipts.reduce((s, r) => s + r.standardPrice, 0);
    return { totalActual, totalStandard, variance: totalActual - totalStandard };
  }, [receipts, rangeStart, rangeEnd]);

  // Production Cost Analysis in range
  const prodCostAnalysis = useMemo(() => {
    const rangeRecords = productionRecords.filter(r =>
      r.productionDate >= rangeStart && r.productionDate <= rangeEnd
    );
    const bySmSku = new Map<string, ProductionRecord[]>();
    rangeRecords.forEach(r => {
      const arr = bySmSku.get(r.smSkuId) || [];
      arr.push(r);
      bySmSku.set(r.smSkuId, arr);
    });

    const rows: { smSkuId: string; name: string; actualOutputKg: number; standardValue: number; actualValue: number; variance: number }[] = [];

    bySmSku.forEach((recs, smSkuId) => {
      const sku = skuMap.get(smSkuId);
      const totalOutputKg = recs.reduce((s, r) => s + r.actualOutputKg, 0);
      const totalBatches = recs.reduce((s, r) => s + r.batchesProduced, 0);

      const bomHeader = bomHeaders.find(h => h.smSkuId === smSkuId);
      let bomCostPerGram = 0;
      if (bomHeader) {
        const bLines = bomLines.filter(l => l.bomHeaderId === bomHeader.id);
        const batchCost = bLines.reduce((s, line) => {
          const ap = prices.find(p => p.skuId === line.rmSkuId && p.isActive);
          return s + line.qtyPerBatch * (ap?.pricePerUsageUom ?? 0);
        }, 0);
        const outputPerBatch = bomHeader.batchSize * bomHeader.yieldPercent;
        bomCostPerGram = outputPerBatch > 0 ? batchCost / outputPerBatch : 0;
      }
      const standardValue = bomCostPerGram * totalOutputKg * 1000;

      let actualValue = 0;
      if (bomHeader) {
        const bLines = bomLines.filter(l => l.bomHeaderId === bomHeader.id);
        bLines.forEach(line => {
          const gramsConsumed = line.qtyPerBatch * totalBatches;
          const rmReceipts = receipts.filter(r => r.skuId === line.rmSkuId);
          const latestReceipt = rmReceipts.length > 0
            ? rmReceipts.reduce((latest, r) => r.receiptDate > latest.receiptDate ? r : latest)
            : null;
          actualValue += gramsConsumed * (latestReceipt?.actualUnitPrice ?? 0);
        });
      }

      rows.push({ smSkuId, name: sku?.name ?? '—', actualOutputKg: totalOutputKg, standardValue, actualValue, variance: actualValue - standardValue });
    });

    return rows;
  }, [productionRecords, rangeStart, rangeEnd, skuMap, bomHeaders, bomLines, prices, receipts]);

  const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const statusColor = (status: string) => {
    if (status === 'Done') return 'default' as const;
    if (status === 'In Progress') return 'secondary' as const;
    return 'outline' as const;
  };

  return (
    <div className="space-y-6">
      {/* Header with date range picker */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-heading font-bold">Dashboard</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {dateRange?.from && dateRange?.to
              ? `${format(dateRange.from, 'MMM d')} – ${format(dateRange.to, 'MMM d, yyyy')}`
              : 'Select date range'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className={cn('justify-start text-left font-normal', !dateRange && 'text-muted-foreground')}>
                <CalendarIcon className="w-4 h-4 mr-2" />
                {dateRange?.from ? (
                  dateRange.to ? `${format(dateRange.from, 'MMM d')} – ${format(dateRange.to, 'MMM d')}` : format(dateRange.from, 'MMM d')
                ) : 'Pick dates'}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="range"
                selected={dateRange}
                onSelect={setDateRange}
                numberOfMonths={2}
                initialFocus
                className={cn("p-3 pointer-events-auto")}
              />
            </PopoverContent>
          </Popover>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="w-3.5 h-3.5" />
            {lastUpdated}
          </div>
        </div>
      </div>

      {/* Stock Value Overview */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Wallet className="w-4 h-4 text-primary" />
            Stock Value Overview
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="rounded-lg border p-4">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">RM Stock Value</p>
              <p className="text-2xl font-heading font-bold mt-1 font-mono">{fmt(stockValueOverview.totalRmValue)}</p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">SM Stock Value</p>
              <p className="text-2xl font-heading font-bold mt-1 font-mono">{fmt(stockValueOverview.totalSmValue)}</p>
            </div>
            <div className="rounded-lg border bg-primary/5 p-4">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Inventory Value</p>
              <p className="text-2xl font-heading font-bold mt-1 font-mono">{fmt(stockValueOverview.combined)}</p>
            </div>
          </div>

          <Collapsible open={stockDetailOpen} onOpenChange={setStockDetailOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="text-xs text-muted-foreground">
                <ChevronDown className={cn("w-3.5 h-3.5 mr-1 transition-transform", stockDetailOpen && "rotate-180")} />
                {stockDetailOpen ? 'Hide' : 'Show'} SKU breakdown
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* RM breakdown */}
                <div>
                  <h4 className="text-xs font-medium text-muted-foreground mb-2 uppercase">Raw Materials</h4>
                  <div className="max-h-48 overflow-y-auto rounded border">
                    <table className="w-full text-xs">
                      <thead><tr className="border-b bg-muted/50"><th className="px-3 py-1.5 text-left font-medium text-muted-foreground">Name</th><th className="px-3 py-1.5 text-right font-medium text-muted-foreground">Stock</th><th className="px-3 py-1.5 text-right font-medium text-muted-foreground">Value</th></tr></thead>
                      <tbody>
                        {stockValueOverview.rmRows.map((r, i) => (
                          <tr key={i} className="border-b last:border-0"><td className="px-3 py-1.5">{r.name}</td><td className="px-3 py-1.5 text-right font-mono">{fmt(r.stock)} {r.uom}</td><td className="px-3 py-1.5 text-right font-mono">{fmt(r.value)}</td></tr>
                        ))}
                        {stockValueOverview.rmRows.length === 0 && <tr><td colSpan={3} className="px-3 py-4 text-center text-muted-foreground">No RM stock</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </div>
                {/* SM breakdown */}
                <div>
                  <h4 className="text-xs font-medium text-muted-foreground mb-2 uppercase">Semi-finished</h4>
                  <div className="max-h-48 overflow-y-auto rounded border">
                    <table className="w-full text-xs">
                      <thead><tr className="border-b bg-muted/50"><th className="px-3 py-1.5 text-left font-medium text-muted-foreground">Name</th><th className="px-3 py-1.5 text-right font-medium text-muted-foreground">Stock (kg)</th><th className="px-3 py-1.5 text-right font-medium text-muted-foreground">Value</th></tr></thead>
                      <tbody>
                        {stockValueOverview.smRows.map((r, i) => (
                          <tr key={i} className="border-b last:border-0"><td className="px-3 py-1.5">{r.name}</td><td className="px-3 py-1.5 text-right font-mono">{fmt(r.stock)}</td><td className="px-3 py-1.5 text-right font-mono">{fmt(r.value)}</td></tr>
                        ))}
                        {stockValueOverview.smRows.length === 0 && <tr><td colSpan={3} className="px-3 py-4 text-center text-muted-foreground">No SM stock</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
      </Card>

      {/* SM Stock Overview */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Package className="w-4 h-4 text-primary" />
            SM Stock Overview
          </CardTitle>
        </CardHeader>
        <CardContent>
          {smStockRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No SM SKUs found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-2 font-medium text-muted-foreground">Name</th>
                    <th className="pb-2 font-medium text-muted-foreground text-right">Current Stock (kg)</th>
                    <th className="pb-2 font-medium text-muted-foreground text-right">Cover Days</th>
                    <th className="pb-2 font-medium text-muted-foreground text-center">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {smStockRows.map(row => (
                    <tr key={row.skuId} className="border-b last:border-0">
                      <td className="py-2">{row.name}</td>
                      <td className="py-2 text-right font-mono">{fmt(row.currentStock)}</td>
                      <td className="py-2 text-right font-mono">{row.coverDays !== null ? row.coverDays : '—'}</td>
                      <td className="py-2 text-center">
                        <Badge variant={row.color === 'warning' ? 'secondary' : row.color}>
                          {row.coverDays === null ? 'No data' : row.coverDays < 2 ? 'Critical' : row.coverDays <= 5 ? 'Low' : 'Healthy'}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Production Plan */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Factory className="w-4 h-4 text-primary" />
            Production Plan
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="text-sm"><span className="text-muted-foreground">Target:</span> <span className="font-semibold">{fmt(planSummary.totalTarget)} kg</span></div>
            <div className="text-sm"><span className="text-muted-foreground">Produced:</span> <span className="font-semibold">{fmt(planSummary.totalProduced)} kg</span></div>
          </div>
          <Progress value={Math.min(planSummary.progress, 100)} className="h-2" />
          {rangePlans.length === 0 ? (
            <p className="text-sm text-muted-foreground">No plans in selected range.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-2 font-medium text-muted-foreground">SM SKU</th>
                    <th className="pb-2 font-medium text-muted-foreground text-right">Target (kg)</th>
                    <th className="pb-2 font-medium text-muted-foreground text-right">Produced (kg)</th>
                    <th className="pb-2 font-medium text-muted-foreground text-center">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rangePlans.map(plan => {
                    const produced = getTotalProducedForPlan(plan.id);
                    return (
                      <tr key={plan.id} className="border-b last:border-0">
                        <td className="py-2">{skuMap.get(plan.smSkuId)?.name ?? '—'}</td>
                        <td className="py-2 text-right font-mono">{fmt(plan.targetQtyKg)}</td>
                        <td className="py-2 text-right font-mono">{fmt(produced)}</td>
                        <td className="py-2 text-center"><Badge variant={statusColor(plan.status)}>{plan.status}</Badge></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Purchase Summary */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ShoppingCart className="w-4 h-4 text-primary" />
              Purchase Summary
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Actual Purchase Value</span>
              <span className="font-mono font-semibold">{fmt(purchaseSummary.totalActual)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Standard Purchase Value</span>
              <span className="font-mono font-semibold">{fmt(purchaseSummary.totalStandard)}</span>
            </div>
            <div className="border-t pt-2 flex justify-between text-sm">
              <span className="font-medium">Variance</span>
              <span className={`font-mono font-bold ${purchaseSummary.variance > 0 ? 'text-destructive' : purchaseSummary.variance < 0 ? 'text-green-600' : ''}`}>
                {purchaseSummary.variance > 0 ? '+' : ''}{fmt(purchaseSummary.variance)}
                {purchaseSummary.variance !== 0 && (
                  purchaseSummary.variance > 0 ? <TrendingUp className="w-3.5 h-3.5 inline ml-1" /> : <TrendingDown className="w-3.5 h-3.5 inline ml-1" />
                )}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Production Cost Analysis */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-primary" />
              Production Cost Analysis
            </CardTitle>
          </CardHeader>
          <CardContent>
            {prodCostAnalysis.length === 0 ? (
              <p className="text-sm text-muted-foreground">No production in selected range.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="pb-2 font-medium text-muted-foreground">SM SKU</th>
                      <th className="pb-2 font-medium text-muted-foreground text-right">Output (kg)</th>
                      <th className="pb-2 font-medium text-muted-foreground text-right">Standard</th>
                      <th className="pb-2 font-medium text-muted-foreground text-right">Actual</th>
                      <th className="pb-2 font-medium text-muted-foreground text-right">Variance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {prodCostAnalysis.map(row => (
                      <tr key={row.smSkuId} className="border-b last:border-0">
                        <td className="py-2">{row.name}</td>
                        <td className="py-2 text-right font-mono">{fmt(row.actualOutputKg)}</td>
                        <td className="py-2 text-right font-mono">{fmt(row.standardValue)}</td>
                        <td className="py-2 text-right font-mono">{fmt(row.actualValue)}</td>
                        <td className={`py-2 text-right font-mono font-semibold ${row.variance > 0 ? 'text-destructive' : row.variance < 0 ? 'text-green-600' : ''}`}>
                          {row.variance > 0 ? '+' : ''}{fmt(row.variance)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Dashboard;
