import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { fetchAllRows } from "@/lib/fetch-all";
import { toLocalDateStr, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { Branch } from "@/types/branch";
import type { TabKey } from "@/components/AppSidebar";
import { fetchPendingTrCount } from "@/lib/pending-trs";
import { kitchenMonthEnd } from "@/lib/month-end";
import { LOW_DAYS, businessDate } from "@/lib/stock-count";
import { MonthCalendar, type CalendarLoad } from "@/components/today/MonthCalendar";

interface Props {
  branches: Branch[];
  onNavigate: (tab: TabKey) => void;
  /** Area managers look; they don't get "go do it" buttons */
  readOnly?: boolean;
  /** Dev demo only */
  load?: (branchIds: string[], today: string, yesterday: string, monthStart: string) => Promise<Record<string, BranchDay>>;
  /** Dev demo only: show the kitchen card and load it from here */
  kitchen?: { load: (today: string) => Promise<KitchenDay> };
  /** The calendar's days open that day's count sheet and sales (not for the kitchen role) */
  canOpenDays?: boolean;
  /** Dev demo only: the month calendar's rows */
  calendarLoad?: CalendarLoad;
}

/** The central kitchen's day: management run the kitchen from their own accounts */
export interface KitchenDay {
  /** Suppliers received from today (receipts are stored per item, not per bill) */
  suppliers: number;
  /** Production runs recorded today */
  runs: number;
  /** Branch requests still waiting for a transfer order */
  requests: number;
  /** Transfer orders sent that a branch hasn't received yet */
  sent: number;
  /**
   * Month-end count, only around the end of the month: due on `date` (the last
   * day), and whether a finished count is already there
   */
  monthEnd: { date: string; done: boolean } | null;
}

/** What one branch has done for its day */
export interface BranchDay {
  salesYesterday: number | null;
  salesMonth: number;
  /** Yesterday's count: finished / counted but "นับเสร็จ" not pressed / nothing counted */
  countYesterday: "done" | "open" | "none";
  toReceive: number;
  /** Items with less than 2 days left at the latest finished count */
  low: { name: string; days: number }[];
}

const baht = (n: number) => `฿${Math.round(n).toLocaleString("th-TH")}`;

async function loadDays(branchIds: string[], today: string, yesterday: string, monthStart: string): Promise<Record<string, BranchDay>> {
  const all = <T,>(build: (a: number, b: number) => unknown) => fetchAllRows<T>(build as never).then((r) => r.data);
  const [sales, counts, tos, skus] = await Promise.all([
    all<{ branch_id: string; sale_date: string; net_amount: number }>((a, b) => supabase.from("sales_entries").select("id, branch_id, sale_date, net_amount").in("branch_id", branchIds).gte("sale_date", monthStart).lte("sale_date", today).order("id").range(a, b)),
    // The last few days of count sheets: yesterday's state and the latest finished count
    all<{ branch_id: string; count_date: string; sku_id: string; physical_count: number | null; expected_usage: number; is_submitted: boolean }>((a, b) =>
      supabase.from("daily_stock_counts").select("id, branch_id, count_date, sku_id, physical_count, expected_usage, is_submitted").in("branch_id", branchIds).gte("count_date", toLocalDateStr(new Date(Date.parse(`${yesterday}T00:00:00`) - 6 * 86_400_000))).lte("count_date", today).order("id").range(a, b),
    ),
    supabase.from("transfer_orders").select("id, branch_id").in("branch_id", branchIds).eq("status", "Sent"),
    supabase.from("skus").select("id, name"),
  ]);
  const name = new Map((skus.data ?? []).map((s) => [s.id, s.name as string]));
  const out: Record<string, BranchDay> = {};
  for (const b of branchIds) {
    const bs = sales.filter((s) => s.branch_id === b);
    const yRows = bs.filter((s) => s.sale_date === yesterday);
    const cy = counts.filter((c) => c.branch_id === b && c.count_date === yesterday);
    // Latest count: days left = counted ÷ that day's expected use. Finished or not, as
    // the stock pages read it (a counted sheet left open used to fall back to an older one)
    const finished = counts.filter((c) => c.branch_id === b && c.physical_count !== null);
    const lastDate = finished.reduce<string | null>((m, c) => (!m || c.count_date > m ? c.count_date : m), null);
    const low = finished
      .filter((c) => c.count_date === lastDate && Number(c.physical_count) > 0 && Number(c.expected_usage) > 0)
      .map((c) => ({ name: name.get(c.sku_id) ?? "", days: Number(c.physical_count) / Number(c.expected_usage) }))
      .filter((x) => x.days < LOW_DAYS)
      .sort((x, y) => x.days - y.days);
    out[b] = {
      salesYesterday: yRows.length ? yRows.reduce((t, s) => t + (Number(s.net_amount) || 0), 0) : null,
      salesMonth: bs.reduce((t, s) => t + (Number(s.net_amount) || 0), 0),
      // A sheet opened with nothing typed in isn't a count
      countYesterday: !cy.some((c) => c.physical_count !== null) ? "none" : cy.every((c) => c.is_submitted) ? "done" : "open",
      toReceive: (tos.data ?? []).filter((t) => t.branch_id === b).length,
      low,
    };
  }
  return out;
}

async function loadKitchen(today: string): Promise<KitchenDay> {
  const end = kitchenMonthEnd(today);
  const shift = (date: string, days: number) => toLocalDateStr(new Date(Date.parse(`${date}T00:00:00`) + days * 86_400_000));
  const [bills, runs, requests, sent, counts] = await Promise.all([
    supabase.from("goods_receipts").select("id, supplier_id").eq("receipt_date", today).order("id"),
    supabase.from("production_records").select("id", { count: "exact", head: true }).eq("production_date", today),
    fetchPendingTrCount(),
    supabase.from("transfer_orders").select("id", { count: "exact", head: true }).eq("status", "Sent"),
    // A finished kitchen count within 3 days of the month end, as the kitchen dashboard
    // looks for one (whether it counted enough to work out the month is shown there)
    end
      ? supabase.from("stock_count_sessions").select("id").eq("status", "Completed").is("deleted_at", null).gte("count_date", shift(end, -3)).lte("count_date", shift(end, 3))
      : Promise.resolve({ data: [] as { id: string }[], error: null }),
  ]);
  // A failed read must not show as "nothing to do"
  const failed = [bills, runs, sent, counts].find((r) => r.error);
  if (failed) throw failed.error;
  return {
    suppliers: new Set((bills.data ?? []).map((b) => b.supplier_id)).size,
    runs: runs.count ?? 0,
    requests,
    sent: sent.count ?? 0,
    monthEnd: end ? { date: end, done: !!counts.data?.length } : null,
  };
}

const shortDate = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString("th-TH", { day: "numeric", month: "short" });

/**
 * The branch's day at a glance — the store manager's first screen: has
 * yesterday's sales come in, was yesterday counted, anything to receive,
 * anything running out. Each open job is one tap from the page that does it.
 * Management and area managers see every branch they look after.
 */
export default function StoreOverview({ branches, onNavigate, readOnly, load = loadDays, kitchen, calendarLoad, canOpenDays = true }: Props) {
  const { profile, isStoreManager, isManagement, isCkManager } = useAuth();
  const showKitchen = !!kitchen || isManagement || isCkManager;
  const loadK = kitchen?.load ?? loadKitchen;
  const now = new Date();
  const today = toLocalDateStr(now);
  const yesterday = toLocalDateStr(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const monthStart = toLocalDateStr(new Date(now.getFullYear(), now.getMonth(), 1));
  const shown = useMemo(
    () => (isStoreManager ? branches.filter((b) => b.id === profile?.branch_id) : branches.filter((b) => b.status === "Active")),
    [isStoreManager, profile?.branch_id, branches],
  );
  const key = shown.map((b) => b.id).join(",");
  const [days, setDays] = useState<Record<string, BranchDay> | null>(null);
  const [error, setError] = useState(false);
  const [kDay, setKDay] = useState<KitchenDay | null>(null);
  const [kError, setKError] = useState(false);

  useEffect(() => {
    if (!showKitchen) return;
    let cancelled = false;
    setKError(false);
    loadK(today)
      .then((d) => !cancelled && setKDay(d))
      .catch(() => !cancelled && setKError(true));
    return () => {
      cancelled = true;
    };
  }, [showKitchen, today]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    setError(false);
    load(key.split(","), today, yesterday, monthStart)
      .then((d) => !cancelled && setDays(d))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [key, today]); // eslint-disable-line react-hooks/exhaustive-deps

  const yLabel = new Date(`${yesterday}T00:00:00`).toLocaleDateString("th-TH", { weekday: "short", day: "numeric", month: "short" });
  if (!shown.length && !showKitchen) return <p className="rounded-2xl border border-border bg-card p-6 text-center text-muted-foreground">บัญชีนี้ยังไม่ได้ตั้งสาขา ติดต่อผู้ดูแลระบบ</p>;

  // `kitchen`: the kitchen card's own jobs, which readOnly (branch pages) doesn't stop
  const Row = ({ ok, warn, text, sub, action, tab, kitchen: own }: { ok: boolean; warn?: boolean; text: string; sub?: string; action?: string; tab?: TabKey; kitchen?: boolean }) => (
    <div className="flex items-center gap-3 border-t border-border px-4 py-3">
      <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold", ok ? "bg-success-soft text-success" : warn ? "bg-warning-soft text-warning" : "bg-destructive/10 text-destructive")}>{ok ? "✓" : "!"}</span>
      <span className="min-w-0 flex-1">
        <span className="block break-words">{text}</span>
        {sub && <span className="block break-words text-sm text-muted-foreground">{sub}</span>}
      </span>
      {!ok && action && tab && (!readOnly || own) && (
        <Button variant="outline" className="h-10 shrink-0" onClick={() => onNavigate(tab)}>
          {action}
        </Button>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold">{isStoreManager ? `วันนี้ · ${shown[0].branchName}` : "วันนี้"}</h1>
        <p className="text-sm text-muted-foreground">
          {now.toLocaleDateString("th-TH", { weekday: "long", day: "numeric", month: "long" })} · {showKitchen ? "งานของครัวกลางและทุกสาขา" : "งานของแต่ละสาขา"} แตะเพื่อไปทำต่อ
        </p>
      </div>
      {(error || kError) && <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">โหลดข้อมูลไม่สำเร็จ ลองใหม่อีกครั้ง</p>}
      {showKitchen && (
        <section className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <h2 className="text-lg font-bold">ครัวกลาง</h2>
            <Button variant="ghost" className="h-10 text-brand" onClick={() => onNavigate("dashboard")}>
              ภาพรวมครัวกลาง
            </Button>
          </div>
          {kError ? null : !kDay ? (
            <div className="space-y-2 px-4 pb-4">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-10 animate-pulse rounded-xl bg-secondary" />
              ))}
            </div>
          ) : (
            <>
              <Row ok text={`วันนี้รับของจาก ${kDay.suppliers} ซัพพลายเออร์ · ผลิต ${kDay.runs} รอบ`} />
              <Row ok={kDay.requests === 0} warn text={kDay.requests ? `ใบขอเบิกรอทำใบโอน ${kDay.requests} ใบ` : "ไม่มีใบขอเบิกรอทำใบโอน"} action="ทำใบโอน" tab="transfer-order" kitchen />
              <Row ok={kDay.sent === 0} warn text={kDay.sent ? `ใบโอนส่งแล้ว สาขายังไม่กดรับ ${kDay.sent} ใบ` : "ไม่มีใบโอนที่สาขายังไม่รับ"} />
              {kDay.monthEnd && (
                <Row
                  ok={kDay.monthEnd.done}
                  warn
                  text={kDay.monthEnd.done ? `นับสต๊อกครัวปลายเดือนแล้ว` : `นับสต๊อกครัวปลายเดือน ${kDay.monthEnd.date === today ? "วันนี้" : kDay.monthEnd.date > today ? "พรุ่งนี้" : "ยังไม่ได้นับ"} · ${shortDate(kDay.monthEnd.date)}`}
                  sub={kDay.monthEnd.done ? "นับครบพอคิดต้นทุนไหม ดูที่ภาพรวมครัวกลาง" : "ต้องนับก่อน ถึงจะเห็นต้นทุนจริงของเดือน"}
                  action="ไปนับ"
                  tab="stockcount"
                  kitchen
                />
              )}
            </>
          )}
        </section>
      )}
      <div className={cn("grid gap-4", shown.length > 1 && "lg:grid-cols-2")}>
        {shown.map((b) => {
          const d = days?.[b.id];
          return (
            <section key={b.id} className="overflow-hidden rounded-2xl border border-border bg-card">
              <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">
                <h2 className="text-lg font-bold">{b.branchName}</h2>
                {d && (
                  <span className="text-sm text-muted-foreground">
                    เดือนนี้ <b className="font-mono text-foreground">{baht(d.salesMonth)}</b>
                  </span>
                )}
              </div>
              {!d ? (
                <div className="space-y-2 px-4 pb-4">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="h-10 animate-pulse rounded-xl bg-secondary" />
                  ))}
                </div>
              ) : (
                <>
                  <Row ok={d.salesYesterday !== null} text={d.salesYesterday !== null ? `ยอดขาย ${yLabel} นำเข้าแล้ว · ${baht(d.salesYesterday)}` : `ยอดขาย ${yLabel} ยังไม่นำเข้า`} sub={d.salesYesterday === null ? "นำเข้าก่อนนับสต๊อก ไม่งั้นยอดคงเหลือจะไม่ถูก" : undefined} action="ไปนำเข้า" tab="sales-entry" />
                  <Row
                    ok={d.countYesterday === "done"}
                    warn={d.countYesterday === "open"}
                    text={d.countYesterday === "done" ? `นับสต๊อก ${yLabel} กดนับเสร็จแล้ว` : d.countYesterday === "open" ? `นับสต๊อก ${yLabel} แล้ว ยังไม่กดนับเสร็จ` : `ยังไม่ได้นับสต๊อก ${yLabel}`}
                    action="ไปนับ"
                    tab="daily-stock-count"
                  />
                  <Row ok={d.toReceive === 0} warn text={d.toReceive ? `ใบโอนจากครัวกลางรอรับ ${d.toReceive} ใบ` : "ไม่มีใบโอนรอรับ"} sub={d.toReceive ? "ของมาถึงแล้วกดรับ ยอดสต๊อกจะได้ถูก" : undefined} action="ไปรับของ" tab="branch-receipt" />
                  <Row
                    ok={d.low.length === 0}
                    text={d.low.length ? `ใกล้หมด ${d.low.length} รายการ` : "ไม่มีของใกล้หมด"}
                    sub={d.low.length ? d.low.slice(0, 3).map((x) => `${x.name} ${x.days.toFixed(1)} วัน`).join(" · ") + (d.low.length > 3 ? " · …" : "") : undefined}
                    action="ไปขอเบิก"
                    tab="transfer-request"
                  />
                </>
              )}
            </section>
          );
        })}
      </div>
      {shown.length > 0 && <MonthCalendar branches={shown} today={businessDate(now)} load={calendarLoad} canOpen={canOpenDays} />}
      <p className="text-xs text-muted-foreground">ใกล้หมด = ยอดนับล่าสุด ÷ ที่ใช้ในวันนั้น ไม่ถึง {LOW_DAYS} วัน · ดูทั้งหมดที่หน้าสต๊อกสาขา</p>
    </div>
  );
}
