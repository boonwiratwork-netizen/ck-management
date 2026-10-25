import { parseData, type ParsedRow, type POSMappingProfile, type ParseSource, type SkippedRow } from "@/hooks/use-sales-entry-data";
import { parseOptions } from "@/lib/pos-options";

/**
 * Pure logic behind the Sales page: read a POS paste in whichever saved format fits,
 * plan each day (add / only-new / replace / skip), and build the exact
 * sales_entries rows the old page wrote. Kept free of React and Supabase so it is tested.
 */

/** One sales_entries row as inserted (the old page's bulkInsert shape) */
export interface SalesInsertRow {
  branch_id: string;
  sale_date: string;
  receipt_no: string;
  menu_code: string;
  menu_name: string;
  order_type: string;
  qty: number;
  unit_price: number;
  net_amount: number;
  channel: string;
}

/** A row already in the database, as much as the import needs */
export interface ExistingRow {
  id: string;
  sale_date: string;
  receipt_no: string;
  menu_code: string;
  menu_name: string;
  net_amount: number;
}

// ── Reading the paste ──

export interface ReadResult {
  profile: POSMappingProfile;
  rows: ParsedRow[];
  skipped: SkippedRow[];
  /** Rows whose menu code the app knows */
  known: number;
}

/** Codes the app can use: real menu codes, plus the old POS's option codes (OP122, OP-12) */
export const isUsableCode = (code: string, menuCodes: Set<string>) => menuCodes.has(code) || /^OP-?\d+$/i.test(code);

/** Read the text with every saved POS format; best fit (most usable codes) first */
export function readWithEachFormat(text: string, profiles: POSMappingProfile[], menuCodes: Set<string>, source: ParseSource): ReadResult[] {
  return profiles
    .map((profile) => {
      const { rows, skippedRows } = parseData(text, profile, "", source);
      return { profile, rows, skipped: skippedRows, known: rows.filter((r) => isUsableCode(r.menuCode, menuCodes)).length };
    })
    .sort((a, b) => b.known - a.known || b.rows.length - a.rows.length);
}

/**
 * Readable = at least half the rows carry a code the app knows. 9 Oct 2026 at Shiro
 * saved 139 rows whose "menu code" was the word คิดภาษี; this stops that.
 */
export const isReadable = (r: ReadResult | undefined) => !!r && r.rows.length > 0 && r.known / r.rows.length >= 0.5;

// ── Planning each day ──

export type DayMode = "add" | "skip" | "replace";

export interface DayPlan {
  date: string;
  rows: ParsedRow[];
  bills: number;
  total: number;
  existing: ExistingRow[];
  existingTotal: number;
  /** Rows not yet in the database (same counting rule as the old import) */
  newRows: ParsedRow[];
}

const key = (date: string, receipt: string, code: string, name: string) => `${date}|${receipt}|${code}|${name}`;

/**
 * Rows of `rows` that are not in `existing`. A key seen twice in the paste and once
 * in the database leaves one new row — the old checkDuplicates/bulkInsert rule.
 */
export function rowsNotInDb(rows: ParsedRow[], existing: ExistingRow[]): ParsedRow[] {
  const inDb = new Map<string, number>();
  for (const e of existing) {
    const k = key(e.sale_date, e.receipt_no, e.menu_code, e.menu_name);
    inDb.set(k, (inDb.get(k) || 0) + 1);
  }
  const seen = new Map<string, number>();
  return rows.filter((r) => {
    const k = key(r.saleDate, r.receiptNo, r.menuCode, r.menuName);
    const n = (seen.get(k) || 0) + 1;
    seen.set(k, n);
    return n > (inDb.get(k) || 0);
  });
}

export function planDays(rows: ParsedRow[], existingByDate: Map<string, ExistingRow[]>): DayPlan[] {
  const byDate = new Map<string, ParsedRow[]>();
  for (const r of rows) byDate.set(r.saleDate, [...(byDate.get(r.saleDate) ?? []), r]);
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, list]) => {
      const existing = existingByDate.get(date) ?? [];
      return {
        date,
        rows: list,
        bills: new Set(list.map((r) => r.receiptNo)).size,
        total: list.reduce((s, r) => s + r.netAmount, 0),
        existing,
        existingTotal: existing.reduce((s, e) => s + Number(e.net_amount || 0), 0),
        newRows: rowsNotInDb(list, existing),
      };
    });
}

/** What a day does unless the person changes it: new days add, days already in skip their known rows */
export const defaultMode = (p: DayPlan): DayMode => (p.newRows.length === 0 ? "skip" : "add");

export const toInsertRow = (branchId: string, r: ParsedRow): SalesInsertRow => ({
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
});

/**
 * Rows to insert and ids to delete for one day. "replace" inserts EVERY pasted row
 * and removes the old ones (the old page deleted the day and then inserted only the
 * rows it had not seen, which emptied a re-pasted day).
 */
export function dayWrites(branchId: string, plan: DayPlan, mode: DayMode): { insert: SalesInsertRow[]; deleteIds: string[] } {
  if (mode === "skip") return { insert: [], deleteIds: [] };
  if (mode === "replace") return { insert: plan.rows.map((r) => toInsertRow(branchId, r)), deleteIds: plan.existing.map((e) => e.id) };
  return { insert: plan.newRows.map((r) => toInsertRow(branchId, r)), deleteIds: [] };
}

// ── Manual entry (the old "บันทึกทีละรายการ" row, unchanged) ──

export function manualRow(input: {
  branchId: string;
  date: string;
  menuCode: string;
  menuName: string;
  optionKeyword?: string;
  qty: number;
  unitPrice: number;
  now?: number;
}): SalesInsertRow {
  return {
    branch_id: input.branchId,
    sale_date: input.date,
    receipt_no: `MANUAL-${input.now ?? Date.now()}`,
    menu_code: input.menuCode,
    menu_name: input.optionKeyword ? `${input.menuName} ${input.optionKeyword}`.trim() : input.menuName,
    order_type: "Manual",
    qty: input.qty,
    unit_price: input.unitPrice,
    net_amount: input.qty * input.unitPrice,
    channel: "Manual",
  };
}

// ── Showing a bill line ──

/** "Standard Shio Ramen เลือกเส้น : เส้นโฮมเมด x 1 แก้ว : น้ำแข็ง x 3" → base + "เส้นโฮมเมด · น้ำแข็ง ×3" */
export function shortName(menuName: string): { base: string; options: string } {
  const opts = parseOptions(menuName);
  if (!opts.length) return { base: menuName, options: "" };
  const firstRaw = opts[0].raw ?? "";
  const cut = firstRaw ? menuName.indexOf(firstRaw) : -1;
  const base = (cut > 0 ? menuName.slice(0, cut) : menuName).trim();
  const counts = [...menuName.matchAll(/\s+x\s*(\d+)\b/g)].map((m) => Number(m[1]));
  const options = opts
    .map((o, i) => {
      // Drop the group: "ระดับเส้น : ลวกเส้น : ปกติ" → "ลวกเส้น ปกติ"
      const parts = (o.raw ?? o.value).split(/\s*:\s*/);
      const text = (parts.length > 1 ? parts.slice(1) : parts).map((p) => p.trim()).join(" ");
      return counts[i] > 1 ? `${text} ×${counts[i]}` : text;
    })
    .join(" · ");
  return { base, options };
}
