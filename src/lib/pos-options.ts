import type { Menu } from "@/types/menu";
import type { ModifierRule } from "@/types/modifier-rule";
import type { MenuBomLine } from "@/types/menu-bom";
import { ruleMatchesSale } from "@/lib/modifier-rules";

/**
 * POS options ("เลือกเส้น : เส้นโฮมเมด x 1") pulled out of bill names, and which
 * modifier rules handle each one. FoodStory writes every option into menu_name as
 * "<group> : <choice> x <n>" (sometimes "<group> : <label> : <choice> x <n>").
 * Pure functions so the catalog and the rule tester are tested.
 */

export interface Bill {
  menu_code: string;
  menu_name: string;
  qty: number;
  branch_id: string;
}

export interface ParsedOption {
  group: string;
  /** What the customer picked, as the POS writes it */
  value: string;
  /** The whole option as written, from the group on ("กระเทียมสด : กระเทียม : เติม") */
  raw?: string;
}

/** Splits a bill name into its options; plain names give [] */
export function parseOptions(menuName: string): ParsedOption[] {
  const out: ParsedOption[] = [];
  const segments = (menuName || "").split(/\s+x\s*\d+\b/);
  // Last piece after the final "x n" is never an option
  for (const seg of segments.slice(0, -1)) {
    const parts = seg.split(/\s*:\s*/);
    if (parts.length < 2) continue;
    const value = parts[parts.length - 1].trim();
    const before = parts[0].trim();
    // The first segment starts with the menu's own name; the group is its last word
    const words = before.split(/\s+/);
    const group = (words[words.length - 1] || "").replace(/^[(]+|[)]+$/g, "").trim();
    const lastWord = words[words.length - 1] || "";
    const raw = seg.slice(seg.lastIndexOf(lastWord, seg.indexOf(":"))).trim();
    if (value) out.push({ group, value, raw });
  }
  return out;
}

export const optionKey = (o: ParsedOption) => `${o.group.toLowerCase()}|${o.value.toLowerCase()}`;

/** "group|*" in the no-stock list marks a whole group (e.g. every saltiness choice) */
export const groupKey = (group: string) => `${group.toLowerCase()}|*`;

export type OptionStatus = "covered" | "partial" | "none" | "ignored";

export interface OptionEntry {
  key: string;
  group: string;
  value: string;
  /** Plates sold with this option (bill qty summed) */
  plates: number;
  /** Plates where at least one rule whose keyword sits in this option fired */
  coveredPlates: number;
  menuCodes: Map<string, number>;
  branchIds: Set<string>;
  /** Active rules whose keyword is inside this option's text */
  rules: ModifierRule[];
  status: OptionStatus;
  example: string;
}

export interface RuleScopeInput {
  menus: Menu[];
}

function menuIdByCode(menus: Menu[]) {
  return new Map(menus.map((m) => [m.menuCode, m.id]));
}

/** Same scope test the stock maths uses: active, branch list, menu list, then text match */
export function ruleFiresOn(rule: Pick<ModifierRule, "isActive" | "keyword" | "ruleType" | "branchIds" | "menuIds">, bill: Bill, menuId: string | undefined): boolean {
  if (!rule.isActive) return false;
  if (!menuId) return false; // bills for codes missing from the menu list are skipped everywhere
  if (rule.branchIds.length > 0 && !rule.branchIds.includes(bill.branch_id)) return false;
  if (rule.menuIds.length > 0 && !rule.menuIds.includes(menuId)) return false;
  return ruleMatchesSale({ keyword: rule.keyword, ruleType: rule.ruleType }, bill);
}

const keywordIn = (keyword: string, text: string) => !!keyword.trim() && text.toLowerCase().includes(keyword.trim().toLowerCase());

