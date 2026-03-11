import { useState, useEffect, useMemo, useRef } from 'react';
import { SKU } from '@/types/sku';
import { BOMHeader } from '@/types/bom';
import { SMStockBalance } from '@/hooks/use-sm-stock-data';
import { MenuBomLine } from '@/types/menu-bom';
import { Menu } from '@/types/menu';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, Save, CheckCircle2, AlertTriangle, AlertCircle } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { SortableHeader } from '@/components/SortableHeader';
import { useSortableTable } from '@/hooks/use-sortable-table';
import { cn } from '@/lib/utils';

interface ProductionPlanTabProps {
  skus: SKU[];
  bomHeaders: BOMHeader[];
  smStockBalances: SMStockBalance[];
  menuBomLines: MenuBomLine[];
  menus: Menu[];
  getOutputPerBatch: (smSkuId: string) => number;
}

/** Get Monday of the week for today, or next Monday if Fri/Sat */
function getSmartWeekStart(): string {
  const today = new Date();
  const day = today.getDay(); // 0=Sun, 1=Mon, ..., 5=Fri, 6=Sat
  if (day === 5 || day === 6) {
    const nextMon = new Date(today);
    nextMon.setDate(today.getDate() + (8 - day));
    return nextMon.toISOString().slice(0, 10);
  }
  const diff = day === 0 ? -6 : 1 - day;
  const mon = new Date(today);
  mon.setDate(today.getDate() + diff);
  return mon.toISOString().slice(0, 10);
}

function getWeekEnd(weekStart: string): string {
  const d = new Date(weekStart);
  d.setDate(d.getDate() + 6);
  return d.toISOString().slice(0, 10);
}

