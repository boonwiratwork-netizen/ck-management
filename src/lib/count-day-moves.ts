import { supabase } from "@/integrations/supabase/client";
import type { SKU } from "@/types/sku";
import { TO_DELIVERED_STATUSES } from "@/lib/to-line-qty";
import { countDayEvents, type CountDayEvent } from "@/lib/count-anchor";

/**
 * Everything that moved in the central kitchen on a count day (receipts, transfers
 * sent, production, manual adjustments), for the "were these in the fridge when you
 * counted?" question. Read-only. Returns null if a read failed (then the count
 * isn't held up by the question).
 */
export async function loadCountDayEvents(date: string, skuOf: (id: string) => SKU | undefined): Promise<CountDayEvent[] | null> {
  const [gr, sup, to, prod, adj] = await Promise.all([
    supabase.from("goods_receipts").select("id, supplier_id, created_at").eq("receipt_date", date).order("id"),
    supabase.from("suppliers").select("id, name").order("id"),
    supabase
      .from("transfer_orders")
      .select("id, to_number, sent_at, updated_at, status, branches(branch_name), transfer_order_lines(id)")
      .eq("delivery_date", date)
      .in("status", [...TO_DELIVERED_STATUSES])
      .order("id"),
    supabase.from("production_records").select("id, sm_sku_id, actual_output_g, created_at").eq("production_date", date).order("id"),
    supabase.from("stock_adjustments").select("id, sku_id, quantity, reason, created_at").eq("adjustment_date", date).is("branch_id", null).order("id"),
  ]);
  if (gr.error || sup.error || to.error || prod.error || adj.error) return null;
  const supplierName = new Map((sup.data ?? []).map((s) => [s.id, s.name]));
  return countDayEvents({
    receipts: (gr.data ?? []).map((r) => ({ supplier: supplierName.get(r.supplier_id ?? "") ?? "ไม่ระบุร้าน", createdAt: r.created_at })),
    deliveries: (to.data ?? []).map((t: any) => ({ toNumber: t.to_number, branch: t.branches?.branch_name ?? "สาขา", lines: (t.transfer_order_lines ?? []).length, sentAt: t.sent_at ?? t.updated_at })),
    production: (prod.data ?? []).map((p) => ({ name: skuOf(p.sm_sku_id)?.name ?? "", grams: Number(p.actual_output_g), createdAt: p.created_at })),
    adjustments: (adj.data ?? []).map((a) => {
      const sku = skuOf(a.sku_id);
      return { name: sku?.name ?? "", quantity: Number(a.quantity), unit: sku?.usageUom ?? "", reason: a.reason ?? "", createdAt: a.created_at };
    }),
  });
}
