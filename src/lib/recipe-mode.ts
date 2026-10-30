/**
 * Switching an SM recipe between "ทำรวดเดียว" (simple) and "ทำทีละขั้น" (multi-step)
 * without changing what it costs or what a batch gives: every line keeps the amount
 * a batch really takes, and the yield is set so the output stays the same.
 */
import type { BOMHeader, BOMLine, BOMStep } from "@/types/bom";
import { resolveSm } from "./cost-engine";

export type LineUpdate = { id: string } & Partial<Omit<BOMLine, "id" | "bomHeaderId">>;

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

/** Simple → one step holding every line at the amount bought (line yields become the step's) */
export function toMultistep(header: BOMHeader, lines: BOMLine[]): { stepYield: number; lines: LineUpdate[] } {
  const r = resolveSm(header, lines, []);
  const bought = sum(r.lines.map((x) => x.qty));
  return {
    stepYield: bought > 0 ? r.output / bought : 1,
    lines: r.lines.map((x) => ({ id: (x.line as BOMLine).id, qtyPerBatch: x.qty, yieldPercent: 1, qtyType: "fixed", percentOfInput: null })),
  };
}

/** Multi-step → one list: each line at what a batch takes; a batch makes what the last step gave (at 100%) */
export function toSimple(header: BOMHeader, lines: BOMLine[], steps: BOMStep[]): { batchSize: number; yieldPercent: number; lines: LineUpdate[] } {
  const r = resolveSm(header, lines, steps);
  // Lines left outside any step never counted: they go in at their own amount
  const loose = lines.filter((l) => !r.lines.some((x) => x.line === l));
  const all = [...r.lines.map((x) => ({ id: (x.line as BOMLine).id, qty: x.qty })), ...loose.map((l) => ({ id: l.id, qty: l.qtyPerBatch }))];
  return {
    // "ผลิตรอบละ 33,000 · ได้จริง 100%" reads plainer than 30,500 at 108%
    batchSize: r.output,
    yieldPercent: 1,
    lines: all.map((x) => ({ id: x.id, qtyPerBatch: x.qty, yieldPercent: 1, stepId: null, qtyType: null, percentOfInput: null })),
  };
}

/** A step line from grams to "% of what goes in" (or back), keeping the same amount */
export const gramsToPercent = (grams: number, base: number) => (base > 0 ? grams / base : 0);
export const percentToGrams = (fraction: number, base: number) => fraction * base;
