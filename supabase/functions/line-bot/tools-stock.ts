// The LINE bot's stock, run-rate, option-rule and transfer tools. Every number is worked out
// with the app's own code (_shared/branch-stock.ts branchFigures, _shared/daily-use.ts,
// _shared/kitchen-stock.ts, _shared/sale-usage.ts); the model only picks the tool.
// Plain TypeScript, relative imports only (Deno in the Edge Function, Node in the tests).

import { addSaleUsage, isDeliverySale, type UsageContext } from "../_shared/sale-usage.ts";
import { ruleMatchesSale } from "../_shared/modifier-rules.ts";
import { branchFigures, receiptConverter, type AdjustmentMove, type AnchorRow, type ReceiptMove, type WasteRow } from "../_shared/branch-stock.ts";
import { branchUsePerDay, dailyUseWindow, totalPerDay, type BranchSaleRow, type BranchWasteRow } from "../_shared/daily-use.ts";
import { kitchenUsePerDay, USAGE_WINDOW_DAYS } from "../_shared/kitchen-stock.ts";
import { priceOnOf } from "../_shared/food-cost.ts";
import { matchSku, norm, periodOf, resolveBranches, shiftDay, thDay, type Masters, type NamedPeriod, type Store, type ToolResult } from "./tools.ts";

// ─── What the stock tools read (data.ts; a fake in the tests) ───

/** One branch's stock inputs, as the store stock page reads them (hooks/use-branch-stock.ts) */
export interface BranchStockInput {
  counts: AnchorRow[];
  receipts: ReceiptMove[];
  adjustments: AdjustmentMove[];
  waste: WasteRow[];
  /** Sales usage per item per day since the oldest anchor, and over the daily-use week */
  usageByDay: Record<string, Record<string, number>>;
  sellingDays: number;
  unanchoredFrom?: string;
}
export interface TransferLineRow {
  to_id: string;
  sku_id: string;
  planned_qty: number;
  actual_qty: number;
  unit_cost: number;
  line_value: number;
}
export interface TransferOrderRow {
  id: string;
  branch_id: string;
  delivery_date: string;
  status: string;
}
export interface StockStore {
  branchStock(branchId: string, products: Set<string> | null): Promise<BranchStockInput>;
  kitchenStock(ids: string[]): Promise<Record<string, number>>;
  /** The kitchen's own adjustment rows (no branch) of these items since a day */
  kitchenAdjustments(ids: string[], from: string, to: string): Promise<{ sku_id: string; adjustment_date: string; quantity: number; reason: string | null }[]>;
  /** Every branch's sales and waste (with what went into WIPs) over a window: the kitchen's SM demand */
  branchWeek(from: string, to: string): Promise<{ sales: BranchSaleRow[]; waste: BranchWasteRow[] }>;
  /** The kitchen's last completed count day (null = none) */
  kitchenLastCount(): Promise<string | null>;
  transfers(branchIds: string[], from: string, to: string): Promise<{ orders: TransferOrderRow[]; lines: TransferLineRow[] }>;
}
export type FullStore = Store & { stock: StockStore };

const n = (v: unknown) => Number(v) || 0;
const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;
const baht = (v: number) => Math.round(v).toLocaleString("en-US");
const baht2 = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const unitText = (u: string) => {
  const k = (u ?? "").trim().toLowerCase();
  if (["g", "gram", "grams", "กรัม", "ก."].includes(k)) return "ก.";
  if (["ml", "มล."].includes(k)) return "มล.";
  return u ?? "";
};
/** An amount said the way people read it: kilos / litres from 1,000 up */
export const amount = (v: number, uom: string) => {
  const u = unitText(uom);
  if (u === "ก." && Math.abs(v) >= 1000) return `${r1(v / 1000)} กก.`;
  if (u === "มล." && Math.abs(v) >= 1000) return `${r1(v / 1000)} ลิตร`;
  return `${r1(v)} ${u}`.trim();
};
const daysText = (d: number | null) => (d === null ? "–" : d >= 100 ? "100+ วัน" : `${r1(d)} วัน`);

/** The items a name points at (the close ones only), or null = every item */
function itemsFor(m: Masters, query: string | null | undefined, types: string[]): { ids: Set<string> | null; names: string[] } {
  if (!query) return { ids: null, names: [] };
  const pool = m.skus.filter((s) => s.active && types.includes(s.type));
  const found = matchSku(pool, query, 5, 0.4);
  const close = found.filter((h) => h.score >= (found[0]?.score ?? 0) - 0.1);
  return { ids: new Set(close.map((h) => h.item.id)), names: close.map((h) => h.item.name) };
}

