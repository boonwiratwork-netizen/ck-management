export interface BomByproduct {
  id: string;
  bomHeaderId: string;
  skuId: string | null;
  name: string;
  outputQty: number;
  costAllocationPct: number;
  tracksInventory: boolean;
}

export const EMPTY_BYPRODUCT: Omit<BomByproduct, 'id' | 'bomHeaderId'> = {
  skuId: null,
  name: '',
  outputQty: 0,
  costAllocationPct: 0,
  tracksInventory: false,
};
