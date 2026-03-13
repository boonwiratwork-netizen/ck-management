import { useState, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { toLocalDateStr } from "@/lib/utils";

export interface SalesEntry {
  id: string;
  branchId: string;
  saleDate: string;
  receiptNo: string;
  menuCode: string;
  menuName: string;
  orderType: string;
  qty: number;
  unitPrice: number;
  netAmount: number;
  channel: string;
}

export interface POSMappingProfile {
  id: string;
  name: string;
  separator: "tab" | "comma" | "semicolon";
  hasHeaderRow: boolean;
  mappings: Record<string, number>;
  dateFormat: string;
}

export interface ParsedRow {
  saleDate: string;
  receiptNo: string;
  menuCode: string;
  menuName: string;
  orderType: string;
  qty: number;
  unitPrice: number;
  netAmount: number;
  channel: string;
  isDuplicate?: boolean;
}

const toLocal = (r: any): SalesEntry => ({
  id: r.id,
  branchId: r.branch_id,
  saleDate: r.sale_date,
  receiptNo: r.receipt_no,
  menuCode: r.menu_code,
  menuName: r.menu_name,
  orderType: r.order_type,
  qty: Number(r.qty),
  unitPrice: Number(r.unit_price),
  netAmount: Number(r.net_amount),
  channel: r.channel,
});

const toProfileLocal = (r: any): POSMappingProfile => ({
  id: r.id,
  name: r.name,
  separator: r.separator,
  hasHeaderRow: r.has_header_row,
  mappings: r.mappings as Record<string, number>,
  dateFormat: r.date_format,
});

// Parse date string according to format
function parseDateStr(raw: string, format: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(/[\/\-\.]/);
  if (parts.length !== 3) return null;

  let year: string, month: string, day: string;

  if (format === "YYYY-MM-DD") {
    [year, month, day] = parts;
  } else if (format === "MM/DD/YYYY") {
    [month, day, year] = parts;
  } else {
    // DD/MM/YYYY (default)
    [day, month, year] = parts;
  }

  if (year.length === 2) year = "20" + year;
  const y = parseInt(year),
    m = parseInt(month),
    d = parseInt(day);
  if (isNaN(y) || isNaN(m) || isNaN(d) || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

// CSV-aware split: handle quoted fields with commas
function splitCSV(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

// Generic split by separator character
function splitBySep(line: string, sep: string): string[] {
  if (sep === ",") return splitCSV(line);
  return line.split(sep);
}

// Auto-detect separator from first non-empty line
function detectSeparator(firstLine: string): "tab" | "comma" | "semicolon" {
  const tabs = (firstLine.match(/\t/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  const semis = (firstLine.match(/;/g) || []).length;
  if (tabs >= commas && tabs >= semis) return "tab";
  if (commas >= semis) return "comma";
  return "semicolon";
}

const SEP_CHAR: Record<string, string> = { tab: "\t", comma: ",", semicolon: ";" };

// Auto-detect whether first row is a header
function detectHeaderRow(firstLine: string, sep: string, mappings: Record<string, number>): boolean {
  const cols = splitBySep(firstLine, sep);
  // Check qty column — if it's non-numeric text, it's likely a header
  const qtyIdx = mappings.qty;
  if (qtyIdx !== undefined && qtyIdx < cols.length) {
    const val = cols[qtyIdx].replace(/["']/g, "").trim();
    if (val && isNaN(Number(val))) return true;
  }
  // Check if multiple columns contain Thai or clearly non-numeric header text
  let textCols = 0;
  for (const col of cols) {
    const v = col.replace(/["']/g, "").trim();
    if (v && isNaN(Number(v)) && /[\u0E00-\u0E7F]|date|receipt|menu|qty|price|amount|channel|order/i.test(v)) {
      textCols++;
    }
  }
  return textCols >= 3;
}

export type ParseSource = "paste" | "csv";

export function parseData(
  rawText: string,
  profile: POSMappingProfile,
  _branchId: string,
  source: ParseSource = "paste",
): ParsedRow[] {
  const lines = rawText.split("\n").filter((l) => l.trim());
  if (lines.length === 0) return [];

  // Determine separator and header row
  let separator = profile.separator;
  let hasHeader = profile.hasHeaderRow;

  if (source === "csv") {
    separator = detectSeparator(lines[0]);
    const sepChar = SEP_CHAR[separator] || "\t";
    hasHeader = detectHeaderRow(lines[0], sepChar, profile.mappings);
  }

  const sepChar = SEP_CHAR[separator] || "\t";
  const startIdx = hasHeader ? 1 : 0;
  const rows: ParsedRow[] = [];

  for (let i = startIdx; i < lines.length; i++) {
    const cols = splitBySep(lines[i], sepChar);

    const m = profile.mappings;
    const menuCode = (cols[m.menu_code] ?? "").trim();
    if (!menuCode) continue;

    const qtyRaw = Number((cols[m.qty] ?? "").trim());
    if (!qtyRaw || isNaN(qtyRaw)) continue;

    const dateRaw = (cols[m.date] ?? "").trim();
    const saleDate = parseDateStr(dateRaw, profile.dateFormat);
    if (!saleDate) continue;

    rows.push({
      saleDate,
      receiptNo: m.receipt_no !== undefined ? (cols[m.receipt_no] ?? "").trim() : "",
      menuCode,
      menuName: m.menu_name !== undefined ? (cols[m.menu_name] ?? "").trim() : "",
      orderType: m.order_type !== undefined ? (cols[m.order_type] ?? "").trim() : "",
      qty: qtyRaw,
      unitPrice: m.unit_price !== undefined ? Number((cols[m.unit_price] ?? "").replace(/,/g, "").trim()) || 0 : 0,
      netAmount: m.net_amount !== undefined ? Number((cols[m.net_amount] ?? "").replace(/,/g, "").trim()) || 0 : 0,
      channel: m.channel !== undefined ? (cols[m.channel] ?? "").trim() : "",
    });
  }

  return rows;
}

export function useSalesEntryData() {
  const [entries, setEntries] = useState<SalesEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [profiles, setProfiles] = useState<POSMappingProfile[]>([]);

  const fetchProfiles = useCallback(async () => {
    const { data, error } = await supabase
      .from("pos_mapping_profiles")
      .select("*")
      .order("created_at", { ascending: true });
    if (error) {
      console.error("Failed to load profiles", error);
      return;
    }
    setProfiles((data || []).map(toProfileLocal));
  }, []);

  const fetchEntries = useCallback(async (filters?: { branchId?: string; dateFrom?: string; dateTo?: string }) => {
    setLoading(true);
    let q = supabase
      .from("sales_entries")
      .select("*")
      .order("sale_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (filters?.branchId) q = q.eq("branch_id", filters.branchId);
    if (filters?.dateFrom) q = q.gte("sale_date", filters.dateFrom);
    if (filters?.dateTo) q = q.lte("sale_date", filters.dateTo);
    const { data, error } = await q.limit(2000);
    if (error) {
      toast.error("Failed to load sales");
      setLoading(false);
      return;
    }
    setEntries((data || []).map(toLocal));
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchEntries();
    fetchProfiles();
  }, [fetchEntries, fetchProfiles]);

  // Check duplicates for historical rows (sale_date < today)
  const checkDuplicates = useCallback(async (branchId: string, rows: ParsedRow[]): Promise<ParsedRow[]> => {
    const today = toLocalDateStr(new Date());
    const historicalRows = rows.filter((r) => r.saleDate < today);
    const todayRows = rows.filter((r) => r.saleDate >= today);

    if (historicalRows.length === 0) {
      return todayRows.map((r) => ({ ...r, isDuplicate: false }));
    }

    // Get unique dates from historical rows
    const dates = [...new Set(historicalRows.map((r) => r.saleDate))];

    // Query existing entries for those dates + branch
    const { data: existing } = await supabase
      .from("sales_entries")
      .select("sale_date,receipt_no,menu_code,menu_name")
      .eq("branch_id", branchId)
      .in("sale_date", dates)
      .limit(5000);

    const existingSet = new Set(
      (existing || []).map((e) => `${e.sale_date}|${e.receipt_no}|${e.menu_code}|${e.menu_name}`),
    );

    const markedHistorical = historicalRows.map((r) => ({
      ...r,
      isDuplicate: existingSet.has(`${r.saleDate}|${r.receiptNo}|${r.menuCode}|${r.menuName}`),
    }));

    const markedToday = todayRows.map((r) => ({ ...r, isDuplicate: false }));

    return [...markedHistorical, ...markedToday];
  }, []);

  const bulkInsert = useCallback(async (branchId: string, rows: Omit<SalesEntry, "id" | "branchId">[]) => {
    // 1) Deduplicate within current import batch by composite key
    const dedupedRows = Array.from(
      new Map(rows.map((r) => [`${branchId}|${r.saleDate}|${r.receiptNo}|${r.menuCode}|${r.menuName}`, r])).values(),
    );
    const intraBatchSkipped = rows.length - dedupedRows.length;

    const insertRows = dedupedRows.map((r) => ({
      branch_id: branchId,
      sale_date: r.saleDate,
      receipt_no: r.receiptNo,
      menu_code: r.menuCode,
      menu_name: r.menuName,
      order_type: r.orderType,
      qty: r.qty,
      unit_price: r.unitPrice,
      net_amount: r.netAmount,
      channel: r.channel,
    }));

    if (insertRows.length === 0) {
      toast.info(`All ${rows.length} rows already imported`);
      return null;
    }

    // 2) Fetch existing rows for this branch/date/receipt scope
    const dates = [...new Set(insertRows.map((r) => r.sale_date))];
    const receipts = [...new Set(insertRows.map((r) => r.receipt_no))];

    const { data: existingRows, error: existingError } = await supabase
      .from("sales_entries")
      .select("branch_id,sale_date,receipt_no,menu_code,menu_name")
      .eq("branch_id", branchId)
      .in("sale_date", dates)
      .in("receipt_no", receipts)
      .limit(5000);

    if (existingError) {
      console.error("Failed to check existing sales entries:", existingError);
      toast.error("Import error: " + existingError.message);
      return null;
    }

    // 3) Build key set from existing rows and keep only new rows
    const existingSet = new Set(
      (existingRows || []).map((r) => `${r.branch_id}|${r.sale_date}|${r.receipt_no}|${r.menu_code}|${r.menu_name}`),
    );

    const newRows = insertRows.filter(
      (r) => !existingSet.has(`${r.branch_id}|${r.sale_date}|${r.receipt_no}|${r.menu_code}|${r.menu_name}`),
    );

    const existingSkipped = insertRows.length - newRows.length;
    const skipped = intraBatchSkipped + existingSkipped;

    if (newRows.length === 0) {
      toast.info(`All ${rows.length} rows already imported`);
      return null;
    }

    // 4) Plain insert in small chunks
    const chunkSize = 50;
    let inserted = 0;

    for (let i = 0; i < newRows.length; i += chunkSize) {
      const chunk = newRows.slice(i, i + chunkSize);
      const { error } = await supabase.from("sales_entries").insert(chunk);

      if (error) {
        console.error("Sales import error:", error);
        toast.error("Import error: " + error.message);
        return null;
      }

      inserted += chunk.length;
    }

    // 5) Explicit import result message
    toast.success(`${inserted} rows imported, ${skipped} rows skipped (already exist)`);
    return { inserted, skipped };
  }, []);

  const saveProfile = useCallback(
    async (profile: Omit<POSMappingProfile, "id"> & { id?: string }) => {
      const row = {
        name: profile.name,
        separator: profile.separator,
        has_header_row: profile.hasHeaderRow,
        mappings: profile.mappings,
        date_format: profile.dateFormat,
        updated_at: new Date().toISOString(),
      };
      if (profile.id) {
        const { error } = await supabase.from("pos_mapping_profiles").update(row).eq("id", profile.id);
        if (error) {
          toast.error("Failed to save profile");
          return false;
        }
      } else {
        const { error } = await supabase.from("pos_mapping_profiles").insert(row);
        if (error) {
          toast.error("Failed to create profile");
          return false;
        }
      }
      await fetchProfiles();
      return true;
    },
    [fetchProfiles],
  );

  const deleteProfile = useCallback(
    async (id: string) => {
      const { error } = await supabase.from("pos_mapping_profiles").delete().eq("id", id);
      if (error) {
        toast.error("Failed to delete profile");
        return false;
      }
      await fetchProfiles();
      return true;
    },
    [fetchProfiles],
  );

  const deleteEntry = useCallback(async (id: string) => {
    const { error } = await supabase.from("sales_entries").delete().eq("id", id);
    if (error) {
      toast.error("Failed to delete");
      return;
    }
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }, []);

  return {
    entries,
    loading,
    fetchEntries,
    bulkInsert,
    deleteEntry,
    profiles,
    fetchProfiles,
    saveProfile,
    deleteProfile,
    checkDuplicates,
  };
}
