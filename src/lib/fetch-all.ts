/**
 * Supabase returns at most 1,000 rows per request and silently drops the rest.
 * Pass a builder that ends with `.order(..., "id")` and `.range(from, to)`; this
 * keeps asking for the next 1,000 until a short page comes back.
 */
export async function fetchAllRows<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<{ data: T[]; error: unknown }> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) return { data: out, error };
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < 1000) break;
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
