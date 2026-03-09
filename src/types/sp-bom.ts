export interface SpBomLine {
  id: string;
  spSkuId: string;
  ingredientSkuId: string;
  qtyPerBatch: number;
  uom: string;
  batchYieldQty: number;
  batchYieldUom: string;
  costPerUnit: number;
}

export const EMPTY_SP_BOM_LINE: Omit<SpBomLine, 'id' | 'costPerUnit'> = {
  spSkuId: '',
  ingredientSkuId: '',
  qtyPerBatch: 0,
  uom: '',
  batchYieldQty: 1,
  batchYieldUom: '',
};
