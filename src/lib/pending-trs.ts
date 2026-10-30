import { supabase } from "@/integrations/supabase/client";

/**
 * Branch requests still waiting for a transfer order. A request counts until it has
 * a sent (or received) TO — an unsent draft still counts — read from the TO table,
 * not the request's own status flag (use-transfer-order.ts fetchPendingTRs uses the
 * same rule), so the menu badge, the today page and the queue never disagree.
 */
export async function fetchPendingTrCount(): Promise<number> {
  const { data: candidates } = await supabase.from("transfer_requests").select("id").in("status", ["Submitted", "Acknowledged"]);
  const ids = (candidates || []).map((t) => t.id);
  if (!ids.length) return 0;
  const { data: active } = await supabase.from("transfer_orders").select("tr_id").in("tr_id", ids).not("status", "in", "(Cancelled,Draft)");
  const covered = new Set((active || []).map((t) => t.tr_id).filter(Boolean));
  return ids.filter((id) => !covered.has(id)).length;
}
