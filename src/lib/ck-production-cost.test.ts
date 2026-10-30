import { describe, it, expect } from "vitest";
import { productionCost, topWithOthers, type Recipe } from "./ck-production-cost";

// Soup A uses bones (RM) + stock (SM); soup B uses bones too
const recipes = new Map<string, Recipe>([
  ["soupA", { smSkuId: "soupA", outputPerBatch: 10000, lines: [{ skuId: "bones", qty: 5000 }, { skuId: "stock", qty: 2000 }] }],
  ["soupB", { smSkuId: "soupB", outputPerBatch: 20000, lines: [{ skuId: "bones", qty: 5000 }] }],
]);
const std: Record<string, number> = { bones: 0.03, stock: 0.05 };
const base = {
  recipes,
  isRm: (id: string) => id === "bones",
  stdPrice: (id: string) => std[id] ?? 0,
  actPrice: (id: string) => (id === "bones" ? 0.033 : std[id] ?? 0),
};

describe("productionCost", () => {
  // A made 2 runs (20 kg), B made 1 run (20 kg): bones expected 10,000 + 5,000
  const r = productionCost({
    ...base,
    produced: [
      { smSkuId: "soupA", outputG: 20000 },
      { smSkuId: "soupB", outputG: 20000 },
    ],
    rmFlow: new Map([["bones", { opening: 4000, bought: 20000, toBranches: 1000, closing: 5000 }]]),
  });

  it("recipe cost is the raw materials for the runs made; a kitchen-made ingredient is listed, not added (no double count)", () => {
    const a = r.rows.find((x) => x.smSkuId === "soupA")!;
    expect(a.runs).toBe(2);
    expect(a.stdCost).toBeCloseTo(10000 * 0.03);
    expect(a.lines.find((l) => l.skuId === "stock")).toMatchObject({ isRm: false, expected: 4000, actual: null });
  });

  it("a raw material missing from a count is taken as the recipe says", () => {
    const u = productionCost({ ...base, produced: [{ smSkuId: "soupB", outputG: 20000 }], rmFlow: new Map([["bones", { opening: 0, bought: 0, toBranches: 0, closing: 0 }]]), uncounted: new Set(["bones"]) });
    expect(u.rows[0].lines[0].actual).toBe(5000);
    expect(u.usageVar).toBe(0);
  });

  it("shares the bones really used (opening + bought − closing − to branches) by what each should have used", () => {
    expect(r.rmUsed.get("bones")).toBe(18000);
    const a = r.rows.find((x) => x.smSkuId === "soupA")!;
    const b = r.rows.find((x) => x.smSkuId === "soupB")!;
    expect(a.lines.find((l) => l.skuId === "bones")!.actual).toBeCloseTo(12000);
    expect(b.lines.find((l) => l.skuId === "bones")!.actual).toBeCloseTo(6000);
    // A: 12,000 × 0.033 (raw materials only)
    expect(a.actCost).toBeCloseTo(396);
  });

  it("splits the difference into price and usage", () => {
    const a = r.rows.find((x) => x.smSkuId === "soupA")!;
    expect(a.priceVar).toBeCloseTo(0.003 * 12000);
    expect(a.usageVar).toBeCloseTo((12000 - 10000) * 0.03);
    expect(a.actCost - a.stdCost).toBeCloseTo(a.priceVar + a.usageVar);
  });

  it("keeps a negative use as it is (a missing receipt or count)", () => {
    const n = productionCost({ ...base, produced: [{ smSkuId: "soupB", outputG: 20000 }], rmFlow: new Map([["bones", { opening: 0, bought: 0, toBranches: 0, closing: 100 }]]) });
    expect(n.rmUsed.get("bones")).toBe(-100);
  });
});

describe("topWithOthers", () => {
  it("adds up to the total", () => {
    const items = [5, 4, 3, 2, 1, 1, 1].map((v, i) => ({ name: `s${i}`, value: v }));
    const t = topWithOthers(items, 5);
    expect(t).toHaveLength(6);
    expect(t.reduce((s, x) => s + x.value, 0)).toBe(17);
    expect(t[5].name).toBe("อื่นๆ (2)");
  });
});
