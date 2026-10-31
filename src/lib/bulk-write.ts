/**
 * How a many-row insert went. "none": the database answered with a refusal (HTTP 4xx/5xx) —
 * one insert is one statement, so nothing of it is in and writing the rows one by one is safe.
 * "unknown": no answer (dropped connection, status 0, or a throw: the insert may have landed
 * before the reply was lost) or fewer rows came back than were sent — writing them again
 * could double them.
 */
export type BulkResult = "ok" | "none" | "unknown";

/**
 * Write rows in one request; if that was refused, one by one. Returns the rows that are not
 * known to be in (empty = all in). After an "unknown" every row is returned unwritten-again:
 * the caller reports them for a person to check instead of risking a double.
 */
export async function writeAllOrEach<T>(rows: T[], bulk: (rows: T[]) => Promise<BulkResult>, one: (row: T) => Promise<boolean>): Promise<T[]> {
  if (rows.length === 0) return [];
  const all = await bulk(rows).catch((): BulkResult => "unknown");
  if (all === "ok") return [];
  if (all === "unknown") return rows;
  const each = await Promise.all(rows.map((r) => one(r).catch(() => false)));
  return rows.filter((_, i) => !each[i]);
}

/** A many-row insert's answer as a BulkResult (`sent`: how many rows went) */
export function bulkResult(sent: number, res: { data: unknown[] | null; error: unknown; status?: number }): BulkResult {
  if (res.error) return (res.status ?? 0) >= 400 ? "none" : "unknown";
  return (res.data?.length ?? 0) >= sent ? "ok" : "unknown";
}

/**
 * writeAllOrEach for a writer that may have no many-rows form (`many` undefined: one after
 * another, as the old pages did). `one` answering false = not in; anything else = in.
 */
export async function writeManyOrEach<T>(list: T[], many: ((rows: T[]) => Promise<BulkResult>) | undefined, one: (row: T) => void | Promise<unknown>): Promise<T[]> {
  const each = async (row: T) => (await one(row)) !== false;
  if (many) return writeAllOrEach(list, many, each);
  const failed: T[] = [];
  for (const row of list) if (!(await each(row).catch(() => false))) failed.push(row);
  return failed;
}
