import { useState, useMemo } from 'react';
import { useLanguage } from '@/hooks/use-language';
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
import { useAuth } from '@/hooks/use-auth';

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

function getGreeting(name: string) {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  return `${greeting}, ${name} 👋`;
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
  const { profile } = useAuth();
  const { t } = useLanguage();
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
      const value = costPerGram * bal.currentStock * 1000;
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

  const firstName = profile?.full_name?.split(' ')[0] || 'Chef';

  const hasNoData = rmStockBalances.length === 0 && smStockBalances.length === 0 && rangePlans.length === 0;

  return (
    <div className="section-gap">
      {/* Header with greeting */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="page-title">{getGreeting(firstName)}</h2>
          <p className="page-subtitle mt-1">
            {dateRange?.from && dateRange?.to
              ? `${format(dateRange.from, 'MMM d')} – ${format(dateRange.to, 'MMM d, yyyy')}`
              : 'Select date range'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className={cn('justify-start text-left font-normal h-9', !dateRange && 'text-muted-foreground')}>
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
          <div className="flex items-center gap-1.5 text-helper text-muted-foreground">
            <Clock className="w-3.5 h-3.5" />
            {lastUpdated}
          </div>
        </div>
      </div>

      {hasNoData && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="w-16 h-16 rounded-full bg-accent flex items-center justify-center mb-4">
              <Package className="w-8 h-8 text-primary" />
            </div>
            <p className="text-lg font-semibold">Nothing cooking yet 🍳</p>
            <p className="text-sm text-muted-foreground mt-1">Add your first data to get started — SKUs, recipes, or receipts!</p>
          </CardContent>
        </Card>
      )}

      {/* Stock Value Overview */}
      <Card className="card-hover">
        <CardHeader className="pb-3 px-card-p pt-card-p">
          <CardTitle className="text-section-title flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
              <Wallet className="w-4 h-4 text-primary" />
            </div>
            {t('title.stockValueOverview')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 px-card-p pb-card-p">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="rounded-lg border p-card-p">
              <p className="text-helper font-semibold text-muted-foreground uppercase tracking-wider">{t('summary.rmStockValue')}</p>
              <p className="text-2xl font-bold mt-2 font-mono">{fmt(stockValueOverview.totalRmValue)}</p>
            </div>
            <div className="rounded-lg border p-card-p">
              <p className="text-helper font-semibold text-muted-foreground uppercase tracking-wider">{t('summary.smStockValue')}</p>
              <p className="text-2xl font-bold mt-2 font-mono">{fmt(stockValueOverview.totalSmValue)}</p>
            </div>
            <div className="rounded-lg border bg-accent p-card-p">
              <p className="text-helper font-semibold text-muted-foreground uppercase tracking-wider">{t('summary.totalInventoryValue')}</p>
              <p className="text-2xl font-bold mt-2 font-mono">{fmt(stockValueOverview.combined)}</p>
            </div>
          </div>

          <Collapsible open={stockDetailOpen} onOpenChange={setStockDetailOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="text-helper text-muted-foreground">
                <ChevronDown className={cn("w-3.5 h-3.5 mr-1 transition-transform", stockDetailOpen && "rotate-180")} />
                {stockDetailOpen ? 'Hide' : 'Show'} SKU breakdown
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div>
                  <h4 className="text-helper font-semibold text-muted-foreground mb-2 uppercase tracking-wider">{t('title.rawMaterials')}</h4>
                  <div className="max-h-48 overflow-y-auto rounded-lg border">
                    <table className="w-full text-sm">
                      <thead><tr className="border-b bg-table-header"><th className="px-3 py-2 text-left table-header">Name</th><th className="px-3 py-2 text-right table-header">Stock</th><th className="px-3 py-2 text-right table-header">Value</th></tr></thead>
                      <tbody>
                        {stockValueOverview.rmRows.map((r, i) => (
                          <tr key={i} className="border-b border-table-border last:border-0 table-row-hover"><td className="px-3 py-2">{r.name}</td><td className="px-3 py-2 text-right font-mono text-helper">{fmt(r.stock)} {r.uom}</td><td className="px-3 py-2 text-right font-mono text-helper">{fmt(r.value)}</td></tr>
                        ))}
                        {stockValueOverview.rmRows.length === 0 && <tr><td colSpan={3} className="px-3 py-8 text-center text-muted-foreground text-helper">No RM stock</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div>
                  <h4 className="text-helper font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Semi-finished</h4>
                  <div className="max-h-48 overflow-y-auto rounded-lg border">
                    <table className="w-full text-sm">
                      <thead><tr className="border-b bg-table-header"><th className="px-3 py-2 text-left table-header">Name</th><th className="px-3 py-2 text-right table-header">Stock (kg)</th><th className="px-3 py-2 text-right table-header">Value</th></tr></thead>
                      <tbody>
                        {stockValueOverview.smRows.map((r, i) => (
                          <tr key={i} className="border-b border-table-border last:border-0 table-row-hover"><td className="px-3 py-2">{r.name}</td><td className="px-3 py-2 text-right font-mono text-helper">{fmt(r.stock)}</td><td className="px-3 py-2 text-right font-mono text-helper">{fmt(r.value)}</td></tr>
                        ))}
                        {stockValueOverview.smRows.length === 0 && <tr><td colSpan={3} className="px-3 py-8 text-center text-muted-foreground text-helper">No SM stock</td></tr>}
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
      <Card className="card-hover">
        <CardHeader className="pb-3 px-card-p pt-card-p">
          <CardTitle className="text-section-title flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-info/10 flex items-center justify-center">
              <Package className="w-4 h-4 text-info" />
            </div>
            SM Stock Overview
          </CardTitle>
        </CardHeader>
        <CardContent className="px-card-p pb-card-p">
          {smStockRows.length === 0 ? (
            <div className="flex flex-col items-center py-8">
              <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
                <Package className="w-6 h-6 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium">No SM SKUs found</p>
              <p className="text-helper text-muted-foreground mt-1">Add semi-finished products to see stock levels</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-table-header">
                    <th className="px-4 py-3 text-left table-header">Name</th>
                    <th className="px-4 py-3 text-right table-header">Current Stock (kg)</th>
                    <th className="px-4 py-3 text-right table-header">Cover Days</th>
                    <th className="px-4 py-3 text-center table-header">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {smStockRows.map((row, idx) => (
                    <tr key={row.skuId} className={`border-b border-table-border last:border-0 table-row-hover ${idx % 2 === 1 ? 'bg-table-alt' : ''}`}>
                      <td className="px-4 py-3 font-medium">{row.name}</td>
                      <td className="px-4 py-3 text-right font-mono">{fmt(row.currentStock)}</td>
                      <td className="px-4 py-3 text-right font-mono">{row.coverDays !== null ? row.coverDays : '—'}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          row.color === 'destructive' ? 'bg-destructive/10 text-destructive' :
                          row.color === 'warning' ? 'bg-warning/10 text-warning' :
                          'bg-success/10 text-success'
                        }`}>
                          {row.coverDays === null ? 'No data' : row.coverDays < 2 ? 'Critical' : row.coverDays <= 5 ? 'Low' : 'Healthy'}
                        </span>
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
      <Card className="card-hover">
        <CardHeader className="pb-3 px-card-p pt-card-p">
          <CardTitle className="text-section-title flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-success/10 flex items-center justify-center">
              <Factory className="w-4 h-4 text-success" />
            </div>
            Production Plan
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 px-card-p pb-card-p">
          <div className="flex items-center gap-6">
            <div className="text-sm"><span className="text-muted-foreground">Target:</span> <span className="font-semibold font-mono">{fmt(planSummary.totalTarget)} kg</span></div>
            <div className="text-sm"><span className="text-muted-foreground">Produced:</span> <span className="font-semibold font-mono">{fmt(planSummary.totalProduced)} kg</span></div>
          </div>
          <Progress value={Math.min(planSummary.progress, 100)} className="h-2" />
          {rangePlans.length === 0 ? (
            <div className="flex flex-col items-center py-8">
              <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
                <Factory className="w-6 h-6 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium">No plans in selected range</p>
              <p className="text-helper text-muted-foreground mt-1">Try a different date range or create a production plan</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-table-header">
                    <th className="px-4 py-3 text-left table-header">SM SKU</th>
                    <th className="px-4 py-3 text-right table-header">Target (kg)</th>
                    <th className="px-4 py-3 text-right table-header">Produced (kg)</th>
                    <th className="px-4 py-3 text-center table-header">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rangePlans.map((plan, idx) => {
                    const produced = getTotalProducedForPlan(plan.id);
                    return (
                      <tr key={plan.id} className={`border-b border-table-border last:border-0 table-row-hover ${idx % 2 === 1 ? 'bg-table-alt' : ''}`}>
                        <td className="px-4 py-3 font-medium">{skuMap.get(plan.smSkuId)?.name ?? '—'}</td>
                        <td className="px-4 py-3 text-right font-mono">{fmt(plan.targetQtyKg)}</td>
                        <td className="px-4 py-3 text-right font-mono">{fmt(produced)}</td>
                        <td className="px-4 py-3 text-center"><Badge variant={statusColor(plan.status)}>{plan.status}</Badge></td>
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
        <Card className="card-hover">
          <CardHeader className="pb-3 px-card-p pt-card-p">
            <CardTitle className="text-section-title flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-warning/10 flex items-center justify-center">
                <ShoppingCart className="w-4 h-4 text-warning" />
              </div>
              Purchase Summary
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 px-card-p pb-card-p">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Actual Purchase Value</span>
              <span className="font-mono font-semibold">{fmt(purchaseSummary.totalActual)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Standard Purchase Value</span>
              <span className="font-mono font-semibold">{fmt(purchaseSummary.totalStandard)}</span>
            </div>
            <div className="border-t pt-3 flex justify-between text-sm">
              <span className="font-semibold">Variance</span>
              <span className={`font-mono font-bold ${purchaseSummary.variance > 0 ? 'variance-positive' : purchaseSummary.variance < 0 ? 'variance-negative' : ''}`}>
                {purchaseSummary.variance > 0 ? '+' : ''}{fmt(purchaseSummary.variance)}
                {purchaseSummary.variance !== 0 && (
                  purchaseSummary.variance > 0 ? <TrendingUp className="w-3.5 h-3.5 inline ml-1" /> : <TrendingDown className="w-3.5 h-3.5 inline ml-1" />
                )}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Production Cost Analysis */}
        <Card className="card-hover">
          <CardHeader className="pb-3 px-card-p pt-card-p">
            <CardTitle className="text-section-title flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <BarChart3 className="w-4 h-4 text-primary" />
              </div>
              Production Cost Analysis
            </CardTitle>
          </CardHeader>
          <CardContent className="px-card-p pb-card-p">
            {prodCostAnalysis.length === 0 ? (
              <div className="flex flex-col items-center py-8">
                <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
                  <BarChart3 className="w-6 h-6 text-muted-foreground" />
                </div>
                <p className="text-sm font-medium">No production in selected range</p>
                <p className="text-helper text-muted-foreground mt-1">Record production to see cost analysis</p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-table-header">
                      <th className="px-4 py-3 text-left table-header">SM SKU</th>
                      <th className="px-4 py-3 text-right table-header">Output (kg)</th>
                      <th className="px-4 py-3 text-right table-header">Standard</th>
                      <th className="px-4 py-3 text-right table-header">Actual</th>
                      <th className="px-4 py-3 text-right table-header">Variance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {prodCostAnalysis.map((row, idx) => (
                      <tr key={row.smSkuId} className={`border-b border-table-border last:border-0 table-row-hover ${idx % 2 === 1 ? 'bg-table-alt' : ''}`}>
                        <td className="px-4 py-3 font-medium">{row.name}</td>
                        <td className="px-4 py-3 text-right font-mono">{fmt(row.actualOutputKg)}</td>
                        <td className="px-4 py-3 text-right font-mono">{fmt(row.standardValue)}</td>
                        <td className="px-4 py-3 text-right font-mono">{fmt(row.actualValue)}</td>
                        <td className={`px-4 py-3 text-right font-mono font-semibold ${row.variance > 0 ? 'variance-positive' : row.variance < 0 ? 'variance-negative' : ''}`}>
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
