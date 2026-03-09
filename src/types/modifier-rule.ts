export interface ModifierRule {
  id: string;
  keyword: string;
  skuId: string;
  qtyPerMatch: number;
  uom: string;
  description: string;
  isActive: boolean;
  menuId: string | null;
}

export const EMPTY_MODIFIER_RULE: Omit<ModifierRule, 'id'> = {
  keyword: '',
  skuId: '',
  qtyPerMatch: 0,
  uom: '',
  description: '',
  isActive: true,
  menuId: null,
};
