import { useMemo, useState } from 'react';
import { GoodsReceipt, getWeekNumber } from '@/types/goods-receipt';
import { SKU } from '@/types/sku';
import { Supplier } from '@/types/supplier';
import { Price } from '@/types/price';
import { DraftRow } from '@/pages/GoodsReceipt';
import { useSortableTable } from '@/hooks/use-sortable-table';
import { SortableHeader } from '@/components/SortableHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Trash2, Copy, Plus, Pencil, Check, X } from 'lucide-react';
import { SearchInput } from '@/components/SearchInput';
import { EmptyState } from '@/components/EmptyState';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { SearchableSelect } from '@/components/SearchableSelect';

interface Props {
  savedReceipts: GoodsReceipt[];
  drafts: DraftRow[];
  rmSkus: SKU[];
  suppliers: Supplier[];
  allSuppliers: Supplier[];
  prices: Price[];
  editingReceiptIds: string[];
  onUpdateDraft: (tempId: string, field: keyof DraftRow, value: any) => void;
  onDeleteDraft: (tempId: string) => void;
  onDeleteSaved: (id: string) => void;
  onAddRow: () => void;
  onDuplicateRow: (index: number) => void;
  onEditSaved: (receipt: GoodsReceipt) => void;
  onSaveRow: (tempId: string) => void;
  onCancelRow: (tempId: string) => void;
}

