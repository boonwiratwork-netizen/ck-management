import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { ModifierRule, ModifierRuleType } from '@/types/modifier-rule';
import { SKU } from '@/types/sku';
import { Menu } from '@/types/menu';
import { MenuBomLine } from '@/types/menu-bom';
import { useAuth } from '@/hooks/use-auth';
import { useLanguage } from '@/hooks/use-language';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SearchableSelect } from '@/components/SearchableSelect';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Plus, Trash2, Edit2, FlaskConical, CheckCircle2, XCircle, Copy, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface ModifierRulesPageProps {
  ruleData: {
    rules: ModifierRule[];
    loading: boolean;
    addRule: (data: Omit<ModifierRule, 'id'>) => Promise<ModifierRule | null>;
    updateRule: (id: string, data: Partial<Omit<ModifierRule, 'id'>>) => Promise<void>;
    deleteRule: (id: string) => Promise<void>;
  };
  skus: SKU[];
  menus: Menu[];
  menuBomLines?: MenuBomLine[];
  readOnly?: boolean;
}

// Multi-menu selector component with checkboxes, portal-based dropdown
function MultiMenuSelector({
  selectedMenuIds,
  onChangeMenuIds,
  menus,
}: {
  selectedMenuIds: string[];
  onChangeMenuIds: (ids: string[]) => void;
  menus: Menu[];
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [pos, setPos] = useState({ top: 0, left: 0, width: 220 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isGlobal = selectedMenuIds.length === 0;

  const filtered = useMemo(() => {
    if (!search) return menus;
    const q = search.toLowerCase();
    return menus.filter(m =>
      m.menuCode.toLowerCase().includes(q) ||
      m.menuName.toLowerCase().includes(q)
    );
  }, [menus, search]);

  const updatePosition = useCallback(() => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPos({
        top: rect.bottom + 4,
        left: rect.left,
        width: Math.max(rect.width, 280),
      });
    }
  }, []);

  useEffect(() => {
    if (open) {
      updatePosition();
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const handleScroll = () => updatePosition();
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleScroll);
    return () => {
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleScroll);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (
        triggerRef.current && !triggerRef.current.contains(target) &&
        dropdownRef.current && !dropdownRef.current.contains(target)
      ) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const toggleMenu = (menuId: string) => {
    if (selectedMenuIds.includes(menuId)) {
      onChangeMenuIds(selectedMenuIds.filter(id => id !== menuId));
    } else {
      onChangeMenuIds([...selectedMenuIds, menuId]);
    }
  };

  const removeMenu = (menuId: string) => {
    onChangeMenuIds(selectedMenuIds.filter(id => id !== menuId));
  };

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => { setOpen(!open); setSearch(''); }}
        className="flex items-center justify-between w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background hover:bg-accent/50 transition-colors"
      >
        <span className={cn('truncate', isGlobal && 'text-muted-foreground')}>
          {isGlobal ? 'All Menus (global rule)' : `${selectedMenuIds.length} menu(s) selected`}
        </span>
        <svg className="ml-2 h-4 w-4 shrink-0 opacity-50" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/></svg>
      </button>

      {/* Selected menu tags */}
      {selectedMenuIds.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {selectedMenuIds.map(id => {
            const m = menus.find(menu => menu.id === id);
            return (
              <Badge key={id} variant="secondary" className="text-[10px] gap-1 pr-1">
                {m ? `${m.menuCode} ${m.menuName}` : id}
                <button type="button" onClick={() => removeMenu(id)} className="hover:bg-muted rounded-full p-0.5">
                  <X className="w-2.5 h-2.5" />
                </button>
              </Badge>
            );
          })}
        </div>
      )}

      {open && (
        <div
          ref={dropdownRef}
          className="absolute left-0 right-0 rounded-md border bg-popover shadow-md z-50 mt-1"
          style={{ pointerEvents: 'auto' }}
          onMouseDown={e => e.stopPropagation()}
        >
          <div className="p-1.5">
            <Input
              ref={inputRef}
              placeholder="Search menus..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-8 text-xs"
              onMouseDown={e => e.stopPropagation()}
            />
          </div>
          <div className="max-h-[220px] overflow-y-auto p-1" style={{ pointerEvents: 'auto' }}>
            {/* All Menus option */}
            <button
              type="button"
              onClick={() => { onChangeMenuIds([]); setOpen(false); }}
              className={cn(
                'flex items-center w-full rounded-sm px-2 py-1.5 text-xs hover:bg-accent cursor-pointer',
                isGlobal && 'bg-accent'
              )}
            >
              <Checkbox checked={isGlobal} className="mr-2 h-3.5 w-3.5" tabIndex={-1} />
              <span className="font-medium">All Menus (global rule)</span>
            </button>
            <div className="h-px bg-border my-1" />
            {filtered.length === 0 && (
              <p className="py-4 text-center text-xs text-muted-foreground">No menus found</p>
            )}
            {filtered.map(m => (
              <button
                key={m.id}
                type="button"
                onClick={() => toggleMenu(m.id)}
                className={cn(
                  'flex items-center w-full rounded-sm px-2 py-1.5 text-xs hover:bg-accent cursor-pointer',
                  selectedMenuIds.includes(m.id) && 'bg-accent'
                )}
              >
                <Checkbox checked={selectedMenuIds.includes(m.id)} className="mr-2 h-3.5 w-3.5" tabIndex={-1} />
                <span className="truncate">{m.menuCode} {m.menuName}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ModifierRulesPage({ ruleData, skus, menus, menuBomLines = [], readOnly = false }: ModifierRulesPageProps) {
  const { isManagement } = useAuth();
  const { t } = useLanguage();
  const canEdit = isManagement && !readOnly;

  const [modalOpen, setModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<ModifierRule | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);
  const [showActiveOnly, setShowActiveOnly] = useState(false);
  const [testModalOpen, setTestModalOpen] = useState(false);
  const [testInput, setTestInput] = useState('');
  const [testResults, setTestResults] = useState<{ rule: ModifierRule; sku: SKU | undefined }[]>([]);

  // Form state
  const [formKeyword, setFormKeyword] = useState('');
  const [formSkuId, setFormSkuId] = useState('');
  const [formQty, setFormQty] = useState(0);
  const [formUom, setFormUom] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formActive, setFormActive] = useState(true);
  const [formMenuIds, setFormMenuIds] = useState<string[]>([]);
  const [formRuleType, setFormRuleType] = useState<ModifierRuleType>('add');
  const [formSwapSkuId, setFormSwapSkuId] = useState('');
  const [formSubmenuId, setFormSubmenuId] = useState('');
  const [skuSearch, setSkuSearch] = useState('');
  const [swapSkuSearch, setSwapSkuSearch] = useState('');

  // RM + SP SKUs
  const eligibleSkus = useMemo(() => skus.filter(s => ['RM', 'SP'].includes(s.type)), [skus]);
  const getSkuById = (id: string) => skus.find(s => s.id === id);
  const getMenuById = (id: string) => menus.find(m => m.id === id);

  const bomByMenuId = useMemo(() => {
    const m = new Map<string, MenuBomLine[]>();
    menuBomLines.forEach(l => {
      const arr = m.get(l.menuId) || [];
      arr.push(l);
      m.set(l.menuId, arr);
    });
    return m;
  }, [menuBomLines]);

  const filteredRules = useMemo(() => {
    return showActiveOnly ? ruleData.rules.filter(r => r.isActive) : ruleData.rules;
  }, [ruleData.rules, showActiveOnly]);

  const resetForm = (overrides?: Partial<Omit<ModifierRule, 'id'>>) => {
    setFormKeyword(overrides?.keyword ?? '');
    setFormSkuId(overrides?.skuId ?? '');
    setFormQty(overrides?.qtyPerMatch ?? 0);
    setFormUom(overrides?.uom ?? '');
    setFormDesc(overrides?.description ?? '');
    setFormActive(overrides?.isActive ?? true);
    setFormMenuIds(overrides?.menuIds ?? []);
    setFormRuleType(overrides?.ruleType ?? 'add');
    setFormSwapSkuId(overrides?.swapSkuId ?? '');
    setFormSubmenuId(overrides?.submenuId ?? '');
    setSkuSearch('');
    setSwapSkuSearch('');
  };

  const openAddModal = () => {
    setEditingRule(null);
    resetForm();
    setModalOpen(true);
  };

  const openEditModal = (rule: ModifierRule) => {
    setEditingRule(rule);
    resetForm({
      keyword: rule.keyword,
      skuId: rule.skuId,
      qtyPerMatch: rule.qtyPerMatch,
      uom: rule.uom,
      description: rule.description,
      isActive: rule.isActive,
      menuIds: rule.menuIds,
      ruleType: rule.ruleType,
      swapSkuId: rule.swapSkuId ?? '',
      submenuId: rule.submenuId ?? '',
    });
    setModalOpen(true);
  };

  const openDuplicateModal = (rule: ModifierRule) => {
    setEditingRule(null);
    resetForm({
      keyword: rule.keyword + ' (copy)',
      skuId: rule.skuId,
      qtyPerMatch: rule.qtyPerMatch,
      uom: rule.uom,
      description: rule.description,
      isActive: false, // inactive by default
      menuIds: [...rule.menuIds],
      ruleType: rule.ruleType,
      swapSkuId: rule.swapSkuId ?? '',
      submenuId: rule.submenuId ?? '',
    });
    setModalOpen(true);
  };

  const handleSkuChange = (id: string) => {
    setFormSkuId(id);
    const sku = getSkuById(id);
    if (sku) setFormUom(sku.usageUom);
  };

  const handleSubmit = async () => {
    if (!formKeyword.trim()) { toast.error('Keyword is required'); return; }

    if (formRuleType === 'add') {
      if (!formSkuId) { toast.error('Please select a SKU'); return; }
      if (formQty <= 0) { toast.error('Quantity must be > 0'); return; }
    } else if (formRuleType === 'swap') {
      if (!formSwapSkuId) { toast.error('Please select the Remove SKU'); return; }
      if (!formSkuId) { toast.error('Please select the Add SKU'); return; }
      if (formQty <= 0) { toast.error('Quantity must be > 0'); return; }
    } else if (formRuleType === 'submenu') {
      if (!formSubmenuId) { toast.error('Please select a submenu'); return; }
    }

    const data: Omit<ModifierRule, 'id'> = {
      keyword: formKeyword.trim(),
      skuId: formRuleType === 'submenu' ? '' : formSkuId,
      qtyPerMatch: formRuleType === 'submenu' ? 1 : formQty,
      uom: formRuleType === 'submenu' ? '' : formUom,
      description: formDesc,
      isActive: formActive,
      menuId: null,
      menuIds: formMenuIds,
      ruleType: formRuleType,
      swapSkuId: formRuleType === 'swap' ? formSwapSkuId : null,
      submenuId: formRuleType === 'submenu' ? formSubmenuId : null,
    };

    if (editingRule) {
      await ruleData.updateRule(editingRule.id, data);
      toast.success('Rule updated');
    } else {
      await ruleData.addRule(data);
      toast.success('Rule added');
    }
    setModalOpen(false);
  };

  const filteredEligibleSkus = useMemo(() => {
    if (!skuSearch) return eligibleSkus;
    const q = skuSearch.toLowerCase();
    return eligibleSkus.filter(s => s.skuId.toLowerCase().includes(q) || s.name.toLowerCase().includes(q));
  }, [eligibleSkus, skuSearch]);

  const filteredSwapSkus = useMemo(() => {
    if (!swapSkuSearch) return eligibleSkus;
    const q = swapSkuSearch.toLowerCase();
    return eligibleSkus.filter(s => s.skuId.toLowerCase().includes(q) || s.name.toLowerCase().includes(q));
  }, [eligibleSkus, swapSkuSearch]);

  const ruleTypeBadgeVariant = (t: ModifierRuleType) => {
    if (t === 'swap') return 'secondary' as const;
    if (t === 'submenu') return 'outline' as const;
    return 'default' as const;
  };

  const getMenuDisplay = (rule: ModifierRule) => {
    if (rule.menuIds.length === 0) {
      return <span className="text-muted-foreground text-xs">All Menus</span>;
    }
    if (rule.menuIds.length === 1) {
      const m = getMenuById(rule.menuIds[0]);
      return <span className="font-mono text-xs">{m?.menuCode || '?'}</span>;
    }
    return <span className="text-xs">{rule.menuIds.length} menus</span>;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-heading font-bold">{t('title.modifierRules')}</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Define extra ingredient usage triggered by keywords found in POS menu name strings
          </p>
        </div>
        {canEdit && (
          <Button size="sm" onClick={openAddModal}>
            <Plus className="w-4 h-4" /> {t('btn.addRule')}
          </Button>
        )}
      </div>

      {/* Filter */}
      <div className="flex items-center gap-2">
        <Switch checked={showActiveOnly} onCheckedChange={setShowActiveOnly} id="active-filter" />
        <label htmlFor="active-filter" className="text-sm text-muted-foreground cursor-pointer">Active only</label>
      </div>

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('col.keyword')}</TableHead>
              <TableHead>{t('col.ruleType')}</TableHead>
              <TableHead>{t('col.menu')}</TableHead>
              <TableHead>{t('col.skuCode')}</TableHead>
              <TableHead>{t('col.skuName')}</TableHead>
              <TableHead className="text-right">{t('col.qty')}</TableHead>
              <TableHead>{t('col.uom')}</TableHead>
              <TableHead>{t('col.description')}</TableHead>
              <TableHead>{t('col.status')}</TableHead>
              <TableHead className="w-28">{t('col.actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredRules.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                  No rules defined yet
                </TableCell>
              </TableRow>
            ) : (
              filteredRules.map(rule => {
                const sku = rule.skuId ? getSkuById(rule.skuId) : undefined;
                const swapSku = rule.swapSkuId ? getSkuById(rule.swapSkuId) : undefined;
                const submenu = rule.submenuId ? getMenuById(rule.submenuId) : null;

                let skuDisplay = sku?.skuId ?? '—';
                let skuNameDisplay: React.ReactNode = sku?.name ?? '—';

                if (rule.ruleType === 'swap') {
                  skuDisplay = `${swapSku?.skuId ?? '?'} → ${sku?.skuId ?? '?'}`;
                  skuNameDisplay = <span>{swapSku?.name ?? '?'} → {sku?.name ?? '?'}</span>;
                } else if (rule.ruleType === 'submenu') {
                  skuDisplay = submenu?.menuCode ?? '—';
                  skuNameDisplay = submenu?.menuName ?? '—';
                }

                return (
                  <TableRow key={rule.id}>
                    <TableCell className="font-medium">{rule.keyword}</TableCell>
                    <TableCell>
                      <Badge variant={ruleTypeBadgeVariant(rule.ruleType)} className="text-[10px] uppercase">
                        {rule.ruleType}
                      </Badge>
                    </TableCell>
                    <TableCell>{getMenuDisplay(rule)}</TableCell>
                    <TableCell className="font-mono text-xs">{skuDisplay}</TableCell>
                    <TableCell>{skuNameDisplay}</TableCell>
                    <TableCell className="text-right">{rule.ruleType === 'submenu' ? '—' : rule.qtyPerMatch}</TableCell>
                    <TableCell>{rule.ruleType === 'submenu' ? '—' : rule.uom}</TableCell>
                    <TableCell className="text-muted-foreground text-sm max-w-[200px] truncate">{rule.description || '—'}</TableCell>
                    <TableCell>
                      <Badge variant={rule.isActive ? 'default' : 'secondary'} className="text-[10px]">
                        {rule.isActive ? t('status.active') : t('status.inactive')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Test rule" onClick={() => {
                          setTestInput('');
                          setTestResults([]);
                          setTestModalOpen(true);
                        }}>
                          <FlaskConical className="w-3.5 h-3.5" />
                        </Button>
                        {canEdit && (
                          <>
                            <Button variant="ghost" size="icon" className="h-7 w-7" title="Duplicate rule" onClick={() => openDuplicateModal(rule)}>
                              <Copy className="w-3.5 h-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditModal(rule)}>
                              <Edit2 className="w-3.5 h-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setDeleteConfirm({ id: rule.id, name: rule.keyword })}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Add/Edit Modal */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="sm:max-w-md overflow-visible">
          <DialogHeader>
            <DialogTitle>{editingRule ? 'Edit Rule' : 'Add Rule'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Rule Type</label>
              <Select value={formRuleType} onValueChange={v => setFormRuleType(v as ModifierRuleType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="add">ADD — Add extra ingredient</SelectItem>
                  <SelectItem value="swap">SWAP — Replace one ingredient with another</SelectItem>
                  <SelectItem value="submenu">SUBMENU — Expand a sub-menu's BOM</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Keyword</label>
              <Input
                value={formKeyword}
                onChange={e => setFormKeyword(e.target.value)}
                placeholder='e.g. "เส้นโฮมเมด"'
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Apply to menus (optional)</label>
              <MultiMenuSelector
                selectedMenuIds={formMenuIds}
                onChangeMenuIds={setFormMenuIds}
                menus={menus}
              />
            </div>

            {/* ADD type fields */}
            {formRuleType === 'add' && (
              <>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">SKU (RM / SP)</label>
                  <Select value={formSkuId} onValueChange={handleSkuChange}>
                    <SelectTrigger><SelectValue placeholder="Select SKU..." /></SelectTrigger>
                    <SelectContent>
                      <div className="px-2 pb-2">
                        <Input placeholder="Search SKU..." value={skuSearch} onChange={e => setSkuSearch(e.target.value)} className="h-8 text-sm" onClick={e => e.stopPropagation()} />
                      </div>
                      {filteredEligibleSkus.map(s => (
                        <SelectItem key={s.id} value={s.id}>
                          <span className="font-mono text-xs mr-2">{s.skuId}</span>{s.name}
                          <Badge variant="outline" className="ml-2 text-[10px]">{s.type}</Badge>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Qty per Match</label>
                  <Input type="number" min={0} step="any" value={formQty || ''} onChange={e => setFormQty(Number(e.target.value))} placeholder="e.g. 110" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">UOM</label>
                  <Input value={formUom} onChange={e => setFormUom(e.target.value)} placeholder="e.g. g, ml, egg" />
                </div>
              </>
            )}

            {/* SWAP type fields */}
            {formRuleType === 'swap' && (
              <>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Remove SKU (ingredient to remove from BOM)</label>
                  <Select value={formSwapSkuId} onValueChange={setFormSwapSkuId}>
                    <SelectTrigger><SelectValue placeholder="Select SKU to remove..." /></SelectTrigger>
                    <SelectContent>
                      <div className="px-2 pb-2">
                        <Input placeholder="Search SKU..." value={swapSkuSearch} onChange={e => setSwapSkuSearch(e.target.value)} className="h-8 text-sm" onClick={e => e.stopPropagation()} />
                      </div>
                      {filteredSwapSkus.map(s => (
                        <SelectItem key={s.id} value={s.id}>
                          <span className="font-mono text-xs mr-2">{s.skuId}</span>{s.name}
                          <Badge variant="outline" className="ml-2 text-[10px]">{s.type}</Badge>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Add SKU (replacement ingredient)</label>
                  <Select value={formSkuId} onValueChange={handleSkuChange}>
                    <SelectTrigger><SelectValue placeholder="Select replacement SKU..." /></SelectTrigger>
                    <SelectContent>
                      <div className="px-2 pb-2">
                        <Input placeholder="Search SKU..." value={skuSearch} onChange={e => setSkuSearch(e.target.value)} className="h-8 text-sm" onClick={e => e.stopPropagation()} />
                      </div>
                      {filteredEligibleSkus.map(s => (
                        <SelectItem key={s.id} value={s.id}>
                          <span className="font-mono text-xs mr-2">{s.skuId}</span>{s.name}
                          <Badge variant="outline" className="ml-2 text-[10px]">{s.type}</Badge>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Qty per Match (for Add SKU)</label>
                  <Input type="number" min={0} step="any" value={formQty || ''} onChange={e => setFormQty(Number(e.target.value))} placeholder="e.g. 110" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">UOM</label>
                  <Input value={formUom} onChange={e => setFormUom(e.target.value)} placeholder="e.g. g, ml" />
                </div>
              </>
            )}

            {/* SUBMENU type fields */}
            {formRuleType === 'submenu' && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Submenu (expand this menu's BOM)</label>
                <SearchableSelect
                  value={formSubmenuId}
                  onValueChange={setFormSubmenuId}
                  options={menus.map(m => ({ value: m.id, label: `${m.menuCode} ${m.menuName}`, sublabel: m.menuCode }))}
                  placeholder="Select a menu..."
                />
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Description (optional)</label>
              <Input
                value={formDesc}
                onChange={e => setFormDesc(e.target.value)}
                placeholder='e.g. "เส้นโฮมเมด" → RM-0016 เส้นตรงโฮมเมด 110g'
              />
            </div>

            <div className="flex items-center gap-2">
              <Switch checked={formActive} onCheckedChange={setFormActive} id="form-active" />
              <label htmlFor="form-active" className="text-sm font-medium cursor-pointer">Active</label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>{t('btn.cancel')}</Button>
            <Button onClick={handleSubmit}>{editingRule ? t('btn.update') : t('btn.add')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Test Rule Modal */}
      <Dialog open={testModalOpen} onOpenChange={setTestModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FlaskConical className="w-4 h-4" /> Test modifier rules
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Paste a menu name string to test</label>
              <Textarea
                value={testInput}
                onChange={e => setTestInput(e.target.value)}
                placeholder='e.g. "ชิโอะ ราเมน เส้นโฮมเมด"'
                rows={3}
                className="text-sm"
              />
            </div>
            <Button
              size="sm"
              onClick={() => {
                if (!testInput.trim()) { toast.error('Enter a menu name string'); return; }
                const matched = ruleData.rules.filter(r => r.isActive && testInput.includes(r.keyword));
                setTestResults(matched.map(r => ({ rule: r, sku: getSkuById(r.skuId) })));
              }}
            >
              Run test
            </Button>
            {testResults.length > 0 ? (
              <div className="space-y-2">
                <p className="text-sm font-medium text-green-600 flex items-center gap-1">
                  <CheckCircle2 className="w-4 h-4" /> {testResults.length} rule(s) matched
                </p>
                {testResults.map(({ rule, sku }) => {
                  const swapSku = rule.swapSkuId ? getSkuById(rule.swapSkuId) : undefined;
                  const submenu = rule.submenuId ? getMenuById(rule.submenuId) : undefined;
                  const submenuBom = submenu ? bomByMenuId.get(submenu.id) || [] : [];

                  return (
                    <div key={rule.id} className="rounded-md border p-2.5 text-sm space-y-0.5">
                      <p>
                        <span className="font-medium">Keyword:</span> "{rule.keyword}"
                        <Badge variant={ruleTypeBadgeVariant(rule.ruleType)} className="ml-2 text-[10px] uppercase">{rule.ruleType}</Badge>
                      </p>
                      {rule.ruleType === 'add' && (
                        <p><span className="font-medium">Adds:</span> {rule.qtyPerMatch} {rule.uom} of {sku?.skuId} ({sku?.name})</p>
                      )}
                      {rule.ruleType === 'swap' && (
                        <>
                          <p><span className="font-medium">Removes:</span> {swapSku?.skuId} ({swapSku?.name}) — full BOM qty</p>
                          <p><span className="font-medium">Adds:</span> {rule.qtyPerMatch} {rule.uom} of {sku?.skuId} ({sku?.name})</p>
                        </>
                      )}
                      {rule.ruleType === 'submenu' && (
                        <>
                          <p><span className="font-medium">Expands BOM of:</span> {submenu?.menuCode} {submenu?.menuName}</p>
                          {submenuBom.length > 0 ? (
                            <div className="mt-1 pl-2 border-l-2 border-muted space-y-0.5">
                              {submenuBom.map(line => {
                                const lSku = getSkuById(line.skuId);
                                return (
                                  <p key={line.id} className="text-xs text-muted-foreground">
                                    + {line.effectiveQty.toFixed(2)} {lSku?.usageUom} of {lSku?.skuId} ({lSku?.name})
                                  </p>
                                );
                              })}
                            </div>
                          ) : (
                            <p className="text-xs text-muted-foreground">No BOM lines found for this submenu</p>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : testInput.trim() && (
              <p className="text-sm text-muted-foreground flex items-center gap-1">
                <XCircle className="w-4 h-4" /> No rules matched this string
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTestModalOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!deleteConfirm}
        onOpenChange={open => !open && setDeleteConfirm(null)}
        title="Delete Rule"
        description={`Delete rule for keyword "${deleteConfirm?.name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={async () => {
          if (deleteConfirm) {
            await ruleData.deleteRule(deleteConfirm.id);
            toast.success('Rule deleted');
            setDeleteConfirm(null);
          }
        }}
      />
    </div>
  );
}
