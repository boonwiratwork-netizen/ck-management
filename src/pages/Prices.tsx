import { useState, useMemo } from 'react';
import { Price } from '@/types/price';
import { SKU } from '@/types/sku';
import { Supplier } from '@/types/supplier';
import { usePriceData } from '@/hooks/use-price-data';
import { PriceTable } from '@/components/PriceTable';
import { PriceFormModal } from '@/components/PriceFormModal';
import { Button } from '@/components/ui/button';
import { Plus, DollarSign, TrendingUp } from 'lucide-react';
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

  const activeCount = useMemo(() => prices.filter(p => p.isActive).length, [prices]);

  const handleAdd = () => { setEditing(null); setModalOpen(true); };
  const handleEdit = (p: Price) => { setEditing(p); setModalOpen(true); };
  const handleDelete = (id: string) => { deletePrice(id); toast.success('Price deleted'); };

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
        <Button onClick={handleAdd}>
          <Plus className="w-4 h-4" />
          Add Price
        </Button>
      </div>

      {/* Summary Cards */}
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
        onDelete={handleDelete}
      />

      <PriceFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={handleSubmit}
        editing={editing}
        skus={skus}
        activeSuppliers={activeSuppliers}
      />
    </div>
  );
}
