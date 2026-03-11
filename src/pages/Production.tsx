import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { SKU } from '@/types/sku';
import { BOMStep } from '@/types/bom';
import { BomByproduct } from '@/types/byproduct';
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
import { ChevronLeft, ChevronRight, Save, ChevronDown, Trash2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/hooks/use-language';
import { useAuth } from '@/hooks/use-auth';
import { useNavigate } from 'react-router-dom';

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
  bomByproducts: BomByproduct[];
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

function getWorkingDaysLeftInWeek(): number {
  const today = new Date();
  const day = today.getDay(); // 0=Sun, 1=Mon...5=Fri
  if (day === 0 || day === 6) return 5; // weekend → next week has 5
  return 6 - day; // Mon=5, Tue=4, Wed=3, Thu=2, Fri=1
}

interface PlanRow {
  sku: SKU;
  hasBom: boolean;
  forecastWeek: number;
  indirectDemand: number;
  indirectParentCount: number;
  stockNow: number;
  gap: number;
  plannedBatches: number;
  outputPerBatch: number;
  planG: number;
  stockAfter: number;
  target: number;
  statusColor: 'red' | 'amber' | 'green';
  afterStatusColor: 'red' | 'amber' | 'green';
  producedG: number;
}

export default function ProductionPage({
  productionData, skus, bomHeaders, stockBalances, bomLines, bomSteps, smStockBalances, menuBomLines, menus, bomByproducts,
}: ProductionPageProps) {
  const { addRecord, deleteRecord, getOutputPerBatch, records } = productionData;
  const { t } = useLanguage();
  const { isManagement } = useAuth();
  const navigate = useNavigate();

  const [weekStart, setWeekStart] = useState(getSmartWeekStart);
  const [globalTarget, setGlobalTarget] = useState(7);
  const [planBatches, setPlanBatches] = useState<Record<string, number>>({});
  const [skuTargets, setSkuTargets] = useState<Record<string, number>>({});
  const [salesData, setSalesData] = useState<{ menuCode: string; qty: number }[]>([]);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<'planning' | 'execution'>('planning');
  const [planLocked, setPlanLocked] = useState(false);
  const [savedWeek, setSavedWeek] = useState<number | null>(null);

  // Record modal state
  const [recordModalOpen, setRecordModalOpen] = useState(false);
  const [recordSkuId, setRecordSkuId] = useState<string | null>(null);
  const [recordForm, setRecordForm] = useState({ productionDate: new Date().toISOString().slice(0, 10), actualOutputG: 0, notes: '' });

  // Delete confirmation & stock warning & critical warning
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);
  const [stockWarning, setStockWarning] = useState<{ shortages: { name: string; need: number; have: number }[] } | null>(null);
  const [criticalWarning, setCriticalWarning] = useState<number | null>(null);

  // History & No BOM collapsibles
  const [historyOpen, setHistoryOpen] = useState(false);
  const [noBomOpen, setNoBomOpen] = useState(false);

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
    setPlanLocked(false);
    setSavedWeek(null);
    supabase.from('weekly_plan_lines' as any).select('*').eq('week_start', weekStart)
      .then(({ data }: any) => {
        const map: Record<string, number> = {};
        if (data && data.length > 0) {
          (data as any[]).forEach(r => { map[r.sku_id] = Number(r.planned_batches); });
          setPlanLocked(true);
          setSavedWeek(getISOWeekNumber(weekStart));
        }
        setPlanBatches(map);
      });
  }, [weekStart]);

  // Direct forecast from menu_bom
  const directForecast = useMemo(() => {
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

  // Indirect forecast: SM used as ingredient in other SM BOMs
  const { totalForecast, indirectDemandMap, indirectParentMap } = useMemo(() => {
    const smSkuIds = new Set(smSkus.map(s => s.id));
    const parentChildMap = new Map<string, { childSmId: string; qtyPerBatch: number }[]>();
    const childParentCount: Record<string, number> = {};

    bomHeaders.forEach(header => {
      if (!smSkuIds.has(header.smSkuId)) return;
      const lines = bomLines.filter(l => l.bomHeaderId === header.id);
      lines.forEach(line => {
        if (smSkuIds.has(line.rmSkuId)) {
          const existing = parentChildMap.get(header.smSkuId) || [];
          existing.push({ childSmId: line.rmSkuId, qtyPerBatch: line.qtyPerBatch });
          parentChildMap.set(header.smSkuId, existing);
          childParentCount[line.rmSkuId] = (childParentCount[line.rmSkuId] || 0) + 1;
        }
      });
    });

    const indirect: Record<string, number> = {};
    const visited = new Set<string>();

    const computeIndirect = (parentId: string, parentWeeklyForecast: number, depth: number) => {
      if (depth > 3 || visited.has(parentId)) return;
      visited.add(parentId);
      const children = parentChildMap.get(parentId) || [];
      const outputPerBatch = getOutputPerBatch(parentId);
      if (outputPerBatch <= 0) { visited.delete(parentId); return; }
      const batchesNeeded = parentWeeklyForecast / outputPerBatch;
      children.forEach(({ childSmId, qtyPerBatch }) => {
        const childDemand = batchesNeeded * qtyPerBatch;
        indirect[childSmId] = (indirect[childSmId] || 0) + childDemand;
        computeIndirect(childSmId, childDemand, depth + 1);
      });
      visited.delete(parentId);
    };

    smSkus.forEach(sku => {
      const direct = directForecast[sku.id] || 0;
      if (direct > 0) computeIndirect(sku.id, direct, 0);
    });

    const total: Record<string, number> = {};
    smSkus.forEach(sku => {
      total[sku.id] = (directForecast[sku.id] || 0) + (indirect[sku.id] || 0);
    });

    return { totalForecast: total, indirectDemandMap: indirect, indirectParentMap: childParentCount };
  }, [directForecast, smSkus, bomHeaders, bomLines, getOutputPerBatch]);

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

  // Build rows — sorted by SKU code ascending, always
  const rows = useMemo((): PlanRow[] => {
    return smSkus
      .map(sku => {
        const hasBom = bomHeaders.some(h => h.smSkuId === sku.id);
        const forecastWeek = totalForecast[sku.id] || 0;
        const indirectDemand = indirectDemandMap[sku.id] || 0;
        const indirectParentCount = indirectParentMap[sku.id] || 0;
        const perDay = forecastWeek / 7;
        const stockNow = smStockBalances.find(b => b.skuId === sku.id)?.currentStock ?? 0;
        const gap = forecastWeek - stockNow;
        const plannedBatches = planBatches[sku.id] || 0;
        const outputPerBatch = getOutputPerBatch(sku.id);
        const planG = plannedBatches * outputPerBatch;
        const stockAfter = stockNow + planG;
        const target = skuTargets[sku.id] ?? globalTarget;
        const targetNeed = perDay * target;
        const producedG = weekRecordsBySku[sku.id] || 0;

        // Current status: stock now vs target days of need
        let statusColor: 'red' | 'amber' | 'green' = 'green';
        if (perDay > 0) {
          if (stockNow < targetNeed * 0.5) statusColor = 'red';
          else if (stockNow < targetNeed) statusColor = 'amber';
        }

        // After status
        let afterStatusColor: 'red' | 'amber' | 'green' = 'green';
        if (perDay > 0) {
          if (stockAfter < targetNeed * 0.5) afterStatusColor = 'red';
          else if (stockAfter < targetNeed) afterStatusColor = 'amber';
        }

        return { sku, hasBom, forecastWeek, indirectDemand, indirectParentCount, stockNow, gap, plannedBatches, outputPerBatch, planG, stockAfter, target, statusColor, afterStatusColor, producedG };
      })
      .sort((a, b) => a.sku.skuId.localeCompare(b.sku.skuId));
  }, [smSkus, bomHeaders, totalForecast, indirectDemandMap, indirectParentMap, smStockBalances, planBatches, skuTargets, globalTarget, getOutputPerBatch, weekRecordsBySku]);

  const bomRows = useMemo(() => rows.filter(r => r.hasBom), [rows]);
  const noBomRows = useMemo(() => rows.filter(r => !r.hasBom), [rows]);
  const execRows = useMemo(() => bomRows.filter(r => r.plannedBatches > 0), [bomRows]);

  // Navigate weeks
  const prevWeek = () => { const d = new Date(weekStart); d.setDate(d.getDate() - 7); setWeekStart(d.toISOString().slice(0, 10)); };
  const nextWeek = () => { const d = new Date(weekStart); d.setDate(d.getDate() + 7); setWeekStart(d.toISOString().slice(0, 10)); };

  // Plan batches change (defaultValue + onBlur)
  const handlePlanChange = useCallback((skuId: string, val: string) => {
    setPlanBatches(prev => ({ ...prev, [skuId]: Number(val) || 0 }));
  }, []);

  // Tab key moves down plan column
  const handlePlanKeyDown = (e: React.KeyboardEvent, skuId: string) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const idx = bomRows.findIndex(r => r.sku.id === skuId);
      const next = e.shiftKey ? idx - 1 : idx + 1;
      if (next >= 0 && next < bomRows.length) {
        planInputRefs.current[bomRows[next].sku.id]?.focus();
      }
    }
  };

  // Save global target
  const saveGlobalTarget = async (value: number) => {
    setGlobalTarget(value);
    await supabase.from('global_settings' as any).update({ value: String(value) } as any).eq('key', 'cover_days_target');
  };

  // Save plan
  const doSavePlan = async () => {
    setSaving(true);
    const planRows = smSkus.filter(s => (planBatches[s.id] || 0) > 0).map(s => ({
      week_start: weekStart, sku_id: s.id, planned_batches: planBatches[s.id] || 0,
    }));
    await supabase.from('weekly_plan_lines' as any).delete().eq('week_start', weekStart);
    if (planRows.length > 0) {
      const { error } = await supabase.from('weekly_plan_lines' as any).insert(planRows as any);
      if (error) { toast.error('Failed to save: ' + error.message); setSaving(false); return; }
    }
    setPlanLocked(true);
    setSavedWeek(weekNumber);
    toast.success(t('prod.planSaved') + ' ' + weekNumber + ' ' + t('prod.planSavedSuffix'));
    setSaving(false);
  };

  const handleSavePlan = () => {
    // Check critical rows with no plan
    const criticalCount = bomRows.filter(r => r.statusColor === 'red' && r.plannedBatches === 0).length;
    if (criticalCount > 0) {
      setCriticalWarning(criticalCount);
      return;
    }
    doSavePlan();
  };

  const unlockPlan = () => {
    setPlanLocked(false);
    setSavedWeek(null);
  };

  // Open record modal
  const openRecordModal = (skuId: string) => {
    const row = rows.find(r => r.sku.id === skuId);
    const remaining = row ? Math.max(0, row.planG - row.producedG) : 0;
    setRecordSkuId(skuId);
    setRecordForm({
      productionDate: new Date().toISOString().slice(0, 10),
      actualOutputG: remaining,
      notes: '',
    });
    setRecordModalOpen(true);
  };

  // Save record
  const checkStockAndSaveRecord = () => {
    if (!recordSkuId) return;
    if (recordForm.actualOutputG <= 0) { toast.error('Enter actual output'); return; }

    const bomHeader = bomHeaders.find(h => h.smSkuId === recordSkuId);
    if (bomHeader) {
      const lines = bomLines.filter(l => l.bomHeaderId === bomHeader.id);
      const outputPerBatch = getOutputPerBatch(recordSkuId);
      const batchesNeeded = outputPerBatch > 0 ? Math.ceil(recordForm.actualOutputG / outputPerBatch) : 0;
      const shortages: { name: string; need: number; have: number }[] = [];
      lines.forEach(line => {
        const deductQty = line.qtyPerBatch * batchesNeeded;
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

    const outputPerBatch = getOutputPerBatch(recordSkuId);
    const batchesProduced = outputPerBatch > 0 ? Math.ceil(recordForm.actualOutputG / outputPerBatch) : 0;

    await addRecord({
      ...EMPTY_PRODUCTION_RECORD,
      planId,
      productionDate: recordForm.productionDate,
      batchesProduced,
      actualOutputG: recordForm.actualOutputG,
    });
    toast.success('Production recorded');
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

  const formatDate = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const getSkuName = (id: string) => skus.find(s => s.id === id)?.name ?? '—';
  const getSkuCode = (id: string) => skus.find(s => s.id === id)?.skuId ?? '';
  const getSkuUom = (id: string) => skus.find(s => s.id === id)?.usageUom ?? 'g';

  const recordSku = recordSkuId ? skus.find(s => s.id === recordSkuId) : null;
  const recordRow = recordSkuId ? rows.find(r => r.sku.id === recordSkuId) : null;

  const statusDot = (color: 'red' | 'amber' | 'green') => (
    <span className={cn(
      'inline-block w-3 h-3 rounded-full',
      color === 'red' && 'bg-destructive',
      color === 'amber' && 'bg-warning',
      color === 'green' && 'bg-success',
    )} />
  );

  return (
    <TooltipProvider>
      <div className="space-y-3">
        {/* ═══ PAGE HEADER ═══ */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          {/* Left: title */}
          <div>
            <h2 className="text-xl font-heading font-bold">{t('prod.title')}</h2>
            <p className="text-xs text-muted-foreground">{t('prod.subtitle')}</p>
          </div>

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

          {/* Right: target + mode toggle + save */}
          <div className="flex items-center gap-3">
            {/* Target Cover Days */}
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-muted-foreground whitespace-nowrap">{t('prod.targetCoverDays')}</label>
              <input
                type="number"
                className="h-7 w-14 text-xs text-right font-mono px-1.5 border rounded-md bg-background"
                defaultValue={globalTarget}
                key={`gt-${globalTarget}`}
                onBlur={e => saveGlobalTarget(Number(e.target.value) || 7)}
                onFocus={e => e.target.select()}
              />
            </div>

            {/* Mode toggle */}
            <div className="flex rounded-md overflow-hidden border">
              <button
                className={cn(
                  'px-3 py-1.5 text-xs font-medium transition-colors',
                  mode === 'planning' ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'
                )}
                onClick={() => setMode('planning')}
              >
                {t('prod.modePlanning')}
              </button>
              <button
                className={cn(
                  'px-3 py-1.5 text-xs font-medium transition-colors',
                  mode === 'execution' ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'
                )}
                onClick={() => setMode('execution')}
              >
                {t('prod.modeExecution')}
              </button>
            </div>

            {/* Save plan (planning mode only) */}
            {mode === 'planning' && !planLocked && (
              <Button onClick={handleSavePlan} disabled={saving} size="sm" className="h-8">
                <Save className="w-3.5 h-3.5 mr-1" />
                {saving ? t('prod.saving') : t('prod.savePlan')}
              </Button>
            )}
            {mode === 'planning' && planLocked && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-success font-medium whitespace-nowrap">
                  {t('prod.planSaved')} {savedWeek} {t('prod.planSavedSuffix')}
                </span>
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={unlockPlan}>
                  {t('prod.editPlan')}
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* ═══ PLANNING MODE ═══ */}
        {mode === 'planning' && (
          <>
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full table-fixed text-xs">
                <colgroup>
                  <col style={{ width: '40px' }} />
                  <col style={{ width: '80px' }} />
                  <col style={{ width: '160px' }} />
                  <col style={{ width: '90px' }} />
                  <col style={{ width: '90px' }} />
                  <col style={{ width: '90px' }} />
                  <col style={{ width: '100px' }} />
                  <col style={{ width: '90px' }} />
                  <col style={{ width: '90px' }} />
                  <col style={{ width: '80px' }} />
                  <col style={{ width: '80px' }} />
                </colgroup>
                <thead className="sticky top-0 z-[5]">
                  <tr className="bg-muted/50 border-b">
                    <th className="px-1 py-2 text-center text-[10px] text-muted-foreground">{t('prod.colStatus')}</th>
                    <th className="px-1.5 py-2 text-left text-[10px]">{t('prod.colCode')}</th>
                    <th className="px-1.5 py-2 text-left text-[10px]">{t('prod.colName')}</th>
                    <th className="px-1.5 py-2 text-right text-[10px]">{t('prod.colNeedWk')}</th>
                    <th className="px-1.5 py-2 text-right text-[10px]">{t('prod.colStockNow')}</th>
                    <th className="px-1.5 py-2 text-right text-[10px]">{t('prod.colGap')}</th>
                    <th className="px-1.5 py-2 text-center text-[10px] bg-primary/10 border-x border-primary/20 font-bold text-primary">{t('prod.colPlanBatch')}</th>
                    <th className="px-1.5 py-2 text-right text-[10px]">{t('prod.colPlanG')}</th>
                    <th className="px-1.5 py-2 text-right text-[10px]">{t('prod.colAfter')}</th>
                    <th className="px-1.5 py-2 text-center text-[10px]">{t('prod.colAfterStatus')}</th>
                    <th className="px-1.5 py-2 text-right text-[10px] text-muted-foreground">{t('prod.colBatchSize')}</th>
                  </tr>
                </thead>
                <tbody>
                  {bomRows.map((row) => {
                    const uom = row.sku.usageUom || 'g';
                    const overstocked = row.gap < 0;
                    const hasPlannedBatches = row.plannedBatches > 0;

                    return (
                      <tr
                        key={row.sku.id}
                        className={cn(
                          'border-b hover:bg-muted/30 transition-colors',
                          overstocked && 'opacity-60',
                          hasPlannedBatches && 'border-l-4 border-l-primary',
                        )}
                      >
                        {/* STATUS dot */}
                        <td className="px-1 py-1 text-center">{statusDot(row.statusColor)}</td>

                        {/* CODE */}
                        <td className="px-1.5 py-1 font-mono truncate text-[11px]">{row.sku.skuId}</td>

                        {/* NAME */}
                        <td className="px-1.5 py-1 truncate">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="truncate block">{row.sku.name}</span>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-xs"><p>{row.sku.name}</p></TooltipContent>
                          </Tooltip>
                        </td>

                        {/* NEED/WK */}
                        <td className="px-1.5 py-1 text-right font-mono">
                          {row.forecastWeek > 0
                            ? <>{row.forecastWeek.toFixed(0)} <span className="text-muted-foreground text-[10px]">{uom}</span></>
                            : <span className="text-muted-foreground">—</span>
                          }
                        </td>

                        {/* STOCK NOW */}
                        <td className="px-1.5 py-1 text-right font-mono">
                          {row.stockNow.toFixed(0)} <span className="text-muted-foreground text-[10px]">{uom}</span>
                        </td>

                        {/* GAP */}
                        <td className={cn('px-1.5 py-1 text-right font-mono', row.gap > 0 ? 'text-destructive font-bold' : 'text-success')}>
                          {row.gap > 0
                            ? <>{row.gap.toFixed(0)} <span className="text-[10px]">{uom}</span></>
                            : <span className="text-muted-foreground text-[10px]">{t('prod.sufficient')}</span>
                          }
                        </td>

                        {/* PLAN (batches) - PRIMARY INPUT */}
                        <td className="px-0.5 py-0.5 bg-background border-x border-primary/10">
                          {planLocked ? (
                            <div className="h-8 flex items-center justify-center font-semibold font-mono text-sm">
                              {row.plannedBatches || '—'}
                            </div>
                          ) : (
                            <input
                              ref={el => { planInputRefs.current[row.sku.id] = el; }}
                              type="number"
                              className="h-8 w-full text-sm text-center font-semibold font-mono border-2 border-primary/30 rounded bg-background focus:border-primary focus:ring-1 focus:ring-primary/50 outline-none"
                              defaultValue={row.plannedBatches ?? 0}
                              key={`${row.sku.id}-${weekStart}-${planLocked}`}
                              onBlur={e => handlePlanChange(row.sku.id, e.target.value)}
                              onFocus={e => e.target.select()}
                              onKeyDown={e => handlePlanKeyDown(e, row.sku.id)}
                              min={0}
                            />
                          )}
                        </td>

                        {/* PLAN (g) */}
                        <td className="px-1.5 py-1 text-right font-mono text-muted-foreground">
                          {row.outputPerBatch > 0
                            ? (row.planG > 0 ? <>{row.planG.toFixed(0)} <span className="text-[10px]">{uom}</span></> : '—')
                            : '—'
                          }
                        </td>

                        {/* AFTER */}
                        <td className="px-1.5 py-1 text-right font-mono font-medium">
                          {row.stockAfter.toFixed(0)} <span className="text-muted-foreground text-[10px]">{uom}</span>
                        </td>

                        {/* AFTER STATUS */}
                        <td className="px-1 py-1 text-center text-base">
                          {row.afterStatusColor === 'green' ? '✅' : row.afterStatusColor === 'amber' ? '⚠️' : '🔴'}
                        </td>

                        {/* BATCH SIZE */}
                        <td className="px-1.5 py-1 text-right font-mono text-muted-foreground text-[10px]">
                          {row.outputPerBatch > 0 ? <>{row.outputPerBatch.toFixed(0)}</> : '—'}
                        </td>
                      </tr>
                    );
                  })}

                  {bomRows.length === 0 && (
                    <tr>
                      <td colSpan={11} className="py-12 text-center text-muted-foreground">
                        No active SM SKUs with BOM found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* No BOM section */}
            {noBomRows.length > 0 && (
              <Collapsible open={noBomOpen} onOpenChange={setNoBomOpen}>
                <CollapsibleTrigger asChild>
                  <button className="flex items-center gap-2 text-sm font-medium text-warning hover:text-foreground transition-colors w-full py-2">
                    <ChevronDown className={cn('w-4 h-4 transition-transform', noBomOpen && 'rotate-180')} />
                    ⚠️ {noBomRows.length} {t('prod.noBomItems')}
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full table-fixed text-xs">
                      <colgroup>
                        <col style={{ width: '100px' }} />
                        <col style={{ width: '250px' }} />
                        <col style={{ width: '120px' }} />
                      </colgroup>
                      <thead>
                        <tr className="bg-muted/50 border-b">
                          <th className="px-2 py-1.5 text-left text-[10px]">{t('prod.colCode')}</th>
                          <th className="px-2 py-1.5 text-left text-[10px]">{t('prod.colName')}</th>
                          <th className="px-2 py-1.5 text-left text-[10px]"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {noBomRows.map(row => (
                          <tr key={row.sku.id} className="border-b hover:bg-muted/30">
                            <td className="px-2 py-1.5 font-mono">{row.sku.skuId}</td>
                            <td className="px-2 py-1.5 truncate">{row.sku.name}</td>
                            <td className="px-2 py-1.5">
                              <Button
                                variant="link"
                                size="sm"
                                className="h-6 px-0 text-xs text-primary"
                                onClick={() => navigate('/bom')}
                              >
                                {t('prod.setupBom')}
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}
          </>
        )}

        {/* ═══ EXECUTION MODE ═══ */}
        {mode === 'execution' && (
          <>
            {execRows.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <p className="text-muted-foreground mb-4">{t('prod.noPlanYet')}</p>
                <Button variant="outline" onClick={() => setMode('planning')}>
                  {t('prod.switchToPlanning')}
                </Button>
              </div>
            ) : (
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full table-fixed text-xs">
                  <colgroup>
                    <col style={{ width: '40px' }} />
                    <col style={{ width: '80px' }} />
                    <col style={{ width: '160px' }} />
                    <col style={{ width: '90px' }} />
                    <col style={{ width: '90px' }} />
                    <col style={{ width: '100px' }} />
                    <col style={{ width: '90px' }} />
                    <col style={{ width: '100px' }} />
                  </colgroup>
                  <thead className="sticky top-0 z-[5]">
                    <tr className="bg-muted/50 border-b">
                      <th className="px-1 py-2 text-center text-[10px] text-muted-foreground">{t('prod.colStatus')}</th>
                      <th className="px-1.5 py-2 text-left text-[10px]">{t('prod.colCode')}</th>
                      <th className="px-1.5 py-2 text-left text-[10px]">{t('prod.colName')}</th>
                      <th className="px-1.5 py-2 text-right text-[10px]">{t('prod.colPlanG_exec')}</th>
                      <th className="px-1.5 py-2 text-right text-[10px]">{t('prod.colProduced')}</th>
                      <th className="px-1.5 py-2 text-right text-[10px]">{t('prod.colRemaining')}</th>
                      <th className="px-1.5 py-2 text-right text-[10px] text-muted-foreground">{t('prod.colPace')}</th>
                      <th className="px-1 py-2 text-center text-[10px]">{t('prod.colActions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {execRows.map(row => {
                      const uom = row.sku.usageUom || 'g';
                      const remaining = row.planG - row.producedG;
                      const done = remaining <= 0;
                      const partial = row.producedG > 0 && !done;
                      const notStarted = row.producedG === 0;
                      const daysLeft = getWorkingDaysLeftInWeek();
                      const pace = !done && daysLeft > 0 ? remaining / daysLeft : 0;

                      return (
                        <tr key={row.sku.id} className="border-b hover:bg-muted/30 transition-colors">
                          {/* STATUS */}
                          <td className="px-1 py-1 text-center text-base">
                            {done ? '✅' : partial ? '🔄' : '⭕'}
                          </td>

                          {/* CODE */}
                          <td className="px-1.5 py-1 font-mono truncate text-[11px]">{row.sku.skuId}</td>

                          {/* NAME */}
                          <td className="px-1.5 py-1 truncate">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="truncate block">{row.sku.name}</span>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-xs"><p>{row.sku.name}</p></TooltipContent>
                            </Tooltip>
                          </td>

                          {/* PLAN (g) */}
                          <td className="px-1.5 py-1 text-right font-mono">
                            {row.planG.toFixed(0)} <span className="text-muted-foreground text-[10px]">{uom}</span>
                          </td>

                          {/* PRODUCED (g) */}
                          <td className="px-1.5 py-1 text-right font-mono">
                            {row.producedG > 0 ? <>{row.producedG.toFixed(0)} <span className="text-muted-foreground text-[10px]">{uom}</span></> : '—'}
                          </td>

                          {/* REMAINING */}
                          <td className={cn('px-1.5 py-1 text-right font-mono font-bold', done ? 'text-success' : 'text-destructive')}>
                            {done
                              ? t('prod.done')
                              : <>{remaining.toFixed(0)} <span className="text-[10px]">{uom}</span></>
                            }
                          </td>

                          {/* PACE */}
                          <td className="px-1.5 py-1 text-right font-mono text-muted-foreground text-[10px]">
                            {!done && pace > 0 ? <>{pace.toFixed(0)}{uom}{t('prod.perDay')}</> : '—'}
                          </td>

                          {/* ACTIONS */}
                          <td className="px-1 py-1 text-center">
                            <Button
                              size="sm"
                              className="h-7 px-3 text-[11px]"
                              onClick={() => openRecordModal(row.sku.id)}
                            >
                              ▶ {t('prod.record')}
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* PRODUCTION HISTORY */}
            <Collapsible open={historyOpen} onOpenChange={setHistoryOpen}>
              <CollapsibleTrigger asChild>
                <button className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors w-full py-2">
                  <ChevronDown className={cn('w-4 h-4 transition-transform', historyOpen && 'rotate-180')} />
                  {t('prod.historyTitle')} {weekNumber}
                  <Badge variant="outline" className="text-[10px] ml-1">{weekRecords.length}</Badge>
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                {weekRecords.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-4 text-center">—</p>
                ) : (
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full table-fixed text-xs">
                      <colgroup>
                        <col style={{ width: '100px' }} />
                        <col style={{ width: '100px' }} />
                        <col style={{ width: '200px' }} />
                        <col style={{ width: '120px' }} />
                        <col style={{ width: '50px' }} />
                      </colgroup>
                      <thead>
                        <tr className="bg-muted/50 border-b">
                          <th className="px-2 py-1.5 text-left">{t('prod.dateLabel')}</th>
                          <th className="px-2 py-1.5 text-left">{t('prod.colCode')}</th>
                          <th className="px-2 py-1.5 text-left">{t('prod.colName')}</th>
                          <th className="px-2 py-1.5 text-right">{t('prod.colProduced')}</th>
                          <th className="px-2 py-1.5"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {weekRecords.map(rec => (
                          <tr key={rec.id} className="border-b hover:bg-muted/30">
                            <td className="px-2 py-1.5">{rec.productionDate}</td>
                            <td className="px-2 py-1.5 font-mono">{getSkuCode(rec.smSkuId)}</td>
                            <td className="px-2 py-1.5 truncate">{getSkuName(rec.smSkuId)}</td>
                            <td className="px-2 py-1.5 text-right font-mono">
                              {rec.actualOutputG.toFixed(0)} <span className="text-muted-foreground">{getSkuUom(rec.smSkuId)}</span>
                            </td>
                            <td className="px-1 py-1.5 text-center">
                              {isManagement && (
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-6 w-6"
                                  onClick={() => setDeleteConfirm({ id: rec.id, name: `${getSkuCode(rec.smSkuId)} on ${rec.productionDate}` })}
                                >
                                  <Trash2 className="w-3 h-3 text-destructive" />
                                </Button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CollapsibleContent>
            </Collapsible>
          </>
        )}
      </div>

      {/* ═══ RECORD MODAL ═══ */}
      <Dialog open={recordModalOpen} onOpenChange={setRecordModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('prod.recordTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground">SM SKU</label>
              <div className="h-10 flex items-center px-3 rounded-md border bg-muted/50 text-sm">
                {recordSku ? `${recordSku.skuId} — ${recordSku.name}` : '—'}
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t('prod.dateLabel')}</label>
              <Input type="date" value={recordForm.productionDate} onChange={e => setRecordForm(f => ({ ...f, productionDate: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t('prod.actualOutputLabel')}</label>
              <Input
                type="number"
                step="1"
                value={recordForm.actualOutputG || ''}
                onChange={e => setRecordForm(f => ({ ...f, actualOutputG: Number(e.target.value) }))}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t('prod.notesLabel')}</label>
              <Input value={recordForm.notes} onChange={e => setRecordForm(f => ({ ...f, notes: e.target.value }))} />
            </div>

            {/* Running total */}
            {recordRow && (
              <div className="rounded-lg bg-muted/50 border p-3 text-sm">
                <p className="font-medium">
                  {t('prod.runningTotal')} {recordRow.producedG.toFixed(0)}g {t('prod.of')} {recordRow.planG.toFixed(0)}g
                  ({recordRow.planG > 0 ? ((recordRow.producedG / recordRow.planG) * 100).toFixed(0) : 0}%)
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRecordModalOpen(false)}>{t('btn.cancel')}</Button>
            <Button onClick={checkStockAndSaveRecord}>{t('prod.record')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Critical warning dialog */}
      <ConfirmDialog
        open={criticalWarning !== null}
        onOpenChange={open => !open && setCriticalWarning(null)}
        title={t('prod.criticalWarningTitle')}
        description={`${criticalWarning} ${t('prod.criticalWarningMsg')}`}
        confirmLabel={t('prod.continueBtn')}
        cancelLabel={t('btn.cancel')}
        variant="warning"
        onConfirm={() => { setCriticalWarning(null); doSavePlan(); }}
      />

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!deleteConfirm}
        onOpenChange={open => !open && setDeleteConfirm(null)}
        title={t('prod.deleteRecord')}
        description={`${t('prod.deleteConfirm')} "${deleteConfirm?.name}"?`}
        confirmLabel={t('btn.delete')}
        onConfirm={handleDeleteRecordConfirm}
      />

      {/* Negative stock warning */}
      <ConfirmDialog
        open={!!stockWarning}
        onOpenChange={open => !open && setStockWarning(null)}
        title={t('prod.stockWarningTitle')}
        description={stockWarning?.shortages.map(s => `${s.name} (need ${s.need.toFixed(0)}, have ${s.have.toFixed(0)})`).join(', ') || ''}
        confirmLabel={t('prod.proceedAnyway')}
        cancelLabel={t('btn.cancel')}
        variant="warning"
        onConfirm={doSaveRecord}
      />
    </TooltipProvider>
  );
}
