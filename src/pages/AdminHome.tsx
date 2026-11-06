import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowRightLeft,
  BarChart3,
  ClipboardList,
  Factory,
  Bell,
  CalendarCheck,
  CalendarClock,
  ChefHat,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  FlaskConical,
  Layers,
  Percent,
  Send,
  Tag,
} from "lucide-react";
import { useAdminHome, type AdminLoader } from "@/hooks/use-admin-home";
import { HEAT_COLUMNS, summaryText, type AdminMasters, type AdminView, type Go, type Kpi, type Team } from "@/lib/admin-home";
import { STATUS_LABEL, chipWeeks, previousPeriod, type PeriodKind } from "@/lib/team-score";
import { BulletLegend, BulletRow, DayDot, Funnel, ScoreBar, ScoreRing, StepChart, Timeline, WeekChips, gradeCell, metricSpec, statusPill } from "@/components/admin/AdminCharts";
import { RefreshNote } from "@/components/RefreshNote";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { bangkokDate } from "@/lib/day-follow";
import { fetchPendingTrCount } from "@/lib/pending-trs";

/**
 * หน้าแรกผู้บริหาร (boards AdmH14HomeB · AdmH15Team · AdmH16Kitchen): every team's metrics
 * on one heatmap, the week's ranking, what needs a look, the headline numbers and where
 * to go. A team's own page opens from its row (hash "team/<id>"; "ck" = the kitchen).
 */

interface Props {
  masters: AdminMasters;
  /** Dev demo only: rows from here instead of the database, a fixed today and clock */
  demo?: { loader: AdminLoader; today: string; nowMs: number };
}

const PERIODS: { key: PeriodKind; label: string }[] = [
  { key: "today", label: "วันนี้" },
  { key: "week", label: "สัปดาห์" },
  { key: "month", label: "เดือน" },
];
const PERIOD_KEY = "ck-admin-period";

const dShort = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("th-TH", { day: "numeric", month: "short" });
const DOW = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];
const dWeek = (d: string) => `${DOW[new Date(`${d}T00:00:00Z`).getUTCDay()]}${Number(d.slice(8))}`;
const thb = (n: number) => (Math.abs(n) >= 100_000 ? `฿${Math.round(n / 1000).toLocaleString("th-TH")}k` : `฿${Math.round(n).toLocaleString("th-TH")}`);

function periodText(v: AdminView) {
  const p = v.period;
  if (p.kind === "today") return `วันนี้ ${dShort(p.from)}`;
  if (p.kind === "week") return `7 วันล่าสุด ${dShort(p.from)}–${dShort(p.to)}`;
  return p.from === p.to ? `เดือนนี้ ${dShort(p.from)}` : `เดือนนี้ ${dShort(p.from)}–${dShort(p.to)}`;
}
const beforeWord = (k: PeriodKind) => (k === "today" ? "เมื่อวาน" : k === "week" ? "สัปดาห์ก่อน" : "เดือนก่อน");
const nowWord = (k: PeriodKind) => (k === "today" ? "วันนี้" : k === "week" ? "สัปดาห์นี้" : "เดือนนี้");

