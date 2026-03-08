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
import { useBranchData } from '@/hooks/use-branch-data';
import { useStockCountData } from '@/hooks/use-stock-count-data';
import Dashboard from '@/pages/Dashboard';
import { SummaryCards } from '@/components/SummaryCards';
import { SKUTable } from '@/components/SKUTable';
import { SKUFormModal } from '@/components/SKUFormModal';
import { CSVImportModal, CSVColumnDef, CSVValidationError } from '@/components/CSVImportModal';
import SuppliersPage from '@/pages/Suppliers';
import PricesPage from '@/pages/Prices';
import BOMPage from '@/pages/BOM';
import GoodsReceiptPage from '@/pages/GoodsReceipt';
import RMStockPage from '@/pages/RMStock';
import ProductionPage from '@/pages/Production';
import SMStockPage from '@/pages/SMStock';
import StockCountPage from '@/pages/StockCount';
import DeliveryToBranchesPage from '@/pages/DeliveryToBranches';
import BranchesPage from '@/pages/Branches';
import { AppSidebar, TabKey } from '@/components/AppSidebar';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Plus, ChefHat, Upload } from 'lucide-react';
import { toast } from 'sonner';

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
  const branchData = useBranchData();
  const stockCountData = useStockCountData({
    skus: skuData.skus,
    rmStockBalances: stockData.stockBalances,
    smStockBalances: smStockData.stockBalances,
    addRmAdjustment: stockData.addAdjustment,
    addSmAdjustment: smStockData.addAdjustment,
    getStdUnitPrice: stockData.getStdUnitPrice,
  });
  const { skus, addSku, updateSku, deleteSku } = skuData;
  const [modalOpen, setModalOpen] = useState(false);
  const [editingSku, setEditingSku] = useState<SKU | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('dashboard');
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);
  const [csvImportOpen, setCsvImportOpen] = useState(false);

  // SKU CSV import
  const skuCsvColumns: CSVColumnDef[] = [
    { key: 'name', label: 'Name', required: true },
    { key: 'type', label: 'Type', required: true },
    { key: 'category', label: 'Category', required: true },
    { key: 'status', label: 'Status' },
    { key: 'specNote', label: 'Spec Note' },
    { key: 'packSize', label: 'Pack Size' },
    { key: 'packUnit', label: 'Pack Unit' },
    { key: 'purchaseUom', label: 'Purchase UOM' },
    { key: 'usageUom', label: 'Usage UOM' },
    { key: 'converter', label: 'Converter' },
    { key: 'storageCondition', label: 'Storage Condition' },
    { key: 'shelfLife', label: 'Shelf Life' },
    { key: 'vat', label: 'VAT' },
    { key: 'leadTime', label: 'Lead Time' },
  ];

  const validateSkuCsv = useCallback((rows: Record<string, string>[]) => {
    const errors: CSVValidationError[] = [];
    const valid: Record<string, string>[] = [];
    let skipped = 0;
    const validTypes = ['RM', 'SM', 'SP', 'PK'];
    const validCategories = ['MT', 'SF', 'VG', 'FR', 'DG', 'SC', 'DY', 'OL'];
    const validStorage = ['Frozen', 'Chilled', 'Ambient'];
    const existingNames = new Set(skus.map(s => s.name.toLowerCase()));
    const seenNames = new Set<string>();

    rows.forEach((row, i) => {
      const rowNum = i + 2;
      const name = row['Name']?.trim();
      const type = row['Type']?.trim().toUpperCase();
      if (!name) { errors.push({ row: rowNum, message: 'Name is required' }); return; }
      if (!type || !validTypes.includes(type)) { errors.push({ row: rowNum, message: `Type must be one of ${validTypes.join('/')}` }); return; }
      const cat = row['Category']?.trim().toUpperCase();
      if (cat && !validCategories.includes(cat)) { errors.push({ row: rowNum, message: `Category must be one of ${validCategories.join('/')}` }); return; }
      const storage = row['Storage Condition']?.trim();
      if (storage && !validStorage.includes(storage)) { errors.push({ row: rowNum, message: `Storage Condition must be one of ${validStorage.join('/')}` }); return; }
      if (existingNames.has(name.toLowerCase()) || seenNames.has(name.toLowerCase())) { skipped++; return; }
      seenNames.add(name.toLowerCase());
      valid.push(row);
    });
    return { valid, errors, skipped };
  }, [skus]);

  const handleSkuCsvConfirm = useCallback((rows: Record<string, string>[]) => {
    let count = 0;
    rows.forEach(row => {
      addSku({
        name: row['Name']?.trim() || '',
        type: (row['Type']?.trim().toUpperCase() || 'RM') as any,
        category: (row['Category']?.trim().toUpperCase() || 'MT') as any,
        status: row['Status']?.trim() === 'Inactive' ? 'Inactive' : 'Active',
        specNote: row['Spec Note']?.trim() || '',
        packSize: Number(row['Pack Size']) || 1,
        packUnit: row['Pack Unit']?.trim() || '',
        purchaseUom: row['Purchase UOM']?.trim() || '',
        usageUom: row['Usage UOM']?.trim() || '',
        converter: Number(row['Converter']) || 1,
        storageCondition: (['Frozen', 'Chilled', 'Ambient'].includes(row['Storage Condition']?.trim()) ? row['Storage Condition']?.trim() : 'Ambient') as any,
        shelfLife: Number(row['Shelf Life']) || 0,
        vat: row['VAT']?.trim().toLowerCase() === 'true' || row['VAT']?.trim() === '1',
        supplier1: '',
        supplier2: '',
        leadTime: Number(row['Lead Time']) || 0,
      });
      count++;
    });
    toast.success(`${count} SKUs imported successfully`);
  }, [addSku]);

  const activeSuppliers = useMemo(
    () => supplierData.suppliers.filter(s => s.status === 'Active'),
    [supplierData.suppliers]
  );

  const activeBranches = useMemo(
    () => branchData.branches.filter(b => b.status === 'Active'),
    [branchData.branches]
  );

  const counts = useMemo(() => {
    const c: Record<SKUType, number> = { RM: 0, SM: 0, SP: 0, PK: 0 };
    skus.forEach(s => c[s.type]++);
    return c;
  }, [skus]);

  // Check if SKU is used in BOM, Goods Receipt, or Production
  const isSkuUsed = (skuId: string) => {
    const inBom = bomData.lines.some(l => l.rmSkuId === skuId) || bomData.headers.some(h => h.smSkuId === skuId);
    const inReceipt = receiptData.receipts.some(r => r.skuId === skuId);
    const inProduction = productionData.records.some(r => r.smSkuId === skuId);
    return inBom || inReceipt || inProduction;
  };

  const handleAdd = () => { setEditingSku(null); setModalOpen(true); };
  const handleEdit = (sku: SKU) => { setEditingSku(sku); setModalOpen(true); };
  const handleDeleteRequest = (id: string) => {
    const sku = skus.find(s => s.id === id);
    setDeleteConfirm({ id, name: sku?.name || sku?.skuId || 'this SKU' });
  };
  const handleDeleteConfirm = () => {
    if (deleteConfirm) {
      deleteSku(deleteConfirm.id);
      toast.success(`SKU "${deleteConfirm.name}" deleted`);
      setDeleteConfirm(null);
    }
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
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar activeTab={activeTab} onTabChange={setActiveTab} />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-12 flex items-center border-b bg-card px-4 gap-3 shrink-0">
            <SidebarTrigger />
            <div className="h-5 w-px bg-border" />
            <h1 className="text-sm font-heading font-semibold text-muted-foreground truncate">
              {activeTab === 'dashboard' ? 'Dashboard' :
                activeTab === 'sku' ? 'SKU Master' :
                activeTab === 'supplier' ? 'Suppliers' :
                activeTab === 'price' ? 'Price Master' :
                activeTab === 'bom' ? 'BOM Master' :
                activeTab === 'receipt' ? 'Goods Receipt' :
                activeTab === 'stock' ? 'RM Stock' :
                activeTab === 'production' ? 'Production' :
                activeTab === 'smstock' ? 'SM Stock' :
                activeTab === 'stockcount' ? 'Stock Count' :
                activeTab === 'delivery' ? 'Delivery to Branches' :
                'Branches'}
            </h1>
          </header>

          <main className="flex-1 overflow-auto p-6">
            <div className="max-w-[1400px] mx-auto">
              {activeTab === 'dashboard' ? (
                <Dashboard
                  skus={skus}
                  smStockBalances={smStockData.stockBalances}
                  rmStockBalances={stockData.stockBalances}
                  productionPlans={productionData.plans}
                  productionRecords={productionData.records}
                  receipts={receiptData.receipts}
                  bomHeaders={bomData.headers}
                  bomLines={bomData.lines}
                  prices={priceData.prices}
                  deliveries={deliveryData.deliveries}
                  getTotalProducedForPlan={productionData.getTotalProducedForPlan}
                  getStdUnitPrice={stockData.getStdUnitPrice}
                />
              ) : activeTab === 'sku' ? (
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
                  <SKUTable skus={skus} onEdit={handleEdit} onDelete={handleDeleteRequest} />
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
                <ProductionPage
                  productionData={productionData}
                  skus={skus}
                  bomHeaders={bomData.headers}
                  stockBalances={stockData.stockBalances}
                  bomLines={bomData.lines}
                />
              ) : activeTab === 'smstock' ? (
                <SMStockPage skus={skus} smStockData={smStockData} />
              ) : activeTab === 'stockcount' ? (
                <StockCountPage skus={skus} stockCountData={stockCountData} getStdUnitPrice={stockData.getStdUnitPrice} />
              ) : activeTab === 'branches' ? (
                <BranchesPage branchData={branchData} />
              ) : (
                <DeliveryToBranchesPage
                  deliveryData={deliveryData}
                  skus={skus}
                  activeBranches={activeBranches}
                  smStockBalances={smStockData.stockBalances}
                />
              )}
            </div>
          </main>
        </div>
      </div>

      <SKUFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={handleSubmit}
        editingSku={editingSku}
        activeSuppliers={activeSuppliers}
        isSkuUsed={editingSku ? isSkuUsed(editingSku.id) : false}
      />

      <ConfirmDialog
        open={!!deleteConfirm}
        onOpenChange={open => !open && setDeleteConfirm(null)}
        title="Delete SKU"
        description={`Are you sure you want to delete "${deleteConfirm?.name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={handleDeleteConfirm}
      />
    </SidebarProvider>
  );
};

export default Index;
