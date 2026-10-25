import { supabase } from "@/integrations/supabase/client";
import type { SKU } from "@/types/sku";
import { TO_DELIVERED_STATUSES, computeToLineQty } from "@/lib/to-line-qty";
import { countDayEvents, countNets, type CountDayEvent, type CountNets, type StockMove } from "@/lib/count-anchor";
import { fetchAllRows } from "@/lib/fetch-all";
import { kitchenStockForSkus } from "@/lib/kitchen-stock";

export interface CountDay {
  /** The count day's movements, one row each (asked about before finishing) */
  events: CountDayEvent[];
  /** Per-SKU net movement on and after the count day (to compare the count fairly) */
  nets: CountNets;
  /** Kitchen stock now per SKU, read from the database alongside the movements */
  systemNow: Record<string, number>;
}

/**
 * Everything that moved in the central kitchen from a count day on (receipts,
 * transfers, production, adjustments) and the kitchen stock now, read-only and
 * together so the two hold the same movements. Returns null if a read failed (then
 * the count isn't held up by the question).
 */
export async function loadCountDay(date: string, skus: SKU[], skuIds: string[]): Promise<CountDay | null> {
  const skuMap = new Map(skus.map((s) => [s.id, s]));
  const skuOf = (id: string) => skuMap.get(id);
  const [systemNow, gr, sup, to, prod, adj] = await Promise.all([
    kitchenStockForSkus(skus, skuIds).catch(() => null),
    fetchAllRows<any>((f, t) => supabase.from("goods_receipts").select("id, sku_id, quantity_received, receipt_date, supplier_id, created_at").gte("receipt_date", date).order("id").range(f, t)),
    supabase.from("suppliers").select("id, name").order("id"),
    fetchAllRows<any>((f, t) =>
      supabase
        .from("transfer_orders")
        .select("id, to_number, delivery_date, sent_at, updated_at, status, branches(branch_name), transfer_order_lines(sku_id, sku_type, actual_qty, planned_qty)")
        .gte("delivery_date", date)
        .in("status", [...TO_DELIVERED_STATUSES])
        .order("id")
        .range(f, t),
    ),
    fetchAllRows<any>((f, t) => supabase.from("production_records").select("id, sm_sku_id, actual_output_g, production_date, created_at").gte("production_date", date).order("id").range(f, t)),
    fetchAllRows<any>((f, t) =>
      supabase.from("stock_adjustments").select("id, sku_id, quantity, reason, stock_type, adjustment_date, created_at").gte("adjustment_date", date).is("branch_id", null).order("id").range(f, t),
    ),
  ]);
  if (!systemNow || gr.error || sup.error || to.error || prod.error || adj.error) return null;
  const supplierName = new Map((sup.data ?? []).map((s) => [s.id, s.name]));
  const grRows = gr.data ?? [];
  const toRows = to.data ?? [];
  const prodRows = prod.data ?? [];
  const adjRows = adj.data ?? [];

  // Same sums as kitchen-stock.ts: receipts × converter, SM out by transfer lines
  // (RM/PK leave through their "Distribution:" adjustments), adjustments of the
  // SKU's own stock type, count adjustments left out
  const moves: StockMove[] = [
    ...grRows.map((r) => ({ skuId: r.sku_id, date: r.receipt_date, qty: Number(r.quantity_received) * (skuOf(r.sku_id)?.converter ?? 1) })),
    ...toRows.flatMap((t) =>
      (t.transfer_order_lines ?? [])
        .filter((l: any) => skuOf(l.sku_id)?.type === "SM")
        .map((l: any) => ({ skuId: l.sku_id, date: t.delivery_date, qty: -computeToLineQty(Number(l.actual_qty), Number(l.planned_qty), t.status) })),
    ),
    ...prodRows.map((p) => ({ skuId: p.sm_sku_id, date: p.production_date, qty: Number(p.actual_output_g) })),
    ...adjRows
      .filter((a) => !(a.reason ?? "").includes("Stock Count") && (skuOf(a.sku_id)?.type === "SM" ? a.stock_type === "SM" : a.stock_type === "RM" || a.stock_type === "PK"))
      .map((a) => ({ skuId: a.sku_id, date: a.adjustment_date, qty: Number(a.quantity) })),
  ];

  const events = countDayEvents({
    receipts: grRows.filter((r) => r.receipt_date === date).map((r) => ({ supplier: supplierName.get(r.supplier_id ?? "") ?? "ไม่ระบุร้าน", createdAt: r.created_at })),
    deliveries: toRows
      .filter((t) => t.delivery_date === date)
      .map((t) => ({ toNumber: t.to_number, branch: t.branches?.branch_name ?? "สาขา", lines: (t.transfer_order_lines ?? []).length, sentAt: t.sent_at ?? t.updated_at })),
    production: prodRows.filter((p) => p.production_date === date).map((p) => ({ name: skuOf(p.sm_sku_id)?.name ?? "", grams: Number(p.actual_output_g), createdAt: p.created_at })),
    adjustments: adjRows
      .filter((a) => a.adjustment_date === date)
      .map((a) => {
        const sku = skuOf(a.sku_id);
        return { name: sku?.name ?? "", quantity: Number(a.quantity), unit: sku?.usageUom ?? "", reason: a.reason ?? "", createdAt: a.created_at };
      }),
  });
  return { events, nets: countNets(moves, date), systemNow };
}
