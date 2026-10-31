import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { buildPriceAt, type PriceChange } from "@/lib/price-history";
import { usageContextOn, type RecipeCopy } from "@/lib/recipe-history";
import { fetchAllRows, fetchAllRowsOrThrow } from "@/lib/fetch-all";
import { usageContextFromApp, usageInputFromApp } from "@/lib/sale-usage";
import { receiptConverter } from "@/lib/branch-stock";
import {
  actualPct,
  computeActual,
  computeStandard,
  datesWithoutSales,
  findAttention,
  priceOnOf,
  readOnce,
  recipeByDay,
  type Actual,
  type Attention,
  type CountRow,
  type FcSale,
  type ReceiptRow,
  receiptUsage,
  type Standard,
  type UsageCorrection,
} from "@/lib/food-cost";
import type { SKU } from "@/types/sku";
import type { Price } from "@/types/price";
import type { Menu } from "@/types/menu";
import type { MenuBomLine } from "@/types/menu-bom";
import type { ModifierRule } from "@/types/modifier-rule";
import type { SpBomLine } from "@/types/sp-bom";
import type { Branch } from "@/types/branch";

export interface FoodCostMasters {
  skus: SKU[];
  prices: Price[];
  menus: Menu[];
  menuBomLines: MenuBomLine[];
  modifierRules: ModifierRule[];
  spBomLines: SpBomLine[];
  branches: Branch[];
}

export interface FoodCostResult {
  std: Standard;
  /** Only for one branch and a whole month that has ended */
  actual: Actual | null;
  attention: Attention[];
  sales: FcSale[];
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const shift = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return iso(d);
};
/** The whole calendar month, ended before today */
export function isClosedMonth(from: string, to: string, today: string): boolean {
  const first = `${from.slice(0, 7)}-01`;
  const d = new Date(`${first}T00:00:00`);
  const last = iso(new Date(d.getFullYear(), d.getMonth() + 1, 0));
  return from === first && to === last && to < today;
}

/** Where the period's rows come from (the database; the dev demo passes its own) */
export interface FoodCostLoader {
  sales(branchIds: string[], from: string, to: string): Promise<{ data: FcSale[]; error: unknown }>;
  corrections(branchIds: string[], from: string, to: string): Promise<UsageCorrection[]>;
  counts(branchId: string, from: string, to: string): Promise<CountRow[]>;
  receipts(branchId: string, from: string, to: string, skuIds?: string[]): Promise<ReceiptRow[]>;
  /** Standard-price changes (price history); none = every day at today's price */
  priceHistory?(): Promise<PriceChange[]>;
  /** Saved copies of recipes and option rules (recipe history); none = today's recipes */
  recipeHistory?(): Promise<RecipeCopy[]>;
}

