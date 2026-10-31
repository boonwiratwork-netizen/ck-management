import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CkTrendPoint } from "@/hooks/use-ck-production";
import type { ProductionCost } from "@/lib/ck-production-cost";
import { monthGap } from "@/lib/ck-trend";

const baht = (n: number) => `฿${Math.abs(Math.round(n)).toLocaleString("th-TH")}`;
const signed = (n: number) => `${Math.round(n) > 0 ? "+" : Math.round(n) < 0 ? "−" : ""}${baht(n)}`;
const label = (from: string) => new Date(`${from}T00:00:00`).toLocaleDateString("th-TH", { month: "short", year: "2-digit" });
/** The bar's full length: beyond this the bar stops growing (the number still says it) */
const BAR_CAP = 25;

/** The box's width, so the drawing keeps real-size text on a phone */
function useWidth(min: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(560);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(min, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [min]);
  return [ref, w] as const;
}

const kText = (v: number, step: number) => {
  const digits = step >= 1000 ? 0 : step >= 100 ? 1 : 2;
  return Math.abs(v) >= 1000 ? `฿${(v / 1000).toFixed(digits)}k` : `฿${Math.round(v)}`;
};

/** Recipe → price → use → paid, for the month open below */
function Waterfall({ cost, estimated }: { cost: ProductionCost; estimated: boolean }) {
  const [ref, W] = useWidth(300);
  const H = 230;
  const T = 40;
  const B = 34;
  const L = 56;
  const g = monthGap(cost, estimated);
  const afterPrice = cost.stdCost + g.price;
  const paid = cost.stdCost + g.total;
  const vals = [cost.stdCost, afterPrice, paid];
  // Zoomed in on the differences (at least 2% of the cost, so ฿3 doesn't fill the chart)
  const span = Math.max(Math.max(...vals) - Math.min(...vals), Math.abs(cost.stdCost) * 0.02, 10);
  const mag = 10 ** Math.floor(Math.log10(span / 4));
  const step = [1, 2, 5, 10].map((k) => k * mag).find((s) => span / s <= 6) ?? 10 * mag;
  const lo = Math.floor((Math.min(...vals) - span * 0.6) / step) * step;
  const hi = Math.ceil((Math.max(...vals) + span * 0.2) / step) * step;
  const y = (v: number) => T + ((hi - v) / (hi - lo)) * (H - T - B);
  const col = (W - L) / 4;
  const bw = Math.min(64, col * 0.6);
  const cx = (i: number) => L + col * i + col / 2;
  const steps: { name: string; from: number; to: number; kind: "total" | "up" | "down" | "wait" }[] = [
    { name: "ตามสูตร", from: lo, to: cost.stdCost, kind: "total" },
    { name: "ราคา", from: cost.stdCost, to: afterPrice, kind: g.price > 0 ? "up" : "down" },
    g.use === null ? { name: "การใช้", from: afterPrice, to: afterPrice, kind: "wait" } : { name: "การใช้", from: afterPrice, to: paid, kind: g.use > 0 ? "up" : "down" },
    { name: estimated ? "จนถึงวันนี้" : "จ่ายจริง", from: lo, to: paid, kind: "total" },
  ];
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(v);
  return (
    <div ref={ref} className="max-w-[640px]">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block max-w-full" role="img" aria-label={`ตามสูตร ${baht(cost.stdCost)} ราคา ${signed(g.price)} การใช้ ${g.use === null ? "รอนับ" : signed(g.use)} ${estimated ? "จนถึงวันนี้" : "จ่ายจริง"} ${baht(paid)}`}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W} y1={y(v)} y2={y(v)} className="stroke-border" />
            <text x={L - 6} y={y(v) + 4} textAnchor="end" className="fill-muted-foreground font-mono text-[11px]">
              {kText(v, step)}
            </text>
          </g>
        ))}
        {steps.map((s, i) => {
          const top = y(Math.max(s.from, s.to));
          const h = Math.max(2, Math.abs(y(s.from) - y(s.to)));
          const x = cx(i) - bw / 2;
          const boxTop = Math.max(T, y(s.from) - 36);
          const value = s.kind === "total" ? baht(s.to) : s.kind === "wait" ? "รอนับ" : signed(s.to - s.from);
          return (
            <g key={s.name}>
              {s.kind === "wait" ? (
                <rect x={x} y={boxTop} width={bw} height={Math.max(12, y(s.from) - boxTop)} rx="4" fill="none" className="stroke-muted-foreground" strokeDasharray="4 3" />
              ) : (
                <rect x={x} y={top} width={bw} height={h} rx="4" className={s.kind === "total" ? "fill-foreground" : s.kind === "up" ? "fill-destructive" : "fill-success"} />
              )}
              <text x={cx(i)} y={(s.kind === "wait" ? boxTop : top) - 6} textAnchor="middle" className="fill-foreground font-mono text-[12px] font-semibold">
                {value}
              </text>
              <text x={cx(i)} y={H - 12} textAnchor="middle" className="fill-muted-foreground text-[12px]">
                {s.name}
              </text>
              {i < 3 && <line x1={x + bw} x2={cx(i + 1) - bw / 2} y1={y(s.to)} y2={y(s.to)} className="stroke-muted-foreground" strokeDasharray="3 3" />}
            </g>
          );
        })}
      </svg>
      <p className="text-xs text-muted-foreground">
        แกนเริ่มที่ {kText(lo, step)} ไม่ใช่ 0 (ขยายให้เห็นส่วนต่าง) · แดง = ทำให้จ่ายเพิ่ม · เขียว = ทำให้จ่ายน้อยลง{estimated ? " · เดือนนี้ยังไม่นับปลายเดือน ส่วนการใช้ยังไม่รู้" : ""}
      </p>
    </div>
  );
}

