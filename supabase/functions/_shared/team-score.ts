import { shiftDay } from "./day-math.ts";
import { kitchenSentShort } from "./transfer-short.ts";

// Shared by the app (src/lib/team-score.ts re-exports this file) and the Edge Functions
// (alerts-run). Plain TypeScript: no Deno, Node or browser APIs, relative imports only.

/**
 * Team score (หน้าแรกผู้บริหาร): each team — a branch, the central kitchen, RD — has a few
 * metrics with a target. score = how many metrics met their target in the period; the
 * status follows from how many missed (all or all−1 = ดี, −2 = ต้องดู, worse = มีปัญหา).
 *
 * Pure: every number here is worked out from rows handed in (lib/admin-home.ts reads them),
 * so each rule is tested on its own. A metric that can't be worked out is `null` with a
 * reason — never a made-up 0.
 *
 * Times: deadlines are absolute instants in Bangkok time (UTC+7, no daylight saving), so
 * the device's own time zone never moves a deadline.
 */

// ─── Targets (defaults; the owner will edit these in settings later) ───

export interface TeamTargets {
  /** นับปิดวันตรงเวลา: the daily count sheet finished before this hour (Bangkok) on its own day */
  countCloseHour: number;
  /** Share of days the count must close on time (1 = 7/7) */
  countOnTimeShare: number;
  /** A day's count difference Σ|variance| × price at most this many baht */
  diffBahtPerDay: number;
  /** Share of counted days within the difference (6/7) */
  diffPassShare: number;
  /** A transfer order received by the branch within this many hours of sending */
  receiveHours: number;
  receiveShare: number;
  /** Sales imported by the end of the next day: share of days */
  salesImportShare: number;
  /** Used more than the recipe, % of the recipe's baht (counted items) — at most */
  overRecipePct: number;
  /** Waste baht ÷ net sales, % — at most */
  wastePct: number;
  /** Kitchen: produced ÷ plan (each item capped at its plan) — at least */
  kitchenPlanShare: number;
  /** Kitchen: request lines sent in full — at least */
  kitchenFillShare: number;
  /** Kitchen: transfer orders sent on (or before) their delivery day — at least */
  kitchenOnDayShare: number;
  /** Kitchen: supplier bills entered on the day they came in — at least */
  kitchenReceiptShare: number;
  /** Kitchen: production cost over its recipes, last closed month, % — at most */
  kitchenCostGapPct: number;
  /** Food cost by recipe (all branches, month to date), % of sales — at most */
  foodCostPct: number;
  /** ต้องดู: an item's standard price up at least this % in the last 7 days */
  priceRisePct: number;
}

export const DEFAULT_TARGETS: TeamTargets = {
  countCloseHour: 23,
  countOnTimeShare: 1,
  diffBahtPerDay: 1000,
  diffPassShare: 6 / 7,
  receiveHours: 24,
  receiveShare: 1,
  salesImportShare: 1,
  overRecipePct: 3,
  wastePct: 2,
  kitchenPlanShare: 0.95,
  kitchenFillShare: 0.95,
  kitchenOnDayShare: 1,
  kitchenReceiptShare: 0.95,
  kitchenCostGapPct: 2,
  foodCostPct: 32,
  priceRisePct: 10,
};

// ─── Time ───

const HOUR = 3_600_000;
/** An instant: `day` at `hour`:00 in Bangkok */
export const bangkokAt = (day: string, hour: number) => Date.parse(`${day}T00:00:00+07:00`) + hour * HOUR;
/** The Bangkok calendar day of an instant (timestamp string or ms) */
export function bangkokDay(at: string | number): string {
  const ms = typeof at === "number" ? at : Date.parse(at);
  return new Date(ms + 7 * HOUR).toISOString().slice(0, 10);
}
export const daysBetween = (from: string, to: string): string[] => {
  const out: string[] = [];
  for (let d = from; d <= to; d = shiftDay(d, 1)) out.push(d);
  return out;
};
export const monthStartOf = (day: string) => `${day.slice(0, 7)}-01`;
/** The last day of the month before `day`'s month */
export const prevMonthEnd = (day: string) => shiftDay(monthStartOf(day), -1);
/** Monday of `day`'s week (the production plan's week_start) */
export function weekStartOf(day: string): string {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return shiftDay(day, dow === 0 ? -6 : 1 - dow);
}

// ─── Periods ───

export type PeriodKind = "today" | "week" | "month";
export interface Period {
  kind: PeriodKind;
  from: string;
  to: string;
}

/**
 * วันนี้ = today · สัปดาห์ = the 7 days ending yesterday · เดือน = this month up to
 * yesterday (today on the 1st, when nothing of the month has ended yet).
 */
