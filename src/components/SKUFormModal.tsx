import { useEffect, useState } from 'react';
import { SKU, SKUType, SKUStatus, StorageCondition, EMPTY_SKU, SKU_TYPE_LABELS } from '@/types/sku';
import { Supplier } from '@/types/supplier';
import { SkuCategory } from '@/hooks/use-sku-categories';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { AlertTriangle, Loader2, Check, Plus, Save, X, Settings } from 'lucide-react';
import { toast } from 'sonner';

interface SKUFormModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: Omit<SKU, 'id' | 'skuId'>, newSkuCode?: string) => void;
  editingSku?: SKU | null;
  activeSuppliers?: Supplier[];
  isSkuUsed?: boolean;
  allSkus?: SKU[];
  skuCategories?: SkuCategory[];
  onAddCategory?: (code: string, nameEn: string, nameTh: string) => Promise<SkuCategory | null>;
  onManageCategories?: () => void;
}

export function SKUFormModal({ open, onClose, onSubmit, editingSku, activeSuppliers = [], isSkuUsed = false, allSkus = [], skuCategories = [], onAddCategory, onManageCategories }: SKUFormModalProps) {
  const [form, setForm] = useState<Omit<SKU, 'id' | 'skuId'>>(EMPTY_SKU);
  const [skuCode, setSkuCode] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCatCode, setNewCatCode] = useState('');
  const [newCatEn, setNewCatEn] = useState('');
  const [newCatTh, setNewCatTh] = useState('');

  const typePrefix: Record<SKUType, string> = { RM: 'RM-', SM: 'SM-', SP: 'SP-', PK: 'PK-' };

  const suggestNextSkuCode = (type: SKUType): string => {
    const nums = allSkus
      .filter(s => s.type === type)
      .map(s => {
        const m = s.skuId.match(new RegExp(`^${type}-(\\d+)$`));
        return m ? parseInt(m[1], 10) : 0;
      });
    const max = nums.length > 0 ? Math.max(...nums) : 0;
    return `${type}-${String(max + 1).padStart(4, '0')}`;
  };

  useEffect(() => {
    if (editingSku) {
      const { id, skuId, ...rest } = editingSku;
      setForm(rest);
      setSkuCode(skuId);
    } else {
      setForm(EMPTY_SKU);
      setSkuCode(suggestNextSkuCode(EMPTY_SKU.type));
    }
    setErrors({});
    setSaving(false);
    setSaved(false);
    setShowAddCategory(false);
  }, [editingSku, open]);

  // Auto-update suggestion when Type changes in add mode
  useEffect(() => {
    if (!editingSku && open) {
      setSkuCode(suggestNextSkuCode(form.type));
      setErrors(prev => { const n = { ...prev }; delete n.skuCode; return n; });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.type]);

  const skuCodeChanged = editingSku && skuCode !== editingSku.skuId;

  const validateSkuCode = (code: string, type: SKUType): string | null => {
    const expectedPrefix = typePrefix[type];
    if (!code.trim()) return 'SKU Code is required';
    if (!/^[A-Z]{2}-\d{4}$/.test(code)) return 'SKU code must follow format: XX-XXXX (e.g. RM-0001)';
    if (!code.startsWith(expectedPrefix)) return `SKU code must start with ${expectedPrefix} for ${SKU_TYPE_LABELS[type]} type`;
    const dupe = allSkus.some(s => s.skuId === code && (!editingSku || s.id !== editingSku.id));
    if (dupe) return 'This SKU code already exists';
    return null;
  };

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = 'SKU Name is required';
    if (!form.packUnit.trim()) errs.packUnit = 'Pack Unit is required';
    if (!form.purchaseUom.trim()) errs.purchaseUom = 'Purchase UOM is required';
    if (!form.usageUom.trim()) errs.usageUom = 'Usage UOM is required';
    if (form.packSize <= 0) errs.packSize = 'Must be a positive number';
    if (form.converter <= 0) errs.converter = 'Must be a positive number';

    if (!editingSku) {
      const codeErr = validateSkuCode(skuCode, form.type);
      if (codeErr) errs.skuCode = codeErr;
    } else if (skuCode !== editingSku.skuId) {
      const codeErr = validateSkuCode(skuCode, form.type);
      if (codeErr) errs.skuCode = codeErr;
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleBlur = (key: string) => {
    if (key === 'name' && !form.name.trim()) setErrors(prev => ({ ...prev, name: 'SKU Name is required' }));
    else if (key === 'packUnit' && !form.packUnit.trim()) setErrors(prev => ({ ...prev, packUnit: 'Pack Unit is required' }));
    else if (key === 'purchaseUom' && !form.purchaseUom.trim()) setErrors(prev => ({ ...prev, purchaseUom: 'Purchase UOM is required' }));
    else if (key === 'usageUom' && !form.usageUom.trim()) setErrors(prev => ({ ...prev, usageUom: 'Usage UOM is required' }));
    else if (key === 'skuCode') {
      const codeErr = validateSkuCode(skuCode, form.type);
      if (codeErr) setErrors(prev => ({ ...prev, skuCode: codeErr }));
      else setErrors(prev => { const n = { ...prev }; delete n.skuCode; return n; });
    }
  };

  const errorCount = Object.keys(errors).length;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) {
      toast.error(`Please fix ${Object.keys(errors).length} error(s) before saving`);
      return;
    }
    setSaving(true);
    try {
      const codeToPass = editingSku ? (skuCodeChanged ? skuCode : undefined) : skuCode;
      onSubmit(form, codeToPass);
      setSaved(true);
      setTimeout(() => { onClose(); setSaved(false); }, 400);
    } finally {
      setSaving(false);
    }
  };

  const update = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors(prev => { const n = { ...prev }; delete n[key]; return n; });
  };

  const handleAddCategory = async () => {
    if (!onAddCategory) return;
    const result = await onAddCategory(newCatCode, newCatEn, newCatTh);
    if (result) {
      update('category', result.code);
      setShowAddCategory(false);
      setNewCatCode('');
      setNewCatEn('');
      setNewCatTh('');
      toast.success(`Category "${result.code}" added`);
    }
  };

  const typeIsLocked = !!editingSku && isSkuUsed;
  const isFormValid = form.name.trim() && form.packUnit.trim() && form.purchaseUom.trim() && form.usageUom.trim() && form.packSize > 0 && form.converter > 0;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl">
        <DialogHeader className="border-b pb-4">
          <DialogTitle className="font-heading text-xl">
            {editingSku ? `Edit ${editingSku.skuId}` : 'Add New SKU'}
          </DialogTitle>
        </DialogHeader>

        {errorCount > 0 && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2.5 text-sm text-destructive flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            Please fix {errorCount} error{errorCount > 1 ? 's' : ''} before saving
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          {/* SKU Code (editable in edit mode) */}
          {editingSku && (
            <div>
              <Label>SKU Code</Label>
              <Input
                value={skuCode}
                onChange={e => {
                  setSkuCode(e.target.value.toUpperCase());
                  if (errors.skuCode) setErrors(prev => { const n = { ...prev }; delete n.skuCode; return n; });
                }}
                placeholder="e.g. RM-0001"
                className={errors.skuCode ? 'input-error' : ''}
              />
              {errors.skuCode && <p className="text-xs text-destructive mt-1">{errors.skuCode}</p>}
              {skuCodeChanged && !errors.skuCode && (
                <div className="mt-2 rounded-lg border border-yellow-400/50 bg-yellow-50 dark:bg-yellow-900/20 px-4 py-2.5 text-sm text-yellow-800 dark:text-yellow-200 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-yellow-600" />
                  <span>Changing this SKU code will update all references in BOM, prices, receipts, and stock records. Make sure the new code follows the format: RM-XXXX, SM-XXXX, SP-XXXX, or PK-XXXX</span>
                </div>
              )}
            </div>
          )}

          {/* Row 1 */}
          <div>
            <Label className="label-required">SKU Name</Label>
            <Input value={form.name} onChange={e => update('name', e.target.value)} onBlur={() => handleBlur('name')} placeholder="Enter SKU name" className={errors.name ? 'input-error' : ''} />
            {errors.name && <p className="text-xs text-destructive mt-1">{errors.name}</p>}
          </div>

          {/* Row 2 */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label className="label-required">Type</Label>
              {typeIsLocked ? (
                <div>
                  <div className="h-10 flex items-center px-3 rounded-md border bg-muted/50 text-sm">
                    {form.type} — {SKU_TYPE_LABELS[form.type]}
                  </div>
                  <p className="text-xs text-warning mt-1 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> Type locked — in use
                  </p>
                </div>
              ) : (
                <Select value={form.type} onValueChange={v => update('type', v as SKUType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(['RM', 'SM', 'SP', 'PK'] as SKUType[]).map(t => (
                      <SelectItem key={t} value={t}>{t} — {SKU_TYPE_LABELS[t]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div>
              <Label className="label-required">Category</Label>
              <Select value={form.category} onValueChange={v => update('category', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-60">
                  {skuCategories.map(c => (
                    <SelectItem key={c.code} value={c.code}>{c.code} — {c.nameEn}</SelectItem>
                  ))}
                  <div className="border-t mt-1 pt-1 px-1 space-y-1">
                    {!showAddCategory ? (
                      <>
                        <Button type="button" variant="ghost" size="sm" className="w-full justify-start text-primary text-xs" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowAddCategory(true); }}>
                          <Plus className="w-3 h-3 mr-1" /> Add Category
                        </Button>
                        {onManageCategories && (
                          <Button type="button" variant="ghost" size="sm" className="w-full justify-start text-muted-foreground text-xs" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onManageCategories(); onClose(); }}>
                            <Settings className="w-3 h-3 mr-1" /> Manage Categories
                          </Button>
                        )}
                      </>
                    ) : (
                      <div className="p-2 space-y-2" onClick={e => e.stopPropagation()}>
                        <Input value={newCatCode} onChange={e => setNewCatCode(e.target.value.toUpperCase())} placeholder="Code (e.g. BV)" className="h-7 text-xs font-mono" maxLength={4} />
                        <Input value={newCatEn} onChange={e => setNewCatEn(e.target.value)} placeholder="Name EN" className="h-7 text-xs" />
                        <Input value={newCatTh} onChange={e => setNewCatTh(e.target.value)} placeholder="ชื่อ TH" className="h-7 text-xs" />
                        <div className="flex gap-1">
                          <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowAddCategory(false)}><X className="w-3 h-3" /></Button>
                          <Button type="button" size="sm" className="h-7 text-xs flex-1" disabled={!newCatCode.trim() || !newCatEn.trim()} onClick={handleAddCategory}><Save className="w-3 h-3 mr-1" /> Save</Button>
                        </div>
                      </div>
                    )}
                  </div>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Status</Label>
              <Select value={form.status} onValueChange={v => update('status', v as SKUStatus)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Active">Active</SelectItem>
                  <SelectItem value="Inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Row 3 - Pack */}
          <div className="grid grid-cols-4 gap-4">
            <div>
              <Label className="label-required">Pack Size</Label>
              <Input type="number" min={0} value={form.packSize} onChange={e => update('packSize', Number(e.target.value))} className={errors.packSize ? 'input-error' : ''} />
              {errors.packSize && <p className="text-xs text-destructive mt-1">{errors.packSize}</p>}
            </div>
            <div>
              <Label className="label-required">Pack Unit</Label>
              <Input value={form.packUnit} onChange={e => update('packUnit', e.target.value)} onBlur={() => handleBlur('packUnit')} placeholder="e.g. แพ็ค" className={errors.packUnit ? 'input-error' : ''} />
              {errors.packUnit && <p className="text-xs text-destructive mt-1">{errors.packUnit}</p>}
            </div>
            <div>
              <Label className="label-required">Purchase UOM</Label>
              <Input value={form.purchaseUom} onChange={e => update('purchaseUom', e.target.value)} onBlur={() => handleBlur('purchaseUom')} placeholder="e.g. ก." className={errors.purchaseUom ? 'input-error' : ''} />
              {errors.purchaseUom && <p className="text-xs text-destructive mt-1">{errors.purchaseUom}</p>}
            </div>
            <div>
              <Label className="label-required">Usage UOM</Label>
              <Input value={form.usageUom} onChange={e => update('usageUom', e.target.value)} onBlur={() => handleBlur('usageUom')} placeholder="e.g. ก." className={errors.usageUom ? 'input-error' : ''} />
              {errors.usageUom && <p className="text-xs text-destructive mt-1">{errors.usageUom}</p>}
            </div>
          </div>

          {/* Row 4 - Storage */}
          <div className="grid grid-cols-4 gap-4">
            <div>
              <Label className="label-required">Converter</Label>
              <Input type="number" min={0} step="any" value={form.converter} onChange={e => update('converter', Number(e.target.value))} className={errors.converter ? 'input-error' : ''} />
              {errors.converter && <p className="text-xs text-destructive mt-1">{errors.converter}</p>}
            </div>
            <div>
              <Label>Storage Condition</Label>
              <Select value={form.storageCondition} onValueChange={v => update('storageCondition', v as StorageCondition)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Frozen">Frozen</SelectItem>
                  <SelectItem value="Chilled">Chilled</SelectItem>
                  <SelectItem value="Ambient">Ambient</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Shelf Life (days)</Label>
              <Input type="number" min={0} value={form.shelfLife} onChange={e => update('shelfLife', Number(e.target.value))} />
            </div>
            <div className="flex flex-col gap-2">
              <Label>VAT</Label>
              <div className="flex items-center gap-2 h-10">
                <Switch checked={form.vat} onCheckedChange={v => update('vat', v)} />
                <span className="text-sm text-muted-foreground">{form.vat ? 'Yes' : 'No'}</span>
              </div>
            </div>
          </div>

          {/* Row 5 - Suppliers */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label>1st Supplier</Label>
              <Select value={form.supplier1 || '_none'} onValueChange={v => update('supplier1', v === '_none' ? '' : v)}>
                <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
                <SelectContent className="max-h-60">
                  <SelectItem value="_none">— None —</SelectItem>
                  {activeSuppliers.map(s => (
                    <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>2nd Supplier</Label>
              <Select value={form.supplier2 || '_none'} onValueChange={v => update('supplier2', v === '_none' ? '' : v)}>
                <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
                <SelectContent className="max-h-60">
                  <SelectItem value="_none">— None —</SelectItem>
                  {activeSuppliers.map(s => (
                    <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Lead Time (days)</Label>
              <Input type="number" min={0} value={form.leadTime} onChange={e => update('leadTime', Number(e.target.value))} />
            </div>
          </div>

          {/* Spec Note */}
          <div>
            <Label>Spec Note</Label>
            <Textarea value={form.specNote} onChange={e => update('specNote', e.target.value)} rows={2} placeholder="Optional specification notes..." />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2 border-t">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving || !isFormValid}>
              {saving ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</>
              ) : saved ? (
                <><Check className="w-4 h-4" /> Saved!</>
              ) : (
                editingSku ? 'Update SKU' : 'Add SKU'
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
