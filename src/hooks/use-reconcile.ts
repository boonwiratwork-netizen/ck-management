import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { perBranchRows } from "@/lib/per-branch";
import { shiftDay } from "@/lib/day-follow";
import { sharedRead } from "@/lib/page-cache";
import { buildReconcile, LOOKBACK_DAYS, type RcBranch, type RcCount, type RcPeriod, type RcSale, type RcView } from "@/lib/reconcile";
import type { SKU } from "@/types/sku";
import type { Price } from "@/types/price";
import type { Menu } from "@/types/menu";
import type { MenuBomLine } from "@/types/menu-bom";
import type { Branch } from "@/types/branch";

/**
 * Rows behind กระทบยอด สูตร เทียบ ของจริง: each branch's count sheets and sales for the period
 * plus LOOKBACK_DAYS before it (so each item's previous count — the start of its window — is
 * found). One paged read per branch, side by side (perBranchRows: a failed page fails the
 * read, never a partial month shown as everything). Products, prices, menus and recipes come
 * from the app's own master data (the same arrays every page uses).
 */

export interface ReconcileMasters {
  skus: SKU[];
  prices: Price[];
  menus: Menu[];
  menuBomLines: MenuBomLine[];
  branches: Branch[];
}

export interface ReconcileLoader {
  load(branchIds: string[], from: string, to: string): Promise<{ counts: RcCount[]; sales: RcSale[] }>;
}

const TABLES = ["daily_stock_counts", "sales_entries"];

export const supabaseReconcileLoader: ReconcileLoader = {
  async load(branchIds, from, to) {
    const [counts, sales] = await Promise.all([
      perBranchRows<RcCount & { id: string }>(branchIds, (id, a, b) =>
        supabase
          .from("daily_stock_counts")
          .select("id, branch_id, count_date, sku_id, physical_count, variance, waste, expected_usage, is_submitted, submitted_at, received_from_ck, received_external")
          .eq("branch_id", id)
          .gte("count_date", from)
          .lte("count_date", to)
          .order("id")
          .range(a, b) as never,
      ),
      perBranchRows<RcSale & { id: string }>(branchIds, (id, a, b) =>
        supabase.from("sales_entries").select("id, branch_id, sale_date, created_at, net_amount, menu_code, qty").eq("branch_id", id).gte("sale_date", from).lte("sale_date", to).order("id").range(a, b) as never,
      ),
    ]);
    return {
      counts: counts.map((c) => ({
        ...c,
        physical_count: c.physical_count === null ? null : Number(c.physical_count),
        variance: Number(c.variance) || 0,
        waste: Number(c.waste) || 0,
        expected_usage: Number(c.expected_usage) || 0,
        received_from_ck: Number(c.received_from_ck) || 0,
        received_external: Number(c.received_external) || 0,
      })),
      sales: sales.map((s) => ({ ...s, net_amount: Number(s.net_amount) || 0, qty: Number(s.qty) || 0, menu_code: s.menu_code ?? "" })),
    };
  },
};

export function useReconcile(masters: ReconcileMasters, period: RcPeriod, loader: ReconcileLoader = supabaseReconcileLoader) {
  const branches = useMemo<RcBranch[]>(
    () =>
      masters.branches
        .filter((b) => b.status === "Active")
        .map((b) => ({ id: b.id, name: b.branchName, brandName: b.brandName }))
        .sort((a, b) => a.name.localeCompare(b.name, "th")),
    [masters.branches],
  );
  const readFrom = shiftDay(period.from, -LOOKBACK_DAYS);
  const ids = branches.map((b) => b.id).join(",");
  const key = ids ? `reconcile|${ids}|${readFrom}|${period.to}` : null;
  const [raw, setRaw] = useState<{ for: string; counts: RcCount[]; sales: RcSale[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    setLoading(true);
    setError(false);
    const read = () => loader.load(ids.split(","), readFrom, period.to);
    // A tap on ‹ › back to a period read a moment ago shows at once (kept 5 min, dropped on any write to these tables)
    (loader === supabaseReconcileLoader && tick === 0 ? sharedRead(key, TABLES, read) : read())
      .then((d) => !cancelled && setRaw({ for: key, ...d }))
      .catch(() => !cancelled && setError(true))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [key, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  // Active price per usage unit: the newest active price row (the cost engine's rule)
  const price = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of masters.prices) if (p.isActive && !m.has(p.skuId)) m.set(p.skuId, Number(p.pricePerUsageUom) || 0);
    return (id: string) => m.get(id) ?? 0;
  }, [masters.prices]);

  const shown = raw && raw.for === key ? raw : null;
  const mastersReady = masters.skus.length > 0;
  const view = useMemo<RcView | null>(
    () =>
      shown && mastersReady
        ? buildReconcile({
            period,
            branches,
            counts: shown.counts,
            sales: shown.sales,
            skus: masters.skus.map((s) => ({ id: s.id, code: s.skuId, name: s.name, purchaseUom: s.purchaseUom, usageUom: s.usageUom, converter: s.converter })),
            price,
            menus: masters.menus,
            bomLines: masters.menuBomLines,
          })
        : null,
    [shown, mastersReady, period, branches, masters.skus, masters.menus, masters.menuBomLines, price],
  );
  const retry = useCallback(() => setTick((t) => t + 1), []);
  return { view, loading: loading || (!!shown && !mastersReady), error, retry, noBranches: branches.length === 0, price };
}
