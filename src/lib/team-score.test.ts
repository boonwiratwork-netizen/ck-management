import { describe, expect, it } from "vitest";
import {
  DEFAULT_TARGETS,
  bangkokAt,
  bangkokDay,
  billMark,
  branchMetrics,
  chipWeeks,
  countCloseMark,
  diffMark,
  fillMarks,
  fromMarks,
  gradeMax,
  gradeShare,
  kitchenMetrics,
  onDayMark,
  periodOf,
  planShare,
  countedBeforeSales,
  countedBeforeSalesDays,
  monthCountOf,
  planMetric,
  planWeeksFor,
  previousPeriod,
  receiveMark,
  salesImportMark,
  scoreOf,
  statusOf,
  weekStartOf,
  type BranchInput,
  type CountLine,
  type KitchenInput,
  type MetricValue,
  type TransferOrder,
} from "./team-score";

const at = (iso: string) => Date.parse(iso);
/** Bangkok wall time → instant */
const bkk = (day: string, hhmm: string) => at(`${day}T${hhmm}:00+07:00`);
const line = (o: Partial<CountLine> = {}): CountLine => ({ count_date: "2026-11-05", sku_id: "a", physical_count: 10, variance: 0, waste: 0, expected_usage: 0, is_submitted: true, submitted_at: "2026-11-05T15:00:00Z", ...o });
const price = () => 1;
const to = (o: Partial<TransferOrder> = {}): TransferOrder => ({ id: "t1", branch_id: "b", to_number: "TO-1", status: "Received", sent_at: "2026-11-05T01:00:00Z", delivery_date: "2026-11-05", total_value: 100, ...o });

describe("Bangkok time", () => {
  it("days and deadlines don't depend on the device's time zone", () => {
    expect(bangkokDay("2026-11-05T15:59:59Z")).toBe("2026-11-05"); // 22:59 in Bangkok
    expect(bangkokDay("2026-11-05T17:00:00Z")).toBe("2026-11-06"); // midnight
    expect(bangkokAt("2026-11-05", 23)).toBe(at("2026-11-05T16:00:00Z"));
  });
  it("week starts on Monday", () => {
    expect(weekStartOf("2026-11-06")).toBe("2026-11-02"); // Friday
    expect(weekStartOf("2026-11-08")).toBe("2026-11-02"); // Sunday
    expect(weekStartOf("2026-11-02")).toBe("2026-11-02");
  });
});

describe("periods", () => {
  it("สัปดาห์ = 7 days ending yesterday; วันนี้ = today; เดือน = month to yesterday", () => {
    expect(periodOf("week", "2026-11-06")).toMatchObject({ from: "2026-10-30", to: "2026-11-05" });
    expect(periodOf("today", "2026-11-06")).toMatchObject({ from: "2026-11-06", to: "2026-11-06" });
    expect(periodOf("month", "2026-11-06")).toMatchObject({ from: "2026-11-01", to: "2026-11-05" });
  });
  it("เดือน on the 1st is today (nothing of the month has ended)", () => {
    expect(periodOf("month", "2026-11-01")).toMatchObject({ from: "2026-11-01", to: "2026-11-01" });
  });
  it("the period before: same length; a month's same days, clamped to a shorter month", () => {
    expect(previousPeriod(periodOf("week", "2026-11-06"))).toMatchObject({ from: "2026-10-23", to: "2026-10-29" });
    expect(previousPeriod({ kind: "month", from: "2026-03-01", to: "2026-03-30" })).toMatchObject({ from: "2026-02-01", to: "2026-02-28" });
    expect(previousPeriod({ kind: "month", from: "2026-11-01", to: "2026-11-05" })).toMatchObject({ from: "2026-10-01", to: "2026-10-05" });
  });
  it("4 week chips, oldest first, the newest ending yesterday", () => {
    const w = chipWeeks("2026-11-06");
    expect(w.map((x) => [x.from, x.to])).toEqual([
      ["2026-10-09", "2026-10-15"],
      ["2026-10-16", "2026-10-22"],
      ["2026-10-23", "2026-10-29"],
      ["2026-10-30", "2026-11-05"],
    ]);
  });
});

