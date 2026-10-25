/**
 * The one place recipe costs are worked out (Cost Center). Before this there were
 * three copies — the BOM screen, the BOM price sync and the SP BOM page — and they
 * disagreed (step 1 of a multi-step recipe, line yields rounded on screen, SP line
 * yields counted only on import). Price changes and Cost Center use this; the old
 * BOM and SP BOM pages still save through bom-price-sync until they move here.
 *
 * Prices are per usage unit (per gram for most things). A recipe's cost per unit is
 * stored as that SM/SP item's "BOM Calculation" price, so menus, food cost and stock
 * value keep reading prices exactly as before.
 */

export interface CostBomHeader {
  id: string;
  smSkuId: string;
  bomMode: string; // "simple" | "multistep"
  batchSize: number;
  yieldPercent: number; // 1 = 100%
}

export interface CostBomLine {
  bomHeaderId: string;
  rmSkuId: string; // an RM or an SM
  qtyPerBatch: number;
  yieldPercent?: number | null; // simple mode, 1 = 100%
  stepId?: string | null;
  qtyType?: string | null; // "fixed" | "percent"
  percentOfInput?: number | null; // 0.1 = 10% of the step's input
}

export interface CostBomStep {
  id: string;
  bomHeaderId: string;
  stepNumber: number;
  yieldPercent: number; // 1 = 100%
}

export interface CostByproduct {
  bomHeaderId: string;
  skuId?: string | null;
  outputQty: number;
  costAllocationPct: number; // 0–100
  tracksInventory?: boolean;
}

export interface CostSpLine {
  spSkuId: string;
  ingredientSkuId: string;
  qtyPerBatch: number;
  batchYieldQty: number;
}

export type PriceOf = (skuId: string) => number;

export interface SmCost {
  /** Ingredient cost of one batch */
  batchCost: number;
  /** What one batch gives of the main item (usage units) */
  output: number;
  /** Main item's cost per usage unit, after by-products take their share */
  costPerUnit: number;
  /** By-products that are stock items: their cost per unit */
  byproducts: { skuId: string; costPerUnit: number }[];
}

/** Quantity actually used once line yield is counted (100 g at 90% = 111 g bought) */
const withYield = (qty: number, yieldPercent?: number | null) => {
  const y = yieldPercent ?? 1;
  return y > 0 ? qty / y : qty;
};

/** Cost of one SM recipe */
export function smCost(header: CostBomHeader, lines: CostBomLine[], steps: CostBomStep[], byproducts: CostByproduct[], priceOf: PriceOf): SmCost {
  let batchCost = 0;
  let output = 0;
  if (header.bomMode === "multistep") {
    // Each step's output feeds the next. Step 1's input is its fixed lines; a
    // "percent" line is that share of the step's input. Line yields don't apply here.
    const ordered = [...steps].sort((a, b) => a.stepNumber - b.stepNumber);
    let prevOutput = 0;
    ordered.forEach((step, idx) => {
      const own = lines.filter((l) => l.stepId === step.id);
      const base = idx === 0 ? own.filter((l) => l.qtyType !== "percent").reduce((s, l) => s + l.qtyPerBatch, 0) : prevOutput;
      const resolved = own.map((l) => ({ l, qty: l.qtyType === "percent" && l.percentOfInput ? l.percentOfInput * base : l.qtyPerBatch }));
      const added = resolved.reduce((s, r) => s + r.qty, 0);
      batchCost += resolved.reduce((s, r) => s + r.qty * priceOf(r.l.rmSkuId), 0);
      prevOutput = (idx === 0 ? added : prevOutput + added) * step.yieldPercent;
    });
    output = prevOutput;
  } else {
    batchCost = lines.reduce((s, l) => s + withYield(l.qtyPerBatch, l.yieldPercent) * priceOf(l.rmSkuId), 0);
    output = header.batchSize * header.yieldPercent;
  }
  const byPct = byproducts.reduce((s, b) => s + (b.costAllocationPct || 0), 0);
  const mainShare = Math.max(0, 100 - byPct) / 100;
  return {
    batchCost,
    output,
    costPerUnit: output > 0 ? (batchCost * mainShare) / output : 0,
    byproducts: byproducts
      .filter((b) => b.tracksInventory && b.skuId && b.outputQty > 0)
      .map((b) => ({ skuId: b.skuId!, costPerUnit: (batchCost * (b.costAllocationPct / 100)) / b.outputQty })),
  };
}

