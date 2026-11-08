import { describe, expect, it } from "vitest";
import { branchItems, costVariance, kitchenItems, lastClosedMonth, type PlaceInput } from "./cost-variance";

const name = (id: string) => ({ a: "ชาชูสามชั้น", b: "ไข่ไก่", c: "ทาเระชิโอะ", d: "เส้น" })[id] ?? id;

describe("ส่วนต่างต้นทุน จริง − สูตร", () => {
  const places: PlaceInput[] = [
    { key: "ck", name: "ครัวกลาง", kind: "kitchen", state: "ok", usage: 9600, price: -800, items: [{ skuId: "a", usage: 4800, price: 0 }, { skuId: "d", usage: 4800, price: -800 }] },
    { key: "t", name: "Thaniya", kind: "branch", state: "ok", revenue: 400_000, stdCost: 120_000, actCost: 66_700, recipeCost: 60_000, usage: 7100, price: 6300, items: [{ skuId: "b", usage: 0, price: 2900 }, { skuId: "c", usage: -1000, price: 0 }] },
    { key: "s", name: "Sendo", kind: "branch", state: "ok", revenue: 100_000, stdCost: 33_500, actCost: 33_100, recipeCost: 33_500, usage: -2400, price: 2000, items: [] },
    { key: "w", name: "Wanmai", kind: "branch", state: "nocount", revenue: 50_000, stdCost: 15_000 },
  ];
  const v = costVariance(places, name);

  it("adds up by place and by cause, with both signs kept", () => {
    expect(v.usage).toBe(9600 + 7100 - 2400);
    expect(v.price).toBe(-800 + 6300 + 2000);
    expect(v.total).toBe(v.usage + v.price);
    expect(v.rows.map((r) => r.total)).toEqual([8800, 13400, -400, 0]);
    expect(v.rows[3].state).toBe("nocount");
    expect(v.counted).toBe(3);
  });

  it("% over the counted branches only, each actual by Food Cost's formula, plus the kitchen", () => {
    // Thaniya counted half its recipe cost: actual 120,000 × 66,700 ÷ 60,000 = 133,400
    const act = 120_000 * (66_700 / 60_000) + 33_500 * (33_100 / 33_500) + 8_800;
    expect(v.stdPct).toBeCloseTo((153_500 / 500_000) * 100, 6);
    expect(v.actPct).toBeCloseTo((act / 500_000) * 100, 6);
    expect(v.places).toBe(4);
  });

  it("nothing counted yet: recipe % over every branch, no actual %", () => {
    const w = costVariance([{ key: "w", name: "W", kind: "branch", state: "nocount", revenue: 100, stdCost: 30 }], name);
    expect(w.stdPct).toBe(30);
    expect(w.actPct).toBeNull();
  });

  it("movers: biggest either way, with place and the bigger cause", () => {
    expect(v.movers.map((m) => [m.name, m.place, m.total, m.cause])).toEqual([
      ["ชาชูสามชั้น", "ครัวกลาง", 4800, "usage"],
      ["เส้น", "ครัวกลาง", 4000, "usage"],
      ["ไข่ไก่", "Thaniya", 2900, "price"],
    ]);
  });

  it("still loading: not done, and a loading place adds nothing", () => {
    const w = costVariance([{ key: "t", name: "T", kind: "branch", state: "loading", revenue: 10, stdCost: 3 }], name);
    expect(w.done).toBe(false);
    expect(w.actPct).toBeNull();
    expect(w.total).toBe(0);
  });
});

describe("kitchen items", () => {
  it("splits like productionCost: use at standard price, price on what was used", () => {
    const items = kitchenItems([
      { lines: [{ skuId: "a", isRm: true, expected: 100, actual: 120, stdPrice: 2, actPrice: 2.5 }, { skuId: "x", isRm: false, expected: 5, actual: null, stdPrice: 1, actPrice: 1 }] },
      { lines: [{ skuId: "a", isRm: true, expected: 50, actual: 40, stdPrice: 2, actPrice: 2.5 }] },
    ]);
    expect(items).toEqual([{ skuId: "a", usage: 40 - 20, price: 60 + 20 }]);
  });
});

describe("branch items", () => {
  it("usage = total − price; uncounted items left out", () => {
    expect(branchItems([{ skuId: "a", totalVar: 100, priceVar: 30 }, { skuId: "b", totalVar: null, priceVar: null }])).toEqual([{ skuId: "a", usage: 70, price: 30 }]);
  });
});

describe("last closed month", () => {
  it("the month before today's, January wraps", () => {
    expect(lastClosedMonth("2026-11-08")).toEqual({ from: "2026-10-01", to: "2026-10-31", month: "2026-10" });
    expect(lastClosedMonth("2027-01-03")).toEqual({ from: "2026-12-01", to: "2026-12-31", month: "2026-12" });
    expect(lastClosedMonth("2028-03-01").to).toBe("2028-02-29");
  });
});

describe("ครัวกลางในแบบสัปดาห์", () => {
  it("isn't counted as missing", () => {
    const v = costVariance(
      [
        { key: "ck", name: "ครัวกลาง", kind: "kitchen", state: "nocount", notApplicable: true },
        { key: "t", name: "T", kind: "branch", state: "ok", revenue: 100, stdCost: 30, actCost: 31, recipeCost: 30, usage: 1, price: 0, warn: "ยอดขายไม่ครบ 2 วัน" },
      ],
      (id) => id,
    );
    expect([v.counted, v.places]).toEqual([1, 1]);
    expect(v.rows[1].warn).toBe("ยอดขายไม่ครบ 2 วัน");
  });
});
