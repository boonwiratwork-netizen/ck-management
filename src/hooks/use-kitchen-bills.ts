import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetch-all";
import { toLocalDateStr } from "@/lib/utils";
import type { Bill } from "@/lib/product-health";

export const BILL_WINDOW_DAYS = 90;

/** Kitchen goods receipts of the last 90 days, for Cost Center's price checks (read-only) */
export function useKitchenBills(enabled: boolean) {
  const [bills, setBills] = useState<Bill[] | null>(null);
  const load = useCallback(async () => {
    const since = toLocalDateStr(new Date(Date.now() - BILL_WINDOW_DAYS * 86400000));
    const { data, error } = await fetchAllRows<any>((f, t) =>
      supabase
        .from("goods_receipts")
        .select("id, sku_id, supplier_id, receipt_date, created_at, actual_unit_price, std_unit_price, quantity_received")
        .gte("receipt_date", since)
        .order("receipt_date", { ascending: false })
        .order("created_at", { ascending: false })
        .order("id")
        .range(f, t),
    );
    if (error) return;
    setBills(
      data.map((r) => ({
        skuId: r.sku_id,
        supplierId: r.supplier_id,
        date: r.receipt_date,
        unitPrice: Number(r.actual_unit_price) || 0,
        stdUnitPrice: Number(r.std_unit_price) || 0,
        qty: Number(r.quantity_received) || 0,
      })),
    );
  }, []);
  useEffect(() => {
    if (enabled && bills === null) load();
  }, [enabled, bills, load]);
  return { bills, reload: load };
}
