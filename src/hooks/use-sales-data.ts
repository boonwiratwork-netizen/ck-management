import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { fetchAllRows } from "@/lib/fetch-all";
import { toLocalDateStr } from "@/lib/utils";
import type { POSMappingProfile } from "@/hooks/use-sales-entry-data";
import { writeDay, type DayWrites, type ExistingRow, type SalesInsertRow, type SalesWriter } from "@/lib/sales-import";
import type { Tables } from "@/integrations/supabase/types";

/** A saved sales_entries row */
export interface SaleLine extends SalesInsertRow {
  id: string;
}

export interface DaySummary {
  lines: number;
  bills: number;
  total: number;
}

export interface ImportWrite extends DayWrites {
  date: string;
}

const CHUNK = 50;

const toProfile = (r: Tables<"pos_mapping_profiles">): POSMappingProfile => ({
  id: r.id,
  name: r.name,
  separator: r.separator as POSMappingProfile["separator"],
  hasHeaderRow: r.has_header_row,
  mappings: r.mappings as unknown as Record<string, number>,
  dateFormat: r.date_format,
});

const toLine = (r: Tables<"sales_entries">): SaleLine => ({
  id: r.id,
  branch_id: r.branch_id,
  sale_date: r.sale_date,
  receipt_no: r.receipt_no ?? "",
  menu_code: r.menu_code ?? "",
  menu_name: r.menu_name ?? "",
  order_type: r.order_type ?? "",
  qty: Number(r.qty),
  unit_price: Number(r.unit_price),
  net_amount: Number(r.net_amount),
  channel: r.channel ?? "",
});

// .select("id") so a delete RLS refuses (no error, 0 rows) is not taken as done
async function deleteIds(ids: string[]): Promise<string | null> {
  for (let i = 0; i < ids.length; i += 200) {
    const part = ids.slice(i, i + 200);
    const { data, error } = await supabase.from("sales_entries").delete().in("id", part).select("id");
    if (error) return error.message;
    if ((data?.length ?? 0) < part.length) return `ลบได้ ${data?.length ?? 0} จาก ${part.length} แถว (ไม่มีสิทธิ์ หรือถูกลบไปแล้ว)`;
  }
  return null;
}

const writer: SalesWriter = {
  insert: async (rows) => {
    const { data, error } = await supabase.from("sales_entries").insert(rows).select("id");
    return { ids: (data || []).map((r) => r.id), error: error?.message ?? null };
  },
  remove: deleteIds,
  update: async (id, patch) => {
    const { data, error } = await supabase.from("sales_entries").update(patch).eq("id", id).select("id");
    if (error) return error.message;
    return data?.length ? null : "แก้แถวเดิมไม่ได้ (ไม่มีสิทธิ์?)";
  },
};

/**
 * Sales of one branch: totals per day for the visible range, the lines of the open
 * day, and every write the page makes. All reads page past Supabase's 1,000-row cap.
 */