// ─── 11. Store stock and days left ───

/** The store stock page's "สต๊อกน้อย": under this many days left */
export const STORE_LOW_DAYS = 2;

export async function branchStock(store: FullStore, args: { item?: string | null; branch?: string | null; low_within_days?: number | null; cover_days?: number | null }): Promise<ToolResult> {
  const m = await store.masters();
  const br = resolveBranches(m, args.branch);
  const branches = m.branches.filter((b) => br.ids.includes(b.id) && b.active !== false);
  const want = itemsFor(m, args.item, ["RM", "SM", "WIP"]);
  if (args.item && !want.ids?.size) return { data: { found: false, query: args.item, note: "ไม่พบวัตถุดิบชื่อนี้ในระบบ" } };
  const skuOf = new Map(m.skus.map((s) => [s.id, s]));
  const within = n(args.low_within_days) > 0 ? n(args.low_within_days) : STORE_LOW_DAYS;
  const cover = n(args.cover_days) > 0 ? n(args.cover_days) : null;
  const window = dailyUseWindow(m.today);
  type Row = { branch: string; item: string; uom: string; balance: number; known: boolean; countDate: string | null; perDay: number; daysLeft: number | null; order: number | null };
  const rows: Row[] = [];
  const inputs = await Promise.all(branches.map((b) => store.stock.branchStock(b.id, want.ids)));
  for (const [i, b] of branches.entries()) {
    const d = inputs[i];
    // Supplier receipts in usage units by the count sheet's rule (the store stock page's converter)
    const converter = (id: string) => {
      const s = skuOf.get(id);
      return receiptConverter(s ? { purchaseUom: s.purchaseUom, usageUom: s.uom, converter: s.converter } : undefined);
    };
    const figures = branchFigures({ ...d, window, converter });
    for (const [id, f] of figures) {
      const sku = skuOf.get(id);
      // The store stock page's items: ingredients, kitchen-made items and the branch's own WIPs
      if (!sku || !["RM", "SM", "WIP"].includes(sku.type) || (want.ids && !want.ids.has(id))) continue;
      const known = f.anchorDate !== null;
      const daysLeft = known && f.dailyUse > 0 ? Math.max(0, f.balance) / f.dailyUse : null;
      // Not counted in 5 weeks: nothing known on hand, so the order covers the whole need (the request page's rule)
      const onHand = known ? Math.max(0, f.balance) : 0;
      rows.push({ branch: b.name, item: sku.name, uom: sku.uom, balance: f.balance, known, countDate: f.countDate, perDay: f.dailyUse, daysLeft, order: cover !== null && f.dailyUse > 0 ? Math.max(0, f.dailyUse * cover - onHand) : null });
    }
  }
  // An item asked for: every branch's line. Otherwise what runs out soonest (or has run out)
  const asked = !!args.item;
  const shown = asked
    ? rows.sort((a, b) => a.item.localeCompare(b.item, "th") || a.branch.localeCompare(b.branch))
    : rows.filter((r) => r.known && r.perDay > 0 && (r.balance <= 0 || (r.daysLeft !== null && r.daysLeft < within))).sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0));
  const stale = rows.filter((r) => (asked || r.perDay > 0) && r.known && r.countDate && r.countDate < shiftDay(m.today, -7));
  const unknown = rows.filter((r) => !r.known && (asked || r.perDay > 0));
  const notes = [
    "คงเหลือ = นับล่าสุด + ของเข้า − ที่ใช้ตามสูตร − ของเสีย (เหมือนหน้าสต๊อกหน้าร้าน) · ใช้ต่อวัน = เฉลี่ย 7 วันล่าสุดตามวันที่ขาย",
    ...(stale.length ? [`นับล่าสุดเกิน 7 วัน ${stale.length} รายการ ตัวเลขอาจคลาด`] : []),
    ...(unknown.length ? [`ไม่ได้นับใน 5 สัปดาห์ ${unknown.length} รายการ ไม่รู้ยอดคงเหลือ`] : []),
    ...(cover !== null ? [`ควรขอเบิก = ใช้ต่อวัน × ${cover} วัน − คงเหลือ (ไม่ได้นับ = ถือว่าไม่มีของ) · ยังไม่หักใบขอเบิกที่ค้างอยู่ และไม่ปัดเป็นแพ็ค`] : []),
    ...(br.unknown ? [`ไม่รู้จักสาขา "${br.unknown}" เลยใช้ทุกสาขา`] : []),
  ];
  return {
    data: {
      mode: asked ? "items" : `ใกล้หมด (เหลือไม่ถึง ${within} วัน)`,
      matched_items: want.names,
      rows: shown.slice(0, 30).map((r) => ({
        branch: r.branch,
        item: r.item,
        balance: r.known ? amount(r.balance, r.uom) : "ไม่รู้ (ไม่ได้นับ)",
        last_count: r.countDate,
        per_day: amount(r.perDay, r.uom),
        days_left: r.daysLeft === null ? null : r1(r.daysLeft),
        ...(cover !== null ? { order_for_cover: r.order === null ? null : amount(r.order, r.uom) } : {}),
      })),
      notes,
    },
    card: shown.length
      ? {
          title: asked ? `สต๊อกหน้าร้าน · ${want.names.slice(0, 2).join(", ")}` : `ของใกล้หมดหน้าร้าน (ไม่ถึง ${within} วัน)`,
          subtitle: `${br.label} · ณ วันนี้ ${thDay(m.today)}`,
          columns: cover !== null ? ["สาขา · ของ", "เหลือ / วันละ", "ควรสั่ง"] : ["สาขา · ของ", "เหลือ / วันละ", "อยู่ได้"],
          rows: shown.slice(0, 20).map((r) => [
            `${r.branch} · ${r.item}`,
            r.known ? `${amount(r.balance, r.uom)} / ${amount(r.perDay, r.uom)}` : "ไม่ได้นับ",
            cover !== null ? (r.order === null ? "–" : amount(r.order, r.uom)) : r.known && r.balance <= 0 && r.perDay > 0 ? "หมด" : daysText(r.daysLeft),
          ]),
          notes,
        }
      : undefined,
  };
}

