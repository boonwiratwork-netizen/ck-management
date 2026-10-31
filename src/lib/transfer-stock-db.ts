import { supabase } from "@/integrations/supabase/client";
import { bangkokDate } from "@/lib/day-follow";
import { claimOutcome, distributionDate, distributionDeltas, distributionReasons, type Claim, type DistributionRow, type OrderState } from "@/lib/transfer-stock";

/**
 * The database side of lib/transfer-stock.ts. Once the 1 Nov 2026 migration is in, the
 * database functions do each step in one transaction; until then (the function isn't there)
 * the app does the same steps itself. Supabase reports no error when row security filters out
 * an update or delete (it just touches 0 rows), so every write here counts the rows it got
 * back and treats fewer than expected as a failure.
 */

type DbError = { code?: string; message?: string } | null;

/** The function isn't in the database (yet): PostgREST says so with PGRST202 */
export const isMissingFunction = (e: DbError) => !!e && (e.code === "PGRST202" || e.code === "42883" || /could not find the function/i.test(e.message ?? ""));

export type DbCall<T> = { kind: "answer"; value: T } | { kind: "unavailable" } | { kind: "refused"; message: string } | { kind: "unknown"; message: string };

/**
 * Call one of the migration's functions. "unavailable" = not installed, take the app's own
 * steps; "refused" = the database answered with an error (a rule, a permission: its transaction
 * was rolled back, nothing saved); "unknown" = no answer (the connection dropped): it may or may
 * not have saved, so the caller reads the database back before saying anything.
 */
/** How long a database function may take before the app stops waiting */
export const DB_CALL_TIMEOUT_MS = 15000;

export async function callDbFunction<T>(fn: string, args: Record<string, unknown>): Promise<DbCall<T>> {
  const call = supabase.rpc as unknown as (f: string, a: Record<string, unknown>) => PromiseLike<{ data: unknown; error: DbError }>;
  // No answer within the limit = "unknown" (the caller reads back), so a stuck connection or
  // sign-in refresh never leaves a button spinning for minutes
  const timedOut = Symbol("timeout");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const res = await Promise.race([
    Promise.resolve(call(fn, args)),
    new Promise<typeof timedOut>((resolve) => { timer = setTimeout(() => resolve(timedOut), DB_CALL_TIMEOUT_MS); }),
  ]).finally(() => clearTimeout(timer));
  if (res === timedOut) return { kind: "unknown", message: "ระบบไม่ตอบ ลองรีเฟรชหน้า (F5) แล้วดูยอดก่อนบันทึกซ้ำ" };
  const { data, error } = res;
  if (!error) return { kind: "answer", value: data as T };
  if (isMissingFunction(error)) return { kind: "unavailable" };
  // An answer from the database carries its error code (P0001, 42501, PGRST…); a dropped connection has none
  if (error.code) return { kind: "refused", message: error.message || error.code };
  return { kind: "unknown", message: error.message || "เชื่อมต่อไม่ได้" };
}

/** How many branch receipts point at an order (null = couldn't read) */
export async function receiptCount(toId: string): Promise<number | null> {
  const { count, error } = await supabase.from("branch_receipts").select("id", { count: "exact", head: true }).eq("transfer_order_id", toId);
  return error ? null : count ?? 0;
}

/** The order's status and how many receipts it has (null = couldn't read) */
export async function orderState(toId: string): Promise<OrderState | null> {
  const [to, receipts] = await Promise.all([supabase.from("transfer_orders").select("status").eq("id", toId).maybeSingle(), receiptCount(toId)]);
  if (to.error || receipts === null) return null;
  return { status: to.data?.status ?? null, receipts };
}

/** Move an order on from `from`: matches only while it still is `from` */
export async function moveOrder(toId: string, from: string, patch: { status: string; decline_reason?: string | null }): Promise<Claim> {
  const { data, error } = await supabase.from("transfer_orders").update(patch).eq("id", toId).eq("status", from).select("id");
  if (error) return { kind: "error", message: error.message };
  if (data && data.length > 0) return { kind: "ok" };
  const { data: now, error: readErr } = await supabase.from("transfer_orders").select("status").eq("id", toId).maybeSingle();
  if (readErr) return { kind: "error", message: readErr.message };
  return claimOutcome(now?.status, from);
}

/** Put a claimed order back to Sent (tried a few times; false = it couldn't) */
export async function releaseClaim(toId: string, claimedAs: string): Promise<boolean> {
  for (let i = 0; i < 3; i++) {
    const { data, error } = await supabase.from("transfer_orders").update({ status: "Sent" }).eq("id", toId).eq("status", claimedAs).select("id");
    if (!error) return (data?.length ?? 0) > 0;
    await new Promise((r) => setTimeout(r, 400 * (i + 1)));
  }
  return false;
}

/** An order's RM/PK rows, by either tag it can carry */
async function distributionRows(to: { id: string; toNumber: string }): Promise<{ rows: (DistributionRow & { id: string })[]; error: string | null }> {
  const res = await Promise.all(
    distributionReasons(to).map((reason) => supabase.from("stock_adjustments").select("id, sku_id, quantity, stock_type, adjustment_date").is("branch_id", null).eq("reason", reason).order("id")),
  );
  const failed = res.find((r) => r.error);
  if (failed?.error) return { rows: [], error: failed.error.message };
  return { rows: res.flatMap((r) => (r.data ?? []) as (DistributionRow & { id: string })[]), error: null };
}

/**
 * Bring a sent order's RM/PK deduction to what its lines say now, adding only the difference
 * on the day the order went out: the database's sync_transfer_distribution once installed,
 * else the same rule here. Returns an error text, or null when done.
 */
export async function syncDistribution(to: { id: string; toNumber: string; sentAt?: string | null; deliveryDate?: string | null }): Promise<string | null> {
  const db = await callDbFunction<number>("sync_transfer_distribution", { p_to_id: to.id });
  if (db.kind === "answer") return null;
  if (db.kind === "refused" || db.kind === "unknown") return db.message;
  const [lines, current] = await Promise.all([
    supabase.from("transfer_order_lines").select("sku_id, sku_type, actual_qty").eq("to_id", to.id).in("sku_type", ["RM", "PK"]).order("id"),
    distributionRows(to),
  ]);
  if (lines.error) return lines.error.message;
  if (current.error) return current.error;
  const date = distributionDate(current.rows, to.sentAt, to.deliveryDate, bangkokDate());
  const add = distributionDeltas(lines.data ?? [], current.rows, date, `Distribution: ${to.toNumber}`);
  if (add.length === 0) return null;
  const { data, error } = await supabase.from("stock_adjustments").insert(add).select("id");
  if (error) return error.message;
  if ((data?.length ?? 0) < add.length) return "บันทึกไม่ครบทุกรายการ";
  return null;
}

/**
 * A cancelled or declined order takes nothing out: its RM/PK rows go. Once the migration is
 * in, the database does this itself as the status changes and nothing is left here to remove.
 * Returns an error text, or null when done.
 */
export async function removeDistribution(to: { id: string; toNumber: string }): Promise<string | null> {
  const { rows, error } = await distributionRows(to);
  if (error) return error;
  if (rows.length === 0) return null;
  const ids = rows.map((r) => r.id);
  const { data, error: delErr } = await supabase.from("stock_adjustments").delete().in("id", ids).select("id");
  if (delErr) return delErr.message;
  if ((data?.length ?? 0) < ids.length) return "บัญชีนี้ไม่มีสิทธิ์คืนสต๊อกครัว";
  return null;
}
