import { Price } from '@/types/price';
import { SKU } from '@/types/sku';
import { Supplier } from '@/types/supplier';
import { Button } from '@/components/ui/button';
import { Pencil, Trash2, DollarSign } from 'lucide-react';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useState } from 'react';
import { SearchInput } from '@/components/SearchInput';
import { SkeletonTable } from '@/components/SkeletonTable';
import { EmptyState } from '@/components/EmptyState';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface PriceTableProps {
  prices: Price[];
  skus: SKU[];
  suppliers: Supplier[];
  onEdit: (price: Price) => void;
  onDelete: (id: string) => void;
  loading?: boolean;
}

export function PriceTable({ prices, skus, suppliers, onEdit, onDelete, loading }: PriceTableProps) {
  const [search, setSearch] = useState('');
  const [filterSku, setFilterSku] = useState<string>('all');

  const skuMap = Object.fromEntries(skus.map(s => [s.id, s]));
  const supplierMap = Object.fromEntries(suppliers.map(s => [s.id, s]));

  const filtered = prices.filter(p => {
    const sku = skuMap[p.skuId];
    const supplier = supplierMap[p.supplierId];
    const q = search.toLowerCase();
    const matchesSearch =
      (sku?.name || '').toLowerCase().includes(q) ||
      (sku?.skuId || '').toLowerCase().includes(q) ||
      (supplier?.name || '').toLowerCase().includes(q);
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

  if (loading) return <SkeletonTable columns={9} rows={8} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search SKU or supplier..."
          className="flex-1"
          totalCount={prices.length}
          filteredCount={sorted.length}
          entityName="prices"
        />
        <Select value={filterSku} onValueChange={setFilterSku}>
          <SelectTrigger className="w-full sm:w-[220px]">
            <SelectValue placeholder="All SKUs" />
          </SelectTrigger>
          <SelectContent className="max-h-60">
            <SelectItem value="all">All SKUs</SelectItem>
            {skus.map(s => (
              <SelectItem key={s.id} value={s.id}>
                <span className="font-mono text-xs mr-1.5">{s.skuId}</span>
                <span>{s.name}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-table-header">
                <th className="text-left px-4 py-3 table-header">SKU</th>
                <th className="text-left px-4 py-3 table-header">Supplier</th>
                <th className="text-right px-4 py-3 table-header">Price/Purchase UOM</th>
                <th className="text-right px-4 py-3 table-header">Price/Usage UOM</th>
                <th className="text-center px-4 py-3 table-header">VAT</th>
                <th className="text-center px-4 py-3 table-header">Active</th>
                <th className="text-left px-4 py-3 table-header">Eff. Date</th>
                <th className="text-left px-4 py-3 table-header">Note</th>
                <th className="text-right px-4 py-3 table-header">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4">
                    <EmptyState
                      icon={DollarSign}
                      title={prices.length === 0 ? 'No prices yet' : 'No prices match your filters'}
                      description={prices.length === 0 ? 'Add your first price entry' : 'Try adjusting your search or filter'}
                    />
                  </td>
                </tr>
              ) : (
                <TooltipProvider>
                  {sorted.map((price, idx) => {
                    const sku = skuMap[price.skuId];
                    const supplier = supplierMap[price.supplierId];
                    return (
                      <tr
                        key={price.id}
                        className={`border-b border-table-border last:border-0 table-row-hover transition-colors ${
                          price.isActive ? 'bg-success/5' : idx % 2 === 1 ? 'bg-table-alt' : ''
                        }`}
                      >
                        <td className="px-4 py-3">
                          <div className="font-medium">{sku?.name || '—'}</div>
                          <div className="text-xs text-muted-foreground font-mono">{sku?.skuId || '—'}</div>
                        </td>
                        <td className="px-4 py-3">{supplier?.name || '—'}</td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums">
                          {price.pricePerPurchaseUom.toFixed(2)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums font-semibold">
                          {price.pricePerUsageUom.toFixed(2)}
                        </td>
                        <td className="px-4 py-3 text-center text-xs">
                          {price.vat ? 'Yes' : 'No'}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {price.isActive ? (
                            <span className="pill-active">Active</span>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{price.effectiveDate}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground max-w-[120px]">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="truncate block">{price.note || '—'}</span>
                            </TooltipTrigger>
                            {price.note && <TooltipContent>{price.note}</TooltipContent>}
                          </Tooltip>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="icon-btn-edit" onClick={() => onEdit(price)}>
                                  <Pencil className="w-3.5 h-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Edit</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="icon-btn-delete" onClick={() => onDelete(price.id)}>
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Delete</TooltipContent>
                            </Tooltip>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </TooltipProvider>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
