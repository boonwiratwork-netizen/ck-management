import { useState, useCallback, useEffect, useRef } from "react";
import { StockCountSession, StockCountLine } from "@/types/stock-count";
import { StockBalance, StockAdjustment } from "@/types/stock";
import { SMStockBalance } from "@/hooks/use-sm-stock-data";
import { SKU } from "@/types/sku";
import { countsInKitchenSheet } from "@/lib/kitchen-count-items";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { toLocalDateStr } from "@/lib/utils";
import { fetchAllRows } from "@/lib/fetch-all";
import type { CountTiming } from "@/lib/count-anchor";
import { writeManyOrEach, type BulkResult } from "@/lib/bulk-write";
import { NO_ANSWER, noAnswer, writeError, writeTimeout } from "@/lib/write-timeout";


const toSession = (r: any): StockCountSession => ({
  id: r.id,
  date: r.count_date,
  note: r.note,
  status: r.status,
  createdAt: r.created_at,
  completedAt: r.completed_at ?? undefined,
  deletedAt: r.deleted_at ?? undefined,
});
const toLine = (r: any): StockCountLine => ({
  id: r.id,
  sessionId: r.session_id,
  skuId: r.sku_id,
  type: r.type,
  systemQty: r.system_qty,
  physicalQty: r.physical_qty,
  variance: r.variance,
  note: r.note,
});

/** The session a count adjustment belongs to, at the end of its reason (still "Stock Count …" to every reader) */
const countTag = (sessionId: string) => `[count ${sessionId}]`;

/**
 * The count's RM/PK stock adjustments. SM uses anchor-based balance (physical_qty in
 * stock_count_lines is the anchor): writing a Stock Count adjustment for SM would cause
 * double-counting when the anchor path filters it out, and overcounting if the anchor is deleted.
 */
function countAdjustments(lines: any[], date: string, sessionId: string): { type: string; adj: Omit<StockAdjustment, "id"> }[] {
  return lines
    .filter((line) => line.type === "RM" || line.type === "PK")
    .map((line) => ({ type: line.type as string, adj: { skuId: line.sku_id, date, quantity: line.variance, reason: `Stock Count ${date}${line.note ? ": " + line.note : ""} ${countTag(sessionId)}` } }));
}

/**
 * Completion stamps (completed_at) this device sent, per session, kept on the device: a session
 * found Completed with one of them was completed by this device (an earlier press whose lock
 * landed after it stopped waiting), so its missing adjustments are this device's to write.
 * Clocks are never compared.
 */
const STAMPS_KEY = "ck-count-completions";
function readStamps(): Record<string, string[]> {
  try {
    return JSON.parse(localStorage.getItem(STAMPS_KEY) || "{}");
  } catch {
    return {};
  }
}
function rememberStamp(sessionId: string, stamp: string) {
  const all = readStamps();
  all[sessionId] = [...(all[sessionId] ?? []), stamp];
  try {
    localStorage.setItem(STAMPS_KEY, JSON.stringify(all));
  } catch {
    // storage blocked: only this page's memory of it is lost
  }
}
function forgetStamps(sessionId: string) {
  const all = readStamps();
  delete all[sessionId];
  try {
    localStorage.setItem(STAMPS_KEY, JSON.stringify(all));
  } catch {
    // nothing to forget
  }
}

interface UseStockCountDataProps {
  enabled?: boolean;
  skus: SKU[];
  rmStockBalances: StockBalance[];
  smStockBalances: SMStockBalance[];
  pkStockBalances: StockBalance[];
  /** One adjustment; false = not saved (anything else counts as saved, as before) */
  addRmAdjustment: (adj: Omit<StockAdjustment, "id">) => void | Promise<unknown>;
  addSmAdjustment: (adj: Omit<StockAdjustment, "id">) => void | Promise<unknown>;
  addPkAdjustment: (adj: Omit<StockAdjustment, "id">) => void | Promise<unknown>;
  /** Many at once (one request); without them each line is written on its own, one after another */
  addRmAdjustments?: (adjs: Omit<StockAdjustment, "id">[]) => Promise<BulkResult>;
  addPkAdjustments?: (adjs: Omit<StockAdjustment, "id">[]) => Promise<BulkResult>;
  getStdUnitPrice: (skuId: string) => number;
  refreshSmStock?: () => Promise<void>;
}