describe("นับปิดวันตรงเวลา (submitted_at before 23:00 Bangkok)", () => {
  const day = "2026-11-05";
  const later = bkk("2026-11-06", "10:00");
  it("22:59 and 23:00 exactly pass, 23:01 fails", () => {
    expect(countCloseMark([line({ submitted_at: "2026-11-05T15:59:00Z" })], day, later)).toBe("pass");
    expect(countCloseMark([line({ submitted_at: "2026-11-05T16:00:00Z" })], day, later)).toBe("pass");
    expect(countCloseMark([line({ submitted_at: "2026-11-05T16:01:00Z" })], day, later)).toBe("fail");
  });
  it("after midnight (still the same count day for the sheet) is late", () => {
    expect(countCloseMark([line({ submitted_at: "2026-11-05T17:30:00Z" })], day, later)).toBe("fail");
  });
  it("the latest finish counts (unlocked and finished again)", () => {
    expect(countCloseMark([line({ submitted_at: "2026-11-05T14:00:00Z" }), line({ sku_id: "b", submitted_at: "2026-11-05T18:00:00Z" })], day, later)).toBe("fail");
  });
  it("not finished: fail once 23:00 has passed, pending before", () => {
    expect(countCloseMark([line({ is_submitted: false, submitted_at: null })], day, later)).toBe("fail");
    expect(countCloseMark([line({ is_submitted: false, submitted_at: null })], day, bkk(day, "20:00"))).toBe("pending");
    expect(countCloseMark([], day, later)).toBe("fail");
    expect(countCloseMark([], day, bkk(day, "12:00"))).toBe("pending");
  });
  it("finished with no time recorded can't be judged", () => {
    expect(countCloseMark([line({ submitted_at: null })], day, later)).toBe("none");
  });
});

describe("diff นับ ≤ ฿1,000", () => {
  const day = "2026-11-05";
  const later = bkk("2026-11-06", "10:00");
  it("Σ |variance| × price of counted rows", () => {
    expect(diffMark([line({ variance: -600 }), line({ sku_id: "b", variance: 400 })], day, later, price)).toBe("pass");
    expect(diffMark([line({ variance: -600 }), line({ sku_id: "b", variance: 401 })], day, later, price)).toBe("fail");
    expect(diffMark([line({ variance: -500 })], day, later, () => 3)).toBe("fail");
    // Not counted rows don't count
    expect(diffMark([line({ variance: 10 }), line({ sku_id: "b", physical_count: null, variance: -5000 })], day, later, price)).toBe("pass");
  });
  it("nothing counted: none; an open sheet before 23:00: pending", () => {
    expect(diffMark([], day, later, price)).toBe("none");
    expect(diffMark([line({ physical_count: null })], day, later, price)).toBe("none");
    expect(diffMark([line({ is_submitted: false, variance: -5000 })], day, bkk(day, "18:00"), price)).toBe("pending");
  });
});

describe("นำเข้ายอดขายภายในวันถัดไป", () => {
  const day = "2026-11-04";
  const s = (created: string) => ({ sale_date: day, created_at: created, net_amount: 100 });
  it("first row by the end of the next day (Bangkok)", () => {
    expect(salesImportMark([s("2026-11-05T16:59:59Z")], day, bkk("2026-11-07", "10:00"))).toBe("pass"); // 23:59:59 on the 5th
    expect(salesImportMark([s("2026-11-05T17:00:01Z")], day, bkk("2026-11-07", "10:00"))).toBe("fail");
    expect(salesImportMark([s("2026-11-05T17:00:01Z"), s("2026-11-04T15:00:00Z")], day, bkk("2026-11-07", "10:00"))).toBe("pass");
  });
  it("none yet: pending until the deadline, then fail", () => {
    expect(salesImportMark([], day, bkk("2026-11-05", "20:00"))).toBe("pending");
    expect(salesImportMark([], day, bkk("2026-11-06", "00:01"))).toBe("fail");
  });
});

