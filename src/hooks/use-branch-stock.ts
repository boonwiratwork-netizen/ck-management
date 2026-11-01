import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRowsOrThrow } from "@/lib/fetch-all";
import { loadUsageContext, usageOf, type UsageSaleRow } from "@/lib/usage-context-db";
import { anchorWindow, branchFigures, pickAnchors, receiptConverter, usageReadFrom, type AdjustmentMove, type AnchorRow, type ReceiptMove, type SheetCountRow, type WasteRow } from "@/lib/branch-stock";
import type { UsageContext } from "@/lib/sale-usage";
import { dailyUseWindow, sellingDays } from "@/lib/daily-use";
import type { SKU } from "@/types/sku";
import { toLocalDateStr } from "@/lib/utils";
import { businessDate } from "@/lib/stock-count";
import { USAGE_TABLES, lastSeen, useKeepLastSeen } from "@/lib/page-cache";

/** What a branch's stock is worked out from: a write to any drops the kept copy (lib/page-cache.ts) */
export const BRANCH_STOCK_TABLES = ["daily_stock_counts", "branch_receipts", "stock_adjustments", "sales_entries", "prices", ...USAGE_TABLES];

export interface BranchStockRow {
  sku: SKU;
  balance: number;
  /**
   * False: on no count sheet in the last 5 weeks, so what's there isn't known — not the
   * receipts of 5 weeks with nothing used (balance then only says what came in)
   */
  known: boolean;
  countDate: string | null;
  /** Average per selling day over the last 7 days, waste included (CLAUDE.md avgDailyUsage) */
  dailyUse: number;
  /** balance ÷ dailyUse; null when nothing is used */
  daysLeft: number | null;
  price: number;
  value: number;
}

/** What one branch's stock is worked out from (branchFigures) */
export interface BranchStockData {
  /** One anchor per product (pickAnchors: typed count, else a sheet's system figure) */
  counts: AnchorRow[];
  receipts: ReceiptMove[];
  adjustments: AdjustmentMove[];
  waste: WasteRow[];
  /** Sales usage per SKU per day since the oldest anchor, and over the last 7 days */
  usageByDay: Record<string, Record<string, number>>;
  sellingDays: number;
  prices: Map<string, number>;
  /** First day of the anchor window: a product with no anchor takes only what came in from then */
  unanchoredFrom?: string;
}

/** Where the rows come from (the database; the dev demo passes its own). `products`: only these are worked out */
export interface BranchStockLoader {
  load(branchId: string, today: string, products?: Set<string> | null): Promise<BranchStockData>;
}

/** The parts every list on a page shares: the count rows of the anchor window and the recipes */
export interface SharedBranchRead {
  rows: Promise<SheetCountRow[]>;
  ctx: Promise<UsageContext>;
}
const started = new Map<string, SharedBranchRead>();
/**
 * Started once per branch and day while under way: the request page's kitchen-made and
 * raw-material lists ask together. Nothing is kept once it's done (a count typed a minute
 * later must show on the next open).
 */
export function sharedBranchRead(branchId: string, today: string): SharedBranchRead {
  const key = `${branchId}|${today}`;
  let r = started.get(key);
  if (!r) {
    const window = anchorWindow(today);
    r = {
      // The count sheet's 5 weeks of rows, typed or not (it used to read every count ever)
      rows: fetchAllRowsOrThrow<SheetCountRow>((a, b) =>
        supabase.from("daily_stock_counts").select("id, sku_id, count_date, physical_count, calculated_balance").eq("branch_id", branchId).gte("count_date", window.from).lte("count_date", today).order("id").range(a, b) as never,
      ),
      ctx: loadUsageContext(),
    };
    started.set(key, r);
    const done = r;
    Promise.allSettled([done.rows, done.ctx]).then(() => started.get(key) === done && started.delete(key));
  }
  return r;
}

