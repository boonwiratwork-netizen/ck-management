// Shortfall rules of a transfer order line, shared by the app (src/lib/transfer-lines.ts
// re-exports them) and the Edge Functions (alerts). Plain TypeScript, relative imports only.

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

/**
 * Packs on a line: the count the kitchen typed, else derived from the weight.
 * The pack count is its own fact — weighing 5 packs of 350 g at 2,005 g is still 5
 * packs — so every screen shows packs from here, never from weight ÷ pack size.
 */
export function packsOf(l: { packsCount: number | null; actualQty: number }, packSize: number): number {
  if (l.packsCount != null) return l.packsCount;
  return packSize > 0 ? Math.round(l.actualQty / packSize) : 0;
}