describe("รับของจากครัวภายใน 1 วัน", () => {
  const now = at("2026-11-08T00:00:00Z");
  it("first receipt within 24 h of sent_at", () => {
    expect(receiveMark(to(), "2026-11-06T01:00:00Z", now)).toBe("pass");
    expect(receiveMark(to(), "2026-11-06T01:00:01Z", now)).toBe("fail");
  });
  it("still not received: fail after 24 h, pending before", () => {
    expect(receiveMark(to({ status: "Sent" }), undefined, now)).toBe("fail");
    expect(receiveMark(to({ status: "Sent" }), undefined, at("2026-11-05T20:00:00Z"))).toBe("pending");
  });
  it("drafts, declined, and received with no receipt row aren't judged", () => {
    expect(receiveMark(to({ status: "Draft", sent_at: null }), undefined, now)).toBe("none");
    expect(receiveMark(to({ status: "Declined" }), undefined, now)).toBe("none");
    expect(receiveMark(to({ status: "Received" }), undefined, now)).toBe("none");
  });
});

describe("kitchen marks", () => {
  it("ส่งตรงวัน uses the Bangkok day of sent_at", () => {
    // 18:00 UTC on the 4th = 01:00 on the 5th in Bangkok: a day late for the 4th
    expect(onDayMark(to({ sent_at: "2026-11-04T18:00:00Z", delivery_date: "2026-11-04" }), "2026-11-06")).toBe("fail");
    expect(onDayMark(to({ sent_at: "2026-11-04T16:59:00Z", delivery_date: "2026-11-04" }), "2026-11-06")).toBe("pass");
    expect(onDayMark(to({ sent_at: "2026-11-02T03:00:00Z", delivery_date: "2026-11-04" }), "2026-11-06")).toBe("pass");
  });
  it("a draft past its day fails; due today or later is pending; sent with no time can't be judged", () => {
    expect(onDayMark(to({ status: "Draft", sent_at: null, delivery_date: "2026-11-05" }), "2026-11-06")).toBe("fail");
    expect(onDayMark(to({ status: "Draft", sent_at: null, delivery_date: "2026-11-06" }), "2026-11-06")).toBe("pending");
    expect(onDayMark(to({ status: "Sent", sent_at: null }), "2026-11-06")).toBe("none");
  });
  it("บันทึกรับของตรงวัน: bill saved on (or before) its receipt day", () => {
    expect(billMark({ supplier_id: "s", receipt_date: "2026-11-05", created_at: "2026-11-05T16:30:00Z" })).toBe("pass"); // 23:30 Bangkok
    expect(billMark({ supplier_id: "s", receipt_date: "2026-11-05", created_at: "2026-11-05T17:30:00Z" })).toBe("fail");
  });
});

describe("grades", () => {
  it("count targets: 6/7 needed of 7, 1 short = near", () => {
    const m = (p: number, f: number) => fromMarks([...Array(p).fill("pass"), ...Array(f).fill("fail"), "pending", "none"], 6 / 7, "x");
    expect(m(7, 0)).toMatchObject({ passed: 7, total: 7, grade: "pass" });
    expect(m(6, 1).grade).toBe("pass");
    expect(m(5, 2).grade).toBe("near");
    expect(m(4, 3).grade).toBe("fail");
  });
  it("a partial week scales the target (3 of 3 days, 1 of 1 day)", () => {
    expect(fromMarks(["pass", "pass", "fail"], 6 / 7, "x").grade).toBe("near"); // need 3 of 3
    expect(fromMarks(["pass"], 1, "x").grade).toBe("pass");
  });
  it("nothing judged: no value, with the reason", () => {
    expect(fromMarks(["pending", "none"], 1, "ยังไม่ถึงเวลา")).toEqual({ value: null, grade: null, why: "ยังไม่ถึงเวลา" });
  });
  it("shares and ceilings", () => {
    expect(gradeShare(0.95, 0.95)).toBe("pass");
    expect(gradeShare(0.86, 0.95)).toBe("near");
    expect(gradeShare(0.84, 0.95)).toBe("fail");
    expect(gradeMax(3, 3)).toBe("pass");
    expect(gradeMax(4.5, 3)).toBe("near");
    expect(gradeMax(6, 3)).toBe("fail");
    expect(gradeMax(-2, 3)).toBe("pass");
  });
});

