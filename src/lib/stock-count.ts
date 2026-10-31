import type { SKU, StorageCondition } from "@/types/sku";

/**
 * Pure rules behind the daily count page: which day a count belongs to, the
 * month-end window, where in the shop each product is, which products this
 * branch doesn't carry, and when a difference is worth a second look.
 */

const pad = (n: number) => String(n).padStart(2, "0");
export const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return isoDate(d);
};

/** Counting after closing, before 05:00, still belongs to the day that closed */
export const CUTOFF_HOUR = 5;
export function businessDate(now: Date): string {
  const d = new Date(now);
  if (d.getHours() < CUTOFF_HOUR) d.setDate(d.getDate() - 1);
  return isoDate(d);
}

/**
 * Month-end: the last five days of a month, ending on its last day (27–31 Oct). Food cost
 * closes the month on its last count (and opens the next month from it), so every product
 * must be counted by the month's last day. The 1st no longer belongs to it (Bucci, Oct
 * 2026): a count dated the 1st is the new month's.
 */
export function monthEndWindow(date: string): string[] | null {
  const d = new Date(`${date}T00:00:00`);
  const last = isoDate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
  const days = [addDays(last, -4), addDays(last, -3), addDays(last, -2), addDays(last, -1), last];
  return days.includes(date) ? days : null;
}

// ── Zones ──

export type Zone = "frozen" | "chilled" | "dry";
export const ZONES: { key: Zone; label: string }[] = [
  { key: "frozen", label: "ช่องแช่แข็ง" },
  { key: "chilled", label: "ตู้เย็น" },
  { key: "dry", label: "ของแห้ง" },
];
const ZONE_OF: Record<StorageCondition, Zone> = { Frozen: "frozen", Chilled: "chilled", Ambient: "dry" };
export const zoneOf = (sku: Pick<SKU, "storageCondition"> | undefined): Zone => (sku && ZONE_OF[sku.storageCondition]) || "dry";
export const zoneLabel = (z: Zone) => ZONES.find((x) => x.key === z)!.label;

// ── Lines ──

export interface CountLine {
  id: string;
  skuId: string;
  openingBalance: number;
  /** In usage units (kitchen + supplier × converter) */
  received: number;
  expectedUsage: number;
  waste: number;
  adjNet: number;
  calculatedBalance: number;
  physicalCount: number | null;
}

/**
 * Not carried by this branch: nothing at the start, nothing received, nothing
 * used and never counted today. Folded away on normal days (Thaniya had 22 of
 * these on every sheet); counted (or confirmed 0) at month-end. Anything that
 * starts moving comes back on its own.
 */
export const isDormant = (l: CountLine) =>
  l.physicalCount === null && l.openingBalance <= 0 && l.received === 0 && l.expectedUsage === 0 && l.waste === 0 && l.adjNet === 0;

/** Difference between what was counted and the balance (physical − calculated) */
export const differenceOf = (l: Pick<CountLine, "physicalCount" | "calculatedBalance">) => (l.physicalCount === null ? null : l.physicalCount - l.calculatedBalance);

/**
 * Worth a second count: off by more than 20% of the larger figure and by at
 * least half a pack (or 50 units for loose items), so a few grams of sauce
 * never raise a flag.
 */
export function isBigDifference(l: Pick<CountLine, "physicalCount" | "calculatedBalance">, packSize: number): boolean {
  const diff = differenceOf(l);
  if (diff === null) return false;
  const base = Math.max(Math.abs(l.calculatedBalance), Math.abs(l.physicalCount ?? 0));
  const floor = packSize > 1 ? packSize / 2 : 50;
  return Math.abs(diff) > base * 0.2 && Math.abs(diff) >= floor;
}

/** Why a big difference may have happened, in words for the review screen */
export function differenceHint(l: Pick<CountLine, "physicalCount" | "calculatedBalance">): string | null {
  const diff = differenceOf(l);
  if (diff === null) return null;
  if (l.calculatedBalance < 0) return "คงเหลือติดลบ ยอดขายหรือสูตรอาจผิด";
  if (diff > 0) return "ลืมรับของ?";
  return "ลืมใส่ของเสีย หรือนับไม่ครบ?";
}

/** Order on screen: the person's own saved order if any, else zone then code */
export function orderLines<T>(lines: T[], skuMap: Map<string, SKU>, customOrder: string[] | null, idOf: (t: T) => string = (t) => (t as { skuId: string }).skuId): T[] {
  const code = (l: T) => skuMap.get(idOf(l))?.skuId ?? "";
  if (customOrder && customOrder.length) {
    const pos = new Map(customOrder.map((id, i) => [id, i]));
    return [...lines].sort((a, b) => (pos.get(idOf(a)) ?? 1e9) - (pos.get(idOf(b)) ?? 1e9) || code(a).localeCompare(code(b)));
  }
  const z = (l: T) => ZONES.findIndex((x) => x.key === zoneOf(skuMap.get(idOf(l))));
  return [...lines].sort((a, b) => z(a) - z(b) || code(a).localeCompare(code(b)));
}

/** "Running out" on the today page and after a count: under this many days left */
export const LOW_DAYS = 2;

/** Items counted below LOW_DAYS of that day's expected use (nothing counted = not low) */
export function lowItems<R extends { physicalCount: number | null; expectedUsage: number }>(rows: R[]): R[] {
  return rows.filter((r) => Number(r.physicalCount) > 0 && r.expectedUsage > 0 && Number(r.physicalCount) / r.expectedUsage < LOW_DAYS);
}
