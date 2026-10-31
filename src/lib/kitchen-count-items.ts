import type { SKU } from "@/types/sku";

/**
 * What the kitchen's monthly count lists (the count sheet and the printed sheet use
 * the same rule): active RM in a recipe or sent to branches, active SM with a recipe
 * or kept in stock as a recipe's by-product (น้ำสต๊อกโทริ ไพตัน comes out of the
 * stock pot and had no line of its own, so it was never counted), and every PK.
 */
export function countsInKitchenSheet(
  s: Pick<SKU, "id" | "type" | "status" | "isDistributable">,
  r: { smWithBom: Set<string>; rmInBom: Set<string>; trackedByproducts: Set<string> },
): boolean {
  if (s.status !== "Active") return false;
  if (s.type === "RM") return r.rmInBom.has(s.id) || s.isDistributable === true;
  if (s.type === "SM") return r.smWithBom.has(s.id) || r.trackedByproducts.has(s.id);
  return s.type === "PK";
}
