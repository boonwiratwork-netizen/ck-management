// CK-level stock valuation, mirroring the pooled-anchor formula in
// src/hooks/use-stock-data.ts (RM), src/hooks/use-pk-stock-data.ts (PK), and
// src/hooks/use-sm-stock-data.ts (SM). Do not fork this formula — if any of those
// three hooks change, update this file to match.

// Canonical set of Transfer Order statuses that represent a real (already-shipped)
// stock movement — mirrors src/lib/to-line-qty.ts.
export const TO_DELIVERED_STATUSES = ["Sent", "Received", "Partially Received"];

export function computeToLineQty(actualQty: number, plannedQty: number, status: string): number {
  return actualQty > 0 ? actualQty : status === "Sent" ? plannedQty : 0;
}

async function getAnchorMap(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  type: "RM" | "PK" | "SM",
): Promise<Record<string, { physical_qty: number; count_date: string }>> {
  const { data: sessions } = await supabase
    .from("stock_count_sessions")
    .select("id, count_date")
    .eq("status", "Completed")
    .is("deleted_at", null);
  if (!sessions || sessions.length === 0) return {};

  const sessionDateById: Record<string, string> = {};
  // deno-lint-ignore no-explicit-any
  for (const s of sessions as any[]) sessionDateById[s.id] = s.count_date;

  const { data: lines } = await supabase
    .from("stock_count_lines")
    .select("session_id, sku_id, physical_qty, type")
    .eq("type", type)
    .not("physical_qty", "is", null)
    // deno-lint-ignore no-explicit-any
    .in("session_id", (sessions as any[]).map((s) => s.id));

  const map: Record<string, { physical_qty: number; count_date: string }> = {};
  // deno-lint-ignore no-explicit-any
  for (const l of (lines || []) as any[]) {
    const date = sessionDateById[l.session_id];
    if (!date) continue;
    const existing = map[l.sku_id];
    if (!existing || date > existing.count_date) {
      map[l.sku_id] = { physical_qty: Number(l.physical_qty), count_date: date };
    }
  }
  return map;
}

// Total CK-level stock value for one SKU type (active SKUs only), clamped at 0 per
// SKU (CLAUDE.md: monetary/value cells never go negative). SKUs with no completed
// stock-count anchor yet are treated as 0 — matches the live pages' behaviour of
// showing nothing meaningful until the first physical count exists.
export async function computeCkStockValueByType(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  type: "RM" | "PK" | "SM",
): Promise<number> {
  const { data: skus } = await supabase
    .from("skus")
    .select("id, converter")
    .eq("type", type)
    .eq("status", "Active");
  const skuList = (skus || []) as Array<{ id: string; converter: number | null }>;
  if (skuList.length === 0) return 0;
  const skuIds = skuList.map((s) => s.id);

  const anchorMap = await getAnchorMap(supabase, type);

  const { data: priceRows } = await supabase
    .from("prices")
    .select("sku_id, price_per_usage_uom")
    .eq("is_active", true)
    .in("sku_id", skuIds)
    .order("created_at", { ascending: false })
    .order("id");
  // The standard: newest active price (one per supplier can be active)
  const priceBySkuId: Record<string, number> = {};
  // deno-lint-ignore no-explicit-any
  for (const p of (priceRows || []) as any[]) if (!(p.sku_id in priceBySkuId)) priceBySkuId[p.sku_id] = Number(p.price_per_usage_uom) || 0;

  const { data: adjustments } = await supabase
    .from("stock_adjustments")
    .select("sku_id, adjustment_date, quantity, reason")
    .eq("stock_type", type)
    .is("branch_id", null)
    .in("sku_id", skuIds);
  const adjList = (adjustments || []) as Array<{ sku_id: string; adjustment_date: string; quantity: number; reason: string }>;

  let totalValue = 0;

  if (type === "SM") {
    const { data: production } = await supabase
      .from("production_records")
      .select("sm_sku_id, actual_output_g, production_date")
      .in("sm_sku_id", skuIds);
    const prodList = (production || []) as Array<{ sm_sku_id: string; actual_output_g: number; production_date: string }>;

    const { data: toRows } = await supabase
      .from("transfer_orders")
      .select("id, status, delivery_date")
      .in("status", TO_DELIVERED_STATUSES);
    const toDateMap: Record<string, string> = {};
    const toStatusMap: Record<string, string> = {};
    // deno-lint-ignore no-explicit-any
    for (const t of (toRows || []) as any[]) {
      toDateMap[t.id] = t.delivery_date;
      toStatusMap[t.id] = t.status;
    }
    const toIds = Object.keys(toDateMap);
    let toLines: Array<{ to_id: string; sku_id: string; actual_qty: number; planned_qty: number }> = [];
    if (toIds.length > 0) {
      const { data } = await supabase
        .from("transfer_order_lines")
        .select("to_id, sku_id, actual_qty, planned_qty")
        .in("to_id", toIds)
        .in("sku_id", skuIds);
      toLines = data || [];
    }

    for (const sku of skuList) {
      const anchor = anchorMap[sku.id];
      if (!anchor) continue;
      const skuAdjustments = adjList.filter((a) => a.sku_id === sku.id);

      const producedAfter = prodList
        .filter((p) => p.sm_sku_id === sku.id && p.production_date > anchor.count_date)
        .reduce((sum, p) => sum + Number(p.actual_output_g), 0);
      const deliveredAfter = toLines
        .filter((l) => l.sku_id === sku.id && toDateMap[l.to_id] > anchor.count_date)
        .reduce((sum, l) => sum + computeToLineQty(Number(l.actual_qty), Number(l.planned_qty), toStatusMap[l.to_id]), 0);
      const netAdjustment = skuAdjustments
        .filter((a) => a.adjustment_date > anchor.count_date && !String(a.reason ?? "").startsWith("Stock Count"))
        .reduce((sum, a) => sum + Number(a.quantity), 0);
      const currentStock = anchor.physical_qty + producedAfter - deliveredAfter + netAdjustment;

      totalValue += Math.max(0, currentStock * (priceBySkuId[sku.id] || 0));
    }
  } else {
    const { data: receipts } = await supabase
      .from("goods_receipts")
      .select("sku_id, quantity_received, receipt_date")
      .in("sku_id", skuIds);
    const receiptList = (receipts || []) as Array<{ sku_id: string; quantity_received: number; receipt_date: string }>;

    for (const sku of skuList) {
      const anchor = anchorMap[sku.id];
      if (!anchor) continue;
      const skuAdjustments = adjList.filter((a) => a.sku_id === sku.id);
      const converter = Number(sku.converter) || 1;

      const receivedAfter = receiptList
        .filter((r) => r.sku_id === sku.id && r.receipt_date > anchor.count_date)
        .reduce((sum, r) => sum + Number(r.quantity_received) * converter, 0);
      const netAdjustment = skuAdjustments
        .filter((a) => a.adjustment_date > anchor.count_date && !String(a.reason ?? "").startsWith("Stock Count"))
        .reduce((sum, a) => sum + Number(a.quantity), 0);
      const currentStock = anchor.physical_qty + receivedAfter + netAdjustment;

      totalValue += Math.max(0, currentStock * (priceBySkuId[sku.id] || 0));
    }
  }

  return totalValue;
}
