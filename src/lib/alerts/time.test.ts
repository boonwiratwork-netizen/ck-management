import { DEFAULT_GLOBAL } from "../../../supabase/functions/_shared/alerts/config.ts";
import { ageDays, bkkDay, bkkDow, bkkMinutes, bkkToUtcCron, digestDue, inWindow, nextDigest } from "../../../supabase/functions/_shared/alerts/time.ts";
import { at } from "./fixture";

const g = DEFAULT_GLOBAL;

describe("Bangkok clock", () => {
  it("days and minutes are Bangkok's whatever the server's zone (UTC 17:30 = 00:30 next day)", () => {
    const ms = Date.parse("2026-11-08T17:30:00Z");
    expect(bkkDay(ms)).toBe("2026-11-09");
    expect(bkkMinutes(ms)).toBe(30);
    expect(bkkDow(ms)).toBe(1); // Monday
  });

  it("allowed window 08:00–21:30: start in, end out", () => {
    expect(inWindow(at("2026-11-09T07:59:00"), g)).toBe(false);
    expect(inWindow(at("2026-11-09T08:00:00"), g)).toBe(true);
    expect(inWindow(at("2026-11-09T21:29:00"), g)).toBe(true);
    expect(inWindow(at("2026-11-09T21:30:00"), g)).toBe(false);
    expect(inWindow(at("2026-11-09T02:00:00"), g)).toBe(false);
  });

  it("a window past midnight wraps", () => {
    const w = { windowStart: "22:00", windowEnd: "02:00" };
    expect(inWindow(at("2026-11-09T23:00:00"), w)).toBe(true);
    expect(inWindow(at("2026-11-09T01:00:00"), w)).toBe(true);
    expect(inWindow(at("2026-11-09T12:00:00"), w)).toBe(false);
  });

  it("digests are due from their time up to the catch-up limit", () => {
    expect(digestDue("morning", at("2026-11-09T07:45:00"), g)).toBe(false);
    expect(digestDue("morning", at("2026-11-09T08:00:00"), g)).toBe(true);
    expect(digestDue("morning", at("2026-11-09T09:45:00"), g)).toBe(true);
    expect(digestDue("morning", at("2026-11-09T10:15:00"), g)).toBe(false);
    expect(digestDue("evening", at("2026-11-09T21:15:00"), g)).toBe(true);
    expect(digestDue("evening", at("2026-11-09T21:00:00"), g)).toBe(false);
  });

  it("what a held push waits for: the next digest", () => {
    expect(nextDigest(at("2026-11-09T22:00:00"), g)).toEqual({ kind: "morning", at: at("2026-11-10T08:00:00") });
    expect(nextDigest(at("2026-11-09T12:00:00"), g)).toEqual({ kind: "evening", at: at("2026-11-09T21:15:00") });
    expect(nextDigest(at("2026-11-09T05:00:00"), g)).toEqual({ kind: "morning", at: at("2026-11-09T08:00:00") });
  });

  it("Bangkok times as UTC cron lines (docs): 08:00 → 01:00, 21:15 → 14:15, 03:00 → 20:00", () => {
    expect(bkkToUtcCron("08:00")).toBe("0 1 * * *");
    expect(bkkToUtcCron("21:15")).toBe("15 14 * * *");
    expect(bkkToUtcCron("03:00")).toBe("0 20 * * *");
  });

  it("age in whole days", () => {
    expect(ageDays(at("2026-11-07T09:00:00"), at("2026-11-09T08:00:00"))).toBe(1);
    expect(ageDays(at("2026-11-09T09:00:00"), at("2026-11-09T08:00:00"))).toBe(0);
  });
});
