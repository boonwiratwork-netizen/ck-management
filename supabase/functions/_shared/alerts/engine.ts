// Push alerts: turning what the rules found into cases, and cases into pushes.
//
// A case is one thing that is wrong, under a stable key (price_rise:<sku>, …). It is
// opened once and notified once. While it stays open it is not sent again; it is sent
// once more only if it gets worse past the rule's step (or moves up to an immediate rule),
// and "รับทราบ" silences it until then. It closes by itself when the rule no longer finds it.
//
// Pure: the Edge Function reads the rows, calls these, and writes what comes back.
// Plain TypeScript, relative imports only.

import type { AlertConfig, RuleConfig, RuleId, Tier } from "./config.ts";
import { RULES } from "./registry.ts";
import { bkkDay, bkkDow, inWindow } from "./time.ts";
import type { AlertRule, CaseCandidate, CaseLink, Severity } from "./types.ts";
import { shiftDay } from "../day-math.ts";

export type RunKind = "tick" | "morning" | "evening";
export type CaseStatus = "open" | "acknowledged" | "closed";

/** One row of public.alert_cases */
export interface CaseRow {
  key: string;
  rule: RuleId;
  tier: Tier;
  title: string;
  detail: string;
  severity: Severity;
  status: CaseStatus;
  scope: CaseCandidate["scope"];
  link: CaseLink;
  habit_key: string | null;
  habit_day: string | null;
  habit_label: string | null;
  opened_at: string;
  /** Opened, re-opened or got worse: the moment people last had news of it */
  changed_at: string;
  last_seen_at: string;
  closed_at: string | null;
  last_value: number;
  /** The value when people were last told (worsening is measured from here) */
  notified_value: number;
  baseline: number | null;
  /** When "ใช้ราคานี้เป็นปกติ" was pressed */
  baseline_set_at: string | null;
  baseline_candidate: number | null;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
}

export type DeliveryResult = "sent" | "failed" | "held_window" | "held_cap" | "held_dedupe";

/** One row of public.alert_deliveries */
export interface DeliveryRow {
  case_key: string | null;
  user_id: string;
  channel: "push" | "digest";
  sent_at: string;
  result: DeliveryResult;
}

const TIER_RANK: Record<Tier, number> = { immediate: 0, morning: 1, evening: 2, weekly: 3, monthly: 4 };
const SEV_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

// ─── Which rules a run evaluates ───

/** Does a rule of this tier belong to this run? (weekly: on the weekly day only) */
export function tierRunsIn(tier: Tier, kind: RunKind, nowMs: number, weeklyDow: number): boolean {
  if (kind === "tick") return tier === "immediate";
  if (kind === "evening") return tier === "immediate" || tier === "evening";
  return tier === "immediate" || tier === "morning" || tier === "monthly" || (tier === "weekly" && bkkDow(nowMs) === weeklyDow);
}

/** The enabled rules of a run, with their settings (a tick evaluates only immediate case rules) */
export function rulesForRun(kind: RunKind, nowMs: number, config: AlertConfig, rules: AlertRule[] = RULES): { rule: AlertRule; cfg: RuleConfig }[] {
  return rules
    .map((rule) => ({ rule, cfg: config.rules.get(rule.id)! }))
    .filter(({ rule, cfg }) => cfg && cfg.enabled && (kind !== "tick" || rule.kind === "case") && tierRunsIn(cfg.tier, kind, nowMs, config.global.weeklyDow));
}

// ─── Cases ───

/** One case per key: the more urgent tier wins, then the bigger value */
export function mergeCandidates(list: CaseCandidate[], tierOf: (r: RuleId) => Tier): CaseCandidate[] {
  const m = new Map<string, CaseCandidate>();
  for (const c of list) {
    const had = m.get(c.key);
    if (!had) m.set(c.key, c);
    // News beats quiet
    else if (!!had.quiet !== !!c.quiet) {
      if (had.quiet) m.set(c.key, c);
    } else {
      const d = TIER_RANK[tierOf(c.rule)] - TIER_RANK[tierOf(had.rule)];
      if (d < 0 || (d === 0 && c.value > had.value)) m.set(c.key, c);
    }
  }
  return [...m.values()];
}

