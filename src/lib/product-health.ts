import type { SKU } from "@/types/sku";
import type { Price } from "@/types/price";
import { BOM_SUPPLIER_ID } from "@/lib/bom-price-sync";
import { recipeItemIds, recost, type RecipeBook } from "@/lib/cost-engine";

/**
 * Everything Cost Center says about one product, worked out in one place: its
 * standard price, what it is made of / used in, and a checklist of setup mistakes
 * that make cost or stock wrong. Pure (no data fetching) so it is tested.
 */

export type ProductLevel = "ok" | "warn" | "error" | "idle";
export type ProductArea = "info" | "price" | "recipe" | "use";

export interface ProductCheck {
  /** Same id across products, so the overview can group them */
  id: "no-price" | "multi-price" | "bill-drift" | "no-recipe" | "recipe-inactive" | "recipe-no-price" | "stale-cost" | "inactive-used" | "unused" | "draft";
  level: ProductLevel;
  area: ProductArea;
  /** One line in plain Thai */
  title: string;
  detail?: string;
}

export interface Bill {
  skuId: string;
  supplierId: string;
  date: string;
  /** Price per purchase unit on the bill (actual_unit_price), and the standard price at the time */
  unitPrice: number;
  stdUnitPrice: number;
  qty: number;
}

export interface ProductContext {
  skus: SKU[];
  prices: Price[];
  book: RecipeBook;
  /** menu_bom rows: which menu uses which item */
  menuLines: { menuId: string; skuId: string }[];
  /** Menus that are on sale */
  activeMenuIds: Set<string>;
  /** Kitchen bills of the last 90 days; null while loading (bill checks wait) */
  bills: Bill[] | null;
  /** Items used by an active modifier rule (add or swap) */
  ruleSkuIds?: Set<string>;
  /** Items any branch received in the last 90 days */
  branchBought?: Set<string> | null;
  /** What every recipe-made item really costs today (allRecipeCosts); worked out once per screen */
  recipeCosts?: Map<string, number>;
}

export { recipeItemIds } from "@/lib/cost-engine";

/**
 * Today's true cost of every recipe-made item, recipes inside recipes included
 * (a recipe whose ingredient never had its cost saved still gets a real number).
 */
export function allRecipeCosts(book: RecipeBook, prices: Price[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const p of prices) if (p.isActive && !map.has(p.skuId)) map.set(p.skuId, p.pricePerUsageUom);
  return recost(recipeItemIds(book), book, map);
}

export interface ProductUsage {
  /** SM recipes that use it */
  inSm: string[];
  /** SP recipes that use it */
  inSp: string[];
  /** Menus (on sale) that use it */
  inMenus: string[];
  /** Active modifier rules that add or swap it in */
  inRules: number;
}

export interface ProductSummary {
  sku: SKU;
  level: ProductLevel;
  checks: ProductCheck[];
  /** The standard price: the active one set most recently (prices come newest first) */
  standard: Price | null;
  /** Active prices, one per supplier (each supplier's bills are checked against its own) */
  active: Price[];
  /** What it is made of (SM/SP), as item ids */
  madeFrom: string[];
  usage: ProductUsage;
  bills: Bill[];
  /** Recent bills vs standard: average of the last 3 bills ÷ standard (null if no bills or price) */
  billRatio: number | null;
  /** Cost per usage unit from its recipe (SM/SP), null otherwise */
  recipeCost: number | null;
}

const isMadeItem = (s: SKU) => s.type === "SM" || s.type === "SP";
const worst = (checks: ProductCheck[]): ProductLevel =>
  checks.some((c) => c.level === "error") ? "error" : checks.some((c) => c.level === "warn") ? "warn" : checks.some((c) => c.level === "idle") ? "idle" : "ok";

/** Bills more than this far from the standard price are flagged (Bucci: 10%) */
export const BILL_DRIFT = 0.1;

export function usageOf(skuId: string, ctx: Pick<ProductContext, "book" | "menuLines" | "activeMenuIds" | "ruleSkuIds">): ProductUsage {
  const smOf = new Map(ctx.book.headers.map((h) => [h.id, h.smSkuId]));
  const inSm = [...new Set(ctx.book.lines.filter((l) => l.rmSkuId === skuId).map((l) => smOf.get(l.bomHeaderId)).filter((x): x is string => !!x))];
  const inSp = [...new Set(ctx.book.spLines.filter((l) => l.ingredientSkuId === skuId).map((l) => l.spSkuId))];
  const inMenus = [...new Set(ctx.menuLines.filter((l) => l.skuId === skuId && ctx.activeMenuIds.has(l.menuId)).map((l) => l.menuId))];
  return { inSm, inSp, inMenus, inRules: ctx.ruleSkuIds?.has(skuId) ? 1 : 0 };
}

