import { supabase } from "@/integrations/supabase/client";
import { writeError, writeTimeout } from "@/lib/write-timeout";
import { DEFAULT_GLOBAL, GLOBAL_ROW, globalToJson, parseConfig, type AlertConfig, type GlobalConfig, type RuleConfig, type RuleId, type SettingsRow } from "../../../supabase/functions/_shared/alerts/config.ts";
import type { CaseRow } from "../../../supabase/functions/_shared/alerts/engine.ts";
import type { DigestLine } from "../../../supabase/functions/_shared/alerts/digest.ts";

/**
 * Reads and writes of the alerts screen (tables from migration 20261107120000_push_alerts.sql,
 * not in the generated types yet). Every write: a time limit (writeTimeout), and the rows that
 * came back are counted — row security that filters a write out still answers 200 with none,
 * which is "not saved", never "saved".
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
const db = supabase as unknown as { from: (t: string) => any; rpc: (fn: string, args?: Record<string, unknown>) => any };
/* eslint-enable @typescript-eslint/no-explicit-any */

export type WriteResult = { ok: true } | { ok: false; message: string };
const fail = (message: string): WriteResult => ({ ok: false, message });
const NOT_SAVED = "ไม่ได้บันทึก: ไม่มีสิทธิ์ หรือรายการนี้เปลี่ยนไปแล้ว ลองรีเฟรช";

type DbError = { code?: string | null; message?: string | null } | null | undefined;
/** The tables aren't there yet (the migration not run): told apart so the screen can say so */
export const isMissingTable = (e: DbError) => !!e && (e.code === "42P01" || e.code === "PGRST205" || /alert_|push_subscriptions/.test(e.message ?? "") && /does not exist|schema cache/i.test(e.message ?? ""));

export interface DigestRow {
  id: string;
  kind: "morning" | "evening";
  for_day: string;
  title: string;
  body: string;
  lines: DigestLine[];
  pushed: boolean;
  created_at: string;
}

export interface DeviceRow {
  id: string;
  endpoint: string;
  device_label: string;
  created_at: string;
  last_success_at: string | null;
}

export interface AlertsRead {
  config: AlertConfig;
  cases: CaseRow[];
  digests: DigestRow[];
  /** Rules this person switched off */
  off: Set<RuleId>;
  devices: DeviceRow[];
}

export type ReadResult = { kind: "ok"; data: AlertsRead } | { kind: "missing" } | { kind: "error"; message: string };

export async function readAlerts(userId: string, nowMs = Date.now()): Promise<ReadResult> {
  const since = new Date(nowMs - 7 * 86_400_000).toISOString();
  const [settings, cases, digests, prefs, devices] = await Promise.all([
    db.from("alert_settings").select("rule, enabled, tier, thresholds, worsen_step, worsen_mode").order("rule"),
    db.from("alert_cases").select("*").or(`status.neq.closed,closed_at.gte.${since}`).order("changed_at", { ascending: false }).order("key").limit(300),
    db.from("alert_digests").select("id, kind, for_day, title, body, lines, pushed, created_at").eq("user_id", userId).order("created_at", { ascending: false }).order("id").limit(14),
    db.from("alert_recipient_prefs").select("rule, enabled").eq("user_id", userId).order("rule"),
    db.from("push_subscriptions").select("id, endpoint, device_label, created_at, last_success_at").eq("user_id", userId).order("created_at").order("id"),
  ]);
  const err = [settings, cases, digests, prefs, devices].map((r) => r.error).find(Boolean);
  if (err) return isMissingTable(err) ? { kind: "missing" } : { kind: "error", message: writeError(err) || "อ่านข้อมูลไม่สำเร็จ" };
  return {
    kind: "ok",
    data: {
      config: parseConfig((settings.data ?? []) as SettingsRow[]),
      cases: (cases.data ?? []) as CaseRow[],
      digests: (digests.data ?? []) as DigestRow[],
      off: new Set(((prefs.data ?? []) as { rule: RuleId; enabled: boolean }[]).filter((p) => !p.enabled).map((p) => p.rule)),
      devices: (devices.data ?? []) as DeviceRow[],
    },
  };
}

async function rpcCount(fn: string, args: Record<string, unknown>): Promise<WriteResult> {
  try {
    const { data, error } = await db.rpc(fn, args).abortSignal(writeTimeout());
    if (error) return fail(writeError(error) || "บันทึกไม่สำเร็จ");
    return Number(data) > 0 ? { ok: true } : fail(NOT_SAVED);
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

/** "รับทราบ" */
export const ackCase = (key: string) => rpcCount("alert_case_ack", { p_key: key });
/** "ใช้ราคานี้เป็นปกติ" (price cases) */
export const setPriceAsNormal = (key: string) => rpcCount("alert_case_use_as_normal", { p_key: key });

/** This device on: its subscription saved under the person (moved over from whoever had the phone before) */
export const registerDevice = (k: { endpoint: string; p256dh: string; auth: string }, label: string) =>
  rpcCount("alert_register_device", { p_endpoint: k.endpoint, p_p256dh: k.p256dh, p_auth: k.auth, p_label: label });

/** This device off (its row only; the person's other devices stay on) */
export async function removeDevice(endpoint: string): Promise<WriteResult> {
  try {
    const { error } = await db.from("push_subscriptions").delete().eq("endpoint", endpoint).select("id").abortSignal(writeTimeout());
    if (error) return fail(writeError(error) || "บันทึกไม่สำเร็จ");
    // No row back = already gone (the server drops a dead device): what was wanted either way
    return { ok: true };
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

/** One rule on/off for this person */
export async function setRulePref(userId: string, rule: RuleId, enabled: boolean): Promise<WriteResult> {
  try {
    const { data, error } = await db
      .from("alert_recipient_prefs")
      .upsert({ user_id: userId, rule, enabled, updated_at: new Date().toISOString() }, { onConflict: "user_id,rule" })
      .select("rule")
      .abortSignal(writeTimeout());
    if (error) return fail(writeError(error) || "บันทึกไม่สำเร็จ");
    return data && data.length > 0 ? { ok: true } : fail(NOT_SAVED);
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

/** A rule's settings (management): on/off, tier, thresholds, worsen step */
export async function saveRuleConfig(userId: string, r: RuleConfig): Promise<WriteResult> {
  try {
    const { data, error } = await db
      .from("alert_settings")
      .update({ enabled: r.enabled, tier: r.tier, thresholds: r.thresholds, worsen_step: r.worsenStep, worsen_mode: r.worsenStep ? r.worsenMode : null, updated_at: new Date().toISOString(), updated_by: userId })
      .eq("rule", r.rule)
      .select("rule")
      .abortSignal(writeTimeout());
    if (error) return fail(writeError(error) || "บันทึกไม่สำเร็จ");
    return data && data.length > 0 ? { ok: true } : fail(NOT_SAVED);
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

/** The global settings (management). The server's public key is kept as it is. */
export async function saveGlobalConfig(userId: string, g: GlobalConfig, current: GlobalConfig): Promise<WriteResult> {
  try {
    const { data, error } = await db
      .from("alert_settings")
      .update({ thresholds: globalToJson({ ...g, vapidPublicKey: current.vapidPublicKey }), updated_at: new Date().toISOString(), updated_by: userId })
      .eq("rule", GLOBAL_ROW)
      .select("rule")
      .abortSignal(writeTimeout());
    if (error) return fail(writeError(error) || "บันทึกไม่สำเร็จ");
    return data && data.length > 0 ? { ok: true } : fail(NOT_SAVED);
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

export { DEFAULT_GLOBAL };
