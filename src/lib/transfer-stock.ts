import { bangkokDate } from "@/lib/day-follow";
import { TO_DELIVERED_STATUSES } from "@/lib/to-line-qty";

/**
 * What a transfer order does to the kitchen's stock, apart from the screens so it can be
 * tested. SM leaves the kitchen through the order's lines, read by status (to-line-qty.ts);
 * RM and PK leave through "Distribution: <TO number>" stock adjustments (CLAUDE.md). Every
 * change to an order keeps the two in step:
 *
 * - sent: the RM/PK rows take out what the lines say, dated the day the order went out;
 * - edited after sending: only the difference is added, on that same day. A kitchen count
 *   since then already holds what really left, so dating it later took it out a second time;
 * - cancelled by the kitchen / declined by the branch: the rows go, so the order counts as
 *   never sent, exactly as its SM does when the status leaves TO_DELIVERED_STATUSES;
 * - partly received: nothing moves. The kitchen sent what the lines say and the branch took
 *   in what it counted (the gap shows as "สาขารับไม่ครบ"). If goods really came back, the
 *   kitchen edits the order, which moves SM and RM/PK together.
 */

/** The order has left the kitchen (its stock is out) */
export const isDelivered = (status: string | null | undefined) => (TO_DELIVERED_STATUSES as readonly string[]).includes(status ?? "");

/** The reasons an order's RM/PK rows carry: its number (since Mar 2026), or its id when the number couldn't be read at the time */
export const distributionReasons = (to: { id: string; toNumber: string }) => [...new Set([`Distribution: ${to.toNumber}`, `Distribution: ${to.id}`])];

export interface DistributionLine {
  sku_id: string;
  sku_type: string | null;
  actual_qty: number | string | null;
}
export interface DistributionRow {
  sku_id: string;
  quantity: number | string;
  stock_type: string;
  adjustment_date: string;
}
export interface DistributionInsert {
  sku_id: string;
  quantity: number;
  stock_type: "RM" | "PK";
  adjustment_date: string;
  reason: string;
}

const num = (v: unknown) => Number(v) || 0;
const key = (skuId: string, type: string) => `${skuId}|${type}`;

/** What the order's RM/PK lines take out, per product and stock type (negative) */
export function distributionTarget(lines: DistributionLine[]): Map<string, { skuId: string; stockType: "RM" | "PK"; qty: number }> {
  const out = new Map<string, { skuId: string; stockType: "RM" | "PK"; qty: number }>();
  for (const l of lines) {
    if (l.sku_type !== "RM" && l.sku_type !== "PK") continue;
    const q = num(l.actual_qty);
    if (q <= 0) continue;
    const k = key(l.sku_id, l.sku_type);
    const had = out.get(k) ?? { skuId: l.sku_id, stockType: l.sku_type, qty: 0 };
    had.qty -= q;
    out.set(k, had);
  }
  return out;
}

/**
 * The rows that bring what is out now to what the lines say: only the differences, so the
 * rows already there are never removed first (an order is never left without its
 * deduction, and a save repeated after a failure adds only what is still missing).
 */
export function distributionDeltas(lines: DistributionLine[], rows: DistributionRow[], date: string, reason: string): DistributionInsert[] {
  const target = distributionTarget(lines);
  const current = new Map<string, { skuId: string; stockType: string; qty: number }>();
  for (const r of rows) {
    const k = key(r.sku_id, r.stock_type);
    const had = current.get(k) ?? { skuId: r.sku_id, stockType: r.stock_type, qty: 0 };
    had.qty += num(r.quantity);
    current.set(k, had);
  }
  const out: DistributionInsert[] = [];
  for (const k of new Set([...target.keys(), ...current.keys()])) {
    const t = target.get(k);
    const c = current.get(k);
    const d = (t?.qty ?? 0) - (c?.qty ?? 0);
    if (Math.abs(d) < 1e-6) continue;
    const stockType = (t?.stockType ?? (c!.stockType === "PK" ? "PK" : "RM")) as "RM" | "PK";
    out.push({ sku_id: (t ?? c)!.skuId, quantity: d, stock_type: stockType, adjustment_date: date, reason });
  }
  return out;
}

/**
 * The day an order's RM/PK deduction belongs on: the day it was sent (Bangkok), else the
 * day already on its rows, else its delivery day. Never the day of an edit.
 */
export function distributionDate(rows: { adjustment_date: string }[], sentAt: string | null | undefined, deliveryDate: string | null | undefined, today: string): string {
  if (sentAt) {
    const d = new Date(sentAt);
    if (!Number.isNaN(d.getTime())) return bangkokDate(d);
  }
  const first = rows.map((r) => r.adjustment_date).filter(Boolean).sort()[0];
  return first ?? deliveryDate ?? today;
}

