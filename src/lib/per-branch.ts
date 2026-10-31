import { fetchAllRowsOrThrow } from "@/lib/fetch-all";

/**
 * One paged read per branch, all at once, joined. A month of sales for every branch runs to
 * tens of thousands of rows: read as one list its pages come one after another (~2 s each);
 * per branch they come side by side. A failed page fails the whole read (no partial month
 * shown as if it were all of it).
 */
export async function perBranchRows<T>(branchIds: string[], build: (branchId: string, from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const parts = await Promise.all(branchIds.map((id) => fetchAllRowsOrThrow<T>((a, b) => build(id, a, b))));
  return parts.flat();
}
