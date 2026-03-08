export type SupplierStatus = 'Active' | 'Inactive';

export interface Supplier {
  id: string;
  name: string;
  leadTime: number;
  moq: number;
  moqUnit: string;
  contactPerson: string;
  phone: string;
  creditTerms: string;
  status: SupplierStatus;
}

export const EMPTY_SUPPLIER: Omit<Supplier, 'id'> = {
  name: '',
  leadTime: 0,
  moq: 0,
  moqUnit: '',
  contactPerson: '',
  phone: '',
  creditTerms: '',
  status: 'Active',
};