export function buildCatalog(bills: Bill[], menus: Menu[], rules: ModifierRule[], ignored: Set<string>): OptionEntry[] {
  const idByCode = menuIdByCode(menus);
  const active = rules.filter((r) => r.isActive && r.keyword.trim());
  const byKey = new Map<string, OptionEntry>();

  for (const bill of bills) {
    const opts = parseOptions(bill.menu_name);
    if (opts.length === 0) continue;
    const menuId = idByCode.get(bill.menu_code);
    const seenInBill = new Set<string>();
    for (const o of opts) {
      const key = optionKey(o);
      if (seenInBill.has(key)) continue; // POS sometimes repeats the option block
      seenInBill.add(key);
      let e = byKey.get(key);
      if (!e) {
        const own = active.filter((r) => keywordIn(r.keyword, o.raw ?? o.value));
        e = { key, group: o.group, value: o.value, plates: 0, coveredPlates: 0, menuCodes: new Map(), branchIds: new Set(), rules: own, status: "none", example: bill.menu_name };
        byKey.set(key, e);
      }
      const q = Number(bill.qty) || 0;
      e.plates += q;
      e.menuCodes.set(bill.menu_code, (e.menuCodes.get(bill.menu_code) ?? 0) + q);
      e.branchIds.add(bill.branch_id);
      if (e.rules.some((r) => ruleFiresOn(r, bill, menuId))) e.coveredPlates += q;
    }
  }

  for (const e of byKey.values()) {
    e.status = ignored.has(e.key) || ignored.has(groupKey(e.group)) ? "ignored" : e.coveredPlates <= 0 ? "none" : e.coveredPlates < e.plates ? "partial" : "covered";
  }
  return [...byKey.values()].sort((a, b) => b.plates - a.plates);
}

export interface RuleDraft {
  ruleType: ModifierRule["ruleType"];
  keyword: string;
  skuId: string | null;
  swapSkuId: string | null;
  submenuId: string | null;
  qtyPerMatch: number;
  menuIds: string[];
  branchIds: string[];
}

export interface DraftTest {
  /** Plates the draft would fire on in the loaded bills */
  plates: number;
  bills: number;
  /** Total usage it would add, in the SKU's usage unit (add/swap) */
  totalQty: number;
  /** Distinct options whose text contains the keyword, with plates — more than one means the keyword is too broad */
  options: { value: string; group: string; plates: number }[];
  /** Plates where the keyword matched the menu's own name rather than an option */
  inMenuName: number;
  /** Swap only: plates where the item to take out isn't in that menu's recipe (would add without removing) */
  swapMissing: number;
  /** Plates with the keyword that the draft's menu/branch picks leave out */
  leftOut: number;
}

/** Runs a rule that isn't saved yet over real bills, so people see what it will do before saving */
export function testDraft(draft: RuleDraft, bills: Bill[], menus: Menu[], lines: MenuBomLine[]): DraftTest {
  const idByCode = menuIdByCode(menus);
  const rule = { ...draft, isActive: true };
  const res: DraftTest = { plates: 0, bills: 0, totalQty: 0, options: [], inMenuName: 0, swapMissing: 0, leftOut: 0 };
  if (!draft.keyword.trim()) return res;
  const optionPlates = new Map<string, { value: string; group: string; plates: number }>();

  for (const bill of bills) {
    const menuId = idByCode.get(bill.menu_code);
    const q = Number(bill.qty) || 0;
    const textHit = ruleMatchesSale({ keyword: draft.keyword, ruleType: draft.ruleType }, bill);
    if (!textHit) continue;
    if (!ruleFiresOn(rule, bill, menuId)) {
      if (menuId) res.leftOut += q;
      continue;
    }
    res.plates += q;
    res.bills += 1;
    if (draft.ruleType !== "submenu") res.totalQty += q * (draft.qtyPerMatch || 0);

    const opts = parseOptions(bill.menu_name).filter((o) => keywordIn(draft.keyword, o.raw ?? o.value));
    if (opts.length === 0) res.inMenuName += q;
    for (const o of opts) {
      const k = optionKey(o);
      const cur = optionPlates.get(k) ?? { value: o.value, group: o.group, plates: 0 };
      cur.plates += q;
      optionPlates.set(k, cur);
    }
    if (draft.ruleType === "swap" && draft.swapSkuId && menuId) {
      const has = lines.some((l) => l.menuId === menuId && l.skuId === draft.swapSkuId && (!l.branchId || l.branchId === bill.branch_id));
      if (!has) res.swapMissing += q;
    }
  }
  res.options = [...optionPlates.values()].sort((a, b) => b.plates - a.plates);
  return res;
}

/**
 * Longer keywords for an option, taken from how the POS writes it, e.g. "เติม" →
 * "กระเทียม : เติม" so "ไม่เติม" no longer matches. Most specific last.
 */
export function specificKeywords(option: ParsedOption, example: string): string[] {
  const out: string[] = [];
  const at = example.indexOf(` : ${option.value} x`);
  if (at > 0) {
    const before = example.slice(0, at).split(/\s*:\s*/);
    const label = (before[before.length - 1] || "").trim().split(/\s+/).pop() || "";
    if (label) out.push(`${label} : ${option.value}`);
  }
  if (option.group) out.push(`${option.group} : ${option.value}`);
  return [...new Set(out)].filter((k) => k !== option.value);
}
