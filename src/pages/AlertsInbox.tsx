import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { BellOff, BellRing, Check, ChevronRight, Smartphone, Tag } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { SegmentedTabs } from "@/components/SegmentedTabs";
import { cn } from "@/lib/utils";
import type { Go } from "@/lib/admin-home";
import { ackCase, readAlerts, registerDevice, removeDevice, saveGlobalConfig, saveRuleConfig, setRulePref, setPriceAsNormal, type AlertsRead, type DigestRow } from "@/lib/alerts/alerts-db";
import { SEVERITY_LABEL, goKeyOf, goOf, sortOpen, verbOf } from "@/lib/alerts/case-go";
import { applyUpdate, currentSubscription, deviceLabel, deviceStateOf, readEnv, subscribeDevice, unsubscribeDevice, workerStatus, type DeviceState } from "@/lib/alerts/push-device";
import { RULE_IDS, RULE_LABEL, THRESHOLD_LABEL, TIERS, TIER_LABEL, type GlobalConfig, type RuleConfig, type RuleId, type Tier } from "../../supabase/functions/_shared/alerts/config.ts";
import type { CaseRow } from "../../supabase/functions/_shared/alerts/engine.ts";
import { ageDays } from "../../supabase/functions/_shared/alerts/time.ts";

/**
 * แจ้งเตือน (management + ck_manager): what is still open (oldest first, with its age and a
 * button to the page), the latest digests and changes, and the settings — this device on/off,
 * which rules this person gets, and (management only) the rules' thresholds and times, which
 * the server reads on its next run. A push opens /alerts#go/<key>: the case's page, at once.
 */

type View = "open" | "recent" | "settings";

export const IOS_HINT = "iPhone ต้องเพิ่มแอปไปที่หน้าจอโฮมก่อน (iOS 16.4+)";
export const UPDATE_HINT = "อัปเดตแอปก่อน แล้วค่อยเปิดแจ้งเตือน";

const SEV_TONE: Record<CaseRow["severity"], string> = {
  high: "bg-destructive/10 text-destructive",
  medium: "bg-warning-soft text-warning",
  low: "bg-secondary text-muted-foreground",
};

