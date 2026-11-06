import { toDeclined, toShort, toUnreceived } from "../../../supabase/functions/_shared/alerts/rules/transfer.ts";
import { priceRise, priceRiseBig } from "../../../supabase/functions/_shared/alerts/rules/price.ts";
import { countedEarly, countProblem, salesMissing, teamRed } from "../../../supabase/functions/_shared/alerts/rules/branch.ts";
import { closeOfDay, monthClose, weeklyCost, weeklyScores } from "../../../supabase/functions/_shared/alerts/rules/summary.ts";
import { baht, thDay, thDow } from "../../../supabase/functions/_shared/alerts/rules/common.ts";
import type { AlertCountRow, AlertTransferOrder, SalesDay } from "../../../supabase/functions/_shared/alerts/types.ts";
import { cfg, data, iso, NOW } from "./fixture";

const to = (o: Partial<AlertTransferOrder>): AlertTransferOrder => ({ id: "t1", branch_id: "b1", to_number: "TO-001", status: "Sent", sent_at: iso("2026-11-08T10:00:00"), delivery_date: "2026-11-08", total_value: 1500, decline_reason: null, updated_at: iso("2026-11-08T10:00:00"), ...o });
const count = (o: Partial<AlertCountRow>): AlertCountRow => ({ branch_id: "b1", count_date: "2026-11-08", sku_id: "s1", physical_count: 100, variance: 0, waste: 0, expected_usage: 0, is_submitted: true, submitted_at: iso("2026-11-08T22:00:00"), ...o });
const sale = (o: Partial<SalesDay>): SalesDay => ({ branch_id: "b1", sale_date: "2026-11-08", first_created_at: iso("2026-11-08T21:00:00"), net_amount: 10000, ...o });

describe("Thai formats", () => {
  it("days and baht", () => {
    expect(thDay("2026-11-09")).toBe("9 พ.ย.");
    expect(thDow("2026-11-09")).toBe("จ. 9 พ.ย.");
    expect(baht(1234567.4)).toBe("฿1,234,567");
    expect(baht(-50)).toBe("฿50");
  });
});

describe("1 · TO declined", () => {
  it("each declined order within the look-back is its own case, with the reason", () => {
    const out = toDeclined.evaluate(data({ tos: [to({ status: "Declined", decline_reason: "ของเสีย", updated_at: iso("2026-11-09T07:00:00") }), to({ id: "t2", status: "Declined", updated_at: iso("2026-11-01T07:00:00") }), to({ id: "t3" })] }), cfg("to_declined"));
    expect(out.cases.map((c) => c.key)).toEqual(["to_declined:t1"]);
    expect(out.cases[0].title).toBe("Sendo สยาม ปฏิเสธใบโอน TO-001");
    expect(out.cases[0].detail).toContain("เหตุผล: ของเสีย");
    expect(out.cases[0].severity).toBe("high");
  });
});

