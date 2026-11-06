import { describe, expect, it } from "vitest";
import { buildView, costMonthsFor, formatMetric, prepare, readFromFor, sortAttention, summaryText, type AdminMasters, type AdminRaw, type Attention } from "./admin-home";
import type { SKU } from "@/types/sku";

const TODAY = "2026-11-06";
const NOW = Date.parse("2026-11-06T10:00:00+07:00");

const sku = (id: string, name: string, code: string): SKU =>
  ({ id, skuId: code, name, type: "RM", category: "", status: "Active", specNote: "", packSize: 1, packUnit: "", purchaseUom: "ก.", usageUom: "ก.", converter: 1, storageCondition: "Chilled", shelfLife: 0, vat: false, supplier1: "", supplier2: "", leadTime: 0, isDistributable: false }) as SKU;

const masters: AdminMasters = {
  skus: [sku("s1", "เนยจืด", "RM-1"), sku("s2", "หมู", "RM-2")],
  prices: [
    { id: "p1", skuId: "s1", supplierId: "x", pricePerPurchaseUom: 0, pricePerUsageUom: 0.4, vat: false, isActive: true, effectiveDate: "", note: "" },
    { id: "p2", skuId: "s2", supplierId: "x", pricePerPurchaseUom: 0, pricePerUsageUom: 0.2, vat: false, isActive: true, effectiveDate: "", note: "" },
  ],
  menus: [
    { id: "m1", menuCode: "MN-1", menuName: "ราเมน", category: "", sellingPrice: 100, status: "Active", brandName: "Sendo", isMaindish: true },
    { id: "m2", menuCode: "MN-2", menuName: "ข้าว", category: "", sellingPrice: 100, status: "Active", brandName: "Sendo", isMaindish: true },
  ],
  menuBomLines: [
    { id: "l1", menuId: "m1", skuId: "s1", qtyPerServing: 10, uom: "ก.", yieldPct: 100, effectiveQty: 10, costPerServing: 0 },
    { id: "l2", menuId: "m2", skuId: "s1", qtyPerServing: 5, uom: "ก.", yieldPct: 100, effectiveQty: 5, costPerServing: 0 },
  ],
  modifierRules: [],
  spBomLines: [],
  branches: [
    { id: "b1", branchName: "Thaniya", brandName: "Sendo", location: "", status: "Active", avgSellingPrice: null },
    { id: "b2", branchName: "ปิดแล้ว", brandName: "Sendo", location: "", status: "Inactive", avgSellingPrice: null },
  ],
};

const empty = (): AdminRaw => ({ today: TODAY, nowMs: NOW, readFrom: readFromFor(TODAY), sales: [], counts: [], tos: [], toLines: [], receipts: [], plans: [], production: [], bills: [], priceChanges: [], recipeCopies: [], corrections: [] });

describe("what is read", () => {
  it("from the start of last month or 4 weeks back, whichever is earlier", () => {
    expect(readFromFor("2026-11-06")).toBe("2026-10-01");
    expect(readFromFor("2026-11-30")).toBe("2026-10-01");
    expect(readFromFor("2026-11-29")).toBe("2026-10-01");
    expect(readFromFor("2026-03-02")).toBe("2026-02-01");
  });
  it("kitchen cost months: the last closed month of every period and chip", () => {
    expect(costMonthsFor("2026-11-06")).toEqual(["2026-09-01", "2026-10-01"]);
  });
});

