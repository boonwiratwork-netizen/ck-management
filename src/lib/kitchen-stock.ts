import { supabase } from "@/integrations/supabase/client";
import type { SKU } from "@/types/sku";
import { fetchAllRows } from "@/lib/fetch-all";
import { afterCount, producedAfterCount, type CountAnchor } from "@/lib/count-anchor";

/**
 * The kitchen's current stock per SKU (SM / RM / PK), moved here unchanged from the
 * old Transfer Order page: physical count anchor + production/receipts after it −
 * deliveries after it + non-"Stock Count" adjustments after it (opening + totals when
 * there is no count yet). Same formula as the SM/RM/PK Stock pages. Reads are
 * paged: the old page read only the first 1,000 delivery lines, so stock drifted up
 * as history grew. Used for the
 * "ในครัวเหลือ" warning and to hide lots that are already used up — never to write.
 */
export async function kitchenStockForSkus(skus: SKU[], skuIdsInput: string[]): Promise<Record<string, number>> {
  const currentStockMap: Record<string, number> = {};
  if (skuIdsInput.length === 0) return currentStockMap;

  const smSkuIds = skuIdsInput.filter((id) => skus.find((s) => s.id === id)?.type === "SM");
  const rmPkSkuIds = skuIdsInput.filter((id) => {
    const t = skus.find((s) => s.id === id)?.type;
    return t === "RM" || t === "PK";
  });

  const { data: sessions } = await fetchAllRows<any>((f, t) =>
    supabase
      .from("stock_count_sessions")
      .select("id, count_date, completed_at, count_timing")
      .eq("status", "Completed")
      .is("deleted_at", null)
      .order("id")
      .range(f, t),
  );
  const sessionIds = (sessions || []).map((s: any) => s.id);
  const sessionDateMap: Record<string, string> = {};
  const sessionAnchorMap: Record<string, CountAnchor> = {};
  for (const s of sessions || []) {
    sessionDateMap[s.id] = s.count_date;
    sessionAnchorMap[s.id] = { count_date: s.count_date, completed_at: s.completed_at, timing: s.count_timing };
  }

  // ── SM ──
  if (smSkuIds.length > 0) {
    const { data: prodData } = await fetchAllRows<any>((f, t) =>
      supabase
        .from("production_records")
        .select("sm_sku_id, production_date, actual_output_g, created_at")
        .in("sm_sku_id", smSkuIds)
        .order("id")
        .range(f, t),
    );
    const bySkuRecords: Record<string, { actualOutputG: number; createdAt: string; productionDate: string }[]> = {};
    for (const r of prodData || []) {
      if (!bySkuRecords[r.sm_sku_id]) bySkuRecords[r.sm_sku_id] = [];
      bySkuRecords[r.sm_sku_id].push({
        actualOutputG: r.actual_output_g,
        createdAt: r.created_at,
        productionDate: r.production_date,
      });
    }

    const anchorMap: Record<string, { physical_qty: number } & CountAnchor> = {};
    if (sessionIds.length > 0) {
      const { data: lines } = await fetchAllRows<any>((f, t) =>
        supabase
          .from("stock_count_lines")
          .select("sku_id, physical_qty, session_id")
          .in("session_id", sessionIds)
          .eq("type", "SM")
          .in("sku_id", smSkuIds)
          .not("physical_qty", "is", null)
          .order("id")
          .range(f, t),
      );
      for (const row of lines || []) {
        const countDate = sessionDateMap[row.session_id];
        if (!countDate) continue;
        const existing = anchorMap[row.sku_id];
        if (!existing || countDate > existing.count_date) {
          anchorMap[row.sku_id] = { physical_qty: row.physical_qty, ...sessionAnchorMap[row.session_id] };
        }
      }
    }

    const { data: toLineRows } = await fetchAllRows<any>((f, t) =>
      supabase
        .from("transfer_order_lines")
        .select("sku_id, planned_qty, actual_qty, to_id")
        .in("sku_id", smSkuIds)
        .order("id")
        .range(f, t),
    );
    const { data: toRows } = await fetchAllRows<any>((f, t) =>
      supabase
        .from("transfer_orders")
        .select("id, status, delivery_date, sent_at")
        .in("status", ["Sent", "Received", "Partially Received"])
        .order("id")
        .range(f, t),
    );
    const validToIds = new Set((toRows || []).map((t: any) => t.id));
    const toStatusMap: Record<string, string> = {};
    const toDateMap: Record<string, string> = {};
    const toSentAtMap: Record<string, string> = {};
    for (const t of toRows || []) {
      toStatusMap[t.id] = t.status;
      toDateMap[t.id] = t.delivery_date;
      toSentAtMap[t.id] = t.sent_at;
    }
    const deliveredBySku: Record<string, { qty: number; date: string; sentAt?: string }[]> = {};
    for (const l of toLineRows || []) {
      if (!validToIds.has(l.to_id)) continue;
      const qty = l.actual_qty > 0 ? l.actual_qty : toStatusMap[l.to_id] === "Sent" ? l.planned_qty : 0;
      if (!deliveredBySku[l.sku_id]) deliveredBySku[l.sku_id] = [];
      deliveredBySku[l.sku_id].push({ qty, date: toDateMap[l.to_id], sentAt: toSentAtMap[l.to_id] });
    }

    const { data: adjRows } = await fetchAllRows<any>((f, t) =>
      supabase
        .from("stock_adjustments")
        .select("sku_id, quantity, adjustment_date, reason, created_at")
        .eq("stock_type", "SM")
        .is("branch_id", null)
        .in("sku_id", smSkuIds)
        .order("id")
        .range(f, t),
    );

    const { data: openingRows } = await supabase
      .from("stock_opening_balances")
      .select("sku_id, quantity")
      .in("sku_id", smSkuIds);
    const openingMap: Record<string, number> = {};
    for (const o of openingRows || []) openingMap[o.sku_id] = o.quantity;

    for (const skuId of smSkuIds) {
      const anchor = anchorMap[skuId];
      const produced = bySkuRecords[skuId] || [];
      if (anchor) {
        const producedAfter = produced
          .filter((r) => producedAfterCount(anchor, r.productionDate, r.createdAt))
          .reduce((sum, r) => sum + r.actualOutputG, 0);
        const deliveredAfter = (deliveredBySku[skuId] || [])
          .filter((d) => afterCount(anchor, d.date, d.sentAt))
          .reduce((sum, d) => sum + d.qty, 0);
        const adjustmentsAfter = (adjRows || [])
          .filter(
            (a: any) =>
              a.sku_id === skuId && afterCount(anchor, a.adjustment_date, a.created_at) && !a.reason.includes("Stock Count"),
          )
          .reduce((sum, a: any) => sum + a.quantity, 0);
        currentStockMap[skuId] = anchor.physical_qty + producedAfter - deliveredAfter + adjustmentsAfter;
      } else {
        const totalProduced = produced.reduce((sum, r) => sum + r.actualOutputG, 0);
        const totalDelivered = (deliveredBySku[skuId] || []).reduce((sum, d) => sum + d.qty, 0);
        const netAdjustment = (adjRows || [])
          .filter((a: any) => a.sku_id === skuId)
          .reduce((sum, a: any) => sum + a.quantity, 0);
        currentStockMap[skuId] = (openingMap[skuId] || 0) + totalProduced - totalDelivered + netAdjustment;
      }
    }
  }

  // ── RM/PK ── same anchor formula as RMStock/PKStock pages (use-stock-data.ts /
  // use-pk-stock-data.ts), scoped to just the requested SKUs.
  if (rmPkSkuIds.length > 0) {
    const { data: rmPkAnchorLines } = await fetchAllRows<any>((f, t) =>
      supabase
        .from("stock_count_lines")
        .select("sku_id, physical_qty, session_id, type")
        .in("session_id", sessionIds)
        .in("type", ["RM", "PK"])
        .in("sku_id", rmPkSkuIds)
        .not("physical_qty", "is", null)
        .order("id")
        .range(f, t),
    );
    const rmPkAnchorMap: Record<string, { physical_qty: number } & CountAnchor> = {};
    for (const row of rmPkAnchorLines || []) {
      const countDate = sessionDateMap[row.session_id];
      if (!countDate) continue;
      const existing = rmPkAnchorMap[row.sku_id];
      if (!existing || countDate > existing.count_date) {
        rmPkAnchorMap[row.sku_id] = { physical_qty: row.physical_qty, ...sessionAnchorMap[row.session_id] };
      }
    }

    const { data: receiptRows } = await fetchAllRows<any>((f, t) =>
      supabase
        .from("goods_receipts")
        .select("sku_id, quantity_received, receipt_date, created_at")
        .in("sku_id", rmPkSkuIds)
        .order("id")
        .range(f, t),
    );

    const { data: rmPkAdjRows } = await fetchAllRows<any>((f, t) =>
      supabase
        .from("stock_adjustments")
        .select("sku_id, quantity, adjustment_date, reason, stock_type, created_at")
        .in("stock_type", ["RM", "PK"])
        .is("branch_id", null)
        .in("sku_id", rmPkSkuIds)
        .order("id")
        .range(f, t),
    );

    const { data: rmPkOpeningRows } = await supabase
      .from("stock_opening_balances")
      .select("sku_id, quantity")
      .in("sku_id", rmPkSkuIds);
    const rmPkOpeningMap: Record<string, number> = {};
    for (const o of rmPkOpeningRows || []) rmPkOpeningMap[o.sku_id] = o.quantity;

    for (const skuId of rmPkSkuIds) {
      const converter = skus.find((s) => s.id === skuId)?.converter ?? 1;
      const anchor = rmPkAnchorMap[skuId];
      if (anchor) {
        const receivedAfter = (receiptRows || [])
          .filter((r) => r.sku_id === skuId && afterCount(anchor, r.receipt_date, r.created_at))
          .reduce((sum, r) => sum + r.quantity_received * converter, 0);
        const adjustmentsAfter = (rmPkAdjRows || [])
          .filter(
            (a: any) =>
              a.sku_id === skuId && afterCount(anchor, a.adjustment_date, a.created_at) && !a.reason.includes("Stock Count"),
          )
          .reduce((sum, a: any) => sum + a.quantity, 0);
        currentStockMap[skuId] = anchor.physical_qty + receivedAfter + adjustmentsAfter;
      } else {
        const totalReceived = (receiptRows || [])
          .filter((r) => r.sku_id === skuId)
          .reduce((sum, r) => sum + r.quantity_received * converter, 0);
        const netAdjustment = (rmPkAdjRows || [])
          .filter((a: any) => a.sku_id === skuId)
          .reduce((sum, a: any) => sum + a.quantity, 0);
        currentStockMap[skuId] = Math.max(0, rmPkOpeningMap[skuId] || 0) + totalReceived + netAdjustment;
      }
    }
  }

  return currentStockMap;
}
