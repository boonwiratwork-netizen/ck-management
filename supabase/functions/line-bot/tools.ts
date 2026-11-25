// The LINE bot's tools: every number the bot says comes from here, worked out with the
// app's own engine (_shared/food-cost.ts computeStandard, _shared/sale-usage.ts). Gemini
// only picks a tool and its arguments; it never does the arithmetic.
// Plain TypeScript, relative imports only (Deno in the Edge Function, Node in the tests).

import { addSaleUsage, isDeliverySale, type UsageContext } from "../_shared/sale-usage.ts";
import { computeStandard, priceOnOf, type FcSale, type Standard, type UsageCorrection } from "../_shared/food-cost.ts";
import type { Card } from "./cards.ts";

// ─── Data the tools read (loaded by data.ts; a fake in the tests) ───

export interface BotMenu {
  id: string;
  code: string;
  name: string;
  brand: string;
  category: string;
  /** List price (menus.selling_price) */
  price: number;
  active: boolean;
}
export interface BotSku {
  id: string;
  code: string;
  name: string;
  type: string;
  /** Usage unit (what prices and recipes are in) */
  uom: string;
  purchaseUom: string;
  active: boolean;
}
export interface BotBranch {
  id: string;
  name: string;
  brand: string;
  /** Closed branches still count in "all branches" for periods they sold in */
  active?: boolean;
}
/** A shop recipe line as the menu page shows it (before yield) — for grams per piece */
export interface BotBomLine {
  menuId: string;
  skuId: string;
  qtyPerServing: number;
  branchId: string | null;
  deliveryOnly: boolean;
}
export interface Masters {
  menus: BotMenu[];
  skus: BotSku[];
  branches: BotBranch[];
  bom: BotBomLine[];
  /** Today's standard price per usage unit (the newest active price row) */
  stdPrice: Map<string, number>;
  /** Standard price history: (sku, day) → price that day, undefined before history */
  priceAt: (skuId: string, date: string) => number | undefined;
  /** Price changes, newest last (for "how has it moved") */
  priceChanges: { skuId: string; day: string; price: number }[];
  /** Today's recipes and rules */
  ctx: UsageContext;
  /** The recipes and rules of a given day (recipe history); undefined = today's */
  ctxAt?: (date: string) => UsageContext;
  /** Today in Bangkok, yyyy-mm-dd */
  today: string;
}
export interface Store {
  masters(): Promise<Masters>;
  sales(branchIds: string[], from: string, to: string): Promise<FcSale[]>;
  corrections(branchIds: string[], from: string, to: string): Promise<UsageCorrection[]>;
}

export interface ToolResult {
  /** What Gemini reads back (plain data, numbers already worked out) */
  data: unknown;
  /** Shown in the chat as a card, exactly as worked out (never retyped by the model) */
  card?: Card;
}

// ─── Small helpers ───

const n = (v: unknown) => Number(v) || 0;
const r0 = (v: number) => Math.round(v);
const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;
export const pct = (cost: number, revenue: number) => (revenue > 0 ? (cost / revenue) * 100 : null);
const baht = (v: number) => Math.round(v).toLocaleString("en-US");
const baht2 = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pctText = (v: number | null) => (v === null ? "–" : `${r1(v).toFixed(1)}%`);
const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${baht(Math.abs(v))}`;
const TH_MONTH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
export const thDay = (d: string) => `${Number(d.slice(8))} ${TH_MONTH[Number(d.slice(5, 7)) - 1]}`;
const periodText = (from: string, to: string) => (from === to ? thDay(from) : `${thDay(from)} – ${thDay(to)} ${Number(to.slice(0, 4)) + 543 - 2500}`);

export const shiftDay = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const monthStart = (d: string) => `${d.slice(0, 7)}-01`;

/**
 * The period asked for, or by default this month so far (yesterday is the last full day);
 * on the 1st, last month. A date after today is pulled back to today.
 */
export function resolvePeriod(today: string, from?: string | null, to?: string | null): { from: string; to: string } {
  const ok = (d?: string | null) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);
  if (ok(from)) {
    let a = from!;
    let b = ok(to) ? to! : today;
    if (a > b) [a, b] = [b, a];
    return { from: a > today ? today : a, to: b > today ? today : b };
  }
  const y = shiftDay(today, -1);
  if (today.slice(8) === "01") return { from: monthStart(y), to: y };
  return { from: monthStart(today), to: today };
}

/** Lower-case, no spaces or punctuation (Thai has no spaces between words anyway) */
export const norm = (s: string) => (s ?? "").toLowerCase().replace(/[\s()[\]{}.,:;'"`~!@#$%^&*_+=|\\/<>?\-–—·]+/g, "");
const bigrams = (s: string) => {
  const out = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) out.set(s.slice(i, i + 2), (out.get(s.slice(i, i + 2)) ?? 0) + 1);
  return out;
};
/** How alike two names are, 0–1 (letter pairs in common; containing the other counts high) */
export function similarity(a: string, b: string): number {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (y.includes(x) || x.includes(y)) return 0.75 + 0.25 * (Math.min(x.length, y.length) / Math.max(x.length, y.length));
  const bx = bigrams(x);
  const by = bigrams(y);
  let common = 0;
  for (const [k, c] of bx) common += Math.min(c, by.get(k) ?? 0);
  const total = Math.max(1, x.length - 1 + y.length - 1);
  return (2 * common) / total;
}

/** Best matches for a name or a code ("SM-0005", "MN-001"), best first */
export function matchByName<T extends { code: string; name: string }>(list: T[], query: string, limit = 5, floor = 0.34): { item: T; score: number }[] {
  const q = (query ?? "").trim();
  if (!q) return [];
  const byCode = list.find((x) => x.code.toLowerCase() === q.toLowerCase());
  if (byCode) return [{ item: byCode, score: 1 }];
  return list
    .map((item) => ({ item, score: similarity(q, item.name) }))
    .filter((x) => x.score >= floor)
    .sort((a, b) => b.score - a.score || a.item.name.length - b.item.name.length)
    .slice(0, limit);
}

/** Branches named ("Shiro", "ธนิยะ" → Thaniya…); none named = every active branch */
export function resolveBranches(m: Masters, name?: string | null): { ids: string[]; label: string; unknown?: string } {
  const all = m.branches;
  if (!name || /^(ทุก.*|all|รวม.*|ทั้งหมด|ทุกที่)$/i.test(name.trim())) return { ids: all.map((b) => b.id), label: "ทุกสาขา" };
  const alias: Record<string, string> = { ธนิยะ: "thaniya", ชิโระ: "shiro", ชิโร: "shiro", เซนโด: "sendo", วันใหม่: "wanmai" };
  const q = alias[name.trim()] ?? name;
  const hit = all.filter((b) => norm(b.name).includes(norm(q)) || norm(q).includes(norm(b.name)) || norm(b.brand) === norm(q));
  if (!hit.length) return { ids: all.map((b) => b.id), label: "ทุกสาขา", unknown: name };
  return { ids: hit.map((b) => b.id), label: hit.map((b) => b.name).join(" + ") };
}

