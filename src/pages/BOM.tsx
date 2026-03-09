import { useState, useMemo, Fragment, useRef, useCallback } from 'react';
import { SKU } from '@/types/sku';
import { Price } from '@/types/price';
import { BOMHeader, BOMLine, BOMStep, EMPTY_BOM_HEADER, EMPTY_BOM_LINE, EMPTY_BOM_STEP, BOMMode, IngredientQtyType } from '@/types/bom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SearchableSelect } from '@/components/SearchableSelect';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Plus, Trash2, Edit2, Check, X, ClipboardList, FlaskConical, DollarSign, ArrowRight, Maximize2, Minimize2, GripVertical } from 'lucide-react';
import { toast } from 'sonner';
import { syncBomPrice } from '@/lib/bom-price-sync';

interface BOMPageProps {
  bomData: {
    headers: BOMHeader[];
    lines: BOMLine[];
    steps: BOMStep[];
    addHeader: (data: Omit<BOMHeader, 'id'>) => string | Promise<string>;
    updateHeader: (id: string, data: Partial<Omit<BOMHeader, 'id'>>) => void | Promise<void>;
    deleteHeader: (id: string) => void | Promise<void>;
    addLine: (data: Omit<BOMLine, 'id'>) => void | Promise<void>;
    updateLine: (id: string, data: Partial<Omit<BOMLine, 'id' | 'bomHeaderId'>>) => void | Promise<void>;
    deleteLine: (id: string) => void | Promise<void>;
    getLinesForHeader: (headerId: string) => BOMLine[];
    addStep: (data: Omit<BOMStep, 'id'>) => string | Promise<string>;
    updateStep: (id: string, data: Partial<Omit<BOMStep, 'id' | 'bomHeaderId'>>) => void | Promise<void>;
    deleteStep: (id: string) => void | Promise<void>;
    getStepsForHeader: (headerId: string) => BOMStep[];
    getLinesForStep: (stepId: string) => BOMLine[];
  };
  skus: SKU[];
  prices: Price[];
  readOnly?: boolean;
}

// Uncontrolled input that only fires onChange on blur
function BlurInput({ defaultValue, onBlurValue, type = 'text', className, step, placeholder, min, max }: {
  defaultValue: string | number;
  onBlurValue: (val: string) => void;
  type?: string;
  className?: string;
  step?: string;
  placeholder?: string;
  min?: number;
  max?: number;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <input
      ref={ref}
      type={type}
      defaultValue={defaultValue}
      step={step}
      placeholder={placeholder}
      min={min}
      max={max}
      className={`flex rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50 transition-colors ${className || ''}`}
      onBlur={() => {
        if (ref.current) onBlurValue(ref.current.value);
      }}
      onKeyDown={e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (ref.current) {
            onBlurValue(ref.current.value);
            ref.current.blur();
          }
        }
      }}
    />
  );
}

