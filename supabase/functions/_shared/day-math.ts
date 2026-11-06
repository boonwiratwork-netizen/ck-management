// Calendar-day arithmetic shared by the app (src/lib/day-follow.ts re-exports it) and the
// Edge Functions. Plain TypeScript: no Deno, Node or browser APIs, relative imports only.

const pad = (n: number) => String(n).padStart(2, "0");

/** A yyyy-MM-dd day moved by n days (calendar arithmetic, no time zone involved) */
export function shiftDay(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
