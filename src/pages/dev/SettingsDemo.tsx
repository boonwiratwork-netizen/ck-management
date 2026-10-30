import { useState } from "react";
import SettingsPage from "@/pages/Settings";
import type { Branch } from "@/types/branch";
import type { SkuCategory } from "@/hooks/use-sku-categories";
import type { SKU } from "@/types/sku";
import type { ManagedUser } from "@/components/settings/UsersTab";

/** Dev only: the settings page with made-up people and the real branches/categories */
const BRANCHES: Branch[] = [
  { id: "b1", branchName: "Thaniya", brandName: "Sendo", location: "Silom", status: "Active", avgSellingPrice: null },
  { id: "b2", branchName: "Shiro", brandName: "Sendo", location: "Ekkamai", status: "Active", avgSellingPrice: null },
];
const CATS: SkuCategory[] = [
  ["DG", "Dry Goods", "ของแห้ง"],
  ["SC", "Sauce", "ซอส"],
  ["MT", "Meat", "เนื้อสัตว์"],
  ["FR", "Fruit", "ผลไม้"],
].map(([code, nameEn, nameTh], i) => ({ id: `c${i}`, code, nameEn, nameTh }));
const SKUS = [...Array(71).fill("DG"), ...Array(69).fill("SC"), ...Array(50).fill("MT")].map((category, i) => ({ id: `s${i}`, category }) as SKU);
const USERS: ManagedUser[] = [
  { userId: "u1", fullName: "bucci", email: "bucci@example.test", role: "management", status: "Active", branchId: null, brands: [] },
  { userId: "u2", fullName: "หัวหน้าสาขา Thaniya", email: "thaniya@example.test", role: "store_manager", status: "Active", branchId: "b1", brands: [] },
  { userId: "u3", fullName: "Area", email: "area@example.test", role: "area_manager", status: "Active", branchId: null, brands: ["Sendo"] },
  { userId: "u4", fullName: "บัญชีเก่า", email: "old@example.test", role: "store_manager", status: "Inactive", branchId: null, brands: [] },
];

export default function SettingsDemo() {
  const [tab, setTab] = useState<"branches" | "users" | "sku-categories">("users");
  const [branches, setBranches] = useState(BRANCHES);
  const [cats, setCats] = useState(CATS);
  const log = (what: unknown) => console.info("[settings demo]", what);
  return (
    <div className="min-h-screen bg-background px-4 py-4 md:p-6">
      <SettingsPage
        tab={tab}
        onNavigate={(t) => setTab(t as typeof tab)}
        canOpen={() => true}
        canEdit
        skus={SKUS}
        branchData={{
          branches,
          addBranch: async (d) => (setBranches((p) => [...p, { ...d, id: `b${p.length + 1}` }]), true),
          updateBranch: async (id, d) => (setBranches((p) => p.map((b) => (b.id === id ? { ...b, ...d } : b))), true),
        }}
        categoryData={{
          categories: cats,
          addCategory: async (code, nameEn, nameTh) => {
            const c = { id: `c${Date.now()}`, code, nameEn, nameTh };
            setCats((p) => [...p, c]);
            return c;
          },
          updateCategory: async (id, nameEn, nameTh) => (setCats((p) => p.map((c) => (c.id === id ? { ...c, nameEn, nameTh } : c))), true),
          deleteCategory: async (id) => (setCats((p) => p.filter((c) => c.id !== id)), true),
        }}
        demoUsers={{ call: async (b) => (log(b), { user: { id: "new" } }), load: async () => USERS, save: async (u, before) => log({ u, before }) }}
      />
    </div>
  );
}
