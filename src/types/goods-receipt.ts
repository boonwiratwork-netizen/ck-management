export interface GoodsReceipt {
  id: string;
  receiptDate: string;       // ISO date
  weekNumber: number;        // auto-calculated
  skuId: string;             // references SKU.id (RM only)
  supplierId: string;        // references Supplier.id
  quantityReceived: number;  // in Purchase UOM
  purchaseUom: string;       // auto-filled from SKU
  actualPrice: number;       // actual price paid per Purchase UOM, ex VAT
  standardPrice: number;     // auto-filled from active Price Master
  priceVariance: number;     // auto-calculated: actual − standard
  note: string;
}

export const EMPTY_GOODS_RECEIPT: Omit<GoodsReceipt, 'id' | 'weekNumber' | 'purchaseUom' | 'standardPrice' | 'priceVariance'> = {
  receiptDate: new Date().toISOString().slice(0, 10),
  skuId: '',
  supplierId: '',
  quantityReceived: 0,
  actualPrice: 0,
  note: '',
};

/** ISO week number from a date string */
export function getWeekNumber(dateStr: string): number {
  const date = new Date(dateStr);
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}
