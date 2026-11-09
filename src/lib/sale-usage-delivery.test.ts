import { describe, it, expect } from "vitest";
import { addSaleUsage, buildUsageContext, deliveryEffective, isDeliverySale, usageContextFromApp, type UsageRule, type UsageSale } from "./sale-usage";
import { usageContextOn, type RecipeCopy } from "./recipe-history";
import { checkBills } from "./bill-check";

// Recipes for delivery: ramen goes out with less soup and tare; blank = same as the shop.
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

// MN-004 ramen: soup 300 (delivery 240), tare 30 (delivery 20), noodle 1 (blank = same).
// MN-004L: Line Man alias, no lines of its own, takes MN-004 by a submenu rule.
// MN-075: Delivery Set A, takes MN-004 by a submenu rule; "เส้นโฮมเมด" swaps the noodle.
const ctx = buildUsageContext({
  menus: [
    { id: "ramen", menuCode: "MN-004" },
    { id: "alias", menuCode: "MN-004L" },
    { id: "set", menuCode: "MN-075" },
  ],
  bomLines: [
    { menuId: "ramen", skuId: "soup", effectiveQty: 300, deliveryEffectiveQty: 240, branchId: null },
    { menuId: "ramen", skuId: "tare", effectiveQty: 30, deliveryEffectiveQty: 20, branchId: null },
    { menuId: "ramen", skuId: "noodle", effectiveQty: 1, deliveryEffectiveQty: null, branchId: null },
    { menuId: "set", skuId: "box", effectiveQty: 1, deliveryEffectiveQty: null, branchId: null },
  ],
  rules: [
    rule({ id: "alias", ruleType: "submenu", keyword: "MN-004L", submenuId: "ramen", menuIds: ["alias"] }),
    rule({ id: "set", ruleType: "submenu", keyword: "Delivery Set A", submenuId: "ramen", menuIds: ["set"] }),
    rule({ id: "home", ruleType: "swap", keyword: "เส้นโฮมเมด", skuId: "noodle-home", swapSkuId: "noodle", qtyPerMatch: 1 }),
    rule({ id: "soup-swap", ruleType: "swap", keyword: "ซุปใส", skuId: "clear-soup", swapSkuId: "soup", qtyPerMatch: 280 }),
  ],
  spLines: [],
  skus: [],
});

function usage(sale: UsageSale) {
  const out: Record<string, number> = {};
  addSaleUsage(ctx, sale, (s, q) => (out[s] = (out[s] || 0) + q));
  return out;
}

describe("isDeliverySale", () => {
  it("order type, delivery-app channel or a Line Man alias code", () => {
    expect(isDeliverySale({ menu_code: "MN-004", order_type: "Delivery", channel: null })).toBe(true);
    expect(isDeliverySale({ menu_code: "MN-004", order_type: null, channel: "LINE MAN เดลิเวอรี" })).toBe(true);
    expect(isDeliverySale({ menu_code: "MN-004", order_type: "", channel: "GrabFood" })).toBe(true);
    expect(isDeliverySale({ menu_code: "MN-004L" })).toBe(true);
    expect(isDeliverySale({ menu_code: "MN-004", order_type: "Dine-In", channel: "หน้าร้าน" })).toBe(false);
    expect(isDeliverySale({ menu_code: "MN-004", order_type: "Take Away", channel: "หน้าร้าน" })).toBe(false);
    expect(isDeliverySale({ menu_code: "MN-004", order_type: "Manual", channel: "Manual" })).toBe(false);
    expect(isDeliverySale({ menu_code: "MN-004" })).toBe(false);
  });
});

