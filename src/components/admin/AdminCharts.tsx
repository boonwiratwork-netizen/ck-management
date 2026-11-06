import { cn } from "@/lib/utils";
import type { Grade, MetricValue, Score, Status, DayMark } from "@/lib/team-score";
import type { Attention, Go } from "@/lib/admin-home";
import { Button } from "@/components/ui/button";

/**
 * The small pictures of หน้าแรกผู้บริหาร and the team pages (hi-fi boards AdmH14–16):
 * bullet bars, week chips, the score ring, the 4-week step line, the day dots, the
 * kitchen funnel and the ต้องดู timeline. Colours are the app's tokens only.
 */

// ─── Colour by grade / status ───

/** Heatmap cell: met · close · missed · can't tell */
export function gradeCell(g: Grade | null): string {
  if (g === "pass") return "bg-success-soft text-success";
  if (g === "near") return "bg-warning-soft text-warning";
  if (g === "fail") return "bg-destructive-soft text-destructive";
  return "border-[1.5px] border-dashed border-border text-muted-foreground";
}
export function statusCell(s: Status): string {
  if (s === "good") return "bg-success-soft text-success";
  if (s === "watch") return "bg-warning-soft text-warning";
  if (s === "bad") return "bg-destructive-soft text-destructive";
  return "border border-dashed border-border text-muted-foreground";
}
export const statusPill = (s: Status) => (s === "good" ? "bg-success-soft text-success" : s === "watch" ? "bg-warning-soft text-warning" : s === "bad" ? "bg-destructive-soft text-destructive" : "bg-secondary text-muted-foreground");
const statusFill = (s: Status) => (s === "good" ? "bg-success" : s === "watch" ? "bg-highlight" : s === "bad" ? "bg-destructive" : "bg-border");
const gradeFill = (g: Grade | null) => (g === "pass" ? "fill-success" : g === "near" ? "fill-highlight" : g === "fail" ? "fill-destructive" : "fill-border");
export const gradeText = (g: Grade | null) => (g === "pass" ? "text-success" : g === "near" ? "text-warning" : g === "fail" ? "text-destructive" : "text-muted-foreground");

// ─── Week chips (oldest → newest, the newest ringed) ───

export function WeekChips({ chips, size = 15 }: { chips: Score[]; size?: number }) {
  return (
    <span className="inline-flex gap-[3px]" role="img" aria-label={`4 สัปดาห์ล่าสุด เก่าไปล่าสุด ${chips.map((c) => (c.total ? c.score : "ไม่มีข้อมูล")).join(" ")}`}>
      {chips.map((c, i) => (
        <span
          key={i}
          style={{ width: size, height: size, fontSize: 11 }}
          className={cn(
            "inline-flex items-center justify-center rounded-[5px] font-semibold leading-none tabular-nums",
            statusCell(c.status),
            i === chips.length - 1 && "font-extrabold ring-[1.5px] ring-foreground ring-offset-2 ring-offset-background",
          )}
        >
          {c.total ? c.score : ""}
        </span>
      ))}
    </span>
  );
}

/** Score bar + "x/n" */
export function ScoreBar({ s }: { s: Score }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1.5 flex-1 rounded-full bg-secondary">
        <div className={cn("h-1.5 rounded-full", statusFill(s.status))} style={{ width: s.total ? `${(s.score / s.total) * 100}%` : 0 }} />
      </div>
      <b className="font-mono text-[12.5px] tabular-nums">{s.total ? `${s.score}/${s.total}` : "—"}</b>
    </div>
  );
}

// ─── Bullet ───

export interface BulletSpec {
  value: number | null;
  prev: number | null;
  target: number | null;
  lower: boolean;
  /** Share metrics are on 0..1 */
  max?: number;
  grade: Grade | null;
}

