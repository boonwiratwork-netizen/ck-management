import { useState, useMemo } from 'react';
import { SpBomLine } from '@/types/sp-bom';
import { SKU } from '@/types/sku';
import { Price } from '@/types/price';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, Edit2, Search, Package, DollarSign, Check, X } from 'lucide-react';
import { toast } from 'sonner';

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
}

export default function SpBomPage({ spBomData, skus, prices, readOnly = false }: SpBomPageProps) {
  const { isManagement } = useAuth();
  const canEdit = isManagement && !readOnly;

  const [selectedSpId, setSelectedSpId] = useState<string | null>(null);
  const [spSearch, setSpSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingLine, setEditingLine] = useState<SpBomLine | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);

  // Batch yield editing
  const [editingYield, setEditingYield] = useState(false);
  const [yieldQty, setYieldQty] = useState(1);
  const [yieldUom, setYieldUom] = useState('');

  // Form state
  const [formSkuId, setFormSkuId] = useState('');
  const [formQty, setFormQty] = useState(0);
  const [formUom, setFormUom] = useState('');
  const [skuSearch, setSkuSearch] = useState('');

  // SP SKUs only
  const spSkus = useMemo(() => skus.filter(s => s.type === 'SP'), [skus]);
  // RM SKUs for ingredients
  const rmSkus = useMemo(() => skus.filter(s => s.type === 'RM'), [skus]);

  const getSkuById = (id: string) => skus.find(s => s.id === id);

  const getActiveCost = (skuId: string): number => {
    const active = prices.find(p => p.skuId === skuId && p.isActive);
    return active?.pricePerUsageUom ?? 0;
  };

  // Selected SP
  const selectedSp = spSkus.find(s => s.id === selectedSpId) ?? null;
  const selectedLines = selectedSpId ? spBomData.getLinesForSp(selectedSpId) : [];

  // Get batch yield from first line or defaults
  const currentBatchYieldQty = selectedLines.length > 0 ? selectedLines[0].batchYieldQty : 1;
  const currentBatchYieldUom = selectedLines.length > 0 ? selectedLines[0].batchYieldUom : '';

  const calcCostPerUnit = (qtyPerBatch: number, ingredientSkuId: string, batchYield: number) => {
    if (batchYield <= 0) return 0;
    return (qtyPerBatch * getActiveCost(ingredientSkuId)) / batchYield;
  };

  const totalCostPerUnit = selectedLines.reduce((sum, l) => {
    const cost = (l.qtyPerBatch * getActiveCost(l.ingredientSkuId)) / (currentBatchYieldQty || 1);
    return sum + cost;
  }, 0);

  // Filter SP list
  const filteredSpSkus = useMemo(() => {
    const q = spSearch.toLowerCase();
    return spSkus.filter(s =>
      s.skuId.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)
    );
  }, [spSkus, spSearch]);

  const openAddModal = () => {
    setEditingLine(null);
    setFormSkuId('');
    setFormQty(0);
    setFormUom('');
    setSkuSearch('');
    setModalOpen(true);
  };

  const openEditModal = (line: SpBomLine) => {
    setEditingLine(line);
    setFormSkuId(line.ingredientSkuId);
    setFormQty(line.qtyPerBatch);
    setFormUom(line.uom);
    setSkuSearch('');
    setModalOpen(true);
  };

  const handleSkuChange = (id: string) => {
    setFormSkuId(id);
    const sku = getSkuById(id);
    if (sku) setFormUom(sku.usageUom);
  };

  const previewCostPerUnit = calcCostPerUnit(formQty, formSkuId, currentBatchYieldQty);

  const handleSubmit = async () => {
    if (!formSkuId || !selectedSpId) { toast.error('Please select a SKU'); return; }
    if (formQty <= 0) { toast.error('Quantity must be > 0'); return; }

    const costPerUnit = calcCostPerUnit(formQty, formSkuId, currentBatchYieldQty);

    if (editingLine) {
      await spBomData.updateLine(editingLine.id, {
        ingredientSkuId: formSkuId,
        qtyPerBatch: formQty,
        uom: formUom,
        costPerUnit,
      });
      toast.success('Ingredient updated');
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
    }
    setModalOpen(false);
  };

  const startEditYield = () => {
    setYieldQty(currentBatchYieldQty);
    setYieldUom(currentBatchYieldUom);
    setEditingYield(true);
  };

  const saveYield = async () => {
    if (!selectedSpId) return;
    if (yieldQty <= 0) { toast.error('Yield qty must be > 0'); return; }
    await spBomData.updateBatchYield(selectedSpId, yieldQty, yieldUom);
    setEditingYield(false);
    toast.success('Batch yield updated');
  };

  const filteredRmSkus = useMemo(() => {
    if (!skuSearch) return rmSkus;
    const q = skuSearch.toLowerCase();
    return rmSkus.filter(s => s.skuId.toLowerCase().includes(q) || s.name.toLowerCase().includes(q));
  }, [rmSkus, skuSearch]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-heading font-bold">SP BOM</h2>
        <p className="text-sm text-muted-foreground mt-0.5">Bill of Materials for Special items — ingredients and costing</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
        {/* Left panel: SP list */}
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
              {filteredSpSkus.map(s => (
                <button
                  key={s.id}
                  onClick={() => { setSelectedSpId(s.id); setEditingYield(false); }}
                  className={`w-full text-left px-4 py-2.5 hover:bg-muted/50 transition-colors ${
                    selectedSpId === s.id ? 'bg-primary/10 border-l-2 border-primary' : ''
                  }`}
                >
                  <p className="text-sm font-medium">{s.skuId}</p>
                  <p className="text-xs text-muted-foreground">{s.name}</p>
                </button>
              ))}
              {filteredSpSkus.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-6">No SP items found</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Right panel */}
        <div className="space-y-4">
          {!selectedSp ? (
            <Card>
              <CardContent className="py-16 text-center text-muted-foreground">
                <Package className="w-10 h-10 mx-auto mb-3 opacity-40" />
                <p>Select an SP item from the left to view its BOM</p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Header */}
              <Card>
                <CardContent className="py-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-heading font-bold">{selectedSp.name}</h3>
                      <p className="text-sm text-muted-foreground">{selectedSp.skuId}</p>
                    </div>
                    <div className="text-right">
                      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <DollarSign className="w-4 h-4" />
                        Total Cost / Unit
                      </div>
                      <p className="text-xl font-bold font-heading">฿{totalCostPerUnit.toFixed(2)}</p>
                    </div>
                  </div>

                  {/* Batch yield row */}
                  <div className="flex items-center gap-2 text-sm border-t pt-3">
                    <span className="text-muted-foreground">Batch yield:</span>
                    {editingYield && canEdit ? (
                      <>
                        <span className="text-muted-foreground">1 batch produces</span>
                        <Input
                          type="number"
                          min={0.01}
                          step="any"
                          value={yieldQty || ''}
                          onChange={e => setYieldQty(Number(e.target.value))}
                          className="h-7 w-20 text-sm"
                        />
                        <Input
                          value={yieldUom}
                          onChange={e => setYieldUom(e.target.value)}
                          placeholder="uom"
                          className="h-7 w-24 text-sm"
                        />
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={saveYield}>
                          <Check className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditingYield(false)}>
                          <X className="w-3.5 h-3.5" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <span className="font-medium">
                          1 batch produces {currentBatchYieldQty} {currentBatchYieldUom || '—'}
                        </span>
                        {canEdit && (
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={startEditYield}>
                            <Edit2 className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Add button */}
              {canEdit && (
                <div className="flex justify-end">
                  <Button size="sm" onClick={openAddModal}>
                    <Plus className="w-4 h-4" /> Add Ingredient
                  </Button>
                </div>
              )}

              {/* Ingredients table */}
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>SKU Code</TableHead>
                        <TableHead>SKU Name</TableHead>
                        <TableHead className="text-right">Qty/Batch</TableHead>
                        <TableHead>UOM</TableHead>
                        <TableHead className="text-right">Cost/Batch</TableHead>
                        <TableHead className="text-right">Cost/Unit</TableHead>
                        {canEdit && <TableHead className="w-20">Actions</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {selectedLines.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={canEdit ? 7 : 6} className="text-center text-muted-foreground py-8">
                            No ingredients yet
                          </TableCell>
                        </TableRow>
                      ) : (
                        selectedLines.map(line => {
                          const sku = getSkuById(line.ingredientSkuId);
                          const unitPrice = getActiveCost(line.ingredientSkuId);
                          const costPerBatch = line.qtyPerBatch * unitPrice;
                          const costPerUnit = currentBatchYieldQty > 0 ? costPerBatch / currentBatchYieldQty : 0;
                          return (
                            <TableRow key={line.id}>
                              <TableCell className="font-mono text-xs">{sku?.skuId ?? '—'}</TableCell>
                              <TableCell>{sku?.name ?? '—'}</TableCell>
                              <TableCell className="text-right">{line.qtyPerBatch}</TableCell>
                              <TableCell>{line.uom}</TableCell>
                              <TableCell className="text-right">฿{costPerBatch.toFixed(2)}</TableCell>
                              <TableCell className="text-right font-medium">฿{costPerUnit.toFixed(4)}</TableCell>
                              {canEdit && (
                                <TableCell>
                                  <div className="flex gap-1">
                                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditModal(line)}>
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
                        })
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>

      {/* Add/Edit Ingredient Modal */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingLine ? 'Edit Ingredient' : 'Add Ingredient'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">SKU (RM only)</label>
              <Select value={formSkuId} onValueChange={handleSkuChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Select RM SKU..." />
                </SelectTrigger>
                <SelectContent>
                  <div className="px-2 pb-2">
                    <Input
                      placeholder="Search SKU..."
                      value={skuSearch}
                      onChange={e => setSkuSearch(e.target.value)}
                      className="h-8 text-sm"
                      onClick={e => e.stopPropagation()}
                    />
                  </div>
                  {filteredRmSkus.map(s => (
                    <SelectItem key={s.id} value={s.id}>
                      <span className="font-mono text-xs mr-2">{s.skuId}</span>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Qty per Batch</label>
              <Input
                type="number"
                min={0}
                step="any"
                value={formQty || ''}
                onChange={e => setFormQty(Number(e.target.value))}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">UOM</label>
              <Input value={formUom} onChange={e => setFormUom(e.target.value)} placeholder="e.g. g, ml, egg" />
            </div>

            {/* Preview */}
            <div className="rounded-md bg-muted/50 p-3 space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Unit Price (active)</span>
                <span className="font-medium">฿{formSkuId ? getActiveCost(formSkuId).toFixed(4) : '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Cost / Batch</span>
                <span className="font-medium">฿{(formQty * (formSkuId ? getActiveCost(formSkuId) : 0)).toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Cost / Unit</span>
                <span className="font-bold">฿{previewCostPerUnit.toFixed(4)}</span>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit}>{editingLine ? 'Update' : 'Add'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
          }
        }}
      />
    </div>
  );
}