const unitText = (u: string) => {
  const k = (u ?? "").trim().toLowerCase();
  if (["g", "gram", "grams", "กรัม", "ก."].includes(k)) return "ก.";
  if (["ml", "มล."].includes(k)) return "มล.";
  if (["kg", "กก."].includes(k)) return "กก.";
  if (["l", "ลิตร"].includes(k)) return "ลิตร";
  if (["pc", "pcs", "piece", "ea", "ชิ้น"].includes(k)) return "ชิ้น";
  return u ?? "";
};

// ─── House facts: how much heavier an item gets once cooked ───

/**
 * Cooked weight ÷ raw weight, for items the shops serve cooked while the system prices and
 * recipes them raw. Bucci, 25 Nov 2026: ข้าวญี่ปุ่นหุงสุกหนัก 2 เท่าของข้าวดิบ (สุก 180 ก. = ดิบ 90 ก.).
 */
export const HOUSE_YIELDS: { item: RegExp; cookedPerRaw: number; note: string }[] = [
  { item: /ข้าวญี่ปุ่น|โคชิฮิคาริ|มุเซนมัย|ข้าวสาร/i, cookedPerRaw: 2, note: "ข้าวญี่ปุ่นหุงสุกหนัก 2 เท่าของข้าวดิบ" },
];
export const cookedYieldOf = (sku: { name: string }) => HOUSE_YIELDS.find((y) => y.item.test(sku.name)) ?? null;
/** Cooked / prepared forms: the system's item is usually the raw one (weights differ) */
const PREPARED = /สุก|ต้ม|นึ่ง|หุง|ทอด|ย่าง|ปรุง|cooked|steamed|boiled/i;

const UNIT: Record<string, { to: "g" | "ml" | "pc"; times: number }> = {
  g: { to: "g", times: 1 }, gram: { to: "g", times: 1 }, กรัม: { to: "g", times: 1 }, "ก.": { to: "g", times: 1 }, ก: { to: "g", times: 1 },
  kg: { to: "g", times: 1000 }, "กก.": { to: "g", times: 1000 }, กก: { to: "g", times: 1000 }, กิโล: { to: "g", times: 1000 },
  ml: { to: "ml", times: 1 }, "มล.": { to: "ml", times: 1 }, มล: { to: "ml", times: 1 }, l: { to: "ml", times: 1000 }, ลิตร: { to: "ml", times: 1000 },
  ชิ้น: { to: "pc", times: 1 }, pc: { to: "pc", times: 1 }, pcs: { to: "pc", times: 1 }, piece: { to: "pc", times: 1 }, ฟอง: { to: "pc", times: 1 }, ลูก: { to: "pc", times: 1 }, แผ่น: { to: "pc", times: 1 }, ea: { to: "pc", times: 1 },
};
const skuUnit = (uom: string) => UNIT[(uom ?? "").trim().toLowerCase()] ?? null;

/**
 * A quantity someone wrote ("180 ก.", "6 ชิ้น", "ข้าวสุก 180 ก.") in the item's own unit, the
 * way the system prices it. Pieces → grams from 'N ชิ้น' menus; cooked → raw by HOUSE_YIELDS.
 * An unknown unit is never guessed.
 */
export function inItemUnit(m: Masters, sku: BotSku, qty: number, unit: string | null | undefined, cooked: boolean): { qty: number; notes: string[] } | { error: "unit_unknown" } {
  const written = (unit ?? "").trim();
  const given = UNIT[written.toLowerCase()];
  const target = skuUnit(sku.uom);
  const notes: string[] = [];
  let q: number | null = null;
  if (given && target && given.to === target.to) q = (qty * given.times) / target.times;
  else if (given?.to === "pc" && target?.to === "g") {
    const gp = gramsPerPiece(m, sku.id);
    if (gp) {
      q = (qty * gp.grams) / target.times;
      notes.push(`${r1(gp.grams)} ก./ชิ้น จาก ${gp.from}`);
    }
  } else if (!written && target) q = qty;
  if (q === null) return { error: "unit_unknown" };
  const y = cookedYieldOf(sku);
  if (cooked && y) {
    notes.push(`${y.note}: สุก ${r1(q)} → ดิบ ${r1(q / y.cookedPerRaw)} ${unitText(sku.uom)}`);
    q = q / y.cookedPerRaw;
  } else if (cooked) notes.push(`ในระบบไม่มีสัดส่วนสุก/ดิบของ ${sku.name} ใช้น้ำหนักตามที่แจ้ง`);
  return { qty: q, notes };
}

/**
 * Menus a name points at: a code; else every menu whose name contains it ("Standard" → the
 * three Standard ramens, "ด้ง" → every donburi); else the closest one.
 */
/** English names people type for the Thai menu words ("Shoyu Signature" → โชยุ Signature) */
const MENU_WORDS: [RegExp, string][] = [
  [/\bshoyu\b/gi, "โชยุ"], [/\bshio\b/gi, "ชิโอะ"], [/\btori\s*paitan\b/gi, "โทริไพตัน"], [/\bpaitan\b/gi, "ไพตัน"], [/\btonkotsu\b/gi, "ทงคตสึ"],
  [/\bgyoza\b/gi, "เกี๊ยวซ่า"], [/\bkaraage\b/gi, "คาราเกะ"], [/\bdon\b/gi, "ด้ง"], [/\bramen\b/gi, "ราเมน"], [/\bwagyu\b/gi, "วากิว"], [/\bfoie\s*gras\b/gi, "ฟัวกราส์"],
];
const menuWords = (q: string) => MENU_WORDS.reduce((s, [re, th]) => s.replace(re, th), q);

