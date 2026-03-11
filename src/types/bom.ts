export type ProductionType = 'CK' | 'Outsource';
export type BOMMode = 'simple' | 'multistep';
export type IngredientQtyType = 'fixed' | 'percent';

export interface BOMHeader {
  id: string;
  smSkuId: string;
  productionType: ProductionType;
  bomMode: BOMMode;
  // Simple BOM fields
  batchSize: number;       // grams
  yieldPercent: number;    // e.g. 0.70
}

export interface BOMLine {
  id: string;
  bomHeaderId: string;
  rmSkuId: string;
  qtyPerBatch: number;     // in usage UOM
  yieldPercent: number;    // 0–1 decimal, e.g. 0.35 = 35%
  // For multi-step: which step this ingredient belongs to
  stepId?: string;
  qtyType?: IngredientQtyType;
  percentOfInput?: number; // e.g. 0.10 = 10%
}

export interface BOMStep {
  id: string;
  bomHeaderId: string;
  stepNumber: number;
  stepName: string;
  yieldPercent: number; // e.g. 0.80
}

export const EMPTY_BOM_HEADER: Omit<BOMHeader, 'id'> = {
  smSkuId: '',
  productionType: 'CK',
  bomMode: 'simple',
  batchSize: 0,
  yieldPercent: 1.0,
};

export const EMPTY_BOM_LINE: Omit<BOMLine, 'id' | 'bomHeaderId'> = {
  rmSkuId: '',
  qtyPerBatch: 0,
  yieldPercent: 1.0,
};

export const EMPTY_BOM_STEP: Omit<BOMStep, 'id' | 'bomHeaderId'> = {
  stepNumber: 1,
  stepName: '',
  yieldPercent: 1.0,
};

