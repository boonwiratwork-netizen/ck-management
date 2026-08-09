// Edge function: to-sent-report
// Trigger-fired (not cron) — called by the notify_to_sent() DB trigger the instant a
// transfer_orders row's status changes to "Sent". Reports what was sent to that one
// branch: each line's pack count and quantity. One LINE push per TO sent.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse, pushLineMessage } from "../_shared/report-utils.ts";
import { computeToLineQty } from "../_shared/stock-value.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const toId = body?.to_id as string | undefined;
    if (!toId) return jsonResponse({ error: "to_id is required" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: to } = await supabase
      .from("transfer_orders")
      .select("id, to_number, branch_id, status")
      .eq("id", toId)
      .single();
    if (!to) return jsonResponse({ error: `transfer_orders row ${toId} not found` }, 404);

    const { data: branch } = await supabase
      .from("branches")
      .select("branch_name")
      .eq("id", to.branch_id)
      .single();

    const { data: lines } = await supabase
      .from("transfer_order_lines")
      .select("sku_id, packs_count, actual_qty, planned_qty, uom")
      .eq("to_id", toId);
    const lineRows = (lines || []) as Array<{
      sku_id: string; packs_count: number | null; actual_qty: number; planned_qty: number; uom: string;
    }>;

    const skuIds = lineRows.map((l) => l.sku_id);
    const nameById: Record<string, string> = {};
    if (skuIds.length > 0) {
      const { data: skuRows } = await supabase.from("skus").select("id, name").in("id", skuIds);
      for (const s of (skuRows || []) as Array<{ id: string; name: string }>) nameById[s.id] = s.name;
    }

    const lineText = lineRows
      .map((l) => {
        const qty = computeToLineQty(Number(l.actual_qty), Number(l.planned_qty), to.status);
        const packs = l.packs_count != null ? `${l.packs_count} แพ็ค, ` : "";
        return `${nameById[l.sku_id] || l.sku_id}: ${packs}${qty.toFixed(0)} ${l.uom}`;
      })
      .join("\n");

    const message =
      `ส่ง TO ${to.to_number} ไปสาขา ${branch?.branch_name || to.branch_id}\n\n` +
      `${lineText || "(ไม่มีรายการ)"}`;

    const result = await pushLineMessage(message);
    if (!result.ok) return jsonResponse({ error: result.error, message }, 500);

    return jsonResponse({ ok: true, message });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: msg }, 500);
  }
});
