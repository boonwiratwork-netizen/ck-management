import { describe, expect, it } from "vitest";
import { buildStockRow, coverByStorage, matchesFilter, shownOnPage } from "./kitchen-stock-view";
import type { SKU } from "@/types/sku";

const sku = (over: Partial<SKU> = {}): SKU => ({ id: "s1", skuId: "SM-0002", name: "น้ำมันไก่", type: "SM", status: "Active", storageCondition: "Frozen", usageUom: "g", ...over }) as SKU;
const T = "2026-10-27";
const row = (o: Partial<Parameters<typeof buildStockRow>[1]> = {}, type: "SM" | "RM" = "SM") =>
  buildStockRow(type, { sku: sku(), stock: 1000, unitCost: 0.05, perDay: 100, lastCount: "2026-09-30", movesAfter: 3, lastIn: null, ...o }, T);

describe("kitchen stock rows", () => {
  it("value never goes below 0", () => {
    expect(row({ stock: -500 }).value).toBe(0);
    expect(row({ stock: -500 }).flags.negative).toBe(true);
    expect(row({ stock: 2000 }).value).toBeCloseTo(100);
  });

  it("low = under 7 days of real use", () => {
    expect(row({ stock: 600, perDay: 100 }).flags.low).toBe(true);
    expect(row({ stock: 800, perDay: 100 }).flags.low).toBe(false);
    expect(row({ stock: 600, perDay: 0 }).flags.low).toBe(false);
  });

  it("stale = never counted while holding stock, or a count older than 35 days", () => {
    expect(row({ lastCount: null }).flags.stale).toBe(true);
    expect(row({ lastCount: null, stock: 0 }).flags.stale).toBe(false);
    expect(row({ lastCount: "2026-09-30" }).flags.stale).toBe(false);
    expect(row({ lastCount: "2026-09-15" }).flags.stale).toBe(true);
  });

  it("unusual SM: over 60 days left (น้ำมันไก่ 86 days), or never counted and unused (น้ำสต๊อกโทริ)", () => {
    expect(row({ stock: 28949, perDay: 337 }).flags.unusual).toBe(true);
    expect(row({ stock: 361455, perDay: 0, lastCount: null }).flags.unusual).toBe(true);
    expect(row({ stock: 3000, perDay: 200 }).flags.unusual).toBe(false);
    // Bought items keep a long cover legitimately (packaging): never "unusual"
    expect(row({ stock: 50000, perDay: 10 }, "RM").flags.unusual).toBe(false);
  });

  it("a switched-off item is listed only while it still holds stock", () => {
    expect(shownOnPage(row({ sku: sku({ status: "Inactive" } as Partial<SKU>), stock: 18000 }))).toBe(true);
    expect(shownOnPage(row({ sku: sku({ status: "Inactive" } as Partial<SKU>), stock: 0 }))).toBe(false);
  });

  it("filters and weighted cover by storage", () => {
    const a = row({ stock: 600, perDay: 100 });
    expect(matchesFilter(a, "low")).toBe(true);
    expect(matchesFilter(a, "negative")).toBe(false);
    const cover = coverByStorage([row({ stock: 1000, perDay: 100 }), row({ stock: 3000, perDay: 100 })]);
    expect(cover.Frozen).toBeCloseTo(20); // (1000 + 3000) ÷ (100 + 100)
  });
});
