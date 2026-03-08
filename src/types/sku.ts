export type SKUType = 'RM' | 'SM' | 'SP' | 'PK';
export type SKUStatus = 'Active' | 'Inactive';
export type StorageCondition = 'Frozen' | 'Chilled' | 'Ambient';
export type Category = 'MT' | 'SF' | 'VG' | 'FR' | 'DG' | 'SC' | 'DY' | 'OL';

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
}

export const SKU_TYPE_LABELS: Record<SKUType, string> = {
  RM: 'Raw Material',
  SM: 'Semi-finished',
  SP: 'Special',
  PK: 'Packaging',
};

export const CATEGORY_LABELS: Record<Category, string> = {
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
};
