import { useState, useMemo } from 'react';
import { SKU } from '@/types/sku';
import { Price } from '@/types/price';
import { BOMHeader, BOMLine } from '@/types/bom';
import { ProductionPlan, ProductionRecord, PlanStatus, EMPTY_PRODUCTION_PLAN, EMPTY_PRODUCTION_RECORD } from '@/types/production';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Plus, Trash2, Calendar, Factory, CheckCircle2, Clock, PlayCircle } from 'lucide-react';
import { toast } from 'sonner';

interface ProductionPageProps {
  productionData: {
    plans: ProductionPlan[];
    records: ProductionRecord[];
    addPlan: (data: { smSkuId: string; targetQtyKg: number; status: PlanStatus; weekDate: string }) => string;
    updatePlan: (id: string, data: Partial<{ smSkuId: string; targetQtyKg: number; status: PlanStatus; weekDate: string }>) => void;
    deletePlan: (id: string) => void;
    addRecord: (data: Omit<ProductionRecord, 'id' | 'smSkuId'>) => string | undefined;
    deleteRecord: (id: string) => void;
    getRecordsForPlan: (planId: string) => ProductionRecord[];
    getTotalProducedForPlan: (planId: string) => number;
    getOutputPerBatch: (smSkuId: string) => number;
  };
  skus: SKU[];
  bomHeaders: BOMHeader[];
}

const STATUS_CONFIG: Record<PlanStatus, { icon: React.ReactNode; color: string }> = {
  'Planned': { icon: <Clock className="w-3 h-3" />, color: 'bg-muted text-muted-foreground' },
  'In Progress': { icon: <PlayCircle className="w-3 h-3" />, color: 'bg-primary/10 text-primary' },
  'Done': { icon: <CheckCircle2 className="w-3 h-3" />, color: 'bg-success/10 text-success' },
};