describe("2 · kitchen sent short", () => {
  const line = (o: Record<string, unknown>) => ({ to_id: "t1", sku_id: "s1", tr_line_id: "r1", planned_qty: 1000, actual_qty: 1000, packs_count: null, unit_cost: 0.2, uom: "g", ...o });
  it("over 10% short is a case; exactly 10% is not; lines not from a request are skipped", () => {
    const d = data({ tos: [to({})], toLines: [line({ actual_qty: 900 }), line({ sku_id: "s3", actual_qty: 850, uom: "ฟอง" }), line({ sku_id: "s1", tr_line_id: null, actual_qty: 0 })] });
    const out = toShort.evaluate(d, cfg("to_short"));
    expect(out.cases).toHaveLength(1);
    expect(out.cases[0].key).toBe("to_short:t1");
    expect(out.cases[0].title).toBe("ครัวส่ง TO-001 ให้ Sendo สยาม ไม่ครบ 1 รายการ");
    expect(out.cases[0].detail).toBe("ไข่ไก่ ขาด 150 ฟอง (15%)");
  });
  it("packed items compare packs × pack size; a request that isn't whole packs is skipped", () => {
    const d = data({ tos: [to({})], toLines: [line({ sku_id: "s2", planned_qty: 2500, actual_qty: 2000, packs_count: 4 }), line({ to_id: "t1", sku_id: "s2", tr_line_id: "r2", planned_qty: 1100, actual_qty: 0, packs_count: 0 })] });
    const out = toShort.evaluate(d, cfg("to_short"));
    expect(out.cases[0].detail).toBe("ซอสโชยุ ขาด 500 g (20%)");
    expect(out.cases[0].value).toBe(1);
  });
  it("the threshold comes from the settings", () => {
    const d = data({ tos: [to({})], toLines: [line({ actual_qty: 880 })] });
    expect(toShort.evaluate(d, cfg("to_short")).cases).toHaveLength(1);
    expect(toShort.evaluate(d, cfg("to_short", { thresholds: { short_pct: 20, lookback_hours: 48 } })).cases).toHaveLength(0);
  });
  it("drafts, declined and orders sent before the look-back don't count", () => {
    const lines = [line({ actual_qty: 0 })];
    expect(toShort.evaluate(data({ tos: [to({ status: "Draft", sent_at: null })], toLines: lines }), cfg("to_short")).cases).toHaveLength(0);
    expect(toShort.evaluate(data({ tos: [to({ sent_at: iso("2026-11-01T10:00:00") })], toLines: lines }), cfg("to_short")).cases).toHaveLength(0);
  });
});

describe("6 · sent, not received", () => {
  it("after 24 h without a branch receipt; a receipt or a younger order clears it; 3+ days is high", () => {
    const d = data({
      tos: [to({ id: "old", sent_at: iso("2026-11-05T10:00:00") }), to({ id: "young", sent_at: iso("2026-11-08T12:00:00") }), to({ id: "got", sent_at: iso("2026-11-05T10:00:00") })],
      receipts: [{ transfer_order_id: "got", created_at: iso("2026-11-05T15:00:00") }],
    });
    const out = toUnreceived.evaluate(d, cfg("to_unreceived"));
    expect(out.cases.map((c) => c.key)).toEqual(["to_unreceived:old"]);
    expect(out.cases[0].value).toBe(3);
    expect(out.cases[0].severity).toBe("high");
    expect(out.cases[0].detail).toMatch(/^3 วัน · มูลค่า ฿1,500/);
  });
});