export default function AdminHome({ masters, demo }: Props) {
  const location = useLocation();
  const navigate = useNavigate();
  const [period, setPeriodState] = useState<PeriodKind>(() => {
    try {
      const v = sessionStorage.getItem(PERIOD_KEY);
      return v === "today" || v === "month" ? v : "week";
    } catch {
      return "week";
    }
  });
  const setPeriod = (k: PeriodKind) => {
    setPeriodState(k);
    try {
      sessionStorage.setItem(PERIOD_KEY, k);
    } catch {
      /* the choice lasts this visit only */
    }
  };
  const { view, error, refreshing, retry, noBranches } = useAdminHome(masters, period, demo?.loader, demo ? { today: demo.today, nowMs: demo.nowMs } : undefined);
  // Branch requests waiting for a transfer order (the sidebar badge's count): a badge on
  // จัดใบโอน once read; nothing shown until then (the dev demo reads nothing)
  const [pendingRequests, setPendingRequests] = useState<number | null>(null);
  useEffect(() => {
    if (demo) return;
    let cancelled = false;
    fetchPendingTrCount()
      .then((n) => !cancelled && setPendingRequests(n))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [demo]);
  const hash = decodeURIComponent(location.hash.slice(1));
  const teamId = hash.startsWith("team/") ? hash.slice(5) : null;

  /** A button's destination: remember the branch that page should open on, then go */
  const follow = (go: Go) => {
    if (go.remember)
      try {
        localStorage.setItem(go.remember[0], go.remember[1]);
      } catch {
        /* the page opens on its first branch */
      }
    navigate({ pathname: go.path, hash: go.hash ? `#${go.hash}` : "" }, { state: go.state });
  };
  const openTeam = (id: string) => navigate({ pathname: location.pathname, hash: `#team/${id}` });

  const team = teamId && view ? view.teams.find((t) => t.id === teamId) ?? null : null;
  if (teamId && view && team) return <TeamPage team={team} view={view} onBack={() => navigate({ pathname: location.pathname, hash: "" })} onGo={follow} />;

  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold leading-snug tracking-tight">หน้าแรก</h1>
          <p className="text-[13px] text-muted-foreground">
            {new Date(`${view?.today ?? demo?.today ?? bangkokDate()}T00:00:00`).toLocaleDateString("th-TH", { weekday: "long", day: "numeric", month: "long" })}
            {view ? ` · ครัวกลาง + ${view.teams.filter((t) => t.kind === "branch").length} สาขา` : ""}
            {demo ? " · ข้อมูลตัวอย่าง (DEV)" : ""}
          </p>
        </div>
        <a href="#need" className="relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border bg-card" aria-label={`ต้องดู ${view?.attention.length ?? 0} เรื่อง`}>
          <Bell className="h-5 w-5" />
          {!!view?.attention.length && (
            <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-background bg-destructive px-1 text-[11px] font-bold text-destructive-foreground">{view.attention.length}</span>
          )}
        </a>
      </div>

      <div className="grid grid-cols-3 rounded-xl bg-secondary p-[3px]" role="group" aria-label="ช่วงเวลา">
        {PERIODS.map((p) => (
          <button key={p.key} type="button" aria-pressed={period === p.key} onClick={() => setPeriod(p.key)} className={cn("h-[38px] rounded-[10px] text-sm", period === p.key ? "bg-card font-semibold text-foreground shadow-sm" : "text-muted-foreground")}>
            {p.label}
          </button>
        ))}
      </div>

      {error && view ? <RefreshNote refreshing={false} failed onRetry={retry} /> : <RefreshNote refreshing={refreshing} />}
      {error && !view && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <span className="min-w-0 flex-1">โหลดข้อมูลไม่สำเร็จ ตัวเลขยังไม่ขึ้น (ไม่ใช่ว่าเป็นศูนย์)</span>
          <button type="button" onClick={retry} className="min-h-[40px] rounded-full border border-destructive px-4 text-sm font-semibold">
            ลองใหม่
          </button>
        </div>
      )}
      {noBranches && <p className="rounded-xl bg-secondary px-3 py-3 text-sm text-muted-foreground">ยังไม่มีสาขาที่เปิดอยู่</p>}

      {!view ? (
        !error && !noBranches && <Skeleton />
      ) : (
        <>
          <Section title="ทีม × ตัวชี้วัด" note="แตะชื่อทีมเพื่อดูละเอียด" />
          <Heatmap teams={view.teams} onOpen={openTeam} />
          <p className="-mt-1.5 text-[11px] text-muted-foreground">
            เลื่อนซ้าย-ขวาดูครบ · ช่องเส้นประ = ยังคิดไม่ได้ (แตะดูเหตุผล) · สาขา: ตามแผน = นำเข้ายอดขายตรงเวลา · ครัวกลาง: นับ = นับปิดเดือน · ช่องสุดท้าย = บันทึกรับของตรงวัน
          </p>

          <KitchenShortcuts pendingRequests={pendingRequests} onGo={follow} />

          <Section title={`อันดับ${nowWord(period)}`} note={`เทียบ${beforeWord(period)}`} />
          <League teams={view.teams} onOpen={openTeam} />

          <div id="need" className="scroll-mt-20">
            <Section title={view.attention.length ? `ต้องดู ${view.attention.length} เรื่อง` : "ต้องดู"} note="สี = ความรุนแรง · แดงก่อน" />
          </div>
          <Timeline items={view.attention} onGo={follow} empty="ไม่มีเรื่องที่ต้องดูตอนนี้" />

          <Section title="ตัวเลขหลัก" />
          <div className="flex flex-col gap-1">
            {view.kpis.map((k) => (
              <KpiRow key={k.key} k={k} />
            ))}
          </div>
          <BulletLegend now={nowWord(period)} before={beforeWord(period)} />

          <Section title="ไปที่" note="เลื่อนดูต่อ" />
          <GoRail onGo={follow} />
        </>
      )}
    </div>
  );
}