export function periodOf(kind: PeriodKind, today: string): Period {
  const y = shiftDay(today, -1);
  if (kind === "today") return { kind, from: today, to: today };
  if (kind === "week") return { kind, from: shiftDay(y, -6), to: y };
  const start = monthStartOf(today);
  return { kind, from: start, to: y >= start ? y : today };
}

/** The period before: yesterday · the 7 days before · the same days of last month */
export function previousPeriod(p: Period): Period {
  if (p.kind === "today") return { kind: p.kind, from: shiftDay(p.from, -1), to: shiftDay(p.to, -1) };
  if (p.kind === "week") return { kind: p.kind, from: shiftDay(p.from, -7), to: shiftDay(p.to, -7) };
  const prevStart = monthStartOf(shiftDay(p.from, -1));
  const prevEnd = shiftDay(p.from, -1);
  const n = daysBetween(p.from, p.to).length;
  const to = shiftDay(prevStart, n - 1);
  return { kind: p.kind, from: prevStart, to: to < prevEnd ? to : prevEnd };
}

/** The last 4 weeks (7 days each, the newest ending yesterday), oldest first */
export function chipWeeks(today: string): Period[] {
  const y = shiftDay(today, -1);
  return [3, 2, 1, 0].map((k) => ({ kind: "week" as const, from: shiftDay(y, -6 - 7 * k), to: shiftDay(y, -7 * k) }));
}

// ─── Rows the metrics read ───

export interface CountLine {
  count_date: string;
  sku_id: string;
  physical_count: number | null;
  variance: number;
  waste: number;
  expected_usage: number;
  is_submitted: boolean;
  submitted_at: string | null;
}
export interface SaleLine {
  sale_date: string;
  created_at: string;
  net_amount: number;
}
export interface TransferOrder {
  id: string;
  branch_id: string;
  to_number: string;
  status: string;
  sent_at: string | null;
  delivery_date: string;
  total_value: number;
}
export interface TransferLine {
  to_id: string;
  sku_id: string;
  tr_line_id: string | null;
  planned_qty: number;
  actual_qty: number;
  packs_count: number | null;
  unit_cost: number;
  uom: string;
}
export interface PlanLine {
  week_start: string;
  sku_id: string;
  planned_qty_uom: number;
}
export interface ProductionRun {
  sm_sku_id: string;
  production_date: string;
  actual_output_g: number;
}
export interface SupplierBill {
  supplier_id: string;
  receipt_date: string;
  /** Earliest row saved for the bill */
  created_at: string;
}

// ─── One day / one item judged ───

/** pass · fail · pending (deadline not reached yet: left out) · none (nothing to judge: left out) */
export type DayMark = "pass" | "fail" | "pending" | "none";

const num = (v: unknown) => Number(v) || 0;

/**
 * นับปิดวันตรงเวลา, one day: the sheet's "นับเสร็จ" (daily_stock_counts.is_submitted +
 * submitted_at, written for every row of the sheet at once) before 23:00 Bangkok that day.
 * The latest submitted_at counts (unlocked and finished again = finished then). A sheet
 * finished without a time (rows from before submitted_at existed) can't be judged: none.
 */
export function countCloseMark(rows: CountLine[], day: string, nowMs: number, t: TeamTargets = DEFAULT_TARGETS): DayMark {
  const deadline = bangkokAt(day, t.countCloseHour);
  const open = rows.length === 0 || rows.some((r) => !r.is_submitted);
  if (open) return nowMs > deadline ? "fail" : "pending";
  const times = rows.map((r) => r.submitted_at).filter((x): x is string => !!x);
  if (times.length === 0) return "none";
  const last = Math.max(...times.map((x) => Date.parse(x)));
  return last <= deadline ? "pass" : "fail";
}

/** One day's count difference in baht: Σ |variance| × price over counted rows */
export function diffBaht(rows: CountLine[], day: string, priceOn: (skuId: string, day: string) => number): number {
  let total = 0;
  for (const r of rows) if (r.physical_count !== null) total += Math.abs(num(r.variance)) * priceOn(r.sku_id, day);
  return total;
}

/** diff นับ ≤ ฿1,000, one day: nothing counted → none; a sheet still open before its deadline → pending */
export function diffMark(rows: CountLine[], day: string, nowMs: number, priceOn: (skuId: string, day: string) => number, t: TeamTargets = DEFAULT_TARGETS): DayMark {
  const counted = rows.filter((r) => r.physical_count !== null);
  if (counted.length === 0) return nowMs > bangkokAt(day, t.countCloseHour) || rows.length === 0 ? "none" : "pending";
  if (rows.some((r) => !r.is_submitted) && nowMs <= bangkokAt(day, t.countCloseHour)) return "pending";
  return diffBaht(counted, day, priceOn) <= t.diffBahtPerDay ? "pass" : "fail";
}

