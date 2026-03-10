import { useState, useMemo, useCallback } from 'react';
import { useLanguage } from '@/hooks/use-language';
import { SpBomLine } from '@/types/sp-bom';
import { SKU } from '@/types/sku';
import { Price } from '@/types/price';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SearchableSelect } from '@/components/SearchableSelect';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { CSVImportModal, CSVColumnDef, CSVValidationError } from '@/components/CSVImportModal';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Plus, Trash2, Edit2, Search, Package, DollarSign, Check, X, Maximize2, Minimize2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { syncBomPrice } from '@/lib/bom-price-sync';

interface SpBomPageProps {
  spBomData: {
    lines: SpBomLine[];
    loading: boolean;
    getLinesForSp: (spSkuId: string) => SpBomLine[];
    addLine: (data: Omit<SpBomLine, 'id'>) => Promise<void>;
    updateLine: (id: string, data: Partial<Omit<SpBomLine, 'id'>>) => Promise<void>;
    updateBatchYield: (spSkuId: string, qty: number, uom: string) => Promise<void>;
    deleteLine: (id: string) => Promise<void>;
  };
  skus: SKU[];
  prices: Price[];
  readOnly?: boolean;
  onPricesRefresh?: () => void;
}

const CSV_COLUMNS: CSVColumnDef[] = [
  { key: 'sp_code', label: 'sp_code', required: true },
  { key: 'sku_code', label: 'sku_code', required: true },
  { key: 'qty', label: 'qty', required: true },
  { key: 'yield_pct', label: 'yield_pct' },
  { key: 'batch_yield_qty', label: 'batch_yield_qty', required: true },
];

