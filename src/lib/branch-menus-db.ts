import { supabase } from "@/integrations/supabase/client";
import { fetchAllRowsOrThrow } from "@/lib/fetch-all";

/**
 * The branch's brand and that brand's active menus, read side by side: every active menu
 * comes with its brand and the branch's own is picked here (it was "which brand?" → "its
 * menus" → …, one round after another). null = no such branch.
 */
export async function brandMenuIds(branchId: string): Promise<{ brandName: string; menuIds: string[] } | null> {
  // Every active menu, paged (a failed page fails the read: a short list would drop products)
  const [{ data: branch }, menus] = await Promise.all([
    supabase.from("branches").select("brand_name").eq("id", branchId).single(),
    fetchAllRowsOrThrow<{ id: string; brand_name: string | null }>((a, b) => supabase.from("menus").select("id, brand_name").eq("status", "Active").order("id").range(a, b)),
  ]);
  if (!branch) return null;
  return { brandName: branch.brand_name, menuIds: menusOfBrand(menus, branch.brand_name) };
}

/** The ids of one brand's menus (the list is already only the active ones) */
export function menusOfBrand(menus: { id: string; brand_name: string | null }[], brandName: string): string[] {
  return menus.filter((m) => m.brand_name === brandName).map((m) => m.id);
}
