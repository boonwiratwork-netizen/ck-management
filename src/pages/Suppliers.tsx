import { useState, useMemo } from 'react';
import { Supplier } from '@/types/supplier';
import { useSupplierData } from '@/hooks/use-supplier-data';
import { SupplierTable } from '@/components/SupplierTable';
import { SupplierFormModal } from '@/components/SupplierFormModal';
import { Button } from '@/components/ui/button';
import { Plus, Users } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  supplierData: ReturnType<typeof useSupplierData>;
}

export default function SuppliersPage({ supplierData }: Props) {
  const { suppliers, addSupplier, updateSupplier, deleteSupplier } = supplierData;
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);

  const activeCount = useMemo(() => suppliers.filter(s => s.status === 'Active').length, [suppliers]);

  const handleAdd = () => { setEditing(null); setModalOpen(true); };
  const handleEdit = (s: Supplier) => { setEditing(s); setModalOpen(true); };
  const handleDelete = (id: string) => { deleteSupplier(id); toast.success('Supplier deleted'); };

  const handleSubmit = (data: Omit<Supplier, 'id'>) => {
    if (editing) {
      updateSupplier(editing.id, data);
      toast.success('Supplier updated');
    } else {
      addSupplier(data);
      toast.success('Supplier added');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-heading font-bold">Supplier Master</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Manage your suppliers and vendor information</p>
        </div>
        <Button onClick={handleAdd}>
          <Plus className="w-4 h-4" />
          Add Supplier
        </Button>
      </div>

      {/* Summary Card */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div className="rounded-lg border bg-card p-5 animate-fade-in">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Suppliers</p>
          <p className="text-3xl font-heading font-bold mt-1">{suppliers.length}</p>
        </div>
        <div className="rounded-lg border bg-card p-5 animate-fade-in">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Active</p>
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-success/10">
              <Users className="w-4 h-4 text-success" />
            </span>
          </div>
          <p className="text-3xl font-heading font-bold mt-1">{activeCount}</p>
        </div>
        <div className="rounded-lg border bg-card p-5 animate-fade-in">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Inactive</p>
          <p className="text-3xl font-heading font-bold mt-1">{suppliers.length - activeCount}</p>
        </div>
      </div>

      <SupplierTable suppliers={suppliers} onEdit={handleEdit} onDelete={handleDelete} />

      <SupplierFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={handleSubmit}
        editing={editing}
      />
    </div>
  );
}
