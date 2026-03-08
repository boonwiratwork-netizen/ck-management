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
  actualPrice: number;
  note: string;
  saved: boolean;
}

function createEmptyDraft(): DraftRow {
  return {
    tempId: crypto.randomUUID(),
    receiptDate: new Date().toISOString().slice(0, 10),
    skuId: '',
    supplierId: '',
    quantityReceived: 0,
    actualPrice: 0,
    note: '',
    saved: false,
  };
}

export default function GoodsReceiptPage({ receiptData, skus, suppliers, prices }: Props) {
  const { receipts, addReceipt, deleteReceipt } = receiptData;
  const [drafts, setDrafts] = useState<DraftRow[]>([]);

  const rmSkus = useMemo(() => skus.filter(s => s.type === 'RM'), [skus]);
  const activeSuppliers = useMemo(() => suppliers.filter(s => s.status === 'Active'), [suppliers]);

  const currentWeek = getWeekNumber(new Date().toISOString().slice(0, 10));
  const thisWeekReceipts = useMemo(
    () => receipts.filter(r => r.weekNumber === currentWeek),
    [receipts, currentWeek]
  );
  const thisWeekValue = useMemo(
    () => thisWeekReceipts.reduce((sum, r) => sum + r.quantityReceived * r.actualPrice, 0),
    [thisWeekReceipts]
  );

  const unsavedCount = drafts.filter(d => !d.saved).length;

  const handleAddRow = useCallback(() => {
    setDrafts(prev => [...prev, createEmptyDraft()]);
  }, []);

  const handleDuplicateRow = useCallback((index: number) => {
    setDrafts(prev => {
      const source = prev[index];
      const dup: DraftRow = { ...source, tempId: crypto.randomUUID(), saved: false };
      const next = [...prev];
      next.splice(index + 1, 0, dup);
      return next;
    });
  }, []);

  const handleUpdateDraft = useCallback((tempId: string, field: keyof DraftRow, value: any) => {
    setDrafts(prev => prev.map(d =>
      d.tempId === tempId ? { ...d, [field]: value, saved: false } : d
    ));
  }, []);

  const handleDeleteDraft = useCallback((tempId: string) => {
    setDrafts(prev => prev.filter(d => d.tempId !== tempId));
  }, []);

  const handleDeleteSaved = useCallback((id: string) => {
    deleteReceipt(id);
    toast.success('Receipt deleted');
  }, [deleteReceipt]);

  const handleSaveAll = useCallback(() => {
    const unsaved = drafts.filter(d => !d.saved && d.skuId && d.supplierId && d.quantityReceived > 0);
    if (unsaved.length === 0) {
      toast.error('No valid unsaved rows to save');
      return;
    }
    unsaved.forEach(d => {
      const sku = rmSkus.find(s => s.id === d.skuId);
      addReceipt({
        receiptDate: d.receiptDate,
        skuId: d.skuId,
        supplierId: d.supplierId,
        quantityReceived: d.quantityReceived,
        actualPrice: d.actualPrice,
        note: d.note,
      }, sku, prices);
    });
    setDrafts(prev => prev.map(d =>
      unsaved.find(u => u.tempId === d.tempId) ? { ...d, saved: true } : d
    ));
    toast.success(`${unsaved.length} receipt(s) saved`);
  }, [drafts, rmSkus, addReceipt, prices]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-heading font-bold">Goods Receipt</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Record raw material receipts from suppliers</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleAddRow}>
            + Add Row
          </Button>
          <Button onClick={handleSaveAll} disabled={unsavedCount === 0}>
            <Save className="w-4 h-4" />
            Save All{unsavedCount > 0 && ` (${unsavedCount})`}
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div className="rounded-lg border bg-card p-5 animate-fade-in">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Receipts</p>
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
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Week Purchase Value</p>
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
        onUpdateDraft={handleUpdateDraft}
        onDeleteDraft={handleDeleteDraft}
        onDeleteSaved={handleDeleteSaved}
        onAddRow={handleAddRow}
        onDuplicateRow={handleDuplicateRow}
      />
    </div>
  );
}
