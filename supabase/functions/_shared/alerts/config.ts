// Push alerts: the settings every rule reads, and their defaults.
//
// Runtime truth is the database table public.alert_settings (one row per rule + one
// "_global" row). The defaults below are written into that table once by the migration
// (20261107120000_push_alerts.sql — a test checks the two match) and are only used at run
// time to fill a key that is missing or unreadable in a row, so a typo in the settings
// never switches a rule off silently or crashes the run.
//
// Shared by the app (settings screen) and the Edge Function alerts-run. Plain TypeScript:
// no Deno, Node or browser APIs, relative imports only.

/**
 * When a rule's news goes out:
 * - immediate: pushed at once (inside the allowed hours and under the daily cap), else in the next digest
 * - morning / evening: in that day's digest
 * - weekly: in the morning digest on the weekly day (Monday)
 * - monthly: in the morning digest from the 1st until the month is closed
 */
export type Tier = "immediate" | "morning" | "evening" | "weekly" | "monthly";
export const TIERS: Tier[] = ["immediate", "morning", "evening", "weekly", "monthly"];

/** How "got worse" is measured: add = value grew by at least `step`; mult = value became `step` × or more */
export type WorsenMode = "add" | "mult";

export type ThresholdValue = number | string | boolean | string[];
export type Thresholds = Record<string, ThresholdValue>;

export const RULE_IDS = [
  "to_declined",
  "to_short",
  "price_rise_big",
  "team_red",
  "count_problem",
  "to_unreceived",
  "sales_missing",
  "price_rise",
  "counted_early",
  "close_of_day",
  "weekly_scores",
  "weekly_cost",
  "month_close",
] as const;
export type RuleId = (typeof RULE_IDS)[number];

export interface RuleConfig {
  rule: RuleId;
  enabled: boolean;
  tier: Tier;
  thresholds: Thresholds;
  /** null = this rule never re-notifies on worsening */
  worsenStep: number | null;
  worsenMode: WorsenMode | null;
}

export interface GlobalConfig {
  /** Pushes only between these times (Bangkok, "HH:MM"); outside = held for the next digest */
  windowStart: string;
  windowEnd: string;
  /** Digest times (Bangkok, "HH:MM"; the run is every 15 minutes, so use :00 :15 :30 :45) */
  morningAt: string;
  eveningAt: string;
  /** Day of the week the weekly summary rides in the morning digest (0 = Sunday … 1 = Monday) */
  weeklyDow: number;
  /** Most immediate pushes per person per day; more go to the next digest */
  dailyCap: number;
  /** The same case is never pushed to the same person twice within this many hours */
  dedupeHours: number;
  /** A branch failing the same daily rule on this many of the last `habitWindowDays` days = a habit (one digest line, never pushed) */
  habitDays: number;
  habitWindowDays: number;
  /** A digest that is late (the run failed) still goes out up to this many minutes after its time */
  digestCatchupMinutes: number;
  /** Lines of new items written into a digest's push before "และอีก N เรื่อง" */
  digestPushLines: number;
  /** Closed cases are deleted after this many days (kept at least two habit windows) */
  caseRetentionDays: number;
  /** Written by alerts-run from the VAPID_PUBLIC_KEY secret; the app subscribes with it */
  vapidPublicKey: string;
}

export const GLOBAL_ROW = "_global";

export const DEFAULT_GLOBAL: GlobalConfig = {
  windowStart: "08:00",
  windowEnd: "21:30",
  morningAt: "08:00",
  eveningAt: "21:15",
  weeklyDow: 1,
  dailyCap: 5,
  dedupeHours: 24,
  habitDays: 4,
  habitWindowDays: 7,
  digestCatchupMinutes: 120,
  digestPushLines: 3,
  caseRetentionDays: 90,
  vapidPublicKey: "",
};

/** Global settings as stored in alert_settings._global.thresholds (snake_case keys) */
const GLOBAL_KEYS: Record<keyof GlobalConfig, string> = {
  windowStart: "window_start",
  windowEnd: "window_end",
  morningAt: "morning_at",
  eveningAt: "evening_at",
  weeklyDow: "weekly_dow",
  dailyCap: "daily_cap",
  dedupeHours: "dedupe_hours",
  habitDays: "habit_days",
  habitWindowDays: "habit_window_days",
  digestCatchupMinutes: "digest_catchup_minutes",
  digestPushLines: "digest_push_lines",
  caseRetentionDays: "case_retention_days",
  vapidPublicKey: "vapid_public_key",
};

