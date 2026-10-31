import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetch-all";
import { isoDate } from "@/lib/stock-count";

export interface OpenDay {
  date: string;
  counted: number;
  total: number;
}

export interface CountStatus {
  /** Sales rows saved for the count day (0 = not imported yet) */
  salesLines: number;
  /** Receipts saved for the count day */
  receipts: number;
  /** Transfer orders sent by the kitchen and not yet received */
  waitingTransfers: number;
  /**
   * Earlier sheets not finished (newest first), last 7 days: older ones are history.
   * A sheet opened with nothing typed in (no count, no waste) isn't one: it doesn't
   * hold up today and isn't touched (not deleted: a phone counting offline may still
   * send its figures to it)
   */
  openDays: OpenDay[];
  /** Whether the count day's own sheet is finished */
  todayFinished: boolean;
}

const EMPTY: CountStatus = { salesLines: 0, receipts: 0, waitingTransfers: 0, openDays: [], todayFinished: false };

/** What to check before counting, and which earlier days were never finished */
export function useCountStatus(branchId: string | null, date: string) {
  const [status, setStatus] = useState<CountStatus>(EMPTY);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    const from = new Date(`${date}T00:00:00`);
    from.setDate(from.getDate() - 7);
    const fromIso = isoDate(from);
    const head = { count: "exact" as const, head: true };
    const [sales, receipts, tos, sheets] = await Promise.all([
      supabase.from("sales_entries").select("id", head).eq("branch_id", branchId).eq("sale_date", date),
      supabase.from("branch_receipts").select("id", head).eq("branch_id", branchId).eq("receipt_date", date),
      supabase.from("transfer_orders").select("id", head).eq("branch_id", branchId).eq("status", "Sent"),
      fetchAllRows((a, b) =>
        supabase
          .from("daily_stock_counts")
          .select("id, count_date, physical_count, waste, is_submitted")
          .eq("branch_id", branchId)
          .gte("count_date", fromIso)
          .lte("count_date", date)
          .order("id")
          .range(a, b),
      ),
    ]);
    const byDay = new Map<string, OpenDay & { finished: boolean; typed: boolean }>();
    for (const r of sheets.data as { count_date: string; physical_count: number | null; waste: number | null; is_submitted: boolean }[]) {
      const d = byDay.get(r.count_date) ?? { date: r.count_date, counted: 0, total: 0, finished: true, typed: false };
      d.total++;
      if (r.physical_count !== null) d.counted++;
      if (r.physical_count !== null || Number(r.waste) > 0) d.typed = true;
      if (!r.is_submitted) d.finished = false;
      byDay.set(r.count_date, d);
    }
    setStatus({
      salesLines: sales.count ?? 0,
      receipts: receipts.count ?? 0,
      waitingTransfers: tos.count ?? 0,
      openDays: [...byDay.values()]
        .filter((d) => !d.finished && d.typed && d.date < date)
        .sort((a, b) => b.date.localeCompare(a.date))
        .map(({ date: dd, counted, total }) => ({ date: dd, counted, total })),
      todayFinished: byDay.get(date)?.finished ?? false,
    });
    setLoading(false);
  }, [branchId, date]);

  useEffect(() => {
    load();
  }, [load]);

  return { status, loading, reload: load };
}
