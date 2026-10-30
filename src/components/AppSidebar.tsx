import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  ChefHat,
  LayoutDashboard,
  Users,
  DollarSign,
  FlaskConical,
  ClipboardList,
  Warehouse,
  Factory,
  Store,
  ClipboardCheck,
  Settings,
  LogOut,
  UtensilsCrossed,
  BookOpen,
  Sparkles,
  ListFilter,
  ShoppingCart,
  PieChart,
  CalendarCheck,
  ArrowUpFromLine,
  ArrowRightLeft,
  LayoutGrid,
  ScanLine,
  Layers,
} from "lucide-react";
import { useAuth, AppRole } from "@/hooks/use-auth";
import { useLanguage } from "@/hooks/use-language";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { fetchPendingTrCount } from "@/lib/pending-trs";
import { useState, useEffect } from "react";

export type TabKey =
  | "dashboard"
  | "sku"
  | "supplier"
  | "price"
  | "receipt"
  | "stock"
  | "production"
  | "smstock"
  | "stockcount"
  | "transfer-order"
  | "branches"
  | "users"
  | "store"
  | "menu-setup"
  | "cost-center"
  | "menu-master"
  | "menu-bom"
  | "sp-bom"
  | "modifier-rules"
  | "sales-entry"
  | "branch-receipt"
  | "branch-receipt-mobile"
  | "transfer-request"
  | "daily-stock-count"
  | "store-stock"
  | "food-cost"
  | "sku-categories"
  | "pkstock";

export type TabContext = "ck" | "store" | "management" | "overview";

export const tabContextMap: Record<TabKey, TabContext> = {
  dashboard: "ck",
  sku: "ck",
  supplier: "ck",
  price: "ck",
  receipt: "ck",
  stock: "ck",
  production: "ck",
  smstock: "ck",
  stockcount: "ck",
  "transfer-order": "ck",
  branches: "management",
  users: "management",
  store: "store",
  "menu-setup": "store",
  // Opened by every role (each sees what it may edit); not a kitchen page, so it
  // never waits for the kitchen stock data
  "cost-center": "management",
  "menu-master": "store",
  "menu-bom": "store",
  "sp-bom": "store",
  "modifier-rules": "store",
  "sales-entry": "store",
  "transfer-request": "store",
  "branch-receipt": "store",
  "branch-receipt-mobile": "store",
  "daily-stock-count": "store",
  "store-stock": "store",
  "food-cost": "store",
  "sku-categories": "management",
  pkstock: "ck",
};

interface AppSidebarProps {
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
}

interface SubLabel {
  subLabel: string;
}
interface NavItem {
  key: TabKey;
  labelKey: string;
  icon: React.ElementType;
}
type NavGroupEntry = NavItem | SubLabel;

function isSubLabel(entry: NavGroupEntry): entry is SubLabel {
  return "subLabel" in entry;
}

interface NavGroup {
  label: string;
  labelKey: string;
  icon?: React.ElementType;
  section: "ck" | "store" | "management" | "overview";
  items: NavGroupEntry[];
}

// Everyone starts on the today page (the kitchen card + their branches)
const todayGroup: NavGroup = {
  label: "",
  labelKey: "",
  section: "overview",
  items: [{ key: "store", labelKey: "nav.storeOverview", icon: CalendarCheck }],
};

// Daily jobs first, then the pages for looking back ("ดูภาพรวม")
const ckGroup: NavGroup = {
  label: "ครัวกลาง",
  labelKey: "nav.centralKitchen",
  icon: ChefHat,
  section: "ck",
  items: [
    { key: "receipt", labelKey: "nav.goodsReceipt", icon: ClipboardList },
    { key: "production", labelKey: "nav.production", icon: Factory },
    { key: "transfer-order", labelKey: "nav.transferOrder", icon: ArrowRightLeft },
    { key: "stockcount", labelKey: "nav.stockCount", icon: ClipboardCheck },
    { subLabel: "ดูภาพรวม" },
    // RM / SM / PK are tabs of one page now (their addresses still work)
    { key: "stock", labelKey: "nav.kitchenStock", icon: Warehouse },
    { key: "dashboard", labelKey: "nav.dashboard", icon: LayoutDashboard },
  ],
};