export function matchMenus(pool: BotMenu[], query: string): BotMenu[] {
  const raw = (query ?? "").trim();
  if (!raw) return [];
  const byCode = pool.find((x) => x.code.toLowerCase() === raw.toLowerCase());
  if (byCode) return [byCode];
  // Shop menus only, unless the shop has none by that name (Line Man aliases and freebies repeat them)
  const shop = pool.filter((x) => !/^MN-\d+L$/i.test(x.code) && !/ของแถม/.test(x.name));
  for (const list of [shop, pool]) {
    for (const q of [raw, menuWords(raw)]) {
      const nq = norm(q);
      const exact = list.find((x) => norm(x.name) === nq);
      if (exact) return [exact];
      // Every word of the query in the name, any order ("Shoyu Signature" = "Signature โชยุ ราเมน")
      const words = q.split(/\s+/).map(norm).filter((w) => w.length >= 2);
      const containing = words.length ? list.filter((x) => words.every((w) => norm(x.name).includes(w))) : [];
      if (containing.length) return containing;
    }
  }
  const best = matchByName(shop, menuWords(raw), 1, 0.5)[0] ?? matchByName(pool, menuWords(raw), 1, 0.5)[0];
  return best ? [best.item] : [];
}

/** Ingredient groups people ask about ("ต้นทุนโปรตีน"); anything else = the words given */
const ITEM_GROUPS: Record<string, RegExp> = {
  protein: /หมู|ไก่|เป็ด|เนื้อ|วากิว|ชาชู|กุ้ง|ปลา|ปู|หอย|หมึก|ไข่|แซลมอน|เบคอน|ฟัวกรา|ทูน่า|สันคอ|สันนอก|สามชั้น|อก|โปรตีน/i,
  noodle: /เส้น|noodle/i,
  soup: /ซุป|น้ำสต๊อก|ทาเระ|soup|tare/i,
  oil: /น้ำมัน|oil/i,
  vegetable: /ผัก|ต้นหอม|หอม|กะหล่ำ|ถั่วงอก|เห็ด|หน่อไม้|สาหร่าย|ข้าวโพด|veg/i,
};
const GROUP_WORDS: Record<string, string> = { โปรตีน: "protein", เนื้อสัตว์: "protein", เส้น: "noodle", ซุป: "soup", น้ำซุป: "soup", น้ำมัน: "oil", ผัก: "vegetable" };
export function itemFilter(only?: string | null): { test: (name: string) => boolean; label: string } | null {
  const o = (only ?? "").trim();
  if (!o) return null;
  const key = ITEM_GROUPS[o.toLowerCase()] ? o.toLowerCase() : GROUP_WORDS[o];
  if (key) return { test: (name) => ITEM_GROUPS[key].test(name), label: o };
  const words = o.split(/[,،\s]+/).map(norm).filter(Boolean);
  return { test: (name) => words.some((w) => norm(name).includes(w)), label: o };
}

// ─── 1. Ingredient prices ───

export async function ingredientPrice(store: Store, args: { query: string; days?: number; qty?: number | null; unit?: string | null; cooked?: boolean | null }): Promise<ToolResult> {
  const m = await store.masters();
  const found = matchByName(m.skus.filter((s) => s.active), args.query, 5);
  if (!found.length) return { data: { found: false, query: args.query, note: "ไม่พบวัตถุดิบชื่อนี้ในระบบ" } };
  // Only the items about as close as the best one (a far match is noise, not an answer)
  const hits = found.filter((h) => h.score >= found[0].score - 0.1);
  const since = shiftDay(m.today, -(args.days && args.days > 0 ? Math.min(args.days, 365) : 90));
  const rows = hits.map(({ item, score }) => {
    const now = m.stdPrice.get(item.id) ?? 0;
    const changes = m.priceChanges.filter((c) => c.skuId === item.id && c.day >= since);
    const before = m.priceAt(item.id, shiftDay(since, -1));
    const first = before ?? changes[0]?.price;
    return {
      code: item.code,
      name: item.name,
      type: item.type,
      unit: unitText(item.uom),
      price_per_unit: r2(now * 1) === 0 ? 0 : Number(now.toFixed(4)),
      price_per_1000_units: r2(now * 1000),
      changed_since: thDay(since),
      price_then_per_unit: first === undefined ? null : Number(first.toFixed(4)),
      change_pct: first ? r1(((now - first) / first) * 100) : null,
      changes: changes.map((c) => ({ day: c.day, price_per_unit: Number(c.price.toFixed(4)) })),
      match: r2(score),
    };
  });
  // A quantity asked about ("ข้าวสุก 180 ก. กี่บาท"): worked out here, never by the model
  let forQty: unknown = null;
  if (args.qty != null && n(args.qty) > 0) {
    const sku = hits[0].item;
    const price = m.stdPrice.get(sku.id) ?? 0;
    const cooked = !!args.cooked || PREPARED.test(args.query);
    const conv = inItemUnit(m, sku, n(args.qty), args.unit, cooked);
    forQty =
      "error" in conv
        ? { item: sku.name, error: `หน่วย "${args.unit}" แปลงไม่ได้ ระบุเป็นกรัม/มล./ชิ้น` }
        : { item: `${sku.name} (${sku.code})`, asked: `${n(args.qty)} ${args.unit ?? unitText(sku.uom)}${cooked ? " (สุก)" : ""}`, qty_in_system_unit: r1(conv.qty), system_unit: unitText(sku.uom), cost: r2(conv.qty * price), how: conv.notes };
  }
  const perText = (r: (typeof rows)[number]) =>
    r.unit === "ก." ? `฿${baht2(r.price_per_1000_units)} / กก.` : r.unit === "มล." ? `฿${baht2(r.price_per_1000_units)} / ลิตร` : `฿${baht2(r.price_per_unit)} / ${r.unit || "หน่วย"}`;
  return {
    data: { found: true, cost_for_qty: forQty, items: rows.map((r) => ({ ...r, price_text: perText(r) })), others_not_shown: found.length - hits.length, cooked_yield: cookedYieldOf(hits[0].item)?.note ?? null },
    // One item: the text answers it; a table only when there are items to compare
    card:
      rows.length < 2 || forQty
        ? undefined
        : {
            title: "ราคาวัตถุดิบในระบบ",
            subtitle: `ราคามาตรฐานวันนี้ · ราคาขยับเทียบกับ ${thDay(since)}`,
            columns: ["วัตถุดิบ", "ราคา", "ขยับ"],
            rows: rows.map((r) => [`${r.name} (${r.code})`, perText(r), r.change_pct === null ? "–" : r.change_pct === 0 ? "เท่าเดิม" : `${r.change_pct > 0 ? "+" : ""}${r.change_pct}%`]),
            notes: ["หลายรายการชื่อใกล้กัน ระบุให้ชัดแล้วถามต่อได้"],
          },
  };
}

// ─── 2. One menu's cost per plate ───

