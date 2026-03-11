import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { GoodsReceipt, getWeekNumber } from '@/types/goods-receipt';
import { SKU } from '@/types/sku';
import { Supplier } from '@/types/supplier';
import { Price } from '@/types/price';
import { BOMLine } from '@/types/bom';
import { useGoodsReceiptData } from '@/hooks/use-goods-receipt-data';
import { useSortableTable } from '@/hooks/use-sortable-table';
import { SortableHeader } from '@/components/SortableHeader';
import { SearchInput } from '@/components/SearchInput';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { CalendarIcon, Save, Plus, Trash2, Pencil, Check, CheckCircle, Search } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useLanguage } from '@/hooks/use-language';
import { SearchableSelect } from '@/components/SearchableSelect';

interface Props {
  receiptData: ReturnType<typeof useGoodsReceiptData>;
  skus: SKU[];
  suppliers: Supplier[];
  prices: Price[];
  bomLines?: BOMLine[];
}

interface RowEdit {
  qty: number;
  actualTotal: number;
  actualManuallyEdited: boolean;
  note: string;
}

interface AdHocRow {
  tempId: string;
  skuId: string;
  qty: number;
  actualTotal: number;
  note: string;
}

export default function GoodsReceiptPage({ receiptData, skus, suppliers, prices, bomLines = [] }: Props) {
  const { receipts, addReceipt, deleteReceipt } = receiptData;
  const { t } = useLanguage();

  const [receiptDate, setReceiptDate] = useState<Date>(new Date());
  const [supplierId, setSupplierId] = useState<string>('');
  const [rowEdits, setRowEdits] = useState<Record<string, RowEdit>>({});
  const [adHocRows, setAdHocRows] = useState<AdHocRow[]>([]);
  const [savedCount, setSavedCount] = useState<number | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingSupplierId, setPendingSupplierId] = useState<string>('');
  const [supplierSearch, setSupplierSearch] = useState('');
  const [supplierDropdownOpen, setSupplierDropdownOpen] = useState(false);
  const supplierDropdownRef = useRef<HTMLDivElement>(null);

  // History filters
  const [histSearch, setHistSearch] = useState('');
  const [histFilterSupplier, setHistFilterSupplier] = useState('all');

  const dateStr = format(receiptDate, 'yyyy-MM-dd');
  const weekNum = getWeekNumber(dateStr);

  const rmSkus = useMemo(() => skus.filter(s => s.type === 'RM'), [skus]);
  const skuMap = useMemo(() => Object.fromEntries(skus.map(s => [s.id, s])), [skus]);
  const supplierMap = useMemo(() => Object.fromEntries(suppliers.map(s => [s.id, s])), [suppliers]);
  const activeSuppliers = useMemo(() => suppliers.filter(s => s.status === 'Active'), [suppliers]);

  // BOM ingredient SKU IDs — SKUs that appear in any bom_lines
  const bomIngredientSkuIds = useMemo(() => {
    return new Set(bomLines.map(l => l.rmSkuId));
  }, [bomLines]);

  // CK supplier IDs — suppliers with at least one SKU in BOM ingredients in active prices
  const ckSupplierIds = useMemo(() => {
    const ids = new Set<string>();
    prices.filter(p => p.isActive && bomIngredientSkuIds.has(p.skuId)).forEach(p => ids.add(p.supplierId));
    return ids;
  }, [prices, bomIngredientSkuIds]);

  // Grouped suppliers for searchable dropdown
  const groupedSuppliers = useMemo(() => {
    const ckGroup = activeSuppliers.filter(s => ckSupplierIds.has(s.id)).sort((a, b) => a.name.localeCompare(b.name));
    const otherGroup = activeSuppliers.filter(s => !ckSupplierIds.has(s.id)).sort((a, b) => a.name.localeCompare(b.name));
    return { ck: ckGroup, other: otherGroup };
  }, [activeSuppliers, ckSupplierIds]);

  // Filter suppliers by search
  const filteredGroupedSuppliers = useMemo(() => {
    const q = supplierSearch.toLowerCase();
    if (!q) return groupedSuppliers;
    return {
      ck: groupedSuppliers.ck.filter(s => s.name.toLowerCase().includes(q)),
      other: groupedSuppliers.other.filter(s => s.name.toLowerCase().includes(q)),
    };
  }, [groupedSuppliers, supplierSearch]);

  // Close supplier dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (supplierDropdownRef.current && !supplierDropdownRef.current.contains(e.target as Node)) {
        setSupplierDropdownOpen(false);
      }
    };
    if (supplierDropdownOpen) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [supplierDropdownOpen]);

  // Pre-loaded SKUs for selected supplier from active Price Master, filtered to BOM ingredients
  const preloadedRows = useMemo(() => {
    if (!supplierId) return [];
    const activePrices = prices.filter(p => p.supplierId === supplierId && p.isActive);
    return activePrices
      .map(p => {
        const sku = skuMap[p.skuId];
        if (!sku || sku.type !== 'RM') return null;
        // FIX 2: Only include SKUs that are BOM ingredients
        if (!bomIngredientSkuIds.has(p.skuId)) return null;
        return { priceId: p.id, skuId: p.skuId, sku, stdUnitPrice: p.pricePerUsageUom };
      })
      .filter(Boolean)
      .sort((a, b) => a!.sku.skuId.localeCompare(b!.sku.skuId)) as { priceId: string; skuId: string; sku: SKU; stdUnitPrice: number }[];
  }, [supplierId, prices, skuMap, bomIngredientSkuIds]);

  const selectedSupplier = supplierMap[supplierId];

  const hasAnyQty = useMemo(() => {
    return Object.values(rowEdits).some(e => e.qty > 0) || adHocRows.some(r => r.qty > 0);
  }, [rowEdits, adHocRows]);

  const handleSupplierChange = useCallback((newId: string) => {
    if (newId === supplierId) return;
    if (hasAnyQty) {
      setPendingSupplierId(newId);
      setConfirmOpen(true);
    } else {
      setSupplierId(newId);
      setRowEdits({});
      setAdHocRows([]);
      setSavedCount(null);
    }
    setSupplierDropdownOpen(false);
    setSupplierSearch('');
  }, [supplierId, hasAnyQty]);

  const confirmSupplierChange = useCallback(() => {
    setSupplierId(pendingSupplierId);
    setRowEdits({});
    setAdHocRows([]);
    setSavedCount(null);
    setConfirmOpen(false);
  }, [pendingSupplierId]);

  const getRowEdit = (skuId: string): RowEdit => rowEdits[skuId] || { qty: 0, actualTotal: 0, actualManuallyEdited: false, note: '' };

  const updateRowEdit = useCallback((skuId: string, updates: Partial<RowEdit>) => {
    setRowEdits(prev => ({
      ...prev,
      [skuId]: { ...getRowEditFromPrev(prev, skuId), ...updates },
    }));
  }, []);

  const qtyRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Save all
  const handleSaveAll = useCallback(async () => {
    const rowsToSave: { skuId: string; qty: number; actualTotal: number; note: string }[] = [];

    // Pre-loaded rows with qty > 0
    for (const row of preloadedRows) {
      const edit = rowEdits[row.skuId];
      if (edit && edit.qty > 0) {
        rowsToSave.push({ skuId: row.skuId, qty: edit.qty, actualTotal: edit.actualTotal, note: edit.note });
      }
    }

    // Ad-hoc rows with qty > 0
    for (const r of adHocRows) {
      if (r.skuId && r.qty > 0) {
        rowsToSave.push({ skuId: r.skuId, qty: r.qty, actualTotal: r.actualTotal, note: r.note });
      }
    }

    if (rowsToSave.length === 0) {
      toast.error('No rows with quantity to save');
      return;
    }

    let count = 0;
    for (const row of rowsToSave) {
      const sku = skuMap[row.skuId];
      await addReceipt(
        { receiptDate: dateStr, skuId: row.skuId, supplierId, quantityReceived: row.qty, actualTotal: row.actualTotal, note: row.note },
        sku,
        prices
      );
      count++;
    }

    setSavedCount(count);
    setRowEdits({});
    setAdHocRows([]);
    setTimeout(() => setSavedCount(null), 4000);
  }, [preloadedRows, rowEdits, adHocRows, dateStr, supplierId, skuMap, prices, addReceipt]);

  // Ad-hoc row management
  const handleAddAdHoc = useCallback(() => {
    setAdHocRows(prev => [...prev, { tempId: crypto.randomUUID(), skuId: '', qty: 0, actualTotal: 0, note: '' }]);
  }, []);

  const updateAdHoc = useCallback((tempId: string, updates: Partial<AdHocRow>) => {
    setAdHocRows(prev => prev.map(r => r.tempId === tempId ? { ...r, ...updates } : r));
  }, []);

  const deleteAdHoc = useCallback((tempId: string) => {
    setAdHocRows(prev => prev.filter(r => r.tempId !== tempId));
  }, []);

  // Receipt history
  const filteredHistory = useMemo(() => {
    return receipts.filter(r => {
      const sku = skuMap[r.skuId];
      const supplier = supplierMap[r.supplierId];
      const matchesSearch =
        (sku?.name || '').toLowerCase().includes(histSearch.toLowerCase()) ||
        (sku?.skuId || '').toLowerCase().includes(histSearch.toLowerCase()) ||
        (supplier?.name || '').toLowerCase().includes(histSearch.toLowerCase());
      const matchesSupplier = histFilterSupplier === 'all' || r.supplierId === histFilterSupplier;
      return matchesSearch && matchesSupplier;
    });
  }, [receipts, skuMap, supplierMap, histSearch, histFilterSupplier]);

  const comparators = useMemo(() => ({
    date: (a: GoodsReceipt, b: GoodsReceipt) => a.receiptDate.localeCompare(b.receiptDate),
    week: (a: GoodsReceipt, b: GoodsReceipt) => a.weekNumber - b.weekNumber,
    sku: (a: GoodsReceipt, b: GoodsReceipt) => (skuMap[a.skuId]?.name || '').localeCompare(skuMap[b.skuId]?.name || ''),
    supplier: (a: GoodsReceipt, b: GoodsReceipt) => (supplierMap[a.supplierId]?.name || '').localeCompare(supplierMap[b.supplierId]?.name || ''),
    qty: (a: GoodsReceipt, b: GoodsReceipt) => a.quantityReceived - b.quantityReceived,
    actualTotal: (a: GoodsReceipt, b: GoodsReceipt) => a.actualTotal - b.actualTotal,
    variance: (a: GoodsReceipt, b: GoodsReceipt) => a.priceVariance - b.priceVariance,
  }), [skuMap, supplierMap]);

  const { sorted: sortedHistory, sortKey: hSortKey, sortDir: hSortDir, handleSort: hHandleSort } = useSortableTable(filteredHistory, comparators);
  const displayHistory = hSortKey ? sortedHistory : [...filteredHistory].sort((a, b) => b.receiptDate.localeCompare(a.receiptDate));

  const thClass = 'text-left px-2 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wider whitespace-nowrap';
  const tdReadOnly = 'px-2 py-2 text-xs';

  const savableCount = useMemo(() => {
    let c = 0;
    for (const row of preloadedRows) {
      const edit = rowEdits[row.skuId];
      if (edit && edit.qty > 0) c++;
    }
    for (const r of adHocRows) {
      if (r.skuId && r.qty > 0) c++;
    }
    return c;
  }, [preloadedRows, rowEdits, adHocRows]);

  const SaveButton = () => (
    <div className="flex items-center gap-2">
      <Button onClick={handleSaveAll} disabled={savableCount === 0}>
        <Save className="w-4 h-4 mr-1" /> Save All ({savableCount})
      </Button>
      {savedCount !== null && (
        <span className="text-xs text-success font-medium flex items-center gap-1 animate-fade-in">
          <CheckCircle className="w-3.5 h-3.5" /> {savedCount} items saved
        </span>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-heading font-bold">{t('title.goodsReceipt')}</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Record raw material receipts from suppliers</p>
        </div>
        {supplierId && <SaveButton />}
      </div>

      {/* Header controls */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block label-required">Date</label>
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
        {/* FIX 3: Searchable grouped supplier dropdown */}
        <div className="relative" ref={supplierDropdownRef}>
          <label className="text-xs font-medium text-muted-foreground mb-1 block label-required">Supplier</label>
          <button
            type="button"
            onClick={() => setSupplierDropdownOpen(!supplierDropdownOpen)}
            className={cn(
              'flex items-center justify-between w-[240px] h-9 px-3 py-2 text-sm border rounded-md bg-background hover:bg-accent/50 transition-colors',
              !supplierId && 'text-muted-foreground'
            )}
          >
            <span className="truncate">{selectedSupplier?.name || '— Select supplier —'}</span>
            <Search className="w-3.5 h-3.5 ml-2 shrink-0 text-muted-foreground" />
          </button>
          {supplierDropdownOpen && (
            <div className="absolute z-50 top-full mt-1 w-[280px] bg-popover border rounded-lg shadow-lg">
              <div className="p-2 border-b">
                <input
                  type="text"
                  value={supplierSearch}
                  onChange={e => setSupplierSearch(e.target.value)}
                  placeholder="Search supplier..."
                  className="w-full h-8 px-2 text-sm border rounded-md bg-background focus:border-primary outline-none"
                  autoFocus
                />
              </div>
              <div className="max-h-60 overflow-y-auto py-1">
                {filteredGroupedSuppliers.ck.length > 0 && (
                  <>
                    <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">CK Suppliers</div>
                    {filteredGroupedSuppliers.ck.map(s => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => handleSupplierChange(s.id)}
                        className={cn(
                          'w-full text-left px-3 py-1.5 text-sm hover:bg-accent transition-colors',
                          s.id === supplierId && 'bg-accent font-medium'
                        )}
                      >
                        {s.name}
                      </button>
                    ))}
                  </>
                )}
                {filteredGroupedSuppliers.other.length > 0 && (
                  <>
                    <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Other Suppliers</div>
                    {filteredGroupedSuppliers.other.map(s => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => handleSupplierChange(s.id)}
                        className={cn(
                          'w-full text-left px-3 py-1.5 text-sm hover:bg-accent transition-colors',
                          s.id === supplierId && 'bg-accent font-medium'
                        )}
                      >
                        {s.name}
                      </button>
                    ))}
                  </>
                )}
                {filteredGroupedSuppliers.ck.length === 0 && filteredGroupedSuppliers.other.length === 0 && (
                  <p className="px-3 py-4 text-sm text-muted-foreground text-center">No suppliers found</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Row count info */}
      {supplierId && selectedSupplier && (
        <p className="text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">{preloadedRows.length}</span> items from <span className="font-semibold text-foreground">{selectedSupplier.name}</span>
        </p>
      )}

      {/* Keyboard hints */}
      {supplierId && (
        <div className="kbd-hint">
          <kbd>Tab</kbd> — move to next item's QTY · Click — edit price or note · <kbd>Enter</kbd> — save row · <kbd>Esc</kbd> — cancel
        </div>
      )}

      {/* Pre-loaded sheet */}
      {supplierId && preloadedRows.length > 0 && (
        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="overflow-auto max-h-[70vh]">
            <table className="w-full text-sm table-fixed">
              <colgroup>
                <col style={{ width: 90 }} />  {/* Date */}
                <col style={{ width: 36 }} />  {/* Wk */}
                <col style={{ width: 200 }} /> {/* SKU */}
                <col style={{ width: 120 }} /> {/* Supplier */}
                <col style={{ width: 80 }} />  {/* QTY - prominent */}
                <col style={{ width: 50 }} />  {/* UOM */}
                <col style={{ width: 90 }} />  {/* Actual ฿ */}
                <col style={{ width: 70 }} />  {/* Unit ฿ */}
                <col style={{ width: 70 }} />  {/* Std ฿ */}
                <col style={{ width: 80 }} />  {/* Std Tot */}
                <col style={{ width: 80 }} />  {/* Var */}
                <col style={{ width: 100 }} /> {/* Note */}
              </colgroup>
              <thead className="sticky-thead">
                <tr className="border-b bg-muted/50">
                  <th className={thClass}>Date</th>
                  <th className={`${thClass} text-center`}>Wk</th>
                  <th className={thClass}>SKU</th>
                  <th className={thClass}>Supplier</th>
                  <th className={`${thClass} text-right bg-background font-semibold text-foreground`}>QTY</th>
                  <th className={`${thClass} text-center`}>UOM</th>
                  <th className={`${thClass} text-right`}>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="cursor-help border-b border-dashed border-muted-foreground">Actual ฿</span>
                        </TooltipTrigger>
                        <TooltipContent side="top"><p>Verify actual price paid</p></TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </th>
                  <th className={`${thClass} text-right`}>Unit ฿</th>
                  <th className={`${thClass} text-right`}>Std ฿</th>
                  <th className={`${thClass} text-right`}>Std Tot</th>
                  <th className={`${thClass} text-right`}>Var</th>
                  <th className={thClass}>Note</th>
                </tr>
              </thead>
              <tbody>
                {preloadedRows.map((row, idx) => {
                  const edit = getRowEdit(row.skuId);
                  const stdTotal = row.stdUnitPrice * edit.qty;
                  const actualTotal = edit.actualManuallyEdited ? edit.actualTotal : stdTotal;
                  const unitPrice = edit.qty > 0 ? actualTotal / edit.qty : 0;
                  const variance = actualTotal - stdTotal;
                  const hasQty = edit.qty > 0;
                  const actualMatchesStd = !edit.actualManuallyEdited || Math.abs(actualTotal - stdTotal) < 0.01;

                  return (
                    <tr
                      key={row.skuId}
                      className={cn(
                        'border-b last:border-0 transition-colors',
                        hasQty
                          ? 'bg-green-50 dark:bg-green-950/20 border-l-4 border-l-green-500'
                          : 'opacity-40'
                      )}
                    >
                      <td className={`${tdReadOnly} text-muted-foreground`}>{dateStr}</td>
                      <td className={`${tdReadOnly} text-center font-mono text-muted-foreground`}>{weekNum}</td>
                      <td className={tdReadOnly}>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="truncate">
                                <span className={cn("font-mono text-[10px]", hasQty ? "text-foreground/70 font-medium" : "text-muted-foreground")}>{row.sku.skuId}</span>
                                <span className={cn("ml-1", hasQty ? "font-semibold text-foreground" : "")}>{row.sku.name}</span>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent side="top"><p className="font-medium">{row.sku.skuId} — {row.sku.name}</p></TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </td>
                      <td className={`${tdReadOnly} text-muted-foreground truncate`}>{selectedSupplier?.name}</td>
                      <td className="px-1 py-1">
                        <input
                          ref={el => { qtyRefs.current[row.skuId] = el; }}
                          type="number"
                          min={0}
                          step="any"
                          defaultValue={edit.qty || ''}
                          key={`qty-${row.skuId}-${savedCount}`}
                          onBlur={e => {
                            const val = Number(e.target.value) || 0;
                            updateRowEdit(row.skuId, {
                              qty: val,
                              ...(!rowEdits[row.skuId]?.actualManuallyEdited ? { actualTotal: row.stdUnitPrice * val } : {}),
                            });
                          }}
                          onFocus={e => e.target.select()}
                          className={cn(
                            "h-8 text-xs text-right w-full font-mono px-2 py-1 border-2 rounded-md bg-background focus:border-primary focus:ring-1 focus:ring-primary/30 outline-none",
                            hasQty ? "border-green-400 font-bold text-green-700 dark:text-green-400" : "border-primary/30"
                          )}
                          placeholder="0"
                        />
                      </td>
                      <td className={`${tdReadOnly} text-center text-muted-foreground`}>{row.sku.purchaseUom}</td>
                      <td className="px-1 py-1">
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            min={0}
                            step="any"
                            defaultValue={actualTotal || ''}
                            key={`actual-${row.skuId}-${edit.qty}-${edit.actualManuallyEdited ? 'manual' : 'auto'}-${savedCount}`}
                            tabIndex={-1}
                            onBlur={e => {
                              const val = Number(e.target.value) || 0;
                              updateRowEdit(row.skuId, { actualTotal: val, actualManuallyEdited: true });
                            }}
                            onFocus={e => e.target.select()}
                            className={cn(
                              "h-8 text-xs text-right font-mono px-2 py-1 border rounded-md outline-none min-w-0 flex-1",
                              hasQty && !actualMatchesStd
                                ? "bg-amber-50 dark:bg-amber-950/30 border-amber-400 focus:border-amber-500"
                                : "bg-amber-50/50 dark:bg-amber-950/10 border-amber-200 dark:border-amber-800/30 focus:border-primary"
                            )}
                            placeholder="0.00"
                          />
                          {hasQty && actualMatchesStd && (
                            <span className="text-[9px] text-muted-foreground bg-muted px-1 rounded whitespace-nowrap shrink-0">= STD</span>
                          )}
                        </div>
                      </td>
                      <td className={`${tdReadOnly} text-right font-mono text-muted-foreground`}>
                        {unitPrice > 0 ? unitPrice.toFixed(2) : '—'}
                      </td>
                      <td className={`${tdReadOnly} text-right font-mono text-muted-foreground`}>
                        {row.stdUnitPrice > 0 ? row.stdUnitPrice.toFixed(2) : '—'}
                      </td>
                      <td className={`${tdReadOnly} text-right font-mono text-muted-foreground`}>
                        {stdTotal > 0 ? stdTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                      </td>
                      <td className={cn(
                        `${tdReadOnly} text-right font-mono`,
                        hasQty && variance !== 0 ? 'font-bold' : 'font-semibold',
                        variance < 0 ? 'text-success' : variance > 0 ? 'text-destructive' : 'text-muted-foreground'
                      )}>
                        {hasQty ? (
                          <>{variance > 0 ? '+' : ''}{variance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</>
                        ) : '—'}
                      </td>
                      <td className="px-1 py-1">
                        <input
                          type="text"
                          defaultValue={edit.note}
                          key={`note-${row.skuId}-${savedCount}`}
                          tabIndex={-1}
                          onBlur={e => updateRowEdit(row.skuId, { note: e.target.value })}
                          className="h-8 text-xs w-full px-2 py-1 border rounded-md bg-background focus:border-primary outline-none"
                          placeholder="Note"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Ad-hoc rows */}
      {supplierId && (
        <div className="space-y-2">
          {adHocRows.length > 0 && (
            <>
              <p className="text-xs font-medium text-muted-foreground">Ad-hoc items (not in Price Master)</p>
              <div className="rounded-lg border bg-card overflow-hidden">
                <table className="w-full text-sm table-fixed">
                  <colgroup>
                    <col style={{ width: 240 }} />
                    <col style={{ width: 80 }} />
                    <col style={{ width: 50 }} />
                    <col style={{ width: 90 }} />
                    <col style={{ width: 100 }} />
                    <col style={{ width: 50 }} />
                  </colgroup>
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className={thClass}>SKU</th>
                      <th className={`${thClass} text-right`}>QTY</th>
                      <th className={`${thClass} text-center`}>UOM</th>
                      <th className={`${thClass} text-right`}>Actual ฿</th>
                      <th className={thClass}>Note</th>
                      <th className={`${thClass} text-center`}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {adHocRows.map(row => {
                      const sku = skuMap[row.skuId];
                      return (
                        <tr key={row.tempId} className="border-b last:border-0 bg-blue-50 dark:bg-blue-950/30">
                          <td className="px-1 py-1">
                            <SearchableSelect
                              value={row.skuId}
                              onValueChange={v => updateAdHoc(row.tempId, { skuId: v })}
                              options={rmSkus.map(s => ({ value: s.id, label: `${s.skuId} — ${s.name}`, sublabel: s.skuId }))}
                              placeholder="Select SKU"
                              triggerClassName="h-8 text-xs truncate"
                            />
                          </td>
                          <td className="px-1 py-1">
                            <input
                              type="number" min={0} step="any"
                              defaultValue={row.qty || ''}
                              key={`adhoc-qty-${row.tempId}`}
                              onBlur={e => updateAdHoc(row.tempId, { qty: Number(e.target.value) || 0 })}
                              onFocus={e => e.target.select()}
                              className="h-8 text-xs text-right w-full font-mono px-2 py-1 border-2 border-primary/30 rounded-md bg-background focus:border-primary outline-none"
                              placeholder="0"
                            />
                          </td>
                          <td className={`${tdReadOnly} text-center text-muted-foreground`}>{sku?.purchaseUom || '—'}</td>
                          <td className="px-1 py-1">
                            <input
                              type="number" min={0} step="any"
                              defaultValue={row.actualTotal || ''}
                              key={`adhoc-actual-${row.tempId}`}
                              onBlur={e => updateAdHoc(row.tempId, { actualTotal: Number(e.target.value) || 0 })}
                              onFocus={e => e.target.select()}
                              className="h-8 text-xs text-right w-full font-mono px-2 py-1 border rounded-md bg-amber-50/50 dark:bg-amber-950/10 border-amber-200 dark:border-amber-800/30 focus:border-primary outline-none"
                              placeholder="0.00"
                            />
                          </td>
                          <td className="px-1 py-1">
                            <input
                              type="text"
                              defaultValue={row.note}
                              key={`adhoc-note-${row.tempId}`}
                              onBlur={e => updateAdHoc(row.tempId, { note: e.target.value })}
                              className="h-8 text-xs w-full px-2 py-1 border rounded-md bg-background focus:border-primary outline-none"
                              placeholder="Note"
                            />
                          </td>
                          <td className="px-1 py-1 text-center">
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => deleteAdHoc(row.tempId)}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <Button size="sm" variant="outline" onClick={handleAddAdHoc}>
            <Plus className="w-3.5 h-3.5 mr-1" /> Add row
          </Button>
        </div>
      )}

      {/* Bottom Save */}
      {supplierId && savableCount > 0 && (
        <div className="flex justify-end">
          <SaveButton />
        </div>
      )}

      {/* Receipt History */}
      <div className="space-y-4 pt-4 border-t">
        <h3 className="text-lg font-heading font-semibold">Receipt History</h3>
        <div className="flex flex-col sm:flex-row gap-3">
          <SearchInput
            value={histSearch}
            onChange={setHistSearch}
            placeholder="Search SKU or supplier..."
            className="flex-1"
            totalCount={receipts.length}
            filteredCount={filteredHistory.length}
            entityName="receipts"
          />
          <Select value={histFilterSupplier} onValueChange={setHistFilterSupplier}>
            <SelectTrigger className="w-full sm:w-[200px]"><SelectValue placeholder="All Suppliers" /></SelectTrigger>
            <SelectContent className="max-h-60">
              <SelectItem value="all">All Suppliers</SelectItem>
              {suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="overflow-auto max-h-[70vh]">
            <table className="w-full text-sm table-fixed">
              <colgroup>
                <col style={{ width: 90 }} />
                <col style={{ width: 36 }} />
                <col style={{ width: 200 }} />
                <col style={{ width: 120 }} />
                <col style={{ width: 70 }} />
                <col style={{ width: 50 }} />
                <col style={{ width: 90 }} />
                <col style={{ width: 70 }} />
                <col style={{ width: 70 }} />
                <col style={{ width: 80 }} />
                <col style={{ width: 80 }} />
                <col style={{ width: 80 }} />
                <col style={{ width: 60 }} />
              </colgroup>
              <thead className="sticky-thead">
                <tr className="border-b bg-muted/50">
                  <th className={`${thClass} cursor-pointer`} onClick={() => hHandleSort('date')}>
                    <SortableHeader label="Date" sortKey="date" activeSortKey={hSortKey} sortDir={hSortDir} onSort={hHandleSort} />
                  </th>
                  <th className={`${thClass} text-center cursor-pointer`} onClick={() => hHandleSort('week')}>
                    <SortableHeader label="Wk" sortKey="week" activeSortKey={hSortKey} sortDir={hSortDir} onSort={hHandleSort} />
                  </th>
                  <th className={`${thClass} cursor-pointer`} onClick={() => hHandleSort('sku')}>
                    <SortableHeader label="SKU" sortKey="sku" activeSortKey={hSortKey} sortDir={hSortDir} onSort={hHandleSort} />
                  </th>
                  <th className={`${thClass} cursor-pointer`} onClick={() => hHandleSort('supplier')}>
                    <SortableHeader label="Supplier" sortKey="supplier" activeSortKey={hSortKey} sortDir={hSortDir} onSort={hHandleSort} />
                  </th>
                  <th className={`${thClass} text-right cursor-pointer`} onClick={() => hHandleSort('qty')}>
                    <SortableHeader label="Qty" sortKey="qty" activeSortKey={hSortKey} sortDir={hSortDir} onSort={hHandleSort} className="justify-end" />
                  </th>
                  <th className={`${thClass} text-center`}>UOM</th>
                  <th className={`${thClass} text-right cursor-pointer`} onClick={() => hHandleSort('actualTotal')}>
                    <SortableHeader label="Actual ฿" sortKey="actualTotal" activeSortKey={hSortKey} sortDir={hSortDir} onSort={hHandleSort} className="justify-end" />
                  </th>
                  <th className={`${thClass} text-right`}>Unit ฿</th>
                  <th className={`${thClass} text-right`}>Std ฿</th>
                  <th className={`${thClass} text-right`}>Std Tot</th>
                  <th className={`${thClass} text-right cursor-pointer`} onClick={() => hHandleSort('variance')}>
                    <SortableHeader label="Var" sortKey="variance" activeSortKey={hSortKey} sortDir={hSortDir} onSort={hHandleSort} className="justify-end" />
                  </th>
                  <th className={thClass}>Note</th>
                  <th className={`${thClass} text-center`}></th>
                </tr>
              </thead>
              <tbody>
                {displayHistory.length === 0 ? (
                  <tr><td colSpan={13} className="px-4 py-12 text-center text-muted-foreground">No receipts found</td></tr>
                ) : displayHistory.map(r => {
                  const sku = skuMap[r.skuId];
                  const supplier = supplierMap[r.supplierId];
                  return (
                    <TooltipProvider key={r.id}>
                      <tr className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                        <td className={tdReadOnly}>{r.receiptDate}</td>
                        <td className={`${tdReadOnly} text-center font-mono`}>{r.weekNumber}</td>
                        <td className={tdReadOnly}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="truncate">
                                <span className="font-mono text-[10px] text-muted-foreground">{sku?.skuId}</span>
                                <span className="ml-1 font-medium">{sku?.name || '—'}</span>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent side="top"><p>{sku?.skuId} — {sku?.name}</p></TooltipContent>
                          </Tooltip>
                        </td>
                        <td className={`${tdReadOnly} truncate`}>{supplier?.name || '—'}</td>
                        <td className={`${tdReadOnly} text-right font-mono`}>{r.quantityReceived.toLocaleString()}</td>
                        <td className={`${tdReadOnly} text-center text-muted-foreground`}>{sku?.purchaseUom || r.usageUom}</td>
                        <td className={`${tdReadOnly} text-right font-mono`}>{r.actualTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        <td className={`${tdReadOnly} text-right font-mono text-muted-foreground`}>{r.actualUnitPrice.toFixed(2)}</td>
                        <td className={`${tdReadOnly} text-right font-mono text-muted-foreground`}>{r.stdUnitPrice.toFixed(2)}</td>
                        <td className={`${tdReadOnly} text-right font-mono`}>{r.standardPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        <td className={`${tdReadOnly} text-right font-mono font-semibold ${
                          r.priceVariance > 0 ? 'text-destructive' : r.priceVariance < 0 ? 'text-success' : ''
                        }`}>
                          {r.priceVariance > 0 ? '+' : ''}{r.priceVariance.toFixed(2)}
                        </td>
                        <td className={`${tdReadOnly} text-muted-foreground truncate`}>{r.note}</td>
                        <td className={`${tdReadOnly} text-center`}>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => deleteReceipt(r.id)}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </td>
                      </tr>
                    </TooltipProvider>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{displayHistory.length} of {receipts.length} receipts shown</p>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Change supplier?"
        description="Changing supplier will clear current entries. Continue?"
        confirmLabel="Continue"
        variant="warning"
        onConfirm={confirmSupplierChange}
      />
    </div>
  );
}

function getRowEditFromPrev(prev: Record<string, RowEdit>, skuId: string): RowEdit {
  return prev[skuId] || { qty: 0, actualTotal: 0, actualManuallyEdited: false, note: '' };
}
