import { describe, it, expect } from "vitest";
import { buildUsageContext } from "./sale-usage";
import { computeActual, computeStandard, receiptUsage, datesWithoutSales, dateRanges, findAttention, overlapShare, pickCount, type FcSale, type UsageCorrection } from "./food-cost";

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

describe("pickCount", () => {
  it("prefers a physical count closest to the date, saying when it's not that day", () => {
    const rows = [
      { sku_id: "noodle", count_date: "2026-08-29", physical_count: 123, calculated_balance: 123 },
      { sku_id: "noodle", count_date: "2026-08-30", physical_count: null, calculated_balance: 0 },
      { sku_id: "noodle", count_date: "2026-09-01", physical_count: 61, calculated_balance: 61 },
    ];
    expect(pickCount(rows, "2026-08-31")).toEqual({ qty: 61, date: "2026-09-01", nearby: true, estimated: false });
  });
});

describe("computeActual + findAttention", () => {
  // Real Shiro September numbers for เส้นโฮลวีท (RM-0171)
  const r = std(Array.from({ length: 986 }, (_, i) => sale({ receipt_no: `R${i}` })));
  const noodleOnly = r.skus.filter((s) => s.skuId === "noodle");
  const actual = computeActual({
    skus: noodleOnly,
    openingRows: [{ sku_id: "noodle", count_date: "2026-09-01", physical_count: 61, calculated_balance: 61 }],
    closingRows: [{ sku_id: "noodle", count_date: "2026-09-30", physical_count: 160, calculated_balance: 161 }],
    receipts: [150, 100, 115, 100, 150].map((q, i) => ({ sku_id: "noodle", receipt_date: `2026-09-1${i}`, qty_received: q, actual_unit_price: 15 })),
    converter: new Map(),
    pastPrice: new Map(),
    openingDate: "2026-08-31",
    closingDate: "2026-09-30",
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
