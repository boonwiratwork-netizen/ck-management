/**
 * Cost Center's top card: one closed month's food cost, actual against the recipes,
 * and where the difference comes from — by place (the kitchen, each branch) and by
 * cause (amount used vs price paid) — plus the items that moved it most, either way.
 *
 * Built only from figures the app already works out, so the numbers agree with the
 * pages they drill into:
 *  - a branch: Food Cost's actual for that branch and month (computeActual: totalVar,
 *    priceVar, usageVar = totalVar − priceVar; per item the same split);
 *  - the kitchen: the kitchen dashboard's production cost (productionCost: usageVar,
 *    priceVar per kitchen recipe and raw material).
 * Branches take kitchen-made items at the standard price, so the kitchen's own
 * difference is added on top, not counted twice.
 *
 * Sign: + = cost more than the recipe says (used more / paid more), − = less.
 */

export interface VarItem {
  skuId: string;
  usage: number;
  price: number;
}

export type PlaceState = "ok" | "loading" | "failed" | "nocount";

export interface PlaceInput {
  key: string;
  name: string;
  kind: "kitchen" | "branch";
  state: PlaceState;
  /** Branches only: the recipe side (sales and recipe cost) */
  revenue?: number;
  stdCost?: number;
  /** Branches, counted: Food Cost's actual cost and the recipe over the same items and days */
  actCost?: number;
  recipeCost?: number;
  /** Why there's no figure, when it isn't the usual "no closing count" */
  note?: string;
  /** Never has a figure in this view (the kitchen in a week): left out of "นับครบ x/y" */
  notApplicable?: boolean;
  /** A figure to read with care ("ยอดขายไม่ครบ 9 วัน"): shown under the place's name */
  warn?: string;
  usage?: number;
  price?: number;
  items?: VarItem[];
}

export interface PlaceRow {
  key: string;
  name: string;
  kind: "kitchen" | "branch";
  state: PlaceState;
  note?: string;
  warn?: string;
  usage: number;
  price: number;
  total: number;
}

export interface Mover {
  skuId: string;
  name: string;
  place: string;
  placeKey: string;
  kind: "kitchen" | "branch";
  total: number;
  /** Which part is bigger, for the words ("ใช้เกิน" / "แพงกว่า" …) */
  cause: "usage" | "price";
}

export interface CostVariance {
  revenue: number;
  stdCost: number;
  /** Recipe food cost %, over the counted branches (every branch while none is counted) */
  stdPct: number | null;
  /**
   * Actual %, over the same counted branches, each by Food Cost's own formula (actualPct:
   * recipe cost × actual ÷ the recipe over the counted items and days), plus the kitchen's
   * difference. null until a branch is counted.
   */
  actPct: number | null;
  /** Places with a figure / all places (the % covers only the counted ones) */
  places: number;
  usage: number;
  price: number;
  total: number;
  rows: PlaceRow[];
  movers: Mover[];
  /** Places whose actual is in (the rest are loading, failed or not counted) */
  counted: number;
  /** All places done reading (nothing still loading) */
  done: boolean;
}

export function costVariance(places: PlaceInput[], skuName: (id: string) => string, moversN = 3): CostVariance {
  let revenue = 0;
  let stdCost = 0;
  // Counted branches only: their sales, recipe cost and actual cost as Food Cost has it
  let cRevenue = 0;
  let cStd = 0;
  let cAct = 0;
  let cBranches = 0;
  let kitchenVar = 0;
  let usage = 0;
  let price = 0;
  let counted = 0;
  const all: Mover[] = [];
  const rows: PlaceRow[] = places.map((p) => {
    if (p.kind === "branch") {
      revenue += p.revenue ?? 0;
      stdCost += p.stdCost ?? 0;
    }
    if (p.state !== "ok") return { key: p.key, name: p.name, kind: p.kind, state: p.state, note: p.note, usage: 0, price: 0, total: 0 };
    counted += 1;
    const u = p.usage ?? 0;
    const pr = p.price ?? 0;
    usage += u;
    price += pr;
    if (p.kind === "branch") {
      cBranches += 1;
      cRevenue += p.revenue ?? 0;
      cStd += p.stdCost ?? 0;
      const rc = p.recipeCost ?? 0;
      const act = p.actCost ?? 0;
      // actualPct × sales: the recipe cost scaled by actual ÷ recipe over the counted spans
      cAct += rc > 0 ? (p.stdCost ?? 0) * (act / rc) : act;
    } else kitchenVar += u + pr;
    for (const it of p.items ?? []) {
      const t = it.usage + it.price;
      if (Math.abs(t) < 0.5) continue;
      all.push({ skuId: it.skuId, name: skuName(it.skuId), place: p.name, placeKey: p.key, kind: p.kind, total: t, cause: Math.abs(it.usage) >= Math.abs(it.price) ? "usage" : "price" });
    }
    return { key: p.key, name: p.name, kind: p.kind, state: p.state, warn: p.warn, usage: u, price: pr, total: u + pr };
  });
  const total = usage + price;
  all.sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
  const anyBranch = cBranches > 0 && cRevenue > 0;
  return {
    revenue,
    stdCost,
    stdPct: anyBranch ? (cStd / cRevenue) * 100 : revenue > 0 ? (stdCost / revenue) * 100 : null,
    actPct: anyBranch ? ((cAct + kitchenVar) / cRevenue) * 100 : null,
    usage,
    price,
    total,
    rows,
    movers: all.slice(0, moversN),
    counted,
    places: places.filter((p) => !p.notApplicable).length,
    done: places.every((p) => p.state !== "loading"),
  };
}

/** The kitchen's difference per raw material, summed over the recipes that use it */
export function kitchenItems(rows: { lines: { skuId: string; isRm: boolean; expected: number; actual: number | null; stdPrice: number; actPrice: number }[] }[]): VarItem[] {
  const by = new Map<string, VarItem>();
  for (const r of rows)
    for (const l of r.lines) {
      if (!l.isRm || l.actual === null) continue;
      const v = by.get(l.skuId) ?? { skuId: l.skuId, usage: 0, price: 0 };
      // The same split productionCost adds up (usageVar, priceVar)
      v.usage += (l.actual - l.expected) * l.stdPrice;
      v.price += (l.actPrice - l.stdPrice) * l.actual;
      by.set(l.skuId, v);
    }
  return [...by.values()];
}

/** A branch's difference per item, from Food Cost's actual rows (usage = total − price) */
export function branchItems(rows: { skuId: string; totalVar: number | null; priceVar: number | null }[]): VarItem[] {
  return rows.filter((r) => r.totalVar !== null).map((r) => ({ skuId: r.skuId, usage: (r.totalVar ?? 0) - (r.priceVar ?? 0), price: r.priceVar ?? 0 }));
}

/** The last whole month before today's (yyyy-mm-dd range) */
export function lastClosedMonth(today: string): { from: string; to: string; month: string } {
  const [y, m] = today.split("-").map(Number);
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  const last = new Date(Date.UTC(py, pm, 0)).getUTCDate();
  const mm = String(pm).padStart(2, "0");
  return { from: `${py}-${mm}-01`, to: `${py}-${mm}-${last}`, month: `${py}-${mm}` };
}
