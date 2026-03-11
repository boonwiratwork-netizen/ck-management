import { GoodsReceipt } from '@/types/goods-receipt';
import { SKU } from '@/types/sku';
import { Supplier } from '@/types/supplier';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Pencil, Trash2, Search } from 'lucide-react';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useState } from 'react';

interface Props {
  receipts: GoodsReceipt[];
  skus: SKU[];
  suppliers: Supplier[];
  onEdit: (receipt: GoodsReceipt) => void;
  onDelete: (id: string) => void;
}

export function GoodsReceiptTable({ receipts, skus, suppliers, onEdit, onDelete }: Props) {
  const [search, setSearch] = useState('');
  const [filterSupplier, setFilterSupplier] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const skuMap = Object.fromEntries(skus.map(s => [s.id, s]));
  const supplierMap = Object.fromEntries(suppliers.map(s => [s.id, s]));

  const filtered = receipts.filter(r => {
    const sku = skuMap[r.skuId];
    const supplier = supplierMap[r.supplierId];
    const matchesSearch =
      (sku?.name || '').toLowerCase().includes(search.toLowerCase()) ||
      (sku?.skuId || '').toLowerCase().includes(search.toLowerCase()) ||
      (supplier?.name || '').toLowerCase().includes(search.toLowerCase());
    const matchesSupplier = filterSupplier === 'all' || r.supplierId === filterSupplier;
    const matchesDateFrom = !dateFrom || r.receiptDate >= dateFrom;
    const matchesDateTo = !dateTo || r.receiptDate <= dateTo;
    return matchesSearch && matchesSupplier && matchesDateFrom && matchesDateTo;
  });

  const sorted = [...filtered].sort((a, b) => b.receiptDate.localeCompare(a.receiptDate));

  return (
    <div className="space-y-4">
      {/* Filters */}
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
        <Select value={filterSupplier} onValueChange={setFilterSupplier}>
          <SelectTrigger className="w-full sm:w-[200px]">
            <SelectValue placeholder="All Suppliers" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Suppliers</SelectItem>
            {suppliers.map(s => (
              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="date"
          value={dateFrom}
          onChange={e => setDateFrom(e.target.value)}
          className="w-full sm:w-[160px]"
          placeholder="From"
        />
        <Input
          type="date"
          value={dateTo}
          onChange={e => setDateTo(e.target.value)}
          className="w-full sm:w-[160px]"
          placeholder="To"
        />
      </div>

      {/* Table */}
      <div className="rounded-lg border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm table-fixed">
            <thead>
              <tr className="bg-table-header border-b">
                <th className="text-left px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Date</th>
                <th className="text-center px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Wk</th>
                <th className="text-left px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">SKU</th>
                <th className="text-left px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Supplier</th>
                <th className="text-right px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Qty</th>
                <th className="text-center px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">UOM</th>
                <th className="text-right px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Actual ฿</th>
                <th className="text-right px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Standard ฿</th>
                <th className="text-right px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Variance</th>
                <th className="text-left px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Note</th>
                <th className="text-right px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-12 text-center text-muted-foreground">
                    {receipts.length === 0 ? 'No receipts yet. Add your first one!' : 'No receipts match your filters.'}
                  </td>
                </tr>
              ) : (
                sorted.map(r => {
                  const sku = skuMap[r.skuId];
                  const supplier = supplierMap[r.supplierId];
                  return (
                    <tr key={r.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 text-xs">{r.receiptDate}</td>
                      <td className="px-4 py-3 text-center text-xs font-mono">{r.weekNumber}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium">{sku?.name || '—'}</div>
                        <div className="text-xs text-muted-foreground font-mono">{sku?.skuId || '—'}</div>
                      </td>
                      <td className="px-4 py-3">{supplier?.name || '—'}</td>
                      <td className="px-4 py-3 text-right font-mono">{r.quantityReceived.toLocaleString()}</td>
                      <td className="px-4 py-3 text-center text-xs">{r.usageUom || '—'}</td>
                      <td className="px-4 py-3 text-right font-mono">{r.actualTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td className="px-4 py-3 text-right font-mono">{r.standardPrice.toFixed(2)}</td>
                      <td className={`px-4 py-3 text-right font-mono font-semibold ${
                        r.priceVariance > 0 ? 'text-destructive' : r.priceVariance < 0 ? 'text-success' : ''
                      }`}>
                        {r.priceVariance > 0 ? '+' : ''}{r.priceVariance.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground max-w-[120px] truncate">{r.note}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEdit(r)}>
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => onDelete(r.id)}>
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
      <p className="text-xs text-muted-foreground">{sorted.length} of {receipts.length} receipts shown</p>
    </div>
  );
}