const storeGroup: NavGroup = {
  label: "สาขา",
  labelKey: "nav.store",
  icon: Store,
  section: "store",
  items: [
    { key: "sales-entry", labelKey: "nav.salesEntry", icon: ShoppingCart },
    { key: "branch-receipt", labelKey: "nav.branchReceipt", icon: ClipboardList },
    { key: "transfer-request", labelKey: "nav.transferRequest", icon: ArrowUpFromLine },
    { key: "daily-stock-count", labelKey: "nav.dailyStockCount", icon: ClipboardCheck },
    { subLabel: "ดูภาพรวม" },
    { key: "store-stock", labelKey: "nav.storeStock", icon: LayoutGrid },
    { key: "food-cost", labelKey: "nav.foodCost", icon: PieChart },
  ],
};

// Products, prices, suppliers, recipes and menus all live in Cost Center
const setupGroup = (withAdmin: boolean): NavGroup => ({
  label: "ตั้งค่า",
  labelKey: "nav.setup",
  section: "management",
  items: [
    { key: "cost-center", labelKey: "nav.costCenter", icon: Layers },
    // Branches · users · categories, as tabs of one page
    ...(withAdmin ? [{ key: "branches" as TabKey, labelKey: "nav.settings", icon: Settings }] : []),
  ],
});

const roleLabels: Record<string, string> = {
  management: "ผู้บริหาร",
  ck_manager: "ครัวกลาง",
  store_manager: "หัวหน้าสาขา",
  area_manager: "Area",
};

/** The 4 daily jobs per role shown in the phone bottom bar (everything else: "เมนู") */
export function bottomNavFor(role: AppRole | null): { key: TabKey; label: string; icon: React.ElementType }[] {
  const today = { key: "store" as TabKey, label: "วันนี้", icon: CalendarCheck };
  switch (role) {
    case "store_manager":
      return [
        today,
        { key: "branch-receipt", label: "รับของ", icon: ScanLine },
        { key: "daily-stock-count", label: "นับสต๊อก", icon: ClipboardCheck },
        { key: "transfer-request", label: "ขอเบิก", icon: ArrowUpFromLine },
      ];
    case "area_manager":
      return [
        today,
        { key: "food-cost", label: "ต้นทุน", icon: PieChart },
        { key: "store-stock", label: "สต๊อก", icon: LayoutGrid },
        { key: "daily-stock-count", label: "นับสต๊อก", icon: ClipboardCheck },
      ];
    // The kitchen is run from management accounts (there are no CK manager users)
    case "ck_manager":
    case "management":
    default:
      return [
        today,
        { key: "receipt", label: "รับของ", icon: ClipboardList },
        { key: "production", label: "ผลิต", icon: Factory },
        { key: "transfer-order", label: "ใบโอน", icon: ArrowRightLeft },
      ];
  }
}

export function getDefaultTab(role: AppRole | null): TabKey {
  // The today page for everyone: each role sees its own part
  return role ? "store" : "dashboard";
}

