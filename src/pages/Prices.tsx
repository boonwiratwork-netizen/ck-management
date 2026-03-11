import { useState, useMemo, useCallback } from 'react';
import { Price } from '@/types/price';
import { SKU } from '@/types/sku';
import { Supplier } from '@/types/supplier';
import { BOMHeader } from '@/types/bom';
import { usePriceData } from '@/hooks/use-price-data';
import { PriceTable } from '@/components/PriceTable';
import { PriceFormModal } from '@/components/PriceFormModal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { CSVImportModal, CSVColumnDef, CSVValidationError } from '@/components/CSVImportModal';
import { Button } from '@/components/ui/button';
import { Plus, DollarSign, TrendingUp, Upload, AlertTriangle, Filter } from 'lucide-react';
import { toast } from 'sonner';
import { isBomPrice } from '@/lib/bom-price-sync';
import { useLanguage } from '@/hooks/use-language';

interface Props {
  priceData: ReturnType<typeof usePriceData>;
  skus: SKU[];
  activeSuppliers: Supplier[];
  allSuppliers: Supplier[];
  readOnly?: boolean;
  bomHeaders?: BOMHeader[];
}

export default function PricesPage({ priceData, skus, activeSuppliers, allSuppliers, readOnly = false, bomHeaders = [] }: Props) {
  const { prices, addPrice, updatePrice, deletePrice } = priceData;
  const { t } = useLanguage();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Price | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);
  const [csvOpen, setCsvOpen] = useState(false);
  const [showUnpricedOnly, setShowUnpricedOnly] = useState(false);

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
        effectiveDate: row['Effective Date']?.trim() || toLocalDateStr(new Date()),
        note: row['Note']?.trim() || '',
      }, sku);
    });
    toast.success(`${rows.length} prices imported`);
  }, [skus, allSuppliers, addPrice]);

  const activeCount = useMemo(() => prices.filter(p => p.isActive).length, [prices]);

  // SKUs with at least one active price (excluding SM/SP which are BOM-managed)
  const pricedSkuIds = useMemo(() => {
    const set = new Set<string>();
    prices.forEach(p => { if (p.isActive) set.add(p.skuId); });
    return set;
  }, [prices]);

  // Only count RM/PK SKUs as "unpriced" since SM/SP are auto-managed via BOM
  const activeRmPkSkus = useMemo(() => skus.filter(s => s.status === 'Active' && (s.type === 'RM' || s.type === 'PK')), [skus]);
  const unpricedCount = useMemo(() => activeRmPkSkus.filter(s => !pricedSkuIds.has(s.id)).length, [activeRmPkSkus, pricedSkuIds]);

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
          <h2 className="page-title">{t('title.priceMaster')}</h2>
          <p className="page-subtitle">Manage SKU pricing across suppliers</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setCsvOpen(true)}>
            <Upload className="w-4 h-4" /> {t('btn.importCsv')}
          </Button>
          <Button onClick={handleAdd}>
            <Plus className="w-4 h-4" /> {t('btn.addPrice')}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="rounded-lg border bg-card p-4 animate-fade-in">
          <p className="text-helper font-medium text-muted-foreground uppercase tracking-wider">{t('summary.totalPrices')}</p>
          <p className="text-2xl font-bold mt-1">{prices.length}</p>
        </div>
        <div className="rounded-lg border bg-card p-4 animate-fade-in">
          <div className="flex items-center justify-between">
            <p className="text-helper font-medium text-muted-foreground uppercase tracking-wider">{t('summary.activePrices')}</p>
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-success/10">
              <DollarSign className="w-4 h-4 text-success" />
            </span>
          </div>
          <p className="text-2xl font-bold mt-1">{activeCount}</p>
        </div>
        <div className="rounded-lg border bg-card p-4 animate-fade-in">
          <div className="flex items-center justify-between">
            <p className="text-helper font-medium text-muted-foreground uppercase tracking-wider">{t('summary.skusPriced')}</p>
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-primary/10">
              <TrendingUp className="w-4 h-4 text-primary" />
            </span>
          </div>
          <p className="text-2xl font-bold mt-1">
            {new Set(prices.map(p => p.skuId)).size}
          </p>
        </div>
        <div
          className={`rounded-lg border p-4 animate-fade-in cursor-pointer transition-colors ${
            showUnpricedOnly ? 'bg-warning/10 border-warning/40' : 'bg-card hover:bg-warning/5'
          }`}
          onClick={() => setShowUnpricedOnly(v => !v)}
        >
          <div className="flex items-center justify-between">
            <p className="text-helper font-medium text-muted-foreground uppercase tracking-wider">{t('summary.unpricedSkus')}</p>
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-warning/10">
              <AlertTriangle className="w-4 h-4 text-warning" />
            </span>
          </div>
          <p className="text-2xl font-bold mt-1">{unpricedCount}</p>
          <p className="text-helper text-muted-foreground mt-1">
            {showUnpricedOnly ? 'Showing unpriced • click to clear' : 'Click to filter'}
          </p>
        </div>
      </div>

      {showUnpricedOnly ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowUnpricedOnly(false)}>
              <Filter className="w-3.5 h-3.5 mr-1" /> {t('btn.clearFilter')}
            </Button>
            <span className="text-sm text-muted-foreground">
              Showing {unpricedCount} active RM/PK SKUs without an active price
            </span>
          </div>
          <div className="rounded-lg border bg-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-table-header">
                    <th className="text-left px-4 py-3 table-header">{t('col.skuId')}</th>
                    <th className="text-left px-4 py-3 table-header">{t('col.name')}</th>
                    <th className="text-left px-4 py-3 table-header">{t('col.type')}</th>
                    <th className="text-left px-4 py-3 table-header">{t('col.category')}</th>
                    <th className="text-right px-4 py-3 table-header">{t('col.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {activeRmPkSkus
                    .filter(s => !pricedSkuIds.has(s.id))
                    .sort((a, b) => a.skuId.localeCompare(b.skuId))
                    .map((sku, idx) => (
                      <tr key={sku.id} className={`border-b border-table-border last:border-0 table-row-hover transition-colors ${idx % 2 === 1 ? 'bg-table-alt' : ''}`}>
                        <td className="px-4 py-3 font-mono text-xs font-semibold">{sku.skuId}</td>
                        <td className="px-4 py-3 font-medium">{sku.name}</td>
                        <td className="px-4 py-3">{sku.type}</td>
                        <td className="px-4 py-3 text-muted-foreground">{sku.category}</td>
                        <td className="px-4 py-3 text-right">
                          <Button size="sm" variant="outline" onClick={() => { setEditing(null); setModalOpen(true); }}>
                            <Plus className="w-3.5 h-3.5 mr-1" /> {t('btn.addPrice')}
                          </Button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <PriceTable
          prices={prices}
          skus={skus}
          suppliers={allSuppliers}
          onEdit={handleEdit}
          onDelete={handleDeleteRequest}
        />
      )}

      <PriceFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={handleSubmit}
        editing={editing}
        skus={skus}
        activeSuppliers={activeSuppliers}
        pricedSkuIds={pricedSkuIds}
        prices={prices}
        bomHeaders={bomHeaders}
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
