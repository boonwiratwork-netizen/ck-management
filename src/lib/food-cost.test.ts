import { describe, it, expect } from "vitest";
import { buildUsageContext } from "./sale-usage";
import { actualPct, computeActual, computeStandard, readOnce, receiptUsage, datesWithoutSales, dateRanges, findAttention, lastCount, overlapShare, priceOnOf, receivedBetween, recipeByDay, type FcSale, type UsageCorrection } from "./food-cost";

const ctx = buildUsageContext({
  menus: [
    { id: "m1", menuCode: "MN-004" },
    { id: "m2", menuCode: "MN-080" },
  ],
  bomLines: [
    { menuId: "m1", skuId: "noodle", effectiveQty: 1, branchId: null },
    { menuId: "m1", skuId: "soup", effectiveQty: 300, branchId: null },
    { menuId: "m2", skuId: "gyoza", effectiveQty: 3, branchId: null },
  ],
  rules: [],
  spLines: [],
  skus: [],
});
const stdPrice = new Map([
  ["noodle", 15],
  ["soup", 0.1],
  ["gyoza", 5],
]);
const menuByCode = new Map([
  ["MN-004", { code: "MN-004", name: "Signature ชิโอะ", category: "Ramen" }],
  ["MN-080", { code: "MN-080", name: "Trio Set", category: "Trio" }],
]);
const skuById = new Map([
  ["noodle", { id: "noodle", code: "RM-0171", name: "เส้นโฮลวีท", type: "RM", uom: "ก้อน" }],
  ["soup", { id: "soup", code: "SM-0015", name: "ซุปชิโอะ", type: "SM", uom: "ก." }],
  ["gyoza", { id: "gyoza", code: "SM-0040", name: "เกี๊ยวซ่า", type: "SM", uom: "ชิ้น" }],
]);
const sale = (s: Partial<FcSale>): FcSale => ({ sale_date: "2026-09-10", branch_id: "shiro", menu_code: "MN-004", menu_name: null, qty: 1, net_amount: 379, receipt_no: "A1", ...s });

const std = (sales: FcSale[], corrections: UsageCorrection[] = [], from = "2026-09-01", to = "2026-09-30") =>
  computeStandard({ sales, ctx, stdPrice, menuByCode, skuById, corrections, branchIds: new Set(["shiro"]), from, to });

describe("computeStandard", () => {
  it("prices every sale's ingredients at standard and totals per menu", () => {
    const r = std([sale({ qty: 2, net_amount: 758 }), sale({ menu_code: "MN-080", qty: 1, net_amount: 49, receipt_no: "A2" })]);
    expect(r.revenue).toBe(807);
    expect(r.bills).toBe(2);
    const ramen = r.menus.find((m) => m.code === "MN-004")!;
    expect(ramen.stdCost).toBeCloseTo(2 * (15 + 30));
    expect(ramen.perServing).toBeCloseTo(45);
    // Sorted by % of the price, highest first: Trio 15/49 = 30.6% before ramen 23.7%
    expect(r.menus[0].code).toBe("MN-080");
    expect(r.stdCost).toBeCloseTo(90 + 15);
  });

  it("keeps sales of menus that aren't set up apart (no cost, still revenue)", () => {
    const r = std([sale({ menu_code: "OP-020", menu_name: "เกี๊ยวซ่า (ตัวเลือก)", net_amount: 0 })]);
    expect(r.unknownMenus).toEqual([{ code: "OP-020", name: "เกี๊ยวซ่า (ตัวเลือก)", qty: 1, revenue: 0 }]);
    expect(r.stdCost).toBe(0);
  });

  it("takes a recorded correction off standard usage, with its reason", () => {
    // Shiro, Sep 2026: the old POS counted 469 noodles twice
    const fix: UsageCorrection = { id: "c1", branchId: "shiro", skuId: "noodle", dateFrom: "2026-09-01", dateTo: "2026-09-30", qty: -469, reason: "POS เก่านับเส้นซ้ำ" };
    const sales = Array.from({ length: 986 }, (_, i) => sale({ receipt_no: `R${i}` }));
    const r = std(sales, [fix]);
    const noodle = r.skus.find((s) => s.skuId === "noodle")!;
    expect(noodle.stdQty).toBe(517);
    expect(noodle.stdCost).toBe(517 * 15);
    expect(noodle.correction).toEqual({ qty: -469, reasons: ["POS เก่านับเส้นซ้ำ"] });
  });

  it("ignores corrections for other branches and other months", () => {
    const fix: UsageCorrection = { id: "c1", branchId: "thaniya", skuId: "noodle", dateFrom: "2026-09-01", dateTo: "2026-09-30", qty: -100, reason: "x" };
    const aug: UsageCorrection = { ...fix, branchId: "shiro", dateFrom: "2026-08-01", dateTo: "2026-08-31" };
    expect(std([sale({})], [fix, aug]).skus.find((s) => s.skuId === "noodle")!.correction).toBeNull();
  });
});

