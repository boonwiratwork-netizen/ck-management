import { useState, useCallback, useEffect } from "react";
import { StockCountSession, StockCountLine } from "@/types/stock-count";
import { StockBalance, StockAdjustment } from "@/types/stock";
import { SMStockBalance } from "@/hooks/use-sm-stock-data";
import { SKU } from "@/types/sku";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { toLocalDateStr } from "@/lib/utils";

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

interface UseStockCountDataProps {
  skus: SKU[];
  rmStockBalances: StockBalance[];
  smStockBalances: SMStockBalance[];
  addRmAdjustment: (adj: Omit<StockAdjustment, "id">) => void;
  addSmAdjustment: (adj: Omit<StockAdjustment, "id">) => void;
  getStdUnitPrice: (skuId: string) => number;
  refreshSmStock?: () => Promise<void>;
}

export function useStockCountData({
  skus,
  rmStockBalances,
  smStockBalances,
  addRmAdjustment,
  addSmAdjustment,
  getStdUnitPrice,
  refreshSmStock,
}: UseStockCountDataProps) {
  const [sessions, setSessions] = useState<StockCountSession[]>([]);
  const [lines, setLines] = useState<StockCountLine[]>([]);

  useEffect(() => {
    Promise.all([
      supabase
        .from("stock_count_sessions")
        .select("*")
        .is("deleted_at", null)
        .order("created_at", { ascending: false }),
      supabase.from("stock_count_lines").select("*").order("created_at", { ascending: false }),
    ]).then(([s, l]) => {
      if (!s.error) setSessions((s.data || []).map(toSession));
      if (!l.error) setLines((l.data || []).map(toLine));
    });
  }, []);

  const createSession = useCallback(
    async (date: string, note: string): Promise<string> => {
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
        toast.error("Failed to create session: " + error.message);
        return "";
      }

      const id = sessionRow.id;

      const [bomHeaderRes, bomLineRes] = await Promise.all([
        supabase.from("bom_headers").select("sm_sku_id"),
        supabase.from("bom_lines").select("rm_sku_id"),
      ]);
      const smWithBom = new Set((bomHeaderRes.data || []).map((h: any) => h.sm_sku_id));
      const rmInBom = new Set((bomLineRes.data || []).map((l: any) => l.rm_sku_id));

      const activeSkus = skus.filter((s) => {
        if (s.status !== "Active") return false;
        if (s.type === "RM") return rmInBom.has(s.id) || s.isDistributable === true;
        if (s.type === "SM") return smWithBom.has(s.id);
        if (s.type === "PK") return true;
        return false;
      });

      const newLines = activeSkus.map((sku) => {
        let systemQty = 0;
        if (sku.type === "RM") {
          systemQty = rmStockBalances.find((b) => b.skuId === sku.id)?.currentStock ?? 0;
        } else if (sku.type === "SM") {
          systemQty = smStockBalances.find((b) => b.skuId === sku.id)?.currentStock ?? 0;
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
          toast.error("Failed to create count lines: " + lineError.message);
        }
        if (insertedLines) setLines((prev) => [...insertedLines.map(toLine), ...prev]);
      }

      setSessions((prev) => [toSession(sessionRow), ...prev]);
      return id;
    },
    [skus, rmStockBalances, smStockBalances],
  );

  const updateLine = useCallback(
    async (lineId: string, physicalQty: number | null, noteText?: string) => {
      const line = lines.find((l) => l.id === lineId);
      if (!line) return;
      const variance = physicalQty !== null ? physicalQty - line.systemQty : 0;
      const updates: any = { physical_qty: physicalQty, variance };
      if (noteText !== undefined) updates.note = noteText;

      const { error } = await supabase.from("stock_count_lines").update(updates).eq("id", lineId);
      if (error) {
        toast.error("Failed to update line: " + error.message);
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

  const confirmSession = useCallback(
    async (sessionId: string) => {
      const session = sessions.find((s) => s.id === sessionId);
      if (!session || session.status === "Completed") return;

      // Fix 1: DB-level lock — atomically set status to Completed only if still Draft
      const { data: lockResult, error: lockError } = await supabase
        .from("stock_count_sessions")
        .update({
          status: "Completed",
          completed_at: new Date().toISOString(),
        })
        .eq("id", sessionId)
        .eq("status", "Draft")
        .select();

      if (lockError) {
        toast.error("Failed to confirm session: " + lockError.message);
        return;
      }
      if (!lockResult || lockResult.length === 0) {
        toast.info("Session already confirmed or no longer Draft");
        return;
      }

      // Fix 2: Read fresh lines from DB, not React state
      const { data: dbLines, error: linesError } = await supabase
        .from("stock_count_lines")
        .select("*")
        .eq("session_id", sessionId);

      if (linesError) {
        toast.error("Failed to fetch count lines: " + linesError.message);
        return;
      }

      const freshLines = (dbLines || [])
        .filter((l: any) => l.physical_qty !== null && l.variance !== 0);

      for (const line of freshLines) {
        const adj: Omit<StockAdjustment, "id"> = {
          skuId: line.sku_id,
          date: session.date,
          quantity: line.variance,
          reason: `Stock Count ${session.date}${line.note ? ": " + line.note : ""}`,
        };
        if (line.type === "RM") {
          await addRmAdjustment(adj);
        } else if (line.type === "SM") {
          await addSmAdjustment(adj);
        }
      }

      // Update local state
      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId ? { ...s, status: "Completed" as const, completedAt: new Date().toISOString() } : s,
        ),
      );

      // Fix 3: Refresh SM stock so balance recalculates with new anchor
      if (refreshSmStock) {
        await refreshSmStock();
      }
    },
    [sessions, addRmAdjustment, addSmAdjustment, refreshSmStock],
  );

  const softDeleteSession = useCallback(
    async (sessionId: string) => {
      const session = sessions.find((s) => s.id === sessionId);
      if (!session) return;

      if (session.status === "Completed") {
        const sessionLines = lines.filter((l) => l.sessionId === sessionId);
        for (const line of sessionLines) {
          if (line.variance === 0 || line.physicalQty === null) continue;
          const reverseAdj: Omit<StockAdjustment, "id"> = {
            skuId: line.skuId,
            date: toLocalDateStr(new Date()),
            quantity: -line.variance,
            reason: `Reversed: Stock Count ${session.date}`,
          };
          if (line.type === "RM") {
            await addRmAdjustment(reverseAdj);
          } else if (line.type === "SM") {
            await addSmAdjustment(reverseAdj);
          }
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
        toast.error("Failed to delete session: " + error.message);
        return;
      }

      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      setLines((prev) => prev.filter((l) => l.sessionId !== sessionId));

      if (refreshSmStock) {
        await refreshSmStock();
      }
    },
    [sessions, lines, addRmAdjustment, addSmAdjustment, refreshSmStock],
  );

  const getLinesForSession = useCallback(
    (sessionId: string) => lines.filter((l) => l.sessionId === sessionId),
    [lines],
  );

  return { sessions, lines, createSession, updateLine, confirmSession, softDeleteSession, getLinesForSession };
}
