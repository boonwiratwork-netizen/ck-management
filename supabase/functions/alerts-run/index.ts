// Edge function: alerts-run — phone push alerts for management and kitchen managers.
// Called every 15 minutes by pg_cron (job "alerts-tick", migration 20261107120000_push_alerts.sql)
// with header x-report-key (Vault secret report_key = Edge secret REPORT_KEY), like the LINE reports.
//
// Each run:
//   0. takes the run lease (alert_try_lock) — a run that can't get it does nothing
//   1. reads the settings (alert_settings) — every threshold, time and cap comes from there
//   2. evaluates the rules due: immediate rules every run; at the morning / close-of-day
//      time (from the settings) every rule of that digest, once a day (alert_claim_digest)
//   3. opens / updates / closes cases (alert_cases), pushes immediate cases within the
//      allowed hours and the daily cap, and sends each person their digest
//   4. logs every push, hold and digest (alert_deliveries, alert_digests)
//
// Safety: every read and write is checked. Anything the caps / dedupe / history depend on
// failing to read stops the run BEFORE anything is sent. Each push is logged right after it
// goes out; if that log write fails the run stops (no further sends without a record).
//
// Query parameters (manual runs): mode=tick|digest-morning|digest-evening (default tick;
// a digest mode sends that digest now even outside its time), dryRun=1 (works everything out,
// writes and pushes nothing, returns it), force=1 (a digest already sent today is sent again).
//
// Secrets: REPORT_KEY, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:…).
// The rules themselves are pure and tested: supabase/functions/_shared/alerts/.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { corsHeaders, jsonResponse, requireReportKey } from "../_shared/report-utils.ts";
import { DEFAULT_RULES, GLOBAL_ROW, num, parseConfig, type RuleId, type SettingsRow } from "../_shared/alerts/config.ts";
import { needsOf } from "../_shared/alerts/registry.ts";
import { bkkDay, digestDue, type DigestKind } from "../_shared/alerts/time.ts";
import { casePayload, habitsOf, planPushes, reconcile, rulesForRun, type CaseRow, type DeliveryRow, type Recipient, type RunKind } from "../_shared/alerts/engine.ts";
import { buildDigest } from "../_shared/alerts/digest.ts";
import type { CaseCandidate, InfoLine } from "../_shared/alerts/types.ts";
import { all, loadData } from "./load.ts";

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;
interface Sub {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  failure_count: number;
  created_at: string;
}

const ROLES = ["management", "ck_manager"];
/** alert_digests.user_id of the claim row (no person has this id) */
const MARKER = "00000000-0000-0000-0000-000000000000";
/** A device that failed this many pushes in a row (not 404/410) is dropped */
const MAX_FAILURES = 10;
/** A digest claim still "running" after this long belongs to a run that died: it may be taken over */
const STALE_CLAIM_MINUTES = 20;
/** The run lease expires by itself after this long (a run that died) */
const LOCK_SECONDS = 600;
const DAY = 86_400_000;

