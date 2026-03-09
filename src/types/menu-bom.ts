export interface MenuBomLine {
  id: string;
  menuId: string;
  skuId: string;
  qtyPerServing: number;
  uom: string;
  yieldPct: number;
  effectiveQty: number;
  costPerServing: number;
}

export const EMPTY_MENU_BOM_LINE: Omit<MenuBomLine, 'id' | 'effectiveQty' | 'costPerServing'> = {
  menuId: '',
  skuId: '',
  qtyPerServing: 0,
  uom: '',
  yieldPct: 100,
};
