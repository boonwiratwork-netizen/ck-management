import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, ChevronLeft, ChevronRight, CircleDot, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetch-all";
import { cn } from "@/lib/utils";
import { monthDays, type CalDay, type CalSummary } from "@/lib/day-calendar";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { Branch } from "@/types/branch";

/** Dev demo only: rows for the month instead of the database */
export type CalendarLoad = (
  branchIds: string[],
  from: string,
  to: string,
) => Promise<{
  counts: { branch_id: string; count_date: string; is_submitted: boolean; physical_count: number | null }[];
  sales: { branch_id: string; sale_date: string }[];
}>;

interface Props {
  branches: Branch[];
  /** The count day (before 5am is still yesterday's count), as the count page has it */
  today: string;
  /** Tapping a day opens its count sheet or sales */
  canOpen?: boolean;
  load?: CalendarLoad;
}

async function loadMonth(branchIds: string[], from: string, to: string) {
  const all = <T,>(build: (a: number, b: number) => unknown) =>
    fetchAllRows<T>(build as never).then((r) => r.data);
  const [counts, sales] = await Promise.all([
    all<{ branch_id: string; count_date: string; is_submitted: boolean; physical_count: number | null }>(
      (a, b) =>
        supabase
          .from("daily_stock_counts")
          .select("id, branch_id, count_date, is_submitted, physical_count")
          .in("branch_id", branchIds)
          .gte("count_date", from)
          .lte("count_date", to)
          .order("id")
          .range(a, b),
    ),
    all<{ branch_id: string; sale_date: string }>((a, b) =>
      supabase
        .from("sales_entries")
        .select("id, branch_id, sale_date")
        .in("branch_id", branchIds)
        .gte("sale_date", from)
        .lte("sale_date", to)
        .order("id")
        .range(a, b),
    ),
  ]);
  return { counts, sales };
}

const shiftMonth = (month: string, by: number) => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + by, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const monthLabel = (month: string) =>
  new Date(`${month}-01T00:00:00`).toLocaleDateString("th-TH", {
    month: "long",
    year: "numeric",
  });
