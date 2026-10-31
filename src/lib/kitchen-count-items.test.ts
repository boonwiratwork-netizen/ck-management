import { describe, expect, it } from "vitest";
import { countsInKitchenSheet } from "./kitchen-count-items";

const r = { smWithBom: new Set(["stock"]), rmInBom: new Set(["bone"]), trackedByproducts: new Set(["paitan"]) };
const sku = (id: string, type: string, status = "Active", isDistributable = false) => ({ id, type, status, isDistributable }) as never;

describe("countsInKitchenSheet", () => {
  it("lists a by-product kept in stock even though it has no recipe of its own", () => {
    expect(countsInKitchenSheet(sku("paitan", "SM"), r)).toBe(true);
    expect(countsInKitchenSheet(sku("other", "SM"), r)).toBe(false);
  });
  it("keeps the old rules for the rest", () => {
    expect(countsInKitchenSheet(sku("stock", "SM"), r)).toBe(true);
    expect(countsInKitchenSheet(sku("bone", "RM"), r)).toBe(true);
    expect(countsInKitchenSheet(sku("egg", "RM", "Active", true), r)).toBe(true);
    expect(countsInKitchenSheet(sku("egg", "RM"), r)).toBe(false);
    expect(countsInKitchenSheet(sku("box", "PK"), r)).toBe(true);
    expect(countsInKitchenSheet(sku("paitan", "SM", "Inactive"), r)).toBe(false);
  });
});
