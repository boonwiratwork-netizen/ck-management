export type MenuCategory = 'Signature Ramen' | 'Ramen' | 'Rice Bowl' | 'Sides' | 'Drinks' | 'Dessert' | 'Other';
export type MenuStatus = 'Active' | 'Inactive';

export interface Menu {
  id: string;
  menuCode: string;
  menuName: string;
  category: string;
  sellingPrice: number;
  status: MenuStatus;
  brandName: string;
}

export const MENU_CATEGORIES: string[] = [
  'Signature Ramen', 'Ramen', 'Rice Bowl', 'Sides', 'Drinks', 'Dessert', 'Other',
];

export const EMPTY_MENU: Omit<Menu, 'id'> = {
  menuCode: '',
  menuName: '',
  category: '',
  sellingPrice: 0,
  status: 'Active',
  brandName: '',
};