// ─── Moving an order on from "Sent" ───
// Receive, decline and cancel each move an order on only while it is still waiting, so of
// two screens only one gets it and nothing brings back an order the kitchen cancelled. Once
// the 1 Nov 2026 migration is in, the database does each in one transaction
// (receive_transfer_order, decline_transfer_order); until then the app takes the same steps
// itself, with the database calls passed in here (lib/transfer-stock-db.ts has the real
// ones) so the order of steps can be tested. After any failure the database's state decides,
// never what this screen remembers: receipts saved = received.

export type Claim = { kind: "ok" } | { kind: "blocked" } | { kind: "taken"; status: string | null } | { kind: "error"; message: string };

/** What the database says about an order now */
export interface OrderState {
  status: string | null;
  receipts: number;
}

/**
 * Still waiting at the branch: sent and nothing in its stock yet. Marked received with no
 * receipt saved is a receive that didn't finish (its reply was lost, or its save failed and
 * the order couldn't be given back): it waits too.
 */
export const isWaiting = (s: OrderState | null | undefined) => !!s && s.receipts === 0 && isDelivered(s.status);

/** Days a "received, nothing saved" order keeps showing on the branch's list (older ones are for the repair lists) */
export const UNFINISHED_DAYS = 14;

/** The orders a branch can receive: sent, or an unfinished receive from the last UNFINISHED_DAYS (by delivery day) */
export function waitingOrders<T extends OrderState & { delivery_date: string }>(rows: T[], unfinishedFrom: string): T[] {
  return rows.filter((r) => isWaiting(r) && (r.status === "Sent" || r.delivery_date >= unfinishedFrom));
}

/**
 * After an update "where status = <from>" matched nothing: what the order's status says now.
 * Unchanged means this account may not change orders (row security filtered the update out,
 * which Supabase doesn't report as an error); anything else, another screen got there.
 */
export function claimOutcome(statusNow: string | null | undefined, from = "Sent"): { kind: "blocked" } | { kind: "taken"; status: string | null } {
  return statusNow === from ? { kind: "blocked" } : { kind: "taken", status: statusNow ?? null };
}

export type ReceiveResult =
  /** Saved; `closed` false = saved the old way and the order stays Sent (this account can't close orders yet) */
  | { kind: "saved"; count: number; closed: boolean }
  /** Its receipts were already in (another screen, or this screen's save whose reply got lost) */
  | { kind: "already" }
  | { kind: "taken"; status: string | null }
  /** Nothing saved; the order still waits */
  | { kind: "failed" }
  | { kind: "error"; message: string };

export interface ReceiveSteps {
  read: () => Promise<OrderState | null>;
  /** status `from` → `to`, only while it is still `from` */
  move: (from: string, to: string) => Promise<Claim>;
  /** A claimed order back to Sent (best effort) */
  release: (claimedAs: string) => Promise<boolean>;
  /** Save the receipt rows; how many saved (0 = failed) */
  save: () => Promise<number>;
}

/**
 * Receive without the database function (before the migration): claim, save, and if the save
 * reports a failure ask the database whether it landed before giving the claim back. An
 * account that may not change orders yet (store managers then) saves as before, once.
 */
export async function receiveSent(steps: ReceiveSteps, status: string): Promise<ReceiveResult> {
  const s = await steps.read();
  if (!s) return { kind: "error", message: "อ่านใบโอนไม่ได้" };
  if (s.receipts > 0) return { kind: "already" };
  if (!isWaiting(s)) return { kind: "taken", status: s.status };
  const c = await steps.move(s.status!, status);
  if (c.kind === "taken" || c.kind === "error") return c;
  const claimed = c.kind === "ok";
  const count = await steps.save();
  if (count > 0) return { kind: "saved", count, closed: claimed };
  const after = await steps.read();
  if (after && after.receipts > 0) return { kind: "already" };
  // If this fails too the order still shows as waiting (marked received, nothing saved)
  if (claimed) await steps.release(status);
  return { kind: "failed" };
}

/** What receive_transfer_order answers (the database did every step in one transaction) */
export interface DbReceiveAnswer {
  result: "saved" | "already" | "taken" | "gone";
  status?: string | null;
  rows?: unknown[];
}

export function receiveAnswer(a: DbReceiveAnswer, count: number): ReceiveResult {
  if (a.result === "saved") return { kind: "saved", count: a.rows?.length ?? count, closed: true };
  if (a.result === "already") return { kind: "already" };
  return { kind: "taken", status: a.result === "gone" ? null : a.status ?? null };
}

export type ReturnResult = { kind: "done"; stockError: string | null } | { kind: "received" } | Exclude<Claim, { kind: "ok" }>;

export interface ReturnSteps {
  read: () => Promise<OrderState | null>;
  /** `from` → Declined / Cancelled, only while still `from` */
  move: (from: string) => Promise<Claim>;
  /** Remove the order's RM/PK Distribution rows; an error text, or null */
  returnStock: () => Promise<string | null>;
}