describe("3 + 8 · price rises (one case per item)", () => {
  const changes = [
    { sku_id: "s1", price_per_usage_uom: 0.2, valid_from: iso("2026-10-01T00:00:00") },
    { sku_id: "s1", price_per_usage_uom: 0.26, valid_from: iso("2026-11-07T09:00:00") },
    { sku_id: "s3", price_per_usage_uom: 4, valid_from: iso("2026-10-01T00:00:00") },
    { sku_id: "s3", price_per_usage_uom: 4.6, valid_from: iso("2026-11-06T09:00:00") },
    { sku_id: "s2", price_per_usage_uom: 0.1, valid_from: iso("2026-10-01T00:00:00") },
    { sku_id: "s2", price_per_usage_uom: 0.2, valid_from: iso("2026-11-06T09:00:00") },
  ];
  it("≥25% is the immediate rule, ≥10% the digest rule; both use price_rise:<sku>; only RM by default", () => {
    const d = data({ priceChanges: changes });
    const big = priceRiseBig.evaluate(d, cfg("price_rise_big")).cases;
    const small = priceRise.evaluate(d, cfg("price_rise")).cases;
    expect(big.map((c) => c.key)).toEqual(["price_rise:s1"]);
    expect(small.map((c) => c.key).sort()).toEqual(["price_rise:s1", "price_rise:s3"]);
    expect(big[0].title).toBe("หมูสามชั้น ราคาขึ้น 30%");
    expect(big[0].detail).toBe("0.200 → 0.260 บาท/g");
    expect(big[0].baselineCandidate).toBe(0.26);
    expect(big[0].link).toEqual({ page: "price", skuCode: "RM-001" });
  });
  it("a change before the look-back isn't news; a new item (no earlier price) isn't judged", () => {
    const d = data({ priceChanges: [{ sku_id: "s1", price_per_usage_uom: 0.5, valid_from: iso("2026-10-20T00:00:00") }, { sku_id: "s3", price_per_usage_uom: 9, valid_from: iso("2026-11-08T00:00:00") }] });
    expect(priceRise.evaluate(d, cfg("price_rise")).cases).toHaveLength(0);
  });
  it("ใช้ราคานี้เป็นปกติ: measured from the price set as normal — quiet (case kept, no news) until it rises again from there", () => {
    const base = new Map([["price_rise:s1", { price: 0.26, setAt: Date.parse("2026-11-08T00:00:00Z") }]]);
    const now = priceRise.evaluate(data({ priceChanges: changes, baselines: base }), cfg("price_rise")).cases;
    expect(now.find((c) => c.key === "price_rise:s1")?.quiet).toBe(true);
    expect(now.find((c) => c.key === "price_rise:s3")?.quiet).toBeUndefined();
    const later = [...changes, { sku_id: "s1", price_per_usage_uom: 0.3, valid_from: iso("2026-11-08T09:00:00") }];
    const again = priceRise.evaluate(data({ priceChanges: later, baselines: base }), cfg("price_rise")).cases.find((c) => c.key === "price_rise:s1")!;
    expect(Math.round(again.value)).toBe(15);
    expect(again.quiet).toBeUndefined();
    expect(again.detail).toContain("เทียบราคาที่ตั้งเป็นปกติ");
  });
  it("a price set as normal before the last change before the look-back is about a price long gone: ignored", () => {
    const old = new Map([["price_rise:s1", { price: 0.26, setAt: Date.parse("2026-09-01T00:00:00Z") }]]);
    const c = priceRise.evaluate(data({ priceChanges: changes, baselines: old }), cfg("price_rise")).cases.find((x) => x.key === "price_rise:s1")!;
    expect(c.quiet).toBeUndefined();
    expect(Math.round(c.value)).toBe(30);
  });
  it("item types come from the settings", () => {
    const d = data({ priceChanges: changes });
    expect(priceRiseBig.evaluate(d, cfg("price_rise_big", { thresholds: { rise_pct: 25, lookback_days: 7, sku_types: ["RM", "SM"] } })).cases.map((c) => c.key).sort()).toEqual(["price_rise:s1", "price_rise:s2"]);
  });
});

