import { toLocalDateStr } from "@/lib/utils";

/**
 * Branch stock, kept apart from the screen so it can be tested.
 *
 * Balance = the product's anchor + what came in − what sales used − waste ± adjustments,
 * everything dated after the anchor day (CLAUDE.md pooled anchor; "Stock Count"
 * adjustments are the count itself and don't move stock again). The anchor is the count
 * sheet's: the latest count typed in within the last 5 weeks, else the latest sheet's
 * system figure (pickAnchors). The count sheet, branch stock and the request page all
 * start from it. Negative balances are shown as they are: they point at a missing receipt
 * or a recipe that uses too much (CLAUDE.md "Negative values").
 */

export interface AnchorRow {
  sku_id: string;
  count_date: string;
  physical_count: number | null;
  /** A sheet's calculated balance stands in: nothing was typed in the window */
  system?: boolean;
}
/** A count sheet row as read (typed count or not) */
export interface SheetCountRow {
  sku_id: string;
  count_date: string;
  physical_count: number | null;
  calculated_balance: number | null;
}
export interface ReceiptMove {
  sku_id: string;
  receipt_date: string;
  qty_received: number;
  transfer_order_id: string | null;
}
export interface AdjustmentMove {
  sku_id: string;
  adjustment_date: string;
  quantity: number;
  reason: string | null;
}
export interface WasteRow {
  sku_id: string;
  count_date: string;
  waste: number;
}

export interface BranchBalance {
  balance: number;
  /** Latest count typed in (null = none in the window) */
  countDate: string | null;
  countQty: number | null;
  /** The day the balance starts from: a typed count or a sheet's system figure (null = no sheet row in the window) */
  anchorDate: string | null;
  movesAfter: number;
}

const num = (v: unknown) => Number(v) || 0;

/** How far back a count still starts a balance: the count sheet's 5 weeks (Oct 2026: no months of sales per load) */
export const ANCHOR_DAYS = 35;

/** The days whose count rows can start the balance at the end of `day` (day included) */
export function anchorWindow(day: string): { from: string; to: string } {
  const d = new Date(`${day}T00:00:00`);
  d.setDate(d.getDate() - (ANCHOR_DAYS - 1));
  return { from: toLocalDateStr(d), to: day };
}

/**
 * Each product's anchor from its count rows in the window: the latest count typed in
 * (however old within the window), else — nothing typed — the latest row's calculated
 * balance, as it stands (negative included). The count sheet's rule since Oct 2026.
 * `untypedBefore`: untyped rows from this day on are left out — today's sheet worked its
 * figure out when it was opened, before the day's sales came in.
 */
export function pickAnchors(rows: SheetCountRow[], untypedBefore?: string): AnchorRow[] {
  const best = new Map<string, SheetCountRow>();
  for (const r of rows) {
    if (untypedBefore && r.physical_count === null && r.count_date >= untypedBefore) continue;
    const had = best.get(r.sku_id);
    const typed = r.physical_count !== null;
    const hadTyped = !!had && had.physical_count !== null;
    if (!had || (typed && !hadTyped) || (typed === hadTyped && r.count_date > had.count_date)) best.set(r.sku_id, r);
  }
  return [...best.values()].map((r) => (r.physical_count !== null ? { sku_id: r.sku_id, count_date: r.count_date, physical_count: num(r.physical_count) } : { sku_id: r.sku_id, count_date: r.count_date, physical_count: num(r.calculated_balance), system: true }));
}

/** The anchor per SKU from anchor rows (a typed count before a system figure, then the latest) */
export function latestCounts(rows: AnchorRow[]): Map<string, { date: string; qty: number; system: boolean }> {
  const out = new Map<string, { date: string; qty: number; system: boolean }>();
  for (const r of rows) {
    if (r.physical_count === null) continue;
    const had = out.get(r.sku_id);
    const system = !!r.system;
    if (!had || (had.system && !system) || (had.system === system && r.count_date > had.date)) out.set(r.sku_id, { date: r.count_date, qty: num(r.physical_count), system });
  }
  return out;
}

/** First day of sales and waste a read needs: the oldest anchor among the products asked for (null = all), else the daily-use week */
export function usageReadFrom(anchors: AnchorRow[], products: Set<string> | null, weekFrom: string): string {
  let from = weekFrom;
  for (const a of anchors) if ((!products || products.has(a.sku_id)) && a.count_date < from) from = a.count_date;
  return from;
}

