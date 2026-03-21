export type SKUType = 'RM' | 'SM' | 'SP' | 'PK';
export type SKUStatus = 'Active' | 'Inactive';
export type StorageCondition = 'Frozen' | 'Chilled' | 'Ambient';

// Category is now a dynamic string code from sku_categories table
export type Category = string;

export interface SKU {
  id: string;
  skuId: string;
  name: string;
  type: SKUType;
  category: Category;
  status: SKUStatus;
  specNote: string;
  packSize: number;
  packUnit: string;
  purchaseUom: string;
  usageUom: string;
  converter: number;
  storageCondition: StorageCondition;
  shelfLife: number;
  vat: boolean;
  supplier1: string;
  supplier2: string;
  leadTime: number;
  isDistributable: boolean;
}

export const SKU_TYPE_LABELS: Record<SKUType, string> = {
  RM: 'Raw Material',
  SM: 'Semi-finished',
  SP: 'Special',
  PK: 'Packaging',
};

// Legacy static labels kept for backward compat but dynamic categories preferred
export const CATEGORY_LABELS: Record<string, string> = {
  MT: 'Meat',
  SF: 'Seafood',
  VG: 'Vegetable',
  FR: 'Fruit',
  DG: 'Dry Goods',
  SC: 'Sauce',
  DY: 'Dairy',
  OL: 'Oil',
};

export const EMPTY_SKU: Omit<SKU, 'id' | 'skuId'> = {
  name: '',
  type: 'RM',
  category: 'MT',
  status: 'Active',
  specNote: '',
  packSize: 1,
  packUnit: '',
  purchaseUom: '',
  usageUom: '',
  converter: 1,
  storageCondition: 'Ambient',
  shelfLife: 0,
  vat: false,
  supplier1: '',
  supplier2: '',
  leadTime: 0,
  isDistributable: false,
};
