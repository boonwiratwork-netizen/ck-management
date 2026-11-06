import { shiftDay } from "@/lib/day-follow";
import { buildPriceAt, type PriceChange } from "@/lib/price-history";
import { usageContextOn, type RecipeCopy } from "@/lib/recipe-history";
import { usageContextFromApp, usageInputFromApp } from "@/lib/sale-usage";
import { computeStandard, priceOnOf, type FcSale, type UsageCorrection } from "@/lib/food-cost";
import { packsOf } from "@/lib/transfer-lines";
import {
  DEFAULT_TARGETS,
  bangkokDay,
  branchDayMarks,
  branchMetrics,
  branchTotals,
  chipWeeks,
  closedMonthFor,
  COUNTED_BEFORE_SALES,
  countCloseMark,
  countedBeforeSales,
  countedBeforeSalesDays,
  daysBetween,
  diffMark,
  monthCountOf,
  diffBaht,
  fillMarks,
  kitchenMetrics,
  monthStartOf,
  onDayMark,
  periodOf,
  planShare,
  planWeeksFor,
  previousPeriod,
  receiveMark,
  salesImportMark,
  scoreOf,
  type BranchDayMarks,
  type BranchInput,
  type BranchMetricId,
  type CountLine,
  type KitchenInput,
  type KitchenMetricId,
  type MetricValue,
  type Period,
  type PeriodKind,
  type PlanLine,
  type ProductionRun,
  type Score,
  type SupplierBill,
  type TeamTargets,
  type TransferLine,
  type TransferOrder,
} from "@/lib/team-score";
import type { SKU } from "@/types/sku";
import type { Price } from "@/types/price";
import type { Menu } from "@/types/menu";
import type { MenuBomLine } from "@/types/menu-bom";
import type { ModifierRule } from "@/types/modifier-rule";
import type { SpBomLine } from "@/types/sp-bom";
import type { Branch } from "@/types/branch";

/**
 * หน้าแรกผู้บริหาร, put together from the rows read once (hooks/use-admin-home.ts):
 * every team's metrics and score for a period, the 4 week chips, the things to look at
 * (ต้องดู) and the headline numbers. Pure, so switching วันนี้/สัปดาห์/เดือน never reads
 * again and every rule is tested.
 */

// ─── What is read ───

export type SaleRow = FcSale & { created_at: string };
export type CountRow = CountLine & { branch_id: string };

export interface AdminRaw {
  /** Bangkok day the rows were read for, and when */
  today: string;
  nowMs: number;
  /** Earliest day read */
  readFrom: string;
  sales: SaleRow[];
  counts: CountRow[];
  tos: TransferOrder[];
  toLines: TransferLine[];
  /** Branch receipts of transfer orders (only the order and when it was saved) */
  receipts: { transfer_order_id: string; created_at: string }[];
  plans: PlanLine[];
  production: ProductionRun[];
  bills: SupplierBill[];
  priceChanges: PriceChange[];
  recipeCopies: RecipeCopy[];
  corrections: UsageCorrection[];
}

export interface AdminMasters {
  skus: SKU[];
  prices: Price[];
  menus: Menu[];
  menuBomLines: MenuBomLine[];
  modifierRules: ModifierRule[];
  spBomLines: SpBomLine[];
  branches: Branch[];
}

/** First day to read: the start of last month (เดือน's comparison) or 4 weeks back, whichever is earlier */
export function readFromFor(today: string): string {
  const fourWeeks = shiftDay(today, -28);
  const lastMonth = monthStartOf(shiftDay(monthStartOf(today), -1));
  return fourWeeks < lastMonth ? fourWeeks : lastMonth;
}

/** Months whose kitchen cost the page needs: the last closed month of the period, its comparison, and each week chip */
export function costMonthsFor(today: string): string[] {
  const ps: { to: string }[] = [periodOf("today", today), periodOf("week", today), periodOf("month", today), ...chipWeeks(today)];
  ps.push(...(["today", "week", "month"] as PeriodKind[]).map((k) => previousPeriod(periodOf(k, today))));
  return [...new Set(ps.map(closedMonthFor))].sort();
}

// ─── Metric definitions (labels, targets, columns) ───

export type Format = "count" | "share" | "pct" | "signedPct" | "done";

export interface MetricDef<Id extends string> {
  id: Id;
  /** Plain words, one line on a phone (team page) */
  label: string;
  /** The target in words, under the label */
  target: (t: TeamTargets) => string;
  /** Home table column: one short word that fits a 52px column … */
  short: string;
  /** … and its target under it, just as short */
  shortTarget: (t: TeamTargets) => string;
  format: Format;
  /** Bullet scale: the target as a number on the value's scale */
  targetValue: (t: TeamTargets) => number;
  /** Lower is better (a ceiling) */
  lower?: boolean;
}

/** 23 → "5 ทุ่ม" (how people say evening hours); other hours as 15:00 */
export const thaiHour = (h: number) => (h >= 19 && h <= 23 ? `${h - 18} ทุ่ม` : `${h}:00`);
const pct = (share: number) => `${Math.round(share * 100)}%`;
const bahtShort = (n: number) => `฿${n.toLocaleString("en-US")}`;