describe("5 · daily count", () => {
  it("not finished by 23:00 → count_missing; a closed day (no sheet, no sales) is skipped", () => {
    const d = data({ counts: [count({ is_submitted: false, submitted_at: null })], salesDaily: [sale({})] });
    const out = countProblem.evaluate(d, cfg("count_problem"));
    expect(out.cases.map((c) => c.key)).toEqual(["count_missing:b1:2026-11-08"]);
    expect(out.cases[0].title).toBe("Sendo สยาม ยังไม่กดนับเสร็จ อา. 8 พ.ย.");
    expect(out.cases[0].habitKey).toBe("count_missing:b1");
    expect(out.cases[0].link).toEqual({ page: "count", branchId: "b1", date: "2026-11-08" });
  });
  it("sales but no sheet at all is missing too", () => {
    const out = countProblem.evaluate(data({ salesDaily: [sale({})] }), cfg("count_problem"));
    expect(out.cases.map((c) => c.key)).toEqual(["count_missing:b1:2026-11-08"]);
    expect(out.cases[0].detail).toContain("ไม่มีใบนับ");
  });
  it("difference over ฿1,000 → count_diff with its baht; twice the limit is high; counted before sales isn't judged", () => {
    const rows = [count({ variance: -6000 }), count({ sku_id: "s3", variance: 100 })]; // 6000×0.2 + 100×4 = 1,600
    const out = countProblem.evaluate(data({ counts: rows, salesDaily: [sale({})] }), cfg("count_problem"));
    expect(out.cases.map((c) => c.key)).toEqual(["count_diff:b1:2026-11-08"]);
    expect(out.cases[0].value).toBe(1600);
    expect(out.cases[0].title).toBe("Sendo สยาม นับแล้วขาด/เกิน ฿1,600 อา. 8 พ.ย.");
    expect(out.cases[0].severity).toBe("medium");
    const big = countProblem.evaluate(data({ counts: [count({ variance: -20000 })], salesDaily: [sale({})] }), cfg("count_problem"));
    expect(big.cases[0].severity).toBe("high");
    const early = countProblem.evaluate(data({ counts: rows, salesDaily: [sale({ first_created_at: iso("2026-11-08T23:30:00") })] }), cfg("count_problem"));
    expect(early.cases).toHaveLength(0);
  });
  it("the limit and look-back come from the settings", () => {
    const rows = [count({ variance: -6000 })];
    expect(countProblem.evaluate(data({ counts: rows, salesDaily: [sale({})] }), cfg("count_problem", { thresholds: { close_hour: 23, diff_baht: 2000, lookback_days: 2 } })).cases).toHaveLength(0);
    const older = [count({ count_date: "2026-11-06", variance: -6000 })];
    expect(countProblem.evaluate(data({ counts: older, salesDaily: [sale({ sale_date: "2026-11-06" })] }), cfg("count_problem")).cases).toHaveLength(0);
    expect(countProblem.evaluate(data({ counts: older, salesDaily: [sale({ sale_date: "2026-11-06" })] }), cfg("count_problem", { thresholds: { close_hour: 23, diff_baht: 1000, lookback_days: 3 } })).cases).toHaveLength(1);
  });
});

describe("7 · sales not imported", () => {
  it("a day with a count sheet and no sales; a day with neither is a closed day (skip_if_no_count)", () => {
    const d = data({ counts: [count({})], salesDaily: [sale({ branch_id: "b2" })] });
    const out = salesMissing.evaluate(d, cfg("sales_missing"));
    expect(out.cases.map((c) => c.key)).toEqual(["sales_missing:b1:2026-11-08"]);
    expect(out.cases[0].link).toEqual({ page: "sales", branchId: "b1", date: "2026-11-08" });
    const all = salesMissing.evaluate(d, cfg("sales_missing", { thresholds: { lookback_days: 2, skip_if_no_count: false } }));
    expect(all.cases.map((c) => c.key).sort()).toEqual(["sales_missing:b1:2026-11-07", "sales_missing:b1:2026-11-08", "sales_missing:b2:2026-11-07"]);
  });
});

describe("9 · counted before the sales came in", () => {
  it("≥2 of the last 7 days → one case per branch", () => {
    const days = ["2026-11-06", "2026-11-07"];
    const d = data({
      counts: days.map((day) => count({ count_date: day, submitted_at: iso(`${day}T20:00:00`) })),
      salesDaily: days.map((day) => sale({ sale_date: day, first_created_at: iso(`${day}T22:00:00`) })),
    });
    const out = countedEarly.evaluate(d, cfg("counted_early"));
    expect(out.cases.map((c) => c.key)).toEqual(["counted_early:b1"]);
    expect(out.cases[0].value).toBe(2);
    expect(countedEarly.evaluate(d, cfg("counted_early", { thresholds: { min_days: 3, window_days: 7 } })).cases).toHaveLength(0);
  });
});

// A week where Sendo misses: count never finished, diff over, sales imported 3 days late, waste 2%;
// Shiro meets everything
const WEEK = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"];
const badGoodWeek = () => ({
  counts: WEEK.flatMap((day) => [count({ count_date: day, is_submitted: false, submitted_at: null, variance: -20000, waste: 1000 }), count({ branch_id: "b2", count_date: day, submitted_at: iso(`${day}T22:00:00`) })]),
  salesDaily: WEEK.flatMap((day) => [sale({ sale_date: day, first_created_at: new Date(Date.parse(`${day}T21:00:00+07:00`) + 3 * 86_400_000).toISOString() }), sale({ branch_id: "b2", sale_date: day, first_created_at: iso(`${day}T21:00:00`) })]),
});

