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
  // Read for "replace", to leave unchanged rows alone (absent = treat as changed)
  qty?: number;
  unit_price?: number;
  order_type?: string;
  channel?: string;
}

// ── Reading the paste ──

const key = (date: string, receipt: string, code: string, name: string) => `${date}|${receipt}|${code}|${name}`;

export interface ReadResult {
  profile: POSMappingProfile;
  rows: ParsedRow[];
  /** Priced lines with no menu code that the name did not resolve either: NOT imported */
  skipped: SkippedRow[];
  /** Rows whose menu code the app knows */
  known: number;
  /** Rows in `rows` whose code came from the name (codeFromName) */
  resolved: number;
}

/** Codes the app can use: real menu codes, plus the old POS's option codes (OP122, OP-12) */
export const isUsableCode = (code: string, menuCodes: Set<string>) => menuCodes.has(code) || /^OP-?\d+$/i.test(code);

/** Finds the menu code for a POS line name, or null */
export type CodeResolver = (menuName: string) => string | null;

/**
 * Read the text with every saved POS format; best fit (most usable codes) first.
 * With `resolve`, priced lines the POS sent without a code (LINE MAN deals, Oct 2026)
 * come in under the code found from their name; the full POS name is kept, since
 * option rules match on it.
 */
export function readWithEachFormat(text: string, profiles: POSMappingProfile[], menuCodes: Set<string>, source: ParseSource, resolve?: CodeResolver): ReadResult[] {
  return profiles
    .map((profile) => {
      const parsed = parseData(text, profile, "", source);
      const found: ParsedRow[] = [];
      const skipped: SkippedRow[] = [];
      for (const s of parsed.skippedRows) {
        const code = resolve && s.saleDate && s.qty > 0 ? resolve(s.menuName) : null;
        if (!code) skipped.push(s);
        else found.push({ saleDate: s.saleDate, receiptNo: s.receiptNo, menuCode: code, menuName: s.menuName, orderType: s.orderType, qty: s.qty, unitPrice: s.unitPrice, netAmount: s.netAmount, channel: s.channel, codeFromName: true });
      }
      const rows = mergeSameKey([...parsed.rows, ...found]);
      return { profile, rows, skipped, known: rows.filter((r) => isUsableCode(r.menuCode, menuCodes)).length, resolved: rows.filter((r) => r.codeFromName).length };
    })
    .sort((a, b) => b.known - a.known || b.rows.length - a.rows.length);
}

/**
 * Two lines of one bill with the same code and full name — coded or resolved — share
 * (branch, date, receipt, code, name), the table's unique key, and would fail the whole
 * day's insert. Fold them into one line (qty and amount added) so the day saves; a
 * re-paste folds the same way. A resolved line folds into a coded twin and stays coded.
 */
function mergeSameKey(rows: ParsedRow[]): ParsedRow[] {
  const byKey = new Map<string, ParsedRow>();
  for (const r of rows) {
    const k = key(r.saleDate, r.receiptNo, r.menuCode, r.menuName);
    const had = byKey.get(k);
    if (had) byKey.set(k, { ...had, qty: had.qty + r.qty, netAmount: had.netAmount + r.netAmount, codeFromName: had.codeFromName && r.codeFromName });
    else byKey.set(k, r);
  }
  return [...byKey.values()];
}

// ── Finding a code from a POS name ──

// Promo decorations FoodStory adds to delivery-app deals: "ลดพิเศษ!", "[เฉพาะที่ LINE MAN]", "[ดีลเดือด]", "[โปรโมชัน]"
const PROMO = /\[[^\]]*\]|ลดพิเศษ!?/g;

/**
 * The menu part of a POS line, before its options: "Black Garlic Ramen ลดพิเศษ! [ดีลเดือด]
 * เลือกเส้น : เส้นโฮมเมด x 1" → "Black Garlic Ramen ลดพิเศษ! [ดีลเดือด]". The option group is
 * the last word before the first colon, plus a number when there is one ("เลือกราเมนชามที่ 1").
 */
export function posBase(menuName: string): string {
  const colon = menuName.indexOf(":");
  if (colon < 0) return menuName.trim();
  return menuName.slice(0, colon).replace(/\s*\S+(\s+\d+)?\s*$/, "").trim();
}

/** The base without promo decorations, spaces as written ("Black Garlic Ramen") */
export const cleanBase = (menuName: string) => posBase(menuName).replace(PROMO, " ").replace(/\s+/g, " ").trim();

/** Compare key: no promo decorations, no case, no spaces */
const nameKey = (text: string) => text.replace(PROMO, " ").toLowerCase().replace(/\s+/g, "");

/** A key that maps to two different codes is not trusted */
function addKey(map: Map<string, Set<string>>, k: string, code: string) {
  if (k.length < 3) return;
  if (!map.has(k)) map.set(k, new Set());
  map.get(k)!.add(code);
}