export function branchBalances(input: {
  skuIds: string[];
  counts: AnchorRow[];
  receipts: ReceiptMove[];
  adjustments: AdjustmentMove[];
  waste: WasteRow[];
  /** Sales usage per SKU per day (usage-context-db usageOf().byDay) */
  usageByDay: Record<string, Record<string, number>>;
  /** Usage units per purchase unit for supplier receipts (1 when the units are the same) */
  converter: (skuId: string) => number;
  /**
   * A product with no anchor is on no sheet in the window (new, or not carried): it starts
   * at 0 with what came in or was moved from this day, and no sales usage or waste is
   * replayed — today's recipes on weeks of past sales invented use for things nobody
   * tracked (a new sauce opened at −13,000 g). Not given = everything read counts.
   */
  unanchoredFrom?: string;
}): Map<string, BranchBalance> {
  const anchor = latestCounts(input.counts);
  const out = new Map<string, BranchBalance>();
  const get = (id: string) => {
    let b = out.get(id);
    if (!b) {
      const a = anchor.get(id);
      const typed = a && !a.system;
      b = { balance: a?.qty ?? 0, countDate: typed ? a.date : null, countQty: typed ? a.qty : null, anchorDate: a?.date ?? null, movesAfter: 0 };
      out.set(id, b);
    }
    return b;
  };
  const u = input.unanchoredFrom;
  // In or moved: after the anchor day; with no anchor, from unanchoredFrom on
  const moved = (id: string, date: string) => {
    const a = anchor.get(id);
    return a ? date > a.date : !u || date >= u;
  };
  // Used or wasted: after the anchor day; with no anchor, not replayed
  const used = (id: string, date: string) => {
    const a = anchor.get(id);
    return a ? date > a.date : !u;
  };
  for (const id of input.skuIds) get(id);
  for (const r of input.receipts) {
    if (!moved(r.sku_id, r.receipt_date)) continue;
    const b = get(r.sku_id);
    // Kitchen transfers are already in usage units; supplier receipts are converted
    b.balance += num(r.qty_received) * (r.transfer_order_id ? 1 : input.converter(r.sku_id) || 1);
    b.movesAfter += 1;
  }
  for (const a of input.adjustments) {
    if ((a.reason ?? "").includes("Stock Count") || !moved(a.sku_id, a.adjustment_date)) continue;
    const b = get(a.sku_id);
    b.balance += num(a.quantity);
    b.movesAfter += 1;
  }
  for (const w of input.waste) {
    if (!used(w.sku_id, w.count_date)) continue;
    get(w.sku_id).balance -= num(w.waste);
  }
  for (const [id, days] of Object.entries(input.usageByDay)) {
    for (const [date, q] of Object.entries(days)) if (used(id, date)) get(id).balance -= q;
  }
  return out;
}

/**
 * The count sheet's opening for a day (use-daily-stock-count): each product's anchor
 * (pickAnchors on the rows the sheet read) plus what moved after it, by branchBalances.
 * The sheet used to floor this at 0 and drop waste typed on days the product wasn't
 * counted, so it started higher than the branch stock page showed for the day before.
 */
export function sheetOpening(input: {
  anchors: AnchorRow[];
  receipts: ReceiptMove[];
  adjustments: AdjustmentMove[];
  waste: WasteRow[];
  /** Sales usage: date → product → qty */
  usageByDate: Record<string, Record<string, number>>;
  converter: (skuId: string) => number;
  /** Products with no anchor take what came in or was moved from this day (the sheet's gap: the day after its earliest anchor) */
  unanchoredFrom: string;
}): Record<string, number> {
  const usageByDay: Record<string, Record<string, number>> = {};
  for (const [date, bySku] of Object.entries(input.usageByDate)) {
    for (const [id, q] of Object.entries(bySku)) {
      const d = (usageByDay[id] ??= {});
      d[date] = (d[date] || 0) + q;
    }
  }
  const out: Record<string, number> = {};
  for (const [id, b] of branchBalances({ skuIds: input.anchors.map((c) => c.sku_id), counts: input.anchors, receipts: input.receipts, adjustments: input.adjustments, waste: input.waste, usageByDay, converter: input.converter, unanchoredFrom: input.unanchoredFrom })) out[id] = b.balance;
  return out;
}

/** Usage units per purchase unit of a supplier receipt: only when the two units differ (the count sheet's rule) */
export const receiptConverter = (s: { purchaseUom?: string | null; usageUom?: string | null; converter?: number | null } | undefined) => (s && s.purchaseUom !== s.usageUom ? Number(s.converter) || 1 : 1);

export interface BranchFigure extends BranchBalance {
  /** (sales usage + waste) over the daily-use window ÷ selling days (lib/daily-use.ts) */
  dailyUse: number;
  /** The busiest day in the window (usage + waste); 0 when nothing was sold */
  peakDailyUse: number;
}

