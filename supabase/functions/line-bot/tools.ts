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
  /** Usage units per purchase unit (skus.converter) */
  converter?: number;
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
  /** What the recipe takes after yield (menu_bom.effective_qty); absent = the serving amount */
  effectiveQty?: number;
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
  /** More tables after the first (an item-by-item breakdown next to the per-menu one) */
  moreCards?: Card[];
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

/** A year written in the Thai calendar (2569) back to 2026 */
const ceDate = (d?: string | null) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) && Number(d.slice(0, 4)) > 2400 ? `${Number(d.slice(0, 4)) - 543}${d.slice(4)}` : d);

export type NamedPeriod = "today" | "yesterday" | "this_week" | "last_week" | "last_7_days" | "this_month" | "last_month" | "last_30_days";
/** "เมื่อวาน", "สัปดาห์ที่แล้ว", "เดือนที่แล้ว"… worked out here, never by the model */
export function namedPeriod(today: string, name: NamedPeriod): { from: string; to: string } {
  const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
  const ms = monthStart(today);
  switch (name) {
    case "today":
      return { from: today, to: today };
    case "yesterday":
      return { from: shiftDay(today, -1), to: shiftDay(today, -1) };
    case "this_week":
      return { from: shiftDay(today, -dow), to: today };
    case "last_week":
      return { from: shiftDay(today, -dow - 7), to: shiftDay(today, -dow - 1) };
    case "last_7_days":
      return { from: shiftDay(today, -7), to: shiftDay(today, -1) };
    case "last_30_days":
      return { from: shiftDay(today, -30), to: shiftDay(today, -1) };
    case "last_month":
      return { from: monthStart(shiftDay(ms, -1)), to: shiftDay(ms, -1) };
    default:
      return { from: ms, to: today };
  }
}
/** The period a tool was given: a named one, dates, or this month so far */
export function periodOf(today: string, a: { period?: NamedPeriod | null; from?: string | null; to?: string | null }): { from: string; to: string } {
  if (a.period && ["today", "yesterday", "this_week", "last_week", "last_7_days", "this_month", "last_month", "last_30_days"].includes(a.period)) return namedPeriod(today, a.period);
  return resolvePeriod(today, ceDate(a.from), ceDate(a.to));
}

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

