import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Bill } from "@/lib/pos-options";
import { SALES_WINDOW_DAYS } from "@/hooks/use-menu-setup-extras";

/** global_settings key holding option keys (and "group|*") that change no ingredient */
const NO_STOCK_KEY = "pos_options_no_stock";

/**
 * Bills with their full names for the POS option catalog. Loaded only when the
 * options view opens (names are long; the menu list doesn't need them).
 */
export function usePosOptionsData(enabled: boolean) {
  const [bills, setBills] = useState<Bill[] | null>(null);
  const [noStock, setNoStock] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!enabled || bills) return;
    let cancelled = false;
    const since = new Date();
    since.setDate(since.getDate() - SALES_WINDOW_DAYS);
    const sinceStr = since.toISOString().split("T")[0];

    (async () => {
      const out: Bill[] = [];
      // Supabase returns at most 1,000 rows per request
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase
          .from("sales_entries")
          .select("id, menu_code, menu_name, qty, branch_id")
          .gte("sale_date", sinceStr)
          .order("id")
          .range(from, from + 999);
        if (error) {
          if (!cancelled) toast.error("โหลดบิลขายไม่สำเร็จ");
          return;
        }
        out.push(...((data ?? []) as Bill[]));
        if (!data || data.length < 1000) break;
      }
      const { data: setting } = await supabase.from("global_settings").select("value").eq("key", NO_STOCK_KEY).maybeSingle();
      if (cancelled) return;
      try {
        setNoStock(new Set(JSON.parse(setting?.value || "[]")));
      } catch {
        setNoStock(new Set());
      }
      setBills(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, bills]);

  /** Mark or unmark keys as "changes no ingredient"; returns true when saved */
  const setNoStockKeys = useCallback(
    async (keys: string[], on: boolean) => {
      const next = new Set(noStock);
      for (const k of keys) {
        if (on) next.add(k);
        else next.delete(k);
      }
      const { error } = await supabase
        .from("global_settings")
        .upsert({ key: NO_STOCK_KEY, value: JSON.stringify([...next].sort()), updated_at: new Date().toISOString() }, { onConflict: "key" });
      if (error) {
        toast.error("บันทึกไม่สำเร็จ: " + error.message);
        return false;
      }
      setNoStock(next);
      return true;
    },
    [noStock],
  );

  return { bills, noStock, setNoStockKeys };
}
