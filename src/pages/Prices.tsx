import { useState, useMemo, useCallback } from 'react';
import { Price } from '@/types/price';
import { SKU } from '@/types/sku';
import { Supplier } from '@/types/supplier';
import { usePriceData } from '@/hooks/use-price-data';
import { PriceTable } from '@/components/PriceTable';
import { PriceFormModal } from '@/components/PriceFormModal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { CSVImportModal, CSVColumnDef, CSVValidationError } from '@/components/CSVImportModal';
import { Button } from '@/components/ui/button';
import { Plus, DollarSign, TrendingUp, Upload } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  priceData: ReturnType<typeof usePriceData>;
  skus: SKU[];
  activeSuppliers: Supplier[];
  allSuppliers: Supplier[];
}

export default function PricesPage({ priceData, skus, activeSuppliers, allSuppliers }: Props) {
  const { prices, addPrice, updatePrice, deletePrice } = priceData;
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Price | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);
  const [csvOpen, setCsvOpen] = useState(false);

  const priceCsvCols: CSVColumnDef[] = [
    { key: 'skuName', label: 'SKU Name', required: true },
    { key: 'supplierName', label: 'Supplier Name', required: true },
    { key: 'pricePerPurchaseUom', label: 'Price Per Purchase UOM', required: true },
    { key: 'vat', label: 'VAT' },
    { key: 'isActive', label: 'Active' },
    { key: 'effectiveDate', label: 'Effective Date' },
    { key: 'note', label: 'Note' },
  ];

  const validatePriceCsv = useCallback((rows: Record<string, string>[]) => {
    const errors: CSVValidationError[] = [];
    const valid: Record<string, string>[] = [];
    let skipped = 0;
    rows.forEach((row, i) => {
      const rowNum = i + 2;
      const skuName = row['SKU Name']?.trim();
      const supplierName = row['Supplier Name']?.trim();
      const price = row['Price Per Purchase UOM']?.trim();
      if (!skuName) { errors.push({ row: rowNum, message: 'SKU Name is required' }); return; }
      if (!supplierName) { errors.push({ row: rowNum, message: 'Supplier Name is required' }); return; }
      if (!price || isNaN(Number(price)) || Number(price) <= 0) { errors.push({ row: rowNum, message: 'Price must be a positive number' }); return; }
      const sku = skus.find(s => s.name.toLowerCase() === skuName.toLowerCase());
      if (!sku) { errors.push({ row: rowNum, message: `SKU "${skuName}" not found` }); return; }
      const supplier = allSuppliers.find(s => s.name.toLowerCase() === supplierName.toLowerCase());
      if (!supplier) { errors.push({ row: rowNum, message: `Supplier "${supplierName}" not found` }); return; }
      valid.push(row);
    });
    return { valid, errors, skipped };
  }, [skus, allSuppliers]);

  const handlePriceCsvConfirm = useCallback((rows: Record<string, string>[]) => {
    rows.forEach(row => {
      const sku = skus.find(s => s.name.toLowerCase() === row['SKU Name']?.trim().toLowerCase());
      const supplier = allSuppliers.find(s => s.name.toLowerCase() === row['Supplier Name']?.trim().toLowerCase());
      if (!sku || !supplier) return;
      addPrice({
        skuId: sku.id,
        supplierId: supplier.id,
        pricePerPurchaseUom: Number(row['Price Per Purchase UOM']) || 0,
        vat: row['VAT']?.trim().toLowerCase() === 'true' || row['VAT']?.trim() === '1',
        isActive: row['Active']?.trim().toLowerCase() !== 'false' && row['Active']?.trim() !== '0',
        effectiveDate: row['Effective Date']?.trim() || new Date().toISOString().slice(0, 10),
        note: row['Note']?.trim() || '',
      }, sku);
    });
    toast.success(`${rows.length} prices imported`);
  }, [skus, allSuppliers, addPrice]);

  const activeCount = useMemo(() => prices.filter(p => p.isActive).length, [prices]);

  const handleAdd = () => { setEditing(null); setModalOpen(true); };
  const handleEdit = (p: Price) => { setEditing(p); setModalOpen(true); };
  const handleDeleteRequest = (id: string) => {
    const p = prices.find(x => x.id === id);
    const sku = skus.find(s => s.id === p?.skuId);
    setDeleteConfirm({ id, name: sku?.name || 'this price record' });
  };
  const handleDeleteConfirm = () => {
    if (deleteConfirm) {
      deletePrice(deleteConfirm.id);
      toast.success('Price deleted');
      setDeleteConfirm(null);
    }
  };

  const handleSubmit = (data: Omit<Price, 'id' | 'pricePerUsageUom'>, sku: SKU | undefined) => {
    if (editing) {
      updatePrice(editing.id, data, sku);
      toast.success('Price updated');
    } else {
      addPrice(data, sku);
      toast.success('Price added');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-heading font-bold">Price Master</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Manage SKU pricing across suppliers</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setCsvOpen(true)}>
            <Upload className="w-4 h-4" /> Import CSV
          </Button>
          <Button onClick={handleAdd}>
            <Plus className="w-4 h-4" /> Add Price
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div className="rounded-lg border bg-card p-5 animate-fade-in">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Prices</p>
          <p className="text-3xl font-heading font-bold mt-1">{prices.length}</p>
        </div>
        <div className="rounded-lg border bg-card p-5 animate-fade-in">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Active Prices</p>
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-success/10">
              <DollarSign className="w-4 h-4 text-success" />
            </span>
          </div>
          <p className="text-3xl font-heading font-bold mt-1">{activeCount}</p>
        </div>
        <div className="rounded-lg border bg-card p-5 animate-fade-in">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">SKUs Priced</p>
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-primary/10">
              <TrendingUp className="w-4 h-4 text-primary" />
            </span>
          </div>
          <p className="text-3xl font-heading font-bold mt-1">
            {new Set(prices.map(p => p.skuId)).size}
          </p>
        </div>
      </div>

      <PriceTable
        prices={prices}
        skus={skus}
        suppliers={allSuppliers}
        onEdit={handleEdit}
        onDelete={handleDeleteRequest}
      />

      <PriceFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={handleSubmit}
        editing={editing}
        skus={skus}
        activeSuppliers={activeSuppliers}
      />

      <ConfirmDialog
        open={!!deleteConfirm}
        onOpenChange={open => !open && setDeleteConfirm(null)}
        title="Delete Price"
        description={`Are you sure you want to delete the price for "${deleteConfirm?.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={handleDeleteConfirm}
      />

      <CSVImportModal
        open={csvOpen}
        onClose={() => setCsvOpen(false)}
        title="Price Master"
        columns={priceCsvCols}
        validate={validatePriceCsv}
        onConfirm={handlePriceCsvConfirm}
      />
    </div>
  );
}