// ─── 12. Kitchen stock and days left ───

/** The kitchen stock page's "ใกล้หมด": under this many days left (lib/kitchen-stock-view.ts) */
export const KITCHEN_LOW_DAYS = 7;

export async function kitchenStock(store: FullStore, args: { item?: string | null; low_within_days?: number | null; cover_days?: number | null }): Promise<ToolResult> {
  const m = await store.masters();
  const want = itemsFor(m, args.item, ["RM", "SM", "PK"]);
  if (args.item && !want.ids?.size) return { data: { found: false, query: args.item, note: "ไม่พบวัตถุดิบชื่อนี้ในระบบ" } };
  const items = m.skus.filter((s) => s.active && ["RM", "SM", "PK"].includes(s.type) && (!want.ids || want.ids.has(s.id)));
  const ids = items.map((s) => s.id);
  const within = n(args.low_within_days) > 0 ? n(args.low_within_days) : KITCHEN_LOW_DAYS;
  const cover = n(args.cover_days) > 0 ? n(args.cover_days) : null;
  const week = dailyUseWindow(m.today);
  const since = shiftDay(m.today, -USAGE_WINDOW_DAYS);
  const [stock, adjustments, demand, lastCount] = await Promise.all([
    store.stock.kitchenStock(ids),
    store.stock.kitchenAdjustments(ids.filter((id) => m.ctx.skuType.get(id) !== "SM"), since, m.today),
    items.some((s) => s.type === "SM") ? store.stock.branchWeek(week.from, week.to) : Promise.resolve({ sales: [], waste: [] }),
    store.stock.kitchenLastCount(),
  ]);
  // Made items: what every branch uses per day (the kitchen stock page's SM cover day)
  const smIds = new Set(items.filter((s) => s.type === "SM").map((s) => s.id));
  const smPerDay = smIds.size ? totalPerDay(branchUsePerDay({ ctx: m.ctx, sales: demand.sales, waste: demand.waste, skuIds: smIds, window: week }).perDay) : {};
  const adjBy = new Map<string, { date: string; quantity: number; reason: string | null }[]>();
  for (const a of adjustments) adjBy.set(a.sku_id, [...(adjBy.get(a.sku_id) ?? []), { date: a.adjustment_date, quantity: n(a.quantity), reason: a.reason }]);
  const rows = items.map((s) => {
    const bal = n(stock[s.id]);
    const perDay = s.type === "SM" ? n(smPerDay[s.id]) : kitchenUsePerDay(adjBy.get(s.id) ?? [], since, m.today);
    const daysLeft = perDay > 0 && bal > 0 ? bal / perDay : null;
    return { s, bal, perDay, daysLeft, order: cover !== null && perDay > 0 ? Math.max(0, perDay * cover - Math.max(0, bal)) : null };
  });
  const asked = !!args.item;
  const shown = asked
    ? rows
    : rows.filter((r) => r.perDay > 0 && (r.bal <= 0 || (r.daysLeft !== null && r.daysLeft < within))).sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0));
  const notes = [
    `คงเหลือเหมือนหน้าสต๊อกครัว · ใช้ต่อวัน: ของที่ครัวผลิต = ที่ทุกสาขาใช้เฉลี่ย 7 วัน, วัตถุดิบ = ที่เข้าการผลิตและส่งสาขาเฉลี่ย ${USAGE_WINDOW_DAYS} วัน`,
    lastCount ? `ครัวนับล่าสุด ${thDay(lastCount)}${lastCount < shiftDay(m.today, -35) ? " (นานแล้ว ตัวเลขอาจคลาด)" : ""}` : "ครัวยังไม่มีการนับ ตัวเลขคิดจากยอดยกมา",
    ...(cover !== null ? [`ควรสั่ง/ผลิต = ใช้ต่อวัน × ${cover} วัน − คงเหลือ · ยังไม่หักของที่สั่งไว้แล้วและยังไม่มาส่ง`] : []),
  ];
  return {
    data: {
      mode: asked ? "items" : `ใกล้หมด (เหลือไม่ถึง ${within} วัน)`,
      rows: shown.slice(0, 30).map((r) => ({
        item: `${r.s.name} (${r.s.code})`,
        type: r.s.type,
        balance: amount(r.bal, r.s.uom),
        per_day: amount(r.perDay, r.s.uom),
        days_left: r.daysLeft === null ? null : r1(r.daysLeft),
        ...(cover !== null ? { order_for_cover: r.order === null ? null : amount(r.order, r.s.uom) } : {}),
      })),
      notes,
    },
    card: shown.length
      ? {
          title: asked ? `สต๊อกครัวกลาง · ${want.names.slice(0, 2).join(", ")}` : `ของใกล้หมดที่ครัวกลาง (ไม่ถึง ${within} วัน)`,
          subtitle: `ณ วันนี้ ${thDay(m.today)}`,
          columns: cover !== null ? ["ของ", "เหลือ / วันละ", "ควรสั่ง/ผลิต"] : ["ของ", "เหลือ / วันละ", "อยู่ได้"],
          rows: shown.slice(0, 20).map((r) => [r.s.name, `${amount(r.bal, r.s.uom)} / ${amount(r.perDay, r.s.uom)}`, cover !== null ? (r.order === null ? "–" : amount(r.order, r.s.uom)) : r.bal <= 0 && r.perDay > 0 ? "หมด" : daysText(r.daysLeft)]),
          notes,
        }
      : undefined,
  };
}