/** Value bar, target (black tick), the period before (grey tick), the passing zone (green) */
export function Bullet({ value, prev, target, lower, max, grade }: BulletSpec) {
  const W = 176;
  const top = max ?? (Math.max(value ?? 0, prev ?? 0, target ?? 0) * 1.25 || 1);
  const x = (v: number) => Math.max(0, Math.min(W, (v / top) * W));
  const tick = (v: number, w: number) => Math.min(W - w, x(v));
  return (
    <svg width="100%" height="22" viewBox={`0 0 ${W} 22`} preserveAspectRatio="none" role="img" aria-label={`ค่า ${value ?? "ไม่มี"} เป้า ${target ?? "ไม่มี"}`}>
      <rect x="0" y="5" width={W} height="12" rx="3" className="fill-secondary" />
      {target !== null && <rect x={lower ? 0 : x(target)} y="5" width={lower ? x(target) : W - x(target)} height="12" className="fill-success-soft" />}
      {value !== null && <rect x="0" y="8" width={x(value)} height="6" rx="2" className={gradeFill(grade)} />}
      {prev !== null && <rect x={tick(prev, 2)} y="3" width="2" height="16" className="fill-muted-foreground" opacity={0.75} />}
      {target !== null && <rect x={tick(target, 3)} y="1" width="3" height="20" className="fill-foreground" />}
    </svg>
  );
}

/**
 * One metric on a phone: name and value on one line, the bar full width under them, then the
 * target and how far off it is. (The old 3-column row squeezed the name into 112px → 3-line wraps.)
 */
export function BulletRow({ label, sub, gap, display, spec, why }: { label: string; sub: string; gap?: string; display: string; spec: BulletSpec; why?: string }) {
  return (
    <div className="border-t border-border py-2.5 first:border-t-0" title={why}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 text-sm leading-snug">{label}</span>
        <span className={cn("shrink-0 whitespace-nowrap text-right font-mono text-sm font-bold tabular-nums", gradeText(spec.grade))}>{display}</span>
      </div>
      <div className="mt-1.5">
        <Bullet {...spec} />
      </div>
      <div className="mt-1 text-xs leading-snug text-muted-foreground">
        {spec.value === null && why ? why : sub}
        {gap && spec.value !== null ? <span className={cn("font-semibold", gradeText(spec.grade))}> · {gap}</span> : null}
      </div>
    </div>
  );
}

export function BulletLegend({ now, before }: { now: string; before: string }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1">
        <i className="inline-block h-1.5 w-3.5 rounded-sm bg-success" />
        {now}
      </span>
      <span className="inline-flex items-center gap-1">
        <i className="inline-block h-3 w-[3px] bg-foreground" />
        เป้า
      </span>
      <span className="inline-flex items-center gap-1">
        <i className="inline-block h-3 w-[2px] bg-muted-foreground" />
        {before}
      </span>
      <span className="inline-flex items-center gap-1">
        <i className="inline-block h-2.5 w-3.5 bg-success-soft" />
        ช่วงผ่าน
      </span>
    </div>
  );
}

/** A metric's value on its bullet (count/share metrics on 0..1) */
export function metricSpec(v: MetricValue, prev: MetricValue, targetValue: number, lower: boolean, format: string): BulletSpec {
  const share = format === "count" || format === "share" || format === "done";
  return { value: v.value, prev: prev.value, target: targetValue, lower, max: share ? 1 : undefined, grade: v.grade };
}

// ─── Ring (one segment per metric) ───

export function ScoreRing({ grades, score, label }: { grades: (Grade | null)[]; score: Score; label: string }) {
  const n = Math.max(1, grades.length);
  const c = 54;
  const r = 46;
  const gap = 0.06; // radians between segments
  const pt = (a: number) => `${(c + r * Math.sin(a)).toFixed(2)} ${(c - r * Math.cos(a)).toFixed(2)}`;
  return (
    <svg width="108" height="108" viewBox="0 0 108 108" role="img" aria-label={label} className="shrink-0">
      {grades.length === 0 && <circle cx={c} cy={c} r={r} fill="none" strokeWidth="14" strokeDasharray="4 4" className="stroke-border" />}
      {grades.map((g, i) => {
        const a0 = (i / n) * 2 * Math.PI + gap;
        const a1 = ((i + 1) / n) * 2 * Math.PI - gap;
        return <path key={i} d={`M${pt(a0)} A${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${pt(a1)}`} fill="none" strokeWidth="14" className={g === "pass" ? "stroke-success" : g === "near" ? "stroke-highlight" : g === "fail" ? "stroke-destructive" : "stroke-border"} />;
      })}
      <text x={c} y="56.7" fontSize="27" fontWeight="700" textAnchor="middle" className="fill-foreground">
        {score.total ? `${score.score}/${score.total}` : "—"}
      </text>
      <text x={c} y="77" fontSize="10" textAnchor="middle" className="fill-muted-foreground">
        ตรงเป้า
      </text>
    </svg>
  );
}

