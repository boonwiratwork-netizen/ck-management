/**
 * Rules for the central kitchen's production (การผลิต), apart from the screens:
 * what one batch uses, how much raw material a record takes out, and the weekly
 * plan figures (daily need, how long stock lasts, what to make).
 */
import type { BOMHeader, BOMLine, BOMStep } from "@/types/bom";
import { resolveSm, resolveSteps } from "./cost-engine";

/**
 * What one batch takes out of stock. Simple recipes take the amount BOUGHT: the
 * recipe line is what goes in after trimming, so 100 g of garlic at 55% usable is
 * 182 g of whole garlic out of stock (the same as the recipe's cost). Until Oct 2026
 * production took the trimmed 100 g (`gross: false`), so stock stayed too high until
 * the monthly count; records saved then are still read that way.
 */
export function ingredientsPerBatch(header: BOMHeader, lines: BOMLine[], steps: BOMStep[], opts: { gross?: boolean } = {}): { skuId: string; qty: number }[] {
  const gross = opts.gross ?? true;
  const bLines = lines.filter((l) => l.bomHeaderId === header.id);
  const out: { skuId: string; qty: number }[] = [];
  if (header.bomMode === "multistep") {
    // The same steps the cost uses (percent lines against the step's base)
    for (const st of resolveSteps(bLines, steps.filter((s) => s.bomHeaderId === header.id))) for (const r of st.lines) out.push({ skuId: r.line.rmSkuId, qty: r.qty });
  } else {
    for (const line of bLines) {
      const y = line.yieldPercent ?? 1;
      out.push({ skuId: line.rmSkuId, qty: gross && y > 0 ? line.qtyPerBatch / y : line.qtyPerBatch });
    }
  }
  return out;
}

/**
 * What one batch makes — the figure production divides an output by to know how much
 * raw material it took (so every screen that compares with production uses this one).
 * Multi-step: the cost engine's steps (resolveSteps).
 */
export function outputPerBatch(header: BOMHeader, lines: BOMLine[], steps: BOMStep[]): number {
  const own = steps.filter((s) => s.bomHeaderId === header.id);
  if (header.bomMode !== "multistep" || own.length === 0) return header.batchSize * header.yieldPercent;
  return resolveSm(header, lines.filter((l) => l.bomHeaderId === header.id), own).output;
}

/**
 * How many batches an output is. Raw material comes out by this exact share (a
 * 3.5 kg pot from a 33 kg batch takes 0.11 of a batch) — it used to be rounded
 * to whole batches, so a small pot took nothing and 24 kg took a full 33 kg batch.
 */
export const batchShare = (outputG: number, perBatch: number) => (perBatch > 0 ? outputG / perBatch : 0);

/** The whole-batch count kept on the record (what screens show), at least 1 when something was made */
export const batchesForRecord = (outputG: number, perBatch: number) => (outputG > 0 && perBatch > 0 ? Math.max(1, Math.round(outputG / perBatch)) : 0);

/** Tag that ties stock adjustments to one production record */
export const recordTag = (recordId: string) => `[rec ${recordId}]`;

/** What a record should take out (negative) / put in (by-products, positive), by product */
export function movementFor(perBatch: { skuId: string; qty: number }[], byproducts: { skuId: string; qty: number }[], share: number): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of perBatch) m.set(l.skuId, (m.get(l.skuId) || 0) - l.qty * share);
  for (const b of byproducts) m.set(b.skuId, (m.get(b.skuId) || 0) + b.qty * share);
  return m;
}

/** Adjustments that bring `current` to `target` (only real differences) */
export function deltas(target: Map<string, number>, current: Map<string, number>): { skuId: string; qty: number }[] {
  const keys = new Set([...target.keys(), ...current.keys()]);
  const out: { skuId: string; qty: number }[] = [];
  for (const k of keys) {
    const d = (target.get(k) || 0) - (current.get(k) || 0);
    if (Math.abs(d) > 0.0001) out.push({ skuId: k, qty: d });
  }
  return out;
}

/** "0.73" / "1" for the adjustment reason */
export const shareText = (share: number) => (Math.abs(share - Math.round(share)) < 0.005 ? String(Math.round(share)) : share.toFixed(2));

// ─── Weekly plan ───

export interface PlanFacts {
  dailyNeed: number;
  stock: number;
  target: number;
  /** Days the stock lasts now / after the plan (Infinity when nothing is used) */
  daysNow: number;
  daysAfter: number;
  /** What to make so stock lasts `target` days */
  suggest: number;
}

export function planFacts(dailyNeed: number, stock: number, target: number, plan: number): PlanFacts {
  const daysNow = dailyNeed > 0 ? stock / dailyNeed : Infinity;
  const daysAfter = dailyNeed > 0 ? (stock + plan) / dailyNeed : Infinity;
  return { dailyNeed, stock, target, daysNow, daysAfter, suggest: dailyNeed > 0 ? Math.max(0, dailyNeed * target - stock) : 0 };
}

/** red: under half the target · amber: under the target · green: enough */
export function daysTone(days: number, target: number, dailyNeed: number): "red" | "amber" | "green" | "none" {
  if (dailyNeed <= 0) return "none";
  if (days < target * 0.5) return "red";
  if (days < target) return "amber";
  return "green";
}

/**
 * SM used inside other SM: planning a parent adds daily need to its children
 * (planned batches × qty per batch ÷ 7), as the old page did.
 */
export function indirectNeed(
  plan: Record<string, number>,
  perBatchOutput: (smId: string) => number,
  childrenOf: Map<string, { childId: string; qtyPerBatch: number }[]>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [parent, planned] of Object.entries(plan)) {
    const per = perBatchOutput(parent);
    if (planned <= 0 || per <= 0) continue;
    for (const c of childrenOf.get(parent) || []) out[c.childId] = (out[c.childId] || 0) + ((planned / per) * c.qtyPerBatch) / 7;
  }
  return out;
}

/** "1.2 กก." from 1,000 g up, else "350 ก." */
export function gramsText(g: number): string {
  const n = (v: number) => v.toLocaleString("th-TH", { maximumFractionDigits: 1 });
  return Math.abs(g) >= 1000 ? `${n(g / 1000)} กก.` : `${Math.round(g).toLocaleString("th-TH")} ก.`;
}

/**
 * What a pot of this SM usually comes out at: the middle of its last 20 records
 * (0 = fewer than 5 records, too few to know). Typing 3,500 for 33,000 is easy to miss.
 */
export function usualOutput(records: { smSkuId: string; productionDate: string; actualOutputG: number }[], skuId: string): number {
  const own = records
    .filter((r) => r.smSkuId === skuId && r.actualOutputG > 0)
    .sort((a, b) => b.productionDate.localeCompare(a.productionDate))
    .slice(0, 20)
    .map((r) => r.actualOutputG)
    .sort((a, b) => a - b);
  return own.length < 5 ? 0 : own[Math.floor(own.length / 2)];
}

/** More than 5 times above or below the usual output: ask before saving */
export const farFromUsual = (grams: number, usual: number) => usual > 0 && grams > 0 && (grams > usual * 5 || grams < usual / 5);
