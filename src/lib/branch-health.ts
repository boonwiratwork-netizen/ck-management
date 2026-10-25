import type { Menu } from "@/types/menu";
import type { ModifierRule } from "@/types/modifier-rule";
import type { Branch } from "@/types/branch";
import type { HealthCheck, MenuSetupSummary } from "@/lib/menu-health";

/**
 * Setup checks for one branch — what a new branch needs before its sales turn
 * into correct stock usage. Pure, so it is tested.
 */

export interface BranchMenuRow {
  menu: Menu;
  open: boolean;
  /** No recipe reaches this menu at this branch (own lines or linked recipe) */
  noRecipe: boolean;
  cost: number;
  costPct: number | null;
  sold: number;
}

export interface BranchSetup {
  rows: BranchMenuRow[];
  checks: HealthCheck[];
  /** Codes sold at this branch that aren't in the menu list, with qty */
  unknownCodes: { code: string; qty: number }[];
}

export function summarizeBranch(input: {
  branch: Branch;
  menus: Menu[];
  rules: ModifierRule[];
  summaries: Map<string, MenuSetupSummary>;
  /** menu_code → branchId → qty; undefined while loading */
  soldByCode?: Record<string, Record<string, number>>;
}): BranchSetup {
  const { branch, menus, rules, summaries, soldByCode } = input;
  const brandMenus = menus.filter((m) => m.brandName === branch.brandName && m.status === "Active");
  const rows: BranchMenuRow[] = brandMenus.map((menu) => {
    const s = summaries.get(menu.id);
    const at = s?.branches.find((b) => b.branchId === branch.id);
    const linkedHere = (s?.linkedRecipes ?? []).some(({ rule }) => rule.branchIds.length === 0 || rule.branchIds.includes(branch.id));
    return {
      menu,
      open: at?.open ?? true,
      // Real bills at this branch decide; without sales, judge from the setup. Set menus
      // fed by topping/set rules aren't "no recipe" (same as the menu checks)
      noRecipe:
        (s?.bills?.platesByBranch[branch.id] ?? 0) > 0
          ? (s?.bills?.emptyByBranch[branch.id] ?? 0) > 0
          : (at?.lines.length ?? 0) === 0 && !linkedHere && !(s?.ownRules ?? []).some((r) => r.isActive && r.ruleType === "submenu"),
      cost: at?.cost ?? 0,
      costPct: at?.costPct ?? null,
      sold: soldByCode?.[menu.menuCode]?.[branch.id] ?? 0,
    };
  });

  const checks: HealthCheck[] = [];
  if (brandMenus.length === 0) {
    const brands = [...new Set(menus.map((m) => m.brandName).filter(Boolean))];
    checks.push({
      id: "brand",
      level: "error",
      area: "info",
      title: `ไม่มีเมนูของแบรนด์ "${branch.brandName || "(ว่าง)"}"`,
      detail: `ชื่อแบรนด์ของสาขาต้องสะกดตรงกับเมนู — แบรนด์ที่มี: ${brands.join(", ") || "—"} · แก้ที่หน้าสาขา`,
    });
  } else {
    checks.push({ id: "brand", level: "ok", area: "info", title: `แบรนด์ ${branch.brandName}: ${brandMenus.length} เมนู` });
  }

  const openRows = rows.filter((r) => r.open);
  if (brandMenus.length > 0)
    checks.push({
      id: "open",
      level: openRows.length > 0 ? "ok" : "warn",
      area: "branches",
      title: `เปิดขาย ${openRows.length} จาก ${rows.length} เมนู`,
    });

  // Toppings/set items live as menus too and are often never sold on their own, so only
  // flag open menus without a recipe that the branch actually sells
  const soldNoRecipe = openRows.filter((r) => r.noRecipe && r.sold > 0);
  if (soldNoRecipe.length > 0)
    checks.push({
      id: "no-recipe",
      level: "error",
      area: "recipe",
      title: `ขายแล้วไม่ตัดของ ${soldNoRecipe.length} เมนู`,
      detail: `${soldNoRecipe.map((r) => r.menu.menuCode).join(", ")} · ขายแล้วไม่ตัดวัตถุดิบ`,
    });

  const unknownCodes: { code: string; qty: number }[] = [];
  if (soldByCode) {
    const known = new Set(menus.map((m) => m.menuCode));
    for (const [code, byBranch] of Object.entries(soldByCode)) {
      const qty = byBranch[branch.id] ?? 0;
      // OP-xxx rows were options in the old POS (before 17 Oct 2026; the new POS writes
      // options into the bill name) and lines like "คิดภาษี" aren't menus at all
      if (/^OP/i.test(code) || !/\d/.test(code)) continue;
      if (qty > 0 && !known.has(code)) unknownCodes.push({ code, qty });
    }
    unknownCodes.sort((a, b) => b.qty - a.qty);
    if (unknownCodes.length > 0)
      checks.push({
        id: "unknown-codes",
        level: "error",
        area: "info",
        title: `ขายรหัสที่ไม่มีในรายการเมนู ${unknownCodes.length} รหัส`,
        detail: `${unknownCodes.slice(0, 8).map((u) => `${u.code} (${u.qty})`).join(", ")} · ยอดขายพวกนี้ไม่ตัดของเลย ต้องสร้างเมนูรหัสนี้ หรือแก้รหัสใน POS`,
      });
    else checks.push({ id: "unknown-codes", level: "ok", area: "info", title: "ทุกรหัสที่ขายมีในรายการเมนู" });
  }

  // Rules limited to other branches but used on this brand's menus never fire here
  const brandIds = new Set(brandMenus.map((m) => m.id));
  const elsewhere = rules.filter(
    (r) =>
      r.isActive &&
      r.branchIds.length > 0 &&
      !r.branchIds.includes(branch.id) &&
      (r.menuIds.length === 0 || r.menuIds.some((id) => brandIds.has(id))),
  );
  if (elsewhere.length > 0)
    checks.push({
      id: "rules-elsewhere",
      level: "warn",
      area: "rules",
      title: `กฎ ${elsewhere.length} ตัวของเมนูแบรนด์นี้ไม่ได้เลือกสาขานี้`,
      detail: `${elsewhere.slice(0, 8).map((r) => `"${r.keyword}"`).join(", ")}${elsewhere.length > 8 ? " …" : ""} · ถ้าสาขานี้ขายตัวเลือกพวกนี้ด้วย ต้องเพิ่มสาขานี้ในกฎ ไม่งั้นไม่ตัดของ`,
    });
  else checks.push({ id: "rules-elsewhere", level: "ok", area: "rules", title: "กฎของแบรนด์นี้ครอบคลุมสาขานี้" });

  return { rows, checks, unknownCodes };
}