describe("addSaleUsage for delivery", () => {
  it("dine-in uses the shop amounts", () => {
    expect(usage({ menu_code: "MN-004", qty: 2, order_type: "Dine-In", channel: "หน้าร้าน" })).toEqual({ soup: 600, tare: 60, noodle: 2 });
  });

  it("delivery uses the delivery amounts; a blank delivery amount = same as the shop", () => {
    expect(usage({ menu_code: "MN-004", qty: 2, order_type: "Delivery", channel: "LINE MAN เดลิเวอรี" })).toEqual({ soup: 480, tare: 40, noodle: 2 });
  });

  it("a Line Man alias menu (pulled in by a rule) uses the dish's delivery amounts", () => {
    expect(usage({ menu_code: "MN-004L", menu_name: "Tonkotsu", qty: 1 })).toEqual({ soup: 240, tare: 20, noodle: 1 });
  });

  it("a delivery set pulls the dish with its delivery amounts", () => {
    const sale = { menu_code: "MN-075", menu_name: "Delivery Set A Tonkotsu", qty: 1 };
    expect(usage({ ...sale, order_type: "Delivery" })).toEqual({ box: 1, soup: 240, tare: 20, noodle: 1 });
    // The same set rung up in the shop: shop amounts
    expect(usage({ ...sale, order_type: "Dine-In", channel: "หน้าร้าน" })).toEqual({ box: 1, soup: 300, tare: 30, noodle: 1 });
  });

  it("a swap inside a delivery set takes out the dish's delivery amount; the replacement amount stays", () => {
    const out = usage({ menu_code: "MN-075", menu_name: "Delivery Set A Tonkotsu ซุปใส", qty: 1, order_type: "Delivery" });
    expect(out.soup).toBe(0);
    expect(out["clear-soup"]).toBe(280);
    expect(out.tare).toBe(20);
  });

  it("a swap on the menu itself takes out the delivery amount", () => {
    const out = usage({ menu_code: "MN-004", menu_name: "Tonkotsu ซุปใส", qty: 1, channel: "LINE MAN เดลิเวอรี" });
    expect(out.soup).toBe(0);
    expect(out["clear-soup"]).toBe(280);
  });

  it("a delivery amount of 0 means the item isn't used for delivery", () => {
    const c = buildUsageContext({
      menus: [{ id: "m", menuCode: "MN-1" }],
      bomLines: [{ menuId: "m", skuId: "garnish", effectiveQty: 5, deliveryEffectiveQty: 0, branchId: null }],
      rules: [],
      spLines: [],
      skus: [],
    });
    let g = 0;
    addSaleUsage(c, { menu_code: "MN-1", qty: 3, order_type: "Delivery" }, (_, q) => (g += q));
    expect(g).toBe(0);
  });
});

describe("delivery amount from the app's recipe lines", () => {
  it("delivery_qty is divided by yield like qty_per_serving; blank = null", () => {
    expect(deliveryEffective(240, 80)).toBe(300);
    expect(deliveryEffective(null, 80)).toBeNull();
    expect(deliveryEffective(undefined, 100)).toBeNull();
    expect(deliveryEffective(0, 50)).toBe(0);
  });

  it("usageContextFromApp reads deliveryQty and yieldPct", () => {
    const c = usageContextFromApp({
      menus: [{ id: "m", menuCode: "MN-1" }],
      menuBomLines: [
        { menuId: "m", skuId: "soup", effectiveQty: 375, yieldPct: 80, deliveryQty: 240 },
        { menuId: "m", skuId: "noodle", effectiveQty: 1, yieldPct: 100 },
      ],
      modifierRules: [],
      spBomLines: [],
      skus: [],
    });
    const out: Record<string, number> = {};
    addSaleUsage(c, { menu_code: "MN-1", qty: 1, order_type: "Delivery" }, (s, q) => (out[s] = (out[s] || 0) + q));
    expect(out).toEqual({ soup: 300, noodle: 1 });
  });
});

describe("recipe history with delivery amounts", () => {
  const today = {
    menus: [{ id: "m1", menuCode: "MN-001" }],
    bomLines: [{ menuId: "m1", skuId: "soup", effectiveQty: 300, deliveryEffectiveQty: 200, branchId: null }],
    rules: [],
    spLines: [],
    skus: [],
  };
  const copy = (id: string, validFrom: string, line: Record<string, unknown>): RecipeCopy => ({ id, kind: "menu", ownerId: "m1", snapshot: [{ sku_id: "soup", effective_qty: 300, branch_id: null, ...line }], validFrom, createdAt: validFrom });
  const used = (c: ReturnType<ReturnType<typeof usageContextOn>>, sale: Partial<UsageSale>) => {
    let g = 0;
    addSaleUsage(c, { menu_code: "MN-001", qty: 1, ...sale }, (_, q) => (g += q));
    return g;
  };

  it("an old copy without delivery_qty = same as the shop; a later copy keeps its own delivery amount", () => {
    const at = usageContextOn(today, [copy("a", "2000-01-01T00:00:00+07:00", {}), copy("b", "2026-11-10T10:00:00+07:00", { delivery_qty: 192, yield_pct: 80 })]);
    expect(used(at("2026-11-01"), { order_type: "Delivery" })).toBe(300);
    expect(used(at("2026-11-10"), { order_type: "Delivery" })).toBe(240);
    expect(used(at("2026-11-10"), { order_type: "Dine-In" })).toBe(300);
  });
});

describe("bill check", () => {
  it("delivery bills are their own group, worked out with delivery amounts", () => {
    const out = checkBills(ctx, [
      { menu_code: "MN-004", menu_name: "Tonkotsu", qty: 2, branch_id: "b", order_type: "Dine-In", channel: "หน้าร้าน" },
      { menu_code: "MN-004", menu_name: "Tonkotsu", qty: 1, branch_id: "b", order_type: "Delivery", channel: "LINE MAN เดลิเวอรี" },
    ]).get("MN-004")!;
    expect(out.plates).toBe(3);
    const shop = out.groups.find((g) => !g.delivery)!;
    const delivery = out.groups.find((g) => g.delivery)!;
    expect(Object.fromEntries(shop.perPlate).soup).toBe(300);
    expect(Object.fromEntries(delivery.perPlate).soup).toBe(240);
  });
});

