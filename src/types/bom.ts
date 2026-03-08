export type ProductionType = 'CK' | 'Outsource';

export interface BOMHeader {
  id: string;
  smSkuId: string;        // references SKU.id (SM type only)
  productionType: ProductionType;
  batchSize: number;       // grams
  yieldPercent: number;    // e.g. 0.70
  // auto-calculated: batchSize * yieldPercent
}

export interface BOMLine {
  id: string;
  bomHeaderId: string;
  rmSkuId: string;         // references SKU.id (RM type only)
  qtyPerBatch: number;     // in usage UOM
  // auto-filled from SKU/Price: ingredientName, usageUom, costPerUnit
}

export const EMPTY_BOM_HEADER: Omit<BOMHeader, 'id'> = {
  smSkuId: '',
  productionType: 'CK',
  batchSize: 0,
  yieldPercent: 0.7,
};

export const EMPTY_BOM_LINE: Omit<BOMLine, 'id' | 'bomHeaderId'> = {
  rmSkuId: '',
  qtyPerBatch: 0,
};
