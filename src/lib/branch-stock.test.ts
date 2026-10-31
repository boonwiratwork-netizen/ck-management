import { describe, it, expect } from "vitest";
import { anchorWindow, branchBalances, branchFigures, latestCounts, moveRows, pickAnchors, receiptConverter, sheetOpening, usageReadFrom } from "./branch-stock";

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
    expect(latestCounts(base.counts).get("soup")).toEqual({ date: "2026-10-29", qty: 9122, system: false });
  });
});

describe("branchFigures (what the stock page and the request page both read)", () => {
  const base = {
    counts: [{ sku_id: "soup", count_date: "2026-10-21", physical_count: 9000 }],
    receipts: [{ sku_id: "soup", receipt_date: "2026-10-26", qty_received: 6000, transfer_order_id: "to1" }],
    adjustments: [],
    waste: [
      { sku_id: "soup", count_date: "2026-10-23", waste: 100 }, // after the count, before the week
      { sku_id: "soup", count_date: "2026-10-30", waste: 400 },
    ],
    // Shiro-style gap: counted on the 21st, nothing typed since
    usageByDay: { soup: { "2026-10-22": 1000, "2026-10-25": 2000, "2026-10-30": 3000 } },
    sellingDays: 5,
    window: { from: "2026-10-25", to: "2026-10-31" },
    converter: () => 1,
  };

  it("balance = count + received − used − waste after it; use per day over the window only", () => {
    const f = branchFigures(base).get("soup")!;
    expect(f.balance).toBe(9000 + 6000 - 1000 - 2000 - 3000 - 100 - 400);
    // (2000 + 3000 + 400) ÷ 5 selling days; the 22nd and the 23rd are before the window
    expect(f.dailyUse).toBe(1080);
    // the 30th: 3000 used + 400 wasted
    expect(f.peakDailyUse).toBe(3400);
    expect(f.countDate).toBe("2026-10-21");
  });

  it("keeps a negative balance and has no use per day without selling days", () => {
    const f = branchFigures({ ...base, receipts: [], sellingDays: 0 }).get("soup")!;
    expect(f.balance).toBe(9000 - 6000 - 500);
    expect(branchFigures({ ...base, usageByDay: { soup: { "2026-10-30": 20000 } }, receipts: [] }).get("soup")!.balance).toBeLessThan(0);
    expect(f.dailyUse).toBe(0);
    expect(f.peakDailyUse).toBe(0);
  });

  it("converts supplier receipts only when the units differ (the count sheet's rule)", () => {
    expect(receiptConverter({ purchaseUom: "ลิตร", usageUom: "ก.", converter: 920 })).toBe(920);
    expect(receiptConverter({ purchaseUom: "ก.", usageUom: "ก.", converter: 0.92 })).toBe(1);
    expect(receiptConverter(undefined)).toBe(1);
  });
});

describe("pickAnchors (the count sheet's anchor, shared with branch stock)", () => {
  const row = (sku: string, date: string, typed: number | null, calc: number) => ({ sku_id: sku, count_date: date, physical_count: typed, calculated_balance: calc });

  it("takes the latest typed count, even when untyped sheets came after it", () => {
    expect(pickAnchors([row("soup", "2026-10-10", 900, 900), row("soup", "2026-10-20", 1000, 1000), row("soup", "2026-10-25", null, 4000)])).toEqual([{ sku_id: "soup", count_date: "2026-10-20", physical_count: 1000 }]);
  });
  it("falls back to the latest sheet's system figure (negative kept) when nothing was typed", () => {
    expect(pickAnchors([row("tare", "2026-10-24", null, 100), row("tare", "2026-10-25", null, -150)])).toEqual([{ sku_id: "tare", count_date: "2026-10-25", physical_count: -150, system: true }]);
  });
  it("a system figure starts the balance but isn't a count", () => {
    const b = branchBalances({ skuIds: ["tare"], counts: pickAnchors([row("tare", "2026-10-25", null, -150)]), receipts: [], adjustments: [], waste: [], usageByDay: {}, converter: () => 1 }).get("tare")!;
    expect(b).toMatchObject({ balance: -150, countDate: null, anchorDate: "2026-10-25" });
  });
  it("leaves out today's untyped rows (their figure predates today's sales), not today's counts", () => {
    const rows = [row("tare", "2026-10-30", null, 400), row("tare", "2026-10-31", null, 900), row("soup", "2026-10-31", 50, 50)];
    expect(pickAnchors(rows, "2026-10-31")).toEqual([
      { sku_id: "tare", count_date: "2026-10-30", physical_count: 400, system: true },
      { sku_id: "soup", count_date: "2026-10-31", physical_count: 50 },
    ]);
  });
  it("looks back 5 weeks, today included", () => {
    expect(anchorWindow("2026-10-31")).toEqual({ from: "2026-09-27", to: "2026-10-31" });
  });
});