export const BRANCH_METRICS: MetricDef<BranchMetricId>[] = [
  { id: "countOnTime", label: "นับสต๊อกเสร็จทันเวลา", target: (t) => `กดนับเสร็จก่อน ${thaiHour(t.countCloseHour)} · เป้า ทุกวัน`, short: "นับเสร็จ", shortTarget: (t) => `ก่อน ${thaiHour(t.countCloseHour)}`, format: "count", targetValue: (t) => t.countOnTimeShare },
  { id: "receive", label: "กดรับของจากครัวภายใน 1 วัน", target: (t) => (t.receiveShare >= 1 ? "เป้า ทุกใบ" : `เป้า ${pct(t.receiveShare)} ของใบโอน`), short: "รับของ", shortTarget: (t) => `ใน ${Math.round(t.receiveHours / 24)} วัน`, format: "count", targetValue: (t) => t.receiveShare },
  { id: "salesImport", label: "ลงยอดขายภายในวันถัดไป", target: () => "เป้า ทุกวัน", short: "ลงยอด", shortTarget: () => "ทุกวัน", format: "count", targetValue: (t) => t.salesImportShare },
  { id: "diff", label: "ของขาด/เกินจากระบบ ไม่เกิน ฿1,000", target: (t) => `นับแล้วต่างจากระบบไม่เกิน ${bahtShort(t.diffBahtPerDay)}/วัน · เป้า ${Math.round(t.diffPassShare * 7)} ใน 7 วัน`, short: "ขาด/เกิน", shortTarget: (t) => `≤${bahtShort(t.diffBahtPerDay)}`, format: "count", targetValue: (t) => t.diffPassShare },
  { id: "overRecipe", label: "ใช้ของเกินสูตร", target: (t) => `เทียบปริมาณตามสูตรจากยอดขาย · เกินได้ไม่เกิน ${t.overRecipePct}%`, short: "เกินสูตร", shortTarget: (t) => `≤${t.overRecipePct}%`, format: "signedPct", targetValue: (t) => t.overRecipePct, lower: true },
  { id: "waste", label: "ของเสีย เทียบยอดขาย", target: (t) => `มูลค่าของเสีย ÷ ยอดขาย · ไม่เกิน ${t.wastePct}%`, short: "ของเสีย", shortTarget: (t) => `≤${t.wastePct}%`, format: "pct", targetValue: (t) => t.wastePct, lower: true },
];

export const KITCHEN_METRICS: MetricDef<KitchenMetricId>[] = [
  { id: "onDay", label: "ส่งของตรงวันนัด", target: (t) => `เป้า ${pct(t.kitchenOnDayShare)} ของใบโอน`, short: "ส่งตรงวัน", shortTarget: (t) => pct(t.kitchenOnDayShare), format: "share", targetValue: (t) => t.kitchenOnDayShare },
  { id: "fill", label: "ส่งของครบตามที่สาขาขอ", target: (t) => `เป้า อย่างน้อย ${pct(t.kitchenFillShare)}`, short: "ส่งครบ", shortTarget: (t) => `≥${pct(t.kitchenFillShare)}`, format: "share", targetValue: (t) => t.kitchenFillShare },
  { id: "plan", label: "ผลิตได้ตามแผน", target: (t) => `เป้า อย่างน้อย ${pct(t.kitchenPlanShare)}`, short: "ตามแผน", shortTarget: (t) => `≥${pct(t.kitchenPlanShare)}`, format: "share", targetValue: (t) => t.kitchenPlanShare },
  { id: "monthCount", label: "นับสต๊อกครัวสิ้นเดือน", target: () => "เดือนที่ปิดแล้ว · ต้องนับครบ", short: "ปิดเดือน", shortTarget: () => "นับครบ", format: "done", targetValue: () => 1 },
  { id: "costGap", label: "ต้นทุนผลิตห่างจากสูตร", target: (t) => `เดือนที่ปิดแล้ว · ห่างได้ไม่เกิน ${t.kitchenCostGapPct}% ทั้งสูงและต่ำ`, short: "ต้นทุน", shortTarget: (t) => `±${t.kitchenCostGapPct}%`, format: "signedPct", targetValue: (t) => t.kitchenCostGapPct, lower: true },
  { id: "billOnDay", label: "ลงบิลรับของวันเดียวกัน", target: (t) => `เป้า อย่างน้อย ${pct(t.kitchenReceiptShare)}`, short: "ลงบิล", shortTarget: (t) => `≥${pct(t.kitchenReceiptShare)}`, format: "share", targetValue: (t) => t.kitchenReceiptShare },
];

export function formatMetric(v: MetricValue, f: Format): string {
  if (v.value === null) return "—";
  if (f === "count") return `${v.passed}/${v.total}`;
  if (f === "done") return v.value >= 1 ? "ครบ" : "ไม่ครบ";
  if (f === "share") return `${Math.round(v.value * 100)}%`;
  const abs = Math.abs(v.value);
  const s = abs >= 10 ? abs.toFixed(0) : abs.toFixed(1);
  if (f === "signedPct") return `${v.value > 0.05 ? "+" : v.value < -0.05 ? "−" : ""}${s}%`;
  return `${s}%`;
}

