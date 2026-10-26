import { supabase } from "@/integrations/supabase/client";
import { canUndo, undoPlan, type ChangeRow } from "@/lib/change-history";

/**
 * One product's history: its own row, its prices, and its recipe (lines + header, or
 * SP lines). Newest first, the last 100. Also who did it (profile names).
 */
export async function loadProductHistory(skuId: string, headerId: string | null): Promise<{ rows: ChangeRow[]; who: Map<string, string> } | null> {
  const ors = [
    `and(table_name.eq.skus,row_id.eq.${skuId})`,
    `and(table_name.eq.prices,new_row->>sku_id.eq.${skuId})`,
    `and(table_name.eq.prices,old_row->>sku_id.eq.${skuId})`,
    `and(table_name.eq.sp_bom,new_row->>sp_sku_id.eq.${skuId})`,
    `and(table_name.eq.sp_bom,old_row->>sp_sku_id.eq.${skuId})`,
    ...(headerId
      ? [`and(table_name.eq.bom_headers,row_id.eq.${headerId})`, `and(table_name.eq.bom_lines,new_row->>bom_header_id.eq.${headerId})`, `and(table_name.eq.bom_lines,old_row->>bom_header_id.eq.${headerId})`]
      : []),
  ];
  const { data, error } = await supabase.from("change_log" as never).select("*").or(ors.join(",")).order("id", { ascending: false }).limit(100);
  if (error) return null;
  const rows = (data ?? []) as unknown as ChangeRow[];
  const ids = [...new Set(rows.map((r) => r.changed_by).filter((x): x is string => !!x))];
  const who = new Map<string, string>();
  if (ids.length) {
    const { data: people } = await supabase.from("profiles").select("user_id, full_name").in("user_id", ids);
    for (const p of people ?? []) who.set(p.user_id, p.full_name);
  }
  return { rows, who };
}

/**
 * Put one non-price change back (product fields, recipe lines and header, SP lines),
 * or delete a new price that replaced nothing. Refused (with the reason) if the row
 * was changed again since. Other price changes are undone as "set the old price"
 * through the normal price save (see priceToRestore).
 */
export async function undoChange(row: ChangeRow): Promise<{ ok: boolean; why?: string }> {
  const table = row.table_name as "skus";
  const id = row.row_id ?? "";
  const { data: current, error } = await supabase.from(table).select("*").eq("id", id).maybeSingle();
  if (error) return { ok: false, why: error.message };
  const check = canUndo(row, current as Record<string, unknown> | null);
  if (!check.ok) return check;
  const plan = undoPlan(row);
  // A deleted SP line comes back with the recipe's batch yield as it is now (it is
  // stored on every line; an old value would split the recipe)
  if (plan.kind === "insert" && row.table_name === "sp_bom") {
    const { data: sibling } = await supabase.from("sp_bom").select("batch_yield_qty, batch_yield_uom").eq("sp_sku_id", String(plan.values.sp_sku_id)).limit(1);
    if (sibling?.length) Object.assign(plan.values, sibling[0]);
  }
  const res =
    plan.kind === "update"
      ? await supabase.from(table).update(plan.patch as never).eq("id", id)
      : plan.kind === "delete"
        ? await supabase.from(table).delete().eq("id", id)
        : await supabase.from(table).insert(plan.values as never);
  return res.error ? { ok: false, why: res.error.message } : { ok: true };
}
