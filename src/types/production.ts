export type PlanStatus = 'Planned' | 'In Progress' | 'Done';

export interface ProductionPlan {
  id: string;
  weekNumber: number;
  weekStartDate: string;     // ISO date (Monday)
  weekEndDate: string;       // ISO date (Sunday)
  smSkuId: string;           // references SKU.id (SM type only)
  targetQtyKg: number;       // target output in kg
  numBatches: number;        // auto-calculated: targetQtyKg * 1000 / outputPerBatch
  status: PlanStatus;
}

export interface ProductionRecord {
  id: string;
  planId: string;            // references ProductionPlan.id
  productionDate: string;    // ISO date
  smSkuId: string;           // auto-filled from plan
  batchesProduced: number;
  actualOutputKg: number;    // actual output in kg
}

export const EMPTY_PRODUCTION_PLAN: Omit<ProductionPlan, 'id' | 'numBatches' | 'weekNumber' | 'weekStartDate' | 'weekEndDate'> = {
  smSkuId: '',
  targetQtyKg: 0,
  status: 'Planned',
};

export const EMPTY_PRODUCTION_RECORD: Omit<ProductionRecord, 'id' | 'smSkuId'> = {
  planId: '',
  productionDate: new Date().toISOString().slice(0, 10),
  batchesProduced: 0,
  actualOutputKg: 0,
};

/** Get Monday of the week for a given date */
export function getWeekStart(dateStr: string): string {
  const d = new Date(dateStr);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const mon = new Date(d.setDate(diff));
  return mon.toISOString().slice(0, 10);
}

/** Get Sunday of the week for a given date */
export function getWeekEnd(startDate: string): string {
  const d = new Date(startDate);
  d.setDate(d.getDate() + 6);
  return d.toISOString().slice(0, 10);
}

/** ISO week number */
export function getISOWeekNumber(dateStr: string): number {
  const date = new Date(dateStr);
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}
