import { describe, expect, it } from "vitest";
import type { SKU } from "@/types/sku";
import type { Price } from "@/types/price";
import { BOM_SUPPLIER_ID } from "@/lib/bom-price-sync";
import { summarizeProduct, unitLooksOff, type ProductContext } from "./product-health";

const sku = (id: string, type: SKU["type"], extra: Partial<SKU> = {}): SKU =>
  ({ id, skuId: id, name: id, type, category: "VG", status: "Active", usageUom: "ก.", packSize: 1000, converter: 1, ...extra }) as SKU;
const price = (skuId: string, perUnit: number, extra: Partial<Price> = {}): Price =>
  ({ id: `p-${skuId}-${perUnit}`, skuId, supplierId: "fk", pricePerPurchaseUom: perUnit * 1000, pricePerUsageUom: perUnit, vat: false, isActive: true, effectiveDate: "2026-03-09", note: "", ...extra }) as Price;

const onion = sku("RM-0027", "RM");
const soup = sku("SM-0051", "SM");
const base = (over: Partial<ProductContext> = {}): ProductContext => ({
  skus: [onion, soup],
  prices: [price("RM-0027", 0.1), price("SM-0051", 0.01, { supplierId: BOM_SUPPLIER_ID })],
  book: { headers: [{ id: "h", smSkuId: "SM-0051", bomMode: "simple", batchSize: 1000, yieldPercent: 1 }], lines: [{ bomHeaderId: "h", rmSkuId: "RM-0027", qtyPerBatch: 100 }], steps: [], byproducts: [], spLines: [] },
  menuLines: [{ menuId: "m1", skuId: "RM-0027" }],
  activeMenuIds: new Set(["m1"]),
  bills: [],
  ...over,
});
const ids = (s: ReturnType<typeof summarizeProduct>) => s.checks.map((c) => `${c.id}:${c.level}`);