const BOMPage = ({ bomData, skus, prices, readOnly = false }: BOMPageProps) => {
  const {
    headers, addHeader, updateHeader, deleteHeader,
    addLine, updateLine, deleteLine, getLinesForHeader,
    addStep, updateStep, deleteStep, getStepsForHeader, getLinesForStep,
  } = bomData;

  const [selectedHeaderId, setSelectedHeaderId] = useState<string | null>(null);
  const [editingHeader, setEditingHeader] = useState(false);
  const [headerForm, setHeaderForm] = useState(EMPTY_BOM_HEADER);
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [lineForm, setLineForm] = useState<Omit<BOMLine, 'id' | 'bomHeaderId'>>({ rmSkuId: '', qtyPerBatch: 0 });
  const [addingLine, setAddingLine] = useState(false);
  const [addingLineStepId, setAddingLineStepId] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [draggedStepId, setDraggedStepId] = useState<string | null>(null);

  const smSkus = useMemo(() => skus.filter(s => s.type === 'SM'), [skus]);
  // FIX 2: Allow both RM and SM as ingredients
  const ingredientSkus = useMemo(() => skus.filter(s => s.type === 'RM' || s.type === 'SM'), [skus]);

  const getSkuName = (id: string) => skus.find(s => s.id === id)?.name ?? '—';
  const getSkuById = (id: string) => skus.find(s => s.id === id);
  const getSkuCode = (id: string) => skus.find(s => s.id === id)?.skuId ?? '';

  const getActiveCost = (rmSkuId: string): number => {
    const active = prices.find(p => p.skuId === rmSkuId && p.isActive);
    return active?.pricePerUsageUom ?? 0;
  };

  const selectedHeader = headers.find(h => h.id === selectedHeaderId) ?? null;
  const selectedLines = selectedHeaderId ? getLinesForHeader(selectedHeaderId) : [];
  const selectedSteps = selectedHeaderId ? getStepsForHeader(selectedHeaderId) : [];

  // Simple BOM calculations
  const outputQty = selectedHeader && selectedHeader.bomMode === 'simple'
    ? selectedHeader.batchSize * selectedHeader.yieldPercent : 0;
  const simpleTotalCost = selectedHeader?.bomMode === 'simple'
    ? selectedLines.reduce((sum, l) => sum + l.qtyPerBatch * getActiveCost(l.rmSkuId), 0) : 0;
  const simpleCostPerGram = outputQty > 0 ? simpleTotalCost / outputQty : 0;

  // Multi-step calculations
  const calcMultiStepData = () => {
    if (!selectedHeader || selectedHeader.bomMode !== 'multistep') return { steps: [], totalCost: 0, finalOutput: 0, costPerGram: 0 };

    let totalCost = 0;
    const stepsCalc: Array<{ step: typeof selectedSteps[0]; inputQty: number; outputQty: number; stepCost: number; ingredients: Array<any> }> = [];
    
    for (let idx = 0; idx < selectedSteps.length; idx++) {
      const step = selectedSteps[idx];
      const stepLines = getLinesForStep(step.id);
      let inputQty: number;
      if (idx === 0) {
        inputQty = stepLines.reduce((s, l) => {
          if (l.qtyType === 'percent') return s;
          return s + l.qtyPerBatch;
        }, 0);
      } else {
        inputQty = stepsCalc[idx - 1].outputQty;
      }

      const ingredientsWithCost = stepLines.map(l => {
        let qty = l.qtyPerBatch;
        if (l.qtyType === 'percent' && l.percentOfInput) {
          qty = l.percentOfInput * inputQty;
        }
        const cost = qty * getActiveCost(l.rmSkuId);
        return { ...l, resolvedQty: qty, lineCost: cost };
      });

      if (idx === 0) {
        inputQty = ingredientsWithCost.reduce((s, l) => s + l.resolvedQty, 0);
      }

      const totalIngredientQtyThisStep = ingredientsWithCost.reduce((s, l) => s + l.resolvedQty, 0);
      const effectiveInput = idx === 0 ? totalIngredientQtyThisStep : inputQty + ingredientsWithCost.reduce((s, l) => s + l.resolvedQty, 0);

      const outputQty = effectiveInput * step.yieldPercent;
      const stepCost = ingredientsWithCost.reduce((s, i) => s + i.lineCost, 0);
      totalCost += stepCost;

      stepsCalc.push({ step, inputQty: effectiveInput, outputQty, stepCost, ingredients: ingredientsWithCost });
    }

    const finalOutput = stepsCalc.length > 0 ? stepsCalc[stepsCalc.length - 1].outputQty : 0;
    return { steps: stepsCalc, totalCost, finalOutput, costPerGram: finalOutput > 0 ? totalCost / finalOutput : 0 };
  };

  const multiStepData = calcMultiStepData();

  const getBomCost = (h: BOMHeader) => {
    const hLines = getLinesForHeader(h.id);
    if (h.bomMode === 'simple') {
      const hOutput = h.batchSize * h.yieldPercent;
      const hCost = hLines.reduce((s, l) => s + l.qtyPerBatch * getActiveCost(l.rmSkuId), 0);
      return { cost: hCost, output: hOutput, costPerGram: hOutput > 0 ? hCost / hOutput : 0 };
    } else {
      const hSteps = getStepsForHeader(h.id);
      let totalCost = 0;
      let prevOutput = 0;
      hSteps.forEach((step, idx) => {
        const sLines = getLinesForStep(step.id);
        let inputQty = idx === 0 ? sLines.reduce((s, l) => s + l.qtyPerBatch, 0) : prevOutput;
        const ingredientQty = sLines.reduce((s, l) => {
          if (l.qtyType === 'percent' && l.percentOfInput) return s + l.percentOfInput * inputQty;
          return s + l.qtyPerBatch;
        }, 0);
        const effectiveInput = idx === 0 ? ingredientQty : inputQty + sLines.reduce((s, l) => {
          if (l.qtyType === 'percent' && l.percentOfInput) return s + l.percentOfInput * inputQty;
          return s + l.qtyPerBatch;
        }, 0);
        prevOutput = effectiveInput * step.yieldPercent;
        totalCost += sLines.reduce((s, l) => {
          let qty = l.qtyPerBatch;
          if (l.qtyType === 'percent' && l.percentOfInput) qty = l.percentOfInput * inputQty;
          return s + qty * getActiveCost(l.rmSkuId);
        }, 0);
      });
      return { cost: totalCost, output: prevOutput, costPerGram: prevOutput > 0 ? totalCost / prevOutput : 0 };
    }
  };

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
      const result = addHeader(headerForm);
      if (result instanceof Promise) {
        result.then(id => setSelectedHeaderId(id));
      } else {
        setSelectedHeaderId(result);
      }
      toast.success('BOM created');
    }
    setEditingHeader(false);
  };

  const handleEditHeader = () => {
    if (!selectedHeader) return;
    setHeaderForm({
      smSkuId: selectedHeader.smSkuId,
      productionType: selectedHeader.productionType,
      bomMode: selectedHeader.bomMode,
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
  const handleStartAddLine = (stepId?: string) => {
    setLineForm({ rmSkuId: '', qtyPerBatch: 0, qtyType: stepId ? 'fixed' : undefined, percentOfInput: 0, stepId });
    setAddingLine(true);
    setAddingLineStepId(stepId ?? null);
    setEditingLineId(null);
  };

  const handleSaveLine = () => {
    if (!selectedHeaderId || !lineForm.rmSkuId) { toast.error('Select a SKU'); return; }
    if (addingLine) {
      addLine({ ...lineForm, bomHeaderId: selectedHeaderId });
      toast.success('Ingredient added');
      setAddingLine(false);
      setAddingLineStepId(null);
    } else if (editingLineId) {
      updateLine(editingLineId, lineForm);
      toast.success('Ingredient updated');
      setEditingLineId(null);
    }
  };

  const handleEditLine = (line: BOMLine) => {
    setLineForm({
      rmSkuId: line.rmSkuId,
      qtyPerBatch: line.qtyPerBatch,
      stepId: line.stepId,
      qtyType: line.qtyType,
      percentOfInput: line.percentOfInput,
    });
    setEditingLineId(line.id);
    setAddingLine(false);
  };

  const handleDeleteLine = (id: string) => {
    deleteLine(id);
    toast.success('Ingredient removed');
  };

  const cancelLineEdit = () => { setAddingLine(false); setEditingLineId(null); setAddingLineStepId(null); };

  // Step actions
  const handleAddStep = () => {
    if (!selectedHeaderId) return;
    const nextNum = selectedSteps.length + 1;
    addStep({ bomHeaderId: selectedHeaderId, stepNumber: nextNum, stepName: `Step ${nextNum}`, yieldPercent: 1.0 });
    toast.success('Step added');
  };

  const handleDeleteStep = (stepId: string) => {
    deleteStep(stepId);
    const remaining = selectedSteps.filter(s => s.id !== stepId);
    remaining.forEach((s, i) => updateStep(s.id, { stepNumber: i + 1 }));
    toast.success('Step removed');
  };

  // Drag reorder steps
  const handleDragStart = (stepId: string) => setDraggedStepId(stepId);
  const handleDragOver = (e: React.DragEvent) => e.preventDefault();
  const handleDrop = (targetStepId: string) => {
    if (!draggedStepId || draggedStepId === targetStepId) { setDraggedStepId(null); return; }
    const ordered = [...selectedSteps];
    const fromIdx = ordered.findIndex(s => s.id === draggedStepId);
    const toIdx = ordered.findIndex(s => s.id === targetStepId);
    if (fromIdx < 0 || toIdx < 0) { setDraggedStepId(null); return; }
    const [moved] = ordered.splice(fromIdx, 1);
    ordered.splice(toIdx, 0, moved);
    ordered.forEach((s, i) => updateStep(s.id, { stepNumber: i + 1 }));
    setDraggedStepId(null);
  };

  // Ingredient line editor (reusable)
  const renderLineEditor = (isMultiStep: boolean, stepInputQty?: number) => (
    <TableRow className="bg-muted/30">
      <TableCell>
        <SearchableSelect
          value={lineForm.rmSkuId}
          onValueChange={v => setLineForm(f => ({ ...f, rmSkuId: v }))}
          options={ingredientSkus.map(s => ({ value: s.id, label: `${s.skuId} — ${s.name}`, sublabel: s.skuId }))}
          placeholder="Select SKU"
          triggerClassName="h-8 text-xs"
        />
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">{lineForm.rmSkuId ? getSkuName(lineForm.rmSkuId) : '—'}</TableCell>
      {isMultiStep && (
        <TableCell>
          <Select value={lineForm.qtyType || 'fixed'} onValueChange={v => setLineForm(f => ({ ...f, qtyType: v as IngredientQtyType }))}>
            <SelectTrigger className="h-8 text-xs w-24"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="fixed">Fixed (g)</SelectItem>
              <SelectItem value="percent">% of Input</SelectItem>
            </SelectContent>
          </Select>
        </TableCell>
      )}
      <TableCell>
        {isMultiStep && lineForm.qtyType === 'percent' ? (
          <div className="flex items-center gap-1">
            <Input type="number" step="0.01" className="h-8 w-20 text-xs"
              value={lineForm.percentOfInput ? (lineForm.percentOfInput * 100) : ''}
              onChange={e => {
                const pct = Number(e.target.value) / 100;
                setLineForm(f => ({ ...f, percentOfInput: pct, qtyPerBatch: pct * (stepInputQty || 0) }));
              }} />
            <span className="text-xs text-muted-foreground">%</span>
            <span className="text-xs text-muted-foreground ml-1">= {((lineForm.percentOfInput || 0) * (stepInputQty || 0)).toFixed(0)}g</span>
          </div>
        ) : (
          <Input type="number" className="h-8 w-24 text-xs" value={lineForm.qtyPerBatch || ''}
            onChange={e => setLineForm(f => ({ ...f, qtyPerBatch: Number(e.target.value) }))} />
        )}
      </TableCell>
      <TableCell className="text-xs">{lineForm.rmSkuId ? getSkuById(lineForm.rmSkuId)?.usageUom : '—'}</TableCell>
      <TableCell className="text-xs text-right">{lineForm.rmSkuId ? getActiveCost(lineForm.rmSkuId).toFixed(2) : '—'}</TableCell>
      <TableCell className="text-xs text-right font-medium">
        {lineForm.rmSkuId ? (() => {
          const qty = isMultiStep && lineForm.qtyType === 'percent'
            ? (lineForm.percentOfInput || 0) * (stepInputQty || 0)
            : lineForm.qtyPerBatch;
          return (qty * getActiveCost(lineForm.rmSkuId)).toFixed(2);
        })() : '—'}
      </TableCell>
      <TableCell>
        <div className="flex gap-1">
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={handleSaveLine}><Check className="w-3.5 h-3.5 text-green-600" /></Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={cancelLineEdit}><X className="w-3.5 h-3.5" /></Button>
        </div>
      </TableCell>
    </TableRow>
  );

  // Helper to render type badge for ingredient row
  const renderIngredientTypeBadge = (skuId: string) => {
    const sku = getSkuById(skuId);
    if (!sku) return null;
    return (
      <Badge variant={sku.type === 'SM' ? 'default' : 'outline'} className="text-[10px] ml-1">
        {sku.type}
      </Badge>
    );
  };

  // Render simple BOM detail
  const renderSimpleBOM = () => (
    <>
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-heading font-bold text-lg">{getSkuName(selectedHeader!.smSkuId)}</h3>
              <p className="text-xs text-muted-foreground">{getSkuCode(selectedHeader!.smSkuId)} · {selectedHeader!.productionType} · Simple BOM</p>
            </div>
            <Button size="sm" variant="outline" onClick={handleEditHeader}>
              <Edit2 className="w-3.5 h-3.5" /> Edit Header
            </Button>
          </div>
          <div className="grid grid-cols-4 gap-4 mt-4">
            <div className="text-center p-3 rounded-lg bg-muted/50">
              <p className="text-xs text-muted-foreground">Batch Size</p>
              <p className="text-lg font-bold">{selectedHeader!.batchSize.toLocaleString()}g</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-muted/50">
              <p className="text-xs text-muted-foreground">Yield</p>
              <p className="text-lg font-bold">{(selectedHeader!.yieldPercent * 100).toFixed(0)}%</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-muted/50">
              <p className="text-xs text-muted-foreground">Output</p>
              <p className="text-lg font-bold">{outputQty.toFixed(0)}g</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-primary/10">
              <p className="text-xs text-muted-foreground flex items-center justify-center gap-1"><DollarSign className="w-3 h-3" />Cost/gram</p>
              <p className="text-lg font-bold text-primary">฿{simpleCostPerGram.toFixed(4)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium">Ingredients ({selectedLines.length})</CardTitle>
            <Button size="sm" onClick={() => handleStartAddLine()} disabled={addingLine}>
              <Plus className="w-3.5 h-3.5" /> Add Ingredient
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">SKU</TableHead>
                <TableHead className="text-xs">Name</TableHead>
                <TableHead className="text-xs">Qty</TableHead>
                <TableHead className="text-xs">UOM</TableHead>
                <TableHead className="text-xs text-right">Cost/unit</TableHead>
                <TableHead className="text-xs text-right">Line Cost</TableHead>
                <TableHead className="text-xs w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {addingLine && !addingLineStepId && renderLineEditor(false)}
              {selectedLines.filter(l => !l.stepId).map(line => {
                const rmSku = getSkuById(line.rmSkuId);
                const cost = getActiveCost(line.rmSkuId);
                const lineCost = line.qtyPerBatch * cost;
                const isSM = rmSku?.type === 'SM';
                if (editingLineId === line.id) return <Fragment key={line.id}>{renderLineEditor(false)}</Fragment>;
                return (
                  <TableRow key={line.id} className={isSM ? 'border-l-2 border-l-blue-400' : ''}>
                    <TableCell className="text-xs font-mono">
                      {rmSku?.skuId ?? '—'}
                      {renderIngredientTypeBadge(line.rmSkuId)}
                    </TableCell>
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
              {selectedLines.filter(l => !l.stepId).length === 0 && !addingLine && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">
                    No ingredients yet. Click "Add Ingredient" to start building the recipe.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          {simpleTotalCost > 0 && (
            <div className="border-t px-4 py-3 flex justify-end">
              <p className="text-sm font-medium">Total batch cost: <span className="text-primary font-bold">฿{simpleTotalCost.toFixed(2)}</span></p>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );

  // Render multi-step BOM detail with UX overhaul
  const renderMultiStepBOM = () => (
    <>
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-heading font-bold text-lg">{getSkuName(selectedHeader!.smSkuId)}</h3>
              <p className="text-xs text-muted-foreground">{getSkuCode(selectedHeader!.smSkuId)} · {selectedHeader!.productionType} · Multi-step BOM</p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={handleEditHeader}>
                <Edit2 className="w-3.5 h-3.5" /> Edit Header
              </Button>
              <Button size="sm" variant="outline" onClick={() => setFullscreen(!fullscreen)}>
                {fullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                {fullscreen ? ' Exit Fullscreen' : ' Expand'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {selectedSteps.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <FlaskConical className="w-8 h-8 text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground">No steps yet. Add a step to define the production process.</p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-6">
        {multiStepData.steps.map((sd, idx) => {
          const stepLines = getLinesForStep(sd.step.id);
          return (
            <Card
              key={sd.step.id}
              className={`border-l-4 border-l-primary/30 ${draggedStepId === sd.step.id ? 'opacity-50' : ''}`}
              draggable
              onDragStart={() => handleDragStart(sd.step.id)}
              onDragOver={handleDragOver}
              onDrop={() => handleDrop(sd.step.id)}
            >
              <CardHeader className="pb-3">
                {/* Step header row */}
                <div className="flex items-center gap-3">
                  <div className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground">
                    <GripVertical className="w-4 h-4" />
                  </div>
                  <Badge variant="outline" className="font-mono text-sm px-3 py-1">{sd.step.stepNumber}</Badge>
                  <BlurInput
                    defaultValue={sd.step.stepName}
                    onBlurValue={val => updateStep(sd.step.id, { stepName: val })}
                    className="h-9 text-sm font-medium min-w-[200px] flex-1 border-dashed"
                    placeholder="Step name..."
                  />
                  <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={() => handleDeleteStep(sd.step.id)}>
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </div>

                {/* Input → Yield → Output row */}
                <div className="flex items-center gap-5 mt-3 px-1 py-2 rounded-lg bg-muted/30">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground text-xs font-medium">Input:</span>
                    <span className="font-semibold text-sm">{sd.inputQty.toFixed(0)}g</span>
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground" />
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground text-xs font-medium">Yield:</span>
                    <BlurInput
                      defaultValue={sd.step.yieldPercent}
                      onBlurValue={val => {
                        const num = parseFloat(val);
                        if (!isNaN(num) && num >= 0 && num <= 1) {
                          updateStep(sd.step.id, { yieldPercent: num });
                        }
                      }}
                      type="number"
                      step="0.01"
                      min={0}
                      max={1}
                      className="h-8 w-24 text-xs"
                    />
                    <span className="text-xs text-muted-foreground">({(sd.step.yieldPercent * 100).toFixed(0)}%)</span>
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground" />
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground text-xs font-medium">Output:</span>
                    <span className="font-semibold text-sm text-primary">{sd.outputQty.toFixed(0)}g</span>
                  </div>
                  {sd.stepCost > 0 && (
                    <Badge variant="secondary" className="text-xs ml-auto">
                      Step cost: ฿{sd.stepCost.toFixed(2)}
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="p-0 pb-4">
                {(stepLines.length > 0 || (addingLine && addingLineStepId === sd.step.id)) && (
                  <div className="px-4">
                    <p className="text-xs text-muted-foreground font-medium mb-2">Ingredients ({stepLines.length})</p>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">SKU</TableHead>
                          <TableHead className="text-xs">Name</TableHead>
                          <TableHead className="text-xs">Qty Type</TableHead>
                          <TableHead className="text-xs">Qty</TableHead>
                          <TableHead className="text-xs">UOM</TableHead>
                          <TableHead className="text-xs text-right">Cost/unit</TableHead>
                          <TableHead className="text-xs text-right">Line Cost</TableHead>
                          <TableHead className="text-xs w-20"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {addingLine && addingLineStepId === sd.step.id && renderLineEditor(true, sd.inputQty)}
                        {sd.ingredients.map(ing => {
                          const rmSku = getSkuById(ing.rmSkuId);
                          const isSM = rmSku?.type === 'SM';
                          if (editingLineId === ing.id) {
                            return <Fragment key={ing.id}>{renderLineEditor(true, sd.inputQty)}</Fragment>;
                          }
                          return (
                            <TableRow key={ing.id} className={isSM ? 'border-l-2 border-l-blue-400' : ''}>
                              <TableCell className="text-xs font-mono">
                                {rmSku?.skuId ?? '—'}
                                {renderIngredientTypeBadge(ing.rmSkuId)}
                              </TableCell>
                              <TableCell className="text-xs">{rmSku?.name ?? '—'}</TableCell>
                              <TableCell className="text-xs">
                                <Badge variant="outline" className="text-[10px]">
                                  {ing.qtyType === 'percent' ? `${((ing.percentOfInput || 0) * 100).toFixed(1)}%` : 'Fixed'}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-xs">{ing.resolvedQty.toFixed(0)}g</TableCell>
                              <TableCell className="text-xs">{rmSku?.usageUom ?? '—'}</TableCell>
                              <TableCell className="text-xs text-right">฿{getActiveCost(ing.rmSkuId).toFixed(2)}</TableCell>
                              <TableCell className="text-xs text-right font-medium">฿{ing.lineCost.toFixed(2)}</TableCell>
                              <TableCell>
                                <div className="flex gap-1">
                                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleEditLine(ing)}>
                                    <Edit2 className="w-3.5 h-3.5" />
                                  </Button>
                                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleDeleteLine(ing.id)}>
                                    <Trash2 className="w-3.5 h-3.5 text-destructive" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}

                {/* Full-width Add Ingredient button */}
                <div className="px-4 mt-3">
                  <Button
                    variant="outline"
                    className="w-full border-dashed border-2 text-orange-600 hover:text-orange-700 hover:bg-orange-50 dark:hover:bg-orange-950/20"
                    onClick={() => handleStartAddLine(sd.step.id)}
                    disabled={addingLine && addingLineStepId === sd.step.id}
                  >
                    <Plus className="w-4 h-4" /> Add Ingredient to this step
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Full-width Add Step button */}
      <Button
        variant="outline"
        className="w-full border-dashed border-2 text-primary hover:bg-primary/5 py-6 text-base"
        onClick={handleAddStep}
      >
        <Plus className="w-5 h-5" /> Add Step
      </Button>

      {/* Multi-step cost summary */}
      {multiStepData.totalCost > 0 && (
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="pt-4">
            <div className="grid grid-cols-3 gap-6 text-center">
              <div>
                <p className="text-xs text-muted-foreground">Total Ingredient Cost</p>
                <p className="text-xl font-bold">฿{multiStepData.totalCost.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Final Output</p>
                <p className="text-xl font-bold">{multiStepData.finalOutput.toFixed(0)}g</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground flex items-center justify-center gap-1"><DollarSign className="w-3 h-3" />Cost per Gram</p>
                <p className="text-xl font-bold text-primary">฿{multiStepData.costPerGram.toFixed(4)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </>
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

      <div className={`grid gap-6 ${fullscreen ? 'grid-cols-1' : 'grid-cols-12'}`}>
        {/* LEFT: SM list (hidden in fullscreen) */}
        {!fullscreen && (
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
                      const { cost: hCost, output: hOutput, costPerGram: hCpg } = getBomCost(h);
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
                              <p className="text-xs text-muted-foreground">
                                {sku?.skuId} · {h.productionType} · {h.bomMode === 'multistep' ? 'Multi-step' : 'Simple'} · {hLines.length} ingredients
                              </p>
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
                              Cost: ฿{hCost.toFixed(2)} / batch · ฿{hCpg.toFixed(4)}/g
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
        )}

        {/* RIGHT: BOM detail */}
        <div className={fullscreen ? '' : 'col-span-8'} style={{ minWidth: 0 }}>
          <div className="space-y-4">
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
                      <SearchableSelect
                        value={headerForm.smSkuId}
                        onValueChange={v => setHeaderForm(f => ({ ...f, smSkuId: v }))}
                        options={smSkus.map(s => ({ value: s.id, label: `${s.skuId} — ${s.name}`, sublabel: s.skuId }))}
                        placeholder="Select SM SKU"
                      />
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
                  </div>

                  {/* BOM Mode toggle */}
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                    <label className="text-sm font-medium">BOM Mode:</label>
                    <div className="flex items-center gap-2">
                      <span className={`text-sm ${headerForm.bomMode === 'simple' ? 'font-bold text-primary' : 'text-muted-foreground'}`}>Simple</span>
                      <Switch
                        checked={headerForm.bomMode === 'multistep'}
                        onCheckedChange={checked => setHeaderForm(f => ({ ...f, bomMode: checked ? 'multistep' : 'simple' }))}
                      />
                      <span className={`text-sm ${headerForm.bomMode === 'multistep' ? 'font-bold text-primary' : 'text-muted-foreground'}`}>Multi-step</span>
                    </div>
                  </div>

                  {headerForm.bomMode === 'simple' && (
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Batch Size (grams)</label>
                        <Input type="number" value={headerForm.batchSize || ''} onChange={e => setHeaderForm(f => ({ ...f, batchSize: Number(e.target.value) }))} />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">% Yield (e.g. 0.70 = 70%)</label>
                        <Input type="number" step="0.01" value={headerForm.yieldPercent || ''} onChange={e => setHeaderForm(f => ({ ...f, yieldPercent: Number(e.target.value) }))} />
                      </div>
                    </div>
                  )}

                  {headerForm.bomMode === 'simple' && (
                    <div className="flex items-center gap-2 text-sm">
                      <FlaskConical className="w-4 h-4 text-muted-foreground" />
                      Output per batch: <span className="font-semibold">{(headerForm.batchSize * headerForm.yieldPercent).toFixed(0)}g</span>
                    </div>
                  )}

                  {headerForm.bomMode === 'multistep' && (
                    <p className="text-xs text-muted-foreground">Multi-step BOM: Define steps and ingredients after saving the header. Batch size and yield are calculated per step.</p>
                  )}

                  <div className="flex gap-2 pt-2">
                    <Button onClick={handleSaveHeader}>Save</Button>
                    <Button variant="outline" onClick={() => setEditingHeader(false)}>Cancel</Button>
                  </div>
                </CardContent>
              </Card>
            ) : selectedHeader ? (
              selectedHeader.bomMode === 'multistep' ? renderMultiStepBOM() : renderSimpleBOM()
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
    </div>
  );
};

export default BOMPage;
