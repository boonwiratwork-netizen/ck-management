import { useEffect, useState, useMemo } from 'react';
import { Price, EMPTY_PRICE } from '@/types/price';
import { SKU } from '@/types/sku';
import { Supplier } from '@/types/supplier';
import { BOMHeader } from '@/types/bom';
import { supabase } from '@/integrations/supabase/client';
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
import { Search, AlertTriangle, Calculator } from 'lucide-react';
import { isBomPrice } from '@/lib/bom-price-sync';

interface PriceFormModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: Omit<Price, 'id' | 'pricePerUsageUom'>, sku: SKU | undefined) => void;
  editing?: Price | null;
  skus: SKU[];
  activeSuppliers: Supplier[];
  pricedSkuIds?: Set<string>;
  prices?: Price[];
  bomHeaders?: BOMHeader[];
}

export function PriceFormModal({ open, onClose, onSubmit, editing, skus, activeSuppliers, pricedSkuIds, prices = [], bomHeaders = [] }: PriceFormModalProps) {
  const [form, setForm] = useState<Omit<Price, 'id' | 'pricePerUsageUom'>>(EMPTY_PRICE);
  const [skuSearch, setSkuSearch] = useState('');

  useEffect(() => {
    if (editing) {
      const { id, pricePerUsageUom, ...rest } = editing;
      setForm(rest);
    } else {
      setForm(EMPTY_PRICE);
    }
    setSkuSearch('');
  }, [editing, open]);

  const selectedSku = useMemo(() => skus.find(s => s.id === form.skuId), [skus, form.skuId]);
  const isSmOrSp = selectedSku && (selectedSku.type === 'SM' || selectedSku.type === 'SP');

  // Check if there's a BOM for the selected SM/SP SKU
  const hasBom = useMemo(() => {
    if (!selectedSku) return false;
    if (selectedSku.type === 'SM') {
      return bomHeaders.some(h => h.smSkuId === selectedSku.id);
    }
    // For SP, check sp_bom via prices (if has BOM price)
    return false; // SP BOMs are handled in SpBom page
  }, [selectedSku, bomHeaders]);

  // Get the BOM-calculated cost for SM/SP
  const bomCost = useMemo(() => {
    if (!selectedSku || !isSmOrSp) return null;
    const bomPrice = prices.find(p => p.skuId === selectedSku.id && isBomPrice(p.supplierId) && p.isActive);
    return bomPrice?.pricePerUsageUom ?? null;
  }, [selectedSku, isSmOrSp, prices]);

  const filteredSkus = useMemo(() => {
    // Filter out SM/SP SKUs from the dropdown - they shouldn't be manually priced
    const eligibleSkus = skus.filter(s => s.type !== 'SM' && s.type !== 'SP');
    if (!skuSearch.trim()) return eligibleSkus;
    const q = skuSearch.toLowerCase();
    return eligibleSkus.filter(s =>
      s.skuId.toLowerCase().includes(q) ||
      s.name.toLowerCase().includes(q)
    );
  }, [skus, skuSearch]);

  const calculatedUsagePrice = useMemo(() => {
    if (!selectedSku || selectedSku.packSize === 0) return 0;
    return (form.pricePerPurchaseUom / selectedSku.packSize) / selectedSku.converter;
  }, [form.pricePerPurchaseUom, selectedSku]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isSmOrSp) return; // SM/SP prices are auto-managed
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
            <Select value={form.skuId || '_none'} onValueChange={v => { update('skuId', v === '_none' ? '' : v); setSkuSearch(''); }}>
              <SelectTrigger><SelectValue placeholder="Select SKU" /></SelectTrigger>
              <SelectContent className="max-h-72">
                <div className="px-2 pb-2 sticky top-0 bg-popover z-10">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground" />
                    <Input
                      placeholder="Search SKU code or name..."
                      value={skuSearch}
                      onChange={e => setSkuSearch(e.target.value)}
                      className="pl-8 h-8 text-sm"
                      onKeyDown={e => e.stopPropagation()}
                    />
                  </div>
                  {skuSearch && (
                    <p className="text-xs text-muted-foreground mt-1 px-0.5">
                      {filteredSkus.length} of {skus.filter(s => s.type !== 'SM' && s.type !== 'SP').length} SKUs
                    </p>
                  )}
                </div>
                <SelectItem value="_none">— Select SKU —</SelectItem>
                {filteredSkus.map(s => {
                  const hasNoPrice = pricedSkuIds && !pricedSkuIds.has(s.id);
                  return (
                    <SelectItem key={s.id} value={s.id}>
                      <span className="inline-flex items-center gap-1.5">
                        {hasNoPrice && (
                          <span className="inline-block w-2 h-2 rounded-full bg-warning flex-shrink-0" />
                        )}
                        <span className="font-mono text-xs">{s.skuId}</span>
                        <span className="mx-0.5">—</span>
                        <span>{s.name}</span>
                        {hasNoPrice && (
                          <span className="text-[10px] text-warning font-medium ml-1">No price</span>
                        )}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            {isSmOrSp && (
              <p className="text-xs text-muted-foreground mt-1">
                SM/SP prices are auto-calculated from BOM. Use RM SKUs for manual pricing.
              </p>
            )}
          </div>

          {/* SM/SP warning — this shouldn't really show since they're filtered out, but just in case */}
          {isSmOrSp ? (
            <div className="space-y-3">
              <div className="rounded-md border border-primary/20 bg-primary/5 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Calculator className="w-4 h-4 text-primary" />
                  <span className="text-sm font-medium">Price auto-calculated from BOM</span>
                </div>
                {bomCost !== null ? (
                  <p className="text-sm text-muted-foreground">
                    Cost/gram: <span className="font-mono font-semibold text-foreground">฿{bomCost.toFixed(4)}</span> (from BOM Master)
                  </p>
                ) : (
                  <div className="flex items-start gap-2 text-warning">
                    <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    <p className="text-sm">No BOM found — add a BOM first to get cost</p>
                  </div>
                )}
              </div>
              <div className="flex justify-end pt-2">
                <Button type="button" variant="outline" onClick={onClose}>Close</Button>
              </div>
            </div>
          ) : (
            <>
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
            </>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