/** How far from the target, in words ("ขาด 2 วัน", "เกินมา 0.5%"); "" when met or unknown */
export function gapText(m: Pick<TeamMetric, "id" | "format" | "lower" | "targetValue" | "value">): string {
  const v = m.value;
  if (v.value === null || v.grade === "pass" || v.grade === null) return "";
  // Graded by counting (days or transfer orders), even when shown as a % → say how many short
  if ((m.format === "count" || m.format === "share") && v.total !== undefined && v.passed !== undefined) {
    const miss = Math.max(1, Math.ceil(v.total * m.targetValue - 1e-9) - v.passed);
    return `ขาด ${miss} ${m.id === "receive" || m.id === "onDay" || m.id === "fill" || m.id === "billOnDay" ? "ใบ" : "วัน"}`;
  }
  if (m.format === "share") return `ขาด ${Math.max(1, Math.round((m.targetValue - v.value) * 100))} จุด`;
  if (m.format === "done") return "ยังนับไม่ครบ";
  const over = Math.abs(v.value) - m.targetValue;
  return `เกินเป้ามา ${over >= 10 ? over.toFixed(0) : over.toFixed(1)}%`;
}

const VERDICT = { pass: "ถึงเป้า", near: "พลาดเป้านิดเดียว", fail: "ห่างเป้า" } as const;

/** The sentence shown when a cell is tapped: value · target · verdict (+ how far) */
export function explainMetric(m: TeamMetric): string {
  const v = m.value;
  if (v.value === null) return `${m.label}: ยังคิดไม่ได้ · ${v.why ?? "ข้อมูลยังไม่พอ"}`;
  const val =
    m.id === "overRecipe" && v.value < -0.05 ? `ใช้น้อยกว่าสูตร ${m.display.replace("−", "")}` : m.format === "count" ? `${v.passed} จาก ${v.total} ${m.id === "receive" ? "ใบ" : "วัน"}` : m.display;
  const gap = gapText(m);
  return `${m.label}: ${val} · ${m.targetText} · ${VERDICT[v.grade!]}${gap ? ` (${gap})` : ""}`;
}

// ─── Deep links ───

/** Where a button goes: a path (+hash), optional router state, and a page's remembered branch to set first */
export interface Go {
  path: string;
  hash?: string;
  state?: Record<string, unknown>;
  remember?: [string, string];
}
export const goCount = (branchId: string, date: string): Go => ({ path: "/daily-stock-count", state: { date }, remember: ["ck-count-branch", branchId] });
export const goSales = (branchId: string, date: string): Go => ({ path: "/sales-entry", hash: `day/${date}`, remember: ["ck-sales-branch", branchId] });
const goTransferHistory: Go = { path: "/transfer-order", hash: "history" };

// ─── Teams ───

export interface TeamMetric {
  id: string;
  label: string;
  /** Home table column word + its target */
  short: string;
  shortTarget: string;
  targetText: string;
  format: Format;
  lower: boolean;
  targetValue: number;
  value: MetricValue;
  prev: MetricValue;
  display: string;
}

export interface Attention {
  key: string;
  tone: "red" | "amber";
  title: string;
  detail: string;
  /** null = no baht figure (shown without one, never ฿0) */
  baht: number | null;
  action?: { label: string; go: Go };
}

export interface Team {
  id: string;
  kind: "kitchen" | "branch" | "rd";
  name: string;
  brand: string;
  metrics: TeamMetric[];
  score: Score;
  prevScore: Score;
  /** The last 4 weeks, oldest first */
  chips: Score[];
  /** This period's score − the period before's (null: one of them couldn't be judged) */
  delta: number | null;
  attention: Attention[];
  /** Branch: the last 7 days of the period, per day-level metric */
  days?: BranchDayMarks[];
  /** Kitchen: plan → produced → sent in full → received by branches */
  funnel?: { plan: number | null; fill: number | null; received: number | null };
}

export interface Kpi {
  key: string;
  label: string;
  sub: string;
  value: number | null;
  prev: number | null;
  /** null = no target (sales: compared with the period before only) */
  target: number | null;
  lower: boolean;
  format: "baht" | "pct";
  why?: string;
}

export interface AdminView {
  /** The Bangkok day the rows were read for */
  today: string;
  period: Period;
  teams: Team[];
  attention: Attention[];
  kpis: Kpi[];
}

// ─── Prepared once per read ───

export interface Prepared {
  raw: AdminRaw;
  branches: Branch[];
  priceOn: (skuId: string, day: string) => number;
  branchInput: Map<string, BranchInput>;
  kitchen: Omit<KitchenInput, "costGap">;
  skuName: (id: string) => string;
  skuCode: (id: string) => string;
  /** Recipe (standard) cost for sales of a span, all given branches */
  standard: (from: string, to: string, branchIds: string[]) => { revenue: number; stdCost: number; qty: Map<string, number> } | null;
  menusUsing: (skuId: string) => number;
}