/**
 * นำเข้ายอดขายภายในวันถัดไป, one day: the day's first sales row saved before the end of
 * the next day (Bangkok). No sales once that has passed = fail (a day closed for business
 * shows as missed — there is no "closed day" record to tell them apart).
 */
export function salesImportMark(sales: SaleLine[], day: string, nowMs: number): DayMark {
  const deadline = bangkokAt(shiftDay(day, 2), 0);
  if (sales.length === 0) return nowMs > deadline ? "fail" : "pending";
  const first = Math.min(...sales.map((s) => Date.parse(s.created_at)));
  return first <= deadline ? "pass" : "fail";
}

/**
 * รับของจากครัวภายใน 1 วัน, one transfer order: the branch's first receipt of it
 * (branch_receipts.transfer_order_id) within 24 h of sent_at. Declined orders and drafts
 * aren't judged; received without any receipt row (nothing to record) isn't either.
 */
export function receiveMark(to: TransferOrder, firstReceipt: string | undefined, nowMs: number, t: TeamTargets = DEFAULT_TARGETS): DayMark {
  if (!to.sent_at || to.status === "Draft" || to.status === "Declined") return "none";
  const deadline = Date.parse(to.sent_at) + t.receiveHours * HOUR;
  if (firstReceipt) return Date.parse(firstReceipt) <= deadline ? "pass" : "fail";
  if (to.status !== "Sent") return "none";
  return nowMs > deadline ? "fail" : "pending";
}

/** ส่งตรงวัน, one transfer order: sent (Bangkok day of sent_at) on or before its delivery day */
export function onDayMark(to: TransferOrder, today: string): DayMark {
  if (to.sent_at) return bangkokDay(to.sent_at) <= to.delivery_date ? "pass" : "fail";
  if (to.status === "Draft") return to.delivery_date < today ? "fail" : "pending";
  // Sent before sent_at was recorded: when is unknown
  return "none";
}

/** บันทึกรับของตรงวัน, one supplier bill: first row saved on (or before) the receipt day */
export const billMark = (b: SupplierBill): DayMark => (bangkokDay(b.created_at) <= b.receipt_date ? "pass" : "fail");

// ─── Metric values and grades ───

export type Grade = "pass" | "near" | "fail";
export type MetricKind = "count" | "share" | "max" | "done";

export interface MetricValue {
  /** null = can't be worked out (`why` says why) */
  value: number | null;
  /** count/share: how many passed, of how many judged */
  passed?: number;
  total?: number;
  grade: Grade | null;
  why?: string;
  /** What exactly was judged, when it isn't the period itself (e.g. the plan week) */
  note?: string;
}

const none = (why: string): MetricValue => ({ value: null, grade: null, why });

/** Days (or items) judged → passed/total; the target is a share of the judged ones (6/7 of 7 = 6) */
export function fromMarks(marks: DayMark[], share: number, emptyWhy: string): MetricValue {
  const judged = marks.filter((m) => m === "pass" || m === "fail");
  if (judged.length === 0) return none(emptyWhy);
  const passed = judged.filter((m) => m === "pass").length;
  const total = judged.length;
  const need = Math.ceil(total * share - 1e-9);
  const grade: Grade = passed >= need ? "pass" : passed >= need - 1 ? "near" : "fail";
  return { value: passed / total, passed, total, grade };
}

/** A share with a floor (≥ target): within 10 points below = near */
export function gradeShare(v: number, target: number): Grade {
  return v >= target - 1e-9 ? "pass" : v >= target - 0.1 ? "near" : "fail";
}
/** A % with a ceiling (≤ target): up to 1.5× the target = near */
export function gradeMax(v: number, target: number): Grade {
  return v <= target + 1e-9 ? "pass" : v <= target * 1.5 ? "near" : "fail";
}

// ─── Branch metrics ───

export type BranchMetricId = "countOnTime" | "receive" | "salesImport" | "diff" | "overRecipe" | "waste";
export type KitchenMetricId = "onDay" | "fill" | "plan" | "monthCount" | "costGap" | "billOnDay";
export type MetricId = BranchMetricId | KitchenMetricId;

export interface BranchInput {
  counts: CountLine[];
  sales: SaleLine[];
  /** Transfer orders to this branch */
  tos: TransferOrder[];
  /** Transfer order id → its first receipt's created_at */
  firstReceipt: Map<string, string>;
  priceOn: (skuId: string, day: string) => number;
}

const byDay = <T>(rows: T[], key: (r: T) => string) => {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const l = m.get(k);
    if (l) l.push(r);
    else m.set(k, [r]);
  }
  return m;
};

