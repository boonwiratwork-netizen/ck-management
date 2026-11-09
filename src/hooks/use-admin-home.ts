import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRowsOrThrow } from "@/lib/fetch-all";
import { perBranchRows } from "@/lib/per-branch";
import { bangkokDate, shiftDay } from "@/lib/day-follow";
import { lastSeen, sharedRead, useKeepLastSeen, USAGE_TABLES } from "@/lib/page-cache";
import { supabaseLoader as foodCostLoader } from "@/hooks/use-food-cost";
import { ckMonthGaps, type CkMonthGap } from "@/hooks/use-ck-production";
import { buildView, costMonthsFor, prepare, readFromFor, type AdminMasters, type AdminRaw, type AdminView } from "@/lib/admin-home";
import { monthStartOf, weekStartOf, type PeriodKind } from "@/lib/team-score";

/**
 * Rows behind หน้าแรกผู้บริหาร, read once for all three periods (วันนี้/สัปดาห์/เดือน switch
 * without reading again):
 *
 * - wave 1, side by side: sales and count sheets per branch (perBranchRows), transfer
 *   orders, their branch receipts, the kitchen's plan, production, supplier bills, count
 *   price and recipe history, usage corrections
 * - wave 2: the lines of the transfer orders found (by id, chunked, side by side)
 *
 * The kitchen's month cost (ckMonthGaps) is read on its own, beside these, and fills its
 * cell and นับครัวปิดเดือน (judged by that same read, so the kitchen page agrees) when done. A revisit shows the kept copy at once and reads again behind it.
 */

export const ADMIN_TABLES = [
  "sales_entries",
  "daily_stock_counts",
  "transfer_orders",
  "transfer_order_lines",
  "branch_receipts",
  "weekly_plan_lines",
  "production_records",
  "goods_receipts",
  "price_history",
  "prices",
  "usage_corrections",
  ...USAGE_TABLES,
];

export interface AdminLoader {
  load(branchIds: string[], today: string, readFrom: string): Promise<Omit<AdminRaw, "today" | "nowMs" | "readFrom">>;
  costGaps(months: string[]): Promise<CkMonthGap[]>;
}

const chunks = <T>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
const must = <T>(r: { data: T[] | null; error: unknown }): T[] => {
  if (r.error) throw r.error;
  return r.data ?? [];
};

export const supabaseAdminLoader: AdminLoader = {
  async load(branchIds, today, readFrom) {
    const ids = branchIds.length ? branchIds : ["00000000-0000-0000-0000-000000000000"];
    const [sales, counts, tos, receipts, plans, production, bills, priceChanges, recipeCopies, corrections] = await Promise.all([
      perBranchRows<AdminRaw["sales"][number]>(ids, (id, a, b) =>
        supabase.from("sales_entries").select("id, branch_id, sale_date, created_at, net_amount, menu_code, menu_name, qty, receipt_no, order_type, channel").eq("branch_id", id).gte("sale_date", readFrom).lte("sale_date", today).order("id").range(a, b) as never,
      ),
      perBranchRows<AdminRaw["counts"][number]>(ids, (id, a, b) =>
        supabase.from("daily_stock_counts").select("id, branch_id, count_date, sku_id, physical_count, variance, waste, expected_usage, is_submitted, submitted_at").eq("branch_id", id).gte("count_date", readFrom).lte("count_date", today).order("id").range(a, b) as never,
      ),
      // Orders due in the window, and any still waiting to be received (an old one is a ต้องดู)
      fetchAllRowsOrThrow<AdminRaw["tos"][number]>((a, b) =>
        supabase.from("transfer_orders").select("id, branch_id, to_number, status, sent_at, delivery_date, total_value").or(`delivery_date.gte.${readFrom},status.eq.Sent`).order("id").range(a, b) as never,
      ),
      fetchAllRowsOrThrow<AdminRaw["receipts"][number]>((a, b) =>
        supabase.from("branch_receipts").select("id, transfer_order_id, created_at").not("transfer_order_id", "is", null).gte("receipt_date", shiftDay(readFrom, -7)).order("id").range(a, b) as never,
      ),
      fetchAllRowsOrThrow<AdminRaw["plans"][number]>((a, b) => supabase.from("weekly_plan_lines").select("id, week_start, sku_id, planned_qty_uom").gte("week_start", weekStartOf(readFrom)).order("id").range(a, b) as never),
      fetchAllRowsOrThrow<AdminRaw["production"][number]>((a, b) => supabase.from("production_records").select("id, sm_sku_id, production_date, actual_output_g").gte("production_date", readFrom).order("id").range(a, b) as never),
      fetchAllRowsOrThrow<{ supplier_id: string; receipt_date: string; created_at: string }>((a, b) => supabase.from("goods_receipts").select("id, supplier_id, receipt_date, created_at").gte("receipt_date", readFrom).order("id").range(a, b) as never),
      foodCostLoader.priceHistory!(),
      foodCostLoader.recipeHistory!(),
      foodCostLoader.corrections(ids, monthStartOf(shiftDay(monthStartOf(today), -1)), today),
    ]);

    // Wave 2: lines of the orders sent in the window (the request lines are what "sent in full" is about)
    const sentIds = tos.filter((t) => t.sent_at && t.status !== "Draft" && t.sent_at.slice(0, 10) >= shiftDay(readFrom, -1)).map((t) => t.id);
    const lineParts = await Promise.all(
      chunks(sentIds, 150).map((part) =>
        fetchAllRowsOrThrow<AdminRaw["toLines"][number]>((a, b) =>
          supabase.from("transfer_order_lines").select("id, to_id, sku_id, tr_line_id, planned_qty, actual_qty, packs_count, unit_cost, uom").in("to_id", part).order("id").range(a, b) as never,
        ),
      ),
    );

    // A supplier bill = the rows of one supplier on one receipt day; its time = the first row saved
    const billMap = new Map<string, { supplier_id: string; receipt_date: string; created_at: string }>();
    for (const r of bills) {
      const k = `${r.supplier_id}|${r.receipt_date}`;
      const had = billMap.get(k);
      if (!had || Date.parse(r.created_at) < Date.parse(had.created_at)) billMap.set(k, { ...r });
    }
    return {
      sales,
      counts: counts.map((c) => ({ ...c, physical_count: c.physical_count === null ? null : Number(c.physical_count), variance: Number(c.variance) || 0, waste: Number(c.waste) || 0, expected_usage: Number(c.expected_usage) || 0 })),
      tos,
      toLines: lineParts.flat(),
      receipts,
      plans,
      production,
      bills: [...billMap.values()],
      priceChanges,
      recipeCopies,
      corrections,
    };
  },
  costGaps: (months) => ckMonthGaps(months),
};