export function prepare(raw: AdminRaw, m: AdminMasters): Prepared {
  const branches = m.branches.filter((b) => b.status === "Active");
  // Standard price = the newest active price row (the cost engine's rule), at the day's price from history
  const stdPrice = new Map<string, number>();
  for (const p of m.prices) if (p.isActive && !stdPrice.has(p.skuId)) stdPrice.set(p.skuId, p.pricePerUsageUom);
  const priceOn = priceOnOf(buildPriceAt(raw.priceChanges), stdPrice);

  const firstReceipt = new Map<string, string>();
  for (const r of raw.receipts) {
    const had = firstReceipt.get(r.transfer_order_id);
    if (!had || Date.parse(r.created_at) < Date.parse(had)) firstReceipt.set(r.transfer_order_id, r.created_at);
  }

  const branchInput = new Map<string, BranchInput>();
  for (const b of branches) branchInput.set(b.id, { counts: [], sales: [], tos: [], firstReceipt, priceOn });
  for (const c of raw.counts) branchInput.get(c.branch_id)?.counts.push(c);
  for (const s of raw.sales) branchInput.get(s.branch_id)?.sales.push({ sale_date: s.sale_date, created_at: s.created_at, net_amount: Number(s.net_amount) || 0 });
  for (const t of raw.tos) branchInput.get(t.branch_id)?.tos.push(t);

  const skuById = new Map(m.skus.map((s) => [s.id, s]));
  const ready = m.menus.length > 0 && m.skus.length > 0;
  const ctx = usageContextFromApp({ menus: m.menus, menuBomLines: m.menuBomLines, modifierRules: m.modifierRules, spBomLines: m.spBomLines, skus: m.skus });
  const ctxAt = raw.recipeCopies.length ? usageContextOn(usageInputFromApp(m), raw.recipeCopies) : undefined;
  const menuByCode = new Map(m.menus.map((x) => [x.menuCode, { code: x.menuCode, name: x.menuName, category: x.category }]));
  const skuInfo = new Map(m.skus.map((s) => [s.id, { id: s.id, code: s.skuId, name: s.name, type: s.type, uom: s.usageUom }]));
  const priceAt = buildPriceAt(raw.priceChanges);

  const standard = (from: string, to: string, ids: string[]) => {
    if (!ready || from > to) return null;
    const set = new Set(ids);
    const sales = raw.sales.filter((s) => set.has(s.branch_id) && s.sale_date >= from && s.sale_date <= to);
    const std = computeStandard({ sales, ctx, ctxAt, stdPrice, priceAt, menuByCode, skuById: skuInfo, corrections: raw.corrections, branchIds: set, from, to });
    return { revenue: std.revenue, stdCost: std.stdCost, qty: new Map(std.skus.map((s) => [s.skuId, s.stdQty])) };
  };

  // Active menus that use an item, directly or inside an SP
  const activeMenu = new Set(m.menus.filter((x) => x.status === "Active").map((x) => x.id));
  const spWith = new Map<string, Set<string>>();
  for (const l of m.spBomLines) {
    const s = spWith.get(l.ingredientSkuId) ?? new Set<string>();
    s.add(l.spSkuId);
    spWith.set(l.ingredientSkuId, s);
  }
  const menusUsing = (skuId: string) => {
    const items = new Set([skuId, ...(spWith.get(skuId) ?? [])]);
    return new Set(m.menuBomLines.filter((l) => items.has(l.skuId) && activeMenu.has(l.menuId)).map((l) => l.menuId)).size;
  };

  return {
    raw,
    branches,
    priceOn,
    branchInput,
    kitchen: {
      tos: raw.tos,
      lines: raw.toLines,
      firstReceipt,
      packSize: (id) => skuById.get(id)?.packSize ?? 0,
      plans: raw.plans,
      production: raw.production,
      bills: raw.bills,
    },
    skuName: (id) => skuById.get(id)?.name ?? "สินค้า",
    skuCode: (id) => skuById.get(id)?.skuId ?? "",
    standard,
    menusUsing,
  };
}

// ─── The view of a period ───

const baht = (n: number) => `฿${Math.round(Math.abs(n)).toLocaleString("th-TH")}`;
const thDay = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("th-TH", { weekday: "short", day: "numeric", month: "short" });

function teamMetrics<Id extends string>(defs: MetricDef<Id>[], now: Record<Id, MetricValue>, prev: Record<Id, MetricValue>, t: TeamTargets): TeamMetric[] {
  return defs.map((d) => ({
    id: d.id,
    label: d.label,
    short: d.short,
    shortTarget: d.shortTarget(t),
    // The plan week (or that it's information only) said under the label
    targetText: now[d.id].note ? `${now[d.id].note} · ${d.target(t)}` : d.target(t),
    format: d.format,
    lower: !!d.lower,
    targetValue: d.targetValue(t),
    value: now[d.id],
    prev: prev[d.id],
    display: formatMetric(now[d.id], d.format),
  }));
}

/** This period's score − the period before's (null: one of them couldn't be judged) */
const delta = (now: Score, before: Score) => (now.total > 0 && before.total > 0 ? now.score - before.score : null);

