import { useState, useMemo } from 'react';
import { SKU, SKUType } from '@/types/sku';
import { useSkuData } from '@/hooks/use-sku-data';
import { useSupplierData } from '@/hooks/use-supplier-data';
import { usePriceData } from '@/hooks/use-price-data';
import { useBomData } from '@/hooks/use-bom-data';
import { useGoodsReceiptData } from '@/hooks/use-goods-receipt-data';
import { useStockData } from '@/hooks/use-stock-data';
import { useProductionData } from '@/hooks/use-production-data';
import { useSmStockData } from '@/hooks/use-sm-stock-data';
import { useDeliveryData } from '@/hooks/use-delivery-data';
import Dashboard from '@/pages/Dashboard';
import { SummaryCards } from '@/components/SummaryCards';
import { SKUTable } from '@/components/SKUTable';
import { SKUFormModal } from '@/components/SKUFormModal';
import SuppliersPage from '@/pages/Suppliers';
import PricesPage from '@/pages/Prices';
import BOMPage from '@/pages/BOM';
import GoodsReceiptPage from '@/pages/GoodsReceipt';
import RMStockPage from '@/pages/RMStock';
import ProductionPage from '@/pages/Production';
import SMStockPage from '@/pages/SMStock';
import DeliveryToBranchesPage from '@/pages/DeliveryToBranches';
import { Button } from '@/components/ui/button';
import { Plus, ChefHat, Package, Users, DollarSign, FlaskConical, ClipboardList, Warehouse, Factory, BoxesIcon, Truck, LayoutDashboard } from 'lucide-react';
import { toast } from 'sonner';

type TabKey = 'sku' | 'supplier' | 'price' | 'bom' | 'receipt' | 'stock' | 'production' | 'smstock' | 'delivery';

const Index = () => {
  const skuData = useSkuData();
  const supplierData = useSupplierData();
  const priceData = usePriceData();
  const bomData = useBomData();
  const receiptData = useGoodsReceiptData();
  const stockData = useStockData(skuData.skus, receiptData.receipts, priceData.prices);
  const productionData = useProductionData(bomData.headers, bomData.lines, stockData.addAdjustment);
  const deliveryData = useDeliveryData();
  const smStockData = useSmStockData(skuData.skus, productionData.records, deliveryData.deliveries, bomData.headers);
  const { skus, addSku, updateSku, deleteSku } = skuData;
  const [modalOpen, setModalOpen] = useState(false);
  const [editingSku, setEditingSku] = useState<SKU | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('sku');

  const activeSuppliers = useMemo(
    () => supplierData.suppliers.filter(s => s.status === 'Active'),
    [supplierData.suppliers]
  );

  const counts = useMemo(() => {
    const c: Record<SKUType, number> = { RM: 0, SM: 0, SP: 0, PK: 0 };
    skus.forEach(s => c[s.type]++);
    return c;
  }, [skus]);

  const handleAdd = () => { setEditingSku(null); setModalOpen(true); };
  const handleEdit = (sku: SKU) => { setEditingSku(sku); setModalOpen(true); };
  const handleDelete = (id: string) => { deleteSku(id); toast.success('SKU deleted'); };

  const handleSubmit = (data: Omit<SKU, 'id' | 'skuId'>) => {
    if (editingSku) {
      updateSku(editingSku.id, data);
      toast.success('SKU updated');
    } else {
      addSku(data);
      toast.success('SKU added');
    }
  };

  const tabs: { key: TabKey; label: string; icon: React.ReactNode }[] = [
    { key: 'sku', label: 'SKU Master', icon: <Package className="w-4 h-4" /> },
    { key: 'supplier', label: 'Suppliers', icon: <Users className="w-4 h-4" /> },
    { key: 'price', label: 'Prices', icon: <DollarSign className="w-4 h-4" /> },
    { key: 'bom', label: 'BOM', icon: <FlaskConical className="w-4 h-4" /> },
    { key: 'receipt', label: 'Goods Receipt', icon: <ClipboardList className="w-4 h-4" /> },
    { key: 'stock', label: 'RM Stock', icon: <Warehouse className="w-4 h-4" /> },
    { key: 'production', label: 'Production', icon: <Factory className="w-4 h-4" /> },
    { key: 'smstock', label: 'SM Stock', icon: <BoxesIcon className="w-4 h-4" /> },
    { key: 'delivery', label: 'Delivery', icon: <Truck className="w-4 h-4" /> },
  ];

  return (
    <div className="min-h-screen bg-background">
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
          <div className="flex items-center gap-1 flex-wrap">
            {tabs.map(tab => (
              <Button
                key={tab.key}
                variant={activeTab === tab.key ? 'default' : 'outline'}
                size="sm"
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.icon}
                {tab.label}
              </Button>
            ))}
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {activeTab === 'sku' ? (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-heading font-bold">SKU Master</h2>
                <p className="text-sm text-muted-foreground mt-0.5">Manage your inventory items across all categories</p>
              </div>
              <Button onClick={handleAdd}>
                <Plus className="w-4 h-4" /> Add SKU
              </Button>
            </div>
            <SummaryCards counts={counts} total={skus.length} />
            <SKUTable skus={skus} onEdit={handleEdit} onDelete={handleDelete} />
          </div>
        ) : activeTab === 'supplier' ? (
          <SuppliersPage supplierData={supplierData} />
        ) : activeTab === 'price' ? (
          <PricesPage priceData={priceData} skus={skus} activeSuppliers={activeSuppliers} allSuppliers={supplierData.suppliers} />
        ) : activeTab === 'bom' ? (
          <BOMPage bomData={bomData} skus={skus} prices={priceData.prices} />
        ) : activeTab === 'receipt' ? (
          <GoodsReceiptPage receiptData={receiptData} skus={skus} suppliers={supplierData.suppliers} prices={priceData.prices} />
        ) : activeTab === 'stock' ? (
          <RMStockPage skus={skus} stockData={stockData} />
        ) : activeTab === 'production' ? (
          <ProductionPage productionData={productionData} skus={skus} bomHeaders={bomData.headers} />
        ) : activeTab === 'smstock' ? (
          <SMStockPage skus={skus} smStockData={smStockData} />
        ) : (
          <DeliveryToBranchesPage deliveryData={deliveryData} skus={skus} />
        )}
      </main>

      <SKUFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={handleSubmit}
        editingSku={editingSku}
        activeSuppliers={activeSuppliers}
      />
    </div>
  );
};

export default Index;
