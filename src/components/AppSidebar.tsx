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
} from '@/components/ui/sidebar';
import {
  ChefHat, LayoutDashboard, Package, Users, DollarSign,
  FlaskConical, ClipboardList, Warehouse, Factory, BoxesIcon,
  Truck, Store, ClipboardCheck, Settings, LogOut, UtensilsCrossed, BookOpen, Sparkles, ListFilter, ShoppingCart, PieChart, Heart,
} from 'lucide-react';
import { useAuth, AppRole } from '@/hooks/use-auth';
import { useLanguage } from '@/hooks/use-language';
import { Button } from '@/components/ui/button';

export type TabKey = 'dashboard' | 'sku' | 'supplier' | 'price' | 'bom' | 'receipt' | 'stock' | 'production' | 'smstock' | 'stockcount' | 'delivery' | 'branches' | 'users' | 'store' | 'menu-master' | 'menu-bom' | 'sp-bom' | 'modifier-rules' | 'sales-entry' | 'branch-receipt' | 'daily-stock-count' | 'food-cost' | 'sku-categories';

export type TabContext = 'ck' | 'store' | 'management' | 'overview';

export const tabContextMap: Record<TabKey, TabContext> = {
  dashboard: 'overview',
  sku: 'ck',
  supplier: 'ck',
  price: 'ck',
  bom: 'ck',
  receipt: 'ck',
  stock: 'ck',
  production: 'ck',
  smstock: 'ck',
  stockcount: 'ck',
  delivery: 'ck',
  branches: 'management',
  users: 'management',
  store: 'store',
  'menu-master': 'store',
  'menu-bom': 'store',
  'sp-bom': 'store',
  'modifier-rules': 'store',
  'sales-entry': 'store',
  'branch-receipt': 'store',
  'daily-stock-count': 'store',
  'food-cost': 'store',
  'sku-categories': 'management',
};

interface AppSidebarProps {
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
}

interface NavGroup {
  label: string;
  labelKey: string;
  icon?: React.ElementType;
  section: 'ck' | 'store' | 'management' | 'overview';
  items: { key: TabKey; labelKey: string; icon: React.ElementType }[];
}