export function AppSidebar({ activeTab, onTabChange }: AppSidebarProps) {
  const { state, setOpenMobile } = useSidebar();
  const collapsed = state === "collapsed";
  const { profile, role, isManagement, signOut, isCkManager } = useAuth();
  const { t } = useLanguage();
  const [pendingTRCount, setPendingTRCount] = useState(0);

  // Pending-request badge: same count as the today page (lib/pending-trs.ts)
  useEffect(() => {
    if (!isManagement && !isCkManager) return;
    const fetchCount = () => fetchPendingTrCount().then(setPendingTRCount);
    fetchCount();
    const interval = setInterval(fetchCount, 30000); // 30s for faster clearing
    // Refresh immediately on changes to EITHER table — a TR submit/cancel, or a TO
    // send/cancel — both can change the derived count.
    const channel = supabase
      .channel("tr-badge-updates")
      .on("postgres_changes", { event: "*", schema: "public", table: "transfer_requests" }, () => {
        fetchCount();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "transfer_orders" }, () => {
        fetchCount();
      })
      .subscribe();
    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [isManagement, isCkManager]);

  // Build groups based on role
  const allGroups: NavGroup[] = [];

  if (isManagement) {
    allGroups.push(todayGroup, ckGroup, storeGroup, setupGroup(true));
  } else if (role === "ck_manager") {
    allGroups.push(todayGroup, ckGroup, setupGroup(false));
  } else if (role === "store_manager" || role === "area_manager") {
    allGroups.push(todayGroup, storeGroup, setupGroup(false));
  }

  const initials = (profile?.full_name || "U")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 shadow-sm bg-[#ff5e29]">
            <ChefHat className="w-5 h-5" style={{ color: "#ffffff" }} />
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold leading-tight truncate text-foreground">Live to Eat</p>
              <p className="text-helper leading-tight text-muted-foreground">ครัวกลางและสาขา</p>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent className="px-2 py-2">
        {allGroups.map((group, groupIdx) => {
          const prevGroup = groupIdx > 0 ? allGroups[groupIdx - 1] : null;
          const showDivider =
            prevGroup &&
            ((prevGroup.section === "ck" && group.section === "store") ||
              (prevGroup.section === "store" && group.section === "management") ||
              (prevGroup.section === "ck" && group.section === "management"));

          return (
            <div key={group.labelKey || "today"}>
              {showDivider && <div className="my-2 mx-3 border-t-2 border-sidebar-border" />}
              <SidebarGroup className="py-1">
                {group.label && (
                  <SidebarGroupLabel className="text-xs font-bold tracking-wide text-foreground px-3 mb-1 flex items-center gap-1.5">
                    {group.icon && !collapsed && <group.icon className="w-3 h-3" />}
                    {group.label}
                  </SidebarGroupLabel>
                )}
                <SidebarGroupContent>
                  <SidebarMenu>
                    {group.items.map((item, itemIdx) => {
                      if (isSubLabel(item)) {
                        if (collapsed) return null;
                        return (
                          <li key={`sub-${item.subLabel}-${itemIdx}`} className="px-3 pt-2 pb-0.5 text-helper text-muted-foreground">
                            {item.subLabel}
                          </li>
                        );
                      }
                      const isActive =
                        activeTab === item.key ||
                        (item.key === "stock" && (activeTab === "smstock" || activeTab === "pkstock")) ||
                        (item.key === "branches" && (activeTab === "users" || activeTab === "sku-categories"));
                      const label = t(item.labelKey);
                      return (
                        <SidebarMenuItem key={item.key}>
                          <SidebarMenuButton
                            isActive={isActive}
                            onClick={() => {
                              onTabChange(item.key);
                              setOpenMobile(false);
                            }}
                            tooltip={label}
                            className={`cursor-pointer rounded-xl transition-all duration-150 ${
                              isActive
                                ? "!bg-primary !text-primary-foreground font-semibold border-l-4 border-brand shadow-raised [&>svg]:opacity-100"
                                : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground [&>svg]:opacity-90"
                            }`}
                          >
                            <item.icon className="w-4 h-4 shrink-0" />
                            <span className="text-sm">{label}</span>
                            {item.key === "transfer-order" &&
                              pendingTRCount > 0 &&
                              (isManagement || isCkManager) &&
                              !collapsed && (
                                <span className="bg-brand text-brand-foreground text-xs rounded-full px-1.5 py-0.5 min-w-[20px] text-center font-medium ml-auto">
                                  {pendingTRCount}
                                </span>
                              )}
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      );
                    })}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </div>
          );
        })}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-3">
        {!collapsed ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 text-primary bg-warning">
                {initials}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold truncate text-foreground">{profile?.full_name || "User"}</p>
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-helper font-medium text-primary bg-orange-200">
                  {roleLabels[role || ""] || "User"}
                </span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0 h-8 w-8 text-sidebar-foreground hover:text-destructive"
                onClick={signOut}
                title="ออกจากระบบ"
              >
                <LogOut className="w-4 h-4" />
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="w-8 h-8 mx-auto rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">
              {initials}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="w-full text-sidebar-foreground hover:text-destructive"
              onClick={signOut}
              title="ออกจากระบบ"
            >
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