export function useSalesData({ branchId, from, to, day }: { branchId: string | null; from: string; to: string; day: string | null }) {
  const [days, setDays] = useState<Map<string, DaySummary>>(new Map());
  const [daysLoading, setDaysLoading] = useState(true);
  const [lines, setLines] = useState<SaleLine[]>([]);
  const [linesLoading, setLinesLoading] = useState(false);
  const [profiles, setProfiles] = useState<POSMappingProfile[]>([]);

  const loadProfiles = useCallback(async () => {
    const { data, error } = await supabase.from("pos_mapping_profiles").select("*").order("created_at", { ascending: true });
    if (!error) setProfiles((data || []).map(toProfile));
  }, []);
  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  const loadDays = useCallback(async () => {
    if (!branchId) return;
    setDaysLoading(true);
    const { data, error } = await fetchAllRows((a, b) =>
      supabase.from("sales_entries").select("sale_date,receipt_no,net_amount").eq("branch_id", branchId).gte("sale_date", from).lte("sale_date", to).order("id").range(a, b),
    );
    if (error) toast.error("โหลดยอดขายไม่สำเร็จ");
    const bills = new Map<string, Set<string>>();
    const out = new Map<string, DaySummary>();
    for (const r of data as { sale_date: string; receipt_no: string; net_amount: number }[]) {
      const d = out.get(r.sale_date) ?? { lines: 0, bills: 0, total: 0 };
      d.lines++;
      d.total += Number(r.net_amount) || 0;
      out.set(r.sale_date, d);
      if (!bills.has(r.sale_date)) bills.set(r.sale_date, new Set());
      bills.get(r.sale_date)!.add(r.receipt_no ?? "");
    }
    bills.forEach((s, d) => (out.get(d)!.bills = s.size));
    setDays(out);
    setDaysLoading(false);
  }, [branchId, from, to]);
  useEffect(() => {
    loadDays();
  }, [loadDays]);

  const loadLines = useCallback(async () => {
    if (!branchId || !day) {
      setLines([]);
      return;
    }
    setLinesLoading(true);
    const { data, error } = await fetchAllRows((a, b) =>
      supabase.from("sales_entries").select("*").eq("branch_id", branchId).eq("sale_date", day).order("receipt_no").order("created_at").order("id").range(a, b),
    );
    if (error) toast.error("โหลดรายการไม่สำเร็จ");
    setLines(data.map(toLine));
    setLinesLoading(false);
  }, [branchId, day]);
  useEffect(() => {
    loadLines();
  }, [loadLines]);

  /** What is already saved on these dates (for the check-before-save screen) */
  const existingOn = useCallback(
    async (dates: string[]): Promise<Map<string, ExistingRow[]> | null> => {
      const out = new Map<string, ExistingRow[]>();
      if (!branchId || !dates.length) return out;
      const { data, error } = await fetchAllRows((a, b) =>
        supabase.from("sales_entries").select("id,sale_date,receipt_no,menu_code,menu_name,net_amount,qty,unit_price,order_type,channel").eq("branch_id", branchId).in("sale_date", dates).order("id").range(a, b),
      );
      if (error) {
        toast.error("ตรวจข้อมูลเดิมไม่สำเร็จ ลองใหม่");
        return null;
      }
      for (const r of data as ExistingRow[]) out.set(r.sale_date, [...(out.get(r.sale_date) ?? []), { ...r, net_amount: Number(r.net_amount), qty: Number(r.qty), unit_price: Number(r.unit_price), order_type: r.order_type ?? "", channel: r.channel ?? "" }]);
      return out;
    },
    [branchId],
  );

  /**
   * This branch's coded lines of the last 90 days whose name contains one of these
   * bases (FoodStory names differ from CK menu names, so past lines teach the code).
   * One small read per base, at most 500 lines each; a failed read just teaches nothing.
   */
  const codeHistory = useCallback(
    async (bases: string[]): Promise<{ menu_code: string; menu_name: string }[]> => {
      if (!branchId || !bases.length) return [];
      const d = new Date();
      d.setDate(d.getDate() - 90);
      const since = toLocalDateStr(d);
      const reads = await Promise.all(
        bases.slice(0, 20).map(async (base) => {
          // Words in order, anything between: a prefilter only, the exact compare is in codeResolver
          const pattern = `%${base.replace(/[%\\]/g, "").split(/\s+/).filter(Boolean).join("%")}%`;
          const { data, error } = await supabase
            .from("sales_entries")
            .select("menu_code,menu_name")
            .eq("branch_id", branchId)
            .gte("sale_date", since)
            .neq("menu_code", "")
            .ilike("menu_name", pattern)
            .order("sale_date", { ascending: false })
            .order("id")
            .limit(500);
          return error ? [] : (data || []).map((r) => ({ menu_code: r.menu_code ?? "", menu_name: r.menu_name ?? "" }));
        }),
      );
      return reads.flat();
    },
    [branchId],
  );

  /**
   * Menus with a recipe at this branch (shared or this branch's menu_bom lines): a
   * no-code POS line is only matched by name to one of these. null = could not read.
   */
  const recipeMenuIds = useCallback(async (): Promise<Set<string> | null> => {
    if (!branchId) return null;
    const { data, error } = await fetchAllRows((a, b) => supabase.from("menu_bom").select("menu_id").or(`branch_id.is.null,branch_id.eq.${branchId}`).order("id").range(a, b));
    if (error) return null;
    return new Set((data as { menu_id: string }[]).map((r) => r.menu_id));
  }, [branchId]);

  /** Save the planned days, one day at a time (order and failure rules: writeDay) */
  const saveImport = useCallback(async (writes: ImportWrite[]): Promise<{ inserted: number; failedDay: string | null }> => {
    let inserted = 0;
    for (const w of writes) {
      const r = await writeDay(w, writer, CHUNK);
      inserted += r.saved;
      if (r.error) {
        toast.error(r.partial ? `วันที่ ${w.date} บันทึกไม่ครบ กดตรวจแล้วบันทึกใหม่อีกครั้ง เลือก “ใช้ข้อมูลนี้แทนทั้งวัน” (${r.error})` : `บันทึกวันที่ ${w.date} ไม่สำเร็จ: ${r.error}`, { duration: 15000 });
        return { inserted, failedDay: w.date };
      }
    }
    return { inserted, failedDay: null };
  }, []);

  /** Every line of these branches between two dates (history screen) */
  const fetchHistory = useCallback(async (branchIds: string[], dateFrom: string, dateTo: string): Promise<SaleLine[] | null> => {
    if (!branchIds.length) return [];
    const { data, error } = await fetchAllRows((a, b) =>
      supabase
        .from("sales_entries")
        .select("*")
        .in("branch_id", branchIds)
        .gte("sale_date", dateFrom)
        .lte("sale_date", dateTo)
        .order("sale_date", { ascending: false })
        .order("receipt_no")
        .order("id")
        .range(a, b),
    );
    if (error) {
      toast.error("โหลดประวัติยอดขายไม่สำเร็จ");
      return null;
    }
    return data.map(toLine);
  }, []);

  const addLine = useCallback(async (row: SalesInsertRow) => {
    const { error } = await supabase.from("sales_entries").insert(row);
    if (error) {
      toast.error("บันทึกไม่สำเร็จ: " + error.message);
      return false;
    }
    return true;
  }, []);

  const updateLine = useCallback(async (id: string, patch: Partial<Omit<SalesInsertRow, "branch_id" | "receipt_no">>) => {
    const { error } = await supabase.from("sales_entries").update(patch).eq("id", id);
    if (error) {
      toast.error("แก้ไขไม่สำเร็จ");
      return false;
    }
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
    return true;
  }, []);

  const deleteLines = useCallback(async (ids: string[]) => {
    const err = await deleteIds(ids);
    if (err) {
      toast.error("ลบไม่สำเร็จ: " + err);
      return false;
    }
    setLines((prev) => prev.filter((l) => !ids.includes(l.id)));
    return true;
  }, []);

  const saveProfile = useCallback(
    async (p: Omit<POSMappingProfile, "id"> & { id?: string }) => {
      const row = { name: p.name, separator: p.separator, has_header_row: p.hasHeaderRow, mappings: p.mappings, date_format: p.dateFormat, updated_at: new Date().toISOString() };
      const { error } = p.id ? await supabase.from("pos_mapping_profiles").update(row).eq("id", p.id) : await supabase.from("pos_mapping_profiles").insert(row);
      if (error) {
        toast.error("บันทึกรูปแบบ POS ไม่สำเร็จ");
        return false;
      }
      await loadProfiles();
      return true;
    },
    [loadProfiles],
  );

  const deleteProfile = useCallback(
    async (id: string) => {
      const { error } = await supabase.from("pos_mapping_profiles").delete().eq("id", id);
      if (error) {
        toast.error("ลบรูปแบบ POS ไม่สำเร็จ");
        return false;
      }
      await loadProfiles();
      return true;
    },
    [loadProfiles],
  );

  return { days, daysLoading, lines, linesLoading, profiles, reloadDays: loadDays, reloadLines: loadLines, existingOn, codeHistory, recipeMenuIds, saveImport, fetchHistory, addLine, updateLine, deleteLines, saveProfile, deleteProfile };
}

export type SalesData = ReturnType<typeof useSalesData>;
