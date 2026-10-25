import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/** global_settings key holding option keys (and "group|*") that change no ingredient */
const NO_STOCK_KEY = "pos_options_no_stock";

/** The saved list of POS options that change no ingredient (bills come from Menu Setup's sales read) */
export function usePosOptionsData(enabled: boolean) {
  const [noStock, setNoStock] = useState<Set<string>>(new Set());
  // Latest saved list, so two quick taps don't overwrite each other
  const noStockRef = useRef<Set<string>>(new Set());
  // Saving is blocked unless the saved list was read, or it would be overwritten
  const [settingLoaded, setSettingLoaded] = useState(false);

  // Bills come from the Menu Setup sales read; this only loads the saved "no ingredient" list
  useEffect(() => {
    if (!enabled || settingLoaded) return;
    let cancelled = false;
    (async () => {
      const { data: setting, error: settingError } = await supabase.from("global_settings").select("value").eq("key", NO_STOCK_KEY).maybeSingle();
      if (cancelled || settingError) return;
      try {
        const saved = new Set<string>(JSON.parse(setting?.value || "[]"));
        noStockRef.current = saved;
        setNoStock(saved);
        setSettingLoaded(true);
      } catch {
        // Unreadable value: leave saving blocked rather than overwrite it
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, settingLoaded]);

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

  return { noStock, setNoStockKeys };
}