/**
 * Decline (branch) or cancel (kitchen) without the database function: only while nothing was
 * received, moved on like a receive, then the kitchen gets its RM/PK back (its SM comes back
 * by the status). The same steps for both, so the two can never leave the kitchen's stock
 * differently.
 *
 * This is the only undo for a sent order: only an unsent draft is ever deleted. Deleting a
 * received order turned the branch's receipts into supplier receipts (their link was set to
 * empty, then × unit converter) while its stock went back to the kitchen as well; a received
 * order is corrected by editing it.
 */
export async function returnSent(steps: ReturnSteps): Promise<ReturnResult> {
  const s = await steps.read();
  if (!s) return { kind: "error", message: "อ่านใบโอนไม่ได้" };
  if (s.receipts > 0) return { kind: "received" };
  if (!isWaiting(s)) return { kind: "taken", status: s.status };
  const c = await steps.move(s.status!);
  if (c.kind !== "ok") return c;
  return { kind: "done", stockError: await steps.returnStock() };
}

/** What decline_transfer_order answers */
export interface DbDeclineAnswer {
  result: "declined" | "already" | "received" | "taken" | "gone";
  status?: string | null;
}

export function declineAnswer(a: DbDeclineAnswer): ReturnResult | { kind: "already" } {
  if (a.result === "declined") return { kind: "done", stockError: null };
  if (a.result === "already") return { kind: "already" };
  if (a.result === "received") return { kind: "received" };
  return { kind: "taken", status: a.result === "gone" ? null : a.status ?? null };
}

// ─── Editing a sent order ───

/** The reason a request line gets when the kitchen sets it to 0 after sending (the send step's "ส่งไม่ได้", later) */
export const ZERO_AFTER_SEND = "ครัวแก้เป็น 0 หลังส่ง";

export interface StoredLine {
  id: string;
  skuId: string;
  actualQty: number;
  plannedQty: number;
  trLineId: string | null;
}

export interface LineEditPlan {
  /** planned_qty to write: 0 for a line set to 0, the branch's request for one brought back from 0 */
  planned: Map<string, number | "requested">;
  /** Request lines to mark "not sent" / to clear */
  decline: string[];
  undecline: string[];
  /** Lines set to 0 the branch already has goods of from this order: refused */
  refused: string[];
}

/**
 * A line set to 0 on a sent order means "not sent": its planned amount goes to 0 too (a 0 with
 * the plan left read as the plan everywhere that falls back to it — the receive screen, the SM
 * the kitchen sent while Sent, to-line-qty.ts) and its request line is marked declined, as the
 * send step does. Refused when the branch already received that product from the order (its
 * stock would come back to the kitchen while the branch has it). Only lines that change are
 * looked at: a line that was 0 already is left as it is. Brought back from 0, the line gets the
 * branch's request again and its decline is cleared. Same rule in save_sent_transfer_order.
 */
export function planLineEdits(stored: StoredLine[], edits: { id: string; actualQty: number }[], receivedBySku: Map<string, number>): LineEditPlan {
  const plan: LineEditPlan = { planned: new Map(), decline: [], undecline: [], refused: [] };
  const byId = new Map(stored.map((l) => [l.id, l]));
  for (const e of edits) {
    const s = byId.get(e.id);
    if (!s) continue;
    const toZero = !(e.actualQty > 0) && s.actualQty > 0;
    const fromZero = e.actualQty > 0 && !(s.actualQty > 0) && !(s.plannedQty > 0);
    if (toZero) {
      if ((receivedBySku.get(s.skuId) ?? 0) > 0) {
        plan.refused.push(e.id);
        continue;
      }
      plan.planned.set(e.id, 0);
      if (s.trLineId) plan.decline.push(s.trLineId);
    } else if (fromZero && s.trLineId) {
      plan.planned.set(e.id, "requested");
      plan.undecline.push(s.trLineId);
    }
  }
  return plan;
}

/** Lines of an order that were not sent (0 and nothing planned): nothing to receive, print or list */
export const wasSent = (l: { actualQty: number; plannedQty: number }) => l.actualQty > 0 || l.plannedQty > 0;

/** More than this many times what was sent is taken as a typing slip (80,000 for 8,000) */
export const OVER_RECEIVE = 3;

/** Lines received at more than OVER_RECEIVE × what was sent (actual, else planned); the database refuses them too */
export function overReceived(lines: { id: string; actualQty: number; plannedQty: number }[], receivedByLine: Map<string, number>): string[] {
  return lines.filter((l) => (receivedByLine.get(l.id) ?? 0) > OVER_RECEIVE * (l.actualQty > 0 ? l.actualQty : l.plannedQty)).map((l) => l.id);
}

/** The Thai word for where an order already went (for "ใบนี้ … ไปแล้ว") */
export function statusWord(status: string | null): string {
  switch (status) {
    case "Received":
    case "Partially Received":
      return "รับ";
    case "Declined":
      return "ปฏิเสธ";
    case "Cancelled":
      return "ยกเลิก";
    case null:
      return "ลบ";
    default:
      return "เปลี่ยน";
  }
}
