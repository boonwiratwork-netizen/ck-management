/**
 * WIP (ทำเองที่ร้าน): an item a branch makes from what it has, by the weights put in
 * each time (ชาชูรวม from chashu trimmings). No recipe, no ratio.
 *
 * A batch is saved by the save_wip_batch database function, all at once: the batch,
 * what went in, and the stock moves at the branch: each input out ("WIP: ใช้ทำ…"),
 * the WIP in ("WIP: ทำ…"), both tagged "[wip <id>]". Every branch balance (count sheet,
 * branch stock, stock card) already adds a branch's adjustments, so they move as is.
 */
import { supabase } from "@/integrations/supabase/client";
import { NO_ANSWER, noAnswer, writeError, writeTimeout } from "@/lib/write-timeout";

export interface WipInput {
  id: string;
  wipSkuId: string;
  skuId: string;
}

export interface WipBatch {
  id: string;
  branchId: string;
  wipSkuId: string;
  madeDate: string;
  outputQty: number;
  inputQty: number;
  costPerUnit: number;
  note: string;
  createdAt: string;
  lines: { skuId: string; qty: number }[];
}

/** A stock move written by a WIP batch (either side) */
export const isWipReason = (reason: string | null | undefined) => (reason ?? "").startsWith("WIP: ");
/** The input side of a batch (taken out to make a WIP) */
export const isWipInputReason = (reason: string | null | undefined) => (reason ?? "").startsWith("WIP: ใช้ทำ");

/**
 * A move between places, not a use: a WIP batch (either side), a transfer to or from
 * another branch, a return to the kitchen. Food cost counts these as stock coming in or
 * going out, never as used (a branch that passed 2 kg to another didn't use it).
 */
export const isTransferReason = (reason: string | null | undefined) => {
  const r = reason ?? "";
  return isWipReason(r) || r.startsWith("โอนให้สาขาอื่น") || r.startsWith("รับโอนจากสาขาอื่น") || r.startsWith("ส่งคืนครัวกลาง");
};

/** Output above what went in by more than this: almost always a typo (warned, not blocked: a sauce may take water) */
export const OUTPUT_OVER = 1.05;
/** Output under this share of what went in: a lot was lost, worth a second look */
export const OUTPUT_LOSS = 0.85;

export type WipOutputCheck = "ok" | "over" | "loss";
export function outputCheck(input: number, output: number): WipOutputCheck {
  if (!(input > 0) || !(output > 0)) return "ok";
  if (output > input * OUTPUT_OVER) return "over";
  if (output < input * OUTPUT_LOSS) return "loss";
  return "ok";
}

/** What a batch costs per unit: each input at its price per unit, over what came out */
export function batchCost(lines: { qty: number; price: number }[], output: number): number {
  if (!(output > 0)) return 0;
  return lines.reduce((s, l) => s + (l.qty > 0 ? l.qty * (l.price || 0) : 0), 0) / output;
}

export async function loadWipInputs(): Promise<WipInput[]> {
  const { data, error } = await supabase.from("wip_inputs" as never).select("id, wip_sku_id, sku_id").order("id");
  if (error) throw new Error(error.message);
  return ((data ?? []) as { id: string; wip_sku_id: string; sku_id: string }[]).map((r) => ({ id: r.id, wipSkuId: r.wip_sku_id, skuId: r.sku_id }));
}

export async function setWipInputs(wipSkuId: string, skuIds: string[], current: WipInput[]): Promise<string | null> {
  const have = current.filter((i) => i.wipSkuId === wipSkuId);
  const drop = have.filter((i) => !skuIds.includes(i.skuId)).map((i) => i.id);
  const add = skuIds.filter((id) => !have.some((i) => i.skuId === id));
  if (drop.length) {
    const { error } = await supabase.from("wip_inputs" as never).delete().in("id", drop).abortSignal(writeTimeout());
    if (error) return writeError(error);
  }
  if (add.length) {
    const { error } = await supabase.from("wip_inputs" as never).insert(add.map((sku_id) => ({ wip_sku_id: wipSkuId, sku_id })) as never).abortSignal(writeTimeout());
    if (error) return writeError(error);
  }
  return null;
}

type BatchRow = { id: string; branch_id: string; wip_sku_id: string; made_date: string; output_qty: number; input_qty: number; cost_per_unit: number; note: string; created_at: string; wip_batch_lines?: { sku_id: string; qty: number }[] };
const toBatch = (r: BatchRow): WipBatch => ({
  id: r.id,
  branchId: r.branch_id,
  wipSkuId: r.wip_sku_id,
  madeDate: r.made_date,
  outputQty: Number(r.output_qty) || 0,
  inputQty: Number(r.input_qty) || 0,
  costPerUnit: Number(r.cost_per_unit) || 0,
  note: r.note ?? "",
  createdAt: r.created_at,
  lines: (r.wip_batch_lines ?? []).map((l) => ({ skuId: l.sku_id, qty: Number(l.qty) || 0 })),
});