const overviewGroup: NavGroup = {
  label: 'OVERVIEW',
  section: 'overview',
  items: [
    { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  ],
};

const masterDataGroup: NavGroup = {
  label: 'MASTER DATA',
  section: 'ck',
  items: [
    { key: 'sku', label: 'SKU Master', icon: Package },
    { key: 'supplier', label: 'Suppliers', icon: Users },
    { key: 'price', label: 'Prices', icon: DollarSign },
  ],
};

const ckGroup: NavGroup = {
  label: 'CENTRAL KITCHEN',
  icon: ChefHat,
  section: 'ck',
  items: [
    { key: 'bom', label: 'BOM', icon: FlaskConical },
    { key: 'receipt', label: 'Goods Receipt', icon: ClipboardList },
    { key: 'production', label: 'Production', icon: Factory },
    { key: 'delivery', label: 'Delivery', icon: Truck },
    { key: 'stock', label: 'RM Stock', icon: Warehouse },
    { key: 'smstock', label: 'SM Stock', icon: BoxesIcon },
    { key: 'stockcount', label: 'Stock Count', icon: ClipboardCheck },
  ],
};

const storeGroup: NavGroup = {
  label: 'STORE',
  icon: Store,
  section: 'store',
  items: [
    { key: 'store', label: 'Store Overview', icon: Store },
    { key: 'menu-master', label: 'Menu Master', icon: UtensilsCrossed },
    { key: 'menu-bom', label: 'Menu BOM', icon: BookOpen },
    { key: 'sp-bom', label: 'SP BOM', icon: Sparkles },
    { key: 'modifier-rules', label: 'Modifier Rules', icon: ListFilter },
    { key: 'sales-entry', label: 'Sales Entry', icon: ShoppingCart },
    { key: 'branch-receipt', label: 'Branch Receipt', icon: ClipboardList },
    { key: 'daily-stock-count', label: 'Daily Stock Count', icon: ClipboardCheck },
    { key: 'food-cost', label: 'Food Cost', icon: PieChart },
  ],
};

const managementGroup: NavGroup = {
  label: 'MANAGEMENT',
  section: 'management',
  items: [
    { key: 'branches', label: 'Branches', icon: Store },
    { key: 'users', label: 'User Management', icon: Settings },
    { key: 'sku-categories', label: 'SKU Categories', icon: Package },
  ],
};

const roleLabels: Record<string, string> = {
  management: 'Management',
  ck_manager: 'CK Manager',
  store_manager: 'Store Manager',
  area_manager: 'Area Manager',
};

export function getDefaultTab(role: AppRole | null): TabKey {
  switch (role) {
    case 'store_manager': return 'daily-stock-count';
    case 'ck_manager': return 'receipt';
    case 'area_manager': return 'food-cost';
    case 'management':
    default:
      return 'dashboard';
  }
}

export function AppSidebar({ activeTab, onTabChange }: AppSidebarProps) {
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';
  const { profile, role, isManagement, signOut } = useAuth();

  // Build groups based on role
  const allGroups: NavGroup[] = [];

  if (isManagement) {
    allGroups.push(overviewGroup, masterDataGroup, ckGroup, storeGroup, managementGroup);
  } else if (role === 'ck_manager') {
    // CK Manager: ONLY CK sections (no Store, no Management)
    allGroups.push(overviewGroup, masterDataGroup, ckGroup);
  } else if (role === 'store_manager' || role === 'area_manager') {
    // Store Manager / Area Manager: ONLY Store section
    allGroups.push(storeGroup);
  }

  const initials = (profile?.full_name || 'U')
    .split(' ')
    .map(w => w[0])
    .join('')
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
            <div className="min-w-0">
              <p className="text-sm font-bold leading-tight truncate text-foreground">CK Manager</p>
              <p className="text-[10px] leading-tight text-sidebar-muted">by Live to Eat</p>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent className="px-2 py-2">
        {allGroups.map((group, groupIdx) => {
          const prevGroup = groupIdx > 0 ? allGroups[groupIdx - 1] : null;
          const showDivider = prevGroup &&
            ((prevGroup.section === 'ck' && group.section === 'store') ||
             (prevGroup.section === 'store' && group.section === 'management') ||
             (prevGroup.section === 'ck' && group.section === 'management'));

          return (
            <div key={group.label}>
              {showDivider && (
                <div className="my-2 mx-3 border-t-2 border-sidebar-border" />
              )}
              <SidebarGroup className="py-1">
                <SidebarGroupLabel className="text-[10px] uppercase tracking-[0.08em] text-sidebar-section font-semibold px-3 mb-1 flex items-center gap-1.5">
                  {group.icon && !collapsed && (
                    <group.icon className="w-3 h-3" />
                  )}
                  {group.label}
                </SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {group.items.map(item => {
                      const isActive = activeTab === item.key;
                      return (
                        <SidebarMenuItem key={item.key}>
                          <SidebarMenuButton
                            isActive={isActive}
                            onClick={() => onTabChange(item.key)}
                            tooltip={item.label}
                            className={`cursor-pointer rounded-md transition-all duration-150 ${
                              isActive
                                ? 'bg-accent text-accent-foreground font-semibold border-l-2 border-primary'
                                : 'text-sidebar-foreground hover:bg-accent/50 hover:text-accent-foreground'
                            }`}
                          >
                            <item.icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-primary' : ''}`} />
                            <span className="text-[13px]">{item.label}</span>
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
                <p className="text-xs font-semibold truncate text-foreground">{profile?.full_name || 'User'}</p>
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-primary/10 text-primary">
                  {roleLabels[role || ''] || 'User'}
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
            <p className="text-[10px] text-sidebar-section text-center flex items-center justify-center gap-1">
              Made with <Heart className="w-3 h-3 text-primary fill-primary" /> for Live to Eat
            </p>
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
