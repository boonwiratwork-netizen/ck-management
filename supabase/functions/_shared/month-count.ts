// The kitchen's month-end RM count rule, shared by the kitchen cost / admin home
// (src/hooks/use-ck-production.ts) and the push alerts (rule 13, month close): a completed
// count session within ±3 days of the day that counted at least half of the raw materials
// in the recipes of what was made. Plain TypeScript, relative imports only.

export const COUNT_WINDOW_DAYS = 3;
export const MIN_COUNT_COVERAGE = 0.5;

const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`);

/** Sessions to try for `target`: within ±window days, later than `after`, nearest first (a later one wins a tie) */
export function sessionsNear<T extends { count_date: string }>(sessions: T[], target: string, after?: string, window = COUNT_WINDOW_DAYS): T[] {
  const t = dayMs(target);
  return sessions
    .filter((s) => Math.abs(dayMs(s.count_date) - t) <= window * 86_400_000 && (!after || s.count_date > after))
    .sort((x, y) => Math.abs(dayMs(x.count_date) - t) - Math.abs(dayMs(y.count_date) - t) || (y.count_date > x.count_date ? 1 : -1));
}

/** What a session counted of `rmIds`: quantities and the share — half of the period's RM, not of whatever the session listed */
export function countCoverage(lines: { sku_id: string; physical_qty: number | null }[], rmIds: Set<string>): { qty: Map<string, number>; coverage: number } {
  const qty = new Map<string, number>();
  for (const l of lines) if (l.physical_qty != null && rmIds.has(l.sku_id)) qty.set(l.sku_id, Number(l.physical_qty));
  return { qty, coverage: rmIds.size ? qty.size / rmIds.size : 0 };
}

/** RM items in the recipes of what was made: the base a count must cover half of */
export function rmIdsOf(producedSm: string[], recipeRm: (smSkuId: string) => string[]): Set<string> {
  const out = new Set<string>();
  for (const sm of producedSm) for (const rm of recipeRm(sm)) out.add(rm);
  return out;
}

/**
 * The month-end count of a month ending `end`: pass = a completed session within ±3 days
 * covering ≥ half of `rmIds`; none = nothing made (no RM to count); fail otherwise.
 */
export function monthEndCount(input: { end: string; sessions: { id: string; count_date: string; status: string }[]; linesOf: (sessionId: string) => { sku_id: string; physical_qty: number | null }[]; rmIds: Set<string> }): "pass" | "fail" | "none" {
  if (input.rmIds.size === 0) return "none";
  for (const s of sessionsNear(input.sessions.filter((x) => x.status === "Completed"), input.end))
    if (countCoverage(input.linesOf(s.id), input.rmIds).coverage >= MIN_COUNT_COVERAGE) return "pass";
  return "fail";
}