/**
 * Code for a no-code POS line: (b) the code this branch's past lines with the same
 * base carried ("Black Garlic Ramen" ↔ MN-056 "แบล็ค การ์ลิค ราเมน"), when one code has
 * ≥ 80% of them; else (a) the one menu with a recipe whose name — whole, without the
 * part in brackets, or the part in brackets — equals the base. Menus without a recipe
 * are passed over: "Standard Tori Paitan Ramen (Line Man)" MN-003L has no menu_bom
 * lines, so a sale under it would take no stock. `withRecipe` null (not loaded) skips
 * (a). Two or more codes for a name = not resolved. Only codes the app knows.
 */
export function codeResolver(menus: { id: string; menuCode: string; menuName: string }[], history: { menu_code: string; menu_name: string }[], menuCodes: Set<string>, withRecipe: Set<string> | null): CodeResolver {
  const byMenu = new Map<string, Set<string>>();
  for (const m of withRecipe ? menus : []) {
    if (!m.menuCode || !m.menuName || !withRecipe!.has(m.id)) continue;
    addKey(byMenu, nameKey(m.menuName), m.menuCode);
    addKey(byMenu, nameKey(m.menuName.replace(/\([^)]*\)/g, " ")), m.menuCode);
    for (const inner of m.menuName.matchAll(/\(([^)]*)\)/g)) addKey(byMenu, nameKey(inner[1]), m.menuCode);
  }
  const counts = new Map<string, Map<string, number>>();
  for (const h of history) {
    if (!h.menu_code || !menuCodes.has(h.menu_code)) continue;
    const k = nameKey(posBase(h.menu_name || ""));
    if (k.length < 3) continue;
    const c = counts.get(k) ?? new Map<string, number>();
    c.set(h.menu_code, (c.get(h.menu_code) ?? 0) + 1);
    counts.set(k, c);
  }
  const byHistory = new Map<string, string>();
  counts.forEach((c, k) => {
    const total = [...c.values()].reduce((s, n) => s + n, 0);
    const [code, n] = [...c.entries()].sort((a, b) => b[1] - a[1])[0];
    if (n / total >= 0.8) byHistory.set(k, code);
  });
  return (menuName) => {
    const k = nameKey(posBase(menuName));
    if (k.length < 3) return null;
    const h = byHistory.get(k);
    if (h) return h;
    const m = byMenu.get(k);
    if (!m || m.size !== 1) return null;
    const code = [...m][0];
    return menuCodes.has(code) ? code : null;
  };
}

/** Bases (cleaned) of the priced no-code lines — what to look up in past sales */
export function noCodeBases(reads: ReadResult[]): string[] {
  const out = new Set<string>();
  for (const r of reads) for (const s of r.skipped) out.add(cleanBase(s.menuName));
  return [...out].filter((b) => b.replace(/\s/g, "").length >= 3);
}

/** A read that may hang: after `ms` give `fallback` instead (an unresolved line, not a spinner) */
export function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(fallback);
      },
    );
  });
}

