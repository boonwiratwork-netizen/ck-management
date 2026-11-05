import { useCallback, useEffect, useRef, useState } from "react";
import { fetchAllRows } from "@/lib/fetch-all";
import { supabase } from "@/integrations/supabase/client";
import type { SKU } from "@/types/sku";
import type { TOLine } from "@/hooks/use-transfer-order";
import { kitchenStockForSkus } from "@/lib/kitchen-stock";
import { isUnknownLot, lotKey, packsOf, reconcileLots, visibleRecords, withUnknownLot, type LotLine, type ProdRecord } from "@/lib/transfer-lines";
import { newRowId, noAnswer, writeError, writeTimeout } from "@/lib/write-timeout";
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
  /** The stock/lot read failed: the screen says so (nothing below is filled from it) */
  const [error, setError] = useState<string | null>(null);
  const lotsRef = useRef(lots);
  const recordsRef = useRef(records);
  const stockRef = useRef(stock);
  /** What the database holds per line: production record → its rows */
  const savedRef = useRef<Record<string, Map<string, SavedRow[]>>>({});
  const chains = useRef<Record<string, Promise<void>>>({});
  const dirty = useRef<Set<string>>(new Set());
  /** Lines whose last save didn't fully land; retried before sending */
  const unsynced = useRef<Set<string>>(new Set());
  /** The same, for the screen: those lines say their lots aren't saved */
  const [unsaved, setUnsaved] = useState<Set<string>>(new Set());
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
        const { data, error } = await supabase.from("transfer_orders").select("status").eq("id", toIdRef.current).abortSignal(writeTimeout()).maybeSingle();
        if (error) {
          unsynced.current.add(lineId);
          setUnsaved(new Set(unsynced.current));
          toast.error("บันทึกล็อตไม่ได้: " + writeError(error));
          return;
        }
        if (data && data.status !== "Draft") return;
      }
      let failure = "";
      const fail = (why: string) => void (failure ||= why);
      /** The row is still there (a delete that answered 0 rows, or got no answer) */
      const stillThere = async (id: string) => {
        const { data, error } = await supabase.from("transfer_order_lot_lines").select("id").eq("id", id).abortSignal(writeTimeout()).maybeSingle();
        return !!error || !!data;
      };
      const remove = async (id: string) => {
        // .select("id"): a delete RLS refuses answers with no error and 0 rows
        const { data, error } = await supabase.from("transfer_order_lot_lines").delete().eq("id", id).select("id").abortSignal(writeTimeout());
        if (!error && data?.length === 1) return true;
        if ((error && !noAnswer(error)) || (await stillThere(id))) {
          fail(error ? writeError(error) : "ไม่มีสิทธิ์ลบล็อต");
          return false;
        }
        return true; // it's gone (landed without an answer, or already removed)
      };
      const want = lotsRef.current[lineId] || [];
      const have = savedRef.current[lineId] || new Map<string, SavedRow[]>();
      const next = new Map<string, SavedRow[]>();
      for (const lot of want) {
        const key = lotKey(lot);
        const rows = have.get(key) || [];
        const row = { production_record_id: lot.productionRecordId || null, production_date: lot.productionDate, packs: lot.packs, pack_weight_g: lot.packWeightG };
        if (rows.length) {
          // One row per lot: update the first, drop any extra copies
          let packs = rows[0].packs;
          if (rows[0].packs !== lot.packs) {
            const { data, error } = await supabase.from("transfer_order_lot_lines").update(row).eq("id", rows[0].id).select("id").abortSignal(writeTimeout());
            // 0 rows = refused or the row is gone: not saved (setting the same packs again is safe to retry)
            if (error) fail(writeError(error));
            else if (data?.length !== 1) fail("แก้ล็อตเดิมไม่ได้ (ไม่มีสิทธิ์ หรือถูกลบไปแล้ว)");
            else packs = lot.packs;
          }
          const kept = [{ id: rows[0].id, packs }];
          for (const extra of rows.slice(1)) if (!(await remove(extra.id))) kept.push(extra);
          next.set(key, kept);
        } else {
          // The id is made here so an insert that got no answer can be looked up (never inserted twice)
          const id = newRowId();
          const { data, error } = await supabase.from("transfer_order_lot_lines").insert({ ...row, id, to_line_id: lineId }).select("id").abortSignal(writeTimeout());
          let landed = !error && data?.length === 1;
          if (error && noAnswer(error)) {
            const back = await supabase.from("transfer_order_lot_lines").select("id").eq("id", id).abortSignal(writeTimeout()).maybeSingle();
            landed = !back.error && !!back.data;
          }
          if (landed) next.set(key, [{ id, packs: lot.packs }]);
          else fail(error ? writeError(error) : "บันทึกล็อตไม่ได้");
        }
      }
      for (const [key, rows] of have) {
        if (next.has(key)) continue;
        const left: SavedRow[] = [];
        for (const r of rows) if (!(await remove(r.id))) left.push(r);
        if (left.length) next.set(key, left);
      }
      savedRef.current = { ...savedRef.current, [lineId]: next };
      if (failure) {
        unsynced.current.add(lineId);
        toast.error(`บันทึกล็อตไม่ได้บางรายการ จะลองใหม่ตอนส่ง (${failure})`);
      } else unsynced.current.delete(lineId);
      setUnsaved(new Set(unsynced.current));
    };
    // A thrown write still ends the run: the line counts as not saved, the queue moves on
    const guarded = () =>
      run().catch(() => {
        unsynced.current.add(lineId);
        setUnsaved(new Set(unsynced.current));
        toast.error("บันทึกล็อตไม่ได้ จะลองใหม่ตอนส่ง");
      });
    const p = (chains.current[lineId] || Promise.resolve()).then(guarded, guarded);
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
    setError(null);
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
      // A failed read would show lots as all still there, or a line's saved lots as none (and
      // fill it again on top): say so and fill nothing
      const failedRead = prodRes.error || lotRes.error || takenRes.error;
      if (failedRead) throw failedRead;
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
        // "ไม่ทราบล็อต" and an old row with no record are different lots: keyed apart, never merged
        const lot = { productionRecordId: r.production_record_id || "", productionDate: r.production_date };
        const key = lotKey(lot);
        const m = (saved[r.to_line_id] ||= new Map());
        m.set(key, [...(m.get(key) || []), { id: r.id, packs: r.packs }]);
        const list = (shown[r.to_line_id] ||= []);
        const same = list.find((l) => lotKey(l) === key);
        if (same) same.packs += r.packs;
        else list.push({ id: r.id, ...lot, packs: r.packs, packWeightG: Number(r.pack_weight_g) || 0 });
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
    })().catch(() => {
      if (stale) return;
      setError("โหลดสต๊อกและล็อตในครัวไม่สำเร็จ ล็อตที่เห็นอาจไม่ครบ กลับแล้วเปิดใบนี้ใหม่");
      setLoading(false);
    });
    return () => {
      stale = true;
    };
  }, [toId, skuKey, lineKey, skus.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // A different order starts clean
  useEffect(() => {
    filled.current = new Set();
    dirty.current = new Set();
    unsynced.current = new Set();
    setUnsaved(new Set());
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

  /** "เติมจากล็อตเก่าสุดให้ครบ": top up (or trim) to the line's packs — real lots only, never "ไม่ทราบล็อต" */
  const fillToPacks = useCallback((line: TOLine, packs: number) => followPacks(line, packs), [followPacks]);

  /** "ไม่ทราบล็อต": a person puts the packs the line still lacks on the unknown lot */
  const markUnknown = useCallback(
    (line: TOLine, packs: number) => {
      if (!isLotLine(line.skuId)) return;
      const ps = skuOf(line.skuId)?.packSize ?? 0;
      const current = lotsRef.current[line.id] || [];
      const next = withUnknownLot(current, packs, ps);
      if (next !== current) apply(line.id, next);
    },
    [isLotLine, skuOf, apply],
  );

  /** Set the packs on the unknown lot (0 takes it off) */
  const setUnknownPacks = useCallback(
    (lineId: string, packs: number) => {
      const current = lotsRef.current[lineId] || [];
      const unknown = current.find(isUnknownLot);
      if (!unknown) return;
      apply(lineId, packs <= 0 ? current.filter((l) => l !== unknown) : current.map((l) => (l === unknown ? { ...l, packs } : l)));
    },
    [apply],
  );

  return { stock, records, lots, unsaved, loading, error, isLotLine, visibleFor, followPacks, setLotPacks, fillToPacks, markUnknown, setUnknownPacks, settle, commit };
}