export function useStockCountData({
  skus,
  rmStockBalances,
  smStockBalances,
  pkStockBalances,
  addRmAdjustment,
  addSmAdjustment,
  addPkAdjustment,
  addRmAdjustments,
  addPkAdjustments,
  getStdUnitPrice,
  refreshSmStock,
  enabled = true,
}: UseStockCountDataProps) {
  const [sessions, setSessions] = useState<StockCountSession[]>([]);
  const [lines, setLines] = useState<StockCountLine[]>([]);
  /** Count saves still on their way (a refresh waits for them) */
  const pendingSaves = useRef(new Set<Promise<unknown>>());

  useEffect(() => {
    // Kitchen data loads only once a kitchen page is opened (see Index)
    if (!enabled) return;
    Promise.all([
      supabase
        .from("stock_count_sessions")
        .select("*")
        .is("deleted_at", null)
        .order("created_at", { ascending: false }),
      // Paged: every count adds ~224 lines (3,900+ now); one read stops at 1,000
      fetchAllRows<any>((f, t) => supabase.from("stock_count_lines").select("*").order("created_at", { ascending: false }).order("id").range(f, t)),
    ]).then(([s, l]) => {
      if (!s.error) setSessions((s.data || []).map(toSession));
      if (!l.error) setLines((l.data || []).map(toLine));
    });
  }, [enabled]);

  /**
   * RM and PK adjustments, each type in one insert when the bulk writers are there; a refused
   * insert is written again row by row. Returns the ones not known to be in (empty = all in).
   */
  const writeAdjustments = useCallback(
    async (rows: { type: string; adj: Omit<StockAdjustment, "id"> }[]): Promise<Omit<StockAdjustment, "id">[]> => {
      const rm = rows.filter((r) => r.type === "RM").map((r) => r.adj);
      const pk = rows.filter((r) => r.type === "PK").map((r) => r.adj);
      return (await Promise.all([writeManyOrEach(rm, addRmAdjustments, addRmAdjustment), writeManyOrEach(pk, addPkAdjustments, addPkAdjustment)])).flat();
    },
    [addRmAdjustments, addPkAdjustments, addRmAdjustment, addPkAdjustment],
  );
  const nameOf = useCallback((skuId: string) => skus.find((s) => s.id === skuId)?.name ?? skuId, [skus]);

  /** SM stock again in the background (a new count is its anchor); a failed read says so */
  const refreshSmInBackground = useCallback(() => {
    if (!refreshSmStock) return;
    refreshSmStock().catch(() => toast.error("โหลดสต๊อก SM ใหม่ไม่สำเร็จ ตัวเลข SM ที่เห็นอาจยังไม่รวมการนับนี้ รีเฟรชหน้า"));
  }, [refreshSmStock]);

  const createSession = useCallback(
    async (date: string, note: string): Promise<string> => {
      // Which products the sheet holds is read beside the "already there?" check (it used
      // to wait for the new session first: two rounds in a row)
      const recipes = Promise.all([
        supabase.from("bom_headers").select("sm_sku_id"),
        supabase.from("bom_lines").select("rm_sku_id"),
        supabase.from("bom_byproducts").select("sku_id, tracks_inventory"),
      ]);
      const { data: existing } = await supabase
        .from("stock_count_sessions")
        .select("id")
        .eq("count_date", date)
        .is("deleted_at", null)
        .maybeSingle();
      if (existing) {
        toast.info("A count session already exists for this date");
        return existing.id;
      }

      const { data: sessionRow, error } = await supabase
        .from("stock_count_sessions")
        .insert({
          count_date: date,
          note,
          status: "Draft",
        })
        .select()
        .single();
      if (error) {
        toast.error("สร้างรอบนับไม่สำเร็จ: " + error.message);
        return "";
      }

      const id = sessionRow.id;

      const [bomHeaderRes, bomLineRes, byproductRes] = await recipes;
      const smWithBom = new Set((bomHeaderRes.data || []).map((h: any) => h.sm_sku_id));
      const rmInBom = new Set((bomLineRes.data || []).map((l: any) => l.rm_sku_id));
      const trackedByproducts = new Set((byproductRes.data || []).filter((b: any) => b.tracks_inventory && b.sku_id).map((b: any) => b.sku_id as string));

      const activeSkus = skus.filter((s) => countsInKitchenSheet(s, { smWithBom, rmInBom, trackedByproducts }));

      const newLines = activeSkus.map((sku) => {
        let systemQty = 0;
        if (sku.type === "RM") {
          systemQty = rmStockBalances.find((b) => b.skuId === sku.id)?.currentStock ?? 0;
        } else if (sku.type === "SM") {
          systemQty = smStockBalances.find((b) => b.skuId === sku.id)?.currentStock ?? 0;
        } else if (sku.type === "PK") {
          systemQty = pkStockBalances.find((b) => b.skuId === sku.id)?.currentStock ?? 0;
        }
        return {
          session_id: id,
          sku_id: sku.id,
          type: sku.type as string,
          system_qty: systemQty,
          physical_qty: null as number | null,
          variance: 0,
          note: "",
        };
      });

      if (newLines.length > 0) {
        const { data: insertedLines, error: lineError } = await supabase
          .from("stock_count_lines")
          .insert(newLines)
          .select();
        if (lineError) {
          toast.error("สร้างรายการนับไม่สำเร็จ: " + lineError.message);
        }
        if (insertedLines) setLines((prev) => [...insertedLines.map(toLine), ...prev]);
      }

      setSessions((prev) => [toSession(sessionRow), ...prev]);
      return id;
    },
    [skus, rmStockBalances, smStockBalances, pkStockBalances],
  );

  const updateLine = useCallback(
    async (lineId: string, physicalQty: number | null, noteText?: string) => {
      const line = lines.find((l) => l.id === lineId);
      if (!line) return;
      const variance = physicalQty !== null ? physicalQty - line.systemQty : 0;
      const updates: any = { physical_qty: physicalQty, variance };
      if (noteText !== undefined) updates.note = noteText;

      const req = Promise.resolve(supabase.from("stock_count_lines").update(updates).eq("id", lineId));
      pendingSaves.current.add(req);
      const { error } = await req;
      pendingSaves.current.delete(req);
      if (error) {
        toast.error("แก้รายการไม่สำเร็จ: " + error.message);
        return;
      }
      setLines((prev) =>
        prev.map((l) =>
          l.id === lineId
            ? {
                ...l,
                physicalQty,
                variance,
                note: noteText !== undefined ? noteText : l.note,
              }
            : l,
        ),
      );
    },
    [lines],
  );

  /**
   * The session is Completed already. Completed by THIS device (its stamp is one this device
   * sent: an earlier press whose lock landed after it stopped waiting) = its RM/PK adjustments
   * were never written: the missing ones are written now (compared by session tag, never twice).
   * Completed by another device = that device writes them; nothing is written here.
   */
  const alreadyCompleted = useCallback(
    async (sessionId: string, date: string, dbLines: any[]): Promise<boolean | "partial"> => {
      const { data: now, error } = await supabase.from("stock_count_sessions").select("status, completed_at").eq("id", sessionId).abortSignal(writeTimeout()).maybeSingle();
      if (error || !now) {
        toast.error("ตรวจรอบนับไม่ได้: " + writeError(error ?? { code: "", message: "" }));
        return false;
      }
      if (now.status !== "Completed") {
        toast.info("รอบนับนี้ยืนยันไม่ได้แล้ว (ถูกลบหรือเปลี่ยนไป) กลับไปหน้าแรกแล้วเปิดใหม่");
        return false;
      }
      const markDone = () => setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, status: "Completed" as const, completedAt: now.completed_at ?? s.completedAt } : s)));
      const mine = !!now.completed_at && (readStamps()[sessionId] ?? []).some((st) => Date.parse(st) === Date.parse(now.completed_at!));
      if (!mine) {
        markDone();
        toast.info("รอบนับนี้ยืนยันจากอีกเครื่องไปแล้ว ไม่ต้องกดซ้ำ");
        return false;
      }
      const want = countAdjustments(dbLines.filter((l) => l.physical_qty !== null && l.variance !== 0), date, sessionId);
      const { data: saved, error: readErr } = await supabase
        .from("stock_adjustments")
        .select("sku_id, reason")
        .is("branch_id", null)
        .eq("adjustment_date", date)
        .like("reason", `Stock Count ${date}%`)
        .abortSignal(writeTimeout());
      if (readErr) {
        toast.error("ตรวจการปรับสต๊อกของรอบนับนี้ไม่ได้ ลองอีกครั้ง: " + writeError(readErr));
        return false;
      }
      // This session's rows by their tag; an untagged row (written before the tag) by its whole reason
      const tag = ` ${countTag(sessionId)}`;
      const have = new Set(
        (saved || [])
          .filter((a) => a.reason.endsWith(tag) || !a.reason.includes("[count "))
          .map((a) => `${a.sku_id}|${a.reason.endsWith(tag) ? a.reason.slice(0, -tag.length) : a.reason}`),
      );
      const toWrite = want.filter((w) => !have.has(`${w.adj.skuId}|${w.adj.reason.slice(0, -tag.length)}`));
      const missing = await writeAdjustments(toWrite);
      markDone();
      if (toWrite.length) refreshSmInBackground();
      if (missing.length) {
        toast.error(`นับเสร็จแล้ว แต่ปรับสต๊อกไม่ได้ ${missing.length} รายการ: ${missing.map((a) => nameOf(a.skuId)).join(", ")} · แจ้งผู้ดูแลระบบ อย่ากดนับซ้ำ`, { duration: 20000 });
        return "partial";
      }
      forgetStamps(sessionId);
      toast.info(toWrite.length ? `รอบนับนี้ยืนยันไปแล้ว ปรับสต๊อกที่ยังขาด ${toWrite.length} รายการให้แล้ว` : "รอบนับนี้ยืนยันไปแล้ว");
      return true;
    },
    [writeAdjustments, refreshSmInBackground, nameOf],
  );

  const confirmSession = useCallback(
    async (sessionId: string, timing?: CountTiming | null, systemAt?: Record<string, number>) => {
      const session = sessions.find((s) => s.id === sessionId);
      if (!session || session.status === "Completed") return;

      // Read the lines first (from the database, not React state): a failed read must never
      // leave a session marked done without its stock adjustments
      const { data: dbLines, error: linesError } = await supabase
        .from("stock_count_lines")
        .select("*")
        .eq("session_id", sessionId)
        .abortSignal(writeTimeout());

      if (linesError) {
        toast.error("โหลดรายการนับไม่สำเร็จ ยังไม่ได้นับเสร็จ ลองอีกครั้ง: " + writeError(linesError));
        return false;
      }

      // DB-level lock — atomically set status to Completed only if still Draft
      const completedAt = new Date().toISOString();
      // Remembered before it is sent: it may land without an answer (alreadyCompleted)
      rememberStamp(sessionId, completedAt);
      const { data: lockResult, error: lockError } = await supabase
        .from("stock_count_sessions")
        .update({
          status: "Completed",
          completed_at: completedAt,
          // Whether the count day's movements were already in the count (count-anchor.ts)
          ...(timing ? { count_timing: timing } : {}),
        })
        .eq("id", sessionId)
        .eq("status", "Draft")
        .select()
        .abortSignal(writeTimeout());

      if (lockError) {
        if (!noAnswer(lockError)) {
          toast.error("ยืนยันรอบนับไม่สำเร็จ: " + lockError.message);
          return false;
        }
        // No answer: read it back. Completed with our own completed_at = our lock landed, so its
        // adjustments are written now (else the session would be done without them)
        const { data: now, error: readErr } = await supabase.from("stock_count_sessions").select("status, completed_at").eq("id", sessionId).abortSignal(writeTimeout()).maybeSingle();
        if (readErr || !now) {
          toast.error(NO_ANSWER);
          return false;
        }
        if (now.status !== "Completed") {
          toast.error("ระบบไม่ตอบ ยังไม่ได้นับเสร็จ ลองกดอีกครั้ง");
          return false;
        }
        if (!now.completed_at || Date.parse(now.completed_at) !== Date.parse(completedAt)) return alreadyCompleted(sessionId, session.date, dbLines || []);
      } else if (!lockResult || lockResult.length === 0) {
        // Already completed — possibly by an earlier press whose lock landed after it gave up:
        // then its adjustments were never written; write whichever are missing
        return alreadyCompleted(sessionId, session.date, dbLines || []);
      }

      // The system figure as it stood when counting (count-anchor.ts systemAtCount),
      // read fresh from the database just before: saved now that the count is ours,
      // so the differences recorded are fair. A failed save keeps the old figures.
      if (systemAt) {
        const changed = (dbLines || []).filter((l: any) => systemAt[l.sku_id] !== undefined && systemAt[l.sku_id] !== Number(l.system_qty));
        for (const l of changed as any[]) {
          l.system_qty = systemAt[l.sku_id];
          l.variance = l.physical_qty !== null ? Number(l.physical_qty) - l.system_qty : 0;
        }
        const results = await Promise.all(changed.map((l: any) => supabase.from("stock_count_lines").update({ system_qty: l.system_qty, variance: l.variance }).eq("id", l.id).abortSignal(writeTimeout())));
        if (results.some((res) => res.error)) toast.error("บันทึกยอดระบบตอนนับไม่ครบ ตัวเลขต่างบางตัวอาจคลาด");
        const byId = new Map((changed as any[]).map((l) => [l.id, l]));
        setLines((prev) => prev.map((l) => (byId.has(l.id) ? { ...l, systemQty: byId.get(l.id).system_qty, variance: byId.get(l.id).variance } : l)));
      }

      const freshLines = (dbLines || [])
        .filter((l: any) => l.physical_qty !== null && l.variance !== 0);

      // RM/PK: one insert per type (was one request per counted line, ~150 in a row)
      const missing = await writeAdjustments(countAdjustments(freshLines, session.date, sessionId));
      if (!missing.length) forgetStamps(sessionId);

      // Update local state
      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId ? { ...s, status: "Completed" as const, completedAt: new Date().toISOString() } : s,
        ),
      );

      // Fix 3: Refresh SM stock so balance recalculates with new anchor — in the background:
      // the count is saved, the button doesn't wait for a re-read of every production record
      refreshSmInBackground();
      if (missing.length) {
        // The count is finished, but these products' stock didn't move to it: never "done"
        toast.error(`นับเสร็จแล้ว แต่ปรับสต๊อกไม่ได้ ${missing.length} รายการ: ${missing.map((a) => nameOf(a.skuId)).join(", ")} · แจ้งผู้ดูแลระบบ อย่ากดนับซ้ำ`, { duration: 20000 });
        return "partial" as const;
      }
      return true;
    },
    [sessions, writeAdjustments, refreshSmInBackground, nameOf, alreadyCompleted],
  );

  const softDeleteSession = useCallback(
    async (sessionId: string) => {
      const session = sessions.find((s) => s.id === sessionId);
      if (!session) return false;

      let missing: Omit<StockAdjustment, "id">[] = [];
      if (session.status === "Completed") {
        // SM uses anchor — no Stock Count adjustment was written, so no reversal needed
        const reversals = lines.filter((l) => l.sessionId === sessionId && l.variance !== 0 && l.physicalQty !== null && (l.type === "RM" || l.type === "PK"));
        missing = await writeAdjustments(
          reversals
            .map((line) => ({
              type: line.type,
              adj: {
                skuId: line.skuId,
                date: toLocalDateStr(new Date()),
                quantity: -line.variance,
                // Starts with "Stock Count" so every balance formula leaves it out, like the count adjustment it undoes
                reason: `Stock Count reversed: ${session.date}`,
              },
            })),
        );
        // Nothing undone: the count stays and trying again is safe. Some undone: it goes ahead
        // (trying again would undo those twice) and the rest are named for a person to fix
        if (missing.length && missing.length === reversals.length) {
          toast.error("ลบใบนับไม่ได้ คืนยอดสต๊อกไม่ได้ ลองอีกครั้ง");
          return false;
        }
      }

      const now = new Date().toISOString();
      const { error } = await supabase
        .from("stock_count_sessions")
        .update({
          deleted_at: now,
        })
        .eq("id", sessionId);
      if (error) {
        toast.error("ลบรอบนับไม่สำเร็จ: " + error.message);
        return false;
      }

      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      setLines((prev) => prev.filter((l) => l.sessionId !== sessionId));

      refreshSmInBackground();
      if (missing.length) {
        toast.error(`ลบใบนับแล้ว แต่คืนยอดไม่ได้ ${missing.length} รายการ: ${missing.map((a) => nameOf(a.skuId)).join(", ")} · แจ้งผู้ดูแลระบบ`, { duration: 20000 });
        return "partial" as const;
      }
      return true;
    },
    [sessions, lines, writeAdjustments, refreshSmInBackground, nameOf],
  );

  /**
   * "อัปเดตยอดระบบ": a draft made before the count day holds old system figures;
   * bring them to the current balances. Only system_qty and variance are written,
   * against counts read fresh from the database (after any count still saving),
   * so a count typed here or on another screen is never overwritten.
   */
  const refreshSystemQty = useCallback(
    async (sessionId: string): Promise<boolean> => {
      const session = sessions.find((s) => s.id === sessionId);
      if (!session || session.status !== "Draft") return false;
      await Promise.all(pendingSaves.current);
      const balanceOf = (type: string, skuId: string) =>
        (type === "RM" ? rmStockBalances : type === "SM" ? smStockBalances : type === "PK" ? pkStockBalances : []).find((b) => b.skuId === skuId)?.currentStock ?? 0;
      const { data: fresh, error: readErr } = await supabase.from("stock_count_lines").select("id, sku_id, type, physical_qty").eq("session_id", sessionId);
      if (readErr || !fresh) {
        toast.error("อัปเดตยอดระบบไม่ได้: " + (readErr?.message ?? ""));
        return false;
      }
      const rows = fresh.map((l) => {
        const systemQty = balanceOf(l.type, l.sku_id);
        return { id: l.id, system_qty: systemQty, variance: l.physical_qty !== null ? Number(l.physical_qty) - systemQty : 0 };
      });
      const results = await Promise.all(rows.map((r) => supabase.from("stock_count_lines").update({ system_qty: r.system_qty, variance: r.variance }).eq("id", r.id)));
      const failed = results.find((r) => r.error);
      if (failed?.error) {
        toast.error("อัปเดตยอดระบบไม่ครบ: " + failed.error.message);
        return false;
      }
      const byId = new Map(rows.map((r) => [r.id, r]));
      setLines((prev) => prev.map((l) => (byId.has(l.id) ? { ...l, systemQty: byId.get(l.id)!.system_qty, variance: byId.get(l.id)!.variance } : l)));
      return true;
    },
    [sessions, rmStockBalances, smStockBalances, pkStockBalances],
  );

  const getLinesForSession = useCallback(
    (sessionId: string) => lines.filter((l) => l.sessionId === sessionId),
    [lines],
  );

  return { sessions, lines, createSession, updateLine, confirmSession, softDeleteSession, getLinesForSession, refreshSystemQty };
}