describe("overlapShare", () => {
  it("is the share of the correction's days inside the period", () => {
    const c = { dateFrom: "2026-10-01", dateTo: "2026-10-08" };
    expect(overlapShare(c, "2026-10-01", "2026-10-31")).toBe(1);
    expect(overlapShare(c, "2026-10-05", "2026-10-31")).toBe(0.5);
    expect(overlapShare(c, "2026-10-09", "2026-10-31")).toBe(0);
  });
});

describe("lastCount", () => {
  const rows = [
    { sku_id: "noodle", count_date: "2026-08-29", physical_count: 123, calculated_balance: 123 },
    { sku_id: "noodle", count_date: "2026-08-30", physical_count: null, calculated_balance: 0 },
    { sku_id: "noodle", count_date: "2026-09-01", physical_count: 61, calculated_balance: 61 },
  ];
  it("takes the month's last physical count, never one from the next month", () => {
    // The old ±3-day rule picked 1 Sep as August's count (closest to the 31st)
    expect(lastCount(rows, "2026-08-01", "2026-08-31")).toEqual({ qty: 123, date: "2026-08-29", early: true, estimated: false });
  });
  it("falls back to the last sheet's calculated balance when nothing was typed in that month", () => {
    const none = [
      { sku_id: "noodle", count_date: "2026-08-20", physical_count: null, calculated_balance: 40 },
      { sku_id: "noodle", count_date: "2026-08-31", physical_count: null, calculated_balance: 35 },
    ];
    expect(lastCount(none, "2026-08-01", "2026-08-31")).toEqual({ qty: 35, date: "2026-08-31", early: false, estimated: true });
  });
  it("is nothing when the month has no row for the item", () => {
    expect(lastCount(rows, "2026-07-01", "2026-07-31")).toBeNull();
  });
});

describe("receivedBetween", () => {
  it("counts receipts after the opening count's day, up to and on the closing count's day", () => {
    // A branch count is the day's end: that day's receipts are already in it
    expect(receivedBetween("2026-08-29", "2026-08-29", "2026-09-30")).toBe(false);
    expect(receivedBetween("2026-08-30", "2026-08-29", "2026-09-30")).toBe(true);
    expect(receivedBetween("2026-09-30", "2026-08-29", "2026-09-30")).toBe(true);
    expect(receivedBetween("2026-10-01", "2026-08-29", "2026-09-30")).toBe(false);
  });
});

const AUG = { from: "2026-08-01", to: "2026-08-31" };
const SEP = { from: "2026-09-01", to: "2026-09-30" };

