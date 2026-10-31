import { useState, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { fetchAllRows } from "@/lib/fetch-all";
import { branchShortCount, kitchenShortCount } from "@/lib/transfer-lines";
import { ZERO_AFTER_SEND, isDelivered, planLineEdits, returnSent, statusWord } from "@/lib/transfer-stock";
import { callDbFunction, moveOrder, orderState, removeDistribution, syncDistribution } from "@/lib/transfer-stock-db";

export interface PendingTR {
  trId: string;
  trNumber: string;
  branchId: string;
  branchName: string;
  requestedDate: string;
  requiredDate: string;
  createdAt: string;
  itemCount: number;
  lines: PendingTRLine[];
  /** A transfer order already started for this request but not sent yet */
  draft: { toId: string; toNumber: string; createdAt: string } | null;
}

export interface PendingTRLine {
  id: string;
  skuId: string;
  skuCode: string;
  skuName: string;
  uom: string;
  requestedQty: number;
  skuType: "SM" | "RM" | "PK";
}

export interface TOLine {
  id: string;
  skuId: string;
  skuCode: string;
  skuName: string;
  plannedQty: number;
  actualQty: number;
  uom: string;
  unitCost: number;
  lineValue: number;
  note: string;
  trLineId: string | null;
  packsCount: number | null;
}

export interface TOHistoryRow {
  id: string;
  toNumber: string;
  deliveryDate: string;
  branchId: string;
  branchName: string;
  trId: string | null;
  trRef: string;
  itemCount: number;
  totalValue: number;
  status: string;
  createdAt: string;
  updatedAt: string;
  notes: string;
  hasLineNotes: boolean;
  /** Request lines the kitchen didn't send or sent >10% short */
  kitchenShort: number;
  /** Lines the branch received >10% under what was sent (only once received) */
  branchShort: number;
  /** Branch receipts saved for it (0 on a "received" order = a receive that didn't finish: it can still be cancelled) */
  receipts: number;
}

export interface HistoryFilters {
  branchIds?: string[];
  dateFrom?: string;
  dateTo?: string;
}

/** One request's lines as a TO line list */
async function linesOfTO(toId: string): Promise<TOLine[]> {
  const { data, error } = await supabase
    .from("transfer_order_lines")
    .select("id, sku_id, planned_qty, actual_qty, uom, unit_cost, line_value, notes, tr_line_id, packs_count, skus(sku_id, name)")
    .eq("to_id", toId)
    .order("id");
  if (error || !data) return [];
  return (data as any[]).map((d) => ({
    id: d.id,
    skuId: d.sku_id,
    skuCode: d.skus?.sku_id || "",
    skuName: d.skus?.name || "",
    plannedQty: Number(d.planned_qty) || 0,
    actualQty: Number(d.actual_qty) || 0,
    uom: d.uom,
    unitCost: Number(d.unit_cost) || 0,
    lineValue: Number(d.line_value) || 0,
    note: d.notes || "",
    trLineId: d.tr_line_id,
    packsCount: d.packs_count ?? null,
  }));
}

/**
 * Line edits only go to an order that hasn't been sent: with the same draft open on
 * two screens, the one left behind must not change an order the other one sent.
 */
async function stillDraft(toId: string): Promise<boolean> {
  const { data } = await supabase.from("transfer_orders").select("status").eq("id", toId).maybeSingle();
  if (data?.status === "Draft") return true;
  toast.error("ใบนี้ถูกส่งหรือทิ้งไปแล้วจากอีกเครื่อง กลับไปหน้าแรกแล้วเปิดใหม่");
  return false;
}

/** Request lines start undeclined again (their order was thrown away, cancelled or deleted) */
async function clearDeclines(trIds: string[]) {
  if (trIds.length === 0) return;
  await supabase.from("transfer_request_lines").update({ decline_reason: null, declined_at: null, declined_by: null }).in("tr_id", trIds).not("declined_at", "is", null);
}

export function useTransferOrder(getBomCostPerGram?: (skuId: string) => number) {
  const [pendingTRs, setPendingTRs] = useState<PendingTR[]>([]);
  const [pendingLoading, setPendingLoading] = useState(true);
  /** Every unsent order, any age (the home list and the clean-up) */
  const [drafts, setDrafts] = useState<{ id: string; toNumber: string; branchId: string; branchName: string; trId: string | null; createdAt: string; itemCount: number }[]>([]);
  const [toHistory, setToHistory] = useState<TOHistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // ─── Requests waiting for the kitchen ───
  // A request is waiting while it has no SENT (or received) transfer order — derived
  // from the TO table, not transfer_requests.status, which used to be left at
  // 'Submitted' when a status write failed. An unsent draft no longer hides the
  // request: it shows as "started" so a forgotten draft can't swallow an order.
  const fetchDrafts = useCallback(async () => {
    const { data } = await supabase
      .from("transfer_orders")
      .select("id, to_number, branch_id, tr_id, created_at, branches(branch_name), transfer_order_lines(count)")
      .eq("status", "Draft")
      .order("created_at", { ascending: false })
      .order("id");
    setDrafts(
      ((data || []) as any[]).map((d) => ({
        id: d.id,
        toNumber: d.to_number,
        branchId: d.branch_id,
        branchName: d.branches?.branch_name || "",
        trId: d.tr_id,
        createdAt: d.created_at,
        itemCount: d.transfer_order_lines?.[0]?.count ?? 0,
      })),
    );
  }, []);

  const fetchPendingTRs = useCallback(async () => {
    fetchDrafts();
    const { data: candidates, error } = await supabase
      .from("transfer_requests")
      .select("id, tr_number, branch_id, requested_date, required_date, created_at")
      .in("status", ["Submitted", "Acknowledged"])
      .order("required_date", { ascending: true })
      .order("id");
    if (error || !candidates || candidates.length === 0) {
      setPendingTRs([]);
      setPendingLoading(false);
      return;
    }
    const candidateIds = candidates.map((t) => t.id);
    const { data: tos } = await supabase
      .from("transfer_orders")
      .select("id, to_number, tr_id, status, created_at")
      .in("tr_id", candidateIds)
      .neq("status", "Cancelled")
      .order("created_at", { ascending: false });
    const sentFor = new Set((tos || []).filter((t) => t.status !== "Draft").map((t) => t.tr_id));
    const draftFor = new Map<string, { toId: string; toNumber: string; createdAt: string }>();
    for (const t of tos || []) {
      if (t.status === "Draft" && t.tr_id && !draftFor.has(t.tr_id)) draftFor.set(t.tr_id, { toId: t.id, toNumber: t.to_number, createdAt: t.created_at });
    }
    const trs = candidates.filter((t) => !sentFor.has(t.id));
    if (trs.length === 0) {
      setPendingTRs([]);
      setPendingLoading(false);
      return;
    }

    const branchIds = [...new Set(trs.map((t) => t.branch_id))];
    const [{ data: branches }, { data: allLines }] = await Promise.all([
      supabase.from("branches").select("id, branch_name").in("id", branchIds),
      supabase
        .from("transfer_request_lines")
        .select("id, tr_id, sku_id, requested_qty, uom, sku_type, skus(sku_id, name)")
        .in("tr_id", trs.map((t) => t.id))
        .order("id"),
    ]);
    const bMap: Record<string, string> = {};
    for (const b of branches || []) bMap[b.id] = b.branch_name;

    setPendingTRs(
      trs.map((tr) => {
        const trLines = ((allLines || []) as any[]).filter((l) => l.tr_id === tr.id);
        return {
          trId: tr.id,
          trNumber: tr.tr_number,
          branchId: tr.branch_id,
          branchName: bMap[tr.branch_id] || "",
          requestedDate: tr.requested_date,
          requiredDate: tr.required_date,
          createdAt: tr.created_at,
          itemCount: trLines.length,
          draft: draftFor.get(tr.id) ?? null,
          lines: trLines.map((l) => ({
            id: l.id,
            skuId: l.sku_id,
            skuCode: l.skus?.sku_id || "",
            skuName: l.skus?.name || "",
            uom: l.uom,
            requestedQty: Number(l.requested_qty) || 0,
            skuType: (l.sku_type === "RM" ? "RM" : l.sku_type === "PK" ? "PK" : "SM") as "SM" | "RM" | "PK",
          })),
        };
      }),
    );
    setPendingLoading(false);
  }, [fetchDrafts]);

  useEffect(() => {
    fetchPendingTRs();
  }, [fetchPendingTRs]);

  /** Request lines the kitchen marked "ส่งไม่ได้", with the reason */
  const fetchDeclined = useCallback(async (trId: string): Promise<{ line: PendingTRLine; reason: string }[]> => {
    const { data } = await supabase
      .from("transfer_request_lines")
      .select("id, sku_id, requested_qty, uom, sku_type, decline_reason, skus(sku_id, name)")
      .eq("tr_id", trId)
      .not("declined_at", "is", null)
      .order("id");
    return ((data || []) as any[]).map((l) => ({
      reason: l.decline_reason || "",
      line: {
        id: l.id,
        skuId: l.sku_id,
        skuCode: l.skus?.sku_id || "",
        skuName: l.skus?.name || "",
        uom: l.uom,
        requestedQty: Number(l.requested_qty) || 0,
        skuType: (l.sku_type === "RM" ? "RM" : l.sku_type === "PK" ? "PK" : "SM") as "SM" | "RM" | "PK",
      },
    }));
  }, []);

  // ─── History, with the two shortfall labels ───
  const fetchHistory = useCallback(async (filters?: HistoryFilters) => {
    setHistoryLoading(true);
    let query = supabase
      .from("transfer_orders")
      .select("id, to_number, delivery_date, branch_id, tr_id, total_value, status, notes, created_at, updated_at")
      .order("created_at", { ascending: false })
      .order("id");
    if (filters?.branchIds?.length) query = query.in("branch_id", filters.branchIds);
    if (filters?.dateFrom) query = query.gte("delivery_date", filters.dateFrom);
    if (filters?.dateTo) query = query.lte("delivery_date", filters.dateTo);
    const { data, error } = await query;
    if (error) {
      toast.error("โหลดประวัติใบโอนไม่ได้");
      setHistoryLoading(false);
      return;
    }
    const tos = data || [];
    const toIds = tos.map((d) => d.id);
    const trIds = [...new Set(tos.map((d) => d.tr_id).filter(Boolean))] as string[];
    const branchIds = [...new Set(tos.map((d) => d.branch_id))];

    const [{ data: branches }, { data: trs }, lineRes, receiptRes, declinedRes] = await Promise.all([
      branchIds.length ? supabase.from("branches").select("id, branch_name").in("id", branchIds) : Promise.resolve({ data: [] as any[] }),
      trIds.length ? supabase.from("transfer_requests").select("id, tr_number").in("id", trIds) : Promise.resolve({ data: [] as any[] }),
      toIds.length
        ? fetchAllRows<any>((f, t) => supabase.from("transfer_order_lines").select("id, to_id, sku_id, planned_qty, actual_qty, tr_line_id, notes, packs_count, skus(pack_size)").in("to_id", toIds).order("id").range(f, t))
        : Promise.resolve({ data: [] as any[], error: null }),
      toIds.length
        ? fetchAllRows<any>((f, t) => supabase.from("branch_receipts").select("id, transfer_order_id, sku_id, qty_received").in("transfer_order_id", toIds).order("id").range(f, t))
        : Promise.resolve({ data: [] as any[], error: null }),
      trIds.length
        ? fetchAllRows<any>((f, t) => supabase.from("transfer_request_lines").select("id, tr_id").in("tr_id", trIds).not("declined_at", "is", null).order("id").range(f, t))
        : Promise.resolve({ data: [] as any[], error: null }),
    ]);
    const bMap: Record<string, string> = {};
    for (const b of branches || []) bMap[b.id] = b.branch_name;
    const trMap: Record<string, string> = {};
    for (const t of trs || []) trMap[t.id] = t.tr_number;
    const linesBy = new Map<string, any[]>();
    for (const l of lineRes.data) linesBy.set(l.to_id, [...(linesBy.get(l.to_id) || []), l]);
    const receivedBy = new Map<string, Map<string, number>>();
    const receiptsOf = new Map<string, number>();
    for (const r of receiptRes.data) {
      receiptsOf.set(r.transfer_order_id, (receiptsOf.get(r.transfer_order_id) || 0) + 1);
      const m = receivedBy.get(r.transfer_order_id) || new Map<string, number>();
      m.set(r.sku_id, (m.get(r.sku_id) || 0) + (Number(r.qty_received) || 0));
      receivedBy.set(r.transfer_order_id, m);
    }
    const declinedBy = new Map<string, number>();
    for (const d of declinedRes.data) declinedBy.set(d.tr_id, (declinedBy.get(d.tr_id) || 0) + 1);

    setToHistory(
      tos.map((d) => {
        const lines = (linesBy.get(d.id) || []).map((l) => ({
          skuId: l.sku_id,
          trLineId: l.tr_line_id,
          plannedQty: Number(l.planned_qty) || 0,
          actualQty: Number(l.actual_qty) || 0,
          packsCount: l.packs_count ?? null,
          packSize: Number(l.skus?.pack_size) || 0,
        }));
        const sent = d.status !== "Draft" && d.status !== "Cancelled";
        const received = d.status === "Received" || d.status === "Partially Received";
        return {
          id: d.id,
          toNumber: d.to_number,
          deliveryDate: d.delivery_date,
          branchId: d.branch_id,
          branchName: bMap[d.branch_id] || "",
          trId: d.tr_id,
          trRef: d.tr_id ? trMap[d.tr_id] || "—" : "—",
          itemCount: lines.length,
          totalValue: Number(d.total_value) || 0,
          status: d.status,
          createdAt: d.created_at,
          updatedAt: d.updated_at,
          notes: d.notes || "",
          hasLineNotes: (linesBy.get(d.id) || []).some((l) => (l.notes || "").trim() !== ""),
          kitchenShort: sent ? kitchenShortCount(lines, d.tr_id ? declinedBy.get(d.tr_id) || 0 : 0) : 0,
          branchShort: received ? branchShortCount(lines, receivedBy.get(d.id) || new Map()) : 0,
          receipts: receiptsOf.get(d.id) || 0,
        };
      }),
    );
    setHistoryLoading(false);
  }, []);

  // ─── Start (or continue) a transfer order ───
  // Continuing a request reuses its unsent draft instead of making another one;
  // the old page created a new draft on every tap (one request had four).
  const createTO = useCallback(
    async (params: {
      trId?: string;
      branchId: string;
      deliveryDate: string;
      notes?: string;
      profileId?: string;
      trLines?: PendingTRLine[];
    }): Promise<{ toId: string; toNumber: string; lines: TOLine[] } | { error: string }> => {
      try {
        if (params.trId) {
          const { data: existing } = await supabase
            .from("transfer_orders")
            .select("id, to_number")
            .eq("tr_id", params.trId)
            .eq("status", "Draft")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (existing) return { toId: existing.id, toNumber: existing.to_number, lines: await linesOfTO(existing.id) };
        }

        // A new order for a request starts with every requested line (old reasons off)
        if (params.trId) await clearDeclines([params.trId]);

        const now = new Date();
        const { data: toNumber, error: rpcError } = await supabase.rpc("next_doc_number", {
          p_type: "TO",
          p_year: now.getFullYear(),
          p_month: now.getMonth() + 1,
        });
        if (rpcError || !toNumber) return { error: rpcError?.message || "สร้างเลขใบโอนไม่ได้" };

        const { data: toRow, error: toError } = await supabase
          .from("transfer_orders")
          .insert({
            to_number: toNumber,
            tr_id: params.trId || null,
            branch_id: params.branchId,
            status: "Draft",
            delivery_date: params.deliveryDate,
            notes: params.notes || "",
            created_by: params.profileId || null,
            total_value: 0,
          })
          .select("id")
          .single();
        if (toError || !toRow) {
          // Another tap or screen started this request at the same moment: use its draft
          if (params.trId) {
            const { data: other } = await supabase.from("transfer_orders").select("id, to_number").eq("tr_id", params.trId).eq("status", "Draft").limit(1).maybeSingle();
            if (other) return { toId: other.id, toNumber: other.to_number, lines: await linesOfTO(other.id) };
          }
          return { error: toError?.message || "สร้างใบโอนไม่ได้" };
        }

        if (params.trId && params.trLines && params.trLines.length > 0) {
          // Cost: RM/PK from the active price, SM from its BOM cost (as before)
          const rmSkuIds = params.trLines.filter((l) => l.skuType === "RM" || l.skuType === "PK").map((l) => l.skuId);
          const rmPriceMap: Record<string, number> = {};
          if (rmSkuIds.length > 0) {
            // The standard: newest active price (one per supplier can be active)
            const { data: prices } = await supabase.from("prices").select("sku_id, price_per_usage_uom").in("sku_id", rmSkuIds).eq("is_active", true).order("created_at", { ascending: false }).order("id");
            for (const p of prices || []) if (!(p.sku_id in rmPriceMap)) rmPriceMap[p.sku_id] = p.price_per_usage_uom;
          }
          // Pack size seeds the pack count on each line
          const packSizeMap: Record<string, number> = {};
          const { data: skuRows } = await supabase.from("skus").select("id, pack_size").in("id", [...new Set(params.trLines.map((l) => l.skuId))]);
          for (const s of skuRows || []) packSizeMap[s.id] = Number(s.pack_size) || 0;

          const lineInserts = params.trLines.map((l) => {
            const unitCost = l.skuType === "RM" || l.skuType === "PK" ? (rmPriceMap[l.skuId] ?? 0) : (getBomCostPerGram?.(l.skuId) ?? 0);
            const ps = packSizeMap[l.skuId] || 0;
            return {
              to_id: toRow.id,
              sku_id: l.skuId,
              planned_qty: l.requestedQty,
              actual_qty: l.requestedQty,
              uom: l.uom,
              unit_cost: unitCost,
              line_value: l.requestedQty * unitCost,
              notes: "",
              tr_line_id: l.id,
              sku_type: l.skuType,
              packs_count: ps > 0 ? Math.round(l.requestedQty / ps) : null,
            };
          });
          const { error: lErr } = await supabase.from("transfer_order_lines").insert(lineInserts);
          if (lErr) {
            // Don't leave an empty draft behind
            await supabase.from("transfer_orders").delete().eq("id", toRow.id).eq("status", "Draft");
            return { error: lErr.message };
          }
          // The status column still feeds the branch's "already asked" figures
          const { error: ackErr } = await supabase.from("transfer_requests").update({ status: "Acknowledged" }).eq("id", params.trId);
          if (ackErr) toast.error("เริ่มใบโอนแล้ว แต่อัปเดตสถานะใบขอเบิกไม่ได้: " + ackErr.message);
        }

        fetchPendingTRs();
        return { toId: toRow.id, toNumber, lines: await linesOfTO(toRow.id) };
      } catch (e: any) {
        return { error: e.message || "เกิดข้อผิดพลาด" };
      }
    },
    [getBomCostPerGram, fetchPendingTRs],
  );

  // ─── Save one line as it is typed ───
  // packsCount: a number saves the typed pack count; undefined keeps it (weight-only
  // edits); null clears it.
  const updateTOLine = useCallback(async (toId: string, lineId: string, actualQty: number, packsCount?: number | null, unitCost?: number) => {
    if (!(await stillDraft(toId))) return false;
    const patch: { actual_qty: number; packs_count?: number | null; line_value?: number } = { actual_qty: actualQty };
    if (packsCount !== undefined) patch.packs_count = packsCount;
    if (unitCost !== undefined) patch.line_value = actualQty * unitCost;
    const { error } = await supabase.from("transfer_order_lines").update(patch).eq("id", lineId);
    if (error) toast.error("บันทึกจำนวนไม่ได้: " + error.message);
    return !error;
  }, []);

  /** A note on a line. (The old page zeroed the line's quantity when a note was typed.) */
  const updateTOLineNote = useCallback(async (toId: string, lineId: string, note: string) => {
    if (!(await stillDraft(toId))) return false;
    const { error } = await supabase.from("transfer_order_lines").update({ notes: note }).eq("id", lineId);
    if (error) toast.error("บันทึกหมายเหตุไม่ได้: " + error.message);
    return !error;
  }, []);

  const updateTOHeader = useCallback(async (toId: string, patch: { notes?: string; delivery_date?: string }) => {
    const { error } = await supabase.from("transfer_orders").update(patch).eq("id", toId);
    if (error) toast.error("บันทึกไม่ได้: " + error.message);
    return !error;
  }, []);

  // ─── Send ───
  // Every line must save before the order is marked sent, and only a draft can be
  // sent — a second tap (or a second screen) can't send it twice and take the
  // kitchen's stock out twice.
  const sendTO = useCallback(
    async (toId: string, lines: TOLine[], notes?: string, deliveryDate?: string): Promise<{ error?: string }> => {
      // Claim the order first: only one screen can turn a draft into sent
      const totalValue = lines.reduce((s, l) => s + l.actualQty * l.unitCost, 0);
      const patch: { status: string; total_value: number; notes?: string; delivery_date?: string } = { status: "Sent", total_value: totalValue };
      if (notes !== undefined) patch.notes = notes;
      if (deliveryDate) patch.delivery_date = deliveryDate;
      const { data: sentRows, error } = await supabase
        .from("transfer_orders")
        .update(patch)
        .eq("id", toId)
        .eq("status", "Draft")
        .select("id, tr_id, to_number, sent_at, delivery_date");
      if (error) return { error: error.message };
      const to = sentRows?.[0];
      if (!to) return { error: "ใบนี้ถูกส่งไปแล้ว" };

      const results = await Promise.all(
        lines.map((l) =>
          supabase
            .from("transfer_order_lines")
            .update({ actual_qty: l.actualQty, line_value: l.actualQty * l.unitCost, notes: l.note, packs_count: l.packsCount })
            .eq("id", l.id)
            .select("id"),
        ),
      );
      const failed = results.find((r) => r.error || !r.data?.length);
      if (failed) {
        // Put it back to a draft so nothing is taken out of stock half-written (not sent: the next send dates it)
        await supabase.from("transfer_orders").update({ status: "Draft", sent_at: null }).eq("id", toId).eq("status", "Sent");
        return { error: "บันทึกบางรายการไม่ได้ ยังไม่ได้ส่ง" + (failed.error ? ": " + failed.error.message : "") };
      }

      // Kitchen RM/PK out for the lines, dated the day it went out (SM is read from the lines)
      const adjErr = await syncDistribution({ id: toId, toNumber: to.to_number, sentAt: to.sent_at, deliveryDate: to.delivery_date });
      if (adjErr) toast.error("ส่งแล้ว แต่หักสต๊อกวัตถุดิบ/บรรจุภัณฑ์ของครัวไม่ได้: " + adjErr);

      if (to.tr_id) {
        const { error: fulErr } = await supabase.from("transfer_requests").update({ status: "Fulfilled" }).eq("id", to.tr_id);
        if (fulErr) toast.error("ส่งแล้ว แต่อัปเดตสถานะใบขอเบิกไม่ได้: " + fulErr.message);
      }
      fetchPendingTRs();
      return {};
    },
    [fetchPendingTRs],
  );

  // ─── Throw away unsent drafts (and give the request back to the queue) ───
  const discardDrafts = useCallback(
    async (toIds: string[]): Promise<number> => {
      if (toIds.length === 0) return 0;
      const { data: drafts } = await supabase.from("transfer_orders").select("id, tr_id").in("id", toIds).eq("status", "Draft");
      const ids = (drafts || []).map((d) => d.id);
      if (ids.length === 0) return 0;
      const { data: lines } = await supabase.from("transfer_order_lines").select("id").in("to_id", ids);
      const lineIds = (lines || []).map((l) => l.id);
      if (lineIds.length) {
        const { error: lotErr } = await supabase.from("transfer_order_lot_lines").delete().in("to_line_id", lineIds);
        if (lotErr) {
          toast.error("ทิ้งใบร่างไม่ได้: " + lotErr.message);
          return 0;
        }
        await supabase.from("transfer_order_lines").delete().in("to_id", ids);
      }
      const { error } = await supabase.from("transfer_orders").delete().in("id", ids).eq("status", "Draft");
      if (error) {
        toast.error("ทิ้งใบร่างไม่ได้: " + error.message);
        return 0;
      }
      // A request whose only draft was thrown away waits for the kitchen again
      const trIds = [...new Set((drafts || []).map((d) => d.tr_id).filter(Boolean))] as string[];
      if (trIds.length) {
        const { data: stillSent } = await supabase.from("transfer_orders").select("tr_id").in("tr_id", trIds).neq("status", "Cancelled");
        const covered = new Set((stillSent || []).map((t) => t.tr_id));
        const reopen = trIds.filter((id) => !covered.has(id));
        if (reopen.length) {
          await supabase.from("transfer_requests").update({ status: "Submitted" }).in("id", reopen).eq("status", "Acknowledged");
          await clearDeclines(reopen);
        }
      }
      fetchPendingTRs();
      return ids.length;
    },
    [fetchPendingTRs],
  );

  // ─── Cancel a sent order (management, CK manager) ───
  // The undo for a sent order (it is never deleted: lib/transfer-stock.ts). The same steps as
  // a branch's decline: only while nothing was received, claimed (so a branch can't receive
  // it at that moment), then its RM/PK comes back to the kitchen (its SM by the status).
  const cancelTO = useCallback(
    async (toId: string) => {
      const { data: to, error: toErr } = await supabase.from("transfer_orders").select("id, to_number, tr_id").eq("id", toId).maybeSingle();
      if (toErr || !to) {
        toast.error("โหลดใบโอนไม่ได้");
        return false;
      }
      const res = await returnSent({
        read: () => orderState(toId),
        move: (from) => moveOrder(toId, from, { status: "Cancelled" }),
        // The database does this itself once the 1 Nov 2026 migration is in (then nothing is left here)
        returnStock: () => removeDistribution({ id: to.id, toNumber: to.to_number }),
      });
      if (res.kind !== "done") {
        toast.error(
          res.kind === "received"
            ? `สาขารับของใบ ${to.to_number} แล้ว ยกเลิกไม่ได้ ถ้าส่งผิดให้กด “แก้ใบที่ส่งแล้ว”`
            : res.kind === "taken"
              ? `ใบ ${to.to_number} ถูก${statusWord(res.status)}ไปแล้ว`
              : res.kind === "blocked"
                ? "บัญชีนี้ยกเลิกใบโอนไม่ได้"
                : "ยกเลิกใบโอนไม่ได้: " + res.message,
        );
        return false;
      }
      if (res.stockError) toast.error("ยกเลิกแล้ว แต่คืนสต๊อกวัตถุดิบ/บรรจุภัณฑ์เข้าครัวไม่ได้: " + res.stockError);
      // Reopen the request so it returns to the queue and stops counting as "on its way"
      if (to.tr_id) {
        const { data: tr, error: trErr } = await supabase.from("transfer_requests").update({ status: "Submitted" }).eq("id", to.tr_id).select("id");
        if (trErr || !tr?.length) toast.error("ยกเลิกแล้ว แต่เปิดใบขอเบิกกลับไม่ได้" + (trErr ? ": " + trErr.message : ""));
        await clearDeclines([to.tr_id]);
      }
      toast.success("ยกเลิกใบโอนแล้ว");
      fetchPendingTRs();
      return true;
    },
    [fetchPendingTRs],
  );

  // ─── Save changes to a sent order (CK manager) ───
  // Its RM/PK deduction gets only the difference, dated the day the order went out: it was
  // deleted and written again as today's, which put it after any kitchen count since (RM/PK
  // read too low) and left the order with no deduction when the second write failed. A line set
  // to 0 means "not sent" (lib/transfer-stock.ts planLineEdits). Once the 1 Nov 2026 migration
  // is in, save_sent_transfer_order does all of it in one transaction (and an older copy of the
  // app is refused before it saves a line).
  const saveTOEdits = useCallback(async (toId: string, lines: TOLine[], declinedBy?: string | null): Promise<boolean> => {
    const { data: to, error: toErr } = await supabase.from("transfer_orders").select("id, to_number, status, sent_at, delivery_date").eq("id", toId).maybeSingle();
    if (toErr || !to) {
      toast.error("โหลดใบโอนไม่ได้");
      return false;
    }
    // Cancelled or declined meanwhile: its stock is already back, nothing to edit
    if (!isDelivered(to.status)) {
      toast.error(`ใบ ${to.to_number} ถูก${statusWord(to.status)}ไปแล้ว แก้ไม่ได้`);
      return false;
    }
    const refusedMsg = (names: string) => `สาขารับ ${names} จากใบนี้แล้ว ใส่ 0 ไม่ได้ (สต๊อกจะกลับเข้าครัวทั้งที่สาขามีของ) · ใส่จำนวนที่ส่งจริงแทน`;
    const db = await callDbFunction<{ result: string; status?: string; product?: string }>("save_sent_transfer_order", {
      p_to_id: toId,
      p_lines: lines.map((l) => ({ id: l.id, actual_qty: l.actualQty, notes: l.note, packs_count: l.packsCount })),
    });
    if (db.kind === "answer") {
      const r = db.value.result;
      if (r === "saved") {
        toast.success("บันทึกการแก้ไขแล้ว");
        return true;
      }
      toast.error(r === "received_line" ? refusedMsg(db.value.product ?? "รายการนี้") : `ใบ ${to.to_number} ถูก${statusWord(r === "gone" ? null : db.value.status ?? null)}ไปแล้ว แก้ไม่ได้`);
      return false;
    }
    if (db.kind === "refused") {
      toast.error("บันทึกไม่สำเร็จ ยังไม่มีอะไรถูกบันทึก: " + db.message);
      return false;
    }
    if (db.kind === "unknown") {
      // Saving again is safe: the lines are set to these numbers and only a missing difference is added
      toast.error("ไม่แน่ใจว่าบันทึกแล้วหรือยัง กดบันทึกอีกครั้งได้ ไม่หักสต๊อกซ้ำ: " + db.message);
      return false;
    }
    // Before the migration: the same plan here
    const [storedRes, receivedRes] = await Promise.all([
      supabase.from("transfer_order_lines").select("id, sku_id, actual_qty, planned_qty, tr_line_id").eq("to_id", toId).order("id"),
      supabase.from("branch_receipts").select("sku_id, qty_received").eq("transfer_order_id", toId).order("id"),
    ]);
    if (storedRes.error || receivedRes.error) {
      toast.error("โหลดใบโอนไม่ได้");
      return false;
    }
    const receivedBySku = new Map<string, number>();
    for (const r of receivedRes.data ?? []) receivedBySku.set(r.sku_id, (receivedBySku.get(r.sku_id) ?? 0) + (Number(r.qty_received) || 0));
    const stored = (storedRes.data ?? []).map((l) => ({ id: l.id, skuId: l.sku_id, actualQty: Number(l.actual_qty) || 0, plannedQty: Number(l.planned_qty) || 0, trLineId: l.tr_line_id }));
    const plan = planLineEdits(stored, lines, receivedBySku);
    if (plan.refused.length) {
      toast.error(refusedMsg(lines.filter((l) => plan.refused.includes(l.id)).map((l) => l.skuName).join(", ")));
      return false;
    }
    const requested = new Map<string, number>();
    if (plan.undecline.length) {
      const { data: tr } = await supabase.from("transfer_request_lines").select("id, requested_qty").in("id", plan.undecline);
      for (const t of tr ?? []) requested.set(t.id, Number(t.requested_qty) || 0);
    }
    const trOf = new Map(stored.map((l) => [l.id, l.trLineId]));
    const results = await Promise.all(
      lines.map((l) => {
        const p = plan.planned.get(l.id);
        const planned = p === "requested" ? requested.get(trOf.get(l.id) ?? "") : p;
        return supabase
          .from("transfer_order_lines")
          .update({ actual_qty: l.actualQty, line_value: l.actualQty * l.unitCost, notes: l.note, packs_count: l.packsCount, ...(planned !== undefined ? { planned_qty: planned } : {}) })
          .eq("id", l.id)
          .eq("to_id", toId)
          .select("id");
      }),
    );
    const failed = results.find((r) => r.error || !r.data?.length);
    if (failed) {
      toast.error("บันทึกบางรายการไม่ได้" + (failed.error ? ": " + failed.error.message : ""));
      return false;
    }
    // The request lines say which were not sent (the order's "ครัวกลางส่งไม่ครบ" label)
    const trWrites = await Promise.all([
      plan.decline.length ? supabase.from("transfer_request_lines").update({ decline_reason: ZERO_AFTER_SEND, declined_at: new Date().toISOString(), declined_by: declinedBy || null }).in("id", plan.decline).select("id") : null,
      plan.undecline.length ? supabase.from("transfer_request_lines").update({ decline_reason: null, declined_at: null, declined_by: null }).in("id", plan.undecline).select("id") : null,
    ]);
    if (trWrites.some((w, i) => w && (w.error || (w.data?.length ?? 0) < (i === 0 ? plan.decline : plan.undecline).length))) toast.error("บันทึกแล้ว แต่บันทึกรายการที่ไม่ได้ส่งในใบขอเบิกไม่ได้");
    const totalValue = lines.reduce((s, l) => s + l.actualQty * l.unitCost, 0);
    const { data: head, error: headErr } = await supabase.from("transfer_orders").update({ total_value: totalValue }).eq("id", toId).select("id");
    if (headErr || !head?.length) toast.error("บันทึกยอดรวมของใบไม่ได้" + (headErr ? ": " + headErr.message : ""));
    const adjErr = await syncDistribution({ id: to.id, toNumber: to.to_number, sentAt: to.sent_at, deliveryDate: to.delivery_date });
    if (adjErr) {
      // The lines are saved; saving again adds only what is still missing
      toast.error("บันทึกแล้ว แต่ปรับสต๊อกวัตถุดิบ/บรรจุภัณฑ์ไม่ได้ กดบันทึกอีกครั้ง: " + adjErr);
      return false;
    }
    toast.success("บันทึกการแก้ไขแล้ว");
    return true;
  }, []);

  const fetchTODetail = useCallback((toId: string) => linesOfTO(toId), []);

  // ─── Add a product the branch didn't ask for ───
  const addTOLine = useCallback(
    async (toId: string, skuId: string, skuCode: string, skuName: string, uom: string): Promise<TOLine | null> => {
      if (!(await stillDraft(toId))) return null;
      const { data: skuRow } = await supabase.from("skus").select("type").eq("id", skuId).single();
      const skuType = skuRow?.type === "PK" ? "PK" : skuRow?.type === "RM" ? "RM" : "SM";
      // Same pricing as request lines: RM/PK → active price, SM → BOM cost
      let costPerG = 0;
      if (skuType === "RM" || skuType === "PK") {
        const { data: priceRow } = await supabase
          .from("prices")
          .select("price_per_usage_uom")
          .eq("sku_id", skuId)
          .eq("is_active", true)
          .order("created_at", { ascending: false })
          .order("id")
          .limit(1)
          .maybeSingle();
        costPerG = Number(priceRow?.price_per_usage_uom) || 0;
      } else {
        costPerG = getBomCostPerGram?.(skuId) ?? 0;
      }
      const { data, error } = await supabase
        .from("transfer_order_lines")
        .insert({ to_id: toId, sku_id: skuId, planned_qty: 0, actual_qty: 0, uom, unit_cost: costPerG, line_value: 0, notes: "", tr_line_id: null, sku_type: skuType, packs_count: 0 })
        .select()
        .single();
      if (error || !data) {
        toast.error("เพิ่มสินค้าไม่ได้");
        return null;
      }
      return { id: data.id, skuId, skuCode, skuName, plannedQty: 0, actualQty: 0, uom, unitCost: costPerG, lineValue: 0, note: "", trLineId: null, packsCount: 0 };
    },
    [getBomCostPerGram],
  );

  // ─── "ส่งไม่ได้": take a line off; a requested line keeps the reason for the branch ───
  const deleteTOLine = useCallback(async (toId: string, lineId: string, trLineId: string | null, reason?: string, declinedBy?: string | null) => {
    if (!(await stillDraft(toId))) return false;
    await supabase.from("transfer_order_lot_lines").delete().eq("to_line_id", lineId);
    const { error } = await supabase.from("transfer_order_lines").delete().eq("id", lineId);
    if (error) {
      toast.error("เอารายการออกไม่ได้");
      return false;
    }
    if (trLineId) {
      const { error: declineErr } = await supabase
        .from("transfer_request_lines")
        .update({ decline_reason: reason || null, declined_at: new Date().toISOString(), declined_by: declinedBy || null })
        .eq("id", trLineId);
      if (declineErr) toast.error("เอาออกแล้ว แต่บันทึกเหตุผลไม่ได้: " + declineErr.message);
    }
    return true;
  }, []);

  /**
   * "ส่งได้แล้ว": put a declined request line back on the order (its reason is cleared).
   */
  const restoreTOLine = useCallback(
    async (toId: string, trLine: PendingTRLine): Promise<TOLine | null> => {
      if (!(await stillDraft(toId))) return null;
      // Already back on the order (a second tap): nothing to add
      const { data: dup } = await supabase.from("transfer_order_lines").select("id").eq("to_id", toId).eq("tr_line_id", trLine.id).limit(1);
      if (dup?.length) return null;
      const { data: sku } = await supabase.from("skus").select("pack_size").eq("id", trLine.skuId).maybeSingle();
      let unitCost = 0;
      if (trLine.skuType === "RM" || trLine.skuType === "PK") {
        const { data: p } = await supabase
          .from("prices")
          .select("price_per_usage_uom")
          .eq("sku_id", trLine.skuId)
          .eq("is_active", true)
          .order("created_at", { ascending: false })
          .order("id")
          .limit(1)
          .maybeSingle();
        unitCost = Number(p?.price_per_usage_uom) || 0;
      } else unitCost = getBomCostPerGram?.(trLine.skuId) ?? 0;
      const ps = Number(sku?.pack_size) || 0;
      const { data, error } = await supabase
        .from("transfer_order_lines")
        .insert({
          to_id: toId,
          sku_id: trLine.skuId,
          planned_qty: trLine.requestedQty,
          actual_qty: trLine.requestedQty,
          uom: trLine.uom,
          unit_cost: unitCost,
          line_value: trLine.requestedQty * unitCost,
          notes: "",
          tr_line_id: trLine.id,
          sku_type: trLine.skuType,
          packs_count: ps > 0 ? Math.round(trLine.requestedQty / ps) : null,
        })
        .select()
        .single();
      if (error || !data) {
        toast.error("ใส่กลับไม่ได้");
        return null;
      }
      await supabase.from("transfer_request_lines").update({ decline_reason: null, declined_at: null, declined_by: null }).eq("id", trLine.id);
      return {
        id: data.id,
        skuId: trLine.skuId,
        skuCode: trLine.skuCode,
        skuName: trLine.skuName,
        plannedQty: trLine.requestedQty,
        actualQty: trLine.requestedQty,
        uom: trLine.uom,
        unitCost,
        lineValue: trLine.requestedQty * unitCost,
        note: "",
        trLineId: trLine.id,
        packsCount: data.packs_count ?? null,
      };
    },
    [getBomCostPerGram],
  );

  return {
    pendingTRs,
    pendingLoading,
    drafts,
    fetchDeclined,
    toHistory,
    historyLoading,
    createTO,
    updateTOLine,
    updateTOLineNote,
    updateTOHeader,
    sendTO,
    discardDrafts,
    cancelTO,
    saveTOEdits,
    fetchHistory,
    fetchTODetail,
    fetchPendingTRs,
    addTOLine,
    deleteTOLine,
    restoreTOLine,
  };
}
