/**
 * Rules for the central kitchen's transfer orders (โอนสินค้า), kept apart from
 * the screens so they can be tested: packs on a line, which production lots a
 * line is picked from, what to check before sending, and the two shortfall
 * labels (ครัวกลางส่งไม่ครบ / สาขารับไม่ครบ).
 */

/** A difference up to 10% (weighing, trimming) still counts as complete */
export const SHORT_TOLERANCE = 0.1;

/** `got` is short of `expected` by more than the tolerance */
export function isShort(got: number, expected: number): boolean {
  return expected > 0 && got < expected * (1 - SHORT_TOLERANCE) - 1e-9;
}

/** What actually left the kitchen on a line (actual qty once set, else the plan) */
export const sentQtyOf = (l: { actualQty: number; plannedQty: number }) => (l.actualQty > 0 ? l.actualQty : l.plannedQty);

/**
 * The kitchen sent less than the branch asked for. Items counted in packs compare
 * PACKS (a pack that weighs less than its set size is still a whole pack sent);
 * others compare quantity with the 10% allowance.
 */
export function kitchenSentShort(l: { plannedQty: number; actualQty: number; packsCount: number | null }, packSize: number): boolean {
  if (packSize > 1) {
    // Branches ask in whole packs, so the request is a whole number of packs —
    // unless the pack size changed after it was made (SM-0007: 1,100 → 800 g on
    // 25 Oct 2026); then the packs asked for are unknown and nothing is flagged.
    const asked = l.plannedQty / packSize;
    if (Math.abs(asked - Math.round(asked)) > 0.01) return false;
    return packsOf(l, packSize) < Math.round(asked);
  }
  return isShort(l.actualQty, l.plannedQty);
}

/** Packs on a line: the count the kitchen typed, else derived from the weight */
export function packsOf(l: { packsCount: number | null; actualQty: number }, packSize: number): number {
  if (l.packsCount != null) return l.packsCount;
  return packSize > 0 ? Math.round(l.actualQty / packSize) : 0;
}

// ─── Production lots (SM only, traceability only) ───

export interface ProdRecord {
  id: string;
  productionDate: string;
  actualOutputG: number;
  batchesProduced: number;
}

export interface LotLine {
  id?: string;
  productionRecordId: string;
  productionDate: string;
  packs: number;
  packWeightG: number;
}

/**
 * Lots still in the kitchen, oldest first: newest production runs whose output
 * adds up to the current stock; older runs are taken as used up and hidden.
 * A lot already picked on the line stays; if nothing would be left, show all.
 * (Same rule the old page used for its lot dropdown.)
 */
export function visibleRecords(records: ProdRecord[], currentStock: number | undefined, selectedIds: Set<string>): ProdRecord[] {
  const oldestFirst = [...records].sort((a, b) => (a.productionDate || "").localeCompare(b.productionDate || ""));
  if (oldestFirst.length === 0 || currentStock == null) return oldestFirst;
  const within = new Set<string>();
  let cumulative = 0;
  for (const r of [...oldestFirst].reverse()) {
    if (cumulative >= currentStock) break;
    within.add(r.id);
    cumulative += r.actualOutputG || 0;
  }
  const visible = oldestFirst.filter((r) => within.has(r.id) || selectedIds.has(r.id));
  return visible.length > 0 ? visible : oldestFirst;
}

/**
 * Bring a line's lots to `packs`: too many → take them off the newest lots
 * first; too few → add the rest to the oldest lot not used yet, else onto the
 * newest lot already on the line. Returns the new list (lots at 0 removed) and
 * the saved lots that were dropped, for the caller to delete.
 */
export function reconcileLots(current: LotLine[], records: ProdRecord[], packs: number, packWeightG: number): { next: LotLine[]; removed: LotLine[] } {
  const lots = current.map((l) => ({ ...l }));
  const assigned = lots.reduce((s, l) => s + (l.packs || 0), 0);
  if (packs === assigned) return { next: lots, removed: [] };
  if (packs < assigned) {
    let over = assigned - packs;
    for (const lot of [...lots].sort((a, b) => (b.productionDate || "").localeCompare(a.productionDate || ""))) {
      if (over <= 0) break;
      const take = Math.min(lot.packs, over);
      lot.packs -= take;
      over -= take;
    }
    return { next: lots.filter((l) => l.packs > 0), removed: lots.filter((l) => l.packs <= 0 && l.id) };
  }
  let remaining = packs - assigned;
  const used = new Set(lots.map((l) => l.productionRecordId).filter(Boolean));
  const fresh = [...records].sort((a, b) => (a.productionDate || "").localeCompare(b.productionDate || "")).find((r) => !used.has(r.id));
  if (fresh) {
    lots.push({ productionRecordId: fresh.id, productionDate: fresh.productionDate, packs: remaining, packWeightG });
    remaining = 0;
  } else if (lots.length > 0) {
    let newest = 0;
    lots.forEach((l, i) => {
      if ((l.productionDate || "") > (lots[newest].productionDate || "")) newest = i;
    });
    lots[newest].packs += remaining;
    remaining = 0;
  }
  return { next: lots, removed: [] };
}

