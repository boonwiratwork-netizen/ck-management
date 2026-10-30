import { describe, it, expect } from "vitest";
import { branchBalances, latestCounts, moveRows } from "./branch-stock";

describe("branchBalances", () => {
  const base = {
    skuIds: ["soup"],
    counts: [
      { sku_id: "soup", count_date: "2026-10-28", physical_count: 9000 },
      { sku_id: "soup", count_date: "2026-10-29", physical_count: 9122 },
      { sku_id: "soup", count_date: "2026-10-30", physical_count: null },
    ],
    receipts: [
      { sku_id: "soup", receipt_date: "2026-10-29", qty_received: 3000, transfer_order_id: "to1" }, // on the count day: in the count
      { sku_id: "soup", receipt_date: "2026-10-30", qty_received: 3000, transfer_order_id: "to2" },
    ],
    adjustments: [
      { sku_id: "soup", adjustment_date: "2026-10-30", quantity: -500, reason: "ของเสีย / หมดอายุ" },
      { sku_id: "soup", adjustment_date: "2026-10-30", quantity: 999, reason: "Stock Count variance" },
    ],
    waste: [{ sku_id: "soup", count_date: "2026-10-30", waste: 100 }],
    usageByDay: { soup: { "2026-10-29": 2700, "2026-10-30": 2787 } },
    converter: () => 1,
  };

  it("starts from the latest count and adds only what came after its day", () => {
    const b = branchBalances(base).get("soup")!;
    // 9122 + 3000 − 500 − 100 − 2787
    expect(b.balance).toBe(8735);
    expect(b.countDate).toBe("2026-10-29");
    expect(b.movesAfter).toBe(2);
  });

  it("shows a negative balance as it is", () => {
    const b = branchBalances({ ...base, usageByDay: { soup: { "2026-10-30": 20000 } } }).get("soup")!;
    expect(b.balance).toBeLessThan(0);
  });

  it("converts supplier receipts, not kitchen transfers", () => {
    const b = branchBalances({ ...base, counts: [], adjustments: [], waste: [], usageByDay: {}, receipts: [{ sku_id: "soup", receipt_date: "2026-10-30", qty_received: 1000, transfer_order_id: null }, { sku_id: "soup", receipt_date: "2026-10-30", qty_received: 1000, transfer_order_id: "t" }], converter: () => 0.92 }).get("soup")!;
    expect(b.balance).toBeCloseTo(1920);
    expect(b.countDate).toBeNull();
  });

  it("latestCounts ignores rows not counted", () => {
    expect(latestCounts(base.counts).get("soup")).toEqual({ date: "2026-10-29", qty: 9122 });
  });
});

describe("moveRows", () => {
  const from = { id: "thaniya", name: "Thaniya" };
  const common = { fromBranch: from, skuId: "noodle", skuType: "RM", qty: 50, note: "", date: "2026-10-30" };

  it("a move to another branch writes both sides", () => {
    const rows = moveRows({ ...common, kind: "branch", toBranch: { id: "shiro", name: "Shiro" } });
    expect(rows.map((r) => [r.branch_id, r.quantity])).toEqual([
      ["thaniya", -50],
      ["shiro", 50],
    ]);
    expect(rows[1].reason).toBe("รับโอนจากสาขาอื่น → Thaniya");
  });

  it("a return to the kitchen goes into the kitchen's stock (no branch)", () => {
    const rows = moveRows({ ...common, kind: "kitchen", note: "เหลือจากโปร" });
    expect(rows.map((r) => [r.branch_id, r.quantity])).toEqual([
      ["thaniya", -50],
      [null, 50],
    ]);
    expect(rows[1].reason).toBe("รับคืนจากสาขา Thaniya: เหลือจากโปร");
  });

  it("a fix needs a reason; waste is one side", () => {
    expect(() => moveRows({ ...common, kind: "fix" })).toThrow();
    expect(moveRows({ ...common, kind: "fix", sign: 1, note: "นับผิด" })[0]).toMatchObject({ quantity: 50, reason: "แก้ไขความผิดพลาด: นับผิด" });
    expect(moveRows({ ...common, kind: "waste" })).toHaveLength(1);
  });

  it("can't move to the same branch", () => {
    expect(() => moveRows({ ...common, kind: "branch", toBranch: from })).toThrow();
  });
});
