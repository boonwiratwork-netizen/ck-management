import { useEffect, useMemo, useState } from "react";
import FoodCostPage from "@/pages/FoodCost";
import type { FoodCostLoader } from "@/hooks/use-food-cost";
import { demoFoodCostLoader } from "./food-cost-demo-data";

/**
 * Dev harness for /dev/food-cost: live menus, recipes, rules and prices (fixture),
 * bill names from real POS lines spread over the last months, and Shiro's real
 * September noodle counts (61 → +615 → 160) so the "used more than there was" line shows.
 */
interface Fixture {
  menus: never[];
  lines: never[];
  rules: never[];
  skus: { id: string; skuId: string }[];
  prices: { skuId: string; pricePerUsageUom: number; isActive: boolean }[];
  branches: { id: string; branchName: string }[];
  spLines: never[];
  bills: { menu_code: string; menu_name: string; qty: number; branch_id: string }[];
}

export default function FoodCostDemo() {
  const [fx, setFx] = useState<Fixture | null>(null);
  useEffect(() => {
    fetch("/fixtures.local/menu-setup.json")
      .then((r) => r.json())
      .then(setFx);
  }, []);

  const loader = useMemo<FoodCostLoader | null>(() => (fx ? demoFoodCostLoader(fx as never) : null), [fx]);

  if (!fx || !loader) return <div className="p-6 text-muted-foreground">กำลังโหลดข้อมูลตัวอย่าง…</div>;
  return (
    <div className="min-h-screen bg-background px-4 py-4 md:p-6">
      <FoodCostPage
        skus={fx.skus as never}
        prices={fx.prices as never}
        menus={fx.menus}
        menuBomLines={fx.lines}
        modifierRules={fx.rules}
        spBomLines={fx.spLines}
        branches={fx.branches as never}
        loader={loader}
      />
    </div>
  );
}