describe("branch metrics over a period", () => {
  const p = { from: "2026-11-04", to: "2026-11-05" };
  const now = bkk("2026-11-07", "12:00");
  const base = (o: Partial<BranchInput> = {}): BranchInput => ({ counts: [], sales: [], tos: [], firstReceipt: new Map(), priceOn: price, ...o });

  it("no data at all: every metric is — with a reason, nothing is 0 (no sheet and no sales = closed)", () => {
    const m = branchMetrics(base(), p, now);
    for (const k of ["countOnTime", "salesImport", "receive", "diff", "overRecipe", "waste"] as const) {
      expect(m[k].value).toBeNull();
      expect(m[k].why).toBeTruthy();
    }
  });

  it("closed day (no sheet, no sales) isn't judged; sales but no sheet = missed count; a sheet but no sales = missed import", () => {
    const sales = [{ sale_date: "2026-11-04", created_at: "2026-11-04T15:00:00Z", net_amount: 100 }];
    const counts = [line({ count_date: "2026-11-05" })];
    const m = branchMetrics(base({ sales, counts }), p, now);
    expect(m.countOnTime).toMatchObject({ passed: 1, total: 2 }); // the 4th: sales, no sheet
    expect(m.salesImport).toMatchObject({ passed: 1, total: 2 }); // the 5th: sheet, no sales
    const closed = branchMetrics(base({ sales: [], counts: [line({ count_date: "2026-11-05" })] }), { from: "2026-11-04", to: "2026-11-04" }, now);
    expect(closed.countOnTime.value).toBeNull();
    expect(closed.salesImport.value).toBeNull();
  });

  it("over recipe: each count's variance over the expected use since that item's previous count (sales days only)", () => {
    const sale = (d: string) => ({ sale_date: d, created_at: `${d}T15:00:00Z`, net_amount: 1000 });
    const sales = ["2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"].map(sale);
    const counts = [
      // Daily item: counted 3rd, 4th, 5th — the 4th and 5th are judged (1 day each)
      line({ count_date: "2026-11-03", expected_usage: 100 }),
      line({ count_date: "2026-11-04", expected_usage: 100, variance: -10 }),
      line({ count_date: "2026-11-05", expected_usage: 100, variance: -10 }),
      // Weekly item: counted 29 Oct and 5 Nov, rows (not counted) every day between with their expected use
      line({ sku_id: "w", count_date: "2026-10-29", expected_usage: 50 }),
      ...["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"].map((d) => line({ sku_id: "w", count_date: d, physical_count: null, expected_usage: 50 })),
      line({ sku_id: "w", count_date: "2026-11-05", expected_usage: 50, variance: -35 }),
      // First count of this item in the rows: its window is unknown → not judged
      line({ sku_id: "new", count_date: "2026-11-05", expected_usage: 1000, variance: -900 }),
    ];
    const m = branchMetrics(base({ counts, sales }), p, now);
    // over = 10 + 10 + 35 = 55; recipe = 100 + 100 + 7 × 50 = 550
    expect(m.overRecipe.value).toBeCloseTo(10);
    // The weekly item alone: 35 over 7 days × 50
    const w = branchMetrics(base({ counts: counts.filter((c) => c.sku_id === "w"), sales }), p, now);
    expect(w.overRecipe.value).toBeCloseTo(10);
  });

  it("counted before the day's sales came in: diff and over-recipe of that day aren't judged", () => {
    const sales = [
      { sale_date: "2026-11-04", created_at: "2026-11-04T15:00:00Z", net_amount: 1000 },
      // The 5th's sales came in at 10:00 on the 6th, after the sheet closed at 22:00 on the 5th
      { sale_date: "2026-11-05", created_at: "2026-11-06T03:00:00Z", net_amount: 1000 },
    ];
    const counts = [
      line({ count_date: "2026-11-04", expected_usage: 100, submitted_at: "2026-11-04T15:30:00Z" }),
      line({ count_date: "2026-11-05", expected_usage: 0, variance: -5000, submitted_at: "2026-11-05T15:00:00Z" }),
    ];
    expect(countedBeforeSales(counts.slice(1), sales.slice(1))).toBe(true);
    expect(countedBeforeSales(counts.slice(0, 1), sales.slice(0, 1))).toBe(false);
    expect(countedBeforeSalesDays({ counts, sales }, p)).toEqual(["2026-11-05"]);
    const m = branchMetrics(base({ counts, sales }), p, now);
    expect(m.diff).toMatchObject({ passed: 1, total: 1 }); // the 5th left out
    expect(m.overRecipe.value).toBeNull();
    expect(m.overRecipe.why).toContain("นับก่อนนำเข้ายอดขาย");
  });

  it("an item whose window has a day with sales but no sheet isn't judged (its expected use is incomplete)", () => {
    const sale = (d: string) => ({ sale_date: d, created_at: `${d}T15:00:00Z`, net_amount: 1000 });
    const sales = ["2026-11-02", "2026-11-03", "2026-11-04"].map(sale);
    const counts = [
      line({ count_date: "2026-11-02", expected_usage: 100 }),
      // No sheet at all on the 3rd though it sold
      line({ count_date: "2026-11-04", expected_usage: 100, variance: -50 }),
    ];
    expect(branchMetrics(base({ counts, sales }), { from: "2026-11-04", to: "2026-11-04" }, now).overRecipe.value).toBeNull();
    // With the 3rd's sheet there, it is judged
    const full = [...counts, line({ sku_id: "other", count_date: "2026-11-03" })];
    expect(branchMetrics(base({ counts: full, sales }), { from: "2026-11-04", to: "2026-11-04" }, now).overRecipe.value).toBeCloseTo(50);
  });

  it("days without sales imported are left out of over-recipe and waste", () => {
    const sales = [{ sale_date: "2026-11-04", created_at: "2026-11-04T15:00:00Z", net_amount: 1000 }];
    const counts = [
      line({ count_date: "2026-11-03", expected_usage: 100 }),
      line({ count_date: "2026-11-04", expected_usage: 100, variance: -3, waste: 5 }),
      // The 5th has no sales: its −500 and its waste don't count
      line({ count_date: "2026-11-05", expected_usage: 0, variance: -500, waste: 50 }),
    ];
    const m = branchMetrics(base({ counts, sales, priceOn: () => 2 }), p, now);
    expect(m.overRecipe.value).toBeCloseTo(3);
    expect(m.waste.value).toBeCloseTo(1); // 5 × ฿2 of ฿1,000
  });

  it("zero sales: waste is — (not divided by zero)", () => {
    const m = branchMetrics(base({ counts: [line({ waste: 5 })], sales: [{ sale_date: "2026-11-05", created_at: "2026-11-05T10:00:00Z", net_amount: 0 }] }), p, now);
    expect(m.overRecipe.value).toBeNull();
    expect(m.waste.value).toBeNull();
  });

  it("receive counts each order sent in the period (by its Bangkok sent day)", () => {
    const tos = [to({ id: "a", sent_at: "2026-11-04T02:00:00Z" }), to({ id: "b", sent_at: "2026-11-05T02:00:00Z" }), to({ id: "c", sent_at: "2026-11-03T16:30:00Z" })]; // c = 23:30 on the 3rd: outside
    const firstReceipt = new Map([
      ["a", "2026-11-04T09:00:00Z"],
      ["b", "2026-11-07T09:00:00Z"],
      ["c", "2026-11-04T01:00:00Z"],
    ]);
    const m = branchMetrics(base({ tos, firstReceipt }), p, now);
    expect(m.receive).toMatchObject({ passed: 1, total: 2, grade: "near" }); // one short of all
  });
});