/** One sale of a menu through the engine, at today's recipes and prices: what a plate costs */
export function plateCost(m: Masters, menu: BotMenu, branchId: string, delivery = false): { lines: { skuId: string; qty: number; cost: number }[]; total: number } {
  const used = new Map<string, number>();
  addSaleUsage(m.ctx, { menu_code: menu.code, menu_name: menu.name, qty: 1, branch_id: branchId, channel: delivery ? "LINE MAN เดลิเวอรี" : "หน้าร้าน" }, (id, q) => used.set(id, (used.get(id) ?? 0) + q));
  const lines = [...used].map(([skuId, qty]) => ({ skuId, qty, cost: qty * (m.stdPrice.get(skuId) ?? 0) })).filter((l) => Math.abs(l.qty) > 1e-9);
  lines.sort((a, b) => b.cost - a.cost);
  return { lines, total: lines.reduce((t, l) => t + l.cost, 0) };
}

export async function menuCost(store: Store, args: { query: string; branch?: string | null; new_price?: number | null; only?: string | null }): Promise<ToolResult> {
  const m = await store.masters();
  const group = matchMenus(m.menus.filter((x) => x.active), args.query);
  if (!group.length) return { data: { found: false, query: args.query, note: "ไม่พบเมนูชื่อนี้ในระบบ" } };
  const br = resolveBranches(m, args.branch);
  const open = m.branches.filter((b) => b.active !== false);
  const branchFor = (menu: BotMenu) => open.find((b) => br.ids.includes(b.id) && b.brand === menu.brand) ?? open.find((b) => b.brand === menu.brand) ?? open[0] ?? m.branches[0];
  const only = itemFilter(args.only);
  const skuName = new Map(m.skus.map((s) => [s.id, s.name]));
  /** The part of a plate the question is about ("only protein"): its lines and their sum, worked out here */
  const partOf = <L extends { skuId: string; cost: number }>(lines: L[]): L[] | null => (only ? lines.filter((l) => only.test(skuName.get(l.skuId) ?? "")) : null);
  // Several menus ("Standard", "ด้ง"): one line each
  if (group.length > 1) {
    const list = group.slice(0, 12).map((menu) => {
      const plate = plateCost(m, menu, branchFor(menu)?.id ?? "");
      const part = partOf(plate.lines);
      if (part) {
        const sum = part.reduce((t, l) => t + l.cost, 0);
        return { code: menu.code, name: menu.name, cost_per_plate: r2(plate.total), price: menu.price, food_cost_pct: null as number | null, only_cost: r2(sum), only_items: part.map((l) => skuName.get(l.skuId) ?? l.skuId) };
      }
      const total = plate.total;
      const price = args.new_price && args.new_price > 0 ? args.new_price : menu.price;
      return { code: menu.code, name: menu.name, cost_per_plate: r2(total), price, food_cost_pct: pct(total, price) === null ? null : r1(pct(total, price)!) };
    });
    if (only)
      return {
        data: { found: true, only: only.label, menus: list, more: Math.max(0, group.length - 12), note: "ต้นทุนตามสูตรหน้าร้านวันนี้ ราคาวัตถุดิบล่าสุด" },
        card: {
          title: `ต้นทุน${only.label} · "${args.query}" ${group.length} เมนู`,
          subtitle: "ตามสูตรหน้าร้าน · ราคาวัตถุดิบวันนี้",
          columns: ["เมนู", only.label, "ทั้งจาน"],
          rows: list.map((x) => [x.name, baht2((x as { only_cost: number }).only_cost), baht2(x.cost_per_plate)]),
        },
      };
    return {
      data: { found: true, menus: list, more: Math.max(0, group.length - 12), note: "ต้นทุนตามสูตรหน้าร้านวันนี้ ราคาวัตถุดิบล่าสุด" },
      card: {
        title: `ต้นทุนต่อจาน · "${args.query}" ${group.length} เมนู`,
        subtitle: `ตามสูตรหน้าร้าน · ราคาวัตถุดิบวันนี้${args.new_price ? ` · เทียบราคา ${baht(args.new_price)}` : ""}`,
        columns: ["เมนู", "ต้นทุน/ราคา", "FC"],
        rows: list.map((x) => [x.name, `${baht2(x.cost_per_plate)} / ${baht(x.price)}`, pctText(x.food_cost_pct)]),
      },
    };
  }
  const menu = group[0];
  const hits = [{ item: menu }];
  const branch = branchFor(menu);
  const plate = plateCost(m, menu, branch?.id ?? "");
  const skuOf = new Map(m.skus.map((s) => [s.id, s]));
  const price = args.new_price && args.new_price > 0 ? args.new_price : menu.price;
  const fc = pct(plate.total, price);
  const missing = plate.lines.filter((l) => !(m.stdPrice.get(l.skuId) ?? 0)).map((l) => skuOf.get(l.skuId)?.name ?? l.skuId);
  const part = partOf(plate.lines);
  if (part && only) {
    const sum = part.reduce((t, l) => t + l.cost, 0);
    return {
      data: { found: true, menu: { code: menu.code, name: menu.name }, only: only.label, only_cost: r2(sum), cost_per_plate: r2(plate.total), only_share_pct: plate.total > 0 ? r1((sum / plate.total) * 100) : null, lines: part.map((l) => ({ item: skuOf.get(l.skuId)?.name ?? l.skuId, qty: r2(l.qty), unit: unitText(skuOf.get(l.skuId)?.uom ?? ""), cost: r2(l.cost) })) },
      card: {
        title: `${menu.name} · ต้นทุน${only.label}`,
        subtitle: `ตามสูตรหน้าร้าน · ${branch?.name ?? ""} · ราคาวัตถุดิบวันนี้`,
        columns: ["วัตถุดิบ", "ปริมาณ", "บาท"],
        rows: part.map((l) => {
          const s = skuOf.get(l.skuId);
          return [s?.name ?? l.skuId, `${r1(l.qty)} ${unitText(s?.uom ?? "")}`, baht2(l.cost)];
        }),
        total: [`รวม${only.label}`, "", baht2(sum)],
        notes: [`ทั้งจาน ${baht2(plate.total)} บาท · ${only.label} ${plate.total > 0 ? r1((sum / plate.total) * 100) : 0}% ของต้นทุน`],
      },
    };
  }
  return {
    data: {
      found: true,
      menu: { code: menu.code, name: menu.name, brand: menu.brand, branch: branch?.name, list_price: menu.price },
      priced_at: price,
      cost_per_plate: r2(plate.total),
      food_cost_pct: fc === null ? null : r1(fc),
      lines: plate.lines.map((l) => ({ item: skuOf.get(l.skuId)?.name ?? l.skuId, qty: r2(l.qty), unit: unitText(skuOf.get(l.skuId)?.uom ?? ""), cost: r2(l.cost) })),
      items_without_price: missing,
      other_matches: hits.slice(1).map((h) => `${h.item.name} (${h.item.code})`),
      note: "ต้นทุนตามสูตรหน้าร้านวันนี้ รวมกฎพิเศษที่ติดกับชื่อเมนูนี้ ราคาวัตถุดิบล่าสุด",
    },
    card: {
      title: `${menu.name} (${menu.code})`,
      subtitle: `ต้นทุนตามสูตร · ${branch?.name ?? ""} · ราคาวัตถุดิบวันนี้`,
      columns: ["วัตถุดิบ", "ปริมาณ", "บาท"],
      rows: plate.lines.slice(0, 14).map((l) => {
        const s = skuOf.get(l.skuId);
        return [s?.name ?? l.skuId, `${r1(l.qty)} ${unitText(s?.uom ?? "")}`, baht2(l.cost)];
      }),
      total: ["ต้นทุนต่อจาน", "", baht2(plate.total)],
      notes: [
        `ราคาขาย ${baht(price)}${args.new_price ? " (ราคาใหม่)" : ""} · food cost ${pctText(fc)}`,
        ...(plate.lines.length > 14 ? [`และอีก ${plate.lines.length - 14} รายการ`] : []),
        ...(missing.length ? [`ยังไม่มีราคา: ${missing.join(", ")}`] : []),
      ],
    },
  };
}

