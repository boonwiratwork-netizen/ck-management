import { describe, expect, it } from "vitest";
import type { BOMHeader, BOMLine, BOMStep } from "@/types/bom";
import { batchShare, batchesForRecord, daysTone, deltas, editMovesStock, editTarget, farFromUsual, gramsText, indirectNeed, ingredientsPerBatch, movementFor, planFacts, shareText, usualOutput } from "./production";

const header = (o: Partial<BOMHeader>): BOMHeader => ({ id: "h", smSkuId: "sm", productionType: "CK", bomMode: "simple", batchSize: 33000, yieldPercent: 1, ...o }) as BOMHeader;
const line = (o: Partial<BOMLine>): BOMLine => ({ id: Math.random().toString(), bomHeaderId: "h", rmSkuId: "bone", qtyPerBatch: 1000, yieldPercent: 1, ...o }) as BOMLine;

describe("ingredients per batch", () => {
  it("simple BOM: lines as they are", () => {
    expect(ingredientsPerBatch(header({}), [line({}), line({ rmSkuId: "salt", qtyPerBatch: 10 })], [])).toEqual([
      { skuId: "bone", qty: 1000 },
      { skuId: "salt", qty: 10 },
    ]);
  });
  it("simple BOM: takes the bought amount (100 g of garlic at 55% usable = 182 g out); old records read net", () => {
    const garlic = [line({ rmSkuId: "garlic", qtyPerBatch: 100, yieldPercent: 0.55 })];
    expect(ingredientsPerBatch(header({}), garlic, [])[0].qty).toBeCloseTo(181.82, 2);
    expect(ingredientsPerBatch(header({}), garlic, [], { gross: false })[0].qty).toBe(100);
  });
  it("multi-step: percent lines against the step input", () => {
    const steps: BOMStep[] = [
      { id: "s1", bomHeaderId: "h", stepNumber: 1, stepName: "a", yieldPercent: 0.5 } as BOMStep,
      { id: "s2", bomHeaderId: "h", stepNumber: 2, stepName: "b", yieldPercent: 1 } as BOMStep,
    ];
    const lines = [line({ stepId: "s1", qtyPerBatch: 2000 }), line({ stepId: "s2", rmSkuId: "sauce", qtyType: "percent", percentOfInput: 0.1, qtyPerBatch: 0 })];
    expect(ingredientsPerBatch(header({ bomMode: "multistep" }), lines, steps)).toEqual([
      { skuId: "bone", qty: 2000 },
      { skuId: "sauce", qty: 100 },
    ]);
  });
});

describe("raw material by the share actually made", () => {
  it("a small pot takes its share, not nothing; 24 kg is not a full 33 kg batch", () => {
    expect(batchShare(3500, 33000)).toBeCloseTo(0.106, 3);
    expect(batchShare(24000, 33000)).toBeCloseTo(0.727, 3);
    expect(batchesForRecord(3500, 33000)).toBe(1);
    expect(batchesForRecord(0, 33000)).toBe(0);
    expect(shareText(0.7272)).toBe("0.73");
    expect(shareText(2)).toBe("2");
  });
  it("movement and the change needed to reach it", () => {
    const want = movementFor([{ skuId: "bone", qty: 1000 }], [{ skuId: "fat", qty: 100 }], 0.5);
    expect([...want]).toEqual([
      ["bone", -500],
      ["fat", 50],
    ]);
    // a full batch was taken before; bring it to half
    expect(deltas(want, new Map([["bone", -1000], ["fat", 100]]))).toEqual([
      { skuId: "bone", qty: 500 },
      { skuId: "fat", qty: -50 },
    ]);
    // deleting the record = bring everything back to zero
    expect(deltas(new Map(), want)).toEqual([
      { skuId: "bone", qty: 500 },
      { skuId: "fat", qty: -50 },
    ]);
  });
});

describe("weekly plan", () => {
  it("days now/after and what to make", () => {
    const f = planFacts(470, 1653, 10, 3000);
    expect(f.daysNow).toBeCloseTo(3.5, 1);
    expect(f.daysAfter).toBeCloseTo(9.9, 1);
    expect(f.suggest).toBeCloseTo(3047, 0);
    expect(daysTone(3.5, 10, 470)).toBe("red");
    expect(daysTone(7, 10, 470)).toBe("amber");
    expect(daysTone(Infinity, 10, 0)).toBe("none");
  });
  it("planning a parent SM adds need to the SM inside it", () => {
    const need = indirectNeed({ soup: 66000 }, () => 33000, new Map([["soup", [{ childId: "stock", qtyPerBatch: 7000 }]]]));
    expect(need.stock).toBeCloseTo(2000, 0);
  });
  it("grams for people", () => {
    expect(gramsText(31900)).toBe("31.9 กก.");
    expect(gramsText(350)).toBe("350 ก.");
  });
});

describe("output far from usual", () => {
  const rec = (g: number, d: string) => ({ smSkuId: "soup", productionDate: d, actualOutputG: g });
  const recs = [33000, 32000, 34000, 33500, 31000].map((g, i) => rec(g, `2026-10-0${i + 1}`));
  it("the middle of the recent records", () => {
    expect(usualOutput(recs, "soup")).toBe(33000);
    expect(usualOutput(recs.slice(0, 4), "soup")).toBe(0);
  });
  it("asks only beyond 5 times either way", () => {
    expect(farFromUsual(3500, 33000)).toBe(true);
    expect(farFromUsual(200000, 33000)).toBe(true);
    expect(farFromUsual(16500, 33000)).toBe(false);
    expect(farFromUsual(3500, 0)).toBe(false);
  });
});

describe("editing a saved record", () => {
  // A record saved before the bought-amount rule (27 Oct 2026): 1 batch took the trimmed 100 g of garlic
  const garlic = [line({ rmSkuId: "garlic", qtyPerBatch: 100, yieldPercent: 0.55 })];
  const today = () => movementFor(ingredientsPerBatch(header({}), garlic, []), [], 1);
  const savedNet = new Map([["garlic", -100]]);

  it("a note alone, or the same numbers again, moves no stock", () => {
    const r = { actualOutputG: 33000, productionDate: "2026-10-26" };
    expect(editMovesStock(r, { ...r })).toBe(false);
    expect(editMovesStock(r, { ...r, actualOutputG: 30000 })).toBe(true);
    expect(editMovesStock(r, { ...r, productionDate: "2026-10-25" })).toBe(true);
  });

  it("an output change scales what that record took, by its own rule (not today's)", () => {
    // 33 kg → 16.5 kg: half of the 100 g it took, not half of today's 182 g
    expect([...editTarget(savedNet, 33000, 16500, today)]).toEqual([["garlic", -50]]);
    expect(deltas(editTarget(savedNet, 33000, 16500, today), savedNet)).toEqual([{ skuId: "garlic", qty: 50 }]);
    // Unchanged output (a day move): exactly what it has, nothing re-worked
    expect(deltas(editTarget(savedNet, 33000, 33000, today), savedNet)).toEqual([]);
    // What the old edit did: today's rule against net rows took 82 g more for a note change
    expect(deltas(today(), savedNet)[0].qty).toBeCloseTo(-81.82, 2);
  });

  it("by-products scale with it; today's recipe only when the record has nothing out or made nothing", () => {
    expect([...editTarget(new Map([["bone", -1000], ["fat", 120]]), 33000, 66000, today)]).toEqual([["bone", -2000], ["fat", 240]]);
    expect([...editTarget(new Map(), 33000, 16500, today)]).toEqual([...today()]);
    expect([...editTarget(savedNet, 0, 16500, today)]).toEqual([...today()]);
  });
});
