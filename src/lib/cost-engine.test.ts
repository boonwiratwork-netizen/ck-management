import { describe, expect, it } from "vitest";
import { affectedRecipes, recost, smCost, spCost, type RecipeBook } from "./cost-engine";

const prices: Record<string, number> = {
  "RM-0047": 0.522, "RM-0165": 0.095, "RM-0195": 0.025, "RM-0048": 0.74, "RM-0198": 0.045, "RM-0196": 0.11, "RM-0199": 0.032, "RM-0197": 0.094,
};
const priceOf = (id: string) => prices[id] ?? 0;
const tonkotsu = { id: "h1", smSkuId: "SM-0051", bomMode: "simple", batchSize: 33000, yieldPercent: 1 };
const tonkotsuLines = [
  ["RM-0047", 80, 1], ["RM-0165", 1000, 0.9], ["RM-0195", 30000, 1], ["RM-0048", 250, 1],
  ["RM-0198", 2000, 0.9], ["RM-0196", 6000, 1], ["RM-0199", 2000, 1], ["RM-0197", 4000, 1],
].map(([rmSkuId, qtyPerBatch, yieldPercent]) => ({ bomHeaderId: "h1", rmSkuId: rmSkuId as string, qtyPerBatch: qtyPerBatch as number, yieldPercent: yieldPercent as number }));

describe("smCost", () => {
  it("simple recipe: the real ซุปทงคตสึ (live data, 25 Oct)", () => {
    const r = smCost(tonkotsu, tonkotsuLines, [], [], priceOf);
    expect(r.batchCost).toBeCloseTo(2282.32, 2);
    expect(r.output).toBe(33000);
    expect(r.costPerUnit * 3000).toBeCloseTo(207.48, 2); // a 3 kg pack
  });

  it("by-products take their share and get their own cost", () => {
    const r = smCost({ ...tonkotsu, batchSize: 1000 }, [{ bomHeaderId: "h1", rmSkuId: "x", qtyPerBatch: 1000 }], [], [{ bomHeaderId: "h1", skuId: "oil", outputQty: 200, costAllocationPct: 20, tracksInventory: true }], () => 1);
    expect(r.batchCost).toBe(1000);
    expect(r.costPerUnit).toBeCloseTo(0.8); // 80% of 1000 over 1000 g
    expect(r.byproducts).toEqual([{ skuId: "oil", costPerUnit: 1 }]); // 20% of 1000 over 200 g
  });

  it("multi-step: step 1 input is its fixed lines, percent lines are a share of it, outputs chain", () => {
    const h = { id: "h2", smSkuId: "SM-X", bomMode: "multistep", batchSize: 0, yieldPercent: 1 };
    const steps = [
      { id: "s1", bomHeaderId: "h2", stepNumber: 1, yieldPercent: 0.5 },
      { id: "s2", bomHeaderId: "h2", stepNumber: 2, yieldPercent: 1 },
    ];
    const lines = [
      { bomHeaderId: "h2", rmSkuId: "meat", qtyPerBatch: 1000, stepId: "s1", qtyType: "fixed" },
      { bomHeaderId: "h2", rmSkuId: "salt", qtyPerBatch: 999, stepId: "s1", qtyType: "percent", percentOfInput: 0.02 },
      { bomHeaderId: "h2", rmSkuId: "sauce", qtyPerBatch: 100, stepId: "s2", qtyType: "fixed" },
    ];
    const r = smCost(h, lines, steps, [], (id) => ({ meat: 0.2, salt: 0.01, sauce: 0.05 })[id] ?? 0);
    // step 1: 1000 + 20 g salt = 1020 × 0.5 = 510 · step 2: 510 + 100 = 610
    expect(r.output).toBe(610);
    expect(r.batchCost).toBeCloseTo(200 + 0.2 + 5, 6);
  });
});

describe("spCost", () => {
  it("batch cost over what one batch makes", () => {
    const r = spCost([
      { spSkuId: "SP-1", ingredientSkuId: "a", qtyPerBatch: 500, batchYieldQty: 1000 },
      { spSkuId: "SP-1", ingredientSkuId: "b", qtyPerBatch: 100, batchYieldQty: 1000 },
    ], (id) => ({ a: 0.1, b: 1 })[id] ?? 0);
    expect(r.batchCost).toBe(150);
    expect(r.costPerUnit).toBe(0.15);
  });
});

