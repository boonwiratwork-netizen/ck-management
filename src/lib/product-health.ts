import type { SKU } from "@/types/sku";
import type { Price } from "@/types/price";
import { BOM_SUPPLIER_ID } from "@/lib/bom-price-sync";
import { smCost, spCost, type RecipeBook } from "@/lib/cost-engine";

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
  /** Kitchen bills of the last 90 days */
  bills: Bill[];
}

export interface ProductUsage {
  /** SM recipes that use it */
  inSm: string[];
  /** SP recipes that use it */
  inSp: string[];
  /** Menus (on sale) that use it */
  inMenus: string[];
}

export interface ProductSummary {
  sku: SKU;
  level: ProductLevel;
  checks: ProductCheck[];
  /** The one standard price (null when none) */
  standard: Price | null;
  /** Active prices (more than one = needs choosing) */
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

export function usageOf(skuId: string, ctx: Pick<ProductContext, "book" | "menuLines" | "activeMenuIds">): ProductUsage {
  const smOf = new Map(ctx.book.headers.map((h) => [h.id, h.smSkuId]));
  const inSm = [...new Set(ctx.book.lines.filter((l) => l.rmSkuId === skuId).map((l) => smOf.get(l.bomHeaderId)).filter((x): x is string => !!x))];
  const inSp = [...new Set(ctx.book.spLines.filter((l) => l.ingredientSkuId === skuId).map((l) => l.spSkuId))];
  const inMenus = [...new Set(ctx.menuLines.filter((l) => l.skuId === skuId && ctx.activeMenuIds.has(l.menuId)).map((l) => l.menuId))];
  return { inSm, inSp, inMenus };
}

export function summarizeProduct(sku: SKU, ctx: ProductContext): ProductSummary {
  const byId = new Map(ctx.skus.map((s) => [s.id, s]));
  const priceOf = (id: string) => ctx.prices.find((p) => p.skuId === id && p.isActive)?.pricePerUsageUom ?? 0;
  const hasPrice = (id: string) => ctx.prices.some((p) => p.skuId === id && p.isActive);
  const active = ctx.prices.filter((p) => p.skuId === sku.id && p.isActive);
  const standard = active[0] ?? null;
  const usage = usageOf(sku.id, ctx);
  const used = usage.inSm.length + usage.inSp.length + usage.inMenus.length > 0;
  const bills = ctx.bills.filter((b) => b.skuId === sku.id).sort((a, b) => b.date.localeCompare(a.date));
  const checks: ProductCheck[] = [];

  // What it's made of, and its recipe cost
  const header = ctx.book.headers.find((h) => h.smSkuId === sku.id);
  const spLines = ctx.book.spLines.filter((l) => l.spSkuId === sku.id);
  const recipeLines = header ? ctx.book.lines.filter((l) => l.bomHeaderId === header.id).map((l) => l.rmSkuId) : spLines.map((l) => l.ingredientSkuId);
  const madeFrom = [...new Set(recipeLines)];
  let recipeCost: number | null = null;
  if (header)
    recipeCost = smCost(
      header,
      ctx.book.lines.filter((l) => l.bomHeaderId === header.id),
      ctx.book.steps.filter((s) => s.bomHeaderId === header.id),
      ctx.book.byproducts.filter((b) => b.bomHeaderId === header.id),
      priceOf,
    ).costPerUnit;
  else if (spLines.length) recipeCost = spCost(spLines, priceOf).costPerUnit;

  if ((sku.status as string) === "Draft") checks.push({ id: "draft", level: "warn", area: "info", title: "ยังเป็นร่าง", detail: "ยังไม่ขึ้นในรับของ ใบโอน ใบนับ จนกว่าจะตั้งครบ" });

  if (sku.status === "Inactive") {
    const where = usage.inSm.length + usage.inSp.length + usage.inMenus.length;
    if (where) checks.push({ id: "inactive-used", level: "error", area: "use", title: "ปิดใช้แล้ว แต่ยังอยู่ในสูตร", detail: `อยู่ใน ${where} ที่ · เปลี่ยนเป็นตัวอื่นในสูตร` });
    return { sku, level: worst(checks), checks, standard, active, madeFrom, usage, bills, billRatio: null, recipeCost };
  }

  if (isMadeItem(sku)) {
    if (!madeFrom.length) checks.push({ id: "no-recipe", level: "error", area: "recipe", title: sku.type === "SM" ? "ครัวผลิตแต่ยังไม่มีสูตร" : "ยังไม่มีสูตร", detail: "ผลิตแล้วไม่ตัดวัตถุดิบ · ต้นทุนไม่มี" });
    const off = madeFrom.filter((id) => byId.get(id)?.status === "Inactive");
    if (off.length) checks.push({ id: "recipe-inactive", level: "error", area: "recipe", title: "สูตรใช้ของที่ปิดใช้แล้ว", detail: off.map((id) => byId.get(id)?.name).join(" · ") });
    const noPrice = madeFrom.filter((id) => !hasPrice(id));
    if (noPrice.length) checks.push({ id: "recipe-no-price", level: "error", area: "recipe", title: "สูตรมีวัตถุดิบที่ไม่มีราคา", detail: noPrice.map((id) => byId.get(id)?.name).join(" · ") });
    // The saved cost is a step behind the recipe (an ingredient price moved since)
    const saved = active.find((p) => p.supplierId === BOM_SUPPLIER_ID)?.pricePerUsageUom;
    if (recipeCost && saved !== undefined && Math.abs(recipeCost - saved) > 0.01 * Math.max(recipeCost, saved))
      checks.push({ id: "stale-cost", level: "warn", area: "recipe", title: "ต้นทุนในระบบไม่ตรงกับสูตร", detail: "ราคาวัตถุดิบเปลี่ยนหลังจากคิดครั้งล่าสุด · กดคิดใหม่" });
  } else {
    if (!active.length) checks.push(used ? { id: "no-price", level: "error", area: "price", title: "ใช้ในสูตรแต่ไม่มีราคา", detail: "ต้นทุนเป็น ฿0 ทุกที่ที่ใช้" } : { id: "no-price", level: "warn", area: "price", title: "ยังไม่มีราคา" });
    if (active.length > 1) checks.push({ id: "multi-price", level: "error", area: "price", title: `มีราคาใช้งาน ${active.length} เจ้า`, detail: "เลือกเจ้าหลักเป็นราคามาตรฐาน" });
  }

  // Recent bills vs the standard price. Bills are priced per purchase unit (the bill's
  // qty is packs × pack size, no converter), so compare per pack.
  let billRatio: number | null = null;
  const recent = bills.filter((b) => b.unitPrice > 0).slice(0, 3);
  if (recent.length && standard && standard.pricePerPurchaseUom > 0) {
    billRatio = (recent.reduce((s, b) => s + b.unitPrice, 0) / recent.length) * (sku.packSize || 1) / standard.pricePerPurchaseUom;
    if (Math.abs(billRatio - 1) > BILL_DRIFT) {
      const pct = Math.round((billRatio - 1) * 100);
      checks.push({ id: "bill-drift", level: "warn", area: "price", title: `บิลล่าสุด${pct > 0 ? "แพงกว่า" : "ถูกกว่า"}ราคามาตรฐาน ${Math.abs(pct)}%`, detail: "ต้นทุนเมนูที่ใช้ตัวนี้คลาดจากจริง" });
    }
  }

  if (!isMadeItem(sku) && !used && !bills.length) checks.push({ id: "unused", level: "idle", area: "use", title: "ไม่ได้ใช้ในสูตรไหน และไม่ได้ซื้อ 90 วัน" });

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
