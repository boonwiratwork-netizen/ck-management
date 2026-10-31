/**
 * Files for bulk changes (Cost Center › นำเข้า/ส่งออกไฟล์): read a CSV or an Excel
 * sheet into rows keyed by column name, and write a template or the current data
 * in exactly those columns, so an exported file can be edited and imported back.
 * The Excel library (~900 KB) is loaded only when a file is read or written.
 */

export type FileRow = Record<string, string>;

/** CSV text → rows (quoted fields, commas and new lines inside quotes, BOM) */
export function parseCsv(text: string): FileRow[] {
  const src = text.replace(/^﻿/, "");
  const table: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      table.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    table.push(row);
  }
  return toRows(table);
}

/** Where a row sits in the file, so messages point at the right line after blank ones */
export const LINE = "__line";

/** First row = column names; empty lines dropped (each row keeps its line number); every value a trimmed string */
function toRows(table: unknown[][]): FileRow[] {
  const [head, ...body] = table;
  if (!head) return [];
  const names = head.map((h) => String(h ?? "").trim());
  return body
    .map((r, i) => ({ r, line: i + 2 }))
    .filter(({ r }) => r.some((v) => String(v ?? "").trim() !== ""))
    .map(({ r, line }) => ({ ...Object.fromEntries(names.map((n, i) => [n, String(r[i] ?? "").trim()])), [LINE]: String(line) }));
}

/** A .csv, .xlsx or .xls file → rows from its first sheet */
export async function readRows(file: File): Promise<FileRow[]> {
  if (/\.csv$/i.test(file.name) || file.type === "text/csv") return parseCsv(await file.text());
  const XLSX = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];
  // Stored values, not what the cell shows: 12.5 formatted as a whole number is
  // still 12.5, a date is a date (written YYYY-MM-DD), 85% is 0.85
  const table = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: "" });
  return toRows(table.map((r) => r.map(cellText)));
}

function cellText(v: unknown): string {
  if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  if (typeof v === "number") return String(v);
  return String(v ?? "");
}

/** An Excel file with these columns and rows (a template has one example row) */
export async function writeRows(fileName: string, columns: string[], rows: FileRow[]) {
  const XLSX = await import("xlsx");
  const ws = XLSX.utils.aoa_to_sheet([columns, ...rows.map((r) => columns.map((c) => r[c] ?? ""))]);
  ws["!cols"] = columns.map((c) => ({ wch: Math.max(12, c.length + 2) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "data");
  XLSX.writeFile(wb, fileName);
}