export function GoodsReceiptSpreadsheet({
  savedReceipts, drafts, rmSkus, suppliers, allSuppliers, prices,
  editingReceiptIds,
  onUpdateDraft, onDeleteDraft, onDeleteSaved, onAddRow, onDuplicateRow,
  onEditSaved, onSaveRow, onCancelRow,
}: Props) {
  const [search, setSearch] = useState('');
  const [filterSupplier, setFilterSupplier] = useState<string>('all');

  const skuMap = useMemo(() => Object.fromEntries(rmSkus.map(s => [s.id, s])), [rmSkus]);
  const supplierMap = useMemo(() => Object.fromEntries(allSuppliers.map(s => [s.id, s])), [allSuppliers]);

  const getStdUnitPrice = (skuId: string, supplierId: string) => {
    const active = prices.find(p => p.skuId === skuId && p.supplierId === supplierId && p.isActive);
    return active?.pricePerUsageUom ?? 0;
  };

  const filteredSaved = useMemo(() => {
    return savedReceipts.filter(r => {
      if (editingReceiptIds.includes(r.id)) return false;
      const sku = skuMap[r.skuId];
      const supplier = supplierMap[r.supplierId];
      const matchesSearch =
        (sku?.name || '').toLowerCase().includes(search.toLowerCase()) ||
        (sku?.skuId || '').toLowerCase().includes(search.toLowerCase()) ||
        (supplier?.name || '').toLowerCase().includes(search.toLowerCase());
      const matchesSupplier = filterSupplier === 'all' || r.supplierId === filterSupplier;
      return matchesSearch && matchesSupplier;
    });
  }, [savedReceipts, skuMap, supplierMap, search, filterSupplier, editingReceiptIds]);

  const comparators = useMemo(() => ({
    date: (a: GoodsReceipt, b: GoodsReceipt) => a.receiptDate.localeCompare(b.receiptDate),
    week: (a: GoodsReceipt, b: GoodsReceipt) => a.weekNumber - b.weekNumber,
    sku: (a: GoodsReceipt, b: GoodsReceipt) => (skuMap[a.skuId]?.name || '').localeCompare(skuMap[b.skuId]?.name || ''),
    supplier: (a: GoodsReceipt, b: GoodsReceipt) => (supplierMap[a.supplierId]?.name || '').localeCompare(supplierMap[b.supplierId]?.name || ''),
    qty: (a: GoodsReceipt, b: GoodsReceipt) => a.quantityReceived - b.quantityReceived,
    actualTotal: (a: GoodsReceipt, b: GoodsReceipt) => a.actualTotal - b.actualTotal,
    variance: (a: GoodsReceipt, b: GoodsReceipt) => a.priceVariance - b.priceVariance,
  }), [skuMap, supplierMap]);

  const { sorted: sortedSaved, sortKey, sortDir, handleSort } = useSortableTable(filteredSaved, comparators);

  // Default sort by date desc when no sort active
  const displaySaved = sortKey ? sortedSaved : [...filteredSaved].sort((a, b) => b.receiptDate.localeCompare(a.receiptDate));

  const thClass = 'text-left px-3 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wider';
  const tdClass = 'px-1.5 py-1';
  const tdReadOnly = 'px-3 py-2.5 text-xs';

  return (
    <div className="space-y-4">
      {/* Keyboard hints */}
      <div className="kbd-hint">
        <kbd>Tab</kbd> to move between cells · <kbd>Enter</kbd> to save row · <kbd>Esc</kbd> to cancel
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search SKU or supplier..."
          className="flex-1"
          totalCount={savedReceipts.length}
          filteredCount={filteredSaved.length}
          entityName="receipts"
        />
        <Select value={filterSupplier} onValueChange={setFilterSupplier}>
          <SelectTrigger className="w-full sm:w-[200px]">
            <SelectValue placeholder="All Suppliers" />
          </SelectTrigger>
          <SelectContent className="max-h-60">
            <SelectItem value="all">All Suppliers</SelectItem>
            {allSuppliers.map(s => (
              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Spreadsheet table */}
      <div className="rounded-lg border bg-card overflow-hidden">
        <div className="overflow-auto max-h-[70vh]">
          <table className="w-full text-sm">
            <thead className="sticky-thead">
              <tr className="border-b bg-muted/50">
                <th className={`${thClass} cursor-pointer hover:bg-muted/50`} onClick={() => handleSort('date')}>
                  <SortableHeader label="Date" sortKey="date" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                </th>
                <th className={`${thClass} text-center cursor-pointer hover:bg-muted/50`} onClick={() => handleSort('week')}>
                  <SortableHeader label="Wk" sortKey="week" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                </th>
                <th className={`${thClass} cursor-pointer hover:bg-muted/50`} style={{ minWidth: 180 }} onClick={() => handleSort('sku')}>
                  <SortableHeader label="SKU" sortKey="sku" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                </th>
                <th className={`${thClass} cursor-pointer hover:bg-muted/50`} style={{ minWidth: 160 }} onClick={() => handleSort('supplier')}>
                  <SortableHeader label="Supplier" sortKey="supplier" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                </th>
                <th className={`${thClass} text-right cursor-pointer hover:bg-muted/50`} onClick={() => handleSort('qty')}>
                  <SortableHeader label="Qty" sortKey="qty" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="justify-end" />
                </th>
                <th className={`${thClass} text-center`}>UOM</th>
                <th className={`${thClass} text-right cursor-pointer hover:bg-muted/50`} onClick={() => handleSort('actualTotal')}>
                  <SortableHeader label="Actual Total" sortKey="actualTotal" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="justify-end" />
                </th>
                <th className={`${thClass} text-right`}>Actual Unit ฿</th>
                <th className={`${thClass} text-right`}>Std Unit ฿</th>
                <th className={`${thClass} text-right`}>Std Total</th>
                <th className={`${thClass} text-right cursor-pointer hover:bg-muted/50`} onClick={() => handleSort('variance')}>
                  <SortableHeader label="Variance" sortKey="variance" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="justify-end" />
                </th>
                <th className={thClass}>Note</th>
                <th className={`${thClass} text-right`} style={{ minWidth: 100 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {/* Draft / editing rows */}
              {drafts.map((draft, idx) => {
                const sku = skuMap[draft.skuId];
                const stdUnit = getStdUnitPrice(draft.skuId, draft.supplierId);
                const actualUnit = draft.quantityReceived > 0 ? draft.actualTotal / draft.quantityReceived : 0;
                const stdTotal = stdUnit * draft.quantityReceived;
                const variance = draft.actualTotal - stdTotal;
                const weekNum = draft.receiptDate ? getWeekNumber(draft.receiptDate) : '';

                const rowBg = draft.isNew
                  ? 'bg-blue-50 dark:bg-blue-950/30'
                  : 'bg-yellow-50 dark:bg-yellow-950/30';

                return (
                  <tr key={draft.tempId} className={`border-b last:border-0 transition-colors ${rowBg}`}>
                    <td className={tdClass}>
                      <Input
                        type="date"
                        value={draft.receiptDate}
                        onChange={e => onUpdateDraft(draft.tempId, 'receiptDate', e.target.value)}
                        className="h-8 text-xs w-[130px]"
                      />
                    </td>
                    <td className={`${tdClass} text-center text-xs font-mono text-muted-foreground`}>{weekNum}</td>
                    <td className={tdClass}>
                      <SearchableSelect
                        value={draft.skuId}
                        onValueChange={v => {
                          onUpdateDraft(draft.tempId, 'skuId', v);
                          if (v) {
                            const s = rmSkus.find(sk => sk.id === v);
                            if (s?.supplier1) {
                              onUpdateDraft(draft.tempId, 'supplierId', s.supplier1);
                            }
                          }
                        }}
                        options={rmSkus.map(s => ({ value: s.id, label: `${s.skuId} — ${s.name}`, sublabel: s.skuId }))}
                        placeholder="Select SKU"
                        triggerClassName="h-8 text-xs"
                      />
                    </td>
                    <td className={tdClass}>
                      <SearchableSelect
                        value={draft.supplierId}
                        onValueChange={v => onUpdateDraft(draft.tempId, 'supplierId', v)}
                        options={suppliers.map(s => ({ value: s.id, label: s.name }))}
                        placeholder="Supplier"
                        triggerClassName="h-8 text-xs"
                      />
                    </td>
                    <td className={tdClass}>
                      <Input
                        type="number"
                        min={0}
                        step="any"
                        value={draft.quantityReceived || ''}
                        onChange={e => onUpdateDraft(draft.tempId, 'quantityReceived', Number(e.target.value))}
                        className="h-8 text-xs text-right w-[80px] font-mono"
                        placeholder="0"
                      />
                    </td>
                    <td className={`${tdClass} text-center text-xs text-muted-foreground`}>
                      {sku?.purchaseUom || '—'}
                    </td>
                    <td className={tdClass}>
                      <Input
                        type="number"
                        min={0}
                        step="any"
                        value={draft.actualTotal || ''}
                        onChange={e => onUpdateDraft(draft.tempId, 'actualTotal', Number(e.target.value))}
                        className="h-8 text-xs text-right w-[100px] font-mono"
                        placeholder="0.00"
                      />
                    </td>
                    <td className={`${tdClass} text-right text-xs font-mono text-muted-foreground`}>
                      {actualUnit > 0 ? actualUnit.toFixed(4) : '—'}
                    </td>
                    <td className={`${tdClass} text-right text-xs font-mono text-muted-foreground`}>
                      {stdUnit > 0 ? stdUnit.toFixed(2) : '—'}
                    </td>
                    <td className={`${tdClass} text-right text-xs font-mono text-muted-foreground`}>
                      {stdTotal > 0 ? stdTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                    </td>
                    <td className={`${tdClass} text-right text-xs font-mono font-semibold ${
                      variance > 0 ? 'text-destructive' : variance < 0 ? 'text-success' : 'text-muted-foreground'
                    }`}>
                      {draft.skuId && draft.supplierId && draft.quantityReceived > 0 ? (
                        <>{variance > 0 ? '+' : ''}{variance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</>
                      ) : '—'}
                    </td>
                    <td className={tdClass}>
                      <Input
                        value={draft.note}
                        onChange={e => onUpdateDraft(draft.tempId, 'note', e.target.value)}
                        className="h-8 text-xs w-[120px]"
                        placeholder="Note..."
                      />
                    </td>
                    <td className={`${tdClass} text-right`}>
                      <div className="flex items-center justify-end gap-0.5">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-success hover:text-success"
                          onClick={() => onSaveRow(draft.tempId)}
                          title="Save row"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-foreground"
                          onClick={() => onCancelRow(draft.tempId)}
                          title="Cancel"
                        >
                          <X className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => onDuplicateRow(idx)}
                          title="Duplicate row"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {/* Add row button inline */}
              {drafts.length > 0 && (
                <tr className="border-b">
                  <td colSpan={13} className="px-3 py-2">
                    <Button variant="ghost" size="sm" onClick={onAddRow} className="text-xs text-muted-foreground hover:text-foreground">
                      <Plus className="w-3.5 h-3.5 mr-1" />
                      Add another row
                    </Button>
                  </td>
                </tr>
              )}

              {/* Saved receipts (read-only) */}
              {displaySaved.map(r => {
                const sku = skuMap[r.skuId];
                const supplier = supplierMap[r.supplierId];
                return (
                  <tr key={r.id} className="border-b last:border-0 bg-background hover:bg-muted/30 transition-colors">
                    <td className={tdReadOnly}>{r.receiptDate}</td>
                    <td className={`${tdReadOnly} text-center font-mono`}>{r.weekNumber}</td>
                    <td className={tdReadOnly}>
                      <div className="font-medium">{sku?.name || '—'}</div>
                      <div className="text-muted-foreground font-mono">{sku?.skuId || '—'}</div>
                    </td>
                    <td className={tdReadOnly}>{supplier?.name || '—'}</td>
                    <td className={`${tdReadOnly} text-right font-mono`}>{r.quantityReceived.toLocaleString()}</td>
                    <td className={`${tdReadOnly} text-center`}>{r.usageUom || '—'}</td>
                    <td className={`${tdReadOnly} text-right font-mono`}>{r.actualTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td className={`${tdReadOnly} text-right font-mono text-muted-foreground`}>{r.actualUnitPrice.toFixed(4)}</td>
                    <td className={`${tdReadOnly} text-right font-mono text-muted-foreground`}>{r.stdUnitPrice.toFixed(2)}</td>
                    <td className={`${tdReadOnly} text-right font-mono`}>{r.standardPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td className={`${tdReadOnly} text-right font-mono font-semibold ${
                      r.priceVariance > 0 ? 'text-destructive' : r.priceVariance < 0 ? 'text-success' : ''
                    }`}>
                      {r.priceVariance > 0 ? '+' : ''}{r.priceVariance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className={`${tdReadOnly} text-muted-foreground max-w-[120px] truncate`}>{r.note}</td>
                    <td className={`${tdReadOnly} text-right`}>
                      <div className="flex items-center justify-end gap-0.5">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => onEditSaved(r)}
                          title="Edit"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => onDeleteSaved(r.id)}
                          title="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {drafts.length === 0 && displaySaved.length === 0 && (
                <tr>
                  <td colSpan={13} className="px-4 py-12 text-center text-muted-foreground">
                    No receipts yet. Click "+ Add Row" to start entering.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {displaySaved.length} saved receipt(s){drafts.length > 0 && ` · ${drafts.filter(d => d.isEditing).length} editing`}
      </p>
    </div>
  );
}
