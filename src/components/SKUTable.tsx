import { SKU, SKUType, SKU_TYPE_LABELS, CATEGORY_LABELS } from '@/types/sku';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Pencil, Trash2, Search } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useState } from 'react';

interface SKUTableProps {
  skus: SKU[];
  onEdit?: (sku: SKU) => void;
  onDelete?: (id: string) => void;
}

const typeBadge: Record<SKUType, string> = {
  RM: 'badge-rm',
  SM: 'badge-sm',
  SP: 'badge-sp',
  PK: 'badge-pk',
};

export function SKUTable({ skus, onEdit, onDelete }: SKUTableProps) {
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');

  const filtered = skus.filter((s) => {
    const matchesSearch =
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.skuId.toLowerCase().includes(search.toLowerCase());
    const matchesType = filterType === 'all' || s.type === filterType;
    const matchesStatus = filterStatus === 'all' || s.status === filterStatus;
    return matchesSearch && matchesType && matchesStatus;
  });

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search SKU ID or name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
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
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">SKU ID</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Name</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Type</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Category</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Storage</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Pack</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Shelf Life</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-muted-foreground">
                    {skus.length === 0 ? 'No SKUs yet. Add your first one!' : 'No SKUs match your filters.'}
                  </td>
                </tr>
              ) : (
                filtered.map((sku) => (
                  <tr key={sku.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs font-semibold">{sku.skuId}</td>
                    <td className="px-4 py-3 font-medium">{sku.name}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded text-xs font-semibold ${typeBadge[sku.type]}`}>
                        {sku.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{CATEGORY_LABELS[sku.category]}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded text-xs font-semibold ${
                        sku.status === 'Active'
                          ? 'bg-success/10 text-success'
                          : 'bg-muted text-muted-foreground'
                      }`}>
                        {sku.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{sku.storageCondition}</td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{sku.packSize} {sku.packUnit}</td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{sku.shelfLife}d</td>
                    {(onEdit || onDelete) && (
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {onEdit && (
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEdit(sku)}>
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        {onDelete && (
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => onDelete(sku.id)}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </div>
                    </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{filtered.length} of {skus.length} SKUs shown</p>
    </div>
  );
}
