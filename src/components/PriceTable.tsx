import { Price } from '@/types/price';
import { SKU } from '@/types/sku';
import { Supplier } from '@/types/supplier';
import { Button } from '@/components/ui/button';
import { Pencil, Trash2, DollarSign, ArrowUp, ArrowDown, ArrowUpDown, Calculator } from 'lucide-react';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useState, useMemo } from 'react';
import { SearchInput } from '@/components/SearchInput';
import { SkeletonTable } from '@/components/SkeletonTable';
import { EmptyState } from '@/components/EmptyState';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { isBomPrice, BOM_SUPPLIER_NAME } from '@/lib/bom-price-sync';

interface PriceTableProps {
  prices: Price[];
  skus: SKU[];
  suppliers: Supplier[];
  onEdit: (price: Price) => void;
  onDelete: (id: string) => void;
  loading?: boolean;
  showUnpricedOnly?: boolean;
}

type SortKey = 'sku' | 'supplier';
type SortDir = 'asc' | 'desc';

export function PriceTable({ prices, skus, suppliers, onEdit, onDelete, loading, showUnpricedOnly }: PriceTableProps) {
  const [search, setSearch] = useState('');
  const [filterSku, setFilterSku] = useState<string>('all');
  const [sortKey, setSortKey] = useState<SortKey>('sku');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const skuMap = Object.fromEntries(skus.map(s => [s.id, s]));
  const supplierMap = Object.fromEntries(suppliers.map(s => [s.id, s]));

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-30" />;
    return sortDir === 'asc'
      ? <ArrowUp className="w-3 h-3 ml-1 text-primary" />
      : <ArrowDown className="w-3 h-3 ml-1 text-primary" />;
  };

  const sorted = useMemo(() => {
    const filtered = prices.filter(p => {
      const sku = skuMap[p.skuId];
      const supplier = supplierMap[p.supplierId];
      const q = search.toLowerCase();
      const supplierName = isBomPrice(p.supplierId) ? BOM_SUPPLIER_NAME : (supplier?.name || '');
      const matchesSearch =
        (sku?.name || '').toLowerCase().includes(q) ||
        (sku?.skuId || '').toLowerCase().includes(q) ||
        supplierName.toLowerCase().includes(q);
      const matchesSku = filterSku === 'all' || p.skuId === filterSku;
      return matchesSearch && matchesSku;
    });

    filtered.sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'sku') {
        cmp = (skuMap[a.skuId]?.skuId || '').localeCompare(skuMap[b.skuId]?.skuId || '');
      } else {
        const nameA = isBomPrice(a.supplierId) ? BOM_SUPPLIER_NAME : (supplierMap[a.supplierId]?.name || '');
        const nameB = isBomPrice(b.supplierId) ? BOM_SUPPLIER_NAME : (supplierMap[b.supplierId]?.name || '');
        cmp = nameA.localeCompare(nameB);
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });

    return filtered;
  }, [prices, search, filterSku, sortKey, sortDir, skuMap, supplierMap]);

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
        <div className="overflow-auto max-h-[70vh]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-table-header sticky top-0 z-10" style={{ backgroundColor: 'hsl(var(--table-header))' }}>
                <th
                  className="text-left px-4 py-3 table-header cursor-pointer select-none hover:bg-muted/50 transition-colors"
                  onClick={() => handleSort('sku')}
                >
                  <span className="inline-flex items-center">SKU <SortIcon col="sku" /></span>
                </th>
                <th
                  className="text-left px-4 py-3 table-header cursor-pointer select-none hover:bg-muted/50 transition-colors"
                  onClick={() => handleSort('supplier')}
                >
                  <span className="inline-flex items-center">Supplier <SortIcon col="supplier" /></span>
                </th>
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
                    const isBom = isBomPrice(price.supplierId);
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
                        <td className="px-4 py-3">
                          {isBom ? (
                            <span className="inline-flex items-center gap-1.5 text-muted-foreground italic">
                              <Calculator className="w-3.5 h-3.5" />
                              {BOM_SUPPLIER_NAME}
                            </span>
                          ) : (
                            supplier?.name || '—'
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums">
                          {isBom ? (
                            <span className="text-muted-foreground italic text-xs">from BOM</span>
                          ) : (
                            price.pricePerPurchaseUom.toFixed(2)
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums font-semibold">
                          {price.pricePerUsageUom.toFixed(4)}
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
                          {isBom ? (
                            <span className="text-xs text-muted-foreground italic">System</span>
                          ) : (
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
                          )}
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
