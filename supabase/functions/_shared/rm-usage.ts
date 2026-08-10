// Sales-driven RM usage, mirroring src/hooks/use-branch-rm-stock.ts's formula but
// scoped to one target SKU + one target date (instead of a rolling 7-day average)
// and looped across branches instead of one branch. Do not fork this logic — if the
// BOM/modifier-rule formula changes, update both places.

// deno-lint-ignore no-explicit-any
export async function computeRmUsageForBranchDate(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  branchId: string,
  brandName: string,
  targetSkuId: string,
  targetDate: string,
): Promise<number> {
  const [menusRes, overridesRes] = await Promise.all([
    supabase.from("menus").select("id, menu_code").eq("brand_name", brandName).eq("status", "Active"),
    supabase.from("branch_menu_overrides").select("menu_id").eq("branch_id", branchId).eq("is_active", false),
  ]);
  // deno-lint-ignore no-explicit-any
  const suppressed = new Set((overridesRes.data || []).map((o: any) => o.menu_id));
  // deno-lint-ignore no-explicit-any
  const menus = (menusRes.data || []).filter((m: any) => !suppressed.has(m.id));
  if (menus.length === 0) return 0;

  const { data: salesRows } = await supabase
    .from("sales_entries")
    .select("menu_code, menu_name, qty")
    .eq("branch_id", branchId)
    .eq("sale_date", targetDate);
  if (!salesRows || salesRows.length === 0) return 0;

  const menuIdByCode: Record<string, string> = {};
  // deno-lint-ignore no-explicit-any
  for (const m of menus as any[]) menuIdByCode[m.menu_code] = m.id;

  const qtySoldByMenuId: Record<string, number> = {};
  // deno-lint-ignore no-explicit-any
  for (const s of salesRows as any[]) {
    const mid = menuIdByCode[s.menu_code];
    if (!mid) continue;
    qtySoldByMenuId[mid] = (qtySoldByMenuId[mid] || 0) + Number(s.qty);
  }
  const soldMenuIds = Object.keys(qtySoldByMenuId);
  if (soldMenuIds.length === 0) return 0;

  const { data: bomRows } = await supabase
    .from("menu_bom")
    .select("menu_id, sku_id, effective_qty")
    .in("menu_id", soldMenuIds)
    .or(`branch_id.is.null,branch_id.eq.${branchId}`);

  let total = 0;
  const spSkuIds = new Set<string>();
  // deno-lint-ignore no-explicit-any
  for (const bom of (bomRows || []) as any[]) {
    const soldQty = qtySoldByMenuId[bom.menu_id] || 0;
    if (soldQty === 0) continue;
    if (bom.sku_id === targetSkuId) {
      total += soldQty * Number(bom.effective_qty);
    } else {
      spSkuIds.add(bom.sku_id); // may be an SP item routed to the target RM via sp_bom
    }
  }

  if (spSkuIds.size > 0) {
    const { data: spBomRows } = await supabase
      .from("sp_bom")
      .select("sp_sku_id, ingredient_sku_id, qty_per_batch, batch_yield_qty")
      .in("sp_sku_id", [...spSkuIds])
      .eq("ingredient_sku_id", targetSkuId);
    // deno-lint-ignore no-explicit-any
    for (const sp of (spBomRows || []) as any[]) {
      const batchYield = Number(sp.batch_yield_qty) || 1;
      // deno-lint-ignore no-explicit-any
      for (const bom of (bomRows || []) as any[]) {
        if (bom.sku_id !== sp.sp_sku_id) continue;
        const soldQty = qtySoldByMenuId[bom.menu_id] || 0;
        total += soldQty * Number(bom.effective_qty) * (Number(sp.qty_per_batch) / batchYield);
      }
    }
  }

  // Modifier rules (submenu / swap / add) — same matching rules as elsewhere:
  // submenu -> sale.menu_code === rule.keyword; swap/add -> menu_name.includes(keyword)
  const [modRulesRes, modRuleMenusRes] = await Promise.all([
    supabase.from("menu_modifier_rules").select("*").eq("is_active", true),
    supabase.from("modifier_rule_menus").select("rule_id, menu_id"),
  ]);
  const ruleMenuMap: Record<string, string[]> = {};
  // deno-lint-ignore no-explicit-any
  for (const rm of (modRuleMenusRes.data || []) as any[]) {
    (ruleMenuMap[rm.rule_id] ||= []).push(rm.menu_id);
  }
  const rules = ((modRulesRes.data || []) as Array<Record<string, unknown>>).map((r) => ({
    keyword: String(r.keyword ?? ""),
    skuId: r.sku_id as string | null,
    qtyPerMatch: Number(r.qty_per_match),
    ruleType: r.rule_type as string,
    swapSkuId: r.swap_sku_id as string | null,
    submenuId: r.submenu_id as string | null,
    menuIds: ruleMenuMap[r.id as string] || [],
    branchIds: (r.branch_ids || []) as string[],
  }));

  const submenuIds = [...new Set(rules.filter((r) => r.ruleType === "submenu" && r.submenuId).map((r) => r.submenuId as string))];
  let submenuBom: Array<{ menu_id: string; sku_id: string; effective_qty: number }> = [];
  let submenuSpBom: Array<{ sp_sku_id: string; ingredient_sku_id: string; qty_per_batch: number; batch_yield_qty: number }> = [];
  if (submenuIds.length > 0) {
    const { data } = await supabase.from("menu_bom").select("menu_id, sku_id, effective_qty").in("menu_id", submenuIds);
    submenuBom = data || [];
    const spIds = [...new Set(submenuBom.filter((b) => b.sku_id !== targetSkuId).map((b) => b.sku_id))];
    if (spIds.length > 0) {
      const { data: sspb } = await supabase
        .from("sp_bom")
        .select("sp_sku_id, ingredient_sku_id, qty_per_batch, batch_yield_qty")
        .in("sp_sku_id", spIds)
        .eq("ingredient_sku_id", targetSkuId);
      submenuSpBom = sspb || [];
    }
  }

  // deno-lint-ignore no-explicit-any
  for (const sale of salesRows as any[]) {
    const mid = menuIdByCode[sale.menu_code];
    if (!mid) continue;
    const menuName = String(sale.menu_name || "").toLowerCase();
    const saleQty = Number(sale.qty);
    for (const rule of rules) {
      if (rule.branchIds.length > 0 && !rule.branchIds.includes(branchId)) continue;
      if (rule.menuIds.length > 0 && !rule.menuIds.includes(mid)) continue;

      if (rule.ruleType === "submenu") {
        if (sale.menu_code !== rule.keyword) continue;
        for (const sbom of submenuBom) {
          if (sbom.menu_id !== rule.submenuId) continue;
          if (sbom.sku_id === targetSkuId) {
            total += saleQty * Number(sbom.effective_qty);
          } else {
            for (const sp of submenuSpBom) {
              if (sp.sp_sku_id !== sbom.sku_id) continue;
              const batchYield = Number(sp.batch_yield_qty) || 1;
              total += saleQty * Number(sbom.effective_qty) * (Number(sp.qty_per_batch) / batchYield);
            }
          }
        }
      } else if (rule.ruleType === "swap") {
        if (!menuName.includes(rule.keyword.toLowerCase())) continue;
        if (rule.swapSkuId === targetSkuId) {
          const swapBom = (bomRows || []).find((b: { menu_id: string; sku_id: string }) => b.menu_id === mid && b.sku_id === rule.swapSkuId);
          if (swapBom) total -= saleQty * Number((swapBom as { effective_qty: number }).effective_qty);
        }
        if (rule.skuId === targetSkuId) total += saleQty * rule.qtyPerMatch;
      } else if (rule.ruleType === "add") {
        if (!menuName.includes(rule.keyword.toLowerCase())) continue;
        if (rule.skuId === targetSkuId) total += saleQty * rule.qtyPerMatch;
      }
    }
  }

  // Waste (daily_stock_counts.waste), same as the cover-day formula
  const { data: wasteRows } = await supabase
    .from("daily_stock_counts")
    .select("waste")
    .eq("branch_id", branchId)
    .eq("sku_id", targetSkuId)
    .eq("count_date", targetDate)
    .gt("waste", 0);
  // deno-lint-ignore no-explicit-any
  for (const w of (wasteRows || []) as any[]) total += Number(w.waste);

  return total;
}