describe("computeActual + findAttention", () => {
  // Real Shiro September numbers for เส้นโฮลวีท (RM-0171)
  const r = std(Array.from({ length: 986 }, (_, i) => sale({ receipt_no: `R${i}` })));
  const noodleOnly = r.skus.filter((s) => s.skuId === "noodle");
  const actual = computeActual({
    skus: noodleOnly,
    openingRows: [{ sku_id: "noodle", count_date: "2026-08-31", physical_count: 61, calculated_balance: 61 }],
    closingRows: [{ sku_id: "noodle", count_date: "2026-09-30", physical_count: 160, calculated_balance: 161 }],
    receipts: [150, 100, 115, 100, 150].map((q, i) => ({ sku_id: "noodle", receipt_date: `2026-09-1${i}`, qty_received: q, actual_unit_price: 15 })),
    converter: new Map(),
    pastPrice: new Map(),
    opening: AUG,
    closing: SEP,
  });

  it("uses opening + received − closing at the price paid", () => {
    const row = actual.rows[0];
    expect(row.received).toBe(615);
    expect(row.actQty).toBe(516);
    expect(row.actCost).toBe(516 * 15);
    expect(row.qtyVar).toBe(516 - 986);
    expect(row.totalVar).toBe(516 * 15 - 986 * 15);
    expect(actual.priceVar).toBe(0);
  });

  it("flags recipes that use more than there ever was (counted twice)", () => {
    const items = findAttention({ std: { ...r, skus: noodleOnly, menus: [] }, actual, missingDays: [] });
    expect(items[0].tone).toBe("red");
    expect(items[0].title).toContain("สูตรบอกใช้ 986");
    expect(items[0].title).toContain("แค่ 676");
  });

  it("says when a branch has days without sales", () => {
    const items = findAttention({ std: { ...r, menus: [] }, actual: null, missingDays: [{ branch: "Shiro", dates: ["2026-10-09", "2026-10-10", "2026-10-11"] }] });
    expect(items[0].title).toBe("Shiro ไม่มียอดขาย 3 วัน");
  });
});

describe("computeActual: the counts and what came in between them", () => {
  const noodle = std([sale({})]).skus.filter((s) => s.skuId === "noodle");
  const count = (date: string, qty: number | null, calc = 0) => ({ sku_id: "noodle", count_date: date, physical_count: qty, calculated_balance: calc });
  const rec = (date: string, qty: number) => ({ sku_id: "noodle", receipt_date: date, qty_received: qty, actual_unit_price: 15 });
  const run = (o: ReturnType<typeof count>[], c: ReturnType<typeof count>[], r: ReturnType<typeof rec>[]) =>
    computeActual({ skus: noodle, openingRows: o, closingRows: c, receipts: r, converter: new Map(), pastPrice: new Map(), opening: AUG, closing: SEP });

  it("takes receipts after the opening count (even in the month before) up to the closing count", () => {
    // Last August count on the 28th, last September count on the 27th
    const a = run([count("2026-08-28", 100)], [count("2026-09-01", 500), count("2026-09-27", 80)], [rec("2026-08-28", 999), rec("2026-08-30", 50), rec("2026-09-10", 200), rec("2026-09-27", 10), rec("2026-09-29", 777)]);
    const row = a.rows[0];
    expect(row.opening).toMatchObject({ date: "2026-08-28", qty: 100, early: true });
    expect(row.closing).toMatchObject({ date: "2026-09-27", qty: 80, early: true });
    // 50 + 200 + 10: the 28 Aug receipt is in the opening, the 29 Sep one comes after the closing
    expect(row.received).toBe(260);
    expect(row.receipts).toBe(3);
    expect(row.actQty).toBe(100 + 260 - 80);
    expect(a.openingDays).toEqual({ first: "2026-08-28", last: "2026-08-28" });
    expect(a.closingDays).toEqual({ first: "2026-09-27", last: "2026-09-27" });
  });

  it("ignores a count from the next month (it would end after the receipts do)", () => {
    const a = run([count("2026-08-31", 100)], [count("2026-09-30", 90), count("2026-10-01", 5)], [rec("2026-09-15", 300)]);
    expect(a.rows[0].closing).toMatchObject({ date: "2026-09-30", qty: 90, early: false });
    expect(a.rows[0].actQty).toBe(310);
  });

  it("has no actual when the branch counted nothing in the month before (not an opening of 0)", () => {
    const a = run([], [count("2026-09-30", 90)], [rec("2026-09-15", 300)]);
    expect(a.rows[0].actQty).toBeNull();
    expect(a.withCounts).toBe(0);
    expect(a.rows[0].received).toBe(300);
  });

  it("takes an item on none of the month's sheets, when the branch did count, as not carried (0)", () => {
    const other = { sku_id: "soup", count_date: "2026-08-31", physical_count: 1000, calculated_balance: 1000 };
    const a = run([other as ReturnType<typeof count>], [count("2026-09-30", 90)], [rec("2026-09-15", 300)]);
    expect(a.rows[0].opening).toBeNull();
    expect(a.rows[0].actQty).toBe(210);
  });

  it("prices by what was paid between the counts, else around them", () => {
    const a = run([count("2026-08-31", 100)], [count("2026-09-30", 100)], [{ ...rec("2026-08-20", 10), actual_unit_price: 12 }]);
    expect(a.rows[0].received).toBe(0);
    expect(a.rows[0].actPrice).toBe(12);
  });
});

