import { describe, expect, it } from "vitest";
import { afterCount, countDayEvents, producedAfterCount, type CountAnchor } from "./count-anchor";

const day = "2026-10-31";
const done = "2026-10-31T10:00:00+00:00";
const legacy: CountAnchor = { count_date: day, completed_at: done, timing: null };
const before: CountAnchor = { ...legacy, timing: "before" };
const after: CountAnchor = { ...legacy, timing: "after" };

describe("afterCount (receipts, transfers, adjustments)", () => {
  it("days around the count are the same for every answer", () => {
    for (const a of [legacy, before, after]) {
      expect(afterCount(a, "2026-11-01")).toBe(true);
      expect(afterCount(a, "2026-10-30")).toBe(false);
    }
  });
  it("older counts: the count day is already in the count", () => {
    expect(afterCount(legacy, day, "2026-10-31T12:00:00+00:00")).toBe(false);
  });
  it("counted before: the whole count day is added", () => {
    expect(afterCount(before, day, "2026-10-31T01:00:00+00:00")).toBe(true);
    expect(afterCount(before, day)).toBe(true);
  });
  it("counted after: only what was entered after finishing is added", () => {
    expect(afterCount(after, day, "2026-10-31T09:00:00+00:00")).toBe(false);
    expect(afterCount(after, day, "2026-10-31T11:00:00+00:00")).toBe(true);
    expect(afterCount(after, day)).toBe(false);
  });
});

describe("producedAfterCount", () => {
  it("keeps the old entry-time rule", () => {
    expect(producedAfterCount(legacy, day, "2026-10-31T09:00:00+00:00")).toBe(false);
    expect(producedAfterCount(legacy, day, "2026-10-31T11:00:00+00:00")).toBe(true);
    expect(producedAfterCount(after, day, "2026-10-31T11:00:00+00:00")).toBe(true);
  });
  it("counted before: the count day's production is added even if entered earlier", () => {
    expect(producedAfterCount(before, day, "2026-10-31T09:00:00+00:00")).toBe(true);
    expect(producedAfterCount(before, "2026-10-30", "2026-10-30T09:00:00+00:00")).toBe(false);
  });
});

describe("countDayEvents", () => {
  it("one row per supplier, transfer, run and manual adjustment, oldest first", () => {
    const rows = countDayEvents({
      receipts: [
        { supplier: "Freshket", createdAt: "2026-10-31T02:10:00Z" },
        { supplier: "Freshket", createdAt: "2026-10-31T02:05:00Z" },
      ],
      deliveries: [{ branch: "Shiro", lines: 11, sentAt: "2026-10-31T02:30:00Z" }],
      production: [{ name: "ซุปโชยุ", grams: 30000, createdAt: "2026-10-31T07:20:00Z" }],
      adjustments: [
        { name: "หมูสามชั้น", quantity: -500, unit: "g", reason: "เสีย", createdAt: "2026-10-31T08:00:00Z" },
        { name: "แป้ง", quantity: -2000, unit: "g", reason: "Production: 2 batches of SM-0001 [rec 1]", createdAt: "2026-10-31T07:20:00Z" },
        { name: "แป้ง", quantity: 10, unit: "g", reason: "Stock Count 2026-10-31", createdAt: "2026-10-31T09:00:00Z" },
      ],
    });
    expect(rows.map((r) => `${r.sign} ${r.text}`)).toEqual([
      "+ รับของ Freshket · 2 รายการ",
      "− ส่งให้ Shiro · 11 รายการ",
      "+ ผลิตซุปโชยุ · 30 กก.",
      "− ปรับยอด หมูสามชั้น · 500 g",
    ]);
    expect(rows[0].at).toBe("2026-10-31T02:05:00Z");
  });
  it("RM/PK taken out for a transfer dated another day shows once; a listed transfer isn't repeated", () => {
    const rows = countDayEvents({
      receipts: [],
      deliveries: [{ toNumber: "TO-0101", branch: "Shiro", lines: 3, sentAt: "2026-10-31T02:30:00Z" }],
      production: [],
      adjustments: [
        { name: "ชาม", quantity: -50, unit: "ชิ้น", reason: "Distribution: TO-0101", createdAt: "2026-10-31T02:30:01Z" },
        { name: "ชาม", quantity: -20, unit: "ชิ้น", reason: "Distribution: TO-0102", createdAt: "2026-10-31T09:00:00Z" },
        { name: "โชยุ", quantity: -500, unit: "มล.", reason: "Distribution: TO-0102", createdAt: "2026-10-31T09:00:00Z" },
      ],
    });
    expect(rows.map((r) => `${r.sign} ${r.text}`)).toEqual(["− ส่งให้ Shiro · 3 รายการ", "− ส่งของ TO-0102 · 2 รายการ"]);
  });
  it("nothing moved: no rows (no question asked)", () => {
    expect(countDayEvents({ receipts: [], deliveries: [], production: [], adjustments: [] })).toEqual([]);
  });
});
