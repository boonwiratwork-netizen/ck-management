import { useState, useMemo } from 'react';
import { ModifierRule } from '@/types/modifier-rule';
import { SKU } from '@/types/sku';
import { Menu } from '@/types/menu';
import { useAuth } from '@/hooks/use-auth';
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
import { Plus, Trash2, Edit2, FlaskConical, CheckCircle2, XCircle } from 'lucide-react';
import { toast } from 'sonner';

interface ModifierRulesPageProps {
  ruleData: {
    rules: ModifierRule[];
    loading: boolean;
    addRule: (data: Omit<ModifierRule, 'id'>) => Promise<void>;
    updateRule: (id: string, data: Partial<Omit<ModifierRule, 'id'>>) => Promise<void>;
    deleteRule: (id: string) => Promise<void>;
  };
  skus: SKU[];
  menus: Menu[];
  readOnly?: boolean;
}

export default function ModifierRulesPage({ ruleData, skus, menus, readOnly = false }: ModifierRulesPageProps) {
  const { isManagement } = useAuth();
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
  const [formMenuId, setFormMenuId] = useState<string>('');
  const [skuSearch, setSkuSearch] = useState('');

  // RM + SP SKUs
  const eligibleSkus = useMemo(() => skus.filter(s => ['RM', 'SP'].includes(s.type)), [skus]);
  const getSkuById = (id: string) => skus.find(s => s.id === id);
  const getMenuById = (id: string) => menus.find(m => m.id === id);

  const filteredRules = useMemo(() => {
    return showActiveOnly ? ruleData.rules.filter(r => r.isActive) : ruleData.rules;
  }, [ruleData.rules, showActiveOnly]);

  const openAddModal = () => {
    setEditingRule(null);
    setFormKeyword('');
    setFormSkuId('');
    setFormQty(0);
    setFormUom('');
    setFormDesc('');
    setFormActive(true);
    setFormMenuId('');
    setSkuSearch('');
    setModalOpen(true);
  };

  const openEditModal = (rule: ModifierRule) => {
    setEditingRule(rule);
    setFormKeyword(rule.keyword);
    setFormSkuId(rule.skuId);
    setFormQty(rule.qtyPerMatch);
    setFormUom(rule.uom);
    setFormDesc(rule.description);
    setFormActive(rule.isActive);
    setFormMenuId(rule.menuId ?? '');
    setSkuSearch('');
    setModalOpen(true);
  };

  const handleSkuChange = (id: string) => {
    setFormSkuId(id);
    const sku = getSkuById(id);
    if (sku) setFormUom(sku.usageUom);
  };

  const handleSubmit = async () => {
    if (!formKeyword.trim()) { toast.error('Keyword is required'); return; }
    if (!formSkuId) { toast.error('Please select a SKU'); return; }
    if (formQty <= 0) { toast.error('Quantity must be > 0'); return; }

    const data = {
      keyword: formKeyword.trim(),
      skuId: formSkuId,
      qtyPerMatch: formQty,
      uom: formUom,
      description: formDesc,
      isActive: formActive,
      menuId: formMenuId || null,
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-heading font-bold">Menu Modifier Rules</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Define extra ingredient usage triggered by keywords found in POS menu name strings
          </p>
        </div>
        {canEdit && (
          <Button size="sm" onClick={openAddModal}>
            <Plus className="w-4 h-4" /> Add Rule
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
              <TableHead>Keyword</TableHead>
              <TableHead>Menu</TableHead>
              <TableHead>SKU Code</TableHead>
              <TableHead>SKU Name</TableHead>
              <TableHead className="text-right">Qty/Match</TableHead>
              <TableHead>UOM</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Active</TableHead>
              <TableHead className="w-24">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredRules.length === 0 ? (
              <TableRow>
                <TableCell colSpan={canEdit ? 9 : 8} className="text-center text-muted-foreground py-8">
                  No rules defined yet
                </TableCell>
              </TableRow>
            ) : (
              filteredRules.map(rule => {
                const sku = getSkuById(rule.skuId);
                const menu = rule.menuId ? getMenuById(rule.menuId) : null;
                return (
                  <TableRow key={rule.id}>
                    <TableCell className="font-medium">{rule.keyword}</TableCell>
                    <TableCell>
                      {menu ? (
                        <span className="font-mono text-xs">{menu.menuCode}</span>
                      ) : (
                        <span className="text-muted-foreground text-xs">All Menus</span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{sku?.skuId ?? '—'}</TableCell>
                    <TableCell>{sku?.name ?? '—'}</TableCell>
                    <TableCell className="text-right">{rule.qtyPerMatch}</TableCell>
                    <TableCell>{rule.uom}</TableCell>
                    <TableCell className="text-muted-foreground text-sm max-w-[200px] truncate">{rule.description || '—'}</TableCell>
                    <TableCell>
                      <Badge variant={rule.isActive ? 'default' : 'secondary'} className="text-[10px]">
                        {rule.isActive ? 'Active' : 'Inactive'}
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
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingRule ? 'Edit Rule' : 'Add Rule'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Keyword</label>
              <Input
                value={formKeyword}
                onChange={e => setFormKeyword(e.target.value)}
                placeholder='e.g. "เส้นโฮมเมด"'
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Apply to specific menu (optional)</label>
              <SearchableSelect
                value={formMenuId || '__all__'}
                onValueChange={v => setFormMenuId(v === '__all__' ? '' : v)}
                options={[
                  { value: '__all__', label: 'All Menus (global rule)' },
                  ...menus.map(m => ({ value: m.id, label: `${m.menuCode} ${m.menuName}`, sublabel: m.menuCode })),
                ]}
                placeholder="All Menus (global rule)"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">SKU (RM / SP)</label>
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

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Qty per Match</label>
              <Input
                type="number"
                min={0}
                step="any"
                value={formQty || ''}
                onChange={e => setFormQty(Number(e.target.value))}
                placeholder="e.g. 110"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">UOM</label>
              <Input value={formUom} onChange={e => setFormUom(e.target.value)} placeholder="e.g. g, ml, egg" />
            </div>

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
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit}>{editingRule ? 'Update' : 'Add'}</Button>
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
                {testResults.map(({ rule, sku }) => (
                  <div key={rule.id} className="rounded-md border p-2.5 text-sm space-y-0.5">
                    <p><span className="font-medium">Keyword:</span> "{rule.keyword}"</p>
                    <p><span className="font-medium">Adds:</span> {rule.qtyPerMatch} {rule.uom} of {sku?.skuId} ({sku?.name})</p>
                  </div>
                ))}
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