export const supabaseLoader: FoodCostLoader = {
  // Missing table (before its migration ran) or a failed read: today's recipes, as before
  recipeHistory: async () => {
    const { data, error } = await fetchAllRows<{ id: string; kind: RecipeCopy["kind"]; owner_id: string | null; snapshot: unknown; valid_from: string; created_at: string }>((a, b) =>
      supabase.from("recipe_history" as never).select("id, kind, owner_id, snapshot, valid_from, created_at").neq("kind", "sm").order("valid_from").order("id").range(a, b) as never,
    );
    if (error) return [];
    return data.map((r) => ({ id: r.id, kind: r.kind, ownerId: r.owner_id, snapshot: r.snapshot, validFrom: r.valid_from, createdAt: r.created_at }));
  },
  // Missing table (before its migration ran) or a failed read: today's price, as before
  priceHistory: async () => {
    const { data, error } = await fetchAllRows<{ sku_id: string; price_per_usage_uom: number; valid_from: string }>((a, b) =>
      supabase.from("price_history" as never).select("id, sku_id, price_per_usage_uom, valid_from").order("valid_from").order("id").range(a, b) as never,
    );
    if (error) return [];
    return data.map((r) => ({ skuId: r.sku_id, pricePerUsageUom: Number(r.price_per_usage_uom), validFrom: r.valid_from }));
  },
  sales: (branchIds, from, to) =>
    fetchAllRows<FcSale>((a, b) =>
      supabase.from("sales_entries").select("id, sale_date, branch_id, menu_code, menu_name, qty, net_amount, receipt_no").in("branch_id", branchIds).gte("sale_date", from).lte("sale_date", to).order("id").range(a, b) as never,
    ),
  async corrections(branchIds, from, to) {
    // Before the table exists there are simply none (not in the generated types yet)
    type CorrRow = { id: string; branch_id: string; sku_id: string; date_from: string; date_to: string; qty: number; reason: string | null };
    const q = supabase.from("usage_corrections" as "sales_entries").select("id, branch_id, sku_id, date_from, date_to, qty, reason");
    const res = (await q.in("branch_id", branchIds).lte("date_from", to).gte("date_to", from)) as unknown as { data: CorrRow[] | null };
    return (res.data ?? []).map((c) => ({ id: c.id, branchId: c.branch_id, skuId: c.sku_id, dateFrom: c.date_from, dateTo: c.date_to, qty: Number(c.qty) || 0, reason: c.reason ?? "" }));
  },
  // A failed page fails the month (no actual from half the counts or receipts)
  counts: (branchId, from, to) =>
    fetchAllRowsOrThrow<CountRow>((x, y) =>
      supabase.from("daily_stock_counts").select("id, sku_id, count_date, physical_count, calculated_balance").eq("branch_id", branchId).gte("count_date", from).lte("count_date", to).order("id").range(x, y) as never,
    ),
  receipts: (branchId, from, to, skuIds) =>
    fetchAllRowsOrThrow<ReceiptRow>((x, y) => {
      let q = supabase.from("branch_receipts").select("id, sku_id, receipt_date, qty_received, actual_unit_price, actual_total, transfer_order_id").eq("branch_id", branchId).gte("receipt_date", from).lte("receipt_date", to);
      if (skuIds) q = q.in("sku_id", skuIds);
      return q.order("id").range(x, y) as never;
    }),
};

/** What one period's work-out needs from the masters (built once per hook) */
interface PeriodEnv {
  m: FoodCostMasters;
  ctx: ReturnType<typeof usageContextFromApp>;
  stdPrice: Map<string, number>;
  menuByCode: Map<string, { code: string; name: string; category: string }>;
  skuById: Map<string, { id: string; code: string; name: string; type: string; uom: string }>;
  converter: Map<string, number>;
  branchName: Map<string, string>;
}

type History = [PriceChange[], RecipeCopy[]];
const loadHistory = (loader: FoodCostLoader): Promise<History> => Promise.all([loader.priceHistory?.() ?? [], loader.recipeHistory?.() ?? []]);

/**
 * One period for the given branches: standard cost (always), actual cost (one
 * branch, closed month) and the things worth a look. null = stopped (`alive` false);
 * throws when something can't be read. `history`: price and recipe history already
 * on the way (several periods share one read).
 */