describe("the view", () => {
  it("no data: kitchen, the active branches, RD; nothing invented", () => {
    const v = buildView(prepare(empty(), masters), "week", new Map());
    expect(v.teams.map((t) => t.id)).toEqual(["ck", "b1", "rd"]);
    const rd = v.teams.find((t) => t.id === "rd")!;
    expect(rd.metrics).toHaveLength(0);
    expect(rd.score.status).toBe("none");
    expect(v.teams[0].chips).toHaveLength(4);
    // Headline numbers without data are null with a reason
    for (const k of v.kpis) {
      expect(k.value).toBeNull();
      expect(k.why).toBeTruthy();
    }
    expect(v.attention).toEqual([]);
  });

  it("ต้องดู: yesterday's count diff, an order sent > 1 day not received, a price rise ≥10% with menus and ≈ baht/week", () => {
    const raw = empty();
    raw.counts.push({ branch_id: "b1", count_date: "2026-11-05", sku_id: "s2", physical_count: 1, variance: -6000, waste: 0, expected_usage: 0, is_submitted: true, submitted_at: "2026-11-05T14:00:00Z" });
    raw.tos.push({ id: "t1", branch_id: "b1", to_number: "TO-9", status: "Sent", sent_at: "2026-11-04T01:00:00Z", delivery_date: "2026-11-04", total_value: 4003 });
    raw.priceChanges.push({ skuId: "s1", pricePerUsageUom: 0.35, validFrom: "2026-09-01T00:00:00Z" }, { skuId: "s1", pricePerUsageUom: 0.4, validFrom: "2026-11-04T03:00:00Z" });
    // 10 bowls of MN-1 in the last 7 days → 100 g of s1
    raw.sales.push({ sale_date: "2026-11-03", branch_id: "b1", menu_code: "MN-1", menu_name: "ราเมน", qty: 10, net_amount: 1000, receipt_no: "r1", created_at: "2026-11-03T15:00:00Z" });
    const v = buildView(prepare(raw, masters), "week", new Map());
    expect(v.attention.map((a) => [a.key, a.tone])).toEqual([
      ["diff-b1", "red"],
      ["to-t1", "amber"],
      ["price-s1", "amber"],
    ]);
    const diff = v.attention[0];
    expect(diff.baht).toBeCloseTo(6000 * 0.2);
    expect(diff.action?.go).toEqual({ path: "/daily-stock-count", state: { date: "2026-11-05" }, remember: ["ck-count-branch", "b1"] });
    const price = v.attention[2];
    expect(price.title).toContain("14%");
    expect(price.detail).toContain("2 เมนู");
    expect(price.baht).toBeCloseTo(0.05 * 100);
    expect(price.action?.go).toEqual({ path: "/cost-center", hash: "p/RM-1" });
  });

  it("red first, then the bigger baht; no baht last", () => {
    const a = (key: string, tone: Attention["tone"], baht: number | null): Attention => ({ key, tone, title: "", detail: "", baht });
    expect(sortAttention([a("1", "amber", 500), a("2", "red", 10), a("3", "amber", null), a("4", "amber", 900)]).map((x) => x.key)).toEqual(["2", "4", "1", "3"]);
  });

  it("food cost by recipe month to date (sales × recipes ÷ sales) against 32%", () => {
    const raw = empty();
    raw.sales.push({ sale_date: "2026-11-02", branch_id: "b1", menu_code: "MN-1", menu_name: "ราเมน", qty: 10, net_amount: 10, receipt_no: "r1", created_at: "2026-11-02T15:00:00Z" });
    const v = buildView(prepare(raw, masters), "week", new Map());
    const fc = v.kpis.find((k) => k.key === "foodcost")!;
    // 100 g × ฿0.4 = ฿40 of ฿10 sales
    expect(fc.value).toBeCloseTo(400);
    expect(fc.target).toBe(32);
  });

  it("week chips; the change follows the period (this week vs the week before)", () => {
    const raw = empty();
    // Open every day of the last two weeks (sales), counted on time only in the newest week
    for (let k = 0; k < 14; k++) {
      const d = new Date(Date.UTC(2026, 9, 23 + k)).toISOString().slice(0, 10);
      raw.sales.push({ sale_date: d, branch_id: "b1", menu_code: "MN-1", menu_name: "ราเมน", qty: 1, net_amount: 100, receipt_no: d, created_at: `${d}T15:00:00Z` });
      if (k >= 7) raw.counts.push({ branch_id: "b1", count_date: d, sku_id: "s1", physical_count: 1, variance: 0, waste: 0, expected_usage: 0, is_submitted: true, submitted_at: `${d}T14:00:00Z` });
    }
    const t = buildView(prepare(raw, masters), "week", new Map()).teams.find((x) => x.id === "b1")!;
    expect(t.metrics.find((m) => m.id === "countOnTime")!.display).toBe("7/7");
    expect(t.prevScore.score).toBeLessThan(t.score.score);
    expect(t.delta).toBe(t.score.score - t.prevScore.score);
    expect(t.chips[3]).toEqual(t.score);
    expect(t.days).toHaveLength(7);
  });

  it("no diff alert while yesterday's sheet is still open before 23:00", () => {
    const raw = { ...empty(), today: "2026-11-05", nowMs: Date.parse("2026-11-05T20:00:00+07:00") };
    raw.counts.push({ branch_id: "b1", count_date: "2026-11-04", sku_id: "s2", physical_count: 1, variance: -9000, waste: 0, expected_usage: 0, is_submitted: false, submitted_at: null });
    // The 4th's deadline passed → judged; make it today's sheet instead
    raw.counts[0].count_date = "2026-11-05";
    const v = buildView(prepare(raw, masters), "today", new Map());
    expect(v.teams.find((x) => x.id === "b1")!.attention.some((a) => a.key.startsWith("diff"))).toBe(false);
  });
});

