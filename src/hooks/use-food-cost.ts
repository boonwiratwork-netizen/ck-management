import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetch-all";
import { usageContextFromApp } from "@/lib/sale-usage";
import {
  computeActual,
  computeStandard,
  datesWithoutSales,
  findAttention,
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
  openingDate: string;
  closingDate: string;
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
}

export const supabaseLoader: FoodCostLoader = {
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
  counts: async (branchId, from, to) =>
    (
      await fetchAllRows<CountRow>((x, y) =>
        supabase.from("daily_stock_counts").select("id, sku_id, count_date, physical_count, calculated_balance").eq("branch_id", branchId).gte("count_date", from).lte("count_date", to).order("id").range(x, y) as never,
      )
    ).data,
  receipts: async (branchId, from, to, skuIds) =>
    (
      await fetchAllRows<ReceiptRow>((x, y) => {
        let q = supabase.from("branch_receipts").select("id, sku_id, receipt_date, qty_received, actual_unit_price, actual_total, transfer_order_id").eq("branch_id", branchId).gte("receipt_date", from).lte("receipt_date", to);
        if (skuIds) q = q.in("sku_id", skuIds);
        return q.order("id").range(x, y) as never;
      })
    ).data,
};

/**
 * Loads one period for the given branches and works out standard cost (always),
 * actual cost (one branch, closed month) and the things worth a look.
 * Calculates on its own when the period or branches change — no "calculate" button.
 */
export function useFoodCost(m: FoodCostMasters, from: string, to: string, branchIds: string[], loader: FoodCostLoader = supabaseLoader) {
  const [result, setResult] = useState<FoodCostResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  const converter = useMemo(() => new Map(m.skus.map((s) => [s.id, s.converter || 1])), [m.skus]);
  const branchName = useMemo(() => new Map(m.branches.map((b) => [b.id, b.branchName])), [m.branches]);
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
      const salesRes = await loader.sales(branchIds, from, to);
      if (cancelled) return;
      if (salesRes.error) {
        setError("โหลดยอดขายไม่สำเร็จ ลองใหม่อีกครั้ง");
        setLoading(false);
        return;
      }
      const corrections = await loader.corrections(branchIds, from, to);
      if (cancelled) return;

      const std = computeStandard({ sales: salesRes.data, ctx, stdPrice, menuByCode, skuById, corrections, branchIds: new Set(branchIds), from, to });
      const today = iso(new Date());
      const openingDate = shift(from, -1);
      const closingDate = to;

      let actual: Actual | null = null;
      if (branchIds.length === 1 && isClosedMonth(from, to, today)) {
        const b = branchIds[0];
        const [open, close, rec] = await Promise.all([
          loader.counts(b, shift(openingDate, -3), shift(openingDate, 3)),
          loader.counts(b, shift(closingDate, -3), shift(closingDate, 3)),
          loader.receipts(b, from, to),
        ]);
        if (cancelled) return;
        // Items not bought this month: what was paid over the 6 months before
        const boughtNow = new Set(rec.map((r) => r.sku_id));
        const need = std.skus.map((s) => s.skuId).filter((id) => !boughtNow.has(id));
        const pastPrice = new Map<string, number>();
        if (need.length) {
          const past = await loader.receipts(b, shift(from, -183), shift(from, -1), need);
          if (cancelled) return;
          const agg = new Map<string, { q: number; v: number }>();
          for (const r of past) {
            const a = agg.get(r.sku_id) ?? { q: 0, v: 0 };
            const u = receiptUsage(r, converter.get(r.sku_id) || 1);
            a.q += u.qty;
            a.v += u.paid;
            agg.set(r.sku_id, a);
          }
          for (const [id, a] of agg) if (a.q > 0) pastPrice.set(id, a.v / a.q);
        }
        actual = computeActual({ skus: std.skus, openingRows: open, closingRows: close, receipts: rec, converter, pastPrice, openingDate, closingDate });
        // Nothing counted around these dates: there is no actual to show (not ฿0)
        if (actual.withCounts === 0) actual = null;
      }

      // Up to yesterday: today's sales usually come in at closing time
      const missingDays = branchIds.map((b) => ({ branch: branchName.get(b) ?? "สาขา", dates: datesWithoutSales(salesRes.data, b, from, to, shift(today, -1)) }));
      const attention = findAttention({ std, actual, missingDays });
      if (cancelled) return;
      setResult({ std, actual, attention, sales: salesRes.data, openingDate, closingDate });
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [key, ready, ctx, stdPrice]); // eslint-disable-line react-hooks/exhaustive-deps

  return { result, loading, error };
}
