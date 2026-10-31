import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetch-all";
import { loadUsageContext, usageOf, type UsageSaleRow } from "@/lib/usage-context-db";
import { branchBalances, latestCounts, type AdjustmentMove, type AnchorRow, type ReceiptMove, type WasteRow } from "@/lib/branch-stock";
import type { SKU } from "@/types/sku";
import { toLocalDateStr } from "@/lib/utils";

export interface BranchStockRow {
  sku: SKU;
  balance: number;
  countDate: string | null;
  /** Average per selling day over the last 7 days, waste included (CLAUDE.md avgDailyUsage) */
  dailyUse: number;
  /** balance ÷ dailyUse; null when nothing is used */
  daysLeft: number | null;
  price: number;
  value: number;
}

/** Where the rows come from (the database; the dev demo passes its own) */
export interface BranchStockLoader {
  load(branchId: string, today: string): Promise<{
    counts: AnchorRow[];
    receipts: ReceiptMove[];
    adjustments: AdjustmentMove[];
    waste: WasteRow[];
    /** Sales usage per SKU per day since the oldest count, and over the last 7 days */
    usageByDay: Record<string, Record<string, number>>;
    sellingDays: number;
    prices: Map<string, number>;
  }>;
}

const shift = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toLocalDateStr(d);
};

export const supabaseBranchStockLoader: BranchStockLoader = {
  async load(branchId, today) {
    const all = <T,>(build: (a: number, b: number) => unknown) => fetchAllRows<T>(build as never).then((r) => r.data);
    // Every count typed in, finished or not: the count sheet, requests to the kitchen and
    // the other stock hooks read it this way (a "finished only" rule here, 30–31 Oct
    // 2026, showed Thaniya a different balance from its own count and request pages)
    const counts = await all<AnchorRow>((a, b) =>
      supabase.from("daily_stock_counts").select("id, sku_id, count_date, physical_count").eq("branch_id", branchId).not("physical_count", "is", null).lte("count_date", today).order("id").range(a, b),
    );
    const anchors = latestCounts(counts);
    // Everything after the oldest latest-count (a SKU never counted reads from the start)
    const since = anchors.size ? [...anchors.values()].reduce((m, x) => (x.date < m ? x.date : m), today) : "2020-01-01";
    const weekAgo = shift(today, -6);
    const from = since < weekAgo ? since : weekAgo;
    const [receipts, adjustments, waste, sales, ctx, priceRows] = await Promise.all([
      all<ReceiptMove>((a, b) => supabase.from("branch_receipts").select("id, sku_id, receipt_date, qty_received, transfer_order_id").eq("branch_id", branchId).gte("receipt_date", since).lte("receipt_date", today).order("id").range(a, b)),
      all<AdjustmentMove>((a, b) => supabase.from("stock_adjustments").select("id, sku_id, adjustment_date, quantity, reason").eq("branch_id", branchId).gte("adjustment_date", since).lte("adjustment_date", today).order("id").range(a, b)),
      all<WasteRow>((a, b) => supabase.from("daily_stock_counts").select("id, sku_id, count_date, waste").eq("branch_id", branchId).gt("waste", 0).gte("count_date", from).lte("count_date", today).order("id").range(a, b)),
      all<UsageSaleRow>((a, b) => supabase.from("sales_entries").select("id, sale_date, menu_code, menu_name, qty").eq("branch_id", branchId).gte("sale_date", from).lte("sale_date", today).order("id").range(a, b)),
      loadUsageContext(),
      all<{ sku_id: string; price_per_usage_uom: number }>((a, b) => supabase.from("prices").select("id, sku_id, price_per_usage_uom, created_at").eq("is_active", true).order("created_at", { ascending: false }).order("id").range(a, b)),
    ]);
    const prices = new Map<string, number>();
    for (const p of priceRows) if (!prices.has(p.sku_id)) prices.set(p.sku_id, Number(p.price_per_usage_uom) || 0);
    const usage = usageOf(ctx, sales, branchId, null);
    const sellingDays = new Set(sales.filter((s) => s.sale_date >= weekAgo).map((s) => s.sale_date)).size;
    return { counts, receipts, adjustments, waste, usageByDay: usage.byDay, sellingDays, prices };
  },
};

/** One branch's stock: balance per item, daily use over the last week, days left */
export function useBranchStock(branchId: string | null, skus: SKU[], loader: BranchStockLoader = supabaseBranchStockLoader) {
  const [rows, setRows] = useState<BranchStockRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!branchId || !skus.length) {
      setRows(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const today = toLocalDateStr(new Date());
    loader
      .load(branchId, today)
      .then((d) => {
        if (cancelled) return;
        const byId = new Map(skus.map((s) => [s.id, s]));
        const conv = (id: string) => {
          const s = byId.get(id);
          return s && s.purchaseUom !== s.usageUom ? s.converter || 1 : 1;
        };
        const ids = new Set<string>();
        for (const r of [...d.counts, ...d.receipts, ...d.adjustments]) ids.add(r.sku_id);
        for (const id of Object.keys(d.usageByDay)) ids.add(id);
        const bal = branchBalances({ skuIds: [...ids], counts: d.counts, receipts: d.receipts, adjustments: d.adjustments, waste: d.waste, usageByDay: d.usageByDay, converter: conv });
        const weekAgo = shift(today, -6);
        const out: BranchStockRow[] = [];
        for (const [id, b] of bal) {
          const sku = byId.get(id);
          // Branch stock is ingredients and kitchen-made items; packaging and SP mixes aren't counted here
          if (!sku || (sku.type !== "RM" && sku.type !== "SM")) continue;
          const used = Object.entries(d.usageByDay[id] ?? {}).reduce((t, [day, q]) => (day >= weekAgo ? t + q : t), 0);
          const wasted = d.waste.filter((w) => w.sku_id === id && w.count_date >= weekAgo).reduce((t, w) => t + (Number(w.waste) || 0), 0);
          const dailyUse = d.sellingDays > 0 ? (used + wasted) / d.sellingDays : 0;
          const price = d.prices.get(id) ?? 0;
          out.push({ sku, balance: b.balance, countDate: b.countDate, dailyUse, daysLeft: dailyUse > 0 ? Math.max(0, b.balance) / dailyUse : null, price, value: Math.max(0, b.balance) * price });
        }
        setRows(out);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError("โหลดสต๊อกสาขาไม่สำเร็จ ลองใหม่อีกครั้ง");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [branchId, skus, loader, tick]);

  return { rows, loading, error, reload };
}
