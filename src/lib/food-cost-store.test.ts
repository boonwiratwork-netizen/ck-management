import { describe, it, expect } from "vitest";
import { buildUsageContext } from "./sale-usage";
import { computeStandard, type FcSale, type Standard } from "./food-cost";
import { planMonthReplace, toMenuMonthRows, wholeMonthOf, type MenuMonthRow } from "./food-cost-store";

const ctx = buildUsageContext({
  menus: [
    { id: "m1", menuCode: "MN-004" },
    { id: "m2", menuCode: "MN-080" },
  ],
  bomLines: [
    { menuId: "m1", skuId: "noodle", effectiveQty: 1, branchId: null },
    { menuId: "m1", skuId: "soup", effectiveQty: 300, branchId: null },
    { menuId: "m2", skuId: "gyoza", effectiveQty: 3, branchId: null },
  ],
  rules: [],
  spLines: [],
  skus: [],
});
const stdPrice = new Map([
  ["noodle", 15],
  ["soup", 0.1],
  ["gyoza", 5],
]);
const menuByCode = new Map([
  ["MN-004", { code: "MN-004", name: "Signature ชิโอะ", category: "Ramen" }],
  ["MN-080", { code: "MN-080", name: "Trio Set", category: "Trio" }],
]);
const sale = (s: Partial<FcSale>): FcSale => ({ sale_date: "2026-09-10", branch_id: "shiro", menu_code: "MN-004", menu_name: null, qty: 1, net_amount: 379, receipt_no: "A1", ...s });
const std = (sales: FcSale[], from = "2026-09-01", to = "2026-09-30") => computeStandard({ sales, ctx, stdPrice, menuByCode, skuById: new Map(), corrections: [], branchIds: new Set(["shiro"]), from, to });
const branch = { id: "shiro", name: "Shiro", brand: "Shiro" };

describe("wholeMonthOf", () => {
  it("gives the first of the month for exactly one calendar month", () => {
    expect(wholeMonthOf("2026-09-01", "2026-09-30")).toBe("2026-09-01");
    expect(wholeMonthOf("2026-02-01", "2026-02-28")).toBe("2026-02-01");
    expect(wholeMonthOf("2028-02-01", "2028-02-29")).toBe("2028-02-01");
  });
  it("is null for a custom range", () => {
    expect(wholeMonthOf("2026-09-02", "2026-09-30")).toBeNull();
    expect(wholeMonthOf("2026-09-01", "2026-09-29")).toBeNull();
    expect(wholeMonthOf("2026-09-01", "2026-10-31")).toBeNull();
  });
});

describe("toMenuMonthRows", () => {
  const sales = [
    sale({ qty: 2, net_amount: 758 }),
    sale({ menu_code: "MN-080", qty: 1, net_amount: 49, receipt_no: "A2" }),
    sale({ menu_code: "OP-999", menu_name: "เพิ่มไข่", qty: 3, net_amount: 60, receipt_no: "A3" }),
  ];

  it("stores every menu with the page's numbers, plus menus not set up so revenue reconciles", () => {
    const s = std(sales);
    const rows = toMenuMonthRows({ std: s, branch, from: "2026-09-01", to: "2026-09-30", today: "2026-10-31" })!;
    expect(rows.map((r) => r.menu_code)).toEqual(["MN-004", "MN-080", "OP-999"]);
    const ramen = rows[0];
    // 2 × (1 noodle ฿15 + 300 g soup ฿0.1) = ฿90
    expect(ramen).toMatchObject({ branch_id: "shiro", branch_name: "Shiro", brand_name: "Shiro", month: "2026-09-01", menu_name: "Signature ชิโอะ", category: "Ramen", qty: 2, revenue: 758, std_cost: 90, cost_per_serving: 45, has_recipe_cost: true, is_closed_month: true });
    expect(ramen.cost_pct).toBeCloseTo((90 / 758) * 100, 3);
    expect(rows[2]).toMatchObject({ menu_name: "เพิ่มไข่", category: "", qty: 3, revenue: 60, std_cost: null, cost_per_serving: null, cost_pct: null, has_recipe_cost: false, uncosted_qty: 3, uncosted_revenue: 60 });
    expect(rows.reduce((t, r) => t + r.revenue, 0)).toBeCloseTo(s.revenue, 6);
    expect(rows.reduce((t, r) => t + (r.std_cost ?? 0), 0)).toBeCloseTo(s.stdCost, 6);
  });

  it("marks the month still running as not closed", () => {
    const rows = toMenuMonthRows({ std: std(sales, "2026-10-01", "2026-10-31"), branch, from: "2026-10-01", to: "2026-10-31", today: "2026-10-31" })!;
    expect(rows.every((r) => r.is_closed_month === false)).toBe(true);
    expect(rows[0].month).toBe("2026-10-01");
  });

  it("stores nothing for a custom range", () => {
    expect(toMenuMonthRows({ std: std(sales), branch, from: "2026-09-05", to: "2026-09-30", today: "2026-10-31" })).toBeNull();
  });

  it("zero revenue gives 0 % and a code both costed and not set up is one row", () => {
    const s: Standard = {
      revenue: 100,
      bills: 1,
      stdCost: 30,
      menus: [{ code: "MN-1", name: "ฟรี", category: "A", qty: 2, revenue: 0, stdCost: 10, pct: 0, perServing: 5 }, { code: "MN-2", name: "ข้าว", category: "A", qty: 4, revenue: 80, stdCost: 20, pct: 25, perServing: 5 }],
      skus: [],
      days: [],
      unknownMenus: [{ code: "MN-2", name: "ข้าว", qty: 1, revenue: 20 }],
    };
    const rows = toMenuMonthRows({ std: s, branch, from: "2026-09-01", to: "2026-09-30", today: "2026-10-01" })!;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ menu_code: "MN-1", revenue: 0, cost_pct: 0, cost_per_serving: 5 });
    // Costed part decides % and per serving (as the page shows); totals include the rest
    expect(rows[1]).toMatchObject({ menu_code: "MN-2", qty: 5, revenue: 100, std_cost: 20, cost_pct: 25, cost_per_serving: 5, has_recipe_cost: true, uncosted_qty: 1, uncosted_revenue: 20 });
  });

  it("rounds away float noise", () => {
    const s = std([sale({ net_amount: 0.1 }), sale({ net_amount: 0.2, receipt_no: "A2" })]);
    expect(toMenuMonthRows({ std: s, branch, from: "2026-09-01", to: "2026-09-30", today: "2026-10-31" })![0].revenue).toBe(0.3);
  });
});

describe("planMonthReplace", () => {
  const row = (code: string) => ({ menu_code: code }) as MenuMonthRow;
  it("upserts all new rows and removes only codes no longer in the month", () => {
    const rows = [row("MN-1"), row("MN-2")];
    expect(planMonthReplace(rows, ["MN-1", "MN-3", "MN-3", "MN-0"])).toEqual({ upsert: rows, remove: ["MN-0", "MN-3"] });
  });
  it("nothing stored yet: nothing to remove", () => {
    expect(planMonthReplace([row("MN-1")], []).remove).toEqual([]);
  });
  it("a month with no sales any more removes everything stored", () => {
    expect(planMonthReplace([], ["MN-1", "MN-2"])).toEqual({ upsert: [], remove: ["MN-1", "MN-2"] });
  });
});