/** Got worse past the rule's step since people were last told */
export function worsened(value: number, notified: number, cfg: Pick<RuleConfig, "worsenStep" | "worsenMode">): boolean {
  if (!cfg.worsenStep || !cfg.worsenMode) return false;
  if (cfg.worsenMode === "add") return value >= notified + cfg.worsenStep - 1e-9;
  return notified > 0 ? value >= notified * cfg.worsenStep - 1e-9 : value > 0;
}

export type CaseChange = "opened" | "reopened" | "worsened" | "updated" | "closed";

export interface Reconciled {
  /** Rows to write (new or changed) */
  rows: CaseRow[];
  changes: { key: string; change: CaseChange }[];
}

/**
 * What the rules found this run against the cases on record. Only cases of rules evaluated
 * in this run can close (a tick doesn't close a morning rule's case).
 */
export function reconcile(input: { nowIso: string; evaluated: Set<RuleId>; candidates: CaseCandidate[]; existing: CaseRow[]; config: AlertConfig }): Reconciled {
  const { nowIso, config } = input;
  const tierOf = (r: RuleId) => config.rules.get(r)?.tier ?? "morning";
  const found = mergeCandidates(input.candidates, tierOf);
  const byKey = new Map(input.existing.map((r) => [r.key, r]));
  const rows: CaseRow[] = [];
  const changes: Reconciled["changes"] = [];

  for (const c of found) {
    const had = byKey.get(c.key);
    // Quiet: keeps a live case as it is (no news, no reopening); nothing to keep otherwise
    if (c.quiet) {
      if (had && had.status !== "closed") {
        rows.push({ ...had, last_seen_at: nowIso });
        changes.push({ key: c.key, change: "updated" });
      }
      continue;
    }
    const tier = tierOf(c.rule);
    const fields = {
      rule: c.rule,
      tier,
      title: c.title,
      detail: c.detail,
      severity: c.severity,
      scope: c.scope,
      link: c.link,
      habit_key: c.habitKey ?? null,
      habit_day: c.habitDay ?? null,
      habit_label: c.habitLabel ?? null,
      last_seen_at: nowIso,
      last_value: c.value,
      baseline_candidate: c.baselineCandidate ?? null,
    };
    if (!had) {
      rows.push({ key: c.key, ...fields, status: "open", opened_at: nowIso, changed_at: nowIso, closed_at: null, notified_value: c.value, baseline: null, baseline_set_at: null, acknowledged_at: null, acknowledged_by: null });
      changes.push({ key: c.key, change: "opened" });
    } else if (had.status === "closed") {
      rows.push({ ...had, ...fields, status: "open", opened_at: nowIso, changed_at: nowIso, closed_at: null, notified_value: c.value, acknowledged_at: null, acknowledged_by: null });
      changes.push({ key: c.key, change: "reopened" });
    } else {
      const up = TIER_RANK[tier] < TIER_RANK[had.tier];
      const worse = up || worsened(c.value, Number(had.notified_value), config.rules.get(c.rule) ?? { worsenStep: null, worsenMode: null });
      if (worse) {
        rows.push({ ...had, ...fields, status: "open", changed_at: nowIso, notified_value: c.value, acknowledged_at: null, acknowledged_by: null });
        changes.push({ key: c.key, change: "worsened" });
      } else {
        rows.push({ ...had, ...fields });
        changes.push({ key: c.key, change: "updated" });
      }
    }
  }

  const seen = new Set(found.map((c) => c.key));
  for (const r of input.existing) {
    if (r.status === "closed" || seen.has(r.key) || !input.evaluated.has(r.rule)) continue;
    // The price set as normal goes with the case: a later rise is measured from the old price again
    rows.push({ ...r, status: "closed", closed_at: nowIso, baseline: null, baseline_set_at: null });
    changes.push({ key: r.key, change: "closed" });
  }
  return { rows, changes };
}

// ─── Habits ───

/**
 * Habits: a branch failing the same daily rule on ≥ habitDays of the last habitWindowDays
 * (days ending yesterday, from every case on record, closed ones included). Such cases are
 * one digest line, never pushed one by one.
 */
