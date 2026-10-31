import { describe, it, expect } from "vitest";
import { buildUsageContext } from "./sale-usage";
import { branchUsePerDay, dailyUseWindow, perDay, sellingDays, totalPerDay, type BranchSaleRow } from "./daily-use";

// A ramen with 300 g soup everywhere and a Shiro-only 20 g garnish; a set whose
// recipe line is an SP mix made of 50 g tare per portion
const ctx = buildUsageContext({
  menus: [
    { id: "m1", menuCode: "MN-004" },
    { id: "m2", menuCode: "MN-090" },
  ],
  bomLines: [
    { menuId: "m1", skuId: "soup", effectiveQty: 300, branchId: null },
    { menuId: "m1", skuId: "garnish", effectiveQty: 20, branchId: "shiro" },
    { menuId: "m2", skuId: "sp-mix", effectiveQty: 2, branchId: null },
  ],
  rules: [],
  spLines: [{ spSkuId: "sp-mix", ingredientSkuId: "tare", qtyPerBatch: 50, batchYieldQty: 1 }],
  skus: [{ id: "sp-mix", type: "SP" }],
});
const sale = (s: Partial<BranchSaleRow>): BranchSaleRow => ({ branch_id: "shiro", sale_date: "2026-10-30", menu_code: "MN-004", menu_name: null, qty: 1, ...s });
const week = dailyUseWindow("2026-10-31");

describe("dailyUseWindow", () => {
  it("is the last 7 days, today included", () => {
    expect(week).toEqual({ from: "2026-10-25", to: "2026-10-31" });
    // across a month end
    expect(dailyUseWindow("2026-11-03")).toEqual({ from: "2026-10-28", to: "2026-11-03" });
  });
  it("counts selling days inside it only", () => {
    expect(sellingDays([sale({ sale_date: "2026-10-24" }), sale({ sale_date: "2026-10-25" }), sale({ sale_date: "2026-10-25" }), sale({ sale_date: "2026-10-31" })], week)).toBe(2);
  });
  it("per day is (used + wasted) ÷ selling days, nothing sold = 0", () => {
    expect(perDay(600, 100, 7)).toBe(100);
    expect(perDay(0, 100, 0)).toBe(0);
  });
});

describe("branchUsePerDay", () => {
  it("divides by the branch's selling days, not the days the item was used", () => {
    // Shiro sold every day of the week; the set (tare) only on two of them
    const sales = ["2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31"].map((d) => sale({ sale_date: d }));
    sales.push(sale({ sale_date: "2026-10-26", menu_code: "MN-090", qty: 7 }), sale({ sale_date: "2026-10-29", menu_code: "MN-090", qty: 7 }));
    const r = branchUsePerDay({ ctx, sales, waste: [], skuIds: null, window: week });
    // 14 sets × 2 portions × 50 g = 1,400 g over 7 selling days (the old SM figure ÷ 2 days read 700)
    expect(r.perDay.get("shiro")!.tare).toBe(200);
    expect(r.perDay.get("shiro")!.soup).toBe(300);
    expect(r.sellingDays.get("shiro")).toBe(7);
  });

  it("adds waste, keeps each branch's own recipe lines and leaves out days outside the window", () => {
    const sales = [sale({ sale_date: "2026-10-30" }), sale({ sale_date: "2026-10-31" }), sale({ branch_id: "thaniya" }), sale({ sale_date: "2026-10-24", qty: 99 })];
    const waste = [
      { branch_id: "shiro", sku_id: "soup", count_date: "2026-10-31", waste: 200 },
      { branch_id: "shiro", sku_id: "soup", count_date: "2026-10-20", waste: 5000 },
    ];
    const r = branchUsePerDay({ ctx, sales, waste, skuIds: new Set(["soup", "garnish"]), window: week });
    expect(r.perDay.get("shiro")).toEqual({ soup: (600 + 200) / 2, garnish: 20 });
    // Thaniya has no garnish line of its own
    expect(r.perDay.get("thaniya")).toEqual({ soup: 300 });
    expect(totalPerDay(r.perDay)).toEqual({ soup: 700, garnish: 20 });
  });
});
