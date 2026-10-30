import { toLocalDateStr } from "@/lib/utils";

/**
 * The month-end KITCHEN count the today page asks about (branches have their own
 * window, stock-count.ts monthEndWindow): from the last 2 days of a
 * month up to the 3rd of the next, it is that month's last day; other days, none.
 */
export function kitchenMonthEnd(today: string): string | null {
  const d = new Date(`${today}T00:00:00`);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  if (d.getDate() >= last.getDate() - 1) return toLocalDateStr(last);
  if (d.getDate() <= 3) return toLocalDateStr(new Date(d.getFullYear(), d.getMonth(), 0));
  return null;
}