/** English ingredient words people type ("duck breast" → อกเป็ด) */
const ITEM_WORDS: [RegExp, string][] = [
  [/pork\s*belly/gi, "สามชั้น"], [/pork\s*(shoulder|collar|neck)/gi, "สันคอ"], [/pork\s*loin/gi, "สันนอก"], [/minced\s*pork|ground\s*pork/gi, "หมูสับ"],
  [/chicken\s*breast/gi, "อกไก่"], [/chicken\s*thigh/gi, "สะโพกไก่"], [/duck\s*breast/gi, "อกเป็ด"], [/chashu/gi, "ชาชู"], [/\begg\b/gi, "ไข่"],
  [/\bnoodles?\b/gi, "เส้น"], [/japanese\s*rice|sushi\s*rice|koshihikari/gi, "ข้าวญี่ปุ่น"], [/\brice\b/gi, "ข้าว"], [/\bnori\b/gi, "สาหร่าย"], [/green\s*onion|scallion/gi, "ต้นหอม"], [/\bgarlic\b/gi, "กระเทียม"],
  [/\bchicken\b/gi, "ไก่"], [/\bpork\b/gi, "หมู"], [/\bduck\b/gi, "เป็ด"], [/\bbeef\b/gi, "เนื้อ"], [/\bvinegar\b/gi, "น้ำส้มสายชู"], [/\bsauce\b/gi, "ซอส"], [/\boil\b/gi, "น้ำมัน"],
  [/\btruffle\b/gi, "ทรัฟเฟิล"], [/\bwagyu\b/gi, "วากิว"], [/\bshrimp\b/gi, "กุ้ง"], [/\bmentaiko\b/gi, "เมนไทโกะ"], [/\btare\b/gi, "ทาเระ"], [/\bstock\b/gi, "น้ำสต๊อก"],
];
export const itemWords = (q: string | null | undefined) => ITEM_WORDS.reduce((s, [re, th]) => s.replace(re, th), q ?? "");
/** An ingredient by name in Thai or English, or code */
export function matchSku<T extends { code: string; name: string }>(list: T[], query: string | null | undefined, limit = 5, floor = 0.34): { item: T; score: number }[] {
  const q = (query ?? "").trim();
  if (!q) return [];
  const a = matchByName(list, q, limit, floor);
  const t = itemWords(q);
  const b = t === q ? a : matchByName(list, t, limit, floor);
  // Every word in the name, any order ("chicken stock" → ไก่ + น้ำสต๊อก = "น้ำสต๊อกไก่")
  const words = t.split(/\s+/).map(norm).filter((w) => w.length >= 2);
  const c = words.length > 1 ? list.filter((x) => words.every((w) => norm(x.name).includes(w))).map((item) => ({ item, score: 0.9 })).slice(0, limit) : [];
  return [c, b, a].sort((x, y) => (y[0]?.score ?? 0) - (x[0]?.score ?? 0))[0];
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
  kg: { to: "g", times: 1000 }, "กก.": { to: "g", times: 1000 }, กก: { to: "g", times: 1000 }, กิโล: { to: "g", times: 1000 }, กิโลกรัม: { to: "g", times: 1000 }, โล: { to: "g", times: 1000 }, ขีด: { to: "g", times: 100 },
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
  const found = matchSku(m.skus.filter((s) => s.active), args.query, 5);
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

/** The list price that gives a target food cost (rounded up to the baht) */
export const priceForFc = (cost: number, targetPct: number) => {
  // 0.3 meant as 30%
  const t = targetPct > 0 && targetPct < 1 ? targetPct * 100 : targetPct;
  return t > 0 ? Math.ceil(Math.round(cost * 100) / t - 1e-9) : null;
};

export async function menuCost(store: Store, args: { query: string; branch?: string | null; new_price?: number | null; only?: string | null; target_fc?: number | null }): Promise<ToolResult> {
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
      const target = n(args.target_fc) > 0 ? priceForFc(total, n(args.target_fc)) : null;
      return { code: menu.code, name: menu.name, cost_per_plate: r2(total), price, food_cost_pct: pct(total, price) === null ? null : r1(pct(total, price)!), ...(target !== null ? { price_for_target_fc: target } : {}) };
    });
    if (only) {
      // Item by item: how much of each goes in a serving and what it costs (a range across menus)
      const items = new Map<string, { name: string; unit: string; menus: number; qMin: number; qMax: number; cMin: number; cMax: number }>();
      for (const menu of group) {
        for (const l of partOf(plateCost(m, menu, branchFor(menu)?.id ?? "").lines) ?? []) {
          const sku = m.skus.find((x) => x.id === l.skuId);
          const e = items.get(l.skuId) ?? { name: sku?.name ?? l.skuId, unit: unitText(sku?.uom ?? ""), menus: 0, qMin: Infinity, qMax: 0, cMin: Infinity, cMax: 0 };
          e.menus++;
          e.qMin = Math.min(e.qMin, l.qty);
          e.qMax = Math.max(e.qMax, l.qty);
          e.cMin = Math.min(e.cMin, l.cost);
          e.cMax = Math.max(e.cMax, l.cost);
          items.set(l.skuId, e);
        }
      }
      const itemRows = [...items.values()].sort((a, b) => b.cMax - a.cMax);
      const range = (a: number, b: number, f: (v: number) => string) => (Math.abs(a - b) < 0.005 ? f(a) : `${f(a)}–${f(b)}`);
      return {
        data: {
          found: true,
          only: only.label,
          items_per_serving: itemRows.map((e) => ({ item: e.name, in_menus: e.menus, qty: range(e.qMin, e.qMax, (v) => `${r1(v)}`) + ` ${e.unit}`, cost: range(e.cMin, e.cMax, (v) => baht2(v)) })),
          menus: list,
          more: Math.max(0, group.length - 12),
          note: "ต้นทุนตามสูตรหน้าร้านวันนี้ ราคาวัตถุดิบล่าสุด · ช่วงตัวเลข = แต่ละเมนูใส่ไม่เท่ากัน",
        },
        card: {
          title: `${only.label}ใน "${args.query}" · ต่อเสิร์ฟ`,
          subtitle: "ปริมาณและต้นทุนต่อจาน ตามสูตรหน้าร้าน · ราคาวัตถุดิบวันนี้",
          columns: ["วัตถุดิบ", "ใส่", "บาท"],
          rows: itemRows.map((e) => [`${e.name} (${e.menus} เมนู)`, `${range(e.qMin, e.qMax, (v) => `${r1(v)}`)} ${e.unit}`, range(e.cMin, e.cMax, baht2)]),
          notes: ["ช่วงตัวเลข = แต่ละเมนูใส่ไม่เท่ากัน"],
        },
        moreCards: [{
          title: `ต้นทุน${only.label} · "${args.query}" ${group.length} เมนู`,
          subtitle: "ตามสูตรหน้าร้าน · ราคาวัตถุดิบวันนี้",
          columns: ["เมนู", only.label, "ทั้งจาน"],
          rows: list.map((x) => [x.name, baht2((x as { only_cost: number }).only_cost), baht2(x.cost_per_plate)]),
        }],
      };
    }
    if (n(args.target_fc) > 0)
      return {
        data: { found: true, target_fc: n(args.target_fc), menus: list, note: "ราคาที่ต้องขาย = ต้นทุนต่อจาน ÷ FC เป้า ปัดขึ้นเป็นบาท" },
        card: {
          title: `ต้องขายเท่าไหร่ถึงได้ FC ${n(args.target_fc)}% · "${args.query}"`,
          subtitle: "ต้นทุนตามสูตรหน้าร้าน · ราคาวัตถุดิบวันนี้",
          columns: ["เมนู", "ราคาตอนนี้", "ต้องขาย"],
          rows: list.map((x) => [`${x.name} (FC ${pctText(x.food_cost_pct)})`, baht(x.price), baht((x as { price_for_target_fc: number }).price_for_target_fc)]),
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
  if (part && only && !(n(args.target_fc) > 0)) {
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
      ...(n(args.target_fc) > 0 ? { target_fc: n(args.target_fc), price_for_target_fc: priceForFc(plate.total, n(args.target_fc)) } : {}),
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
        ...(n(args.target_fc) > 0 ? [`ถ้าต้องการ FC ${n(args.target_fc)}% ต้องขาย ${baht(priceForFc(plate.total, n(args.target_fc))!)} บาท`] : []),
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
export interface PeriodWork {
  std: Standard;
  mix: Map<string, MenuMix>;
  corrected: boolean;
  lastSaleDay: string | null;
  /** Each branch's last day with sales in the period (absent = none) */
  lastByBranch: Map<string, string>;
  branchIds: string[];
}

export async function workPeriod(store: Store, m: Masters, branchIds: string[], from: string, to: string, withMix = true, onlyCodes?: Set<string>): Promise<PeriodWork> {
  const [allSales, allCorrections] = await Promise.all([store.sales(branchIds, from, to), store.corrections(branchIds, from, to)]);
  // Only some menus: their sales, and no usage corrections (those are per item, not per menu)
  const sales = onlyCodes ? allSales.filter((x) => onlyCodes.has(x.menu_code)) : allSales;
  const corrections = onlyCodes ? [] : allCorrections;
  const lastByBranch = new Map<string, string>();
  for (const x of allSales) if (!lastByBranch.has(x.branch_id) || x.sale_date > lastByBranch.get(x.branch_id)!) lastByBranch.set(x.branch_id, x.sale_date);
  const menuByCode = new Map(m.menus.map((x) => [x.code, { code: x.code, name: x.name, category: x.category }]));
  const skuById = new Map(m.skus.map((s) => [s.id, { id: s.id, code: s.code, name: s.name, type: s.type, uom: s.uom }]));
  const std = computeStandard({ sales, ctx: m.ctx, ctxAt: m.ctxAt, stdPrice: m.stdPrice, priceAt: m.priceAt, menuByCode, skuById, corrections, branchIds: new Set(branchIds), from, to });
  const corrected = std.skus.some((s) => s.correction);
  // The last day with sales in: sales are imported after the day, so "this month" may stop short
  const lastSaleDay = sales.reduce<string | null>((d, x) => (d === null || x.sale_date > d ? x.sale_date : d), null);
  // The same sales again, keeping each menu's ingredients apart (computeStandard sums them)
  const priceOn = priceOnOf(m.priceAt, m.stdPrice);
  const mix = new Map<string, MenuMix>();
  if (!withMix) return { std, mix, corrected, lastSaleDay, lastByBranch, branchIds };
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
  return { std, mix, corrected, lastSaleDay, lastByBranch, branchIds };
}

/** The period before: the same days of last month when the period starts on the 1st, else the same length just before */
export function previousPeriod(p: { from: string; to: string }): { from: string; to: string } {
  if (p.from.slice(8) === "01" && p.from.slice(0, 7) === p.to.slice(0, 7)) {
    const d = new Date(`${p.from}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - 1);
    const from = d.toISOString().slice(0, 10);
    const end = shiftDay(p.from, -1);
    const to = `${from.slice(0, 8)}${p.to.slice(8)}`;
    return { from, to: to > end ? end : to };
  }
  const days = Math.round((Date.parse(p.to) - Date.parse(p.from)) / 86_400_000) + 1;
  return { from: shiftDay(p.from, -days), to: shiftDay(p.from, -1) };
}

/** Menu codes a group name means: by name, else by category; their Line Man aliases (MN-001L) too */
export function menuCodesFor(m: Masters, group: string): Set<string> {
  const q = norm(menuWords(group)).replace(/^ราเมน$/, "ramen");
  if (!q) return new Set();
  const codes = new Set(matchMenus(m.menus, group).map((x) => x.code));
  for (const x of m.menus) if (norm(x.category).includes(q)) codes.add(x.code);
  for (const c of [...codes]) if (!/L$/i.test(c)) codes.add(`${c}L`);
  return codes;
}

/**
 * What the reader must know about the numbers: no sales at all; a branch whose sales stop
 * before yesterday (today's are imported tomorrow, so today never counts as missing); a branch
 * name not known; items used with no price (cost understated).
 */
export function dataNotes(m: Masters, p: { from: string; to: string }, w: Pick<PeriodWork, "std" | "lastSaleDay" | "lastByBranch" | "branchIds">, unknownBranch?: string): string[] {
  const out: string[] = [];
  const expected = p.to < m.today ? p.to : shiftDay(m.today, -1);
  if (!w.lastSaleDay) {
    out.push(expected < p.from ? "วันนี้ยังไม่มียอดขาย (ยอดของวันนี้นำเข้าพรุ่งนี้)" : `ยังไม่มียอดขายในระบบช่วง ${periodText(p.from, p.to)}`);
  } else if (expected >= p.from) {
    // Each open branch that sold before but stops short (or a closed day: says both)
    const short = w.branchIds
      .map((id) => ({ b: m.branches.find((x) => x.id === id), last: w.lastByBranch.get(id) }))
      .filter((x) => x.b && x.b.active !== false && x.last && x.last < expected);
    for (const x of short.slice(0, 3)) out.push(`${x.b!.name}: ยอดขายในระบบมีถึง ${thDay(x.last!)} (ยังไม่ได้นำเข้า หรือร้านปิด)`);
  }
  if (unknownBranch) out.push(`ไม่รู้จักสาขา "${unknownBranch}" เลยใช้ทุกสาขา`);
  const noPrice = w.std.skus.filter((x) => x.stdQty > 0 && x.stdCost <= 0 && !(m.stdPrice.get(x.skuId) ?? 0));
  if (noPrice.length) out.push(`วัตถุดิบไม่มีราคา ${noPrice.length} ตัว (${noPrice.slice(0, 3).map((x) => x.name).join(", ")}${noPrice.length > 3 ? "…" : ""}) ต้นทุนอาจต่ำกว่าจริง`);
  return out;
}

type FcSort = "revenue" | "fc_high" | "fc_low" | "qty" | "profit";
const SORT_LABEL: Record<FcSort, string> = { revenue: "ขายดีสุด (บาท)", fc_high: "FC สูงสุด", fc_low: "FC ต่ำสุด", qty: "ขายได้กี่จาน", profit: "กำไรหลังหักวัตถุดิบ" };

export async function foodCost(
  store: Store,
  args: { period?: NamedPeriod | null; from?: string | null; to?: string | null; branch?: string | null; top?: number | null; menus?: string | null; sort?: FcSort | null; compare?: "branches" | "previous_period" | null; by_day?: boolean | null },
): Promise<ToolResult> {
  const m = await store.masters();
  const p = periodOf(m.today, args);
  const br = resolveBranches(m, args.branch);
  const fcOf = (cost: number, rev: number) => (pct(cost, rev) === null ? null : r1(pct(cost, rev)!));

  // Side by side: each branch, or this period against the one before
  if (args.compare === "branches" || args.compare === "previous_period") {
    const sides =
      args.compare === "branches"
        ? br.ids.map((id) => ({ label: m.branches.find((b) => b.id === id)?.name ?? id, ids: [id], period: p }))
        : [
            { label: "ช่วงนี้", ids: br.ids, period: p },
            { label: "ช่วงก่อน", ids: br.ids, period: previousPeriod(p) },
          ];
    const groupCodes = args.menus ? menuCodesFor(m, args.menus) : null;
    const sideNotes: string[] = br.unknown ? [`ไม่รู้จักสาขา "${br.unknown}" เลยใช้ทุกสาขา`] : [];
    if (groupCodes && !groupCodes.size) return { data: { found: false, menus: args.menus, note: "ไม่พบเมนูกลุ่มนี้ในระบบ" } };
    const rows = await Promise.all(
      sides.map(async (side) => {
        const w = await workPeriod(store, m, side.ids, side.period.from, side.period.to, false);
        const { std } = w;
        if (side.period === p) sideNotes.push(...dataNotes(m, side.period, w));
        const pool = groupCodes ? std.menus.filter((x) => groupCodes.has(x.code)) : null;
        const rev = pool ? pool.reduce((t, x) => t + x.revenue, 0) : std.revenue;
        const cost = pool ? pool.reduce((t, x) => t + x.stdCost, 0) : std.stdCost;
        return { label: side.label, period: side.period, revenue: r0(rev), recipe_cost: r0(cost), food_cost_pct: fcOf(cost, rev), ...(pool ? { plates: r0(pool.reduce((t, x) => t + x.qty, 0)) } : {}) };
      }),
    );
    const shown = rows.filter((r) => r.revenue > 0 || args.compare === "previous_period");
    return {
      data: { compare: args.compare, branches: br.label, only_menus: args.menus ?? "ทุกเมนู", rows: shown, data_notes: sideNotes, note: "ต้นทุนตามสูตร (เหมือนหน้าต้นทุนอาหารในแอป)" },
      card: {
        title: `${args.compare === "branches" ? "Food cost แยกสาขา" : `Food cost เทียบช่วงก่อน · ${br.label}`}${args.menus ? ` · ${args.menus}` : " · ทุกเมนู"}`,
        subtitle: args.compare === "branches" ? `${periodText(p.from, p.to)} · ตามสูตร` : "ตามสูตร · ช่วงก่อน = วันเดียวกันของเดือนก่อน",
        columns: ["", "ยอดขาย", "FC"],
        rows: shown.map((r) => [args.compare === "branches" ? r.label : `${r.label} (${periodText(r.period.from, r.period.to)})`, baht(r.revenue), pctText(r.food_cost_pct)]),
        notes: [...new Set(sideNotes)].slice(0, 5),
      },
    };
  }

  // Day by day ("FC รายวันสัปดาห์นี้", "FC ราเมนรายวัน")
  if (args.by_day) {
    const codes = args.menus ? menuCodesFor(m, args.menus) : undefined;
    if (codes && !codes.size) return { data: { found: false, menus: args.menus, note: "ไม่พบเมนูกลุ่มนี้ในระบบ" } };
    const wd = await workPeriod(store, m, br.ids, p.from, p.to, false, codes);
    const notesDay = dataNotes(m, p, wd, br.unknown);
    const days = wd.std.days.map((d) => ({ day: d.date, revenue: r0(d.revenue), recipe_cost: r0(d.stdCost), food_cost_pct: fcOf(d.stdCost, d.revenue), bills: d.bills }));
    // The headline from the same daily figures (before usage corrections), so the rows add up to it
    const sumRev = wd.std.days.reduce((t, d) => t + d.revenue, 0);
    const sumCost = wd.std.days.reduce((t, d) => t + d.stdCost, 0);
    if (wd.corrected) notesDay.push(`รายวันยังไม่หักรายการปรับยอดใช้ (ทั้งช่วงหลังปรับ FC ${pctText(pct(wd.std.stdCost, wd.std.revenue))})`);
    if (days.length > 20) notesDay.push(`แสดง 20 วันล่าสุด จาก ${days.length} วัน`);
    return {
      data: { period: p, branches: br.label, only_menus: args.menus ?? "ทุกเมนู", days, food_cost_pct: fcOf(sumCost, sumRev), data_notes: notesDay },
      card: {
        title: `Food cost รายวัน · ${br.label} · ${args.menus ?? "ทุกเมนู"}`,
        subtitle: `${periodText(p.from, p.to)} · ตามสูตร`,
        headline: pctText(pct(sumCost, sumRev)),
        columns: ["วัน", "ยอดขาย", "FC"],
        rows: days.slice(-20).map((d) => [thDay(d.day), baht(d.revenue), pctText(d.food_cost_pct)]),
        notes: notesDay,
      },
    };
  }
  const w = await workPeriod(store, m, br.ids, p.from, p.to, false);
  const { std } = w;
  const notesData = dataNotes(m, p, w, br.unknown);
  const top = Math.max(3, Math.min(n(args.top) || 10, 20));
  const sort: FcSort = args.sort && SORT_LABEL[args.sort] ? args.sort : "revenue";
  // Only some menus ("ราเมน", "ด้ง", "Standard"): by name, else by category
  let pool = [...std.menus];
  if (args.menus) {
    const codes = menuCodesFor(m, args.menus);
    if (!codes.size) return { data: { found: false, menus: args.menus, note: "ไม่พบเมนูกลุ่มนี้ในระบบ" } };
    pool = pool.filter((x) => codes.has(x.code));
  }
  const key = (x: (typeof pool)[number]) => (sort === "fc_high" ? x.pct : sort === "fc_low" ? -x.pct : sort === "qty" ? x.qty : sort === "profit" ? x.revenue - x.stdCost : x.revenue);
  // FC rankings skip what barely sold (a 1-plate menu at 60% isn't the story)
  // …and menus without a recipe cost (0% isn't a cheap dish, it's a missing recipe)
  const ranked = pool.filter((x) => x.revenue > 0 && (sort.startsWith("fc") || sort === "profit" ? x.qty >= 5 && x.stdCost > 0 : true)).sort((a, b) => key(b) - key(a));
  const menus = ranked.slice(0, top);
  const unknownRevenue = std.unknownMenus.reduce((t, u) => t + u.revenue, 0);
  const fc = pct(std.stdCost, std.revenue);
  const subRev = pool.reduce((t, x) => t + x.revenue, 0);
  const subCost = pool.reduce((t, x) => t + x.stdCost, 0);
  return {
    data: {
      period: p,
      branches: br.label,
      unknown_branch: br.unknown ?? null,
      revenue: r0(std.revenue),
      recipe_cost: r0(std.stdCost),
      food_cost_pct: fc === null ? null : r1(fc),
      bills: std.bills,
      ...(args.menus ? { only_menus: args.menus, only_menus_revenue: r0(subRev), only_menus_qty: r0(pool.reduce((t, x) => t + x.qty, 0)), only_menus_food_cost_pct: fcOf(subCost, subRev) } : {}),
      sorted_by: SORT_LABEL[sort],
      menus: menus.map((x) => ({ code: x.code, name: x.name, qty: r0(x.qty), revenue: r0(x.revenue), cost: r0(x.stdCost), food_cost_pct: r1(x.pct), cost_per_plate: r2(x.perServing), profit_after_ingredients: r0(x.revenue - x.stdCost) })),
      menus_not_set_up: std.unknownMenus.slice(0, 5).map((u) => ({ code: u.code, name: u.name, revenue: r0(u.revenue) })),
      menus_not_set_up_revenue: r0(unknownRevenue),
      average_bill: std.bills > 0 ? r0(std.revenue / std.bills) : null,
      data_notes: notesData,
      note: "ต้นทุนตามสูตร (เหมือนหน้าต้นทุนอาหารในแอป) ไม่ใช่ต้นทุนจริงจากการนับสต๊อก",
    },
    card: {
      title: `Food cost ตามสูตร · ${br.label}${args.menus ? ` · ${args.menus}` : ""}`,
      subtitle: args.menus
        ? `${periodText(p.from, p.to)} · ยอดขายกลุ่มนี้ ฿${baht(subRev)} · ทั้งร้าน FC ${pctText(fc)}`
        : `${periodText(p.from, p.to)} · ยอดขาย ฿${baht(std.revenue)} · ต้นทุน ฿${baht(std.stdCost)}`,
      headline: args.menus ? pctText(fcOf(subCost, subRev)) : pctText(fc),
      columns: [`เมนู (${SORT_LABEL[sort]})`, sort === "qty" ? "จาน" : sort === "profit" ? "กำไร" : "ยอดขาย", "FC"],
      rows: menus.map((x) => [x.name, sort === "qty" ? baht(x.qty) : sort === "profit" ? baht(x.revenue - x.stdCost) : baht(x.revenue), pctText(x.pct)]),
      notes: [
        ...notesData,
        "ตัวเลขเดียวกับหน้าต้นทุนอาหาร (ตามสูตร) ในแอป",
        ...(sort.startsWith("fc") ? ["ไม่นับเมนูที่ขายได้ไม่ถึง 5 จาน"] : []),
        ...(unknownRevenue > 0 && !args.menus ? [`เมนูที่ยังไม่ตั้งในระบบ ขายได้ ฿${baht(unknownRevenue)} (ไม่มีต้นทุน)`] : []),
      ],
    },
  };
}

// ─── 4. What-if ───

export interface ScenarioArgs {
  period?: NamedPeriod | null;
  from?: string | null;
  to?: string | null;
  branch?: string | null;
  /** One menu (menu) or a whole category (category, e.g. "ramen"); a new price or a % change */
  menu_prices?: { menu?: string | null; category?: string | null; new_price?: number | null; change_pct?: number | null }[] | null;
  ingredient_prices?: { item: string; new_price_per_kg?: number | null; change_pct?: number | null }[] | null;
  volume?: { menus?: string[] | null; group?: "price_changed" | "all" | null; change_pct: number }[] | null;
  include_delivery?: boolean | null;
  /** Recipe changes on a menu or a group, worked into those menus' cost over the period */
  recipe_changes?: { menu: string; changes: RecipeChange[] }[] | null;
  /** Menus not on sale yet: their plates over the period added (cost from given items, or a cost) */
  new_menus?: { name: string; price: number; plates_per_day: number; cost?: number | null; items?: { name: string; qty: number; unit?: string | null; stated_cost?: number | null }[] | null }[] | null;
}

export async function scenario(store: Store, args: ScenarioArgs): Promise<ToolResult> {
  const m = await store.masters();
  const p = periodOf(m.today, args);
  const br = resolveBranches(m, args.branch);
  const w = await workPeriod(store, m, br.ids, p.from, p.to);
  const { std, mix, corrected } = w;
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
    const hit = matchSku(m.skus.filter((s) => s.active), c.item, 1, 0.5)[0];
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

  // The scenario's ingredient prices: a recipe change and a new menu are costed with them, so
  // taking out an item that also gets dearer takes out its new price (not the old one)
  const ms: Masters = newSkuPrice.size ? { ...m, stdPrice: new Map([...m.stdPrice, ...newSkuPrice]) } : m;
  // Recipe changes: one per-plate change for each menu (every plate sold, both channels). The
  // same menu named twice (a group, then the menu) is changed once, its changes together.
  const perMenu = new Map<string, { menu: BotMenu; changes: RecipeChange[]; keys: Set<string> }>();
  for (const rc of args.recipe_changes ?? []) {
    if (!rc?.menu) continue;
    const targets = matchMenus(m.menus.filter((x) => x.active), rc.menu);
    if (!targets.length) unmatched.push(rc.menu);
    for (const t of targets) {
      const e = perMenu.get(t.code) ?? { menu: t, changes: [], keys: new Set<string>() };
      for (const c of rc.changes ?? []) {
        const key = JSON.stringify([norm(c.item ?? ""), c.action, n(c.qty), c.unit ?? "", norm(c.replace_with ?? "")]);
        if (e.keys.has(key)) continue;
        e.keys.add(key);
        e.changes.push(c);
      }
      perMenu.set(t.code, e);
    }
  }
  const plateDelta = new Map<string, number>();
  const recipeDone: string[] = [];
  const recipeNotDone: string[] = [];
  const openB = m.branches.filter((b) => b.active !== false);
  for (const { menu: t, changes } of perMenu.values()) {
    const b = openB.find((x) => br.ids.includes(x.id) && x.brand === t.brand) ?? openB.find((x) => x.brand === t.brand) ?? openB[0];
    const r = changedPlate(ms, t, b?.id ?? "", changes);
    const d = r.now - r.was;
    plateDelta.set(t.code.toLowerCase(), d);
    plateDelta.set(`${t.code}L`.toLowerCase(), (plateDelta.get(`${t.code}L`.toLowerCase()) ?? 0) + d);
    recipeDone.push(...r.done.map((x) => `${t.name}: ${x}`));
    recipeNotDone.push(...r.notes);
  }
  const delivery = !!args.include_delivery;
  let dRev = 0;
  let dCost = 0;
  let repricedGpNew = 0;
  let repricedGpOld = 0;
  const changed: { code: string; name: string; fcNow: number | null; fcNew: number | null; perPlate: number; perPlateNew: number; oldPrice: number; newPrice: number }[] = [];
  for (const [code, row] of mix) {
    const ratio = newPrice.has(code) ? newPrice.get(code)! / (menuByCode.get(code)?.price || newPrice.get(code)!) : 1;
    const f = volume.get(code) ?? 1;
    const rev = (row.revenueShop * ratio + (row.revenue - row.revenueShop) * (delivery ? ratio : 1)) * f;
    let cost = row.cost + (plateDelta.get(code.toLowerCase()) ?? 0) * row.qty;
    for (const [id, e] of row.sku) if (newSkuPrice.has(id)) cost += e.qty * newSkuPrice.get(id)! - e.cost;
    cost *= f;
    dRev += rev - row.revenue;
    dCost += cost - row.cost;
    if (newPrice.has(code)) {
      repricedGpNew += (rev - cost) / f;
      repricedGpOld += row.revenue - row.cost;
      const menu = menuByCode.get(code)!;
      const plate = row.qty > 0 ? row.cost / row.qty : 0;
      const plateNew = row.qty > 0 ? cost / f / row.qty : 0;
      changed.push({ code, name: menu.name, fcNow: pct(plate, menu.price), fcNew: pct(plateNew, newPrice.get(code)!), perPlate: plate, perPlateNew: plateNew, oldPrice: menu.price, newPrice: newPrice.get(code)! });
    }
  }
  // New menus: plates per day × the days the period sold anything, costed like compare_items.
  // One whose cost is unknown (no cost, no items, or an item not priced) stays out of the
  // totals: at ฿0 it would make the whole shop look cheaper.
  const saleDays = new Set(std.days.filter((d) => d.revenue > 0).map((d) => d.date)).size;
  const added: { name: string; price: number; plates: number; perPlate: number }[] = [];
  const newMenuNotes: string[] = [];
  for (const nm of args.new_menus ?? []) {
    if (!nm?.name) continue;
    if (!(n(nm.price) > 0) || !(n(nm.plates_per_day) > 0)) {
      newMenuNotes.push(`${nm.name}: ต้องมีราคาขายและจำนวนจานต่อวัน`);
      continue;
    }
    if (!saleDays) {
      newMenuNotes.push(`${nm.name}: ช่วงนี้ไม่มียอดขาย เลยคิดเมนูใหม่รวมไม่ได้`);
      continue;
    }
    let perPlate = n(nm.cost);
    if (!(perPlate > 0)) {
      const c = nm.items?.length ? costItems(ms, nm.items) : null;
      if (!c || c.notCosted.length || !(c.total > 0)) {
        newMenuNotes.push(`${nm.name}: ยังไม่ได้รวม เพราะยังไม่รู้ต้นทุน${c?.notCosted.length ? ` ${c.notCosted.join(", ")}` : ""} (บอกต้นทุนต่อจาน หรือวัตถุดิบที่ใช้)`);
        continue;
      }
      perPlate = c.total;
    }
    const plates = n(nm.plates_per_day) * saleDays;
    added.push({ name: nm.name, price: n(nm.price), plates, perPlate });
    dRev += n(nm.price) * plates;
    dCost += perPlate * plates;
  }
  const rev0 = std.revenue;
  const cost0 = std.stdCost;
  const rev1 = rev0 + dRev;
  const cost1 = cost0 + dCost;
  const gp0 = rev0 - cost0;
  const gp1 = rev1 - cost1;
  // Break-even: how much more the repriced menus must sell for the same baht after ingredients
  const noVolumeOnRepriced = ![...newPrice.keys()].some((c) => volume.has(c));
  // (the repriced menus' own profit, so a recipe change or a new menu elsewhere doesn't move it)
  const breakEven = newPrice.size && noVolumeOnRepriced && repricedGpNew > 0 && repricedGpNew < repricedGpOld ? (repricedGpOld - repricedGpNew) / repricedGpNew : null;
  const assumptions = [
    volume.size ? "เมนูที่ไม่ได้ระบุ ขายเท่าเดิม" : "ขายได้จำนวนจานเท่าเดิม",
    newPrice.size ? (delivery ? "ราคาใหม่ใช้กับเดลิเวอรี่ด้วย" : "เดลิเวอรี่คงราคาเดิม") : "",
    newPrice.size ? "ส่วนลดคิดตามสัดส่วนเดิม" : "",
    newSkuPrice.size ? "ราคาวัตถุดิบใหม่ใช้ทั้งช่วง" : "",
    plateDelta.size ? "สูตรที่แก้ใช้กับทุกจานที่ขายในช่วงนี้ (รวมเดลิเวอรี่) คิดจากสูตรและราคาวันนี้" : "",
    added.length ? `เมนูใหม่: จานต่อวัน × ${saleDays} วันที่มียอดขายในช่วงนี้ ราคาเต็มไม่หักส่วนลด` : "",
    ...newMenuNotes,
    ...recipeNotDone,
    corrected && (newSkuPrice.size || volume.size) ? "ช่วงนี้มีรายการปรับยอดใช้ ส่วนที่เปลี่ยนคิดจากยอดใช้ตามสูตรก่อนปรับ" : "",
    ...dataNotes(m, p, w, br.unknown),
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
      recipe_changes_done: recipeDone,
      new_menus: added.map((x) => ({ name: x.name, price: x.price, cost_per_plate: r2(x.perPlate), food_cost_pct: pct(x.perPlate, x.price) === null ? null : r1(pct(x.perPlate, x.price)!), plates_in_period: r0(x.plates) })),
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
        ...added.map((x) => [`ใหม่: ${x.name} ${baht(x.price)} (${baht(x.plates)} จาน)`, baht(x.price * x.plates), pctText(pct(x.perPlate, x.price))]),
      ],
      notes: [
        `กำไรหลังหักวัตถุดิบ ${signed(gp1 - gp0)} บาท เทียบตอนนี้`,
        ...(breakEven !== null ? [`เมนูที่ปรับราคาต้องขายเพิ่ม ${r1(breakEven * 100)}% ถึงจะเท่าเดิม`] : []),
        ...assumptions,
        ...recipeDone.slice(0, 4),
        ...newMenuNotes.slice(0, 2),
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

type GivenItem = { name: string; qty: number; unit?: string | null; stated_cost?: number | null; code?: string | null };

/**
 * A dish's items as someone wrote them, priced with the system's prices (a sub-recipe at its
 * ingredients' cost). Items that can't be priced keep the cost stated, if any; the rest are
 * listed as not costed. compare_items and a new menu in scenario both cost a dish this way.
 */
export function costItems(m: Masters, items: GivenItem[]) {
  const pool = m.skus.filter((s) => s.active);
  const rows = (items ?? []).map((it) => {
    const stated = it.stated_cost != null && Number.isFinite(Number(it.stated_cost)) ? Number(it.stated_cost) : null;
    const base = { name: it.name, qty: n(it.qty), unit: it.unit ?? "", stated_cost: stated };
    const byCode = it.code ? matchByName(pool, it.code, 1)[0] : undefined;
    const cands = byCode ? [byCode] : matchSku(pool, it.name, 4, 0.4);
    const hit = cands[0];
    if (!hit) return { ...base, status: "not_in_system" as const };
    // A generic name ("น้ำ", "ซอส", "หมู") fits several items about equally: ask, never pick one
    if (!byCode && cands.length > 1 && cands[1].score >= hit.score - 0.05) return { ...base, status: "ambiguous" as const, candidates: cands.map((c) => `${c.item.name} (${c.item.code})`) };
    const sku = hit.item;
    const price = unitCostOf(m, sku.id);
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
  /** Items left out of the total: not priced in the system and no cost stated */
  const notCosted = rows.filter((r) => r.status !== "ok" && r.stated_cost === null).map((r) => r.name);
  return { rows, ok, statedOk, systemOk, statedRest, total: systemOk + statedRest, notCosted };
}

export async function compareItems(store: Store, args: { dish?: string | null; selling_price?: number | null; target_fc?: number | null; items: GivenItem[] }): Promise<ToolResult> {
  const m = await store.masters();
  const { rows, ok, statedOk, systemOk, statedRest, total, notCosted } = costItems(m, args.items);
  const target = n(args.target_fc) > 0 && n(args.target_fc) < 1 ? n(args.target_fc) * 100 : n(args.target_fc);
  // FC and a price only from a whole cost: an item left out would make the dish look cheaper
  const whole = notCosted.length === 0 && total > 0;
  const partial = notCosted.length ? `ยังไม่รวม ${notCosted.join(", ")} (ไม่มีราคาในระบบ บอกต้นทุนมาได้)` : "";
  const why = (s: string) => (s === "not_in_system" ? "ไม่มีในระบบ" : s === "no_price" ? "ไม่มีราคา" : s === "ambiguous" ? "ชื่อกว้างไป" : "หน่วยแปลงไม่ได้");
  return {
    data: {
      dish: args.dish ?? null,
      items: rows,
      checked_total: { stated: r2(statedOk), system: r2(systemOk) },
      unchecked_stated_total: r2(statedRest),
      estimated_total: r2(systemOk + statedRest),
      ...(n(args.selling_price) > 0 ? { selling_price: n(args.selling_price), food_cost_pct: whole ? r1((total / n(args.selling_price)) * 100) : null } : {}),
      ...(target > 0 ? { target_fc: target, price_for_target_fc: whole ? priceForFc(total, target) : null } : {}),
      ...(notCosted.length ? { not_costed: notCosted, fc_needs: partial } : {}),
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
        ...(whole && n(args.selling_price) > 0 ? [`ขาย ${baht(n(args.selling_price))} → FC ${pctText((total / n(args.selling_price)) * 100)}`] : []),
        ...(whole && target > 0 ? [`ถ้าต้องการ FC ${r1(target)}% ควรขาย ${baht(priceForFc(total, target)!)} บาท`] : []),
        ...(!whole && (n(args.selling_price) > 0 || target > 0) ? [`ยังคิด FC ไม่ได้: ${partial || "ไม่มีรายการที่คิดต้นทุนได้"}`] : []),
      ],
    },
  };
}

// ─── 6. Which menus use an ingredient, and how much ───

export async function ingredientInMenus(store: Store, args: { query: string; menus?: string | null }): Promise<ToolResult> {
  const m = await store.masters();
  const hit = matchSku(m.skus.filter((s) => s.active), args.query, 1)[0];
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

// ─── 7. A recipe changed: take out, swap, change the amount ───

export interface RecipeChange {
  item: string;
  action: "remove" | "set_qty" | "replace" | "add";
  qty?: number | null;
  unit?: string | null;
  replace_with?: string | null;
}

/** An item's cost per unit: its standard price, or a sub-recipe (SP) worked out from its ingredients */
export function unitCostOf(m: Masters, skuId: string, depth = 0): number {
  if (m.ctx.skuType.get(skuId) === "SP" && depth < 4) {
    return (m.ctx.spBySku.get(skuId) ?? []).reduce((t, l) => t + (l.qtyPerBatch / (l.batchYieldQty || 1)) * unitCostOf(m, l.ingredientSkuId, depth + 1), 0);
  }
  return m.stdPrice.get(skuId) ?? 0;
}

/**
 * The menu's recipe as the menu page shows it: its own lines (shared + this branch's, shop
 * only), sub-recipes kept whole (ทาเระ, a sauce), the serving amount and the yield factor.
 */
export function recipeLines(m: Masters, menu: BotMenu, branchId: string) {
  return m.bom
    .filter((l) => l.menuId === menu.id && !l.deliveryOnly && (l.branchId === null || l.branchId === branchId))
    .map((l) => {
      const eff = l.effectiveQty ?? l.qtyPerServing;
      // effective ÷ serving: what a gram served takes from stock (1.25 at 80% yield)
      const factor = l.qtyPerServing > 0 && eff > 0 ? eff / l.qtyPerServing : 1;
      return { skuId: l.skuId, serving: l.qtyPerServing, factor, cost: eff * unitCostOf(m, l.skuId) };
    });
}

/**
 * One plate with a recipe changed (take out / set an amount / swap / add) on the menu's own
 * lines (a sauce is one line; amounts are serving amounts, the recipe's yield applies): the
 * plate before (option rules included) and after. Shared by recipe_whatif and scenario.
 */
export function changedPlate(m: Masters, menu: BotMenu, branchId: string, changes: RecipeChange[]): { was: number; now: number; done: string[]; notes: string[] } {
  const skus = m.skus.filter((s) => s.active);
  const skuOf = new Map(m.skus.map((s) => [s.id, s]));
  const branch = { id: branchId };
  const was = plateCost(m, menu, branch.id).total;
  const lines = recipeLines(m, menu, branch.id);
    let delta = 0;
    const done: string[] = [];
    const notes: string[] = [];
    for (const c of changes ?? []) {
      if (!c?.item) continue;
      if (c.action === "add") {
        const add = matchSku(skus, c.item, 1, 0.4)[0]?.item;
        const conv = add && c.qty ? inItemUnit(m, add, n(c.qty), c.unit, false) : null;
        if (!add || !conv || "error" in conv) {
          notes.push(`เพิ่ม "${c.item}" ไม่ได้ (หาไม่เจอหรือไม่มีปริมาณ)`);
          continue;
        }
        const cost = conv.qty * unitCostOf(m, add.id);
        delta += cost;
        done.push(`เพิ่ม ${add.name} ${r1(conv.qty)} ${unitText(add.uom)} (+${baht2(cost)})`);
        continue;
      }
      // The item among this menu's own lines (a sauce or ทาเระ is one line, not its ingredients)
      const pool = lines.map((l) => ({ code: skuOf.get(l.skuId)?.code ?? "", name: skuOf.get(l.skuId)?.name ?? "", line: l }));
      const hits = matchSku(pool, c.item, 3, 0.4);
      if (!hits.length) {
        notes.push(`สูตรของ ${menu.name} ไม่มี "${c.item}"`);
        continue;
      }
      if (hits.length > 1 && hits[1].score >= hits[0].score - 0.05) {
        notes.push(`"${c.item}" ใน ${menu.name} มีหลายตัว (${hits.map((h) => h.item.name).join(", ")}) ระบุให้ชัด`);
        continue;
      }
      const line = hits[0].item.line;
      const sku = skuOf.get(line.skuId)!;
      if (c.action === "remove") {
        delta -= line.cost;
        done.push(`เอา ${sku.name} ออก (−${baht2(line.cost)})`);
        line.cost = 0;
        line.serving = 0;
      } else if (c.action === "set_qty") {
        // The new amount is a serving amount: the recipe's yield applies to it as before
        const conv = c.qty != null ? inItemUnit(m, sku, n(c.qty), c.unit, false) : null;
        if (!conv || "error" in conv) {
          notes.push(`ปริมาณใหม่ของ ${sku.name} แปลงหน่วยไม่ได้`);
          continue;
        }
        const cost = conv.qty * line.factor * unitCostOf(m, sku.id);
        delta += cost - line.cost;
        done.push(`${sku.name} ${r1(line.serving)} → ${r1(conv.qty)} ${unitText(sku.uom)} (${signed(cost - line.cost)})`);
        line.cost = cost;
        line.serving = conv.qty;
      } else if (c.action === "replace") {
        const to = c.replace_with ? matchSku(skus, c.replace_with, 1, 0.4)[0]?.item : undefined;
        if (!to) {
          notes.push(`หา "${c.replace_with ?? ""}" ที่จะใส่แทนไม่เจอ`);
          continue;
        }
        // The amount given, else the same serving amount, in the new item's own unit (g → kg…)
        const conv = c.qty != null ? inItemUnit(m, to, n(c.qty), c.unit, false) : inItemUnit(m, to, line.serving, sku.uom, false);
        if ("error" in conv) {
          notes.push(`ใส่ ${to.name} แทน ${sku.name} ต้องบอกปริมาณ (หน่วยไม่เหมือนกัน)`);
          continue;
        }
        const cost = conv.qty * line.factor * unitCostOf(m, to.id);
        delta += cost - line.cost;
        done.push(`${sku.name} → ${to.name} ${r1(conv.qty)} ${unitText(to.uom)} (${signed(cost - line.cost)})`);
        line.cost = cost;
        line.serving = conv.qty;
      }
    }
  return { was, now: was + delta, done, notes };
}

export async function recipeWhatIf(store: Store, args: { menu: string; changes: RecipeChange[]; branch?: string | null }): Promise<ToolResult> {
  const m = await store.masters();
  const group = matchMenus(m.menus.filter((x) => x.active), args.menu ?? "");
  const menus = group.slice(0, 6);
  if (!menus.length) return { data: { found: false, query: args.menu, note: "ไม่พบเมนูชื่อนี้ในระบบ" } };
  const br = resolveBranches(m, args.branch);
  const open = m.branches.filter((b) => b.active !== false);
  // Plates sold this month, Line Man aliases (MN-001L) included
  const period = resolvePeriod(m.today);
  const sales = await store.sales(br.ids, period.from, period.to);
  const results = menus.map((menu) => {
    const branch = open.find((b) => br.ids.includes(b.id) && b.brand === menu.brand) ?? open.find((b) => b.brand === menu.brand) ?? open[0];
    // The plate as everything counts it (option rules included): the baseline
    const { was, now, done, notes } = changedPlate(m, menu, branch?.id ?? "", args.changes ?? []);
    const alias = `${menu.code}L`.toLowerCase();
    const sold = sales.filter((x) => x.menu_code === menu.code || (x.menu_code ?? "").toLowerCase() === alias).reduce((t, x) => t + n(x.qty), 0);
    return { menu, was, now, done, notes, sold };
  });
  return {
    data: {
      period_for_plates_sold: period,
      menus: results.map((r) => ({
        code: r.menu.code,
        name: r.menu.name,
        cost_before: r2(r.was),
        cost_after: r2(r.now),
        change_per_plate: r2(r.now - r.was),
        food_cost_before: pct(r.was, r.menu.price) === null ? null : r1(pct(r.was, r.menu.price)!),
        food_cost_after: pct(r.now, r.menu.price) === null ? null : r1(pct(r.now, r.menu.price)!),
        plates_sold_this_month: r0(r.sold),
        change_this_month: r0((r.now - r.was) * r.sold),
        changes_made: r.done,
        not_done: r.notes,
      })),
      more_menus_not_shown: Math.max(0, group.length - menus.length),
      note: "ต้นทุนตามสูตรหน้าร้าน ราคาวัตถุดิบวันนี้ · ปริมาณที่แก้เป็นปริมาณเสิร์ฟ (คิด yield ของสูตรเดิม) · ผลต่อเดือน = ส่วนต่างต่อจาน × จานที่ขายเดือนนี้ (รวม Line Man)",
    },
    card: {
      title: `ถ้าแก้สูตร · ${args.menu}`,
      subtitle: `ต้นทุนตามสูตรหน้าร้าน · ราคาวัตถุดิบวันนี้ · จานที่ขาย ${periodText(period.from, period.to)}`,
      columns: ["เมนู", "ต้นทุน/จาน", "FC"],
      rows: results.map((r) => [r.menu.name, `${baht2(r.was)} → ${baht2(r.now)}`, `${pctText(pct(r.was, r.menu.price))} → ${pctText(pct(r.now, r.menu.price))}`]),
      notes: [
        ...[...new Set(results.flatMap((r) => r.done))].slice(0, 4),
        ...results.filter((r) => r.sold > 0).map((r) => `${r.menu.name}: ขาย ${baht(r.sold)} จาน → ${signed((r.now - r.was) * r.sold)} บาท/เดือนนี้`).slice(0, 3),
        ...[...new Set(results.flatMap((r) => r.notes))].slice(0, 3),
        ...(group.length > menus.length ? [`แสดง ${menus.length} จาก ${group.length} เมนู`] : []),
      ],
    },
  };
}

// ─── 8. Which ingredients moved in price, and what it costs ───

export async function priceMovers(store: Store, args: { days?: number | null; top?: number | null; branch?: string | null; this_month?: boolean | null }): Promise<ToolResult> {
  const m = await store.masters();
  // Up to 60 days: longer reads too many sales for the function's time
  const monthDays = Math.round((Date.parse(m.today) - Date.parse(`${m.today.slice(0, 8)}01`)) / 86_400_000) + 1;
  const days = Math.max(7, Math.min(args.this_month ? monthDays : n(args.days) || 30, 60));
  const since = shiftDay(m.today, -days);
  const br = resolveBranches(m, args.branch);
  // What each item is used per the recipes over those days (the shops; the kitchen buys for them)
  const { std } = await workPeriod(store, m, br.ids, since, m.today, false);
  const used = new Map(std.skus.map((x) => [x.skuId, x.stdQty]));
  const rows = [];
  for (const sku of m.skus.filter((s) => s.active)) {
    // Both from the price history, so a gap between the two price tables isn't read as a change
    const now = m.priceAt(sku.id, m.today) ?? m.stdPrice.get(sku.id);
    const then = m.priceAt(sku.id, shiftDay(since, -1));
    if (!now || !then || Math.abs(now - then) < 1e-9) continue;
    const q = used.get(sku.id) ?? 0;
    rows.push({ sku, then, now, pct: ((now - then) / then) * 100, impact: q * (now - then), used: q });
  }
  rows.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact) || Math.abs(b.pct) - Math.abs(a.pct));
  const top = rows.slice(0, Math.max(3, Math.min(n(args.top) || 10, 20)));
  const per = (sku: BotSku, v: number) => (unitText(sku.uom) === "ก." ? `${baht2(v * 1000)}/กก.` : unitText(sku.uom) === "มล." ? `${baht2(v * 1000)}/ลิตร` : `${baht2(v)}/${unitText(sku.uom)}`);
  return {
    data: {
      since,
      branches: br.label,
      items: top.map((r) => ({ item: `${r.sku.name} (${r.sku.code})`, price_then: per(r.sku, r.then), price_now: per(r.sku, r.now), change_pct: r1(r.pct), used_in_period: r1(r.used), unit: unitText(r.sku.uom), cost_effect_in_period: r0(r.impact) })),
      total_cost_effect: r0(rows.reduce((t, r) => t + r.impact, 0)),
      note: "ผลต่อต้นทุน = ปริมาณที่ใช้ตามสูตรในช่วงนี้ × ราคาที่เปลี่ยน (ถ้าใช้ราคาใหม่ทั้งช่วง)",
    },
    card: top.length
      ? {
          title: `วัตถุดิบที่ราคาเปลี่ยน · ${days} วัน`,
          subtitle: `ตั้งแต่ ${thDay(since)} · ผลต่อต้นทุนตามปริมาณที่ใช้จริงในช่วงนี้ · ${br.label}`,
          columns: ["วัตถุดิบ", "ราคา", "ผล/ช่วงนี้"],
          rows: top.map((r) => [`${r.sku.name} (${r.pct > 0 ? "+" : ""}${r1(r.pct)}%)`, `${per(r.sku, r.then)} → ${per(r.sku, r.now)}`, signed(r.impact)]),
          total: ["รวมทุกตัวที่เปลี่ยน", "", signed(rows.reduce((t, r) => t + r.impact, 0))],
        }
      : undefined,
  };
}

// ─── 9. Menu engineering: which dishes earn, which sell ───

export type MenuClass = "star" | "plowhorse" | "puzzle" | "dog";
const CLASS_TEXT: Record<MenuClass, { th: string; act: string }> = {
  star: { th: "ดาวเด่น", act: "ขายดีและกำไรต่อจานสูง: รักษาไว้" },
  plowhorse: { th: "ขายดี กำไรต่ำ", act: "พิจารณาปรับราคาหรือลดต้นทุน" },
  puzzle: { th: "กำไรดี ขายน้อย", act: "ดันการขาย / จัดวางเมนูให้เห็นง่าย" },
  dog: { th: "ขายน้อย กำไรต่ำ", act: "ทบทวนว่าควรเก็บไว้ไหม" },
};
/**
 * Menu engineering (Kasavana & Smith): popularity = share of plates ≥ 70% of an even share;
 * profit = baht left per plate after ingredients ≥ the plate-weighted average. Menus with no
 * recipe cost or almost no sales are left out.
 */
export function classifyMenus(rows: { code: string; name: string; qty: number; revenue: number; stdCost: number }[]) {
  const pool = rows.filter((x) => x.qty >= 5 && x.stdCost > 0 && x.revenue > 0);
  const plates = pool.reduce((t, x) => t + x.qty, 0);
  const cmAll = pool.reduce((t, x) => t + (x.revenue - x.stdCost), 0);
  const avgCm = plates > 0 ? cmAll / plates : 0;
  const popBar = pool.length ? 0.7 / pool.length : 0;
  return pool
    .map((x) => {
      const cm = (x.revenue - x.stdCost) / x.qty;
      const popular = plates > 0 && x.qty / plates >= popBar;
      const earns = cm >= avgCm;
      const cls: MenuClass = popular && earns ? "star" : popular ? "plowhorse" : earns ? "puzzle" : "dog";
      return { ...x, cm, share: plates > 0 ? x.qty / plates : 0, cls };
    })
    .sort((a, b) => b.qty - a.qty);
}

export async function menuEngineering(store: Store, args: { period?: NamedPeriod | null; from?: string | null; to?: string | null; branch?: string | null; menus?: string | null }): Promise<ToolResult> {
  const m = await store.masters();
  const p = periodOf(m.today, args);
  const br = resolveBranches(m, args.branch);
  const w = await workPeriod(store, m, br.ids, p.from, p.to, false);
  // One dish = its shop code and its Line Man alias (MN-001 + MN-001L)
  const known = new Set(m.menus.map((x) => x.code));
  const merged = new Map<string, { code: string; name: string; qty: number; revenue: number; stdCost: number }>();
  for (const x of w.std.menus) {
    const base = /L$/i.test(x.code) && known.has(x.code.slice(0, -1)) ? x.code.slice(0, -1) : x.code;
    const e = merged.get(base) ?? { code: base, name: m.menus.find((y) => y.code === base)?.name ?? x.name, qty: 0, revenue: 0, stdCost: 0 };
    e.qty += x.qty;
    e.revenue += x.revenue;
    e.stdCost += x.stdCost;
    merged.set(base, e);
  }
  let rows = [...merged.values()];
  if (args.menus) {
    const codes = menuCodesFor(m, args.menus);
    if (!codes.size) return { data: { found: false, menus: args.menus, note: "ไม่พบเมนูกลุ่มนี้ในระบบ" } };
    rows = rows.filter((x) => codes.has(x.code));
  }
  const out = classifyMenus(rows);
  const notes = dataNotes(m, p, w, br.unknown);
  const byClass = (c: MenuClass) => out.filter((x) => x.cls === c);
  return {
    data: {
      period: p,
      branches: br.label,
      method: "ขายดี = สัดส่วนจาน ≥ 70% ของค่าเฉลี่ย · กำไรดี = เงินเหลือต่อจานหลังหักวัตถุดิบ ≥ ค่าเฉลี่ย (ไม่นับเมนูที่ไม่มีสูตรหรือขายไม่ถึง 5 จาน)",
      menus: out.map((x) => ({ code: x.code, name: x.name, plates: r0(x.qty), left_per_plate: r2(x.cm), food_cost_pct: r1((x.stdCost / x.revenue) * 100), group: CLASS_TEXT[x.cls].th, suggestion: CLASS_TEXT[x.cls].act })),
      data_notes: notes,
    },
    card: out.length
      ? {
          title: `เมนูไหนทำเงิน · ${br.label}${args.menus ? ` · ${args.menus}` : ""}`,
          subtitle: `${periodText(p.from, p.to)} · เงินเหลือต่อจาน = ราคาขายจริง − ต้นทุนตามสูตร`,
          columns: ["เมนู", "กลุ่ม", "เหลือ/จาน"],
          rows: (["star", "plowhorse", "puzzle", "dog"] as MenuClass[]).flatMap((c) => byClass(c).slice(0, 5).map((x) => [`${x.name} (${baht(x.qty)} จาน)`, CLASS_TEXT[c].th, baht2(x.cm)])),
          notes: [...(["star", "plowhorse", "puzzle", "dog"] as MenuClass[]).filter((c) => byClass(c).length).map((c) => `${CLASS_TEXT[c].th}: ${CLASS_TEXT[c].act}`), ...notes],
        }
      : undefined,
  };
}

// ─── 10. How much of an item the recipes used ───

export async function ingredientUsage(store: Store, args: { query: string; period?: NamedPeriod | null; from?: string | null; to?: string | null; branch?: string | null }): Promise<ToolResult> {
  const m = await store.masters();
  const hit = matchSku(m.skus.filter((s) => s.active), args.query, 1)[0];
  if (!hit) return { data: { found: false, query: args.query, note: "ไม่พบวัตถุดิบชื่อนี้ในระบบ" } };
  const p = periodOf(m.today, args);
  const br = resolveBranches(m, args.branch);
  const w = await workPeriod(store, m, br.ids, p.from, p.to, false);
  const u = unitText(hit.item.uom);
  let qty = 0;
  let cost = 0;
  const extra: string[] = [];
  if (m.ctx.skuType.get(hit.item.id) === "SP") {
    // A sub-recipe (ทาเระ, sauce) is broken into its ingredients by the engine: counted here
    // from the menus' own lines × plates sold (option rules not included)
    const sales = await store.sales(br.ids, p.from, p.to);
    const menuId = new Map(m.menus.map((x) => [x.code, x.id]));
    for (const x of sales) {
      const id = menuId.get(x.menu_code);
      if (!id) continue;
      for (const l of m.bom) if (l.menuId === id && l.skuId === hit.item.id && !l.deliveryOnly && (l.branchId === null || l.branchId === x.branch_id)) qty += (l.effectiveQty ?? l.qtyPerServing) * n(x.qty);
    }
    cost = qty * unitCostOf(m, hit.item.id);
    extra.push("สูตรย่อย: นับจากสูตรเมนู × จานที่ขาย (ไม่รวมกฎพิเศษ)");
  } else {
    const row = w.std.skus.find((x) => x.skuId === hit.item.id);
    qty = row?.stdQty ?? 0;
    cost = row?.stdCost ?? 0;
  }
  const days = Math.max(1, Math.round((Date.parse(w.lastSaleDay ?? p.to) - Date.parse(p.from)) / 86_400_000) + 1);
  // Kilos / litres from 1,000 up; grams below (20 g a day isn't "0 กก.")
  const big = (v: number) => (u === "ก." && v >= 1000 ? `${r1(v / 1000)} กก.` : u === "มล." && v >= 1000 ? `${r1(v / 1000)} ลิตร` : `${r1(v)} ${u}`);
  return {
    data: {
      item: `${hit.item.name} (${hit.item.code})`,
      period: p,
      branches: br.label,
      used_by_recipe: big(qty),
      per_day: big(qty / days),
      days_counted: days,
      cost: r0(cost),
      data_notes: [...dataNotes(m, p, w, br.unknown), ...extra],
      note: "ปริมาณตามสูตร × ยอดขาย (ไม่ใช่ที่ใช้จริงจากการนับสต๊อก)",
    },
  };
}

// ─── The menu Gemini picks from ───

// ─── Arithmetic on numbers the tools gave (the model never does sums in its head) ───

/**
 * + − × ÷ and brackets. A small parser, never eval: anything else in the text (names, units,
 * %) is refused rather than guessed.
 */
export function calc(expression: string): number {
  const raw = String(expression ?? "");
  // % reads differently to people ("289 + 10%" = 317.9) and to a parser (289.1): refused, the
  // model writes 1.1 or 0.1 instead. A comma only as thousands (1,200); "(1,2)" is refused.
  if (raw.includes("%")) throw new Error("ใช้ % ไม่ได้ เขียนเป็นทศนิยม เช่น ขึ้น 10% = * 1.1");
  const src = raw
    .replace(/(\d),(?=\d{3}(?!\d))/g, "$1")
    .replace(/[×xX]/g, "*")
    .replace(/÷/g, "/")
    .replace(/[−–]/g, "-")
    .replace(/\s/g, " ");
  let i = 0;
  const peek = () => src[i];
  const skip = () => {
    while (src[i] === " ") i++;
  };
  const num = (): number => {
    skip();
    if (peek() === "(") {
      i++;
      const v = sum();
      skip();
      if (peek() !== ")") throw new Error("วงเล็บไม่ครบ");
      i++;
      return v;
    }
    if (peek() === "-") return (i++, -num());
    if (peek() === "+") return (i++, num());
    const m = /^(?:\d+(?:\.\d+)?|\.\d+)/.exec(src.slice(i));
    if (!m) throw new Error(`อ่านไม่ออกตรง "${src.slice(i, i + 12)}"`);
    i += m[0].length;
    return Number(m[0]);
  };
  const product = (): number => {
    let v = num();
    for (;;) {
      skip();
      const op = peek();
      if (op !== "*" && op !== "/") return v;
      i++;
      const r = num();
      if (op === "/" && r === 0) throw new Error("หารด้วยศูนย์");
      v = op === "*" ? v * r : v / r;
    }
  };
  const sum = (): number => {
    let v = product();
    for (;;) {
      skip();
      const op = peek();
      if (op !== "+" && op !== "-") return v;
      i++;
      v = op === "+" ? v + product() : v - product();
    }
  };
  const v = sum();
  skip();
  if (i < src.length) throw new Error(`อ่านไม่ออกตรง "${src.slice(i, i + 12)}"`);
  if (!Number.isFinite(v)) throw new Error("ผลไม่ใช่ตัวเลข");
  return v;
}

export async function calculate(_s: Store, a: { expression: string; about?: string | null }): Promise<ToolResult> {
  try {
    const v = calc(a?.expression);
    // Full precision for a next step (0.085 a gram stays 0.085); 2 decimals only to show
    const result = Math.round(v * 1e6) / 1e6;
    const shown = Math.abs(v) >= 1 ? r2(v) : Number(v.toPrecision(3));
    return {
      data: { about: a?.about ?? null, expression: a?.expression, result, shown },
      card: { title: a?.about ? `คิดเลข · ${a.about}` : "คิดเลข", columns: ["", ""], rows: [[String(a?.expression ?? ""), shown.toLocaleString("en-US", { maximumFractionDigits: 4 })]] },
    };
  } catch (e) {
    return { data: { error: `คิดไม่ได้: ${(e as Error).message} (ใช้ได้แค่ตัวเลข + - * / วงเล็บ และ %)`, expression: a?.expression } };
  }
}

export const TOOLS = {
  ingredient_price: ingredientPrice,
  menu_cost: menuCost,
  food_cost: foodCost,
  scenario,
  compare_items: compareItems,
  ingredient_in_menus: ingredientInMenus,
  recipe_whatif: recipeWhatIf,
  price_movers: priceMovers,
  menu_engineering: menuEngineering,
  ingredient_usage: ingredientUsage,
  calculate,
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
