import { casePayload, habitsOf, mergeCandidates, planPushes, reconcile, rulesForRun, worsened, type CaseRow, type DeliveryRow, type Recipient } from "../../../supabase/functions/_shared/alerts/engine.ts";
import { RULES, needsOf } from "../../../supabase/functions/_shared/alerts/registry.ts";
import { RULE_IDS, parseConfig } from "../../../supabase/functions/_shared/alerts/config.ts";
import type { CaseCandidate } from "../../../supabase/functions/_shared/alerts/types.ts";
import { at, config, iso, NOW } from "./fixture";

const cand = (o: Partial<CaseCandidate>): CaseCandidate => ({ key: "price_rise:s1", rule: "price_rise", title: "หมูราคาขึ้น 12%", detail: "", severity: "medium", value: 12, scope: { skuId: "s1" }, link: { page: "price", skuCode: "RM-001" }, ...o });
const row = (o: Partial<CaseRow>): CaseRow => ({
  key: "price_rise:s1", rule: "price_rise", tier: "morning", title: "t", detail: "", severity: "medium", status: "open", scope: {}, link: { page: "transfer" },
  habit_key: null, habit_day: null, habit_label: null, opened_at: iso("2026-11-05T08:00:00"), changed_at: iso("2026-11-05T08:00:00"), last_seen_at: iso("2026-11-05T08:00:00"), closed_at: null,
  last_value: 12, notified_value: 12, baseline: null, baseline_set_at: null, baseline_candidate: null, acknowledged_at: null, acknowledged_by: null, ...o,
});
const NOW_ISO = new Date(NOW).toISOString();
const rec = (candidates: CaseCandidate[], existing: CaseRow[], evaluated = ["price_rise", "price_rise_big", "count_problem", "to_unreceived"]) =>
  reconcile({ nowIso: NOW_ISO, evaluated: new Set(evaluated as never), candidates, existing, config: config() });

describe("registry", () => {
  it("every rule id is registered exactly once, and adding one is one list entry", () => {
    expect(RULES.map((r) => r.id)).toEqual([...RULE_IDS]);
  });
  it("a tick evaluates only immediate case rules and reads only what they need", () => {
    const tick = rulesForRun("tick", NOW, config()).map((r) => r.rule.id);
    expect(tick).toEqual(["to_declined", "to_short", "price_rise_big"]);
    expect([...needsOf(rulesForRun("tick", NOW, config()).map((r) => r.rule))].sort()).toEqual(["prices", "toLines", "tos"]);
  });
  it("morning: every case rule + weekly on Monday + month close; evening: close of day; a rule switched off never runs", () => {
    const mon = rulesForRun("morning", NOW, config()).map((r) => r.rule.id);
    expect(mon).toContain("weekly_scores");
    expect(mon).toContain("month_close");
    expect(mon).not.toContain("close_of_day");
    const tue = rulesForRun("morning", at("2026-11-10T08:00:00"), config()).map((r) => r.rule.id);
    expect(tue).not.toContain("weekly_scores");
    expect(rulesForRun("evening", NOW, config()).map((r) => r.rule.id)).toEqual(["to_declined", "to_short", "price_rise_big", "close_of_day"]);
    const off = parseConfig([{ rule: "to_short", enabled: false, tier: "immediate", thresholds: {}, worsen_step: null, worsen_mode: null }]);
    expect(rulesForRun("tick", NOW, off).map((r) => r.rule.id)).not.toContain("to_short");
  });
  it("a rule moved to another tier in the settings moves with it", () => {
    const moved = parseConfig([{ rule: "to_unreceived", enabled: true, tier: "immediate", thresholds: {}, worsen_step: null, worsen_mode: null }]);
    expect(rulesForRun("tick", NOW, moved).map((r) => r.rule.id)).toContain("to_unreceived");
  });
});

