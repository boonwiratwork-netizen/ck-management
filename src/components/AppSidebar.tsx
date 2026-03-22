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
  Package,
  Users,
  DollarSign,
  FlaskConical,
  ClipboardList,
  Warehouse,
  Factory,
  BoxesIcon,
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
  Heart,
  ArrowUpFromLine,
  ArrowRightLeft,
  LayoutGrid,
} from "lucide-react";
import { useAuth, AppRole } from "@/hooks/use-auth";
import { useLanguage } from "@/hooks/use-language";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useState, useEffect } from "react";

export type TabKey =
  | "dashboard"
  | "sku"
  | "supplier"
  | "price"
  | "bom"
  | "receipt"
  | "stock"
  | "production"
  | "smstock"
  | "stockcount"
  | "delivery"
  | "transfer-order"
  | "branches"
  | "users"
  | "store"
  | "menu-master"
  | "menu-bom"
  | "sp-bom"
  | "modifier-rules"
  | "sales-entry"
  | "branch-receipt"
  | "transfer-request"
  | "daily-stock-count"
  | "store-stock"
  | "food-cost"
  | "sku-categories";

export type TabContext = "ck" | "store" | "management" | "overview";

export const tabContextMap: Record<TabKey, TabContext> = {
  dashboard: "ck",
  sku: "ck",
  supplier: "ck",
  price: "ck",
  bom: "ck",
  receipt: "ck",
  stock: "ck",
  production: "ck",
  smstock: "ck",
  stockcount: "ck",
  delivery: "ck",
  "transfer-order": "ck",
  branches: "management",
  users: "management",
  store: "store",
  "menu-master": "store",
  "menu-bom": "store",
  "sp-bom": "store",
  "modifier-rules": "store",
  "sales-entry": "store",
  "transfer-request": "store",
  "branch-receipt": "store",
  "daily-stock-count": "store",
  "store-stock": "store",
  "food-cost": "store",
  "sku-categories": "management",
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

const masterDataGroup: NavGroup = {
  label: "MASTER DATA",
  labelKey: "nav.masterData",
  section: "ck",
  items: [
    { key: "sku", labelKey: "nav.skuMaster", icon: Package },
    { key: "supplier", labelKey: "nav.suppliers", icon: Users },
    { key: "price", labelKey: "nav.prices", icon: DollarSign },
  ],
};

const ckGroup: NavGroup = {
  label: "CENTRAL KITCHEN",
  labelKey: "nav.centralKitchen",
  icon: ChefHat,
  section: "ck",
  items: [
    { subLabel: "Daily" },
    { key: "receipt", labelKey: "nav.goodsReceipt", icon: ClipboardList },
    { key: "production", labelKey: "nav.production", icon: Factory },
    { key: "transfer-order", labelKey: "nav.transferOrder", icon: ArrowRightLeft },
    { key: "stockcount", labelKey: "nav.stockCount", icon: ClipboardCheck },
    { subLabel: "Monitor" },
    { key: "dashboard", labelKey: "nav.dashboard", icon: LayoutDashboard },
    { key: "stock", labelKey: "nav.rmStock", icon: Warehouse },
    { key: "smstock", labelKey: "nav.smStock", icon: BoxesIcon },
    { subLabel: "Config" },
    { key: "bom", labelKey: "nav.bom", icon: FlaskConical },
  ],
};

const storeGroup: NavGroup = {
  label: "STORE",
  labelKey: "nav.store",
  icon: Store,
  section: "store",
  items: [
    { subLabel: "Daily" },
    { key: "sales-entry", labelKey: "nav.salesEntry", icon: ShoppingCart },
    { key: "branch-receipt", labelKey: "nav.branchReceipt", icon: ClipboardList },
    { key: "transfer-request", labelKey: "nav.transferRequest", icon: ArrowUpFromLine },
    { key: "daily-stock-count", labelKey: "nav.dailyStockCount", icon: ClipboardCheck },
    { subLabel: "Monitor" },
    { key: "store", labelKey: "nav.storeOverview", icon: Store },
    { key: "store-stock", labelKey: "nav.storeStock", icon: LayoutGrid },
    { key: "food-cost", labelKey: "nav.foodCost", icon: PieChart },
    { subLabel: "Setup" },
    { key: "menu-master", labelKey: "nav.menuMaster", icon: UtensilsCrossed },
    { key: "menu-bom", labelKey: "nav.menuBom", icon: BookOpen },
    { key: "sp-bom", labelKey: "nav.spBom", icon: Sparkles },
    { key: "modifier-rules", labelKey: "nav.modifierRules", icon: ListFilter },
  ],
};

const managementGroup: NavGroup = {
  label: "SETUP",
  labelKey: "nav.management",
  section: "management",
  items: [
    { key: "sku", labelKey: "nav.skuMaster", icon: Package },
    { key: "supplier", labelKey: "nav.suppliers", icon: Users },
    { key: "price", labelKey: "nav.prices", icon: DollarSign },
    { key: "branches", labelKey: "nav.branches", icon: Store },
    { key: "users", labelKey: "nav.userManagement", icon: Settings },
    { key: "sku-categories", labelKey: "nav.skuCategories", icon: Package },
  ],
};

const roleLabels: Record<string, string> = {
  management: "Management",
  ck_manager: "CK Manager",
  store_manager: "Store Manager",
  area_manager: "Area Manager",
};

export function getDefaultTab(role: AppRole | null): TabKey {
  switch (role) {
    case "store_manager":
      return "daily-stock-count";
    case "ck_manager":
      return "receipt";
    case "area_manager":
      return "food-cost";
    case "management":
    default:
      return "dashboard";
  }
}

export function AppSidebar({ activeTab, onTabChange }: AppSidebarProps) {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { profile, role, isManagement, signOut, isCkManager } = useAuth();
  const { lang, toggleLang, t } = useLanguage();
  const [pendingTRCount, setPendingTRCount] = useState(0);

  // Fetch pending TR count for badge (only 'Submitted' status)
  useEffect(() => {
    if (!isManagement && !isCkManager) return;
    const fetchCount = () => {
      supabase
        .from("transfer_requests")
        .select("id", { count: "exact", head: true })
        .eq("status", "Submitted")
        .then(({ count }) => setPendingTRCount(count || 0));
    };
    fetchCount();
    const interval = setInterval(fetchCount, 30000); // 30s for faster clearing
    // Listen for realtime changes on transfer_requests to refresh badge immediately
    const channel = supabase
      .channel("tr-badge-updates")
      .on("postgres_changes", { event: "*", schema: "public", table: "transfer_requests" }, () => {
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
    allGroups.push(ckGroup, storeGroup, managementGroup);
  } else if (role === "ck_manager") {
    // CK Manager: ONLY CK sections (no Store, no Management)
    allGroups.push(ckGroup);
  } else if (role === "store_manager" || role === "area_manager") {
    // Store Manager / Area Manager: ONLY Store section
    allGroups.push(storeGroup);
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
          <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center shrink-0 shadow-sm">
            <ChefHat className="w-5 h-5 text-primary-foreground" />
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold leading-tight truncate text-foreground">Live to Eat App</p>
                  <p className="text-helper leading-tight text-muted-foreground">CK & Store Management</p>
                </div>
                <button
                  onClick={toggleLang}
                  className="flex items-center gap-0.5 rounded-full border border-sidebar-border bg-sidebar px-1.5 py-0.5 text-helper font-medium shrink-0 hover:bg-accent transition-colors"
                >
                  <span className={lang === "th" ? "font-bold text-primary" : "text-muted-foreground"}>TH</span>
                  <span className="text-muted-foreground">/</span>
                  <span className={lang === "en" ? "font-bold text-primary" : "text-muted-foreground"}>EN</span>
                </button>
              </div>
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
            <div key={group.labelKey}>
              {showDivider && <div className="my-2 mx-3 border-t-2 border-sidebar-border" />}
              <SidebarGroup className="py-1">
                <SidebarGroupLabel className="text-xs font-bold uppercase tracking-widest text-foreground px-3 mb-1 flex items-center gap-1.5">
                  {group.icon && !collapsed && <group.icon className="w-3 h-3" />}
                  {t(group.labelKey)}
                </SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {group.items.map((item, itemIdx) => {
                      if (isSubLabel(item)) {
                        if (collapsed) return null;
                        return (
                          <li key={`sub-${item.subLabel}-${itemIdx}`} className="px-3 pt-2 pb-0.5">
                            <span className="text-helper uppercase tracking-wider text-muted-foreground font-semibold text-[10px]">
                              {item.subLabel}
                            </span>
                          </li>
                        );
                      }
                      const isActive = activeTab === item.key;
                      const label = t(item.labelKey);
                      return (
                        <SidebarMenuItem key={item.key}>
                          <SidebarMenuButton
                            isActive={isActive}
                            onClick={() => onTabChange(item.key)}
                            tooltip={label}
                            className={`cursor-pointer rounded-md transition-all duration-150 ${
                              isActive
                                ? "bg-accent text-accent-foreground font-semibold border-l-2 border-primary"
                                : "text-sidebar-foreground hover:bg-accent/50 hover:text-accent-foreground"
                            }`}
                          >
                            <item.icon
                              className={`w-4 h-4 shrink-0 ${isActive ? "!text-primary opacity-100" : "opacity-70"}`}
                            />
                            <span className="text-sm">{label}</span>
                            {item.key === "transfer-order" &&
                              pendingTRCount > 0 &&
                              (isManagement || isCkManager) &&
                              !collapsed && (
                                <span className="bg-primary text-primary-foreground text-xs rounded-full px-1.5 py-0.5 min-w-[20px] text-center font-medium ml-auto">
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
              <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                {initials}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold truncate text-foreground">{profile?.full_name || "User"}</p>
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-helper font-medium bg-primary/10 text-primary">
                  {roleLabels[role || ""] || "User"}
                </span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0 h-8 w-8 text-sidebar-foreground hover:text-destructive"
                onClick={signOut}
                title="Sign out"
              >
                <LogOut className="w-4 h-4" />
              </Button>
            </div>
            <p className="text-helper text-muted-foreground text-center flex items-center justify-center gap-1">
              Made with <Heart className="w-3 h-3 text-primary fill-primary" /> for Live to Eat
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <button
              onClick={toggleLang}
              className="w-8 h-8 mx-auto rounded-full border border-sidebar-border flex items-center justify-center text-helper font-bold text-primary hover:bg-accent transition-colors"
            >
              {lang === "th" ? "TH" : "EN"}
            </button>
            <div className="w-8 h-8 mx-auto rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">
              {initials}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="w-full text-sidebar-foreground hover:text-destructive"
              onClick={signOut}
              title="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