export default function ProductionPage({ productionData, skus, bomHeaders }: ProductionPageProps) {
  const {
    plans, addPlan, updatePlan, deletePlan,
    addRecord, deleteRecord, getRecordsForPlan, getTotalProducedForPlan, getOutputPerBatch,
  } = productionData;

  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [planForm, setPlanForm] = useState({ smSkuId: '', targetQtyKg: 0, status: 'Planned' as PlanStatus, weekDate: new Date().toISOString().slice(0, 10) });
  const [recordModalOpen, setRecordModalOpen] = useState(false);
  const [recordForm, setRecordForm] = useState(EMPTY_PRODUCTION_RECORD);

  const smSkus = useMemo(() => skus.filter(s => s.type === 'SM'), [skus]);
  const smSkusWithBOM = useMemo(() => smSkus.filter(s => bomHeaders.some(h => h.smSkuId === s.id)), [smSkus, bomHeaders]);
  const getSkuName = (id: string) => skus.find(s => s.id === id)?.name ?? '—';
  const getSkuCode = (id: string) => skus.find(s => s.id === id)?.skuId ?? '';

  const selectedPlan = plans.find(p => p.id === selectedPlanId) ?? null;
  const selectedRecords = selectedPlanId ? getRecordsForPlan(selectedPlanId) : [];

  // Group plans by week
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

  // Summary stats
  const currentWeekPlans = useMemo(() => {
    const now = new Date().toISOString().slice(0, 10);
    return plans.filter(p => p.weekStartDate <= now && p.weekEndDate >= now);
  }, [plans]);

  const totalPlanned = currentWeekPlans.length;
  const totalDone = currentWeekPlans.filter(p => p.status === 'Done').length;

  // Plan CRUD
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
    if (editingPlanId) {
      updatePlan(editingPlanId, planForm);
      toast.success('Plan updated');
    } else {
      const newId = addPlan(planForm);
      setSelectedPlanId(newId);
      toast.success('Plan added');
    }
    setPlanModalOpen(false);
  };

  const handleDeletePlan = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    deletePlan(id);
    if (selectedPlanId === id) setSelectedPlanId(null);
    toast.success('Plan deleted');
  };

  // Record CRUD
  const handleOpenAddRecord = () => {
    if (!selectedPlanId) return;
    setRecordForm({ ...EMPTY_PRODUCTION_RECORD, planId: selectedPlanId });
    setRecordModalOpen(true);
  };

  const handleSaveRecord = () => {
    if (recordForm.batchesProduced <= 0) { toast.error('Enter batches produced'); return; }
    if (recordForm.actualOutputKg <= 0) { toast.error('Enter actual output'); return; }
    addRecord(recordForm);
    toast.success('Production recorded — RM stock deducted');
    setRecordModalOpen(false);
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
          <h2 className="text-2xl font-heading font-bold">Production</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Plan and record SM production runs</p>
        </div>
        <Button onClick={handleOpenAddPlan}>
          <Plus className="w-4 h-4" /> New Plan
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="rounded-lg border bg-card p-5">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">This Week Plans</p>
          <p className="text-3xl font-heading font-bold mt-1">{totalPlanned}</p>
        </div>
        <div className="rounded-lg border bg-card p-5">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Completed</p>
          <p className="text-3xl font-heading font-bold mt-1 text-success">{totalDone}</p>
        </div>
        <div className="rounded-lg border bg-card p-5">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Plans</p>
          <p className="text-3xl font-heading font-bold mt-1">{plans.length}</p>
        </div>
        <div className="rounded-lg border bg-card p-5">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">SM with BOM</p>
          <p className="text-3xl font-heading font-bold mt-1">{smSkusWithBOM.length}</p>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6">
        {/* LEFT: Plans by week */}
        <div className="col-span-4 space-y-3">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Calendar className="w-4 h-4" /> Production Plans
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {weekGroups.length === 0 ? (
                <p className="text-sm text-muted-foreground px-4 pb-4">No plans yet. Click "New Plan" to start.</p>
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
                                <Badge variant="outline" className={`text-xs gap-1 ${statusCfg.color}`}>
                                  {statusCfg.icon}
                                  {plan.status}
                                </Badge>
                                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={e => handleDeletePlan(plan.id, e)}>
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

        {/* RIGHT: Production records */}
        <div className="col-span-8 space-y-4">
          {selectedPlan ? (
            <>
              {/* Plan header */}
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

              {/* Records table */}
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
                            No records yet
                          </TableCell>
                        </TableRow>
                      ) : (
                        selectedRecords.map(rec => (
                          <TableRow key={rec.id}>
                            <TableCell className="text-xs">{rec.productionDate}</TableCell>
                            <TableCell className="text-xs">{getSkuName(rec.smSkuId)}</TableCell>
                            <TableCell className="text-xs text-right">{rec.batchesProduced}</TableCell>
                            <TableCell className="text-xs text-right font-medium">{rec.actualOutputKg.toFixed(1)}</TableCell>
                            <TableCell>
                              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { deleteRecord(rec.id); toast.success('Record deleted'); }}>
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
                <p className="text-sm">Select a production plan to view records</p>
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
              <label className="text-xs font-medium text-muted-foreground">SM SKU (must have BOM)</label>
              <Select value={planForm.smSkuId} onValueChange={v => setPlanForm(f => ({ ...f, smSkuId: v }))}>
                <SelectTrigger><SelectValue placeholder="Select SM SKU" /></SelectTrigger>
                <SelectContent>
                  {smSkusWithBOM.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.skuId} — {s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {smSkusWithBOM.length === 0 && (
                <p className="text-xs text-destructive mt-1">No SM SKUs with BOM found. Create a BOM first.</p>
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
              <Input value={selectedPlan ? `${getSkuCode(selectedPlan.smSkuId)} — ${getSkuName(selectedPlan.smSkuId)}` : ''} disabled />
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
              <label className="text-xs font-medium text-muted-foreground">Actual Output (kg)</label>
              <Input type="number" step="0.1" value={recordForm.actualOutputKg || ''} onChange={e => setRecordForm(f => ({ ...f, actualOutputKg: Number(e.target.value) }))} />
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
            <Button onClick={handleSaveRecord}>Save & Deduct Stock</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
