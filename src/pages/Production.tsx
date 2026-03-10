import { useState, useMemo, useRef, useEffect } from 'react';
import { SKU } from '@/types/sku';
import { BOMHeader, BOMLine } from '@/types/bom';
import { ProductionPlan, ProductionRecord, PlanStatus, EMPTY_PRODUCTION_RECORD } from '@/types/production';
import { StockBalance } from '@/types/stock';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Plus, Trash2, Calendar, Factory, CheckCircle2, Clock, PlayCircle, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/hooks/use-language';
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
}

const STATUS_CONFIG: Record<PlanStatus, { icon: React.ReactNode; color: string }> = {
  'Planned': { icon: <Clock className="w-3 h-3" />, color: 'bg-muted text-muted-foreground' },
  'In Progress': { icon: <PlayCircle className="w-3 h-3" />, color: 'bg-primary/10 text-primary' },
  'Done': { icon: <CheckCircle2 className="w-3 h-3" />, color: 'bg-success/10 text-success' },
};

// Inline absolute-positioned dropdown to avoid Dialog pointer-event interference
function SmSkuSelector({
  value,
  onValueChange,
  skus: skuList,
  bomHeaders: bomH,
}: {
  value: string;
  onValueChange: (id: string) => void;
  skus: SKU[];
  bomHeaders: BOMHeader[];
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = skuList.find(s => s.id === value);

  const filtered = useMemo(() => {
    if (!search) return skuList;
    const q = search.toLowerCase();
    return skuList.filter(s =>
      s.skuId.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)
    );
  }, [skuList, search]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (
        triggerRef.current && !triggerRef.current.contains(target) &&
        dropdownRef.current && !dropdownRef.current.contains(target)
      ) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => { setOpen(!open); setSearch(''); }}
        className="flex items-center justify-between w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background hover:bg-accent/50 transition-colors"
      >
        <span className={cn('truncate', !selected && 'text-muted-foreground')}>
          {selected ? `${selected.skuId} — ${selected.name}` : 'Select SM SKU'}
        </span>
        <svg className="ml-2 h-4 w-4 shrink-0 opacity-50" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/></svg>
      </button>

      {open && (
        <div
          ref={dropdownRef}
          className="absolute left-0 right-0 rounded-md border bg-popover shadow-md z-50 mt-1"
          style={{ pointerEvents: 'auto' }}
          onMouseDown={e => e.stopPropagation()}
        >
          <div className="p-1.5">
            <Input
              ref={inputRef}
              placeholder="Search SM SKU..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-8 text-xs"
              onMouseDown={e => e.stopPropagation()}
            />
          </div>
          <div className="max-h-[220px] overflow-y-auto p-1" style={{ pointerEvents: 'auto' }}>
            {filtered.length === 0 && (
              <p className="py-4 text-center text-xs text-muted-foreground">No SKUs found</p>
            )}
            {filtered.map(s => {
              const hasBom = bomH.some(h => h.smSkuId === s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => { onValueChange(s.id); setOpen(false); setSearch(''); }}
                  className={cn(
                    'flex items-center w-full rounded-sm px-2 py-1.5 text-xs hover:bg-accent cursor-pointer',
                    value === s.id && 'bg-accent'
                  )}
                >
                  <span className="truncate">
                    <span className="font-mono mr-1">{s.skuId}</span> — {s.name}
                    {!hasBom && <span className="text-warning ml-1">⚠ No BOM</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ProductionPage({ productionData, skus, bomHeaders, stockBalances, bomLines }: ProductionPageProps) {
  const {
    plans, addPlan, updatePlan, deletePlan,
    addRecord, deleteRecord, getRecordsForPlan, getTotalProducedForPlan, getOutputPerBatch,
  } = productionData;
  const { t } = useLanguage();

  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [planForm, setPlanForm] = useState({ smSkuId: '', targetQtyKg: 0, status: 'Planned' as PlanStatus, weekDate: new Date().toISOString().slice(0, 10) });
  const [recordModalOpen, setRecordModalOpen] = useState(false);
  const [recordForm, setRecordForm] = useState(EMPTY_PRODUCTION_RECORD);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string; type: 'plan' | 'record' } | null>(null);
  const [stockWarning, setStockWarning] = useState<{ data: typeof recordForm; shortages: { name: string; need: number; have: number }[] } | null>(null);

  const smSkus = useMemo(() => skus.filter(s => s.type === 'SM'), [skus]);
  const smSkusWithBOM = useMemo(() => smSkus.filter(s => bomHeaders.some(h => h.smSkuId === s.id)), [smSkus, bomHeaders]);
  const smSkusAll = smSkus; // For showing warning about missing BOM
  const getSkuName = (id: string) => skus.find(s => s.id === id)?.name ?? '—';
  const getSkuCode = (id: string) => skus.find(s => s.id === id)?.skuId ?? '';

  const selectedPlan = plans.find(p => p.id === selectedPlanId) ?? null;
  const selectedRecords = selectedPlanId ? getRecordsForPlan(selectedPlanId) : [];

  const weekGroups = useMemo(() => {
    const groups: Record<string, { weekNumber: number; startDate: string; endDate: string; plans: ProductionPlan[] }> = {};
    plans.forEach(p => {
      const key = `${p.weekNumber}-${p.weekStartDate}`;
      if (!groups[key]) {
        groups[key] = { weekNumber: p.weekNumber, startDate: p.weekStartDate, endDate: p.weekEndDate, plans: [] };
      }
      groups[key].plans.push(p);
    });
    return Object.values(groups).sort((a, b) => b.startDate.localeCompare(a.startDate));
  }, [plans]);

  const currentWeekPlans = useMemo(() => {
    const now = new Date().toISOString().slice(0, 10);
    return plans.filter(p => p.weekStartDate <= now && p.weekEndDate >= now);
  }, [plans]);

  const totalPlanned = currentWeekPlans.length;
  const totalDone = currentWeekPlans.filter(p => p.status === 'Done').length;

  const handleOpenAddPlan = () => {
    setEditingPlanId(null);
    setPlanForm({ smSkuId: '', targetQtyKg: 0, status: 'Planned', weekDate: new Date().toISOString().slice(0, 10) });
    setPlanModalOpen(true);
  };

  const handleOpenEditPlan = (plan: ProductionPlan) => {
    setEditingPlanId(plan.id);
    setPlanForm({ smSkuId: plan.smSkuId, targetQtyKg: plan.targetQtyKg, status: plan.status, weekDate: plan.weekStartDate });
    setPlanModalOpen(true);
  };

  const handleSavePlan = () => {
    if (!planForm.smSkuId) { toast.error('Select an SM SKU'); return; }
    if (planForm.targetQtyKg <= 0) { toast.error('Enter target quantity'); return; }

    // Check if BOM exists
    const hasBom = bomHeaders.some(h => h.smSkuId === planForm.smSkuId);
    if (!hasBom) {
      toast.warning('⚠ No BOM found for this SKU — RM stock cannot be deducted when recording production');
    }

    if (editingPlanId) {
      updatePlan(editingPlanId, planForm);
      toast.success('Plan updated');
    } else {
      const result = addPlan(planForm);
      if (result instanceof Promise) {
        result.then(id => setSelectedPlanId(id));
      } else {
        setSelectedPlanId(result);
      }
      toast.success('Plan added');
    }
    setPlanModalOpen(false);
  };

  const handleDeletePlanRequest = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const plan = plans.find(p => p.id === id);
    setDeleteConfirm({ id, name: plan ? getSkuName(plan.smSkuId) : 'this plan', type: 'plan' });
  };

  const handleDeleteRecordRequest = (id: string) => {
    setDeleteConfirm({ id, name: 'this production record', type: 'record' });
  };

  const handleDeleteConfirm = () => {
    if (!deleteConfirm) return;
    if (deleteConfirm.type === 'plan') {
      deletePlan(deleteConfirm.id);
      if (selectedPlanId === deleteConfirm.id) setSelectedPlanId(null);
      toast.success('Plan deleted');
    } else {
      deleteRecord(deleteConfirm.id);
      toast.success('Record deleted');
    }
    setDeleteConfirm(null);
  };

  const handleOpenAddRecord = () => {
    if (!selectedPlanId) return;
    setRecordForm({ ...EMPTY_PRODUCTION_RECORD, planId: selectedPlanId });
    setRecordModalOpen(true);
  };

  // Check RM stock before saving production record
  const checkStockAndSave = () => {
    if (recordForm.batchesProduced <= 0) { toast.error('Enter batches produced'); return; }
    if (recordForm.actualOutputG <= 0) { toast.error('Enter actual output'); return; }

    if (!selectedPlan) return;

    // Check for stock shortages
    const bomHeader = bomHeaders.find(h => h.smSkuId === selectedPlan.smSkuId);
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
        setStockWarning({ data: recordForm, shortages });
        return;
      }
    }

    saveRecord();
  };

  const saveRecord = () => {
    addRecord(recordForm);
    toast.success('Production recorded — RM stock deducted');
    setRecordModalOpen(false);
    setStockWarning(null);
  };

  const formatDateRange = (start: string, end: string) => {
    const s = new Date(start);
    const e = new Date(end);
    const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `${fmt(s)}–${fmt(e)}`;
  };

  const previewBatches = planForm.smSkuId ? (() => {
    const outputPerBatch = getOutputPerBatch(planForm.smSkuId);
    return outputPerBatch > 0 ? Math.ceil((planForm.targetQtyKg * 1000) / outputPerBatch) : 0;
  })() : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-heading font-bold">{t('title.production')}</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Plan and record SM production runs</p>
        </div>
        <Button onClick={handleOpenAddPlan}>
          <Plus className="w-4 h-4" /> {t('btn.newPlan')}
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="rounded-lg border bg-card p-5">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('summary.thisWeekPlans')}</p>
          <p className="text-3xl font-heading font-bold mt-1">{totalPlanned}</p>
        </div>
        <div className="rounded-lg border bg-card p-5">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('status.completed')}</p>
          <p className="text-3xl font-heading font-bold mt-1 text-success">{totalDone}</p>
        </div>
        <div className="rounded-lg border bg-card p-5">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('summary.totalPlans')}</p>
          <p className="text-3xl font-heading font-bold mt-1">{plans.length}</p>
        </div>
        <div className="rounded-lg border bg-card p-5">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('summary.smWithBom')}</p>
          <p className="text-3xl font-heading font-bold mt-1">{smSkusWithBOM.length}</p>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-4 space-y-3">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Calendar className="w-4 h-4" /> Production Plans
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {weekGroups.length === 0 ? (
                <div className="px-4 pb-4 text-center">
                  <Factory className="w-8 h-8 mx-auto mb-2 opacity-40 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">No plans yet. Click "New Plan" to start scheduling production.</p>
                </div>
              ) : (
                <div className="divide-y">
                  {weekGroups.map(week => (
                    <div key={`${week.weekNumber}-${week.startDate}`}>
                      <div className="px-4 py-2 bg-muted/30">
                        <p className="text-xs font-semibold text-muted-foreground">
                          Week {week.weekNumber}: {formatDateRange(week.startDate, week.endDate)}
                        </p>
                      </div>
                      {week.plans.map(plan => {
                        const isSelected = selectedPlanId === plan.id;
                        const produced = getTotalProducedForPlan(plan.id);
                        const statusCfg = STATUS_CONFIG[plan.status];
                        const hasBom = bomHeaders.some(h => h.smSkuId === plan.smSkuId);
                        return (
                          <div
                            key={plan.id}
                            className={`px-4 py-3 cursor-pointer transition-colors hover:bg-muted/50 ${isSelected ? 'bg-primary/5 border-l-2 border-primary' : ''}`}
                            onClick={() => setSelectedPlanId(plan.id)}
                          >
                            <div className="flex items-center justify-between">
                              <div className="min-w-0">
                                <p className="text-sm font-medium truncate">{getSkuName(plan.smSkuId)}</p>
                                <p className="text-xs text-muted-foreground">{getSkuCode(plan.smSkuId)} · {plan.targetQtyKg}kg target · {plan.numBatches} batches</p>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                {!hasBom && <span title="No BOM"><AlertTriangle className="w-3.5 h-3.5 text-warning" /></span>}
                                <Badge variant="outline" className={`text-xs gap-1 ${statusCfg.color}`}>
                                  {statusCfg.icon}
                                  {plan.status}
                                </Badge>
                                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={e => handleDeletePlanRequest(plan.id, e)}>
                                  <Trash2 className="w-3.5 h-3.5 text-destructive" />
                                </Button>
                              </div>
                            </div>
                            {produced > 0 && (
                              <p className="text-xs text-muted-foreground mt-1">
                                Produced: {produced.toFixed(1)}kg / {plan.targetQtyKg}kg ({((produced / plan.targetQtyKg) * 100).toFixed(0)}%)
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="col-span-8 space-y-4">
          {selectedPlan ? (
            <>
              <Card>
                <CardContent className="pt-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-heading font-bold text-lg">{getSkuName(selectedPlan.smSkuId)}</h3>
                      <p className="text-xs text-muted-foreground">
                        {getSkuCode(selectedPlan.smSkuId)} · Week {selectedPlan.weekNumber} · {formatDateRange(selectedPlan.weekStartDate, selectedPlan.weekEndDate)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Select
                        value={selectedPlan.status}
                        onValueChange={v => updatePlan(selectedPlan.id, { status: v as PlanStatus })}
                      >
                        <SelectTrigger className="w-[140px] h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Planned">Planned</SelectItem>
                          <SelectItem value="In Progress">In Progress</SelectItem>
                          <SelectItem value="Done">Done</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button size="sm" variant="outline" onClick={() => handleOpenEditPlan(selectedPlan)}>
                        Edit Plan
                      </Button>
                    </div>
                  </div>

                  {!bomHeaders.some(h => h.smSkuId === selectedPlan.smSkuId) && (
                    <div className="mt-3 rounded-lg border border-warning/50 bg-warning/5 p-3 flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                      <p className="text-sm text-warning">No BOM found for this SKU — RM stock cannot be deducted when recording production.</p>
                    </div>
                  )}

                  <div className="grid grid-cols-4 gap-4 mt-4">
                    <div className="text-center p-3 rounded-lg bg-muted/50">
                      <p className="text-xs text-muted-foreground">Target</p>
                      <p className="text-lg font-bold">{selectedPlan.targetQtyKg} kg</p>
                    </div>
                    <div className="text-center p-3 rounded-lg bg-muted/50">
                      <p className="text-xs text-muted-foreground">Batches</p>
                      <p className="text-lg font-bold">{selectedPlan.numBatches}</p>
                    </div>
                    <div className="text-center p-3 rounded-lg bg-muted/50">
                      <p className="text-xs text-muted-foreground">Produced</p>
                      <p className="text-lg font-bold">{getTotalProducedForPlan(selectedPlan.id).toFixed(1)} kg</p>
                    </div>
                    <div className="text-center p-3 rounded-lg bg-primary/10">
                      <p className="text-xs text-muted-foreground">Progress</p>
                      <p className="text-lg font-bold text-primary">
                        {selectedPlan.targetQtyKg > 0
                          ? ((getTotalProducedForPlan(selectedPlan.id) / selectedPlan.targetQtyKg) * 100).toFixed(0)
                          : 0}%
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <Factory className="w-4 h-4" /> Production Records ({selectedRecords.length})
                    </CardTitle>
                    <Button size="sm" onClick={handleOpenAddRecord}>
                      <Plus className="w-3.5 h-3.5" /> Record Production
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Date</TableHead>
                        <TableHead className="text-xs">SM SKU</TableHead>
                        <TableHead className="text-xs text-right">Batches</TableHead>
                        <TableHead className="text-xs text-right">Output (kg)</TableHead>
                        <TableHead className="text-xs w-10"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {selectedRecords.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                            <Factory className="w-6 h-6 mx-auto mb-2 opacity-40" />
                            No records yet. Click "Record Production" to log a batch.
                          </TableCell>
                        </TableRow>
                      ) : (
                        selectedRecords.map(rec => (
                          <TableRow key={rec.id}>
                            <TableCell className="text-xs">{rec.productionDate}</TableCell>
                            <TableCell className="text-xs">{getSkuName(rec.smSkuId)}</TableCell>
                            <TableCell className="text-xs text-right">{rec.batchesProduced}</TableCell>
                            <TableCell className="text-xs text-right font-medium">{rec.actualOutputG.toFixed(1)}</TableCell>
                            <TableCell>
                              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleDeleteRecordRequest(rec.id)}>
                                <Trash2 className="w-3.5 h-3.5 text-destructive" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </>
          ) : (
            <Card>
              <CardContent className="py-16 text-center text-muted-foreground">
                <Factory className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">Select a production plan from the left panel to view and record production.</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Plan Modal */}
      <Dialog open={planModalOpen} onOpenChange={setPlanModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingPlanId ? 'Edit Production Plan' : 'New Production Plan'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Week (select any date in the week)</label>
              <Input type="date" value={planForm.weekDate} onChange={e => setPlanForm(f => ({ ...f, weekDate: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">SM SKU</label>
              <SmSkuSelector
                value={planForm.smSkuId}
                onValueChange={v => setPlanForm(f => ({ ...f, smSkuId: v }))}
                skus={smSkusAll}
                bomHeaders={bomHeaders}
              />
              {planForm.smSkuId && !bomHeaders.some(h => h.smSkuId === planForm.smSkuId) && (
                <p className="text-xs text-warning mt-1 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> No BOM found — RM stock cannot be deducted
                </p>
              )}
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Target Quantity (kg)</label>
              <Input type="number" step="0.1" value={planForm.targetQtyKg || ''} onChange={e => setPlanForm(f => ({ ...f, targetQtyKg: Number(e.target.value) }))} />
            </div>
            {planForm.smSkuId && planForm.targetQtyKg > 0 && (
              <div className="rounded-lg bg-muted/50 p-3 text-sm">
                <p>Output per batch: <span className="font-semibold">{(getOutputPerBatch(planForm.smSkuId) / 1000).toFixed(2)} kg</span></p>
                <p>Batches needed: <span className="font-semibold">{previewBatches}</span></p>
              </div>
            )}
            <div>
              <label className="text-xs font-medium text-muted-foreground">Status</label>
              <Select value={planForm.status} onValueChange={v => setPlanForm(f => ({ ...f, status: v as PlanStatus }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Planned">Planned</SelectItem>
                  <SelectItem value="In Progress">In Progress</SelectItem>
                  <SelectItem value="Done">Done</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPlanModalOpen(false)}>Cancel</Button>
            <Button onClick={handleSavePlan}>{editingPlanId ? 'Update' : 'Create'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Record Modal */}
      <Dialog open={recordModalOpen} onOpenChange={setRecordModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record Production</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground">SM SKU</label>
              <div className="h-10 flex items-center px-3 rounded-md border bg-muted/50 text-sm">
                {selectedPlan ? `${getSkuCode(selectedPlan.smSkuId)} — ${getSkuName(selectedPlan.smSkuId)}` : '—'}
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
              <label className="text-xs font-medium text-muted-foreground">Actual Output (g)</label>
              <Input type="number" step="0.1" value={recordForm.actualOutputG || ''} onChange={e => setRecordForm(f => ({ ...f, actualOutputG: Number(e.target.value) }))} />
            </div>
            {selectedPlan && recordForm.batchesProduced > 0 && (
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
            <Button onClick={checkStockAndSave}>Save & Deduct Stock</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!deleteConfirm}
        onOpenChange={open => !open && setDeleteConfirm(null)}
        title={deleteConfirm?.type === 'plan' ? 'Delete Production Plan' : 'Delete Production Record'}
        description={`Are you sure you want to delete "${deleteConfirm?.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={handleDeleteConfirm}
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
        onConfirm={saveRecord}
      />
    </div>
  );
}