describe("delivery-only lines (menu_bom.delivery_only)", () => {
  // MN-010: noodle 1 in both; box 1 only for delivery. MN-011L alias + MN-012 set pull MN-010 in.
  const c = usageContextFromApp({
    menus: [
      { id: "dish", menuCode: "MN-010" },
      { id: "alias", menuCode: "MN-010L" },
      { id: "set", menuCode: "MN-012" },
    ],
    menuBomLines: [
      { menuId: "dish", skuId: "noodle", effectiveQty: 1, yieldPct: 100 },
      { menuId: "dish", skuId: "box", effectiveQty: 2, yieldPct: 50, deliveryOnly: true },
    ],
    modifierRules: [
      { id: "alias", ruleType: "submenu", keyword: "MN-010L", skuId: null, swapSkuId: null, submenuId: "dish", qtyPerMatch: 1, isActive: true, menuIds: ["alias"] },
      { id: "set", ruleType: "submenu", keyword: "Set B", skuId: null, swapSkuId: null, submenuId: "dish", qtyPerMatch: 1, isActive: true, menuIds: ["set"] },
      { id: "nobox", ruleType: "swap", keyword: "ถุงผ้า", skuId: "bag", swapSkuId: "box", submenuId: null, qtyPerMatch: 1, isActive: true },
    ],
    spBomLines: [],
    skus: [],
  });
  const u = (sale: UsageSale) => {
    const out: Record<string, number> = {};
    addSaleUsage(c, sale, (s, q) => (out[s] = (out[s] || 0) + q));
    return out;
  };

  it("a shop sale skips it; a delivery sale uses it at its effective amount", () => {
    expect(u({ menu_code: "MN-010", qty: 3, order_type: "Dine-In" })).toEqual({ noodle: 3 });
    expect(u({ menu_code: "MN-010", qty: 3, order_type: "Delivery" })).toEqual({ noodle: 3, box: 6 });
  });

  it("through a set or an alias, the dish's delivery-only line follows the sale", () => {
    expect(u({ menu_code: "MN-012", menu_name: "Set B", qty: 1, order_type: "Dine-In" })).toEqual({ noodle: 1 });
    expect(u({ menu_code: "MN-012", menu_name: "Set B", qty: 1, channel: "GrabFood" })).toEqual({ noodle: 1, box: 2 });
    expect(u({ menu_code: "MN-010L", menu_name: "x", qty: 1 })).toEqual({ noodle: 1, box: 2 });
  });

  it("a swap removes a delivery-only line only from a delivery sale", () => {
    // Shop: nothing to take out, the replacement still goes in (as with any swap)
    expect(u({ menu_code: "MN-010", menu_name: "x ถุงผ้า", qty: 1, order_type: "Dine-In" })).toEqual({ noodle: 1, bag: 1 });
    expect(u({ menu_code: "MN-010", menu_name: "x ถุงผ้า", qty: 1, order_type: "Delivery" })).toEqual({ noodle: 1, box: 0, bag: 1 });
  });

  it("recipe history: delivery_only in a copy is read; no key = an ordinary line", () => {
    const today = { menus: [{ id: "m1", menuCode: "MN-001" }], bomLines: [], rules: [], spLines: [], skus: [] };
    const at = usageContextOn(today, [
      {
        id: "a",
        kind: "menu",
        ownerId: "m1",
        snapshot: [
          { sku_id: "noodle", effective_qty: 1, branch_id: null },
          { sku_id: "box", effective_qty: 1, branch_id: null, delivery_only: true },
        ],
        validFrom: "2000-01-01T00:00:00+07:00",
        createdAt: "2000-01-01T00:00:00+07:00",
      },
    ]);
    const used = (sale: Partial<UsageSale>) => {
      const out: Record<string, number> = {};
      addSaleUsage(at("2026-11-09"), { menu_code: "MN-001", qty: 1, ...sale }, (s, q) => (out[s] = (out[s] || 0) + q));
      return out;
    };
    expect(used({ order_type: "Dine-In" })).toEqual({ noodle: 1 });
    expect(used({ order_type: "Delivery" })).toEqual({ noodle: 1, box: 1 });
  });

  it("bill check: a shop bill never sees the delivery-only line", () => {
    const out = checkBills(c, [
      { menu_code: "MN-010", menu_name: "x", qty: 1, branch_id: "b", order_type: "Dine-In" },
      { menu_code: "MN-010", menu_name: "x", qty: 1, branch_id: "b", order_type: "Delivery" },
    ]).get("MN-010")!;
    expect(Object.fromEntries(out.groups.find((g) => !g.delivery)!.perPlate)).toEqual({ noodle: 1 });
    expect(Object.fromEntries(out.groups.find((g) => g.delivery)!.perPlate)).toEqual({ noodle: 1, box: 2 });
  });
});
