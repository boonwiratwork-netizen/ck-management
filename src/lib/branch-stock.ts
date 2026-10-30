/**
 * Branch stock, kept apart from the screen so it can be tested.
 *
 * Balance = the latest finished count + what came in − what sales used − waste
 * ± adjustments, everything dated after the count day (CLAUDE.md pooled anchor;
 * "Stock Count" adjustments are the count itself and don't move stock again).
 * Negative balances are shown as they are: they point at a missing receipt or a
 * recipe that uses too much (CLAUDE.md "Negative values").
 */

export interface AnchorRow {
  sku_id: string;
  count_date: string;
  physical_count: number | null;
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
  /** Latest finished count (null = never counted: everything since the start counts) */
  countDate: string | null;
  countQty: number | null;
  movesAfter: number;
}

const num = (v: unknown) => Number(v) || 0;

/** Latest physical count per SKU (rows from finished count sheets) */
export function latestCounts(rows: AnchorRow[]): Map<string, { date: string; qty: number }> {
  const out = new Map<string, { date: string; qty: number }>();
  for (const r of rows) {
    if (r.physical_count === null) continue;
    const had = out.get(r.sku_id);
    if (!had || r.count_date > had.date) out.set(r.sku_id, { date: r.count_date, qty: num(r.physical_count) });
  }
  return out;
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
}): Map<string, BranchBalance> {
  const anchor = latestCounts(input.counts);
  const out = new Map<string, BranchBalance>();
  const get = (id: string) => {
    let b = out.get(id);
    if (!b) {
      const a = anchor.get(id);
      b = { balance: a?.qty ?? 0, countDate: a?.date ?? null, countQty: a?.qty ?? null, movesAfter: 0 };
      out.set(id, b);
    }
    return b;
  };
  const after = (id: string, date: string) => {
    const a = anchor.get(id);
    return !a || date > a.date;
  };
  for (const id of input.skuIds) get(id);
  for (const r of input.receipts) {
    if (!after(r.sku_id, r.receipt_date)) continue;
    const b = get(r.sku_id);
    // Kitchen transfers are already in usage units; supplier receipts are converted
    b.balance += num(r.qty_received) * (r.transfer_order_id ? 1 : input.converter(r.sku_id) || 1);
    b.movesAfter += 1;
  }
  for (const a of input.adjustments) {
    if ((a.reason ?? "").includes("Stock Count") || !after(a.sku_id, a.adjustment_date)) continue;
    const b = get(a.sku_id);
    b.balance += num(a.quantity);
    b.movesAfter += 1;
  }
  for (const w of input.waste) {
    if (!after(w.sku_id, w.count_date)) continue;
    get(w.sku_id).balance -= num(w.waste);
  }
  for (const [id, days] of Object.entries(input.usageByDay)) {
    for (const [date, q] of Object.entries(days)) if (after(id, date)) get(id).balance -= q;
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
