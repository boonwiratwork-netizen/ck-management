import { useCallback, useEffect, useRef, useState } from "react";
import { fetchAllRows } from "@/lib/fetch-all";
import { supabase } from "@/integrations/supabase/client";
import type { SKU } from "@/types/sku";
import type { TOLine } from "@/hooks/use-transfer-order";
import { kitchenStockForSkus } from "@/lib/kitchen-stock";
import { packsOf, reconcileLots, visibleRecords, type LotLine, type ProdRecord } from "@/lib/transfer-lines";
import { toast } from "sonner";

interface SavedRow {
  id: string;
  packs: number;
}

/**
 * Kitchen stock and production lots for the order being packed. Lots are SM-only
 * and traceability-only (nothing reads them for stock). A line with no saved lot
 * is filled from the oldest lot still in the kitchen; changing the packs moves
 * the lots with it.
 *
 * Saving: the screen keeps what each line SHOULD have; a per-line queue writes the
 * difference against what the database HAS (by production lot), always using the
 * latest wish — so quick taps can never insert a lot twice or leave a dropped one
 * behind. With `deferWrites` (editing a sent order) nothing is written until
 * `commit()`, so backing out leaves the order as it was.
 */
export function useTransferLots(toId: string | null, lines: TOLine[], skus: SKU[], deferWrites = false) {
  const [stock, setStock] = useState<Record<string, number>>({});
  const [records, setRecords] = useState<Record<string, ProdRecord[]>>({});
  const [lots, setLots] = useState<Record<string, LotLine[]>>({});
  const [loading, setLoading] = useState(false);
  const lotsRef = useRef(lots);
  const recordsRef = useRef(records);
  const stockRef = useRef(stock);
  /** What the database holds per line: production record → its rows */
  const savedRef = useRef<Record<string, Map<string, SavedRow[]>>>({});
  const chains = useRef<Record<string, Promise<void>>>({});
  const dirty = useRef<Set<string>>(new Set());
  /** Lines whose last save didn't fully land; retried before sending */
  const unsynced = useRef<Set<string>>(new Set());
  const toIdRef = useRef(toId);
  toIdRef.current = toId;
  const filled = useRef<Set<string>>(new Set());
  /** Lines changed while a reload was on its way (their screen state wins) */
  const touched = useRef<Set<string>>(new Set());
  const deferRef = useRef(deferWrites);
  deferRef.current = deferWrites;

  const skuOf = useCallback((id: string) => skus.find((s) => s.id === id), [skus]);
  const isLotLine = useCallback(
    (skuId: string) => {
      const s = skuOf(skuId);
      // RM and PK carry a pack size too — only real SM items have production lots
      return s?.type === "SM" && (s.packSize ?? 0) > 0;
    },
    [skuOf],
  );

  /** Bring the database to the line's latest wish (runs one at a time per line) */
  const persist = useCallback((lineId: string) => {
    const run = async () => {
      // Packing writes only to an unsent order (another screen may have sent it)
      if (!deferRef.current && toIdRef.current) {
        const { data } = await supabase.from("transfer_orders").select("status").eq("id", toIdRef.current).maybeSingle();
        if (data && data.status !== "Draft") return;
      }
      let bad = false;
      const want = lotsRef.current[lineId] || [];
      const have = savedRef.current[lineId] || new Map<string, SavedRow[]>();
      const next = new Map<string, SavedRow[]>();
      for (const lot of want) {
        const key = lot.productionRecordId;
        const rows = have.get(key) || [];
        const row = { production_record_id: key || null, production_date: lot.productionDate, packs: lot.packs, pack_weight_g: lot.packWeightG };
        if (rows.length) {
          // One row per lot: update the first, drop any extra copies
          let packs = rows[0].packs;
          if (rows[0].packs !== lot.packs) {
            const { error } = await supabase.from("transfer_order_lot_lines").update(row).eq("id", rows[0].id);
            if (error) bad = true;
            else packs = lot.packs;
          }
          const kept = [{ id: rows[0].id, packs }];
          for (const extra of rows.slice(1)) {
            const { error } = await supabase.from("transfer_order_lot_lines").delete().eq("id", extra.id);
            if (error) {
              bad = true;
              kept.push(extra);
            }
          }
          next.set(key, kept);
        } else {
          const { data, error } = await supabase.from("transfer_order_lot_lines").insert({ ...row, to_line_id: lineId }).select("id").single();
          if (error || !data) bad = true;
          else next.set(key, [{ id: data.id, packs: lot.packs }]);
        }
      }
      for (const [key, rows] of have) {
        if (next.has(key)) continue;
        for (const r of rows) {
          const { error } = await supabase.from("transfer_order_lot_lines").delete().eq("id", r.id);
          if (error) {
            bad = true;
            next.set(key, rows);
          }
        }
      }
      savedRef.current = { ...savedRef.current, [lineId]: next };
      if (bad) {
        unsynced.current.add(lineId);
        toast.error("บันทึกล็อตไม่ได้บางรายการ จะลองใหม่ตอนส่ง");
      } else unsynced.current.delete(lineId);
    };
    const p = (chains.current[lineId] || Promise.resolve()).then(run, run);
    chains.current[lineId] = p;
    return p;
  }, []);

  const apply = useCallback(
    (lineId: string, next: LotLine[]) => {
      lotsRef.current = { ...lotsRef.current, [lineId]: next };
      setLots(lotsRef.current);
      touched.current.add(lineId);
      if (deferRef.current) dirty.current.add(lineId);
      else persist(lineId);
    },
    [persist],
  );

  /** Wait for every lot save, retrying lines that didn't land; false if one still hasn't */
  const settle = useCallback(async () => {
    await Promise.all(Object.values(chains.current));
    for (const id of [...unsynced.current]) persist(id);
    await Promise.all(Object.values(chains.current));
    return unsynced.current.size === 0;
  }, [persist]);

  /** Editing a sent order: write the lot changes now (with its save button) */
  const commit = useCallback(async () => {
    for (const id of dirty.current) persist(id);
    dirty.current.clear();
    return settle();
  }, [persist, settle]);

  const visibleFor = useCallback(
    (lineId: string, skuId: string) =>
      visibleRecords(recordsRef.current[skuId] || [], stockRef.current[skuId], new Set((lotsRef.current[lineId] || []).map((l) => l.productionRecordId).filter(Boolean))),
    [],
  );

  // ─── Load: records + stock + saved lots, then fill lines that have none ───
  const skuKey = [...new Set(lines.map((l) => l.skuId))].sort().join(",");
  const lineKey = lines.map((l) => l.id).sort().join(",");
  const linesRef = useRef(lines);
  linesRef.current = lines;
  useEffect(() => {
    if (!toId || !lineKey) {
      lotsRef.current = {};
      setLots({});
      return;
    }
    let stale = false;
    setLoading(true);
    // Edits from here on are newer than what this reload will read
    touched.current = new Set();
    (async () => {
      // Saves still on their way must land first, or the reload would miss them
      await Promise.all(Object.values(chains.current));
      if (stale) return;
      const skuIds = skuKey.split(",").filter(Boolean);
      const smIds = skuIds.filter(isLotLine);
      const [prodRes, stockMap, lotRes, takenRes] = await Promise.all([
        // Paged: every SM's runs since March add up past the 1,000-row cap
        smIds.length
          ? fetchAllRows<{ id: string; sm_sku_id: string; production_date: string; actual_output_g: number; batches_produced: number }>((a, b) =>
              supabase.from("production_records").select("id, sm_sku_id, production_date, actual_output_g, batches_produced").in("sm_sku_id", smIds).order("production_date", { ascending: true }).order("id").range(a, b) as never,
            )
          : Promise.resolve({ data: [] as never[], error: null }),
        kitchenStockForSkus(skus, skuIds),
        supabase.from("transfer_order_lot_lines").select("id, to_line_id, production_record_id, production_date, packs, pack_weight_g").in("to_line_id", lineKey.split(",")).order("production_date").order("id"),
        fetchAllRows<{ to_line_id: string; production_record_id: string | null; packs: number; pack_weight_g: number }>((a, b) =>
          supabase.from("transfer_order_lot_lines").select("id, to_line_id, production_record_id, packs, pack_weight_g").order("id").range(a, b) as never,
        ),
      ]);
      if (stale) return;
      // What other orders already took from each lot (this order's own lines don't count)
      const thisOrder = new Set(lineKey.split(","));
      const taken = new Map<string, number>();
      for (const t of takenRes.data) {
        if (!t.production_record_id || thisOrder.has(t.to_line_id)) continue;
        taken.set(t.production_record_id, (taken.get(t.production_record_id) ?? 0) + (Number(t.packs) || 0) * (Number(t.pack_weight_g) || 0));
      }
      const bySku: Record<string, ProdRecord[]> = {};
      for (const r of prodRes.data || []) {
        const out = Number(r.actual_output_g) || 0;
        (bySku[r.sm_sku_id] ||= []).push({ id: r.id, productionDate: r.production_date, actualOutputG: out, batchesProduced: r.batches_produced, remainingG: out - (taken.get(r.id) ?? 0) });
      }
      // Saved lots, one entry per production lot (old duplicates are added up)
      const saved: Record<string, Map<string, SavedRow[]>> = {};
      const shown: Record<string, LotLine[]> = {};
      for (const r of lotRes.data || []) {
        const key = r.production_record_id || "";
        const m = (saved[r.to_line_id] ||= new Map());
        m.set(key, [...(m.get(key) || []), { id: r.id, packs: r.packs }]);
        const list = (shown[r.to_line_id] ||= []);
        const same = list.find((l) => l.productionRecordId === key);
        if (same) same.packs += r.packs;
        else list.push({ id: r.id, productionRecordId: key, productionDate: r.production_date, packs: r.packs, packWeightG: Number(r.pack_weight_g) || 0 });
      }
      // A line edited while this was loading keeps the edit, and what its own
      // saves recorded (the query may have run before they landed)
      for (const id of new Set([...touched.current, ...dirty.current])) {
        shown[id] = lotsRef.current[id] || [];
        if (savedRef.current[id]) saved[id] = savedRef.current[id];
      }
      recordsRef.current = bySku;
      stockRef.current = stockMap;
      savedRef.current = saved;
      lotsRef.current = shown;
      setRecords(bySku);
      setStock(stockMap);
      setLots(shown);
      setLoading(false);
      for (const id of touched.current) if (!deferRef.current) persist(id);
      if (deferRef.current) return; // a sent order is never filled in on opening
      // Lines with no saved lot: fill from the oldest lot still in the kitchen (once)
      for (const l of linesRef.current) {
        if (!isLotLine(l.skuId) || (shown[l.id] || []).length || filled.current.has(l.id)) continue;
        const ps = skuOf(l.skuId)?.packSize ?? 0;
        const packs = packsOf(l, ps);
        const visible = visibleRecords(bySku[l.skuId] || [], stockMap[l.skuId], new Set());
        if (packs <= 0 || visible.length === 0) continue;
        filled.current.add(l.id);
        apply(l.id, reconcileLots([], visible, packs, ps).next);
      }
    })();
    return () => {
      stale = true;
    };
  }, [toId, skuKey, lineKey, skus.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // A different order starts clean
  useEffect(() => {
    filled.current = new Set();
    dirty.current = new Set();
    unsynced.current = new Set();
  }, [toId]);

  /** Packs on a line changed: move its lots with it */
  const followPacks = useCallback(
    (line: TOLine, packs: number) => {
      if (!isLotLine(line.skuId)) return;
      const ps = skuOf(line.skuId)?.packSize ?? 0;
      apply(line.id, reconcileLots(lotsRef.current[line.id] || [], visibleFor(line.id, line.skuId), packs, ps).next);
    },
    [isLotLine, skuOf, visibleFor, apply],
  );

  /** Set how many packs come from one production lot (0 takes it off) */
  const setLotPacks = useCallback(
    (lineId: string, skuId: string, record: ProdRecord, packs: number) => {
      const ps = skuOf(skuId)?.packSize ?? 0;
      const current = lotsRef.current[lineId] || [];
      const existing = current.find((l) => l.productionRecordId === record.id);
      let next: LotLine[];
      if (existing) next = packs <= 0 ? current.filter((l) => l !== existing) : current.map((l) => (l === existing ? { ...l, packs } : l));
      else if (packs > 0) next = [...current, { productionRecordId: record.id, productionDate: record.productionDate, packs, packWeightG: ps }];
      else return;
      apply(lineId, next);
    },
    [skuOf, apply],
  );

  /** "เติมจากล็อตเก่าสุดให้ครบ": top up (or trim) to the line's packs */
  const fillToPacks = useCallback((line: TOLine, packs: number) => followPacks(line, packs), [followPacks]);

  return { stock, records, lots, loading, isLotLine, visibleFor, followPacks, setLotPacks, fillToPacks, settle, commit };
}
