import { describe, it, expect } from "vitest";
import { addSaleUsage, buildUsageContext, UsageRule } from "./sale-usage";

const rule = (r: Partial<UsageRule>): UsageRule => ({
  id: "r",
  ruleType: "add",
  keyword: "",
  skuId: null,
  swapSkuId: null,
  submenuId: null,
  qtyPerMatch: 1,
  isActive: true,
  branchIds: [],
  menuIds: [],
  ...r,
});

// MN-073 ramen has 1 whole-wheat noodle for every branch; Shiro also has a branch-only garnish.
const ctx = buildUsageContext({
  menus: [
    { id: "m073", menuCode: "MN-073" },
    { id: "m022", menuCode: "MN-022" },
  ],
  bomLines: [
    { menuId: "m073", skuId: "noodle-wholewheat", effectiveQty: 1, branchId: null },
    { menuId: "m073", skuId: "soup", effectiveQty: 300, branchId: null },
    { menuId: "m073", skuId: "garnish", effectiveQty: 2, branchId: "shiro" },
    { menuId: "m022", skuId: "egg", effectiveQty: 1, branchId: null },
  ],
  rules: [
    rule({ id: "home", ruleType: "swap", keyword: "เส้นโฮมเมด", skuId: "noodle-home", swapSkuId: "noodle-wholewheat" }),
    rule({ id: "egg", ruleType: "submenu", keyword: "Ajitama", submenuId: "m022" }),
    rule({ id: "thaniya-only", ruleType: "add", keyword: "พิเศษ", skuId: "extra", branchIds: ["thaniya"] }),
  ],
  spLines: [],
  skus: [],
});

function usage(sale: { menu_code: string; menu_name?: string; qty: number; branch_id?: string }) {
  const out: Record<string, number> = {};
  const known = addSaleUsage(ctx, sale, (s, q) => (out[s] = (out[s] || 0) + q));
  return { known, out };
}

describe("addSaleUsage", () => {
  it("counts the recipe times quantity", () => {
    expect(usage({ menu_code: "MN-073", qty: 2, branch_id: "thaniya" }).out).toEqual({ "noodle-wholewheat": 2, soup: 600 });
  });

  it("adds a branch's own recipe lines only at that branch", () => {
    expect(usage({ menu_code: "MN-073", qty: 1, branch_id: "shiro" }).out.garnish).toBe(2);
  });

  it("swap takes the recipe line out and puts the new item in (one noodle per bowl)", () => {
    const { out } = usage({ menu_code: "MN-073", menu_name: "Tonkotsu เลือกเส้น : เส้นโฮมเมด x 1", qty: 1, branch_id: "thaniya" });
    expect(out["noodle-wholewheat"]).toBe(0);
    expect(out["noodle-home"]).toBe(1);
  });

  it("submenu adds the topping's own recipe", () => {
    expect(usage({ menu_code: "MN-073", menu_name: "Tonkotsu Topping : Ajitama x 1", qty: 1, branch_id: "shiro" }).out.egg).toBe(1);
  });

  it("branch-only rules don't fire at other branches", () => {
    expect(usage({ menu_code: "MN-073", menu_name: "พิเศษ", qty: 1, branch_id: "shiro" }).out.extra).toBeUndefined();
    expect(usage({ menu_code: "MN-073", menu_name: "พิเศษ", qty: 1, branch_id: "thaniya" }).out.extra).toBe(1);
  });

  it("reports menus missing from the menu list", () => {
    expect(usage({ menu_code: "MN-067", qty: 1 }).known).toBe(false);
  });
});
