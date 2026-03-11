import { toLocalDateStr } from '@/lib/utils';

export interface GoodsReceipt {
  id: string;
  receiptDate: string;       // ISO date
  weekNumber: number;        // auto-calculated
  skuId: string;             // references SKU.id (RM only)
  supplierId: string;        // references Supplier.id
  quantityReceived: number;  // in Usage UOM (g, ml, etc.)
  usageUom: string;          // auto-filled from SKU
  actualTotal: number;       // total amount paid (entered by user)
  actualUnitPrice: number;   // actualTotal ÷ qty (auto-calculated)
  stdUnitPrice: number;      // active Price Master price per Usage UOM
  standardPrice: number;     // stdUnitPrice × qty (total standard value)
  priceVariance: number;     // actualTotal − standardPrice
  note: string;
}

export const EMPTY_GOODS_RECEIPT: Omit<GoodsReceipt, 'id' | 'weekNumber' | 'usageUom' | 'stdUnitPrice' | 'standardPrice' | 'priceVariance' | 'actualUnitPrice'> = {
  receiptDate: toLocalDateStr(new Date()),
  skuId: '',
  supplierId: '',
  quantityReceived: 0,
  actualTotal: 0,
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
