import { describe, expect, it } from "vitest";
import { usageContextOn, smRecipesOn, type RecipeCopy } from "./recipe-history";
import { addSaleUsage } from "./sale-usage";

const today = {
  menus: [{ id: "m1", menuCode: "MN-001" }],
  // Today's recipe: 120 g pork (changed on 15 Nov from 100 g)
  bomLines: [{ menuId: "m1", skuId: "pork", effectiveQty: 120, branchId: null }],
  rules: [],
  spLines: [],
  skus: [{ id: "pork", type: "RM" }],
};
const copy = (id: string, validFrom: string, qty: number, createdAt = validFrom): RecipeCopy => ({ id, kind: "menu", ownerId: "m1", snapshot: [{ sku_id: "pork", effective_qty: qty, branch_id: null }], validFrom, createdAt });
const used = (ctx: ReturnType<ReturnType<typeof usageContextOn>>) => {
  let g = 0;
  addSaleUsage(ctx, { menu_code: "MN-001", qty: 1 }, (_, q) => (g += q));
  return g;
};

describe("usageContextOn", () => {
  const at = usageContextOn(today, [copy("a", "2000-01-01T00:00:00+07:00", 100), copy("b", "2026-11-15T10:00:00+07:00", 120)]);
  it("uses the recipe of the sale's day", () => {
    expect(used(at("2026-10-31"))).toBe(100);
    expect(used(at("2026-11-14"))).toBe(100);
    expect(used(at("2026-11-15"))).toBe(120);
  });
  it("builds one context per set of recipes, not per day", () => {
    expect(at("2026-11-01")).toBe(at("2026-11-14"));
    expect(at("2026-11-01")).not.toBe(at("2026-11-15"));
  });
  it("the last copy saved in a day is the recipe as saved", () => {
    const sameDay = usageContextOn(today, [copy("a", "2026-11-15T10:00:00+07:00", 50, "2026-11-15T10:00:01+07:00"), copy("b", "2026-11-15T10:00:00+07:00", 130, "2026-11-15T10:00:02+07:00")]);
    expect(used(sameDay("2026-11-15"))).toBe(130);
  });
  it("menus without a copy use today's recipe", () => {
    expect(used(usageContextOn(today, [])("2026-10-31"))).toBe(120);
  });
});

describe("smRecipesOn", () => {
  it("picks each SM recipe's copy on the day", () => {
    const c = (id: string, d: string, qty: number): RecipeCopy => ({ id, kind: "sm", ownerId: "h1", snapshot: { header: { sm_sku_id: "sm", bom_mode: "simple", batch_size: 1000, yield_percent: 1 }, steps: [], lines: [{ rm_sku_id: "pork", qty_per_batch: qty, yield_percent: 1, step_id: null, qty_type: null, percent_of_input: null }] }, validFrom: d, createdAt: d });
    const m = smRecipesOn([c("a", "2000-01-01T00:00:00+07:00", 900), c("b", "2026-11-20T08:00:00+07:00", 950)], "2026-11-19");
    expect(m.get("h1")?.lines[0].qty_per_batch).toBe(900);
  });
});
