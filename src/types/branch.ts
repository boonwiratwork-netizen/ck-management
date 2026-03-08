export type BranchStatus = 'Active' | 'Inactive';

export interface Branch {
  id: string;
  branchName: string;
  brandName: string;
  location: string;
  status: BranchStatus;
}

export const EMPTY_BRANCH: Omit<Branch, 'id'> = {
  branchName: '',
  brandName: '',
  location: '',
  status: 'Active',
};
