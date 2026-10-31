import { useState, useMemo, useCallback, useEffect, lazy, Suspense } from "react";
import { CountReminder } from "@/components/count/CountReminder";
import { BaseLoadingBar, BasePageSkeleton, useBaseStatus } from "@/components/BaseLoading";
import { useNavigate, useParams } from "react-router-dom";
import { useSpBomData } from "@/hooks/use-sp-bom-data";
import { useImportSaves } from "@/hooks/use-import-saves";
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
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const GoodsReceiptPage = lazy(() => import("@/pages/KitchenReceive"));
const KitchenStockPage = lazy(() => import("@/pages/KitchenStock"));
const ProductionPage = lazy(() => import("@/pages/Produce"));
const StockCountPage = lazy(() => import("@/pages/KitchenCount"));
const TransferOrderPage = lazy(() => import("@/pages/Transfer"));
// Branches, users and categories: one settings page, three tabs
const SettingsPage = lazy(() => import("@/pages/Settings"));
const MenuSetupPage = lazy(() => import("@/pages/MenuSetup"));
const CostCenterPage = lazy(() => import("@/pages/CostCenter"));
// One sales page for phones and computers (replaced SalesEntry)
const SalesEntryPage = lazy(() => import("@/pages/Sales"));
// The daily branch count, rebuilt (replaced DailyStockCount)
const DailyStockCountPage = lazy(() => import("@/pages/DailyCount"));
// One receiving page for phones and computers (replaced BranchReceipt + BranchReceiptMobile)
const ReceivePage = lazy(() => import("@/pages/Receive"));
// One request page for phones and computers (replaced TransferRequest)
const TransferRequestPage = lazy(() => import("@/pages/Request"));
const FoodCostPage = lazy(() => import("@/pages/FoodCost"));
const StoreOverview = lazy(() => import("@/pages/StoreOverview"));
const StoreStockPage = lazy(() => import("@/pages/StoreStock"));
import { AppSidebar, TabKey, tabContextMap, getDefaultTab, bottomNavFor } from "@/components/AppSidebar";
import { BottomNavBar } from "@/components/BottomNavBar";
import { SidebarProvider, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

/** Old pages whose work is in Cost Center now: where their address lands there */
const OLD_PAGE_HASH: Record<string, string> = {
  "modifier-rules": "pos/rules",
  sku: "products",
  price: "products",
  "sp-bom": "products",
  supplier: "suppliers",
  "menu-master": "menus",
  "menu-bom": "menus",
};

const tabLabels: Record<TabKey, { title: string; subtitle: string }> = {
  dashboard: { title: "ภาพรวมครัวกลาง", subtitle: "ต้นทุนจริงเทียบสูตร" },
  sku: { title: "รายการสินค้า (หน้าเดิม)", subtitle: "นำเข้า/ส่งออกสินค้า" },
  supplier: { title: "ซัพพลายเออร์ (หน้าเดิม)", subtitle: "นำเข้าซัพพลายเออร์" },
  price: { title: "ราคาทั้งหมด (หน้าเดิม)", subtitle: "ราคาทุกซัพพลายเออร์" },
  receipt: { title: "รับของเข้าครัว", subtitle: "ใส่ตามบิลซัพพลายเออร์" },
  stock: { title: "สต๊อกครัว", subtitle: "วัตถุดิบ · ครัวผลิต · บรรจุภัณฑ์" },
  production: { title: "การผลิต", subtitle: "บันทึกผลผลิตและวางแผน" },
  smstock: { title: "สต๊อกครัว", subtitle: "วัตถุดิบ · ครัวผลิต · บรรจุภัณฑ์" },
  stockcount: { title: "นับสต๊อกครัว", subtitle: "นับเดือนละครั้ง" },
  "transfer-order": { title: "โอนสินค้า", subtitle: "ครัวกลางส่งของให้สาขา" },
  branches: { title: "ตั้งค่า", subtitle: "สาขา" },
  users: { title: "ตั้งค่า", subtitle: "ผู้ใช้" },
  store: { title: "วันนี้", subtitle: "งานประจำวันของครัวกลางและสาขา" },
  "menu-setup": { title: "ตั้งค่าเมนู", subtitle: "สูตร สาขา กฎพิเศษ ในที่เดียว" },
  "cost-center": { title: "Cost Center", subtitle: "เมนู สินค้า สูตร ราคา ซัพพลายเออร์" },
  "menu-master": { title: "รายการเมนู (หน้าเดิม)", subtitle: "นำเข้าเมนู" },
  "menu-bom": { title: "สูตรเมนู (หน้าเดิม)", subtitle: "สูตรเมนูแบบตาราง" },
  "sp-bom": { title: "สูตร SP (หน้าเดิม)", subtitle: "นำเข้าสูตร SP" },
  "modifier-rules": { title: "กฎพิเศษ", subtitle: "ปรับวัตถุดิบตามตัวเลือกเมนู" },
  "sales-entry": { title: "ยอดขาย", subtitle: "นำยอดขายจาก POS เข้า" },
  "branch-receipt": { title: "รับของ", subtitle: "รับของเข้าสาขา" },
  "branch-receipt-mobile": { title: "รับของ", subtitle: "รับของเข้าสาขา" },
  "transfer-request": { title: "ขอเบิก", subtitle: "ขอของจากครัวกลาง" },
  "daily-stock-count": { title: "นับสต๊อก", subtitle: "นับของหน้าร้านทุกวัน" },
  "store-stock": { title: "สต๊อกสาขา", subtitle: "คงเหลือของแต่ละสาขา" },
  "food-cost": { title: "ต้นทุนอาหาร", subtitle: "ต้นทุนเทียบยอดขาย" },
  "sku-categories": { title: "ตั้งค่า", subtitle: "หมวดสินค้า" },
  pkstock: { title: "สต๊อกครัว", subtitle: "วัตถุดิบ · ครัวผลิต · บรรจุภัณฑ์" },
};

// Define which tabs each role can access
function canAccessTab(role: string | null, tab: TabKey): boolean {
  // Everyone opens Cost Center; what each role may change is decided inside it
  if (tab === "cost-center") return !!role;
  const ctx = tabContextMap[tab];
  switch (role) {
    case "management":
      return true;
    case "ck_manager":
      // Product setup pages Cost Center still links to (recipes, categories)
      if (tab === "sku" || tab === "supplier" || tab === "price" || tab === "sp-bom" || tab === "sku-categories") return true;
      // The today page shows the kitchen card first
      return ctx === "ck" || ctx === "overview" || tab === "store";
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
      "transfer-order",
      "stock",
      "smstock",
      "pkstock",
      "stockcount",
      "sku",
      "supplier",
      "price",
      "sp-bom",
      "sku-categories",
      "cost-center",
    ];
    return !editableCk.includes(tab);
  }
  if (role === "store_manager") {
    const editableStore: TabKey[] = [
      "sales-entry",
      "branch-receipt",
      "branch-receipt-mobile",
      "daily-stock-count",
      "transfer-request",
    ];
    return !editableStore.includes(tab);
  }
  return true;
}

