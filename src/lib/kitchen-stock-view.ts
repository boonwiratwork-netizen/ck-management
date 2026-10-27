import type { SKU } from "@/types/sku";

/** Less than this many days of stock left = "ใกล้หมด" */
export const LOW_DAYS = 7;
/** A monthly count older than this = "ไม่ได้นับนาน" */
export const STALE_COUNT_DAYS = 35;
/** Made items (SM) with more than this many days left look wrong: check by counting */
export const OVER_DAYS = 60;

export type StockType = "RM" | "SM" | "PK";

export interface StockRowInput {
  sku: SKU;
  stock: number;
  /** Standard cost per usage unit (Cost Center's) */
  unitCost: number;
  /** Real use per day (SM: sales-based; RM/PK: production + sent, 28 days) */
  perDay: number;
  /** Date of the last physical count, or null when never counted */
  lastCount: string | null;
  /** Moves the balance is built from since that count */
  movesAfter: number;
  /** Last time it came in: made (SM) or bought (RM/PK) */
  lastIn: { date: string; from?: string } | null;
}

export interface StockRow extends StockRowInput {
  /** Never below 0 (a negative stock has no value) */
  value: number;
  daysLeft: number | null;
  countAgeDays: number | null;
  flags: { negative: boolean; low: boolean; stale: boolean; unusual: boolean; inactive: boolean };
}

const daysBetween = (from: string, to: string) => Math.round((new Date(to + "T00:00:00").getTime() - new Date(from + "T00:00:00").getTime()) / 86400000);

export function buildStockRow(type: StockType, input: StockRowInput, today: string): StockRow {
  const { stock, unitCost, perDay, lastCount } = input;
  const daysLeft = perDay > 0 && stock > 0 ? stock / perDay : null;
  const countAgeDays = lastCount ? daysBetween(lastCount, today) : null;
  const stale = countAgeDays === null ? stock !== 0 : countAgeDays > STALE_COUNT_DAYS;
  // Made items piling up: far more than will be used, or never counted and nobody uses it
  const unusual = type === "SM" && stock > 0 && ((daysLeft !== null && daysLeft > OVER_DAYS) || (lastCount === null && perDay === 0));
  return {
    ...input,
    value: Math.max(0, stock) * unitCost,
    daysLeft,
    countAgeDays,
    flags: {
      negative: stock < 0,
      low: daysLeft !== null && daysLeft < LOW_DAYS,
      stale,
      unusual,
      inactive: input.sku.status !== "Active",
    },
  };
}

/**
 * Which items the page lists: active ones, plus switched-off ones that still hold
 * stock (they still count in the value, and someone should zero or reuse them).
 */
export const shownOnPage = (r: StockRow) => r.sku.status === "Active" || Math.abs(r.stock) > 0.5;

export type StockFilter = "all" | "low" | "negative" | "unusual" | "stale";

export function matchesFilter(r: StockRow, f: StockFilter): boolean {
  if (f === "all") return true;
  if (f === "low") return r.flags.low;
  if (f === "negative") return r.flags.negative;
  if (f === "unusual") return r.flags.unusual;
  return r.flags.stale;
}

/** Weighted cover per storage group: Σ stock ÷ Σ use per day (rows with both) */
export function coverByStorage(rows: StockRow[]): Record<string, number | null> {
  const acc: Record<string, { s: number; u: number }> = {};
  for (const r of rows) {
    if (!(r.perDay > 0) || !(r.stock > 0)) continue;
    const k = r.sku.storageCondition;
    acc[k] ??= { s: 0, u: 0 };
    acc[k].s += r.stock;
    acc[k].u += r.perDay;
  }
  const out: Record<string, number | null> = {};
  for (const [k, v] of Object.entries(acc)) out[k] = v.u > 0 ? v.s / v.u : null;
  return out;
}
