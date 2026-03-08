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
  useSidebar,
} from '@/components/ui/sidebar';
import {
  ChefHat, LayoutDashboard, Package, Users, DollarSign,
  FlaskConical, ClipboardList, Warehouse, Factory, BoxesIcon,
  Truck, Store, ClipboardCheck,
} from 'lucide-react';

export type TabKey = 'dashboard' | 'sku' | 'supplier' | 'price' | 'bom' | 'receipt' | 'stock' | 'production' | 'smstock' | 'delivery' | 'branches';

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
    ],
  },
  {
    label: 'Branches',
    items: [
      { key: 'branches' as TabKey, label: 'Branches', icon: Store },
    ],
  },
];

export function AppSidebar({ activeTab, onTabChange }: AppSidebarProps) {
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';

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
        {navGroups.map(group => (
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
    </Sidebar>
  );
}