// ─── 13. What each option rule costs ───

/**
 * Each rule's cost = the plate's usage with every rule − without this one, sale by sale, at
 * the sale day's price: the engine itself, so swaps, set items and branch limits count as
 * they do everywhere. Only sales the rule's words match are run twice.
 */
export function ruleCosts(m: Masters, ctx: UsageContext, sales: { sale_date: string; branch_id: string; menu_code: string; menu_name: string | null; qty: number | string; order_type?: string | null; channel?: string | null }[], ruleIds: Set<string> | null) {
  const priceOn = priceOnOf(m.priceAt, m.stdPrice);
  const costOf = (c: UsageContext, s: (typeof sales)[number]) => {
    let t = 0;
    addSaleUsage(c, s, (id, q) => (t += q * priceOn(id, s.sale_date)));
    return t;
  };
  // The same line many times (date, branch, menu, name, shop/delivery) is one run × its plates:
  // the engine is linear in qty, and a month of sales is tens of thousands of lines
  const grouped = new Map<string, (typeof sales)[number] & { lname: string }>();
  for (const x of sales) {
    const key = `${x.sale_date}|${x.branch_id}|${x.menu_code}|${x.menu_name ?? ""}|${isDeliverySale(x) ? "d" : "s"}`;
    const g = grouped.get(key);
    if (g) g.qty = n(g.qty) + n(x.qty);
    else grouped.set(key, { ...x, qty: n(x.qty), lname: (x.menu_name ?? "").toLowerCase() });
  }
  const lines = [...grouped.values()];
  const out = [];
  for (const rule of ctx.rules) {
    if (ruleIds && !ruleIds.has(rule.id)) continue;
    // The engine's own words test (modifier-rules.ts: trimmed, any case)
    const kw = (rule.keyword ?? "").trim().toLowerCase();
    if (!kw) continue;
    const without: UsageContext = { ...ctx, rules: ctx.rules.filter((r) => r.id !== rule.id) };
    let cost = 0;
    let times = 0;
    for (const s of lines) {
      if (!s.lname.includes(kw) && s.menu_code !== rule.keyword.trim()) continue;
      // Times = the plates the rule applies to (its words, branch and menus), whatever it costs
      const menuId = ctx.menuIdByCode.get(s.menu_code);
      const applies = !!menuId && ruleMatchesSale(rule, s) && (rule.branchIds.length === 0 || rule.branchIds.includes(s.branch_id)) && (rule.menuIds.length === 0 || rule.menuIds.includes(menuId));
      if (applies) times += n(s.qty);
      const d = costOf(ctx, s) - costOf(without, s);
      if (Math.abs(d) >= 1e-9) cost += d;
    }
    out.push({ rule, cost, times });
  }
  // Most added cost first; rules that save (a swap to something cheaper) at the end
  return out.sort((a, b) => b.cost - a.cost);
}

