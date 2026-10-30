import { useState, useCallback, useEffect } from "react";
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
import { batchShare, batchesForRecord, deltas, ingredientsPerBatch, movementFor, outputPerBatch, recordTag, shareText } from "@/lib/production";

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
  addStockAdjustment: (adj: { skuId: string; date: string; quantity: number; reason: string }) => void | Promise<unknown>,
  bomSteps: BOMStep[] = [],
  enabled = true,
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
        .single();
      if (error) {
        toast.error("Failed to add plan: " + error.message);
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
        toast.error("Failed to update plan: " + error.message);
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
      toast.error("Failed to delete plan: " + error.message);
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
      const { data: bp } = await supabase
        .from("bom_byproducts")
        .select("sku_id, output_qty")
        .eq("bom_header_id", header.id)
        .eq("tracks_inventory", true)
        .not("sku_id", "is", null);
      const byproducts = (bp || []).map((b) => ({ skuId: b.sku_id as string, qty: Number(b.output_qty) || 0 }));
      const { data: skuRows } = await supabase.from("skus").select("id, type").in("id", [...new Set(ingredients.map((l) => l.skuId))]);
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
    const { data } = await supabase.from("stock_adjustments").select("sku_id, quantity, reason").like("reason", `%${recordTag(record.id)}%`);
    const rows = data || [];
    const marked = rows.map((r) => /legacy=([\d.]+)/.exec(r.reason)?.[1]).find(Boolean);
    const legacy = marked != null ? Number(marked) : rows.length === 0 ? record.batchesProduced : null;
    const m = legacy != null ? movementFor(per.ingredientsNet, [], legacy) : new Map<string, number>();
    for (const r of rows) m.set(r.sku_id, (m.get(r.sku_id) || 0) + Number(r.quantity));
    return { current: m, legacy };
  }, []);

  /** Write adjustments: ingredients (SM as SM, others as RM as before) and by-products (SM, own reason) */
  const writeMoves = useCallback(
    async (moves: { skuId: string; qty: number }[], date: string, reason: string, byproductReason: string, per: NonNullable<Awaited<ReturnType<typeof perBatchFor>>>) => {
      for (const m of moves) {
        const isBp = per.byproductIds.has(m.skuId);
        if (isBp || per.typeOf.get(m.skuId) === "SM") {
          const { error } = await supabase.from("stock_adjustments").insert({ sku_id: m.skuId, adjustment_date: date, quantity: m.qty, reason: isBp ? byproductReason : reason, stock_type: "SM" });
          if (error) toast.error("ปรับสต๊อกไม่ได้: " + error.message);
        } else await addStockAdjustment({ skuId: m.skuId, date, quantity: m.qty, reason });
      }
    },
    [addStockAdjustment],
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

  const addRecord = useCallback(
    async (data: { smSkuId: string; productionDate: string; actualOutputG: number; notes?: string; byproductQty?: Record<string, number> }): Promise<string | undefined> => {
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
      const { data: saved, error } = await supabase.from("production_records").insert(row as never).select().single();
      if (error || !saved) {
        toast.error("บันทึกผลผลิตไม่ได้: " + (error?.message ?? ""));
        return;
      }
      setRecords((prev) => [toRecord(saved), ...prev]);
      const per = await perBatchFor(data.smSkuId);
      if (per) {
        const share = batchShare(data.actualOutputG, perOut);
        const want = movementFor(per.ingredients, per.byproducts, share);
        // By-products as weighed (น้ำมันไก่ 3–6 kg a pot), not the recipe's fixed amount
        for (const b of per.byproducts) if (data.byproductQty && data.byproductQty[b.skuId] !== undefined) want.set(b.skuId, Math.max(0, data.byproductQty[b.skuId]));
        const tag = recordTag(saved.id);
        await writeMoves(deltas(want, new Map()), data.productionDate, `Production: ${shareText(share)} batches of ${data.smSkuId} ${tag}`, `Production by-product: ${shareText(share)} batches of ${data.smSkuId} ${tag}`, per);
      }
      return saved.id;
    },
    [planFor, getOutputPerBatch, perBatchFor, writeMoves],
  );

  const updateRecordWithDelta = useCallback(
    async (id: string, data: { productionDate: string; actualOutputG: number; notes?: string }) => {
      const old = records.find((r) => r.id === id);
      if (!old) {
        toast.error("ไม่พบบันทึกนี้");
        return false;
      }
      const perOut = getOutputPerBatch(old.smSkuId);
      const patch: Record<string, unknown> = {
        production_date: data.productionDate,
        actual_output_g: data.actualOutputG,
        batches_produced: batchesForRecord(data.actualOutputG, perOut),
      };
      if (data.notes !== undefined) patch.notes = data.notes;
      const { error } = await supabase.from("production_records").update(patch as never).eq("id", id);
      if (error) {
        toast.error("แก้บันทึกไม่ได้: " + error.message);
        return false;
      }
      const per = await perBatchFor(old.smSkuId);
      if (per) {
        const { current: now, legacy } = await currentFor(old, per);
        const share = batchShare(data.actualOutputG, perOut);
        // Legacy records: ingredients only (their by-products stay as they were)
        const want = movementFor(per.ingredients, legacy != null ? [] : per.byproducts, share);
        // By-products were weighed when recorded: keep that amount, scaled by the new output
        const oldShare = batchShare(old.actualOutputG, perOut);
        if (legacy == null && oldShare > 0)
          for (const b of per.byproducts) want.set(b.skuId, (now.get(b.skuId) ?? 0) * (share / oldShare));
        const tag = `${recordTag(id)}${legacy != null ? ` legacy=${legacy}` : ""}`;
        const bpReason = (what: string) => `Production by-product ${what} ${tag}`;
        if (old.productionDate !== data.productionDate) {
          // Moved to another day: take the old movement back on the old day, apply the new one on the new day
          await writeMoves(deltas(new Map(), now), old.productionDate, `Production correction (date moved to ${data.productionDate}) ${tag}`, bpReason(`correction (date moved to ${data.productionDate})`), per);
          await writeMoves(deltas(want, new Map()), data.productionDate, `Production: ${shareText(share)} batches of ${old.smSkuId} ${tag}`, `Production by-product: ${shareText(share)} batches of ${old.smSkuId} ${tag}`, per);
        } else {
          await writeMoves(deltas(want, now), data.productionDate, `Production correction: ${shareText(share)} batches of ${old.smSkuId} ${tag}`, bpReason(`correction: ${shareText(share)} batches of ${old.smSkuId}`), per);
        }
      }
      setRecords((prev) =>
        prev.map((r) => (r.id === id ? { ...r, productionDate: data.productionDate, actualOutputG: data.actualOutputG, batchesProduced: batchesForRecord(data.actualOutputG, perOut), notes: data.notes ?? r.notes } : r)),
      );
      return true;
    },
    [records, getOutputPerBatch, perBatchFor, currentFor, writeMoves],
  );

  /** Delete a record and give its raw material back (the old page left it taken out) */
  const deleteRecord = useCallback(
    async (id: string) => {
      const old = records.find((r) => r.id === id);
      const { error } = await supabase.from("production_records").delete().eq("id", id);
      if (error) {
        toast.error("ลบบันทึกไม่ได้: " + error.message);
        return false;
      }
      setRecords((prev) => prev.filter((r) => r.id !== id));
      if (old) {
        const per = await perBatchFor(old.smSkuId);
        if (per) {
          const { current: now, legacy } = await currentFor(old, per);
          const tag = `${recordTag(id)}${legacy != null ? ` legacy=${legacy}` : ""}`;
          await writeMoves(deltas(new Map(), now), old.productionDate, `Production correction (record deleted) ${tag}`, `Production by-product correction (record deleted) ${tag}`, per);
        }
      }
      return true;
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
