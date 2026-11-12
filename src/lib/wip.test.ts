import { describe, expect, it } from "vitest";
import { adjustmentLabels, batchCost, wipMix, isTransferReason, isWipInputReason, isWipReason, outputCheck } from "./wip";

describe("WIP reasons and checks", () => {
  it("knows a batch's two sides, transfers and returns from waste and fixes", () => {
    expect(isWipInputReason("WIP: ใช้ทำชาชูรวม [wip a1]")).toBe(true);
    expect(isWipReason("WIP: ทำชาชูรวม [wip a1]")).toBe(true);
    expect(isWipInputReason("WIP: ทำชาชูรวม [wip a1]")).toBe(false);
    for (const r of ["WIP: ทำชาชูรวม [wip a1]", "โอนให้สาขาอื่น → Thaniya", "รับโอนจากสาขาอื่น → Shiro: ด่วน", "ส่งคืนครัวกลาง"]) expect(isTransferReason(r)).toBe(true);
    for (const r of ["ของเสีย / หมดอายุ", "แก้ไขความผิดพลาด: นับผิด", "Stock Count 2026-10-31", null]) expect(isTransferReason(r)).toBe(false);
  });

  it("output against what went in: over 5% or under 85% is worth a look", () => {
    expect(outputCheck(1000, 1000)).toBe("ok");
    expect(outputCheck(1000, 1040)).toBe("ok");
    expect(outputCheck(1000, 1100)).toBe("over");
    expect(outputCheck(1000, 800)).toBe("loss");
    expect(outputCheck(0, 500)).toBe("ok");
  });

  it("a batch's cost: each input by weight at its own price, over what came out", () => {
    // 200 g at ฿0.30 + 300 g at ฿0.26 = ฿138 → 500 g out = ฿0.276/g
    expect(batchCost([{ qty: 200, price: 0.3 }, { qty: 300, price: 0.26 }], 500)).toBeCloseTo(0.276, 6);
    // a 10% loss makes each gram dearer (the cost of what went in stays whole)
    expect(batchCost([{ qty: 1000, price: 0.25 }], 900)).toBeCloseTo(0.2778, 4);
    expect(batchCost([{ qty: 100, price: 1 }], 0)).toBe(0);
  });

  it("a count row's moves said by name, the rest as ปรับยอด", () => {
    expect(
      adjustmentLabels([
        { quantity: -300, reason: "WIP: ใช้ทำชาชูรวม [wip a1]" },
        { quantity: -100, reason: "WIP: ใช้ทำชาชูรวม [wip a2]" },
        { quantity: -50, reason: "โอนให้สาขาอื่น → Thaniya" },
        { quantity: 20, reason: "แก้ไขความผิดพลาด: x" },
      ]),
    ).toEqual([
      { label: "ใช้ทำชาชูรวม", qty: -400 },
      { label: "โอนให้สาขาอื่น", qty: -50 },
      { label: "ปรับยอด", qty: 20 },
    ]);
    expect(adjustmentLabels([{ quantity: 1000, reason: "WIP: ทำชาชูรวม [wip a1]" }])).toEqual([{ label: "ทำเอง", qty: 1000 }]);
  });
});

describe("wipMix (a WIP's average make-up, for per-bowl plans)", () => {
  it("each input per unit of WIP, over all recent batches by weight", () => {
    const m = wipMix([
      { wipSkuId: "w", outputQty: 1000, lines: [{ skuId: "a", qty: 600 }, { skuId: "b", qty: 400 }] },
      { wipSkuId: "w", outputQty: 900, lines: [{ skuId: "a", qty: 1000 }] },
      { wipSkuId: "x", outputQty: 0, lines: [{ skuId: "a", qty: 5 }] },
    ]).get("w")!;
    expect(m.find((x) => x.skuId === "a")!.perUnit).toBeCloseTo(1600 / 1900, 6);
    expect(m.find((x) => x.skuId === "b")!.perUnit).toBeCloseTo(400 / 1900, 6);
  });
});
