import { useState, useMemo, useCallback, useEffect } from "react";
import { SKU, SKUType } from "@/types/sku";
import { useSpBomData } from "@/hooks/use-sp-bom-data";
import { useModifierRuleData } from "@/hooks/use-modifier-rule-data";
import { useSkuData } from "@/hooks/use-sku-data";
import { useSupplierData } from "@/hooks/use-supplier-data";
import { usePriceData } from "@/hooks/use-price-data";
import { useByproductData } from "@/hooks/use-byproduct-data";
import { useBomData } from "@/hooks/use-bom-data";
import { useGoodsReceiptData } from "@/hooks/use-goods-receipt-data";
import { useStockData } from "@/hooks/use-stock-data";
import { useProductionData } from "@/hooks/use-production-data";
import { useSmStockData } from "@/hooks/use-sm-stock-data";
import { usePkStockData } from "@/hooks/use-pk-stock-data";
import { useSmDailyUsage } from "@/hooks/use-sm-daily-usage";
import { useDeliveryData } from "@/hooks/use-delivery-data";
import { useVisibilityRefresh } from "@/hooks/use-visibility-refresh";
import { useBranchData } from "@/hooks/use-branch-data";
import { useStockCountData } from "@/hooks/use-stock-count-data";
import { useMenuData } from "@/hooks/use-menu-data";
import { useMenuBomData } from "@/hooks/use-menu-bom-data";
import { useSkuCategories } from "@/hooks/use-sku-categories";
import { useAuth } from "@/hooks/use-auth";
import Dashboard from "@/pages/Dashboard";
import { SummaryCards } from "@/components/SummaryCards";
import { SKUTable } from "@/components/SKUTable";
import { SKUFormModal } from "@/components/SKUFormModal";
import { CSVImportModal, CSVColumnDef, CSVValidationError } from "@/components/CSVImportModal";
import SuppliersPage from "@/pages/Suppliers";
import PricesPage from "@/pages/Prices";
import BOMPage from "@/pages/BOM";
import GoodsReceiptPage from "@/pages/GoodsReceipt";
import RMStockPage from "@/pages/RMStock";
import ProductionPage from "@/pages/Production";
import SMStockPage from "@/pages/SMStock";
import PKStockPage from "@/pages/PKStock";
import StockCountPage from "@/pages/StockCount";
import DeliveryToBranchesPage from "@/pages/DeliveryToBranches";
import TransferOrderPage from "@/pages/TransferOrder";
import BranchesPage from "@/pages/Branches";
import UserManagementPage from "@/pages/UserManagement";
import MenuMasterPage from "@/pages/MenuMaster";
import MenuBOMPage from "@/pages/MenuBOM";
import SpBomPage from "@/pages/SpBom";
import ModifierRulesPage from "@/pages/ModifierRules";
import SalesEntryPage from "@/pages/SalesEntry";
import DailyStockCountPage from "@/pages/DailyStockCount";
import BranchReceiptPage from "@/pages/BranchReceipt";
import BranchReceiptMobilePage from "@/pages/BranchReceiptMobile";
import TransferRequestPage from "@/pages/TransferRequest";
import FoodCostPage from "@/pages/FoodCost";
import StoreOverview from "@/pages/StoreOverview";
import StoreStockPage from "@/pages/StoreStock";
import SkuCategoriesPage from "@/pages/SkuCategories";
import { AppSidebar, TabKey, tabContextMap, getDefaultTab } from "@/components/AppSidebar";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Plus, Upload, Package } from "lucide-react";
import { toast } from "sonner";