// ─── 3. Food cost for a period (the Food Cost page's ตามสูตร) ───

export interface MenuMix {
  code: string;
  name: string;
  qty: number;
  revenue: number;
  /** Revenue from shop sales (a new list price applies to these) */
  revenueShop: number;
  cost: number;
  /** Usage per item, and its cost at each sale's day price */
  sku: Map<string, { qty: number; cost: number }>;
}

/** The period through the app's own engine, plus each menu's ingredients (for what-ifs) */
export async function workPeriod(store: Store, m: Masters, branchIds: string[], from: string, to: string, withMix = true): Promise<{ std: Standard; mix: Map<string, MenuMix>; corrected: boolean }> {
  const [sales, corrections] = await Promise.all([store.sales(branchIds, from, to), store.corrections(branchIds, from, to)]);
  const menuByCode = new Map(m.menus.map((x) => [x.code, { code: x.code, name: x.name, category: x.category }]));
  const skuById = new Map(m.skus.map((s) => [s.id, { id: s.id, code: s.code, name: s.name, type: s.type, uom: s.uom }]));
  const std = computeStandard({ sales, ctx: m.ctx, ctxAt: m.ctxAt, stdPrice: m.stdPrice, priceAt: m.priceAt, menuByCode, skuById, corrections, branchIds: new Set(branchIds), from, to });
  const corrected = std.skus.some((s) => s.correction);
  // The same sales again, keeping each menu's ingredients apart (computeStandard sums them)
  const priceOn = priceOnOf(m.priceAt, m.stdPrice);
  const mix = new Map<string, MenuMix>();
  if (!withMix) return { std, mix, corrected };
  for (const s of sales) {
    const shop = !isDeliverySale(s);
    const row = mix.get(s.menu_code) ?? { code: s.menu_code, name: menuByCode.get(s.menu_code)?.name ?? s.menu_name ?? s.menu_code, qty: 0, revenue: 0, revenueShop: 0, cost: 0, sku: new Map() };
    const known = addSaleUsage(m.ctxAt?.(s.sale_date) ?? m.ctx, s, (id, q) => {
      const c = q * priceOn(id, s.sale_date);
      const e = row.sku.get(id) ?? { qty: 0, cost: 0 };
      e.qty += q;
      e.cost += c;
      row.sku.set(id, e);
      row.cost += c;
    });
    if (!known) continue;
    row.qty += n(s.qty);
    row.revenue += n(s.net_amount);
    if (shop) row.revenueShop += n(s.net_amount);
    mix.set(s.menu_code, row);
  }
  return { std, mix, corrected };
}

export async function foodCost(store: Store, args: { from?: string | null; to?: string | null; branch?: string | null; top?: number | null }): Promise<ToolResult> {
  const m = await store.masters();
  const p = resolvePeriod(m.today, args.from, args.to);
  const br = resolveBranches(m, args.branch);
  const { std } = await workPeriod(store, m, br.ids, p.from, p.to, false);
  const top = Math.max(3, Math.min(n(args.top) || 10, 20));
  const menus = [...std.menus].sort((a, b) => b.revenue - a.revenue).slice(0, top);
  const unknownRevenue = std.unknownMenus.reduce((t, u) => t + u.revenue, 0);
  const fc = pct(std.stdCost, std.revenue);
  return {
    data: {
      period: p,
      branches: br.label,
      unknown_branch: br.unknown ?? null,
      revenue: r0(std.revenue),
      recipe_cost: r0(std.stdCost),
      food_cost_pct: fc === null ? null : r1(fc),
      bills: std.bills,
      top_menus_by_revenue: menus.map((x) => ({ code: x.code, name: x.name, qty: r0(x.qty), revenue: r0(x.revenue), cost: r0(x.stdCost), food_cost_pct: r1(x.pct), cost_per_plate: r2(x.perServing) })),
      menus_not_set_up: std.unknownMenus.slice(0, 5).map((u) => ({ code: u.code, name: u.name, revenue: r0(u.revenue) })),
      menus_not_set_up_revenue: r0(unknownRevenue),
      note: "ต้นทุนตามสูตร (เหมือนหน้าต้นทุนอาหารในแอป) ไม่ใช่ต้นทุนจริงจากการนับสต๊อก",
    },
    card: {
      title: `Food cost ตามสูตร · ${br.label}`,
      subtitle: `${periodText(p.from, p.to)} · ยอดขาย ฿${baht(std.revenue)} · ต้นทุน ฿${baht(std.stdCost)}`,
      headline: pctText(fc),
      columns: ["เมนู (ขายดีสุด)", "ยอดขาย", "FC"],
      rows: menus.map((x) => [x.name, baht(x.revenue), pctText(x.pct)]),
      notes: [
        "ตัวเลขเดียวกับหน้าต้นทุนอาหาร (ตามสูตร) ในแอป",
        ...(unknownRevenue > 0 ? [`เมนูที่ยังไม่ตั้งในระบบ ขายได้ ฿${baht(unknownRevenue)} (ไม่มีต้นทุน)`] : []),
      ],
    },
  };
}

// ─── 4. What-if ───