describe("computeActual: the recipe over the same days as the counts", () => {
  const priceOn = priceOnOf(undefined, stdPrice);
  // 30 bowls a day at Shiro, 26 Aug – 30 Sep (one noodle each)
  const days = (from: number, to: number, month: string) => Array.from({ length: to - from + 1 }, (_, i) => `${month}-${String(from + i).padStart(2, "0")}`);
  const sales = [...days(26, 31, "2026-08"), ...days(1, 30, "2026-09")].map((d, i) => sale({ sale_date: d, qty: 30, receipt_no: `B${i}` }));
  const sep = sales.filter((x) => x.sale_date >= "2026-09-01");
  const noodleSep = std(sep).skus.filter((x) => x.skuId === "noodle");
  const recipeDays = recipeByDay({ sales, ctx, priceOn });
  const count = (date: string, qty: number | null, calc = 0) => ({ sku_id: "noodle", count_date: date, physical_count: qty, calculated_balance: calc });
  const run = (o: ReturnType<typeof count>[], c: ReturnType<typeof count>[], withRecipe = true) =>
    computeActual({
      skus: noodleSep,
      openingRows: o,
      closingRows: c,
      receipts: [{ sku_id: "noodle", receipt_date: "2026-09-05", qty_received: 550, actual_unit_price: 15 }],
      converter: new Map(),
      pastPrice: new Map(),
      opening: AUG,
      closing: SEP,
      ...(withRecipe ? { recipeDays, priceOn } : {}),
    });

  it("an early closing count (20 Sep, sheets 21–30 left untyped) is set against 1–20 Sep, not the month", () => {
    const untyped = days(21, 30, "2026-09").map((d) => count(d, null, 50));
    const a = run([count("2026-08-31", 100)], [count("2026-09-20", 50), ...untyped]);
    const row = a.rows[0];
    expect(row.closing).toMatchObject({ date: "2026-09-20", early: true });
    expect(row.span).toEqual({ from: "2026-09-01", to: "2026-09-20" });
    expect(row.actQty).toBe(100 + 550 - 50);
    expect(row.recipeQty).toBe(600);
    expect(row.stdQty).toBe(900);
    expect(row.qtyVar).toBe(0);
    expect(a.recipeCost).toBe(600 * 15);
    // No red "the recipe counts twice": 600 used, 650 there
    expect(findAttention({ std: { ...std(sep), skus: noodleSep, menus: [] }, actual: a, missingDays: [] }).some((x) => x.key === "imp-noodle")).toBe(false);
    // Against the whole month (the old way) it read 900 used of 650 and raised one
    const wholeMonth = run([count("2026-08-31", 100)], [count("2026-09-20", 50), ...untyped], false);
    expect(findAttention({ std: { ...std(sep), skus: noodleSep, menus: [] }, actual: wholeMonth, missingDays: [] }).some((x) => x.key === "imp-noodle")).toBe(true);
  });

  it("actual % is comparable with the recipe %: ฿0 difference reads the same %", () => {
    const untyped = days(21, 30, "2026-09").map((d) => count(d, null, 50));
    const a = run([count("2026-08-31", 100)], [count("2026-09-20", 50), ...untyped]);
    const st = std(sep);
    const recipePct = (st.stdCost / st.revenue) * 100;
    // 600 used over 1–20 Sep = the recipe then: not the 20-day cost over a 30-day month's sales
    expect(actualPct(st, a)).toBeCloseTo(recipePct);
    expect((a.actCost / st.revenue) * 100).toBeLessThan(recipePct);
    // counted on the month ends with every item: the plain actual cost ÷ sales
    expect(actualPct({ revenue: 1000, stdCost: 200 }, { actCost: 250, recipeCost: 200 })).toBe(25);
    expect(actualPct({ revenue: 0, stdCost: 0 }, { actCost: 1, recipeCost: 1 })).toBeNull();
  });

  it("an opening count on 25 Aug spans 26 Aug to the closing count, recipe included", () => {
    const a = run([count("2026-08-25", 300)], [count("2026-09-30", 50)]);
    expect(a.rows[0].span).toEqual({ from: "2026-08-26", to: "2026-09-30" });
    // 6 August days + 30 September days of 30 bowls
    expect(a.rows[0].recipeQty).toBe(36 * 30);
    expect(a.rows[0].actQty).toBe(300 + 550 - 50);
  });

  it("counted on the month ends, the recipe side is exactly the month's (corrections included)", () => {
    const fix: UsageCorrection = { id: "c1", branchId: "shiro", skuId: "noodle", dateFrom: "2026-09-01", dateTo: "2026-09-30", qty: -469, reason: "POS เก่านับเส้นซ้ำ" };
    const month = std(sep, [fix]).skus.filter((x) => x.skuId === "noodle");
    const a = computeActual({
      skus: month,
      openingRows: [count("2026-08-31", 100)],
      closingRows: [count("2026-09-30", 50)],
      receipts: [],
      converter: new Map(),
      pastPrice: new Map(),
      opening: AUG,
      closing: SEP,
      recipeDays,
      corrections: [fix],
      priceOn,
    });
    expect(a.rows[0].recipeQty).toBe(month[0].stdQty);
    expect(a.rows[0].recipeCost).toBe(month[0].stdCost);
  });

  it("an item on no sheet in either month has no actual (not all its receipts), though the branch counted", () => {
    const soupToo = std(sep).skus.filter((x) => x.skuId === "noodle" || x.skuId === "soup");
    const a = computeActual({
      skus: soupToo,
      openingRows: [count("2026-08-31", 100)],
      closingRows: [count("2026-09-30", 50)],
      receipts: [{ sku_id: "soup", receipt_date: "2026-09-05", qty_received: 99999, actual_unit_price: 0.1 }],
      converter: new Map(),
      pastPrice: new Map(),
      opening: AUG,
      closing: SEP,
      recipeDays,
      priceOn,
    });
    expect(a.rows.find((r) => r.skuId === "soup")!.actQty).toBeNull();
    expect(a.withCounts).toBe(1);
  });
});

