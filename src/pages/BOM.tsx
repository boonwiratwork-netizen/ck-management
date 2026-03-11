import { useState, useMemo, Fragment, useRef, useCallback, useEffect } from 'react';
import { SKU } from '@/types/sku';
import { Price } from '@/types/price';
import { BOMHeader, BOMLine, BOMStep, EMPTY_BOM_HEADER, BOMMode, IngredientQtyType } from '@/types/bom';
import { BomByproduct, EMPTY_BYPRODUCT } from '@/types/byproduct';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SearchableSelect } from '@/components/SearchableSelect';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Plus, Trash2, Edit2, Check, X, ClipboardList, FlaskConical, DollarSign, ArrowRight, Maximize2, Minimize2, GripVertical, Search, AlertTriangle, Info } from 'lucide-react';
import { StatusDot } from '@/components/ui/status-dot';
import { toast } from 'sonner';
import { syncBomPrice, cascadeBomCost, computeBomCostFromDb, syncByproductPrices } from '@/lib/bom-price-sync';
import { useLanguage } from '@/hooks/use-language';

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
  byproductData: {
    byproducts: BomByproduct[];
    getByproductsForHeader: (headerId: string) => BomByproduct[];
    addByproduct: (data: Omit<BomByproduct, 'id'>) => void | Promise<void>;
    updateByproduct: (id: string, data: Partial<Omit<BomByproduct, 'id' | 'bomHeaderId'>>) => void | Promise<void>;
    deleteByproduct: (id: string) => void | Promise<void>;
    bulkUpdateAllocations: (updates: { id: string; costAllocationPct: number }[]) => void | Promise<void>;
  };
  skus: SKU[];
  prices: Price[];
  readOnly?: boolean;
  onPricesRefresh?: () => void;
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

