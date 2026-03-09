import { useState, useMemo, useCallback, useEffect } from 'react';
import { SKU, SKUType } from '@/types/sku';
import { useSpBomData } from '@/hooks/use-sp-bom-data';
import { useModifierRuleData } from '@/hooks/use-modifier-rule-data';
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
import { useMenuData } from '@/hooks/use-menu-data';
import { useMenuBomData } from '@/hooks/use-menu-bom-data';
import { useAuth } from '@/hooks/use-auth';
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
import UserManagementPage from '@/pages/UserManagement';
import MenuMasterPage from '@/pages/MenuMaster';
import MenuBOMPage from '@/pages/MenuBOM';
import SpBomPage from '@/pages/SpBom';
import ModifierRulesPage from '@/pages/ModifierRules';
import SalesEntryPage from '@/pages/SalesEntry';
import DailyStockCountPage from '@/pages/DailyStockCount';
import BranchReceiptPage from '@/pages/BranchReceipt';
import FoodCostPage from '@/pages/FoodCost';
import { AppSidebar, TabKey } from '@/components/AppSidebar';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Plus, Upload } from 'lucide-react';
import { toast } from 'sonner';

const tabLabels: Record<TabKey, string> = {
  dashboard: 'Dashboard',
  sku: 'SKU Master',
  supplier: 'Suppliers',
  price: 'Price Master',
  bom: 'BOM Master',
  receipt: 'Goods Receipt',
  stock: 'RM Stock',
  production: 'Production',
  smstock: 'SM Stock',
  stockcount: 'Stock Count',
  delivery: 'Delivery to Branches',
  branches: 'Branches',
  users: 'User Management',
  store: 'Store',
  'menu-master': 'Menu Master',
  'menu-bom': 'Menu BOM',
  'sp-bom': 'SP BOM',
  'modifier-rules': 'Modifier Rules',
  'sales-entry': 'Sales Entry',
  'branch-receipt': 'Branch Receipt',
  'daily-stock-count': 'Daily Stock Count',
  'food-cost': 'Food Cost',
};

// Tabs that CK Manager can fully interact with
const ckManagerFullAccess: TabKey[] = ['dashboard', 'receipt', 'production', 'delivery', 'stock', 'smstock', 'stockcount'];
// Tabs that CK Manager can view (read-only)
const ckManagerReadOnly: TabKey[] = ['sku', 'supplier', 'price', 'bom', 'branches'];

