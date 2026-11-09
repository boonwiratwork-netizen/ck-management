import { judgedCountRows, daysBetween, monthStartOf, countedBeforeSalesDays, type CountLine, type SaleLine } from "@/lib/team-score";
import { shiftDay } from "@/lib/day-follow";

/**
 * กระทบยอด สูตร เทียบ ของจริง — per item, per branch, for a week or a month.
 *
 * Pure: the page reads rows (hooks/use-reconcile.ts) and everything is worked out here.
 *
 * How "used" is found (the owner and Bucci learned this the hard way, Nov 2026):
 * - Never compare raw receipts with the recipe. Each counted row's difference
 *   (daily_stock_counts.variance = physical − calculated) already carries opening, receipts,
 *   recipe use, waste and adjustments, so  used = recipe − Σ difference  over the judged rows,
 *   and stock building up or running down is already in it.
 * - Which rows are judged is the team score's own rule (judgedCountRows in team-score.ts):
 *   each row only over its own window since that item's previous real count, only if every
 *   sales day in the window had a count sheet, and not on a day counted before its sales came in.
 * - Waste is its own column; it is not part of "used" (the calculated balance already took it off).
 * - received_external is stored in PURCHASE units: × converter (only when the purchase and usage
 *   units differ) before it is shown next to usage-unit numbers.
 */

// ─── Rows read ───

export interface RcCount extends CountLine {
  branch_id: string;
  received_from_ck: number;
  /** RAW purchase units (see skuConverter) */
  received_external: number;
}
export interface RcSale extends SaleLine {
  branch_id: string;
  menu_code: string;
  qty: number;
}
export interface RcSku {
  id: string;
  code: string;
  name: string;
  purchaseUom: string;
  usageUom: string;
  converter: number;
}
export interface RcBranch {
  id: string;
  name: string;
  brandName: string;
}
export interface RcMenu {
  id: string;
  menuCode: string;
  menuName: string;
  brandName: string;
}
export interface RcBomLine {
  menuId: string;
  skuId: string;
  effectiveQty: number;
  branchId?: string | null;
  /** A line only delivery uses: never "the amount per serving" a shop counts with */
  deliveryOnly?: boolean;
}

export interface RcPeriod {
  kind: "week" | "month";
  from: string;
  to: string;
  /** The month isn't over yet (month to date) */
  ongoing: boolean;
}

// ─── Periods ───

/**
 * สัปดาห์: the 7 completed days ending yesterday, `back` weeks earlier.
 * เดือน: the calendar month `back` months before today's; the current one runs to yesterday
 * (today on the 1st, when no day of it has ended) and is marked ongoing.
 */
