import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { buildPriceAt } from "@/lib/price-history";
import { smRecipesOn } from "@/lib/recipe-history";
import { fetchAllRows } from "@/lib/fetch-all";
import { ingredientsPerBatch, outputPerBatch } from "@/lib/production";
import { afterCount, producedAfterCount, type CountAnchor, type CountTiming } from "@/lib/count-anchor";
import { productionCost, topWithOthers, type ProductionCost, type Recipe, type RmFlow } from "@/lib/ck-production-cost";
import { computeToLineQty, TO_DELIVERED_STATUSES } from "@/lib/to-line-qty";
import { toLocalDateStr } from "@/lib/utils";
import type { BOMHeader, BOMLine, BOMStep } from "@/types/bom";

export interface CountPick {
  date: string;
  /** Share of the period's raw materials counted in that session */
  coverage: number;
}

export interface CkPeriod {
  /** The period these numbers are for (the screen shows a skeleton while another loads) */
  from: string;
  to: string;
  cost: ProductionCost | null;
  /** Production compared: between the two counts (or the opening count and today) */
  prodFrom: string | null;
  prodTo: string | null;
  opening: CountPick | null;
  closing: CountPick | null;
  /** No closing count: today's balances stand in, so use can't really be compared yet */
  estimated: boolean;
  blocked: string | null;
  produced: boolean;
  /** Raw materials missing from one of the counts (taken as the recipe says) */
  uncounted: string[];
  purchases: { total: number; top: { name: string; value: number }[] };
  distribution: { sm: number; rm: number; byBranch: { name: string; sm: number; rm: number }[] };
}

const shift = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toLocalDateStr(d);
};
/** Every page of a query; a failed page fails the whole load (no silent partial data) */
const all = async <T,>(build: (a: number, b: number) => unknown): Promise<T[]> => {
  const r = await fetchAllRows<T>(build as never);
  if (r.error) throw r.error;
  return r.data;
};

interface Session extends CountAnchor {
  id: string;
}

/** The completed RM count nearest `target` (±3 days, later than `after`) that counted at least half of `rmIds` */
async function pickCount(target: string, rmIds: Set<string>, after?: string): Promise<{ session: Session; qty: Map<string, number>; coverage: number } | null> {
  const sessions = await all<{ id: string; count_date: string; completed_at: string | null; count_timing: CountTiming | null }>((a, b) =>
    supabase.from("stock_count_sessions").select("id, count_date, completed_at, count_timing").eq("status", "Completed").is("deleted_at", null).gte("count_date", shift(target, -3)).lte("count_date", shift(target, 3)).order("id").range(a, b),
  );
  const t = Date.parse(`${target}T00:00:00`);
  const pool = sessions.filter((s) => !after || s.count_date > after);
  pool.sort((x, y) => Math.abs(Date.parse(`${x.count_date}T00:00:00`) - t) - Math.abs(Date.parse(`${y.count_date}T00:00:00`) - t) || (y.count_date > x.count_date ? 1 : -1));
  for (const s of pool) {
    const lines = await all<{ sku_id: string; physical_qty: number | null }>((a, b) => supabase.from("stock_count_lines").select("id, sku_id, physical_qty").eq("session_id", s.id).eq("type", "RM").order("id").range(a, b));
    const qty = new Map<string, number>();
    for (const l of lines) if (l.physical_qty != null && rmIds.has(l.sku_id)) qty.set(l.sku_id, Number(l.physical_qty));
    // Half of the period's raw materials, not half of whatever the session listed
    const coverage = rmIds.size ? qty.size / rmIds.size : 0;
    if (coverage >= 0.5) return { session: { id: s.id, count_date: s.count_date, completed_at: s.completed_at, timing: s.count_timing }, qty, coverage };
  }
  return null;
}

/** What was read for a period, before today's balances are laid on (estimated case) */
interface Raw {
  from: string;
  to: string;
  produced: { smSkuId: string; outputG: number }[];
  recipes: Map<string, Recipe>;
  type: Map<string, string>;
  std: Map<string, number>;
  opening: { session: Session; qty: Map<string, number>; coverage: number } | null;
  closing: { session: Session; qty: Map<string, number>; coverage: number } | null;
  blocked: string | null;
  flow: Map<string, RmFlow>;
  paid: Map<string, { q: number; v: number }>;
  prodFrom: string | null;
  prodTo: string | null;
  purchases: CkPeriod["purchases"];
  distribution: CkPeriod["distribution"];
}