const dayLabel = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString("th-TH", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

const TONE = {
  done: "bg-success-soft text-success",
  open: "bg-warning-soft text-warning",
  none: "bg-destructive/10 text-destructive",
} as const;
const ICON = { done: Check, open: CircleDot, none: X } as const;
const COUNT_TEXT = {
  done: "นับเสร็จ",
  open: "นับแล้ว ยังไม่กดนับเสร็จ",
  none: "ไม่ได้นับ",
} as const;

/**
 * The whole month, one row of days per branch: which days were counted and which
 * days' sales never came in. A gap only shows here; the Today card only covers yesterday.
 * Tap a day to open that day's count sheet or sales.
 */
export function MonthCalendar({
  branches,
  today,
  canOpen = true,
  load = loadMonth,
}: Props) {
  const navigate = useNavigate();
  const thisMonth = today.slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const [data, setData] = useState<Record<
    string,
    { days: CalDay[]; summary: CalSummary }
  > | null>(null);
  const [error, setError] = useState(false);
  const key = branches.map((b) => b.id).join(",");

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    setData(null);
    setError(false);
    const [y, m] = month.split("-").map(Number);
    const to = `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
    load(key.split(","), `${month}-01`, to)
      .then(({ counts, sales }) => {
        if (cancelled) return;
        const out: Record<string, { days: CalDay[]; summary: CalSummary }> = {};
        for (const id of key.split(",")) {
          out[id] = monthDays(
            month,
            today,
            counts.filter((c) => c.branch_id === id),
            new Set(
              sales.filter((s) => s.branch_id === id).map((s) => s.sale_date),
            ),
          );
        }
        setData(out);
      })
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [key, month, today]); // eslint-disable-line react-hooks/exhaustive-deps

  // The count and sales pages each remember their own branch: point them at this one
  const open = (
    path: "daily-stock-count" | "sales-entry",
    branchId: string,
    date: string,
  ) => {
    try {
      localStorage.setItem(
        path === "daily-stock-count" ? "ck-count-branch" : "ck-sales-branch",
        branchId,
      );
    } catch {
      /* the page falls back to its first branch */
    }
    if (path === "daily-stock-count")
      navigate("/daily-stock-count", { state: { date } });
    else navigate({ pathname: "/sales-entry", hash: `#day/${date}` });
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10"
            aria-label="เดือนก่อน"
            onClick={() => setMonth((m) => shiftMonth(m, -1))}
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <h2 className="text-base font-bold">
            {monthLabel(month)} · นับสต๊อกและยอดขาย
          </h2>
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10"
            aria-label="เดือนถัดไป"
            disabled={month >= thisMonth}
            onClick={() => setMonth((m) => shiftMonth(m, 1))}
          >
            <ChevronRight className="h-5 w-5" />
          </Button>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {(["done", "open", "none"] as const).map((k) => {
            const I = ICON[k];
            return (
              <span key={k} className="inline-flex items-center gap-1">
                <I className={cn("h-3.5 w-3.5", TONE[k].split(" ")[1])} />{" "}
                {COUNT_TEXT[k]}
              </span>
            );
          })}
          <span className="inline-flex items-center gap-1">
            <i className="inline-block h-[3px] w-3.5 rounded-sm bg-destructive" />{" "}
            ยอดขายยังไม่เข้า
          </span>
        </div>
      </div>
      {error && (
        <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
          โหลดปฏิทินไม่สำเร็จ ลองใหม่อีกครั้ง
        </p>
      )}
      {branches.map((b) => {
        const d = data?.[b.id];
        return (
          <div
            key={b.id}
            className="flex flex-col gap-2 rounded-2xl border border-border bg-card px-4 py-3"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <b>{b.branchName}</b>
              {d && (
                <span className="text-sm text-muted-foreground">
                  นับเสร็จ{" "}
                  <b className="font-mono text-foreground">{d.summary.done}</b>{" "}
                  · ไม่กดเสร็จ{" "}
                  <b
                    className={cn(
                      "font-mono",
                      d.summary.open ? "text-warning" : "text-foreground",
                    )}
                  >
                    {d.summary.open}
                  </b>{" "}
                  · ไม่ได้นับ{" "}
                  <b
                    className={cn(
                      "font-mono",
                      d.summary.none ? "text-destructive" : "text-foreground",
                    )}
                  >
                    {d.summary.none}
                  </b>{" "}
                  · ยอดขายไม่เข้า{" "}
                  <b
                    className={cn(
                      "font-mono",
                      d.summary.noSales
                        ? "text-destructive"
                        : "text-foreground",
                    )}
                  >
                    {d.summary.noSales}
                  </b>{" "}
                  วัน
                </span>
              )}
            </div>
            {!d ? (
              !error && (
                <div className="h-[76px] animate-pulse rounded-xl bg-secondary" />
              )
            ) : (
              <div className="grid grid-cols-10 gap-1 lg:grid-cols-[repeat(16,minmax(0,1fr))]">
                {d.days.map((day) => {
                  const blank = day.pending && day.count === "none";
                  const I = ICON[day.count];
                  return (
                    <Popover key={day.date}>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          aria-label={`${dayLabel(day.date)} ${blank ? "" : COUNT_TEXT[day.count]}${!day.pending && !day.sales ? " · ยอดขายยังไม่เข้า" : ""}`}
                          className={cn(
                            "relative flex h-9 flex-col items-center justify-center rounded-lg text-[11px] leading-none",
                            blank
                              ? "bg-secondary text-muted-foreground"
                              : TONE[day.count],
                            day.date === today && "ring-1 ring-foreground/40",
                          )}
                        >
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {Number(day.date.slice(8))}
                          </span>
                          {!blank && <I className="mt-0.5 h-3 w-3" />}
                          {!day.pending && !day.sales && (
                            <i className="absolute inset-x-[3px] bottom-[2px] h-[3px] rounded-sm bg-destructive" />
                          )}
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-64 p-3">
                        <div className="flex flex-col gap-2 text-sm">
                          <b>
                            {b.branchName} · {dayLabel(day.date)}
                          </b>
                          <span className="text-muted-foreground">
                            {blank ? "ยังไม่ถึงเวลานับ" : COUNT_TEXT[day.count]}{" "}
                            ·{" "}
                            {day.sales
                              ? "ยอดขายเข้าแล้ว"
                              : day.pending
                                ? "ยอดขายยังไม่ถึงเวลา"
                                : "ยอดขายยังไม่เข้า"}
                          </span>
                          {canOpen && (
                            <div className="flex gap-2">
                              <Button
                                variant="outline"
                                className="h-10 flex-1"
                                onClick={() =>
                                  open("daily-stock-count", b.id, day.date)
                                }
                              >
                                ใบนับ
                              </Button>
                              <Button
                                variant="outline"
                                className="h-10 flex-1"
                                onClick={() =>
                                  open("sales-entry", b.id, day.date)
                                }
                              >
                                ยอดขาย
                              </Button>
                            </div>
                          )}
                        </div>
                      </PopoverContent>
                    </Popover>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      <p className="text-xs text-muted-foreground">
        "ไม่กดเสร็จ" = ใส่ยอดนับแล้ว (สต๊อกใช้ยอดนั้นแล้ว) แต่ยังไม่กด "นับเสร็จ"
        ใบยังแก้ได้ และวันถัดไปจะเริ่มนับไม่ได้จนกว่าจะปิดวันที่ค้าง · เปิดใบนับแต่ไม่ได้ใส่ยอด = ไม่ได้นับ
        {canOpen && " · แตะวันเพื่อเปิดใบนับหรือยอดขายของวันนั้น"}
      </p>
    </section>
  );
}
