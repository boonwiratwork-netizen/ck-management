export type StockCountStatus = 'Draft' | 'Completed';

export interface StockCountSession {
  id: string;
  date: string;           // ISO date
  note: string;
  status: StockCountStatus;
  createdAt: string;      // ISO datetime
  completedAt?: string;   // ISO datetime
  deletedAt?: string;     // ISO datetime — soft delete
}

export interface StockCountLine {
  id: string;
  sessionId: string;
  skuId: string;
  type: 'RM' | 'SM' | 'SP' | 'PK';
  systemQty: number;
  physicalQty: number | null;  // null = not yet counted
  variance: number;            // physical - system (0 if not counted)
  note: string;
}
