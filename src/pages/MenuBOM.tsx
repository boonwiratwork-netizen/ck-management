import { useState, useMemo, useCallback } from 'react';
import { Menu } from '@/types/menu';
import { MenuBomLine } from '@/types/menu-bom';
import { SKU } from '@/types/sku';
import { Price } from '@/types/price';
import { Branch } from '@/types/branch';
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
import { Plus, Trash2, Edit2, Check, X, Search, UtensilsCrossed, DollarSign, Maximize2, Minimize2, Upload } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface MenuBOMPageProps {
  menuBomData: {
    lines: MenuBomLine[];
    loading: boolean;
    getLinesForMenu: (menuId: string) => MenuBomLine[];
    addLine: (data: Omit<MenuBomLine, 'id'>) => Promise<void>;
    updateLine: (id: string, data: Partial<Omit<MenuBomLine, 'id'>>) => Promise<void>;
    deleteLine: (id: string) => Promise<void>;
  };
  menus: Menu[];
  skus: SKU[];
  prices: Price[];
  branches: Branch[];
  readOnly?: boolean;
}

export default function MenuBOMPage({ menuBomData, menus, skus, prices, branches, readOnly = false }: MenuBOMPageProps) {
  const { isManagement } = useAuth();
  const canEdit = isManagement && !readOnly;

  const [selectedMenuId, setSelectedMenuId] = useState<string | null>(null);
  const [menuSearch, setMenuSearch] = useState('');
  const [fullscreen, setFullscreen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);

  // Inline editing state
  const [addingLine, setAddingLine] = useState(false);
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [formSkuId, setFormSkuId] = useState('');
  const [formQty, setFormQty] = useState(0);
  const [formUom, setFormUom] = useState('');
  const [formYield, setFormYield] = useState(100);

  // Eligible SKUs: RM, SM, SP
  const eligibleSkus = useMemo(() => skus.filter(s => ['RM', 'SM', 'SP'].includes(s.type)), [skus]);

  const getSkuById = (id: string) => skus.find(s => s.id === id);

  const getActiveCost = (skuId: string): number => {
    const active = prices.find(p => p.skuId === skuId && p.isActive);
    return active?.pricePerUsageUom ?? 0;
  };

  const calcEffectiveQty = (qty: number, yieldPct: number) => {
    if (yieldPct <= 0) return qty;
    return qty / (yieldPct / 100);
  };

  const calcCostPerServing = (effectiveQty: number, skuId: string) => {
    return effectiveQty * getActiveCost(skuId);
  };

  const selectedMenu = menus.find(m => m.id === selectedMenuId) ?? null;
  const selectedLines = selectedMenuId ? menuBomData.getLinesForMenu(selectedMenuId) : [];
  const totalCost = selectedLines.reduce((sum, l) => sum + l.costPerServing, 0);

  const filteredMenus = useMemo(() => {
    const q = menuSearch.toLowerCase();
    return menus.filter(m =>
      m.menuCode.toLowerCase().includes(q) || m.menuName.toLowerCase().includes(q)
    );
  }, [menus, menuSearch]);

  // Inline add
  const startAddLine = () => {
    setFormSkuId('');
    setFormQty(0);
    setFormUom('');
    setFormYield(100);
    setAddingLine(true);
    setEditingLineId(null);
  };

  const startEditLine = (line: MenuBomLine) => {
    setFormSkuId(line.skuId);
    setFormQty(line.qtyPerServing);
    setFormUom(line.uom);
    setFormYield(line.yieldPct);
    setEditingLineId(line.id);
    setAddingLine(false);
  };

  const handleSkuChange = (id: string) => {
    setFormSkuId(id);
    const sku = getSkuById(id);
    if (sku) setFormUom(sku.usageUom);
  };

  const saveLine = async () => {
    if (!formSkuId || !selectedMenuId) { toast.error('Select a SKU'); return; }
    if (formQty <= 0) { toast.error('Qty must be > 0'); return; }

    const effectiveQty = calcEffectiveQty(formQty, formYield);
    const costPerServing = calcCostPerServing(effectiveQty, formSkuId);

    if (editingLineId) {
      await menuBomData.updateLine(editingLineId, {
        skuId: formSkuId,
        qtyPerServing: formQty,
        uom: formUom,
        yieldPct: formYield,
        effectiveQty,
        costPerServing,
      });
      toast.success('Ingredient updated');
      setEditingLineId(null);
    } else {
      await menuBomData.addLine({
        menuId: selectedMenuId,
        skuId: formSkuId,
        qtyPerServing: formQty,
        uom: formUom,
        yieldPct: formYield,
        effectiveQty,
        costPerServing,
      });
      toast.success('Ingredient added');
      // Auto-continue: reset form for next ingredient
      setFormSkuId('');
      setFormQty(0);
      setFormUom('');
      setFormYield(100);
    }
  };

  const cancelEdit = () => {
    setAddingLine(false);
    setEditingLineId(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') cancelEdit();
  };

  // Computed preview
  const previewEffQty = calcEffectiveQty(formQty, formYield);
  const previewCost = calcCostPerServing(previewEffQty, formSkuId);

  const renderInlineRow = () => (
    <TableRow className="bg-muted/30 h-9" onKeyDown={handleKeyDown}>
      <TableCell>
        <SearchableSelect
          value={formSkuId}
          onValueChange={handleSkuChange}
          options={eligibleSkus.map(s => ({ value: s.id, label: `${s.skuId} — ${s.name}`, sublabel: s.skuId }))}
          placeholder="Select SKU"
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
        <Input type="number" className="h-8 w-full text-xs text-right font-mono" value={formYield}
          onChange={e => setFormYield(Number(e.target.value) || 100)} />
      </TableCell>
      <TableCell className="text-xs text-right font-mono">{formSkuId ? previewEffQty.toFixed(2) : '—'}</TableCell>
      <TableCell className="text-xs text-right font-mono">
        {formSkuId ? (() => {
          const c = getActiveCost(formSkuId);
          return c > 0 ? `฿${c.toFixed(4)}` : <span className="text-orange-500">—</span>;
        })() : '—'}
      </TableCell>
      <TableCell className="text-xs text-right font-mono font-medium">
        {formSkuId && previewCost > 0 ? `฿${previewCost.toFixed(2)}` : formSkuId ? <span className="text-orange-500">—</span> : '—'}
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
        <h2 className="text-2xl font-heading font-bold">Menu BOM</h2>
        <p className="text-sm text-muted-foreground mt-0.5">Bill of Materials per menu item — ingredients and costing</p>
      </div>

      <div className={`grid gap-4 ${fullscreen ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-[320px_1fr]'}`}>
        {/* Left panel: menu list */}
        {!fullscreen && (
          <Card className="h-fit max-h-[calc(100vh-200px)] flex flex-col">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Menus</CardTitle>
              <div className="relative mt-2">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search menus..."
                  value={menuSearch}
                  onChange={e => setMenuSearch(e.target.value)}
                  className="pl-9 h-9 text-sm"
                />
              </div>
            </CardHeader>
            <CardContent className="flex-1 overflow-auto p-0">
              <div className="divide-y">
                {filteredMenus.map(m => {
                  const lineCount = menuBomData.getLinesForMenu(m.id).length;
                  const menuCost = menuBomData.getLinesForMenu(m.id).reduce((s, l) => s + l.costPerServing, 0);
                  return (
                    <button
                      key={m.id}
                      onClick={() => { setSelectedMenuId(m.id); cancelEdit(); }}
                      className={`w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors ${
                        selectedMenuId === m.id ? 'bg-primary/5 border-l-2 border-primary' : ''
                      }`}
                    >
                      <p className="text-sm font-medium">{m.menuCode} · {m.menuName}</p>
                      <p className="text-xs text-muted-foreground">
                        {lineCount} ingredients {menuCost > 0 && <span className="font-mono">· ฿{menuCost.toFixed(2)}/serving</span>}
                      </p>
                    </button>
                  );
                })}
                {filteredMenus.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-6">No menus found</p>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Right panel */}
        <div className="space-y-4">
          {!selectedMenu ? (
            <Card>
              <CardContent className="py-16 flex flex-col items-center justify-center gap-3">
                <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center">
                  <UtensilsCrossed className="w-7 h-7 text-muted-foreground" />
                </div>
                <p className="font-medium">Select a menu from the left to view its BOM</p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Header */}
              <Card>
                <CardContent className="p-6 flex items-center justify-between">
                  <div>
                    <h3 className="text-xl font-heading font-bold">{selectedMenu.menuName}</h3>
                    <p className="text-[13px] text-muted-foreground mt-0.5">{selectedMenu.menuCode} · {selectedMenu.category}</p>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-center p-3 rounded-lg bg-primary/10 min-w-[140px]">
                      <p className="text-[11px] uppercase text-muted-foreground flex items-center justify-center gap-1">
                        <DollarSign className="w-3 h-3" /> Total Cost/Serving
                      </p>
                      <p className="text-xl font-bold text-primary font-mono">฿{totalCost.toFixed(2)}</p>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => setFullscreen(!fullscreen)}>
                      {fullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Ingredients table */}
              <Card>
                <CardContent className="p-0 overflow-hidden">
                  <Table className="table-fixed">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-[11px] uppercase text-muted-foreground" style={{ width: 120 }}>SKU Code</TableHead>
                        <TableHead className="text-[11px] uppercase text-muted-foreground">Name</TableHead>
                        <TableHead className="text-[11px] uppercase text-muted-foreground text-right" style={{ width: 80 }}>Qty/Serving</TableHead>
                        <TableHead className="text-[11px] uppercase text-muted-foreground" style={{ width: 70 }}>UOM</TableHead>
                        <TableHead className="text-[11px] uppercase text-muted-foreground text-right" style={{ width: 80 }}>Yield %</TableHead>
                        <TableHead className="text-[11px] uppercase text-muted-foreground text-right" style={{ width: 90 }}>Eff. Qty</TableHead>
                        <TableHead className="text-[11px] uppercase text-muted-foreground text-right" style={{ width: 100 }}>Cost/unit</TableHead>
                        <TableHead className="text-[11px] uppercase text-muted-foreground text-right" style={{ width: 100 }}>Line Cost</TableHead>
                        {canEdit && <TableHead className="text-[11px] uppercase text-muted-foreground" style={{ width: 70 }}></TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {selectedLines.length === 0 && !addingLine && (
                        <TableRow>
                          <TableCell colSpan={canEdit ? 9 : 8} className="py-16">
                            <div className="flex flex-col items-center justify-center gap-3">
                              <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center">
                                <UtensilsCrossed className="w-7 h-7 text-muted-foreground" />
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
                        const sku = getSkuById(line.skuId);
                        const unitCost = getActiveCost(line.skuId);
                        if (editingLineId === line.id) return <>{renderInlineRow()}</>;
                        return (
                          <TableRow key={line.id} className="h-9">
                            <TableCell className="text-[13px] font-mono py-2 px-3">
                              {sku?.skuId ?? '—'}
                            </TableCell>
                            <TableCell className="text-[13px] truncate overflow-hidden py-2 px-3" title={sku?.name ?? '—'}>
                              {sku?.name ?? '—'}
                            </TableCell>
                            <TableCell className="text-[13px] text-right font-mono py-2 px-3">{line.qtyPerServing}</TableCell>
                            <TableCell className="text-[13px] py-2 px-3">{line.uom}</TableCell>
                            <TableCell className="text-[13px] text-right font-mono py-2 px-3">{line.yieldPct}%</TableCell>
                            <TableCell className="text-[13px] text-right font-mono py-2 px-3">{line.effectiveQty.toFixed(2)}</TableCell>
                            <TableCell className="text-[13px] text-right font-mono py-2 px-3">
                              {unitCost > 0 ? `฿${unitCost.toFixed(4)}` : <span className="text-orange-500">—</span>}
                            </TableCell>
                            <TableCell className="text-[13px] text-right font-mono font-medium py-2 px-3">
                              {line.costPerServing > 0 ? `฿${line.costPerServing.toFixed(2)}` : <span className="text-orange-500">—</span>}
                            </TableCell>
                            {canEdit && (
                              <TableCell className="py-2 px-3">
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
                  {totalCost > 0 && (
                    <div className="border-t px-6 py-3 flex justify-end">
                      <p className="text-sm">Total cost/serving: <span className="font-bold font-mono text-primary">฿{totalCost.toFixed(2)}</span></p>
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
        description={`Remove "${deleteConfirm?.name}" from this menu's BOM?`}
        confirmLabel="Remove"
        onConfirm={async () => {
          if (deleteConfirm) {
            await menuBomData.deleteLine(deleteConfirm.id);
            toast.success('Ingredient removed');
            setDeleteConfirm(null);
          }
        }}
      />
    </div>
  );
}
