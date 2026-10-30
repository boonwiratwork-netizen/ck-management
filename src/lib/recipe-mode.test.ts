import { describe, it, expect } from "vitest";
import { toMultistep, toSimple } from "./recipe-mode";
import { resolveSm, resolveSteps } from "./cost-engine";
import type { BOMHeader, BOMLine, BOMStep } from "@/types/bom";

const h = (bomMode: "simple" | "multistep", batchSize = 0, yieldPercent = 1): BOMHeader => ({ id: "h", smSkuId: "sm", productionType: "CK", bomMode, batchSize, yieldPercent });
const price: Record<string, number> = { pork: 0.135, shoyu: 0.13, wood: 0.36, garlic: 0.08 };
const cost = (hd: BOMHeader, ls: BOMLine[], st: BOMStep[]) => resolveSm(hd, ls, st).lines.reduce((s, x) => s + x.qty * price[x.line.rmSkuId], 0);

// สันนอกชาชู as it is set up: trim 82% → sous vide 90% (+12% shoyu) → smoke (+1% wood)
const steps: BOMStep[] = [
  { id: "s1", bomHeaderId: "h", stepNumber: 1, stepName: "trim", yieldPercent: 0.82 },
  { id: "s2", bomHeaderId: "h", stepNumber: 2, stepName: "sous vide", yieldPercent: 0.9 },
  { id: "s3", bomHeaderId: "h", stepNumber: 3, stepName: "smoke", yieldPercent: 0.9999 },
];
const lines: BOMLine[] = [
  { id: "a", bomHeaderId: "h", rmSkuId: "pork", qtyPerBatch: 1000, yieldPercent: 1, stepId: "s1", qtyType: "fixed" },
  { id: "b", bomHeaderId: "h", rmSkuId: "shoyu", qtyPerBatch: 98.4, yieldPercent: 1, stepId: "s2", qtyType: "percent", percentOfInput: 0.12 },
  { id: "c", bomHeaderId: "h", rmSkuId: "wood", qtyPerBatch: 9, yieldPercent: 1, stepId: "s3", qtyType: "percent", percentOfInput: 0.01 },
];

describe("resolveSteps", () => {
  it("each step: in = last out + its lines, out = in × yield; percent lines against the last step's output", () => {
    const r = resolveSteps(lines, steps);
    expect(r[0].input).toBe(1000);
    expect(r[0].output).toBeCloseTo(820);
    expect(r[1].lines[0].qty).toBeCloseTo(98.4);
    expect(r[1].input).toBeCloseTo(918.4);
    expect(r[2].lines[0].qty).toBeCloseTo(8.2656);
  });
});

describe("switching how a recipe is made keeps its cost and its output", () => {
  it("multi-step → simple", () => {
    const m = h("multistep");
    const s = toSimple(m, lines, steps);
    const after = lines.map((l) => ({ ...l, ...s.lines.find((u) => u.id === l.id) })) as BOMLine[];
    const sh = h("simple", s.batchSize, s.yieldPercent);
    expect(resolveSm(sh, after, []).output).toBeCloseTo(resolveSm(m, lines, steps).output);
    expect(cost(sh, after, [])).toBeCloseTo(cost(m, lines, steps));
  });

  it("simple → multi-step (line yields move into the step)", () => {
    const sh = h("simple", 5000, 0.9);
    const simple: BOMLine[] = [
      { id: "a", bomHeaderId: "h", rmSkuId: "pork", qtyPerBatch: 4000, yieldPercent: 0.8 },
      { id: "d", bomHeaderId: "h", rmSkuId: "garlic", qtyPerBatch: 100, yieldPercent: 0.55 },
    ];
    const m = toMultistep(sh, simple);
    const step: BOMStep = { id: "n1", bomHeaderId: "h", stepNumber: 1, stepName: "ขั้นที่ 1", yieldPercent: m.stepYield };
    const after = simple.map((l) => ({ ...l, ...m.lines.find((u) => u.id === l.id), stepId: "n1" })) as BOMLine[];
    const mh = h("multistep", 5000, 0.9);
    expect(resolveSm(mh, after, [step]).output).toBeCloseTo(4500);
    expect(cost(mh, after, [step])).toBeCloseTo(cost(sh, simple, []));
  });
});
