import { useEffect, useState } from "react";
import MenuSetupPage from "@/pages/MenuSetup";
import type { Menu } from "@/types/menu";
import type { MenuBomLine } from "@/types/menu-bom";
import type { ModifierRule } from "@/types/modifier-rule";
import type { SKU } from "@/types/sku";
import type { Price } from "@/types/price";
import type { Branch } from "@/types/branch";

interface Fixture {
  menus: Menu[];
  lines: MenuBomLine[];
  rules: ModifierRule[];
  skus: SKU[];
  prices: Price[];
  branches: Branch[];
  overrides: Record<string, Record<string, boolean>>;
  soldByCode: Record<string, Record<string, number>>;
}

/**
 * Dev-only harness (route exists only under `npm run dev`): renders Menu Setup
 * from fixtures.local/menu-setup.json — a local, git-ignored export — so the
 * screen can be checked at every size without signing in. Saves stay in memory.
 */
export default function MenuSetupDemo() {
  const [data, setData] = useState<Fixture | null>(null);
  const [lines, setLines] = useState<MenuBomLine[]>([]);
  const [menus, setMenus] = useState<Menu[]>([]);

  useEffect(() => {
    fetch("/fixtures.local/menu-setup.json")
      .then((r) => r.json())
      .then((d: Fixture) => {
        setData(d);
        setLines(d.lines);
        setMenus(d.menus);
      });
  }, []);

  if (!data) return <div className="p-6 text-muted-foreground">กำลังโหลดข้อมูลตัวอย่าง…</div>;
  const wait = () => new Promise((r) => setTimeout(r, 400));
  return (
    <div className="min-h-screen bg-background px-4 py-4 md:p-6">
      <MenuSetupPage
        menus={menus}
        updateMenu={async (id, patch) => (await wait(), setMenus((p) => p.map((m) => (m.id === id ? { ...m, ...patch } : m))), true)}
        menuBom={{
          lines,
          loading: false,
          addLine: async (l) => (await wait(), setLines((p) => [...p, { ...l, id: crypto.randomUUID() }]), true),
          updateLine: async (id, patch) => (await wait(), setLines((p) => p.map((l) => (l.id === id ? { ...l, ...patch } : l))), true),
          deleteLine: async (id) => (await wait(), setLines((p) => p.filter((l) => l.id !== id)), true),
        }}
        rules={data.rules}
        skus={data.skus}
        prices={data.prices}
        branches={data.branches}
        onNavigate={() => undefined}
        demoExtras={{ overrides: data.overrides, soldByCode: data.soldByCode }}
      />
    </div>
  );
}
