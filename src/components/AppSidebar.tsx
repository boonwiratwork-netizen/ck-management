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
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';

export type TabKey = 'dashboard' | 'sku' | 'supplier' | 'price' | 'bom' | 'receipt' | 'stock' | 'production' | 'smstock' | 'stockcount' | 'delivery' | 'branches' | 'users' | 'store' | 'menu-master' | 'menu-bom' | 'sp-bom' | 'modifier-rules' | 'sales-entry' | 'branch-receipt' | 'daily-stock-count' | 'food-cost';

interface AppSidebarProps {
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
}

const ckGroups = [
  {
    label: 'OVERVIEW',
    items: [
      { key: 'dashboard' as TabKey, label: 'Dashboard', icon: LayoutDashboard },
    ],
  },
  {
    label: 'MASTER DATA',
    items: [
      { key: 'sku' as TabKey, label: 'SKU Master', icon: Package },
      { key: 'supplier' as TabKey, label: 'Suppliers', icon: Users },
      { key: 'price' as TabKey, label: 'Prices', icon: DollarSign },
    ],
  },
  {
    label: 'CENTRAL KITCHEN',
    items: [
      { key: 'bom' as TabKey, label: 'BOM', icon: FlaskConical },
      { key: 'receipt' as TabKey, label: 'Goods Receipt', icon: ClipboardList },
      { key: 'production' as TabKey, label: 'Production', icon: Factory },
      { key: 'delivery' as TabKey, label: 'Delivery', icon: Truck },
      { key: 'stock' as TabKey, label: 'RM Stock', icon: Warehouse },
      { key: 'smstock' as TabKey, label: 'SM Stock', icon: BoxesIcon },
      { key: 'stockcount' as TabKey, label: 'Stock Count', icon: ClipboardCheck },
    ],
  },
];

const storeGroup = {
  label: 'STORE',
  items: [
    { key: 'store' as TabKey, label: 'Store Overview', icon: Store },
    { key: 'menu-master' as TabKey, label: 'Menu Master', icon: UtensilsCrossed },
    { key: 'menu-bom' as TabKey, label: 'Menu BOM', icon: BookOpen },
    { key: 'sp-bom' as TabKey, label: 'SP BOM', icon: Sparkles },
    { key: 'modifier-rules' as TabKey, label: 'Modifier Rules', icon: ListFilter },
    { key: 'sales-entry' as TabKey, label: 'Sales Entry', icon: ShoppingCart },
    { key: 'branch-receipt' as TabKey, label: 'Branch Receipt', icon: ClipboardList },
    { key: 'daily-stock-count' as TabKey, label: 'Daily Stock Count', icon: ClipboardCheck },
    { key: 'food-cost' as TabKey, label: 'Food Cost', icon: PieChart },
  ],
};

const managementGroup = {
  label: 'MANAGEMENT',
  items: [
    { key: 'branches' as TabKey, label: 'Branches', icon: Store },
    { key: 'users' as TabKey, label: 'User Management', icon: Settings },
  ],
};

const roleLabels: Record<string, string> = {
  admin: 'Admin',
  ck_manager: 'CK Manager',
  branch_manager: 'Branch Mgr',
};

export function AppSidebar({ activeTab, onTabChange }: AppSidebarProps) {
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';
  const { profile, role, isAdmin, isBranchManager, signOut } = useAuth();

  const allGroups = isBranchManager
    ? [storeGroup]
    : isAdmin
      ? [...ckGroups, storeGroup, managementGroup]
      : ckGroups;

  const initials = (profile?.full_name || 'U')
    .split(' ')
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <Sidebar collapsible="icon">
      {/* Logo area */}
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

      {/* Navigation */}
      <SidebarContent className="px-2 py-2">
        {allGroups.map(group => (
          <SidebarGroup key={group.label} className="py-1">
            <SidebarGroupLabel className="text-[10px] uppercase tracking-[0.08em] text-sidebar-section font-semibold px-3 mb-1">
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
        ))}
      </SidebarContent>

      {/* Footer */}
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