export function habitsOf(rows: Pick<CaseRow, "habit_key" | "habit_day" | "habit_label">[], today: string, g: AlertConfig["global"]): Map<string, { days: number; label: string }> {
  const from = shiftDay(today, -g.habitWindowDays);
  const days = new Map<string, Set<string>>();
  const label = new Map<string, string>();
  for (const r of rows) {
    if (!r.habit_key || !r.habit_day || r.habit_day < from || r.habit_day >= today) continue;
    const s = days.get(r.habit_key) ?? new Set<string>();
    s.add(r.habit_day);
    days.set(r.habit_key, s);
    if (r.habit_label) label.set(r.habit_key, r.habit_label);
  }
  const out = new Map<string, { days: number; label: string }>();
  for (const [k, s] of days) if (s.size >= g.habitDays) out.set(k, { days: s.size, label: label.get(k) ?? k });
  return out;
}

// ─── Pushes ───

export interface Recipient {
  userId: string;
  /** Rules this person switched off (no row = on) */
  off: Set<RuleId>;
  /**
   * No burst on joining: news older than this person's first device (ms), or older than the
   * moment they switched a rule back on, is treated as already pushed — it is in their next
   * digest instead.
   */
  since?: number;
  ruleSince?: Map<RuleId, number>;
}

export interface PushPlan {
  send: { userId: string; key: string }[];
  held: { userId: string; key: string; result: Exclude<DeliveryResult, "sent" | "failed"> }[];
}

const sortCases = (a: CaseRow, b: CaseRow) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || Date.parse(a.changed_at) - Date.parse(b.changed_at);

/**
 * Who gets which immediate push now. A case goes to a person once per piece of news
 * (opened / reopened / worse = changed_at). Held for the next digest when: outside the
 * allowed hours, over the person's daily cap (pushes sent today, Bangkok), or the same case
 * was pushed to them within dedupeHours. Acknowledged and habitual cases are never pushed.
 * A hold is written down once per piece of news, not every 15 minutes.
 */
export function planPushes(input: { nowMs: number; config: AlertConfig; cases: CaseRow[]; recipients: Recipient[]; deliveries: DeliveryRow[]; habits: Map<string, unknown> }): PushPlan {
  const { nowMs, config } = input;
  const g = config.global;
  const today = bkkDay(nowMs);
  const due = input.cases.filter((c) => c.status === "open" && c.tier === "immediate" && !(c.habit_key && input.habits.has(c.habit_key))).sort(sortCases);
  const plan: PushPlan = { send: [], held: [] };
  const open = inWindow(nowMs, g);
  for (const r of input.recipients) {
    const mine = input.deliveries.filter((d) => d.user_id === r.userId);
    let sentToday = mine.filter((d) => d.channel === "push" && d.result === "sent" && d.case_key && bkkDay(Date.parse(d.sent_at)) === today).length;
    for (const c of due) {
      if (r.off.has(c.rule)) continue;
      const startedAt = Math.max(r.since ?? -Infinity, r.ruleSince?.get(c.rule) ?? -Infinity);
      if (Date.parse(c.changed_at) < startedAt) continue;
      const forCase = mine.filter((d) => d.case_key === c.key);
      const since = Date.parse(c.changed_at);
      // Already had this news (pushed, in a digest, or held for one)
      if (forCase.some((d) => Date.parse(d.sent_at) >= since && d.result !== "failed")) continue;
      const lastPush = Math.max(-Infinity, ...forCase.filter((d) => d.channel === "push" && d.result === "sent").map((d) => Date.parse(d.sent_at)));
      if (nowMs - lastPush < g.dedupeHours * 3_600_000) plan.held.push({ userId: r.userId, key: c.key, result: "held_dedupe" });
      else if (!open) plan.held.push({ userId: r.userId, key: c.key, result: "held_window" });
      else if (sentToday >= g.dailyCap) plan.held.push({ userId: r.userId, key: c.key, result: "held_cap" });
      else {
        plan.send.push({ userId: r.userId, key: c.key });
        sentToday++;
      }
    }
  }
  return plan;
}

/** A case's push: title, body, where tapping it goes, and a tag so a newer one replaces it */
export function casePayload(c: Pick<CaseRow, "key" | "title" | "detail">) {
  return { title: c.title, body: c.detail, url: `/alerts#go/${encodeURIComponent(c.key)}`, tag: c.key };
}