export const COUNTED_BEFORE_SALES = "นับก่อนลงยอดขาย";

/**
 * The day's sheet was finished before the day's first sales row was saved: its stored
 * expected use and difference were worked out with no sales, so neither diff nor
 * over-recipe can be judged on it. A sheet without a finish time can't tell: false.
 */
export function countedBeforeSales(rows: CountLine[], sales: SaleLine[]): boolean {
  const times = rows.filter((r) => r.is_submitted && r.submitted_at).map((r) => Date.parse(r.submitted_at as string));
  if (!times.length || !sales.length) return false;
  return Math.min(...sales.map((x) => Date.parse(x.created_at))) > Math.max(...times);
}

/** Days of the period whose sheet was finished before the sales came in */
export function countedBeforeSalesDays(input: Pick<BranchInput, "counts" | "sales">, p: { from: string; to: string }): string[] {
  const counts = byDay(input.counts, (r) => r.count_date);
  const sales = byDay(input.sales, (r) => r.sale_date);
  return daysBetween(p.from, p.to).filter((d) => countedBeforeSales(counts.get(d) ?? [], sales.get(d) ?? []));
}

export interface BranchDayMarks {
  day: string;
  countOnTime: DayMark;
  diff: DayMark;
  receive: DayMark;
  salesImport: DayMark;
}

/** Each day of the period, per day-level metric (the team page's dot grid) */
export function branchDayMarks(input: BranchInput, p: { from: string; to: string }, nowMs: number, t: TeamTargets = DEFAULT_TARGETS): BranchDayMarks[] {
  const counts = byDay(input.counts, (r) => r.count_date);
  const sales = byDay(input.sales, (r) => r.sale_date);
  const tosByDay = byDay(
    input.tos.filter((x) => x.sent_at),
    (x) => bangkokDay(x.sent_at as string),
  );
  return daysBetween(p.from, p.to).map((day) => {
    const rows = counts.get(day) ?? [];
    const daySales = sales.get(day) ?? [];
    // No sheet and no sales at all = the branch was closed that day: not judged either way
    // (sales but no sheet = a missed count; a sheet but no sales = a missed import)
    const closed = rows.length === 0 && daySales.length === 0;
    const toMarks = (tosByDay.get(day) ?? []).map((x) => receiveMark(x, input.firstReceipt.get(x.id), nowMs, t)).filter((m) => m !== "none");
    return {
      day,
      countOnTime: closed ? "none" : countCloseMark(rows, day, nowMs, t),
      // Counted before the day's sales came in: the saved difference has no recipe use in it
      diff: countedBeforeSales(rows, daySales) ? "none" : diffMark(rows, day, nowMs, input.priceOn, t),
      receive: toMarks.length === 0 ? "none" : toMarks.includes("fail") ? "fail" : toMarks.includes("pending") ? "pending" : "pass",
      salesImport: closed ? "none" : salesImportMark(daySales, day, nowMs),
    };
  });
}

export type BranchMetrics = Record<BranchMetricId, MetricValue>;

export function branchMetrics(input: BranchInput, p: { from: string; to: string }, nowMs: number, t: TeamTargets = DEFAULT_TARGETS): BranchMetrics {
  const days = new Set(daysBetween(p.from, p.to));
  const marks = branchDayMarks(input, p, nowMs, t);
  // Per order, not per day: 3 orders on one day are 3 chances
  const toMarks = input.tos.filter((x) => x.sent_at && days.has(bangkokDay(x.sent_at))).map((x) => receiveMark(x, input.firstReceipt.get(x.id), nowMs, t));

  const r = overRecipeAndWaste(input, days);
  const { over, recipe, waste, net, judgedRows: countedRows } = r;
  const saleRows = r.salesDays;

  const overRecipe: MetricValue =
    countedRows === 0 && r.early > 0 ? none(`${COUNTED_BEFORE_SALES} — ส่วนต่างของวันนั้นยังไม่ได้หักยอดใช้ตามสูตร`) : countedRows === 0 ? none("ไม่มีของที่นับซ้ำในช่วงนี้ (ต้องมียอดนับครั้งก่อนของรายการเดียวกัน และวันที่นับมียอดขาย)") : recipe <= 0 ? none("วันที่นับไม่มียอดใช้ตามสูตร (ยอดขายไม่ได้นำเข้า หรือเมนูยังไม่มีสูตร)") : { value: (over / recipe) * 100, grade: gradeMax((over / recipe) * 100, t.overRecipePct) };
  const wasteV: MetricValue = saleRows === 0 || net <= 0 ? none("ไม่มียอดขายในช่วงนี้") : { value: (waste / net) * 100, grade: gradeMax((waste / net) * 100, t.wastePct) };

  return {
    countOnTime: fromMarks(
      marks.map((m) => m.countOnTime),
      t.countOnTimeShare,
      "ยังไม่ถึงเวลาปิดวัน",
    ),
    receive: fromMarks(toMarks, t.receiveShare, "ไม่มีใบโอนส่งมาในช่วงนี้"),
    salesImport: fromMarks(
      marks.map((m) => m.salesImport),
      t.salesImportShare,
      "ยังไม่ถึงกำหนดนำเข้า (สิ้นวันถัดไป)",
    ),
    diff: fromMarks(
      marks.map((m) => m.diff),
      t.diffPassShare,
      r.early > 0 ? `ไม่มีวันที่นับให้ดู (${COUNTED_BEFORE_SALES} ${r.early} วัน)` : "ไม่มีวันที่นับในช่วงนี้",
    ),
    overRecipe,
    waste: wasteV,
  };
}