/** Unimported lines grouped by their POS menu part, biggest amount first (the warning on the check screen) */
export function skippedByName(skipped: SkippedRow[]): { name: string; lines: number; amount: number }[] {
  const m = new Map<string, { name: string; lines: number; amount: number }>();
  for (const s of skipped) {
    const name = posBase(s.menuName) || s.menuName || "(ไม่มีชื่อ)";
    const g = m.get(name) ?? { name, lines: 0, amount: 0 };
    g.lines++;
    g.amount += s.netAmount;
    m.set(name, g);
  }
  return [...m.values()].sort((a, b) => b.amount - a.amount);
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

/**
 * Rows of `rows` that are not in `existing`. A key seen twice in the paste and once
 * in the database leaves one new row — the old checkDuplicates/bulkInsert rule.
 * Pass 1 matches the exact (bill, code, name); pass 2 lets a leftover line match a saved
 * line of the same bill and full name under ANY code: a code found from the name may
 * differ next time, be fixed by hand in History, or the POS may start sending the real
 * code for a deal saved under a resolved one — still the same bill line.
 */
export function rowsNotInDb(rows: ParsedRow[], existing: ExistingRow[]): ParsedRow[] {
  return matchExisting(rows, existing, true).unmatched;
}

/** Pairs pasted rows with saved rows (each saved row used once); `anyCode` adds pass 2 */
function matchExisting(rows: ParsedRow[], existing: ExistingRow[], anyCode: boolean) {
  const free = new Map<string, ExistingRow[]>();
  for (const e of existing) {
    const k = key(e.sale_date, e.receipt_no, "*", e.menu_name);
    free.set(k, [...(free.get(k) ?? []), e]);
  }
  const pair = new Map<number, ExistingRow>();
  const take = (i: number, exact: boolean) => {
    const r = rows[i];
    const list = free.get(key(r.saleDate, r.receiptNo, "*", r.menuName));
    const j = list ? list.findIndex((e) => !exact || e.menu_code === r.menuCode) : -1;
    if (j < 0) return;
    pair.set(i, list![j]);
    list!.splice(j, 1);
  };
  rows.forEach((_, i) => take(i, true));
  if (anyCode) rows.forEach((_, i) => !pair.has(i) && take(i, false));
  return { pair, unmatched: rows.filter((_, i) => !pair.has(i)) };
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

/** Fields a re-pasted line may change on a saved row with the same key */
export type SalesRowPatch = Pick<SalesInsertRow, "order_type" | "qty" | "unit_price" | "net_amount" | "channel">;

export interface DayWrites {
  insert: SalesInsertRow[];
  /** Saved rows with the same key as a pasted line but other values (replace only) */
  update: { id: string; patch: SalesRowPatch }[];
  deleteIds: string[];
  /** Saved rows that already equal a pasted line: left as they are (replace only) */
  kept: number;
}

/**
 * Rows to write for one day. "replace" makes the day equal the paste. A pasted line with
 * the same (bill, code, name) as a saved row keeps that row — updated if its numbers
 * differ — instead of insert-then-delete: inserting first would hit the table's unique
 * key on every unchanged line and fail the day. The rest is inserted and the saved rows
 * nothing matched are deleted, after the inserts (saveImport), so a failure never
 * empties the day. (The old page deleted the day and then inserted only unseen rows.)
 */
export function dayWrites(branchId: string, plan: DayPlan, mode: DayMode): DayWrites {
  if (mode === "skip") return { insert: [], update: [], deleteIds: [], kept: 0 };
  if (mode === "add") return { insert: plan.newRows.map((r) => toInsertRow(branchId, r)), update: [], deleteIds: [], kept: 0 };
  const { pair } = matchExisting(plan.rows, plan.existing, false);
  const update: DayWrites["update"] = [];
  let kept = 0;
  pair.forEach((e, i) => {
    const r = plan.rows[i];
    const patch: SalesRowPatch = { order_type: r.orderType, qty: r.qty, unit_price: r.unitPrice, net_amount: r.netAmount, channel: r.channel };
    const same = e.qty !== undefined && Number(e.qty) === r.qty && Number(e.unit_price) === r.unitPrice && Number(e.net_amount) === r.netAmount && (e.order_type ?? "") === r.orderType && (e.channel ?? "") === r.channel;
    if (same) kept++;
    else update.push({ id: e.id, patch });
  });
  const used = new Set([...pair.values()].map((e) => e.id));
  return {
    insert: plan.rows.filter((_, i) => !pair.has(i)).map((r) => toInsertRow(branchId, r)),
    update,
    deleteIds: plan.existing.filter((e) => !used.has(e.id)).map((e) => e.id),
    kept,
  };
}

/** The three writes a day needs; each returns an error text or null. 0 rows touched is an error (RLS says no silently) */
export interface SalesWriter {
  insert(rows: SalesInsertRow[]): Promise<{ ids: string[]; error: string | null }>;
  remove(ids: string[]): Promise<string | null>;
  update(id: string, patch: SalesRowPatch): Promise<string | null>;
}

/**
 * Writes one day: inserts, then deletes, then updates. Keys never collide (an insert
 * never shares a key with a row that stays — see dayWrites), so inserting first is safe;
 * a failed insert takes its rows back out and the day is as before (`partial` false).
 * A failed delete or update leaves the day partly written (`partial`): checking and
 * saving the paste again repairs it, since the plan is worked out from what is saved.
 */
export async function writeDay(w: DayWrites, db: SalesWriter, chunk = 50): Promise<{ saved: number; error: string | null; partial: boolean }> {
  const newIds: string[] = [];
  for (let i = 0; i < w.insert.length; i += chunk) {
    const part = w.insert.slice(i, i + chunk);
    const r = await db.insert(part);
    const error = r.error ?? (r.ids.length < part.length ? "บันทึกได้ไม่ครบทุกแถว (ไม่มีสิทธิ์?)" : null);
    if (error) {
      const undo = newIds.length || r.ids.length ? await db.remove([...newIds, ...r.ids]) : null;
      return { saved: 0, error, partial: !!undo };
    }
    newIds.push(...r.ids);
  }
  if (w.deleteIds.length) {
    const error = await db.remove(w.deleteIds);
    if (error) return { saved: newIds.length, error, partial: true };
  }
  // Small parallel groups: a replaced day may change many lines' numbers
  for (let i = 0; i < w.update.length; i += 10) {
    const errors = await Promise.all(w.update.slice(i, i + 10).map((u) => db.update(u.id, u.patch)));
    const error = errors.find(Boolean);
    if (error) return { saved: newIds.length, error, partial: true };
  }
  return { saved: newIds.length + w.update.length + w.kept, error: null, partial: false };
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