export async function ruleCost(store: FullStore, args: { query?: string | null; period?: NamedPeriod | null; from?: string | null; to?: string | null; branch?: string | null }): Promise<ToolResult> {
  const m = await store.masters();
  const p = periodOf(m.today, args);
  const br = resolveBranches(m, args.branch);
  const skuName = (id: string | null) => (id ? (m.skus.find((s) => s.id === id)?.name ?? "") : "");
  const menuName = (id: string | null) => (id ? (m.menus.find((x) => x.id === id)?.name ?? "") : "");
  const describe = (r: UsageContext["rules"][number]) =>
    r.ruleType === "submenu" ? `"${r.keyword}" → ใส่สูตร ${menuName(r.submenuId)}` : r.ruleType === "swap" ? `"${r.keyword}" → เอา ${skuName(r.swapSkuId)} ออก ใส่ ${skuName(r.skuId)}` : `"${r.keyword}" → เพิ่ม ${skuName(r.skuId)} ${r.qtyPerMatch}`;
  let ruleIds: Set<string> | null = null;
  if (args.query) {
    const q = norm(args.query);
    ruleIds = new Set(m.ctx.rules.filter((r) => norm(r.keyword).includes(q) || q.includes(norm(r.keyword)) || norm(describe(r)).includes(q)).map((r) => r.id));
    if (!ruleIds.size) return { data: { found: false, query: args.query, note: "ไม่พบกฎพิเศษที่ตรงกับคำนี้" } };
  }
  const sales = await store.sales(br.ids, p.from, p.to);
  const list = ruleCosts(m, m.ctx, sales, ruleIds).filter((x) => ruleIds || x.times > 0);
  const top = list.slice(0, 15);
  return {
    data: {
      period: p,
      branches: br.label,
      rules: top.map((x) => ({ rule: describe(x.rule), type: x.rule.ruleType, times: r1(x.times), cost: r2(x.cost), per_time: x.times > 0 ? r2(x.cost / x.times) : null })),
      note: "ต้นทุนของกฎ = ต้นทุนตามสูตรเมื่อมีกฎ − เมื่อไม่มีกฎ (สลับของ/ใส่สูตรย่อย/เพิ่มของ) ราคาวัตถุดิบของวันที่ขาย; ใช้สูตรวันนี้",
    },
    card: top.length
      ? {
          title: args.query ? `ต้นทุนกฎพิเศษ · "${args.query}"` : "กฎพิเศษที่เพิ่มต้นทุนมากสุด",
          subtitle: `${thDay(p.from)} – ${thDay(p.to)} · ${br.label}`,
          columns: ["กฎ", "ครั้ง", "บาท"],
          rows: top.map((x) => [describe(x.rule), baht(x.times), `${baht2(x.cost)}${x.times > 0 ? ` (${baht2(x.cost / x.times)}/ครั้ง)` : ""}`]),
          notes: ["บาท = ต้นทุนที่กฎนี้เพิ่ม (ติดลบ = ทำให้ถูกลง เช่น สลับเป็นของถูกกว่า)", "กฎที่ซ้อนกัน (สลับของในจานที่อยู่ในเซ็ต) อาจนับซ้ำ ตัวเลขแต่ละกฎจึงบวกรวมกันไม่ได้"],
        }
      : undefined,
  };
}