/** One counted row that can be judged against the recipe, with the window it covers */
export interface JudgedCountRow<T extends CountLine = CountLine> {
  row: T;
  /** The item's previous real count (the window runs from the day after it through row.count_date) */
  prevCount: string;
  /** This item's rows in the window (day after prevCount … row.count_date), the counted row last */
  windowRows: T[];
  /** Recipe use in the window: Σ expected_usage (≥ 0) on sales days, in usage units */
  recipeQty: number;
  /** The same in baht (each day at its own price) */
  recipeBaht: number;
  /** Price of the counted row's day */
  price: number;
}

/**
 * The counted rows of a period that can be judged against the recipe — one rule for the team
 * score (overRecipeAndWaste) and the per-item reconcile page (lib/reconcile.ts).
 *
 * A row's difference (variance) is the gap since the item's previous real count, so its recipe
 * base is the expected use summed from the day after that count through the counted day (sales
 * days only). Judged only when: there is an earlier count of the item in the rows read; every
 * day of the window with sales had a count sheet (else that day's expected use was never worked
 * out); the counted day is in `days`, had sales, and wasn't counted before its sales came in;
 * and the window's recipe use is above 0. Rows of every item may be passed together.
 */
export function judgedCountRows<T extends CountLine>(counts: T[], sales: Pick<SaleLine, "sale_date" | "created_at">[], days: Set<string>, priceOn: (skuId: string, day: string) => number): { rows: JudgedCountRow<T>[]; early: Set<string> } {
  const salesDays = new Set(sales.map((x) => x.sale_date));
  const sheetDays = new Set(counts.map((x) => x.count_date));
  const sorted = [...days].sort();
  const early = new Set(countedBeforeSalesDays({ counts, sales: sales as SaleLine[] }, { from: sorted[0] ?? "", to: sorted[sorted.length - 1] ?? "" }));
  const bySku = new Map<string, T[]>();
  for (const r of counts) {
    const l = bySku.get(r.sku_id);
    if (l) l.push(r);
    else bySku.set(r.sku_id, [r]);
  }
  const out: JudgedCountRow<T>[] = [];
  for (const list of bySku.values()) {
    const rows = [...list].sort((a, b) => a.count_date.localeCompare(b.count_date));
    let prevCount: string | null = null;
    let since = 0; // expected use (baht) on sales days after the previous count
    let sinceQty = 0;
    let windowRows: T[] = [];
    for (const r of rows) {
      const price = priceOn(r.sku_id, r.count_date);
      windowRows.push(r);
      if (salesDays.has(r.count_date)) {
        since += Math.max(0, num(r.expected_usage)) * price;
        sinceQty += Math.max(0, num(r.expected_usage));
      }
      if (r.physical_count === null) continue;
      // A day in the window with sales but no sheet at all: its expected use was never
      // worked out, so the window's recipe base is incomplete — the item isn't judged
      const gap = prevCount !== null && daysBetween(shiftDay(prevCount, 1), r.count_date).some((d) => salesDays.has(d) && !sheetDays.has(d));
      if (prevCount !== null && !gap && !early.has(r.count_date) && days.has(r.count_date) && salesDays.has(r.count_date) && since > 0)
        out.push({ row: r, prevCount, windowRows, recipeQty: sinceQty, recipeBaht: since, price });
      prevCount = r.count_date;
      since = 0;
      sinceQty = 0;
      windowRows = [];
    }
  }
  return { rows: out, early };
}

/**
 * Over-recipe and waste of a period, on days with sales imported only (a day with no sales
 * in has no recipe use, so its difference would read as "used more than the recipe").
 *
 * Over-recipe, per counted row: its variance is the gap since the item's previous real
 * count, so its recipe base is the expected use summed from the day after that count
 * through the counted day (sales days only). A row with no earlier count of the item in the
 * rows read isn't judged (its window is unknown). Items counted weekly work the same way.
 */