export function summarizeProduct(sku: SKU, ctx: ProductContext): ProductSummary {
  const byId = new Map(ctx.skus.map((s) => [s.id, s]));
  const priceOf = (id: string) => ctx.prices.find((p) => p.skuId === id && p.isActive)?.pricePerUsageUom ?? 0;
  const hasPrice = (id: string) => ctx.prices.some((p) => p.skuId === id && p.isActive);
  const active = ctx.prices.filter((p) => p.skuId === sku.id && p.isActive);
  const standard = active[0] ?? null;
  const usage = usageOf(sku.id, ctx);
  const used = usage.inSm.length + usage.inSp.length + usage.inMenus.length + usage.inRules > 0;
  const bills = (ctx.bills ?? []).filter((b) => b.skuId === sku.id).sort((a, b) => b.date.localeCompare(a.date));
  const checks: ProductCheck[] = [];

  // What it's made of, and its recipe cost. A tracked by-product comes out of its
  // parent's recipe (e.g. stock from boiling bones): that recipe is its "recipe".
  const header = ctx.book.headers.find((h) => h.smSkuId === sku.id);
  const spLines = ctx.book.spLines.filter((l) => l.spSkuId === sku.id);
  const parent = ctx.book.byproducts.find((b) => b.tracksInventory && b.skuId === sku.id);
  const parentSm = parent ? ctx.book.headers.find((h) => h.id === parent.bomHeaderId)?.smSkuId : undefined;
  const ownLines = header ? ctx.book.lines.filter((l) => l.bomHeaderId === header.id).map((l) => l.rmSkuId) : [];
  // A by-product with an empty recipe of its own (น้ำมันไก่) still comes from its parent
  const recipeLines = ownLines.length ? ownLines : spLines.length ? spLines.map((l) => l.ingredientSkuId) : parentSm ? [parentSm] : [];
  const madeFrom = [...new Set(recipeLines)];
  const costs = ctx.recipeCosts ?? allRecipeCosts(ctx.book, ctx.prices);
  const recipeCost = costs.get(sku.id) ?? null;
  // An ingredient "has a price" if it has one, or its own recipe gives it one
  const priced = (id: string) => hasPrice(id) || costs.has(id);
  void priceOf;

  if ((sku.status as string) === "Draft") checks.push({ id: "draft", level: "warn", area: "info", title: "ยังเป็นร่าง", detail: "ยังไม่ขึ้นในรับของ ใบโอน ใบนับ และยังใส่ในสูตรไม่ได้ จนกว่าจะตั้งครบ" });

  if (sku.status === "Inactive") {
    const where = usage.inSm.length + usage.inSp.length + usage.inMenus.length + usage.inRules;
    if (where) checks.push({ id: "inactive-used", level: "error", area: "use", title: "ปิดใช้แล้ว แต่ยังอยู่ในสูตร", detail: `อยู่ใน ${where} ที่ · เปลี่ยนเป็นตัวอื่นในสูตร` });
    return { sku, level: worst(checks), checks, standard, active, madeFrom, usage, bills, billRatio: null, recipeCost };
  }

  if (isMadeItem(sku) || parentSm) {
    if (!madeFrom.length && isMadeItem(sku)) checks.push({ id: "no-recipe", level: "error", area: "recipe", title: sku.type === "SM" ? "ครัวผลิตแต่ยังไม่มีสูตร" : "ยังไม่มีสูตร", detail: "ผลิตแล้วไม่ตัดวัตถุดิบ · ต้นทุนไม่มี" });
    const off = madeFrom.filter((id) => byId.get(id)?.status === "Inactive");
    if (off.length) checks.push({ id: "recipe-inactive", level: "error", area: "recipe", title: "สูตรใช้ของที่ปิดใช้แล้ว", detail: off.map((id) => byId.get(id)?.name).join(" · ") });
    const noPrice = madeFrom.filter((id) => !priced(id));
    if (noPrice.length) checks.push({ id: "recipe-no-price", level: "error", area: "recipe", title: "สูตรมีวัตถุดิบที่ไม่มีราคา", detail: noPrice.map((id) => byId.get(id)?.name).join(" · ") });
    // The saved cost is behind the recipe (never worked out, or an ingredient moved since)
    const saved = (active.find((p) => p.supplierId === BOM_SUPPLIER_ID) ?? active[0])?.pricePerUsageUom;
    if (recipeCost && (!saved || Math.abs(recipeCost - saved) > 0.01 * Math.max(recipeCost, saved)))
      checks.push(
        saved
          ? { id: "stale-cost", level: "warn", area: "recipe", title: "ต้นทุนในระบบไม่ตรงกับสูตร", detail: "ราคาวัตถุดิบเปลี่ยนหลังจากคิดครั้งล่าสุด · กดคิดใหม่" }
          : { id: "stale-cost", level: "warn", area: "recipe", title: "ยังไม่ได้คิดต้นทุนจากสูตร", detail: "ที่อื่นเห็นตัวนี้เป็น ฿0 · กดคิดใหม่" },
      );
  } else {
    if (!active.length) checks.push(used ? { id: "no-price", level: "error", area: "price", title: "ใช้ในสูตรแต่ไม่มีราคา", detail: "ต้นทุนเป็น ฿0 ทุกที่ที่ใช้" } : { id: "no-price", level: "warn", area: "price", title: "ยังไม่มีราคา" });
  }

  // Recent bills vs the price they should have had: each supplier's bill against that
  // supplier's own price (else the standard). Bills are priced per purchase unit (the
  // bill's qty is packs × pack size, no converter), so compare per pack.
  let billRatio: number | null = null;
  const ratios = bills
    .filter((b) => b.unitPrice > 0)
    .slice(0, 3)
    .map((b) => {
      const ref = (active.find((p) => p.supplierId === b.supplierId) ?? standard)?.pricePerPurchaseUom ?? 0;
      return ref > 0 ? (b.unitPrice * (sku.packSize || 1)) / ref : null;
    })
    .filter((r): r is number => r !== null);
  if (ratios.length) {
    billRatio = ratios.reduce((s, r) => s + r, 0) / ratios.length;
    if (Math.abs(billRatio - 1) > BILL_DRIFT) {
      const pct = Math.round((billRatio - 1) * 100);
      checks.push({ id: "bill-drift", level: "warn", area: "price", title: `บิลล่าสุด${pct > 0 ? "แพงกว่า" : "ถูกกว่า"}ราคาที่ตั้งไว้ ${Math.abs(pct)}%`, detail: "ต้นทุนเมนูที่ใช้ตัวนี้คลาดจากจริง" });
    }
  }

  // Only once bills and branch receipts have loaded (else everything looks unused)
  if (!isMadeItem(sku) && !used && ctx.bills && ctx.branchBought !== null && !bills.length && !ctx.branchBought?.has(sku.id))
    checks.push({ id: "unused", level: "idle", area: "use", title: "ไม่ได้ใช้ในสูตรไหน และไม่ได้ซื้อ 90 วัน" });

  return { sku, level: worst(checks), checks, standard, active, madeFrom, usage, bills, billRatio, recipeCost };
}

/**
 * At entry time: is this price per usage unit far off? (5× either way from the middle
 * price of its category — or, with fewer than 5 priced items there, of every item
 * used in the same unit)
 */
export function unitLooksOff(pricePerUnit: number, category: string, skus: SKU[], prices: Price[], usageUom?: string): { median: number; ratio: number } | null {
  if (!(pricePerUnit > 0)) return null;
  const valuesFor = (keep: (s: SKU) => boolean) => {
    const ids = new Set(skus.filter((s) => s.status === "Active" && (s.type === "RM" || s.type === "PK") && keep(s)).map((s) => s.id));
    return prices.filter((p) => p.isActive && ids.has(p.skuId) && p.pricePerUsageUom > 0).map((p) => p.pricePerUsageUom).sort((a, b) => a - b);
  };
  let vals = category ? valuesFor((s) => s.category === category) : [];
  if (vals.length < 5 && usageUom) vals = valuesFor((s) => s.usageUom === usageUom);
  if (vals.length < 5) return null;
  const median = vals[Math.floor(vals.length / 2)];
  const ratio = pricePerUnit / median;
  return ratio > 5 || ratio < 0.2 ? { median, ratio } : null;
}
