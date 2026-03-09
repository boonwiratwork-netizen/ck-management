import { useState, useMemo } from 'react';
import { SpBomLine } from '@/types/sp-bom';
import { SKU } from '@/types/sku';
import { Price } from '@/types/price';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SearchableSelect } from '@/components/SearchableSelect';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Plus, Trash2, Edit2, Search, Package, DollarSign, Check, X, Maximize2, Minimize2 } from 'lucide-react';
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

export default function SpBomPage({ spBomData, skus, prices, readOnly = false, onPricesRefresh }: SpBomPageProps) {
  const { isManagement } = useAuth();
  const canEdit = isManagement && !readOnly;

  const [selectedSpId, setSelectedSpId] = useState<string | null>(null);
  const [spSearch, setSpSearch] = useState('');
  const [fullscreen, setFullscreen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);

  // Batch yield editing
  const [editingYield, setEditingYield] = useState(false);
  const [yieldQty, setYieldQty] = useState(1);
  const [yieldUom, setYieldUom] = useState('');

  // Inline editing state
  const [addingLine, setAddingLine] = useState(false);
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [formSkuId, setFormSkuId] = useState('');
  const [formQty, setFormQty] = useState(0);
  const [formUom, setFormUom] = useState('');
  const [formYieldPct, setFormYieldPct] = useState(100);

  const spSkus = useMemo(() => skus.filter(s => s.type === 'SP'), [skus]);
  const rmSkus = useMemo(() => skus.filter(s => s.type === 'RM'), [skus]);

  const getSkuById = (id: string) => skus.find(s => s.id === id);

  const getActiveCost = (skuId: string): number => {
    const active = prices.find(p => p.skuId === skuId && p.isActive);
    return active?.pricePerUsageUom ?? 0;
  };

  const calcEffQty = (qty: number, yieldPct: number) => yieldPct > 0 ? qty / (yieldPct / 100) : qty;

  const selectedSp = spSkus.find(s => s.id === selectedSpId) ?? null;
  const selectedLines = selectedSpId ? spBomData.getLinesForSp(selectedSpId) : [];

  const currentBatchYieldQty = selectedLines.length > 0 ? selectedLines[0].batchYieldQty : 1;
  const currentBatchYieldUom = selectedLines.length > 0 ? selectedLines[0].batchYieldUom : '';

  const totalBatchCost = selectedLines.reduce((sum, l) => {
    const effQty = calcEffQty(l.qtyPerBatch, 100); // SP BOM lines didn't have yield% before, use 100
    return sum + effQty * getActiveCost(l.ingredientSkuId);
  }, 0);
  const totalCostPerUnit = currentBatchYieldQty > 0 ? totalBatchCost / currentBatchYieldQty : 0;

  const filteredSpSkus = useMemo(() => {
    const q = spSearch.toLowerCase();
    return spSkus.filter(s =>
      s.skuId.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)
    );
  }, [spSkus, spSearch]);

  // Sync SP BOM price
  const syncSpPrice = async () => {
    if (!selectedSpId || totalCostPerUnit <= 0) return;
    const sku = getSkuById(selectedSpId);
    await syncBomPrice(selectedSpId, totalCostPerUnit);
    toast.success(`SP BOM saved · ${sku?.skuId} price updated to ฿${totalCostPerUnit.toFixed(4)}/unit`);
    onPricesRefresh?.();
  };

  const startAddLine = () => {
    setFormSkuId('');
    setFormQty(0);
    setFormUom('');
    setFormYieldPct(100);
    setAddingLine(true);
    setEditingLineId(null);
  };

  const startEditLine = (line: SpBomLine) => {
    setFormSkuId(line.ingredientSkuId);
    setFormQty(line.qtyPerBatch);
    setFormUom(line.uom);
    setFormYieldPct(100);
    setEditingLineId(line.id);
    setAddingLine(false);
  };

  const handleSkuChange = (id: string) => {
    setFormSkuId(id);
    const sku = getSkuById(id);
    if (sku) setFormUom(sku.usageUom);
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
      // Auto-continue
      setFormSkuId('');
      setFormQty(0);
      setFormUom('');
      setFormYieldPct(100);
    }
    // Sync price
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
    setYieldUom(currentBatchYieldUom);
    setEditingYield(true);
  };

  const saveYield = async () => {
    if (!selectedSpId) return;
    if (yieldQty <= 0) { toast.error('Yield qty must be > 0'); return; }
    if (!yieldUom.trim()) { toast.error('UOM is required'); return; }
    await spBomData.updateBatchYield(selectedSpId, yieldQty, yieldUom);
    setEditingYield(false);
    toast.success('Batch yield updated');
    setTimeout(() => syncSpPrice(), 300);
  };

  const previewEffQty = calcEffQty(formQty, formYieldPct);
  const previewLineCost = previewEffQty * getActiveCost(formSkuId);

  const renderInlineRow = () => (
    <TableRow className="bg-muted/30 h-12" onKeyDown={handleKeyDown}>
      <TableCell>
        <SearchableSelect
          value={formSkuId}
          onValueChange={handleSkuChange}
          options={rmSkus.map(s => ({ value: s.id, label: `${s.skuId} — ${s.name}`, sublabel: s.skuId }))}
          placeholder="Select RM SKU"
          triggerClassName="h-8 text-xs w-full"
        />
      </TableCell>
      <TableCell className="text-xs text-muted-foreground truncate overflow-hidden">
        {formSkuId ? getSkuById(formSkuId)?.name : '—'}
      </TableCell>
      <TableCell>
        <Input type="number" className="h-8 w-full text-xs text-right font-mono" value={formQty || ''}
          onChange={e => setFormQty(Number(e.target.value))} />
      </TableCell>
      <TableCell>
        <Input className="h-8 w-full text-xs" value={formUom}
          onChange={e => setFormUom(e.target.value)} />
      </TableCell>
      <TableCell>
        <Input type="number" className="h-8 w-full text-xs text-right font-mono" value={formYieldPct}
          onChange={e => setFormYieldPct(Number(e.target.value) || 100)} />
      </TableCell>
      <TableCell className="text-xs text-right font-mono">{formSkuId ? previewEffQty.toFixed(2) : '—'}</TableCell>
      <TableCell className="text-xs text-right font-mono">
        {formSkuId ? (() => {
          const c = getActiveCost(formSkuId);
          return c > 0 ? `฿${c.toFixed(4)}` : <span className="text-orange-500">—</span>;
        })() : '—'}
      </TableCell>
      <TableCell className="text-xs text-right font-mono font-medium">
        {formSkuId && previewLineCost > 0 ? `฿${previewLineCost.toFixed(2)}` : formSkuId ? <span className="text-orange-500">—</span> : '—'}
      </TableCell>
      <TableCell>
        <div className="flex gap-1">
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={saveLine}><Check className="w-3.5 h-3.5 text-green-600" /></Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={cancelEdit}><X className="w-3.5 h-3.5" /></Button>
        </div>
      </TableCell>
    </TableRow>
  );

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-heading font-bold">SP BOM</h2>
        <p className="text-sm text-muted-foreground mt-0.5">Bill of Materials for Special items — ingredients and costing</p>
      </div>

      <div className={`grid gap-4 ${fullscreen ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-[320px_1fr]'}`}>
        {/* Left panel */}
        {!fullscreen && (
          <Card className="h-fit max-h-[calc(100vh-200px)] flex flex-col">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">SP Items</CardTitle>
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
                  const batchUom = spBomData.getLinesForSp(s.id)[0]?.batchYieldUom ?? '';
                  return (
                    <button
                      key={s.id}
                      onClick={() => { setSelectedSpId(s.id); setEditingYield(false); cancelEdit(); }}
                      className={`w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors ${
                        selectedSpId === s.id ? 'bg-primary/5 border-l-2 border-primary' : ''
                      }`}
                    >
                      <p className="text-sm font-medium">{s.skuId} · {s.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {lineCount} ingredients {lineCount > 0 && <span>· {batchYield} {batchUom}</span>}
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

                  {/* Batch yield editor */}
                  {editingYield && canEdit && (
                    <div className="flex items-center gap-2 text-sm border-t pt-3 mt-3">
                      <span className="text-muted-foreground font-medium">1 batch produces</span>
                      <Input type="number" min={0.01} step="any" value={yieldQty || ''} onChange={e => setYieldQty(Number(e.target.value))} className="h-8 w-20 text-sm" />
                      <Input value={yieldUom} onChange={e => setYieldUom(e.target.value)} placeholder="e.g. ฟอง, g" className="h-8 w-32 text-sm" />
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={saveYield}><Check className="w-3.5 h-3.5 text-green-600" /></Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditingYield(false)}><X className="w-3.5 h-3.5" /></Button>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Ingredients table */}
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-[11px] uppercase text-muted-foreground">SKU Code</TableHead>
                        <TableHead className="text-[11px] uppercase text-muted-foreground">Name</TableHead>
                        <TableHead className="text-[11px] uppercase text-muted-foreground text-right">Qty/Batch</TableHead>
                        <TableHead className="text-[11px] uppercase text-muted-foreground">UOM</TableHead>
                        <TableHead className="text-[11px] uppercase text-muted-foreground text-right">Yield %</TableHead>
                        <TableHead className="text-[11px] uppercase text-muted-foreground text-right">Eff. Qty</TableHead>
                        <TableHead className="text-[11px] uppercase text-muted-foreground text-right">Cost/unit</TableHead>
                        <TableHead className="text-[11px] uppercase text-muted-foreground text-right">Line Cost</TableHead>
                        {canEdit && <TableHead className="text-[11px] uppercase text-muted-foreground w-20"></TableHead>}
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
                        const effQty = line.qtyPerBatch; // treat yield=100% for existing lines
                        const lineCost = effQty * unitPrice;
                        const costPerUnit = currentBatchYieldQty > 0 ? lineCost / currentBatchYieldQty : 0;
                        if (editingLineId === line.id) return <>{renderInlineRow()}</>;
                        return (
                          <TableRow key={line.id} className="h-12">
                            <TableCell className="text-sm font-mono">
                              {sku?.skuId ?? '—'}
                              <Badge variant="outline" className="text-[10px] ml-1">RM</Badge>
                            </TableCell>
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <TableCell className="text-sm max-w-[120px] truncate">{sku?.name ?? '—'}</TableCell>
                                </TooltipTrigger>
                                <TooltipContent>{sku?.name}</TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                            <TableCell className="text-sm text-right font-mono">{line.qtyPerBatch}</TableCell>
                            <TableCell className="text-sm">{line.uom}</TableCell>
                            <TableCell className="text-sm text-right font-mono">100%</TableCell>
                            <TableCell className="text-sm text-right font-mono">{effQty.toFixed(2)}</TableCell>
                            <TableCell className="text-sm text-right font-mono">
                              {unitPrice > 0 ? `฿${unitPrice.toFixed(4)}` : <span className="text-orange-500">—</span>}
                            </TableCell>
                            <TableCell className="text-sm text-right font-mono font-medium">
                              {lineCost > 0 ? `฿${lineCost.toFixed(2)}` : <span className="text-orange-500">—</span>}
                            </TableCell>
                            {canEdit && (
                              <TableCell>
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
    </div>
  );
}
