import { useCallback, useEffect, useRef, useState } from "react";
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
  // Latest saved list, so two quick taps don't overwrite each other
  const noStockRef = useRef<Set<string>>(new Set());
  // Saving is blocked unless the saved list was read, or it would be overwritten
  const [settingLoaded, setSettingLoaded] = useState(false);
  const [error, setError] = useState(false);

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
          if (!cancelled) {
            toast.error("โหลดบิลขายไม่สำเร็จ");
            setError(true);
          }
          return;
        }
        out.push(...((data ?? []) as Bill[]));
        if (!data || data.length < 1000) break;
      }
      const { data: setting, error: settingError } = await supabase.from("global_settings").select("value").eq("key", NO_STOCK_KEY).maybeSingle();
      if (cancelled) return;
      if (!settingError) {
        try {
          const saved = new Set<string>(JSON.parse(setting?.value || "[]"));
          noStockRef.current = saved;
          setNoStock(saved);
          setSettingLoaded(true);
        } catch {
          // Unreadable value: leave saving blocked rather than overwrite it
        }
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
      if (!settingLoaded) {
        toast.error("โหลดรายการเดิมไม่สำเร็จ เลยยังบันทึกไม่ได้ ลองรีเฟรช");
        return false;
      }
      const before = noStockRef.current;
      const next = new Set(before);
      for (const k of keys) {
        if (on) next.add(k);
        else next.delete(k);
      }
      // Claim the new list before saving so a second quick tap builds on it
      noStockRef.current = next;
      setNoStock(next);
      const { error } = await supabase
        .from("global_settings")
        .upsert({ key: NO_STOCK_KEY, value: JSON.stringify([...next].sort()), updated_at: new Date().toISOString() }, { onConflict: "key" });
      if (error) {
        if (noStockRef.current === next) {
          noStockRef.current = before;
          setNoStock(before);
        }
        toast.error("บันทึกไม่สำเร็จ: " + error.message);
        return false;
      }
      return true;
    },
    [settingLoaded],
  );

  return { bills, noStock, setNoStockKeys, error };
}