export function overRecipeAndWaste(input: BranchInput, days: Set<string>) {
  const salesDays = new Set(input.sales.map((x) => x.sale_date));
  const { rows: judged, early } = judgedCountRows(input.counts, input.sales, days, input.priceOn);
  let over = 0;
  let recipe = 0;
  for (const j of judged) {
    over += -num(j.row.variance) * j.price;
    recipe += j.recipeBaht;
  }
  const judgedRows = judged.length;
  let waste = 0;
  for (const r of input.counts) if (days.has(r.count_date) && salesDays.has(r.count_date)) waste += Math.max(0, num(r.waste)) * input.priceOn(r.sku_id, r.count_date);
  let net = 0;
  const inDays = new Set<string>();
  for (const x of input.sales)
    if (days.has(x.sale_date)) {
      net += num(x.net_amount);
      inDays.add(x.sale_date);
    }
  return { over, recipe, waste, net, judgedRows, salesDays: inDays.size, early: early.size };
}

/** Baht numbers behind a branch's period, for KPI totals */
export function branchTotals(input: BranchInput, p: { from: string; to: string }) {
  const days = new Set(daysBetween(p.from, p.to));
  let sales = 0;
  let waste = 0;
  for (const s of input.sales) if (days.has(s.sale_date)) sales += num(s.net_amount);
  const salesDays = new Set(input.sales.map((x) => x.sale_date));
  for (const r of input.counts) if (days.has(r.count_date) && salesDays.has(r.count_date)) waste += Math.max(0, num(r.waste)) * input.priceOn(r.sku_id, r.count_date);
  return { sales, waste };
}

// ─── Kitchen metrics ───

export interface KitchenInput {
  /** Every transfer order (all branches) */
  tos: TransferOrder[];
  lines: TransferLine[];
  firstReceipt: Map<string, string>;
  packSize: (skuId: string) => number;
  plans: PlanLine[];
  production: ProductionRun[];
  bills: SupplierBill[];
  /** Kitchen cost over recipe by month (yyyy-MM-01 → result); missing = still reading */
  costGap: Map<string, { pct: number | null; why?: string; count?: "pass" | "fail" | "none" }>;
}

const thShort = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("th-TH", { day: "numeric", month: "short", timeZone: "UTC" });
const weekLabel = (ws: string) => `จ.–ส. ${thShort(ws)}–${thShort(shiftDay(ws, 5))}`;
const isSaturday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay() === 6;

/**
 * Which plan weeks (Mondays) a period's ผลิตตามแผน judges. A plan week is Monday–Saturday
 * (the kitchen is closed on Sundays) and is judged once its Saturday is before today.
 * - สัปดาห์ (and each week chip): the plan week whose Saturday falls in the period — the
 *   most recent completed one
 * - เดือน: every completed plan week that started in the month; none yet → the last
 *   completed week of the month before (labelled so)
 * - วันนี้: none (today's progress is shown for information, see planToday)
 */
export function planWeeksFor(p: { from: string; to: string; kind?: PeriodKind }, today: string): { weeks: string[]; note: string | null } {
  if (p.kind === "today") return { weeks: [], note: null };
  if (p.kind === "month") {
    const start = monthStartOf(p.from);
    const weeks: string[] = [];
    for (let ws = weekStartOf(start) < start ? shiftDay(weekStartOf(start), 7) : start; ws <= p.to; ws = shiftDay(ws, 7)) if (shiftDay(ws, 5) < today) weeks.push(ws);
    if (weeks.length) return { weeks, note: weeks.length === 1 ? `สัปดาห์ผลิตที่จบแล้ว ${weekLabel(weeks[0])}` : `${weeks.length} สัปดาห์ผลิตที่จบแล้ว ${thShort(weeks[0])}–${thShort(shiftDay(weeks[weeks.length - 1], 5))}` };
    // None finished yet this month: the last one of the month before
    let ws = shiftDay(weekStartOf(start), weekStartOf(start) < start ? 0 : -7);
    while (shiftDay(ws, 5) >= today) ws = shiftDay(ws, -7);
    return { weeks: [ws], note: `เดือนนี้ยังไม่มีสัปดาห์ที่จบ · ใช้สัปดาห์ล่าสุดของเดือนก่อน ${weekLabel(ws)}` };
  }
  for (let d = p.to; d >= p.from; d = shiftDay(d, -1))
    if (isSaturday(d) && d < today) {
      const ws = shiftDay(d, -5);
      return { weeks: [ws], note: `สัปดาห์ผลิตล่าสุด ${weekLabel(ws)}` };
    }
  return { weeks: [], note: null };
}