/**
 * The kitchen is run from management accounts too: its daily jobs one tap from the home
 * page (owner, Nov 2026)
 */
const KITCHEN_JOBS: { label: string; icon: React.ElementType; go: Go; badge?: "requests" }[] = [
  { label: "รับของ", icon: ClipboardList, go: { path: "/receipt" } },
  { label: "จัดใบโอน", icon: ArrowRightLeft, go: { path: "/transfer-order" }, badge: "requests" },
  { label: "บันทึกผลิต", icon: Factory, go: { path: "/production" } },
];

export function KitchenShortcuts({ pendingRequests, onGo }: { pendingRequests: number | null; onGo: (go: Go) => void }) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-semibold text-muted-foreground">ครัวกลาง ทางลัด</div>
      <div className="grid grid-cols-3 gap-2" role="group" aria-label="ครัวกลาง ทางลัด">
        {KITCHEN_JOBS.map((j) => {
          const n = j.badge === "requests" ? pendingRequests : null;
          return (
            <button
              key={j.label}
              type="button"
              onClick={() => onGo(j.go)}
              className="relative flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-2 text-[13px] font-medium"
              aria-label={n ? `${j.label} · ใบขอเบิกรอ ${n} ใบ` : j.label}
            >
              <j.icon className="h-[18px] w-[18px] shrink-0 text-brand" />
              <span className="whitespace-nowrap">{j.label}</span>
              {!!n && (
                <span className="absolute -right-1 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-background bg-destructive px-1 text-[11px] font-bold text-destructive-foreground">{n}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Section({ title, note }: { title: string; note?: string }) {
  return (
    <div className="-mb-0.5 mt-1.5 flex items-baseline justify-between gap-2">
      <h2 className="text-[15px] font-bold">{title}</h2>
      {note && <span className="text-xs text-muted-foreground">{note}</span>}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-2" aria-label="กำลังโหลด">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="h-14 animate-pulse rounded-xl bg-secondary" />
      ))}
    </div>
  );
}

/** Brand on a small line, the name on at most two */
function TeamName({ t, withScore }: { t: Team; withScore?: boolean }) {
  return (
    <div className="min-w-0">
      {t.brand && <div className="truncate text-[10.5px] leading-tight text-muted-foreground">{t.brand}</div>}
      <div className="line-clamp-2 break-words text-[12.5px] font-bold leading-tight text-foreground">{t.name}</div>
      {withScore && <div className="whitespace-nowrap font-mono text-[11px] font-semibold leading-snug text-muted-foreground">{t.kind === "rd" ? "ยังไม่มีข้อมูล" : t.score.total ? `${t.score.score}/${t.score.total} ตรงเป้า` : "ยังคิดไม่ได้"}</div>}
    </div>
  );
}

const SHOWN_BRANCHES = 4;
const rankOf = (t: Team) => (t.score.total ? t.score.score / t.score.total : -1);

/** Kitchen first, then branches worst first (4 shown, the rest behind "ดูทั้งหมด"), RD last */
function Heatmap({ teams, onOpen }: { teams: Team[]; onOpen: (id: string) => void }) {
  const [all, setAll] = useState(false);
  const ck = teams.filter((t) => t.kind === "kitchen");
  const branches = teams.filter((t) => t.kind === "branch").sort((a, b) => rankOf(a) - rankOf(b) || a.name.localeCompare(b.name, "th"));
  const rd = teams.filter((t) => t.kind === "rd");
  const shown = [...ck, ...(all ? branches : branches.slice(0, SHOWN_BRANCHES)), ...rd];
  const hidden = branches.length - SHOWN_BRANCHES;
  const cell = (t: Team, i: number) => {
    if (t.kind === "rd") return { text: "", cls: gradeCell(null), title: "ยังไม่มีข้อมูล RD" };
    const id = t.kind === "kitchen" ? HEAT_COLUMNS[i].kitchen : HEAT_COLUMNS[i].branch;
    const m = t.metrics.find((x) => x.id === id)!;
    return { text: m.display, cls: gradeCell(m.value.grade), title: `${m.label}: ${m.display}${m.value.note ? ` · ${m.value.note}` : ""}${m.value.why ? ` · ${m.value.why}` : ""}` };
  };
  return (
    <div role="table" aria-label="ทีม × ตัวชี้วัด">
      <div className="relative flex">
        <div className="w-24 shrink-0">
          <div className="h-[34px]" />
          {shown.map((t) => (
            <button key={t.id} type="button" onClick={() => onOpen(t.id)} className="flex h-[62px] w-full items-center border-t border-border pr-1.5 text-left">
              <TeamName t={t} withScore />
            </button>
          ))}
        </div>
        <div className="min-w-0 flex-1 overflow-x-auto">
          <div className="grid w-max gap-x-[3px] pr-6" style={{ gridTemplateColumns: "repeat(6, 38px) 74px" }}>
            {HEAT_COLUMNS.map((c) => (
              <div key={c.short} className="flex h-[34px] items-end justify-center pb-1 text-center text-[10px] font-semibold leading-tight text-muted-foreground">
                {c.short}
              </div>
            ))}
            <div className="flex h-[34px] flex-col items-center justify-end pb-1 text-center text-[9.5px] font-semibold leading-tight text-muted-foreground">
              <div>4 สัปดาห์ล่าสุด</div>
              <div className="font-normal">เก่า → ล่าสุด</div>
            </div>
            {shown.map((t) => (
              <Row key={t.id} t={t} cell={cell} onOpen={onOpen} />
            ))}
          </div>
        </div>
        <div className="pointer-events-none absolute inset-y-0 right-0 w-[30px] bg-gradient-to-r from-transparent to-background" />
      </div>
      {hidden > 0 && (
        <button type="button" onClick={() => setAll((a) => !a)} className="flex min-h-[40px] w-full items-center justify-between border-t border-border text-[12.5px] font-semibold text-muted-foreground">
          {all ? "ย่อกลับ" : `+ อีก ${hidden} สาขา · ดูทั้งหมด`}
          <ChevronRight className={cn("h-4 w-4 transition-transform", all && "-rotate-90")} />
        </button>
      )}
    </div>
  );
}

function Row({ t, cell, onOpen }: { t: Team; cell: (t: Team, i: number) => { text: string; cls: string; title: string }; onOpen: (id: string) => void }) {
  return (
    <>
      {HEAT_COLUMNS.map((_, i) => {
        const c = cell(t, i);
        return (
          <button key={i} type="button" onClick={() => onOpen(t.id)} title={c.title} aria-label={c.title} className="flex h-[62px] items-center justify-center border-t border-border">
            <span className={cn("flex h-[38px] w-[38px] items-center justify-center whitespace-nowrap rounded-lg text-[10.5px] font-bold tabular-nums", c.cls)}>{c.text}</span>
          </button>
        );
      })}
      <div className="flex h-[62px] items-center justify-center border-t border-border">{t.kind === "rd" ? <span className="text-[11px] text-muted-foreground">ยังไม่มีข้อมูล</span> : <WeekChips chips={t.chips} />}</div>
    </>
  );
}

/** Ranked by the share of metrics met; RD (no data) last */
function League({ teams, onOpen }: { teams: Team[]; onOpen: (id: string) => void }) {
  const ranked = [...teams].sort((a, b) => (a.kind === "rd" ? 1 : 0) - (b.kind === "rd" ? 1 : 0) || rankOf(b) - rankOf(a) || b.score.score - a.score.score || a.name.localeCompare(b.name, "th"));
  const cols = "grid grid-cols-[16px_minmax(0,1fr)_78px_86px_30px] items-center gap-x-1";
  return (
    <div className="text-[13px]">
      <div className={cn(cols, "border-b border-border pb-1 text-[11px] font-semibold text-muted-foreground")}>
        <span>#</span>
        <span>ทีม</span>
        <span>คะแนน</span>
        <span className="leading-tight">
          4 สัปดาห์ล่าสุด
          <span className="block text-[9.5px] font-normal">เก่า → ล่าสุด</span>
        </span>
        <span className="text-right">เทียบ</span>
      </div>
      {ranked.map((t, i) => (
        <button key={t.id} type="button" onClick={() => onOpen(t.id)} className={cn(cols, "w-full border-b border-secondary py-1.5 text-left")}>
          <span className="font-mono text-muted-foreground">{t.kind === "rd" ? "–" : i + 1}</span>
          <TeamName t={t} />
          {t.kind === "rd" ? <span className="col-span-3 text-xs text-muted-foreground">ยังไม่มีข้อมูล</span> : (
            <>
              <ScoreBar s={t.score} />
              <WeekChips chips={t.chips} size={17} />
              <span className="text-right font-mono">{t.delta === null || t.delta === 0 ? <span className="text-muted-foreground">–</span> : t.delta > 0 ? <span className="font-bold text-success">▲{t.delta}</span> : <span className="font-bold text-destructive">▼{-t.delta}</span>}</span>
            </>
          )}
        </button>
      ))}
    </div>
  );
}

function KpiRow({ k }: { k: Kpi }) {
  const grade = k.value === null ? null : k.target === null ? (k.prev === null || k.value >= k.prev ? "pass" : "near") : (k.lower ? k.value <= k.target : k.value >= k.target) ? "pass" : (k.lower ? k.value <= k.target * 1.5 : k.value >= k.target - 10) ? "near" : "fail";
  const display = k.value === null ? "—" : k.format === "baht" ? thb(k.value) : `${k.value.toFixed(1)}%`;
  return <BulletRow label={k.label} sub={k.sub} display={display} why={k.why} spec={{ value: k.value, prev: k.prev, target: k.target, lower: k.lower, max: k.key === "receive" ? 100 : undefined, grade }} />;
}

const RAIL: { label: string; icon: React.ElementType; go: Go }[] = [
  { label: "ขาย", icon: BarChart3, go: { path: "/sales-entry" } },
  { label: "Food cost", icon: Percent, go: { path: "/food-cost" } },
  { label: "ครัวกลาง", icon: ChefHat, go: { path: "/dashboard" } },
  { label: "นับ & waste", icon: ClipboardCheck, go: { path: "/daily-stock-count" } },
  { label: "ปิดเดือน", icon: CalendarCheck, go: { path: "/stockcount" } },
  { label: "RD", icon: FlaskConical, go: { path: "/rd" } },
  { label: "Cost Center", icon: Layers, go: { path: "/cost-center" } },
  { label: "ราคาวัตถุดิบ", icon: Tag, go: { path: "/cost-center", hash: "products" } },
  // The earlier management first page (kitchen card + each branch's day)
  { label: "วันนี้ (หน้าเดิม)", icon: CalendarClock, go: { path: "/store" } },
];

function GoRail({ onGo }: { onGo: (go: Go) => void }) {
  return (
    <nav aria-label="ไปที่" className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
      {RAIL.map((r) => (
        <button key={r.label} type="button" onClick={() => onGo(r.go)} className="flex min-h-[64px] w-[66px] shrink-0 flex-col items-center gap-1 text-center text-[11px] leading-tight">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-soft text-brand">
            <r.icon className="h-5 w-5" />
          </span>
          {r.label}
        </button>
      ))}
    </nav>
  );
}

// ─── A team's own page ───

function TeamPage({ team, view, onBack, onGo }: { team: Team; view: AdminView; onBack: () => void; onGo: (go: Go) => void }) {
  const k = view.period.kind;
  const chipLabels = useMemo(() => chipWeeks(view.today).map((w) => dShort(w.from)), [view.today]);
  const copy = async () => {
    const text = summaryText(team, view.period);
    try {
      await navigator.clipboard.writeText(text);
      toast.success("คัดลอกสรุปแล้ว วางในไลน์ได้เลย");
    } catch {
      toast.error("คัดลอกไม่ได้ในเครื่องนี้");
    }
  };
  const prev = previousPeriod(view.period);

  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-3">
      <div className="flex items-center gap-2.5">
        <button type="button" onClick={onBack} aria-label="ย้อนกลับ" className="-ml-2.5 inline-flex h-11 w-11 items-center justify-center rounded-xl">
          <ChevronLeft className="h-[22px] w-[22px]" />
        </button>
        <div className="min-w-0 flex-1">
          {team.brand && <div className="truncate text-xs text-muted-foreground">{team.brand}</div>}
          <h1 className="break-words text-xl font-bold leading-snug">{team.name}</h1>
          <div className="text-xs text-muted-foreground">
            {periodText(view)}
            {team.kind === "kitchen" ? " · ตัวชี้วัดของครัว" : ""}
          </div>
        </div>
      </div>

      {team.kind === "rd" ? (
        <p className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">ยังไม่มีข้อมูล RD ในระบบ — ตัวชี้วัดของทีมนี้จะขึ้นเมื่อเริ่มบันทึกงาน RD</p>
      ) : (
        <>
          <div className="flex items-center gap-3.5">
            <ScoreRing grades={team.metrics.map((m) => m.value.grade)} score={team.score} label={`${team.name} ${team.score.score} จาก ${team.score.total} ตรงเป้า`} />
            <div className="min-w-0 flex-1">
              <span className={cn("inline-flex h-[22px] items-center rounded-full px-2 text-xs font-semibold", statusPill(team.score.status))}>{STATUS_LABEL[team.score.status]}</span>
              <div className="mt-1 text-[13px]">
                {beforeWord(k)} <b className="font-mono">{team.prevScore.total ? `${team.prevScore.score}/${team.prevScore.total}` : "—"}</b> · 4 สัปดาห์ก่อน <b className="font-mono">{team.chips[0]?.total ? `${team.chips[0].score}/${team.chips[0].total}` : "—"}</b>
              </div>
              <div className="text-xs text-muted-foreground">คัดลอกสรุปไปวางในไลน์</div>
              <Button variant="outline" className="mt-1.5 h-10 gap-1.5 rounded-[10px] px-2.5 text-[13px]" onClick={copy}>
                <Send className="h-[15px] w-[15px]" />
                {team.kind === "kitchen" ? "ส่งข้อความถึงหัวหน้าครัว" : "ส่งข้อความถึงหัวหน้าสาขา"}
              </Button>
            </div>
          </div>

          {team.funnel && (
            <>
              <Section title="จากแผน ถึงสาขา" note={`ผลิตตามแผน ${team.funnel.plan === null ? "—" : `${Math.round(team.funnel.plan * 100)}%`} · ส่งครบ ${team.funnel.fill === null ? "—" : `${Math.round(team.funnel.fill * 100)}%`}`} />
              <Funnel {...team.funnel} />
            </>
          )}

          <Section title="ตัวชี้วัด" note={nowWord(k)} />
          <div className="flex flex-col gap-1">
            {team.metrics.map((m) => (
              <BulletRow key={m.id} label={m.label} sub={m.targetText} display={m.display} why={m.value.why} spec={metricSpec(m.value, m.prev, m.targetValue, m.lower, m.format)} />
            ))}
          </div>
          <BulletLegend now={nowWord(k)} before={`${beforeWord(k)} (${dShort(prev.from)}${prev.from !== prev.to ? `–${dShort(prev.to)}` : ""})`} />

          {team.days && team.days.length > 0 && (
            <>
              <Section title="วันไหนไม่ผ่าน" note={`${team.days.length} วันล่าสุด`} />
              <DayGrid days={team.days} />
            </>
          )}

          <Section title="เรื่องที่ทำให้คะแนนตก" note="สี = ความรุนแรง · แดงก่อน" />
          <Timeline items={team.attention.slice(0, 8)} onGo={onGo} empty="ไม่มีเรื่องที่ทำให้คะแนนตกในช่วงนี้" />

          <Section title="คะแนน 4 สัปดาห์" />
          <StepChart chips={team.chips} labels={chipLabels} />
        </>
      )}
    </div>
  );
}

function DayGrid({ days }: { days: NonNullable<Team["days"]> }) {
  const rows: { label: string; key: "countOnTime" | "diff" | "receive" | "salesImport" }[] = [
    { label: "นับตรงเวลา", key: "countOnTime" },
    { label: "diff ≤ ฿1,000", key: "diff" },
    { label: "รับของใน 1 วัน", key: "receive" },
    { label: "นำเข้ายอดขาย", key: "salesImport" },
  ];
  return (
    <div>
      <div className="grid items-center gap-y-0.5" style={{ gridTemplateColumns: `96px repeat(${days.length}, minmax(0, 1fr))` }}>
        <span />
        {days.map((d) => (
          <span key={d.day} className="text-center text-[10.5px] text-muted-foreground">
            {dWeek(d.day)}
          </span>
        ))}
        {rows.map((r) => (
          <Fragment key={r.key} label={r.label}>
            {days.map((d) => (
              <span key={d.day} className="flex min-h-[22px] justify-center">
                <DayDot m={d[r.key]} />
              </span>
            ))}
          </Fragment>
        ))}
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">จุดเขียว = ผ่าน · กากบาทแดง = ไม่ผ่าน · วงกลมโปร่ง = ยังไม่ถึงกำหนด · ขีด = ไม่มีให้ดู</p>
    </div>
  );
}

function Fragment({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <span className="text-xs">{label}</span>
      {children}
    </>
  );
}