export function reconcilePeriod(kind: "week" | "month", today: string, back = 0): RcPeriod {
  const y = shiftDay(today, -1);
  if (kind === "week") {
    const to = shiftDay(y, -7 * back);
    return { kind, from: shiftDay(to, -6), to, ongoing: false };
  }
  const d = new Date(`${monthStartOf(today)}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - back);
  const from = d.toISOString().slice(0, 10);
  const next = new Date(d);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const end = shiftDay(next.toISOString().slice(0, 10), -1);
  if (end < today) return { kind, from, to: end, ongoing: false };
  return { kind, from, to: y >= from ? y : today, ongoing: true };
}

/** How far before the period the rows are read, so each item's previous count is found */
export const LOOKBACK_DAYS = 21;

// ─── Units ───

/** Purchase → usage units for received_external: only when the two units differ (as the count sheet does) */
export function skuConverter(sku: Pick<RcSku, "purchaseUom" | "usageUom" | "converter"> | undefined): number {
  if (!sku) return 1;
  if (sku.purchaseUom === sku.usageUom) return 1;
  return Number(sku.converter) || 1;
}

/** A unit as people say it */
export function unitText(u: string): string {
  const k = (u ?? "").trim().toLowerCase();
  if (k === "g" || k === "gram" || k === "grams" || k === "กรัม" || k === "ก.") return "ก.";
  if (k === "kg" || k === "กก.") return "กก.";
  if (k === "ml" || k === "มล.") return "มล.";
  if (k === "l" || k === "ลิตร") return "ลิตร";
  if (k === "pc" || k === "pcs" || k === "piece" || k === "ea" || k === "ชิ้น") return "ชิ้น";
  return u ?? "";
}

// ─── Per branch: which days could be used ───

export interface BranchDays {
  branchId: string;
  /** Days in the period */
  total: number;
  /** Days with sales and a count sheet, not counted before the sales came in */
  usable: number;
  /** Sales but no count sheet (the windows across them can't be judged) */
  noSheet: string[];
  /** Counted before that day's sales came in */
  early: string[];
  /** A count sheet with counts but no sales imported */
  noSales: string[];
}

export function branchDays(counts: RcCount[], sales: RcSale[], p: { from: string; to: string }): BranchDays[] {
  const ids = new Set([...counts.map((c) => c.branch_id), ...sales.map((s) => s.branch_id)]);
  return [...ids].map((id) => branchDaysOf(id, counts.filter((c) => c.branch_id === id), sales.filter((s) => s.branch_id === id), p));
}

export function branchDaysOf(branchId: string, counts: RcCount[], sales: RcSale[], p: { from: string; to: string }): BranchDays {
  const days = daysBetween(p.from, p.to);
  const sheet = new Set(counts.map((c) => c.count_date));
  const counted = new Set(counts.filter((c) => c.physical_count !== null).map((c) => c.count_date));
  const sold = new Set(sales.map((s) => s.sale_date));
  const early = new Set(countedBeforeSalesDays({ counts, sales }, p));
  const out: BranchDays = { branchId, total: days.length, usable: 0, noSheet: [], early: [], noSales: [] };
  for (const d of days) {
    if (sold.has(d) && !sheet.has(d)) out.noSheet.push(d);
    else if (early.has(d)) out.early.push(d);
    else if (!sold.has(d) && counted.has(d)) out.noSales.push(d);
    else if (sold.has(d) && sheet.has(d)) out.usable++;
  }
  return out;
}

// ─── Per item × branch ───

export type Verdict = "short" | "over" | "near" | "bad";

export interface Cell {
  branchId: string;
  /** Recipe use over the judged windows (usage units) */
  recipe: number;
  /** Σ count difference over the judged rows (physical − calculated): < 0 = stock short */
  diff: number;
  /** recipe − diff */
  used: number;
  /** Waste recorded in the judged windows */
  waste: number;
  /** Received in the judged windows, usage units (from the kitchen + outside × converter) */
  received: number;
  /** Judged counts */
  counts: number;
  firstCount: string;
  lastCount: string;
  /** (used − recipe) ÷ recipe: > 0 = used more than the recipe ("ใช้เกิน") */
  pct: number;
  verdict: Verdict;
}

/** How far from the recipe still counts as near it */
export const NEAR_SHARE = 0.1;
/** Used more than this many times the recipe can't be real */
const BAD_TIMES = 3;

export function verdictOf(recipe: number, used: number): Verdict {
  if (used < 0 || used > BAD_TIMES * recipe || (recipe > 0 && Math.abs(used) < 1e-9)) return "bad";
  const pct = recipe > 0 ? (used - recipe) / recipe : 0;
  if (Math.abs(pct) < NEAR_SHARE) return "near";
  return pct > 0 ? "short" : "over";
}

export function cellsOf(counts: RcCount[], sales: RcSale[], p: { from: string; to: string }, skuById: Map<string, RcSku>): Map<string, Cell> {
  const days = new Set(daysBetween(p.from, p.to));
  // Judged on quantities: a price of 1 makes the shared rule's "recipe use above ฿0" mean
  // "recipe use above 0", so an item without a price is still compared
  const { rows } = judgedCountRows(counts, sales, days, () => 1);
  const out = new Map<string, Cell>();
  for (const j of rows) {
    const sku = j.row.sku_id;
    const conv = skuConverter(skuById.get(sku));
    const c = out.get(sku) ?? { branchId: j.row.branch_id, recipe: 0, diff: 0, used: 0, waste: 0, received: 0, counts: 0, firstCount: j.row.count_date, lastCount: j.row.count_date, pct: 0, verdict: "near" as Verdict };
    c.recipe += j.recipeQty;
    c.diff += Number(j.row.variance) || 0;
    for (const w of j.windowRows) {
      c.waste += Math.max(0, Number(w.waste) || 0);
      c.received += (Number(w.received_from_ck) || 0) + (Number(w.received_external) || 0) * conv;
    }
    c.counts++;
    if (j.row.count_date < c.firstCount) c.firstCount = j.row.count_date;
    if (j.row.count_date > c.lastCount) c.lastCount = j.row.count_date;
    out.set(sku, c);
  }
  for (const c of out.values()) {
    c.used = c.recipe - c.diff;
    c.pct = c.recipe > 0 ? (c.used - c.recipe) / c.recipe : 0;
    c.verdict = verdictOf(c.recipe, c.used);
  }
  return out;
}

// ─── Row label ───

export type Label = "bad" | "bom" | "shop" | "near" | "kitchen";

export const LABEL_TEXT: Record<Label, string> = {
  bad: "ข้อมูลนับผิด",
  bom: "หลายสาขาเหมือนกัน · เช็คสูตร",
  shop: "หน้าร้าน",
  near: "ใกล้สูตร",
  kitchen: "เช็คสูตรหรือการผลิต",
};

/**
 * น่าจะเป็น: a number that can't be real → ข้อมูลนับผิด; every branch with data off ≥10%
 * the same way (2 or more) → the recipe; one branch off, or branches off in opposite ways →
 * the shop; all within ±10% → near. The kitchen (one column) off → its recipe or production.
 */
export function labelOf(cells: Cell[], scope: "branches" | "kitchen" = "branches"): Label {
  if (cells.some((c) => c.verdict === "bad")) return "bad";
  const off = cells.filter((c) => c.verdict === "short" || c.verdict === "over");
  if (off.length === 0) return "near";
  if (scope === "kitchen") return "kitchen";
  if (cells.length >= 2 && off.length === cells.length && new Set(off.map((c) => c.verdict)).size === 1) return "bom";
  return "shop";
}

// ─── The table ───

export interface ServingBranch {
  branchId: string;
  menuName: string;
  /** Recipe per serving (usage units) */
  perServing: number;
  /** perServing × used ÷ recipe */
  actualPerServing: number | null;
  sold: number;
}

export interface RcRow {
  sku: RcSku;
  unit: string;
  price: number;
  cells: Map<string, Cell>;
  label: Label;
  /** Σ over branches |used − recipe| × price */
  gapBaht: number;
  serving: ServingBranch[];
}

export interface RcView {
  period: RcPeriod;
  branches: RcBranch[];
  days: BranchDays[];
  rows: RcRow[];
}

export interface RcInput {
  period: RcPeriod;
  branches: RcBranch[];
  counts: RcCount[];
  sales: RcSale[];
  skus: RcSku[];
  /** Active price per usage unit (0 when none) */
  price: (skuId: string) => number;
  menus: RcMenu[];
  bomLines: RcBomLine[];
}

export const gapBahtOf = (cells: Iterable<Cell>, price: number) => [...cells].reduce((t, c) => t + Math.abs(c.used - c.recipe) * price, 0);

/** Biggest baht gap first; ties by name */
export function sortRows<T extends { gapBaht: number; sku: { name: string } }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.gapBaht - a.gapBaht || a.sku.name.localeCompare(b.sku.name, "th"));
}

/** The branch's best-selling menu (in the period) whose recipe has the item, and its amount per serving */
export function servingFor(skuId: string, branch: RcBranch, sales: RcSale[], menus: RcMenu[], bomLines: RcBomLine[], cell: Cell | undefined, p: { from: string; to: string }): ServingBranch | null {
  const lines = bomLines.filter((l) => l.skuId === skuId && !l.deliveryOnly && (!l.branchId || l.branchId === branch.id));
  if (!lines.length) return null;
  const menuById = new Map(menus.map((m) => [m.id, m]));
  const perMenu = new Map<string, number>(); // menu id → per serving (the branch's own line wins)
  const own = new Set(lines.filter((l) => l.branchId === branch.id).map((l) => l.menuId));
  for (const l of lines) {
    if (own.has(l.menuId) && !l.branchId) continue;
    const m = menuById.get(l.menuId);
    if (!m || m.brandName !== branch.brandName) continue;
    perMenu.set(l.menuId, (perMenu.get(l.menuId) ?? 0) + (Number(l.effectiveQty) || 0));
  }
  if (!perMenu.size) return null;
  const idsByCode = new Map<string, string[]>();
  for (const id of perMenu.keys()) {
    const code = menuById.get(id)!.menuCode;
    idsByCode.set(code, [...(idsByCode.get(code) ?? []), id]);
  }
  const sold = new Map<string, number>();
  for (const s of sales) {
    if (s.branch_id !== branch.id || s.sale_date < p.from || s.sale_date > p.to) continue;
    for (const id of idsByCode.get(s.menu_code) ?? []) sold.set(id, (sold.get(id) ?? 0) + (Number(s.qty) || 0));
  }
  let best: string | null = null;
  for (const id of perMenu.keys()) if (best === null || (sold.get(id) ?? 0) > (sold.get(best) ?? 0)) best = id;
  if (!best || (sold.get(best) ?? 0) <= 0) return null;
  const per = perMenu.get(best)!;
  const ratio = cell && cell.recipe > 0 && cell.verdict !== "bad" ? cell.used / cell.recipe : null;
  return { branchId: branch.id, menuName: menuById.get(best)!.menuName, perServing: per, actualPerServing: ratio === null ? null : per * ratio, sold: sold.get(best) ?? 0 };
}

export function buildReconcile(input: RcInput): RcView {
  const { period, branches } = input;
  const skuById = new Map(input.skus.map((s) => [s.id, s]));
  const days: BranchDays[] = [];
  const perBranch = new Map<string, Map<string, Cell>>();
  for (const b of branches) {
    const counts = input.counts.filter((c) => c.branch_id === b.id);
    const sales = input.sales.filter((s) => s.branch_id === b.id);
    days.push(branchDaysOf(b.id, counts.filter((c) => c.count_date >= period.from), sales, period));
    perBranch.set(b.id, cellsOf(counts, sales, period, skuById));
  }
  const skuIds = new Set<string>();
  for (const m of perBranch.values()) for (const id of m.keys()) skuIds.add(id);
  const rows: RcRow[] = [];
  for (const id of skuIds) {
    const sku = skuById.get(id);
    if (!sku) continue;
    const cells = new Map<string, Cell>();
    for (const b of branches) {
      const c = perBranch.get(b.id)?.get(id);
      if (c) cells.set(b.id, c);
    }
    const price = input.price(id);
    const serving = branches.map((b) => servingFor(id, b, input.sales, input.menus, input.bomLines, cells.get(b.id), period)).filter((x): x is ServingBranch => x !== null);
    rows.push({ sku, unit: unitText(sku.usageUom), price, cells, label: labelOf([...cells.values()]), gapBaht: gapBahtOf(cells.values(), price), serving });
  }
  return { period, branches, days, rows: sortRows(rows) };
}

/** Rows to show: everything, or only those off by 10% or more somewhere (or with a bad number) */
export const onlyOff = (rows: RcRow[]) => rows.filter((r) => r.label !== "near");

// ─── The kitchen (counts monthly; worked out by the kitchen dashboard's own cost) ───

export interface KitchenLine {
  skuId: string;
  isRm: boolean;
  expected: number;
  actual: number | null;
}

/**
 * The kitchen dashboard's month cost, per raw material: recipe = Σ what the recipes made should
 * have used; used = what really left stock (opening + bought − closing − sent to branches), as
 * that cost works it out. Items missing from a count are taken as the recipe there, so they
 * can't be compared: left out (`uncounted`).
 */
export function kitchenRows(input: {
  lines: KitchenLine[];
  rmUsed: Map<string, number>;
  uncounted: Set<string>;
  skus: RcSku[];
  price: (skuId: string) => number;
  opening: string;
  closing: string;
}): RcRow[] {
  const skuById = new Map(input.skus.map((s) => [s.id, s]));
  const recipe = new Map<string, number>();
  for (const l of input.lines) if (l.isRm) recipe.set(l.skuId, (recipe.get(l.skuId) ?? 0) + (Number(l.expected) || 0));
  const rows: RcRow[] = [];
  for (const [id, r] of recipe) {
    const sku = skuById.get(id);
    if (!sku || r <= 0 || input.uncounted.has(id)) continue;
    const used = input.rmUsed.get(id) ?? 0;
    const cell: Cell = { branchId: "ck", recipe: r, diff: r - used, used, waste: 0, received: 0, counts: 2, firstCount: input.opening, lastCount: input.closing, pct: (used - r) / r, verdict: verdictOf(r, used) };
    const price = input.price(id);
    const cells = new Map([["ck", cell]]);
    rows.push({ sku, unit: unitText(sku.usageUom), price, cells, label: labelOf([cell], "kitchen"), gapBaht: gapBahtOf([cell], price), serving: [] });
  }
  return sortRows(rows);
}

// ─── Words ───

const n0 = (v: number) => Math.round(v).toLocaleString("th-TH");

/** A cell in one or two short parts: "ใช้เกิน 24%" + "+1,024 ก." (used − recipe) */
export function cellText(c: Cell | undefined, unit: string): { head: string; sub: string } | null {
  if (!c) return null;
  // Said from the recipe's side, grams = used − recipe ("ขาด/เกิน" would read as stock short/over: the opposite)
  const gap = c.used - c.recipe;
  const grams = `${gap > 0 ? "+" : gap < 0 ? "−" : ""}${n0(Math.abs(gap))} ${unit}`.trim();
  if (c.verdict === "bad") return { head: "นับผิด", sub: grams };
  if (c.verdict === "near") return { head: "ใกล้สูตร", sub: "" };
  const pct = `${Math.round(Math.abs(c.pct) * 100)}%`;
  // verdict "short" = stock came up short = used MORE than the recipe
  return { head: `${c.verdict === "short" ? "ใช้เกิน" : "ใช้น้อย"} ${pct}`, sub: grams };
}

const TH_MONTH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
export const thDay = (d: string) => `${Number(d.slice(8))} ${TH_MONTH[Number(d.slice(5, 7)) - 1]}`;

/** "2, 5 พ.ย." / "30 ต.ค., 2 พ.ย." — at most `max` days, then "+N" */
export function daysText(days: string[], max = 4): string {
  if (!days.length) return "";
  const shown = days.slice(0, max);
  const parts: string[] = [];
  for (let i = 0; i < shown.length; i++) {
    const d = shown[i];
    const sameMonthAsNext = i + 1 < shown.length && shown[i + 1].slice(0, 7) === d.slice(0, 7);
    parts.push(sameMonthAsNext ? String(Number(d.slice(8))) : thDay(d));
  }
  return parts.join(", ") + (days.length > max ? ` +${days.length - max}` : "");
}

/** "Thaniya ข้อมูล 7/7 วัน" · "Shiro ข้อมูล 3/7 วัน (ไม่มีใบนับ 2, 5 พ.ย.)" */
export function daysLine(name: string, d: BranchDays): string {
  const why = daysWhy(d);
  return `${name} ข้อมูล ${d.usable}/${d.total} วัน${why.length ? ` (${why.join(" · ")})` : ""}`;
}

/** Why days couldn't be used, one short phrase per reason */
export function daysWhy(d: BranchDays): string[] {
  const why: string[] = [];
  if (d.noSheet.length) why.push(`ไม่มีใบนับ ${daysText(d.noSheet)}`);
  if (d.early.length) why.push(`นับก่อนลงยอดขาย ${daysText(d.early)}`);
  if (d.noSales.length) why.push(`ไม่มียอดขาย ${daysText(d.noSales)}`);
  return why;
}

export const periodText = (p: RcPeriod) => (p.from.slice(0, 7) === p.to.slice(0, 7) ? `${Number(p.from.slice(8))}–${thDay(p.to)}` : `${thDay(p.from)} – ${thDay(p.to)}`);

// ─── Copy as a table ───

const tsvCell = (v: string | number) => String(v).replace(/[\t\r\n]+/g, " ");
const q = (v: number) => (Math.round(v * 10) / 10).toString();

/** Header + one line per item, tab-separated (pastes into a sheet as columns) */
export function toTsv(rows: RcRow[], cols: { id: string; name: string }[]): string {
  const head = ["วัตถุดิบ", "รหัส", "หน่วย", "น่าจะเป็น", "ห่างจากสูตร (บาท)"];
  for (const c of cols) head.push(`${c.name} ตามสูตร`, `${c.name} ใช้จริง`, `${c.name} ใช้เกินสูตร %`, `${c.name} ของเสีย`);
  const lines = [head.map(tsvCell).join("\t")];
  for (const r of rows) {
    const out: (string | number)[] = [r.sku.name, r.sku.code, r.unit, LABEL_TEXT[r.label], Math.round(r.gapBaht)];
    for (const c of cols) {
      const x = r.cells.get(c.id);
      if (!x) out.push("", "", "", "");
      else out.push(q(x.recipe), q(x.used), x.recipe > 0 ? `${Math.round(x.pct * 100)}` : "", q(x.waste));
    }
    lines.push(out.map(tsvCell).join("\t"));
  }
  return lines.join("\n");
}

// ─── Address ───

/**
 * Where a link into กระทบยอด opens: "#m/2026-10/s/kitchen/sku/RM-0009" (any part may be
 * left out). m = that month (else this week), s = kitchen (else branches), sku = only that item.
 */
export interface RcLink {
  month: string | null;
  kitchen: boolean;
  sku: string | null;
}

export function parseRcHash(hash: string): RcLink {
  const parts = hash.replace(/^#/, "").split("/");
  const out: RcLink = { month: null, kitchen: false, sku: null };
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const [k, v] = [parts[i], parts[i + 1]];
    if (k === "m" && /^\d{4}-\d{2}$/.test(v)) out.month = v;
    else if (k === "s") out.kitchen = v === "kitchen";
    else if (k === "sku" && v) out.sku = v;
  }
  return out;
}

export function rcHash(link: Partial<RcLink>): string {
  return [link.month && `m/${link.month}`, link.kitchen && "s/kitchen", link.sku && `sku/${link.sku}`].filter(Boolean).join("/");
}

/** How many months back from today's month a "yyyy-mm" is (0 = this month, never negative) */
export function monthsBack(today: string, month: string): number {
  const [ty, tm] = today.split("-").map(Number);
  const [y, m] = month.split("-").map(Number);
  return Math.max(0, (ty - y) * 12 + (tm - m));
}
