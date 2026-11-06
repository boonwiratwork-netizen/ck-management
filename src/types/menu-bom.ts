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
}

export const EMPTY_MENU_BOM_LINE: Omit<MenuBomLine, 'id' | 'effectiveQty' | 'costPerServing'> = {
  menuId: '',
  skuId: '',
  qtyPerServing: 0,
  uom: '',
  yieldPct: 100,
};
