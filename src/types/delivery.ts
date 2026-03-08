export interface Delivery {
  id: string;
  deliveryDate: string;       // ISO date
  weekNumber: number;
  branchName: string;
  smSkuId: string;            // references SKU.id (SM type only)
  qtyDeliveredKg: number;
  note: string;
}

export const EMPTY_DELIVERY: Omit<Delivery, 'id' | 'weekNumber'> = {
  deliveryDate: new Date().toISOString().slice(0, 10),
  branchName: '',
  smSkuId: '',
  qtyDeliveredKg: 0,
  note: '',
};
