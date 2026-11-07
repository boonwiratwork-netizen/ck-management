import { describe, expect, it } from "vitest";
import type { Menu } from "@/types/menu";
import type { MenuBomLine } from "@/types/menu-bom";
import type { Price } from "@/types/price";
import type { SKU } from "@/types/sku";
import { activePrice, buildMatrix, bulkYieldPreview, codesFromHash, editProblem, effectiveQty, lastWeek, lineValues, pickableSkus, soldByMenuCode } from "./usage-matrix";

const menu = (id: string, name: string, status: "Active" | "Inactive" = "Active"): Menu => ({ id, menuCode: `MN-${id}`, menuName: name, category: "", sellingPrice: 0, status, brandName: "Sendo", isMaindish: true });
const line = (id: string, menuId: string, skuId: string, qty: number, yieldPct = 100, branchId: string | null = null): MenuBomLine => ({ id, menuId, skuId, qtyPerServing: qty, uom: "ก.", yieldPct, effectiveQty: effectiveQty(qty, yieldPct), costPerServing: 0, branchId });
const sku = (id: string, name: string, status: "Active" | "Inactive" = "Active") => ({ id, skuId: `RM-${id}`, name, status, usageUom: "ก." }) as unknown as SKU;

const menus = [menu("1", "ราเมนโชยุ"), menu("2", "ข้าวหน้าหมู"), menu("3", "ราเมนเก่า", "Inactive"), menu("4", "เกี๊ยวซ่า")];
const lines = [
  line("a", "1", "onion", 10, 35),
  line("b", "1", "onion", 12, 35, "br-2"),
  line("c", "2", "onion", 5, 100),
  line("d", "3", "onion", 8, 35),
  line("e", "4", "oil", 2, 100),
  line("f", "2", "oil", 1, 100),
  line("g", "9", "onion", 3, 35), // its menu is gone
];

describe("effective qty and cost (same as the recipe editor / import)", () => {
  it("qty ÷ (yield/100); cost = effective × active price", () => {
    expect(effectiveQty(7, 35)).toBeCloseTo(20);
    expect(lineValues(7, 35, 0.1)).toEqual({ qtyPerServing: 7, yieldPct: 35, effectiveQty: 20, costPerServing: 2 });
    expect(effectiveQty(5, 0)).toBe(5);
  });
  it("uses the active price only", () => {
    const prices = [
      { skuId: "x", isActive: false, pricePerUsageUom: 9 },
      { skuId: "x", isActive: true, pricePerUsageUom: 0.5 },
    ] as Price[];
    expect(activePrice(prices, "x")).toBe(0.5);
    expect(activePrice(prices, "y")).toBe(0);
  });
});

describe("editProblem", () => {
  it("qty > 0, yield 1–100", () => {
    expect(editProblem(10, 35)).toBeNull();
    expect(editProblem(10, 100)).toBeNull();
    expect(editProblem(0, 50)).not.toBeNull();
    expect(editProblem(NaN, 50)).not.toBeNull();
    expect(editProblem(5, 0.5)).not.toBeNull();
    expect(editProblem(5, 101)).not.toBeNull();
  });
});

describe("pickableSkus", () => {
  it("active items in at least one menu recipe, with how many menus", () => {
    const out = pickableSkus([sku("onion", "ต้นหอมไทย"), sku("oil", "น้ำมันทรัฟเฟิล"), sku("salt", "เกลือ"), sku("old", "เก่า", "Inactive")], [...lines, line("z", "1", "old", 1)]);
    expect(out.map((p) => [p.sku.id, p.menuCount])).toEqual([
      ["onion", 4],
      ["oil", 2],
    ]);
  });
});

describe("buildMatrix", () => {
  const rows = buildMatrix(menus, lines, ["onion", "oil"], { "MN-1": 40, "MN-4": 3 });
  it("one row per menu using a picked item; open menus first, closed last; unknown menus left out", () => {
    expect(rows.map((r) => r.menu.id)).toEqual(["4", "2", "1", "3"]) // Thai order: เกี๊ยว (ก) before ข้าว (ข);
    expect(rows.map((r) => r.active)).toEqual([true, true, true, false]);
  });
  it("shared and branch lines both shown, shared first, never merged", () => {
    const r1 = rows.find((r) => r.menu.id === "1")!;
    expect(r1.cells.onion.map((l) => l.id)).toEqual(["a", "b"]);
    expect(r1.cells.oil).toBeUndefined();
  });
  it("week sales by menu code (0 when none, null while unknown)", () => {
    expect(rows.find((r) => r.menu.id === "1")!.soldWeek).toBe(40);
    expect(rows.find((r) => r.menu.id === "2")!.soldWeek).toBe(0);
    expect(buildMatrix(menus, lines, ["oil"], null)[0].soldWeek).toBeNull();
  });
  it("only picked items", () => {
    expect(buildMatrix(menus, lines, ["oil"], null).map((r) => r.menu.id)).toEqual(["4", "2"]);
    expect(buildMatrix(menus, lines, [], null)).toEqual([]);
  });
});

describe("bulkYieldPreview", () => {
  it("every menu line of the item that changes (shared, branch, closed menus), not lines already at the value", () => {
    const out = bulkYieldPreview(lines, menus, "onion", 100, 0.2);
    expect(out.map((c) => c.line.id).sort()).toEqual(["a", "b", "d", "g"]);
    expect(out.find((c) => c.line.id === "a")).toMatchObject({ oldYield: 35, newYield: 100, next: { qtyPerServing: 10, yieldPct: 100, effectiveQty: 10, costPerServing: 2 } });
    // open menus listed before closed ones
    expect(out.findIndex((c) => c.line.id === "d")).toBeGreaterThan(out.findIndex((c) => c.line.id === "a"));
  });
  it("nothing to do when all are already there", () => {
    expect(bulkYieldPreview(lines, menus, "oil", 100, 1)).toEqual([]);
  });
  it("never touches another item", () => {
    expect(bulkYieldPreview(lines, menus, "oil", 50, 1).every((c) => c.line.skuId === "oil")).toBe(true);
  });
});

describe("helpers", () => {
  it("lastWeek = the 7 finished days before today", () => {
    expect(lastWeek(new Date(2026, 10, 7, 15))).toEqual({ from: "2026-10-31", to: "2026-11-06" });
  });
  it("soldByMenuCode sums all branches", () => {
    expect(soldByMenuCode([{ menu_code: "MN-1", qty: 2 }, { menu_code: "MN-1", qty: "3" }, { menu_code: "", qty: 9 }, { menu_code: "MN-2", qty: null }])).toEqual({ "MN-1": 5, "MN-2": 0 });
  });
  it("codesFromHash", () => {
    expect(codesFromHash("usage")).toEqual([]);
    expect(codesFromHash("usage/RM-0027")).toEqual(["RM-0027"]);
    expect(codesFromHash("usage/RM-1,RM-2,RM-1,,RM-3,RM-4,RM-5,RM-6,RM-7")).toEqual(["RM-1", "RM-2", "RM-3", "RM-4", "RM-5", "RM-6"]);
    expect(codesFromHash("products")).toEqual([]);
  });
});
