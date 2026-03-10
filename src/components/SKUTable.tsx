import { SKU, SKUType, SKU_TYPE_LABELS } from '@/types/sku';
import { SkuCategory } from '@/hooks/use-sku-categories';
import { Button } from '@/components/ui/button';
import { Pencil, Trash2, Package, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useState, useMemo } from 'react';
import { SearchInput } from '@/components/SearchInput';
import { SkeletonTable } from '@/components/SkeletonTable';
import { EmptyState } from '@/components/EmptyState';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface SKUTableProps {
  skus: SKU[];
  onEdit?: (sku: SKU) => void;
  onDelete?: (id: string) => void;
  loading?: boolean;
  skuCategories?: SkuCategory[];
}

const typeBadge: Record<SKUType, string> = {
  RM: 'badge-rm',
  SM: 'badge-sm',
  SP: 'badge-sp',
  PK: 'badge-pk',
};

type SortKey = 'skuId' | 'name' | 'type' | 'category' | 'status';
type SortDir = 'asc' | 'desc';

export function SKUTable({ skus, onEdit, onDelete, loading, skuCategories = [] }: SKUTableProps) {
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [sortKey, setSortKey] = useState<SortKey>('skuId');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const catLabelMap = useMemo(() => {
    const m: Record<string, string> = {};
    skuCategories.forEach(c => { m[c.code] = c.nameEn; });
    return m;
  }, [skuCategories]);

  const getCatLabel = (code: string) => catLabelMap[code] || code;

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

  const filtered = useMemo(() => {
    const list = skus.filter((s) => {
      const q = search.toLowerCase();
      const matchesSearch =
        s.name.toLowerCase().includes(q) ||
        s.skuId.toLowerCase().includes(q) ||
        getCatLabel(s.category).toLowerCase().includes(q);
      const matchesType = filterType === 'all' || s.type === filterType;
      const matchesStatus = filterStatus === 'all' || s.status === filterStatus;
      return matchesSearch && matchesType && matchesStatus;
    });

    list.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'skuId': cmp = a.skuId.localeCompare(b.skuId); break;
        case 'name': cmp = a.name.localeCompare(b.name); break;
        case 'type': cmp = a.type.localeCompare(b.type); break;
        case 'category': cmp = getCatLabel(a.category).localeCompare(getCatLabel(b.category)); break;
        case 'status': cmp = a.status.localeCompare(b.status); break;
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });

    return list;
  }, [skus, search, filterType, filterStatus, sortKey, sortDir, catLabelMap]);

  if (loading) return <SkeletonTable columns={8} rows={10} />;

  const sortableHeaders: { key: SortKey; label: string; align?: string }[] = [
    { key: 'skuId', label: 'SKU ID' },
    { key: 'name', label: 'Name' },
    { key: 'type', label: 'Type' },
    { key: 'category', label: 'Category' },
    { key: 'status', label: 'Status' },
  ];

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search code, name, or category..."
          className="flex-1"
          totalCount={skus.length}
          filteredCount={filtered.length}
          entityName="SKUs"
        />
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-full sm:w-[160px]">
            <SelectValue placeholder="All Types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {(['RM', 'SM', 'SP', 'PK'] as SKUType[]).map((t) => (
              <SelectItem key={t} value={t}>{t} — {SKU_TYPE_LABELS[t]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-full sm:w-[140px]">
            <SelectValue placeholder="All Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="Active">Active</SelectItem>
            <SelectItem value="Inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="rounded-lg border bg-card overflow-hidden">
        <div className="overflow-auto max-h-[70vh]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-table-header">
                {sortableHeaders.map(h => (
                  <th
                    key={h.key}
                    className="text-left px-4 py-3 table-header cursor-pointer select-none hover:bg-muted/50 transition-colors"
                    onClick={() => handleSort(h.key)}
                  >
                    <span className="inline-flex items-center">
                      {h.label}
                      <SortIcon col={h.key} />
                    </span>
                  </th>
                ))}
                <th className="text-left px-4 py-3 table-header">Storage</th>
                <th className="text-left px-4 py-3 table-header">Pack</th>
                <th className="text-left px-4 py-3 table-header">Shelf Life</th>
                {(onEdit || onDelete) && (
                  <th className="text-right px-4 py-3 table-header">Actions</th>
                )}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4">
                    <EmptyState
                      icon={Package}
                      title={skus.length === 0 ? 'No SKUs added yet' : 'No SKUs match your filters'}
                      description={skus.length === 0 ? 'Add your first ingredient to get started' : 'Try adjusting your search or filter criteria'}
                    />
                  </td>
                </tr>
              ) : (
                <TooltipProvider>
                  {filtered.map((sku, idx) => (
                    <tr key={sku.id} className={`border-b border-table-border last:border-0 table-row-hover transition-colors min-h-table-row ${idx % 2 === 1 ? 'bg-table-alt' : ''}`}>
                      <td className="px-4 py-3 font-mono text-xs font-semibold">{sku.skuId}</td>
                      <td className="px-4 py-3 font-medium max-w-[200px]">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="truncate block">{sku.name}</span>
                          </TooltipTrigger>
                          <TooltipContent>{sku.name}</TooltipContent>
                        </Tooltip>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${typeBadge[sku.type]}`}>
                          {sku.type}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{getCatLabel(sku.category)}</td>
                      <td className="px-4 py-3">
                        <span className={sku.status === 'Active' ? 'pill-active' : 'pill-inactive'}>
                          {sku.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-helper">{sku.storageCondition}</td>
                      <td className="px-4 py-3 text-muted-foreground text-helper">{sku.packSize} {sku.packUnit}</td>
                      <td className="px-4 py-3 text-muted-foreground text-helper">{sku.shelfLife}d</td>
                      {(onEdit || onDelete) && (
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {onEdit && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="icon-btn-edit" onClick={() => onEdit(sku)}>
                                  <Pencil className="w-3.5 h-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Edit</TooltipContent>
                            </Tooltip>
                          )}
                          {onDelete && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="icon-btn-delete" onClick={() => onDelete(sku.id)}>
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Delete</TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      </td>
                      )}
                    </tr>
                  ))}
                </TooltipProvider>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
