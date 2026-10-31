import { toLocalDateStr } from "@/lib/utils";

/** One standard-price change of an item (table price_history, written by the database) */
export interface PriceChange {
  skuId: string;
  pricePerUsageUom: number;
  /** When it changed (timestamp) */
  validFrom: string;
}

/**
 * Price on a day = the item's last change on or before that day. A change counts
 * for its whole day: a day's sales use the price it ended the day with. No change
 * on record (an item priced before history began, or none at all) → undefined, and
 * the caller uses today's price, which is what every report used before.
 */
export function buildPriceAt(changes: PriceChange[]): (skuId: string, date: string) => number | undefined {
  const bySku = new Map<string, { day: string; price: number }[]>();
  for (const c of changes) {
    const list = bySku.get(c.skuId) ?? [];
    list.push({ day: toLocalDateStr(new Date(c.validFrom)), price: Number(c.pricePerUsageUom) });
    bySku.set(c.skuId, list);
  }
  // Oldest first; within a day the later change wins (kept in arrival order)
  for (const list of bySku.values()) list.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  return (skuId, date) => {
    const list = bySku.get(skuId);
    if (!list) return undefined;
    let found: number | undefined;
    for (const e of list) {
      if (e.day > date) break;
      found = e.price;
    }
    // Before the first change on record: the first price is the best we know
    return found ?? list[0].price;
  };
}