const toneRank = (a: Attention) => (a.tone === "red" ? 0 : 1);
/** Red first, then the bigger baht (no baht last) */
export const sortAttention = (list: Attention[]) => [...list].sort((a, b) => toneRank(a) - toneRank(b) || (b.baht ?? -1) - (a.baht ?? -1));

/** A branch's count difference on one day, with its biggest items */
function diffOf(p: Prepared, branchId: string, day: string) {
  const rows = (p.branchInput.get(branchId)?.counts ?? []).filter((r) => r.count_date === day && r.physical_count !== null);
  const total = diffBaht(rows, day, p.priceOn);
  const top = rows
    .map((r) => ({ id: r.sku_id, v: Math.abs(Number(r.variance) || 0) * p.priceOn(r.sku_id, day) }))
    .sort((a, b) => b.v - a.v)
    .slice(0, 3)
    .filter((x) => x.v > 0)
    .map((x) => p.skuName(x.id));
  return { total, top, counted: rows.length };
}

/** A process problem worth knowing: the sheet was finished before the day's sales came in, ≥2 days */
const earlyItem = (b: Branch, days: string[]): Attention => ({
  key: `early-${b.id}`,
  tone: "amber",
  title: `${b.branchName} ${COUNTED_BEFORE_SALES} ${days.length} วัน`,
  detail: `${days.map(thDay).join(" · ")} · ของขาด/เกิน และใช้เกินสูตรของวันนั้นจึงไม่ได้คิด ให้ลงยอดขายก่อนกดนับเสร็จ`,
  baht: null,
  action: { label: "ดูใบนับ", go: goCount(b.id, days[days.length - 1]) },
});

function branchAttention(p: Prepared, b: Branch, period: Period, t: TeamTargets): Attention[] {
  const input = p.branchInput.get(b.id)!;
  const now = p.raw.nowMs;
  const out: Attention[] = [];
  for (const day of daysBetween(period.from, period.to)) {
    const d = diffOf(p, b.id, day);
    // Only a judged day (a sheet still open before its deadline isn't one yet)
    const dayRows = input.counts.filter((r) => r.count_date === day);
    if (diffMark(dayRows, day, now, p.priceOn, t) === "fail" && !countedBeforeSales(dayRows, input.sales.filter((x) => x.sale_date === day)))
      out.push({ key: `diff-${day}`, tone: "red", title: `นับแล้วขาด/เกิน ${baht(d.total)} ${thDay(day)}`, detail: d.top.join(" · ") || "ดูรายการในใบนับ", baht: d.total, action: { label: "ดูใบนับ", go: goCount(b.id, day) } });
    const rows = input.counts.filter((r) => r.count_date === day);
    if (countCloseMark(rows, day, now, t) === "fail")
      out.push({ key: `close-${day}`, tone: "amber", title: rows.length && rows.every((r) => r.is_submitted) ? `นับเสร็จหลัง ${t.countCloseHour}:00 · ${thDay(day)}` : `ยังไม่กดนับเสร็จ · ${thDay(day)}`, detail: "ยอดคงเหลือวันถัดไปจะเริ่มจากใบที่ยังไม่ปิด", baht: null, action: { label: "ดูใบนับ", go: goCount(b.id, day) } });
    if (salesImportMark(input.sales.filter((s) => s.sale_date === day), day, now) === "fail") {
      const any = input.sales.some((s) => s.sale_date === day);
      out.push({ key: `sales-${day}`, tone: "amber", title: any ? `ลงยอดขายช้า · ${thDay(day)}` : `ยังไม่ลงยอดขาย · ${thDay(day)}`, detail: "ยอดใช้ตามสูตรของวันนั้นจะไม่ถูก", baht: null, action: { label: "ดูยอดขาย", go: goSales(b.id, day) } });
    }
  }
  const early = countedBeforeSalesDays(input, period);
  if (early.length >= 2) out.push(earlyItem(b, early));
  for (const to of input.tos) {
    if (!to.sent_at) continue;
    const day = bangkokDay(to.sent_at);
    const open = to.status === "Sent" && !input.firstReceipt.has(to.id);
    const mark = receiveMark(to, input.firstReceipt.get(to.id), now, t);
    if (mark !== "fail" || !(open || (day >= period.from && day <= period.to))) continue;
    const days = Math.floor((now - Date.parse(to.sent_at)) / 86_400_000);
    out.push({
      key: `to-${to.id}`,
      tone: open && days >= 3 ? "red" : "amber",
      title: open ? `${to.to_number} ยังไม่กดรับ ${days} วัน` : `${to.to_number} กดรับเกิน 1 วัน`,
      detail: `มูลค่า ${baht(Number(to.total_value) || 0)}${open ? " · สต๊อกสาขาจะไม่ตรง" : ""}`,
      baht: Number(to.total_value) || 0,
      action: { label: "ตามใบโอน", go: goTransferHistory },
    });
  }
  return sortAttention(out);
}

