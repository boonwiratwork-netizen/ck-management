import { describe, it, expect } from "vitest";
import { deliveryCost, deliveryDiffCount, deliveryQtyToSave, deliveryRows, hasDeliveryRecipe } from "./delivery-recipe";
import type { MenuBomLine } from "@/types/menu-bom";
import type { Price } from "@/types/price";

const line = (l: Partial<MenuBomLine>): MenuBomLine => ({ id: l.skuId ?? "x", menuId: "m", skuId: "x", qtyPerServing: 1, uom: "g", yieldPct: 100, effectiveQty: 1, costPerServing: 0, branchId: null, ...l });
const prices = [
  { id: "1", skuId: "soup", pricePerUsageUom: 0.1, isActive: true },
  { id: "2", skuId: "tare", pricePerUsageUom: 1, isActive: true },
  { id: "3", skuId: "egg", pricePerUsageUom: 5, isActive: true },
  { id: "4", skuId: "box", pricePerUsageUom: 3, isActive: true },
] as Price[];

describe("delivery recipe view", () => {
  // soup 260 (yield 90%) → 223; tare 30 → 25; egg 1 → 0 (not used); noodle-free; box delivery-only
  const shop = [
    line({ skuId: "soup", qtyPerServing: 260, yieldPct: 90, deliveryQty: 223 }),
    line({ skuId: "tare", qtyPerServing: 30, deliveryQty: 25 }),
    line({ skuId: "egg", qtyPerServing: 1, deliveryQty: 0 }),
    line({ skuId: "sake", qtyPerServing: 19 }),
    line({ skuId: "same", qtyPerServing: 5, deliveryQty: 5 }),
  ];
  const only = [line({ skuId: "box", qtyPerServing: 1, deliveryOnly: true })];
  const rows = deliveryRows(shop, only, prices);

  it("marks each row: changed / off / same / only, with the delivery amount", () => {
    expect(rows.map((r) => [r.line.skuId, r.kind, r.shopQty, r.deliveryQty])).toEqual([
      ["soup", "changed", 260, 223],
      ["tare", "changed", 30, 25],
      ["egg", "off", 1, 0],
      ["sake", "same", 19, 19],
      ["same", "same", 5, 5],
      ["box", "only", null, 1],
    ]);
    expect(deliveryDiffCount(rows)).toBe(4);
  });

  it("costs the delivery amounts (shop yield), skips rows not used, adds delivery-only rows", () => {
    expect(deliveryCost(rows)).toBeCloseTo((223 / 0.9) * 0.1 + 25 * 1 + 0 + 0 + 0 + 3, 6);
  });

  it("a recipe with nothing set has no delivery recipe", () => {
    expect(hasDeliveryRecipe([line({ skuId: "soup" })])).toBe(false);
    expect(hasDeliveryRecipe([line({ skuId: "soup", deliveryQty: 0 })])).toBe(true);
    expect(hasDeliveryRecipe([line({ skuId: "box", deliveryOnly: true })])).toBe(true);
  });

  it("typed amount → what to save: blank or the shop amount follow the shop", () => {
    expect(deliveryQtyToSave("", 260)).toBeNull();
    expect(deliveryQtyToSave(" 260 ", 260)).toBeNull();
    expect(deliveryQtyToSave("223", 260)).toBe(223);
    expect(deliveryQtyToSave("0", 260)).toBe(0);
    expect(deliveryQtyToSave("-1", 260)).toBeUndefined();
    expect(deliveryQtyToSave("abc", 260)).toBeUndefined();
  });
});
