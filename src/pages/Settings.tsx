import type { TabKey } from "@/components/AppSidebar";
import type { Branch } from "@/types/branch";
import type { SKU } from "@/types/sku";
import type { SkuCategory } from "@/hooks/use-sku-categories";
import { SegmentedTabs } from "@/components/SegmentedTabs";
import { BranchesTab } from "@/components/settings/BranchesTab";
import { UsersTab, type CallAdmin, type ManagedUser } from "@/components/settings/UsersTab";
import { CategoriesTab } from "@/components/settings/CategoriesTab";

type SettingsTab = "branches" | "users" | "sku-categories";
const TABS: { key: SettingsTab; label: string }[] = [
  { key: "branches", label: "สาขา" },
  { key: "users", label: "ผู้ใช้" },
  { key: "sku-categories", label: "หมวดสินค้า" },
];

interface Props {
  tab: SettingsTab;
  onNavigate: (tab: TabKey) => void;
  canOpen: (tab: TabKey) => boolean;
  /** Management changes settings; everyone else who can open a tab only looks */
  canEdit: boolean;
  branchData: { branches: Branch[]; addBranch: (d: Omit<Branch, "id">) => Promise<boolean>; updateBranch: (id: string, d: Partial<Omit<Branch, "id">>) => Promise<boolean> };
  categoryData: {
    categories: SkuCategory[];
    addCategory: (code: string, nameEn: string, nameTh: string) => Promise<SkuCategory | null>;
    updateCategory: (id: string, nameEn: string, nameTh: string) => Promise<boolean>;
    deleteCategory: (id: string) => Promise<boolean>;
  };
  skus: SKU[];
  /** Dev harness only */
  demoUsers?: { call: CallAdmin; load: () => Promise<ManagedUser[]>; save: (u: ManagedUser, before: ManagedUser | null) => Promise<void> };
}

/**
 * Settings, used now and then: branches, users, product categories on one page
 * (each tab keeps its old address: /branches, /users, /sku-categories).
 */
export default function SettingsPage({ tab, onNavigate, canOpen, canEdit, branchData, categoryData, skus, demoUsers }: Props) {
  const tabs = TABS.filter((t) => canOpen(t.key));
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">ตั้งค่า</h1>
          <p className="text-sm text-muted-foreground">ใช้นาน ๆ ครั้ง{canEdit ? "" : " · ดูอย่างเดียว"}</p>
        </div>
        {tabs.length > 1 && <SegmentedTabs<SettingsTab> tabs={tabs} value={tab} onChange={(t) => onNavigate(t)} />}
      </div>
      <div className="max-w-3xl">
        {tab === "branches" ? (
          <BranchesTab branches={branchData.branches} canEdit={canEdit} addBranch={branchData.addBranch} updateBranch={branchData.updateBranch} />
        ) : tab === "users" ? (
          <UsersTab branches={branchData.branches} demo={demoUsers} />
        ) : (
          <CategoriesTab categories={categoryData.categories} skus={skus} canEdit={canEdit} addCategory={categoryData.addCategory} updateCategory={categoryData.updateCategory} deleteCategory={categoryData.deleteCategory} />
        )}
      </div>
    </div>
  );
}
