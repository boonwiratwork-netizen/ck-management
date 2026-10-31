import { describe, expect, it } from "vitest";
import { bangkokDate, followDay, shiftDay } from "./day-follow";

describe("the day a page saves on", () => {
  it("is the calendar day in Bangkok, whatever zone the device is in", () => {
    // 23:59 and 00:01 in Bangkok (UTC+7)
    expect(bangkokDate(new Date("2026-10-31T16:59:00Z"))).toBe("2026-10-31");
    expect(bangkokDate(new Date("2026-10-31T17:01:00Z"))).toBe("2026-11-01");
    // 06:00 in Bangkok is still the day before in UTC
    expect(bangkokDate(new Date("2026-10-31T23:00:00Z"))).toBe("2026-11-01");
  });

  it("moves days across month and year ends", () => {
    expect(shiftDay("2026-11-01", -1)).toBe("2026-10-31");
    expect(shiftDay("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftDay("2026-10-31", -30)).toBe("2026-10-01");
  });

  it("follows the new day only when it was still on the old today", () => {
    // Left open overnight on today: moves on
    expect(followDay("2026-10-31", "2026-10-31", "2026-11-01")).toBe("2026-11-01");
    // A day picked on purpose (back-dating a bill) stays
    expect(followDay("2026-10-28", "2026-10-31", "2026-11-01")).toBe("2026-10-28");
  });
});