export interface NoodleUsage {
  skuId: string;
  name: string;
  usageUom: string;
  total: number;
}

// Excluded by Bucci — matched by the "starts with เส้น" rule but not wanted in
// this report.
const EXCLUDED_NOODLE_NAMES = new Set(["เส้นบะหมี่", "เส้นหมี่ ตรากิเลนคู่"]);

// Finds every active RM sku that IS a noodle (any kind), and sums its sales-driven
// theoretical usage across all given branches for one date.
//
// Matches on "name starts with เส้น" rather than "name contains เส้น" — the SKU
// master consistently names actual noodles that way ("เส้นบะหมี่", "เส้นตรง
// โฮมเมด..."), while เส้น also shows up mid-name in unrelated items (a brand name
// "...ตราเส้นไหม", "สาหร่ายย่างตัดเส้น", "หมูสันนอก...เต็มเส้น") which a plain
// substring match wrongly pulled in.
export async function computeAllNoodleUsage(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  branches: Array<{ id: string; brand_name: string }>,
  targetDate: string,
): Promise<NoodleUsage[]> {
  const { data: skuMatches } = await supabase
    .from("skus")
    .select("id, name, usage_uom")
    .eq("type", "RM")
    .eq("status", "Active")
    .ilike("name", "เส้น%");

  const filtered = ((skuMatches || []) as Array<{ id: string; name: string; usage_uom: string }>).filter(
    (sku) => !EXCLUDED_NOODLE_NAMES.has(sku.name),
  );

  const results: NoodleUsage[] = [];
  for (const sku of filtered) {
    let total = 0;
    for (const b of branches) {
      total += await computeRmUsageForBranchDate(supabase, b.id, b.brand_name, sku.id, targetDate);
    }
    results.push({ skuId: sku.id, name: sku.name, usageUom: sku.usage_uom, total });
  }
  return results;
}
