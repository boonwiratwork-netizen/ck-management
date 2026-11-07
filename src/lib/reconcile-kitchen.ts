import type { CkPeriod } from "@/hooks/use-ck-production";
import { kitchenRows, type RcRow, type RcSku } from "@/lib/reconcile";

/** What the ครัวกลาง scope shows for a month, from the kitchen dashboard's month cost */
export type KitchenResult = { kind: "rows"; rows: RcRow[]; opening: string; closing: string; uncounted: number } | { kind: "note"; text: string } | { kind: "loading" } | { kind: "error" };

export function kitchenResult(data: CkPeriod | null, loading: boolean, error: string | null, skus: RcSku[], price: (id: string) => number, ongoing: boolean): KitchenResult {
  if (error) return { kind: "error" };
  if (!data || loading) return { kind: "loading" };
  if (data.blocked) return { kind: "note", text: `เทียบไม่ได้: ${data.blocked}` };
  if (!data.produced) return { kind: "note", text: "เดือนนี้ครัวไม่มีการผลิต" };
  if (data.estimated || !data.closing || !data.opening || !data.cost) return { kind: "note", text: ongoing ? "เดือนนี้ยังไม่จบ ครัวยังไม่นับปิดเดือน เลยยังเทียบไม่ได้" : "ยังไม่มีผลนับปิดเดือนของครัว เลยยังเทียบไม่ได้" };
  const rows = kitchenRows({
    lines: data.cost.rows.flatMap((r) => r.lines),
    rmUsed: data.cost.rmUsed,
    uncounted: new Set(data.uncounted),
    skus,
    price,
    opening: data.opening.date,
    closing: data.closing.date,
  });
  return { kind: "rows", rows, opening: data.opening.date, closing: data.closing.date, uncounted: new Set(data.uncounted).size };
}