async function computePeriod(env: PeriodEnv, from: string, to: string, branchIds: string[], loader: FoodCostLoader, alive: () => boolean, history?: Promise<History>): Promise<FoodCostResult | null> {
  const salesRes = await loader.sales(branchIds, from, to);
  if (!alive()) return null;
  if (salesRes.error) throw new Error("sales");
  const corrections = await loader.corrections(branchIds, from, to);
  if (!alive()) return null;

  // Each day's sales at that day's price: a later price change leaves a closed month alone
  const [changes, copies] = await (history ?? loadHistory(loader));
  if (!alive()) return null;
  const priceAt = buildPriceAt(changes);
  // …and with the recipes of that day: a later recipe change leaves it alone too
  const ctxAt = copies.length ? usageContextOn(usageInputFromApp(env.m), copies) : undefined;
  const std = computeStandard({ sales: salesRes.data, ctx: env.ctx, ctxAt, stdPrice: env.stdPrice, priceAt, menuByCode: env.menuByCode, skuById: env.skuById, corrections, branchIds: new Set(branchIds), from, to });
  const today = iso(new Date());

  let actual: Actual | null = null;
  if (branchIds.length === 1 && isClosedMonth(from, to, today)) {
    const b = branchIds[0];
    // Opening = the last count of the month before, closing = the last count of this
    // month (CLAUDE.md), received = what came in between those two count days, so the
    // receipts are read from the start of the month before
    const opening = { from: `${shift(from, -1).slice(0, 7)}-01`, to: shift(from, -1) };
    const closing = { from, to };
    // …and the recipe side over each item's same span: the month before's sales and
    // corrections too, since a span can start there
    const [open, close, rec, before, spanCorrections] = await Promise.all([
      loader.counts(b, opening.from, opening.to),
      loader.counts(b, closing.from, closing.to),
      loader.receipts(b, opening.from, to),
      loader.sales([b], opening.from, opening.to),
      loader.corrections([b], opening.from, to),
    ]);
    if (!alive()) return null;
    if (before.error) throw new Error("sales");
    const priceOn = priceOnOf(priceAt, env.stdPrice);
    const recipeDays = recipeByDay({ sales: [...before.data, ...salesRes.data], ctx: env.ctx, ctxAt, priceOn });
    // Items not bought in those two months: what was paid over the months before
    const boughtNow = new Set(rec.map((r) => r.sku_id));
    const need = std.skus.map((s) => s.skuId).filter((id) => !boughtNow.has(id));
    const pastPrice = new Map<string, number>();
    if (need.length) {
      const past = await loader.receipts(b, shift(from, -183), shift(opening.from, -1), need);
      if (!alive()) return null;
      const agg = new Map<string, { q: number; v: number }>();
      for (const r of past) {
        const a = agg.get(r.sku_id) ?? { q: 0, v: 0 };
        const u = receiptUsage(r, env.converter.get(r.sku_id) || 1);
        a.q += u.qty;
        a.v += u.paid;
        agg.set(r.sku_id, a);
      }
      for (const [id, a] of agg) if (a.q > 0) pastPrice.set(id, a.v / a.q);
    }
    actual = computeActual({ skus: std.skus, openingRows: open, closingRows: close, receipts: rec, converter: env.converter, pastPrice, opening, closing, recipeDays, corrections: spanCorrections, priceOn });
    // Nothing counted in these months: there is no actual to show (not ฿0)
    if (actual.withCounts === 0) actual = null;
  }

  // Up to yesterday: today's sales usually come in at closing time
  const missingDays = branchIds.map((b) => ({ branch: env.branchName.get(b) ?? "สาขา", dates: datesWithoutSales(salesRes.data, b, from, to, shift(today, -1)) }));
  const attention = findAttention({ std, actual, missingDays });
  if (!alive()) return null;
  return { std, actual, attention, sales: salesRes.data };
}

