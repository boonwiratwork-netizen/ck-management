import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { fetchAllRows } from "@/lib/fetch-all";
import { toLocalDateStr, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { Branch } from "@/types/branch";
import type { TabKey } from "@/components/AppSidebar";

interface Props {
  branches: Branch[];
  onNavigate: (tab: TabKey) => void;
  /** Area managers look; they don't get "go do it" buttons */
  readOnly?: boolean;
  /** Dev demo only */
  load?: (branchIds: string[], today: string, yesterday: string, monthStart: string) => Promise<Record<string, BranchDay>>;
}

/** What one branch has done for its day */
export interface BranchDay {
  salesYesterday: number | null;
  salesMonth: number;
  /** Yesterday's count sheet: finished / started but not finished / not started */
  countYesterday: "done" | "open" | "none";
  toReceive: number;
  /** Items with less than 2 days left at the latest finished count */
  low: { name: string; days: number }[];
}

const LOW_DAYS = 2;
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
    // Latest finished sheet: days left = counted ÷ that day's expected use
    const finished = counts.filter((c) => c.branch_id === b && c.is_submitted && c.physical_count !== null);
    const lastDate = finished.reduce<string | null>((m, c) => (!m || c.count_date > m ? c.count_date : m), null);
    const low = finished
      .filter((c) => c.count_date === lastDate && Number(c.physical_count) > 0 && Number(c.expected_usage) > 0)
      .map((c) => ({ name: name.get(c.sku_id) ?? "", days: Number(c.physical_count) / Number(c.expected_usage) }))
      .filter((x) => x.days < LOW_DAYS)
      .sort((x, y) => x.days - y.days);
    out[b] = {
      salesYesterday: yRows.length ? yRows.reduce((t, s) => t + (Number(s.net_amount) || 0), 0) : null,
      salesMonth: bs.reduce((t, s) => t + (Number(s.net_amount) || 0), 0),
      countYesterday: !cy.length ? "none" : cy.every((c) => c.is_submitted) ? "done" : "open",
      toReceive: (tos.data ?? []).filter((t) => t.branch_id === b).length,
      low,
    };
  }
  return out;
}

/**
 * The branch's day at a glance — the store manager's first screen: has
 * yesterday's sales come in, was yesterday counted, anything to receive,
 * anything running out. Each open job is one tap from the page that does it.
 * Management and area managers see every branch they look after.
 */
export default function StoreOverview({ branches, onNavigate, readOnly, load = loadDays }: Props) {
  const { profile, isStoreManager } = useAuth();
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
  if (!shown.length) return <p className="rounded-2xl border border-border bg-card p-6 text-center text-muted-foreground">บัญชีนี้ยังไม่ได้ตั้งสาขา ติดต่อผู้ดูแลระบบ</p>;

  const Row = ({ ok, warn, text, sub, action, tab }: { ok: boolean; warn?: boolean; text: string; sub?: string; action?: string; tab?: TabKey }) => (
    <div className="flex items-center gap-3 border-t border-border px-4 py-3">
      <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold", ok ? "bg-success-soft text-success" : warn ? "bg-warning-soft text-warning" : "bg-destructive/10 text-destructive")}>{ok ? "✓" : "!"}</span>
      <span className="min-w-0 flex-1">
        <span className="block break-words">{text}</span>
        {sub && <span className="block break-words text-sm text-muted-foreground">{sub}</span>}
      </span>
      {!ok && action && tab && !readOnly && (
        <Button variant="outline" className="h-10 shrink-0" onClick={() => onNavigate(tab)}>
          {action}
        </Button>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold">{isStoreManager ? `วันนี้ · ${shown[0].branchName}` : "ภาพรวมสาขา"}</h1>
        <p className="text-sm text-muted-foreground">{now.toLocaleDateString("th-TH", { weekday: "long", day: "numeric", month: "long" })} · งานของแต่ละสาขา แตะเพื่อไปทำต่อ</p>
      </div>
      {error && <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">โหลดข้อมูลไม่สำเร็จ ลองใหม่อีกครั้ง</p>}
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
                    text={d.countYesterday === "done" ? `นับสต๊อก ${yLabel} กดนับเสร็จแล้ว` : d.countYesterday === "open" ? `นับสต๊อก ${yLabel} ยังไม่กดนับเสร็จ` : `ยังไม่ได้นับสต๊อก ${yLabel}`}
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
      <p className="text-xs text-muted-foreground">ใกล้หมด = ยอดนับล่าสุด ÷ ที่ใช้ในวันนั้น ไม่ถึง {LOW_DAYS} วัน · ดูทั้งหมดที่หน้าสต๊อกสาขา</p>
    </div>
  );
}