function kitchenAttention(p: Prepared, period: Period, today: string, t: TeamTargets, costGap: KitchenInput["costGap"]): Attention[] {
  const out: Attention[] = [];
  const branchName = new Map(p.branches.map((b) => [b.id, b.branchName]));
  for (const f of fillMarks(p.kitchen, period)) {
    if (!f.short) continue;
    const l = f.line;
    const pack = p.kitchen.packSize(l.sku_id);
    const asked = Number(l.planned_qty) || 0;
    const sent = pack > 1 ? packsOf({ packsCount: l.packs_count, actualQty: Number(l.actual_qty) || 0 }, pack) * pack : Number(l.actual_qty) || 0;
    const short = Math.max(0, asked - sent);
    out.push({
      key: `short-${l.to_id}-${l.sku_id}`,
      tone: "amber",
      title: `ส่ง${p.skuName(l.sku_id)}ให้ ${branchName.get(f.to.branch_id) ?? "สาขา"} ไม่ครบ`,
      detail: `ขาด ${short.toLocaleString("th-TH", { maximumFractionDigits: 1 })} ${l.uom}${Number(l.unit_cost) > 0 ? ` · ≈ ${baht(short * Number(l.unit_cost))}` : ""}`,
      baht: Number(l.unit_cost) > 0 ? short * Number(l.unit_cost) : null,
      action: { label: "ดูใบโอน", go: goTransferHistory },
    });
  }
  // Items made under 95% of their plan in the plan weeks judged for this period
  const { weeks, note } = planWeeksFor(period, today);
  const items = new Set(p.kitchen.plans.filter((l) => weeks.includes(l.week_start)).map((l) => l.sku_id));
  for (const sku of items) {
    const s = planShare(
      p.kitchen.plans.filter((l) => l.sku_id === sku),
      p.kitchen.production,
      weeks,
    );
    if (s.value === null || s.value >= t.kitchenPlanShare) continue;
    out.push({ key: `plan-${sku}`, tone: "amber", title: `${p.skuName(sku)} ผลิต ${Math.round(s.value * 100)}% ของแผน`, detail: note ?? "ตามแผนสัปดาห์", baht: null, action: { label: "ดูแผนผลิต", go: { path: "/production", hash: "plan" } } });
  }
  const month = closedMonthFor(period);
  const mc = monthCountOf({ costGap }, month, today);
  if (mc === "fail") {
    const label = new Date(`${month}T00:00:00`).toLocaleDateString("th-TH", { month: "short", year: "2-digit" });
    out.push({ key: "month-count", tone: "red", title: `นับครัวปิดเดือน ${label} ไม่ผ่าน`, detail: "ต้องนับวัตถุดิบอย่างน้อยครึ่งหนึ่งภายใน ±3 วันจากสิ้นเดือน ถึงคิดต้นทุนจริงได้", baht: null, action: { label: "ไปนับครัว", go: { path: "/stockcount" } } });
  }
  for (const to of p.kitchen.tos) {
    if (to.delivery_date < period.from || to.delivery_date > period.to || to.status === "Declined") continue;
    if (onDayMark(to, today) !== "fail") continue;
    out.push({ key: `late-${to.id}`, tone: "amber", title: `${to.to_number} ส่งช้ากว่ากำหนด`, detail: `${branchName.get(to.branch_id) ?? "สาขา"} · กำหนด ${thDay(to.delivery_date)}`, baht: Number(to.total_value) || null, action: { label: "ดูใบโอน", go: goTransferHistory } });
  }
  return sortAttention(out);
}

export function buildView(p: Prepared, kind: PeriodKind, costGap: KitchenInput["costGap"], t: TeamTargets = DEFAULT_TARGETS): AdminView {
  const { today, nowMs } = p.raw;
  const period = periodOf(kind, today);
  const prev = previousPeriod(period);
  const weeks = chipWeeks(today);
  const kIn: KitchenInput = { ...p.kitchen, costGap };

  const teams: Team[] = [];

  // The central kitchen
  {
    const now = kitchenMetrics(kIn, period, today, t);
    const before = kitchenMetrics(kIn, prev, today, t);
    const score = scoreOf(Object.values(now));
    const prevScore = scoreOf(Object.values(before));
    const chips = weeks.map((w) => scoreOf(Object.values(kitchenMetrics(kIn, w, today, t))));
    const fills = fillMarks(kIn, period);
    const sent = kIn.tos.filter((x) => x.sent_at && x.status !== "Draft" && x.status !== "Declined" && bangkokDay(x.sent_at) >= period.from && bangkokDay(x.sent_at) <= period.to);
    teams.push({
      id: "ck",
      kind: "kitchen",
      name: "ครัวกลาง",
      brand: "",
      metrics: teamMetrics(KITCHEN_METRICS, now, before, t),
      score,
      prevScore,
      chips,
      delta: delta(score, prevScore),
      attention: kitchenAttention(p, period, today, t, costGap),
      funnel: {
        plan: now.plan.value,
        fill: fills.length ? now.fill.value : null,
        received: sent.length ? sent.filter((x) => kIn.firstReceipt.has(x.id) || x.status === "Received" || x.status === "Partially Received").length / sent.length : null,
      },
    });
  }

  for (const b of p.branches) {
    const input = p.branchInput.get(b.id)!;
    const now = branchMetrics(input, period, nowMs, t);
    const before = branchMetrics(input, prev, nowMs, t);
    const score = scoreOf(Object.values(now));
    const prevScore = scoreOf(Object.values(before));
    const chips = weeks.map((w) => scoreOf(Object.values(branchMetrics(input, w, nowMs, t))));
    const last7 = { from: daysBetween(period.from, period.to).slice(-7)[0], to: period.to };
    teams.push({
      id: b.id,
      kind: "branch",
      name: b.branchName,
      brand: b.brandName,
      metrics: teamMetrics(BRANCH_METRICS, now, before, t),
      score,
      prevScore,
      chips,
      delta: delta(score, prevScore),
      attention: branchAttention(p, b, period, t),
      days: branchDayMarks(input, last7, nowMs, t),
    });
  }

  // RD: no data in the app yet — shown as such, never with numbers
  const empty: Score = { score: 0, total: 0, status: "none" };
  teams.push({ id: "rd", kind: "rd", name: "RD", brand: "", metrics: [], score: empty, prevScore: empty, chips: weeks.map(() => empty), delta: null, attention: [] });

  return { today, period, teams, attention: homeAttention(p, t), kpis: kpis(p, period, prev, t) };
}

