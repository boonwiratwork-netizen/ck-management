import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/** How many days of sales the Menu Setup screen looks at */
export const SALES_WINDOW_DAYS = 30;

// Supabase returns at most 1,000 rows per request
async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

/**
 * Data only the Menu Setup screen needs, loaded when it opens (not at app start):
 * which branches closed which menus, and recent sales per menu code per branch.
 */
export function useMenuSetupExtras() {
  /** menuId → branchId → is_active */
  const [overrides, setOverrides] = useState<Record<string, Record<string, boolean>>>({});
  /** menu_code → branchId → qty */
  const [soldByCode, setSoldByCode] = useState<Record<string, Record<string, number>> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const since = new Date();
    since.setDate(since.getDate() - SALES_WINDOW_DAYS);
    const sinceStr = since.toISOString().split("T")[0];

    (async () => {
      try {
        const [ov, sales] = await Promise.all([
          fetchAll<{ menu_id: string; branch_id: string; is_active: boolean }>((a, b) =>
            supabase.from("branch_menu_overrides").select("id, menu_id, branch_id, is_active").order("id").range(a, b),
          ),
          fetchAll<{ menu_code: string; branch_id: string; qty: number }>((a, b) =>
            supabase.from("sales_entries").select("id, menu_code, branch_id, qty").gte("sale_date", sinceStr).order("id").range(a, b),
          ),
        ]);
        if (cancelled) return;
        const o: Record<string, Record<string, boolean>> = {};
        for (const r of ov) (o[r.menu_id] ??= {})[r.branch_id] = r.is_active;
        const s: Record<string, Record<string, number>> = {};
        for (const r of sales) {
          const byBranch = (s[r.menu_code] ??= {});
          byBranch[r.branch_id] = (byBranch[r.branch_id] ?? 0) + Number(r.qty);
        }
        setOverrides(o);
        setSoldByCode(s);
      } catch {
        if (!cancelled) toast.error("โหลดยอดขาย/สถานะเปิดขายไม่สำเร็จ");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Open or close one menu at one branch; returns true when saved */
  const setBranchOpen = useCallback(async (menuId: string, branchId: string, open: boolean) => {
    const { error } = await supabase
      .from("branch_menu_overrides")
      .upsert({ branch_id: branchId, menu_id: menuId, is_active: open }, { onConflict: "branch_id,menu_id" });
    if (error) {
      toast.error("บันทึกการเปิดขายไม่สำเร็จ: " + error.message);
      return false;
    }
    setOverrides((prev) => ({ ...prev, [menuId]: { ...(prev[menuId] ?? {}), [branchId]: open } }));
    return true;
  }, []);

  /** Open or close many menus at one branch in one save */
  const setBranchOpenMany = useCallback(async (menuIds: string[], branchId: string, open: boolean) => {
    if (menuIds.length === 0) return true;
    const { error } = await supabase
      .from("branch_menu_overrides")
      .upsert(
        menuIds.map((menu_id) => ({ branch_id: branchId, menu_id, is_active: open })),
        { onConflict: "branch_id,menu_id" },
      );
    if (error) {
      toast.error("บันทึกการเปิดขายไม่สำเร็จ: " + error.message);
      return false;
    }
    setOverrides((prev) => {
      const next = { ...prev };
      for (const id of menuIds) next[id] = { ...(next[id] ?? {}), [branchId]: open };
      return next;
    });
    return true;
  }, []);

  return { overrides, soldByCode, loading, setBranchOpen, setBranchOpenMany };
}