/** A branch's batches in a date range (with what went in) */
export async function loadWipBatches(branchId: string, from: string, to: string): Promise<WipBatch[]> {
  const { data, error } = await supabase
    .from("wip_batches" as never)
    .select("id, branch_id, wip_sku_id, made_date, output_qty, input_qty, cost_per_unit, note, created_at, wip_batch_lines(sku_id, qty)")
    .eq("branch_id", branchId)
    .gte("made_date", from)
    .lte("made_date", to)
    .order("created_at", { ascending: false })
    .order("id");
  if (error) throw new Error(error.message);
  return ((data ?? []) as BatchRow[]).map(toBatch);
}

/**
 * Save (or replace, same id) a batch. Pressed again after no answer, the same id goes
 * again and replaces itself: never a second batch.
 */
export async function saveWipBatch(b: { id: string; branchId: string; wipSkuId: string; madeDate: string; outputQty: number; note: string; lines: { skuId: string; qty: number }[] }): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await supabase
    .rpc("save_wip_batch" as never, {
      p_id: b.id,
      p_branch: b.branchId,
      p_wip: b.wipSkuId,
      p_date: b.madeDate,
      p_output: b.outputQty,
      p_lines: b.lines.filter((l) => l.qty > 0).map((l) => ({ sku_id: l.skuId, qty: l.qty })),
      p_note: b.note,
    } as never)
    .abortSignal(writeTimeout());
  if (!error) return { ok: true };
  return { ok: false, message: noAnswer(error) ? NO_ANSWER : error.message };
}

export async function deleteWipBatch(id: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await supabase.rpc("delete_wip_batch" as never, { p_id: id } as never).abortSignal(writeTimeout());
  if (!error) return { ok: true };
  return { ok: false, message: noAnswer(error) ? NO_ANSWER : error.message };
}

/** Is the branch's count of that day sent? (then that day's batches can't change: they're in the count) */
export async function dayClosed(branchId: string, date: string): Promise<boolean> {
  const { data, error } = await supabase.from("daily_stock_counts").select("id").eq("branch_id", branchId).eq("count_date", date).eq("is_submitted", true).limit(1);
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/**
 * A count row's adjustments, said the way the branch knows them: a WIP batch's two sides
 * by name ("ใช้ทำชาชูรวม −300", "ทำเอง +1,000"), transfers, and the rest as ปรับยอด.
 */
export function adjustmentLabels(details: { quantity: number; reason: string }[]): { label: string; qty: number }[] {
  const out = new Map<string, number>();
  const add = (label: string, q: number) => out.set(label, (out.get(label) ?? 0) + q);
  for (const d of details) {
    const r = d.reason ?? "";
    if (isWipInputReason(r)) add(r.replace(/^WIP: /, "").replace(/ \[wip [^\]]+\]$/, ""), d.quantity);
    else if (isWipReason(r)) add("ทำเอง", d.quantity);
    else if (r.startsWith("โอนให้สาขาอื่น")) add("โอนให้สาขาอื่น", d.quantity);
    else if (r.startsWith("รับโอนจากสาขาอื่น")) add("รับโอน", d.quantity);
    else if (r.startsWith("ส่งคืนครัวกลาง")) add("ส่งคืนครัว", d.quantity);
    else add("ปรับยอด", d.quantity);
  }
  return [...out].filter(([, q]) => Math.abs(q) > 0.0001).map(([label, qty]) => ({ label, qty }));
}

/**
 * What a WIP is made of on average, per unit of it, from its recent batches: ชาชูรวม 1 g =
 * 0.3 g สามชั้น + 0.2 g อกเป็ด … (by weight put in, over what came out). A WIP with no batches
 * says nothing (no guess). For plans that work per bowl (the production planning helper).
 */
export function wipMix(batches: { wipSkuId: string; outputQty: number; lines: { skuId: string; qty: number }[] }[]): Map<string, { skuId: string; perUnit: number }[]> {
  const out = new Map<string, { skuId: string; perUnit: number }[]>();
  const byWip = new Map<string, { output: number; inputs: Map<string, number> }>();
  for (const b of batches) {
    if (!(b.outputQty > 0)) continue;
    const e = byWip.get(b.wipSkuId) ?? { output: 0, inputs: new Map<string, number>() };
    e.output += b.outputQty;
    for (const l of b.lines) if (l.qty > 0) e.inputs.set(l.skuId, (e.inputs.get(l.skuId) ?? 0) + l.qty);
    byWip.set(b.wipSkuId, e);
  }
  for (const [wip, e] of byWip) out.set(wip, [...e.inputs].map(([skuId, q]) => ({ skuId, perUnit: q / e.output })));
  return out;
}

/** Every branch's batches since a day (with what went in): for averages across branches */
export async function loadRecentWipBatches(from: string): Promise<{ wipSkuId: string; outputQty: number; lines: { skuId: string; qty: number }[] }[]> {
  const { data, error } = await supabase
    .from("wip_batches" as never)
    .select("id, wip_sku_id, output_qty, wip_batch_lines(sku_id, qty)")
    .gte("made_date", from)
    .order("id");
  // Before the migration there's no table: no batches (the plan works as before)
  if (error) return [];
  return ((data ?? []) as { wip_sku_id: string; output_qty: number; wip_batch_lines?: { sku_id: string; qty: number }[] }[]).map((r) => ({
    wipSkuId: r.wip_sku_id,
    outputQty: Number(r.output_qty) || 0,
    lines: (r.wip_batch_lines ?? []).map((l) => ({ skuId: l.sku_id, qty: Number(l.qty) || 0 })),
  }));
}