describe("kitchen metrics", () => {
  const p = { from: "2026-11-02", to: "2026-11-05" }; // Mon–Thu
  const base = (o: Partial<KitchenInput> = {}): KitchenInput => ({ tos: [], lines: [], firstReceipt: new Map(), packSize: () => 0, plans: [], production: [], bills: [], costGap: new Map(), ...o });

  describe("ผลิตตามแผน", () => {
    const plans = [
      { week_start: "2026-10-19", sku_id: "x", planned_qty_uom: 6000 },
      { week_start: "2026-10-26", sku_id: "x", planned_qty_uom: 6000 },
      { week_start: "2026-10-26", sku_id: "y", planned_qty_uom: 6000 },
      { week_start: "2026-11-02", sku_id: "x", planned_qty_uom: 6000 },
    ];
    const production = [
      { sm_sku_id: "x", production_date: "2026-10-20", actual_output_g: 6000 },
      { sm_sku_id: "x", production_date: "2026-10-27", actual_output_g: 9000 }, // over: capped at its week's 6000
      { sm_sku_id: "y", production_date: "2026-10-31", actual_output_g: 3000 },
      { sm_sku_id: "x", production_date: "2026-11-06", actual_output_g: 2000 }, // today
    ];
    const pm = (p: { from: string; to: string; kind?: "today" | "week" | "month" }, today = "2026-11-06") => planMetric({ plans, production }, p, today);

    it("สัปดาห์: the most recent completed Mon–Sat plan week, labelled with its dates", () => {
      const m = pm({ kind: "week", from: "2026-10-30", to: "2026-11-05" });
      expect(m.value).toBeCloseTo(0.75); // week of 26 Oct: x 6000/6000, y 3000/6000
      expect(m.grade).toBe("fail");
      expect(m.note).toContain("สัปดาห์ผลิตล่าสุด จ.–ส.");
      expect(m.note).toContain("26");
      expect(m.note).toContain("31");
    });

    it("each week chip uses the plan week that ended in that chip's week", () => {
      expect(planWeeksFor({ kind: "week", from: "2026-10-23", to: "2026-10-29" }, "2026-11-06").weeks).toEqual(["2026-10-19"]);
      expect(pm({ kind: "week", from: "2026-10-23", to: "2026-10-29" }).value).toBe(1);
      // Without a kind (a chip) the same rule
      expect(planWeeksFor({ from: "2026-10-30", to: "2026-11-05" }, "2026-11-06").weeks).toEqual(["2026-10-26"]);
    });

    it("a Saturday that is today isn't finished", () => {
      expect(planWeeksFor({ kind: "week", from: "2026-10-25", to: "2026-10-31" }, "2026-10-31").weeks).toEqual([]);
    });

    it("เดือน: every completed week that started in the month; none yet → the last completed week of the month before, labelled", () => {
      expect(planWeeksFor({ kind: "month", from: "2026-10-01", to: "2026-10-31" }, "2026-11-06").weeks).toEqual(["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"]);
      const early = planWeeksFor({ kind: "month", from: "2026-11-01", to: "2026-11-05" }, "2026-11-06");
      expect(early.weeks).toEqual(["2026-10-26"]);
      expect(early.note).toContain("เดือนก่อน");
      // Weeks with no plan lines simply add nothing: Oct 19 (1.0) + Oct 26 (0.75 of 12000)
      expect(pm({ kind: "month", from: "2026-10-01", to: "2026-10-31" }).value).toBeCloseTo((6000 + 9000) / 18000);
    });

    it("วันนี้: today's progress vs 1/6 of the week's plan, information only (not judged, not scored)", () => {
      const m = pm({ kind: "today", from: "2026-11-06", to: "2026-11-06" });
      expect(m.value).toBeCloseTo(1); // 2000 made vs 1000 planned for a day: capped
      expect(m.grade).toBeNull();
      expect(m.note).toContain("ไม่นับคะแนน");
      expect(scoreOf([m]).total).toBe(0);
      expect(pm({ kind: "today", from: "2026-11-08", to: "2026-11-08" }, "2026-11-08").why).toContain("อาทิตย์");
    });

    it("planShare caps each item per week", () => {
      expect(planShare(plans, production, ["2026-10-26"])).toMatchObject({ planned: 12000, made: 9000 });
      expect(planShare(plans, production, []).value).toBeNull();
    });
  });

  it("sent in full: packs for pack items, 10% allowance otherwise; only request lines of orders sent in the period", () => {
    const tos = [to({ id: "t1", sent_at: "2026-11-03T02:00:00Z" }), to({ id: "t2", sent_at: "2026-10-30T02:00:00Z" })];
    const ln = (o: object) => ({ to_id: "t1", sku_id: "pk", tr_line_id: "r", planned_qty: 3000, actual_qty: 2900, packs_count: 3, unit_cost: 1, uom: "ก.", ...o });
    const lines = [ln({}), ln({ sku_id: "pk", packs_count: 2 }), ln({ sku_id: "g", actual_qty: 2800 }), ln({ sku_id: "g", actual_qty: 2600 }), ln({ tr_line_id: null, packs_count: 0 }), ln({ to_id: "t2", packs_count: 0 })];
    const marks = fillMarks({ tos, lines, packSize: (id) => (id === "pk" ? 1000 : 1) }, p);
    expect(marks.map((m) => m.short)).toEqual([false, true, false, true]);
  });

  it("month-end count comes from the kitchen cost read (same rule and RM base as the kitchen page)", () => {
    const k = (count: "pass" | "fail" | "none" | undefined, today: string) => kitchenMetrics(base({ costGap: count === undefined ? new Map() : new Map([["2026-10-01", { pct: null, count }]]) }), p, today).monthCount;
    expect(k("pass", "2026-11-06")).toMatchObject({ value: 1, grade: "pass" });
    expect(k("fail", "2026-11-06")).toMatchObject({ value: 0, grade: "fail" });
    expect(k("none", "2026-11-06").why).toContain("ไม่มีการผลิต");
    expect(k(undefined, "2026-11-06").value).toBeNull(); // still reading
    // Inside the ±3-day window and not found yet: not judged
    expect(k("fail", "2026-11-02").value).toBeNull();
    expect(monthCountOf({ costGap: new Map([["2026-10-01", { pct: null, count: "pass" }]]) }, "2026-10-01", "2026-11-01")).toBe("pass");
  });

  it("kitchen cost: — while reading or when the month can't be worked out", () => {
    expect(kitchenMetrics(base(), p, "2026-11-06").costGap.value).toBeNull();
    expect(kitchenMetrics(base({ costGap: new Map([["2026-10-01", { pct: null, why: "ไม่มีผลนับ" }]]) }), p, "2026-11-06").costGap.why).toBe("ไม่มีผลนับ");
    expect(kitchenMetrics(base({ costGap: new Map([["2026-10-01", { pct: 1.2 }]]) }), p, "2026-11-06").costGap).toMatchObject({ value: 1.2, grade: "pass" });
    // Either way: −2.5% (cheaper than the recipe by more than 2%) misses too, shown signed
    expect(kitchenMetrics(base({ costGap: new Map([["2026-10-01", { pct: -2.5 }]]) }), p, "2026-11-06").costGap).toMatchObject({ value: -2.5, grade: "near" });
    expect(kitchenMetrics(base({ costGap: new Map([["2026-10-01", { pct: -1.9 }]]) }), p, "2026-11-06").costGap.grade).toBe("pass");
  });
});

