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
});

interface StockDeduction {
  skuId: string;
  quantity: number;
  reason: string;
}

export function useProductionData(
  bomHeaders: BOMHeader[],
  bomLines: BOMLine[],
  addStockAdjustment: (adj: { skuId: string; date: string; quantity: number; reason: string }) => void,
  bomSteps: BOMStep[] = [],
) {
  const [plans, setPlans] = useState<ProductionPlan[]>([]);
  const [records, setRecords] = useState<ProductionRecord[]>([]);

  useEffect(() => {
    Promise.all([
      supabase.from("production_plans").select("*").order("created_at", { ascending: false }),
      supabase.from("production_records").select("*").order("created_at", { ascending: false }),
    ]).then(([p, r]) => {
      if (!p.error) setPlans((p.data || []).map(toPlan));
      if (!r.error) setRecords((r.data || []).map(toRecord));
    });
  }, []);

  const getOutputPerBatch = useCallback(
    (smSkuId: string): number => {
      const header = bomHeaders.find((h) => h.smSkuId === smSkuId);
      if (!header) return 0;

      if (header.bomMode === "multistep") {
        const steps = bomSteps.filter((s) => s.bomHeaderId === header.id).sort((a, b) => a.stepNumber - b.stepNumber);
        if (steps.length === 0) return header.batchSize * header.yieldPercent;
        const lines = bomLines.filter((l) => l.bomHeaderId === header.id);
        let prevOutput = 0;
        steps.forEach((step, idx) => {
          const sLines = lines.filter((l) => l.stepId === step.id);
          const inputQty = idx === 0 ? sLines.reduce((s, l) => s + l.qtyPerBatch, 0) : prevOutput;
          const addedQty =
            idx === 0
              ? 0
              : sLines.reduce((s, l) => {
                  if (l.qtyType === "percent" && l.percentOfInput) return s + l.percentOfInput * inputQty;
                  return s + l.qtyPerBatch;
                }, 0);
          const effectiveInput = idx === 0 ? inputQty : inputQty + addedQty;
          prevOutput = effectiveInput * step.yieldPercent;
        });
        return prevOutput;
      }

      return header.batchSize * header.yieldPercent;
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

  const addRecord = useCallback(
    async (data: Omit<ProductionRecord, "id" | "smSkuId"> & { smSkuId?: string }): Promise<string | undefined> => {
      const plan = plans.find((p) => p.id === data.planId);
      const smSkuId = plan?.smSkuId ?? data.smSkuId;
      if (!smSkuId) {
        toast.error("Failed to find SKU for record");
        return;
      }

      const { data: row, error } = await supabase
        .from("production_records")
        .insert({
          plan_id: data.planId,
          production_date: data.productionDate,
          sm_sku_id: smSkuId,
          batches_produced: data.batchesProduced,
          actual_output_g: data.actualOutputG,
        })
        .select()
        .single();
      if (error) {
        toast.error("Failed to add record: " + error.message);
        return;
      }
      setRecords((prev) => [toRecord(row), ...prev]);

      // Auto-deduct stock based on BOM
      const bomHeader = bomHeaders.find((h) => h.smSkuId === smSkuId);
      if (bomHeader) {
        const bLines = bomLines.filter((l) => l.bomHeaderId === bomHeader.id);

        // Resolve per-line qty: for multi-step BOMs, recalculate percent-type lines
        const resolvedLines: { rmSkuId: string; qty: number }[] = [];

        if (bomHeader.bomMode === "multistep") {
          const steps = bomSteps
            .filter((s) => s.bomHeaderId === bomHeader.id)
            .sort((a, b) => a.stepNumber - b.stepNumber);
          let prevStepOutput = 0;

          steps.forEach((step, idx) => {
            const stepLines = bLines.filter((l) => l.stepId === step.id);
            // Step input = previous step's output (step 1 has no prev output, input comes from its own fixed lines)
            const stepInput =
              idx === 0
                ? stepLines.filter((l) => !l.qtyType || l.qtyType === "fixed").reduce((s, l) => s + l.qtyPerBatch, 0)
                : prevStepOutput;

            stepLines.forEach((line) => {
              if (line.qtyType === "percent" && line.percentOfInput) {
                // Percent-type: resolve against the step's input qty
                resolvedLines.push({ rmSkuId: line.rmSkuId, qty: line.percentOfInput * stepInput });
              } else {
                // Fixed-type: use stored qtyPerBatch as-is
                resolvedLines.push({ rmSkuId: line.rmSkuId, qty: line.qtyPerBatch });
              }
            });

            // Calculate step output for next step
            const addedQty =
              idx === 0
                ? 0
                : stepLines.reduce((s, l) => {
                    if (l.qtyType === "percent" && l.percentOfInput) return s + l.percentOfInput * stepInput;
                    return s + l.qtyPerBatch;
                  }, 0);
            const effectiveInput = idx === 0 ? stepInput : stepInput + addedQty;
            prevStepOutput = effectiveInput * step.yieldPercent;
          });
        } else {
          // Simple BOM: all lines are fixed, use qtyPerBatch directly
          bLines.forEach((line) => {
            resolvedLines.push({ rmSkuId: line.rmSkuId, qty: line.qtyPerBatch });
          });
        }

        // Fetch SKU types for all ingredient SKUs to determine stock_type
        const uniqueSkuIds = [...new Set(resolvedLines.map((l) => l.rmSkuId))];
        const { data: skuRows } = await supabase.from("skus").select("id, type").in("id", uniqueSkuIds);
        const skuTypeMap = new Map<string, string>();
        (skuRows || []).forEach((s) => skuTypeMap.set(s.id, s.type));

        for (const line of resolvedLines) {
          const deductQty = -(line.qty * data.batchesProduced);
          const skuType = skuTypeMap.get(line.rmSkuId) || "RM";
          const reason = `Production: ${data.batchesProduced} batches of ${smSkuId}`;

          if (skuType === "SM") {
            // SM ingredients: insert directly with stock_type='SM'
            await supabase.from("stock_adjustments").insert({
              sku_id: line.rmSkuId,
              adjustment_date: data.productionDate,
              quantity: deductQty,
              reason,
              stock_type: "SM",
            });
          } else {
            // RM/other: use existing addStockAdjustment (writes stock_type='RM')
            addStockAdjustment({
              skuId: line.rmSkuId,
              date: data.productionDate,
              quantity: deductQty,
              reason,
            });
          }
        }
        // By-product stock IN adjustments
        const { data: byproducts } = await supabase
          .from("bom_byproducts")
          .select("sku_id, output_qty")
          .eq("bom_header_id", bomHeader.id)
          .eq("tracks_inventory", true)
          .not("sku_id", "is", null);

        if (byproducts && byproducts.length > 0) {
          for (const bp of byproducts) {
            const { error: bpError } = await supabase.from("stock_adjustments").insert({
              sku_id: bp.sku_id!,
              adjustment_date: data.productionDate,
              quantity: bp.output_qty * data.batchesProduced,
              stock_type: "SM",
              reason: `Production by-product: ${data.batchesProduced} batches of ${smSkuId}`,
            });
            if (bpError) console.error("By-product stock adjustment failed:", bpError.message);
          }
        }
      }
      return row.id;
    },
    [plans, bomHeaders, bomLines, bomSteps, addStockAdjustment],
  );

  const updateRecord = useCallback(
    async (id: string, data: { productionDate: string; actualOutputG: number; batchesProduced: number }) => {
      const { error } = await supabase
        .from("production_records")
        .update({
          production_date: data.productionDate,
          actual_output_g: data.actualOutputG,
          batches_produced: data.batchesProduced,
        })
        .eq("id", id);
      if (error) {
        toast.error("Failed to update record: " + error.message);
        return;
      }
      setRecords((prev) =>
        prev.map((r) =>
          r.id === id
            ? {
                ...r,
                productionDate: data.productionDate,
                actualOutputG: data.actualOutputG,
                batchesProduced: data.batchesProduced,
              }
            : r,
        ),
      );
    },
    [],
  );

  const deleteRecord = useCallback(async (id: string) => {
    const { error } = await supabase.from("production_records").delete().eq("id", id);
    if (error) {
      toast.error("Failed to delete record: " + error.message);
      return;
    }
    setRecords((prev) => prev.filter((r) => r.id !== id));
  }, []);

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
    updateRecord,
    deleteRecord,
    getRecordsForPlan,
    getTotalProducedForPlan,
    getOutputPerBatch,
  };
}
