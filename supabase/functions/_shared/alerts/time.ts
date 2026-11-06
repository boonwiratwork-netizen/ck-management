// Bangkok clock for the push alerts: the allowed hours, digest times, the day a cap counts on.
// Bangkok is UTC+7 all year (no daylight saving), so the server's own time zone (UTC on
// Supabase) never moves anything. Plain TypeScript, relative imports only.

import type { GlobalConfig } from "./config.ts";
import { shiftDay } from "../day-math.ts";

const HOUR = 3_600_000;
const BKK = 7 * HOUR;

/** The Bangkok calendar day (yyyy-MM-dd) of an instant */
export const bkkDay = (ms: number) => new Date(ms + BKK).toISOString().slice(0, 10);
/** Minutes since Bangkok midnight */
export const bkkMinutes = (ms: number) => {
  const d = new Date(ms + BKK);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};
/** Bangkok day of the week (0 = Sunday) */
export const bkkDow = (ms: number) => new Date(ms + BKK).getUTCDay();
/** "HH:MM" → minutes since midnight */
export const hm = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
/** The instant of `day` at "HH:MM" Bangkok */
export const bkkAt = (day: string, time: string) => Date.parse(`${day}T00:00:00+07:00`) + hm(time) * 60_000;

/** Inside the allowed push hours (start inclusive, end exclusive). An end before the start wraps past midnight. */
export function inWindow(ms: number, g: Pick<GlobalConfig, "windowStart" | "windowEnd">): boolean {
  const m = bkkMinutes(ms);
  const a = hm(g.windowStart);
  const b = hm(g.windowEnd);
  return a <= b ? m >= a && m < b : m >= a || m < b;
}

export type DigestKind = "morning" | "evening";

/**
 * Is a digest due on this run? Its time has come today and it is no more than the catch-up
 * time late (a failed run is made up for, a day-old one isn't). Whether it already went out
 * today is the caller's check (alert_digests keeps one row per kind and day).
 */
export function digestDue(kind: DigestKind, ms: number, g: GlobalConfig): boolean {
  const at = hm(kind === "morning" ? g.morningAt : g.eveningAt);
  const m = bkkMinutes(ms);
  return m >= at && m <= at + g.digestCatchupMinutes;
}

/** The next digest after an instant (what a held push is waiting for) */
export function nextDigest(ms: number, g: GlobalConfig): { kind: DigestKind; at: number } {
  const day = bkkDay(ms);
  const options = [
    { kind: "morning" as const, at: bkkAt(day, g.morningAt) },
    { kind: "evening" as const, at: bkkAt(day, g.eveningAt) },
    { kind: "morning" as const, at: bkkAt(shiftDay(day, 1), g.morningAt) },
  ].filter((o) => o.at > ms);
  return options.sort((a, b) => a.at - b.at)[0];
}

/** Whole days between two instants (for "ค้างมา N วัน") */
export const ageDays = (fromMs: number, toMs: number) => Math.max(0, Math.floor((toMs - fromMs) / (24 * HOUR)));

/**
 * pg_cron schedules are in UTC. The alerts run every 15 minutes and read the times above
 * from the settings, so no schedule depends on a Bangkok time — this is kept for the docs
 * and tests: a Bangkok "HH:MM" as a UTC cron line.
 */
export function bkkToUtcCron(time: string): string {
  const m = (hm(time) - 7 * 60 + 24 * 60) % (24 * 60);
  return `${m % 60} ${Math.floor(m / 60)} * * *`;
}