/** Throws on a failed read/write, so the run stops before it sends anything it can't account for */
function must<T>(label: string, r: { data: T; error: { message?: string } | null }): T {
  if (r.error) throw new Error(`${label}: ${r.error.message ?? JSON.stringify(r.error)}`);
  return r.data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const denied = requireReportKey(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") ?? "tick";
  const dryRun = url.searchParams.get("dryRun") === "1";
  const force = url.searchParams.get("force") === "1";
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const today = bkkDay(nowMs);
  const db: Db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // ── 0. One run at a time (a dry run only reads, so it doesn't need the lease) ──
  const holder = crypto.randomUUID();
  if (!dryRun) {
    const got = must("alert_try_lock", await db.rpc("alert_try_lock", { p_holder: holder, p_stale_seconds: LOCK_SECONDS }));
    if (!got) return jsonResponse({ ok: true, skipped: "another run is in progress" });
  }
  let claimed: DigestKind | null = null;
  let digestDone = false;

  try {
    // ── 1. Settings ──
    const settingRows = must("alert_settings", await db.from("alert_settings").select("rule, enabled, tier, thresholds, worsen_step, worsen_mode")) as SettingsRow[];
    const config = parseConfig(settingRows ?? []);

    // The app subscribes with the public key: keep the settings row in step with the secret
    const pub = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
    const priv = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
    const subject = Deno.env.get("VAPID_SUBJECT") ?? "";
    if (!pub || !priv || !subject) throw new Error("VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT not configured");
    if (!dryRun && config.global.vapidPublicKey !== pub) {
      const g = settingRows.find((r) => r.rule === GLOBAL_ROW);
      const thresholds = { ...((g?.thresholds as Record<string, unknown>) ?? {}), vapid_public_key: pub };
      must("alert_settings key", await db.from("alert_settings").update({ thresholds, updated_at: nowIso }).eq("rule", GLOBAL_ROW));
    }
    webpush.setVapidDetails(subject, pub, priv);

    // ── 2. Which run: a digest when its time has come and this run claims it, else a tick ──
    const wanted: DigestKind[] = mode === "digest-morning" ? ["morning"] : mode === "digest-evening" ? ["evening"] : mode === "tick" ? (["morning", "evening"] as DigestKind[]).filter((k) => digestDue(k, nowMs, config.global)) : [];
    for (const k of wanted) {
      if (dryRun) {
        claimed = k;
        break;
      }
      // Taken when nobody has it, or a claim of a run that died (>20 min, still "running")
      if (must("alert_claim_digest", await db.rpc("alert_claim_digest", { p_kind: k, p_day: today, p_stale_minutes: STALE_CLAIM_MINUTES, p_force: force && mode !== "tick" }))) {
        claimed = k;
        break;
      }
    }
    const digest = claimed;
    const kind: RunKind = digest ?? "tick";

    // ── 3. Evaluate ──
    const due = rulesForRun(kind, nowMs, config);
    const keepFrom = new Date(nowMs - Math.max(14, config.global.habitWindowDays * 2) * DAY).toISOString();
    const existing = await all<CaseRow>((a, b) => db.from("alert_cases").select("*").or(`status.neq.closed,closed_at.gte.${keepFrom}`).order("key").range(a, b));
    const baselines = new Map(existing.filter((c) => c.baseline !== null && c.status !== "closed").map((c) => [c.key, { price: Number(c.baseline), setAt: Date.parse(c.baseline_set_at ?? c.acknowledged_at ?? c.changed_at) }]));
    const priceLookback = Math.max(...DEFAULT_RULES.filter((r) => r.rule === "price_rise" || r.rule === "price_rise_big").map((r) => num(config.rules.get(r.rule)!.thresholds, "lookback_days")));
    const data = await loadData(db, needsOf(due.map((d) => d.rule)), nowMs, baselines, priceLookback);

    const candidates: CaseCandidate[] = [];
    const info: InfoLine[] = [];
    const errors: string[] = [];
    for (const { rule, cfg } of due) {
      try {
        const out = rule.evaluate(data, cfg);
        candidates.push(...out.cases);
        info.push(...out.info);
      } catch (e) {
        // One broken rule never stops the others; its cases stay as they were (not closed)
        errors.push(`${rule.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    const failed = new Set(errors.map((e) => e.split(":")[0]));
    const evaluated = new Set<RuleId>(due.filter((d) => d.rule.kind === "case" && !failed.has(d.rule.id)).map((d) => d.rule.id));
    const rec = reconcile({ nowIso, evaluated, candidates, existing, config });

    // Every case as it now stands
    const now = new Map(existing.map((c) => [c.key, c]));
    for (const r of rec.rows) now.set(r.key, r);
    const cases = [...now.values()];
    const habits = habitsOf(cases, today, config.global);

    // ── 4. Who (every read checked: caps, dedupe and history depend on them) ──
    const roleRows = must("user_roles", await db.from("user_roles").select("user_id, role").in("role", ROLES)) as { user_id: string }[];
    const userIds = [...new Set(roleRows.map((r) => r.user_id))];
    const subs = userIds.length ? await all<Sub>((a, b) => db.from("push_subscriptions").select("id, user_id, endpoint, p256dh, auth, failure_count, created_at").in("user_id", userIds).order("id").range(a, b)) : [];
    const prefRows = userIds.length ? await all<{ user_id: string; rule: RuleId; enabled: boolean; updated_at: string }>((a, b) => db.from("alert_recipient_prefs").select("user_id, rule, enabled, updated_at").in("user_id", userIds).order("user_id").order("rule").range(a, b)) : [];
    const recipients: Recipient[] = userIds
      .filter((u) => subs.some((s) => s.user_id === u))
      .map((u) => {
        const mine = prefRows.filter((p) => p.user_id === u);
        return {
          userId: u,
          off: new Set(mine.filter((p) => !p.enabled).map((p) => p.rule)),
          // No burst: news from before the person's first device, or before a rule was switched back on
          since: Math.min(...subs.filter((s) => s.user_id === u).map((s) => Date.parse(s.created_at))),
          ruleSince: new Map(mine.filter((p) => p.enabled).map((p) => [p.rule, Date.parse(p.updated_at)])),
        };
      });
    const deliveries = recipients.length
      ? await all<DeliveryRow>((a, b) => db.from("alert_deliveries").select("id, case_key, user_id, channel, sent_at, result").in("user_id", recipients.map((r) => r.userId)).gte("sent_at", new Date(nowMs - 8 * DAY).toISOString()).order("id").range(a, b))
      : [];

    const pushPlan = planPushes({ nowMs, config, cases, recipients, deliveries, habits });
    // A case pushed on this very run isn't told again in the digest
    const pushedNow = (u: string): DeliveryRow[] => pushPlan.send.filter((p) => p.userId === u).map((p) => ({ case_key: p.key, user_id: u, channel: "push", sent_at: nowIso, result: "sent" }));
    // A digest retried after a run died part-way: people who already got it today are skipped
    const doneUsers = digest && !force ? new Set((must("alert_digests read", await db.from("alert_digests").select("user_id").eq("kind", digest).eq("for_day", today).neq("user_id", MARKER)) as { user_id: string }[]).map((x) => x.user_id)) : new Set<string>();
    const digests = digest
      ? recipients.filter((r) => !doneUsers.has(r.userId)).map((r) => ({ r, d: buildDigest({ kind: digest, nowMs, config, recipient: r, cases: cases.filter((c) => c.status !== "closed"), deliveries: [...deliveries.filter((x) => x.user_id === r.userId), ...pushedNow(r.userId)], habits, info }) }))
      : [];

    if (dryRun)
      return jsonResponse({ kind, today, rules: due.map((d) => d.rule.id), errors, changes: rec.changes, pushes: pushPlan, digests: digests.map((x) => ({ user: x.r.userId, ...x.d })) });

    // ── 5. Write the cases, and the holds (before anything is sent) ──
    if (rec.rows.length) must("alert_cases write", await db.from("alert_cases").upsert(rec.rows, { onConflict: "key" }));
    const held = pushPlan.held.map((h) => ({ case_key: h.key, user_id: h.userId, channel: "push", sent_at: nowIso, result: h.result }));
    if (held.length) must("alert_deliveries holds", await db.from("alert_deliveries").insert(held));

    // ── 6. Send: each push logged right after it goes out; a failed log stops the run ──
    const dropped = new Set<string>();
    const failures = new Map<string, number>();
    const ok = new Set<string>();
    async function toUser(userId: string, payload: Record<string, unknown>): Promise<boolean> {
      let any = false;
      for (const s of subs.filter((x) => x.user_id === userId && !dropped.has(x.id))) {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 12 * 3600, urgency: "high" });
          any = true;
          ok.add(s.id);
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) dropped.add(s.id);
          else failures.set(s.id, (failures.get(s.id) ?? s.failure_count) + 1);
        }
      }
      return any;
    }

    let pushed = 0;
    const byKey = new Map(cases.map((c) => [c.key, c]));
    for (const p of pushPlan.send) {
      const sent = await toUser(p.userId, casePayload(byKey.get(p.key)!));
      must("alert_deliveries push", await db.from("alert_deliveries").insert({ case_key: p.key, user_id: p.userId, channel: "push", sent_at: new Date().toISOString(), result: sent ? "sent" : "failed" }));
      if (sent) pushed++;
    }

    let digestCount = 0;
    for (const { r, d } of digests) {
      const sent = d.empty ? false : await toUser(r.userId, { title: d.title, body: d.body, url: "/alerts", tag: `digest-${d.kind}` });
      const lines = d.newKeys.map((k) => ({ case_key: k, user_id: r.userId, channel: "digest", sent_at: nowIso, result: sent ? "sent" : "failed" }));
      if (lines.length) must("alert_deliveries digest", await db.from("alert_deliveries").insert(lines));
      must("alert_digests", await db.from("alert_digests").upsert({ kind: d.kind, for_day: today, user_id: r.userId, title: d.title, body: d.body, lines: d.lines, pushed: sent, status: "done" }, { onConflict: "kind,for_day,user_id" }));
      digestCount++;
    }
    if (digest) {
      must("alert_digests done", await db.from("alert_digests").update({ status: "done" }).eq("kind", digest).eq("for_day", today).eq("user_id", MARKER));
      digestDone = true;
    }

    // Devices: errors here don't undo what was sent; reported
    const deviceErrors: string[] = [];
    const note = (label: string, r: { error: { message?: string } | null }) => r.error && deviceErrors.push(`${label}: ${r.error.message}`);
    if (dropped.size) note("drop devices", await db.from("push_subscriptions").delete().in("id", [...dropped]));
    if (ok.size) note("devices ok", await db.from("push_subscriptions").update({ last_success_at: nowIso, failure_count: 0 }).in("id", [...ok]));
    for (const [id, n] of failures) {
      if (ok.has(id)) continue;
      if (n >= MAX_FAILURES) note("drop device", await db.from("push_subscriptions").delete().eq("id", id));
      else note("device failure", await db.from("push_subscriptions").update({ failure_count: n }).eq("id", id));
    }

    // ── 7. Housekeeping (morning only): old logs and long-closed cases (kept ≥ two habit windows) ──
    if (digest === "morning") {
      const keepDays = Math.max(config.global.caseRetentionDays, config.global.habitWindowDays * 2);
      note("prune deliveries", await db.from("alert_deliveries").delete().lt("sent_at", new Date(nowMs - 60 * DAY).toISOString()));
      note("prune digests", await db.from("alert_digests").delete().lt("for_day", new Date(nowMs - 60 * DAY).toISOString().slice(0, 10)));
      note("prune cases", await db.from("alert_cases").delete().eq("status", "closed").lt("closed_at", new Date(nowMs - keepDays * DAY).toISOString()));
    }

    return jsonResponse({ ok: true, kind, rules: due.map((d) => d.rule.id), errors: [...errors, ...deviceErrors], changes: rec.changes.filter((c) => c.change !== "updated").length, pushed, held: held.length, digests: digestCount });
  } catch (err) {
    // A digest this run claimed but didn't finish is released, so the next run sends it
    if (claimed && !digestDone && !dryRun) await db.from("alert_digests").delete().eq("kind", claimed).eq("for_day", today).eq("user_id", MARKER).eq("status", "running");
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  } finally {
    if (!dryRun) await db.rpc("alert_release_lock", { p_holder: holder });
  }
});
