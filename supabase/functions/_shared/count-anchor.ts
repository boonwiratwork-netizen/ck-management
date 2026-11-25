/**
 * Which stock movements come AFTER a physical count (and so are added to the
 * counted figure). Everything dated after the count day is added; the question is
 * the count day itself, and it goes by date only: kitchen bills are often keyed in a
 * day later and counts are typed in from paper, so entry times say little about
 * when something was physically in the fridge.
 *
 * - Counts saved before this rule (timing null): exactly as before — a movement
 *   on the count day is taken as already in the count (production compares its
 *   entry time with when the count was finished).
 * - "before" (นับก่อนรายการของวันนั้น): every movement dated on the count day is added.
 * - "after" (นับหลังรายการของวันนั้น): every movement dated on the count day is in the count.
 */

export type CountTiming = "before" | "after";

export interface CountAnchor {
  count_date: string;
  completed_at?: string | null;
  timing?: CountTiming | null;
}

/** Receipts, adjustments and deliveries (dated movements) */
export function afterCount(anchor: CountAnchor, date: string): boolean {
  if (date === anchor.count_date) return anchor.timing === "before";
  return date > anchor.count_date;
}

/** Production records: counts saved before this rule keep the old entry-time rule */
export function producedAfterCount(anchor: CountAnchor, productionDate: string, createdAt?: string | null): boolean {
  if (anchor.timing) return afterCount(anchor, productionDate);
  return (createdAt ?? productionDate) > (anchor.completed_at ?? anchor.count_date);
}

/** One row of "what moved in the kitchen on the count day", shown before a count is finished */
export interface CountDayEvent {
  at: string; // ISO time it was entered
  sign: "+" | "−";
  text: string;
}

export interface CountDayRaw {
  receipts: { supplier: string; createdAt: string }[];
  deliveries: { toNumber?: string; branch: string; lines: number; sentAt: string }[];
  production: { name: string; grams: number; createdAt: string }[];
  adjustments: { name: string; quantity: number; unit: string; reason: string; createdAt: string }[];
}

const gramsLabel = (g: number) => (g >= 1000 ? `${(g / 1000).toLocaleString("th-TH", { maximumFractionDigits: 1 })} กก.` : `${Math.round(g).toLocaleString("th-TH")} ก.`);

/**
 * The count day's movements, one row each, oldest first: a supplier's receipts make
 * one row, a transfer one row, a production run one row, a manual adjustment one row.
 * Count adjustments and the raw-material deductions a production run makes itself
 * are left out (the production row stands for them). RM/PK taken out for a transfer
 * dated another day (sent today) shows as one row per transfer.
 */
export function countDayEvents(raw: CountDayRaw): CountDayEvent[] {
  const out: CountDayEvent[] = [];
  const bySupplier = new Map<string, { n: number; at: string }>();
  for (const r of raw.receipts) {
    const g = bySupplier.get(r.supplier);
    if (!g) bySupplier.set(r.supplier, { n: 1, at: r.createdAt });
    else {
      g.n++;
      if (r.createdAt < g.at) g.at = r.createdAt;
    }
  }
  for (const [supplier, g] of bySupplier) out.push({ at: g.at, sign: "+", text: `รับของ ${supplier} · ${g.n} รายการ` });
  for (const d of raw.deliveries) out.push({ at: d.sentAt, sign: "−", text: `ส่งให้ ${d.branch} · ${d.lines} รายการ` });
  for (const p of raw.production) out.push({ at: p.createdAt, sign: "+", text: `ผลิต${p.name} · ${gramsLabel(p.grams)}` });
  const listedTos = new Set(raw.deliveries.map((d) => d.toNumber).filter(Boolean));
  const otherTos = new Map<string, { n: number; at: string }>();
  for (const a of raw.adjustments) {
    if (a.reason.startsWith("Distribution:")) {
      const no = a.reason.slice("Distribution:".length).trim();
      if (listedTos.has(no)) continue;
      const g = otherTos.get(no);
      if (!g) otherTos.set(no, { n: 1, at: a.createdAt });
      else {
        g.n++;
        if (a.createdAt < g.at) g.at = a.createdAt;
      }
      continue;
    }
    if (a.quantity === 0 || a.reason.includes("Stock Count") || a.reason.startsWith("Production")) continue;
    out.push({ at: a.createdAt, sign: a.quantity > 0 ? "+" : "−", text: `ปรับยอด ${a.name} · ${Math.abs(a.quantity).toLocaleString("th-TH", { maximumFractionDigits: 2 })} ${a.unit}`.trim() });
  }
  for (const [no, g] of otherTos) out.push({ at: g.at, sign: "−", text: `ส่งของ ${no} · ${g.n} รายการ` });
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/** A movement's effect on one SKU's kitchen stock, in the stock pages' units */
export interface StockMove {
  skuId: string;
  date: string;
  qty: number; // + in, − out
}

export interface CountNets {
  /** Net movement dated on the count day, per SKU */
  day: Record<string, number>;
  /** Net movement dated after the count day (the count was typed in later), per SKU */
  later: Record<string, number>;
}

export function countNets(moves: StockMove[], countDate: string): CountNets {
  const nets: CountNets = { day: {}, later: {} };
  for (const m of moves) {
    if (m.date < countDate) continue;
    const bucket = m.date === countDate ? nets.day : nets.later;
    bucket[m.skuId] = (bucket[m.skuId] ?? 0) + m.qty;
  }
  return nets;
}

/**
 * What the system should have shown at the moment of counting, from the system
 * figure now (which already holds every movement entered so far): take off what is
 * dated after the count day, and the count day itself when the count came first.
 */
export function systemAtCount(systemNow: number, skuId: string, nets: CountNets, timing: CountTiming | null): number {
  return systemNow - (nets.later[skuId] ?? 0) - (timing === "before" ? nets.day[skuId] ?? 0 : 0);
}
