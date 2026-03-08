import { useEffect, useState } from 'react';
import { SKU, SKUType, Category, SKUStatus, StorageCondition, EMPTY_SKU, SKU_TYPE_LABELS, CATEGORY_LABELS } from '@/types/sku';
import { Supplier } from '@/types/supplier';
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
import { AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

interface SKUFormModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: Omit<SKU, 'id' | 'skuId'>) => void;
  editingSku?: SKU | null;
  activeSuppliers?: Supplier[];
  isSkuUsed?: boolean;
}

export function SKUFormModal({ open, onClose, onSubmit, editingSku, activeSuppliers = [], isSkuUsed = false }: SKUFormModalProps) {
  const [form, setForm] = useState<Omit<SKU, 'id' | 'skuId'>>(EMPTY_SKU);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (editingSku) {
      const { id, skuId, ...rest } = editingSku;
      setForm(rest);
    } else {
      setForm(EMPTY_SKU);
    }
    setErrors({});
  }, [editingSku, open]);

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = 'SKU Name is required';
    if (!form.packUnit.trim()) errs.packUnit = 'Pack Unit is required';
    if (!form.purchaseUom.trim()) errs.purchaseUom = 'Purchase UOM is required';
    if (!form.usageUom.trim()) errs.usageUom = 'Usage UOM is required';
    if (form.packSize <= 0) errs.packSize = 'Pack Size must be > 0';
    if (form.converter <= 0) errs.converter = 'Converter must be > 0';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) {
      toast.error('Please fill in all required fields');
      return;
    }
    onSubmit(form);
    onClose();
  };

  const update = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors(prev => { const n = { ...prev }; delete n[key]; return n; });
  };

  const originalType = editingSku?.type;
  const typeIsLocked = !!editingSku && isSkuUsed;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading text-xl">
            {editingSku ? `Edit ${editingSku.skuId}` : 'Add New SKU'}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-5 pt-2">
          {/* Row 1 */}
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Label>SKU Name *</Label>
              <Input value={form.name} onChange={e => update('name', e.target.value)} placeholder="Enter SKU name" className={errors.name ? 'border-destructive' : ''} />
              {errors.name && <p className="text-xs text-destructive mt-1">{errors.name}</p>}
            </div>
          </div>

          {/* Row 2 */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label>Type *</Label>
              {typeIsLocked ? (
                <div>
                  <div className="h-10 flex items-center px-3 rounded-md border bg-muted/50 text-sm">
                    {form.type} — {SKU_TYPE_LABELS[form.type]}
                  </div>
                  <p className="text-xs text-warning mt-1 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> Type locked — SKU is used in BOM/Receipt/Production
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
              <Label>Category *</Label>
              <Select value={form.category} onValueChange={v => update('category', v as Category)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(CATEGORY_LABELS) as Category[]).map(c => (
                    <SelectItem key={c} value={c}>{c} — {CATEGORY_LABELS[c]}</SelectItem>
                  ))}
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
              <Label>Pack Size *</Label>
              <Input type="number" min={0} value={form.packSize} onChange={e => update('packSize', Number(e.target.value))} className={errors.packSize ? 'border-destructive' : ''} />
              {errors.packSize && <p className="text-xs text-destructive mt-1">{errors.packSize}</p>}
            </div>
            <div>
              <Label>Pack Unit *</Label>
              <Input value={form.packUnit} onChange={e => update('packUnit', e.target.value)} placeholder="e.g. แพ็ค" className={errors.packUnit ? 'border-destructive' : ''} />
              {errors.packUnit && <p className="text-xs text-destructive mt-1">{errors.packUnit}</p>}
            </div>
            <div>
              <Label>Purchase UOM *</Label>
              <Input value={form.purchaseUom} onChange={e => update('purchaseUom', e.target.value)} placeholder="e.g. ก." className={errors.purchaseUom ? 'border-destructive' : ''} />
              {errors.purchaseUom && <p className="text-xs text-destructive mt-1">{errors.purchaseUom}</p>}
            </div>
            <div>
              <Label>Usage UOM *</Label>
              <Input value={form.usageUom} onChange={e => update('usageUom', e.target.value)} placeholder="e.g. ก." className={errors.usageUom ? 'border-destructive' : ''} />
              {errors.usageUom && <p className="text-xs text-destructive mt-1">{errors.usageUom}</p>}
            </div>
          </div>

          {/* Row 4 - Storage */}
          <div className="grid grid-cols-4 gap-4">
            <div>
              <Label>Converter *</Label>
              <Input type="number" min={0} step="any" value={form.converter} onChange={e => update('converter', Number(e.target.value))} className={errors.converter ? 'border-destructive' : ''} />
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
                <SelectContent>
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
                <SelectContent>
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
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit">{editingSku ? 'Update SKU' : 'Add SKU'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