const tabLabels: Record<TabKey, { title: string; subtitle: string }> = {
  dashboard: { title: "Dashboard", subtitle: "" },
  sku: { title: "SKU Master", subtitle: "Manage your inventory items across all categories" },
  supplier: { title: "Suppliers", subtitle: "Your trusted ingredient partners" },
  price: { title: "Price Master", subtitle: "Track costs across all suppliers" },
  bom: { title: "BOM Master", subtitle: "Track what goes into every dish" },
  receipt: { title: "Goods Receipt", subtitle: "Record incoming ingredients" },
  stock: { title: "RM Stock", subtitle: "Raw material inventory levels" },
  production: { title: "Production", subtitle: "Plan and track your kitchen output" },
  smstock: { title: "SM Stock", subtitle: "Semi-finished goods inventory" },
  stockcount: { title: "Stock Count", subtitle: "Verify your physical inventory" },
  delivery: { title: "Delivery to Branches", subtitle: "Track what leaves the kitchen" },
  "transfer-order": { title: "Transfer Order", subtitle: "Create and send SM deliveries to branches" },
  branches: { title: "Branches", subtitle: "Manage your restaurant locations" },
  users: { title: "User Management", subtitle: "Team access and permissions" },
  store: { title: "Store Overview", subtitle: "Branch operations at a glance" },
  "menu-master": { title: "Menu Master", subtitle: "Your menu catalog" },
  "menu-bom": { title: "Menu BOM", subtitle: "Ingredients behind every menu item" },
  "sp-bom": { title: "SP BOM", subtitle: "Special product recipes" },
  "modifier-rules": { title: "Modifier Rules", subtitle: "Auto-adjust ingredients for menu options" },
  "sales-entry": { title: "Sales Entry", subtitle: "Record daily sales data" },
  "branch-receipt": { title: "Branch Receipt", subtitle: "Track incoming stock at branches" },
  "branch-receipt-mobile": { title: "รับของ (มือถือ)", subtitle: "บันทึกรับสินค้าจากซัพพลายเออร์" },
  "transfer-request": { title: "Transfer Request", subtitle: "Request SM ingredients from Central Kitchen" },
  "daily-stock-count": { title: "Daily Stock Count", subtitle: "Daily branch inventory check" },
  "store-stock": { title: "Store Stock", subtitle: "Branch-level stock balances" },
  "food-cost": { title: "Food Cost", subtitle: "Analyze your cost vs revenue" },
  "sku-categories": { title: "SKU Categories", subtitle: "Manage ingredient categories" },
  pkstock: { title: "PK Stock", subtitle: "Packaging material stock balances" },
};

// Define which tabs each role can access
function canAccessTab(role: string | null, tab: TabKey): boolean {
  const ctx = tabContextMap[tab];
  switch (role) {
    case "management":
      return true;
    case "ck_manager":
      return ctx === "ck" || ctx === "overview";
    case "store_manager":
      return ctx === "store";
    case "area_manager":
      return ctx === "store";
    default:
      return false;
  }
}

// Management can edit everything. CK Manager can edit CK ops, view masters.
// Store Manager can edit store ops, view store masters. Area Manager is read-only everywhere.
function isTabReadOnly(role: string | null, tab: TabKey): boolean {
  if (role === "management") return false;
  if (role === "area_manager") return true;
  if (role === "ck_manager") {
    const editableCk: TabKey[] = [
      "receipt",
      "production",
      "delivery",
      "transfer-order",
      "stock",
      "smstock",
      "pkstock",
      "stockcount",
    ];
    return !editableCk.includes(tab);
  }
  if (role === "store_manager") {
    const editableStore: TabKey[] = ["sales-entry", "branch-receipt", "branch-receipt-mobile", "daily-stock-count", "transfer-request"];
    return !editableStore.includes(tab);
  }
  return true;
}

function ContextBreadcrumb({ tab, branchName }: { tab: TabKey; branchName?: string }) {
  const ctx = tabContextMap[tab];
  if (ctx === "ck" || tab === "dashboard") {
    return <span className="text-helper text-muted-foreground">Central Kitchen</span>;
  }
  if (ctx === "store") {
    return <span className="text-helper text-muted-foreground">Store{branchName ? ` — ${branchName}` : ""}</span>;
  }
  return null;
}

