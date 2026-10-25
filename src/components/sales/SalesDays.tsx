import { ChevronLeft, ChevronRight } from "lucide-react";
import { addDays, addMonths, endOfMonth, format, getDay, parseISO, startOfMonth } from "date-fns";
import type { DaySummary } from "@/hooks/use-sales-data";
import { baht } from "@/components/receive/parts";
import { cn } from "@/lib/utils";

const DOW = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
const DOW_LONG = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัส", "ศุกร์", "เสาร์"];
const MONTH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const MONTH_LONG = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];

/** "พุธ 22 ต.ค." */
export const thaiDay = (iso: string) => {
  const d = parseISO(iso);
  return `${DOW_LONG[getDay(d)]} ${d.getDate()} ${MONTH[d.getMonth()]}`;
};
const iso = (d: Date) => format(d, "yyyy-MM-dd");

/** A past day with no sales saved (today is still open, so never "missing") */
export const isMissing = (date: string, today: string, days: Map<string, DaySummary>) => date < today && !days.has(date);

type Status = "saved" | "missing" | "today" | "future";
const statusOf = (date: string, today: string, days: Map<string, DaySummary>): Status =>
  days.has(date) ? "saved" : date === today ? "today" : date > today ? "future" : "missing";

/** The last 14 days as two rows of chips (phones and the left column) */
export function DayStrip({ today, days, loading, selected, onPick }: { today: string; days: Map<string, DaySummary>; loading: boolean; selected: string | null; onPick: (d: string) => void }) {
  const list = Array.from({ length: 14 }, (_, k) => iso(addDays(parseISO(today), k - 13)));
  const missing = list.filter((d) => isMissing(d, today, days)).length;
  return (
    <section data-tour="days" className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">14 วันล่าสุด</h2>
        {!loading && <span className={cn("text-sm font-semibold", missing ? "text-warning" : "text-success")}>{missing ? `ยังไม่มียอด ${missing} วัน` : "ครบทุกวัน"}</span>}
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {list.map((d) => {
          const st = loading ? "future" : statusOf(d, today, days);
          const date = parseISO(d);
          return (
            <button
              key={d}
              type="button"
              onClick={() => onPick(d)}
              aria-pressed={selected === d}
              aria-label={`${thaiDay(d)} ${st === "saved" ? `มียอด ${baht(days.get(d)!.total)}` : st === "missing" ? "ยังไม่มียอด" : ""}`}
              className={cn(
                "flex min-h-[52px] flex-col items-center justify-center gap-px rounded-xl border text-[15px] font-semibold transition-colors",
                st === "missing" ? "border-dashed border-warning bg-warning-soft text-warning" : "border-border bg-card hover:bg-secondary",
                selected === d && "ring-2 ring-foreground ring-offset-1",
                loading && "animate-pulse",
              )}
            >
              <span className={cn("text-[11px] font-normal", st === "missing" ? "text-warning" : "text-muted-foreground")}>{DOW[getDay(date)]}</span>
              {date.getDate()}
              {st === "saved" && <span className="h-1.5 w-1.5 rounded-full bg-success" />}
              {st === "missing" && <span className="text-[10px] font-medium leading-none">ขาด</span>}
              {st === "today" && <span className="text-[10px] font-medium leading-none text-muted-foreground">วันนี้</span>}
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** One month (computers): saved days tinted, missing days dashed */
export function MonthCalendar({
  month,
  onMonth,
  today,
  days,
  loading,
  selected,
  onPick,
}: {
  month: string;
  onMonth: (m: string) => void;
  today: string;
  days: Map<string, DaySummary>;
  loading: boolean;
  selected: string | null;
  onPick: (d: string) => void;
}) {
  const first = startOfMonth(parseISO(`${month}-01`));
  const last = endOfMonth(first);
  const lead = (getDay(first) + 6) % 7; // weeks start Monday
  const cells = Array.from({ length: last.getDate() }, (_, k) => iso(addDays(first, k)));
  const missing = cells.filter((d) => isMissing(d, today, days)).length;
  const canNext = iso(addMonths(first, 1)) <= today;
  return (
    <section data-tour="days" className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-1">
        <button type="button" aria-label="เดือนก่อน" onClick={() => onMonth(format(addMonths(first, -1), "yyyy-MM"))} className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-secondary">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <h2 className="flex-1 text-center text-[15px] font-semibold">
          {MONTH_LONG[first.getMonth()]} {first.getFullYear() + 543}
        </h2>
        <button type="button" aria-label="เดือนถัดไป" disabled={!canNext} onClick={() => onMonth(format(addMonths(first, 1), "yyyy-MM"))} className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-secondary disabled:opacity-30">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
        {["จ", "อ", "พ", "พฤ", "ศ", "ส", "อา"].map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: lead }, (_, k) => (
          <span key={`l${k}`} />
        ))}
        {cells.map((d) => {
          const st = loading ? "future" : statusOf(d, today, days);
          return (
            <button
              key={d}
              type="button"
              disabled={st === "future" && !loading}
              onClick={() => onPick(d)}
              aria-pressed={selected === d}
              title={st === "saved" ? baht(days.get(d)!.total) : undefined}
              className={cn(
                "h-10 rounded-lg text-sm transition-colors disabled:opacity-30",
                st === "saved" && "bg-success-soft hover:brightness-95",
                st === "missing" && "border-[1.5px] border-dashed border-warning bg-warning-soft font-bold text-warning",
                (st === "today" || st === "future") && "border border-border bg-card",
                selected === d && "ring-2 ring-foreground",
                loading && "animate-pulse",
              )}
            >
              {parseISO(d).getDate()}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded bg-success-soft" />
          มียอดแล้ว
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded border-[1.5px] border-dashed border-warning bg-warning-soft" />
          ยังไม่มียอด
        </span>
        {!loading && missing > 0 && <span className="ml-auto font-semibold text-warning">ขาด {missing} วัน</span>}
      </div>
    </section>
  );
}

/** Days with sales, newest first (phone home screen) */
export function RecentDays({ days, onPick, limit = 7 }: { days: Map<string, DaySummary>; onPick: (d: string) => void; limit?: number }) {
  const list = [...days.entries()].sort(([a], [b]) => b.localeCompare(a)).slice(0, limit);
  if (!list.length) return null;
  return (
    <section data-tour="saved" className="flex flex-col gap-2">
      <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">บันทึกแล้ว</h2>
      <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
        {list.map(([d, s]) => (
          <li key={d}>
            <button type="button" onClick={() => onPick(d)} className="flex min-h-[60px] w-full items-center gap-3 px-4 py-2 text-left hover:bg-secondary/60">
              <span className="min-w-0 flex-1">
                <span className="block text-[15px]">{thaiDay(d)}</span>
                <span className="block text-sm text-muted-foreground">
                  {s.bills} บิล · {s.lines} รายการ
                </span>
              </span>
              <span className="font-mono text-[15px] font-semibold">{baht(s.total)}</span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
