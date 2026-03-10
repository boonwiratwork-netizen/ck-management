import { useState, useMemo, useCallback } from 'react';
import { Delivery } from '@/types/delivery';
import { Branch } from '@/types/branch';
import { getWeekNumber } from '@/types/goods-receipt';
import { SKU } from '@/types/sku';
import { SMStockBalance } from '@/hooks/use-sm-stock-data';
import { useDeliveryData } from '@/hooks/use-delivery-data';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SearchableSelect } from '@/components/SearchableSelect';
import { Save, Truck, TrendingUp, Plus, Copy, Check, X, Trash2, Pencil, Search, AlertTriangle, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { useLanguage } from '@/hooks/use-language';

interface Props {
  deliveryData: ReturnType<typeof useDeliveryData>;
  skus: SKU[];
  activeBranches: Branch[];
  smStockBalances: SMStockBalance[];
}

interface DraftDeliveryRow {
  tempId: string;
  deliveryDate: string;
  branchName: string;
  smSkuId: string;
  qtyDeliveredG: number;
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
    qtyDeliveredG: 0,
    note: '',
    isNew: true,
    isEditing: true,
  };
}

export default function DeliveryToBranchesPage({ deliveryData, skus, activeBranches, smStockBalances }: Props) {
  const { deliveries, addDelivery, updateDelivery, deleteDelivery } = deliveryData;
  const { t } = useLanguage();
  const [drafts, setDrafts] = useState<DraftDeliveryRow[]>([]);
  const [search, setSearch] = useState('');
  const [filterBranch, setFilterBranch] = useState<string>('all');
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);
  const [stockWarning, setStockWarning] = useState<{ tempId: string; skuName: string; need: number; have: number } | null>(null);

  const smSkus = useMemo(() => skus.filter(s => s.type === 'SM'), [skus]);
  const skuMap = useMemo(() => Object.fromEntries(skus.map(s => [s.id, s])), [skus]);

  const currentWeek = getWeekNumber(new Date().toISOString().slice(0, 10));
  const thisWeekDeliveries = useMemo(
    () => deliveries.filter(d => d.weekNumber === currentWeek),
    [deliveries, currentWeek]
  );
  const thisWeekQty = useMemo(
    () => thisWeekDeliveries.reduce((s, d) => s + d.qtyDeliveredG, 0),
    [thisWeekDeliveries]
  );

  const branches = useMemo(() => {
    const set = new Set(deliveries.map(d => d.branchName).filter(Boolean));
    return Array.from(set).sort();
  }, [deliveries]);

  const editingIds = drafts.filter(d => d.savedDeliveryId).map(d => d.savedDeliveryId!);

  // Sorting
  type DelSortKey = 'date' | 'week' | 'branch' | 'sku' | 'qty';
  const [delSortKey, setDelSortKey] = useState<DelSortKey | null>(null);
  const [delSortDir, setDelSortDir] = useState<'asc' | 'desc'>('desc');

  const handleDelSort = (key: DelSortKey) => {
    if (delSortKey === key) {
      if (delSortDir === 'asc') setDelSortDir('desc');
      else { setDelSortKey(null); setDelSortDir('desc'); }
    } else {
      setDelSortKey(key);
      setDelSortDir('asc');
    }
  };

  const DelSortIcon = ({ col }: { col: DelSortKey }) => {
    if (delSortKey !== col) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-30" />;
    return delSortDir === 'asc'
      ? <ArrowUp className="w-3 h-3 ml-1 text-primary" />
      : <ArrowDown className="w-3 h-3 ml-1 text-primary" />;
  };

  const filteredSaved = useMemo(() => {
    let list = deliveries
      .filter(d => {
        if (editingIds.includes(d.id)) return false;
        const sku = skuMap[d.smSkuId];
        const matchesSearch =
          (sku?.name || '').toLowerCase().includes(search.toLowerCase()) ||
          (sku?.skuId || '').toLowerCase().includes(search.toLowerCase()) ||
          d.branchName.toLowerCase().includes(search.toLowerCase());
        const matchesBranch = filterBranch === 'all' || d.branchName === filterBranch;
        return matchesSearch && matchesBranch;
      });

    if (delSortKey) {
      list = [...list].sort((a, b) => {
        let cmp = 0;
        switch (delSortKey) {
          case 'date': cmp = a.deliveryDate.localeCompare(b.deliveryDate); break;
          case 'week': cmp = a.weekNumber - b.weekNumber; break;
          case 'branch': cmp = a.branchName.localeCompare(b.branchName); break;
          case 'sku': cmp = (skuMap[a.smSkuId]?.name || '').localeCompare(skuMap[b.smSkuId]?.name || ''); break;
          case 'qty': cmp = a.qtyDeliveredG - b.qtyDeliveredG; break;
        }
        return delSortDir === 'desc' ? -cmp : cmp;
      });
    } else {
      list = [...list].sort((a, b) => b.deliveryDate.localeCompare(a.deliveryDate));
    }
    return list;
  }, [deliveries, skuMap, search, filterBranch, editingIds, delSortKey, delSortDir]);

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

  const doSaveRow = useCallback((tempId: string) => {
    const draft = drafts.find(d => d.tempId === tempId);
    if (!draft) return;
    const data = {
      deliveryDate: draft.deliveryDate,
      branchName: draft.branchName,
      smSkuId: draft.smSkuId,
      qtyDeliveredG: draft.qtyDeliveredG,
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

  const handleSaveRow = useCallback((tempId: string) => {
    const draft = drafts.find(d => d.tempId === tempId);
    if (!draft || !draft.smSkuId || !draft.branchName || draft.qtyDeliveredG <= 0) {
      toast.error('Please fill in Branch, SM SKU, and Qty');
      return;
    }

    // Check SM stock
    const balance = smStockBalances.find(b => b.skuId === draft.smSkuId);
    const currentStock = balance?.currentStock ?? 0;
    if (currentStock - draft.qtyDeliveredG < 0) {
      const sku = skuMap[draft.smSkuId];
      setStockWarning({
        tempId,
        skuName: sku?.name || draft.smSkuId,
        need: draft.qtyDeliveredG,
        have: currentStock,
      });
      return;
    }

    doSaveRow(tempId);
  }, [drafts, smStockBalances, skuMap, doSaveRow]);

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
      qtyDeliveredG: delivery.qtyDeliveredG,
      note: delivery.note,
      isNew: false,
      isEditing: true,
      savedDeliveryId: delivery.id,
    };
    setDrafts(prev => [...prev, draft]);
  }, [drafts]);

  const handleDeleteRequest = useCallback((id: string) => {
    const d = deliveries.find(x => x.id === id);
    const sku = d ? skuMap[d.smSkuId] : null;
    setDeleteConfirm({ id, name: sku?.name || 'this delivery' });
  }, [deliveries, skuMap]);

  const handleDeleteConfirm = () => {
    if (deleteConfirm) {
      deleteDelivery(deleteConfirm.id);
      toast.success('Delivery deleted');
      setDeleteConfirm(null);
    }
  };

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
          <h2 className="text-2xl font-heading font-bold">{t('title.delivery')}</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Record SM deliveries to branches — auto-deducts from SM Stock</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleAddRow}>{t('btn.addRow')}</Button>
          {hasUnsaved && (
            <Button onClick={handleSaveAll}>
              <Save className="w-4 h-4" />
              {t('btn.saveAll')} ({drafts.filter(d => d.isEditing).length})
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div className="rounded-lg border bg-card p-5">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('summary.totalDeliveries')}</p>
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
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('summary.weekQtyDelivered')}</p>
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-success/10">
              <TrendingUp className="w-4 h-4 text-success" />
            </span>
          </div>
          <p className="text-3xl font-heading font-bold mt-1">{thisWeekQty.toLocaleString(undefined, { maximumFractionDigits: 1 })} kg</p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search SKU or branch..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        {branches.length > 0 && (
          <Select value={filterBranch} onValueChange={setFilterBranch}>
            <SelectTrigger className="w-full sm:w-[200px]"><SelectValue placeholder={t('common.allBranches')} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('common.allBranches')}</SelectItem>
              {branches.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="rounded-lg border bg-card overflow-hidden">
        <div className="overflow-auto max-h-[70vh]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 sticky top-0 z-10" style={{ backgroundColor: 'hsl(var(--table-header))' }}>
                <th className={`${thClass} cursor-pointer select-none hover:bg-muted/50`} onClick={() => handleDelSort('date')}>
                  <span className="inline-flex items-center">{t('col.date')}<DelSortIcon col="date" /></span>
                </th>
                <th className={`${thClass} text-center cursor-pointer select-none hover:bg-muted/50`} onClick={() => handleDelSort('week')}>
                  <span className="inline-flex items-center">{t('col.week')}<DelSortIcon col="week" /></span>
                </th>
                <th className={`${thClass} cursor-pointer select-none hover:bg-muted/50`} style={{ minWidth: 140 }} onClick={() => handleDelSort('branch')}>
                  <span className="inline-flex items-center">{t('col.branch')}<DelSortIcon col="branch" /></span>
                </th>
                <th className={`${thClass} cursor-pointer select-none hover:bg-muted/50`} style={{ minWidth: 180 }} onClick={() => handleDelSort('sku')}>
                  <span className="inline-flex items-center">{t('col.smSku')}<DelSortIcon col="sku" /></span>
                </th>
                <th className={`${thClass} text-right cursor-pointer select-none hover:bg-muted/50`} onClick={() => handleDelSort('qty')}>
                  <span className="inline-flex items-center justify-end">{t('col.qtyKg')}<DelSortIcon col="qty" /></span>
                </th>
                <th className={thClass}>{t('col.note')}</th>
                <th className={`${thClass} text-right`} style={{ minWidth: 100 }}>{t('col.actions')}</th>
              </tr>
            </thead>
            <tbody>
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
                      <SearchableSelect
                        value={draft.branchName}
                        onValueChange={v => handleUpdateDraft(draft.tempId, 'branchName', v)}
                        options={activeBranches.map(b => ({ value: b.branchName, label: `${b.branchName} — ${b.brandName}` }))}
                        placeholder="Select Branch"
                        triggerClassName="h-8 text-xs"
                      />
                    </td>
                    <td className={tdClass}>
                      <SearchableSelect
                        value={draft.smSkuId}
                        onValueChange={v => handleUpdateDraft(draft.tempId, 'smSkuId', v)}
                        options={smSkus.map(s => ({ value: s.id, label: `${s.skuId} — ${s.name}`, sublabel: s.skuId }))}
                        placeholder="Select SM SKU"
                        triggerClassName="h-8 text-xs"
                      />
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
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => handleDeleteRequest(d.id)} title="Delete"><Trash2 className="w-3.5 h-3.5" /></Button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {drafts.length === 0 && filteredSaved.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                    <Truck className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    No deliveries yet. Click "+ Add Row" to record your first delivery.
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

      <ConfirmDialog
        open={!!deleteConfirm}
        onOpenChange={open => !open && setDeleteConfirm(null)}
        title="Delete Delivery"
        description={`Are you sure you want to delete the delivery for "${deleteConfirm?.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={handleDeleteConfirm}
      />

      <AlertDialog open={!!stockWarning} onOpenChange={open => !open && setStockWarning(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-6 h-6 text-destructive" />
              Negative SM stock warning
            </AlertDialogTitle>
          </AlertDialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">This delivery will result in negative stock:</p>
            <div className="rounded-lg border bg-muted/30 p-3 space-y-1.5">
              <p className="text-sm"><span className="font-bold">{stockWarning?.skuName}</span></p>
              <p className="text-sm text-destructive font-medium">Current stock: {stockWarning?.have?.toFixed(1)} kg</p>
              <p className="text-sm text-destructive font-medium">Shortfall: {((stockWarning?.need ?? 0) - (stockWarning?.have ?? 0)).toFixed(1)} kg</p>
            </div>
          </div>
          <AlertDialogFooter className="gap-2 sm:gap-0">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-muted text-foreground hover:bg-muted/80"
              onClick={() => {
                setStockWarning(null);
                // Focus qty field — user can manually adjust
              }}
            >
              Adjust Qty
            </AlertDialogAction>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (stockWarning) {
                  doSaveRow(stockWarning.tempId);
                  setStockWarning(null);
                }
              }}
            >
              Proceed Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