describe("dates", () => {
  it("finds the days with no sales, not past today", () => {
    const sales = [sale({ sale_date: "2026-10-01" }), sale({ sale_date: "2026-10-03" })];
    expect(datesWithoutSales(sales, "shiro", "2026-10-01", "2026-10-31", "2026-10-04")).toEqual(["2026-10-02", "2026-10-04"]);
  });
  it("joins consecutive days", () => {
    expect(dateRanges(["2026-10-09", "2026-10-10", "2026-10-11", "2026-10-20"])).toMatch(/^9–11 ต\.ค\., 20 ต\.ค\.$/);
  });
});

describe("receiptUsage", () => {
  it("converts supplier receipts to usage units and prices by what was paid", () => {
    // น้ำมันถั่วเหลือง 5,000 มล. at ฿0.06/มล. (converter 0.92 → grams)
    expect(receiptUsage({ sku_id: "oil", receipt_date: "2026-09-01", qty_received: 5000, actual_unit_price: 0.06, actual_total: 300 }, 0.92)).toEqual({ qty: 4600, paid: 300 });
  });
  it("takes kitchen transfers as they are (already usage units)", () => {
    expect(receiptUsage({ sku_id: "oil", receipt_date: "2026-09-01", qty_received: 1000, actual_unit_price: 0.065, actual_total: 65, transfer_order_id: "to1" }, 0.92)).toEqual({ qty: 1000, paid: 65 });
  });
});

describe("readOnce (the trend's shared reads)", () => {
  it("reads each ask once, however many months ask it", async () => {
    let calls = 0;
    const loader = { sales: async (ids: string[], from: string, to: string) => (calls++, { data: [`${ids}|${from}|${to}`], error: null }), other: () => "untouched" };
    const r = readOnce(loader, ["sales"]);
    const [a, b, c] = await Promise.all([r.sales(["shiro"], "2026-09-01", "2026-09-30"), r.sales(["shiro"], "2026-09-01", "2026-09-30"), r.sales(["shiro"], "2026-10-01", "2026-10-31")]);
    expect(calls).toBe(2);
    expect(a).toBe(b);
    expect(c.data[0]).toBe("shiro|2026-10-01|2026-10-31");
    expect(r.other()).toBe("untouched");
  });
});