export interface ScenarioArgs {
  from?: string | null;
  to?: string | null;
  branch?: string | null;
  /** One menu (menu) or a whole category (category, e.g. "ramen"); a new price or a % change */
  menu_prices?: { menu?: string | null; category?: string | null; new_price?: number | null; change_pct?: number | null }[] | null;
  ingredient_prices?: { item: string; new_price_per_kg?: number | null; change_pct?: number | null }[] | null;
  volume?: { menus?: string[] | null; group?: "price_changed" | "all" | null; change_pct: number }[] | null;
  include_delivery?: boolean | null;
}

export async function scenario(store: Store, args: ScenarioArgs): Promise<ToolResult> {
  const m = await store.masters();
  const p = resolvePeriod(m.today, args.from, args.to);
  const br = resolveBranches(m, args.branch);
  const { std, mix, corrected } = await workPeriod(store, m, br.ids, p.from, p.to);
  const menuByCode = new Map(m.menus.map((x) => [x.code, x]));
  const unmatched: string[] = [];
  const notes: string[] = [];

  // Menus whose price changes (matched against the menus sold, then all menus)
  const newPrice = new Map<string, number>();
  const sold = m.menus.filter((x) => mix.has(x.code));
  for (const c of args.menu_prices ?? []) {
    const pctChange = c?.change_pct != null && Number.isFinite(Number(c.change_pct)) ? Number(c.change_pct) : null;
    if (!(n(c?.new_price) > 0) && pctChange === null) continue;
    // A whole category ("ราเมน" / "ramen" matches Ramen, Signature Ramen, Special Ramen…): the menus sold in it
    let targets: BotMenu[] = [];
    if (c.category) {
      const q = norm(c.category).replace(/^ราเมน$/, "ramen").replace(/^ของทานเล่น$/, "appetizer").replace(/^เครื่องดื่ม$/, "drinks");
      targets = sold.filter((x) => norm(x.category).includes(q) || (q === "drinks" && /drink|beer|soft/i.test(x.category)));
      if (!targets.length) unmatched.push(`หมวด ${c.category}`);
    } else if (c.menu) {
      targets = matchMenus(sold, c.menu);
      if (!targets.length) targets = matchMenus(m.menus.filter((x) => x.active), c.menu);
      if (!targets.length) unmatched.push(c.menu);
    }
    for (const t of targets) {
      if (!(t.price > 0)) {
        notes.push(`${t.name} ไม่มีราคาขายในระบบ เลยคิดราคาใหม่ไม่ได้`);
        continue;
      }
      newPrice.set(t.code, n(c.new_price) > 0 && !c.category ? n(c.new_price) : Math.round(t.price * (1 + (pctChange ?? 0) / 100)));
    }
  }
  // Ingredients whose price changes (per usage unit)
  const newSkuPrice = new Map<string, number>();
  for (const c of args.ingredient_prices ?? []) {
    const hit = matchByName(m.skus.filter((s) => s.active), c.item, 1, 0.5)[0];
    if (!hit) {
      unmatched.push(c.item);
      continue;
    }
    const now = m.stdPrice.get(hit.item.id) ?? 0;
    const unit = unitText(hit.item.uom);
    const perUnit = c.new_price_per_kg != null && c.new_price_per_kg > 0 ? (unit === "ก." || unit === "มล." ? c.new_price_per_kg / 1000 : c.new_price_per_kg) : c.change_pct != null ? now * (1 + c.change_pct / 100) : null;
    if (perUnit === null) continue;
    newSkuPrice.set(hit.item.id, perUnit);
  }
  // Volume changes
  const volume = new Map<string, number>();
  for (const v of args.volume ?? []) {
    const f = 1 + n(v.change_pct) / 100;
    if (v.group === "all") for (const code of mix.keys()) volume.set(code, f);
    else if (v.group === "price_changed") for (const code of newPrice.keys()) volume.set(code, f);
    for (const name of v.menus ?? []) {
      const hit = matchByName(m.menus.filter((x) => mix.has(x.code)), name, 1, 0.5)[0];
      if (hit) volume.set(hit.item.code, f);
      else unmatched.push(name);
    }
  }

  const delivery = !!args.include_delivery;
  let dRev = 0;
  let dCost = 0;
  let repricedGpNew = 0;
  const changed: { code: string; name: string; fcNow: number | null; fcNew: number | null; perPlate: number; perPlateNew: number; oldPrice: number; newPrice: number }[] = [];
  for (const [code, row] of mix) {
    const ratio = newPrice.has(code) ? newPrice.get(code)! / (menuByCode.get(code)?.price || newPrice.get(code)!) : 1;
    const f = volume.get(code) ?? 1;
    const rev = (row.revenueShop * ratio + (row.revenue - row.revenueShop) * (delivery ? ratio : 1)) * f;
    let cost = row.cost;
    for (const [id, e] of row.sku) if (newSkuPrice.has(id)) cost += e.qty * newSkuPrice.get(id)! - e.cost;
    cost *= f;
    dRev += rev - row.revenue;
    dCost += cost - row.cost;
    if (newPrice.has(code)) {
      repricedGpNew += (rev - cost) / f;
      const menu = menuByCode.get(code)!;
      const plate = row.qty > 0 ? row.cost / row.qty : 0;
      const plateNew = row.qty > 0 ? cost / f / row.qty : 0;
      changed.push({ code, name: menu.name, fcNow: pct(plate, menu.price), fcNew: pct(plateNew, newPrice.get(code)!), perPlate: plate, perPlateNew: plateNew, oldPrice: menu.price, newPrice: newPrice.get(code)! });
    }
  }
  const rev0 = std.revenue;
  const cost0 = std.stdCost;
  const rev1 = rev0 + dRev;
  const cost1 = cost0 + dCost;
  const gp0 = rev0 - cost0;
  const gp1 = rev1 - cost1;
  // Break-even: how much more the repriced menus must sell for the same baht after ingredients
  const noVolumeOnRepriced = ![...newPrice.keys()].some((c) => volume.has(c));
  const breakEven = newPrice.size && noVolumeOnRepriced && repricedGpNew > 0 && gp1 < gp0 ? (gp0 - gp1) / repricedGpNew : null;
  const assumptions = [
    volume.size ? "เมนูที่ไม่ได้ระบุ ขายเท่าเดิม" : "ขายได้จำนวนจานเท่าเดิม",
    newPrice.size ? (delivery ? "ราคาใหม่ใช้กับเดลิเวอรี่ด้วย" : "เดลิเวอรี่คงราคาเดิม") : "",
    newPrice.size ? "ส่วนลดคิดตามสัดส่วนเดิม" : "",
    newSkuPrice.size ? "ราคาวัตถุดิบใหม่ใช้ทั้งช่วง" : "",
    corrected && (newSkuPrice.size || volume.size) ? "ช่วงนี้มีรายการปรับยอดใช้ ส่วนที่เปลี่ยนคิดจากยอดใช้ตามสูตรก่อนปรับ" : "",
  ].filter(Boolean);
  const fc0 = pct(cost0, rev0);
  const fc1 = pct(cost1, rev1);
  return {
    data: {
      period: p,
      branches: br.label,
      now: { revenue: r0(rev0), recipe_cost: r0(cost0), food_cost_pct: fc0 === null ? null : r1(fc0), gross_after_ingredients: r0(gp0) },
      scenario: { revenue: r0(rev1), recipe_cost: r0(cost1), food_cost_pct: fc1 === null ? null : r1(fc1), gross_after_ingredients: r0(gp1) },
      change_in_gross_after_ingredients: r0(gp1 - gp0),
      repriced_menus: changed.map((c) => ({ code: c.code, name: c.name, old_price: c.oldPrice, new_price: c.newPrice, cost_per_plate: r2(c.perPlate), cost_per_plate_new: r2(c.perPlateNew), food_cost_now: c.fcNow === null ? null : r1(c.fcNow), food_cost_new: c.fcNew === null ? null : r1(c.fcNew) })),
      ingredients_changed: [...newSkuPrice.keys()].map((id) => m.skus.find((s) => s.id === id)?.name),
      break_even_volume_pct_on_repriced: breakEven === null ? null : r1(breakEven * 100),
      not_found: unmatched,
      assumptions,
      notes,
    },
    card: {
      title: `ถ้าเปลี่ยนแล้ว · ${br.label}`,
      subtitle: `จากยอดขายจริง ${periodText(p.from, p.to)} · ต้นทุนตามสูตร`,
      columns: ["", "ยอดขาย", "FC"],
      rows: [
        ["ตอนนี้", baht(rev0), pctText(fc0)],
        ["ถ้าเปลี่ยน", baht(rev1), pctText(fc1)],
        ...changed
          .sort((a, b) => (b.fcNew ?? 0) - (a.fcNew ?? 0))
          .slice(0, 10)
          .map((c) => [`${c.name} ${baht(c.oldPrice)}→${baht(c.newPrice)}`, "", `${pctText(c.fcNow)}→${pctText(c.fcNew)}`]),
      ],
      notes: [
        `กำไรหลังหักวัตถุดิบ ${signed(gp1 - gp0)} บาท เทียบตอนนี้`,
        ...(breakEven !== null ? [`เมนูที่ปรับราคาต้องขายเพิ่ม ${r1(breakEven * 100)}% ถึงจะเท่าเดิม`] : []),
        ...assumptions,
        ...(unmatched.length ? [`หาไม่เจอ: ${unmatched.join(", ")}`] : []),
        ...notes,
      ],
    },
  };
}

