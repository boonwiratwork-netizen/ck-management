export type ModifierRuleType = 'add' | 'swap' | 'submenu';

export interface ModifierRule {
  id: string;
  keyword: string;
  skuId: string;
  qtyPerMatch: number;
  uom: string;
  description: string;
  isActive: boolean;
  menuId: string | null;       // kept for backward compat, but deprecated
  menuIds: string[];            // NEW: from junction table
  ruleType: ModifierRuleType;
  swapSkuId: string | null;
  submenuId: string | null;
}

export const EMPTY_MODIFIER_RULE: Omit<ModifierRule, 'id'> = {
  keyword: '',
  skuId: '',
  qtyPerMatch: 0,
  uom: '',
  description: '',
  isActive: true,
  menuId: null,
  menuIds: [],
  ruleType: 'add',
  swapSkuId: null,
  submenuId: null,
};
