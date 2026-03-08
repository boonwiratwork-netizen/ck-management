import { useEffect, useState, useMemo } from 'react';
import { GoodsReceipt, EMPTY_GOODS_RECEIPT } from '@/types/goods-receipt';
import { SKU } from '@/types/sku';
import { Supplier } from '@/types/supplier';
import { Price } from '@/types/price';
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

type FormData = Omit<GoodsReceipt, 'id' | 'weekNumber' | 'purchaseUom' | 'standardPrice' | 'priceVariance'>;

interface Props {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: FormData, sku: SKU | undefined) => void;
  editing?: GoodsReceipt | null;
  rmSkus: SKU[];
  suppliers: Supplier[];
  prices: Price[];
}

export function GoodsReceiptFormModal({ open, onClose, onSubmit, editing, rmSkus, suppliers, prices }: Props) {
  const [form, setForm] = useState<FormData>({ ...EMPTY_GOODS_RECEIPT });

  useEffect(() => {
    if (editing) {
      const { id, weekNumber, purchaseUom, standardPrice, priceVariance, ...rest } = editing;
      setForm(rest);
    } else {
      setForm({ ...EMPTY_GOODS_RECEIPT, receiptDate: new Date().toISOString().slice(0, 10) });
    }
  }, [editing, open]);

  const selectedSku = useMemo(() => rmSkus.find(s => s.id === form.skuId), [rmSkus, form.skuId]);

  const standardPrice = useMemo(() => {
    if (!form.skuId || !form.supplierId) return 0;
    const active = prices.find(p => p.skuId === form.skuId && p.supplierId === form.supplierId && p.isActive);
    return active?.pricePerPurchaseUom ?? 0;
  }, [form.skuId, form.supplierId, prices]);

  const variance = form.actualPrice - standardPrice;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(form, selectedSku);
    onClose();
  };

  const update = <K extends keyof FormData>(key: K, value: FormData[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading text-xl">
            {editing ? 'Edit Goods Receipt' : 'Add Goods Receipt'}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-5 pt-2">
          {/* Receipt Date */}
          <div>
            <Label>Receipt Date *</Label>
            <Input
              type="date"
              required
              value={form.receiptDate}
              onChange={e => update('receiptDate', e.target.value)}
            />
          </div>

          {/* SKU (RM only) */}
          <div>
            <Label>SKU (Raw Material) *</Label>
            <Select value={form.skuId || '_none'} onValueChange={v => update('skuId', v === '_none' ? '' : v)}>
              <SelectTrigger><SelectValue placeholder="Select RM SKU" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_none">— Select SKU —</SelectItem>
                {rmSkus.map(s => (
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
                {suppliers.map(s => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Quantity + Purchase UOM */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Quantity Received *</Label>
              <Input
                type="number"
                min={0}
                step="any"
                required
                value={form.quantityReceived || ''}
                onChange={e => update('quantityReceived', Number(e.target.value))}
                placeholder="0"
              />
            </div>
            <div>
              <Label>Purchase UOM</Label>
              <div className="h-10 flex items-center px-3 rounded-md border bg-muted/50 text-sm">
                {selectedSku?.purchaseUom || '—'}
              </div>
            </div>
          </div>

          {/* Prices */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label>Actual Price *</Label>
              <Input
                type="number"
                min={0}
                step="any"
                required
                value={form.actualPrice || ''}
                onChange={e => update('actualPrice', Number(e.target.value))}
                placeholder="0.00"
              />
            </div>
            <div>
              <Label>Standard Price</Label>
              <div className="h-10 flex items-center px-3 rounded-md border bg-muted/50 font-mono text-sm">
                {standardPrice.toFixed(2)}
              </div>
            </div>
            <div>
              <Label>Variance</Label>
              <div className={`h-10 flex items-center px-3 rounded-md border font-mono text-sm font-semibold ${
                variance > 0 ? 'bg-destructive/10 text-destructive' : variance < 0 ? 'bg-success/10 text-success' : 'bg-muted/50'
              }`}>
                {variance > 0 ? '+' : ''}{variance.toFixed(2)}
              </div>
            </div>
          </div>

          {/* Note */}
          <div>
            <Label>Note</Label>
            <Textarea value={form.note} onChange={e => update('note', e.target.value)} rows={2} placeholder="Optional notes..." />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={!form.skuId || !form.supplierId || !form.quantityReceived}>
              {editing ? 'Update Receipt' : 'Add Receipt'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
