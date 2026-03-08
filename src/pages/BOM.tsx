import { useState, useMemo } from 'react';
import { SKU } from '@/types/sku';
import { Price } from '@/types/price';
import { BOMHeader, BOMLine, EMPTY_BOM_HEADER, EMPTY_BOM_LINE } from '@/types/bom';
import { Supplier } from '@/types/supplier';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, Edit2, Check, X, ClipboardList, FlaskConical, DollarSign } from 'lucide-react';
import { toast } from 'sonner';

interface BOMPageProps {
  bomData: {
    headers: BOMHeader[];
    lines: BOMLine[];
    addHeader: (data: Omit<BOMHeader, 'id'>) => string;
    updateHeader: (id: string, data: Partial<Omit<BOMHeader, 'id'>>) => void;
    deleteHeader: (id: string) => void;
    addLine: (data: Omit<BOMLine, 'id'>) => void;
    updateLine: (id: string, data: Partial<Omit<BOMLine, 'id' | 'bomHeaderId'>>) => void;
    deleteLine: (id: string) => void;
    getLinesForHeader: (headerId: string) => BOMLine[];
  };
  skus: SKU[];
  prices: Price[];
}

const BOMPage = ({ bomData, skus, prices }: BOMPageProps) => {
  const { headers, addHeader, updateHeader, deleteHeader, addLine, updateLine, deleteLine, getLinesForHeader } = bomData;

  const [selectedHeaderId, setSelectedHeaderId] = useState<string | null>(null);
  const [editingHeader, setEditingHeader] = useState(false);
  const [headerForm, setHeaderForm] = useState(EMPTY_BOM_HEADER);
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [lineForm, setLineForm] = useState(EMPTY_BOM_LINE);
  const [addingLine, setAddingLine] = useState(false);

  const smSkus = useMemo(() => skus.filter(s => s.type === 'SM'), [skus]);
  const rmSkus = useMemo(() => skus.filter(s => s.type === 'RM'), [skus]);

  const getSkuName = (id: string) => skus.find(s => s.id === id)?.name ?? '—';
  const getSkuById = (id: string) => skus.find(s => s.id === id);
  const getSkuCode = (id: string) => skus.find(s => s.id === id)?.skuId ?? '';

  const getActiveCost = (rmSkuId: string): number => {
    const active = prices.find(p => p.skuId === rmSkuId && p.isActive);
    return active?.pricePerUsageUom ?? 0;
  };

  const selectedHeader = headers.find(h => h.id === selectedHeaderId) ?? null;
  const selectedLines = selectedHeaderId ? getLinesForHeader(selectedHeaderId) : [];

  const outputQty = selectedHeader ? selectedHeader.batchSize * selectedHeader.yieldPercent : 0;
  const totalCost = selectedLines.reduce((sum, l) => sum + l.qtyPerBatch * getActiveCost(l.rmSkuId), 0);
  const costPerGram = outputQty > 0 ? totalCost / outputQty : 0;

  // Header actions
  const handleAddHeader = () => {
    setHeaderForm(EMPTY_BOM_HEADER);
    setEditingHeader(true);
    setSelectedHeaderId(null);
  };

  const handleSaveHeader = () => {
    if (!headerForm.smSkuId) { toast.error('Select an SM SKU'); return; }
    const exists = headers.find(h => h.smSkuId === headerForm.smSkuId && h.id !== selectedHeaderId);
    if (exists) { toast.error('BOM already exists for this SM SKU'); return; }

    if (selectedHeaderId && selectedHeader) {
      updateHeader(selectedHeaderId, headerForm);
      toast.success('BOM updated');
    } else {
      const newId = addHeader(headerForm);
      setSelectedHeaderId(newId);
      toast.success('BOM created');
    }
    setEditingHeader(false);
  };

  const handleEditHeader = () => {
    if (!selectedHeader) return;
    setHeaderForm({
      smSkuId: selectedHeader.smSkuId,
      productionType: selectedHeader.productionType,
      batchSize: selectedHeader.batchSize,
      yieldPercent: selectedHeader.yieldPercent,
    });
    setEditingHeader(true);
  };

  const handleDeleteHeader = (id: string) => {
    deleteHeader(id);
    if (selectedHeaderId === id) setSelectedHeaderId(null);
    toast.success('BOM deleted');
  };

  // Line actions
  const handleStartAddLine = () => {
    setLineForm(EMPTY_BOM_LINE);
    setAddingLine(true);
    setEditingLineId(null);
  };

  const handleSaveLine = () => {
    if (!selectedHeaderId || !lineForm.rmSkuId) { toast.error('Select an RM SKU'); return; }
    if (addingLine) {
      addLine({ ...lineForm, bomHeaderId: selectedHeaderId });
      toast.success('Ingredient added');
      setAddingLine(false);
    } else if (editingLineId) {
      updateLine(editingLineId, { rmSkuId: lineForm.rmSkuId, qtyPerBatch: lineForm.qtyPerBatch });
      toast.success('Ingredient updated');
      setEditingLineId(null);
    }
  };

  const handleEditLine = (line: BOMLine) => {
    setLineForm({ rmSkuId: line.rmSkuId, qtyPerBatch: line.qtyPerBatch });
    setEditingLineId(line.id);
    setAddingLine(false);
  };

  const handleDeleteLine = (id: string) => {
    deleteLine(id);
    toast.success('Ingredient removed');
  };

  const cancelLineEdit = () => { setAddingLine(false); setEditingLineId(null); };

  // Inline editor row
  const renderLineEditor = (isNew: boolean) => (
    <TableRow className="bg-muted/30">
      <TableCell>
        <Select value={lineForm.rmSkuId} onValueChange={v => setLineForm(f => ({ ...f, rmSkuId: v }))}>
          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select RM" /></SelectTrigger>
          <SelectContent>
            {rmSkus.map(s => (
              <SelectItem key={s.id} value={s.id}>{s.skuId} — {s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">{lineForm.rmSkuId ? getSkuName(lineForm.rmSkuId) : '—'}</TableCell>
      <TableCell>
        <Input type="number" className="h-8 w-24 text-xs" value={lineForm.qtyPerBatch || ''} onChange={e => setLineForm(f => ({ ...f, qtyPerBatch: Number(e.target.value) }))} />
      </TableCell>
      <TableCell className="text-xs">{lineForm.rmSkuId ? getSkuById(lineForm.rmSkuId)?.usageUom : '—'}</TableCell>
      <TableCell className="text-xs text-right">{lineForm.rmSkuId ? getActiveCost(lineForm.rmSkuId).toFixed(2) : '—'}</TableCell>
      <TableCell className="text-xs text-right font-medium">
        {lineForm.rmSkuId ? (lineForm.qtyPerBatch * getActiveCost(lineForm.rmSkuId)).toFixed(2) : '—'}
      </TableCell>
      <TableCell>
        <div className="flex gap-1">
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={handleSaveLine}><Check className="w-3.5 h-3.5 text-green-600" /></Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={cancelLineEdit}><X className="w-3.5 h-3.5" /></Button>
        </div>
      </TableCell>
    </TableRow>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-heading font-bold">BOM Master</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Manage recipes for Semi-finished (SM) items</p>
        </div>
        <Button onClick={handleAddHeader}>
          <Plus className="w-4 h-4" /> New BOM
        </Button>
      </div>

      <div className="grid grid-cols-12 gap-6">
        {/* LEFT: SM list */}
        <div className="col-span-4 space-y-3">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <ClipboardList className="w-4 h-4" /> SM Items ({headers.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {headers.length === 0 ? (
                <p className="text-sm text-muted-foreground px-4 pb-4">No BOMs yet. Click "New BOM" to start.</p>
              ) : (
                <div className="divide-y">
                  {headers.map(h => {
                    const sku = getSkuById(h.smSkuId);
                    const hLines = getLinesForHeader(h.id);
                    const hOutput = h.batchSize * h.yieldPercent;
                    const hCost = hLines.reduce((s, l) => s + l.qtyPerBatch * getActiveCost(l.rmSkuId), 0);
                    const isSelected = selectedHeaderId === h.id;
                    return (
                      <div
                        key={h.id}
                        className={`px-4 py-3 cursor-pointer transition-colors hover:bg-muted/50 ${isSelected ? 'bg-primary/5 border-l-2 border-primary' : ''}`}
                        onClick={() => { setSelectedHeaderId(h.id); setEditingHeader(false); setAddingLine(false); setEditingLineId(null); }}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium">{sku?.name ?? '—'}</p>
                            <p className="text-xs text-muted-foreground">{sku?.skuId} · {h.productionType} · {hLines.length} ingredients</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs">{hOutput.toFixed(0)}g</Badge>
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={e => { e.stopPropagation(); handleDeleteHeader(h.id); }}>
                              <Trash2 className="w-3.5 h-3.5 text-destructive" />
                            </Button>
                          </div>
                        </div>
                        {hCost > 0 && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Cost: ฿{hCost.toFixed(2)} / batch · ฿{hOutput > 0 ? (hCost / hOutput).toFixed(4) : '0'}/g
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* RIGHT: BOM detail */}
        <div className="col-span-8 space-y-4">
          {editingHeader ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">
                  {selectedHeaderId && selectedHeader ? 'Edit BOM Header' : 'New BOM Header'}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">SM SKU</label>
                    <Select value={headerForm.smSkuId} onValueChange={v => setHeaderForm(f => ({ ...f, smSkuId: v }))}>
                      <SelectTrigger><SelectValue placeholder="Select SM SKU" /></SelectTrigger>
                      <SelectContent>
                        {smSkus.map(s => (
                          <SelectItem key={s.id} value={s.id}>{s.skuId} — {s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Production Type</label>
                    <Select value={headerForm.productionType} onValueChange={v => setHeaderForm(f => ({ ...f, productionType: v as 'CK' | 'Outsource' }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="CK">CK (Central Kitchen)</SelectItem>
                        <SelectItem value="Outsource">Outsource</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Batch Size (grams)</label>
                    <Input type="number" value={headerForm.batchSize || ''} onChange={e => setHeaderForm(f => ({ ...f, batchSize: Number(e.target.value) }))} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">% Yield (e.g. 0.70 = 70%)</label>
                    <Input type="number" step="0.01" value={headerForm.yieldPercent || ''} onChange={e => setHeaderForm(f => ({ ...f, yieldPercent: Number(e.target.value) }))} />
                  </div>
                </div>
                <div className="flex items-center gap-2 pt-2 text-sm">
                  <FlaskConical className="w-4 h-4 text-muted-foreground" />
                  Output per batch: <span className="font-semibold">{(headerForm.batchSize * headerForm.yieldPercent).toFixed(0)}g</span>
                </div>
                <div className="flex gap-2 pt-2">
                  <Button onClick={handleSaveHeader}>Save</Button>
                  <Button variant="outline" onClick={() => setEditingHeader(false)}>Cancel</Button>
                </div>
              </CardContent>
            </Card>
          ) : selectedHeader ? (
            <>
              {/* Header summary */}
              <Card>
                <CardContent className="pt-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-heading font-bold text-lg">{getSkuName(selectedHeader.smSkuId)}</h3>
                      <p className="text-xs text-muted-foreground">{getSkuCode(selectedHeader.smSkuId)} · {selectedHeader.productionType}</p>
                    </div>
                    <Button size="sm" variant="outline" onClick={handleEditHeader}>
                      <Edit2 className="w-3.5 h-3.5" /> Edit Header
                    </Button>
                  </div>
                  <div className="grid grid-cols-4 gap-4 mt-4">
                    <div className="text-center p-3 rounded-lg bg-muted/50">
                      <p className="text-xs text-muted-foreground">Batch Size</p>
                      <p className="text-lg font-bold">{selectedHeader.batchSize.toLocaleString()}g</p>
                    </div>
                    <div className="text-center p-3 rounded-lg bg-muted/50">
                      <p className="text-xs text-muted-foreground">Yield</p>
                      <p className="text-lg font-bold">{(selectedHeader.yieldPercent * 100).toFixed(0)}%</p>
                    </div>
                    <div className="text-center p-3 rounded-lg bg-muted/50">
                      <p className="text-xs text-muted-foreground">Output</p>
                      <p className="text-lg font-bold">{outputQty.toFixed(0)}g</p>
                    </div>
                    <div className="text-center p-3 rounded-lg bg-primary/10">
                      <p className="text-xs text-muted-foreground flex items-center justify-center gap-1"><DollarSign className="w-3 h-3" />Cost/gram</p>
                      <p className="text-lg font-bold text-primary">฿{costPerGram.toFixed(4)}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Ingredients table */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-medium">Ingredients ({selectedLines.length})</CardTitle>
                    <Button size="sm" onClick={handleStartAddLine} disabled={addingLine}>
                      <Plus className="w-3.5 h-3.5" /> Add Ingredient
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">RM SKU</TableHead>
                        <TableHead className="text-xs">Name</TableHead>
                        <TableHead className="text-xs">Qty</TableHead>
                        <TableHead className="text-xs">UOM</TableHead>
                        <TableHead className="text-xs text-right">Cost/unit</TableHead>
                        <TableHead className="text-xs text-right">Line Cost</TableHead>
                        <TableHead className="text-xs w-20"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {addingLine && renderLineEditor(true)}
                      {selectedLines.map(line => {
                        const rmSku = getSkuById(line.rmSkuId);
                        const cost = getActiveCost(line.rmSkuId);
                        const lineCost = line.qtyPerBatch * cost;

                        if (editingLineId === line.id) return renderLineEditor(false);

                        return (
                          <TableRow key={line.id}>
                            <TableCell className="text-xs font-mono">{rmSku?.skuId ?? '—'}</TableCell>
                            <TableCell className="text-xs">{rmSku?.name ?? '—'}</TableCell>
                            <TableCell className="text-xs">{line.qtyPerBatch}</TableCell>
                            <TableCell className="text-xs">{rmSku?.usageUom ?? '—'}</TableCell>
                            <TableCell className="text-xs text-right">฿{cost.toFixed(2)}</TableCell>
                            <TableCell className="text-xs text-right font-medium">฿{lineCost.toFixed(2)}</TableCell>
                            <TableCell>
                              <div className="flex gap-1">
                                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleEditLine(line)}>
                                  <Edit2 className="w-3.5 h-3.5" />
                                </Button>
                                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleDeleteLine(line.id)}>
                                  <Trash2 className="w-3.5 h-3.5 text-destructive" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      {selectedLines.length === 0 && !addingLine && (
                        <TableRow>
                          <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">
                            No ingredients yet. Click "Add Ingredient" to start building the recipe.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                  {selectedLines.length > 0 && (
                    <div className="border-t px-4 py-3 flex justify-end">
                      <p className="text-sm font-medium">Total batch cost: <span className="text-primary font-bold">฿{totalCost.toFixed(2)}</span></p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <ClipboardList className="w-10 h-10 text-muted-foreground/40 mb-3" />
                <p className="text-sm text-muted-foreground">Select an SM item from the left or create a new BOM</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
};

export default BOMPage;