// ─── ต้องดู (home) ───

export function homeAttention(p: Prepared, t: TeamTargets = DEFAULT_TARGETS): Attention[] {
  const { today, nowMs } = p.raw;
  const y = shiftDay(today, -1);
  const out: Attention[] = [];
  const branchName = new Map(p.branches.map((b) => [b.id, b.branchName]));

  // Yesterday's count difference over the limit
  for (const b of p.branches) {
    const d = diffOf(p, b.id, y);
    const rows = p.branchInput.get(b.id)!.counts.filter((r) => r.count_date === y);
    if (diffMark(rows, y, nowMs, p.priceOn, t) === "fail" && !countedBeforeSales(rows, p.branchInput.get(b.id)!.sales.filter((x) => x.sale_date === y)))
      out.push({ key: `diff-${b.id}`, tone: "red", title: `${b.branchName} นับแล้วขาด/เกิน`, detail: `เมื่อวาน${d.top.length ? ` · ${d.top.join(" ")}` : ""}`, baht: d.total, action: { label: "ดูใบนับ", go: goCount(b.id, y) } });
  }

  // Sheets finished before the sales came in, 2+ days of the last 7
  for (const b of p.branches) {
    const early = countedBeforeSalesDays(p.branchInput.get(b.id)!, { from: shiftDay(y, -6), to: y });
    if (early.length >= 2) out.push(earlyItem(b, early));
  }

  // Sent more than a day ago, not received
  for (const to of p.kitchen.tos) {
    if (to.status !== "Sent" || !to.sent_at || p.kitchen.firstReceipt.has(to.id) || !branchName.has(to.branch_id)) continue;
    const age = nowMs - Date.parse(to.sent_at);
    if (age <= t.receiveHours * 3_600_000) continue;
    const days = Math.floor(age / 86_400_000);
    out.push({ key: `to-${to.id}`, tone: days >= 3 ? "red" : "amber", title: `${branchName.get(to.branch_id) ?? "สาขา"} ยังไม่กดรับของ ${days} วัน`, detail: `ใบโอน ${to.to_number} · มูลค่า ${baht(Number(to.total_value) || 0)}`, baht: Number(to.total_value) || 0, action: { label: "ตามสาขา", go: goTransferHistory } });
  }

  // Standard price up ≥10% in the last 7 days (price_history), with the menus it's in
  const since = nowMs - 7 * 86_400_000;
  const bySku = new Map<string, PriceChange[]>();
  for (const c of p.raw.priceChanges) {
    const l = bySku.get(c.skuId) ?? [];
    l.push(c);
    bySku.set(c.skuId, l);
  }
  const week = p.standard(shiftDay(y, -6), y, p.branches.map((b) => b.id));
  for (const [sku, list] of bySku) {
    list.sort((a, b) => Date.parse(a.validFrom) - Date.parse(b.validFrom));
    const recent = list.filter((c) => Date.parse(c.validFrom) >= since);
    if (!recent.length) continue;
    const before = [...list].reverse().find((c) => Date.parse(c.validFrom) < since);
    const from = Number(before?.pricePerUsageUom);
    const to = Number(recent[recent.length - 1].pricePerUsageUom);
    if (!(from > 0) || !(to > 0)) continue;
    const rise = ((to - from) / from) * 100;
    if (rise < t.priceRisePct) continue;
    const menus = p.menusUsing(sku);
    const qty = week?.qty.get(sku) ?? 0;
    const perWeek = qty > 0 ? (to - from) * qty : null;
    out.push({
      key: `price-${sku}`,
      tone: "amber",
      title: `${p.skuName(sku)}ราคาขึ้น ${Math.round(rise)}%`,
      detail: `${menus} เมนู${perWeek !== null ? ` · ≈ ${baht(perWeek)}/สัปดาห์` : " · ยังไม่มียอดใช้ตามสูตร 7 วัน"}`,
      baht: perWeek,
      action: p.skuCode(sku) ? { label: "ดูเมนู", go: { path: "/cost-center", hash: `p/${encodeURIComponent(p.skuCode(sku))}` } } : undefined,
    });
  }
  return sortAttention(out);
}