// ─── 4-week step line ───

export function StepChart({ chips, labels }: { chips: Score[]; labels: string[] }) {
  const max = Math.max(1, ...chips.map((c) => c.total));
  const W = 358;
  const x0 = 26;
  const x1 = 350;
  const yOf = (v: number) => 88 - (v / max) * 72;
  const seg = (x1 - x0) / chips.length;
  const known = chips.map((c, i) => ({ c, i })).filter(({ c }) => c.total > 0);
  const steps = known.map(({ c, i }) => [`${(x0 + i * seg).toFixed(1)},${yOf(c.score).toFixed(1)}`, `${(x0 + (i + 1) * seg).toFixed(1)},${yOf(c.score).toFixed(1)}`]).flat();
  const goal = max - 1;
  const ticks = [...new Set([0, Math.round(max / 3), Math.round((2 * max) / 3), max])];
  return (
    <svg width="100%" height="110" viewBox={`0 0 ${W} 110`} role="img" aria-label={`คะแนน 4 สัปดาห์ ${chips.map((c) => (c.total ? c.score : "ไม่มี")).join(" ")} จาก ${max}`}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={x0} x2={x1} y1={yOf(t)} y2={yOf(t)} className="stroke-border" />
          <text x="20" y={yOf(t) + 3.5} fontSize="10" textAnchor="end" className="fill-muted-foreground">
            {t}
          </text>
        </g>
      ))}
      {steps.length > 0 && <polyline points={steps.join(" ")} fill="none" strokeWidth="2.5" className="stroke-brand" />}
      {max > 1 && (
        <>
          <line x1={x0} x2={x1} y1={yOf(goal)} y2={yOf(goal)} strokeWidth="1.5" strokeDasharray="5 4" className="stroke-success" />
          <text x={x0 + 4} y={yOf(goal) - 5} fontSize="10" fontWeight="600" className="fill-success">
            เป้า {goal}/{max}
          </text>
        </>
      )}
      {chips.map((c, i) => (
        <g key={i}>
          <text x={x0 + (i + 0.5) * seg} y={c.total ? yOf(c.score) - 8 : 80} fontSize="12" fontWeight="700" textAnchor="middle" className={c.total ? "fill-foreground" : "fill-muted-foreground"}>
            {c.total ? `${c.score}/${c.total}` : "—"}
          </text>
          <text x={x0 + (i + 0.5) * seg} y="104" fontSize="10" textAnchor="middle" fontWeight={i === chips.length - 1 ? 700 : 400} className="fill-muted-foreground">
            {labels[i]}
          </text>
        </g>
      ))}
    </svg>
  );
}

// ─── Day dots ───

export function DayDot({ m }: { m: DayMark }) {
  if (m === "pass")
    return (
      <svg width="22" height="22" aria-label="ผ่าน">
        <circle cx="11" cy="11" r="4.5" className="fill-success" />
      </svg>
    );
  if (m === "fail")
    return (
      <svg width="22" height="22" aria-label="ไม่ผ่าน">
        <circle cx="11" cy="11" r="8" className="fill-destructive" />
        <path d="M8 8l6 6M14 8l-6 6" strokeWidth="2" strokeLinecap="round" className="stroke-destructive-foreground" />
      </svg>
    );
  if (m === "pending")
    return (
      <svg width="22" height="22" aria-label="ยังไม่ถึงกำหนด">
        <circle cx="11" cy="11" r="4" fill="none" strokeWidth="1.5" className="stroke-muted-foreground" />
      </svg>
    );
  return (
    <svg width="22" height="22" aria-label="ไม่มี">
      <line x1="8" x2="14" y1="11" y2="11" strokeWidth="2" className="stroke-border" />
    </svg>
  );
}

// ─── Kitchen funnel ───

