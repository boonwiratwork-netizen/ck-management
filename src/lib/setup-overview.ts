import type { Menu } from "@/types/menu";
import type { MenuBomLine } from "@/types/menu-bom";
import type { SKU } from "@/types/sku";
import type { Price } from "@/types/price";
import type { CheckLevel, MenuSetupSummary } from "@/lib/menu-health";
import { activeUnitCost } from "@/lib/menu-health";

/**
 * Whole-setup picture for the overview screen: menu problems grouped by kind
 * (so "15 menus have an unpriced ingredient" is one line, not 15), and the
 * unpriced ingredients themselves, ranked by how many menus they affect.
 */

export interface IssueGroup {
  kind: string;
  level: CheckLevel;
  title: string;
  /** What fixing it does, one line */
  why: string;
  menus: { menu: Menu; detail: string }[];
}

const KINDS: { kind: string; title: string; why: string }[] = [
  { kind: "dup-code", title: "รหัสเมนูซ้ำ", why: "สต๊อกอาจลดผิดเมนู" },
  { kind: "no-recipe", title: "ขายแล้วแต่ยังไม่มีสูตร", why: "ขายแล้วสต๊อกวัตถุดิบไม่ลด" },
  { kind: "unreached", title: "บางสาขาขายแล้วสต๊อกไม่ลด", why: "กฎท็อปปิ้ง/ชุดที่ใช้สูตรนี้ ยังไม่ได้เลือกสาขานั้น" },
  { kind: "swap", title: "ตัวเลือกเปลี่ยนวัตถุดิบ หาของเดิมในสูตรไม่เจอ", why: "เพิ่มของใหม่โดยไม่หักของเดิม สต๊อกลดเกิน" },
  { kind: "sub", title: "ท็อปปิ้งชี้ไปเมนูที่ไม่มีสูตรหรือถูกลบ", why: "สั่งท็อปปิ้งแล้วสต๊อกไม่ลด" },
  { kind: "nosku", title: "ตัวเลือกที่ยังไม่ได้เลือกวัตถุดิบ", why: "กดแล้วสต๊อกไม่ลดเลย" },
  { kind: "bad-qty", title: "ปริมาณในสูตรผิด", why: "สต๊อกลดผิดจำนวน" },
  { kind: "unpriced", title: "ใช้วัตถุดิบที่ยังไม่มีราคา", why: "ต้นทุนเมนูต่ำกว่าจริง" },
  { kind: "double", title: "วัตถุดิบซ้ำในสูตร", why: "แถวซ้ำถูกนับสองครั้ง" },
  { kind: "inactive-sku", title: "ใช้วัตถุดิบที่ปิดใช้งานแล้ว", why: "ควรเปลี่ยนเป็นตัวที่ใช้อยู่จริง" },
  { kind: "closed-sold", title: "ปิดขายไว้แต่ยังมียอดขาย", why: "สต๊อกยังลดตามยอดขายจริง" },
  { kind: "inactive-sold", title: "ปิดเมนูไว้แต่ยังมียอดขาย", why: "บางรายงานจะไม่นับวัตถุดิบ" },
  { kind: "foreign-branch", title: "มีแถวสูตรของสาขาที่ไม่ได้ขายแบรนด์นี้", why: "ไม่ถูกใช้ ลบทิ้งได้" },
  { kind: "no-branch", title: "แบรนด์ของเมนูไม่ตรงกับสาขาไหนเลย", why: "เช็คชื่อแบรนด์ให้สะกดตรงกัน" },
  { kind: "price", title: "ยังไม่มีราคาขาย", why: "คิด % ต้นทุนไม่ได้" },
];

/** "swap-<rule id>" → "swap"; ids without a known kind keep their own id */
export function checkKind(id: string): string {
  let best = "";
  for (const { kind } of KINDS) if ((id === kind || id.startsWith(`${kind}-`)) && kind.length > best.length) best = kind;
  return best || id;
}

export function groupIssues(menus: Menu[], summaries: Map<string, MenuSetupSummary>): IssueGroup[] {
  const groups = new Map<string, IssueGroup>();
  for (const menu of menus) {
    if (menu.status !== "Active") continue;
    const s = summaries.get(menu.id);
    if (!s) continue;
    for (const c of s.checks) {
      if (c.level === "ok") continue;
      const kind = checkKind(c.id);
      const meta = KINDS.find((k) => k.kind === kind);
      let g = groups.get(kind);
      if (!g) {
        g = { kind, level: c.level, title: meta?.title ?? c.title, why: meta?.why ?? "", menus: [] };
        groups.set(kind, g);
      }
      if (c.level === "error") g.level = "error";
      if (!g.menus.some((m) => m.menu.id === menu.id)) g.menus.push({ menu, detail: c.title });
    }
  }
  const order = (k: string) => {
    const i = KINDS.findIndex((x) => x.kind === k);
    return i < 0 ? KINDS.length : i;
  };
  return [...groups.values()].sort((a, b) => (a.level === b.level ? order(a.kind) - order(b.kind) : a.level === "error" ? -1 : 1));
}

export interface UnpricedSku {
  sku: SKU | undefined;
  skuId: string;
  menus: Menu[];
}

/** Ingredients with no active price that active menus use, most-used first */
export function unpricedSkus(menus: Menu[], lines: MenuBomLine[], skus: SKU[], prices: Price[]): UnpricedSku[] {
  const activeMenus = new Map(menus.filter((m) => m.status === "Active").map((m) => [m.id, m]));
  const bySku = new Map<string, Set<string>>();
  for (const l of lines) {
    if (!activeMenus.has(l.menuId)) continue;
    if (activeUnitCost(prices, l.skuId) > 0) continue;
    (bySku.get(l.skuId) ?? bySku.set(l.skuId, new Set()).get(l.skuId)!).add(l.menuId);
  }
  return [...bySku.entries()]
    .map(([skuId, ids]) => ({ skuId, sku: skus.find((s) => s.id === skuId), menus: [...ids].map((id) => activeMenus.get(id)!) }))
    .sort((a, b) => b.menus.length - a.menus.length);
}
