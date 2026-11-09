export interface MenuBomLine {
  id: string;
  menuId: string;
  skuId: string;
  qtyPerServing: number;
  uom: string;
  yieldPct: number;
  effectiveQty: number;
  costPerServing: number;
  branchId?: string | null;
  /** Spec / note for the shop on this line (recipe sheet); empty when none or the column isn't there yet */
  specNote?: string;
  /**
   * Served amount per serving for a delivery sale, same unit as qtyPerServing and before
   * yield (menu_bom.delivery_qty). null / absent = the same as in the shop; 0 = not used for delivery.
   */
  deliveryQty?: number | null;
  /**
   * A line only delivery uses (menu_bom.delivery_only: the delivery box). Its qtyPerServing
   * is the delivery amount; deliveryQty stays null. Shop sales, the shop recipe, its cost
   * and the recipe sheet skip it. Absent = false (also before the migration).
   */
  deliveryOnly?: boolean;
}

/** The shop recipe: every line except delivery-only ones */
export const isShopLine = (l: { deliveryOnly?: boolean }) => !l.deliveryOnly;

export const EMPTY_MENU_BOM_LINE: Omit<MenuBomLine, 'id' | 'effectiveQty' | 'costPerServing'> = {
  menuId: '',
  skuId: '',
  qtyPerServing: 0,
  uom: '',
  yieldPct: 100,
};
