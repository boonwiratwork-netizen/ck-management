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
  /**
   * What a delivery sale uses instead (menu_bom.delivery_qty ÷ yield): ramen for delivery
   * goes out with less soup and tare. null = the same as in the shop.
   */
  deliveryEffectiveQty: number | null;
  /**
   * A line only delivery uses (menu_bom.delivery_only: the delivery box, a sauce cup).
   * Shop sales skip it; a delivery sale uses effectiveQty. Absent = false.
   */
  deliveryOnly?: boolean;
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
  /** sales_entries.order_type ("Delivery", "Dine-In", "Take Away", "Manual") */
  order_type?: string | null;
  /** sales_entries.channel ("LINE MAN เดลิเวอรี", "หน้าร้าน", "Manual") */
  channel?: string | null;
}

const DELIVERY_CHANNEL = /เดลิเวอรี|delivery|line ?man|grab|robinhood|foodpanda|shopee/i;
/** Line Man alias menus (MN-001L … MN-073L): sold on Line Man only */
const DELIVERY_ALIAS_CODE = /^MN-\d+L$/i;

/**
 * A delivery sale: the order type says so, the channel is a delivery app, or the menu
 * is a Line Man alias. Such a sale uses each recipe line's delivery amount when it has one.
 */
export function isDeliverySale(sale: Pick<UsageSale, "menu_code" | "order_type" | "channel">): boolean {
  if (/delivery/i.test(sale.order_type ?? "")) return true;
  if (DELIVERY_CHANNEL.test(sale.channel ?? "")) return true;
  return DELIVERY_ALIAS_CODE.test((sale.menu_code ?? "").trim());
}