/** Cost of one SP recipe per unit it makes */
export function spCost(lines: CostSpLine[], priceOf: PriceOf): { batchCost: number; batchYield: number; costPerUnit: number } {
  const batchCost = lines.reduce((s, l) => s + l.qtyPerBatch * priceOf(l.ingredientSkuId), 0);
  const batchYield = lines[0]?.batchYieldQty ?? 0;
  return { batchCost, batchYield, costPerUnit: batchYield > 0 ? batchCost / batchYield : 0 };
}

export interface RecipeBook {
  headers: CostBomHeader[];
  lines: CostBomLine[];
  steps: CostBomStep[];
  byproducts: CostByproduct[];
  spLines: CostSpLine[];
}

/**
 * Every recipe-made item whose cost depends on the given items, directly or through
 * other recipes, in the order to recompute them (an SM used inside another SM or an
 * SP comes before it). Recipes that loop back on themselves are left out.
 */
export function affectedRecipes(changed: Iterable<string>, book: RecipeBook): string[] {
  // ingredient → items made from it
  const usedIn = new Map<string, Set<string>>();
  const add = (ing: string, made: string) => {
    if (!usedIn.has(ing)) usedIn.set(ing, new Set());
    usedIn.get(ing)!.add(made);
  };
  const smOf = new Map(book.headers.map((h) => [h.id, h.smSkuId]));
  for (const l of book.lines) {
    const sm = smOf.get(l.bomHeaderId);
    if (sm) add(l.rmSkuId, sm);
  }
  // A by-product's cost comes out of its parent recipe: it follows the parent
  for (const b of book.byproducts) {
    const sm = smOf.get(b.bomHeaderId);
    if (sm && b.tracksInventory && b.skuId) add(sm, b.skuId);
  }
  for (const l of book.spLines) add(l.ingredientSkuId, l.spSkuId);

  // Everything reachable from the changed items
  const reach = new Set<string>();
  const queue = [...changed];
  while (queue.length) {
    const id = queue.shift()!;
    for (const next of usedIn.get(id) ?? []) {
      if (!reach.has(next)) {
        reach.add(next);
        queue.push(next);
      }
    }
  }
  // A changed recipe item is recomputed itself too
  for (const id of changed) if (book.headers.some((h) => h.smSkuId === id) || book.spLines.some((l) => l.spSkuId === id)) reach.add(id);

  // Order: an item comes after every reachable item it is made from
  const madeFrom = new Map<string, string[]>();
  for (const id of reach) madeFrom.set(id, []);
  for (const [ing, made] of usedIn) for (const m of made) if (reach.has(m) && reach.has(ing)) madeFrom.get(m)!.push(ing);
  const order: string[] = [];
  const state = new Map<string, "doing" | "done">();
  const visit = (id: string): boolean => {
    if (state.get(id) === "done") return true;
    if (state.get(id) === "doing") return false; // a loop
    state.set(id, "doing");
    const ok = madeFrom.get(id)!.every(visit);
    state.set(id, "done");
    if (ok) order.push(id);
    return ok;
  };
  for (const id of [...reach].sort()) visit(id);
  return order;
}

/**
 * New cost per unit for each affected recipe item, worked out in order so a recipe
 * inside another uses its fresh cost. `prices` holds today's prices (per usage unit);
 * the result says which change.
 */
export function recost(changed: Iterable<string>, book: RecipeBook, prices: Map<string, number>): Map<string, number> {
  const current = new Map(prices);
  const out = new Map<string, number>();
  const priceOf = (id: string) => current.get(id) ?? 0;
  for (const id of affectedRecipes(changed, book)) {
    const header = book.headers.find((h) => h.smSkuId === id);
    const spLines = book.spLines.filter((l) => l.spSkuId === id);
    // A by-product only: its parent (earlier in the order) already set its cost
    if (!header && !spLines.length) continue;
    let cost: number;
    if (header) {
      const r = smCost(
        header,
        book.lines.filter((l) => l.bomHeaderId === header.id),
        book.steps.filter((s) => s.bomHeaderId === header.id),
        book.byproducts.filter((b) => b.bomHeaderId === header.id),
        priceOf,
      );
      cost = r.costPerUnit;
      for (const b of r.byproducts) {
        current.set(b.skuId, b.costPerUnit);
        out.set(b.skuId, b.costPerUnit);
      }
    } else {
      cost = spCost(spLines, priceOf).costPerUnit;
    }
    // An emptied recipe (no lines, no batch size) keeps its last cost, and the
    // recipes built on it go on using that, not ฿0
    if (!(cost > 0)) continue;
    current.set(id, cost);
    out.set(id, cost);
  }
  return out;
}
