import { useState, useMemo } from 'react';
import { SKU, SKUType } from '@/types/sku';
import { useSkuData } from '@/hooks/use-sku-data';
import { SummaryCards } from '@/components/SummaryCards';
import { SKUTable } from '@/components/SKUTable';
import { SKUFormModal } from '@/components/SKUFormModal';
import { Button } from '@/components/ui/button';
import { Plus, ChefHat } from 'lucide-react';
import { toast } from 'sonner';

const Index = () => {
  const { skus, addSku, updateSku, deleteSku } = useSkuData();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingSku, setEditingSku] = useState<SKU | null>(null);

  const counts = useMemo(() => {
    const c: Record<SKUType, number> = { RM: 0, SM: 0, SP: 0, PK: 0 };
    skus.forEach(s => c[s.type]++);
    return c;
  }, [skus]);

  const handleAdd = () => {
    setEditingSku(null);
    setModalOpen(true);
  };

  const handleEdit = (sku: SKU) => {
    setEditingSku(sku);
    setModalOpen(true);
  };

  const handleDelete = (id: string) => {
    deleteSku(id);
    toast.success('SKU deleted');
  };

  const handleSubmit = (data: Omit<SKU, 'id' | 'skuId'>) => {
    if (editingSku) {
      updateSku(editingSku.id, data);
      toast.success('SKU updated');
    } else {
      addSku(data);
      toast.success('SKU added');
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center">
              <ChefHat className="w-5 h-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-lg font-heading font-bold leading-tight">CK Manager</h1>
              <p className="text-xs text-muted-foreground">Central Kitchen Operations</p>
            </div>
          </div>
          <Button onClick={handleAdd}>
            <Plus className="w-4 h-4" />
            Add SKU
          </Button>
        </div>
      </header>

      {/* Main */}
      <main className="container mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        <div>
          <h2 className="text-2xl font-heading font-bold">SKU Master</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Manage your inventory items across all categories</p>
        </div>

        <SummaryCards counts={counts} total={skus.length} />
        <SKUTable skus={skus} onEdit={handleEdit} onDelete={handleDelete} />
      </main>

      <SKUFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={handleSubmit}
        editingSku={editingSku}
      />
    </div>
  );
};

export default Index;
