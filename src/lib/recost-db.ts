import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetch-all";
import { BOM_PRICE_NOTE, BOM_SUPPLIER_ID } from "@/lib/bom-price-sync";
import { toLocalDateStr } from "@/lib/utils";
import { affectedRecipes, recipeItemIds, recost, type RecipeBook } from "@/lib/cost-engine";

/** Every recipe in the system, read fresh (paged) */
export async function loadRecipeBook(): Promise<RecipeBook | null> {
  const [h, l, s, b, sp] = await Promise.all([
    fetchAllRows<any>((f, t) => supabase.from("bom_headers").select("id, sm_sku_id, bom_mode, batch_size, yield_percent").order("id").range(f, t)),
    fetchAllRows<any>((f, t) => supabase.from("bom_lines").select("bom_header_id, rm_sku_id, qty_per_batch, yield_percent, step_id, qty_type, percent_of_input").order("id").range(f, t)),
    fetchAllRows<any>((f, t) => supabase.from("bom_steps").select("id, bom_header_id, step_number, yield_percent").order("id").range(f, t)),
    fetchAllRows<any>((f, t) => supabase.from("bom_byproducts").select("bom_header_id, sku_id, output_qty, cost_allocation_pct, tracks_inventory").order("id").range(f, t)),
    fetchAllRows<any>((f, t) => supabase.from("sp_bom").select("sp_sku_id, ingredient_sku_id, qty_per_batch, batch_yield_qty").order("id").range(f, t)),
  ]);
  if (h.error || l.error || s.error || b.error || sp.error) return null;
  return {
    headers: h.data.map((r) => ({ id: r.id, smSkuId: r.sm_sku_id, bomMode: r.bom_mode, batchSize: Number(r.batch_size), yieldPercent: Number(r.yield_percent) })),
    lines: l.data.map((r) => ({
      bomHeaderId: r.bom_header_id,
      rmSkuId: r.rm_sku_id,
      qtyPerBatch: Number(r.qty_per_batch),
      yieldPercent: r.yield_percent === null ? null : Number(r.yield_percent),
      stepId: r.step_id,
      qtyType: r.qty_type,
      percentOfInput: r.percent_of_input === null ? null : Number(r.percent_of_input),
    })),
    steps: s.data.map((r) => ({ id: r.id, bomHeaderId: r.bom_header_id, stepNumber: Number(r.step_number), yieldPercent: Number(r.yield_percent) })),
    byproducts: b.data.map((r) => ({ bomHeaderId: r.bom_header_id, skuId: r.sku_id, outputQty: Number(r.output_qty), costAllocationPct: Number(r.cost_allocation_pct), tracksInventory: !!r.tracks_inventory })),
    spLines: sp.data.map((r) => ({ spSkuId: r.sp_sku_id, ingredientSkuId: r.ingredient_sku_id, qtyPerBatch: Number(r.qty_per_batch), batchYieldQty: Number(r.batch_yield_qty) })),
  };
}

/** Today's price per usage unit for every item that has one */
export async function loadActivePrices(): Promise<Map<string, number> | null> {
  // Newest first, the same pick as every screen (prices.find(isActive) on a newest-first list)
  const { data, error } = await fetchAllRows<any>((f, t) =>
    supabase.from("prices").select("sku_id, price_per_usage_uom").eq("is_active", true).order("created_at", { ascending: false }).order("id").range(f, t),
  );
  if (error) return null;
  const map = new Map<string, number>();
  for (const p of data) if (!map.has(p.sku_id)) map.set(p.sku_id, Number(p.price_per_usage_uom));
  return map;
}

export interface RecostResult {
  /** Recipe items whose cost moved: old → new per usage unit */
  changed: { skuId: string; from: number; to: number }[];
  ok: boolean;
}

/**
 * After a price or recipe changes, work every recipe cost out again from today's
 * prices and save the ones that moved (as their "BOM Calculation" price). All of them,
 * not only those built on the change: a recipe whose ingredient was never costed (or
 * fell behind) would otherwise be worked out from a stale number. Menus and food cost
 * read those prices, so they follow on their own. (`changedSkuIds` is what triggered it.)
 */
export async function recostAndSave(changedSkuIds: string[]): Promise<RecostResult> {
  void changedSkuIds;
  const [book, prices] = await Promise.all([loadRecipeBook(), loadActivePrices()]);
  if (!book || !prices) return { changed: [], ok: false };
  const next = recost(recipeItemIds(book), book, prices);
  const changed = [...next]
    .map(([skuId, to]) => ({ skuId, from: prices.get(skuId) ?? 0, to }))
    .filter((c) => Math.abs(c.to - c.from) > 1e-9 * Math.max(1, Math.abs(c.from)));
  let ok = true;
  for (const c of changed) if (!(await saveRecipeCost(c.skuId, c.to))) ok = false;
  return { changed, ok };
}

/**
 * Store a recipe item's cost as its one active price: the "BOM Calculation" row is
 * updated (or added), then any other active price of the item is switched off, so a
 * recipe-made item always has exactly one. False if a save failed.
 */
export async function saveRecipeCost(skuId: string, costPerUnit: number): Promise<boolean> {
  const today = toLocalDateStr(new Date());
  const { data: existing, error } = await supabase
    .from("prices")
    .select("id")
    .eq("sku_id", skuId)
    .eq("supplier_id", BOM_SUPPLIER_ID)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) return false;
  let keepId: string;
  if (existing?.length) {
    keepId = existing[0].id;
    const { error: e } = await supabase
      .from("prices")
      .update({ price_per_purchase_uom: 0, price_per_usage_uom: costPerUnit, effective_date: today, note: BOM_PRICE_NOTE })
      .eq("id", keepId);
    if (e) return false;
  } else {
    const { data: row, error: e } = await supabase
      .from("prices")
      .insert({ sku_id: skuId, supplier_id: BOM_SUPPLIER_ID, price_per_purchase_uom: 0, price_per_usage_uom: costPerUnit, vat: false, is_active: true, effective_date: today, note: BOM_PRICE_NOTE })
      .select("id")
      .single();
    if (e || !row) return false;
    keepId = row.id;
  }
  // Under a lock in the database when the function exists (two people at once)
  const { error: rpcError } = await supabase.rpc("keep_only_active_price" as never, { p_sku: skuId, p_supplier: null, p_keep: keepId } as never);
  if (!rpcError) return true;
  const { error: off } = await supabase.from("prices").update({ is_active: false }).eq("sku_id", skuId).eq("is_active", true).neq("id", keepId);
  return !off;
}

/** What a change to these items reaches: recipe items (in order) and menus */
export async function impactOf(skuIds: string[]): Promise<{ recipes: string[]; menuIds: string[] } | null> {
  const book = await loadRecipeBook();
  if (!book) return null;
  const recipes = affectedRecipes(skuIds, book);
  const reach = [...new Set([...skuIds, ...recipes])];
  const { data, error } = await fetchAllRows<any>((f, t) => supabase.from("menu_bom").select("menu_id, sku_id").in("sku_id", reach).order("id").range(f, t));
  if (error) return null;
  return { recipes: recipes.filter((r) => !skuIds.includes(r)), menuIds: [...new Set(data.map((r) => r.menu_id))] };
}
