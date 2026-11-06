import { buildDigest } from "../../../supabase/functions/_shared/alerts/digest.ts";
import type { CaseRow, DeliveryRow } from "../../../supabase/functions/_shared/alerts/engine.ts";
import { at, config, iso, NOW } from "./fixture";

const row = (o: Partial<CaseRow>): CaseRow => ({
  key: "k", rule: "count_problem", tier: "morning", title: "Sendo สยาม นับ diff ฿1,600 อา. 8 พ.ย.", detail: "เกินเกณฑ์ ฿1,000/วัน", severity: "medium", status: "open", scope: {}, link: { page: "count", branchId: "b1", date: "2026-11-08" },
  habit_key: null, habit_day: null, habit_label: null, opened_at: iso("2026-11-09T08:00:00"), changed_at: iso("2026-11-09T08:00:00"), last_seen_at: iso("2026-11-09T08:00:00"), closed_at: null,
  last_value: 1, notified_value: 1, baseline: null, baseline_set_at: null, baseline_candidate: null, acknowledged_at: null, acknowledged_by: null, ...o,
});
const me = { userId: "u1", off: new Set<never>() };
const build = (o: Partial<Parameters<typeof buildDigest>[0]>) => buildDigest({ kind: "morning", nowMs: NOW, config: config(), recipient: me, cases: [], deliveries: [], habits: new Map(), info: [], ...o });

describe("digest", () => {
  it("new items first (urgent first), then one collapsed line for what is still open", () => {
    const told: DeliveryRow = { case_key: "old", user_id: "u1", channel: "push", sent_at: iso("2026-11-07T10:00:00"), result: "sent" };
    const d = build({
      cases: [
        row({ key: "a" }),
        row({ key: "b", severity: "high", title: "TO-001 ส่งแล้ว Shiro ยังไม่กดรับ", detail: "3 วัน" }),
        row({ key: "old", opened_at: iso("2026-11-05T08:00:00"), changed_at: iso("2026-11-05T08:00:00") }),
        row({ key: "acked", status: "acknowledged" }),
      ],
      deliveries: [told],
    });
    expect(d.title).toBe("สรุปเช้า 9 พ.ย.");
    expect(d.newKeys).toEqual(["b", "a"]);
    expect(d.stillOpen).toBe(1);
    expect(d.lines.map((l) => l.text)).toEqual(["TO-001 ส่งแล้ว Shiro ยังไม่กดรับ · 3 วัน", "Sendo สยาม นับ diff ฿1,600 อา. 8 พ.ย. · เกินเกณฑ์ ฿1,000/วัน", "ยังค้าง 1 เรื่อง (ดูอายุแต่ละเรื่องในแอป)"]);
    expect(d.body).toBe("TO-001 ส่งแล้ว Shiro ยังไม่กดรับ\nSendo สยาม นับ diff ฿1,600 อา. 8 พ.ย.\nยังค้าง 1 เรื่อง");
    expect(d.empty).toBe(false);
  });
  it("pushes held overnight are in the morning digest as new", () => {
    const held: DeliveryRow = { case_key: "a", user_id: "u1", channel: "push", sent_at: iso("2026-11-08T22:00:00"), result: "held_window" };
    expect(build({ cases: [row({ key: "a", changed_at: iso("2026-11-08T22:00:00") })], deliveries: [held] }).newKeys).toEqual(["a"]);
  });
  it("a case that got worse after being told is new again", () => {
    const told: DeliveryRow = { case_key: "a", user_id: "u1", channel: "digest", sent_at: iso("2026-11-08T08:00:00"), result: "sent" };
    expect(build({ cases: [row({ key: "a", changed_at: iso("2026-11-09T08:00:00") })], deliveries: [told] }).newKeys).toEqual(["a"]);
  });
  it("habits: one line, the day-by-day cases left out", () => {
    const d = build({ cases: [row({ key: "h1", habit_key: "count_diff:b1" }), row({ key: "h2", habit_key: "count_diff:b1" })], habits: new Map([["count_diff:b1", { days: 5, label: "Sendo สยาม นับ diff เกิน ฿1,000" }]]) });
    expect(d.newKeys).toEqual([]);
    expect(d.lines.map((l) => l.text)).toEqual(["เป็นประจำ: Sendo สยาม นับ diff เกิน ฿1,000 5/7 วัน"]);
    expect(d.body).toBe("เป็นประจำ: Sendo สยาม นับ diff เกิน ฿1,000 5/7 วัน");
  });
  it("more than 3 new: the push says how many more", () => {
    const d = build({ cases: ["a", "b", "c", "d", "e"].map((k) => row({ key: k, title: `เรื่อง ${k}` })) });
    expect(d.body.split("\n")).toEqual(["เรื่อง a", "เรื่อง b", "เรื่อง c", "และอีก 2 เรื่อง"]);
  });
  it("Monday: the weekly sections with headings; title says so", () => {
    const d = build({ info: [{ rule: "weekly_scores", text: "1. Shiro อารีย์ 5/5 ดี" }, { rule: "weekly_cost", text: "Waste 7 วัน 0.20% ของยอดขาย (฿100)" }] });
    expect(d.title).toBe("สรุปเช้า 9 พ.ย. + สรุปสัปดาห์");
    expect(d.lines.map((l) => l.text)).toEqual(["— คะแนนทีม 7 วัน —", "1. Shiro อารีย์ 5/5 ดี", "— ต้นทุน / waste / ของใหม่ —", "Waste 7 วัน 0.20% ของยอดขาย (฿100)"]);
    expect(d.body).toBe("1. Shiro อารีย์ 5/5 ดี");
  });
  it("close of day title; nothing new and no sections = empty (no push)", () => {
    const d = build({ kind: "evening", nowMs: at("2026-11-09T21:15:00"), cases: [row({ key: "old" })], deliveries: [{ case_key: "old", user_id: "u1", channel: "push", sent_at: iso("2026-11-09T09:00:00"), result: "sent" }] });
    expect(d.title).toBe("สรุปปิดวัน 9 พ.ย.");
    expect(d.empty).toBe(true);
    expect(d.lines.map((l) => l.text)).toEqual(["ยังค้าง 1 เรื่อง (ดูอายุแต่ละเรื่องในแอป)"]);
  });
  it("rules the person switched off are left out", () => {
    const d = buildDigest({ kind: "morning", nowMs: NOW, config: config(), recipient: { userId: "u1", off: new Set(["count_problem", "weekly_scores"]) }, cases: [row({ key: "a" })], deliveries: [], habits: new Map(), info: [{ rule: "weekly_scores", text: "x" }] });
    expect(d.empty).toBe(true);
  });
});