export default function AlertsInbox({ nowMs }: { nowMs?: number } = {}) {
  const { user, isManagement } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [view, setView] = useState<View>("open");
  const [state, setState] = useState<{ kind: "loading" } | { kind: "missing" } | { kind: "error"; message: string } | { kind: "ok"; data: AlertsRead }>({ kind: "loading" });
  const [busy, setBusy] = useState<string | null>(null);
  const followed = useRef(false);

  const load = useCallback(async () => {
    if (!user) return;
    const r = await readAlerts(user.id, nowMs ?? Date.now());
    setState(r.kind === "ok" ? { kind: "ok", data: r.data } : r);
  }, [user, nowMs]);
  useEffect(() => {
    load();
  }, [load]);

  const follow = useCallback(
    (go: Go) => {
      if (go.remember)
        try {
          localStorage.setItem(go.remember[0], go.remember[1]);
        } catch {
          /* the page opens on its first branch */
        }
      navigate({ pathname: go.path, hash: go.hash ? `#${go.hash}` : "" }, { state: go.state });
    },
    [navigate],
  );

  // Opened from a push: go straight to the case's page (once)
  useEffect(() => {
    const key = goKeyOf(location.hash);
    if (!key || followed.current || state.kind !== "ok") return;
    followed.current = true;
    const c = state.data.cases.find((x) => x.key === key);
    const go = goOf(c?.link);
    if (go) follow(go);
    else navigate({ pathname: location.pathname, hash: "" }, { replace: true });
  }, [location.hash, location.pathname, state, follow, navigate]);

  const data = state.kind === "ok" ? state.data : null;
  const open = useMemo(() => (data ? sortOpen(data.cases) : []), [data]);
  const now = nowMs ?? Date.now();

  /** A write: busy while it runs (cleared in finally), the reason shown when it fails, read again when it worked */
  const run = async (id: string, write: () => Promise<{ ok: true } | { ok: false; message: string }>, done?: string) => {
    if (busy) return;
    setBusy(id);
    try {
      const r = await write();
      if ("message" in r) toast.error(r.message);
      else {
        if (done) toast.success(done);
        await load();
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-3">
      <div>
        <h1 className="text-2xl font-bold leading-snug tracking-tight">แจ้งเตือน</h1>
        <p className="text-[13px] text-muted-foreground">เรื่องที่ระบบเจอ ส่งเข้ามือถือ · สรุปเช้าและปิดวัน</p>
      </div>
      <SegmentedTabs<View>
        tabs={[
          { key: "open", label: open.length ? `ยังค้าง ${open.length}` : "ยังค้าง" },
          { key: "recent", label: "ล่าสุด" },
          { key: "settings", label: "ตั้งค่า" },
        ]}
        value={view}
        onChange={setView}
      />

      {state.kind === "loading" && <p className="py-6 text-center text-sm text-muted-foreground">กำลังโหลด…</p>}
      {state.kind === "missing" && <p className="rounded-xl bg-secondary px-3 py-3 text-sm text-muted-foreground">ระบบแจ้งเตือนยังไม่ได้ติดตั้งในฐานข้อมูล (ต้องรันไฟล์ push_alerts ก่อน)</p>}
      {state.kind === "error" && (
        <div role="alert" className="flex items-center gap-2 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <span className="flex-1">โหลดไม่สำเร็จ: {state.message}</span>
          <button type="button" onClick={load} className="min-h-[40px] rounded-full border border-destructive px-4 font-semibold">
            ลองใหม่
          </button>
        </div>
      )}

      {data && view === "open" && (
        <OpenList
          cases={open}
          now={now}
          busy={busy}
          onGo={follow}
          onAck={(c) => run(`ack:${c.key}`, () => ackCase(c.key), "รับทราบแล้ว จะไม่แจ้งซ้ำจนกว่าจะแย่ลง")}
          onNormal={(c) => run(`normal:${c.key}`, () => setPriceAsNormal(c.key), "ตั้งเป็นราคาปกติแล้ว")}
        />
      )}
      {data && view === "recent" && <RecentList digests={data.digests} cases={data.cases} now={now} onGo={follow} />}
      {data && view === "settings" && user && <Settings data={data} userId={user.id} isManagement={isManagement} busy={busy} run={run} />}
    </div>
  );
}

// ─── ยังค้าง ───

function OpenList({ cases, now, busy, onGo, onAck, onNormal }: { cases: CaseRow[]; now: number; busy: string | null; onGo: (g: Go) => void; onAck: (c: CaseRow) => void; onNormal: (c: CaseRow) => void }) {
  if (!cases.length) return <p className="rounded-xl bg-secondary px-3 py-6 text-center text-sm text-muted-foreground">ไม่มีเรื่องค้าง</p>;
  return (
    <ul className="flex flex-col gap-2" aria-label="เรื่องที่ยังค้าง">
      {cases.map((c) => {
        const go = goOf(c.link);
        const age = ageDays(Date.parse(c.opened_at), now);
        return (
          <li key={c.key} className="rounded-xl border border-border bg-card p-3">
            <div className="flex items-start gap-2">
              <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", SEV_TONE[c.severity])}>{SEVERITY_LABEL[c.severity]}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold leading-snug">{c.title}</p>
                {c.detail && <p className="text-[13px] text-muted-foreground">{c.detail}</p>}
                <p className="mt-0.5 text-[12px] text-muted-foreground">
                  {age === 0 ? "วันนี้" : `ค้างมา ${age} วัน`}
                  {c.status === "acknowledged" ? " · รับทราบแล้ว" : ""}
                </p>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {go && (
                <Button size="sm" className="h-10" onClick={() => onGo(go)}>
                  {verbOf(c.link)}
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              )}
              {c.status === "open" && (
                <Button size="sm" variant="outline" className="h-10" disabled={!!busy} onClick={() => onAck(c)}>
                  <Check className="mr-1 h-4 w-4" />
                  {busy === `ack:${c.key}` ? "กำลังบันทึก…" : "รับทราบ"}
                </Button>
              )}
              {c.key.startsWith("price_rise:") && c.baseline_candidate !== null && (
                <Button size="sm" variant="outline" className="h-10" disabled={!!busy} onClick={() => onNormal(c)}>
                  <Tag className="mr-1 h-4 w-4" />
                  {busy === `normal:${c.key}` ? "กำลังบันทึก…" : "ใช้ราคานี้เป็นปกติ"}
                </Button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ─── ล่าสุด ───

const STATUS_WORD: Record<CaseRow["status"], string> = { open: "เปิดอยู่", acknowledged: "รับทราบแล้ว", closed: "จบแล้ว" };

function RecentList({ digests, cases, now, onGo }: { digests: DigestRow[]; cases: CaseRow[]; now: number; onGo: (g: Go) => void }) {
  const recent = [...cases].sort((a, b) => Date.parse(b.changed_at) - Date.parse(a.changed_at)).slice(0, 30);
  return (
    <div className="flex flex-col gap-3">
      {digests.length > 0 && (
        <section aria-label="สรุปที่ส่งแล้ว" className="flex flex-col gap-2">
          {digests.map((d) => (
            <details key={d.id} className="rounded-xl border border-border bg-card p-3">
              <summary className="cursor-pointer text-sm font-semibold">{d.title}</summary>
              <ul className="mt-2 flex flex-col gap-1 text-[13px]">
                {(d.lines ?? []).map((l, i) => {
                  const go = goOf(l.link);
                  return (
                    <li key={i} className={cn(l.section === "info" && l.text.startsWith("—") ? "mt-1 font-semibold" : "", l.section === "open" ? "text-muted-foreground" : "")}>
                      {go ? (
                        <button type="button" className="text-left underline-offset-2 hover:underline" onClick={() => onGo(go)}>
                          {l.text}
                        </button>
                      ) : (
                        l.text
                      )}
                    </li>
                  );
                })}
              </ul>
            </details>
          ))}
        </section>
      )}
      <ul className="flex flex-col gap-1" aria-label="เรื่องล่าสุด">
        {recent.map((c) => {
          const go = goOf(c.link);
          return (
            <li key={c.key}>
              <button type="button" disabled={!go} onClick={() => go && onGo(go)} className="flex w-full items-start gap-2 rounded-xl px-2 py-2 text-left hover:bg-secondary">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm">{c.title}</span>
                  <span className="block text-[12px] text-muted-foreground">
                    {STATUS_WORD[c.status]} · {ageDays(Date.parse(c.changed_at), now) === 0 ? "วันนี้" : `${ageDays(Date.parse(c.changed_at), now)} วันก่อน`}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
        {!recent.length && !digests.length && <li className="rounded-xl bg-secondary px-3 py-6 text-center text-sm text-muted-foreground">ยังไม่มีการแจ้งเตือน</li>}
      </ul>
    </div>
  );
}

// ─── ตั้งค่า ───

type Run = (id: string, write: () => Promise<{ ok: true } | { ok: false; message: string }>, done?: string) => Promise<void>;

function Settings({ data, userId, isManagement, busy, run }: { data: AlertsRead; userId: string; isManagement: boolean; busy: string | null; run: Run }) {
  return (
    <div className="flex flex-col gap-4">
      <DeviceCard data={data} busy={busy} run={run} />
      <section className="flex flex-col gap-1" aria-label="เรื่องที่อยากรับ">
        <h2 className="text-sm font-semibold">เรื่องที่อยากรับ</h2>
        {RULE_IDS.map((rule) => {
          const cfg = data.config.rules.get(rule)!;
          return (
            <label key={rule} className="flex min-h-[44px] items-center gap-3 rounded-xl px-2 hover:bg-secondary">
              <span className="min-w-0 flex-1 text-sm">
                {RULE_LABEL[rule]}
                <span className="block text-[12px] text-muted-foreground">
                  {TIER_LABEL[cfg.tier]}
                  {cfg.enabled ? "" : " · ปิดทั้งระบบ"}
                </span>
              </span>
              <Switch aria-label={RULE_LABEL[rule]} checked={!data.off.has(rule)} disabled={!!busy} onCheckedChange={(v) => run(`pref:${rule}`, () => setRulePref(userId, rule, v))} />
            </label>
          );
        })}
      </section>
      {isManagement && <GlobalEditor data={data} userId={userId} busy={busy} run={run} />}
      {isManagement && (
        <section className="flex flex-col gap-2" aria-label="เกณฑ์แต่ละเรื่อง">
          <h2 className="text-sm font-semibold">เกณฑ์แต่ละเรื่อง (ทุกคน)</h2>
          {RULE_IDS.map((rule) => (
            <RuleEditor key={rule} cfg={data.config.rules.get(rule)!} userId={userId} busy={busy} run={run} />
          ))}
        </section>
      )}
    </div>
  );
}

function DeviceCard({ data, busy, run }: { data: AlertsRead; busy: string | null; run: Run }) {
  const [endpoint, setEndpoint] = useState<string | null | undefined>(undefined);
  const [worker, setWorker] = useState<Awaited<ReturnType<typeof workerStatus>> | null>(null);
  useEffect(() => {
    let live = true;
    currentSubscription().then((s) => live && setEndpoint(s?.endpoint ?? null));
    workerStatus().then((w) => live && setWorker(w));
    return () => {
      live = false;
    };
  }, [data]);
  const env = readEnv();
  const on = !!endpoint && data.devices.some((d) => d.endpoint === endpoint);
  // Only subscribe through a worker that handles pushes, with no new version waiting
  const st: DeviceState = deviceStateOf(env, on, worker === "ready");

  const turnOn = () =>
    run("device", async () => {
      try {
        const k = await subscribeDevice(data.config.global.vapidPublicKey);
        return registerDevice(k, deviceLabel(env.userAgent));
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    }, "เปิดแจ้งเตือนบนเครื่องนี้แล้ว");
  const turnOff = () =>
    run("device", async () => {
      const ep = await unsubscribeDevice();
      return ep ? removeDevice(ep) : { ok: true };
    }, "ปิดแจ้งเตือนบนเครื่องนี้แล้ว");

  return (
    <section className="rounded-xl border border-border bg-card p-3" aria-label="เครื่องนี้">
      <div className="flex items-center gap-3">
        {st === "on" ? <BellRing className="h-5 w-5 text-primary" /> : <BellOff className="h-5 w-5 text-muted-foreground" />}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">เปิดแจ้งเตือนบนเครื่องนี้</p>
          <p className="text-[12px] text-muted-foreground">
            {st === "on" && "เปิดอยู่ · แจ้งเฉพาะ 08:00–21:30 นอกนั้นรอสรุปเช้า"}
            {st === "off" && "ยังปิดอยู่"}
            {st === "blocked" && "เครื่องนี้ปิดการแจ้งเตือนของแอปไว้ เปิดได้ที่การตั้งค่าของเครื่อง"}
            {st === "unsupported" && "เบราว์เซอร์นี้รับการแจ้งเตือนไม่ได้"}
            {st === "ios-needs-install" && IOS_HINT}
            {st === "needs-update" && UPDATE_HINT}
          </p>
        </div>
        {st === "needs-update" && (
          <Button size="sm" className="h-10" onClick={() => applyUpdate()}>
            อัปเดตแอป
          </Button>
        )}
        {(st === "on" || st === "off") && endpoint !== undefined && (
          <Switch aria-label="เปิดแจ้งเตือนบนเครื่องนี้" checked={st === "on"} disabled={!!busy} onCheckedChange={(v) => (v ? turnOn() : turnOff())} />
        )}
      </div>
      {data.devices.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1 border-t border-border pt-2 text-[12px] text-muted-foreground">
          {data.devices.map((d) => (
            <li key={d.id} className="flex items-center gap-2">
              <Smartphone className="h-3.5 w-3.5" />
              {d.device_label || "อุปกรณ์"}
              {d.endpoint === endpoint ? " (เครื่องนี้)" : ""}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const inputCls = "h-10 w-full rounded-lg border border-border bg-background px-2 font-mono text-right text-base";

function GlobalEditor({ data, userId, busy, run }: { data: AlertsRead; userId: string; busy: string | null; run: Run }) {
  const [g, setG] = useState<GlobalConfig>(data.config.global);
  useEffect(() => setG(data.config.global), [data.config.global]);
  const times: [keyof GlobalConfig, string][] = [
    ["windowStart", "แจ้งได้ตั้งแต่"],
    ["windowEnd", "แจ้งได้ถึง"],
    ["morningAt", "สรุปเช้า"],
    ["eveningAt", "สรุปปิดวัน"],
  ];
  const nums: [keyof GlobalConfig, string][] = [
    ["dailyCap", "แจ้งทันทีได้สูงสุด (ครั้ง/คน/วัน)"],
    ["dedupeHours", "เรื่องเดิมไม่แจ้งซ้ำภายใน (ชม.)"],
    ["habitDays", "เป็นประจำเมื่อเกิด (วัน)"],
    ["habitWindowDays", "ในช่วง (วัน)"],
  ];
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3" aria-label="เวลาและจำนวน">
      <h2 className="text-sm font-semibold">เวลาและจำนวน (ทุกคน)</h2>
      <div className="grid grid-cols-2 gap-2">
        {times.map(([k, label]) => (
          <label key={k} className="text-[12px] text-muted-foreground">
            {label}
            <input type="time" step={900} aria-label={label} className={inputCls} value={String(g[k])} onChange={(e) => setG({ ...g, [k]: e.target.value })} />
          </label>
        ))}
        {nums.map(([k, label]) => (
          <label key={k} className="text-[12px] text-muted-foreground">
            {label}
            <input type="number" min={0} inputMode="numeric" aria-label={label} className={inputCls} value={String(g[k])} onChange={(e) => setG({ ...g, [k]: Number(e.target.value) })} />
          </label>
        ))}
      </div>
      <p className="text-[12px] text-muted-foreground">ระบบทำงานทุก 15 นาที ตั้งเวลาเป็น :00 :15 :30 :45</p>
      <Button className="h-10 self-end" disabled={!!busy} onClick={() => run("global", () => saveGlobalConfig(userId, g, data.config.global), "บันทึกแล้ว ใช้รอบถัดไป")}>
        {busy === "global" ? "กำลังบันทึก…" : "บันทึก"}
      </Button>
    </section>
  );
}

function RuleEditor({ cfg, userId, busy, run }: { cfg: RuleConfig; userId: string; busy: string | null; run: Run }) {
  const [r, setR] = useState<RuleConfig>(cfg);
  useEffect(() => setR(cfg), [cfg]);
  const id = `rule:${cfg.rule}`;
  return (
    <details className="rounded-xl border border-border bg-card p-3">
      <summary className="cursor-pointer text-sm">
        <span className="font-semibold">{RULE_LABEL[cfg.rule as RuleId]}</span>
        <span className="text-muted-foreground"> · {cfg.enabled ? TIER_LABEL[cfg.tier] : "ปิด"}</span>
      </summary>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <label className="col-span-2 flex items-center gap-2 text-sm">
          <Switch aria-label={`เปิดใช้ ${RULE_LABEL[cfg.rule]}`} checked={r.enabled} onCheckedChange={(v) => setR({ ...r, enabled: v })} />
          เปิดใช้ (ทุกคน)
        </label>
        <label className="text-[12px] text-muted-foreground">
          ส่งเมื่อ
          <select aria-label="ส่งเมื่อ" className="h-10 w-full rounded-lg border border-border bg-background px-2 text-base" value={r.tier} onChange={(e) => setR({ ...r, tier: e.target.value as Tier })}>
            {TIERS.map((t) => (
              <option key={t} value={t}>
                {TIER_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        {Object.entries(r.thresholds).map(([k, v]) =>
          typeof v === "number" ? (
            <label key={k} className="text-[12px] text-muted-foreground">
              {THRESHOLD_LABEL[k] ?? k}
              <input type="number" inputMode="decimal" aria-label={THRESHOLD_LABEL[k] ?? k} className={inputCls} value={String(v)} onChange={(e) => setR({ ...r, thresholds: { ...r.thresholds, [k]: Number(e.target.value) } })} />
            </label>
          ) : typeof v === "boolean" ? (
            <label key={k} className="flex items-center gap-2 text-[12px] text-muted-foreground">
              <Switch aria-label={THRESHOLD_LABEL[k] ?? k} checked={v} onCheckedChange={(x) => setR({ ...r, thresholds: { ...r.thresholds, [k]: x } })} />
              {THRESHOLD_LABEL[k] ?? k}
            </label>
          ) : Array.isArray(v) ? (
            <label key={k} className="text-[12px] text-muted-foreground">
              {THRESHOLD_LABEL[k] ?? k}
              <input aria-label={THRESHOLD_LABEL[k] ?? k} className={cn(inputCls, "text-left font-sans")} value={v.join(", ")} onChange={(e) => setR({ ...r, thresholds: { ...r.thresholds, [k]: e.target.value.split(",").map((x) => x.trim().toUpperCase()).filter(Boolean) } })} />
            </label>
          ) : (
            <label key={k} className="text-[12px] text-muted-foreground">
              {THRESHOLD_LABEL[k] ?? k}
              <input aria-label={THRESHOLD_LABEL[k] ?? k} className={cn(inputCls, "text-left font-sans")} value={String(v)} onChange={(e) => setR({ ...r, thresholds: { ...r.thresholds, [k]: e.target.value } })} />
            </label>
          ),
        )}
        {cfg.worsenMode && (
          <label className="text-[12px] text-muted-foreground">
            แจ้งซ้ำเมื่อแย่ลง {r.worsenMode === "mult" ? "(เท่า)" : "(เพิ่มขึ้น)"}
            <input type="number" inputMode="decimal" aria-label="แจ้งซ้ำเมื่อแย่ลง" className={inputCls} value={r.worsenStep ?? ""} onChange={(e) => setR({ ...r, worsenStep: e.target.value === "" ? null : Number(e.target.value) })} />
          </label>
        )}
      </div>
      <Button className="mt-2 h-10" disabled={!!busy} onClick={() => run(id, () => saveRuleConfig(userId, r), "บันทึกแล้ว ใช้รอบถัดไป")}>
        {busy === id ? "กำลังบันทึก…" : "บันทึก"}
      </Button>
    </details>
  );
}
