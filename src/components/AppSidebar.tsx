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
  Truck, Store, ClipboardCheck, Settings, LogOut, UtensilsCrossed, BookOpen, Sparkles, ListFilter, ShoppingCart,
} from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export type TabKey = 'dashboard' | 'sku' | 'supplier' | 'price' | 'bom' | 'receipt' | 'stock' | 'production' | 'smstock' | 'stockcount' | 'delivery' | 'branches' | 'users' | 'store' | 'menu-master' | 'menu-bom' | 'sp-bom' | 'modifier-rules' | 'sales-entry';

interface AppSidebarProps {
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
}

const navGroups = [
  {
    label: 'Overview',
    items: [
      { key: 'dashboard' as TabKey, label: 'Dashboard', icon: LayoutDashboard },
    ],
  },
  {
    label: 'Masters',
    items: [
      { key: 'sku' as TabKey, label: 'SKU Master', icon: Package },
      { key: 'supplier' as TabKey, label: 'Suppliers', icon: Users },
      { key: 'price' as TabKey, label: 'Prices', icon: DollarSign },
    ],
  },
  {
    label: 'Planning',
    items: [
      { key: 'bom' as TabKey, label: 'BOM', icon: FlaskConical },
    ],
  },
  {
    label: 'Operations',
    items: [
      { key: 'receipt' as TabKey, label: 'Goods Receipt', icon: ClipboardList },
      { key: 'production' as TabKey, label: 'Production', icon: Factory },
      { key: 'delivery' as TabKey, label: 'Delivery', icon: Truck },
    ],
  },
  {
    label: 'Stock',
    items: [
      { key: 'stock' as TabKey, label: 'RM Stock', icon: Warehouse },
      { key: 'smstock' as TabKey, label: 'SM Stock', icon: BoxesIcon },
      { key: 'stockcount' as TabKey, label: 'Stock Count', icon: ClipboardCheck },
    ],
  },
  {
    label: 'Branches',
    items: [
      { key: 'branches' as TabKey, label: 'Branches', icon: Store },
    ],
  },
];

const settingsGroup = {
  label: 'Settings',
  items: [
    { key: 'users' as TabKey, label: 'User Management', icon: Settings },
  ],
};

const storeGroup = {
  label: 'Store',
  items: [
    { key: 'store' as TabKey, label: 'Store', icon: Store },
    { key: 'menu-master' as TabKey, label: 'Menu Master', icon: UtensilsCrossed },
    { key: 'menu-bom' as TabKey, label: 'Menu BOM', icon: BookOpen },
    { key: 'sp-bom' as TabKey, label: 'SP BOM', icon: Sparkles },
    { key: 'modifier-rules' as TabKey, label: 'Modifier Rules', icon: ListFilter },
  ],
};

export function AppSidebar({ activeTab, onTabChange }: AppSidebarProps) {
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';
  const { profile, role, isAdmin, isBranchManager, signOut } = useAuth();

  const allGroups = isBranchManager
    ? [storeGroup]
    : isAdmin
      ? [...navGroups, storeGroup, settingsGroup]
      : navGroups;

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shrink-0">
            <ChefHat className="w-4.5 h-4.5 text-primary-foreground" />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <p className="text-sm font-heading font-bold leading-tight truncate">CK Manager</p>
              <p className="text-[10px] text-sidebar-foreground/60 leading-tight">Central Kitchen Ops</p>
            </div>
          )}
        </div>
      </SidebarHeader>
      <SidebarContent>
        {allGroups.map(group => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel className="text-[10px] uppercase tracking-wider">{group.label}</SidebarGroupLabel>
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
                        className="cursor-pointer"
                      >
                        <item.icon className="w-4 h-4" />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border p-3">
        {!collapsed && (
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium truncate">{profile?.full_name || 'User'}</p>
              <Badge variant="secondary" className="text-[10px] mt-0.5">
                {role === 'admin' ? 'Admin' : role === 'branch_manager' ? 'Branch Manager' : 'CK Manager'}
              </Badge>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 h-8 w-8"
              onClick={signOut}
              title="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        )}
        {collapsed && (
          <Button
            variant="ghost"
            size="icon"
            className="w-full"
            onClick={signOut}
            title="Sign out"
          >
            <LogOut className="w-4 h-4" />
          </Button>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
