import { useState, useMemo, useCallback } from 'react';
import { GoodsReceipt, getWeekNumber } from '@/types/goods-receipt';
import { SKU } from '@/types/sku';
import { Supplier } from '@/types/supplier';
import { Price } from '@/types/price';
import { useGoodsReceiptData } from '@/hooks/use-goods-receipt-data';
import { GoodsReceiptSpreadsheet } from '@/components/GoodsReceiptSpreadsheet';
import { Button } from '@/components/ui/button';
import { Save, ClipboardList, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/hooks/use-language';

interface Props {
  receiptData: ReturnType<typeof useGoodsReceiptData>;
  skus: SKU[];
  suppliers: Supplier[];
  prices: Price[];
}

export interface DraftRow {
  tempId: string;
  receiptDate: string;
  skuId: string;
  supplierId: string;
  quantityReceived: number;
  actualTotal: number;
  note: string;
  isNew: boolean;
  isEditing: boolean;
  savedReceiptId?: string;
}

function createEmptyDraft(): DraftRow {
  return {
    tempId: crypto.randomUUID(),
    receiptDate: new Date().toISOString().slice(0, 10),
    skuId: '',
    supplierId: '',
    quantityReceived: 0,
    actualTotal: 0,
    note: '',
    isNew: true,
    isEditing: true,
  };
}

export default function GoodsReceiptPage({ receiptData, skus, suppliers, prices }: Props) {
  const { receipts, addReceipt, updateReceipt, deleteReceipt } = receiptData;
  const { t } = useLanguage();
  const [drafts, setDrafts] = useState<DraftRow[]>([]);

  const rmSkus = useMemo(() => skus.filter(s => s.type === 'RM'), [skus]);
  const activeSuppliers = useMemo(() => suppliers.filter(s => s.status === 'Active'), [suppliers]);

  const currentWeek = getWeekNumber(new Date().toISOString().slice(0, 10));
  const thisWeekReceipts = useMemo(
    () => receipts.filter(r => r.weekNumber === currentWeek),
    [receipts, currentWeek]
  );
  const thisWeekValue = useMemo(
    () => thisWeekReceipts.reduce((sum, r) => sum + r.actualTotal, 0),
    [thisWeekReceipts]
  );

  const hasUnsavedOrEditing = drafts.some(d => d.isEditing);

  const handleAddRow = useCallback(() => {
    setDrafts(prev => [...prev, createEmptyDraft()]);
  }, []);

  const handleDuplicateRow = useCallback((index: number) => {
    setDrafts(prev => {
      const source = prev[index];
      const dup: DraftRow = { ...source, tempId: crypto.randomUUID(), isNew: true, isEditing: true, savedReceiptId: undefined };
      const next = [...prev];
      next.splice(index + 1, 0, dup);
      return next;
    });
  }, []);

  const handleUpdateDraft = useCallback((tempId: string, field: keyof DraftRow, value: any) => {
    setDrafts(prev => prev.map(d =>
      d.tempId === tempId ? { ...d, [field]: value } : d
    ));
  }, []);

  const handleDeleteDraft = useCallback((tempId: string) => {
    setDrafts(prev => prev.filter(d => d.tempId !== tempId));
  }, []);

  const handleDeleteSaved = useCallback((id: string) => {
    deleteReceipt(id);
    toast.success('Receipt deleted');
  }, [deleteReceipt]);

  // Start editing a saved receipt
  const handleEditSaved = useCallback((receipt: GoodsReceipt) => {
    // Check if already editing this receipt
    if (drafts.some(d => d.savedReceiptId === receipt.id)) return;
    const draft: DraftRow = {
      tempId: crypto.randomUUID(),
      receiptDate: receipt.receiptDate,
      skuId: receipt.skuId,
      supplierId: receipt.supplierId,
      quantityReceived: receipt.quantityReceived,
      actualTotal: receipt.actualTotal,
      note: receipt.note,
      isNew: false,
      isEditing: true,
      savedReceiptId: receipt.id,
    };
    setDrafts(prev => [...prev, draft]);
  }, [drafts]);

  // Save a single row
  const handleSaveRow = useCallback((tempId: string) => {
    const draft = drafts.find(d => d.tempId === tempId);
    if (!draft || !draft.skuId || !draft.supplierId || draft.quantityReceived <= 0) {
      toast.error('Please fill in SKU, Supplier, and Qty');
      return;
    }
    const sku = rmSkus.find(s => s.id === draft.skuId);
    const data = {
      receiptDate: draft.receiptDate,
      skuId: draft.skuId,
      supplierId: draft.supplierId,
      quantityReceived: draft.quantityReceived,
      actualTotal: draft.actualTotal,
      note: draft.note,
    };
    if (draft.isNew) {
      addReceipt(data, sku, prices);
    } else if (draft.savedReceiptId) {
      updateReceipt(draft.savedReceiptId, data, sku, prices);
    }
    setDrafts(prev => prev.filter(d => d.tempId !== tempId));
    toast.success('Receipt saved');
  }, [drafts, rmSkus, addReceipt, updateReceipt, prices]);

  // Cancel editing
  const handleCancelRow = useCallback((tempId: string) => {
    // Just remove the draft — if it was editing an existing row, the original is still in receipts
    setDrafts(prev => prev.filter(d => d.tempId !== tempId));
  }, []);

  const handleSaveAll = useCallback(() => {
    const editingDrafts = drafts.filter(d => d.isEditing && d.skuId && d.supplierId && d.quantityReceived > 0);
    if (editingDrafts.length === 0) {
      toast.error('No valid rows to save');
      return;
    }
    editingDrafts.forEach(draft => {
      const sku = rmSkus.find(s => s.id === draft.skuId);
      const data = {
        receiptDate: draft.receiptDate,
        skuId: draft.skuId,
        supplierId: draft.supplierId,
        quantityReceived: draft.quantityReceived,
        actualTotal: draft.actualTotal,
        note: draft.note,
      };
      if (draft.isNew) {
        addReceipt(data, sku, prices);
      } else if (draft.savedReceiptId) {
        updateReceipt(draft.savedReceiptId, data, sku, prices);
      }
    });
    setDrafts(prev => prev.filter(d => !editingDrafts.find(e => e.tempId === d.tempId)));
    toast.success(`${editingDrafts.length} receipt(s) saved`);
  }, [drafts, rmSkus, addReceipt, updateReceipt, prices]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-heading font-bold">{t('title.goodsReceipt')}</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Record raw material receipts from suppliers</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleAddRow}>
            {t('btn.addRow')}
          </Button>
          {hasUnsavedOrEditing && (
            <Button onClick={handleSaveAll}>
              <Save className="w-4 h-4" />
              {t('btn.saveAll')} ({drafts.filter(d => d.isEditing).length})
            </Button>
          )}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div className="rounded-lg border bg-card p-5 animate-fade-in">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('summary.totalReceipts')}</p>
          <p className="text-3xl font-heading font-bold mt-1">{receipts.length}</p>
        </div>
        <div className="rounded-lg border bg-card p-5 animate-fade-in">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">This Week (W{currentWeek})</p>
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-primary/10">
              <ClipboardList className="w-4 h-4 text-primary" />
            </span>
          </div>
          <p className="text-3xl font-heading font-bold mt-1">{thisWeekReceipts.length}</p>
        </div>
        <div className="rounded-lg border bg-card p-5 animate-fade-in">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('summary.weekPurchaseValue')}</p>
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-success/10">
              <TrendingUp className="w-4 h-4 text-success" />
            </span>
          </div>
          <p className="text-3xl font-heading font-bold mt-1">฿{thisWeekValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</p>
        </div>
      </div>

      <GoodsReceiptSpreadsheet
        savedReceipts={receipts}
        drafts={drafts}
        rmSkus={rmSkus}
        suppliers={activeSuppliers}
        allSuppliers={suppliers}
        prices={prices}
        editingReceiptIds={drafts.filter(d => d.savedReceiptId).map(d => d.savedReceiptId!)}
        onUpdateDraft={handleUpdateDraft}
        onDeleteDraft={handleDeleteDraft}
        onDeleteSaved={handleDeleteSaved}
        onAddRow={handleAddRow}
        onDuplicateRow={handleDuplicateRow}
        onEditSaved={handleEditSaved}
        onSaveRow={handleSaveRow}
        onCancelRow={handleCancelRow}
      />
    </div>
  );
}