describe("counted before sales", () => {
  it("2+ days in the period: one ต้องดู item for the branch; no diff alert for those days", () => {
    const raw = empty();
    for (const d of ["2026-11-04", "2026-11-05"]) {
      raw.counts.push({ branch_id: "b1", count_date: d, sku_id: "s2", physical_count: 1, variance: -9000, waste: 0, expected_usage: 0, is_submitted: true, submitted_at: `${d}T14:00:00Z` });
      raw.sales.push({ sale_date: d, branch_id: "b1", menu_code: "MN-1", menu_name: "ราเมน", qty: 1, net_amount: 100, receipt_no: d, created_at: `${d}T16:30:00Z` });
    }
    const v = buildView(prepare(raw, masters), "week", new Map());
    expect(v.attention.map((a) => a.key)).toEqual(["early-b1"]);
    expect(v.attention[0].title).toContain("นับก่อนลงยอดขาย 2 วัน");
    const team = v.teams.find((t) => t.id === "b1")!;
    expect(team.attention.some((a) => a.key === "early-b1")).toBe(true);
    expect(team.attention.some((a) => a.key.startsWith("diff"))).toBe(false);
  });
  it("one day only: no item", () => {
    const raw = empty();
    raw.counts.push({ branch_id: "b1", count_date: "2026-11-05", sku_id: "s2", physical_count: 1, variance: 0, waste: 0, expected_usage: 0, is_submitted: true, submitted_at: "2026-11-05T14:00:00Z" });
    raw.sales.push({ sale_date: "2026-11-05", branch_id: "b1", menu_code: "MN-1", menu_name: "ราเมน", qty: 1, net_amount: 100, receipt_no: "x", created_at: "2026-11-05T16:30:00Z" });
    expect(buildView(prepare(raw, masters), "week", new Map()).attention).toEqual([]);
  });
});

describe("text", () => {
  it("formats", () => {
    expect(formatMetric({ value: null, grade: null }, "share")).toBe("—");
    expect(formatMetric({ value: 6 / 7, passed: 6, total: 7, grade: "pass" }, "count")).toBe("6/7");
    expect(formatMetric({ value: 0.955, grade: "pass" }, "share")).toBe("96%");
    expect(formatMetric({ value: 1.234, grade: "pass" }, "signedPct")).toBe("+1.2%");
    expect(formatMetric({ value: -0.4, grade: "pass" }, "signedPct")).toBe("−0.4%");
    expect(formatMetric({ value: 12.4, grade: "fail" }, "pct")).toBe("12%");
    expect(formatMetric({ value: 1, grade: "pass" }, "done")).toBe("ครบ");
  });
  it("the LINE summary is plain text with the score and each metric", () => {
    const v = buildView(prepare(empty(), masters), "week", new Map());
    const text = summaryText(v.teams.find((t) => t.id === "b1")!, v.period);
    expect(text).toContain("Sendo · Thaniya");
    expect(text).toContain("ตรงเป้า");
    expect(text).toContain("- นับสต๊อกเสร็จทันเวลา:");
    expect(text).not.toMatch(/<|>/);
  });
});
