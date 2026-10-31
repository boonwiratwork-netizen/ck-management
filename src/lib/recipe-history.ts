import { toLocalDateStr } from "@/lib/utils";
import { buildUsageContext, type UsageBomLine, type UsageContext, type UsageRule, type UsageSpLine } from "@/lib/sale-usage";

/** One saved copy of a recipe (table recipe_history, written by the database) */
export interface RecipeCopy {
  id: string;
  kind: "menu" | "sp" | "sm" | "rules";
  ownerId: string | null;
  snapshot: unknown;
  validFrom: string;
  createdAt: string;
}

type Chosen = Map<string, RecipeCopy>; // "kind|owner" → copy in force

/**
 * The copy of each recipe in force on a day: the last one saved on or before that
 * day (a change counts for its whole day, like prices). Before the first copy, the
 * first one (today's recipe at the start of history) is the best known.
 */
export function copiesOn(copies: RecipeCopy[]): (date: string) => Chosen {
  const byOwner = new Map<string, { day: string; at: string; c: RecipeCopy }[]>();
  for (const c of copies) {
    const key = `${c.kind}|${c.ownerId ?? ""}`;
    const list = byOwner.get(key) ?? [];
    list.push({ day: toLocalDateStr(new Date(c.validFrom)), at: c.createdAt, c });
    byOwner.set(key, list);
  }
  for (const list of byOwner.values()) list.sort((a, b) => (a.day !== b.day ? (a.day < b.day ? -1 : 1) : a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return (date) => {
    const out: Chosen = new Map();
    for (const [key, list] of byOwner) {
      let found = list[0].c;
      for (const e of list) {
        if (e.day > date) break;
        found = e.c;
      }
      out.set(key, found);
    }
    return out;
  };
}

interface UsageInput {
  menus: { id: string; menuCode: string }[];
  bomLines: UsageBomLine[];
  rules: UsageRule[];
  spLines: UsageSpLine[];
  skus: { id: string; type: string }[];
}

const n = (v: unknown) => Number(v) || 0;

/**
 * Sales → ingredients with the recipes and option rules of a given day. Recipes with
 * no copy (none saved yet) are today's. One context per distinct set of copies, so
 * a month with no recipe change builds just one.
 */
export function usageContextOn(today: UsageInput, copies: RecipeCopy[]): (date: string) => UsageContext {
  const pick = copiesOn(copies);
  const cache = new Map<string, UsageContext>();
  return (date) => {
    const chosen = pick(date);
    const key = [...chosen.values()].map((c) => c.id).sort().join(",");
    const hit = cache.get(key);
    if (hit) return hit;
    const menuCopies = [...chosen.values()].filter((c) => c.kind === "menu");
    const spCopies = [...chosen.values()].filter((c) => c.kind === "sp");
    const rulesCopy = chosen.get("rules|");
    const fromMenus = new Set(menuCopies.map((c) => c.ownerId));
    const fromSp = new Set(spCopies.map((c) => c.ownerId));
    const bomLines: UsageBomLine[] = [
      ...today.bomLines.filter((l) => !fromMenus.has(l.menuId)),
      ...menuCopies.flatMap((c) => ((c.snapshot as { sku_id: string; effective_qty: number; branch_id: string | null }[]) ?? []).map((l) => ({ menuId: c.ownerId!, skuId: l.sku_id, effectiveQty: n(l.effective_qty), branchId: l.branch_id ?? null }))),
    ];
    const spLines: UsageSpLine[] = [
      ...today.spLines.filter((l) => !fromSp.has(l.spSkuId)),
      ...spCopies.flatMap((c) => ((c.snapshot as { ingredient_sku_id: string; qty_per_batch: number; batch_yield_qty: number }[]) ?? []).map((l) => ({ spSkuId: c.ownerId!, ingredientSkuId: l.ingredient_sku_id, qtyPerBatch: n(l.qty_per_batch), batchYieldQty: n(l.batch_yield_qty) || 1 }))),
    ];
    const rules: UsageRule[] = rulesCopy
      ? (
          (rulesCopy.snapshot as { id: string; keyword: string; rule_type: string; sku_id: string | null; swap_sku_id: string | null; submenu_id: string | null; qty_per_match: number; is_active: boolean; branch_ids: string[] | null; menu_ids: string[] | null }[]) ?? []
        ).map((r) => ({ id: r.id, ruleType: r.rule_type, keyword: r.keyword, skuId: r.sku_id || null, swapSkuId: r.swap_sku_id, submenuId: r.submenu_id, qtyPerMatch: n(r.qty_per_match), isActive: !!r.is_active, branchIds: r.branch_ids ?? [], menuIds: r.menu_ids ?? [] }))
      : today.rules;
    const ctx = buildUsageContext({ menus: today.menus, bomLines, rules, spLines, skus: today.skus });
    cache.set(key, ctx);
    return ctx;
  };
}

/** An SM recipe as saved on a day (kitchen overview): header, steps and lines */
export interface SmCopy {
  header: { sm_sku_id: string; bom_mode: string; batch_size: number; yield_percent: number } | null;
  steps: { id: string; step_number: number; yield_percent: number }[];
  lines: { rm_sku_id: string; qty_per_batch: number; yield_percent: number | null; step_id: string | null; qty_type: string | null; percent_of_input: number | null }[];
}

/** Each SM recipe's copy on a day, by header id (only those with a copy) */
export function smRecipesOn(copies: RecipeCopy[], date: string): Map<string, SmCopy> {
  const chosen = copiesOn(copies.filter((c) => c.kind === "sm"))(date);
  return new Map([...chosen.values()].map((c) => [c.ownerId!, c.snapshot as SmCopy]));
}