const BOMPage = ({ bomData, byproductData, skus, prices, readOnly = false, onPricesRefresh }: BOMPageProps) => {
  const { t } = useLanguage();
  const {
    headers, addHeader, updateHeader, deleteHeader,
    addLine, updateLine, deleteLine, getLinesForHeader,
    addStep, updateStep, deleteStep, getStepsForHeader, getLinesForStep,
  } = bomData;
  const { byproducts, getByproductsForHeader, addByproduct, updateByproduct, deleteByproduct, bulkUpdateAllocations } = byproductData;

  const [selectedHeaderId, setSelectedHeaderId] = useState<string | null>(null);
  const [editingHeader, setEditingHeader] = useState(false);
  const [headerForm, setHeaderForm] = useState(EMPTY_BOM_HEADER);
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [lineForm, setLineForm] = useState<Omit<BOMLine, 'id' | 'bomHeaderId'> & { yieldPct: number }>({
    rmSkuId: '', qtyPerBatch: 0, yieldPercent: 1.0, yieldPct: 100,
  });
  const [addingLine, setAddingLine] = useState(false);
  const [addingLineStepId, setAddingLineStepId] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [draggedStepId, setDraggedStepId] = useState<string | null>(null);
  const [listSearch, setListSearch] = useState('');
  const [byproductsDirty, setByproductsDirty] = useState(false);
  const [byproductsSavedMsg, setByproductsSavedMsg] = useState(false);
  const [pendingNavHeaderId, setPendingNavHeaderId] = useState<string | null>(null);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);

  const smSkus = useMemo(() => skus.filter(s => s.type === 'SM'), [skus]);
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

  // Yield-aware calculations for simple BOM
  const calcEffQty = (qty: number, yieldPct: number) => yieldPct > 0 ? qty / (yieldPct / 100) : qty;

  const outputQty = selectedHeader && selectedHeader.bomMode === 'simple'
    ? selectedHeader.batchSize * selectedHeader.yieldPercent : 0;
  
  // Simple BOM: lines don't have yield in DB, but we treat yield=100% for backward compat
  // For simple BOM we use raw qty (no per-line yield currently stored in bom_lines)
  const simpleTotalCost = selectedHeader?.bomMode === 'simple'
    ? selectedLines.reduce((sum, l) => {
        const cost = getActiveCost(l.rmSkuId);
        const lineYieldPct = Math.round((l.yieldPercent ?? 1.0) * 100);
        const effQty = calcEffQty(l.qtyPerBatch, lineYieldPct);
        return sum + effQty * cost;
      }, 0) : 0;
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

  // By-product allocation calculations
  const selectedByproducts = selectedHeaderId ? getByproductsForHeader(selectedHeaderId) : [];
  const totalBatchCost = selectedHeader?.bomMode === 'multistep' ? multiStepData.totalCost : simpleTotalCost;
  const mainProductOutput = selectedHeader?.bomMode === 'multistep' ? multiStepData.finalOutput : outputQty;
  const totalByproductPct = selectedByproducts.reduce((s, bp) => s + bp.costAllocationPct, 0);
  const mainProductPct = Math.max(0, 100 - totalByproductPct);
  const allocatedMainCost = totalBatchCost * (mainProductPct / 100);
  const allocatedMainCpg = mainProductOutput > 0 ? allocatedMainCost / mainProductOutput : 0;
  const hasByproducts = selectedByproducts.length > 0;
  const allocationValid = Math.abs(100 - (mainProductPct + totalByproductPct)) < 0.01;

  const getBomCost = (h: BOMHeader) => {
    const hLines = getLinesForHeader(h.id);
    if (h.bomMode === 'simple') {
      const hOutput = h.batchSize * h.yieldPercent;
      const hCost = hLines.reduce((s, l) => {
        const lineYieldPct = Math.round((l.yieldPercent ?? 1.0) * 100);
        const effQty = calcEffQty(l.qtyPerBatch, lineYieldPct);
        return s + effQty * getActiveCost(l.rmSkuId);
      }, 0);
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

  const syncCurrentBomPrice = useCallback(async (headerId?: string) => {
    const hId = headerId || selectedHeaderId;
    if (!hId) return;
    const { costPerGram, smSkuId } = await computeBomCostFromDb(hId);
    if (costPerGram > 0 && smSkuId) {
      const skuName = getSkuCode(smSkuId) || getSkuName(smSkuId);
      await syncBomPrice(smSkuId, costPerGram);
      // Also sync by-product prices
      await syncByproductPrices(hId, totalBatchCost);
      const { menuBomCount, spBomCount } = await cascadeBomCost(smSkuId, costPerGram);
      let msg = `BOM saved · ${skuName} price updated to ฿${costPerGram.toFixed(4)}/g`;
      if (menuBomCount > 0 || spBomCount > 0) {
        msg += ` — ${menuBomCount} menu BOM${menuBomCount !== 1 ? 's' : ''} and ${spBomCount} SP BOM${spBomCount !== 1 ? 's' : ''} refreshed`;
      }
      toast.success(msg);
      onPricesRefresh?.();
    }
  }, [selectedHeaderId, onPricesRefresh, totalBatchCost]);

  // Header actions
  const handleAddHeader = () => {
    setHeaderForm(EMPTY_BOM_HEADER);
    setEditingHeader(true);
    setSelectedHeaderId(null);
  };

  const handleSaveHeader = async () => {
    if (!headerForm.smSkuId) { toast.error('Select an SM SKU'); return; }
    const exists = headers.find(h => h.smSkuId === headerForm.smSkuId && h.id !== selectedHeaderId);
    if (exists) { toast.error('BOM already exists for this SM SKU'); return; }

    if (selectedHeaderId && selectedHeader) {
      await updateHeader(selectedHeaderId, headerForm);
      await syncCurrentBomPrice(selectedHeaderId);
    } else {
      const result = addHeader(headerForm);
      if (result instanceof Promise) {
        result.then(id => { setSelectedHeaderId(id); });
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

  // Line actions — with auto-continue
  const handleStartAddLine = (stepId?: string) => {
    setLineForm({ rmSkuId: '', qtyPerBatch: 0, yieldPercent: 1.0, qtyType: stepId ? 'fixed' : undefined, percentOfInput: 0, stepId, yieldPct: 100 });
    setAddingLine(true);
    setAddingLineStepId(stepId ?? null);
    setEditingLineId(null);
  };

  const handleSaveLine = async () => {
    if (!selectedHeaderId || !lineForm.rmSkuId) { toast.error('Select a SKU'); return; }
    if (addingLine) {
      await addLine({ ...lineForm, yieldPercent: lineForm.yieldPct / 100, bomHeaderId: selectedHeaderId });
      // Auto-continue: open new empty row
      const stepId = addingLineStepId;
      setLineForm({ rmSkuId: '', qtyPerBatch: 0, yieldPercent: 1.0, qtyType: stepId ? 'fixed' : undefined, percentOfInput: 0, stepId: stepId ?? undefined, yieldPct: 100 });
    } else if (editingLineId) {
      await updateLine(editingLineId, { ...lineForm, yieldPercent: lineForm.yieldPct / 100 });
      setEditingLineId(null);
      setAddingLine(false);
    }
    await syncCurrentBomPrice();
  };

  const handleEditLine = (line: BOMLine) => {
    const yieldPctDisplay = Math.round((line.yieldPercent ?? 1.0) * 100);
    setLineForm({
      rmSkuId: line.rmSkuId,
      qtyPerBatch: line.qtyPerBatch,
      yieldPercent: line.yieldPercent ?? 1.0,
      stepId: line.stepId,
      qtyType: line.qtyType,
      percentOfInput: line.percentOfInput,
      yieldPct: yieldPctDisplay,
    });
    setEditingLineId(line.id);
    setAddingLine(false);
  };

  const handleDeleteLine = async (id: string) => {
    await deleteLine(id);
    toast.success('Ingredient removed');
    await syncCurrentBomPrice();
  };

  const cancelLineEdit = () => {
    // If adding and form is empty (auto-continue blank row), just stop
    setAddingLine(false);
    setEditingLineId(null);
    setAddingLineStepId(null);
  };

  // Handle Escape on the adding row
  const handleLineKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      cancelLineEdit();
    }
  };

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

  // By-product actions — mark dirty on any change
  const handleAddByproduct = async () => {
    if (!selectedHeaderId) return;
    await addByproduct({
      bomHeaderId: selectedHeaderId,
      skuId: null,
      name: '',
      outputQty: 0,
      costAllocationPct: 0,
      tracksInventory: false,
    });
    setByproductsDirty(true);
  };

  const handleByproductOutputChange = async (bpId: string, newOutputQty: number) => {
    await updateByproduct(bpId, { outputQty: newOutputQty });
    await autoRebalanceAllocations(bpId, undefined, newOutputQty);
    setByproductsDirty(true);
  };

  const handleByproductPctChange = async (bpId: string, newPct: number) => {
    await updateByproduct(bpId, { costAllocationPct: newPct });
    setByproductsDirty(true);
  };

  const handleByproductFieldChange = async (bpId: string, data: Partial<Omit<BomByproduct, 'id' | 'bomHeaderId'>>) => {
    await updateByproduct(bpId, data);
    setByproductsDirty(true);
  };

  const autoRebalanceAllocations = async (changedId?: string, changedPct?: number, changedOutput?: number) => {
    if (!selectedHeaderId) return;
    const bps = getByproductsForHeader(selectedHeaderId);
    if (bps.length === 0) return;
    
    const totalBpOutput = bps.reduce((s, bp) => {
      const out = bp.id === changedId && changedOutput !== undefined ? changedOutput : bp.outputQty;
      return s + out;
    }, 0);
    const totalOutput = mainProductOutput + totalBpOutput;
    
    if (totalOutput <= 0) return;
    
    const updates = bps.map(bp => {
      const out = bp.id === changedId && changedOutput !== undefined ? changedOutput : bp.outputQty;
      return {
        id: bp.id,
        costAllocationPct: totalOutput > 0 ? (out / totalOutput) * 100 : 0,
      };
    });
    await bulkUpdateAllocations(updates);
  };

  const handleDeleteByproduct = async (bpId: string) => {
    await deleteByproduct(bpId);
    setByproductsDirty(true);
  };

  const handleSaveByproducts = async () => {
    await syncCurrentBomPrice();
    setByproductsDirty(false);
    setByproductsSavedMsg(true);
    setTimeout(() => setByproductsSavedMsg(false), 3000);
  };

  // Navigation guard for unsaved by-product changes
  const trySelectHeader = (id: string) => {
    if (byproductsDirty && id !== selectedHeaderId) {
      setPendingNavHeaderId(id);
      setShowUnsavedDialog(true);
    } else {
      setSelectedHeaderId(id);
      setEditingHeader(false);
      setAddingLine(false);
      setEditingLineId(null);
      setByproductsDirty(false);
      setByproductsSavedMsg(false);
    }
  };

  const confirmDiscardByproducts = () => {
    setByproductsDirty(false);
    setShowUnsavedDialog(false);
    if (pendingNavHeaderId) {
      setSelectedHeaderId(pendingNavHeaderId);
      setEditingHeader(false);
      setAddingLine(false);
      setEditingLineId(null);
      setPendingNavHeaderId(null);
    }
  };

  const confirmSaveAndNav = async () => {
    await handleSaveByproducts();
    setShowUnsavedDialog(false);
    if (pendingNavHeaderId) {
      setSelectedHeaderId(pendingNavHeaderId);
      setEditingHeader(false);
      setAddingLine(false);
      setEditingLineId(null);
      setPendingNavHeaderId(null);
    }
  };

  // Browser beforeunload guard
  useEffect(() => {
    if (!byproductsDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [byproductsDirty]);

  // Check if an SM SKU has its own BOM (for conflict warning)
  const skuHasOwnBom = (skuId: string | null): boolean => {
    if (!skuId) return false;
    return headers.some(h => h.smSkuId === skuId && h.id !== selectedHeaderId);
  };

  // Check if an SM SKU is registered as a by-product somewhere
  const getByproductParentHeader = (skuId: string): BOMHeader | null => {
    const bp = byproducts.find(b => b.skuId === skuId && b.tracksInventory);
    if (!bp) return null;
    return headers.find(h => h.id === bp.bomHeaderId) ?? null;
  };

  const [sortAsc, setSortAsc] = useState(true);

  // Filtered headers for left panel search
  const filteredHeaders = useMemo(() => {
    const q = listSearch.toLowerCase();
    const filtered = listSearch
      ? headers.filter(h => {
          const sku = getSkuById(h.smSkuId);
          return sku?.skuId.toLowerCase().includes(q) || sku?.name.toLowerCase().includes(q);
        })
      : headers;
    return [...filtered].sort((a, b) => {
      const skuA = getSkuById(a.smSkuId)?.skuId ?? '';
      const skuB = getSkuById(b.smSkuId)?.skuId ?? '';
      const cmp = skuA.localeCompare(skuB);
      return sortAsc ? cmp : -cmp;
    });
  }, [headers, listSearch, skus, sortAsc]);

  // Inline line editor row (reusable for simple and multistep)
  const renderLineEditor = (isMultiStep: boolean, stepInputQty?: number) => (
    <TableRow className="bg-muted/30 h-9" onKeyDown={handleLineKeyDown}>
      <TableCell>
        <SearchableSelect
          value={lineForm.rmSkuId}
          onValueChange={v => {
            const sku = getSkuById(v);
            setLineForm(f => ({ ...f, rmSkuId: v }));
          }}
          options={ingredientSkus.map(s => ({ value: s.id, label: `${s.skuId} — ${s.name}`, sublabel: s.skuId }))}
          placeholder="Select SKU"
          triggerClassName="h-8 text-xs"
        />
      </TableCell>
      <TableCell className="text-xs text-muted-foreground truncate overflow-hidden">
        {lineForm.rmSkuId ? getSkuName(lineForm.rmSkuId) : '—'}
      </TableCell>
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
            <Input type="number" step="0.01" className="h-8 w-20 text-xs text-right font-mono"
              value={lineForm.percentOfInput ? (lineForm.percentOfInput * 100) : ''}
              onChange={e => {
                const pct = Number(e.target.value) / 100;
                setLineForm(f => ({ ...f, percentOfInput: pct, qtyPerBatch: pct * (stepInputQty || 0) }));
              }} />
            <span className="text-xs text-muted-foreground">%</span>
          </div>
        ) : (
          <Input type="number" className="h-8 w-full max-w-[80px] text-xs text-right font-mono" value={lineForm.qtyPerBatch || ''}
            onChange={e => setLineForm(f => ({ ...f, qtyPerBatch: Number(e.target.value) }))} />
        )}
      </TableCell>
      <TableCell className="text-xs">{lineForm.rmSkuId ? getSkuById(lineForm.rmSkuId)?.usageUom : '—'}</TableCell>
      {!isMultiStep && (
        <>
          <TableCell className="overflow-hidden">
            <Input type="number" className="h-8 w-full max-w-[64px] text-xs text-right font-mono" value={lineForm.yieldPct}
              onChange={e => {
                const v = Number(e.target.value);
                setLineForm(f => ({ ...f, yieldPct: v || 0 }));
              }}
              onBlur={e => {
                let v = Number(e.target.value);
                if (v < 0.01 || v > 100 || isNaN(v)) v = 100;
                setLineForm(f => ({ ...f, yieldPct: v }));
              }} />
          </TableCell>
          <TableCell className="text-xs text-right font-mono">
            {lineForm.rmSkuId ? calcEffQty(lineForm.qtyPerBatch, lineForm.yieldPct).toFixed(2) : '—'}
          </TableCell>
        </>
      )}
      <TableCell className="text-xs text-right font-mono">
        {lineForm.rmSkuId ? (() => {
          const cost = getActiveCost(lineForm.rmSkuId);
          return cost > 0 ? `฿${cost.toFixed(4)}` : <span className="text-primary">—</span>;
        })() : '—'}
      </TableCell>
      <TableCell className="text-xs text-right font-mono font-medium">
        {lineForm.rmSkuId ? (() => {
          const qty = isMultiStep && lineForm.qtyType === 'percent'
            ? (lineForm.percentOfInput || 0) * (stepInputQty || 0)
            : lineForm.qtyPerBatch;
          const effQty = isMultiStep ? qty : calcEffQty(qty, lineForm.yieldPct);
          const cost = getActiveCost(lineForm.rmSkuId);
          return cost > 0 ? `฿${(effQty * cost).toFixed(2)}` : <span className="text-primary">—</span>;
        })() : '—'}
      </TableCell>
      <TableCell>
        <div className="flex gap-1">
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={handleSaveLine}><Check className="w-3.5 h-3.5 text-success" /></Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={cancelLineEdit}><X className="w-3.5 h-3.5" /></Button>
        </div>
      </TableCell>
    </TableRow>
  );

  // Type badge — removed per design: SKU code prefix already communicates type

  // Common table headers for simple BOM
  const simpleTableHeaders = (
    <TableRow>
      <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground" style={{ width: 120 }}>{t('col.skuCode')}</TableHead>
      <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('col.name')}</TableHead>
      <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground text-right" style={{ width: 80 }}>{t('col.qty')}</TableHead>
      <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground" style={{ width: 70 }}>{t('col.uom')}</TableHead>
      <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground text-right" style={{ width: 80 }}>{t('col.yieldPct')}</TableHead>
      <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground text-right" style={{ width: 90 }}>{t('col.effQty')}</TableHead>
      <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground text-right" style={{ width: 100 }}>{t('col.costUnit')}</TableHead>
      <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground text-right" style={{ width: 100 }}>{t('col.lineCost')}</TableHead>
      <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground" style={{ width: 70 }}></TableHead>
    </TableRow>
  );

  // Render simple BOM
  const renderSimpleBOM = () => (
    <>
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-heading font-semibold">{getSkuName(selectedHeader!.smSkuId)}</h3>
              <p className="text-sm text-muted-foreground mt-0.5">{getSkuCode(selectedHeader!.smSkuId)} · {selectedHeader!.productionType} · Simple BOM</p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={handleEditHeader}>
                <Edit2 className="w-3.5 h-3.5" /> Edit Header
              </Button>
              <Button size="sm" variant="outline" onClick={() => setFullscreen(!fullscreen)}>
                {fullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-4 mt-4">
            <div className="text-center p-4 rounded-lg bg-muted/50">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Batch Size</p>
              <p className="text-lg font-bold font-mono">{selectedHeader!.batchSize.toLocaleString()}g</p>
            </div>
            <div className="text-center p-4 rounded-lg bg-muted/50">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Yield</p>
              <p className="text-lg font-bold font-mono">{(selectedHeader!.yieldPercent * 100).toFixed(0)}%</p>
            </div>
            <div className="text-center p-4 rounded-lg bg-muted/50">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Output</p>
              <p className="text-lg font-bold font-mono">{outputQty.toFixed(0)}g</p>
            </div>
            <div className="text-center p-4 rounded-lg bg-primary/10">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground flex items-center justify-center gap-1"><DollarSign className="w-3 h-3" />Cost/gram</p>
              <p className="text-lg font-bold text-primary font-mono">฿{(hasByproducts ? allocatedMainCpg : simpleCostPerGram).toFixed(4)}</p>
              {hasByproducts && <p className="text-xs text-muted-foreground mt-0.5">after by-product allocation</p>}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 overflow-hidden">
          <Table className="table-fixed">
            <TableHeader>{simpleTableHeaders}</TableHeader>
            <TableBody>
              {selectedLines.filter(l => !l.stepId).length === 0 && !addingLine && (
                <TableRow>
                  <TableCell colSpan={9} className="py-16">
                    <div className="flex flex-col items-center justify-center gap-3">
                      <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center">
                        <FlaskConical className="w-7 h-7 text-muted-foreground" />
                      </div>
                      <p className="font-medium text-foreground">No ingredients added yet</p>
                      <Button
                        variant="outline"
                        className="border-dashed border-2 text-orange-600 hover:text-orange-700 hover:bg-orange-50 dark:hover:bg-orange-950/20"
                        onClick={() => handleStartAddLine()}
                      >
                        <Plus className="w-4 h-4" /> {t('btn.addFirstIngredient')}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              )}
              {selectedLines.filter(l => !l.stepId).map(line => {
                const rmSku = getSkuById(line.rmSkuId);
                const cost = getActiveCost(line.rmSkuId);
                const lineYieldPct = Math.round((line.yieldPercent ?? 1.0) * 100);
                const effQty = calcEffQty(line.qtyPerBatch, lineYieldPct);
                const lineCost = effQty * cost;
                if (editingLineId === line.id) return <Fragment key={line.id}>{renderLineEditor(false)}</Fragment>;
                return (
                  <TableRow key={line.id} className="h-9">
                    <TableCell className="text-[13px] font-mono py-2 px-3">
                      {rmSku?.skuId ?? '—'}
                    </TableCell>
                    <TableCell className="text-[13px] truncate overflow-hidden py-2 px-3" title={rmSku?.name ?? '—'}>
                      {rmSku?.name ?? '—'}
                    </TableCell>
                    <TableCell className="text-[13px] text-right font-mono py-2 px-3">{line.qtyPerBatch}</TableCell>
                    <TableCell className="text-[13px] py-2 px-3">{rmSku?.usageUom ?? '—'}</TableCell>
                    <TableCell className="text-[13px] text-right font-mono py-2 px-3">{lineYieldPct}%</TableCell>
                    <TableCell className="text-[13px] text-right font-mono py-2 px-3">{effQty.toFixed(2)}</TableCell>
                    <TableCell className="text-[13px] text-right font-mono py-2 px-3">
                      {cost > 0 ? `฿${cost.toFixed(4)}` : <span className="text-orange-500">—</span>}
                    </TableCell>
                    <TableCell className="text-[13px] text-right font-mono font-medium py-2 px-3">
                      {cost > 0 ? `฿${lineCost.toFixed(2)}` : <span className="text-orange-500">—</span>}
                    </TableCell>
                    <TableCell className="py-2 px-3">
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
              {addingLine && !addingLineStepId && renderLineEditor(false)}
            </TableBody>
          </Table>
          {/* Add Ingredient button at bottom */}
          {selectedLines.filter(l => !l.stepId).length > 0 && !addingLine && (
            <div className="p-4 pt-2">
              <Button
                variant="outline"
                className="w-full border-dashed border-2 text-orange-600 hover:text-orange-700 hover:bg-orange-50 dark:hover:bg-orange-950/20"
                onClick={() => handleStartAddLine()}
              >
                 <Plus className="w-4 h-4" /> {t('btn.addIngredient')}
              </Button>
            </div>
          )}
          {/* Totals pinned at bottom */}
          {simpleTotalCost > 0 && (
            <div className="border-t px-6 py-3 flex justify-end gap-6">
              <p className="text-sm">Total batch cost: <span className="font-bold font-mono text-primary">฿{simpleTotalCost.toFixed(2)}</span></p>
              <p className="text-sm">Cost/gram: <span className="font-bold font-mono text-primary">฿{simpleCostPerGram.toFixed(4)}</span></p>
            </div>
          )}
        </CardContent>
      </Card>
      {renderByproductsSection()}
    </>
  );
  const renderMultiStepBOM = () => (
    <>
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xl font-heading font-bold">{getSkuName(selectedHeader!.smSkuId)}</h3>
              <p className="text-[13px] text-muted-foreground mt-0.5">{getSkuCode(selectedHeader!.smSkuId)} · {selectedHeader!.productionType} · Multi-step BOM</p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={handleEditHeader}>
                <Edit2 className="w-3.5 h-3.5" /> Edit Header
              </Button>
              <Button size="sm" variant="outline" onClick={() => setFullscreen(!fullscreen)}>
                {fullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {selectedSteps.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center gap-3">
            <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center">
              <FlaskConical className="w-7 h-7 text-muted-foreground" />
            </div>
            <p className="font-medium">No steps yet</p>
            <p className="text-sm text-muted-foreground">Add a step to define the production process.</p>
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

                <div className="flex items-center gap-5 mt-3 px-1 py-2 rounded-lg bg-muted/30">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground text-xs font-medium">Input:</span>
                    <span className="font-semibold text-sm font-mono">{sd.inputQty.toFixed(0)}g</span>
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
                      className="h-8 w-24 text-xs font-mono"
                    />
                    <span className="text-xs text-muted-foreground">({(sd.step.yieldPercent * 100).toFixed(0)}%)</span>
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground" />
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground text-xs font-medium">Output:</span>
                    <span className="font-semibold text-sm text-primary font-mono">{sd.outputQty.toFixed(0)}g</span>
                  </div>
                  {sd.stepCost > 0 && (
                    <Badge variant="secondary" className="text-xs ml-auto font-mono">
                      Step cost: ฿{sd.stepCost.toFixed(2)}
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="p-0 pb-4">
                {(stepLines.length > 0 || (addingLine && addingLineStepId === sd.step.id)) && (
                  <div className="px-4 overflow-hidden">
                    <Table className="table-fixed">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-[11px] uppercase text-muted-foreground" style={{ width: 120 }}>SKU</TableHead>
                          <TableHead className="text-[11px] uppercase text-muted-foreground">Name</TableHead>
                          <TableHead className="text-[11px] uppercase text-muted-foreground" style={{ width: 90 }}>Qty Type</TableHead>
                          <TableHead className="text-[11px] uppercase text-muted-foreground text-right" style={{ width: 80 }}>Qty</TableHead>
                          <TableHead className="text-[11px] uppercase text-muted-foreground" style={{ width: 70 }}>UOM</TableHead>
                          <TableHead className="text-[11px] uppercase text-muted-foreground text-right" style={{ width: 100 }}>Cost/unit</TableHead>
                          <TableHead className="text-[11px] uppercase text-muted-foreground text-right" style={{ width: 100 }}>Line Cost</TableHead>
                          <TableHead className="text-[11px] uppercase text-muted-foreground" style={{ width: 70 }}></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sd.ingredients.map(ing => {
                          const rmSku = getSkuById(ing.rmSkuId);
                          if (editingLineId === ing.id) {
                            return <Fragment key={ing.id}>{renderLineEditor(true, sd.inputQty)}</Fragment>;
                          }
                          return (
                            <TableRow key={ing.id} className="h-9">
                              <TableCell className="text-[13px] font-mono py-2 px-3">
                                {rmSku?.skuId ?? '—'}
                              </TableCell>
                              <TableCell className="text-[13px] truncate overflow-hidden py-2 px-3" title={rmSku?.name ?? '—'}>
                                {rmSku?.name ?? '—'}
                              </TableCell>
                              <TableCell className="text-[13px] py-2 px-3">
                                <Badge variant="outline" className="text-[10px]">
                                  {ing.qtyType === 'percent' ? `${((ing.percentOfInput || 0) * 100).toFixed(1)}%` : 'Fixed'}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-[13px] text-right font-mono py-2 px-3">{ing.resolvedQty.toFixed(0)}g</TableCell>
                              <TableCell className="text-[13px] py-2 px-3">{rmSku?.usageUom ?? '—'}</TableCell>
                              <TableCell className="text-[13px] text-right font-mono py-2 px-3">
                                {getActiveCost(ing.rmSkuId) > 0 ? `฿${getActiveCost(ing.rmSkuId).toFixed(4)}` : <span className="text-orange-500">—</span>}
                              </TableCell>
                              <TableCell className="text-[13px] text-right font-mono font-medium py-2 px-3">
                                {ing.lineCost > 0 ? `฿${ing.lineCost.toFixed(2)}` : <span className="text-orange-500">—</span>}
                              </TableCell>
                              <TableCell className="py-2 px-3">
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
                        {addingLine && addingLineStepId === sd.step.id && renderLineEditor(true, sd.inputQty)}
                      </TableBody>
                    </Table>
                  </div>
                )}

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

      <Button
        variant="outline"
        className="w-full border-dashed border-2 text-orange-600 hover:text-orange-700 hover:bg-orange-50 dark:hover:bg-orange-950/20 py-6 text-base"
        onClick={handleAddStep}
      >
        <Plus className="w-5 h-5" /> Add Step
      </Button>

      {multiStepData.totalCost > 0 && (
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="pt-4">
            <div className="grid grid-cols-3 gap-6 text-center">
              <div>
                <p className="text-[11px] uppercase text-muted-foreground">Total Ingredient Cost</p>
                <p className="text-xl font-bold font-mono">฿{multiStepData.totalCost.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase text-muted-foreground">Final Output</p>
                <p className="text-xl font-bold font-mono">{multiStepData.finalOutput.toFixed(0)}g</p>
              </div>
              <div>
                <p className="text-[11px] uppercase text-muted-foreground flex items-center justify-center gap-1"><DollarSign className="w-3 h-3" />Cost per Gram</p>
                <p className="text-xl font-bold text-primary font-mono">฿{(hasByproducts ? allocatedMainCpg : multiStepData.costPerGram).toFixed(4)}</p>
                {hasByproducts && <p className="text-[10px] text-muted-foreground mt-0.5">after by-product allocation</p>}
              </div>
            </div>
          </CardContent>
        </Card>
      )}
      {renderByproductsSection()}
    </>
  );
  // Reusable by-products section for both simple and multi-step BOMs
  const renderByproductsSection = () => {
    if (!selectedHeaderId || !selectedHeader) return null;
    const bps = selectedByproducts;

    return (
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium">By-products</h4>
            <Button
              size="sm"
              variant="outline"
              className="border-dashed border-2 text-orange-600 hover:text-orange-700 hover:bg-orange-50 dark:hover:bg-orange-950/20"
              onClick={handleAddByproduct}
            >
              <Plus className="w-3.5 h-3.5" /> Add By-product
            </Button>
          </div>

          {bps.length === 0 && (
            <p className="text-xs text-muted-foreground py-4 text-center">No by-products. Click "Add By-product" to define output splits.</p>
          )}

          {bps.length > 0 && (
            <div className="space-y-2">
              {bps.map(bp => {
                const bpAllocCost = totalBatchCost * (bp.costAllocationPct / 100);
                const bpCpg = bp.outputQty > 0 ? bpAllocCost / bp.outputQty : 0;
                const hasConflict = bp.tracksInventory && bp.skuId && skuHasOwnBom(bp.skuId);
                return (
                  <div key={bp.id}>
                    <div className="flex items-center gap-2 p-2.5 rounded-lg border bg-muted/20">
                      {/* Type badge */}
                      <button
                        className={`text-[10px] px-2 py-1 rounded-md shrink-0 font-medium transition-colors ${bp.tracksInventory ? 'bg-primary/10 text-primary border border-primary/20' : 'bg-muted text-muted-foreground border border-transparent'}`}
                        onClick={() => handleByproductFieldChange(bp.id, { tracksInventory: !bp.tracksInventory, skuId: null, name: '' })}
                      >
                        {bp.tracksInventory ? 'SKU' : 'Text'}
                      </button>

                      {/* SKU selector or name field */}
                      <div className="min-w-0 flex-1">
                        {bp.tracksInventory ? (
                          <SearchableSelect
                            value={bp.skuId || ''}
                            onValueChange={v => handleByproductFieldChange(bp.id, { skuId: v, name: getSkuName(v) })}
                            options={smSkus.map(s => ({ value: s.id, label: `${s.skuId} — ${s.name}`, sublabel: s.skuId }))}
                            placeholder="Select SM SKU"
                            triggerClassName="h-8 text-xs"
                          />
                        ) : (
                          <BlurInput
                            defaultValue={bp.name}
                            onBlurValue={val => handleByproductFieldChange(bp.id, { name: val })}
                            className="h-8 text-xs w-full"
                            placeholder="By-product name..."
                          />
                        )}
                      </div>

                      {/* Output g */}
                      <div className="shrink-0 w-20">
                        <BlurInput
                          key={`out-${bp.id}-${bp.outputQty}`}
                          defaultValue={bp.outputQty}
                          onBlurValue={val => handleByproductOutputChange(bp.id, Number(val) || 0)}
                          type="number"
                          className="h-8 w-full text-xs text-right font-mono"
                          placeholder="g"
                        />
                      </div>
                      <span className="text-[10px] text-muted-foreground shrink-0">g</span>

                      {/* Alloc % */}
                      <div className="shrink-0 w-16">
                        <BlurInput
                          key={`pct-${bp.id}-${bp.costAllocationPct.toFixed(1)}`}
                          defaultValue={bp.costAllocationPct.toFixed(1)}
                          onBlurValue={val => handleByproductPctChange(bp.id, Number(val) || 0)}
                          type="number"
                          step="0.1"
                          className="h-8 w-full text-xs text-right font-mono"
                        />
                      </div>
                      <span className="text-[10px] text-muted-foreground shrink-0">%</span>

                      {/* Cost ฿ read-only */}
                      <div className="shrink-0 w-20 text-right">
                        <span className="text-xs font-mono text-muted-foreground">
                          {bpAllocCost > 0 ? `฿${bpAllocCost.toFixed(2)}` : '—'}
                        </span>
                      </div>

                      {/* Cost/g read-only */}
                      <div className="shrink-0 w-20 text-right">
                        <span className="text-xs font-mono text-muted-foreground">
                          {bpCpg > 0 ? `฿${bpCpg.toFixed(4)}` : '—'}
                        </span>
                      </div>

                      {/* Delete */}
                      <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => handleDeleteByproduct(bp.id)}>
                        <Trash2 className="w-3.5 h-3.5 text-destructive" />
                      </Button>
                    </div>
                    {/* Conflict warning below affected row */}
                    {hasConflict && (
                      <div className="flex items-center gap-1.5 text-[10px] text-orange-600 mt-1 ml-2">
                        <AlertTriangle className="w-3 h-3" />
                        {getSkuCode(bp.skuId!)} already has its own BOM. Using it as a by-product will override its cost/gram.
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Summary */}
          {bps.length > 0 && (
            <div className="border-t pt-2 space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Main product ({getSkuCode(selectedHeader.smSkuId)})</span>
                <span className="font-mono font-medium">{mainProductPct.toFixed(1)}%</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Main product cost/gram</span>
                <span className="font-mono font-bold text-primary">฿{allocatedMainCpg.toFixed(4)}</span>
              </div>
              {!allocationValid && (
                <p className="text-[10px] text-destructive font-medium flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> Total allocation does not equal 100%. Adjust by-product percentages.
                </p>
              )}
            </div>
          )}

          {/* Save By-products button */}
          {bps.length > 0 && (
            <div className="border-t pt-3 flex items-center justify-between">
              <div>
                {byproductsSavedMsg && (
                  <span className="text-xs text-green-600 font-medium flex items-center gap-1">
                    <Check className="w-3.5 h-3.5" /> By-products saved ✓
                  </span>
                )}
              </div>
              <Button
                onClick={handleSaveByproducts}
                className="bg-orange-500 hover:bg-orange-600 text-white"
                disabled={!byproductsDirty}
              >
                Save By-products
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  {/* Unsaved by-product changes dialog */}
  const unsavedDialog = showUnsavedDialog ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background rounded-lg border shadow-lg p-6 max-w-sm w-full space-y-4">
        <h3 className="text-sm font-semibold">Unsaved By-product Changes</h3>
        <p className="text-sm text-muted-foreground">You have unsaved by-product changes. Save before leaving?</p>
        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={confirmDiscardByproducts}>Discard</Button>
          <Button size="sm" className="bg-orange-500 hover:bg-orange-600 text-white" onClick={confirmSaveAndNav}>Save & Continue</Button>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
    {unsavedDialog}
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-heading font-bold">{t('title.bomMaster')}</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Manage recipes for Semi-finished (SM) items</p>
        </div>
        <Button onClick={handleAddHeader}>
          <Plus className="w-4 h-4" /> New BOM
        </Button>
      </div>

      <div className={`grid gap-6 ${fullscreen ? 'grid-cols-1' : 'grid-cols-12'}`}>
        {/* LEFT: SM list */}
        {!fullscreen && (
          <div className="col-span-4 space-y-3">
            <Card className="h-fit max-h-[calc(100vh-200px)] flex flex-col">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <ClipboardList className="w-4 h-4" /> SM Items ({headers.length})
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  {headers.filter(h => getLinesForHeader(h.id).length > 0).length} of {headers.filter(h => !byproducts.some(bp => bp.skuId === h.smSkuId && bp.tracksInventory)).length} items have BOM
                </p>
                <div className="relative mt-2">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search SM items..."
                    value={listSearch}
                    onChange={e => setListSearch(e.target.value)}
                    className="pl-9 h-9 text-sm"
                  />
                </div>
                <div className="flex items-center justify-end mt-1.5">
                  <button
                    onClick={() => setSortAsc(!sortAsc)}
                    className="text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                  >
                    Code {sortAsc ? 'A→Z ↑' : 'Z→A ↓'}
                  </button>
                </div>
              </CardHeader>
              <CardContent className="flex-1 overflow-auto p-0">
                {filteredHeaders.length === 0 ? (
                  <p className="text-sm text-muted-foreground px-4 pb-4 text-center py-6">No BOMs yet. Click "New BOM" to start.</p>
                ) : (
                  <div className="divide-y">
                    {filteredHeaders.map(h => {
                      const sku = getSkuById(h.smSkuId);
                      const hLines = getLinesForHeader(h.id);
                      const { cost: hCost, output: hOutput, costPerGram: hCpg } = getBomCost(h);
                      const isSelected = selectedHeaderId === h.id;
                      const hasBom = hLines.length > 0;
                      // Check if this SKU is a by-product of another BOM
                      const parentHeader = getByproductParentHeader(h.smSkuId);
                      const isByproductSku = !!parentHeader;
                      const showNoBomWarning = !hasBom && !isByproductSku;
                      return (
                        <div
                          key={h.id}
                          className={`px-4 py-3 cursor-pointer transition-colors hover:bg-muted/50 ${isSelected ? 'bg-primary/5 border-l-2 border-primary' : ''} ${showNoBomWarning ? 'bg-orange-50/60 dark:bg-orange-950/10' : ''}`}
                          onClick={() => trySelectHeader(h.id)}
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-sm font-medium flex items-center gap-1.5">
                                {showNoBomWarning && <span className="text-orange-500">⚠️</span>}
                                {sku?.skuId} · {sku?.name ?? '—'}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {hLines.length} ingredients · {h.bomMode === 'multistep' ? 'Multi-step' : 'Simple'} · {hOutput.toFixed(0)}g
                              </p>
                              {isByproductSku && (
                                <p className="text-[10px] text-muted-foreground mt-0.5">
                                  By-product of {getSkuCode(parentHeader!.smSkuId)}
                                </p>
                              )}
                            </div>
                            <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={e => { e.stopPropagation(); handleDeleteHeader(h.id); }}>
                              <Trash2 className="w-3.5 h-3.5 text-destructive" />
                            </Button>
                          </div>
                          {hCost > 0 && (
                            <p className="text-xs text-muted-foreground mt-1 font-mono">
                              ฿{hCost.toFixed(2)} / batch · ฿{hCpg.toFixed(4)}/g
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
                        <label className="text-xs font-medium text-muted-foreground">Yield % (e.g. 1.0 = 100%)</label>
                        <Input type="number" step="0.01" value={headerForm.yieldPercent || ''} onChange={e => setHeaderForm(f => ({ ...f, yieldPercent: Number(e.target.value) }))} />
                      </div>
                    </div>
                  )}

                  {headerForm.bomMode === 'simple' && (
                    <div className="flex items-center gap-2 text-sm">
                      <FlaskConical className="w-4 h-4 text-muted-foreground" />
                      Output per batch: <span className="font-semibold font-mono">{(headerForm.batchSize * headerForm.yieldPercent).toFixed(0)}g</span>
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
                  <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mb-3">
                    <ClipboardList className="w-7 h-7 text-muted-foreground" />
                  </div>
                  <p className="font-medium">Select an SM item from the left or create a new BOM</p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
    </>
  );
};

export default BOMPage;
