import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { SKU } from '@/types/sku';
import { ProductionPlan, ProductionRecord, getISOWeekNumber, getWeekStart, getWeekEnd } from '@/types/production';
import { GoodsReceipt } from '@/types/goods-receipt';
import { BOMHeader, BOMLine } from '@/types/bom';
import { Price } from '@/types/price';
import { Delivery } from '@/types/delivery';
import { SMStockBalance } from '@/hooks/use-sm-stock-data';
import { Clock, TrendingDown, TrendingUp, Package, Factory, ShoppingCart, BarChart3 } from 'lucide-react';

interface DashboardProps {
  skus: SKU[];
  smStockBalances: SMStockBalance[];
  productionPlans: ProductionPlan[];
  productionRecords: ProductionRecord[];
  receipts: GoodsReceipt[];
  bomHeaders: BOMHeader[];
  bomLines: BOMLine[];
  prices: Price[];
  deliveries: Delivery[];
  getTotalProducedForPlan: (planId: string) => number;
}

const Dashboard = ({
  skus,
  smStockBalances,
  productionPlans,
  productionRecords,
  receipts,
  bomHeaders,
  bomLines,
  prices,
  deliveries,
  getTotalProducedForPlan,
}: DashboardProps) => {
  const now = new Date();
  const currentWeek = getISOWeekNumber(now.toISOString().slice(0, 10));
  const weekStart = getWeekStart(now.toISOString().slice(0, 10));
  const weekEnd = getWeekEnd(weekStart);
  const lastUpdated = now.toLocaleString();

  const skuMap = useMemo(() => {
    const m = new Map<string, SKU>();
    skus.forEach(s => m.set(s.id, s));
    return m;
  }, [skus]);

  // Section 1: SM Stock Overview
  const smStockRows = useMemo(() => {
    return smStockBalances.map(bal => {
      const sku = skuMap.get(bal.skuId);
      // avg daily delivery over last 30 days
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

  // Section 2: This Week Production Plans
  const thisWeekPlans = useMemo(() => {
    return productionPlans.filter(p => p.weekNumber === currentWeek);
  }, [productionPlans, currentWeek]);

  const planSummary = useMemo(() => {
    const totalTarget = thisWeekPlans.reduce((s, p) => s + p.targetQtyKg, 0);
    const totalProduced = thisWeekPlans.reduce((s, p) => s + getTotalProducedForPlan(p.id), 0);
    return { totalTarget, totalProduced, progress: totalTarget > 0 ? (totalProduced / totalTarget) * 100 : 0 };
  }, [thisWeekPlans, getTotalProducedForPlan]);

  // Section 3: Weekly Purchase Summary
  const purchaseSummary = useMemo(() => {
    const weekReceipts = receipts.filter(r => {
      return r.receiptDate >= weekStart && r.receiptDate <= weekEnd;
    });
    const totalActual = weekReceipts.reduce((s, r) => s + r.actualTotal, 0);
    const totalStandard = weekReceipts.reduce((s, r) => s + r.standardPrice, 0);
    const variance = totalActual - totalStandard;
    return { totalActual, totalStandard, variance };
  }, [receipts, weekStart, weekEnd]);

  // Section 4: Production Cost Analysis
  const prodCostAnalysis = useMemo(() => {
    const weekRecords = productionRecords.filter(r =>
      r.productionDate >= weekStart && r.productionDate <= weekEnd
    );

    // Group by SM SKU
    const bySmSku = new Map<string, ProductionRecord[]>();
    weekRecords.forEach(r => {
      const arr = bySmSku.get(r.smSkuId) || [];
      arr.push(r);
      bySmSku.set(r.smSkuId, arr);
    });

    const rows: {
      smSkuId: string;
      name: string;
      actualOutputKg: number;
      standardValue: number;
      actualValue: number;
      variance: number;
    }[] = [];

    bySmSku.forEach((recs, smSkuId) => {
      const sku = skuMap.get(smSkuId);
      const totalOutputKg = recs.reduce((s, r) => s + r.actualOutputKg, 0);
      const totalBatches = recs.reduce((s, r) => s + r.batchesProduced, 0);

      // Standard: BOM cost/gram × actual output
      const bomHeader = bomHeaders.find(h => h.smSkuId === smSkuId);
      let bomCostPerGram = 0;
      if (bomHeader) {
        const bLines = bomLines.filter(l => l.bomHeaderId === bomHeader.id);
        const batchCost = bLines.reduce((s, line) => {
          const activePrice = prices.find(p => p.skuId === line.rmSkuId && p.isActive);
          return s + line.qtyPerBatch * (activePrice?.pricePerUsageUom ?? 0);
        }, 0);
        const outputPerBatch = bomHeader.batchSize * bomHeader.yieldPercent;
        bomCostPerGram = outputPerBatch > 0 ? batchCost / outputPerBatch : 0;
      }
      const standardValue = bomCostPerGram * totalOutputKg * 1000;

      // Actual: sum of (actual RM price × grams consumed)
      let actualValue = 0;
      if (bomHeader) {
        const bLines = bomLines.filter(l => l.bomHeaderId === bomHeader.id);
        bLines.forEach(line => {
          const gramsConsumed = line.qtyPerBatch * totalBatches;
          // Get actual unit price from recent receipts for this RM
          const rmReceipts = receipts.filter(r => r.skuId === line.rmSkuId);
          const latestReceipt = rmReceipts.length > 0
            ? rmReceipts.reduce((latest, r) => r.receiptDate > latest.receiptDate ? r : latest)
            : null;
          const actualUnitPrice = latestReceipt?.actualUnitPrice ?? 0;
          actualValue += gramsConsumed * actualUnitPrice;
        });
      }

      const variance = actualValue - standardValue;

      rows.push({
        smSkuId,
        name: sku?.name ?? '—',
        actualOutputKg: totalOutputKg,
        standardValue,
        actualValue,
        variance,
      });
    });

    return rows;
  }, [productionRecords, weekStart, weekEnd, skuMap, bomHeaders, bomLines, prices, receipts]);

  const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const statusColor = (status: string) => {
    if (status === 'Done') return 'default';
    if (status === 'In Progress') return 'secondary';
    return 'outline';
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-heading font-bold">Dashboard</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Week {currentWeek}: {new Date(weekStart).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – {new Date(weekEnd).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="w-3.5 h-3.5" />
          Last updated: {lastUpdated}
        </div>
      </div>

      {/* Section 1 — SM Stock Overview */}
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

      {/* Section 2 — This Week Production Plan */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Factory className="w-4 h-4 text-primary" />
            This Week Production Plan
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="text-sm">
              <span className="text-muted-foreground">Target:</span>{' '}
              <span className="font-semibold">{fmt(planSummary.totalTarget)} kg</span>
            </div>
            <div className="text-sm">
              <span className="text-muted-foreground">Produced:</span>{' '}
              <span className="font-semibold">{fmt(planSummary.totalProduced)} kg</span>
            </div>
          </div>
          <Progress value={Math.min(planSummary.progress, 100)} className="h-2" />
          {thisWeekPlans.length === 0 ? (
            <p className="text-sm text-muted-foreground">No plans for this week.</p>
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
                  {thisWeekPlans.map(plan => {
                    const produced = getTotalProducedForPlan(plan.id);
                    return (
                      <tr key={plan.id} className="border-b last:border-0">
                        <td className="py-2">{skuMap.get(plan.smSkuId)?.name ?? '—'}</td>
                        <td className="py-2 text-right font-mono">{fmt(plan.targetQtyKg)}</td>
                        <td className="py-2 text-right font-mono">{fmt(produced)}</td>
                        <td className="py-2 text-center">
                          <Badge variant={statusColor(plan.status)}>{plan.status}</Badge>
                        </td>
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
        {/* Section 3 — Weekly Purchase Summary */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ShoppingCart className="w-4 h-4 text-primary" />
              Weekly Purchase Summary
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
                  purchaseSummary.variance > 0
                    ? <TrendingUp className="w-3.5 h-3.5 inline ml-1" />
                    : <TrendingDown className="w-3.5 h-3.5 inline ml-1" />
                )}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Section 4 — Production Cost Analysis */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-primary" />
              Production Cost Analysis
            </CardTitle>
          </CardHeader>
          <CardContent>
            {prodCostAnalysis.length === 0 ? (
              <p className="text-sm text-muted-foreground">No production this week.</p>
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