/**
 * ผลิตตามแผน over whole plan weeks (weekly_plan_lines, grams per item per Monday week):
 * what was made Monday–Sunday of each week against its plan, each item capped at its plan
 * for the week, so over-making one item can't hide another short one.
 */
export function planShare(plans: PlanLine[], production: ProductionRun[], weekStarts: string[]): { value: number | null; planned: number; made: number } {
  const wanted = new Set(weekStarts);
  const weeks = new Map<string, Map<string, number>>();
  for (const l of plans) {
    if (!wanted.has(l.week_start)) continue;
    const w = weeks.get(l.week_start) ?? new Map<string, number>();
    w.set(l.sku_id, (w.get(l.sku_id) ?? 0) + num(l.planned_qty_uom));
    weeks.set(l.week_start, w);
  }
  let planned = 0;
  let made = 0;
  for (const [ws, items] of weeks) {
    const sun = shiftDay(ws, 6);
    for (const [sku, qty] of items) {
      if (qty <= 0) continue;
      const got = production.filter((r) => r.sm_sku_id === sku && r.production_date >= ws && r.production_date <= sun).reduce((s, r) => s + num(r.actual_output_g), 0);
      planned += qty;
      made += Math.min(got, qty);
    }
  }
  return { value: planned > 0 ? made / planned : null, planned, made };
}

/**
 * วันนี้ (information only, never judged): today's production against today's share of the
 * week's plan (a sixth: Monday–Saturday), each item capped. Sunday: the kitchen is closed.
 */
export function planToday(plans: PlanLine[], production: ProductionRun[], today: string): MetricValue {
  if (new Date(`${today}T00:00:00Z`).getUTCDay() === 0) return { value: null, grade: null, why: "วันอาทิตย์ครัวปิด" };
  const ws = weekStartOf(today);
  let planned = 0;
  let made = 0;
  for (const l of plans) {
    if (l.week_start !== ws || num(l.planned_qty_uom) <= 0) continue;
    const want = num(l.planned_qty_uom) / 6;
    const got = production.filter((r) => r.sm_sku_id === l.sku_id && r.production_date === today).reduce((s, r) => s + num(r.actual_output_g), 0);
    planned += want;
    made += Math.min(got, want);
  }
  if (planned <= 0) return { value: null, grade: null, why: "ไม่มีแผนผลิตของสัปดาห์นี้" };
  return { value: made / planned, grade: null, note: "ความคืบหน้าวันนี้ เทียบ 1/6 ของแผนสัปดาห์ · ดูเฉยๆ ไม่นับคะแนน" };
}

/** ส่งครบตามที่สาขาขอ: request lines (tr_line_id) of orders sent in the period, not sent short (kitchenSentShort) */
export function fillMarks(input: Pick<KitchenInput, "tos" | "lines" | "packSize">, p: { from: string; to: string }): { line: TransferLine; to: TransferOrder; short: boolean }[] {
  const sent = new Map(input.tos.filter((x) => x.sent_at && x.status !== "Draft" && bangkokDay(x.sent_at) >= p.from && bangkokDay(x.sent_at) <= p.to).map((x) => [x.id, x]));
  return input.lines
    .filter((l) => l.tr_line_id && sent.has(l.to_id))
    .map((l) => ({ line: l, to: sent.get(l.to_id)!, short: kitchenSentShort({ plannedQty: num(l.planned_qty), actualQty: num(l.actual_qty), packsCount: l.packs_count }, input.packSize(l.sku_id)) }));
}

/** The month a period's นับครัวปิดเดือน / ต้นทุนครัว is judged on: the last month that ended before its last day */
export const closedMonthFor = (p: { to: string }) => monthStartOf(prevMonthEnd(p.to));

export type KitchenMetrics = Record<KitchenMetricId, MetricValue>;

/** ผลิตตามแผน for a period: the plan weeks planWeeksFor picks; วันนี้ is information only */
export function planMetric(input: Pick<KitchenInput, "plans" | "production">, p: { from: string; to: string; kind?: PeriodKind }, today: string, t: TeamTargets = DEFAULT_TARGETS): MetricValue {
  if (p.kind === "today") return planToday(input.plans, input.production, today);
  const { weeks, note } = planWeeksFor(p, today);
  if (!weeks.length) return none("ยังไม่มีสัปดาห์ผลิต (จ.–ส.) ที่จบแล้ว");
  const ps = planShare(input.plans, input.production, weeks);
  if (ps.value === null) return { value: null, grade: null, why: `ไม่มีแผนผลิตของ${note ?? "สัปดาห์นี้"}`, note: note ?? undefined };
  return { value: ps.value, grade: gradeShare(ps.value, t.kitchenPlanShare), note: note ?? undefined };
}

