import { Price } from '@/types/price';
import { SKU } from '@/types/sku';
import { Supplier } from '@/types/supplier';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Pencil, Trash2, Search } from 'lucide-react';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useState } from 'react';

interface PriceTableProps {
  prices: Price[];
  skus: SKU[];
  suppliers: Supplier[];
  onEdit: (price: Price) => void;
  onDelete: (id: string) => void;
}

export function PriceTable({ prices, skus, suppliers, onEdit, onDelete }: PriceTableProps) {
  const [search, setSearch] = useState('');
  const [filterSku, setFilterSku] = useState<string>('all');

  const skuMap = Object.fromEntries(skus.map(s => [s.id, s]));
  const supplierMap = Object.fromEntries(suppliers.map(s => [s.id, s]));

  const filtered = prices.filter(p => {
    const sku = skuMap[p.skuId];
    const supplier = supplierMap[p.supplierId];
    const matchesSearch =
      (sku?.name || '').toLowerCase().includes(search.toLowerCase()) ||
      (sku?.skuId || '').toLowerCase().includes(search.toLowerCase()) ||
      (supplier?.name || '').toLowerCase().includes(search.toLowerCase());
    const matchesSku = filterSku === 'all' || p.skuId === filterSku;
    return matchesSearch && matchesSku;
  });

  // Sort: active first, then by SKU name
  const sorted = [...filtered].sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    const nameA = skuMap[a.skuId]?.name || '';
    const nameB = skuMap[b.skuId]?.name || '';
    return nameA.localeCompare(nameB);
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search SKU or supplier..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={filterSku} onValueChange={setFilterSku}>
          <SelectTrigger className="w-full sm:w-[220px]">
            <SelectValue placeholder="All SKUs" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All SKUs</SelectItem>
            {skus.map(s => (
              <SelectItem key={s.id} value={s.id}>{s.skuId} — {s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">SKU</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Supplier</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Price/Purchase UOM</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Price/Usage UOM</th>
                <th className="text-center px-4 py-3 font-medium text-muted-foreground">VAT</th>
                <th className="text-center px-4 py-3 font-medium text-muted-foreground">Active</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Eff. Date</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Note</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-muted-foreground">
                    {prices.length === 0 ? 'No prices yet. Add your first one!' : 'No prices match your filters.'}
                  </td>
                </tr>
              ) : (
                sorted.map(price => {
                  const sku = skuMap[price.skuId];
                  const supplier = supplierMap[price.supplierId];
                  return (
                    <tr
                      key={price.id}
                      className={`border-b last:border-0 transition-colors ${
                        price.isActive
                          ? 'bg-success/5 hover:bg-success/10'
                          : 'hover:bg-muted/30'
                      }`}
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium">{sku?.name || '—'}</div>
                        <div className="text-xs text-muted-foreground font-mono">{sku?.skuId || '—'}</div>
                      </td>
                      <td className="px-4 py-3">{supplier?.name || '—'}</td>
                      <td className="px-4 py-3 text-right font-mono">
                        {price.pricePerPurchaseUom.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-semibold">
                        {price.pricePerUsageUom.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-center text-xs">
                        {price.vat ? 'Yes' : 'No'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {price.isActive ? (
                          <span className="inline-flex px-2 py-0.5 rounded text-xs font-semibold bg-success/10 text-success">Active</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{price.effectiveDate}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground max-w-[120px] truncate">{price.note}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEdit(price)}>
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => onDelete(price.id)}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{sorted.length} of {prices.length} prices shown</p>
    </div>
  );
}