// ─── Headline numbers ───

function kpis(p: Prepared, period: Period, prev: Period, t: TeamTargets): Kpi[] {
  const ids = p.branches.map((b) => b.id);
  const sum = (per: Period) => {
    let sales = 0;
    let waste = 0;
    const marks: ReturnType<typeof receiveMark>[] = [];
    for (const id of ids) {
      const input = p.branchInput.get(id)!;
      const tot = branchTotals(input, per);
      sales += tot.sales;
      waste += tot.waste;
      for (const to of input.tos) if (to.sent_at && bangkokDay(to.sent_at) >= per.from && bangkokDay(to.sent_at) <= per.to) marks.push(receiveMark(to, input.firstReceipt.get(to.id), p.raw.nowMs, t));
    }
    const judged = marks.filter((m) => m === "pass" || m === "fail");
    return { sales, waste, onTime: judged.length ? judged.filter((m) => m === "pass").length / judged.length : null };
  };
  const a = sum(period);
  const b = sum(prev);
  const hasSales = (per: Period) => p.raw.sales.some((s) => s.sale_date >= per.from && s.sale_date <= per.to);

  // Food cost by recipe, month to date (up to yesterday), against the same days of last month
  const y = shiftDay(p.raw.today, -1);
  const mFrom = monthStartOf(p.raw.today);
  const mtd = y >= mFrom ? p.standard(mFrom, y, ids) : null;
  const mPrev = previousPeriod({ kind: "month", from: mFrom, to: y >= mFrom ? y : mFrom });
  const before = p.standard(mPrev.from, mPrev.to, ids);
  const fc = (s: typeof mtd) => (s && s.revenue > 0 ? (s.stdCost / s.revenue) * 100 : null);

  const label = period.kind === "today" ? "วันนี้" : period.kind === "week" ? "สัปดาห์" : "เดือนนี้";
  return [
    { key: "sales", label: `ยอดขาย${label}`, sub: b.sales > 0 ? `ช่วงก่อน ${baht(b.sales)}` : "ช่วงก่อนไม่มียอด", value: hasSales(period) ? a.sales : null, prev: hasSales(prev) ? b.sales : null, target: null, lower: false, format: "baht", why: hasSales(period) ? undefined : "ยังไม่มียอดขายนำเข้าในช่วงนี้" },
    { key: "foodcost", label: "ต้นทุนอาหารตามสูตร", sub: `เดือนนี้ · เป้า ไม่เกิน ${t.foodCostPct}%`, value: fc(mtd), prev: fc(before), target: t.foodCostPct, lower: true, format: "pct", why: mtd === null ? (y < mFrom ? "ยังไม่มีวันที่จบของเดือนนี้" : "กำลังโหลดสูตร/เมนู") : mtd.revenue <= 0 ? "ยังไม่มียอดขายเดือนนี้" : undefined },
    { key: "waste", label: "ของเสีย เทียบยอดขาย", sub: `เป้า ไม่เกิน ${t.wastePct}%`, value: a.sales > 0 ? (a.waste / a.sales) * 100 : null, prev: b.sales > 0 ? (b.waste / b.sales) * 100 : null, target: t.wastePct, lower: true, format: "pct", why: a.sales > 0 ? undefined : "ไม่มียอดขายในช่วงนี้" },
    { key: "receive", label: "สาขากดรับของทันเวลา", sub: `ภายใน ${t.receiveHours} ชม. · เป้า ${Math.round(t.receiveShare * 100)}%`, value: a.onTime === null ? null : a.onTime * 100, prev: b.onTime === null ? null : b.onTime * 100, target: t.receiveShare * 100, lower: false, format: "pct", why: a.onTime === null ? "ไม่มีใบโอนที่ครบกำหนดรับในช่วงนี้" : undefined },
  ];
}

/** Plain text for LINE: the team's score, each metric and what pulled it down */
export function summaryText(team: Team, period: Period): string {
  const span = period.from === period.to ? thDay(period.from) : `${thDay(period.from)} – ${thDay(period.to)}`;
  const lines = [`${team.brand ? `${team.brand} · ` : ""}${team.name}`, `${span} · ตรงเป้า ${team.score.score}/${team.score.total}`];
  for (const m of team.metrics) lines.push(`- ${m.label}: ${m.display}${m.value.grade === "pass" ? " (ผ่าน)" : m.value.grade ? " (ไม่ถึงเป้า)" : ""}`);
  if (team.attention.length) {
    lines.push("", "เรื่องที่ต้องดู:");
    for (const a of team.attention.slice(0, 5)) lines.push(`- ${a.title}${a.detail ? ` (${a.detail})` : ""}`);
  }
  return lines.join("\n");
}