describe("affectedRecipes / recost", () => {
  // RM r → SM a → SM b → SP p ; SM c unrelated
  const book: RecipeBook = {
    headers: [
      { id: "ha", smSkuId: "a", bomMode: "simple", batchSize: 100, yieldPercent: 1 },
      { id: "hb", smSkuId: "b", bomMode: "simple", batchSize: 100, yieldPercent: 1 },
      { id: "hc", smSkuId: "c", bomMode: "simple", batchSize: 100, yieldPercent: 1 },
    ],
    lines: [
      { bomHeaderId: "ha", rmSkuId: "r", qtyPerBatch: 100 },
      { bomHeaderId: "hb", rmSkuId: "a", qtyPerBatch: 50 },
      { bomHeaderId: "hb", rmSkuId: "r", qtyPerBatch: 50 },
      { bomHeaderId: "hc", rmSkuId: "z", qtyPerBatch: 100 },
    ],
    steps: [],
    byproducts: [],
    spLines: [{ spSkuId: "p", ingredientSkuId: "b", qtyPerBatch: 10, batchYieldQty: 10 }],
  };

  it("follows the chain in build order and skips unrelated recipes", () => {
    expect(affectedRecipes(["r"], book)).toEqual(["a", "b", "p"]);
    expect(affectedRecipes(["z"], book)).toEqual(["c"]);
    expect(affectedRecipes(["nothing"], book)).toEqual([]);
  });

  it("a changed recipe recomputes itself and what uses it", () => {
    expect(affectedRecipes(["b"], book)).toEqual(["b", "p"]);
  });

  it("a recipe inside another uses its fresh cost", () => {
    const out = recost(["r"], book, new Map([["r", 2], ["a", 1], ["b", 1], ["p", 1]]));
    expect(out.get("a")).toBe(2); // 100 × 2 / 100
    expect(out.get("b")).toBe(2); // (50 × 2 + 50 × 2) / 100
    expect(out.get("p")).toBe(2);
  });

  it("a by-product follows its parent, and recipes using the by-product follow it", () => {
    // RM chicken → SM breast (by-product bones, 50% of cost) → bones → SM stock
    const b2: RecipeBook = {
      headers: [
        { id: "hbr", smSkuId: "breast", bomMode: "simple", batchSize: 100, yieldPercent: 1 },
        { id: "hst", smSkuId: "stock", bomMode: "simple", batchSize: 100, yieldPercent: 1 },
      ],
      lines: [
        { bomHeaderId: "hbr", rmSkuId: "chicken", qtyPerBatch: 200 },
        { bomHeaderId: "hst", rmSkuId: "bones", qtyPerBatch: 100 },
      ],
      steps: [],
      byproducts: [{ bomHeaderId: "hbr", skuId: "bones", outputQty: 100, costAllocationPct: 50, tracksInventory: true }],
      spLines: [],
    };
    expect(affectedRecipes(["chicken"], b2)).toEqual(["breast", "bones", "stock"]);
    const out = recost(["chicken"], b2, new Map([["chicken", 1]]));
    expect(out.get("breast")).toBe(1); // 200 × 50% / 100
    expect(out.get("bones")).toBe(1); // 200 × 50% / 100
    expect(out.get("stock")).toBe(1); // 100 × 1 / 100
  });

  it("an emptied recipe keeps its last cost and recipes built on it don't drop to ฿0", () => {
    const emptied: RecipeBook = { ...book, lines: book.lines.filter((l) => l.bomHeaderId !== "ha") };
    const out = recost(["r", "a"], emptied, new Map([["r", 2], ["a", 3], ["b", 1], ["p", 1]]));
    expect(out.has("a")).toBe(false);
    expect(out.get("b")).toBe(2.5); // (50 × 3 + 50 × 2) / 100, with a's last cost
  });

  it("an ingredient with no price: the recipe keeps its last cost instead of saving a lower one", () => {
    const out = recost(["r"], book, new Map([["a", 1], ["b", 1], ["p", 1]])); // r has no price
    expect(out.has("a")).toBe(false);
    expect(out.has("b")).toBe(false);
  });

  it("recipes that loop are left out instead of hanging", () => {
    const loop: RecipeBook = { ...book, lines: [...book.lines, { bomHeaderId: "ha", rmSkuId: "b", qtyPerBatch: 1 }] };
    const order = affectedRecipes(["r"], loop);
    expect(order).not.toContain("a");
    expect(order).not.toContain("b");
  });
});
