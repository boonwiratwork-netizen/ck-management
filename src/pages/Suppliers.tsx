import { useState, useMemo, useCallback } from 'react';
import { Supplier } from '@/types/supplier';
import { useSupplierData } from '@/hooks/use-supplier-data';
import { SupplierTable } from '@/components/SupplierTable';
import { SupplierFormModal } from '@/components/SupplierFormModal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { CSVImportModal, CSVColumnDef, CSVValidationError } from '@/components/CSVImportModal';
import { Button } from '@/components/ui/button';
import { Plus, Users, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/hooks/use-language';

interface Props {
  supplierData: ReturnType<typeof useSupplierData>;
  readOnly?: boolean;
}

export default function SuppliersPage({ supplierData, readOnly = false }: Props) {
  const { suppliers, addSupplier, updateSupplier, deleteSupplier } = supplierData;
  const { t } = useLanguage();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);
  const [csvOpen, setCsvOpen] = useState(false);

  const supplierCsvCols: CSVColumnDef[] = [
    { key: 'name', label: 'Name', required: true },
    { key: 'leadTime', label: 'Lead Time' },
    { key: 'moq', label: 'MOQ' },
    { key: 'moqUnit', label: 'MOQ Unit' },
    { key: 'contactPerson', label: 'Contact Person' },
    { key: 'phone', label: 'Phone' },
    { key: 'creditTerms', label: 'Credit Terms' },
    { key: 'status', label: 'Status' },
  ];

  const validateSupplierCsv = useCallback((rows: Record<string, string>[]) => {
    const errors: CSVValidationError[] = [];
    const valid: Record<string, string>[] = [];
    let skipped = 0;
    const existing = new Set(suppliers.map(s => s.name.toLowerCase()));
    const seen = new Set<string>();
    rows.forEach((row, i) => {
      const name = row['Name']?.trim();
      if (!name) { errors.push({ row: i + 2, message: 'Name is required' }); return; }
      if (existing.has(name.toLowerCase()) || seen.has(name.toLowerCase())) { skipped++; return; }
      seen.add(name.toLowerCase());
      valid.push(row);
    });
    return { valid, errors, skipped };
  }, [suppliers]);

  const handleSupplierCsvConfirm = useCallback((rows: Record<string, string>[]) => {
    rows.forEach(row => {
      addSupplier({
        name: row['Name']?.trim() || '',
        leadTime: Number(row['Lead Time']) || 0,
        moq: Number(row['MOQ']) || 0,
        moqUnit: row['MOQ Unit']?.trim() || '',
        contactPerson: row['Contact Person']?.trim() || '',
        phone: row['Phone']?.trim() || '',
        creditTerms: row['Credit Terms']?.trim() || '',
        status: row['Status']?.trim() === 'Inactive' ? 'Inactive' : 'Active',
      });
    });
    toast.success(`${rows.length} suppliers imported`);
  }, [addSupplier]);

  const activeCount = useMemo(() => suppliers.filter(s => s.status === 'Active').length, [suppliers]);

  const handleAdd = () => { setEditing(null); setModalOpen(true); };
  const handleEdit = (s: Supplier) => { setEditing(s); setModalOpen(true); };
  const handleDeleteRequest = (id: string) => {
    const s = suppliers.find(x => x.id === id);
    setDeleteConfirm({ id, name: s?.name || 'this supplier' });
  };
  const handleDeleteConfirm = () => {
    if (deleteConfirm) {
      deleteSupplier(deleteConfirm.id);
      toast.success(`Supplier "${deleteConfirm.name}" deleted`);
      setDeleteConfirm(null);
    }
  };

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
          <h2 className="page-title">{t('title.supplierMaster')}</h2>
          <p className="page-subtitle">Manage your suppliers and vendor information</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setCsvOpen(true)}>
            <Upload className="w-4 h-4" /> {t('btn.importCsv')}
          </Button>
          <Button onClick={handleAdd}>
            <Plus className="w-4 h-4" /> {t('btn.addSupplier')}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div className="rounded-lg border bg-card p-4 animate-fade-in">
          <p className="text-helper font-medium text-muted-foreground uppercase tracking-wider">{t('summary.totalSuppliers')}</p>
          <p className="text-2xl font-bold mt-1">{suppliers.length}</p>
        </div>
        <div className="rounded-lg border bg-card p-4 animate-fade-in">
          <div className="flex items-center justify-between">
            <p className="text-helper font-medium text-muted-foreground uppercase tracking-wider">{t('status.active')}</p>
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-success/10">
              <Users className="w-4 h-4 text-success" />
            </span>
          </div>
          <p className="text-2xl font-bold mt-1">{activeCount}</p>
        </div>
        <div className="rounded-lg border bg-card p-4 animate-fade-in">
          <p className="text-helper font-medium text-muted-foreground uppercase tracking-wider">{t('status.inactive')}</p>
          <p className="text-2xl font-bold mt-1">{suppliers.length - activeCount}</p>
        </div>
      </div>

      <SupplierTable suppliers={suppliers} onEdit={handleEdit} onDelete={handleDeleteRequest} />

      <SupplierFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={handleSubmit}
        editing={editing}
      />

      <ConfirmDialog
        open={!!deleteConfirm}
        onOpenChange={open => !open && setDeleteConfirm(null)}
        title="Delete Supplier"
        description={`Are you sure you want to delete "${deleteConfirm?.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={handleDeleteConfirm}
      />

      <CSVImportModal
        open={csvOpen}
        onClose={() => setCsvOpen(false)}
        title="Supplier Master"
        columns={supplierCsvCols}
        validate={validateSupplierCsv}
        onConfirm={handleSupplierCsvConfirm}
      />
    </div>
  );
}
