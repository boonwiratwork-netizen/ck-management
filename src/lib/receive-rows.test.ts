import { describe, it, expect } from "vitest";
import {
  supplierRow,
  transferOrderRow,
  kitchenAdHocRow,
  branchTransferRow,
  transferOrderStatusAfter,
  qtyFromPacks,
  packsFromQty,
  stdUnitPriceFor,
} from "./receive-rows";
import type { SKU } from "@/types/sku";
import type { Price } from "@/types/price";

/*
 * Parity with the old pages. Each "old*" function below is the old page's row
 * formula, copied from BranchReceipt.tsx / BranchReceiptMobile.tsx as of 25 Oct
 * 2026, so the rows the new page writes can be compared field by field.
 */
const sku = (p: Partial<SKU>) => ({ id: "s1", skuId: "RM-0001", name: "x", purchaseUom: "ก.", usageUom: "ก.", packSize: 1000, packUnit: "แพ็ค", ...p }) as SKU;
const base = { branchId: "b1", receiptDate: "2026-10-25" };

// BranchReceipt.tsx external save (desktop)
function oldDesktopExternal(s: SKU, qty: number, std: number, edited: boolean, typedTotal: number, note: string) {
  const actualTotal = edited ? typedTotal : std * qty;
  const actualUnitPrice = qty > 0 ? actualTotal / qty : 0;
  const stdTotal = qty * std;
  return { ...base, skuId: s.id, supplierName: "Makro", qtyReceived: qty, uom: s.purchaseUom || "", actualUnitPrice, actualTotal, stdUnitPrice: std, stdTotal, priceVariance: actualTotal - stdTotal, notes: note, transferOrderId: null };
}
// BranchReceiptMobile.tsx save
function oldMobile(s: SKU, qty: number, std: number, invoicePrice: number, rawName?: string) {
  const stdTotal = qty * std;
  let actualUnitPrice: number, actualTotal: number, priceVariance: number;
  if (invoicePrice > 0) {
    actualUnitPrice = invoicePrice / Math.max(1, s.packSize || 1);
    actualTotal = qty * actualUnitPrice;
    priceVariance = actualTotal - stdTotal;
  } else {
    actualUnitPrice = std;
    actualTotal = stdTotal;
    priceVariance = 0;
  }
  return { ...base, skuId: s.id, supplierName: "Makro", qtyReceived: qty, uom: s.purchaseUom ?? "", actualUnitPrice, actualTotal, stdUnitPrice: std, stdTotal, priceVariance, notes: rawName ?? "", transferOrderId: null };
}

describe("supplierRow matches the old pages", () => {
  const cases = [
    { s: sku({}), packs: 3, std: 0.12 },
    { s: sku({ packSize: 1, packUnit: "" }), packs: 7.5, std: 4 },
    { s: sku({ packSize: 12, packUnit: "กล่อง", purchaseUom: "กล่อง" }), packs: 2, std: 36.67 },
    { s: sku({ purchaseUom: "" }), packs: 1, std: 0 },
  ];
  for (const c of cases) {
    const qty = qtyFromPacks(c.s, c.packs);
    it(`desktop, priced at standard · ${c.s.packSize}/${c.s.packUnit}`, () => {
      expect(supplierRow({ ...base, supplierName: "Makro", sku: c.s, qty, stdUnitPrice: c.std, note: "n" })).toEqual(oldDesktopExternal(c.s, qty, c.std, false, 0, "n"));
    });
    it(`desktop, typed line total · ${c.s.packSize}/${c.s.packUnit}`, () => {
      expect(supplierRow({ ...base, supplierName: "Makro", sku: c.s, qty, stdUnitPrice: c.std, lineTotal: 512.5, note: "n" })).toEqual(oldDesktopExternal(c.s, qty, c.std, true, 512.5, "n"));
    });
    it(`phone, invoice price per pack · ${c.s.packSize}/${c.s.packUnit}`, () => {
      expect(supplierRow({ ...base, supplierName: "Makro", sku: c.s, qty, stdUnitPrice: c.std, invoicePrice: 127, note: "AI: หมูบด" })).toEqual(oldMobile(c.s, qty, c.std, 127, "AI: หมูบด"));
    });
    it(`phone, no price · ${c.s.packSize}/${c.s.packUnit}`, () => {
      expect(supplierRow({ ...base, supplierName: "Makro", sku: c.s, qty, stdUnitPrice: c.std, note: "" })).toEqual(oldMobile(c.s, qty, c.std, 0, ""));
    });
  }
});