export const DEFAULT_RULES: RuleConfig[] = [
  // ── immediate ──
  { rule: "to_declined", enabled: true, tier: "immediate", thresholds: { lookback_hours: 48 }, worsenStep: null, worsenMode: null },
  { rule: "to_short", enabled: true, tier: "immediate", thresholds: { short_pct: 10, lookback_hours: 48 }, worsenStep: null, worsenMode: null },
  { rule: "price_rise_big", enabled: true, tier: "immediate", thresholds: { rise_pct: 25, lookback_days: 7, sku_types: ["RM"] }, worsenStep: 10, worsenMode: "add" },
  // ── morning digest ──
  { rule: "team_red", enabled: true, tier: "morning", thresholds: { period: "week" }, worsenStep: 1, worsenMode: "add" },
  { rule: "count_problem", enabled: true, tier: "morning", thresholds: { close_hour: 23, diff_baht: 1000, lookback_days: 2 }, worsenStep: 2, worsenMode: "mult" },
  { rule: "to_unreceived", enabled: true, tier: "morning", thresholds: { hours: 24 }, worsenStep: 2, worsenMode: "add" },
  { rule: "sales_missing", enabled: true, tier: "morning", thresholds: { lookback_days: 2, skip_if_no_count: true }, worsenStep: null, worsenMode: null },
  { rule: "price_rise", enabled: true, tier: "morning", thresholds: { rise_pct: 10, lookback_days: 7, sku_types: ["RM"] }, worsenStep: 10, worsenMode: "add" },
  { rule: "counted_early", enabled: true, tier: "morning", thresholds: { min_days: 2, window_days: 7 }, worsenStep: 2, worsenMode: "add" },
  // ── close of day (21:15) ──
  { rule: "close_of_day", enabled: true, tier: "evening", thresholds: { sales_drop_pct: 15 }, worsenStep: null, worsenMode: null },
  // ── weekly (Monday morning) ──
  { rule: "weekly_scores", enabled: true, tier: "weekly", thresholds: {}, worsenStep: null, worsenMode: null },
  { rule: "weekly_cost", enabled: true, tier: "weekly", thresholds: { new_item_days: 7 }, worsenStep: null, worsenMode: null },
  // ── month close (1st, then each morning until complete) ──
  { rule: "month_close", enabled: true, tier: "monthly", thresholds: { max_days: 10 }, worsenStep: null, worsenMode: null },
];

/** Thai names, for the settings screen and the digest */
export const RULE_LABEL: Record<RuleId, string> = {
  to_declined: "สาขาปฏิเสธใบโอน",
  to_short: "ครัวส่งไม่ครบตามที่ขอ",
  price_rise_big: "ราคาวัตถุดิบขึ้นแรง",
  team_red: "ทีมสถานะ มีปัญหา",
  count_problem: "นับไม่เสร็จ / ของขาด-เกินเยอะ",
  to_unreceived: "ใบโอนส่งแล้วสาขายังไม่รับ",
  sales_missing: "ยังไม่ลงยอดขายเมื่อวาน",
  price_rise: "ราคาวัตถุดิบขึ้น",
  counted_early: "นับก่อนลงยอดขาย",
  close_of_day: "สรุปปิดวัน",
  weekly_scores: "คะแนนทีมรายสัปดาห์",
  weekly_cost: "Food cost / waste / ของใหม่ รายสัปดาห์",
  month_close: "รายการปิดเดือนที่ยังขาด",
};

/** Thai names of the threshold keys (settings screen) */
export const THRESHOLD_LABEL: Record<string, string> = {
  lookback_hours: "ดูย้อนหลัง (ชม.)",
  lookback_days: "ดูย้อนหลัง (วัน)",
  short_pct: "ส่งขาดเกิน (%)",
  rise_pct: "ราคาขึ้นตั้งแต่ (%)",
  sku_types: "ประเภทสินค้า",
  period: "ช่วงที่ดู",
  close_hour: "นับเสร็จก่อน (โมง)",
  diff_baht: "ของขาด/เกินเกินกี่บาทต่อวัน",
  hours: "ส่งแล้วเกิน (ชม.)",
  skip_if_no_count: "ข้ามวันที่ไม่มีใบนับ (ร้านปิด)",
  min_days: "อย่างน้อย (วัน)",
  window_days: "ในช่วง (วัน)",
  sales_drop_pct: "ยอดขายตกเกิน (%)",
  new_item_days: "ของใหม่ภายใน (วัน)",
  max_days: "เตือนถึงวันที่ของเดือน",
};

