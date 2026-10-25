import { describe, it, expect } from "vitest";
import { summarizeMenu, describeRule, MenuSetupInput } from "./menu-health";
import type { Menu } from "@/types/menu";
import type { ModifierRule } from "@/types/modifier-rule";
import type { SKU } from "@/types/sku";
import type { Price } from "@/types/price";
import type { Branch } from "@/types/branch";
import type { MenuBomLine } from "@/types/menu-bom";

const menu = (m: Partial<Menu>): Menu => ({
  id: "m1",
  menuCode: "MN-001",
  menuName: "Tonkotsu",
  category: "Ramen",
  sellingPrice: 300,
  status: "Active",
  brandName: "Shiro",
  isMaindish: true,
  ...m,
});
const sku = (id: string, name: string, status: "Active" | "Inactive" = "Active") => ({ id, skuId: id.toUpperCase(), name, status }) as SKU;
const price = (skuId: string, perUnit: number) => ({ id: "p" + skuId, skuId, pricePerUsageUom: perUnit, isActive: true }) as Price;
const branch = (id: string, brandName = "Shiro") => ({ id, branchName: id, brandName, status: "Active" }) as Branch;
const line = (l: Partial<MenuBomLine>): MenuBomLine => ({
  id: Math.random().toString(),
  menuId: "m1",
  skuId: "noodle",
  qtyPerServing: 1,
  uom: "pc",
  yieldPct: 100,
  effectiveQty: 1,
  costPerServing: 0,
  branchId: null,
  ...l,
});
const rule = (r: Partial<ModifierRule>): ModifierRule => ({
  id: "r1",
  keyword: "",
  skuId: "",
  qtyPerMatch: 1,
  uom: "",
  description: "",
  isActive: true,
  menuId: null,
  menuIds: [],
  ruleType: "add",
  swapSkuId: null,
  submenuId: null,
  branchIds: [],
  ...r,
});

const base = (over: Partial<MenuSetupInput> = {}): MenuSetupInput => ({
  menu: menu({}),
  menus: [menu({})],
  lines: [line({}), line({ skuId: "soup", qtyPerServing: 300 })],
  rules: [],
  skus: [sku("noodle", "เส้นโฮลวีท"), sku("soup", "ซุป"), sku("home", "เส้นโฮมเมด"), sku("garnish", "ต้นหอม")],
  prices: [price("noodle", 20), price("soup", 0.1), price("home", 25), price("garnish", 1)],
  branches: [branch("shiro"), branch("thaniya", "Thaniya")],
  overrides: {},
  ...over,
});

const ids = (s: ReturnType<typeof summarizeMenu>, level: string) => s.checks.filter((c) => c.level === level).map((c) => c.id);

describe("summarizeMenu", () => {
  it("costs the recipe per branch of the menu's brand only", () => {
    const s = summarizeMenu(base({ lines: [line({}), line({ skuId: "soup", qtyPerServing: 300 }), line({ skuId: "garnish", qtyPerServing: 5, branchId: "shiro" })] }));
    expect(s.branches.map((b) => b.branchId)).toEqual(["shiro"]);
    expect(s.branches[0].cost).toBeCloseTo(20 + 30 + 5);
    expect(s.branches[0].costPct).toBeCloseTo((55 / 300) * 100);
    expect(s.worst).toBe("ok");
  });

  it("applies yield to cost", () => {
    const s = summarizeMenu(base({ lines: [line({ qtyPerServing: 1, yieldPct: 50 })] }));
    expect(s.branches[0].cost).toBeCloseTo(40);
  });

  it("flags a menu with no recipe as an error", () => {
    const s = summarizeMenu(base({ lines: [] }));
    expect(ids(s, "error")).toContain("no-recipe");
  });

  it("flags ingredients without a price", () => {
    const s = summarizeMenu(base({ prices: [price("noodle", 20)] }));
    expect(ids(s, "warn")).toContain("unpriced");
  });

  it("flags the same ingredient counted twice at a branch", () => {
    const s = summarizeMenu(base({ lines: [line({}), line({ branchId: "shiro" })] }));
    expect(ids(s, "warn")).toContain("double");
  });

  it("flags a swap rule whose old ingredient is not in the recipe", () => {
    const r = rule({ ruleType: "swap", keyword: "เส้นโฮมเมด", skuId: "home", swapSkuId: "garnish", menuIds: ["m1"] });
    expect(ids(summarizeMenu(base({ rules: [r] })), "error")).toContain("swap-r1");
    const ok = rule({ ...r, swapSkuId: "noodle" });
    expect(ids(summarizeMenu(base({ rules: [ok] })), "error")).not.toContain("swap-r1");
  });

  it("only checks a branch-limited swap at its own branches", () => {
    const r = rule({ ruleType: "swap", keyword: "x", skuId: "home", swapSkuId: "garnish", menuIds: ["m1"], branchIds: ["other"] });
    expect(ids(summarizeMenu(base({ rules: [r] })), "error")).not.toContain("swap-r1");
  });

  it("flags a topping rule pointing at a menu with no recipe", () => {
    const topping = menu({ id: "m2", menuCode: "MN-022", menuName: "Ajitama" });
    const r = rule({ ruleType: "submenu", keyword: "Ajitama", submenuId: "m2", menuIds: ["m1"] });
    const s = summarizeMenu(base({ rules: [r], menus: [menu({}), topping] }));
    expect(ids(s, "error")).toContain("sub-r1");
  });

  it("a topping menu without a price is fine, without a recipe is an error", () => {
    const topping = menu({ id: "m2", menuCode: "MN-022", sellingPrice: 0 });
    const r = rule({ ruleType: "submenu", keyword: "Ajitama", submenuId: "m2" });
    const s = summarizeMenu(base({ menu: topping, menus: [menu({}), topping], rules: [r] }));
    expect(s.usedAsTopping).toHaveLength(1);
    expect(s.checks.find((c) => c.id === "price")?.level).toBe("ok");
    expect(ids(s, "error")).toContain("no-recipe");
  });

  it("warns when a branch closed the menu but still sells it", () => {
    const s = summarizeMenu(base({ overrides: { shiro: false }, soldByBranch: { shiro: 12 } }));
    expect(ids(s, "warn")).toContain("closed-sold-shiro");
  });

  it("flags duplicate menu codes", () => {
    const s = summarizeMenu(base({ menus: [menu({}), menu({ id: "m9" })] }));
    expect(ids(s, "error")).toContain("dup-code");
  });
});