describe("4 · team มีปัญหา (the home page's own score)", () => {
  it("a branch that missed every judged metric is มีปัญหา; one that met them is not", () => {
    const out = teamRed.evaluate(data(badGoodWeek()), cfg("team_red"));
    expect(out.cases.map((c) => c.key)).toEqual(["team_red:b1"]);
    expect(out.cases[0].title).toBe("Sendo สยาม สถานะ มีปัญหา");
    expect(out.cases[0].link).toEqual({ page: "admin", teamId: "b1" });
  });
});

describe("10 · close of day", () => {
  it("sales vs same weekday last week, production vs plan, orders due and not sent", () => {
    const d = data({
      today: "2026-11-09",
      nowMs: NOW,
      salesDaily: [sale({ sale_date: "2026-11-09", net_amount: 8000 }), sale({ sale_date: "2026-11-02", net_amount: 10000 })],
      plans: [{ week_start: "2026-11-09", sku_id: "s2", planned_qty_uom: 6000 }],
      production: [{ sm_sku_id: "s2", production_date: "2026-11-09", actual_output_g: 500 }],
      tos: [to({ status: "Draft", sent_at: null, delivery_date: "2026-11-09", to_number: "TO-009" })],
    });
    const text = closeOfDay.evaluate(d, cfg("close_of_day")).info.map((i) => i.text);
    expect(text).toEqual([
      "Sendo สยาม: ยอดขาย ฿8,000 (−20% จากจ. 2 พ.ย. · ตกมาก)",
      "Shiro อารีย์: ยังไม่มียอดขายวันนี้ในระบบ",
      "ครัวกลาง: ผลิตวันนี้ 50% ของแผน (1/6 ของแผนสัปดาห์)",
      "ใบโอนถึงกำหนดแต่ยังไม่ส่ง 1 ใบ: TO-009",
    ]);
  });
});

describe("11 + 12 · weekly", () => {
  it("scores best first", () => {
    const lines = weeklyScores.evaluate(data(badGoodWeek()), cfg("weekly_scores")).info.map((i) => i.text);
    expect(lines[0]).toMatch(/^1\. Shiro อารีย์ \d\/\d ดี/);
    expect(lines[1]).toMatch(/^2\. Sendo สยาม \d\/\d มีปัญหา/);
  });
  it("food cost from the saved analysis, waste % of 7 days, new menus and items, RD later", () => {
    const d = data({
      foodCostMonthly: [
        { branch_id: "b1", month: "2026-11-01", revenue: 100000, std_cost: 31000, has_recipe_cost: true, is_closed_month: false, computed_at: iso("2026-11-08T10:00:00") },
        { branch_id: "b1", month: "2026-11-01", revenue: 5000, std_cost: null, has_recipe_cost: false, is_closed_month: false, computed_at: iso("2026-11-08T10:00:00") },
      ],
      counts: [count({ waste: 500 })],
      salesDaily: [sale({ net_amount: 50000 })],
      newItems: [{ kind: "menu", name: "ราเมงต้มยำ", created_at: iso("2026-11-05T10:00:00") }, { kind: "sku", name: "กุ้งแม่น้ำ", created_at: iso("2026-10-01T10:00:00") }],
    });
    expect(weeklyCost.evaluate(d, cfg("weekly_cost")).info.map((i) => i.text)).toEqual([
      "Food cost ตามสูตร พ.ย. 31.0% (คิดล่าสุด 8 พ.ย.)",
      "Waste 7 วัน 0.20% ของยอดขาย (฿100)",
      "เมนูใหม่ 1: ราเมงต้มยำ · วัตถุดิบใหม่ 0",
      "RD: ยังไม่มีข้อมูลในแอป",
    ]);
  });
});