/**
 * นับครัวปิดเดือน of a closed month, from the kitchen cost read (CkMonthGap.count) so it
 * uses the very same rule and base as the kitchen cost page. loading = that read isn't in
 * yet; pending = still inside the ±3-day window; none = nothing made that month.
 */
export function monthCountOf(input: Pick<KitchenInput, "costGap">, month: string, today: string): "pass" | "pending" | "fail" | "none" | "loading" {
  const end = shiftDay(monthStartOf(shiftDay(month, 32)), -1);
  const gap = input.costGap.get(month);
  if (gap?.count === "pass") return "pass";
  if (today <= shiftDay(end, 3)) return "pending";
  if (!gap || !gap.count) return "loading";
  return gap.count;
}

export function kitchenMetrics(input: KitchenInput, p: { from: string; to: string; kind?: PeriodKind }, today: string, t: TeamTargets = DEFAULT_TARGETS): KitchenMetrics {
  const inP = (d: string) => d >= p.from && d <= p.to;
  const onDay = fromMarks(
    input.tos.filter((x) => inP(x.delivery_date) && x.status !== "Declined").map((x) => onDayMark(x, today)),
    t.kitchenOnDayShare,
    "ไม่มีใบโอนที่ต้องส่งในช่วงนี้",
  );
  const fills = fillMarks(input, p);
  const fill: MetricValue = fills.length === 0 ? none("ไม่มีรายการจากใบขอเบิกที่ส่งในช่วงนี้") : (() => {
    const v = fills.filter((f) => !f.short).length / fills.length;
    return { value: v, passed: fills.filter((f) => !f.short).length, total: fills.length, grade: gradeShare(v, t.kitchenFillShare) };
  })();
  const plan = planMetric(input, p, today, t);
  const bills = input.bills.filter((b) => inP(b.receipt_date)).map(billMark);
  const billV = fromMarks(bills, t.kitchenReceiptShare, "ไม่มีบิลรับของเข้าครัวในช่วงนี้");
  // fromMarks grades a share target by count; this one is a % target
  const billOnDay: MetricValue = billV.value === null ? billV : { ...billV, grade: gradeShare(billV.value, t.kitchenReceiptShare) };

  // Month-end count of the last closed month: a finished session within ±3 days of its last
  // day that counted at least half of the RM items (the kitchen dashboard's rule)
  const month = closedMonthFor(p);
  const mc = monthCountOf(input, month, today);
  const monthCount: MetricValue =
    mc === "pass" ? { value: 1, grade: "pass" } : mc === "fail" ? { value: 0, grade: "fail" } : none(mc === "pending" ? "ยังอยู่ในช่วงนับปลายเดือน (±3 วัน)" : mc === "none" ? "เดือนนั้นไม่มีการผลิต" : "กำลังตรวจการนับปลายเดือน");

  const gap = input.costGap.get(month);
  const costGap: MetricValue = !gap ? none("กำลังคิดต้นทุนครัวของเดือนที่ปิดแล้ว") : gap.pct === null ? none(gap.why ?? "คิดต้นทุนครัวเดือนนี้ไม่ได้") : { value: gap.pct, grade: gradeMax(Math.abs(gap.pct), t.kitchenCostGapPct) }; // ≤2% either way; shown signed

  return { onDay, fill, plan, monthCount, costGap, billOnDay };
}

// ─── Score and status ───

export type Status = "good" | "watch" | "bad" | "none";

export interface Score {
  /** Metrics that met their target */
  score: number;
  /** Metrics that could be judged (a "—" one is left out) */
  total: number;
  status: Status;
}

export function scoreOf(metrics: MetricValue[]): Score {
  const judged = metrics.filter((m) => m.grade !== null);
  const score = judged.filter((m) => m.grade === "pass").length;
  const total = judged.length;
  return { score, total, status: statusOf(score, total) };
}

/**
 * ดี = all met, or one missed of 3 or more · มีปัญหา = every one missed, or 3+ missed ·
 * ต้องดู = in between (with 1–2 metrics judged any miss is at least ต้องดู) · none = nothing judged
 */
export function statusOf(score: number, total: number): Status {
  if (total === 0) return "none";
  const missed = total - score;
  if (missed === 0 || (missed === 1 && total >= 3)) return "good";
  if (missed === total || missed >= 3) return "bad";
  return "watch";
}

export const STATUS_LABEL: Record<Status, string> = { good: "ดี", watch: "ต้องดู", bad: "มีปัญหา", none: "ยังไม่มีข้อมูล" };