// ─── Before sending ───

export interface PackLine {
  id: string;
  skuId: string;
  skuName: string;
  plannedQty: number;
  actualQty: number;
  packsCount: number | null;
  trLineId: string | null;
}

export interface SkuInfo {
  type: string;
  packSize: number;
}

export interface SendCheck {
  /** Sending more than the kitchen's stock (allowed after a warning) */
  overStock: { lineId: string; skuName: string; needed: number; available: number }[];
  /** SM lines whose lots don't add up to the packs (must be fixed) */
  lotMismatch: { lineId: string; skuName: string; packs: number; assigned: number }[];
  /** Lines from the request sent more than 10% under what was asked */
  short: { lineId: string; skuName: string; requested: number; sent: number }[];
  /** Lines changed from the request within or above it, for the review list */
  changed: { lineId: string; skuName: string; requested: number; sent: number }[];
}

export function checkBeforeSend(lines: PackLine[], skuOf: (skuId: string) => SkuInfo | undefined, stock: Record<string, number>, lots: Record<string, LotLine[]>): SendCheck {
  const out: SendCheck = { overStock: [], lotMismatch: [], short: [], changed: [] };
  for (const l of lines) {
    const sku = skuOf(l.skuId);
    if (l.actualQty > 0 && stock[l.skuId] != null && l.actualQty > stock[l.skuId]) {
      out.overStock.push({ lineId: l.id, skuName: l.skuName, needed: l.actualQty, available: stock[l.skuId] });
    }
    // Lots are SM-only: RM and PK carry a pack size too, so never gate on pack size alone
    if (sku?.type === "SM" && sku.packSize > 0) {
      const packs = packsOf(l, sku.packSize);
      const assigned = (lots[l.id] || []).reduce((s, x) => s + (x.packs || 0), 0);
      if (packs !== assigned) out.lotMismatch.push({ lineId: l.id, skuName: l.skuName, packs, assigned });
    }
    if (l.trLineId && l.plannedQty > 0) {
      if (kitchenSentShort(l, sku?.packSize ?? 0)) out.short.push({ lineId: l.id, skuName: l.skuName, requested: l.plannedQty, sent: l.actualQty });
      else if (Math.abs(l.actualQty - l.plannedQty) > 0.5) out.changed.push({ lineId: l.id, skuName: l.skuName, requested: l.plannedQty, sent: l.actualQty });
    }
  }
  return out;
}

// ─── After sending: the two labels ───

/** Request lines the kitchen didn't send ("ส่งไม่ได้") or sent short (fewer packs, or >10% less) */
export function kitchenShortCount(
  lines: { trLineId: string | null; plannedQty: number; actualQty: number; packsCount: number | null; packSize: number }[],
  declinedRequestLines: number,
): number {
  return declinedRequestLines + lines.filter((l) => l.trLineId && kitchenSentShort(l, l.packSize)).length;
}

/**
 * Lines the branch received more than 10% under what the kitchen actually sent
 * (or not at all). Receipts are matched by product.
 */
export function branchShortCount(lines: { skuId: string; actualQty: number; plannedQty: number }[], receivedBySku: Map<string, number>): number {
  return lines.filter((l) => {
    const sent = sentQtyOf(l);
    return sent > 0 && isShort(receivedBySku.get(l.skuId) ?? 0, sent);
  }).length;
}

export type Tone = "wait" | "info" | "done" | "warn" | "kitchen" | "off";
export interface Badge {
  text: string;
  tone: Tone;
}

/** The labels a sent transfer order shows, in Thai */
export function transferBadges(to: { status: string; kitchenShort: number; branchShort: number }): Badge[] {
  const out: Badge[] = [];
  if (to.status === "Draft") return [{ text: "ยังไม่ได้ส่ง", tone: "wait" }];
  if (to.status === "Cancelled") return [{ text: "ยกเลิก", tone: "off" }];
  if (to.status === "Declined") return [{ text: "สาขาปฏิเสธ", tone: "off" }];
  if (to.kitchenShort > 0) out.push({ text: `ครัวกลางส่งไม่ครบ ${to.kitchenShort}`, tone: "kitchen" });
  if (to.status === "Sent") out.push({ text: "รอสาขารับ", tone: "info" });
  else if (to.branchShort > 0) out.push({ text: `สาขารับไม่ครบ ${to.branchShort}`, tone: "warn" });
  else out.push({ text: "สาขารับครบ", tone: "done" });
  return out;
}