function getISOWeekNumber(dateStr: string): number {
  const date = new Date(dateStr);
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

interface PlanRow {
  sku: SKU;
  hasBom: boolean;
  forecastWeek: number;
  perDay: number;
  hasSalesData: boolean;
  stockNow: number;
  coverNow: number;
  batches: number;
  outputPerBatch: number;
  planG: number;
  stockAfter: number;
  coverAfter: number;
  target: number;
  status: 'green' | 'amber' | 'red';
}

export function ProductionPlanTab({ skus, bomHeaders, smStockBalances, menuBomLines, menus, getOutputPerBatch }: ProductionPlanTabProps) {
  const [weekStart, setWeekStart] = useState(getSmartWeekStart);
  const [globalTarget, setGlobalTarget] = useState(7);
  const [planBatches, setPlanBatches] = useState<Record<string, number>>({});
  const [skuTargets, setSkuTargets] = useState<Record<string, number>>({});
  const [salesData, setSalesData] = useState<{ menuCode: string; qty: number }[]>([]);
  const [saving, setSaving] = useState(false);
  const [loadedWeek, setLoadedWeek] = useState('');
  const planInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const smSkus = useMemo(() => skus.filter(s => s.type === 'SM' && s.status === 'Active'), [skus]);
  const weekEnd = getWeekEnd(weekStart);
  const weekNumber = getISOWeekNumber(weekStart);

  // Fetch global settings
  useEffect(() => {
    supabase.from('global_settings' as any).select('*').eq('key', 'cover_days_target').single()
      .then(({ data }: any) => {
        if (data) setGlobalTarget(Number(data.value) || 7);
      });
  }, []);

  // Fetch per-SKU targets from skus.cover_days_target
  useEffect(() => {
    supabase.from('skus').select('id, cover_days_target' as any)
      .not('cover_days_target', 'is', null)
      .then(({ data }: any) => {
        if (data) {
          const map: Record<string, number> = {};
          data.forEach((r: any) => { if (r.cover_days_target != null) map[r.id] = Number(r.cover_days_target); });
          setSkuTargets(map);
        }
      });
  }, []);

  // Fetch last 7 days sales
  useEffect(() => {
    const today = new Date();
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(today.getDate() - 7);
    supabase.from('sales_entries').select('menu_code, qty')
      .gte('sale_date', sevenDaysAgo.toISOString().slice(0, 10))
      .lte('sale_date', today.toISOString().slice(0, 10))
      .then(({ data }) => {
        if (data) setSalesData(data.map((r: any) => ({ menuCode: r.menu_code, qty: Number(r.qty) })));
      });
  }, []);

  // Fetch plan lines for selected week
  useEffect(() => {
    supabase.from('weekly_plan_lines' as any).select('*').eq('week_start', weekStart)
      .then(({ data }: any) => {
        const map: Record<string, number> = {};
        if (data) {
          (data as any[]).forEach(r => { map[r.sku_id] = Number(r.planned_batches); });
        }
        setPlanBatches(map);
        setLoadedWeek(weekStart);
      });
  }, [weekStart]);

  // Compute forecast per SM SKU
  const forecast = useMemo(() => {
    const menuCodeToId = new Map(menus.map(m => [m.menuCode, m.id]));
    const smSkuIds = new Set(smSkus.map(s => s.id));
    const usage: Record<string, number> = {};

    salesData.forEach(sale => {
      const menuId = menuCodeToId.get(sale.menuCode);
      if (!menuId) return;
      menuBomLines.filter(l => l.menuId === menuId && smSkuIds.has(l.skuId)).forEach(line => {
        usage[line.skuId] = (usage[line.skuId] || 0) + line.effectiveQty * sale.qty;
      });
    });

    return usage;
  }, [salesData, menus, menuBomLines, smSkus]);

  // Build row data
  const rows = useMemo((): PlanRow[] => {
    return smSkus.map(sku => {
      const hasBom = bomHeaders.some(h => h.smSkuId === sku.id);
      const forecastWeek = forecast[sku.id] || 0;
      const perDay = forecastWeek / 7;
      const hasSalesData = forecastWeek > 0;
      const stockNow = smStockBalances.find(b => b.skuId === sku.id)?.currentStock ?? 0;
      const coverNow = perDay > 0 ? stockNow / perDay : Infinity;
      const batches = planBatches[sku.id] || 0;
      const outputPerBatch = getOutputPerBatch(sku.id);
      const planG = batches * outputPerBatch;
      const stockAfter = stockNow + planG;
      const coverAfter = perDay > 0 ? stockAfter / perDay : Infinity;
      const target = skuTargets[sku.id] ?? globalTarget;

      let status: 'green' | 'amber' | 'red' = 'green';
      if (stockAfter <= 0) status = 'red';
      else if (coverAfter < target) status = coverAfter <= 0 ? 'red' : 'amber';

      return { sku, hasBom, forecastWeek, perDay, hasSalesData, stockNow, coverNow, batches, outputPerBatch, planG, stockAfter, coverAfter, target, status };
    });
  }, [smSkus, bomHeaders, forecast, smStockBalances, planBatches, skuTargets, globalTarget, getOutputPerBatch]);

  // Sort comparators
  const comparators = useMemo(() => ({
    status: (a: PlanRow, b: PlanRow) => {
      const order = { red: 0, amber: 1, green: 2 };
      return order[a.status] - order[b.status];
    },
    code: (a: PlanRow, b: PlanRow) => a.sku.skuId.localeCompare(b.sku.skuId),
    name: (a: PlanRow, b: PlanRow) => a.sku.name.localeCompare(b.sku.name),
    forecast: (a: PlanRow, b: PlanRow) => a.forecastWeek - b.forecastWeek,
    perDay: (a: PlanRow, b: PlanRow) => a.perDay - b.perDay,
    stockNow: (a: PlanRow, b: PlanRow) => a.stockNow - b.stockNow,
    coverNow: (a: PlanRow, b: PlanRow) => a.coverNow - b.coverNow,
    batches: (a: PlanRow, b: PlanRow) => a.batches - b.batches,
    planG: (a: PlanRow, b: PlanRow) => a.planG - b.planG,
    stockAfter: (a: PlanRow, b: PlanRow) => a.stockAfter - b.stockAfter,
    coverAfter: (a: PlanRow, b: PlanRow) => a.coverAfter - b.coverAfter,
    target: (a: PlanRow, b: PlanRow) => a.target - b.target,
  }), []);

  const { sorted, sortKey, sortDir, handleSort } = useSortableTable(rows, comparators);

  // Default sort: coverAfter ascending, no-bom/no-data at bottom
  const displayRows = useMemo(() => {
    if (sortKey) return sorted;
    return [...rows].sort((a, b) => {
      const aValid = a.hasBom && a.hasSalesData;
      const bValid = b.hasBom && b.hasSalesData;
      if (aValid && !bValid) return -1;
      if (!aValid && bValid) return 1;
      if (a.coverAfter === Infinity && b.coverAfter === Infinity) return 0;
      if (a.coverAfter === Infinity) return 1;
      if (b.coverAfter === Infinity) return -1;
      return a.coverAfter - b.coverAfter;
    });
  }, [rows, sorted, sortKey]);

  // Navigate weeks
  const prevWeek = () => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() - 7);
    setWeekStart(d.toISOString().slice(0, 10));
  };
  const nextWeek = () => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 7);
    setWeekStart(d.toISOString().slice(0, 10));
  };

  // Update plan batches locally (controlled for live calc)
  const updateBatches = (skuId: string, value: number) => {
    setPlanBatches(prev => ({ ...prev, [skuId]: value }));
  };

  // Update per-SKU target (controlled + persist on blur)
  const updateSkuTarget = (skuId: string, value: number) => {
    setSkuTargets(prev => ({ ...prev, [skuId]: value }));
  };
  const persistSkuTarget = async (skuId: string, value: number) => {
    await supabase.from('skus').update({ cover_days_target: value } as any).eq('id', skuId);
  };

  // Save global target
  const saveGlobalTarget = async (value: number) => {
    setGlobalTarget(value);
    await supabase.from('global_settings' as any).update({ value: String(value) } as any).eq('key', 'cover_days_target');
  };

  // Save plan
  const savePlan = async () => {
    setSaving(true);
    const planRows = smSkus.filter(s => (planBatches[s.id] || 0) > 0).map(s => ({
      week_start: weekStart,
      sku_id: s.id,
      planned_batches: planBatches[s.id] || 0,
    }));

    await supabase.from('weekly_plan_lines' as any).delete().eq('week_start', weekStart);
    if (planRows.length > 0) {
      const { error } = await supabase.from('weekly_plan_lines' as any).insert(planRows as any);
      if (error) { toast.error('Failed to save: ' + error.message); setSaving(false); return; }
    }
    toast.success('Plan saved');
    setSaving(false);
  };

  // Summary
  const onTargetCount = displayRows.filter(r => r.hasBom && r.hasSalesData && r.coverAfter >= r.target).length;
  const totalValidCount = displayRows.filter(r => r.hasBom && r.hasSalesData).length;
  const allOnTarget = onTargetCount === totalValidCount && totalValidCount > 0;

  const formatDate = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  const coverColor = (val: number, target: number) => {
    if (!isFinite(val)) return 'text-muted-foreground';
    if (val <= 0) return 'text-destructive font-bold';
    if (val < target) return 'text-destructive';
    if (val < target * 1.2) return 'text-warning';
    return 'text-success';
  };

  // Tab key navigates down plan column
  const handlePlanKeyDown = (e: React.KeyboardEvent, skuId: string) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const idx = displayRows.findIndex(r => r.sku.id === skuId);
      const next = e.shiftKey ? idx - 1 : idx + 1;
      if (next >= 0 && next < displayRows.length) {
        planInputRefs.current[displayRows[next].sku.id]?.focus();
      }
    }
  };

  return (
    <TooltipProvider>
      <div className="space-y-4">
        {/* Header controls */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={prevWeek}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-sm font-semibold whitespace-nowrap min-w-[220px] text-center">
              Week {weekNumber} · {formatDate(weekStart)} – {formatDate(weekEnd)}
            </span>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={nextWeek}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground whitespace-nowrap">Target Cover Days</label>
              <input
                type="number"
                className="h-8 w-16 text-xs text-right font-mono px-2 py-1 border rounded-md bg-background"
                defaultValue={globalTarget}
                key={`global-${globalTarget}`}
                onBlur={e => saveGlobalTarget(Number(e.target.value) || 7)}
                onFocus={e => e.target.select()}
              />
            </div>

            <div className={cn(
              'text-xs font-medium px-3 py-1.5 rounded-full',
              allOnTarget ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'
            )}>
              {onTargetCount} of {totalValidCount} SKUs on target
            </div>

            <Button onClick={savePlan} disabled={saving} className="h-9">
              <Save className="w-4 h-4 mr-1" />
              {saving ? 'Saving...' : 'Save Plan'}
            </Button>
          </div>
        </div>

        {/* Main table */}
        <div className="border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full table-fixed text-xs">
              <thead className="sticky top-0 z-5">
                <tr className="bg-muted/50 border-b">
                  <th className="w-[36px] px-1 py-2 text-center text-muted-foreground">#</th>
                  <th className="w-[72px] px-1.5 py-2 text-left">
                    <SortableHeader label="Code" sortKey="code" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                  </th>
                  <th className="w-[130px] px-1.5 py-2 text-left">
                    <SortableHeader label="Name" sortKey="name" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                  </th>
                  <th className="w-[76px] px-1.5 py-2 text-right">
                    <SortableHeader label="Forecast/wk" sortKey="forecast" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                  </th>
                  <th className="w-[56px] px-1.5 py-2 text-right">
                    <SortableHeader label="/Day" sortKey="perDay" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                  </th>
                  <th className="w-[76px] px-1.5 py-2 text-right">
                    <SortableHeader label="Stock Now" sortKey="stockNow" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                  </th>
                  <th className="w-[56px] px-1.5 py-2 text-right">
                    <SortableHeader label="Cover" sortKey="coverNow" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                  </th>
                  <th className="w-[72px] px-1.5 py-2 text-center bg-primary/10 border-x border-primary/20">
                    <span className="font-bold text-primary">Plan</span>
                  </th>
                  <th className="w-[72px] px-1.5 py-2 text-right">
                    <SortableHeader label="Plan (g)" sortKey="planG" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                  </th>
                  <th className="w-[76px] px-1.5 py-2 text-right">
                    <SortableHeader label="After" sortKey="stockAfter" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                  </th>
                  <th className="w-[56px] px-1.5 py-2 text-right">
                    <SortableHeader label="Cover↑" sortKey="coverAfter" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                  </th>
                  <th className="w-[52px] px-1.5 py-2 text-right">
                    <SortableHeader label="Target" sortKey="target" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                  </th>
                </tr>
              </thead>
              <tbody>
                {displayRows.map((row) => {
                  const muted = !row.hasBom || !row.hasSalesData;
                  return (
                    <tr key={row.sku.id} className={cn('border-b hover:bg-muted/30 transition-colors', muted && 'opacity-50')}>
                      {/* Status */}
                      <td className="px-1 py-1 text-center">
                        {row.status === 'green' && <CheckCircle2 className="w-3.5 h-3.5 text-success inline-block" />}
                        {row.status === 'amber' && <AlertTriangle className="w-3.5 h-3.5 text-warning inline-block" />}
                        {row.status === 'red' && <AlertCircle className="w-3.5 h-3.5 text-destructive inline-block" />}
                      </td>

                      {/* Code */}
                      <td className="px-1.5 py-1 font-mono truncate">{row.sku.skuId}</td>

                      {/* Name */}
                      <td className="px-1.5 py-1 truncate">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="truncate block">{row.sku.name}</span>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-xs">
                            <p>{row.sku.name}</p>
                          </TooltipContent>
                        </Tooltip>
                      </td>

                      {/* Forecast/week */}
                      <td className="px-1.5 py-1 text-right font-mono">
                        {!row.hasBom
                          ? <span className="text-muted-foreground italic">No BOM</span>
                          : !row.hasSalesData
                            ? <span className="text-muted-foreground italic">No data</span>
                            : row.forecastWeek.toFixed(0)}
                      </td>

                      {/* Per day */}
                      <td className="px-1.5 py-1 text-right font-mono text-muted-foreground text-[10px]">
                        {row.hasBom && row.hasSalesData ? row.perDay.toFixed(0) : ''}
                      </td>

                      {/* Stock now */}
                      <td className="px-1.5 py-1 text-right font-mono">{row.stockNow.toFixed(0)}</td>

                      {/* Cover now */}
                      <td className={cn('px-1.5 py-1 text-right font-mono', row.hasSalesData && coverColor(row.coverNow, row.target))}>
                        {!row.hasSalesData ? '' : row.coverNow === Infinity ? '∞' : row.coverNow.toFixed(1)}
                      </td>

                      {/* Plan batches - EDITABLE */}
                      <td className="px-0.5 py-0.5 bg-background border-x border-primary/10">
                        <input
                          ref={el => { planInputRefs.current[row.sku.id] = el; }}
                          type="number"
                          className="h-8 w-full text-sm text-center font-semibold font-mono border-2 border-primary/30 rounded bg-background focus:border-primary focus:ring-1 focus:ring-primary/50 outline-none disabled:opacity-30"
                          value={planBatches[row.sku.id] || ''}
                          onChange={e => updateBatches(row.sku.id, Number(e.target.value) || 0)}
                          onFocus={e => e.target.select()}
                          onKeyDown={e => handlePlanKeyDown(e, row.sku.id)}
                          disabled={!row.hasBom}
                          min={0}
                        />
                      </td>

                      {/* Plan g */}
                      <td className="px-1.5 py-1 text-right font-mono text-muted-foreground">
                        {row.planG > 0 ? row.planG.toFixed(0) : ''}
                      </td>

                      {/* Stock after */}
                      <td className="px-1.5 py-1 text-right font-mono font-medium">
                        {row.stockAfter.toFixed(0)}
                      </td>

                      {/* Cover after */}
                      <td className={cn('px-1.5 py-1 text-right font-mono font-medium', row.hasSalesData && coverColor(row.coverAfter, row.target))}>
                        {!row.hasSalesData ? '' : row.coverAfter === Infinity ? '∞' : row.coverAfter.toFixed(1)}
                      </td>

                      {/* Target */}
                      <td className="px-0.5 py-0.5">
                        <input
                          type="number"
                          className="h-7 w-full text-xs text-right font-mono px-1 border rounded bg-background"
                          value={skuTargets[row.sku.id] ?? globalTarget}
                          onChange={e => updateSkuTarget(row.sku.id, Number(e.target.value) || 0)}
                          onBlur={e => persistSkuTarget(row.sku.id, Number(e.target.value) || globalTarget)}
                          onFocus={e => e.target.select()}
                          min={0}
                        />
                      </td>
                    </tr>
                  );
                })}

                {displayRows.length === 0 && (
                  <tr>
                    <td colSpan={12} className="py-12 text-center text-muted-foreground">
                      No active SM SKUs found. Add SM SKUs in SKU Master first.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-6 text-[10px] text-muted-foreground px-1">
          <span className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-success" /> On target</span>
          <span className="flex items-center gap-1"><AlertTriangle className="w-3 h-3 text-warning" /> Below target</span>
          <span className="flex items-center gap-1"><AlertCircle className="w-3 h-3 text-destructive" /> Critical</span>
          <span>Forecast = last 7 days Sales Entry × Menu BOM usage</span>
        </div>
      </div>
    </TooltipProvider>
  );
}
