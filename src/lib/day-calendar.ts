/**
 * A branch's month at a glance on the Today page: for each day, was the stock
 * count finished, and did that day's sales come in. Same reading as the Today
 * card: a sheet counts as finished only when every line was submitted.
 */
export type CountState = "done" | "open" | "none";

export interface CalDay {
  date: string;
  count: CountState;
  /** Any sales entered for the day */
  sales: boolean;
  /** Today or later: the day isn't over, so nothing is missing yet */
  pending: boolean;
}

export interface CalSummary {
  done: number;
  open: number;
  none: number;
  noSales: number;
}

/** Every day of `month` ("2026-10"), one branch */
export function monthDays(
  month: string,
  today: string,
  counts: { count_date: string; is_submitted: boolean }[],
  saleDates: Set<string>,
): { days: CalDay[]; summary: CalSummary } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  const byDate = new Map<string, boolean[]>();
  for (const c of counts) (byDate.get(c.count_date) ?? byDate.set(c.count_date, []).get(c.count_date)!).push(c.is_submitted);
  const days: CalDay[] = [];
  const summary: CalSummary = { done: 0, open: 0, none: 0, noSales: 0 };
  for (let d = 1; d <= last; d++) {
    const date = `${month}-${String(d).padStart(2, "0")}`;
    const lines = byDate.get(date);
    const count: CountState = !lines?.length ? "none" : lines.every(Boolean) ? "done" : "open";
    const pending = date >= today;
    const sales = saleDates.has(date);
    days.push({ date, count, sales, pending });
    // Today's count may still be under way: only finished days go into the totals
    if (pending) continue;
    summary[count]++;
    if (!pending && !sales) summary.noSales++;
  }
  return { days, summary };
}
