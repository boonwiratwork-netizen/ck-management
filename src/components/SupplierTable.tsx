import { Supplier } from '@/types/supplier';
import { Button } from '@/components/ui/button';
import { Pencil, Trash2, Users } from 'lucide-react';
import { useState } from 'react';
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

export function SupplierTable({ suppliers, onEdit, onDelete, loading }: Props) {
  const [search, setSearch] = useState('');

  const filtered = suppliers.filter(s => {
    const q = search.toLowerCase();
    return s.name.toLowerCase().includes(q) ||
      s.contactPerson.toLowerCase().includes(q) ||
      s.phone.toLowerCase().includes(q);
  });

  if (loading) return <SkeletonTable columns={8} rows={6} />;

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
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-table-header">
                <th className="text-left px-4 py-3 table-header">Supplier Name</th>
                <th className="text-left px-4 py-3 table-header">Status</th>
                <th className="text-left px-4 py-3 table-header">Lead Time</th>
                <th className="text-left px-4 py-3 table-header">MOQ</th>
                <th className="text-left px-4 py-3 table-header">Contact</th>
                <th className="text-left px-4 py-3 table-header">Phone</th>
                <th className="text-left px-4 py-3 table-header">Credit Terms</th>
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
