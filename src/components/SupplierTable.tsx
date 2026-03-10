import { Supplier } from '@/types/supplier';
import { Button } from '@/components/ui/button';
import { Pencil, Trash2, Users, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import { useState, useMemo } from 'react';
import { SearchInput } from '@/components/SearchInput';
import { SkeletonTable } from '@/components/SkeletonTable';
import { EmptyState } from '@/components/EmptyState';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface Props {
  suppliers: Supplier[];
  onEdit: (s: Supplier) => void;
  onDelete: (id: string) => void;
  loading?: boolean;
}

type SortKey = 'name' | 'status' | 'leadTime' | 'moq' | 'contactPerson' | 'phone' | 'creditTerms';
type SortDir = 'asc' | 'desc';

export function SupplierTable({ suppliers, onEdit, onDelete, loading }: Props) {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

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
    const list = suppliers.filter(s => {
      const q = search.toLowerCase();
      return s.name.toLowerCase().includes(q) ||
        s.contactPerson.toLowerCase().includes(q) ||
        s.phone.toLowerCase().includes(q);
    });

    list.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'name': cmp = a.name.localeCompare(b.name); break;
        case 'status': cmp = a.status.localeCompare(b.status); break;
        case 'leadTime': cmp = a.leadTime - b.leadTime; break;
        case 'moq': cmp = a.moq - b.moq; break;
        case 'contactPerson': cmp = a.contactPerson.localeCompare(b.contactPerson); break;
        case 'phone': cmp = a.phone.localeCompare(b.phone); break;
        case 'creditTerms': cmp = a.creditTerms.localeCompare(b.creditTerms); break;
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });

    return list;
  }, [suppliers, search, sortKey, sortDir]);

  if (loading) return <SkeletonTable columns={8} rows={6} />;

  const sortableHeaders: { key: SortKey; label: string }[] = [
    { key: 'name', label: 'Supplier Name' },
    { key: 'status', label: 'Status' },
    { key: 'leadTime', label: 'Lead Time' },
    { key: 'moq', label: 'MOQ' },
    { key: 'contactPerson', label: 'Contact' },
    { key: 'phone', label: 'Phone' },
    { key: 'creditTerms', label: 'Credit Terms' },
  ];

  return (
    <div className="space-y-4">
      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder="Search supplier name, contact, or phone..."
        className="max-w-md"
        totalCount={suppliers.length}
        filteredCount={filtered.length}
        entityName="suppliers"
      />

      <div className="rounded-lg border bg-card overflow-hidden">
        <div className="overflow-auto max-h-[70vh]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-table-header sticky top-0 z-10" style={{ backgroundColor: 'hsl(var(--table-header))' }}>
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
                <th className="text-right px-4 py-3 table-header">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4">
                    <EmptyState
                      icon={Users}
                      title={suppliers.length === 0 ? 'No suppliers yet' : 'No suppliers match your search'}
                      description={suppliers.length === 0 ? 'Add your first supplier partner' : 'Try adjusting your search terms'}
                    />
                  </td>
                </tr>
              ) : (
                <TooltipProvider>
                  {filtered.map((s, idx) => (
                    <tr key={s.id} className={`border-b border-table-border last:border-0 table-row-hover transition-colors ${idx % 2 === 1 ? 'bg-table-alt' : ''}`}>
                      <td className="px-4 py-3 font-medium">{s.name}</td>
                      <td className="px-4 py-3">
                        <span className={s.status === 'Active' ? 'pill-active' : 'pill-inactive'}>
                          {s.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">{s.leadTime}d</td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">{s.moq} {s.moqUnit}</td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">{s.contactPerson}</td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">{s.phone}</td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">{s.creditTerms}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button variant="ghost" size="icon" className="icon-btn-edit" onClick={() => onEdit(s)}>
                                <Pencil className="w-3.5 h-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Edit</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button variant="ghost" size="icon" className="icon-btn-delete" onClick={() => onDelete(s.id)}>
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Delete</TooltipContent>
                          </Tooltip>
                        </div>
                      </td>
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