export default function SpBomPage({ spBomData, skus, prices, readOnly = false, onPricesRefresh }: SpBomPageProps) {
  const { isManagement } = useAuth();
  const canEdit = isManagement && !readOnly;

  const [selectedSpId, setSelectedSpId] = useState<string | null>(null);
  const [spSearch, setSpSearch] = useState('');
  const [fullscreen, setFullscreen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);
  const [csvOpen, setCsvOpen] = useState(false);

  // Batch yield editing
  const [editingYield, setEditingYield] = useState(false);
  const [yieldQty, setYieldQty] = useState(1);

  // Inline editing state
  const [addingLine, setAddingLine] = useState(false);
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [formSkuId, setFormSkuId] = useState('');
  const [formQty, setFormQty] = useState(0);
  const [formYieldPct, setFormYieldPct] = useState(100);

  const spSkus = useMemo(() => skus.filter(s => s.type === 'SP'), [skus]);
  const rmSkus = useMemo(() => skus.filter(s => s.type === 'RM'), [skus]);

  const getSkuById = (id: string) => skus.find(s => s.id === id);
  const getSkuByCode = (code: string) => skus.find(s => s.skuId === code);

  const getActiveCost = (skuId: string): number => {
    const active = prices.find(p => p.skuId === skuId && p.isActive);
    return active?.pricePerUsageUom ?? 0;
  };

  const calcEffQty = (qty: number, yieldPct: number) => yieldPct > 0 ? qty / (yieldPct / 100) : qty;

  const selectedSp = spSkus.find(s => s.id === selectedSpId) ?? null;
  const selectedLines = selectedSpId ? spBomData.getLinesForSp(selectedSpId) : [];

  const currentBatchYieldQty = selectedLines.length > 0 ? selectedLines[0].batchYieldQty : 1;
  // Batch yield UOM is always from the SP SKU's usage_uom
  const currentBatchYieldUom = selectedSp?.usageUom ?? '';

  const totalBatchCost = selectedLines.reduce((sum, l) => {
    const effQty = calcEffQty(l.qtyPerBatch, 100);
    return sum + effQty * getActiveCost(l.ingredientSkuId);
  }, 0);
  const totalCostPerUnit = currentBatchYieldQty > 0 ? totalBatchCost / currentBatchYieldQty : 0;

  const filteredSpSkus = useMemo(() => {
    const q = spSearch.toLowerCase();
    return spSkus.filter(s =>
      s.skuId.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)
    );
  }, [spSkus, spSearch]);

  // Summary: how many SP items have BOM set up
  const spWithBom = useMemo(() => spSkus.filter(s => spBomData.getLinesForSp(s.id).length > 0).length, [spSkus, spBomData]);

  // Sync SP BOM price
  const syncSpPrice = async () => {
    if (!selectedSpId || totalCostPerUnit <= 0) return;
    const sku = getSkuById(selectedSpId);
    await syncBomPrice(selectedSpId, totalCostPerUnit);
    toast.success(`SP BOM saved · ${sku?.skuId} price updated to ฿${totalCostPerUnit.toFixed(4)}/unit`);
    onPricesRefresh?.();
  };

  const formUom = formSkuId ? (getSkuById(formSkuId)?.usageUom ?? '') : '';

  const startAddLine = () => {
    setFormSkuId('');
    setFormQty(0);
    setFormYieldPct(100);
    setAddingLine(true);
    setEditingLineId(null);
  };

  const startEditLine = (line: SpBomLine) => {
    setFormSkuId(line.ingredientSkuId);
    setFormQty(line.qtyPerBatch);
    setFormYieldPct(100);
    setEditingLineId(line.id);
    setAddingLine(false);
  };

  const handleSkuChange = (id: string) => {
    setFormSkuId(id);
  };

  const saveLine = async () => {
    if (!formSkuId || !selectedSpId) { toast.error('Select a SKU'); return; }
    if (formQty <= 0) { toast.error('Qty must be > 0'); return; }

    const effQty = calcEffQty(formQty, formYieldPct);
    const costPerUnit = currentBatchYieldQty > 0 ? (effQty * getActiveCost(formSkuId)) / currentBatchYieldQty : 0;

    if (editingLineId) {
      await spBomData.updateLine(editingLineId, {
        ingredientSkuId: formSkuId,
        qtyPerBatch: formQty,
        uom: formUom,
        costPerUnit,
      });
      toast.success('Ingredient updated');
      setEditingLineId(null);
    } else {
      await spBomData.addLine({
        spSkuId: selectedSpId,
        ingredientSkuId: formSkuId,
        qtyPerBatch: formQty,
        uom: formUom,
        batchYieldQty: currentBatchYieldQty,
        batchYieldUom: currentBatchYieldUom,
        costPerUnit,
      });
      toast.success('Ingredient added');
      setFormSkuId('');
      setFormQty(0);
      setFormYieldPct(100);
    }
    setTimeout(() => syncSpPrice(), 300);
  };

  const cancelEdit = () => {
    setAddingLine(false);
    setEditingLineId(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') cancelEdit();
  };

  const startEditYield = () => {
    setYieldQty(currentBatchYieldQty);
    setEditingYield(true);
  };

  const saveYield = async () => {
    if (!selectedSpId) return;
    if (yieldQty <= 0) { toast.error('Yield qty must be > 0'); return; }
    await spBomData.updateBatchYield(selectedSpId, yieldQty, currentBatchYieldUom);
    setEditingYield(false);
    toast.success('Batch yield updated');
    setTimeout(() => syncSpPrice(), 300);
  };

  // CSV import
  const validateCsv = useCallback((rows: Record<string, string>[]) => {
    const valid: Record<string, string>[] = [];
    const errors: CSVValidationError[] = [];
    let skipped = 0;

    // Track which sp_codes already have BOM
    const spCodesWithBom = new Set<string>();
    spSkus.forEach(sp => {
      if (spBomData.getLinesForSp(sp.id).length > 0) {
        spCodesWithBom.add(sp.skuId);
      }
    });

    rows.forEach((row, i) => {
      const rowNum = i + 2;
      const spCode = (row['sp_code'] ?? '').trim();
      const skuCode = (row['sku_code'] ?? '').trim();
      const qtyStr = (row['qty'] ?? '').trim();
      const batchYieldStr = (row['batch_yield_qty'] ?? '').trim();

      if (!spCode) { errors.push({ row: rowNum, message: 'sp_code is required' }); return; }
      if (!skuCode) { errors.push({ row: rowNum, message: 'sku_code is required' }); return; }
      if (!qtyStr) { errors.push({ row: rowNum, message: 'qty is required' }); return; }
      if (!batchYieldStr) { errors.push({ row: rowNum, message: 'batch_yield_qty is required' }); return; }

      const spSku = getSkuByCode(spCode);
      if (!spSku || spSku.type !== 'SP') { errors.push({ row: rowNum, message: `SP SKU "${spCode}" not found` }); return; }

      const ingredientSku = getSkuByCode(skuCode);
      if (!ingredientSku) { errors.push({ row: rowNum, message: `SKU "${skuCode}" not found` }); return; }

      const qty = Number(qtyStr);
      if (isNaN(qty) || qty <= 0) { errors.push({ row: rowNum, message: 'qty must be a positive number' }); return; }

      const batchYield = Number(batchYieldStr);
      if (isNaN(batchYield) || batchYield <= 0) { errors.push({ row: rowNum, message: 'batch_yield_qty must be a positive number' }); return; }

      // Add warning for existing BOM (shown in errors list as info)
      if (spCodesWithBom.has(spCode)) {
        errors.push({ row: rowNum, message: `⚠️ "${spCode}" has existing BOM — will be replaced` });
      }

      valid.push(row);
    });

    return { valid, errors, skipped };
  }, [skus, spSkus, spBomData]);

  const handleCsvImport = useCallback(async (rows: Record<string, string>[]) => {
    // Group rows by sp_code
    const grouped: Record<string, Record<string, string>[]> = {};
    rows.forEach(row => {
      const spCode = (row['sp_code'] ?? '').trim();
      if (!grouped[spCode]) grouped[spCode] = [];
      grouped[spCode].push(row);
    });

    let spCount = 0;
    let rowCount = 0;
    let failCount = 0;

    for (const [spCode, spRows] of Object.entries(grouped)) {
      const spSku = getSkuByCode(spCode);
      if (!spSku) { failCount += spRows.length; continue; }

      // Delete existing lines for this SP
      const existing = spBomData.getLinesForSp(spSku.id);
      for (const line of existing) {
        await spBomData.deleteLine(line.id);
      }

      const batchYieldQty = Number((spRows[0]['batch_yield_qty'] ?? '1').trim()) || 1;
      const batchYieldUom = spSku.usageUom;

      // Update batch yield
      if (spRows.length > 0) {
        await spBomData.updateBatchYield(spSku.id, batchYieldQty, batchYieldUom);
      }

      for (const row of spRows) {
        const ingredientSku = getSkuByCode((row['sku_code'] ?? '').trim());
        if (!ingredientSku) { failCount++; continue; }

        const qty = Number((row['qty'] ?? '0').trim()) || 0;
        const yieldPct = Number((row['yield_pct'] ?? '100').trim()) || 100;
        const effQty = calcEffQty(qty, yieldPct);
        const unitCost = getActiveCost(ingredientSku.id);
        const costPerUnit = batchYieldQty > 0 ? (effQty * unitCost) / batchYieldQty : 0;

        await spBomData.addLine({
          spSkuId: spSku.id,
          ingredientSkuId: ingredientSku.id,
          qtyPerBatch: qty,
          uom: ingredientSku.usageUom,
          batchYieldQty,
          batchYieldUom,
          costPerUnit,
        });
        rowCount++;
      }

      // Sync price for this SP
      const totalCost = spRows.reduce((sum, row) => {
        const ingredientSku = getSkuByCode((row['sku_code'] ?? '').trim());
        if (!ingredientSku) return sum;
        const qty = Number((row['qty'] ?? '0').trim()) || 0;
        const yieldPct = Number((row['yield_pct'] ?? '100').trim()) || 100;
        return sum + calcEffQty(qty, yieldPct) * getActiveCost(ingredientSku.id);
      }, 0);
      if (batchYieldQty > 0 && totalCost > 0) {
        await syncBomPrice(spSku.id, totalCost / batchYieldQty);
      }

      spCount++;
    }

    toast.success(`Imported: ${spCount} SP items, ${rowCount} rows inserted${failCount > 0 ? `, ${failCount} failed` : ''}`);
    onPricesRefresh?.();
  }, [skus, spBomData, prices, onPricesRefresh]);

  const previewEffQty = calcEffQty(formQty, formYieldPct);
  const previewLineCost = previewEffQty * getActiveCost(formSkuId);

  const renderInlineRow = () => (
    <TableRow className="bg-muted/30 h-9" onKeyDown={handleKeyDown}>
      <TableCell className="py-1 px-2">
        <SearchableSelect
          value={formSkuId}
          onValueChange={handleSkuChange}
          options={rmSkus.map(s => ({ value: s.id, label: `${s.skuId} — ${s.name}`, sublabel: s.skuId }))}
          placeholder="Select RM SKU"
          triggerClassName="h-8 text-xs w-full"
        />
      </TableCell>
      <TableCell className="text-[13px] text-muted-foreground truncate overflow-hidden py-1 px-2">
        {formSkuId ? getSkuById(formSkuId)?.name : '—'}
      </TableCell>
      <TableCell className="py-1 px-2">
        <Input type="number" className="h-8 w-full text-xs text-right font-mono" value={formQty || ''}
          onChange={e => setFormQty(Number(e.target.value))} />
      </TableCell>
      <TableCell className="text-[13px] text-muted-foreground py-1 px-2">{formUom || '—'}</TableCell>
      <TableCell className="py-1 px-2">
        <Input type="number" className="h-8 w-full text-xs text-right font-mono" value={formYieldPct}
          onChange={e => setFormYieldPct(Number(e.target.value) || 100)} />
      </TableCell>
      <TableCell className="text-[13px] text-right font-mono py-1 px-2">{formSkuId ? previewEffQty.toFixed(2) : '—'}</TableCell>
      <TableCell className="text-[13px] text-right font-mono py-1 px-2">
        {formSkuId ? (() => {
          const c = getActiveCost(formSkuId);
          return c > 0 ? `฿${c.toFixed(4)}` : <span className="text-orange-500">—</span>;
        })() : '—'}
      </TableCell>
      <TableCell className="text-[13px] text-right font-mono font-medium py-1 px-2">
        {formSkuId && previewLineCost > 0 ? `฿${previewLineCost.toFixed(2)}` : formSkuId ? <span className="text-orange-500">—</span> : '—'}
      </TableCell>
      <TableCell className="py-1 px-2">
        <div className="flex gap-1">
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={saveLine}><Check className="w-3.5 h-3.5 text-green-600" /></Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={cancelEdit}><X className="w-3.5 h-3.5" /></Button>
        </div>
      </TableCell>
    </TableRow>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-heading font-bold">SP BOM</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Bill of Materials for Special items — ingredients and costing</p>
        </div>
        {canEdit && (
          <Button variant="outline" size="sm" onClick={() => setCsvOpen(true)}>
            <Upload className="w-4 h-4" /> Import CSV
          </Button>
        )}
      </div>

      <div className={`grid gap-4 ${fullscreen ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-[320px_1fr]'}`}>
        {/* Left panel */}
        {!fullscreen && (
          <Card className="h-fit max-h-[calc(100vh-200px)] flex flex-col">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">SP Items</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">{spWithBom} of {spSkus.length} items have BOM</p>
              <div className="relative mt-2">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search SP items..."
                  value={spSearch}
                  onChange={e => setSpSearch(e.target.value)}
                  className="pl-9 h-9 text-sm"
                />
              </div>
            </CardHeader>
            <CardContent className="flex-1 overflow-auto p-0">
              <div className="divide-y">
                {filteredSpSkus.map(s => {
                  const lineCount = spBomData.getLinesForSp(s.id).length;
                  const batchYield = spBomData.getLinesForSp(s.id)[0]?.batchYieldQty ?? 1;
                  const hasBom = lineCount > 0;
                  return (
                    <button
                      key={s.id}
                      onClick={() => { setSelectedSpId(s.id); setEditingYield(false); cancelEdit(); }}
                      className={`w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors ${
                        selectedSpId === s.id ? 'bg-primary/5 border-l-2 border-primary' : ''
                      } ${!hasBom ? 'bg-orange-50/60 dark:bg-orange-950/10' : ''}`}
                    >
                      <p className="text-sm font-medium flex items-center gap-1.5">
                        {!hasBom && <span className="text-orange-500">⚠️</span>}
                        {s.skuId} · {s.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {lineCount} ingredients {lineCount > 0 && <span>· {batchYield} {s.usageUom}</span>}
                      </p>
                    </button>
                  );
                })}
                {filteredSpSkus.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-6">No SP items found</p>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Right panel */}
        <div className="space-y-4">
          {!selectedSp ? (
            <Card>
              <CardContent className="py-16 flex flex-col items-center justify-center gap-3">
                <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center">
                  <Package className="w-7 h-7 text-muted-foreground" />
                </div>
                <p className="font-medium">Select an SP item from the left to view its BOM</p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Header */}
              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-xl font-heading font-bold">{selectedSp.name}</h3>
                      <p className="text-[13px] text-muted-foreground mt-0.5">{selectedSp.skuId} · SP BOM</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-center p-3 rounded-lg bg-muted/50 min-w-[120px]">
                        <p className="text-[11px] uppercase text-muted-foreground">Batch Yield</p>
                        <p className="text-lg font-bold font-mono">{currentBatchYieldQty} {currentBatchYieldUom || <span className="text-orange-500 text-xs">⚠️</span>}</p>
                      </div>
                      <div className="text-center p-3 rounded-lg bg-primary/10 min-w-[120px]">
                        <p className="text-[11px] uppercase text-muted-foreground flex items-center justify-center gap-1">
                          <DollarSign className="w-3 h-3" /> Cost/Unit
                        </p>
                        <p className="text-lg font-bold text-primary font-mono">฿{totalCostPerUnit.toFixed(4)}</p>
                      </div>
                      <div className="flex flex-col gap-1">
                        {canEdit && (
                          <Button size="sm" variant="outline" onClick={startEditYield}>
                            <Edit2 className="w-3.5 h-3.5" /> Edit Yield
                          </Button>
                        )}
                        <Button size="sm" variant="outline" onClick={() => setFullscreen(!fullscreen)}>
                          {fullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                        </Button>
                      </div>
                    </div>
                  </div>

                  {/* Batch yield editor — UOM is read-only from SP SKU */}
                  {editingYield && canEdit && (
                    <div className="flex items-center gap-2 text-sm border-t pt-3 mt-3">
                      <span className="text-muted-foreground font-medium">1 batch produces</span>
                      <Input type="number" min={0.01} step="any" value={yieldQty || ''} onChange={e => setYieldQty(Number(e.target.value))} className="h-8 w-20 text-sm" />
                      <span className="text-sm text-muted-foreground font-medium">{currentBatchYieldUom || '—'}</span>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={saveYield}><Check className="w-3.5 h-3.5 text-green-600" /></Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditingYield(false)}><X className="w-3.5 h-3.5" /></Button>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Ingredients table */}
              <Card>
                <CardContent className="p-0 overflow-hidden">
                  <Table className="table-fixed">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-[11px] uppercase text-muted-foreground px-2" style={{ width: 120 }}>SKU Code</TableHead>
                        <TableHead className="text-[11px] uppercase text-muted-foreground px-2">Name</TableHead>
                        <TableHead className="text-[11px] uppercase text-muted-foreground text-right px-2" style={{ width: 80 }}>Qty/Batch</TableHead>
                        <TableHead className="text-[11px] uppercase text-muted-foreground px-2" style={{ width: 60 }}>UOM</TableHead>
                        <TableHead className="text-[11px] uppercase text-muted-foreground text-right px-2" style={{ width: 70 }}>Yield %</TableHead>
                        <TableHead className="text-[11px] uppercase text-muted-foreground text-right px-2" style={{ width: 80 }}>Eff. Qty</TableHead>
                        <TableHead className="text-[11px] uppercase text-muted-foreground text-right px-2" style={{ width: 90 }}>Cost/unit</TableHead>
                        <TableHead className="text-[11px] uppercase text-muted-foreground text-right px-2" style={{ width: 90 }}>Line Cost</TableHead>
                        {canEdit && <TableHead className="text-[11px] uppercase text-muted-foreground px-2" style={{ width: 70 }}></TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {selectedLines.length === 0 && !addingLine && (
                        <TableRow>
                          <TableCell colSpan={canEdit ? 9 : 8} className="py-16">
                            <div className="flex flex-col items-center justify-center gap-3">
                              <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center">
                                <Package className="w-7 h-7 text-muted-foreground" />
                              </div>
                              <p className="font-medium">No ingredients added yet</p>
                              {canEdit && (
                                <Button
                                  variant="outline"
                                  className="border-dashed border-2 text-orange-600 hover:text-orange-700 hover:bg-orange-50 dark:hover:bg-orange-950/20"
                                  onClick={startAddLine}
                                >
                                  <Plus className="w-4 h-4" /> Add First Ingredient
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                      {selectedLines.map(line => {
                        const sku = getSkuById(line.ingredientSkuId);
                        const unitPrice = getActiveCost(line.ingredientSkuId);
                        const effQty = line.qtyPerBatch;
                        const lineCost = effQty * unitPrice;
                        if (editingLineId === line.id) return <>{renderInlineRow()}</>;
                        return (
                          <TableRow key={line.id} className="h-9">
                            <TableCell className="text-[13px] font-mono py-1 px-2">
                              {sku?.skuId ?? '—'}
                            </TableCell>
                            <TableCell className="text-[13px] truncate overflow-hidden py-1 px-2" title={sku?.name ?? '—'}>
                              {sku?.name ?? '—'}
                            </TableCell>
                            <TableCell className="text-[13px] text-right font-mono py-1 px-2">{line.qtyPerBatch}</TableCell>
                            <TableCell className="text-[13px] text-muted-foreground py-1 px-2">{sku?.usageUom ?? line.uom}</TableCell>
                            <TableCell className="text-[13px] text-right font-mono py-1 px-2">100%</TableCell>
                            <TableCell className="text-[13px] text-right font-mono py-1 px-2">{effQty.toFixed(2)}</TableCell>
                            <TableCell className="text-[13px] text-right font-mono py-1 px-2">
                              {unitPrice > 0 ? `฿${unitPrice.toFixed(4)}` : <span className="text-orange-500">—</span>}
                            </TableCell>
                            <TableCell className="text-[13px] text-right font-mono font-medium py-1 px-2">
                              {(() => {
                                const liveLineCost = effQty * getActiveCost(line.ingredientSkuId);
                                return liveLineCost > 0 ? `฿${liveLineCost.toFixed(2)}` : <span className="text-orange-500">—</span>;
                              })()}
                            </TableCell>
                            {canEdit && (
                              <TableCell className="py-1 px-2">
                                <div className="flex gap-1">
                                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => startEditLine(line)}>
                                    <Edit2 className="w-3.5 h-3.5" />
                                  </Button>
                                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setDeleteConfirm({ id: line.id, name: sku?.name ?? 'ingredient' })}>
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </Button>
                                </div>
                              </TableCell>
                            )}
                          </TableRow>
                        );
                      })}
                      {addingLine && renderInlineRow()}
                    </TableBody>
                  </Table>
                  {/* Add button at bottom */}
                  {canEdit && selectedLines.length > 0 && !addingLine && !editingLineId && (
                    <div className="p-4 pt-2">
                      <Button
                        variant="outline"
                        className="w-full border-dashed border-2 text-orange-600 hover:text-orange-700 hover:bg-orange-50 dark:hover:bg-orange-950/20"
                        onClick={startAddLine}
                      >
                        <Plus className="w-4 h-4" /> Add Ingredient
                      </Button>
                    </div>
                  )}
                  {/* Totals */}
                  {totalBatchCost > 0 && (
                    <div className="border-t px-6 py-3 flex justify-end gap-6">
                      <p className="text-sm">Total cost/batch: <span className="font-bold font-mono text-primary">฿{totalBatchCost.toFixed(2)}</span></p>
                      <p className="text-sm">Cost/unit: <span className="font-bold font-mono text-primary">฿{totalCostPerUnit.toFixed(4)}</span></p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!deleteConfirm}
        onOpenChange={open => !open && setDeleteConfirm(null)}
        title="Remove Ingredient"
        description={`Remove "${deleteConfirm?.name}" from this SP's BOM?`}
        confirmLabel="Remove"
        onConfirm={async () => {
          if (deleteConfirm) {
            await spBomData.deleteLine(deleteConfirm.id);
            toast.success('Ingredient removed');
            setDeleteConfirm(null);
            setTimeout(() => syncSpPrice(), 300);
          }
        }}
      />

      {/* CSV Import Modal */}
      <CSVImportModal
        open={csvOpen}
        onClose={() => setCsvOpen(false)}
        title="SP BOM"
        columns={CSV_COLUMNS}
        validate={validateCsv}
        onConfirm={handleCsvImport}
      />
    </div>
  );
}
