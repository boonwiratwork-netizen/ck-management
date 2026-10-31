import { useState, useEffect, useCallback, useMemo } from "react";
import { SKU } from "@/types/sku";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetch-all";
import { loadUsageContext } from "@/lib/usage-context-db";
import { branchUsePerDay, dailyUseWindow, totalPerDay, type BranchSaleRow, type BranchWasteRow } from "@/lib/daily-use";
import type { UsageContext } from "@/lib/sale-usage";
import { toLocalDateStr } from "@/lib/utils";

/**
 * Sales-based daily SM SKU usage, counted the same way as Food Cost (branch recipe
 * lines, SP expansion, modifier rules incl. toppings and set items) plus waste typed on
 * the count sheet, over the shared 7-day window (Bangkok dates), ÷ each branch's selling
 * days (CLAUDE.md avgDailyUsage, lib/daily-use.ts). Until Nov 2026 this divided by the
 * days each item happened to be used (an item used 2 days of 7 read 3.5× too high), left
 * waste out and started the week on the UTC date.
 * Shared between Kitchen Stock (cover day), Production (daily need) and the production
 * plan helper (use-planning-agent.ts).
 */
export interface SmUseRead {
  ctx: UsageContext;
  /** The window's sales, every branch */
  sales: BranchSaleRow[];
  /** branch → SM item → used per day */
  perDay: Map<string, Record<string, number>>;
  /** branch → days in the window it sold anything */
  sellingDays: Map<string, number>;
}

export async function loadSmUse(today: string): Promise<SmUseRead> {
  const window = dailyUseWindow(today);
  // A failed page fails the read (no silently short week)
  const all = <T,>(build: (a: number, b: number) => unknown) =>
    fetchAllRows<T>(build as never).then((r) => {
      if (r.error) throw r.error;
      return r.data;
    });
  const [sales, waste, ctx] = await Promise.all([
    all<BranchSaleRow>((a, b) => supabase.from("sales_entries").select("id, branch_id, sale_date, menu_code, menu_name, qty").gte("sale_date", window.from).lte("sale_date", window.to).order("id").range(a, b)),
    all<BranchWasteRow>((a, b) => supabase.from("daily_stock_counts").select("id, branch_id, sku_id, count_date, waste").gt("waste", 0).gte("count_date", window.from).lte("count_date", window.to).order("id").range(a, b)),
    loadUsageContext(),
  ]);
  const smIds = new Set([...ctx.skuType].filter(([, t]) => t === "SM").map(([id]) => id));
  const { perDay, sellingDays } = branchUsePerDay({ ctx, sales, waste, skuIds: smIds, window });
  return { ctx, sales, perDay, sellingDays };
}

export interface SmDailyUse {
  /** SM item → used per day, every branch together */
  perDay: Record<string, number>;
  /** The whole read, for the production plan helper (one read for both) */
  read: SmUseRead | null;
  /** The read failed: cover days and daily need are unknown, not 0 (the last good read stays) */
  error: boolean;
  reload: () => void;
}

export function useSmDailyUsage(skus: SKU[], enabled = true): SmDailyUse {
  const [read, setRead] = useState<SmUseRead | null>(null);
  const [error, setError] = useState(false);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    // Reads a week of sales; only kitchen pages need it (see Index)
    if (!enabled || skus.length === 0) return;
    let cancelled = false;
    setError(false);
    loadSmUse(toLocalDateStr(new Date()))
      .then((r) => {
        if (!cancelled) setRead(r);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [skus, enabled, tick]);

  const perDay = useMemo(() => (read ? totalPerDay(read.perDay) : {}), [read]);
  return { perDay, read, error, reload };
}
