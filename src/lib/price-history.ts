import { toLocalDateStr } from "@/lib/utils";
import { buildPriceAt as sharedPriceAt, type PriceChange } from "../../supabase/functions/_shared/price-at.ts";

export type { PriceChange };

/** Price on a day (shared rule, supabase/functions/_shared/price-at.ts), days in the device's time */
export function buildPriceAt(changes: PriceChange[]): (skuId: string, date: string) => number | undefined {
  return sharedPriceAt(changes, (v) => toLocalDateStr(new Date(v)));
}
