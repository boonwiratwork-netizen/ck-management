import { useState, useCallback, useEffect, useRef } from "react";
import {
  ProductionPlan,
  ProductionRecord,
  PlanStatus,
  getWeekStart,
  getWeekEnd,
  getISOWeekNumber,
} from "@/types/production";
import { BOMHeader, BOMLine, BOMStep } from "@/types/bom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { fetchAllRows } from "@/lib/fetch-all";
import { bulkResult, type BulkResult } from "@/lib/bulk-write";
import { NO_ANSWER, newRowId, noAnswer, writeError, writeTimeout } from "@/lib/write-timeout";
import { batchShare, batchesForRecord, deltas, editMovesStock, editTarget, ingredientsPerBatch, movementFor, outputPerBatch, recordTag, shareText, writeProductionMoves } from "@/lib/production";

const toPlan = (r: any): ProductionPlan => ({
  id: r.id,
  weekNumber: r.week_number,
  weekStartDate: r.week_start_date,
  weekEndDate: r.week_end_date,
  smSkuId: r.sm_sku_id,
  targetQtyKg: r.target_qty_kg,
  numBatches: r.num_batches,
  status: r.status,
});
const toRecord = (r: any): ProductionRecord => ({
  id: r.id,
  planId: r.plan_id,
  productionDate: r.production_date,
  smSkuId: r.sm_sku_id,
  batchesProduced: r.batches_produced,
  actualOutputG: r.actual_output_g,
  createdAt: r.created_at,
  notes: r.notes ?? "",
});

interface StockDeduction {
  skuId: string;
  quantity: number;
  reason: string;
}

