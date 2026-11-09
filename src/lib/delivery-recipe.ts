import type { MenuBomLine } from "@/types/menu-bom";
import type { Price } from "@/types/price";
import { lineCost } from "@/lib/menu-health";

/**
 * The recipe as a delivery sale sees it (Menu Setup → สูตร → เดลิเวอรี), worked out from
 * the menu's lines. Same rule as the usage engine (src/lib/sale-usage.ts):
 *  - a shop line with no delivery amount follows the shop ("same");
 *  - a shop line with a delivery amount uses it ("changed"), 0 = not used ("off");
 *  - a delivery-only line is used by delivery sales only ("only").
 * Pure, so the screen and the tests read the same thing.
 */
export type DeliveryRowKind = "same" | "changed" | "off" | "only";

export interface DeliveryRow {
  line: MenuBomLine;
  kind: DeliveryRowKind;
  /** The shop amount per serving (before yield); null for a delivery-only line */
  shopQty: number | null;
  /** What a delivery sale serves (before yield): 0 for "off" */
  deliveryQty: number;
  /** Cost of this row for one delivery serving (0 for "off") */
  cost: number;
}

/** One shop line, or one delivery-only line, as delivery sees it */
export function deliveryRow(line: MenuBomLine, prices: Price[]): DeliveryRow {
  if (line.deliveryOnly) return { line, kind: "only", shopQty: null, deliveryQty: line.qtyPerServing, cost: lineCost(line, prices) };
  const d = line.deliveryQty;
  // An amount equal to the shop's reads as "same" (nothing to point out)
  if (d === null || d === undefined || d === line.qtyPerServing) return { line, kind: "same", shopQty: line.qtyPerServing, deliveryQty: line.qtyPerServing, cost: lineCost(line, prices) };
  if (d === 0) return { line, kind: "off", shopQty: line.qtyPerServing, deliveryQty: 0, cost: 0 };
  return { line, kind: "changed", shopQty: line.qtyPerServing, deliveryQty: d, cost: lineCost({ ...line, qtyPerServing: d }, prices) };
}

/**
 * One block of the delivery recipe: the block's shop lines in their order, then the
 * delivery-only lines of the same block (same branch_id).
 */
export function deliveryRows(shopLines: MenuBomLine[], deliveryOnlyLines: MenuBomLine[], prices: Price[]): DeliveryRow[] {
  return [...shopLines.filter((l) => !l.deliveryOnly), ...deliveryOnlyLines.filter((l) => l.deliveryOnly)].map((l) => deliveryRow(l, prices));
}

export const deliveryCost = (rows: DeliveryRow[]) => rows.reduce((s, r) => s + r.cost, 0);

/** Rows that differ from the shop (changed, not used, delivery-only) */
export const deliveryDiffCount = (rows: DeliveryRow[]) => rows.filter((r) => r.kind !== "same").length;

/**
 * The menu has its own delivery recipe: some line has a delivery amount set (even one
 * equal to the shop's — it was set on purpose) or there is a delivery-only line.
 * Without one, delivery orders take the shop recipe.
 */
export function hasDeliveryRecipe(lines: MenuBomLine[]): boolean {
  return lines.some((l) => l.deliveryOnly || (l.deliveryQty !== null && l.deliveryQty !== undefined));
}

/**
 * What to save for a delivery amount typed against a shop line: blank or the shop
 * amount = null (follow the shop, also when the shop amount changes later); a number ≥ 0
 * = that amount; anything else = undefined (invalid).
 */
export function deliveryQtyToSave(typed: string, shopQty: number): number | null | undefined {
  const t = typed.trim();
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n === shopQty ? null : n;
}
