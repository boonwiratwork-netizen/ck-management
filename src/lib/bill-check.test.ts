import { describe, it, expect } from "vitest";
import { checkBills } from "./bill-check";
import { buildUsageContext } from "./sale-usage";

const ctx = buildUsageContext({
  menus: [
    { id: "ramen", menuCode: "MN-001" },
    { id: "set", menuCode: "MN-075" },
    { id: "empty", menuCode: "MN-099" },
  ],
  bomLines: [{ menuId: "ramen", skuId: "noodle", effectiveQty: 1, branchId: null }],
  rules: [
    { id: "r", ruleType: "submenu", keyword: "Standard Shio Ramen", skuId: null, swapSkuId: null, submenuId: "ramen", qtyPerMatch: 1, isActive: true, branchIds: [], menuIds: ["set"] },
  ],
  spLines: [],
  skus: [],
});

describe("checkBills", () => {
  it("credits a set menu whose items come from rules on the bill text", () => {
    const r = checkBills(ctx, [{ menu_code: "MN-075", menu_name: "Delivery Set ชามที่ 1 : Standard Shio Ramen x 1", qty: 2, branch_id: "t" }]);
    const c = r.get("MN-075")!;
    expect(c.emptyPlates).toBe(0);
    expect(c.groups[0].perPlate).toEqual([["noodle", 1]]);
  });

  it("flags bills that deduct nothing, per branch", () => {
    const r = checkBills(ctx, [
      { menu_code: "MN-099", menu_name: "Mystery", qty: 3, branch_id: "s" },
      { menu_code: "MN-075", menu_name: "Delivery Set (no items written)", qty: 1, branch_id: "t" },
    ]);
    expect(r.get("MN-099")).toMatchObject({ plates: 3, emptyPlates: 3, emptyByBranch: { s: 3 } });
    expect(r.get("MN-075")!.emptyPlates).toBe(1);
  });

  it("groups identical bills and skips unknown codes", () => {
    const r = checkBills(ctx, [
      { menu_code: "MN-001", menu_name: "Shio", qty: 1, branch_id: "t" },
      { menu_code: "MN-001", menu_name: "Shio", qty: 2, branch_id: "t" },
      { menu_code: "OP122", menu_name: "แก้วน้ำแข็ง", qty: 5, branch_id: "t" },
    ]);
    expect(r.get("MN-001")!.groups).toHaveLength(1);
    expect(r.get("MN-001")!.plates).toBe(3);
    expect(r.has("OP122")).toBe(false);
  });
});