export function useProductionData(
  bomHeaders: BOMHeader[],
  bomLines: BOMLine[],
  /** One RM adjustment; false = not saved (anything else counts as saved, as before) */
  addStockAdjustment: (adj: { skuId: string; date: string; quantity: number; reason: string }) => void | Promise<unknown>,
  bomSteps: BOMStep[] = [],
  enabled = true,
  /** Many RM adjustments in one insert; without it each is written on its own */
  addStockAdjustments?: (adjs: { skuId: string; date: string; quantity: number; reason: string }[]) => Promise<BulkResult>,
) {
  const [plans, setPlans] = useState<ProductionPlan[]>([]);
  const [records, setRecords] = useState<ProductionRecord[]>([]);

  useEffect(() => {
    // Kitchen data loads only once a kitchen page is opened (see Index)
    if (!enabled) return;
    Promise.all([
      supabase.from("production_plans").select("*").order("created_at", { ascending: false }),
      // Paged: there are more records than one 1,000-row page will hold
      fetchAllRows<any>((f, t) => supabase.from("production_records").select("*").order("created_at", { ascending: false }).order("id").range(f, t)),
    ]).then(([p, r]) => {
      if (!p.error) setPlans((p.data || []).map(toPlan));
      if (!r.error) setRecords((r.data || []).map(toRecord));
    });
  }, [enabled]);

  const getOutputPerBatch = useCallback(
    (smSkuId: string): number => {
      const header = bomHeaders.find((h) => h.smSkuId === smSkuId);
      return header ? outputPerBatch(header, bomLines, bomSteps) : 0;
    },
    [bomHeaders, bomSteps, bomLines],
  );

  const addPlan = useCallback(
    async (data: { smSkuId: string; targetQtyKg: number; status: PlanStatus; weekDate: string }): Promise<string> => {
      const weekStart = getWeekStart(data.weekDate);
      const weekEnd = getWeekEnd(weekStart);
      const weekNumber = getISOWeekNumber(data.weekDate);
      const outputPerBatch = getOutputPerBatch(data.smSkuId);
      const numBatches = outputPerBatch > 0 ? Math.ceil((data.targetQtyKg * 1000) / outputPerBatch) : 0;

      const { data: row, error } = await supabase
        .from("production_plans")
        .insert({
          week_number: weekNumber,
          week_start_date: weekStart,
          week_end_date: weekEnd,
          sm_sku_id: data.smSkuId,
          target_qty_kg: data.targetQtyKg,
          num_batches: numBatches,
          status: data.status,
        })
        .select()
        .abortSignal(writeTimeout())
        .single();
      if (error) {
        toast.error("เพิ่มแผนผลิตไม่สำเร็จ: " + writeError(error));
        return "";
      }
      setPlans((prev) => [toPlan(row), ...prev]);
      return row.id;
    },
    [getOutputPerBatch],
  );

  const updatePlan = useCallback(
    async (
      id: string,
      data: Partial<{ smSkuId: string; targetQtyKg: number; status: PlanStatus; weekDate: string }>,
    ) => {
      const plan = plans.find((p) => p.id === id);
      if (!plan) return;
      const updated = { ...plan };
      if (data.weekDate) {
        updated.weekStartDate = getWeekStart(data.weekDate);
        updated.weekEndDate = getWeekEnd(updated.weekStartDate);
        updated.weekNumber = getISOWeekNumber(data.weekDate);
      }
      if (data.smSkuId !== undefined) updated.smSkuId = data.smSkuId;
      if (data.targetQtyKg !== undefined) updated.targetQtyKg = data.targetQtyKg;
      if (data.status !== undefined) updated.status = data.status;
      const outputPerBatch = getOutputPerBatch(updated.smSkuId);
      updated.numBatches = outputPerBatch > 0 ? Math.ceil((updated.targetQtyKg * 1000) / outputPerBatch) : 0;

      const { error } = await supabase
        .from("production_plans")
        .update({
          week_number: updated.weekNumber,
          week_start_date: updated.weekStartDate,
          week_end_date: updated.weekEndDate,
          sm_sku_id: updated.smSkuId,
          target_qty_kg: updated.targetQtyKg,
          num_batches: updated.numBatches,
          status: updated.status,
        })
        .eq("id", id);
      if (error) {
        toast.error("แก้แผนผลิตไม่สำเร็จ: " + error.message);
        return;
      }
      setPlans((prev) => prev.map((p) => (p.id === id ? updated : p)));
    },
    [plans, getOutputPerBatch],
  );

  const deletePlan = useCallback(async (id: string) => {
    await supabase.from("production_records").delete().eq("plan_id", id);
    const { error } = await supabase.from("production_plans").delete().eq("id", id);
    if (error) {
      toast.error("ลบแผนผลิตไม่สำเร็จ: " + error.message);
      return;
    }
    setPlans((prev) => prev.filter((p) => p.id !== id));
    setRecords((prev) => prev.filter((r) => r.planId !== id));
  }, []);

  // ─── Raw material for a record ───
  // Every adjustment a record makes carries its tag ("[rec <id>]"), so a later edit
  // or delete can see exactly what is out for it and only add the difference.
  // Records saved before the tag (untagged) took whole batches: batches × per batch.
  const perBatchFor = useCallback(
    async (smSkuId: string) => {
      const header = bomHeaders.find((h) => h.smSkuId === smSkuId);
      if (!header) return null;
      const ingredients = ingredientsPerBatch(header, bomLines, bomSteps);
      // What untagged old records took (trimmed amounts, no line yield)
      const ingredientsNet = ingredientsPerBatch(header, bomLines, bomSteps, { gross: false });
      // The recipe's by-products and its ingredients' types, read together (they don't depend on each other)
      const [{ data: bp, error: bpErr }, { data: skuRows, error: skuErr }] = await Promise.all([
        supabase.from("bom_byproducts").select("sku_id, output_qty").eq("bom_header_id", header.id).eq("tracks_inventory", true).not("sku_id", "is", null).abortSignal(writeTimeout()),
        supabase.from("skus").select("id, type").in("id", [...new Set(ingredients.map((l) => l.skuId))]).abortSignal(writeTimeout()),
      ]);
      // Without them SM ingredients would go out as RM and by-products be missed: never guess
      if (bpErr || skuErr) throw new Error(writeError(bpErr ?? skuErr));
      const byproducts = (bp || []).map((b) => ({ skuId: b.sku_id as string, qty: Number(b.output_qty) || 0 }));
      const typeOf = new Map((skuRows || []).map((r) => [r.id, r.type as string]));
      return { ingredients, ingredientsNet, byproducts, typeOf, byproductIds: new Set(byproducts.map((b) => b.skuId)) };
    },
    [bomHeaders, bomLines, bomSteps],
  );

  /**
   * What is out for a record now, by product (negative = taken out).
   * - New records: the sum of their tagged rows.
   * - Records saved before the tag ("legacy"): the old page took whole batches of
   *   ingredients, untagged. The first time one is changed its batch count is
   *   written into every tagged reason ("legacy=N"), so later changes still count
   *   that untagged base. Their by-products are left as they were (the old edit
   *   never moved them, so their true amount isn't known).
   */
  const currentFor = useCallback(async (record: ProductionRecord, per: NonNullable<Awaited<ReturnType<typeof perBatchFor>>>) => {
    const { data, error } = await supabase.from("stock_adjustments").select("sku_id, quantity, reason").like("reason", `%${recordTag(record.id)}%`).abortSignal(writeTimeout());
    // An empty answer would read as "legacy record, whole batches out": a failed read must stop the caller
    if (error) throw new Error(writeError(error));
    const rows = data || [];
    const marked = rows.map((r) => /legacy=([\d.]+)/.exec(r.reason)?.[1]).find(Boolean);
    const legacy = marked != null ? Number(marked) : rows.length === 0 ? record.batchesProduced : null;
    const m = legacy != null ? movementFor(per.ingredientsNet, [], legacy) : new Map<string, number>();
    for (const r of rows) m.set(r.sku_id, (m.get(r.sku_id) || 0) + Number(r.quantity));
    return { current: m, legacy };
  }, []);

  /**
   * Write adjustments: ingredients (SM as SM, others as RM as before) and by-products (SM, own
   * reason). The SM rows go in one insert and the RM rows in another, side by side (a recipe of
   * 15 ingredients was 15 requests one after another, ~3 s on the save button). A refused insert
   * is written again row by row. Returns the products whose stock did not move (empty = all did).
   */
  const writeMoves = useCallback(
    async (moves: { skuId: string; qty: number }[], date: string, reason: string, byproductReason: string, per: NonNullable<Awaited<ReturnType<typeof perBatchFor>>>): Promise<string[]> =>
      writeProductionMoves(moves, date, reason, byproductReason, per, {
        smMany: async (rows) => bulkResult(rows.length, await supabase.from("stock_adjustments").insert(rows).select("id").abortSignal(writeTimeout())),
        smOne: async (row) => {
          const { data, error } = await supabase.from("stock_adjustments").insert(row).select("id").abortSignal(writeTimeout());
          return !error && !!data?.length;
        },
        rmMany: addStockAdjustments,
        rmOne: async (a) => (await addStockAdjustment(a)) !== false,
      }),
    [addStockAdjustment, addStockAdjustments],
  );

  /** Find (or make) the week's plan row a record hangs on, as before */
  const planFor = useCallback(
    async (smSkuId: string, productionDate: string): Promise<string> => {
      const ws = getWeekStart(productionDate);
      const existing = plans.find((p) => p.smSkuId === smSkuId && p.weekStartDate === ws);
      if (existing) return existing.id;
      return addPlan({ smSkuId, targetQtyKg: 0, status: "In Progress", weekDate: productionDate });
    },
    [plans, addPlan],
  );

  /** A record insert that got no answer and wasn't found: its id, used again if the same pot is saved again */
  const unconfirmedInsert = useRef<{ key: string; id: string } | null>(null);

  const addRecord = useCallback(
    async (data: { smSkuId: string; productionDate: string; actualOutputG: number; notes?: string; byproductQty?: Record<string, number> }): Promise<{ id: string; stockShort: string[] } | undefined> => {
      const planId = await planFor(data.smSkuId, data.productionDate);
      if (!planId) return;
      const perOut = getOutputPerBatch(data.smSkuId);
      const row: Record<string, unknown> = {
        plan_id: planId,
        production_date: data.productionDate,
        sm_sku_id: data.smSkuId,
        batches_produced: batchesForRecord(data.actualOutputG, perOut),
        actual_output_g: data.actualOutputG,
      };
      if (data.notes) row.notes = data.notes;
      // The id is made here, so a save that got no answer can be looked up. Pressed again for the
      // same pot after that, the same id goes again: a late landing can't become a second record
      const key = `${data.smSkuId}|${data.productionDate}|${data.actualOutputG}`;
      const reuse = unconfirmedInsert.current?.key === key;
      const recordId = reuse ? unconfirmedInsert.current!.id : newRowId();
      row.id = recordId;
      // The recipe's read starts beside the insert (it doesn't depend on it)
      const perRead = perBatchFor(data.smSkuId);
      perRead.catch(() => undefined); // awaited below, only once the record is in
      const res = await supabase.from("production_records").insert(row as never).select().abortSignal(writeTimeout()).single();
      let saved = res.data;
      if (res.error && (noAnswer(res.error) || (reuse && res.error.code === "23505"))) {
        // No answer (or it is already in from the unanswered press): did it land? Then carry on as saved
        const back = await supabase.from("production_records").select().eq("id", recordId).abortSignal(writeTimeout()).maybeSingle();
        if (back.data) saved = back.data;
        else {
          unconfirmedInsert.current = { key, id: recordId };
          toast.error(back.error ? "บันทึกผลผลิต: " + NO_ANSWER : "ระบบไม่ตอบ ยังไม่ได้บันทึกผลผลิต ลองกดบันทึกอีกครั้ง");
          return;
        }
      } else if (res.error || !saved) {
        toast.error("บันทึกผลผลิตไม่ได้: " + writeError(res.error));
        return;
      }
      unconfirmedInsert.current = null;
      setRecords((prev) => [toRecord(saved), ...prev]);
      const read = await perRead.then(
        (p) => ({ per: p }),
        (e: unknown) => ({ failed: e instanceof Error ? e.message : String(e) }),
      );
      if ("failed" in read) {
        // Saved, but what to take out couldn't be read: the recipe's products are named as not moved
        toast.error("อ่านสูตรไม่ได้ ยังไม่ได้ตัดสต๊อก: " + read.failed);
        const header = bomHeaders.find((h) => h.smSkuId === data.smSkuId);
        return { id: saved.id, stockShort: [...new Set(bomLines.filter((l) => l.bomHeaderId === header?.id).map((l) => l.rmSkuId))] };
      }
      const per = read.per;
      if (per) {
        const share = batchShare(data.actualOutputG, perOut);
        const want = movementFor(per.ingredients, per.byproducts, share);
        // By-products as weighed (น้ำมันไก่ 3–6 kg a pot), not the recipe's fixed amount
        for (const b of per.byproducts) if (data.byproductQty && data.byproductQty[b.skuId] !== undefined) want.set(b.skuId, Math.max(0, data.byproductQty[b.skuId]));
        const tag = recordTag(saved.id);
        // stockShort: products whose stock didn't move (the record is saved: never saved again)
        const stockShort = await writeMoves(deltas(want, new Map()), data.productionDate, `Production: ${shareText(share)} batches of ${data.smSkuId} ${tag}`, `Production by-product: ${shareText(share)} batches of ${data.smSkuId} ${tag}`, per);
        return { id: saved.id, stockShort };
      }
      return { id: saved.id, stockShort: [] };
    },
    [planFor, getOutputPerBatch, perBatchFor, writeMoves, bomHeaders, bomLines],
  );

  const updateRecordWithDelta = useCallback(
    /** false = nothing saved; else saved, with the products whose stock didn't move (stockShort) */
    async (id: string, data: { productionDate: string; actualOutputG: number; notes?: string }): Promise<false | { stockShort: string[] }> => {
      const old = records.find((r) => r.id === id);
      if (!old) {
        toast.error("ไม่พบบันทึกนี้");
        return false;
      }
      const perOut = getOutputPerBatch(old.smSkuId);
      const outputChanged = Math.abs(data.actualOutputG - old.actualOutputG) > 1e-6;
      const moves = editMovesStock(old, data);
      // Only what changed is written: a note alone keeps the batch count (legacy records read their untagged base from it)
      const patch: Record<string, unknown> = {};
      if (outputChanged) Object.assign(patch, { actual_output_g: data.actualOutputG, batches_produced: batchesForRecord(data.actualOutputG, perOut) });
      if (old.productionDate !== data.productionDate) patch.production_date = data.productionDate;
      if (data.notes !== undefined && data.notes !== (old.notes ?? "")) patch.notes = data.notes;
      if (Object.keys(patch).length === 0) return { stockShort: [] };
      // The recipe and what is out for the record now are read first: if either can't be read
      // the edit stops here (a deduction is never worked out from missing figures)
      let per: Awaited<ReturnType<typeof perBatchFor>> = null;
      let out: Awaited<ReturnType<typeof currentFor>> | null = null;
      try {
        per = moves ? await perBatchFor(old.smSkuId) : null;
        out = per ? await currentFor(old, per) : null;
      } catch (e) {
        toast.error("อ่านยอดที่ตัดสต๊อกของบันทึกนี้ไม่ได้ ยังไม่ได้แก้ ลองอีกครั้ง: " + (e instanceof Error ? e.message : String(e)));
        return false;
      }
      const { data: saved, error } = await supabase.from("production_records").update(patch as never).eq("id", id).select("id").abortSignal(writeTimeout());
      if (error && noAnswer(error)) {
        // No answer: read it back. Landed = carry on (the difference is written); else not saved
        const back = await supabase.from("production_records").select("actual_output_g, batches_produced, production_date, notes").eq("id", id).abortSignal(writeTimeout()).maybeSingle();
        const now = back.data as Record<string, unknown> | null;
        const landed = !!now && Object.entries(patch).every(([k, v]) => String(now[k] ?? "") === String(v ?? ""));
        if (!landed) {
          toast.error(back.error || !now ? "แก้บันทึก: " + NO_ANSWER : "ระบบไม่ตอบ ยังไม่ได้แก้ ลองอีกครั้ง");
          return false;
        }
      } else if (error || !saved?.length) {
        toast.error("แก้บันทึกไม่ได้" + (error ? ": " + writeError(error) : ""));
        return false;
      }
      let stockShort: string[] = [];
      if (per && out) {
        const { current: now, legacy } = out;
        const share = batchShare(data.actualOutputG, perOut);
        // What this record took out, scaled to the new output: the rule it was saved with
        // (records before 27 Oct 2026 took net amounts), not today's. By-products scale the
        // same way (weighed when recorded); legacy records never moved theirs.
        const want = editTarget(now, old.actualOutputG, data.actualOutputG, () => movementFor(per.ingredients, legacy != null ? [] : per.byproducts, share));
        const tag = `${recordTag(id)}${legacy != null ? ` legacy=${legacy}` : ""}`;
        const bpReason = (what: string) => `Production by-product ${what} ${tag}`;
        if (old.productionDate !== data.productionDate) {
          // Moved to another day: take the old movement back on the old day, apply the new one on the new day (both at once)
          stockShort = (await Promise.all([
            writeMoves(deltas(new Map(), now), old.productionDate, `Production correction (date moved to ${data.productionDate}) ${tag}`, bpReason(`correction (date moved to ${data.productionDate})`), per),
            writeMoves(deltas(want, new Map()), data.productionDate, `Production: ${shareText(share)} batches of ${old.smSkuId} ${tag}`, `Production by-product: ${shareText(share)} batches of ${old.smSkuId} ${tag}`, per),
          ])).flat();
        } else {
          stockShort = await writeMoves(deltas(want, now), data.productionDate, `Production correction: ${shareText(share)} batches of ${old.smSkuId} ${tag}`, bpReason(`correction: ${shareText(share)} batches of ${old.smSkuId}`), per);
        }
      }
      setRecords((prev) =>
        prev.map((r) =>
          r.id === id
            ? { ...r, productionDate: data.productionDate, actualOutputG: data.actualOutputG, batchesProduced: outputChanged ? batchesForRecord(data.actualOutputG, perOut) : r.batchesProduced, notes: data.notes ?? r.notes }
            : r,
        ),
      );
      return { stockShort };
    },
    [records, getOutputPerBatch, perBatchFor, currentFor, writeMoves],
  );

  /** Delete a record and give its raw material back (the old page left it taken out) */
  const deleteRecord = useCallback(
    /** false = not deleted; else deleted, with the products whose material didn't come back (stockShort) */
    async (id: string): Promise<false | { stockShort: string[] }> => {
      const old = records.find((r) => r.id === id);
      // What it took out is read first: if it can't be, nothing is deleted (its material
      // would never come back, or come back by a guess)
      let per: Awaited<ReturnType<typeof perBatchFor>> = null;
      let out: Awaited<ReturnType<typeof currentFor>> | null = null;
      try {
        per = old ? await perBatchFor(old.smSkuId) : null;
        out = per && old ? await currentFor(old, per) : null;
      } catch (e) {
        toast.error("อ่านยอดที่ตัดสต๊อกของบันทึกนี้ไม่ได้ ยังไม่ได้ลบ ลองอีกครั้ง: " + (e instanceof Error ? e.message : String(e)));
        return false;
      }
      const { error } = await supabase.from("production_records").delete().eq("id", id).abortSignal(writeTimeout());
      if (error && noAnswer(error)) {
        // No answer: gone = it landed, give the material back as on success; still there = not deleted
        const back = await supabase.from("production_records").select("id").eq("id", id).abortSignal(writeTimeout()).maybeSingle();
        if (back.error || back.data) {
          toast.error(back.error ? "ลบบันทึก: " + NO_ANSWER : "ระบบไม่ตอบ ยังไม่ได้ลบ ลองอีกครั้ง");
          return false;
        }
      } else if (error) {
        toast.error("ลบบันทึกไม่ได้: " + writeError(error));
        return false;
      }
      setRecords((prev) => prev.filter((r) => r.id !== id));
      let stockShort: string[] = [];
      if (old) {
        if (per && out) {
          const { current: now, legacy } = out;
          const tag = `${recordTag(id)}${legacy != null ? ` legacy=${legacy}` : ""}`;
          stockShort = await writeMoves(deltas(new Map(), now), old.productionDate, `Production correction (record deleted) ${tag}`, `Production by-product correction (record deleted) ${tag}`, per);
        }
      }
      return { stockShort };
    },
    [records, perBatchFor, currentFor, writeMoves],
  );

  const getRecordsForPlan = useCallback((planId: string) => records.filter((r) => r.planId === planId), [records]);
  const getTotalProducedForPlan = useCallback(
    (planId: string) => records.filter((r) => r.planId === planId).reduce((s, r) => s + r.actualOutputG, 0),
    [records],
  );

  return {
    plans,
    records,
    addPlan,
    updatePlan,
    deletePlan,
    addRecord,
    updateRecordWithDelta,
    deleteRecord,
    getRecordsForPlan,
    getTotalProducedForPlan,
    getOutputPerBatch,
  };
}