export function Funnel({ plan, fill, received }: { plan: number | null; fill: number | null; received: number | null }) {
  const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
  const rows: { label: string; v: number | null; text: string; tone: string }[] = [
    { label: "แผนผลิต", v: plan === null ? null : 1, text: plan === null ? "ไม่มีแผน" : "100%", tone: "fill-brand" },
    { label: "ผลิตจริง", v: plan, text: pct(plan), tone: "fill-brand" },
    { label: "ส่งครบ", v: fill, text: pct(fill), tone: "fill-brand" },
    { label: "สาขารับ", v: received, text: received === null ? "—" : `${pct(received)} ของที่ส่ง`, tone: "fill-success" },
  ];
  const W = 232;
  const mid = 186;
  return (
    <svg width="100%" height="132" viewBox="0 0 358 132" role="img" aria-label={rows.map((r) => `${r.label} ${r.text}`).join(" ")}>
      {rows.map((r, i) => {
        const y = 4 + i * 32;
        // The last bar is a share of what was sent, so it sits under "ส่งครบ"
        const w = r.v === null ? 0 : W * (i === 3 ? (fill ?? 1) : r.v);
        const prevV = i > 0 && i < 3 ? rows[i - 1].v : null;
        const drop = prevV !== null && r.v !== null ? Math.round((r.v - prevV) * 100) : null;
        return (
          <g key={r.label}>
            <text x="0" y={y + 15} fontSize="12" fontWeight="700" className="fill-foreground">
              {r.label}
            </text>
            {r.v === null ? (
              <rect x={mid - W / 2} y={y} width={W} height="22" rx="5" fill="none" strokeDasharray="4 3" className="stroke-border" />
            ) : (
              <rect x={mid - w / 2} y={y} width={Math.max(w, 2)} height="22" rx="5" className={r.tone} />
            )}
            <text x={mid} y={y + 15} fontSize="11.5" fontWeight="700" textAnchor="middle" className={r.v === null || w < 60 ? "fill-muted-foreground" : "fill-brand-foreground"}>
              {r.text}
            </text>
            {drop !== null && drop < 0 && (
              <text x="358" y={y - 1} fontSize="12" fontWeight="700" textAnchor="end" className="fill-destructive">
                −{Math.abs(drop)}%
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ─── ต้องดู timeline ───

const thb = (n: number) => `฿${Math.round(n).toLocaleString("th-TH")}`;

export function Timeline({ items, onGo, empty }: { items: Attention[]; onGo: (go: Go) => void; empty: string }) {
  if (!items.length) return <p className="rounded-xl bg-secondary px-3 py-3 text-sm text-muted-foreground">{empty}</p>;
  // Whole row is the tap target; the amount sits beside the title and the action is a small link
  // under it — a button beside the text squeezed titles into 2–3 broken lines on a phone.
  return (
    <div className="relative before:absolute before:bottom-3 before:left-[13px] before:top-3 before:w-0.5 before:bg-border">
      {items.map((a) => {
        const body = (
          <>
            <span className="flex w-7 shrink-0 justify-center pt-0.5">
              <svg width="20" height="20" viewBox="0 0 28 28" aria-label={a.tone === "red" ? "ด่วน" : "ควรดู"}>
                <circle cx="14" cy="14" r="9" strokeWidth="3" className={cn(a.tone === "red" ? "fill-destructive" : "fill-highlight", "stroke-background")} />
              </svg>
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 text-sm font-semibold leading-snug">{a.title}</span>
                {a.baht !== null && <b className="shrink-0 whitespace-nowrap font-mono text-sm tabular-nums">{thb(a.baht)}</b>}
              </span>
              <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{a.detail}</span>
              {a.action && <span className="mt-1 inline-flex items-center text-[13px] font-semibold text-brand">{a.action.label} ›</span>}
            </span>
          </>
        );
        return a.action ? (
          <button key={a.key} type="button" onClick={() => onGo(a.action!.go)} className="relative flex w-full items-start gap-2.5 py-2.5 text-left">
            {body}
          </button>
        ) : (
          <div key={a.key} className="relative flex items-start gap-2.5 py-2.5">
            {body}
          </div>
        );
      })}
    </div>
  );
}