// ─── 14. What the kitchen sent the branches ───

export async function transfers(store: FullStore, args: { item?: string | null; branch?: string | null; period?: NamedPeriod | null; from?: string | null; to?: string | null }): Promise<ToolResult> {
  const m = await store.masters();
  const p = periodOf(m.today, args);
  const br = resolveBranches(m, args.branch);
  const want = itemsFor(m, args.item, ["RM", "SM", "PK"]);
  if (args.item && !want.ids?.size) return { data: { found: false, query: args.item, note: "ไม่พบวัตถุดิบชื่อนี้ในระบบ" } };
  const { orders, lines } = await store.stock.transfers(br.ids, p.from, p.to);
  // Sent or received only; a line's amount = what was sent (else what was planned, still on its way)
  const live = new Map(orders.filter((o) => ["Sent", "Received", "Partially Received"].includes(o.status)).map((o) => [o.id, o]));
  const skuOf = new Map(m.skus.map((s) => [s.id, s]));
  const branchName = new Map(m.branches.map((b) => [b.id, b.name]));
  const byBranch = new Map<string, { value: number; orders: Set<string> }>();
  const byItem = new Map<string, { qty: number; value: number; asked: number }>();
  for (const l of lines) {
    const o = live.get(l.to_id);
    if (!o || (want.ids && !want.ids.has(l.sku_id))) continue;
    const qty = n(l.actual_qty) > 0 ? n(l.actual_qty) : o.status === "Sent" ? n(l.planned_qty) : 0;
    const value = n(l.unit_cost) * qty;
    const b = byBranch.get(o.branch_id) ?? { value: 0, orders: new Set<string>() };
    b.value += value;
    b.orders.add(o.id);
    byBranch.set(o.branch_id, b);
    const i = byItem.get(l.sku_id) ?? { qty: 0, value: 0, asked: 0 };
    i.qty += qty;
    i.value += value;
    i.asked += n(l.planned_qty);
    byItem.set(l.sku_id, i);
  }
  const branches = [...byBranch].map(([id, v]) => ({ branch: branchName.get(id) ?? id, value: Math.round(v.value), orders: v.orders.size })).sort((a, b) => b.value - a.value);
  const items = [...byItem]
    .map(([id, v]) => ({ id, item: skuOf.get(id)?.name ?? id, uom: skuOf.get(id)?.uom ?? "", qty: v.qty, value: v.value, asked: v.asked, unit_cost: v.qty > 0 ? v.value / v.qty : 0 }))
    .sort((a, b) => b.value - a.value);
  const total = branches.reduce((t, b) => t + b.value, 0);
  return {
    data: {
      period: p,
      branches_asked: br.label,
      total_value: Math.round(total),
      by_branch: branches,
      items: items.slice(0, 15).map((x) => ({ item: x.item, sent: amount(x.qty, x.uom), asked: amount(x.asked, x.uom), value: Math.round(x.value), cost_per_unit: unitText(x.uom) === "ก." ? `${baht2(x.unit_cost * 1000)}/กก.` : unitText(x.uom) === "มล." ? `${baht2(x.unit_cost * 1000)}/ลิตร` : `${baht2(x.unit_cost)}/${unitText(x.uom)}` })),
      note: "มูลค่า = จำนวนที่ส่ง × ต้นทุนต่อหน่วยในใบโอน · นับใบที่ส่งแล้ว/รับแล้ว ตามวันส่ง",
    },
    card: items.length
      ? {
          title: `ครัวกลางส่งให้สาขา${args.item ? ` · ${want.names.slice(0, 2).join(", ")}` : ""}`,
          subtitle: `${thDay(p.from)} – ${thDay(p.to)} · รวม ฿${baht(total)}${branches.length > 1 ? ` · ${branches.map((b) => `${b.branch} ฿${baht(b.value)}`).join(" · ")}` : ""}`,
          columns: ["ของ", "ส่ง / ขอ", "มูลค่า"],
          rows: items.slice(0, 15).map((x) => [x.item, `${amount(x.qty, x.uom)} / ${amount(x.asked, x.uom)}`, baht(x.value)]),
          notes: ["มูลค่าตามต้นทุนต่อหน่วยในใบโอน"],
        }
      : undefined,
  };
}

export const STOCK_TOOLS = {
  branch_stock: branchStock,
  kitchen_stock: kitchenStock,
  rule_cost: ruleCost,
  transfers,
} as const;