describe("summarizeProduct", () => {
  it("a well set up item is ok and knows where it is used", () => {
    const s = summarizeProduct(onion, base());
    expect(s.level).toBe("ok");
    expect(s.usage).toEqual({ inSm: ["SM-0051"], inSp: [], inMenus: ["m1"], inRules: 0 });
    expect(s.standard?.pricePerUsageUom).toBe(0.1);
  });

  it("bills far from the standard price (ต้นหอมไทย ฿100 vs ฿220-230)", () => {
    const bills = [0.22, 0.22, 0.23, 0.115].map((u, i) => ({ skuId: "RM-0027", supplierId: "fk", date: `2026-10-1${6 - i}`, unitPrice: u, stdUnitPrice: 0.1, qty: 1000 }));
    const s = summarizeProduct(onion, base({ bills }));
    expect(s.billRatio).toBeCloseTo(2.233, 2);
    expect(ids(s)).toEqual(["bill-drift:warn"]);
    expect(s.checks[0].title).toBe("บิลล่าสุดแพงกว่าราคาที่ตั้งไว้ 123%");
  });

  it("bills are per purchase unit: an item bought by the kg and used in grams", () => {
    const kg = { ...onion, packSize: 1, converter: 1000, purchaseUom: "กก.", usageUom: "ก." } as SKU;
    const bills = [{ skuId: "RM-0027", supplierId: "fk", date: "2026-10-16", unitPrice: 220, stdUnitPrice: 0.1, qty: 2 }];
    const s = summarizeProduct(kg, base({ skus: [kg, soup], prices: [price("RM-0027", 0.1, { pricePerPurchaseUom: 100 })], bills }));
    expect(s.billRatio).toBeCloseTo(2.2);
  });

  it("no price: an error when used, a warning when not", () => {
    expect(ids(summarizeProduct(onion, base({ prices: [] })))).toEqual(["no-price:error"]);
    expect(ids(summarizeProduct(onion, base({ prices: [], menuLines: [], book: { headers: [], lines: [], steps: [], byproducts: [], spLines: [] }, bills: [{ skuId: "RM-0027", supplierId: "fk", date: "2026-10-01", unitPrice: 0, stdUnitPrice: 0, qty: 1 }] })))).toEqual(["no-price:warn"]);
  });

  it("two suppliers' active prices are normal: the newest is the standard", () => {
    const s = summarizeProduct(onion, base({ prices: [price("RM-0027", 0.12, { supplierId: "makro" }), price("RM-0027", 0.1)] }));
    expect(ids(s)).toEqual([]);
    expect(s.standard?.supplierId).toBe("makro");
  });

  it("SM: no recipe, recipe with a switched-off item, and a saved cost behind the recipe", () => {
    expect(ids(summarizeProduct(soup, base({ book: { headers: [], lines: [], steps: [], byproducts: [], spLines: [] } })))).toEqual(["no-recipe:error"]);
    expect(ids(summarizeProduct(soup, base({ skus: [{ ...onion, status: "Inactive" }, soup] })))).toContain("recipe-inactive:error");
    // recipe: 100 g × 0.1 / 1000 g = 0.01 = saved → fine; at 0.2 the saved 0.01 is stale
    expect(ids(summarizeProduct(soup, base()))).toEqual([]);
    expect(ids(summarizeProduct(soup, base({ prices: [price("RM-0027", 0.2), price("SM-0051", 0.01, { supplierId: BOM_SUPPLIER_ID })] })))).toEqual(["stale-cost:warn"]);
  });

  it("a tracked by-product isn't 'no recipe': it comes from its parent (น้ำสต๊อกโทริ ไพตัน ← SM-0010)", () => {
    const stock = sku("SM-0016", "SM");
    const ctx = base({
      skus: [onion, soup, stock],
      book: { ...base().book, byproducts: [{ bomHeaderId: "h", skuId: "SM-0016", outputQty: 100, costAllocationPct: 50, tracksInventory: true }] },
      prices: [price("RM-0027", 0.1), price("SM-0051", 0.005, { supplierId: BOM_SUPPLIER_ID }), price("SM-0016", 0.05, { supplierId: BOM_SUPPLIER_ID })],
    });
    const s = summarizeProduct(stock, ctx);
    expect(s.madeFrom).toEqual(["SM-0051"]);
    expect(s.recipeCost).toBeCloseTo(0.05); // 100 g × 0.1 × 50% / 100 g
    expect(ids(s)).toEqual([]);
  });

  it("a recipe never costed: itself 'not costed yet', and recipes using it don't call it 'no price'", () => {
    // SM-0051 has a recipe but no saved price; SM-0099 uses SM-0051
    const top = sku("SM-0099", "SM");
    const ctx = base({
      skus: [onion, soup, top],
      prices: [price("RM-0027", 0.1)],
      book: {
        ...base().book,
        headers: [...base().book.headers, { id: "h2", smSkuId: "SM-0099", bomMode: "simple", batchSize: 100, yieldPercent: 1 }],
        lines: [...base().book.lines, { bomHeaderId: "h2", rmSkuId: "SM-0051", qtyPerBatch: 100 }],
      },
    });
    expect(summarizeProduct(soup, ctx).checks.map((c) => c.title)).toEqual(["ยังไม่ได้คิดต้นทุนจากสูตร"]);
    expect(ids(summarizeProduct(top, ctx))).toEqual(["stale-cost:warn"]);
  });

  it("switched off but still in a recipe", () => {
    expect(ids(summarizeProduct({ ...onion, status: "Inactive" }, base()))).toEqual(["inactive-used:error"]);
  });

  it("used by a modifier rule or bought by a branch = not idle; unknown while bills load", () => {
    const loose = { menuLines: [], book: { headers: [], lines: [], steps: [], byproducts: [], spLines: [] } };
    expect(summarizeProduct(onion, base({ ...loose, ruleSkuIds: new Set(["RM-0027"]) })).level).toBe("ok");
    expect(summarizeProduct(onion, base({ ...loose, branchBought: new Set(["RM-0027"]) })).level).toBe("ok");
    expect(summarizeProduct(onion, base({ ...loose, bills: null })).level).toBe("ok");
  });

  it("not used and not bought = idle", () => {
    const s = summarizeProduct(onion, base({ menuLines: [], book: { headers: [], lines: [], steps: [], byproducts: [], spLines: [] } }));
    expect(s.level).toBe("idle");
  });
});

describe("unitLooksOff", () => {
  const skus = ["a", "b", "c", "d", "e"].map((id) => sku(id, "RM"));
  const prices = [0.03, 0.05, 0.1, 0.2, 0.5].map((v, i) => price(skus[i].id, v));
  it("฿60 a gram for a vegetable is off (1 ถุง = 1 ก. mistake)", () => {
    expect(unitLooksOff(60, "VG", skus, prices)?.ratio).toBe(600);
  });
  it("a normal price passes; too few to compare passes", () => {
    expect(unitLooksOff(0.12, "VG", skus, prices)).toBeNull();
    expect(unitLooksOff(60, "VG", skus.slice(0, 3), prices)).toBeNull();
  });
});
