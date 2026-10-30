/**
 * The kitchen's production cost for a period: what the recipes say the runs made
 * should have used, against the raw materials that really left stock.
 *
 * - Recipe ("ตามสูตร"): the raw materials each recipe should have used for the
 *   runs it made (output ÷ output per batch, as production deducts), at standard.
 *   The whole pot, by-products included, so it compares with what the pot used.
 * - Actual ("จริง"): per raw material, opening count + bought − closing count −
 *   what went to branches (Distribution), shared out over the recipes by what each
 *   should have used; priced at what was paid.
 * Raw materials only, on both sides: a kitchen-made ingredient (stock in a soup)
 * already has its raw materials in its own row, so costing it again would count
 * them twice. Such lines are listed, not added. A raw material missing from one of
 * the two counts can't be measured: it's taken as the recipe says and listed.
 */

export interface RecipeLine {
  skuId: string;
  /** Per batch, as bought (line yield counted) */
  qty: number;
}

export interface Recipe {
  smSkuId: string;
  outputPerBatch: number;
  lines: RecipeLine[];
}

export interface RmFlow {
  opening: number;
  bought: number;
  toBranches: number;
  closing: number;
}

export interface LineCost {
  skuId: string;
  isRm: boolean;
  expected: number;
  /** null for kitchen-made ingredients (not tracked by count) */
  actual: number | null;
  stdPrice: number;
  actPrice: number;
}

export interface SmProductionCost {
  smSkuId: string;
  outputG: number;
  runs: number;
  stdCost: number;
  actCost: number;
  priceVar: number;
  usageVar: number;
  lines: LineCost[];
}

export interface ProductionCost {
  rows: SmProductionCost[];
  stdCost: number;
  actCost: number;
  priceVar: number;
  usageVar: number;
  /** Raw material used, per SKU (opening + bought − closing − to branches) */
  rmUsed: Map<string, number>;
}

export function productionCost(input: {
  produced: { smSkuId: string; outputG: number }[];
  recipes: Map<string, Recipe>;
  isRm: (skuId: string) => boolean;
  stdPrice: (skuId: string) => number;
  /** What was paid in the period, else the standard */
  actPrice: (skuId: string) => number;
  rmFlow: Map<string, RmFlow>;
  /** Raw materials not in the opening or the closing count */
  uncounted?: Set<string>;
}): ProductionCost {
  // Output per SM, and what each recipe should have used
  const out = new Map<string, number>();
  for (const p of input.produced) out.set(p.smSkuId, (out.get(p.smSkuId) ?? 0) + (Number(p.outputG) || 0));
  const expected = new Map<string, Map<string, number>>(); // sm → sku → qty
  const totalExpectedRm = new Map<string, number>();
  const runsOf = new Map<string, number>();
  for (const [sm, g] of out) {
    const r = input.recipes.get(sm);
    const runs = r && r.outputPerBatch > 0 ? g / r.outputPerBatch : 0;
    runsOf.set(sm, runs);
    const m = new Map<string, number>();
    for (const l of r?.lines ?? []) {
      m.set(l.skuId, (m.get(l.skuId) ?? 0) + l.qty * runs);
      if (input.isRm(l.skuId)) totalExpectedRm.set(l.skuId, (totalExpectedRm.get(l.skuId) ?? 0) + l.qty * runs);
    }
    expected.set(sm, m);
  }

  const rmUsed = new Map<string, number>();
  for (const id of totalExpectedRm.keys()) {
    const f = input.rmFlow.get(id);
    // Shown as it is (negative = a receipt or a count missing): not clamped
    rmUsed.set(id, f ? f.opening + f.bought - f.closing - f.toBranches : 0);
  }

  const rows: SmProductionCost[] = [];
  for (const [sm, g] of out) {
    const lines: LineCost[] = [];
    let std = 0;
    let act = 0;
    let pv = 0;
    let uv = 0;
    for (const [id, exp] of expected.get(sm) ?? []) {
      const sp = input.stdPrice(id);
      if (!input.isRm(id)) {
        lines.push({ skuId: id, isRm: false, expected: exp, actual: null, stdPrice: sp, actPrice: sp });
        continue;
      }
      std += exp * sp;
      const total = totalExpectedRm.get(id) ?? 0;
      // This recipe's share of what the raw material really lost, by what it should
      // have used; not measurable without both counts → as the recipe says
      const share = input.uncounted?.has(id) ? exp : total > 0 ? (rmUsed.get(id) ?? 0) * (exp / total) : 0;
      const ap = input.actPrice(id);
      act += share * ap;
      pv += (ap - sp) * share;
      uv += (share - exp) * sp;
      lines.push({ skuId: id, isRm: true, expected: exp, actual: share, stdPrice: sp, actPrice: ap });
    }
    // Biggest difference first (price and use), kitchen-made lines last
    const diff = (l: LineCost) => (l.actual === null ? -1 : Math.abs(l.actual * l.actPrice - l.expected * l.stdPrice));
    lines.sort((a, b) => diff(b) - diff(a));
    rows.push({ smSkuId: sm, outputG: g, runs: runsOf.get(sm) ?? 0, stdCost: std, actCost: act, priceVar: pv, usageVar: uv, lines });
  }
  rows.sort((a, b) => Math.abs(b.actCost - b.stdCost) - Math.abs(a.actCost - a.stdCost));
  const sum = (k: "stdCost" | "actCost" | "priceVar" | "usageVar") => rows.reduce((t, r) => t + r[k], 0);
  return { rows, stdCost: sum("stdCost"), actCost: sum("actCost"), priceVar: sum("priceVar"), usageVar: sum("usageVar"), rmUsed };
}

/** Top suppliers by spend plus one "อื่นๆ" row, so the rows add up to the total */
export function topWithOthers<T extends { name: string; value: number }>(items: T[], n = 5): { name: string; value: number }[] {
  const sorted = [...items].sort((a, b) => b.value - a.value);
  const top = sorted.slice(0, n).map((x) => ({ name: x.name, value: x.value }));
  const rest = sorted.slice(n).reduce((t, x) => t + x.value, 0);
  return rest > 0 ? [...top, { name: `อื่นๆ (${sorted.length - n})`, value: rest }] : top;
}
