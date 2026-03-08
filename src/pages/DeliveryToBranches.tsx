import { useState, useMemo, useCallback } from 'react';
import { Delivery } from '@/types/delivery';
import { Branch } from '@/types/branch';
import { getWeekNumber } from '@/types/goods-receipt';
import { SKU } from '@/types/sku';
import { useDeliveryData } from '@/hooks/use-delivery-data';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Save, Truck, TrendingUp, Plus, Copy, Check, X, Trash2, Pencil, Search } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  deliveryData: ReturnType<typeof useDeliveryData>;
  skus: SKU[];
  activeBranches: Branch[];
}

interface DraftDeliveryRow {
  tempId: string;
  deliveryDate: string;
  branchName: string;
  smSkuId: string;
  qtyDeliveredKg: number;
  note: string;
  isNew: boolean;
  isEditing: boolean;
  savedDeliveryId?: string;
}

function createEmptyDraft(): DraftDeliveryRow {
  return {
    tempId: crypto.randomUUID(),
    deliveryDate: new Date().toISOString().slice(0, 10),
    branchName: '',
    smSkuId: '',
    qtyDeliveredKg: 0,
    note: '',
    isNew: true,
    isEditing: true,
  };
}

export default function DeliveryToBranchesPage({ deliveryData, skus }: Props) {
  const { deliveries, addDelivery, updateDelivery, deleteDelivery } = deliveryData;
  const [drafts, setDrafts] = useState<DraftDeliveryRow[]>([]);
  const [search, setSearch] = useState('');
  const [filterBranch, setFilterBranch] = useState<string>('all');

  const smSkus = useMemo(() => skus.filter(s => s.type === 'SM'), [skus]);
  const skuMap = useMemo(() => Object.fromEntries(skus.map(s => [s.id, s])), [skus]);

  const currentWeek = getWeekNumber(new Date().toISOString().slice(0, 10));
  const thisWeekDeliveries = useMemo(
    () => deliveries.filter(d => d.weekNumber === currentWeek),
    [deliveries, currentWeek]
  );
  const thisWeekQty = useMemo(
    () => thisWeekDeliveries.reduce((s, d) => s + d.qtyDeliveredKg, 0),
    [thisWeekDeliveries]
  );

  const branches = useMemo(() => {
    const set = new Set(deliveries.map(d => d.branchName).filter(Boolean));
    return Array.from(set).sort();
  }, [deliveries]);

  const editingIds = drafts.filter(d => d.savedDeliveryId).map(d => d.savedDeliveryId!);

  const filteredSaved = useMemo(() => {
    return deliveries
      .filter(d => {
        if (editingIds.includes(d.id)) return false;
        const sku = skuMap[d.smSkuId];
        const matchesSearch =
          (sku?.name || '').toLowerCase().includes(search.toLowerCase()) ||
          (sku?.skuId || '').toLowerCase().includes(search.toLowerCase()) ||
          d.branchName.toLowerCase().includes(search.toLowerCase());
        const matchesBranch = filterBranch === 'all' || d.branchName === filterBranch;
        return matchesSearch && matchesBranch;
      })
      .sort((a, b) => b.deliveryDate.localeCompare(a.deliveryDate));
  }, [deliveries, skuMap, search, filterBranch, editingIds]);

  const handleAddRow = useCallback(() => {
    setDrafts(prev => [...prev, createEmptyDraft()]);
  }, []);

  const handleDuplicateRow = useCallback((index: number) => {
    setDrafts(prev => {
      const source = prev[index];
      const dup: DraftDeliveryRow = { ...source, tempId: crypto.randomUUID(), isNew: true, isEditing: true, savedDeliveryId: undefined };
      const next = [...prev];
      next.splice(index + 1, 0, dup);
      return next;
    });
  }, []);

  const handleUpdateDraft = useCallback((tempId: string, field: keyof DraftDeliveryRow, value: any) => {
    setDrafts(prev => prev.map(d => d.tempId === tempId ? { ...d, [field]: value } : d));
  }, []);

  const handleSaveRow = useCallback((tempId: string) => {
    const draft = drafts.find(d => d.tempId === tempId);
    if (!draft || !draft.smSkuId || !draft.branchName || draft.qtyDeliveredKg <= 0) {
      toast.error('Please fill in Branch, SM SKU, and Qty');
      return;
    }
    const data = {
      deliveryDate: draft.deliveryDate,
      branchName: draft.branchName,
      smSkuId: draft.smSkuId,
      qtyDeliveredKg: draft.qtyDeliveredKg,
      note: draft.note,
    };
    if (draft.isNew) {
      addDelivery(data);
    } else if (draft.savedDeliveryId) {
      updateDelivery(draft.savedDeliveryId, data);
    }
    setDrafts(prev => prev.filter(d => d.tempId !== tempId));
    toast.success('Delivery saved');
  }, [drafts, addDelivery, updateDelivery]);

  const handleCancelRow = useCallback((tempId: string) => {
    setDrafts(prev => prev.filter(d => d.tempId !== tempId));
  }, []);

  const handleEditSaved = useCallback((delivery: Delivery) => {
    if (drafts.some(d => d.savedDeliveryId === delivery.id)) return;
    const draft: DraftDeliveryRow = {
      tempId: crypto.randomUUID(),
      deliveryDate: delivery.deliveryDate,
      branchName: delivery.branchName,
      smSkuId: delivery.smSkuId,
      qtyDeliveredKg: delivery.qtyDeliveredKg,
      note: delivery.note,
      isNew: false,
      isEditing: true,
      savedDeliveryId: delivery.id,
    };
    setDrafts(prev => [...prev, draft]);
  }, [drafts]);

  const handleDeleteSaved = useCallback((id: string) => {
    deleteDelivery(id);
    toast.success('Delivery deleted');
  }, [deleteDelivery]);

  const handleSaveAll = useCallback(() => {
    const valid = drafts.filter(d => d.isEditing && d.smSkuId && d.branchName && d.qtyDeliveredKg > 0);
    if (valid.length === 0) { toast.error('No valid rows to save'); return; }
    valid.forEach(draft => {
      const data = {
        deliveryDate: draft.deliveryDate,
        branchName: draft.branchName,
        smSkuId: draft.smSkuId,
        qtyDeliveredKg: draft.qtyDeliveredKg,
        note: draft.note,
      };
      if (draft.isNew) addDelivery(data);
      else if (draft.savedDeliveryId) updateDelivery(draft.savedDeliveryId, data);
    });
    setDrafts(prev => prev.filter(d => !valid.find(v => v.tempId === d.tempId)));
    toast.success(`${valid.length} delivery(ies) saved`);
  }, [drafts, addDelivery, updateDelivery]);

  const hasUnsaved = drafts.some(d => d.isEditing);

  const thClass = 'text-left px-3 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wider';
  const tdClass = 'px-1.5 py-1';
  const tdReadOnly = 'px-3 py-2.5 text-xs';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-heading font-bold">Delivery to Branches</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Record SM deliveries to branches — auto-deducts from SM Stock</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleAddRow}>+ Add Row</Button>
          {hasUnsaved && (
            <Button onClick={handleSaveAll}>
              <Save className="w-4 h-4" />
              Save All ({drafts.filter(d => d.isEditing).length})
            </Button>
          )}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div className="rounded-lg border bg-card p-5">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Deliveries</p>
          <p className="text-3xl font-heading font-bold mt-1">{deliveries.length}</p>
        </div>
        <div className="rounded-lg border bg-card p-5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">This Week (W{currentWeek})</p>
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-primary/10">
              <Truck className="w-4 h-4 text-primary" />
            </span>
          </div>
          <p className="text-3xl font-heading font-bold mt-1">{thisWeekDeliveries.length}</p>
        </div>
        <div className="rounded-lg border bg-card p-5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Week Qty Delivered</p>
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-success/10">
              <TrendingUp className="w-4 h-4 text-success" />
            </span>
          </div>
          <p className="text-3xl font-heading font-bold mt-1">{thisWeekQty.toLocaleString(undefined, { maximumFractionDigits: 1 })} kg</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search SKU or branch..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        {branches.length > 0 && (
          <Select value={filterBranch} onValueChange={setFilterBranch}>
            <SelectTrigger className="w-full sm:w-[200px]"><SelectValue placeholder="All Branches" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Branches</SelectItem>
              {branches.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Spreadsheet */}
      <div className="rounded-lg border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className={thClass}>Date</th>
                <th className={`${thClass} text-center`}>Wk</th>
                <th className={thClass} style={{ minWidth: 140 }}>Branch</th>
                <th className={thClass} style={{ minWidth: 180 }}>SM SKU</th>
                <th className={`${thClass} text-right`}>Qty (kg)</th>
                <th className={thClass}>Note</th>
                <th className={`${thClass} text-right`} style={{ minWidth: 100 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {/* Drafts */}
              {drafts.map((draft, idx) => {
                const weekNum = draft.deliveryDate ? getWeekNumber(draft.deliveryDate) : '';
                const rowBg = draft.isNew ? 'bg-blue-50 dark:bg-blue-950/30' : 'bg-yellow-50 dark:bg-yellow-950/30';
                return (
                  <tr key={draft.tempId} className={`border-b last:border-0 transition-colors ${rowBg}`}>
                    <td className={tdClass}>
                      <Input type="date" value={draft.deliveryDate} onChange={e => handleUpdateDraft(draft.tempId, 'deliveryDate', e.target.value)} className="h-8 text-xs w-[130px]" />
                    </td>
                    <td className={`${tdClass} text-center text-xs font-mono text-muted-foreground`}>{weekNum}</td>
                    <td className={tdClass}>
                      <Input value={draft.branchName} onChange={e => handleUpdateDraft(draft.tempId, 'branchName', e.target.value)} className="h-8 text-xs" placeholder="Branch name" />
                    </td>
                    <td className={tdClass}>
                      <Select value={draft.smSkuId || '_none'} onValueChange={v => handleUpdateDraft(draft.tempId, 'smSkuId', v === '_none' ? '' : v)}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select SM SKU" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="_none">— Select —</SelectItem>
                          {smSkus.map(s => <SelectItem key={s.id} value={s.id}>{s.skuId} — {s.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className={tdClass}>
                      <Input type="number" min={0} step="any" value={draft.qtyDeliveredKg || ''} onChange={e => handleUpdateDraft(draft.tempId, 'qtyDeliveredKg', Number(e.target.value))} className="h-8 text-xs text-right w-[80px] font-mono" placeholder="0" />
                    </td>
                    <td className={tdClass}>
                      <Input value={draft.note} onChange={e => handleUpdateDraft(draft.tempId, 'note', e.target.value)} className="h-8 text-xs w-[120px]" placeholder="Note..." />
                    </td>
                    <td className={`${tdClass} text-right`}>
                      <div className="flex items-center justify-end gap-0.5">
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-success hover:text-success" onClick={() => handleSaveRow(draft.tempId)} title="Save"><Check className="w-3.5 h-3.5" /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={() => handleCancelRow(draft.tempId)} title="Cancel"><X className="w-3.5 h-3.5" /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDuplicateRow(idx)} title="Duplicate"><Copy className="w-3.5 h-3.5" /></Button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {drafts.length > 0 && (
                <tr className="border-b">
                  <td colSpan={7} className="px-3 py-2">
                    <Button variant="ghost" size="sm" onClick={handleAddRow} className="text-xs text-muted-foreground hover:text-foreground">
                      <Plus className="w-3.5 h-3.5 mr-1" /> Add another row
                    </Button>
                  </td>
                </tr>
              )}

              {/* Saved */}
              {filteredSaved.map(d => {
                const sku = skuMap[d.smSkuId];
                return (
                  <tr key={d.id} className="border-b last:border-0 bg-background hover:bg-muted/30 transition-colors">
                    <td className={tdReadOnly}>{d.deliveryDate}</td>
                    <td className={`${tdReadOnly} text-center font-mono`}>{d.weekNumber}</td>
                    <td className={tdReadOnly}>{d.branchName}</td>
                    <td className={tdReadOnly}>
                      <div className="font-medium">{sku?.name || '—'}</div>
                      <div className="text-muted-foreground font-mono">{sku?.skuId || '—'}</div>
                    </td>
                    <td className={`${tdReadOnly} text-right font-mono`}>{d.qtyDeliveredKg.toLocaleString(undefined, { maximumFractionDigits: 1 })}</td>
                    <td className={`${tdReadOnly} text-muted-foreground max-w-[120px] truncate`}>{d.note}</td>
                    <td className={`${tdReadOnly} text-right`}>
                      <div className="flex items-center justify-end gap-0.5">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleEditSaved(d)} title="Edit"><Pencil className="w-3.5 h-3.5" /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => handleDeleteSaved(d.id)} title="Delete"><Trash2 className="w-3.5 h-3.5" /></Button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {drafts.length === 0 && filteredSaved.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                    No deliveries yet. Click "+ Add Row" to start entering.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {filteredSaved.length} saved delivery(ies){drafts.length > 0 && ` · ${drafts.filter(d => d.isEditing).length} editing`}
      </p>
    </div>
  );
}
