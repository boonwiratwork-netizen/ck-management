import { useEffect, useState, useMemo } from 'react';
import { Price, EMPTY_PRICE } from '@/types/price';
import { SKU } from '@/types/sku';
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

interface PriceFormModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: Omit<Price, 'id' | 'pricePerUsageUom'>, sku: SKU | undefined) => void;
  editing?: Price | null;
  skus: SKU[];
  activeSuppliers: Supplier[];
}

export function PriceFormModal({ open, onClose, onSubmit, editing, skus, activeSuppliers }: PriceFormModalProps) {
  const [form, setForm] = useState<Omit<Price, 'id' | 'pricePerUsageUom'>>(EMPTY_PRICE);

  useEffect(() => {
    if (editing) {
      const { id, pricePerUsageUom, ...rest } = editing;
      setForm(rest);
    } else {
      setForm(EMPTY_PRICE);
    }
  }, [editing, open]);

  const selectedSku = useMemo(() => skus.find(s => s.id === form.skuId), [skus, form.skuId]);

  const calculatedUsagePrice = useMemo(() => {
    if (!selectedSku || selectedSku.packSize === 0) return 0;
    return (form.pricePerPurchaseUom / selectedSku.packSize) / selectedSku.converter;
  }, [form.pricePerPurchaseUom, selectedSku]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(form, selectedSku);
    onClose();
  };

  const update = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading text-xl">
            {editing ? 'Edit Price' : 'Add New Price'}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-5 pt-2">
          {/* SKU */}
          <div>
            <Label>SKU *</Label>
            <Select value={form.skuId || '_none'} onValueChange={v => update('skuId', v === '_none' ? '' : v)}>
              <SelectTrigger><SelectValue placeholder="Select SKU" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_none">— Select SKU —</SelectItem>
                {skus.map(s => (
                  <SelectItem key={s.id} value={s.id}>{s.skuId} — {s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Supplier */}
          <div>
            <Label>Supplier *</Label>
            <Select value={form.supplierId || '_none'} onValueChange={v => update('supplierId', v === '_none' ? '' : v)}>
              <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_none">— Select Supplier —</SelectItem>
                {activeSuppliers.map(s => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Prices */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Price per Purchase UOM *</Label>
              <Input
                type="number"
                min={0}
                step="any"
                required
                value={form.pricePerPurchaseUom || ''}
                onChange={e => update('pricePerPurchaseUom', Number(e.target.value))}
                placeholder="0.00"
              />
            </div>
            <div>
              <Label>Price per Usage UOM</Label>
              <div className="h-10 flex items-center px-3 rounded-md border bg-muted/50 font-mono text-sm font-semibold">
                {calculatedUsagePrice.toFixed(2)}
              </div>
              {selectedSku && (
                <p className="text-xs text-muted-foreground mt-1">
                  = {form.pricePerPurchaseUom} ÷ {selectedSku.packSize} ÷ {selectedSku.converter}
                </p>
              )}
            </div>
          </div>

          {/* VAT & Active */}
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label>VAT</Label>
              <div className="flex items-center gap-2 h-10">
                <Switch checked={form.vat} onCheckedChange={v => update('vat', v)} />
                <span className="text-sm text-muted-foreground">{form.vat ? 'Yes' : 'No'}</span>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Label>Active Price</Label>
              <div className="flex items-center gap-2 h-10">
                <Switch checked={form.isActive} onCheckedChange={v => update('isActive', v)} />
                <span className="text-sm text-muted-foreground">{form.isActive ? 'Yes' : 'No'}</span>
              </div>
            </div>
          </div>

          {/* Effective Date */}
          <div>
            <Label>Effective Date *</Label>
            <Input
              type="date"
              required
              value={form.effectiveDate}
              onChange={e => update('effectiveDate', e.target.value)}
            />
          </div>

          {/* Note */}
          <div>
            <Label>Note</Label>
            <Textarea value={form.note} onChange={e => update('note', e.target.value)} rows={2} placeholder="Optional notes..." />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={!form.skuId || !form.supplierId}>
              {editing ? 'Update Price' : 'Add Price'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
