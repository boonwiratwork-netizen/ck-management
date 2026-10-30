import { useEffect, useMemo, useState } from "react";
import FoodCostPage from "@/pages/FoodCost";
import type { FoodCostLoader } from "@/hooks/use-food-cost";
import type { FcSale } from "@/lib/food-cost";

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

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export default function FoodCostDemo() {
  const [fx, setFx] = useState<Fixture | null>(null);
  useEffect(() => {
    fetch("/fixtures.local/menu-setup.json")
      .then((r) => r.json())
      .then(setFx);
  }, []);

  const loader = useMemo<FoodCostLoader | null>(() => {
    if (!fx) return null;
    const noodle = fx.skus.find((s) => s.skuId === "RM-0171")?.id ?? "";
    const shiro = fx.branches.find((b) => b.branchName === "Shiro")?.id ?? "";
    const price = new Map(fx.prices.filter((p) => p.isActive).map((p) => [p.skuId, p.pricePerUsageUom]));
    // Every bill name sold each day, 120 days back; Shiro has no sales 9–17 Oct (POS change)
    const sales: FcSale[] = [];
    const start = new Date();
    start.setDate(start.getDate() - 120);
    for (let d = new Date(start); d <= new Date(); d.setDate(d.getDate() + 1)) {
      const day = iso(d);
      fx.bills.forEach((b, i) => {
        if (b.branch_id === shiro && day >= "2026-10-09" && day <= "2026-10-17") return;
        if ((i + d.getDate()) % 4) return;
        sales.push({ sale_date: day, branch_id: b.branch_id, menu_code: b.menu_code, menu_name: b.menu_name, qty: b.qty, net_amount: b.qty * 330, receipt_no: `${day}-${i}` });
      });
    }
    const wait = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 250));
    return {
      sales: (ids, from, to) => wait({ data: sales.filter((s) => ids.includes(s.branch_id) && s.sale_date >= from && s.sale_date <= to), error: null }),
      corrections: (ids, from, to) =>
        wait(
          ids.includes(shiro) && from <= "2026-09-30" && to >= "2026-09-01"
            ? [{ id: "c9", branchId: shiro, skuId: noodle, dateFrom: "2026-09-01", dateTo: "2026-09-30", qty: -469, reason: "POS เก่านับเส้นซ้ำ (สูตรชาม + บรรทัดตัวเลือกเส้น)" }]
            : [],
        ),
      // Every item counted at month end (stock = 2 days of use), the noodle with Shiro's real September counts
      counts: (b, from) =>
        wait(
          fx.prices
            .filter((p) => p.isActive)
            .filter((p, i) => i < 80 || p.skuId === noodle)
            .map((p) => ({ sku_id: p.skuId, count_date: from.slice(0, 8) + (from.endsWith("28") || from.endsWith("27") ? "31" : "30"), physical_count: 2000, calculated_balance: 2000 }))
            .map((r) => (r.sku_id === noodle && b === shiro ? { ...r, count_date: from < "2026-09-15" ? "2026-09-01" : "2026-09-30", physical_count: from < "2026-09-15" ? 61 : 160 } : r)),
        ),
      receipts: (b, from, to, skuIds) =>
        wait(
          b === shiro && from <= "2026-09-30" && to >= "2026-09-01" && (!skuIds || skuIds.includes(noodle))
            ? [150, 100, 115, 100, 150].map((q, i) => ({ sku_id: noodle, receipt_date: `2026-09-${10 + i}`, qty_received: q, actual_unit_price: 15 }))
            : fx.prices.filter((p) => p.isActive && (!skuIds || skuIds.includes(p.skuId))).slice(0, 60).map((p) => ({ sku_id: p.skuId, receipt_date: from, qty_received: 1000, actual_unit_price: (price.get(p.skuId) ?? 0) * 1.03 })),
        ),
    };
  }, [fx]);

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