describe("sheetOpening (the count sheet's ยกมา)", () => {
  const anchors = pickAnchors([
    { sku_id: "soup", count_date: "2026-10-20", physical_count: 1000, calculated_balance: 1200 },
    // never typed in the window: the last sheet's system figure, already short
    { sku_id: "tare", count_date: "2026-10-25", physical_count: null, calculated_balance: -150 },
  ]);
  const run = (over: Partial<Parameters<typeof sheetOpening>[0]> = {}) =>
    sheetOpening({ anchors, receipts: [], adjustments: [], waste: [], usageByDate: {}, converter: () => 1, unanchoredFrom: "2026-09-25", ...over });

  it("keeps a shortfall instead of starting again from 0", () => {
    expect(run({ usageByDate: { "2026-10-22": { soup: 1500 } } }).soup).toBe(-500);
    expect(run().tare).toBe(-150);
  });

  it("takes off waste typed on days the item wasn't counted (not the anchor day's own)", () => {
    const waste = [
      { sku_id: "soup", count_date: "2026-10-20", waste: 50 }, // in the count already
      { sku_id: "soup", count_date: "2026-10-22", waste: 80 },
    ];
    expect(run({ waste }).soup).toBe(920);
  });

  it("adds receipts (supplier ones converted) and moves after the anchor, not count adjustments", () => {
    const o = run({
      receipts: [
        { sku_id: "soup", receipt_date: "2026-10-20", qty_received: 999, transfer_order_id: "to0" },
        { sku_id: "soup", receipt_date: "2026-10-21", qty_received: 500, transfer_order_id: "to1" },
        { sku_id: "soup", receipt_date: "2026-10-22", qty_received: 2, transfer_order_id: null },
      ],
      adjustments: [
        { sku_id: "soup", adjustment_date: "2026-10-23", quantity: -100, reason: "ของเสีย / หมดอายุ" },
        { sku_id: "soup", adjustment_date: "2026-10-23", quantity: 777, reason: "Stock Count variance" },
      ],
      converter: () => 1000,
    });
    expect(o.soup).toBe(1000 + 500 + 2000 - 100);
  });

  it("starts a product on no sheet at what came in during the sheet's own gap, without replaying sales", () => {
    // A new sauce: today's recipes on five weeks of sales would open it at −13,000 g, and five
    // weeks of receipts at 50,000 g; the gap (after the earliest anchor, the 20th) holds 2,000
    const o = run({
      unanchoredFrom: "2026-10-21",
      receipts: [
        { sku_id: "sauce", receipt_date: "2026-10-05", qty_received: 48000, transfer_order_id: "old" }, // before the gap
        { sku_id: "sauce", receipt_date: "2026-10-28", qty_received: 2000, transfer_order_id: "to9" },
      ],
      usageByDate: { "2026-10-01": { sauce: 6500 }, "2026-10-29": { sauce: 6500 } },
      waste: [{ sku_id: "sauce", count_date: "2026-10-29", waste: 10 }],
    });
    expect(o.sauce).toBe(2000);
  });

  it("works each product from its own anchor, not the earliest anchor of any product", () => {
    // soup anchored on the 20th, tare on the 25th: tare doesn't take the 22nd's use
    const o = run({ usageByDate: { "2026-10-22": { soup: 100, tare: 100 }, "2026-10-26": { soup: 10, tare: 10 } } });
    expect(o.soup).toBe(890);
    expect(o.tare).toBe(-160);
  });
});

describe("what a branch stock read covers", () => {
  const anchors = [
    { sku_id: "soup", count_date: "2026-10-29", physical_count: 1 },
    { sku_id: "old-item", count_date: "2026-09-28", physical_count: 1 }, // discontinued, counted once
  ];
  it("reads sales from the oldest anchor of the page's own products, at least the week", () => {
    expect(usageReadFrom(anchors, new Set(["soup"]), "2026-10-25")).toBe("2026-10-25");
    // every product (branch stock): the old item's count sets the start
    expect(usageReadFrom(anchors, null, "2026-10-25")).toBe("2026-09-28");
    expect(usageReadFrom([{ sku_id: "soup", count_date: "2026-10-20", physical_count: 1 }], new Set(["soup"]), "2026-10-25")).toBe("2026-10-20");
  });

  it("a never-counted item gets receipts only, one window for all its movements", () => {
    // tare: on no sheet in the window; sales from the week replayed on it read −1,100 before
    const f = branchFigures({
      counts: [],
      receipts: [{ sku_id: "tare", receipt_date: "2026-10-27", qty_received: 600, transfer_order_id: "to1" }],
      adjustments: [],
      waste: [],
      usageByDay: { tare: { "2026-10-26": 850, "2026-10-28": 850 } },
      sellingDays: 7,
      window: { from: "2026-10-25", to: "2026-10-31" },
      converter: () => 1,
      unanchoredFrom: "2026-09-27",
    }).get("tare")!;
    expect(f.balance).toBe(600);
    expect(f.countDate).toBeNull();
    // use per day still comes from the week's sales
    expect(f.dailyUse).toBeCloseTo(1700 / 7);
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
