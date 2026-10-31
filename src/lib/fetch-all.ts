/**
 * Supabase returns at most a fixed number of rows per request (10,000 here, measured 31 Oct
 * 2026; 1,000 is its default) and silently drops the rest. Pass a builder that ends with
 * `.order(..., "id")` and `.range(from, to)`; this asks for 10,000 at a time — every request
 * costs ~0.2 s however small, so fewer, bigger pages are faster — and goes on from the rows it
 * got. A page of a whole multiple of 1,000 may have been cut by a lower limit, so it asks
 * again; anything shorter is the end.
 */
const PAGE = 10000;

export async function fetchAllRows<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<{ data: T[]; error: unknown }> {
  const out: T[] = [];
  for (let from = 0; ; ) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) return { data: out, error };
    if (!data || data.length === 0) break;
    out.push(...data);
    from += data.length;
    if (data.length % 1000 !== 0) break;
  }
  return { data: out, error: null };
}

/**
 * fetchAllRows for numbers people act on: a page that fails fails the whole read
 * (throws), instead of handing back the pages before it as if they were everything.
 */
export async function fetchAllRowsOrThrow<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const r = await fetchAllRows(build);
  if (r.error) throw r.error;
  return r.data;
}