/** The read itself; `shared` from sharedBranchRead when several lists ask at once. `prices`: false = not read (the request page doesn't value stock) */
export async function loadBranchStock(branchId: string, today: string, products: Set<string> | null = null, shared: SharedBranchRead = sharedBranchRead(branchId, today), opts: { prices?: boolean } = {}): Promise<BranchStockData> {
  // A page that fails fails the read: partial rows would show (and order from) a wrong balance
  const all = <T,>(build: (a: number, b: number) => unknown) => fetchAllRowsOrThrow<T>(build as never);
  const window = anchorWindow(today);
  // Receipts, moves and prices don't depend on the counts: asked for now, alongside them (one
  // round trip less on every open and after every save)
  const receiptsP = all<ReceiptMove>((a, b) => supabase.from("branch_receipts").select("id, sku_id, receipt_date, qty_received, transfer_order_id").eq("branch_id", branchId).gte("receipt_date", window.from).lte("receipt_date", today).order("id").range(a, b));
  const adjustmentsP = all<AdjustmentMove>((a, b) => supabase.from("stock_adjustments").select("id, sku_id, adjustment_date, quantity, reason").eq("branch_id", branchId).gte("adjustment_date", window.from).lte("adjustment_date", today).order("id").range(a, b));
  const pricesP = opts.prices === false ? Promise.resolve([] as { sku_id: string; price_per_usage_uom: number }[]) : all<{ sku_id: string; price_per_usage_uom: number }>((a, b) => supabase.from("prices").select("id, sku_id, price_per_usage_uom, created_at").eq("is_active", true).order("created_at", { ascending: false }).order("id").range(a, b));
  // Not left unhandled if the counts fail first (the await below rethrows them)
  for (const p of [receiptsP, adjustmentsP, pricesP]) p.catch(() => undefined);
  // Today's untyped rows aren't anchors: their figure predates today's sales. "Today" is
  // the count day (before 05:00 it's still yesterday's sheet), as the count page has it
  const countDay = businessDate(new Date());
  const anchors = pickAnchors(await shared.rows, countDay < today ? countDay : today).filter((a) => !products || products.has(a.sku_id));
  // Sales and waste from the oldest anchor of the products asked for (one discontinued item
  // elsewhere doesn't drag the read back), and at least the daily-use week. Receipts and
  // moves from the window's start: a product with no anchor takes those, nothing more
  const week = dailyUseWindow(today);
  const from = usageReadFrom(anchors, products, week.from);
  const [receipts, adjustments, waste, sales, ctx, priceRows] = await Promise.all([
    receiptsP,
    adjustmentsP,
    all<WasteRow>((a, b) => supabase.from("daily_stock_counts").select("id, sku_id, count_date, waste").eq("branch_id", branchId).gt("waste", 0).gte("count_date", from).lte("count_date", today).order("id").range(a, b)),
    all<UsageSaleRow>((a, b) => supabase.from("sales_entries").select("id, sale_date, menu_code, menu_name, qty").eq("branch_id", branchId).gte("sale_date", from).lte("sale_date", today).order("id").range(a, b)),
    shared.ctx,
    pricesP,
  ]);
  const prices = new Map<string, number>();
  for (const p of priceRows) if (!prices.has(p.sku_id)) prices.set(p.sku_id, Number(p.price_per_usage_uom) || 0);
  const usage = usageOf(ctx, sales, branchId, products);
  const own = <T extends { sku_id: string }>(rows: T[]) => (products ? rows.filter((r) => products.has(r.sku_id)) : rows);
  return { counts: anchors, receipts: own(receipts), adjustments: own(adjustments), waste: own(waste), usageByDay: usage.byDay, sellingDays: sellingDays(sales, week), prices, unanchoredFrom: window.from };
}

export const supabaseBranchStockLoader: BranchStockLoader = { load: (branchId, today, products) => loadBranchStock(branchId, today, products ?? null) };

/** One branch's stock: balance per item, daily use over the last week, days left */
export function useBranchStock(branchId: string | null, skus: SKU[], loader: BranchStockLoader = supabaseBranchStockLoader) {
  // Coming back: the rows shown last for this branch and day are up at once, read again behind
  // them (lib/page-cache.ts). Only the database loader's rows are kept (not the dev demo's)
  const keyFor = (id: string | null) => (id && loader === supabaseBranchStockLoader ? `store-stock|${id}|${toLocalDateStr(new Date())}` : null);
  const [shown, setShown] = useState<{ for: string; rows: BranchStockRow[] } | null>(() => {
    const k = keyFor(branchId);
    const seen = lastSeen<BranchStockRow[]>(k);
    return seen && k ? { for: k, rows: seen.value } : null;
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  useKeepLastSeen(shown && keyFor(branchId) === shown.for ? shown.for : null, BRANCH_STOCK_TABLES, shown?.rows);
  const setRows = (k: string, rows: BranchStockRow[]) => setShown({ for: k, rows });

  useEffect(() => {
    if (!branchId || !skus.length) {
      setShown(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const today = toLocalDateStr(new Date());
    const k = keyFor(branchId) ?? `demo|${branchId}|${today}`;
    // Another branch: its own kept rows, or none — never the last branch's under this one
    setShown((s) => {
      if (s?.for === k) return s;
      const seen = lastSeen<BranchStockRow[]>(keyFor(branchId));
      return seen ? { for: k, rows: seen.value } : null;
    });
    loader
      .load(branchId, today)
      .then((d) => {
        if (cancelled) return;
        const byId = new Map(skus.map((s) => [s.id, s]));
        const figures = branchFigures({ ...d, window: dailyUseWindow(today), converter: (id) => receiptConverter(byId.get(id)) });
        const out: BranchStockRow[] = [];
        for (const [id, f] of figures) {
          const sku = byId.get(id);
          // Branch stock is ingredients and kitchen-made items; packaging and SP mixes aren't counted here
          if (!sku || (sku.type !== "RM" && sku.type !== "SM")) continue;
          const price = d.prices.get(id) ?? 0;
          const known = f.anchorDate !== null;
          out.push({ sku, balance: f.balance, known, countDate: f.countDate, dailyUse: f.dailyUse, daysLeft: known && f.dailyUse > 0 ? Math.max(0, f.balance) / f.dailyUse : null, price, value: known ? Math.max(0, f.balance) * price : 0 });
        }
        setRows(k, out);
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

  const rows = shown && shown.for.endsWith(`|${branchId}|${toLocalDateStr(new Date())}`) ? shown.rows : null;
  /** Rows are up (kept from before, or a reload after a move) and being read again */
  const refreshing = loading && !!rows;
  return { rows, loading, refreshing, error, reload };
}