describe("score and status", () => {
  const v = (g: MetricValue["grade"]): MetricValue => ({ value: g ? 1 : null, grade: g });
  it("ดี = all met, or 1 missed of 3+; ต้องดู in between; มีปัญหา = all missed or 3+ missed", () => {
    expect(statusOf(6, 6)).toBe("good");
    expect(statusOf(5, 6)).toBe("good");
    expect(statusOf(4, 6)).toBe("watch");
    expect(statusOf(3, 6)).toBe("bad");
    expect(statusOf(2, 3)).toBe("good");
    expect(statusOf(1, 3)).toBe("watch");
    expect(statusOf(0, 3)).toBe("bad");
    // 1–2 metrics judged: any miss is at least ต้องดู
    expect(statusOf(2, 2)).toBe("good");
    expect(statusOf(1, 2)).toBe("watch");
    expect(statusOf(0, 2)).toBe("bad");
    expect(statusOf(1, 1)).toBe("good");
    expect(statusOf(0, 1)).toBe("bad");
    expect(statusOf(0, 0)).toBe("none");
  });
  it("near counts as missed; — metrics are left out of the total", () => {
    expect(scoreOf([v("pass"), v("near"), v("fail"), v(null)])).toEqual({ score: 1, total: 3, status: "watch" });
    expect(scoreOf([v(null)])).toEqual({ score: 0, total: 0, status: "none" });
  });
  it("targets are one config object", () => {
    expect(DEFAULT_TARGETS).toMatchObject({ countCloseHour: 23, diffBahtPerDay: 1000, overRecipePct: 3, wastePct: 0.5, kitchenCostGapPct: 2, foodCostPct: 32 });
  });
});