interface Props {
  /** Newest first, as the month chips */
  months: { from: string; to: string }[];
  points: (CkTrendPoint | "failed" | null)[];
  selected: string | null;
  onPick: (from: string) => void;
  /** The month open below (its own, complete numbers) */
  open: { cost: ProductionCost | null; estimated: boolean; label: string } | null;
}

/**
 * Month by month: did the kitchen pay more or less than its recipes, and why (price
 * or use), one line each; tap a month to open it below. Under it, the open month as
 * steps: recipe → price → use → paid.
 */
export function CkTrend({ months, points, selected, onPick, open }: Props) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="font-bold">จ่ายจริงเทียบสูตร รายเดือน</h2>
        <span className="inline-flex items-center gap-1 text-xs font-semibold">
          <ChevronLeft className="h-3.5 w-3.5 text-success" aria-hidden />
          <span className="text-success">ถูกกว่าสูตร</span>
          <span className="text-muted-foreground">·</span>
          <span className="text-destructive">แพงกว่าสูตร</span>
          <ChevronRight className="h-3.5 w-3.5 text-destructive" aria-hidden />
        </span>
      </div>
      <div className="flex flex-col">
        {months.map((m, i) => {
          const p = points[i] ?? null;
          const cost = p && p !== "failed" ? p.cost : null;
          const g = cost && p && p !== "failed" ? monthGap(cost, p.estimated) : null;
          const w = g?.pct != null ? (Math.min(Math.abs(g.pct), BAR_CAP) / BAR_CAP) * 50 : 0;
          // Produced, no cost and nothing blocking: today's balances are still on the way
          const waiting = p !== null && p !== "failed" && p.produced && !cost && !p.blocked;
          return (
            <button key={m.from} type="button" aria-pressed={selected === m.from} onClick={() => onPick(m.from)} className={cn("grid grid-cols-[64px_minmax(0,1fr)] items-center gap-x-3 gap-y-1 border-t border-border px-2 py-2.5 text-left sm:grid-cols-[72px_200px_minmax(0,1fr)]", selected === m.from ? "bg-secondary" : "hover:bg-secondary/60")}>
              <b className="text-sm">{label(m.from)}</b>
              <span className="relative block h-3 rounded-full bg-secondary">
                <i className="absolute -top-1 left-1/2 h-5 w-px bg-muted-foreground/50" />
                {g && g.total !== 0 && <i className={cn("absolute top-0 h-3 rounded-full", g.total > 0 ? "bg-destructive" : "bg-success")} style={g.total > 0 ? { left: "50%", width: `max(4px, ${w}%)` } : { right: "50%", width: `max(4px, ${w}%)` }} />}
              </span>
              <span className="col-span-2 block min-w-0 text-sm sm:col-span-1">
                {p === null || waiting ? (
                  <span className="inline-block h-4 w-48 animate-pulse rounded bg-secondary" />
                ) : p === "failed" ? (
                  <span className="text-muted-foreground">โหลดไม่ได้ · เปิดหน้านี้ใหม่อีกครั้ง</span>
                ) : !p.produced ? (
                  <span className="text-muted-foreground">ไม่มีการผลิต</span>
                ) : !g ? (
                  <span className="text-muted-foreground">{p.blocked ?? "ยังคิดไม่ได้"}</span>
                ) : (
                  <>
                    <span>
                      {p.estimated ? "จนถึงวันนี้" : "จ่ายจริง"}
                      <b className={cn(g.total > 0 ? "text-destructive" : g.total < 0 ? "text-success" : "text-foreground")}>
                        {" "}
                        {g.total === 0 ? "ตรงสูตร" : `${g.total > 0 ? "แพงกว่า" : "ถูกกว่า"}สูตร ${baht(g.total)}${g.pct !== null && Math.abs(g.pct) >= 0.05 ? ` (${Math.abs(g.pct).toFixed(1)}%)` : ""}`}
                      </b>
                    </span>
                    <span className="block text-xs text-muted-foreground">{g.why}</span>
                  </>
                )}
              </span>
            </button>
          );
        })}
      </div>
      {open?.cost && (
        <div className="border-t border-border pt-3">
          <div className="mb-1 text-sm font-semibold">{open.label}: เงินไปไหน</div>
          <Waterfall cost={open.cost} estimated={open.estimated} />
        </div>
      )}
    </section>
  );
}
