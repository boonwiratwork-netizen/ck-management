export interface Delivery {
  id: string;
  deliveryDate: string;       // ISO date
  weekNumber: number;
  branchName: string;
  smSkuId: string;            // references SKU.id (SM type only)
  qtyDeliveredG: number;     // in grams
  note: string;
}

export const EMPTY_DELIVERY: Omit<Delivery, 'id' | 'weekNumber'> = {
  deliveryDate: toLocalDateStr(new Date()),
  branchName: '',
  smSkuId: '',
  qtyDeliveredG: 0,
  note: '',
};