describe("13 · month close", () => {
  const base = { today: "2026-11-02", nowMs: Date.parse("2026-11-02T08:00:00+07:00") };
  // Last month the kitchen made SM s2, whose recipe uses RM s1 and s3
  const made = { producedSm: ["s2"], recipeRm: new Map([["s2", ["s1", "s3"]]]) };
  it("lists what of last month is missing; nothing after max_days", () => {
    const d = data({
      ...base,
      kitchenMonth: { sessions: [], lines: [], ...made },
      counts: [count({ count_date: "2026-10-31" }), count({ count_date: "2026-10-30" }), count({ branch_id: "b2", count_date: "2026-10-31", is_submitted: false })],
      salesDaily: [sale({ sale_date: "2026-10-31" }), sale({ branch_id: "b2", sale_date: "2026-10-31" })],
      tos: [to({ sent_at: iso("2026-10-30T10:00:00") })],
      foodCostMonthly: [{ branch_id: "b1", month: "2026-10-01", revenue: 1, std_cost: 1, has_recipe_cost: true, is_closed_month: true, computed_at: iso("2026-11-01T10:00:00") }],
    });
    expect(monthClose.evaluate(d, cfg("month_close")).info.map((i) => i.text)).toEqual([
      "ครัวกลางยังไม่นับปิดเดือน ต.ค. (ภายใน ±3 วันจากสิ้นเดือน · นับอย่างน้อยครึ่งหนึ่งของวัตถุดิบ)",
      "Sendo สยาม ยังไม่ลงยอดขาย 1 วัน (30 ต.ค.)",
      "Shiro อารีย์ ยังไม่นับปิดวันสุดท้าย 31 ต.ค.",
      "ใบโอนเดือน ต.ค. ยังไม่กดรับ 1 ใบ",
      "Food cost ต.ค. ยังไม่บันทึก: Shiro อารีย์",
    ]);
    expect(monthClose.evaluate({ ...d, today: "2026-11-11" }, cfg("month_close")).info).toEqual([]);
  });
  it("the kitchen count follows the home page's rule: a session within ±3 days counting ≥ half of the recipes' RM", () => {
    const kitchen = (lines: { session_id: string; sku_id: string; physical_qty: number | null }[], date = "2026-11-01") =>
      monthClose.evaluate(data({ ...base, kitchenMonth: { sessions: [{ id: "k1", count_date: date, status: "Completed" }], lines, ...made } }), cfg("month_close")).info.some((i) => i.text.startsWith("ครัวกลาง"));
    expect(kitchen([{ session_id: "k1", sku_id: "s1", physical_qty: 5 }])).toBe(false); // 1 of 2 = 50%
    expect(kitchen([{ session_id: "k1", sku_id: "s1", physical_qty: null }, { session_id: "k1", sku_id: "s2", physical_qty: 5 }])).toBe(true); // nothing of s1/s3
    expect(kitchen([{ session_id: "k1", sku_id: "s1", physical_qty: 5 }], "2026-11-04")).toBe(true); // 4 days after
    // Nothing made: no RM to count, nothing to say
    expect(monthClose.evaluate(data({ ...base, kitchenMonth: { sessions: [], lines: [], producedSm: [], recipeRm: new Map() } }), cfg("month_close")).info.some((i) => i.text.startsWith("ครัวกลาง"))).toBe(false);
  });
  it("complete = no lines", () => {
    const d = data({
      ...base,
      kitchenMonth: { sessions: [{ id: "k1", count_date: "2026-11-01", status: "Completed" }], lines: [{ session_id: "k1", sku_id: "s1", physical_qty: 1 }, { session_id: "k1", sku_id: "s3", physical_qty: 1 }], ...made },
      counts: [count({ count_date: "2026-10-31" }), count({ branch_id: "b2", count_date: "2026-10-31" })],
      salesDaily: [sale({ sale_date: "2026-10-31" }), sale({ branch_id: "b2", sale_date: "2026-10-31" })],
      foodCostMonthly: ["b1", "b2"].map((b) => ({ branch_id: b, month: "2026-10-01", revenue: 1, std_cost: 1, has_recipe_cost: true, is_closed_month: true, computed_at: iso("2026-11-01T10:00:00") })),
    });
    expect(monthClose.evaluate(d, cfg("month_close")).info).toEqual([]);
  });
});
