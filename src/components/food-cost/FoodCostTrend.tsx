import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { FC_TARGET } from "@/lib/food-cost";
import type { TrendPoint } from "@/hooks/use-food-cost";

interface Props {
  /** Oldest first */
  months: { from: string; to: string }[];
  /** null = still working that month out */
  points: (TrendPoint | "failed" | null)[];
  selected: string;
  onPick: (from: string) => void;
  /** One branch: there can be an actual line */
  oneBranch: boolean;
  today: string;
  error: boolean;
}

const H = 220;
/** Above this the scale stops growing: one bad month shouldn't flatten the rest */
const CAP = 60;
const L = 40;
const R = 16;
const T = 14;
const B = 30;
const label = (from: string) => new Date(`${from}T00:00:00`).toLocaleDateString("th-TH", { month: "short" });
const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}฿${Math.abs(Math.round(n)).toLocaleString("th-TH")}`;

/**
 * Food cost % month by month: from the recipes (dashed) and, for one branch and
 * months that have ended, from the counts (solid). Under it, actual − recipes in
 * baht. Tapping a month opens it below.
 */
export function FoodCostTrend({ months, points: raw, selected, onPick, oneBranch, today, error }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  // Drawn at the box's real width, so the text stays its real size on a phone
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(640);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const points = months.map((_, i) => raw[i] ?? null);
  const done = (p: TrendPoint | "failed" | null): p is TrendPoint => !!p && p !== "failed";
  const values = points.flatMap((p) => (done(p) ? [p.stdPct, p.actPct] : [])).filter((v): v is number => v !== null && Number.isFinite(v));
  // The scale hugs the numbers but always shows the target
  const lo = Math.floor(Math.min(FC_TARGET - 10, ...values) / 2) * 2;
  const hi = Math.min(CAP, Math.ceil(Math.max(FC_TARGET + 1, ...values) / 2) * 2);
  const x = (i: number) => L + ((i + 0.5) * (W - L - R)) / months.length;
  const y = (v: number) => T + ((hi - Math.min(v, hi)) / (hi - lo)) * (H - T - B);
  const ticks: number[] = [];
  for (let v = lo; v <= hi; v += hi - lo > 12 ? 4 : 2) ticks.push(v);
  // Split at months with no value: never draw a line through a missing month
  const segments = (key: "stdPct" | "actPct") => {
    const out: string[][] = [[]];
    points.forEach((p, i) => {
      const v = done(p) ? p[key] : null;
      if (v === null || !Number.isFinite(v)) out.push([]);
      else out[out.length - 1].push(`${x(i)},${y(v)}`);
    });
    return out.filter((s) => s.length > 1).map((s) => s.join(" "));
  };
  const hp = hover !== null ? points[hover] : null;
  const h = done(hp) ? hp : null;

  return (
    <section className="rounded-2xl border border-border bg-card px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="font-bold">ต้นทุน % รายเดือน</h2>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <svg width="22" height="8" aria-hidden>
              <line x1="0" x2="22" y1="4" y2="4" className="stroke-foreground" strokeWidth="2" strokeDasharray="5 3" />
            </svg>
            ตามสูตร (จากยอดขาย)
          </span>
          {oneBranch && (
            <span className="inline-flex items-center gap-1.5">
              <svg width="22" height="8" aria-hidden>
                <line x1="0" x2="22" y1="4" y2="4" className="stroke-brand" strokeWidth="2" />
              </svg>
              จริง (จากนับสต๊อก)
            </span>
          )}
          <span className="inline-flex items-center gap-1.5">
            <svg width="22" height="8" aria-hidden>
              <line x1="0" x2="22" y1="4" y2="4" className="stroke-destructive" strokeDasharray="3 3" />
            </svg>
            เป้า {FC_TARGET}%
          </span>
        </div>
      </div>
      {error && <p className="mt-2 text-sm text-destructive">บางเดือนโหลดไม่สำเร็จ ลองใหม่อีกครั้ง</p>}
      <div ref={box} className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="mt-1 block max-w-full" role="img" aria-label="ต้นทุนอาหาร % รายเดือน">
          {ticks.map((v) => (
            <g key={v}>
              <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="stroke-border" />
              <text x={L - 6} y={y(v) + 4} textAnchor="end" className="fill-muted-foreground font-mono text-[11px]">
                {v}%
              </text>
            </g>
          ))}
          <line x1={L} x2={W - R} y1={y(FC_TARGET)} y2={y(FC_TARGET)} className="stroke-destructive" strokeDasharray="4 4" />
          {months.map((mo, i) => (
            <text key={mo.from} x={x(i)} y={H - 10} textAnchor="middle" className={cn("text-[12px]", mo.from === selected ? "fill-foreground font-bold" : "fill-muted-foreground")}>
              {label(mo.from)}
              {mo.to >= today ? " (ยังไม่จบ)" : ""}
            </text>
          ))}
          {segments("stdPct").map((pts) => (
            <polyline key={pts} points={pts} fill="none" className="stroke-foreground" strokeWidth="2" strokeDasharray="6 4" />
          ))}
          {oneBranch && segments("actPct").map((pts) => <polyline key={pts} points={pts} fill="none" className="stroke-brand" strokeWidth="2" />)}
          {points.map((p, i) =>
            p === "failed" ? (
              <text key={i} x={x(i)} y={(T + H - B) / 2} textAnchor="middle" className="fill-muted-foreground text-[12px]">
                โหลดไม่ได้
              </text>
            ) : p ? (
              <g key={i}>
                {p.stdPct !== null && Number.isFinite(p.stdPct) && <circle cx={x(i)} cy={y(p.stdPct)} r="4.5" className="fill-card stroke-foreground" strokeWidth="2" />}
                {oneBranch && p.actPct !== null && Number.isFinite(p.actPct) && <circle cx={x(i)} cy={y(p.actPct)} r="5" className="fill-brand stroke-card" strokeWidth="2" />}
              </g>
            ) : (
              <rect key={i} x={x(i) - 14} y={T} width="28" height={H - T - B} rx="6" className="animate-pulse fill-secondary" />
            ),
          )}
          {/* One tap target per month: the whole column */}
          {months.map((mo, i) => (
            <rect
              key={mo.from}
              x={x(i) - (W - L - R) / months.length / 2}
              y={0}
              width={(W - L - R) / months.length}
              height={H}
              fill="transparent"
              className="cursor-pointer"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onClick={() => {
                setHover(null);
                onPick(mo.from);
              }}
            >
              <title>{`เปิด ${label(mo.from)}`}</title>
            </rect>
          ))}
        </svg>
        {h && hover !== null && (
          <div
            className="pointer-events-none absolute top-1 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs shadow-sm"
            style={{
              left: `${(x(hover) / W) * 100}%`,
              transform: `translateX(${hover >= months.length / 2 ? "-105%" : "5%"})`,
            }}
          >
            <b>{label(h.from)}</b>
            <div>
              สูตร <span className="font-mono">{h.stdPct?.toFixed(1) ?? "—"}%</span>
              {oneBranch && (
                <>
                  {" "}
                  · จริง <span className="font-mono">{h.actPct?.toFixed(1) ?? "—"}%</span>
                </>
              )}
            </div>
            <div className="text-muted-foreground">
              ขาย <span className="font-mono">฿{Math.round(h.revenue).toLocaleString("th-TH")}</span>
            </div>
          </div>
        )}
      </div>
      {oneBranch && (
        <>
          <div className="mt-1 text-xs text-muted-foreground">จริงต่างจากสูตร (แดง = ใช้จริงแพงกว่าสูตร)</div>
          <div
            className="mt-1 grid gap-1"
            style={{
              gridTemplateColumns: `repeat(${months.length}, minmax(0, 1fr))`,
            }}
          >
            {points.map((q, i) => {
              const p = done(q) ? q : null;
              return (
                <button key={months[i].from} type="button" onClick={() => onPick(months[i].from)} className={cn("min-w-0 rounded-lg px-2 py-1.5 text-left", months[i].from === selected ? "bg-secondary" : "hover:bg-secondary/60")}>
                  <div className="text-xs text-muted-foreground">{label(months[i].from)}</div>
                  <div className={cn("truncate font-mono text-sm font-semibold", p?.totalVar && p.totalVar > 0 ? "text-destructive" : "text-foreground")}>{p?.totalVar !== null && p?.totalVar !== undefined ? signed(p.totalVar) : "—"}</div>
                  {p?.priceVar !== null && p?.priceVar !== undefined && p.usageVar !== null && (
                    <div className="truncate text-[11px] text-muted-foreground">
                      ราคา {signed(p.priceVar)} · ใช้ {signed(p.usageVar)}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}
      <p className="mt-2 text-xs text-muted-foreground">{oneBranch ? '"จริง" มีเฉพาะเดือนที่จบและนับปิดเดือนแล้ว · แตะเดือนเพื่อเปิดด้านล่าง' : "เลือกสาขาเดียวเพื่อดูต้นทุนจริงเทียบ · แตะเดือนเพื่อเปิดด้านล่าง"}</p>
    </section>
  );
}
