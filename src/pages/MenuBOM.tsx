import { useState, useMemo } from 'react';
import { Menu } from '@/types/menu';
import { MenuBomLine } from '@/types/menu-bom';
import { SKU } from '@/types/sku';
import { Price } from '@/types/price';
import { Branch } from '@/types/branch';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, Edit2, Check, X, Search, UtensilsCrossed, DollarSign } from 'lucide-react';
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
  const [modalOpen, setModalOpen] = useState(false);
  const [editingLine, setEditingLine] = useState<MenuBomLine | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);

  // Form state
  const [formSkuId, setFormSkuId] = useState('');
  const [formQty, setFormQty] = useState(0);
  const [formUom, setFormUom] = useState('');
  const [formYield, setFormYield] = useState(100);
  const [skuSearch, setSkuSearch] = useState('');

  // Eligible SKUs: RM, SM, SP only
  const eligibleSkus = useMemo(() => skus.filter(s => ['RM', 'SM', 'SP'].includes(s.type)), [skus]);

  const getSkuById = (id: string) => skus.find(s => s.id === id);
  const getBranchName = (id: string | null) => branches.find(b => b.id === id)?.branchName ?? '—';

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

  // Selected menu
  const selectedMenu = menus.find(m => m.id === selectedMenuId) ?? null;
  const selectedLines = selectedMenuId ? menuBomData.getLinesForMenu(selectedMenuId) : [];
  const totalCost = selectedLines.reduce((sum, l) => sum + l.costPerServing, 0);

  // Filter menus
  const filteredMenus = useMemo(() => {
    const q = menuSearch.toLowerCase();
    return menus.filter(m =>
      m.menuCode.toLowerCase().includes(q) || m.menuName.toLowerCase().includes(q)
    );
  }, [menus, menuSearch]);

  // Open add modal
  const openAddModal = () => {
    setEditingLine(null);
    setFormSkuId('');
    setFormQty(0);
    setFormUom('');
    setFormYield(100);
    setSkuSearch('');
    setModalOpen(true);
  };

  // Open edit modal
  const openEditModal = (line: MenuBomLine) => {
    setEditingLine(line);
    setFormSkuId(line.skuId);
    setFormQty(line.qtyPerServing);
    setFormUom(line.uom);
    setFormYield(line.yieldPct);
    setSkuSearch('');
    setModalOpen(true);
  };

  // When SKU changes, pre-fill UOM
  const handleSkuChange = (id: string) => {
    setFormSkuId(id);
    const sku = getSkuById(id);
    if (sku) setFormUom(sku.usageUom);
  };

  // Computed preview values
  const previewEffQty = calcEffectiveQty(formQty, formYield);
  const previewCost = calcCostPerServing(previewEffQty, formSkuId);

  const handleSubmit = async () => {
    if (!formSkuId || !selectedMenuId) { toast.error('Please select a SKU'); return; }
    if (formQty <= 0) { toast.error('Quantity must be > 0'); return; }

    const effectiveQty = calcEffectiveQty(formQty, formYield);
    const costPerServing = calcCostPerServing(effectiveQty, formSkuId);

    if (editingLine) {
      await menuBomData.updateLine(editingLine.id, {
        skuId: formSkuId,
        qtyPerServing: formQty,
        uom: formUom,
        yieldPct: formYield,
        effectiveQty,
        costPerServing,
      });
      toast.success('Ingredient updated');
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
    }
    setModalOpen(false);
  };

  const filteredEligibleSkus = useMemo(() => {
    if (!skuSearch) return eligibleSkus;
    const q = skuSearch.toLowerCase();
    return eligibleSkus.filter(s => s.skuId.toLowerCase().includes(q) || s.name.toLowerCase().includes(q));
  }, [eligibleSkus, skuSearch]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-heading font-bold">Menu BOM</h2>
        <p className="text-sm text-muted-foreground mt-0.5">Bill of Materials per menu item — ingredients and costing</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
        {/* Left panel: menu list */}
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
              {filteredMenus.map(m => (
                <button
                  key={m.id}
                  onClick={() => setSelectedMenuId(m.id)}
                  className={`w-full text-left px-4 py-2.5 hover:bg-muted/50 transition-colors ${
                    selectedMenuId === m.id ? 'bg-primary/10 border-l-2 border-primary' : ''
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">{m.menuCode} <span className="font-normal text-muted-foreground">{m.menuName}</span></p>
                      <p className="text-xs text-muted-foreground">
                        {menuBomData.getLinesForMenu(m.id).length} ingredients · {getBranchName(m.branchId)}
                      </p>
                    </div>
                  </div>
                </button>
              ))}
              {filteredMenus.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-6">No menus found</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Right panel: BOM for selected menu */}
        <div className="space-y-4">
          {!selectedMenu ? (
            <Card>
              <CardContent className="py-16 text-center text-muted-foreground">
                <UtensilsCrossed className="w-10 h-10 mx-auto mb-3 opacity-40" />
                <p>Select a menu from the left to view its BOM</p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Header */}
              <Card>
                <CardContent className="py-4 flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-heading font-bold">{selectedMenu.menuName}</h3>
                    <p className="text-sm text-muted-foreground">{selectedMenu.menuCode} · {selectedMenu.category}</p>
                  </div>
                  <div className="text-right">
                    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <DollarSign className="w-4 h-4" />
                      Total Cost / Serving
                    </div>
                    <p className="text-xl font-bold font-heading">฿{totalCost.toFixed(2)}</p>
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
                        <TableHead>Type</TableHead>
                        <TableHead className="text-right">Qty/Serving</TableHead>
                        <TableHead>UOM</TableHead>
                        <TableHead className="text-right">Yield %</TableHead>
                        <TableHead className="text-right">Eff. Qty</TableHead>
                        <TableHead className="text-right">Cost/Serving</TableHead>
                        {canEdit && <TableHead className="w-20">Actions</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {selectedLines.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={canEdit ? 9 : 8} className="text-center text-muted-foreground py-8">
                            No ingredients yet
                          </TableCell>
                        </TableRow>
                      ) : (
                        selectedLines.map(line => {
                          const sku = getSkuById(line.skuId);
                          return (
                            <TableRow key={line.id}>
                              <TableCell className="font-mono text-xs">{sku?.skuId ?? '—'}</TableCell>
                              <TableCell>{sku?.name ?? '—'}</TableCell>
                              <TableCell>
                                <Badge variant="outline" className="text-[10px]">{sku?.type ?? '—'}</Badge>
                              </TableCell>
                              <TableCell className="text-right">{line.qtyPerServing}</TableCell>
                              <TableCell>{line.uom}</TableCell>
                              <TableCell className="text-right">{line.yieldPct}%</TableCell>
                              <TableCell className="text-right">{line.effectiveQty.toFixed(2)}</TableCell>
                              <TableCell className="text-right font-medium">฿{line.costPerServing.toFixed(2)}</TableCell>
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
            {/* SKU search dropdown */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">SKU</label>
              <Select value={formSkuId} onValueChange={handleSkuChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Select SKU..." />
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
                  {filteredEligibleSkus.map(s => (
                    <SelectItem key={s.id} value={s.id}>
                      <span className="font-mono text-xs mr-2">{s.skuId}</span>
                      {s.name}
                      <Badge variant="outline" className="ml-2 text-[10px]">{s.type}</Badge>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Qty per serving */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Qty per Serving</label>
              <Input
                type="number"
                min={0}
                step="any"
                value={formQty || ''}
                onChange={e => setFormQty(Number(e.target.value))}
              />
            </div>

            {/* UOM */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">UOM</label>
              <Input value={formUom} onChange={e => setFormUom(e.target.value)} placeholder="e.g. g, ml, egg" />
            </div>

            {/* Yield % */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Yield %</label>
              <Input
                type="number"
                min={1}
                max={100}
                value={formYield || ''}
                onChange={e => setFormYield(Number(e.target.value))}
              />
            </div>

            {/* Preview */}
            <div className="rounded-md bg-muted/50 p-3 space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Effective Qty</span>
                <span className="font-medium">{previewEffQty.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Unit Price (active)</span>
                <span className="font-medium">฿{formSkuId ? getActiveCost(formSkuId).toFixed(4) : '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Cost / Serving</span>
                <span className="font-bold">฿{previewCost.toFixed(2)}</span>
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
