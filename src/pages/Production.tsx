import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { SKU } from '@/types/sku';
import { BOMStep } from '@/types/bom';
import { BOMHeader, BOMLine } from '@/types/bom';
import { ProductionPlan, ProductionRecord, PlanStatus, EMPTY_PRODUCTION_RECORD } from '@/types/production';
import { StockBalance } from '@/types/stock';
import { SMStockBalance } from '@/hooks/use-sm-stock-data';
import { MenuBomLine } from '@/types/menu-bom';
import { Menu } from '@/types/menu';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { SortableHeader } from '@/components/SortableHeader';
import { useSortableTable } from '@/hooks/use-sortable-table';
import { ChevronLeft, ChevronRight, Save, CheckCircle2, AlertTriangle, AlertCircle, Play, ChevronDown, Trash2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface ProductionPageProps {
  productionData: {
    plans: ProductionPlan[];
    records: ProductionRecord[];
    addPlan: (data: { smSkuId: string; targetQtyKg: number; status: PlanStatus; weekDate: string }) => string | Promise<string>;
    updatePlan: (id: string, data: Partial<{ smSkuId: string; targetQtyKg: number; status: PlanStatus; weekDate: string }>) => void | Promise<void>;
    deletePlan: (id: string) => void | Promise<void>;
    addRecord: (data: Omit<ProductionRecord, 'id' | 'smSkuId'>) => string | undefined | Promise<string | undefined>;
    deleteRecord: (id: string) => void | Promise<void>;
    getRecordsForPlan: (planId: string) => ProductionRecord[];
    getTotalProducedForPlan: (planId: string) => number;
    getOutputPerBatch: (smSkuId: string) => number;
  };
  skus: SKU[];
  bomHeaders: BOMHeader[];
  stockBalances: StockBalance[];
  bomLines: BOMLine[];
  bomSteps: BOMStep[];
  smStockBalances: SMStockBalance[];
  menuBomLines: MenuBomLine[];
  menus: Menu[];
}

function getSmartWeekStart(): string {
  const today = new Date();
  const day = today.getDay();
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

function getWeekEndDate(weekStart: string): string {
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
  indirectDemand: number;
  indirectParentCount: number;
  perDay: number;
  hasSalesData: boolean;
  stockNow: number;
  coverNow: number;
  plannedBatches: number;
  outputPerBatch: number;
  planG: number;
  stockAfter: number;
  coverAfter: number;
  target: number;
  status: 'green' | 'amber' | 'red';
  producedG: number;
  progress: number;
}

export default function ProductionPage({
  productionData, skus, bomHeaders, stockBalances, bomLines, smStockBalances, menuBomLines, menus,
}: ProductionPageProps) {
  const { addRecord, deleteRecord, getOutputPerBatch, records } = productionData;

  const [weekStart, setWeekStart] = useState(getSmartWeekStart);
  const [globalTarget, setGlobalTarget] = useState(7);
  const [planBatches, setPlanBatches] = useState<Record<string, number>>({});
  const [skuTargets, setSkuTargets] = useState<Record<string, number>>({});
  const [salesData, setSalesData] = useState<{ menuCode: string; qty: number }[]>([]);
  const [saving, setSaving] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Record modal state
  const [recordModalOpen, setRecordModalOpen] = useState(false);
  const [recordSkuId, setRecordSkuId] = useState<string | null>(null);
  const [recordForm, setRecordForm] = useState({ productionDate: new Date().toISOString().slice(0, 10), batchesProduced: 0, actualOutputG: 0, notes: '' });

  // Delete confirmation
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);
  // Stock warning
  const [stockWarning, setStockWarning] = useState<{ shortages: { name: string; need: number; have: number }[] } | null>(null);

  const planInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const smSkus = useMemo(() => skus.filter(s => s.type === 'SM' && s.status === 'Active'), [skus]);
  const weekEnd = getWeekEndDate(weekStart);
  const weekNumber = getISOWeekNumber(weekStart);

  // Fetch global settings
  useEffect(() => {
    supabase.from('global_settings' as any).select('*').eq('key', 'cover_days_target').single()
      .then(({ data }: any) => { if (data) setGlobalTarget(Number(data.value) || 7); });
  }, []);

  // Fetch per-SKU targets
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
        if (data) (data as any[]).forEach(r => { map[r.sku_id] = Number(r.planned_batches); });
        setPlanBatches(map);
      });
  }, [weekStart]);

  // Forecast
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

  // Production records for selected week per SKU
  const weekRecordsBySku = useMemo(() => {
    const map: Record<string, number> = {};
    records.forEach(r => {
      if (r.productionDate >= weekStart && r.productionDate <= weekEnd) {
        map[r.smSkuId] = (map[r.smSkuId] || 0) + r.actualOutputG;
      }
    });
    return map;
  }, [records, weekStart, weekEnd]);

  // Week history records
  const weekRecords = useMemo(() => {
    return records
      .filter(r => r.productionDate >= weekStart && r.productionDate <= weekEnd)
      .sort((a, b) => b.productionDate.localeCompare(a.productionDate));
  }, [records, weekStart, weekEnd]);

  // Build rows
  const rows = useMemo((): PlanRow[] => {
    return smSkus.map(sku => {
      const hasBom = bomHeaders.some(h => h.smSkuId === sku.id);
      const forecastWeek = forecast[sku.id] || 0;
      const perDay = forecastWeek / 7;
      const hasSalesData = forecastWeek > 0;
      const stockNow = smStockBalances.find(b => b.skuId === sku.id)?.currentStock ?? 0;
      const coverNow = perDay > 0 ? stockNow / perDay : Infinity;
      const plannedBatches = planBatches[sku.id] || 0;
      const outputPerBatch = getOutputPerBatch(sku.id);
      const planG = plannedBatches * outputPerBatch;
      const stockAfter = stockNow + planG;
      const coverAfter = perDay > 0 ? stockAfter / perDay : Infinity;
      const target = skuTargets[sku.id] ?? globalTarget;
      const producedG = weekRecordsBySku[sku.id] || 0;
      const progress = planG > 0 ? (producedG / planG) * 100 : 0;

      let status: 'green' | 'amber' | 'red' = 'green';
      if (plannedBatches > 0 && progress >= 100) {
        status = 'green';
      } else if (plannedBatches > 0 && progress < 100) {
        status = coverAfter >= target ? 'green' : 'amber';
      } else {
        // plan = 0, coverage only
        if (stockAfter <= 0) status = 'red';
        else if (coverAfter < target) status = coverAfter <= 0 ? 'red' : 'amber';
      }

      return { sku, hasBom, forecastWeek, perDay, hasSalesData, stockNow, coverNow, plannedBatches, outputPerBatch, planG, stockAfter, coverAfter, target, status, producedG, progress };
    });
  }, [smSkus, bomHeaders, forecast, smStockBalances, planBatches, skuTargets, globalTarget, getOutputPerBatch, weekRecordsBySku]);

  // Sort comparators
  const comparators = useMemo(() => ({
    status: (a: PlanRow, b: PlanRow) => { const o = { red: 0, amber: 1, green: 2 }; return o[a.status] - o[b.status]; },
    code: (a: PlanRow, b: PlanRow) => a.sku.skuId.localeCompare(b.sku.skuId),
    name: (a: PlanRow, b: PlanRow) => a.sku.name.localeCompare(b.sku.name),
    forecast: (a: PlanRow, b: PlanRow) => a.forecastWeek - b.forecastWeek,
    perDay: (a: PlanRow, b: PlanRow) => a.perDay - b.perDay,
    stockNow: (a: PlanRow, b: PlanRow) => a.stockNow - b.stockNow,
    coverNow: (a: PlanRow, b: PlanRow) => a.coverNow - b.coverNow,
    batches: (a: PlanRow, b: PlanRow) => a.plannedBatches - b.plannedBatches,
    planG: (a: PlanRow, b: PlanRow) => a.planG - b.planG,
    stockAfter: (a: PlanRow, b: PlanRow) => a.stockAfter - b.stockAfter,
    coverAfter: (a: PlanRow, b: PlanRow) => a.coverAfter - b.coverAfter,
    produced: (a: PlanRow, b: PlanRow) => a.producedG - b.producedG,
    progress: (a: PlanRow, b: PlanRow) => a.progress - b.progress,
    target: (a: PlanRow, b: PlanRow) => a.target - b.target,
  }), []);

  const { sorted, sortKey, sortDir, handleSort } = useSortableTable(rows, comparators);

  // Custom default sort
  const displayRows = useMemo(() => {
    if (sortKey) return sorted;
    return [...rows].sort((a, b) => {
      const aValid = a.hasBom && a.hasSalesData;
      const bValid = b.hasBom && b.hasSalesData;
      if (aValid && !bValid) return -1;
      if (!aValid && bValid) return 1;
      if (!aValid && !bValid) return 0;

      // First: plan > 0 and 0% < progress < 100% (in-progress)
      const aInProg = a.plannedBatches > 0 && a.progress > 0 && a.progress < 100;
      const bInProg = b.plannedBatches > 0 && b.progress > 0 && b.progress < 100;
      if (aInProg && !bInProg) return -1;
      if (!aInProg && bInProg) return 1;

      // Then: plan > 0 and progress = 0%
      const aNotStarted = a.plannedBatches > 0 && a.progress === 0;
      const bNotStarted = b.plannedBatches > 0 && b.progress === 0;
      if (aNotStarted && !bNotStarted) return -1;
      if (!aNotStarted && bNotStarted) return 1;

      // Then: plan = 0, by cover days ascending
      if (a.coverAfter === Infinity && b.coverAfter === Infinity) return 0;
      if (a.coverAfter === Infinity) return 1;
      if (b.coverAfter === Infinity) return -1;
      return a.coverAfter - b.coverAfter;
    });
  }, [rows, sorted, sortKey]);

  // Navigate weeks
  const prevWeek = () => { const d = new Date(weekStart); d.setDate(d.getDate() - 7); setWeekStart(d.toISOString().slice(0, 10)); };
  const nextWeek = () => { const d = new Date(weekStart); d.setDate(d.getDate() + 7); setWeekStart(d.toISOString().slice(0, 10)); };

  // Plan batches change (defaultValue + onBlur)
  const handlePlanChange = useCallback((skuId: string, val: string) => {
    setPlanBatches(prev => ({ ...prev, [skuId]: Number(val) || 0 }));
  }, []);

  // Target change
  const handleTargetBlur = useCallback(async (skuId: string, val: string) => {
    const num = Number(val) || globalTarget;
    setSkuTargets(prev => ({ ...prev, [skuId]: num }));
    await supabase.from('skus').update({ cover_days_target: num } as any).eq('id', skuId);
  }, [globalTarget]);

  // Save global target
  const saveGlobalTarget = async (value: number) => {
    setGlobalTarget(value);
    await supabase.from('global_settings' as any).update({ value: String(value) } as any).eq('key', 'cover_days_target');
  };

  // Save plan
  const savePlan = async () => {
    setSaving(true);
    const planRows = smSkus.filter(s => (planBatches[s.id] || 0) > 0).map(s => ({
      week_start: weekStart, sku_id: s.id, planned_batches: planBatches[s.id] || 0,
    }));
    await supabase.from('weekly_plan_lines' as any).delete().eq('week_start', weekStart);
    if (planRows.length > 0) {
      const { error } = await supabase.from('weekly_plan_lines' as any).insert(planRows as any);
      if (error) { toast.error('Failed to save: ' + error.message); setSaving(false); return; }
    }
    toast.success('Plan saved');
    setSaving(false);
  };

  // Tab key moves down plan column
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

  // Open record modal
  const openRecordModal = (skuId: string) => {
    const row = rows.find(r => r.sku.id === skuId);
    setRecordSkuId(skuId);
    setRecordForm({
      productionDate: new Date().toISOString().slice(0, 10),
      batchesProduced: 0,
      actualOutputG: row?.planG ?? 0,
      notes: '',
    });
    setRecordModalOpen(true);
  };

  // Save record — find or create a production_plan for this SKU/week, then add record
  const checkStockAndSaveRecord = () => {
    if (!recordSkuId) return;
    if (recordForm.batchesProduced <= 0) { toast.error('Enter batches produced'); return; }
    if (recordForm.actualOutputG <= 0) { toast.error('Enter actual output'); return; }

    const bomHeader = bomHeaders.find(h => h.smSkuId === recordSkuId);
    if (bomHeader) {
      const lines = bomLines.filter(l => l.bomHeaderId === bomHeader.id);
      const shortages: { name: string; need: number; have: number }[] = [];
      lines.forEach(line => {
        const deductQty = line.qtyPerBatch * recordForm.batchesProduced;
        const balance = stockBalances.find(b => b.skuId === line.rmSkuId);
        const currentStock = balance?.currentStock ?? 0;
        if (currentStock - deductQty < 0) {
          const sku = skus.find(s => s.id === line.rmSkuId);
          shortages.push({ name: sku?.name || line.rmSkuId, need: deductQty, have: currentStock });
        }
      });
      if (shortages.length > 0) {
        setStockWarning({ shortages });
        return;
      }
    }
    doSaveRecord();
  };

  const doSaveRecord = async () => {
    if (!recordSkuId) return;

    // Find existing production_plan for this SKU+week, or create one
    let plan = productionData.plans.find(p => p.smSkuId === recordSkuId && p.weekStartDate === weekStart);
    let planId = plan?.id;

    if (!planId) {
      const result = await productionData.addPlan({
        smSkuId: recordSkuId,
        targetQtyKg: 0,
        status: 'In Progress',
        weekDate: weekStart,
      });
      planId = typeof result === 'string' ? result : '';
    }
    if (!planId) { toast.error('Failed to create plan'); return; }

    await addRecord({
      ...EMPTY_PRODUCTION_RECORD,
      planId,
      productionDate: recordForm.productionDate,
      batchesProduced: recordForm.batchesProduced,
      actualOutputG: recordForm.actualOutputG,
    });
    toast.success('Production recorded — RM stock deducted');
    setRecordModalOpen(false);
    setStockWarning(null);
  };

  // Delete record
  const handleDeleteRecordConfirm = () => {
    if (!deleteConfirm) return;
    deleteRecord(deleteConfirm.id);
    toast.success('Record deleted');
    setDeleteConfirm(null);
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

  const getSkuName = (id: string) => skus.find(s => s.id === id)?.name ?? '—';
  const getSkuCode = (id: string) => skus.find(s => s.id === id)?.skuId ?? '';
  const getSkuUom = (id: string) => skus.find(s => s.id === id)?.usageUom ?? 'g';

  const recordSku = recordSkuId ? skus.find(s => s.id === recordSkuId) : null;

  return (
    <TooltipProvider>
      <div className="space-y-3">
        {/* HEADER ROW */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          {/* Left: title */}
          <h2 className="text-xl font-heading font-bold whitespace-nowrap">Production</h2>

          {/* Center: week selector */}
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

          {/* Right: target + badge + save */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-muted-foreground whitespace-nowrap">Target</label>
              <input
                type="number"
                className="h-7 w-14 text-xs text-right font-mono px-1.5 border rounded-md bg-background"
                defaultValue={globalTarget}
                key={`gt-${globalTarget}`}
                onBlur={e => saveGlobalTarget(Number(e.target.value) || 7)}
                onFocus={e => e.target.select()}
              />
            </div>

            <div className={cn(
              'text-xs font-medium px-2.5 py-1 rounded-full whitespace-nowrap',
              allOnTarget ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'
            )}>
              {onTargetCount}/{totalValidCount} on target
            </div>

            <Button onClick={savePlan} disabled={saving} size="sm" className="h-8">
              <Save className="w-3.5 h-3.5 mr-1" />
              {saving ? 'Saving...' : 'Save Plan'}
            </Button>
          </div>
        </div>

        {/* MAIN TABLE */}
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full table-fixed text-xs">
            <colgroup>
              <col style={{ width: '40px' }} />
              <col style={{ width: '90px' }} />
              <col style={{ width: '160px' }} />
              <col style={{ width: '100px' }} />
              <col style={{ width: '70px' }} />
              <col style={{ width: '90px' }} />
              <col style={{ width: '80px' }} />
              <col style={{ width: '100px' }} />
              <col style={{ width: '90px' }} />
              <col style={{ width: '90px' }} />
              <col style={{ width: '90px' }} />
              <col style={{ width: '90px' }} />
              <col style={{ width: '110px' }} />
              <col style={{ width: '70px' }} />
              <col style={{ width: '80px' }} />
            </colgroup>
            <thead className="sticky top-0 z-[5]">
              <tr className="bg-muted/50 border-b">
                <th className="px-1 py-2 text-center text-muted-foreground text-[10px]">#</th>
                <th className="px-1.5 py-2 text-left">
                  <SortableHeader label="Code" sortKey="code" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                </th>
                <th className="px-1.5 py-2 text-left">
                  <SortableHeader label="Name" sortKey="name" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                </th>
                <th className="px-1.5 py-2 text-right">
                  <SortableHeader label="Forecast/wk" sortKey="forecast" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                </th>
                <th className="px-1.5 py-2 text-right">
                  <SortableHeader label="/Day" sortKey="perDay" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                </th>
                <th className="px-1.5 py-2 text-right">
                  <SortableHeader label="Stock Now" sortKey="stockNow" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                </th>
                <th className="px-1.5 py-2 text-right">
                  <SortableHeader label="Cover" sortKey="coverNow" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                </th>
                <th className="px-1.5 py-2 text-center bg-primary/10 border-x border-primary/20">
                  <span className="font-bold text-primary">Plan</span>
                </th>
                <th className="px-1.5 py-2 text-right">
                  <SortableHeader label="Plan (g)" sortKey="planG" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                </th>
                <th className="px-1.5 py-2 text-right">
                  <SortableHeader label="After" sortKey="stockAfter" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                </th>
                <th className="px-1.5 py-2 text-right">
                  <SortableHeader label="Cover↑" sortKey="coverAfter" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                </th>
                <th className="px-1.5 py-2 text-right">
                  <SortableHeader label="Produced" sortKey="produced" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                </th>
                <th className="px-1.5 py-2 text-center">
                  <SortableHeader label="Progress" sortKey="progress" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                </th>
                <th className="px-1.5 py-2 text-right">
                  <SortableHeader label="Target" sortKey="target" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                </th>
                <th className="px-1 py-2 text-center text-muted-foreground text-[10px]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {displayRows.map((row) => {
                const muted = !row.hasBom || !row.hasSalesData;
                const uom = row.sku.usageUom || 'g';
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
                        <TooltipContent side="top" className="max-w-xs"><p>{row.sku.name}</p></TooltipContent>
                      </Tooltip>
                    </td>

                    {/* Forecast/wk */}
                    <td className="px-1.5 py-1 text-right font-mono">
                      {!row.hasBom
                        ? <span className="text-muted-foreground italic">No BOM</span>
                        : !row.hasSalesData
                          ? <span className="text-muted-foreground italic">No data</span>
                          : <>{row.forecastWeek.toFixed(0)} <span className="text-muted-foreground text-xs">{uom}</span></>}
                    </td>

                    {/* /Day */}
                    <td className="px-1.5 py-1 text-right font-mono text-muted-foreground text-[10px]">
                      {row.hasBom && row.hasSalesData ? <>{row.perDay.toFixed(0)} <span className="text-xs">{uom}</span></> : ''}
                    </td>

                    {/* Stock Now */}
                    <td className="px-1.5 py-1 text-right font-mono">
                      {row.stockNow.toFixed(0)} <span className="text-muted-foreground text-xs">{uom}</span>
                    </td>

                    {/* Cover Now */}
                    <td className={cn('px-1.5 py-1 text-right font-mono', row.hasSalesData && coverColor(row.coverNow, row.target))}>
                      {!row.hasSalesData ? '' : row.coverNow === Infinity ? '∞' : <>{row.coverNow.toFixed(1)} <span className="text-muted-foreground text-xs">days</span></>}
                    </td>

                    {/* Plan batches - EDITABLE */}
                    <td className="px-0.5 py-0.5 bg-background border-x border-primary/10">
                      {!row.hasBom ? (
                        <span className="flex items-center justify-center h-8 text-muted-foreground italic text-[10px]">No BOM</span>
                      ) : (
                        <input
                          ref={el => { planInputRefs.current[row.sku.id] = el; }}
                          type="number"
                          className="h-8 w-full text-sm text-center font-semibold font-mono border-2 border-primary/30 rounded bg-background focus:border-primary focus:ring-1 focus:ring-primary/50 outline-none"
                          defaultValue={row.plannedBatches ?? 0}
                          key={`${row.sku.id}-${weekStart}`}
                          onBlur={e => handlePlanChange(row.sku.id, e.target.value)}
                          onFocus={e => e.target.select()}
                          onKeyDown={e => handlePlanKeyDown(e, row.sku.id)}
                          min={0}
                        />
                      )}
                    </td>

                    {/* Plan (g) */}
                    <td className="px-1.5 py-1 text-right font-mono text-muted-foreground">
                      {row.planG > 0 ? <>{row.planG.toFixed(0)} <span className="text-xs">{uom}</span></> : ''}
                    </td>

                    {/* After */}
                    <td className="px-1.5 py-1 text-right font-mono font-medium">
                      {row.stockAfter.toFixed(0)} <span className="text-muted-foreground text-xs">{uom}</span>
                    </td>

                    {/* Cover After */}
                    <td className={cn('px-1.5 py-1 text-right font-mono font-medium', row.hasSalesData && coverColor(row.coverAfter, row.target))}>
                      {!row.hasSalesData ? '' : row.coverAfter === Infinity ? '∞' : <>{row.coverAfter.toFixed(1)} <span className="text-muted-foreground text-xs">days</span></>}
                    </td>

                    {/* Produced */}
                    <td className="px-1.5 py-1 text-right font-mono">
                      {row.producedG > 0 ? <>{row.producedG.toFixed(0)} <span className="text-muted-foreground text-xs">{uom}</span></> : <span className="text-muted-foreground">—</span>}
                    </td>

                    {/* Progress */}
                    <td className="px-1.5 py-1">
                      {row.planG <= 0 ? (
                        <span className="text-muted-foreground text-center block">—</span>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                            <div
                              className={cn(
                                'h-full rounded-full transition-all',
                                row.progress >= 100 ? 'bg-success' : row.progress > 0 ? 'bg-warning' : 'bg-muted-foreground/30'
                              )}
                              style={{ width: `${Math.min(row.progress, 100)}%` }}
                            />
                          </div>
                          <span className={cn(
                            'text-[10px] font-mono w-8 text-right',
                            row.progress >= 100 ? 'text-success' : row.progress > 0 ? 'text-warning' : 'text-muted-foreground'
                          )}>
                            {row.progress.toFixed(0)}%
                          </span>
                        </div>
                      )}
                    </td>

                    {/* Target */}
                    <td className="px-0.5 py-0.5">
                      <input
                        type="number"
                        className="h-7 w-full text-xs text-right font-mono px-1 border rounded bg-background"
                        defaultValue={skuTargets[row.sku.id] ?? globalTarget}
                        key={`tgt-${row.sku.id}-${globalTarget}`}
                        onBlur={e => handleTargetBlur(row.sku.id, e.target.value)}
                        onFocus={e => e.target.select()}
                        min={0}
                      />
                    </td>

                    {/* Actions */}
                    <td className="px-1 py-1 text-center">
                      {row.hasBom && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-[10px] text-primary hover:text-primary"
                          onClick={() => openRecordModal(row.sku.id)}
                        >
                          <Play className="w-3 h-3 mr-0.5" />
                          บันทึก
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}

              {displayRows.length === 0 && (
                <tr>
                  <td colSpan={15} className="py-12 text-center text-muted-foreground">
                    No active SM SKUs found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-6 text-[10px] text-muted-foreground px-1">
          <span className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-success" /> On target</span>
          <span className="flex items-center gap-1"><AlertTriangle className="w-3 h-3 text-warning" /> Below target</span>
          <span className="flex items-center gap-1"><AlertCircle className="w-3 h-3 text-destructive" /> Critical</span>
          <span>Forecast = last 7 days Sales Entry × Menu BOM</span>
        </div>

        {/* PRODUCTION HISTORY — collapsible */}
        <Collapsible open={historyOpen} onOpenChange={setHistoryOpen}>
          <CollapsibleTrigger asChild>
            <button className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors w-full py-2">
              <ChevronDown className={cn('w-4 h-4 transition-transform', historyOpen && 'rotate-180')} />
              Production History · Week {weekNumber}
              <Badge variant="outline" className="text-[10px] ml-1">{weekRecords.length}</Badge>
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            {weekRecords.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">No production records for this week.</p>
            ) : (
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full table-fixed text-xs">
                  <colgroup>
                    <col style={{ width: '100px' }} />
                    <col style={{ width: '100px' }} />
                    <col style={{ width: '200px' }} />
                    <col style={{ width: '80px' }} />
                    <col style={{ width: '120px' }} />
                    <col style={{ width: '50px' }} />
                  </colgroup>
                  <thead>
                    <tr className="bg-muted/50 border-b">
                      <th className="px-2 py-1.5 text-left">Date</th>
                      <th className="px-2 py-1.5 text-left">SM Code</th>
                      <th className="px-2 py-1.5 text-left">SM Name</th>
                      <th className="px-2 py-1.5 text-right">Batches</th>
                      <th className="px-2 py-1.5 text-right">Output</th>
                      <th className="px-2 py-1.5"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {weekRecords.map(rec => (
                      <tr key={rec.id} className="border-b hover:bg-muted/30">
                        <td className="px-2 py-1.5">{rec.productionDate}</td>
                        <td className="px-2 py-1.5 font-mono">{getSkuCode(rec.smSkuId)}</td>
                        <td className="px-2 py-1.5 truncate">{getSkuName(rec.smSkuId)}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{rec.batchesProduced}</td>
                        <td className="px-2 py-1.5 text-right font-mono">
                          {rec.actualOutputG.toFixed(0)} <span className="text-muted-foreground">{getSkuUom(rec.smSkuId)}</span>
                        </td>
                        <td className="px-1 py-1.5 text-center">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6"
                            onClick={() => setDeleteConfirm({ id: rec.id, name: `${getSkuCode(rec.smSkuId)} on ${rec.productionDate}` })}
                          >
                            <Trash2 className="w-3 h-3 text-destructive" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>
      </div>

      {/* RECORD MODAL */}
      <Dialog open={recordModalOpen} onOpenChange={setRecordModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>บันทึกการผลิต</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground">SM SKU</label>
              <div className="h-10 flex items-center px-3 rounded-md border bg-muted/50 text-sm">
                {recordSku ? `${recordSku.skuId} — ${recordSku.name}` : '—'}
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Production Date</label>
              <Input type="date" value={recordForm.productionDate} onChange={e => setRecordForm(f => ({ ...f, productionDate: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Batches Produced</label>
              <Input type="number" value={recordForm.batchesProduced || ''} onChange={e => setRecordForm(f => ({ ...f, batchesProduced: Number(e.target.value) }))} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Actual Output ({recordSku?.usageUom || 'g'})</label>
              <Input type="number" step="0.1" value={recordForm.actualOutputG || ''} onChange={e => setRecordForm(f => ({ ...f, actualOutputG: Number(e.target.value) }))} />
            </div>
            {recordSkuId && recordForm.batchesProduced > 0 && (
              <div className="rounded-lg bg-destructive/5 border border-destructive/20 p-3 text-sm">
                <p className="font-medium text-destructive">⚠ RM Stock Deduction Preview</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Saving will auto-deduct BOM ingredients × {recordForm.batchesProduced} batches from RM Stock.
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRecordModalOpen(false)}>Cancel</Button>
            <Button onClick={checkStockAndSaveRecord}>Save & Deduct Stock</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!deleteConfirm}
        onOpenChange={open => !open && setDeleteConfirm(null)}
        title="Delete Production Record"
        description={`Are you sure you want to delete "${deleteConfirm?.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={handleDeleteRecordConfirm}
      />

      {/* Negative stock warning */}
      <ConfirmDialog
        open={!!stockWarning}
        onOpenChange={open => !open && setStockWarning(null)}
        title="⚠ Negative Stock Warning"
        description={`This production will cause negative stock for: ${stockWarning?.shortages.map(s => `${s.name} (need ${s.need.toFixed(0)}, have ${s.have.toFixed(0)})`).join(', ')}. Continue anyway?`}
        confirmLabel="Proceed Anyway"
        cancelLabel="Cancel"
        variant="warning"
        onConfirm={doSaveRecord}
      />
    </TooltipProvider>
  );
}