export const TIER_LABEL: Record<Tier, string> = {
  immediate: "ทันที",
  morning: "สรุปเช้า",
  evening: "สรุปปิดวัน",
  weekly: "สรุปรายสัปดาห์",
  monthly: "ปิดเดือน",
};

// ─── Reading the table ───

/** One row of public.alert_settings as read from the database */
export interface SettingsRow {
  rule: string;
  enabled: boolean | null;
  tier: string | null;
  thresholds: unknown;
  worsen_step: number | string | null;
  worsen_mode: string | null;
}

export interface AlertConfig {
  global: GlobalConfig;
  rules: Map<RuleId, RuleConfig>;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** A stored threshold if it has the default's type (numbers may come back as strings), else the default */
function pick(def: ThresholdValue, v: unknown): ThresholdValue {
  if (v === undefined || v === null) return def;
  if (typeof def === "number") {
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
    return Number.isFinite(n) ? n : def;
  }
  if (typeof def === "boolean") return typeof v === "boolean" ? v : def;
  if (Array.isArray(def)) return Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : def;
  return typeof v === "string" ? v : def;
}

export function parseGlobal(thresholds: unknown): GlobalConfig {
  const t = isObj(thresholds) ? thresholds : {};
  const out = { ...DEFAULT_GLOBAL };
  for (const k of Object.keys(GLOBAL_KEYS) as (keyof GlobalConfig)[]) {
    const v = pick(DEFAULT_GLOBAL[k], t[GLOBAL_KEYS[k]]);
    (out as Record<string, unknown>)[k] = v;
  }
  for (const k of ["windowStart", "windowEnd", "morningAt", "eveningAt"] as const) if (!HM.test(out[k])) out[k] = DEFAULT_GLOBAL[k];
  return out;
}

/** GlobalConfig → the JSON stored in alert_settings._global.thresholds */
export function globalToJson(g: GlobalConfig): Record<string, ThresholdValue> {
  const out: Record<string, ThresholdValue> = {};
  for (const k of Object.keys(GLOBAL_KEYS) as (keyof GlobalConfig)[]) out[GLOBAL_KEYS[k]] = g[k];
  return out;
}

export function parseRule(def: RuleConfig, row: SettingsRow | undefined): RuleConfig {
  if (!row) return def;
  const stored = isObj(row.thresholds) ? row.thresholds : {};
  const thresholds: Thresholds = {};
  for (const [k, d] of Object.entries(def.thresholds)) thresholds[k] = pick(d, stored[k]);
  const step = row.worsen_step === null || row.worsen_step === undefined || row.worsen_step === "" ? null : Number(row.worsen_step);
  const mode = row.worsen_mode === "add" || row.worsen_mode === "mult" ? row.worsen_mode : null;
  const validStep = step !== null && Number.isFinite(step) && step > 0 && mode !== null;
  return {
    rule: def.rule,
    enabled: row.enabled !== false,
    tier: TIERS.includes(row.tier as Tier) ? (row.tier as Tier) : def.tier,
    thresholds,
    worsenStep: validStep ? step : null,
    worsenMode: validStep ? mode : null,
  };
}

/** The table's rows → the settings every rule runs with (a missing row = that rule's defaults) */
export function parseConfig(rows: SettingsRow[]): AlertConfig {
  const byRule = new Map(rows.map((r) => [r.rule, r]));
  const rules = new Map<RuleId, RuleConfig>();
  for (const d of DEFAULT_RULES) rules.set(d.rule, parseRule(d, byRule.get(d.rule)));
  return { global: parseGlobal(byRule.get(GLOBAL_ROW)?.thresholds), rules };
}

export const num = (t: Thresholds, k: string): number => Number(t[k]) || 0;
export const list = (t: Thresholds, k: string): string[] => (Array.isArray(t[k]) ? (t[k] as string[]) : []);
export const flag = (t: Thresholds, k: string): boolean => t[k] === true;
