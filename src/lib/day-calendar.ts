/**
 * A branch's month at a glance on the Today page: for each day, was stock counted,
 * and did that day's sales come in. Counted = any line has a figure (stock uses it
 * at once, finished or not); "open" = counted but "นับเสร็จ" not pressed, so the sheet
 * can still change and the next day can't start. A sheet opened with nothing typed
 * in is not a count (Shiro 9, 11, 14, 18 Oct 2026 looked "open" until this).
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
  counts: { count_date: string; is_submitted: boolean; physical_count: number | null }[],
  saleDates: Set<string>,
): { days: CalDay[]; summary: CalSummary } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  const byDate = new Map<string, { submitted: boolean; counted: boolean }[]>();
  for (const c of counts) (byDate.get(c.count_date) ?? byDate.set(c.count_date, []).get(c.count_date)!).push({ submitted: c.is_submitted, counted: c.physical_count !== null });
  const days: CalDay[] = [];
  const summary: CalSummary = { done: 0, open: 0, none: 0, noSales: 0 };
  for (let d = 1; d <= last; d++) {
    const date = `${month}-${String(d).padStart(2, "0")}`;
    const lines = byDate.get(date);
    const count: CountState = !lines?.some((l) => l.counted) ? "none" : lines.every((l) => l.submitted) ? "done" : "open";
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
