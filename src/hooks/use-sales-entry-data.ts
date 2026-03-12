import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { toLocalDateStr } from '@/lib/utils';

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
  separator: 'tab' | 'comma' | 'semicolon';
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

  if (format === 'YYYY-MM-DD') {
    [year, month, day] = parts;
  } else if (format === 'MM/DD/YYYY') {
    [month, day, year] = parts;
  } else {
    // DD/MM/YYYY (default)
    [day, month, year] = parts;
  }

  if (year.length === 2) year = '20' + year;
  const y = parseInt(year), m = parseInt(month), d = parseInt(day);
  if (isNaN(y) || isNaN(m) || isNaN(d) || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

// CSV-aware split: handle quoted fields with commas
function splitCSV(line: string): string[] {
  const result: string[] = [];
  let current = '';
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
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

export function parseData(
  rawText: string,
  profile: POSMappingProfile,
  _branchId: string
): ParsedRow[] {
  const lines = rawText.split('\n').filter(l => l.trim());
  const startIdx = profile.hasHeaderRow ? 1 : 0;
  const rows: ParsedRow[] = [];

  for (let i = startIdx; i < lines.length; i++) {
    let cols: string[];
    if (profile.separator === 'comma') {
      cols = splitCSV(lines[i]);
    } else if (profile.separator === 'semicolon') {
      cols = lines[i].split(';');
    } else {
      cols = lines[i].split('\t');
    }

    const m = profile.mappings;
    const menuCode = (cols[m.menu_code] ?? '').trim();
    if (!menuCode) continue;

    const qtyRaw = Number((cols[m.qty] ?? '').trim());
    if (!qtyRaw || isNaN(qtyRaw)) continue;

    const dateRaw = (cols[m.date] ?? '').trim();
    const saleDate = parseDateStr(dateRaw, profile.dateFormat);
    if (!saleDate) continue;

    rows.push({
      saleDate,
      receiptNo: m.receipt_no !== undefined ? (cols[m.receipt_no] ?? '').trim() : '',
      menuCode,
      menuName: m.menu_name !== undefined ? (cols[m.menu_name] ?? '').trim() : '',
      orderType: m.order_type !== undefined ? (cols[m.order_type] ?? '').trim() : '',
      qty: qtyRaw,
      unitPrice: m.unit_price !== undefined ? (Number((cols[m.unit_price] ?? '').trim()) || 0) : 0,
      netAmount: m.net_amount !== undefined ? (Number((cols[m.net_amount] ?? '').trim()) || 0) : 0,
      channel: m.channel !== undefined ? (cols[m.channel] ?? '').trim() : '',
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
      .from('pos_mapping_profiles')
      .select('*')
      .order('created_at', { ascending: true });
    if (error) { console.error('Failed to load profiles', error); return; }
    setProfiles((data || []).map(toProfileLocal));
  }, []);

  const fetchEntries = useCallback(async (filters?: { branchId?: string; dateFrom?: string; dateTo?: string }) => {
    setLoading(true);
    let q = supabase.from('sales_entries').select('*').order('sale_date', { ascending: false }).order('created_at', { ascending: false });
    if (filters?.branchId) q = q.eq('branch_id', filters.branchId);
    if (filters?.dateFrom) q = q.gte('sale_date', filters.dateFrom);
    if (filters?.dateTo) q = q.lte('sale_date', filters.dateTo);
    const { data, error } = await q.limit(2000);
    if (error) { toast.error('Failed to load sales'); setLoading(false); return; }
    setEntries((data || []).map(toLocal));
    setLoading(false);
  }, []);

  useEffect(() => { fetchEntries(); fetchProfiles(); }, [fetchEntries, fetchProfiles]);

  // Check duplicates for historical rows (sale_date < today)
  const checkDuplicates = useCallback(async (
    branchId: string,
    rows: ParsedRow[]
  ): Promise<ParsedRow[]> => {
    const today = toLocalDateStr(new Date());
    const historicalRows = rows.filter(r => r.saleDate < today);
    const todayRows = rows.filter(r => r.saleDate >= today);

    if (historicalRows.length === 0) {
      return todayRows.map(r => ({ ...r, isDuplicate: false }));
    }

    // Get unique dates from historical rows
    const dates = [...new Set(historicalRows.map(r => r.saleDate))];

    // Query existing entries for those dates + branch
    const { data: existing } = await supabase
      .from('sales_entries')
      .select('sale_date,receipt_no,menu_code,menu_name')
      .eq('branch_id', branchId)
      .in('sale_date', dates);

    const existingSet = new Set(
      (existing || []).map(e => `${e.sale_date}|${e.receipt_no}|${e.menu_code}|${e.menu_name}`)
    );

    const markedHistorical = historicalRows.map(r => ({
      ...r,
      isDuplicate: existingSet.has(`${r.saleDate}|${r.receiptNo}|${r.menuCode}|${r.menuName}`),
    }));

    const markedToday = todayRows.map(r => ({ ...r, isDuplicate: false }));

    return [...markedHistorical, ...markedToday];
  }, []);

  const bulkInsert = useCallback(async (branchId: string, rows: Omit<SalesEntry, 'id' | 'branchId'>[]) => {
    const insertRows = rows.map(r => ({
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

    let inserted = 0;
    const chunkSize = 500;
    for (let i = 0; i < insertRows.length; i += chunkSize) {
      const chunk = insertRows.slice(i, i + chunkSize);
      const { data, error } = await supabase
        .from('sales_entries')
        .upsert(chunk, { onConflict: 'branch_id,sale_date,receipt_no,menu_code,menu_name', ignoreDuplicates: true })
        .select();
      if (error) {
        toast.error('Import error: ' + error.message);
        return { inserted, skipped: rows.length - inserted };
      }
      inserted += (data?.length || 0);
    }
    return { inserted, skipped: rows.length - inserted };
  }, []);

  const saveProfile = useCallback(async (profile: Omit<POSMappingProfile, 'id'> & { id?: string }) => {
    const row = {
      name: profile.name,
      separator: profile.separator,
      has_header_row: profile.hasHeaderRow,
      mappings: profile.mappings,
      date_format: profile.dateFormat,
      updated_at: new Date().toISOString(),
    };
    if (profile.id) {
      const { error } = await supabase.from('pos_mapping_profiles').update(row).eq('id', profile.id);
      if (error) { toast.error('Failed to save profile'); return false; }
    } else {
      const { error } = await supabase.from('pos_mapping_profiles').insert(row);
      if (error) { toast.error('Failed to create profile'); return false; }
    }
    await fetchProfiles();
    return true;
  }, [fetchProfiles]);

  const deleteProfile = useCallback(async (id: string) => {
    const { error } = await supabase.from('pos_mapping_profiles').delete().eq('id', id);
    if (error) { toast.error('Failed to delete profile'); return false; }
    await fetchProfiles();
    return true;
  }, [fetchProfiles]);

  const deleteEntry = useCallback(async (id: string) => {
    const { error } = await supabase.from('sales_entries').delete().eq('id', id);
    if (error) { toast.error('Failed to delete'); return; }
    setEntries(prev => prev.filter(e => e.id !== id));
  }, []);

  return { entries, loading, fetchEntries, bulkInsert, deleteEntry, profiles, fetchProfiles, saveProfile, deleteProfile, checkDuplicates };
}
