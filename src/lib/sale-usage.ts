import { ruleMatchesSale } from "@/lib/modifier-rules";

/**
 * Ingredient usage of one sales line, the same way Food Cost counts it:
 * recipe lines (shared + this branch's own) → SP expansion → modifier rules
 * (add / swap removes the swapped recipe line / submenu adds that menu's recipe).
 */
export interface UsageBomLine {
  menuId: string;
  skuId: string;
  effectiveQty: number;
  branchId: string | null;
}
export interface UsageRule {
  id: string;
  ruleType: string;
  keyword: string;
  skuId: string | null;
  swapSkuId: string | null;
  submenuId: string | null;
  qtyPerMatch: number;
  isActive: boolean;
  branchIds: string[];
  menuIds: string[];
}
export interface UsageSpLine {
  spSkuId: string;
  ingredientSkuId: string;
  qtyPerBatch: number;
  batchYieldQty: number;
}
export interface UsageContext {
  menuIdByCode: Map<string, string>;
  bomByMenu: Map<string, UsageBomLine[]>;
  rules: UsageRule[];
  spBySku: Map<string, UsageSpLine[]>;
  skuType: Map<string, string>;
}
export interface UsageSale {
  menu_code: string;
  menu_name?: string | null;
  qty: number | string;
  branch_id?: string | null;
}

export function buildUsageContext(input: {
  menus: { id: string; menuCode: string }[];
  bomLines: UsageBomLine[];
  rules: UsageRule[];
  spLines: UsageSpLine[];
  skus: { id: string; type: string }[];
}): UsageContext {
  const bomByMenu = new Map<string, UsageBomLine[]>();
  for (const l of input.bomLines) {
    const arr = bomByMenu.get(l.menuId) ?? [];
    arr.push(l);
    bomByMenu.set(l.menuId, arr);
  }
  const spBySku = new Map<string, UsageSpLine[]>();
  for (const l of input.spLines) {
    const arr = spBySku.get(l.spSkuId) ?? [];
    arr.push(l);
    spBySku.set(l.spSkuId, arr);
  }
  return {
    menuIdByCode: new Map(input.menus.map((m) => [m.menuCode, m.id])),
    bomByMenu,
    rules: input.rules.filter((r) => r.isActive),
    spBySku,
    skuType: new Map(input.skus.map((s) => [s.id, s.type])),
  };
}

/** Calls add(skuId, qty) for every ingredient the sale uses; returns false if the menu is unknown */
export function addSaleUsage(ctx: UsageContext, sale: UsageSale, add: (skuId: string, qty: number) => void): boolean {
  const menuId = ctx.menuIdByCode.get(sale.menu_code);
  if (!menuId) return false;
  const qty = Number(sale.qty) || 0;
  if (qty === 0) return true;
  const branch = sale.branch_id ?? null;
  const linesFor = (mid: string) =>
    (ctx.bomByMenu.get(mid) ?? []).filter((l) => l.branchId === null || l.branchId === branch);
  const expand = (skuId: string, q: number) => {
    if (ctx.skuType.get(skuId) === "SP") {
      for (const sp of ctx.spBySku.get(skuId) ?? []) add(sp.ingredientSkuId, (sp.qtyPerBatch / sp.batchYieldQty) * q);
    } else {
      add(skuId, q);
    }
  };

  const recipe = linesFor(menuId);
  for (const line of recipe) expand(line.skuId, line.effectiveQty * qty);

  for (const rule of ctx.rules) {
    if (rule.branchIds.length > 0 && (!branch || !rule.branchIds.includes(branch))) continue;
    if (rule.menuIds.length > 0 && !rule.menuIds.includes(menuId)) continue;
    if (!ruleMatchesSale(rule, sale)) continue;
    if (rule.ruleType === "submenu") {
      if (rule.submenuId) for (const line of linesFor(rule.submenuId)) expand(line.skuId, line.effectiveQty * qty);
      continue;
    }
    if (rule.ruleType === "swap" && rule.swapSkuId) {
      for (const line of recipe) if (line.skuId === rule.swapSkuId) expand(line.skuId, -line.effectiveQty * qty);
    }
    if (rule.skuId) expand(rule.skuId, rule.qtyPerMatch * qty);
  }
  return true;
}
