// Helpers every alert rule uses. Plain TypeScript, relative imports only.

import { buildPriceAt } from "../../price-at.ts";
import type { BranchInput, SaleLine } from "../../team-score.ts";
import { bkkDay } from "../time.ts";
import type { AlertData } from "../types.ts";

const TH_MONTH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const TH_DOW = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];

/** "7 พ.ย." (no time zone involved: the day is a calendar string) */
export const thDay = (d: string) => `${Number(d.slice(8, 10))} ${TH_MONTH[Number(d.slice(5, 7)) - 1]}`;
/** "ศ. 7 พ.ย." */
export const thDow = (d: string) => `${TH_DOW[new Date(`${d}T00:00:00Z`).getUTCDay()]} ${thDay(d)}`;
/** "ต.ค." of a yyyy-MM-.. day */
export const thMonth = (d: string) => TH_MONTH[Number(d.slice(5, 7)) - 1];

/** ฿1,234 (no decimals; negative shown as its size — the words around it say which way) */
export function baht(n: number): string {
  const s = String(Math.round(Math.abs(n)));
  return `฿${s.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}
export const pct = (n: number) => `${Math.round(n)}%`;
export const qty = (n: number) => {
  const r = Math.round(n * 10) / 10;
  return String(r).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
};

export const branchName = (data: AlertData, id: string) => data.branches.find((b) => b.id === id)?.name ?? "สาขา";

/** The standard price of an item on a Bangkok day: price history, else today's standard price */
export function priceOnOf(data: AlertData): (skuId: string, day: string) => number {
  const at = buildPriceAt(
    data.priceChanges.map((c) => ({ skuId: c.sku_id, pricePerUsageUom: Number(c.price_per_usage_uom), validFrom: c.valid_from })),
    (v) => bkkDay(Date.parse(v)),
  );
  return (skuId, day) => at(skuId, day) ?? data.stdPrice.get(skuId) ?? 0;
}

/** Transfer order id → its first branch receipt's time */
export function firstReceiptOf(data: AlertData): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of data.receipts) {
    const had = m.get(r.transfer_order_id);
    if (!had || Date.parse(r.created_at) < Date.parse(had)) m.set(r.transfer_order_id, r.created_at);
  }
  return m;
}

/**
 * Each active branch's rows in the shape the team score reads (lib/team-score). Sales come
 * summed per day: the score only uses a day's first saved time and its net total, so one
 * row per day judges exactly like every sales line would.
 */
export function branchInputsOf(data: AlertData): Map<string, BranchInput> {
  const priceOn = priceOnOf(data);
  const firstReceipt = firstReceiptOf(data);
  const out = new Map<string, BranchInput>();
  for (const b of data.branches) out.set(b.id, { counts: [], sales: [], tos: [], firstReceipt, priceOn });
  for (const c of data.counts) out.get(c.branch_id)?.counts.push(c);
  for (const s of data.salesDaily) out.get(s.branch_id)?.sales.push({ sale_date: s.sale_date, created_at: s.first_created_at, net_amount: Number(s.net_amount) || 0 } as SaleLine);
  for (const t of data.tos) out.get(t.branch_id)?.tos.push(t);
  return out;
}
