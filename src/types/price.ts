export interface Price {
  id: string;
  skuId: string;       // references SKU.id
  supplierId: string;  // references Supplier.id
  pricePerPurchaseUom: number;
  pricePerUsageUom: number; // auto-calculated
  vat: boolean;
  isActive: boolean;
  effectiveDate: string; // ISO date
  note: string;
}

export const EMPTY_PRICE: Omit<Price, 'id' | 'pricePerUsageUom'> = {
  skuId: '',
  supplierId: '',
  pricePerPurchaseUom: 0,
  vat: false,
  isActive: false,
  effectiveDate: new Date().toISOString().slice(0, 10),
  note: '',
};
