import { useEffect, useState } from "react";
import { AlertTriangle, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { businessDate, isoDate } from "@/lib/stock-count";

/**
 * Orange strip on every store page while an earlier day's count isn't finished
 * (last 7 days), so "นับเสร็จ" can't be forgotten. Tapping it opens the count page.
 */
export function CountReminder({ branchId, onGo }: { branchId: string | null; onGo: () => void }) {
  const [days, setDays] = useState(0);
  useEffect(() => {
    if (!branchId) return;
    const today = businessDate(new Date());
    const from = new Date(`${today}T00:00:00`);
    from.setDate(from.getDate() - 7);
    // Only sheets with something typed in: one opened by mistake and left blank isn't a
    // day to finish (the count page's own check reads it the same way)
    supabase
      .from("daily_stock_counts")
      .select("count_date, physical_count, waste")
      .eq("branch_id", branchId)
      .eq("is_submitted", false)
      .gte("count_date", isoDate(from))
      .lt("count_date", today)
      .limit(10000)
      .then(({ data }) => setDays(new Set((data ?? []).filter((r) => r.physical_count !== null || Number(r.waste) > 0).map((r) => r.count_date)).size));
  }, [branchId]);
  if (!days) return null;
  return (
    <button type="button" onClick={onGo} className="flex w-full items-center gap-2 bg-warning-soft px-4 py-2.5 text-left text-sm font-semibold text-warning md:px-6">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span className="flex-1">ยังไม่ได้กด “นับเสร็จ” {days} วัน</span>
      <span className="flex items-center">
        ไปจัดการ <ChevronRight className="h-4 w-4" />
      </span>
    </button>
  );
}