/** The masters, shaped once for working out periods */
function usePeriodEnv(m: FoodCostMasters): PeriodEnv {
  const ctx = useMemo(
    () => usageContextFromApp({ menus: m.menus, menuBomLines: m.menuBomLines, modifierRules: m.modifierRules, spBomLines: m.spBomLines, skus: m.skus }),
    [m.menus, m.menuBomLines, m.modifierRules, m.spBomLines, m.skus],
  );
  // Standard price = the newest active price row (the cost engine's rule)
  const stdPrice = useMemo(() => {
    const out = new Map<string, number>();
    for (const p of m.prices) if (p.isActive && !out.has(p.skuId)) out.set(p.skuId, p.pricePerUsageUom);
    return out;
  }, [m.prices]);
  const menuByCode = useMemo(() => new Map(m.menus.map((x) => [x.menuCode, { code: x.menuCode, name: x.menuName, category: x.category }])), [m.menus]);
  const skuById = useMemo(() => new Map(m.skus.map((s) => [s.id, { id: s.id, code: s.skuId, name: s.name, type: s.type, uom: s.usageUom }])), [m.skus]);
  // Supplier receipts in usage units by the count sheet's rule (CLAUDE.md UOM: the converter
  // applies when purchase and usage units differ), as branch stock and the count sheet read them
  const converter = useMemo(() => new Map(m.skus.map((s) => [s.id, receiptConverter(s)])), [m.skus]);
  const branchName = useMemo(() => new Map(m.branches.map((b) => [b.id, b.branchName])), [m.branches]);
  // `m` itself is a new object every render; what's read from it is the arrays above
  return useMemo(() => ({ m, ctx, stdPrice, menuByCode, skuById, converter, branchName }), [ctx, stdPrice, menuByCode, skuById, converter, branchName]); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * Loads one period for the given branches and works out standard cost (always),
 * actual cost (one branch, closed month) and the things worth a look.
 * Calculates on its own when the period or branches change — no "calculate" button.
 */
export function useFoodCost(m: FoodCostMasters, from: string, to: string, branchIds: string[], loader: FoodCostLoader = supabaseLoader) {
  const [result, setResult] = useState<FoodCostResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const env = usePeriodEnv(m);
  const key = `${from}|${to}|${[...branchIds].sort().join(",")}`;
  const ready = m.menus.length > 0 && m.skus.length > 0 && branchIds.length > 0;

  useEffect(() => {
    if (!ready) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const r = await computePeriod(env, from, to, branchIds, loader, () => !cancelled);
        if (!r || cancelled) return;
        setResult(r);
      } catch {
        if (cancelled) return;
        setError("โหลดข้อมูลไม่สำเร็จ ลองใหม่อีกครั้ง");
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [key, ready, env]); // eslint-disable-line react-hooks/exhaustive-deps

  return { result, loading, error };
}

/** One month on the trend chart */
export interface TrendPoint {
  from: string;
  to: string;
  revenue: number;
  /** % of sales: from the recipes, and from the counts (one branch, a closed month) */
  stdPct: number | null;
  actPct: number | null;
  /** Actual − standard, baht (null = no actual) */
  totalVar: number | null;
  priceVar: number | null;
  usageVar: number | null;
}

/**
 * The same work-out for several months, one after another, for the trend at the
 * top of Food Cost. Each month is filled in as soon as it's done ("failed" = that
 * month couldn't be read).
 */
export function useFoodCostTrend(m: FoodCostMasters, months: { from: string; to: string }[], branchIds: string[], loader: FoodCostLoader = supabaseLoader) {
  const env = usePeriodEnv(m);
  const [points, setPoints] = useState<(TrendPoint | "failed" | null)[]>([]);
  const [error, setError] = useState(false);
  const key = `${months.map((x) => x.from).join(",")}|${[...branchIds].sort().join(",")}`;
  const ready = m.menus.length > 0 && m.skus.length > 0 && branchIds.length > 0;

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    setPoints(months.map(() => null));
    setError(false);
    (async () => {
      // Price and recipe history once for all the months, every other read once per ask,
      // and the months side by side (each fills in when done)
      const history = loadHistory(loader);
      const reads = readOnce(loader, ["sales", "corrections", "counts", "receipts"]);
      await Promise.all(months.map(async ({ from, to }, i) => {
        try {
          const r = await computePeriod(env, from, to, branchIds, reads, () => !cancelled, history);
          if (!r || cancelled) return;
          const pct = (v: number) => (r.std.revenue > 0 ? (v / r.std.revenue) * 100 : null);
          const point: TrendPoint = {
            from,
            to,
            revenue: r.std.revenue,
            stdPct: pct(r.std.stdCost),
            // Comparable with the recipe % (the counts' own days against the same recipe)
            actPct: r.actual ? actualPct(r.std, r.actual) : null,
            totalVar: r.actual?.totalVar ?? null,
            priceVar: r.actual?.priceVar ?? null,
            usageVar: r.actual?.usageVar ?? null,
          };
          setPoints((p) => p.map((x, k) => (k === i ? point : x)));
        } catch {
          if (cancelled) return;
          setPoints((p) => p.map((x, k) => (k === i ? "failed" : x)));
          setError(true);
        }
      }));
    })();
    return () => {
      cancelled = true;
    };
  }, [key, ready, env]); // eslint-disable-line react-hooks/exhaustive-deps

  return { points, error };
}