describe("describeRule", () => {
  it("says a swap in plain words", () => {
    const r = rule({ ruleType: "swap", keyword: "เส้นโฮมเมด", skuId: "home", swapSkuId: "noodle", uom: "pc" });
    expect(describeRule(r, base().skus, [])).toBe('ถ้าบิลมีคำว่า "เส้นโฮมเมด" → เอา เส้นโฮลวีท ออก ใส่ เส้นโฮมเมด 1 pc แทน');
  });
});

describe("linked recipes", () => {
  it("a delivery menu that takes the dine-in recipe through its own-name rule is costed and not flagged", () => {
    const lm = menu({ id: "m1l", menuCode: "MN-001L", menuName: "Tonkotsu Ramen (Line Man)", sellingPrice: 250 });
    const r = rule({ ruleType: "submenu", keyword: "Tonkotsu Ramen (Line Man)", submenuId: "m1", menuIds: ["m1l"] });
    const s = summarizeMenu(base({ menu: lm, menus: [menu({}), lm], rules: [r] }));
    expect(s.linkedRecipes).toHaveLength(1);
    expect(s.branches[0].cost).toBeCloseTo(50);
    expect(s.branches[0].linkedCost).toBeCloseTo(50);
    expect(s.checks.find((c) => c.id === "no-recipe")?.level).toBe("ok");
  });

  it("an option rule (keyword not in the menu name) is not a linked recipe", () => {
    const r = rule({ ruleType: "submenu", keyword: "Ajitama", submenuId: "m2", menuIds: ["m1"] });
    const s = summarizeMenu(base({ rules: [r], menus: [menu({}), menu({ id: "m2", menuCode: "MN-022" })] }));
    expect(s.linkedRecipes).toHaveLength(0);
  });
});

describe("swap on a linked recipe", () => {
  const lm = menu({ id: "m1l", menuCode: "MN-001L", menuName: "Tonkotsu Ramen (Line Man)", sellingPrice: 250 });
  const link = rule({ id: "link", ruleType: "submenu", keyword: "Tonkotsu Ramen (Line Man)", submenuId: "m1", menuIds: ["m1l"] });
  const swap = rule({ id: "sw", ruleType: "swap", keyword: "เส้นโฮมเมด", skuId: "home", swapSkuId: "noodle", menuIds: ["m1l"] });

  it("doesn't flag a swap whose old ingredient comes from the linked recipe", () => {
    const s = summarizeMenu(base({ menu: lm, menus: [menu({}), lm], rules: [link, swap] }));
    expect(s.worst).toBe("ok");
  });

  it("flags a branch the linking rule doesn't cover", () => {
    const only = rule({ ...link, branchIds: ["thaniya"] });
    const s = summarizeMenu(base({ menu: lm, menus: [menu({}), lm], rules: [only], branches: [branch("shiro"), branch("thaniya")] }));
    expect(ids(s, "warn")).toContain("unreached-shiro");
    const sold = summarizeMenu(base({ menu: lm, menus: [menu({}), lm], rules: [only], branches: [branch("shiro"), branch("thaniya")], soldByBranch: { shiro: 3 } }));
    expect(ids(sold, "error")).toContain("unreached-shiro");
    expect(ids(s, "error")).not.toContain("unreached-thaniya");
  });
});