/**
 * Everything the branch stock page shows per item, in one place, so the request page
 * orders from the same numbers: the balance (branchBalances) and use per day over the
 * shared window. `usageByDay` must cover the window and the days since each count.
 */
export function branchFigures(input: {
  counts: AnchorRow[];
  receipts: ReceiptMove[];
  adjustments: AdjustmentMove[];
  waste: WasteRow[];
  usageByDay: Record<string, Record<string, number>>;
  /** Days in the window the branch sold anything */
  sellingDays: number;
  window: { from: string; to: string };
  converter: (skuId: string) => number;
  /** First day of the anchor window (see branchBalances) */
  unanchoredFrom?: string;
}): Map<string, BranchFigure> {
  const ids = new Set<string>();
  for (const r of [...input.counts, ...input.receipts, ...input.adjustments]) ids.add(r.sku_id);
  for (const id of Object.keys(input.usageByDay)) ids.add(id);
  const bal = branchBalances({ skuIds: [...ids], counts: input.counts, receipts: input.receipts, adjustments: input.adjustments, waste: input.waste, usageByDay: input.usageByDay, converter: input.converter, unanchoredFrom: input.unanchoredFrom });
  const inW = (d: string) => d >= input.window.from && d <= input.window.to;
  const wasteBy = new Map<string, Record<string, number>>();
  for (const w of input.waste) {
    if (!inW(w.count_date)) continue;
    const m = wasteBy.get(w.sku_id) ?? {};
    m[w.count_date] = (m[w.count_date] || 0) + num(w.waste);
    wasteBy.set(w.sku_id, m);
  }
  const out = new Map<string, BranchFigure>();
  for (const [id, b] of bal) {
    const day: Record<string, number> = { ...(wasteBy.get(id) ?? {}) };
    for (const [d, q] of Object.entries(input.usageByDay[id] ?? {})) if (inW(d)) day[d] = (day[d] || 0) + q;
    const values = Object.values(day);
    const total = values.reduce((t, q) => t + q, 0);
    const sold = input.sellingDays > 0;
    out.set(id, { ...b, dailyUse: sold ? total / input.sellingDays : 0, peakDailyUse: sold && values.length ? Math.max(...values) : 0 });
  }
  return out;
}

// ─── Moving stock: always both sides in one write ───

export type MoveKind = "branch" | "kitchen" | "waste" | "fix";

export interface MoveRow {
  branch_id: string | null;
  sku_id: string;
  adjustment_date: string;
  quantity: number;
  reason: string;
  stock_type: string;
}

/**
 * The stock_adjustments rows for one move. A move between places writes both
 * sides in one insert (all or nothing), so a transfer can never be left on one
 * side — the 23 Oct Thaniya "+50 จาก SHIRO" typed by hand had no Shiro side.
 */
export function moveRows(m: {
  kind: MoveKind;
  fromBranch: { id: string; name: string };
  toBranch?: { id: string; name: string };
  skuId: string;
  skuType: string;
  qty: number;
  /** For "fix": + adds, − takes off */
  sign?: 1 | -1;
  note: string;
  date: string;
}): MoveRow[] {
  const q = Math.abs(m.qty);
  const note = m.note.trim();
  const base = { sku_id: m.skuId, adjustment_date: m.date, stock_type: m.skuType };
  const withNote = (s: string) => (note ? `${s}: ${note}` : s);
  switch (m.kind) {
    case "branch":
      if (!m.toBranch || m.toBranch.id === m.fromBranch.id) throw new Error("เลือกสาขาปลายทาง");
      return [
        { ...base, branch_id: m.fromBranch.id, quantity: -q, reason: withNote(`โอนให้สาขาอื่น → ${m.toBranch.name}`) },
        { ...base, branch_id: m.toBranch.id, quantity: q, reason: withNote(`รับโอนจากสาขาอื่น → ${m.fromBranch.name}`) },
      ];
    case "kitchen":
      // The kitchen's own stock is the row with no branch
      return [
        { ...base, branch_id: m.fromBranch.id, quantity: -q, reason: withNote("ส่งคืนครัวกลาง") },
        { ...base, branch_id: null, quantity: q, reason: withNote(`รับคืนจากสาขา ${m.fromBranch.name}`) },
      ];
    case "waste":
      return [{ ...base, branch_id: m.fromBranch.id, quantity: -q, reason: withNote("ของเสีย / หมดอายุ") }];
    case "fix":
      if (!note) throw new Error("บอกเหตุผลที่แก้");
      return [{ ...base, branch_id: m.fromBranch.id, quantity: (m.sign ?? -1) * q, reason: `แก้ไขความผิดพลาด: ${note}` }];
  }
}
