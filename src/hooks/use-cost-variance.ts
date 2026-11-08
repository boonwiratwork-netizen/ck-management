import { useMemo } from "react";
import { useCkPeriod } from "@/hooks/use-ck-production";
import { supabaseLoader, useFoodCostByBranch, type FoodCostLoader, type FoodCostMasters } from "@/hooks/use-food-cost";
import { branchItems, costVariance, kitchenItems, type CostVariance, type PlaceInput } from "@/lib/cost-variance";
import type { ProductionCost } from "@/lib/ck-production-cost";

const NO_LIVE: { skuId: string; currentStock: number }[] = [];

/** The kitchen's month as the card needs it (the dev demo passes its own) */
export interface KitchenMonth {
  loading: boolean;
  error: boolean;
  /** null = no production cost for the month (not counted at both ends, or nothing made) */
  cost: ProductionCost | null;
  /** Why there's no cost, when known */
  note?: string;
}

/**
 * Cost Center's top card: one closed month, the kitchen and every active branch, each
 * worked out by its own page's numbers (Food Cost per branch, the kitchen dashboard's
 * production cost) and put together by costVariance.
 */
export function useCostVariance(m: FoodCostMasters, period: { from: string; to: string }, opts?: { loader?: FoodCostLoader; kitchen?: KitchenMonth }): CostVariance {
  const branches = useMemo(() => m.branches.filter((b) => b.status === "Active"), [m.branches]);
  const ids = useMemo(() => branches.map((b) => b.id), [branches]);
  const months = useFoodCostByBranch(m, period.from, period.to, ids, opts?.loader ?? supabaseLoader);
  // A closed month has its closing count, so no live balances are needed (none given:
  // a month without one comes back "estimated" and is shown as not counted)
  const live = useCkPeriod(period.from, period.to, NO_LIVE, true);
  const kitchen: KitchenMonth = opts?.kitchen ?? {
    loading: live.loading,
    error: !!live.error,
    cost: live.data && !live.data.estimated && !live.data.blocked ? live.data.cost : null,
    note: !live.data ? undefined : !live.data.produced ? "เดือนนี้ไม่ได้ผลิต" : live.data.blocked || live.data.estimated ? "นับครัวต้น/ปลายเดือนไม่ครบ" : undefined,
  };

  const skuName = useMemo(() => {
    const names = new Map(m.skus.map((s) => [s.id, s.name]));
    return (id: string) => names.get(id) ?? id;
  }, [m.skus]);

  return useMemo(() => {
    const places: PlaceInput[] = [
      kitchen.loading
        ? { key: "ck", name: "ครัวกลาง", kind: "kitchen", state: "loading" }
        : kitchen.error
          ? { key: "ck", name: "ครัวกลาง", kind: "kitchen", state: "failed" }
          : !kitchen.cost
            ? { key: "ck", name: "ครัวกลาง", kind: "kitchen", state: "nocount", note: kitchen.note }
            : { key: "ck", name: "ครัวกลาง", kind: "kitchen", state: "ok", usage: kitchen.cost.usageVar, price: kitchen.cost.priceVar, items: kitchenItems(kitchen.cost.rows) },
      ...branches.map((b): PlaceInput => {
        const row = months.find((x) => x.branchId === b.id);
        const base = { key: b.id, name: b.branchName, kind: "branch" as const };
        if (!row || (!row.result && !row.failed)) return { ...base, state: "loading" };
        if (row.failed || !row.result) return { ...base, state: "failed" };
        const { std, actual } = row.result;
        const recipe = { revenue: std.revenue, stdCost: std.stdCost };
        if (!actual) return { ...base, ...recipe, state: "nocount" };
        return { ...base, ...recipe, state: "ok", actCost: actual.actCost, recipeCost: actual.recipeCost, usage: actual.usageVar, price: actual.priceVar, items: branchItems(actual.rows) };
      }),
    ];
    return costVariance(places, skuName);
  }, [kitchen.loading, kitchen.error, kitchen.cost, kitchen.note, branches, months, skuName]);
}
