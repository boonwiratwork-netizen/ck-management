/**
 * The day a page saves on (receiving, kitchen bills, production), apart from the screens.
 * A page used to fix its day when it was opened, so a tablet left open overnight saved the
 * next morning's goods on yesterday. The day now follows the calendar day in Bangkok, the
 * way the count page follows its count day, unless someone picked another day on purpose.
 */

const pad = (n: number) => String(n).padStart(2, "0");

const bangkok = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" });

/** The calendar day in Bangkok (yyyy-MM-dd), whatever time zone the device is set to */
export function bangkokDate(now: Date = new Date()): string {
  const parts = bangkok.formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** A yyyy-MM-dd day moved by n days (calendar arithmetic, no time zone involved) */
export function shiftDay(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/**
 * The day to show once "today" has moved on: a page still on the old today moves to the
 * new one; a day the user picked (back-dating a bill) stays as it is.
 */
export function followDay(shown: string, oldToday: string, newToday: string): string {
  return shown === oldToday ? newToday : shown;
}
