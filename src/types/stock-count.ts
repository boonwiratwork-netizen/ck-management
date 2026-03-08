export type StockCountStatus = 'Draft' | 'Completed';

export interface StockCountSession {
  id: string;
  date: string;           // ISO date
  note: string;
  status: StockCountStatus;
  createdAt: string;      // ISO datetime
  completedAt?: string;   // ISO datetime
}

export interface StockCountLine {
  id: string;
  sessionId: string;
  skuId: string;
  type: 'RM' | 'SM';
  systemQty: number;
  physicalQty: number | null;  // null = not yet counted
  variance: number;            // physical - system (0 if not counted)
  note: string;
}