describe("cases", () => {
  it("first time: opened once", () => {
    const r = rec([cand({})], []);
    expect(r.changes).toEqual([{ key: "price_rise:s1", change: "opened" }]);
    expect(r.rows[0]).toMatchObject({ status: "open", opened_at: NOW_ISO, changed_at: NOW_ISO, notified_value: 12, tier: "morning" });
  });
  it("still there, not worse: updated, no news (changed_at kept)", () => {
    const r = rec([cand({ value: 15 })], [row({})]);
    expect(r.changes[0].change).toBe("updated");
    expect(r.rows[0]).toMatchObject({ changed_at: iso("2026-11-05T08:00:00"), last_value: 15, notified_value: 12 });
  });
  it("worse past the step (+12% → +22%): news again, acknowledgement cleared", () => {
    const r = rec([cand({ value: 22 })], [row({ status: "acknowledged", acknowledged_at: NOW_ISO })]);
    expect(r.changes[0].change).toBe("worsened");
    expect(r.rows[0]).toMatchObject({ status: "open", changed_at: NOW_ISO, notified_value: 22, acknowledged_at: null });
  });
  it("+12% → +28% moves the case to the immediate rule: worse even under the step", () => {
    const r = rec([cand({ value: 20, rule: "price_rise" }), cand({ value: 28, rule: "price_rise_big", severity: "high" })], [row({ notified_value: 19 })]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ rule: "price_rise_big", tier: "immediate", status: "open" });
    expect(r.changes[0].change).toBe("worsened");
  });
  it("acknowledged and not worse: stays silent", () => {
    const r = rec([cand({ value: 14 })], [row({ status: "acknowledged" })]);
    expect(r.rows[0].status).toBe("acknowledged");
    expect(r.changes[0].change).toBe("updated");
  });
  it("condition cleared: closes by itself — only for rules evaluated in this run", () => {
    const r = rec([], [row({}), row({ key: "to_unreceived:t1", rule: "to_unreceived" }), row({ key: "team_red:b1", rule: "team_red" })], ["price_rise", "to_unreceived"]);
    expect(r.changes).toEqual([
      { key: "price_rise:s1", change: "closed" },
      { key: "to_unreceived:t1", change: "closed" },
    ]);
    expect(r.rows[0]).toMatchObject({ status: "closed", closed_at: NOW_ISO });
  });
  it("back after closing: reopened as new news", () => {
    const r = rec([cand({ value: 30 })], [row({ status: "closed", closed_at: iso("2026-11-06T08:00:00") })]);
    expect(r.changes[0].change).toBe("reopened");
    expect(r.rows[0]).toMatchObject({ status: "open", opened_at: NOW_ISO, closed_at: null });
  });
  it("closing clears the price set as normal (it belongs to that rise)", () => {
    const r = rec([], [row({ status: "acknowledged", baseline: 0.26, baseline_set_at: iso("2026-11-08T08:00:00") })]);
    expect(r.rows[0]).toMatchObject({ status: "closed", baseline: null, baseline_set_at: null });
  });
  it("quiet (at the price set as normal): the case stays as it is, no news; never opens or reopens one", () => {
    const acked = row({ status: "acknowledged", baseline: 0.26, notified_value: 0 });
    const r = rec([cand({ value: 2, quiet: true })], [acked]);
    expect(r.changes).toEqual([{ key: "price_rise:s1", change: "updated" }]);
    expect(r.rows[0]).toMatchObject({ status: "acknowledged", baseline: 0.26, changed_at: acked.changed_at });
    expect(rec([cand({ quiet: true })], []).rows).toEqual([]);
    expect(rec([cand({ quiet: true })], [row({ status: "closed" })]).rows).toEqual([]);
  });
  it("after ใช้ราคานี้เป็นปกติ (worsening measured from 0): a new rise past the limit is news again", () => {
    const r = rec([cand({ value: 12 })], [row({ status: "acknowledged", baseline: 0.26, notified_value: 0 })]);
    expect(r.changes[0].change).toBe("worsened");
    expect(r.rows[0].status).toBe("open");
  });
  it("worsening: add and multiply steps; a rule without a step never re-notifies", () => {
    expect(worsened(21.9, 12, { worsenStep: 10, worsenMode: "add" })).toBe(false);
    expect(worsened(22, 12, { worsenStep: 10, worsenMode: "add" })).toBe(true);
    expect(worsened(3000, 1600, { worsenStep: 2, worsenMode: "mult" })).toBe(false);
    expect(worsened(3200, 1600, { worsenStep: 2, worsenMode: "mult" })).toBe(true);
    expect(worsened(99, 1, { worsenStep: null, worsenMode: null })).toBe(false);
  });
  it("two rules finding one key: the more urgent tier wins", () => {
    const tier = (r: string) => (r === "price_rise_big" ? "immediate" : "morning") as never;
    expect(mergeCandidates([cand({ rule: "price_rise", value: 30 }), cand({ rule: "price_rise_big", value: 28 })], tier)[0].rule).toBe("price_rise_big");
  });
});

describe("habits", () => {
  const h = (day: string, k = "count_diff:b1") => ({ habit_key: k, habit_day: day, habit_label: "Sendo สยาม นับ diff เกิน ฿1,000" });
  it("≥4 of the last 7 days = a habit; 3 isn't; days outside the window don't count", () => {
    const g = config().global;
    const four = ["2026-11-02", "2026-11-04", "2026-11-06", "2026-11-08"].map((d) => h(d));
    expect(habitsOf(four, "2026-11-09", g).get("count_diff:b1")).toEqual({ days: 4, label: "Sendo สยาม นับ diff เกิน ฿1,000" });
    expect(habitsOf(four.slice(1), "2026-11-09", g).size).toBe(0);
    expect(habitsOf([...four.slice(1), h("2026-11-01")], "2026-11-09", g).size).toBe(0);
  });
});

