import { useMemo, useState } from 'react';
import { GoodsReceipt, getWeekNumber } from '@/types/goods-receipt';
import { SKU } from '@/types/sku';
import { Supplier } from '@/types/supplier';
import { Price } from '@/types/price';
import { DraftRow } from '@/pages/GoodsReceipt';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Trash2, Copy, Plus, Search } from 'lucide-react';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

interface Props {
  savedReceipts: GoodsReceipt[];
  drafts: DraftRow[];
  rmSkus: SKU[];
  suppliers: Supplier[];
  allSuppliers: Supplier[];
  prices: Price[];
  onUpdateDraft: (tempId: string, field: keyof DraftRow, value: any) => void;
  onDeleteDraft: (tempId: string) => void;
  onDeleteSaved: (id: string) => void;
  onAddRow: () => void;
  onDuplicateRow: (index: number) => void;
}

export function GoodsReceiptSpreadsheet({
  savedReceipts, drafts, rmSkus, suppliers, allSuppliers, prices,
  onUpdateDraft, onDeleteDraft, onDeleteSaved, onAddRow, onDuplicateRow,
}: Props) {
  const [search, setSearch] = useState('');
  const [filterSupplier, setFilterSupplier] = useState<string>('all');

  const skuMap = useMemo(() => Object.fromEntries(rmSkus.map(s => [s.id, s])), [rmSkus]);
  const supplierMap = useMemo(() => Object.fromEntries(allSuppliers.map(s => [s.id, s])), [allSuppliers]);

  const getStandardPrice = (skuId: string, supplierId: string) => {
    const active = prices.find(p => p.skuId === skuId && p.supplierId === supplierId && p.isActive);
    return active?.pricePerPurchaseUom ?? 0;
  };

  // Filter saved receipts
  const filteredSaved = useMemo(() => {
    return savedReceipts.filter(r => {
      const sku = skuMap[r.skuId];
      const supplier = supplierMap[r.supplierId];
      const matchesSearch =
        (sku?.name || '').toLowerCase().includes(search.toLowerCase()) ||
        (sku?.skuId || '').toLowerCase().includes(search.toLowerCase()) ||
        (supplier?.name || '').toLowerCase().includes(search.toLowerCase());
      const matchesSupplier = filterSupplier === 'all' || r.supplierId === filterSupplier;
      return matchesSearch && matchesSupplier;
    }).sort((a, b) => b.receiptDate.localeCompare(a.receiptDate));
  }, [savedReceipts, skuMap, supplierMap, search, filterSupplier]);

  const thClass = 'text-left px-3 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wider';
  const tdClass = 'px-1.5 py-1';

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search SKU or supplier..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={filterSupplier} onValueChange={setFilterSupplier}>
          <SelectTrigger className="w-full sm:w-[200px]">
            <SelectValue placeholder="All Suppliers" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Suppliers</SelectItem>
            {allSuppliers.map(s => (
              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Spreadsheet table */}
      <div className="rounded-lg border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className={thClass}>Date</th>
                <th className={`${thClass} text-center`}>Wk</th>
                <th className={thClass} style={{ minWidth: 180 }}>SKU</th>
                <th className={thClass} style={{ minWidth: 160 }}>Supplier</th>
                <th className={`${thClass} text-right`}>Qty</th>
                <th className={`${thClass} text-center`}>UOM</th>
                <th className={`${thClass} text-right`}>Actual ฿</th>
                <th className={`${thClass} text-right`}>Std ฿</th>
                <th className={`${thClass} text-right`}>Variance</th>
                <th className={thClass}>Note</th>
                <th className={`${thClass} text-right`} style={{ minWidth: 80 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {/* Draft rows (unsaved/new) */}
              {drafts.map((draft, idx) => {
                const sku = skuMap[draft.skuId];
                const stdPrice = getStandardPrice(draft.skuId, draft.supplierId);
                const variance = draft.actualPrice - stdPrice;
                const weekNum = draft.receiptDate ? getWeekNumber(draft.receiptDate) : '';
                const isUnsaved = !draft.saved;

                return (
                  <tr
                    key={draft.tempId}
                    className={`border-b last:border-0 transition-colors ${
                      isUnsaved ? 'bg-yellow-50 dark:bg-yellow-950/30' : 'hover:bg-muted/30'
                    }`}
                  >
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
                      <Select
                        value={draft.skuId || '_none'}
                        onValueChange={v => {
                          const newSkuId = v === '_none' ? '' : v;
                          onUpdateDraft(draft.tempId, 'skuId', newSkuId);
                          // Auto-fill supplier from SKU's supplier1
                          if (newSkuId) {
                            const s = rmSkus.find(sk => sk.id === newSkuId);
                            if (s?.supplier1) {
                              onUpdateDraft(draft.tempId, 'supplierId', s.supplier1);
                            }
                          }
                        }}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Select SKU" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="_none">— Select —</SelectItem>
                          {rmSkus.map(s => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.skuId} — {s.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className={tdClass}>
                      <Select
                        value={draft.supplierId || '_none'}
                        onValueChange={v => onUpdateDraft(draft.tempId, 'supplierId', v === '_none' ? '' : v)}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Supplier" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="_none">— Select —</SelectItem>
                          {suppliers.map(s => (
                            <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
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
                        value={draft.actualPrice || ''}
                        onChange={e => onUpdateDraft(draft.tempId, 'actualPrice', Number(e.target.value))}
                        className="h-8 text-xs text-right w-[90px] font-mono"
                        placeholder="0.00"
                      />
                    </td>
                    <td className={`${tdClass} text-right text-xs font-mono text-muted-foreground`}>
                      {stdPrice > 0 ? stdPrice.toFixed(2) : '—'}
                    </td>
                    <td className={`${tdClass} text-right text-xs font-mono font-semibold ${
                      variance > 0 ? 'text-destructive' : variance < 0 ? 'text-success' : 'text-muted-foreground'
                    }`}>
                      {draft.skuId && draft.supplierId ? (
                        <>{variance > 0 ? '+' : ''}{variance.toFixed(2)}</>
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
                          className="h-7 w-7"
                          onClick={() => onDuplicateRow(idx)}
                          title="Duplicate row"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => onDeleteDraft(draft.tempId)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {/* Add row button inline */}
              {drafts.length > 0 && (
                <tr className="border-b">
                  <td colSpan={11} className="px-3 py-2">
                    <Button variant="ghost" size="sm" onClick={onAddRow} className="text-xs text-muted-foreground hover:text-foreground">
                      <Plus className="w-3.5 h-3.5 mr-1" />
                      Add another row
                    </Button>
                  </td>
                </tr>
              )}

              {/* Saved receipts */}
              {filteredSaved.map(r => {
                const sku = skuMap[r.skuId];
                const supplier = supplierMap[r.supplierId];
                return (
                  <tr key={r.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="px-3 py-2.5 text-xs">{r.receiptDate}</td>
                    <td className="px-3 py-2.5 text-center text-xs font-mono">{r.weekNumber}</td>
                    <td className="px-3 py-2.5">
                      <div className="font-medium text-xs">{sku?.name || '—'}</div>
                      <div className="text-xs text-muted-foreground font-mono">{sku?.skuId || '—'}</div>
                    </td>
                    <td className="px-3 py-2.5 text-xs">{supplier?.name || '—'}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs">{r.quantityReceived.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-center text-xs">{r.purchaseUom || '—'}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs">{r.actualPrice.toFixed(2)}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs">{r.standardPrice.toFixed(2)}</td>
                    <td className={`px-3 py-2.5 text-right font-mono text-xs font-semibold ${
                      r.priceVariance > 0 ? 'text-destructive' : r.priceVariance < 0 ? 'text-success' : ''
                    }`}>
                      {r.priceVariance > 0 ? '+' : ''}{r.priceVariance.toFixed(2)}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground max-w-[120px] truncate">{r.note}</td>
                    <td className="px-3 py-2.5 text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => onDeleteSaved(r.id)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </td>
                  </tr>
                );
              })}

              {drafts.length === 0 && filteredSaved.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-4 py-12 text-center text-muted-foreground">
                    No receipts yet. Click "+ Add Row" to start entering.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {filteredSaved.length} saved receipt(s){drafts.length > 0 && ` · ${drafts.filter(d => !d.saved).length} unsaved draft(s)`}
      </p>
    </div>
  );
}