describe("kitchen and branch rows match the old page", () => {
  it("transfer order line", () => {
    const s = sku({ usageUom: "ก." });
    // old: uom sku.usageUom || line.uom || "น.", unit = TO unit cost, no variance
    expect(transferOrderRow({ ...base, sku: s, skuId: s.id, lineUom: "kg", qty: 4000, unitCost: 0.05, note: "", transferOrderId: "to1" })).toEqual({
      ...base, skuId: "s1", supplierName: "Central Kitchen", qtyReceived: 4000, uom: "ก.", actualUnitPrice: 0.05, actualTotal: 200, stdUnitPrice: 0.05, stdTotal: 200, priceVariance: 0, notes: "", transferOrderId: "to1",
    });
    expect(transferOrderRow({ ...base, sku: undefined, skuId: "gone", lineUom: "", qty: 1, unitCost: 2, note: "x", transferOrderId: "to1" }).uom).toBe("น.");
  });
  it("kitchen goods without a transfer order", () => {
    const s = sku({ usageUom: "" });
    expect(kitchenAdHocRow({ ...base, sku: s, qty: 3, stdUnitPrice: 10, note: "" })).toMatchObject({ supplierName: "Central Kitchen", uom: "น.", actualTotal: 30, stdTotal: 30, priceVariance: 0, transferOrderId: null });
  });
  it("from another branch", () => {
    const s = sku({ usageUom: "" });
    expect(branchTransferRow({ ...base, fromBranchName: "Shiro", sku: s, qty: 2, stdUnitPrice: 5, note: "" })).toMatchObject({ supplierName: "รับจากสาขา · Shiro", uom: "", actualUnitPrice: 5, actualTotal: 10, priceVariance: 0 });
  });
});

describe("packs and prices", () => {
  it("converts packs like the old pages", () => {
    expect(qtyFromPacks(sku({}), 3)).toBe(3000);
    expect(qtyFromPacks(sku({ packUnit: "" }), 3)).toBe(3);
    expect(packsFromQty(sku({}), 2600)).toBe(3);
  });
  it("standard price prefers this supplier's", () => {
    const prices = [
      { skuId: "s1", supplierId: "other", pricePerUsageUom: 1, isActive: true },
      { skuId: "s1", supplierId: "makro", pricePerUsageUom: 2, isActive: true },
    ] as Price[];
    expect(stdUnitPriceFor(prices, "s1", "makro")).toBe(2);
    expect(stdUnitPriceFor(prices, "s1", "nobody")).toBe(1);
    expect(stdUnitPriceFor(prices, "s1")).toBe(1);
  });
});

describe("transfer order status", () => {
  const lines = [{ id: "a", plannedQty: 4 }, { id: "b", plannedQty: 2 }];
  it("all received", () => expect(transferOrderStatusAfter(lines, new Map([["a", 4], ["b", 2]]))).toBe("Received"));
  it("short line", () => expect(transferOrderStatusAfter(lines, new Map([["a", 4], ["b", 1]]))).toBe("Partially Received"));
  it("one line in full, the other none → partial, not still waiting (old bug)", () =>
    expect(transferOrderStatusAfter(lines, new Map([["a", 4]]))).toBe("Partially Received"));
  it("nothing received", () => expect(transferOrderStatusAfter(lines, new Map())).toBe("Sent"));
  it("compares with what the kitchen sent, not what was asked", () =>
    expect(transferOrderStatusAfter([{ id: "a", plannedQty: 2000, actualQty: 1000 }], new Map([["a", 1000]]))).toBe("Received"));
  it("weighing up to 10% under still counts as received", () =>
    expect(transferOrderStatusAfter([{ id: "a", plannedQty: 1750, actualQty: 1880 }], new Map([["a", 1750]]))).toBe("Received"));
});