/** Phone bottom bar; must render inside SidebarProvider so "เมนู" can open the drawer */
function MobileNav({ role, activeTab, onTabChange }: { role: string | null; activeTab: TabKey; onTabChange: (t: TabKey) => void }) {
  const { setOpenMobile } = useSidebar();
  return (
    <BottomNavBar
      className="md:hidden"
      items={bottomNavFor(role as Parameters<typeof bottomNavFor>[0])}
      activeKey={activeTab}
      onSelect={(k) => onTabChange(k as TabKey)}
      onMore={() => setOpenMobile(true)}
    />
  );
}

const Index = () => {
  const { isManagement, role, isStoreManager, isAreaManager, profile, brandAssignments } = useAuth();
  const navigate = useNavigate();
  const { tab: pathTab } = useParams<{ tab?: string }>();
  // Page comes from the URL path (/menu-bom); old links with ?tab= still work
  const requestedTab = useMemo<TabKey | null>(() => {
    // Menu Setup moved into Cost Center: old links land on the same view there (the
    // address is then rewritten by the canonical-path effect below)
    if (pathTab === "menu-setup") return "cost-center";
    // Multi-step recipes and by-products moved into Cost Center too
    if (pathTab === "bom") return "cost-center";
    // …and every POS option rule (Cost Center › ตัวเลือก POS › กฎทั้งหมด), and the
    // old product / supplier / price / menu / recipe pages
    if (pathTab && pathTab in OLD_PAGE_HASH) return "cost-center";
    if (pathTab && pathTab in tabContextMap) return pathTab as TabKey;
    const legacy = new URLSearchParams(window.location.search).get("tab");
    return legacy && legacy in tabContextMap ? (legacy as TabKey) : null;
  }, [pathTab]);
  const activeTab: TabKey =
    requestedTab && (!role || canAccessTab(role, requestedTab)) ? requestedTab : getDefaultTab(role);


  // Kitchen stock/production data (≈20 requests, the slowest ones) is only used on
  // kitchen pages. Load it the first time one is opened, then keep it; branch pages
  // and store managers never wait for it.
  const [kitchenData, setKitchenData] = useState(false);
  const baseLoad = useBaseStatus();
  const onKitchenPage = tabContextMap[activeTab] !== "store" && tabContextMap[activeTab] !== "management";
  useEffect(() => {
    if (role && onKitchenPage) setKitchenData(true);
  }, [role, onKitchenPage]);
  const skuData = useSkuData();
  const supplierData = useSupplierData();
  const priceData = usePriceData();
  const bomData = useBomData();
  const byproductData = useByproductData();
  const receiptData = useGoodsReceiptData(kitchenData);
  const stockData = useStockData(skuData.skus, receiptData.receipts, priceData.prices, kitchenData);
  const productionData = useProductionData(bomData.headers, bomData.lines, stockData.addAdjustment, bomData.steps, kitchenData);
  const deliveryData = useDeliveryData(kitchenData);
  const smStockData = useSmStockData(
    skuData.skus,
    productionData.records,
    deliveryData.deliveries,
    bomData.headers,
    bomData.lines,
    priceData.prices,
    bomData.steps,
    byproductData.byproducts,
    kitchenData,
  );
  const smDailyUsage = useSmDailyUsage(skuData.skus, kitchenData);
  const pkStockData = usePkStockData(skuData.skus, receiptData.receipts, priceData.prices, kitchenData);
  const branchData = useBranchData();

  // Kitchen RM/PK stock reads every receipt itself. Keep it fresh wherever its balance
  // is used: after any receipt is added/edited/deleted (the shared receipts list
  // changes), and on the pages that read it (stock, count, dashboard)
  const onItemStockPage = activeTab === "stock" || activeTab === "pkstock";
  const readsItemStock = onItemStockPage || activeTab === "stockcount" || activeTab === "dashboard";
  useEffect(() => {
    if (!kitchenData) return;
    stockData.reload();
    pkStockData.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receiptData.receipts]);
  useEffect(() => {
    if (!kitchenData || !readsItemStock) return;
    stockData.reload();
    if (activeTab !== "stock") pkStockData.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, kitchenData]);
  useVisibilityRefresh([
    () => (kitchenData && readsItemStock ? Promise.all([stockData.reload(), pkStockData.reload()]).then(() => undefined) : undefined),
    () => (kitchenData ? smStockData.refreshProductionRecords() : undefined),
    () => (kitchenData ? smStockData.refreshToDelivered() : undefined),
    () => (kitchenData ? receiptData.fetchReceipts(receiptData.isFullHistory) : undefined),
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
    pkStockBalances: pkStockData.stockBalances,
    addRmAdjustment: stockData.addAdjustment,
    addSmAdjustment: smStockData.addAdjustment,
    addPkAdjustment: pkStockData.addAdjustment,
    getStdUnitPrice: stockData.getStdUnitPrice,
    refreshSmStock: smStockData.refreshProductionRecords,
    enabled: kitchenData,
  });
  const { skus, addSku, bulkAddSkus, updateSku } = skuData;
  // Bulk import/export by file (Cost Center › ภาพรวม)
  const importSaves = useImportSaves({
    skus,
    prices: priceData.prices,
    suppliers: supplierData.suppliers,
    menus: menuData.menus,
    menuBomLines: menuBomData.lines,
    spLines: spBomData.lines,
    bulkAddSkus,
    bulkEnsureCategories: skuCategoryData.bulkEnsureCategories,
    addSupplier: supplierData.addSupplier,
    addPrice: priceData.addPrice,
    recostPrices: priceData.recostPrices,
    bulkAddMenus: menuData.bulkAddMenus,
    replaceMenuRecipe: menuBomData.replaceShared,
    replaceSpRecipe: spBomData.replaceLines,
  });
  const importCtx = useMemo(
    () => ({
      skus,
      suppliers: supplierData.suppliers,
      prices: priceData.prices,
      menus: menuData.menus,
      menuBomLines: menuBomData.lines,
      spLines: spBomData.lines,
      brands: [...new Set(branchData.branches.map((b) => b.brandName).filter(Boolean))],
    }),
    [skus, supplierData.suppliers, priceData.prices, menuData.menus, menuBomData.lines, spBomData.lines, branchData.branches],
  );
  // Keep the address bar on the canonical /<page> path once the role is known
  useEffect(() => {
    if (!role) return;
    if (pathTab !== activeTab || window.location.search) {
      // The old rules page lands on the rules tab, not Cost Center's first screen
      const hash = pathTab && pathTab in OLD_PAGE_HASH && !window.location.hash ? `#${OLD_PAGE_HASH[pathTab]}` : window.location.hash;
      navigate(`/${activeTab}${hash}`, { replace: true });
    }
  }, [role, pathTab, activeTab, navigate]);

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
      toast.error("ตำแหน่งนี้เปิดหน้านั้นไม่ได้");
      navigate(`/${getDefaultTab(role)}`);
      return;
    }
    navigate(`/${tab}`);
  };

  const activeBranches = useMemo(() => branchData.branches.filter((b) => b.status === "Active"), [branchData.branches]);

  const currentTab = tabLabels[activeTab] || { title: "วันนี้", subtitle: "" };
  // The Excel library is ~900 KB: load it only when someone exports
  const exportAllBoms = async () =>
    (await import("@/lib/bom-export")).exportAllBoms({
      bomHeaders: bomData.headers,
      bomLines: bomData.lines,
      bomSteps: bomData.steps,
      menuBomLines: menuBomData.lines,
      spBomLines: spBomData.lines,
      skus: skuData.skus,
      prices: priceData.prices,
      menus: menuData.menus,
      branches: branchData.branches,
    });

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar activeTab={activeTab} onTabChange={handleTabChange} />
        <div className="flex-1 flex flex-col min-w-0">
          {/* Top header bar */}
          <header className="sticky top-0 z-30 h-14 flex items-center border-b bg-card/95 backdrop-blur px-3 md:px-6 gap-3 md:gap-4 shrink-0 pt-[env(safe-area-inset-top)]">
            <SidebarTrigger />
            <div className="h-5 w-px bg-border" />
            <div className="min-w-0">
              <h1 className="text-base md:text-sm font-semibold text-foreground truncate">{currentTab.title}</h1>
            </div>
            {readOnly && (
              <span className="ml-2 text-helper uppercase tracking-wider bg-muted text-muted-foreground px-2 py-0.5 rounded-full font-medium">
                ดูอย่างเดียว
              </span>
            )}
          </header>

          <main className="flex-1 overflow-auto pb-[calc(64px+env(safe-area-inset-bottom))] md:pb-0">
            {isStoreManager && tabContextMap[activeTab] === "store" && activeTab !== "daily-stock-count" && (
              <CountReminder branchId={profile?.branch_id ?? null} onGo={() => handleTabChange("daily-stock-count")} />
            )}
            <BaseLoadingBar />
            <Suspense fallback={<div className="page-shell"><BasePageSkeleton /></div>}>
            {baseLoad === "first-load" ? (
              <div className="page-shell"><BasePageSkeleton /></div>
            ) : (
              <div className="page-shell">
                {activeTab === "dashboard" ? (
                  <Dashboard skus={skus} prices={priceData.prices} bomLines={bomData.lines} rmStockBalances={stockData.stockBalances} smStockBalances={smStockData.stockBalances} stockReady={stockData.loaded} />
                ) : activeTab === "receipt" ? (
                  <GoodsReceiptPage receiptData={receiptData} skus={skus} suppliers={supplierData.suppliers} prices={priceData.prices} onNavigate={handleTabChange} />
                ) : activeTab === "stock" || activeTab === "smstock" || activeTab === "pkstock" ? (
                  // RM / SM / PK on one page; each tab keeps its old address
                  <KitchenStockPage
                    type={activeTab === "stock" ? "RM" : activeTab === "smstock" ? "SM" : "PK"}
                    onType={(t) => handleTabChange(t === "RM" ? "stock" : t === "SM" ? "smstock" : "pkstock")}
                    skus={skus}
                    suppliers={supplierData.suppliers}
                    categories={skuCategoryData.categories}
                    bomHeaders={bomData.headers}
                    bomLines={bomData.lines}
                    rm={stockData}
                    pk={pkStockData}
                    sm={smStockData}
                    smDailyUsage={smDailyUsage}
                    canEdit={!readOnly}
                  />
                ) : activeTab === "production" ? (
                  <ProductionPage
                    productionData={productionData}
                    skus={skus}
                    bomHeaders={bomData.headers}
                    bomLines={bomData.lines}
                    bomSteps={bomData.steps}
                    smStockBalances={smStockData.stockBalances}
                    isStockDataReady={smStockData.isStockDataReady}
                    smDailyUsage={smDailyUsage}
                    refreshProductionRecords={smStockData.refreshProductionRecords}
                    byproducts={byproductData.byproducts}
                    onNavigate={handleTabChange}
                  />
                ) : activeTab === "stockcount" ? (
                  <StockCountPage
                    skus={skus}
                    stockCountData={stockCountData}
                    getStdUnitPrice={stockData.getStdUnitPrice}
                    bomHeaders={bomData.headers}
                    bomLines={bomData.lines}
                    canEdit={isManagement || role === 'ck_manager'}
                  />
                ) : activeTab === "branches" || activeTab === "users" || activeTab === "sku-categories" ? (
                  <SettingsPage
                    tab={activeTab}
                    onNavigate={handleTabChange}
                    canOpen={(t) => canAccessTab(role, t)}
                    canEdit={!readOnly}
                    branchData={branchData}
                    categoryData={skuCategoryData}
                    skus={skus}
                  />
                ) : activeTab === "store" ? (
                  <StoreOverview
                    branches={isAreaManager ? areaManagerBranches : branchData.branches}
                    onNavigate={handleTabChange}
                    // Area managers look; the kitchen role can't open branch pages
                    readOnly={isAreaManager || role === "ck_manager"}
                  />
                ) : activeTab === "cost-center" ? (
                  <CostCenterPage
                    menuSetup={{
                      menus: menuData.menus,
                      updateMenu: menuData.updateMenu,
                      menuBom: menuBomData,
                      rules: modifierRuleData.rules,
                      skus,
                      prices: priceData.prices,
                      branches: branchData.branches,
                      readOnly: !isManagement,
                      onNavigate: handleTabChange,
                      addRule: modifierRuleData.addRule,
                      addMenu: menuData.addMenu,
                      getNextCode: menuData.getNextCode,
                      spBomLines: spBomData.lines,
                      updateRule: modifierRuleData.updateRule,
                      deleteRule: modifierRuleData.deleteRule,
                    }}
                    skus={skus}
                    prices={priceData.prices}
                    suppliers={supplierData.suppliers}
                    menus={menuData.menus}
                    categories={skuCategoryData.categories}
                    bomHeaders={bomData.headers}
                    bomLines={bomData.lines}
                    bomSteps={bomData.steps}
                    byproducts={byproductData.byproducts}
                    spLines={spBomData.lines}
                    recipeActions={{
                      addHeader: bomData.addHeader,
                      updateHeader: bomData.updateHeader,
                      addLine: bomData.addLine,
                      updateLine: bomData.updateLine,
                      deleteLine: bomData.deleteLine,
                      spAddLine: spBomData.addLine,
                      spUpdateLine: spBomData.updateLine,
                      spUpdateBatchYield: spBomData.updateBatchYield,
                      spDeleteLine: spBomData.deleteLine,
                      deleteHeader: async (id) => {
                        const ok = await bomData.deleteHeader(id);
                        // Its by-products went with it in the database
                        if (ok) byproductData.forgetHeader(id);
                        return ok;
                      },
                      addStep: bomData.addStep,
                      updateStep: bomData.updateStep,
                      deleteStep: bomData.deleteStep,
                      addByproduct: byproductData.addByproduct,
                      updateByproduct: byproductData.updateByproduct,
                      deleteByproduct: byproductData.deleteByproduct,
                    }}
                    menuLines={menuBomData.lines.map((l) => ({ menuId: l.menuId, skuId: l.skuId }))}
                    canEditProducts={isManagement || role === "ck_manager"}
                    addSku={addSku}
                    productActions={{
                      updateSku,
                      addPrice: priceData.addPrice,
                      updatePrice: priceData.updatePrice,
                      repriceUnits: priceData.repriceUnits,
                      recost: priceData.recostPrices,
                      reloadData: async () => {
                        await Promise.all([skuData.reload(), bomData.reload(), spBomData.reload(), priceData.refreshPrices()]);
                      },
                    }}
                    addSupplier={supplierData.addSupplier}
                    updateSupplier={supplierData.updateSupplier}
                    onNavigate={handleTabChange}
                    canOpen={(t) => canAccessTab(role, t)}
                    onExportAll={isManagement ? exportAllBoms : undefined}
                    files={{ ctx: importCtx, saves: importSaves, canEditMenus: isManagement }}
                  />
                ) : activeTab === "menu-setup" ? (
                  <MenuSetupPage
                    menus={menuData.menus}
                    updateMenu={menuData.updateMenu}
                    menuBom={menuBomData}
                    rules={modifierRuleData.rules}
                    skus={skus}
                    prices={priceData.prices}
                    branches={branchData.branches}
                    readOnly={!isManagement}
                    onNavigate={handleTabChange}
                    addRule={modifierRuleData.addRule}
                    addMenu={menuData.addMenu}
                    getNextCode={menuData.getNextCode}
                    spBomLines={spBomData.lines}
                    updateRule={modifierRuleData.updateRule}
                    deleteRule={modifierRuleData.deleteRule}
                  />
                ) : activeTab === "sales-entry" ? (
                  <SalesEntryPage
                    branches={isAreaManager ? areaManagerBranches : branchData.branches}
                    menus={menuData.menus}
                    modifierRules={modifierRuleData.rules}
                    onNavigate={handleTabChange}
                  />
                ) : activeTab === "branch-receipt" || activeTab === "branch-receipt-mobile" ? (
                  <ReceivePage
                    skus={skus}
                    prices={priceData.prices}
                    branches={isAreaManager ? areaManagerBranches : branchData.branches}
                    suppliers={supplierData.suppliers}
                    menus={menuData.menus}
                    menuBomLines={menuBomData.lines}
                    getBomCostPerGram={smStockData.getBomCostPerGram}
                    onNavigate={handleTabChange}
                  />
                ) : activeTab === "transfer-request" ? (
                  <TransferRequestPage branches={isAreaManager ? areaManagerBranches : branchData.branches} />
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
                    onNavigate={handleTabChange}
                  />
                ) : activeTab === "store-stock" ? (
                  <StoreStockPage skus={skus} branches={isAreaManager ? areaManagerBranches : branchData.branches} readOnly={isAreaManager} />
                ) : activeTab === "food-cost" ? (
                  <FoodCostPage
                    skus={skus}
                    prices={priceData.prices}
                    menus={menuData.menus}
                    menuBomLines={menuBomData.lines}
                    modifierRules={modifierRuleData.rules}
                    spBomLines={spBomData.lines}
                    branches={isAreaManager ? areaManagerBranches : branchData.branches}
                  />
                ) : null}
              </div>
            )}
            </Suspense>
          </main>
          <MobileNav role={role} activeTab={activeTab} onTabChange={handleTabChange} />
        </div>
      </div>

      {(isManagement || role === "ck_manager") && (
        <Suspense fallback={null}>
          {/* Mounted only while open, so their code loads on first use */}


        </Suspense>
      )}
    </SidebarProvider>
  );
};

export default Index;
