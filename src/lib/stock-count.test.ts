import { describe, expect, it } from "vitest";
import type { SKU } from "@/types/sku";
import { businessDate, differenceHint, isBigDifference, isDormant, monthEndWindow, orderLines, zoneOf, type CountLine } from "./stock-count";

describe("count day", () => {
  it("before 05:00 belongs to the day that closed", () => {
    expect(businessDate(new Date(2026, 9, 26, 0, 40))).toBe("2026-10-25");
    expect(businessDate(new Date(2026, 9, 26, 4, 59))).toBe("2026-10-25");
    expect(businessDate(new Date(2026, 9, 26, 5, 0))).toBe("2026-10-26");
    expect(businessDate(new Date(2026, 9, 25, 21, 30))).toBe("2026-10-25");
  });
});

describe("month-end window (last 4 days + the 1st)", () => {
  const oct = ["2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"];
  it("covers 28–31 Oct and 1 Nov", () => {
    for (const d of oct) expect(monthEndWindow(d)).toEqual(oct);
    expect(monthEndWindow("2026-10-27")).toBeNull();
    expect(monthEndWindow("2026-11-02")).toBeNull();
  });
  it("follows short months and year end", () => {
    expect(monthEndWindow("2027-02-25")).toEqual(["2027-02-25", "2027-02-26", "2027-02-27", "2027-02-28", "2027-03-01"]);
    expect(monthEndWindow("2027-01-01")).toEqual(["2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01"]);
  });
});

const line = (p: Partial<CountLine>): CountLine => ({ id: "x", skuId: "s", openingBalance: 0, received: 0, expectedUsage: 0, waste: 0, adjNet: 0, calculatedBalance: 0, physicalCount: null, ...p });

describe("products this branch doesn't carry", () => {
  it("folds only when nothing moved and nothing was counted", () => {
    expect(isDormant(line({}))).toBe(true);
    expect(isDormant(line({ received: 500 }))).toBe(false);
    expect(isDormant(line({ expectedUsage: 10 }))).toBe(false);
    expect(isDormant(line({ openingBalance: 100 }))).toBe(false);
    expect(isDormant(line({ physicalCount: 0 }))).toBe(false);
  });
});

describe("differences worth a second count", () => {
  it("ignores small ones, flags big ones", () => {
    expect(isBigDifference({ calculatedBalance: 1792, physicalCount: 1850 }, 1000)).toBe(false);
    expect(isBigDifference({ calculatedBalance: 1380, physicalCount: 960 }, 1)).toBe(true);
    // big in % but only 20 g of a 100 g pack item
    expect(isBigDifference({ calculatedBalance: 30, physicalCount: 10 }, 100)).toBe(false);
    expect(isBigDifference({ calculatedBalance: 100, physicalCount: null }, 1)).toBe(false);
  });
  it("gives a likely reason", () => {
    expect(differenceHint({ calculatedBalance: 149, physicalCount: 627 })).toBe("ลืมรับของ?");
    expect(differenceHint({ calculatedBalance: 1380, physicalCount: 960 })).toBe("ลืมใส่ของเสีย หรือนับไม่ครบ?");
    expect(differenceHint({ calculatedBalance: -220, physicalCount: 400 })).toBe("คงเหลือติดลบ ยอดขายหรือสูตรอาจผิด");
  });
});

describe("order", () => {
  const sku = (id: string, code: string, storage: SKU["storageCondition"]) => ({ id, skuId: code, storageCondition: storage }) as SKU;
  const skus = new Map([sku("a", "RM-3", "Ambient"), sku("b", "RM-2", "Chilled"), sku("c", "RM-1", "Frozen"), sku("d", "RM-0", "Chilled")].map((s) => [s.id, s]));
  const lines = ["a", "b", "c", "d"].map((skuId) => ({ skuId }));
  it("defaults to freezer → fridge → dry, then code", () => {
    expect(orderLines(lines, skus, null).map((l) => l.skuId)).toEqual(["c", "d", "b", "a"]);
    expect(zoneOf(skus.get("a"))).toBe("dry");
  });
  it("keeps the order a person arranged, untouched", () => {
    expect(orderLines(lines, skus, ["a", "c", "b"]).map((l) => l.skuId)).toEqual(["a", "c", "b", "d"]);
  });
});