const Index = () => {
  const { isManagement, role, isStoreManager, isAreaManager, profile, brandAssignments } = useAuth();
  const skuData = useSkuData();
  const supplierData = useSupplierData();
  const priceData = usePriceData();
  const bomData = useBomData();
  const byproductData = useByproductData();
  const receiptData = useGoodsReceiptData();
  const stockData = useStockData(skuData.skus, receiptData.receipts, priceData.prices);
  const productionData = useProductionData(bomData.headers, bomData.lines, stockData.addAdjustment, bomData.steps);
  const deliveryData = useDeliveryData();
  const smStockData = useSmStockData(
    skuData.skus,
    productionData.records,
    deliveryData.deliveries,
    bomData.headers,
    bomData.lines,
    priceData.prices,
    bomData.steps,
    byproductData.byproducts,
  );
  const smDailyUsage = useSmDailyUsage(skuData.skus);
  const pkStockData = usePkStockData(skuData.skus, receiptData.receipts, priceData.prices);
  const branchData = useBranchData();

  useVisibilityRefresh([
    () => smStockData.refreshProductionRecords(),
    () => smStockData.refreshToDelivered(),
    () => receiptData.fetchReceipts(receiptData.isFullHistory),
  ]);
  const menuData = useMenuData();
  const menuBomData = useMenuBomData();
  const menuBomLoading = menuBomData.loading;
  const spBomData = useSpBomData();
  const modifierRuleData = useModifierRuleData();
  const skuCategoryData = useSkuCategories();
  const stockCountData = useStockCountData({
    skus: skuData.skus,
    rmStockBalances: stockData.stockBalances,
    smStockBalances: smStockData.stockBalances,
    addRmAdjustment: stockData.addAdjustment,
    addSmAdjustment: smStockData.addAdjustment,
    getStdUnitPrice: stockData.getStdUnitPrice,
    refreshSmStock: smStockData.refreshProductionRecords,
  });
  const { skus, addSku, bulkAddSkus, updateSku, deleteSku } = skuData;
  const [modalOpen, setModalOpen] = useState(false);
  const [editingSku, setEditingSku] = useState<SKU | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>(() => getDefaultTab(role));
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);
  const [csvImportOpen, setCsvImportOpen] = useState(false);

  // Update default tab when role loads
  useEffect(() => {
    if (role) {
      setActiveTab(getDefaultTab(role));
    }
  }, [role]);

  // Branch name for breadcrumbs
  const userBranchName = useMemo(() => {
    if (!profile?.branch_id) return undefined;
    return branchData.branches.find((b) => b.id === profile.branch_id)?.branchName;
  }, [profile?.branch_id, branchData.branches]);

  // For area_manager: filter branches by brand assignments
  const areaManagerBranches = useMemo(() => {
    if (!isAreaManager || brandAssignments.length === 0) return branchData.branches;
    return branchData.branches.filter((b) => brandAssignments.includes(b.brandName));
  }, [isAreaManager, brandAssignments, branchData.branches]);

  // Current tab read-only status
  const readOnly = isTabReadOnly(role, activeTab);

  // Access control for tab changes
  const handleTabChange = (tab: TabKey) => {
    if (!canAccessTab(role, tab)) {
      toast.error("You don't have access to that section");
      setActiveTab(getDefaultTab(role));
      return;
    }
    setActiveTab(tab);
  };

  // SKU CSV import columns
  const skuCsvColumns: CSVColumnDef[] = [
    { key: "name", label: "Name", required: true },
    { key: "type", label: "Type", required: true },
    { key: "category", label: "Category", required: true },
    { key: "status", label: "Status" },
    { key: "specNote", label: "Spec Note" },
    { key: "packSize", label: "Pack Size" },
    { key: "packUnit", label: "Pack Unit" },
    { key: "purchaseUom", label: "Purchase UOM" },
    { key: "usageUom", label: "Usage UOM" },
    { key: "converter", label: "Converter" },
    { key: "storageCondition", label: "Storage Condition" },
    { key: "shelfLife", label: "Shelf Life" },
    { key: "vat", label: "VAT" },
    { key: "leadTime", label: "Lead Time" },
  ];

  const validateSkuCsv = useCallback(
    (rows: Record<string, string>[]) => {
      const errors: CSVValidationError[] = [];
      const valid: Record<string, string>[] = [];
      let skipped = 0;
      const validTypes = ["RM", "SM", "SP", "PK"];
      const validStorage = ["Frozen", "Chilled", "Ambient"];
      const existingNames = new Set(skus.map((s) => s.name.toLowerCase()));
      const seenNames = new Set<string>();

      rows.forEach((row, i) => {
        const rowNum = i + 2;
        const name = row["Name"]?.trim();
        const type = row["Type"]?.trim().toUpperCase();
        if (!name) {
          errors.push({ row: rowNum, message: "Name is required" });
          return;
        }
        if (!type || !validTypes.includes(type)) {
          errors.push({ row: rowNum, message: `Type must be one of ${validTypes.join("/")}` });
          return;
        }
        // Category is now dynamic — any non-empty code is accepted (will be auto-created if missing)
        const storage = row["Storage Condition"]?.trim();
        if (storage && !validStorage.includes(storage)) {
          errors.push({ row: rowNum, message: `Storage Condition must be one of ${validStorage.join("/")}` });
          return;
        }
        if (existingNames.has(name.toLowerCase()) || seenNames.has(name.toLowerCase())) {
          skipped++;
          return;
        }
        seenNames.add(name.toLowerCase());
        valid.push(row);
      });
      return { valid, errors, skipped };
    },
    [skus],
  );

  const handleSkuCsvConfirm = useCallback(
    async (rows: Record<string, string>[]) => {
      // Collect all category codes from the CSV
      const csvCategoryCodes = [
        ...new Set(rows.map((r) => r["Category"]?.trim().toUpperCase() || "MT").filter(Boolean)),
      ];
      // Auto-create missing categories
      const newCats = await skuCategoryData.bulkEnsureCategories(csvCategoryCodes);

      const skuRows: Omit<SKU, "id" | "skuId">[] = rows.map((row) => ({
        name: row["Name"]?.trim() || "",
        type: (row["Type"]?.trim().toUpperCase() || "RM") as any,
        category: row["Category"]?.trim().toUpperCase() || "MT",
        status: row["Status"]?.trim() === "Inactive" ? "Inactive" : "Active",
        specNote: row["Spec Note"]?.trim() || "",
        packSize: Number(row["Pack Size"]) || 1,
        packUnit: row["Pack Unit"]?.trim() || "",
        purchaseUom: row["Purchase UOM"]?.trim() || "",
        usageUom: row["Usage UOM"]?.trim() || "",
        converter: Number(row["Converter"]) || 1,
        storageCondition: (["Frozen", "Chilled", "Ambient"].includes(row["Storage Condition"]?.trim())
          ? row["Storage Condition"]?.trim()
          : "Ambient") as any,
        shelfLife: Number(row["Shelf Life"]) || 0,
        vat: row["VAT"]?.trim().toLowerCase() === "true" || row["VAT"]?.trim() === "1",
        supplier1: "",
        supplier2: "",
        leadTime: Number(row["Lead Time"]) || 0,
        isDistributable: false,
      }));
      const count = await bulkAddSkus(skuRows);
      if (count) {
        let msg = `${count} SKUs imported successfully`;
        if (newCats.length > 0) {
          msg += `. ${newCats.length} new categories auto-created: ${newCats.join(", ")}. You can rename them in SKU Categories settings.`;
        }
        toast.success(msg);
      }
    },
    [bulkAddSkus, skuCategoryData],
  );

  const activeSuppliers = useMemo(
    () => supplierData.suppliers.filter((s) => s.status === "Active"),
    [supplierData.suppliers],
  );

  const activeBranches = useMemo(() => branchData.branches.filter((b) => b.status === "Active"), [branchData.branches]);

  const counts = useMemo(() => {
    const c: Record<SKUType, number> = { RM: 0, SM: 0, SP: 0, PK: 0 };
    skus.forEach((s) => c[s.type]++);
    return c;
  }, [skus]);

  const isSkuUsed = (skuId: string) => {
    const inBom = bomData.lines.some((l) => l.rmSkuId === skuId) || bomData.headers.some((h) => h.smSkuId === skuId);
    const inReceipt = receiptData.receipts.some((r) => r.skuId === skuId);
    const inProduction = productionData.records.some((r) => r.smSkuId === skuId);
    return inBom || inReceipt || inProduction;
  };

  const handleAdd = () => {
    setEditingSku(null);
    setModalOpen(true);
  };
  const handleEdit = (sku: SKU) => {
    if (readOnly) return;
    setEditingSku(sku);
    setModalOpen(true);
  };
  const handleDeleteRequest = (id: string) => {
    if (!isManagement) {
      toast.error("Only Management can delete items");
      return;
    }
    const sku = skus.find((s) => s.id === id);
    setDeleteConfirm({ id, name: sku?.name || sku?.skuId || "this SKU" });
  };
  const handleDeleteConfirm = () => {
    if (deleteConfirm) {
      deleteSku(deleteConfirm.id);
      toast.success(`SKU "${deleteConfirm.name}" deleted`);
      setDeleteConfirm(null);
    }
  };

  const handleSubmit = (data: Omit<SKU, "id" | "skuId">, newSkuCode?: string) => {
    if (editingSku) {
      updateSku(editingSku.id, data, newSkuCode);
      toast.success(newSkuCode ? `SKU updated — code changed to ${newSkuCode}` : "SKU updated");
    } else {
      addSku(data);
      toast.success("SKU added");
    }
  };

  const currentTab = tabLabels[activeTab] || { title: "Dashboard", subtitle: "" };

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar activeTab={activeTab} onTabChange={handleTabChange} />
        <div className="flex-1 flex flex-col min-w-0">
          {/* Top header bar */}
          <header className="h-14 flex items-center border-b bg-card px-6 gap-4 shrink-0">
            <SidebarTrigger />
            <div className="h-5 w-px bg-border" />
            <div className="min-w-0">
              <h1 className="text-sm font-semibold text-foreground truncate">{currentTab.title}</h1>
            </div>
            {readOnly && (
              <span className="ml-2 text-helper uppercase tracking-wider bg-muted text-muted-foreground px-2 py-0.5 rounded-full font-medium">
                View Only
              </span>
            )}
          </header>

          <main className="flex-1 overflow-auto">
            <div className="max-w-[1400px] mx-auto px-8 py-6">
              {activeTab === "dashboard" ? (
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
                  smDailyUsage={smDailyUsage}
                  getTotalProducedForPlan={productionData.getTotalProducedForPlan}
                  getStdUnitPrice={stockData.getStdUnitPrice}
                />
              ) : activeTab === "sku" ? (
                <div className="section-gap">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="page-title">{currentTab.title}</h2>
                      <ContextBreadcrumb tab={activeTab} branchName={userBranchName} />
                      <p className="page-subtitle">{currentTab.subtitle}</p>
                    </div>
                    {isManagement && (
                      <div className="flex gap-2">
                        <Button variant="outline" onClick={() => setCsvImportOpen(true)} className="h-9">
                          <Upload className="w-4 h-4" /> Import CSV
                        </Button>
                        <Button onClick={handleAdd} className="h-9">
                          <Plus className="w-4 h-4" /> Add SKU
                        </Button>
                      </div>
                    )}
                  </div>
                  <SummaryCards counts={counts} total={skus.length} />
                  <SKUTable
                    skus={skus}
                    onEdit={isManagement ? handleEdit : undefined}
                    onDelete={isManagement ? handleDeleteRequest : undefined}
                    onToggleDistributable={
                      isManagement || role === "ck_manager"
                        ? (id, value) => updateSku(id, { isDistributable: value })
                        : undefined
                    }
                    skuCategories={skuCategoryData.categories}
                  />
                </div>
              ) : activeTab === "supplier" ? (
                <SuppliersPage supplierData={supplierData} readOnly={readOnly} />
              ) : activeTab === "price" ? (
                <PricesPage
                  priceData={priceData}
                  skus={skus}
                  activeSuppliers={activeSuppliers}
                  allSuppliers={supplierData.suppliers}
                  readOnly={readOnly}
                  bomHeaders={bomData.headers}
                />
              ) : activeTab === "bom" ? (
                <BOMPage
                  bomData={bomData}
                  skus={skus}
                  prices={priceData.prices}
                  readOnly={readOnly}
                  onPricesRefresh={priceData.refreshPrices}
                  byproductData={byproductData}
                />
              ) : activeTab === "receipt" ? (
                <GoodsReceiptPage
                  receiptData={receiptData}
                  skus={skus}
                  suppliers={supplierData.suppliers}
                  prices={priceData.prices}
                  bomLines={bomData.lines}
                />
              ) : activeTab === "stock" ? (
                <RMStockPage skus={skus} stockData={stockData} bomHeaders={bomData.headers} bomLines={bomData.lines} />
              ) : activeTab === "production" ? (
                <ProductionPage
                  productionData={productionData}
                  skus={skus}
                  bomHeaders={bomData.headers}
                  stockBalances={stockData.stockBalances}
                  bomLines={bomData.lines}
                  bomSteps={bomData.steps}
                  smStockBalances={smStockData.stockBalances}
                  isStockDataReady={smStockData.isStockDataReady}
                  menuBomLines={menuBomData.lines}
                  menus={menuData.menus}
                  bomByproducts={byproductData.byproducts}
                  refreshProductionRecords={smStockData.refreshProductionRecords}
                />
              ) : activeTab === "smstock" ? (
                <SMStockPage skus={skus} smStockData={smStockData} smDailyUsage={smDailyUsage} />
              ) : activeTab === "pkstock" ? (
                <PKStockPage
                  skus={skus}
                  stockData={pkStockData}
                  bomHeaders={bomData.headers}
                  bomLines={bomData.lines}
                />
              ) : activeTab === "stockcount" ? (
                <StockCountPage
                  skus={skus}
                  stockCountData={stockCountData}
                  getStdUnitPrice={stockData.getStdUnitPrice}
                  bomHeaders={bomData.headers}
                  bomLines={bomData.lines}
                  isManagement={isManagement}
                />
              ) : activeTab === "branches" ? (
                <BranchesPage branchData={branchData} readOnly={readOnly} />
              ) : activeTab === "users" ? (
                isManagement ? (
                  <UserManagementPage />
                ) : (
                  <div className="text-muted-foreground">Access denied</div>
                )
              ) : activeTab === "store" ? (
                <StoreOverview
                  branches={isAreaManager ? areaManagerBranches : branchData.branches}
                  onNavigate={handleTabChange}
                />
              ) : activeTab === "menu-master" ? (
                <MenuMasterPage menuData={menuData} branches={branchData.branches} />
              ) : activeTab === "menu-bom" ? (
                <MenuBOMPage
                  menuBomData={menuBomData}
                  menus={menuData.menus}
                  skus={skus}
                  prices={priceData.prices}
                  branches={branchData.branches}
                  readOnly={!isManagement}
                />
              ) : activeTab === "sp-bom" ? (
                <SpBomPage
                  spBomData={spBomData}
                  skus={skus}
                  prices={priceData.prices}
                  readOnly={!isManagement}
                  onPricesRefresh={priceData.refreshPrices}
                />
              ) : activeTab === "modifier-rules" ? (
                <ModifierRulesPage
                  ruleData={modifierRuleData}
                  skus={skus}
                  menus={menuData.menus}
                  menuBomLines={menuBomData.lines}
                  readOnly={!isManagement}
                  branches={branchData.branches}
                />
              ) : activeTab === "sales-entry" ? (
                <SalesEntryPage
                  branches={isAreaManager ? areaManagerBranches : branchData.branches}
                  menus={menuData.menus}
                  modifierRules={modifierRuleData.rules}
                />
              ) : activeTab === "branch-receipt" ? (
                <BranchReceiptPage
                  skus={skus}
                  prices={priceData.prices}
                  branches={isAreaManager ? areaManagerBranches : branchData.branches}
                  suppliers={supplierData.suppliers}
                  menus={menuData.menus}
                  menuBomLines={menuBomData.lines}
                  getBomCostPerGram={smStockData.getBomCostPerGram}
                />
              ) : activeTab === "transfer-request" ? (
                <TransferRequestPage />
              ) : activeTab === "transfer-order" ? (
                <TransferOrderPage
                  getBomCostPerGram={smStockData.getBomCostPerGram}
                  refreshSmStock={smStockData.refreshToDelivered}
                />
              ) : activeTab === "daily-stock-count" ? (
                <DailyStockCountPage
                  skus={skus}
                  menuBomLines={menuBomData.lines}
                  modifierRules={modifierRuleData.rules}
                  spBomLines={spBomData.lines}
                  menus={menuData.menus}
                  branches={isAreaManager ? areaManagerBranches : branchData.branches}
                  menuBomLoading={menuBomLoading}
                />
              ) : activeTab === "store-stock" ? (
                <StoreStockPage
                  skus={skus}
                  branches={isAreaManager ? areaManagerBranches : branchData.branches}
                  bomHeaders={bomData.headers}
                  bomLines={bomData.lines}
                  menus={menuData.menus}
                  menuBomLines={menuBomData.lines}
                  spBomLines={spBomData.lines}
                  modifierRules={modifierRuleData.rules}
                />
              ) : activeTab === "food-cost" ? (
                <FoodCostPage
                  skus={skus}
                  prices={priceData.prices}
                  menus={menuData.menus}
                  menuBomLines={menuBomData.lines}
                  modifierRules={modifierRuleData.rules}
                  spBomLines={spBomData.lines}
                  branches={isAreaManager ? areaManagerBranches : branchData.branches}
                  suppliers={supplierData.suppliers}
                />
              ) : activeTab === "sku-categories" ? (
                <SkuCategoriesPage categoryData={skuCategoryData} skus={skus} readOnly={!isManagement} />
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

      {isManagement && (
        <>
          <SKUFormModal
            open={modalOpen}
            onClose={() => setModalOpen(false)}
            onSubmit={handleSubmit}
            editingSku={editingSku}
            activeSuppliers={activeSuppliers}
            isSkuUsed={editingSku ? isSkuUsed(editingSku.id) : false}
            allSkus={skus}
            skuCategories={skuCategoryData.categories}
            onAddCategory={skuCategoryData.addCategory}
            onManageCategories={() => handleTabChange("sku-categories")}
          />

          <ConfirmDialog
            open={!!deleteConfirm}
            onOpenChange={(open) => !open && setDeleteConfirm(null)}
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