// ─── 5. Lines someone sent (a photo, a list) against the system ───

/**
 * Grams per piece of an item, from menus sold by the piece ("อกเป็ดชาชู 2 ชิ้น (ท็อปปิ้ง)"):
 * that menu's shop line of the item ÷ the pieces in its name. Middle value if several.
 */
export function gramsPerPiece(m: Masters, skuId: string): { grams: number; from: string } | null {
  const found: { g: number; from: string }[] = [];
  for (const menu of m.menus) {
    const pieces = /(\d+(?:\.\d+)?)\s*ชิ้น/.exec(menu.name);
    if (!pieces) continue;
    const lines = m.bom.filter((l) => l.menuId === menu.id && l.skuId === skuId && !l.branchId && !l.deliveryOnly);
    if (lines.length !== 1) continue;
    const g = lines[0].qtyPerServing / Number(pieces[1]);
    if (g > 0) found.push({ g, from: `${menu.name} (${menu.code})` });
  }
  if (!found.length) return null;
  found.sort((a, b) => a.g - b.g);
  const mid = found[Math.floor(found.length / 2)];
  return { grams: mid.g, from: mid.from };
}

export async function compareItems(store: Store, args: { dish?: string | null; items: { name: string; qty: number; unit?: string | null; stated_cost?: number | null; code?: string | null }[] }): Promise<ToolResult> {
  const m = await store.masters();
  const pool = m.skus.filter((s) => s.active);
  const rows = (args.items ?? []).map((it) => {
    const stated = it.stated_cost != null && Number.isFinite(Number(it.stated_cost)) ? Number(it.stated_cost) : null;
    const base = { name: it.name, qty: n(it.qty), unit: it.unit ?? "", stated_cost: stated };
    const byCode = it.code ? matchByName(pool, it.code, 1)[0] : undefined;
    const cands = byCode ? [byCode] : matchByName(pool, it.name, 4, 0.4);
    const hit = cands[0];
    if (!hit) return { ...base, status: "not_in_system" as const };
    // A generic name ("น้ำ", "ซอส", "หมู") fits several items about equally: ask, never pick one
    if (!byCode && cands.length > 1 && cands[1].score >= hit.score - 0.05) return { ...base, status: "ambiguous" as const, candidates: cands.map((c) => `${c.item.name} (${c.item.code})`) };
    const sku = hit.item;
    const price = m.stdPrice.get(sku.id) ?? 0;
    if (!price) return { ...base, status: "no_price" as const, matched: `${sku.name} (${sku.code})` };
    const conv = inItemUnit(m, sku, n(it.qty), it.unit, PREPARED.test(it.name));
    if ("error" in conv) return { ...base, status: "unit_unknown" as const, matched: `${sku.name} (${sku.code})`, system_unit: unitText(sku.uom) };
    const usageQty = conv.qty;
    const via = conv.notes.join(" · ");
    const cost = usageQty * price;
    return {
      ...base,
      status: "ok" as const,
      matched: `${sku.name} (${sku.code})`,
      match_score: r2(hit.score),
      qty_in_system_unit: r1(usageQty),
      system_unit: unitText(sku.uom),
      converted_via: via || null,
      warning: PREPARED.test(it.name) && !PREPARED.test(sku.name) && !cookedYieldOf(sku) ? `ในภาพเป็น "${it.name}" แต่ในระบบเป็น ${sku.name} (ของดิบ) น้ำหนักไม่เท่ากัน` : null,
      system_cost: r2(cost),
      difference: stated === null ? null : r2(stated - cost),
    };
  });
  const ok = rows.filter((r) => r.status === "ok");
  const statedOk = ok.reduce((t, r) => t + (r.stated_cost ?? 0), 0);
  const systemOk = ok.reduce((t, r) => t + (r.system_cost ?? 0), 0);
  const statedRest = rows.filter((r) => r.status !== "ok").reduce((t, r) => t + (r.stated_cost ?? 0), 0);
  const why = (s: string) => (s === "not_in_system" ? "ไม่มีในระบบ" : s === "no_price" ? "ไม่มีราคา" : s === "ambiguous" ? "ชื่อกว้างไป" : "หน่วยแปลงไม่ได้");
  return {
    data: {
      dish: args.dish ?? null,
      items: rows,
      checked_total: { stated: r2(statedOk), system: r2(systemOk) },
      unchecked_stated_total: r2(statedRest),
      estimated_total: r2(systemOk + statedRest),
      note: "ราคามาตรฐานล่าสุดในระบบ ต่อหน่วยที่สูตรใช้",
    },
    card: {
      title: `${args.dish ? `${args.dish} · ` : ""}เทียบกับราคาในระบบ`,
      subtitle: "ราคาวัตถุดิบวันนี้ในระบบ",
      columns: ["รายการ", "ที่แจ้ง", "ในระบบ"],
      rows: rows.map((r) => [
        `${r.name} ${r.qty ? `${r1(r.qty)}${r.unit ? ` ${r.unit}` : ""}` : ""}`.trim(),
        r.stated_cost === null ? "–" : baht2(r.stated_cost),
        r.status === "ok" ? `${baht2(r.system_cost!)}${r.difference !== null && Math.abs(r.difference) >= 0.5 ? (r.difference > 0 ? " ▼" : " ▲") : ""}` : why(r.status),
      ]),
      total: ["รวมที่เช็คได้", baht2(statedOk), baht2(systemOk)],
      notes: [
        "▲ = ในระบบแพงกว่าที่แจ้ง · ▼ = ในระบบถูกกว่า",
        ...ok.filter((r) => r.converted_via).map((r) => `${r.name}: ${r.converted_via}`),
        ...ok.filter((r) => r.warning).map((r) => `⚠ ${r.warning}`),
        ...rows.filter((r) => r.status === "ambiguous").map((r) => `${r.name}: ระบุให้ชัดกว่านี้ เช่น ${(r as { candidates: string[] }).candidates.slice(0, 2).join(" หรือ ")}`),
        ...(statedRest > 0 ? [`รายการที่เช็คไม่ได้ ใช้ตัวเลขที่แจ้งไปก่อน → รวมประมาณ ${baht2(systemOk + statedRest)}`] : []),
      ],
    },
  };
}