/** menu_bom.delivery_qty → the delivery amount after yield; blank / not a number = null (same as shop) */
export function deliveryEffective(deliveryQty: unknown, yieldPct: unknown): number | null {
  if (deliveryQty === null || deliveryQty === undefined || deliveryQty === "") return null;
  const q = Number(deliveryQty);
  if (!Number.isFinite(q) || q < 0) return null;
  const y = Number(yieldPct);
  return y > 0 ? q / (y / 100) : q;
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

/**
 * The context from the app's own data (menus, menu recipes, rules, SP recipes, SKUs as
 * the data hooks hold them). Every screen that turns sales into ingredients builds it
 * here, so they all count the same way.
 */
/** The usage engine's input from the app's own data (also the base for a past day's recipes) */
export function usageInputFromApp(input: {
  menus: { id: string; menuCode: string }[];
  menuBomLines: { menuId: string; skuId: string; effectiveQty: number; branchId?: string | null; deliveryQty?: number | null; yieldPct?: number; deliveryOnly?: boolean }[];
  modifierRules: { id: string; ruleType: string; keyword: string; skuId: string | null; swapSkuId: string | null; submenuId: string | null; qtyPerMatch: number; isActive: boolean; branchIds?: string[] | null; menuIds?: string[] | null }[];
  spBomLines: { spSkuId: string; ingredientSkuId: string; qtyPerBatch: number; batchYieldQty: number }[];
  skus: { id: string; type: string }[];
}) {
  return {
    menus: input.menus.map((m) => ({ id: m.id, menuCode: m.menuCode })),
    bomLines: input.menuBomLines.map((l) => ({
      menuId: l.menuId,
      skuId: l.skuId,
      effectiveQty: Number(l.effectiveQty) || 0,
      deliveryEffectiveQty: deliveryEffective(l.deliveryQty, l.yieldPct ?? 100),
      deliveryOnly: !!l.deliveryOnly,
      branchId: l.branchId ?? null,
    })),
    rules: input.modifierRules.map((r) => ({
      id: r.id,
      ruleType: r.ruleType,
      keyword: r.keyword,
      skuId: r.skuId || null,
      swapSkuId: r.swapSkuId,
      submenuId: r.submenuId,
      qtyPerMatch: Number(r.qtyPerMatch) || 0,
      isActive: r.isActive,
      branchIds: r.branchIds ?? [],
      menuIds: r.menuIds ?? [],
    })),
    spLines: input.spBomLines.map((l) => ({ spSkuId: l.spSkuId, ingredientSkuId: l.ingredientSkuId, qtyPerBatch: Number(l.qtyPerBatch) || 0, batchYieldQty: Number(l.batchYieldQty) || 1 })),
    skus: input.skus.map((s) => ({ id: s.id, type: s.type })),
  };
}

export function usageContextFromApp(input: {
  menus: { id: string; menuCode: string }[];
  menuBomLines: { menuId: string; skuId: string; effectiveQty: number; branchId?: string | null; deliveryQty?: number | null; yieldPct?: number; deliveryOnly?: boolean }[];
  modifierRules: { id: string; ruleType: string; keyword: string; skuId: string | null; swapSkuId: string | null; submenuId: string | null; qtyPerMatch: number; isActive: boolean; branchIds?: string[] | null; menuIds?: string[] | null }[];
  spBomLines: { spSkuId: string; ingredientSkuId: string; qtyPerBatch: number; batchYieldQty: number }[];
  skus: { id: string; type: string }[];
}): UsageContext {
  return buildUsageContext(usageInputFromApp(input));
}

/** Calls add(skuId, qty) for every ingredient the sale uses; returns false if the menu is unknown */
export function addSaleUsage(ctx: UsageContext, sale: UsageSale, add: (skuId: string, qty: number) => void): boolean {
  const menuId = ctx.menuIdByCode.get(sale.menu_code);
  if (!menuId) return false;
  const qty = Number(sale.qty) || 0;
  if (qty === 0) return true;
  const branch = sale.branch_id ?? null;
  // A delivery sale takes each line's delivery amount where one is set: the menu's own
  // lines, a set's dish lines and the line a swap takes out alike. Rule amounts stay.
  const delivery = isDeliverySale(sale);
  const per = (l: UsageBomLine) => (delivery && l.deliveryEffectiveQty !== null ? l.deliveryEffectiveQty : l.effectiveQty);
  // A delivery-only line (the delivery box) is part of the recipe for delivery sales only:
  // a shop sale never sees it, so a swap can't take it out of a shop sale either.
  const linesFor = (mid: string) =>
    (ctx.bomByMenu.get(mid) ?? []).filter((l) => (l.branchId === null || l.branchId === branch) && (delivery || !l.deliveryOnly));
  const expand = (skuId: string, q: number) => {
    if (ctx.skuType.get(skuId) === "SP") {
      for (const sp of ctx.spBySku.get(skuId) ?? []) add(sp.ingredientSkuId, (sp.qtyPerBatch / sp.batchYieldQty) * q);
    } else {
      add(skuId, q);
    }
  };

  const recipe = linesFor(menuId);
  for (const line of recipe) expand(line.skuId, per(line) * qty);

  const atBranch = (r: UsageRule) => r.branchIds.length === 0 || (!!branch && r.branchIds.includes(branch));
  // A swap's replacement goes in once per sale, however many places it reaches
  // (the set itself and the dish inside it)
  const replaced = new Set<string>();
  const addReplacement = (r: UsageRule) => {
    if (replaced.has(r.id)) return;
    replaced.add(r.id);
    if (r.skuId) expand(r.skuId, r.qtyPerMatch * qty);
  };

  for (const rule of ctx.rules) {
    if (!atBranch(rule)) continue;
    if (rule.menuIds.length > 0 && !rule.menuIds.includes(menuId)) continue;
    if (!ruleMatchesSale(rule, sale)) continue;
    if (rule.ruleType === "submenu") {
      if (!rule.submenuId) continue;
      const dish = linesFor(rule.submenuId);
      for (const line of dish) expand(line.skuId, per(line) * qty);
      // A choice made for the dish inside a set ("Delivery Set A … เลือกเส้น : เส้นหนาหนึบ")
      // swaps that dish's own line too, whether the swap lists the dish, the set, or
      // every menu: the item comes out of the dish, the replacement goes in once.
      for (const sw of ctx.rules) {
        if (sw.ruleType !== "swap" || !sw.swapSkuId || !atBranch(sw)) continue;
        if (sw.menuIds.length > 0 && !sw.menuIds.includes(rule.submenuId) && !sw.menuIds.includes(menuId)) continue;
        if (!ruleMatchesSale(sw, sale)) continue;
        for (const line of dish) if (line.skuId === sw.swapSkuId) expand(line.skuId, -per(line) * qty);
        addReplacement(sw);
      }
      continue;
    }
    if (rule.ruleType === "swap" && rule.swapSkuId) {
      for (const line of recipe) if (line.skuId === rule.swapSkuId) expand(line.skuId, -per(line) * qty);
      addReplacement(rule);
      continue;
    }
    if (rule.skuId) expand(rule.skuId, rule.qtyPerMatch * qty);
  }
  return true;
}