/**
 * One period of the kitchen: production cost (recipe vs actual), purchases and what
 * went to branches. Reads when the period changes; today's balances (estimated case)
 * are laid on without reading again, and only once they've loaded.
 */
export function useCkPeriod(from: string, to: string, liveRm: { skuId: string; currentStock: number }[], liveReady: boolean) {
  const [raw, setRaw] = useState<Raw | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      const today = toLocalDateStr(new Date());
      const [headers, lines, steps, prices, skus, suppliers, branches] = await Promise.all([
        all<{ id: string; sm_sku_id: string; bom_mode: string; batch_size: number; yield_percent: number; production_type: string }>((a, b) => supabase.from("bom_headers").select("id, sm_sku_id, bom_mode, batch_size, yield_percent, production_type").order("id").range(a, b)),
        all<{ id: string; bom_header_id: string; rm_sku_id: string; qty_per_batch: number; yield_percent: number | null; step_id: string | null; qty_type: string | null; percent_of_input: number | null }>((a, b) =>
          supabase.from("bom_lines").select("id, bom_header_id, rm_sku_id, qty_per_batch, yield_percent, step_id, qty_type, percent_of_input").order("id").range(a, b),
        ),
        all<{ id: string; bom_header_id: string; step_number: number; step_name: string; yield_percent: number }>((a, b) => supabase.from("bom_steps").select("id, bom_header_id, step_number, step_name, yield_percent").order("id").range(a, b)),
        all<{ sku_id: string; price_per_usage_uom: number }>((a, b) => supabase.from("prices").select("id, sku_id, price_per_usage_uom, created_at").eq("is_active", true).order("created_at", { ascending: false }).order("id").range(a, b)),
        all<{ id: string; type: string; converter: number | null }>((a, b) => supabase.from("skus").select("id, type, converter").order("id").range(a, b)),
        all<{ id: string; name: string }>((a, b) => supabase.from("suppliers").select("id, name").order("id").range(a, b)),
        all<{ id: string; branch_name: string }>((a, b) => supabase.from("branches").select("id, branch_name").order("id").range(a, b)),
      ]);
      if (cancelled) return;
      const std = new Map<string, number>();
      for (const p of prices) if (!std.has(p.sku_id)) std.set(p.sku_id, Number(p.price_per_usage_uom) || 0);
      // Priced as on the period's last day (price history), so a later change leaves a
      // closed month alone; no history (table not there yet, or none) → today's price
      const history = await supabase.from("price_history" as never).select("sku_id, price_per_usage_uom, valid_from").lte("valid_from", `${shift(to, 1)}T00:00:00+07:00`).order("valid_from").limit(10000);
      if (cancelled) return;
      if (!history.error && history.data) {
        const priceAt = buildPriceAt((history.data as { sku_id: string; price_per_usage_uom: number; valid_from: string }[]).map((r) => ({ skuId: r.sku_id, pricePerUsageUom: Number(r.price_per_usage_uom), validFrom: r.valid_from })));
        for (const id of [...std.keys()]) {
          const then = priceAt(id, to);
          if (then !== undefined) std.set(id, then);
        }
      }
      const type = new Map(skus.map((s) => [s.id, s.type]));
      const conv = new Map(skus.map((s) => [s.id, Number(s.converter) || 1]));
      const isRm = (id: string) => type.get(id) === "RM";

      // Recipes as production deducts them: per-batch lines (bought amount) and output per batch
      const appLines: BOMLine[] = lines.map((l) => ({ id: l.id, bomHeaderId: l.bom_header_id, rmSkuId: l.rm_sku_id, qtyPerBatch: Number(l.qty_per_batch) || 0, yieldPercent: l.yield_percent ?? 1, stepId: l.step_id ?? undefined, qtyType: (l.qty_type ?? undefined) as BOMLine["qtyType"], percentOfInput: l.percent_of_input ?? undefined }));
      const appSteps: BOMStep[] = steps.map((s) => ({ id: s.id, bomHeaderId: s.bom_header_id, stepNumber: s.step_number, stepName: s.step_name, yieldPercent: Number(s.yield_percent) || 0 }));
      const recipes = new Map<string, Recipe>();
      for (const h of headers) {
        const header: BOMHeader = { id: h.id, smSkuId: h.sm_sku_id, productionType: h.production_type as BOMHeader["productionType"], bomMode: h.bom_mode as BOMHeader["bomMode"], batchSize: Number(h.batch_size) || 0, yieldPercent: Number(h.yield_percent) || 0 };
        recipes.set(h.sm_sku_id, { smSkuId: h.sm_sku_id, outputPerBatch: outputPerBatch(header, appLines, appSteps), lines: ingredientsPerBatch(header, appLines, appSteps) });
      }
      // The recipes as on the period's last day (recipe history), so a later change
      // leaves a closed month alone; no history (table not there yet) → today's
      const copies = await supabase.from("recipe_history" as never).select("id, kind, owner_id, snapshot, valid_from, created_at").eq("kind", "sm").lte("valid_from", `${shift(to, 1)}T00:00:00+07:00`).order("valid_from").limit(10000);
      if (cancelled) return;
      if (!copies.error && copies.data) {
        const then = smRecipesOn(
          (copies.data as { id: string; kind: "sm"; owner_id: string; snapshot: unknown; valid_from: string; created_at: string }[]).map((r) => ({ id: r.id, kind: r.kind, ownerId: r.owner_id, snapshot: r.snapshot, validFrom: r.valid_from, createdAt: r.created_at })),
          to,
        );
        for (const [headerId, c] of then) {
          if (!c.header) continue;
          const header: BOMHeader = { id: headerId, smSkuId: c.header.sm_sku_id, productionType: "CK", bomMode: c.header.bom_mode as BOMHeader["bomMode"], batchSize: Number(c.header.batch_size) || 0, yieldPercent: Number(c.header.yield_percent) || 0 };
          const ls: BOMLine[] = c.lines.map((l, i) => ({ id: `${headerId}-${i}`, bomHeaderId: headerId, rmSkuId: l.rm_sku_id, qtyPerBatch: Number(l.qty_per_batch) || 0, yieldPercent: l.yield_percent ?? 1, stepId: l.step_id ?? undefined, qtyType: (l.qty_type ?? undefined) as BOMLine["qtyType"], percentOfInput: l.percent_of_input ?? undefined }));
          const st: BOMStep[] = c.steps.map((s) => ({ id: s.id, bomHeaderId: headerId, stepNumber: s.step_number, stepName: "", yieldPercent: Number(s.yield_percent) || 0 }));
          recipes.set(header.smSkuId, { smSkuId: header.smSkuId, outputPerBatch: outputPerBatch(header, ls, st), lines: ingredientsPerBatch(header, ls, st) });
        }
      }

      // Production around the period (counts can sit a few days either side)
      const prodRows = await all<{ sm_sku_id: string; actual_output_g: number; production_date: string; created_at: string }>((a, b) =>
        supabase.from("production_records").select("id, sm_sku_id, actual_output_g, production_date, created_at").gte("production_date", shift(from, -4)).lte("production_date", shift(to, 3)).order("id").range(a, b),
      );
      if (cancelled) return;
      const inPeriod = prodRows.filter((p) => p.production_date >= from && p.production_date <= to);
      const rmIds = new Set<string>();
      for (const p of inPeriod) for (const l of recipes.get(p.sm_sku_id)?.lines ?? []) if (isRm(l.skuId)) rmIds.add(l.skuId);

      // Counts: the end of the day before the period, and the period's last day (once it's over)
      const closed = to < today;
      const opening = rmIds.size ? await pickCount(shift(from, -1), rmIds) : null;
      const closing = rmIds.size && closed && opening ? await pickCount(to, rmIds, opening.session.count_date) : null;
      if (cancelled) return;
      const blocked = !inPeriod.length ? null : !opening ? "ไม่มีผลนับวัตถุดิบต้นช่วง (±3 วัน · นับอย่างน้อยครึ่งหนึ่งของที่ใช้)" : closed && !closing ? "ไม่มีผลนับวัตถุดิบปลายช่วง (±3 วัน · นับอย่างน้อยครึ่งหนึ่งของที่ใช้)" : null;

      // Production compared = what was made between the two counts (the same rule the
      // stock pages use), so recipe and actual cover the same days
      const produced = opening
        ? prodRows.filter((p) => producedAfterCount(opening.session, p.production_date, p.created_at) && (closing ? !producedAfterCount(closing.session, p.production_date, p.created_at) : p.production_date <= today))
        : inPeriod;

      const windowFrom = opening ? opening.session.count_date : from;
      const windowTo = closing ? closing.session.count_date : today;
      const [receipts, dist] = await Promise.all([
        all<{ sku_id: string; supplier_id: string; receipt_date: string; quantity_received: number; actual_total: number | null; actual_unit_price: number | null }>((a, b) =>
          supabase.from("goods_receipts").select("id, sku_id, supplier_id, receipt_date, quantity_received, actual_total, actual_unit_price").gte("receipt_date", windowFrom < from ? windowFrom : from).lte("receipt_date", windowTo > to ? windowTo : to).order("id").range(a, b),
        ),
        all<{ sku_id: string; adjustment_date: string; quantity: number }>((a, b) =>
          supabase.from("stock_adjustments").select("id, sku_id, adjustment_date, quantity").is("branch_id", null).eq("stock_type", "RM").like("reason", "Distribution:%").gte("adjustment_date", windowFrom).lte("adjustment_date", windowTo).order("id").range(a, b),
        ),
      ]);
      if (cancelled) return;
      const between = (date: string) => (opening ? afterCount(opening.session, date) : date >= from) && (closing ? !afterCount(closing.session, date) : date <= today);
      const flow = new Map<string, RmFlow>();
      for (const id of rmIds) flow.set(id, { opening: opening?.qty.get(id) ?? 0, bought: 0, toBranches: 0, closing: closing?.qty.get(id) ?? 0 });
      const paid = new Map<string, { q: number; v: number }>();
      for (const r of receipts) {
        const f = flow.get(r.sku_id);
        if (!f || !between(r.receipt_date)) continue;
        // Usage units as the stock pages count a receipt (× converter)
        const q = (Number(r.quantity_received) || 0) * (conv.get(r.sku_id) ?? 1);
        f.bought += q;
        const p = paid.get(r.sku_id) ?? { q: 0, v: 0 };
        p.q += q;
        p.v += r.actual_total != null ? Number(r.actual_total) : (Number(r.actual_unit_price) || 0) * (Number(r.quantity_received) || 0);
        paid.set(r.sku_id, p);
      }
      for (const d of dist) {
        const f = flow.get(d.sku_id);
        if (f && between(d.adjustment_date)) f.toBranches += -Number(d.quantity) || 0;
      }

      // Purchases in the period, by supplier (top 5 + the rest)
      const supName = new Map(suppliers.map((s) => [s.id, s.name]));
      const bySup = new Map<string, number>();
      let spend = 0;
      for (const r of receipts) {
        if (r.receipt_date < from || r.receipt_date > to) continue;
        const v = r.actual_total != null ? Number(r.actual_total) : (Number(r.actual_unit_price) || 0) * (Number(r.quantity_received) || 0);
        spend += v;
        const n = supName.get(r.supplier_id) ?? "ไม่ระบุ";
        bySup.set(n, (bySup.get(n) ?? 0) + v);
      }

      // Sent to branches in the period (delivered transfer orders)
      const tos = await all<{ id: string; branch_id: string; status: string }>((a, b) =>
        supabase.from("transfer_orders").select("id, branch_id, status").in("status", [...TO_DELIVERED_STATUSES]).gte("delivery_date", from).lte("delivery_date", to).order("id").range(a, b),
      );
      const toLines: { to_id: string; sku_type: string; actual_qty: number; planned_qty: number; unit_cost: number }[] = [];
      for (let i = 0; i < tos.length; i += 150) {
        const ids = tos.slice(i, i + 150).map((t) => t.id);
        toLines.push(...(await all<(typeof toLines)[number]>((a, b) => supabase.from("transfer_order_lines").select("id, to_id, sku_type, actual_qty, planned_qty, unit_cost").in("to_id", ids).order("id").range(a, b))));
      }
      if (cancelled) return;
      const toById = new Map(tos.map((t) => [t.id, t]));
      const brName = new Map(branches.map((b) => [b.id, b.branch_name]));
      const byBr = new Map<string, { sm: number; rm: number }>();
      let dSm = 0;
      let dRm = 0;
      for (const l of toLines) {
        const t = toById.get(l.to_id);
        if (!t) continue;
        const v = computeToLineQty(l.actual_qty, l.planned_qty, t.status) * (Number(l.unit_cost) || 0);
        const n = brName.get(t.branch_id) ?? "สาขา";
        const e = byBr.get(n) ?? { sm: 0, rm: 0 };
        if (l.sku_type === "RM") {
          e.rm += v;
          dRm += v;
        } else {
          e.sm += v;
          dSm += v;
        }
        byBr.set(n, e);
      }

      const dates = produced.map((p) => p.production_date).sort();
      setRaw({
        from,
        to,
        produced: produced.map((p) => ({ smSkuId: p.sm_sku_id, outputG: Number(p.actual_output_g) || 0 })),
        recipes,
        type,
        std,
        opening,
        closing,
        blocked,
        flow,
        paid,
        prodFrom: dates[0] ?? null,
        prodTo: dates[dates.length - 1] ?? null,
        purchases: { total: spend, top: topWithOthers([...bySup].map(([name, value]) => ({ name, value }))) },
        distribution: { sm: dSm, rm: dRm, byBranch: [...byBr].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.sm + b.rm - (a.sm + a.rm)) },
      });
      setLoading(false);
    })().catch(() => {
      if (cancelled) return;
      setRaw(null);
      setError("โหลดข้อมูลไม่สำเร็จ ลองใหม่อีกครั้ง");
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [from, to]);

  // The cost, with today's balances as the closing figure when there's no closing count
  const data = useMemo<CkPeriod | null>(() => {
    if (!raw) return null;
    const estimated = !raw.closing;
    const waiting = estimated && !liveReady;
    let cost: ProductionCost | null = null;
    const uncounted: string[] = [];
    if (!raw.blocked && raw.produced.length && !waiting) {
      const live = new Map(liveRm.map((b) => [b.skuId, b.currentStock]));
      const flow = new Map<string, RmFlow>();
      const missing = new Set<string>();
      for (const [id, f] of raw.flow) {
        flow.set(id, estimated ? { ...f, closing: live.get(id) ?? 0 } : f);
        if (!raw.opening?.qty.has(id) || (raw.closing && !raw.closing.qty.has(id))) missing.add(id);
      }
      uncounted.push(...missing);
      const isRm = (id: string) => raw.type.get(id) === "RM";
      cost = productionCost({
        produced: raw.produced,
        recipes: raw.recipes,
        isRm,
        stdPrice: (id) => raw.std.get(id) ?? 0,
        actPrice: (id) => {
          const p = raw.paid.get(id);
          return p && p.q > 0 ? p.v / p.q : raw.std.get(id) ?? 0;
        },
        rmFlow: flow,
        uncounted: missing,
      });
    }
    return {
      from: raw.from,
      to: raw.to,
      cost,
      prodFrom: raw.prodFrom,
      prodTo: raw.prodTo,
      opening: raw.opening ? { date: raw.opening.session.count_date, coverage: raw.opening.coverage } : null,
      closing: raw.closing ? { date: raw.closing.session.count_date, coverage: raw.closing.coverage } : null,
      estimated,
      blocked: raw.blocked,
      produced: raw.produced.length > 0,
      uncounted,
      purchases: raw.purchases,
      distribution: raw.distribution,
    };
  }, [raw, liveRm, liveReady]);

  return { data, loading: loading || (!!raw && !raw.closing && !liveReady), error };
}