// ─── 6. Which menus use an ingredient, and how much ───

export async function ingredientInMenus(store: Store, args: { query: string; menus?: string | null }): Promise<ToolResult> {
  const m = await store.masters();
  const hit = matchByName(m.skus.filter((s) => s.active), args.query, 1)[0];
  if (!hit) return { data: { found: false, query: args.query, note: "ไม่พบวัตถุดิบชื่อนี้ในระบบ" } };
  const sku = hit.item;
  const price = m.stdPrice.get(sku.id) ?? 0;
  const pool = m.menus.filter((x) => x.active && !/^MN-\d+L$/i.test(x.code) && !/ของแถม/.test(x.name));
  const menus = args.menus ? matchMenus(pool, args.menus) : pool;
  const open = m.branches.filter((b) => b.active !== false);
  const y = cookedYieldOf(sku);
  const rows: { code: string; name: string; qty: number; cooked: number | null; cost: number }[] = [];
  for (const menu of menus) {
    const branch = open.find((b) => b.brand === menu.brand) ?? open[0];
    const q = plateCost(m, menu, branch?.id ?? "").lines.find((l) => l.skuId === sku.id)?.qty ?? 0;
    if (q > 1e-9) rows.push({ code: menu.code, name: menu.name, qty: q, cooked: y ? q * y.cookedPerRaw : null, cost: q * price });
  }
  rows.sort((a, b) => b.qty - a.qty);
  const u = unitText(sku.uom);
  return {
    data: {
      item: `${sku.name} (${sku.code})`,
      price_per_unit: Number(price.toFixed(4)),
      unit: u,
      recipe_weight_is: y ? "ดิบ (ก่อนหุง)" : "ตามหน่วยของวัตถุดิบ",
      cooked_yield: y?.note ?? null,
      menus: rows.map((r) => ({ code: r.code, name: r.name, qty: r1(r.qty), cooked_qty: r.cooked === null ? null : r1(r.cooked), cost: r2(r.cost) })),
      filter: args.menus ?? null,
    },
    card: rows.length
      ? {
          title: `${sku.name} ใช้ในเมนูไหนบ้าง`,
          subtitle: `${args.menus ? `เมนู "${args.menus}" · ` : ""}ราคา ${u === "ก." ? `฿${baht2(price * 1000)} / กก.` : u === "มล." ? `฿${baht2(price * 1000)} / ลิตร` : `฿${baht2(price)} / ${u}`}`,
          columns: ["เมนู", y ? "ดิบ (≈สุก)" : "ใช้", "บาท"],
          rows: rows.slice(0, 15).map((r) => [r.name, y ? `${r1(r.qty)} (≈${r0(r.cooked!)}) ${u}` : `${r1(r.qty)} ${u}`, baht2(r.cost)]),
          notes: [...(y ? [`สูตรในระบบเป็นน้ำหนักดิบ · ${y.note}`] : []), ...(rows.length > 15 ? [`และอีก ${rows.length - 15} เมนู`] : [])],
        }
      : undefined,
  };
}

// ─── The menu Gemini picks from ───

export const TOOLS = {
  ingredient_price: ingredientPrice,
  menu_cost: menuCost,
  food_cost: foodCost,
  scenario,
  compare_items: compareItems,
  ingredient_in_menus: ingredientInMenus,
  // No tool fits: noted for Bucci's review (index.ts logs it); the model then says so plainly
  cannot_answer: async (_s: Store, a: { reason?: string; closest?: string }) => ({ data: { noted: true, reason: a?.reason ?? "", closest: a?.closest ?? "" } }),
} as const;
export type ToolName = keyof typeof TOOLS;

export async function runTool(store: Store, name: string, args: unknown): Promise<ToolResult> {
  const fn = (TOOLS as Record<string, (s: Store, a: never) => Promise<ToolResult>>)[name];
  if (!fn) return { data: { error: `ไม่มีเครื่องมือชื่อ ${name}` } };
  try {
    return await fn(store, (args ?? {}) as never);
  } catch (e) {
    return { data: { error: `คิดไม่สำเร็จ: ${(e as Error).message}` } };
  }
}
