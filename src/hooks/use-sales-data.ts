import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { fetchAllRows } from "@/lib/fetch-all";
import type { POSMappingProfile } from "@/hooks/use-sales-entry-data";
import type { ExistingRow, SalesInsertRow } from "@/lib/sales-import";
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

export interface ImportWrite {
  date: string;
  insert: SalesInsertRow[];
  deleteIds: string[];
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

async function deleteIds(ids: string[]): Promise<string | null> {
  for (let i = 0; i < ids.length; i += 200) {
    const { error } = await supabase.from("sales_entries").delete().in("id", ids.slice(i, i + 200));
    if (error) return error.message;
  }
  return null;
}

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
        supabase.from("sales_entries").select("id,sale_date,receipt_no,menu_code,menu_name,net_amount").eq("branch_id", branchId).in("sale_date", dates).order("id").range(a, b),
      );
      if (error) {
        toast.error("ตรวจข้อมูลเดิมไม่สำเร็จ ลองใหม่");
        return null;
      }
      for (const r of data as ExistingRow[]) out.set(r.sale_date, [...(out.get(r.sale_date) ?? []), { ...r, net_amount: Number(r.net_amount) }]);
      return out;
    },
    [branchId],
  );

  /**
   * Save the planned days. A replaced day inserts its new rows FIRST and deletes the
   * old ones only after every insert worked, so a failure never leaves the day empty;
   * if an insert fails, that day's new rows are taken back out.
   */
  const saveImport = useCallback(async (writes: ImportWrite[]): Promise<{ inserted: number; failedDay: string | null }> => {
    let inserted = 0;
    for (const w of writes) {
      const newIds: string[] = [];
      for (let i = 0; i < w.insert.length; i += CHUNK) {
        const { data, error } = await supabase.from("sales_entries").insert(w.insert.slice(i, i + CHUNK)).select("id");
        if (error) {
          await deleteIds(newIds);
          toast.error(`บันทึกวันที่ ${w.date} ไม่สำเร็จ: ${error.message}`);
          return { inserted, failedDay: w.date };
        }
        newIds.push(...(data || []).map((r) => r.id));
      }
      if (w.deleteIds.length) {
        const err = await deleteIds(w.deleteIds);
        if (err) {
          toast.error(`ลบข้อมูลเดิมของวันที่ ${w.date} ไม่ครบ: ${err} — ตรวจวันนั้นอีกครั้ง`);
          return { inserted: inserted + newIds.length, failedDay: w.date };
        }
      }
      inserted += newIds.length;
    }
    return { inserted, failedDay: null };
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

  return { days, daysLoading, lines, linesLoading, profiles, reloadDays: loadDays, reloadLines: loadLines, existingOn, saveImport, addLine, updateLine, deleteLines, saveProfile, deleteProfile };
}

export type SalesData = ReturnType<typeof useSalesData>;
