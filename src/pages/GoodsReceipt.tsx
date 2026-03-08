import { useState, useMemo } from 'react';
import { GoodsReceipt, getWeekNumber } from '@/types/goods-receipt';
import { SKU } from '@/types/sku';
import { Supplier } from '@/types/supplier';
import { Price } from '@/types/price';
import { useGoodsReceiptData } from '@/hooks/use-goods-receipt-data';
import { GoodsReceiptTable } from '@/components/GoodsReceiptTable';
import { GoodsReceiptFormModal } from '@/components/GoodsReceiptFormModal';
import { Button } from '@/components/ui/button';
import { Plus, ClipboardList, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  receiptData: ReturnType<typeof useGoodsReceiptData>;
  skus: SKU[];
  suppliers: Supplier[];
  prices: Price[];
}

export default function GoodsReceiptPage({ receiptData, skus, suppliers, prices }: Props) {
  const { receipts, addReceipt, updateReceipt, deleteReceipt } = receiptData;
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<GoodsReceipt | null>(null);

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

  const handleAdd = () => { setEditing(null); setModalOpen(true); };
  const handleEdit = (r: GoodsReceipt) => { setEditing(r); setModalOpen(true); };
  const handleDelete = (id: string) => { deleteReceipt(id); toast.success('Receipt deleted'); };

  const handleSubmit = (
    data: Omit<GoodsReceipt, 'id' | 'weekNumber' | 'purchaseUom' | 'standardPrice' | 'priceVariance'>,
    sku: SKU | undefined
  ) => {
    if (editing) {
      updateReceipt(editing.id, data, sku, prices);
      toast.success('Receipt updated');
    } else {
      addReceipt(data, sku, prices);
      toast.success('Receipt added');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-heading font-bold">Goods Receipt</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Record raw material receipts from suppliers</p>
        </div>
        <Button onClick={handleAdd}>
          <Plus className="w-4 h-4" />
          Add Receipt
        </Button>
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

      <GoodsReceiptTable
        receipts={receipts}
        skus={skus}
        suppliers={suppliers}
        onEdit={handleEdit}
        onDelete={handleDelete}
      />

      <GoodsReceiptFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={handleSubmit}
        editing={editing}
        rmSkus={rmSkus}
        suppliers={activeSuppliers}
        prices={prices}
      />
    </div>
  );
}