describe("pushes", () => {
  const me: Recipient = { userId: "u1", off: new Set() };
  const imm = (o: Partial<CaseRow>) => row({ key: "to_declined:t1", rule: "to_declined", tier: "immediate", severity: "high", changed_at: iso("2026-11-09T09:50:00"), ...o });
  const plan = (cases: CaseRow[], deliveries: DeliveryRow[] = [], nowMs = at("2026-11-09T10:00:00"), recipients = [me], habits = new Map()) => planPushes({ nowMs, config: config(), cases, recipients, deliveries, habits });
  const sent = (key: string, when: string, result: DeliveryRow["result"] = "sent", channel: DeliveryRow["channel"] = "push"): DeliveryRow => ({ case_key: key, user_id: "u1", channel, sent_at: iso(when), result });

  it("inside the window: sent once per piece of news", () => {
    expect(plan([imm({})]).send).toEqual([{ userId: "u1", key: "to_declined:t1" }]);
    expect(plan([imm({})], [sent("to_declined:t1", "2026-11-09T09:55:00")]).send).toEqual([]);
  });
  it("outside 08:00–21:30: held for the morning digest, written down once", () => {
    const night = at("2026-11-09T22:00:00");
    const c = imm({ changed_at: iso("2026-11-09T21:45:00") });
    expect(plan([c], [], night).held).toEqual([{ userId: "u1", key: "to_declined:t1", result: "held_window" }]);
    expect(plan([c], [sent("to_declined:t1", "2026-11-09T21:50:00", "held_window")], night).held).toEqual([]);
  });
  it("5 a day per person: the 6th is held (pushes already sent today count)", () => {
    const today = Array.from({ length: 4 }, (_, i) => sent(`x${i}`, "2026-11-09T09:00:00"));
    const cases = [imm({ key: "a" }), imm({ key: "b" })];
    const p = plan(cases, today);
    expect(p.send.map((s) => s.key)).toEqual(["a"]);
    expect(p.held).toEqual([{ userId: "u1", key: "b", result: "held_cap" }]);
    // yesterday's don't count
    expect(plan(cases, Array.from({ length: 5 }, (_, i) => sent(`y${i}`, "2026-11-08T20:00:00"))).send).toHaveLength(2);
  });
  it("the same case is never pushed again within 24 h, even with new news", () => {
    const p = plan([imm({ changed_at: iso("2026-11-09T09:58:00") })], [sent("to_declined:t1", "2026-11-09T08:30:00")]);
    expect(p.held).toEqual([{ userId: "u1", key: "to_declined:t1", result: "held_dedupe" }]);
    expect(plan([imm({ changed_at: iso("2026-11-09T09:58:00") })], [sent("to_declined:t1", "2026-11-08T08:30:00")]).send).toHaveLength(1);
  });
  it("a failed push is tried again; acknowledged, digest-tier, switched-off and habitual cases are not pushed", () => {
    expect(plan([imm({})], [sent("to_declined:t1", "2026-11-09T09:55:00", "failed")]).send).toHaveLength(1);
    expect(plan([imm({ status: "acknowledged" })]).send).toHaveLength(0);
    expect(plan([imm({ tier: "morning" })]).send).toHaveLength(0);
    expect(plan([imm({})], [], undefined, [{ userId: "u1", off: new Set(["to_declined"]) }]).send).toHaveLength(0);
    expect(plan([imm({ habit_key: "h" })], [], undefined, [me], new Map([["h", {}]])).send).toHaveLength(0);
  });
  it("no burst: news older than the person's first device, or than switching a rule back on, isn't pushed (digest instead)", () => {
    const old = imm({ changed_at: iso("2026-11-09T09:00:00") });
    expect(plan([old], [], undefined, [{ userId: "u1", off: new Set(), since: at("2026-11-09T09:30:00") }]).send).toEqual([]);
    expect(plan([old], [], undefined, [{ userId: "u1", off: new Set(), since: at("2026-11-08T09:30:00") }]).send).toHaveLength(1);
    expect(plan([old], [], undefined, [{ userId: "u1", off: new Set(), ruleSince: new Map([["to_declined", at("2026-11-09T09:30:00")]]) }]).send).toEqual([]);
    expect(plan([imm({ changed_at: iso("2026-11-09T09:45:00") })], [], undefined, [{ userId: "u1", off: new Set(), since: at("2026-11-09T09:30:00") }]).send).toHaveLength(1);
  });
  it("each person has their own cap and log", () => {
    const p = plan([imm({})], [sent("to_declined:t1", "2026-11-09T09:55:00")], undefined, [me, { userId: "u2", off: new Set() }]);
    expect(p.send).toEqual([{ userId: "u2", key: "to_declined:t1" }]);
  });
  it("payload: Thai title/body, deep link into the app, tag = case", () => {
    expect(casePayload({ key: "count_diff:b1:2026-11-08", title: "สาขา นับ diff", detail: "เกิน" })).toEqual({ title: "สาขา นับ diff", body: "เกิน", url: "/alerts#go/count_diff%3Ab1%3A2026-11-08", tag: "count_diff:b1:2026-11-08" });
  });
});
