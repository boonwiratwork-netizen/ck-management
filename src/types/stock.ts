export interface StockBalance {
  skuId: string;
  openingStock: number;       // manually set once, in usage UOM
  totalReceived: number;      // sum from Goods Receipts
  totalConsumed: number;      // from Production (0 for now)
  adjustments: StockAdjustment[];
  currentStock: number;       // opening + received - consumed + net adjustments
}

export interface StockAdjustment {
  id: string;
  skuId: string;
  date: string;               // ISO date
  quantity: number;           // positive = add, negative = subtract
  reason: string;
}