/** The kitchen's month costs change only when a closed month's data does: one read per 30 min per set of months */
const COST_TABLES = ["goods_receipts", "production_records", "stock_count_sessions", "stock_count_lines", "price_history", "prices", "bom_headers", "bom_lines", "bom_steps", "deliveries", "transfer_order_lines"];

export function useAdminHome(masters: AdminMasters, period: PeriodKind, loader: AdminLoader = supabaseAdminLoader, opts?: { today?: string; nowMs?: number }) {
  const today = opts?.today ?? bangkokDate();
  const branchIds = useMemo(
    () => masters.branches.filter((b) => b.status === "Active").map((b) => b.id).sort(),
    [masters.branches],
  );
  const cached = loader === supabaseAdminLoader;
  const key = branchIds.length ? `admin-home|${branchIds.join(",")}|${today}` : null;
  const [raw, setRaw] = useState<{ for: string; value: AdminRaw } | null>(() => {
    const seen = cached ? lastSeen<AdminRaw>(key) : null;
    return seen && key ? { for: key, value: seen.value } : null;
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [tick, setTick] = useState(0);
  const [gaps, setGaps] = useState<Map<string, { pct: number | null; why?: string }>>(new Map());
  useKeepLastSeen(cached && raw ? raw.for : null, ADMIN_TABLES, raw?.value);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    setLoading(true);
    setError(false);
    setRaw((r) => {
      if (r?.for === key) return r;
      const seen = cached ? lastSeen<AdminRaw>(key) : null;
      return seen ? { for: key, value: seen.value } : null;
    });
    const readFrom = readFromFor(today);
    loader
      .load(branchIds, today, readFrom)
      .then((d) => !cancelled && setRaw({ for: key, value: { ...d, today, readFrom, nowMs: opts?.nowMs ?? Date.now() } }))
      .catch(() => !cancelled && setError(true))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [key, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;
    const months = costMonthsFor(today);
    const read = () => loader.costGaps(months);
    (cached ? sharedRead(`ck-month-gaps|${months.join(",")}`, COST_TABLES, read, 30 * 60_000) : read())
      .then((list) => !cancelled && setGaps(new Map(list.map((g) => [g.month, { pct: g.pct, why: g.why, count: g.count }]))))
      .catch(() => !cancelled && setGaps(new Map(months.map((m) => [m, { pct: null, why: "อ่านต้นทุนครัวไม่สำเร็จ", count: undefined }]))));
    return () => {
      cancelled = true;
    };
  }, [today, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = raw && raw.for === key ? raw.value : null;
  // Held until products and prices are in: a missing price read must never price things at ฿0
  const mastersReady = masters.prices.length > 0 && masters.skus.length > 0;
  const prepared = useMemo(
    () => (shown && mastersReady ? prepare(shown, masters) : null),
    // The masters' arrays, not the wrapper object (a new one every render)
    [shown, mastersReady, masters.skus, masters.prices, masters.menus, masters.menuBomLines, masters.modifierRules, masters.spBomLines, masters.branches], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const view = useMemo<AdminView | null>(() => (prepared ? buildView(prepared, period, gaps) : null), [prepared, period, gaps]);
  const retry = useCallback(() => setTick((t) => t + 1), []);

  return { view, loading: loading || (!!shown && !mastersReady), error, refreshing: loading && !!view, retry, noBranches: branchIds.length === 0 };
}