const Index = () => {
  const { isAdmin, role, isBranchManager } = useAuth();
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
  const menuData = useMenuData();
  const menuBomData = useMenuBomData();
  const spBomData = useSpBomData();
  const modifierRuleData = useModifierRuleData();
  const stockCountData = useStockCountData({
    skus: skuData.skus,
    rmStockBalances: stockData.stockBalances,
    smStockBalances: smStockData.stockBalances,
    addRmAdjustment: stockData.addAdjustment,
    addSmAdjustment: smStockData.addAdjustment,
    getStdUnitPrice: stockData.getStdUnitPrice,
  });
  const { skus, addSku, bulkAddSkus, updateSku, deleteSku } = skuData;
  const [modalOpen, setModalOpen] = useState(false);
  const [editingSku, setEditingSku] = useState<SKU | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>(isBranchManager ? 'store' : 'dashboard');
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);
  const [csvImportOpen, setCsvImportOpen] = useState(false);

  // Check if current tab is read-only for CK Manager
  const isReadOnly = !isAdmin && ckManagerReadOnly.includes(activeTab);

  // Access control for tab changes
  const handleTabChange = (tab: TabKey) => {
    if (!isAdmin && tab === 'users') {
      toast.error('Access denied: Admin only');
      return;
    }
    if (isBranchManager && tab !== 'store' && tab !== 'menu-master' && tab !== 'menu-bom' && tab !== 'sp-bom' && tab !== 'modifier-rules' && tab !== 'sales-entry' && tab !== 'branch-receipt' && tab !== 'daily-stock-count' && tab !== 'food-cost') {
      toast.error('Access denied');
      return;
    }
    setActiveTab(tab);
  };

  // SKU CSV import columns
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

  const handleSkuCsvConfirm = useCallback(async (rows: Record<string, string>[]) => {
    const skuRows: Omit<SKU, 'id' | 'skuId'>[] = rows.map(row => ({
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
    }));
    const count = await bulkAddSkus(skuRows);
    if (count) toast.success(`${count} SKUs imported successfully`);
  }, [bulkAddSkus]);

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

  const isSkuUsed = (skuId: string) => {
    const inBom = bomData.lines.some(l => l.rmSkuId === skuId) || bomData.headers.some(h => h.smSkuId === skuId);
    const inReceipt = receiptData.receipts.some(r => r.skuId === skuId);
    const inProduction = productionData.records.some(r => r.smSkuId === skuId);
    return inBom || inReceipt || inProduction;
  };

  const handleAdd = () => { setEditingSku(null); setModalOpen(true); };
  const handleEdit = (sku: SKU) => {
    if (isReadOnly) return;
    setEditingSku(sku);
    setModalOpen(true);
  };
  const handleDeleteRequest = (id: string) => {
    if (!isAdmin) {
      toast.error('Only admins can delete items');
      return;
    }
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
        <AppSidebar activeTab={activeTab} onTabChange={handleTabChange} />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-12 flex items-center border-b bg-card px-4 gap-3 shrink-0">
            <SidebarTrigger />
            <div className="h-5 w-px bg-border" />
            <h1 className="text-sm font-heading font-semibold text-muted-foreground truncate">
              {tabLabels[activeTab] || 'Dashboard'}
            </h1>
            {isReadOnly && (
              <span className="ml-2 text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded">View Only</span>
            )}
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
                    {isAdmin && (
                      <div className="flex gap-2">
                        <Button variant="outline" onClick={() => setCsvImportOpen(true)}>
                          <Upload className="w-4 h-4" /> Import CSV
                        </Button>
                        <Button onClick={handleAdd}>
                          <Plus className="w-4 h-4" /> Add SKU
                        </Button>
                      </div>
                    )}
                  </div>
                  <SummaryCards counts={counts} total={skus.length} />
                  <SKUTable
                    skus={skus}
                    onEdit={isAdmin ? handleEdit : undefined}
                    onDelete={isAdmin ? handleDeleteRequest : undefined}
                  />
                </div>
              ) : activeTab === 'supplier' ? (
                <SuppliersPage supplierData={supplierData} readOnly={isReadOnly} />
              ) : activeTab === 'price' ? (
                <PricesPage priceData={priceData} skus={skus} activeSuppliers={activeSuppliers} allSuppliers={supplierData.suppliers} readOnly={isReadOnly} />
              ) : activeTab === 'bom' ? (
                <BOMPage bomData={bomData} skus={skus} prices={priceData.prices} readOnly={isReadOnly} />
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
                <BranchesPage branchData={branchData} readOnly={isReadOnly} />
              ) : activeTab === 'users' ? (
                isAdmin ? <UserManagementPage /> : <div className="text-muted-foreground">Access denied</div>
              ) : activeTab === 'store' ? (
                <div className="text-muted-foreground text-center py-12">Store section coming soon.</div>
              ) : activeTab === 'menu-master' ? (
                <MenuMasterPage menuData={menuData} branches={branchData.branches} />
              ) : activeTab === 'menu-bom' ? (
                <MenuBOMPage
                  menuBomData={menuBomData}
                  menus={menuData.menus}
                  skus={skus}
                  prices={priceData.prices}
                  branches={branchData.branches}
                  readOnly={!isAdmin}
                />
                ) : activeTab === 'sp-bom' ? (
                <SpBomPage
                  spBomData={spBomData}
                  skus={skus}
                  prices={priceData.prices}
                  readOnly={!isAdmin}
                />
              ) : activeTab === 'modifier-rules' ? (
                <ModifierRulesPage
                  ruleData={modifierRuleData}
                  skus={skus}
                  menus={menuData.menus}
                  readOnly={!isAdmin}
                />
              ) : activeTab === 'sales-entry' ? (
                <SalesEntryPage branches={branchData.branches} />
              ) : activeTab === 'branch-receipt' ? (
                <BranchReceiptPage skus={skus} prices={priceData.prices} branches={branchData.branches} suppliers={supplierData.suppliers} />
              ) : activeTab === 'daily-stock-count' ? (
                <DailyStockCountPage
                  skus={skus}
                  menuBomLines={menuBomData.lines}
                  modifierRules={modifierRuleData.rules}
                  spBomLines={spBomData.lines}
                  menus={menuData.menus}
                  branches={branchData.branches}
                />
              ) : activeTab === 'food-cost' ? (
                <FoodCostPage
                  skus={skus}
                  prices={priceData.prices}
                  menus={menuData.menus}
                  menuBomLines={menuBomData.lines}
                  modifierRules={modifierRuleData.rules}
                  spBomLines={spBomData.lines}
                  branches={branchData.branches}
                  suppliers={supplierData.suppliers}
                />
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

      {isAdmin && (
        <>
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

          <CSVImportModal
            open={csvImportOpen}
            onClose={() => setCsvImportOpen(false)}
            title="SKU Master"
            columns={skuCsvColumns}
            validate={validateSkuCsv}
            onConfirm={handleSkuCsvConfirm}
          />
        </>
      )}
    </SidebarProvider>
  );
};

export default Index;
