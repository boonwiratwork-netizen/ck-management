import { useState, useMemo, useCallback } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useBranchReceiptData, BranchReceipt } from '@/hooks/use-branch-receipt-data';
import { SKU } from '@/types/sku';
import { Price } from '@/types/price';
import { Branch } from '@/types/branch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { CalendarIcon, Plus, Save, Trash2, Search } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface Props {
  skus: SKU[];
  prices: Price[];
  branches: Branch[];
}

interface DraftRow {
  tempId: string;
  skuId: string;
  supplierName: string;
  qtyReceived: number;
  uom: string;
  actualUnitPrice: number;
}

function createEmptyDraft(): DraftRow {
  return {
    tempId: crypto.randomUUID(),
    skuId: '',
    supplierName: '',
    qtyReceived: 0,
    uom: '',
    actualUnitPrice: 0,
  };
}

export default function BranchReceiptPage({ skus, prices, branches }: Props) {
  const { isAdmin, isBranchManager, profile } = useAuth();
  const { receipts, saveReceipts, deleteReceipt } = useBranchReceiptData();

  const [receiptDate, setReceiptDate] = useState<Date>(new Date());
  const [branchId, setBranchId] = useState<string>(
    isBranchManager && profile?.branch_id ? profile.branch_id : ''
  );
  const [drafts, setDrafts] = useState<DraftRow[]>([]);

  // History filters
  const [historyDateFrom, setHistoryDateFrom] = useState<Date | undefined>(undefined);
  const [historyDateTo, setHistoryDateTo] = useState<Date | undefined>(undefined);
  const [historyBranch, setHistoryBranch] = useState<string>('all');

  const rmSkus = useMemo(() => skus.filter(s => s.type === 'RM' && s.status === 'Active'), [skus]);
  const skuMap = useMemo(() => Object.fromEntries(skus.map(s => [s.id, s])), [skus]);
  const branchMap = useMemo(() => Object.fromEntries(branches.map(b => [b.id, b])), [branches]);

  const activeBranches = useMemo(() => branches.filter(b => b.status === 'Active'), [branches]);
  const availableBranches = useMemo(() => {
    if (isAdmin) return activeBranches;
    if (isBranchManager && profile?.branch_id) return activeBranches.filter(b => b.id === profile.branch_id);
    return [];
  }, [isAdmin, isBranchManager, profile, activeBranches]);

  const getStdUnitPrice = useCallback((skuId: string): number => {
    const active = prices.find(p => p.skuId === skuId && p.isActive);
    return active?.pricePerUsageUom ?? 0;
  }, [prices]);

  const handleAddRow = useCallback(() => setDrafts(prev => [...prev, createEmptyDraft()]), []);
  const handleDeleteDraft = useCallback((tempId: string) => setDrafts(prev => prev.filter(d => d.tempId !== tempId)), []);

  const handleUpdateDraft = useCallback((tempId: string, field: keyof DraftRow, value: any) => {
    setDrafts(prev => prev.map(d => {
      if (d.tempId !== tempId) return d;
      const updated = { ...d, [field]: value };
      if (field === 'skuId' && value) {
        const sku = rmSkus.find(s => s.id === value);
        if (sku) updated.uom = sku.usageUom;
      }
      return updated;
    }));
  }, [rmSkus]);

  const handleSaveAll = useCallback(async () => {
    if (!branchId) { toast.error('Please select a branch'); return; }
    const validDrafts = drafts.filter(d => d.skuId && d.qtyReceived > 0);
    if (validDrafts.length === 0) { toast.error('No valid rows to save'); return; }

    const dateStr = format(receiptDate, 'yyyy-MM-dd');
    const rows = validDrafts.map(d => {
      const stdUnit = getStdUnitPrice(d.skuId);
      const actualTotal = d.qtyReceived * d.actualUnitPrice;
      const stdTotal = d.qtyReceived * stdUnit;
      return {
        branchId,
        receiptDate: dateStr,
        skuId: d.skuId,
        supplierName: d.supplierName,
        qtyReceived: d.qtyReceived,
        uom: d.uom,
        actualUnitPrice: d.actualUnitPrice,
        actualTotal,
        stdUnitPrice: stdUnit,
        stdTotal,
        priceVariance: actualTotal - stdTotal,
        notes: '',
      };
    });
    const count = await saveReceipts(rows);
    if (count) {
      toast.success(`${count} receipt(s) saved`);
      setDrafts([]);
    }
  }, [branchId, drafts, receiptDate, getStdUnitPrice, saveReceipts]);

  // History filtering
  const filteredHistory = useMemo(() => {
    return receipts.filter(r => {
      if (historyBranch !== 'all' && r.branchId !== historyBranch) return false;
      if (isBranchManager && profile?.branch_id && r.branchId !== profile.branch_id) return false;
      if (historyDateFrom && r.receiptDate < format(historyDateFrom, 'yyyy-MM-dd')) return false;
      if (historyDateTo && r.receiptDate > format(historyDateTo, 'yyyy-MM-dd')) return false;
      return true;
    });
  }, [receipts, historyBranch, historyDateFrom, historyDateTo, isBranchManager, profile]);

  const totalActual = useMemo(() => filteredHistory.reduce((s, r) => s + r.actualTotal, 0), [filteredHistory]);
  const totalStd = useMemo(() => filteredHistory.reduce((s, r) => s + r.stdTotal, 0), [filteredHistory]);
  const totalVariance = totalActual - totalStd;

  const thClass = 'text-left px-3 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wider';
  const tdClass = 'px-1.5 py-1';
  const tdReadOnly = 'px-3 py-2.5 text-xs';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-heading font-bold">Branch Receipt</h2>
        <p className="text-sm text-muted-foreground mt-0.5">Record external purchases received at the branch</p>
      </div>

      {/* Top controls */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Date</label>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className={cn('w-[160px] justify-start text-left font-normal', !receiptDate && 'text-muted-foreground')}>
                <CalendarIcon className="mr-2 h-4 w-4" />
                {format(receiptDate, 'PPP')}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={receiptDate} onSelect={d => d && setReceiptDate(d)} initialFocus className="p-3 pointer-events-auto" />
            </PopoverContent>
          </Popover>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Branch</label>
          <Select value={branchId || '_none'} onValueChange={v => setBranchId(v === '_none' ? '' : v)} disabled={isBranchManager}>
            <SelectTrigger className="w-[200px]"><SelectValue placeholder="Select branch" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_none">— Select —</SelectItem>
              {availableBranches.map(b => <SelectItem key={b.id} value={b.id}>{b.branchName}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" onClick={handleAddRow}><Plus className="w-4 h-4 mr-1" /> Add Row</Button>
        {drafts.length > 0 && (
          <Button onClick={handleSaveAll}><Save className="w-4 h-4 mr-1" /> Save All ({drafts.length})</Button>
        )}
      </div>

      {/* Inline entry table */}
      {drafts.length > 0 && (
        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className={thClass} style={{ minWidth: 200 }}>SKU</th>
                  <th className={thClass}>SKU Name</th>
                  <th className={thClass} style={{ minWidth: 140 }}>Supplier</th>
                  <th className={`${thClass} text-right`}>Qty</th>
                  <th className={`${thClass} text-center`}>UOM</th>
                  <th className={`${thClass} text-right`}>Actual Unit ฿</th>
                  <th className={`${thClass} text-right`}>Actual Total</th>
                  <th className={`${thClass} text-right`}>Std Unit ฿</th>
                  <th className={`${thClass} text-right`}>Std Total</th>
                  <th className={`${thClass} text-right`}>Variance</th>
                  <th className={`${thClass} text-center`} style={{ minWidth: 60 }}></th>
                </tr>
              </thead>
              <tbody>
                {drafts.map(draft => {
                  const sku = skuMap[draft.skuId];
                  const stdUnit = draft.skuId ? getStdUnitPrice(draft.skuId) : 0;
                  const actualTotal = draft.qtyReceived * draft.actualUnitPrice;
                  const stdTotal = draft.qtyReceived * stdUnit;
                  const variance = actualTotal - stdTotal;

                  return (
                    <tr key={draft.tempId} className="border-b last:border-0 bg-blue-50 dark:bg-blue-950/30">
                      <td className={tdClass}>
                        <Select value={draft.skuId || '_none'} onValueChange={v => handleUpdateDraft(draft.tempId, 'skuId', v === '_none' ? '' : v)}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select SKU" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="_none">— Select —</SelectItem>
                            {rmSkus.map(s => <SelectItem key={s.id} value={s.id}>{s.skuId} — {s.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className={`${tdClass} text-xs text-muted-foreground`}>{sku?.name || '—'}</td>
                      <td className={tdClass}>
                        <Input value={draft.supplierName} onChange={e => handleUpdateDraft(draft.tempId, 'supplierName', e.target.value)} className="h-8 text-xs w-[130px]" placeholder="Supplier..." />
                      </td>
                      <td className={tdClass}>
                        <Input type="number" min={0} step="any" value={draft.qtyReceived || ''} onChange={e => handleUpdateDraft(draft.tempId, 'qtyReceived', Number(e.target.value))} className="h-8 text-xs text-right w-[80px] font-mono" placeholder="0" />
                      </td>
                      <td className={tdClass}>
                        <Input value={draft.uom} onChange={e => handleUpdateDraft(draft.tempId, 'uom', e.target.value)} className="h-8 text-xs text-center w-[60px]" />
                      </td>
                      <td className={tdClass}>
                        <Input type="number" min={0} step="any" value={draft.actualUnitPrice || ''} onChange={e => handleUpdateDraft(draft.tempId, 'actualUnitPrice', Number(e.target.value))} className="h-8 text-xs text-right w-[90px] font-mono" placeholder="0.00" />
                      </td>
                      <td className={`${tdClass} text-right text-xs font-mono text-muted-foreground`}>
                        {actualTotal > 0 ? actualTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                      </td>
                      <td className={`${tdClass} text-right text-xs font-mono text-muted-foreground`}>
                        {stdUnit > 0 ? stdUnit.toFixed(2) : '—'}
                      </td>
                      <td className={`${tdClass} text-right text-xs font-mono text-muted-foreground`}>
                        {stdTotal > 0 ? stdTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                      </td>
                      <td className={`${tdClass} text-right text-xs font-mono font-semibold ${variance > 0 ? 'text-destructive' : variance === 0 ? 'text-green-600' : 'text-muted-foreground'}`}>
                        {draft.skuId && draft.qtyReceived > 0 ? (
                          <>{variance > 0 ? '+' : ''}{variance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</>
                        ) : '—'}
                      </td>
                      <td className={`${tdClass} text-center`}>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => handleDeleteDraft(draft.tempId)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Receipt History */}
      <div className="space-y-4 pt-4 border-t">
        <h3 className="text-lg font-heading font-semibold">Receipt History</h3>
        <div className="flex flex-wrap gap-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">From</label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className={cn('w-[140px] justify-start text-left font-normal text-xs', !historyDateFrom && 'text-muted-foreground')}>
                  <CalendarIcon className="mr-1 h-3 w-3" />
                  {historyDateFrom ? format(historyDateFrom, 'PP') : 'Start'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={historyDateFrom} onSelect={setHistoryDateFrom} initialFocus className="p-3 pointer-events-auto" />
              </PopoverContent>
            </Popover>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">To</label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className={cn('w-[140px] justify-start text-left font-normal text-xs', !historyDateTo && 'text-muted-foreground')}>
                  <CalendarIcon className="mr-1 h-3 w-3" />
                  {historyDateTo ? format(historyDateTo, 'PP') : 'End'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={historyDateTo} onSelect={setHistoryDateTo} initialFocus className="p-3 pointer-events-auto" />
              </PopoverContent>
            </Popover>
          </div>
          {isAdmin && (
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Branch</label>
              <Select value={historyBranch} onValueChange={setHistoryBranch}>
                <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Branches</SelectItem>
                  {activeBranches.map(b => <SelectItem key={b.id} value={b.id}>{b.branchName}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className={thClass}>Date</th>
                  <th className={thClass}>SKU</th>
                  <th className={thClass}>SKU Name</th>
                  <th className={thClass}>Supplier</th>
                  <th className={`${thClass} text-right`}>Qty</th>
                  <th className={`${thClass} text-center`}>UOM</th>
                  <th className={`${thClass} text-right`}>Actual ฿</th>
                  <th className={`${thClass} text-right`}>Std ฿</th>
                  <th className={`${thClass} text-right`}>Variance</th>
                  {isAdmin && <th className={thClass}>Branch</th>}
                  {isAdmin && <th className={`${thClass} text-center`}></th>}
                </tr>
              </thead>
              <tbody>
                {filteredHistory.map(r => {
                  const sku = skuMap[r.skuId];
                  const branch = branchMap[r.branchId];
                  return (
                    <tr key={r.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                      <td className={tdReadOnly}>{r.receiptDate}</td>
                      <td className={`${tdReadOnly} font-mono`}>{sku?.skuId || '—'}</td>
                      <td className={tdReadOnly}>{sku?.name || '—'}</td>
                      <td className={tdReadOnly}>{r.supplierName || '—'}</td>
                      <td className={`${tdReadOnly} text-right font-mono`}>{r.qtyReceived.toLocaleString()}</td>
                      <td className={`${tdReadOnly} text-center`}>{r.uom}</td>
                      <td className={`${tdReadOnly} text-right font-mono`}>{r.actualTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td className={`${tdReadOnly} text-right font-mono`}>{r.stdTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td className={`${tdReadOnly} text-right font-mono font-semibold ${r.priceVariance > 0 ? 'text-destructive' : r.priceVariance === 0 ? 'text-green-600' : 'text-muted-foreground'}`}>
                        {r.priceVariance > 0 ? '+' : ''}{r.priceVariance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      {isAdmin && <td className={tdReadOnly}>{branch?.branchName || '—'}</td>}
                      {isAdmin && (
                        <td className={`${tdReadOnly} text-center`}>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => { deleteReceipt(r.id); toast.success('Deleted'); }}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </td>
                      )}
                    </tr>
                  );
                })}
                {filteredHistory.length === 0 && (
                  <tr><td colSpan={11} className="px-4 py-12 text-center text-muted-foreground">No receipts found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Summary */}
        {filteredHistory.length > 0 && (
          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-lg border bg-card p-4">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Actual Spend</p>
              <p className="text-xl font-heading font-bold mt-1">฿{totalActual.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            </div>
            <div className="rounded-lg border bg-card p-4">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Std Spend</p>
              <p className="text-xl font-heading font-bold mt-1">฿{totalStd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            </div>
            <div className="rounded-lg border bg-card p-4">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Variance</p>
              <p className={`text-xl font-heading font-bold mt-1 ${totalVariance > 0 ? 'text-destructive' : totalVariance === 0 ? 'text-green-600' : 'text-muted-foreground'}`}>
                {totalVariance > 0 ? '+' : ''}฿{totalVariance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
