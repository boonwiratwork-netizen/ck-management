import { describe, expect, it } from "vitest";
import { buildPriceAt } from "./price-history";
import { computeStandard } from "./food-cost";
import { buildUsageContext } from "./sale-usage";

describe("buildPriceAt", () => {
  const at = buildPriceAt([
    { skuId: "pork", pricePerUsageUom: 0.2, validFrom: "2000-01-01T00:00:00+07:00" },
    { skuId: "pork", pricePerUsageUom: 0.25, validFrom: "2026-11-10T14:00:00+07:00" },
    { skuId: "pork", pricePerUsageUom: 0.3, validFrom: "2026-11-10T18:00:00+07:00" },
  ]);
  it("gives the price in force on a day; a change counts for its whole day (the last one that day)", () => {
    expect(at("pork", "2026-10-31")).toBe(0.2);
    expect(at("pork", "2026-11-10")).toBe(0.3);
    expect(at("pork", "2026-12-01")).toBe(0.3);
  });
  it("knows nothing of items without history (caller uses today's price)", () => {
    expect(at("egg", "2026-11-10")).toBeUndefined();
  });
});

describe("food cost at the price of the day", () => {
  it("prices each sale at its own day, so a later change doesn't move a closed month", () => {
    const ctx = buildUsageContext({ menus: [{ id: "m", menuCode: "MN-1" }], bomLines: [{ menuId: "m", skuId: "pork", effectiveQty: 100, branchId: null }], rules: [], spLines: [], skus: [{ id: "pork", type: "RM" }] });
    const sale = (d: string) => ({ branch_id: "b", sale_date: d, menu_code: "MN-1", menu_name: "", qty: 1, net_amount: 100, receipt_no: d });
    const priceAt = buildPriceAt([
      { skuId: "pork", pricePerUsageUom: 0.2, validFrom: "2000-01-01T00:00:00+07:00" },
      { skuId: "pork", pricePerUsageUom: 0.3, validFrom: "2026-11-15T09:00:00+07:00" },
    ]);
    const r = computeStandard({
      sales: [sale("2026-11-14"), sale("2026-11-15")] as never,
      ctx,
      stdPrice: new Map([["pork", 0.3]]),
      priceAt,
      menuByCode: new Map(),
      skuById: new Map(),
      corrections: [],
      branchIds: new Set(["b"]),
      from: "2026-11-01",
      to: "2026-11-30",
    });
    const pork = r.skus.find((s) => s.skuId === "pork")!;
    expect(pork.stdCost).toBeCloseTo(100 * 0.2 + 100 * 0.3);
    expect(pork.stdPrice).toBeCloseTo(0.25);
  });
});
