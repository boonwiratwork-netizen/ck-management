import type { Menu } from "@/types/menu";
import type { MenuBomLine } from "@/types/menu-bom";
import type { ModifierRule } from "@/types/modifier-rule";
import type { SKU } from "@/types/sku";
import type { Price } from "@/types/price";
import type { Branch } from "@/types/branch";
import type { MenuBillCheck } from "@/lib/bill-check";

/**
 * Everything the Menu Setup screen says about one menu, worked out in one place:
 * cost per branch, which rules touch it, and a checklist of setup mistakes that
 * would make stock or food cost wrong. Pure (no data fetching) so it is tested.
 */

export type CheckLevel = "ok" | "warn" | "error";
export type CheckArea = "info" | "recipe" | "branches" | "rules";

export interface HealthCheck {
  id: string;
  level: CheckLevel;
  area: CheckArea;
  /** One line in plain Thai */
  title: string;
  /** What is wrong and what to do, when not ok */
  detail?: string;
}

export interface BranchCost {
  branchId: string;
  branchName: string;
  cost: number;
  /** Cost ÷ selling price × 100; null when there is no price */
  costPct: number | null;
  /** Ingredient lines that count at this branch (shared + this branch only) */
  lines: MenuBomLine[];
  /** Open for sale at this branch (no override, or override on) */
  open: boolean;
  /** Sold in the period loaded (qty), 0 when none */
  sold: number;
  /** Part of `cost` that comes from another menu's recipe via an always-on topping/set rule */
  linkedCost: number;
}

export interface MenuSetupInput {
  menu: Menu;
  menus: Menu[];
  lines: MenuBomLine[];
  rules: ModifierRule[];
  skus: SKU[];
  prices: Price[];
  branches: Branch[];
  /** branch_menu_overrides rows for this menu: branchId → is_active */
  overrides: Record<string, boolean>;
  /** Qty sold per branch for this menu over the period loaded; undefined = not loaded yet */
  soldByBranch?: Record<string, number>;
  /** Real bills of this menu run through the stock maths; undefined = not loaded or no sales */
  bills?: MenuBillCheck;
}

export interface MenuSetupSummary {
  branches: BranchCost[];
  sharedLines: MenuBomLine[];
  /** Branch-only lines, by branch id */
  branchLines: Record<string, MenuBomLine[]>;
  /** Rules picked only for this menu */
  ownRules: ModifierRule[];
  /** Rules that use this menu as a topping / set item (submenu) */
  usedAsTopping: ModifierRule[];
  /** Active rules with no menu picked — they can fire on any menu whose bill name has the keyword */
  globalRuleCount: number;
  /** Submenu rules on this menu whose keyword is the menu's own name/code, so every sale pulls in that recipe */
  linkedRecipes: { rule: ModifierRule; menu: Menu }[];
  checks: HealthCheck[];
  worst: CheckLevel;
  bills?: MenuBillCheck;
}

export function activeUnitCost(prices: Price[], skuId: string): number {
  return prices.find((p) => p.skuId === skuId && p.isActive)?.pricePerUsageUom ?? 0;
}

export function effectiveQty(qty: number, yieldPct: number): number {
  return yieldPct > 0 ? qty / (yieldPct / 100) : qty;
}

export function lineCost(line: Pick<MenuBomLine, "skuId" | "qtyPerServing" | "yieldPct">, prices: Price[]): number {
  return effectiveQty(line.qtyPerServing, line.yieldPct) * activeUnitCost(prices, line.skuId);
}

/** Branches that sell this brand, active ones only */
export function brandBranches(branches: Branch[], brandName: string): Branch[] {
  return branches.filter((b) => b.status === "Active" && b.brandName === brandName);
}

function ruleTouchesMenu(rule: ModifierRule, menuId: string): boolean {
  return rule.menuIds.includes(menuId);
}

export function summarizeMenu(input: MenuSetupInput): MenuSetupSummary {
  const { menu, menus, rules, skus, prices, overrides, soldByBranch } = input;
  const skuById = new Map(skus.map((s) => [s.id, s]));
  const skuName = (id: string | null | undefined) => (id ? skuById.get(id)?.name ?? "วัตถุดิบที่ถูกลบไปแล้ว" : "—");

  const menuLines = input.lines.filter((l) => l.menuId === menu.id);
  const sharedLines = menuLines.filter((l) => !l.branchId);
  const branchLines: Record<string, MenuBomLine[]> = {};
  for (const l of menuLines) if (l.branchId) (branchLines[l.branchId] ??= []).push(l);

  const activeRules = rules.filter((r) => r.isActive);
  const ownRules = rules.filter((r) => ruleTouchesMenu(r, menu.id));
  // e.g. "Tonkotsu Ramen (Line Man)" has no recipe of its own: a rule with that exact
  // name as keyword adds MN-073's recipe to every sale
  const linkedRecipes = ownRules
    .filter((r) => r.isActive && r.ruleType === "submenu" && r.submenuId && r.submenuId !== menu.id && alwaysFires(r.keyword, menu))
    .map((rule) => ({ rule, menu: menus.find((m) => m.id === rule.submenuId) }))
    .filter((x): x is { rule: ModifierRule; menu: Menu } => !!x.menu);

  const sellingBranches = brandBranches(input.branches, menu.brandName);
  const branches: BranchCost[] = sellingBranches.map((b) => {
    const lines = [...sharedLines, ...(branchLines[b.id] ?? [])];
    const ownCost = lines.reduce((s, l) => s + lineCost(l, prices), 0);
    const linkedCost = linkedRecipes
      .filter(({ rule }) => rule.branchIds.length === 0 || rule.branchIds.includes(b.id))
      .reduce(
        (s, { menu: sub }) =>
          s + input.lines.filter((l) => l.menuId === sub.id && (!l.branchId || l.branchId === b.id)).reduce((t, l) => t + lineCost(l, prices), 0),
        0,
      );
    const cost = ownCost + linkedCost;
    return {
      branchId: b.id,
      branchName: b.branchName,
      cost,
      costPct: menu.sellingPrice > 0 ? (cost / menu.sellingPrice) * 100 : null,
      lines,
      open: overrides[b.id] ?? true,
      sold: soldByBranch?.[b.id] ?? 0,
      linkedCost,
    };
  });

  const usedAsTopping = rules.filter((r) => r.ruleType === "submenu" && r.submenuId === menu.id);
  const globalRuleCount = activeRules.filter((r) => r.menuIds.length === 0).length;

  const checks: HealthCheck[] = [];
  const add = (c: HealthCheck) => checks.push(c);

  // ── Info ──
  if (menu.sellingPrice > 0) add({ id: "price", level: "ok", area: "info", title: "มีราคาขาย" });
  else
    add({
      id: "price",
      level: usedAsTopping.length > 0 ? "ok" : "warn",
      area: "info",
      title: usedAsTopping.length > 0 ? "ไม่มีราคาขาย (เป็นท็อปปิ้ง/ของในชุด)" : "ยังไม่มีราคาขาย",
      detail: usedAsTopping.length > 0 ? undefined : "ไม่มีราคา = คิด % ต้นทุนไม่ได้ ใส่ราคาขายที่หน้าร้าน",
    });

  // Sales match codes exactly (case and all), so only an exact duplicate is a clash
  const sameCode = menus.filter((m) => m.id !== menu.id && m.menuCode.trim() === menu.menuCode.trim());
  if (sameCode.length > 0)
    add({
      id: "dup-code",
      level: "error",
      area: "info",
      title: `รหัส ${menu.menuCode} ซ้ำกับอีก ${sameCode.length} เมนู`,
      detail: "ยอดขายจับคู่เมนูด้วยรหัส รหัสซ้ำ = ระบบตัดของผิดเมนู เปลี่ยนรหัสให้ไม่ซ้ำ",
    });

  const totalSold = Object.values(soldByBranch ?? {}).reduce((s, q) => s + q, 0);
  if (menu.status === "Inactive" && totalSold > 0)
    add({
      id: "inactive-sold",
      level: "warn",
      area: "info",
      title: "ปิดเมนูไว้ แต่ยังมียอดขายเข้ามา",
      detail: `ขายไป ${totalSold.toLocaleString()} ที่ในช่วงที่ดู · ถ้ายังขายอยู่ให้เปิดกลับเป็น Active ไม่งั้นบางรายงานจะไม่นับวัตถุดิบ`,
    });

  // ── Recipe ──
  const billed = input.bills && input.bills.plates > 0 ? input.bills : null;
  if (billed) {
    // Real bills decide: whatever the recipe/rule setup, did every plate deduct something?
    const empty = billed.groups.find((g) => g.empty);
    add(
      billed.emptyPlates === 0
        ? { id: "no-recipe", level: "ok", area: "recipe", title: `บิลจริง ${billed.plates.toLocaleString()} จาน ตัดของทุกจาน` }
        : {
            id: "no-recipe",
            level: "error",
            area: "recipe",
            title: `${billed.emptyPlates.toLocaleString()} จาก ${billed.plates.toLocaleString()} จานขายแล้วไม่ตัดของ`,
            detail: `เช่นบิล "${empty?.name ?? ""}" · เพิ่มสูตร หรือกฎที่มีคำตรงกับในบิล (ดูแท็บบิลจริง)`,
          },
    );
  } else if (menuLines.length === 0 && linkedRecipes.length > 0) {
    add({
      id: "no-recipe",
      level: "ok",
      area: "recipe",
      title: `ใช้สูตรของ ${linkedRecipes.map((x) => x.menu.menuCode).join(", ")} ผ่านกฎ`,
    });
  } else if (menuLines.length === 0 && ownRules.some((r) => r.isActive && r.ruleType === "submenu")) {
    // Set menus often have no recipe of their own: the bill lists the set items and
    // topping/set rules add each item's recipe. Don't push people to add one (double deduct).
    const n = ownRules.filter((r) => r.isActive && r.ruleType === "submenu").length;
    add({
      id: "no-recipe",
      level: "warn",
      area: "recipe",
      title: `ไม่มีสูตรของตัวเอง — ตัดของผ่านกฎท็อปปิ้ง/ชุด ${n} ตัว`,
      detail: "ถ้าเป็นเมนูชุด แบบนี้ถูกแล้ว ไม่ต้องเพิ่มสูตร (จะตัดซ้ำ) · เช็คที่ตัวเลือก POS ว่าของในชุดมีกฎครบ",
    });
  } else if (menuLines.length === 0 && /set|ชุด|เซ็ต|เซต/i.test(`${menu.menuName} ${menu.category}`) && activeRules.some((r) => r.ruleType === "submenu" && r.menuIds.length === 0)) {
    add({
      id: "no-recipe",
      level: "warn",
      area: "recipe",
      title: "เมนูชุด ไม่มีสูตรของตัวเอง",
      detail: "ถ้าบิลของชุดนี้มีรหัส/ชื่อของในชุด กฎท็อปปิ้งจะตัดของให้เอง ไม่ต้องเพิ่มสูตร (จะตัดซ้ำ) · เช็คที่ตัวเลือก POS",
    });
  } else if (menuLines.length === 0) {
    const needed = usedAsTopping.length > 0 || totalSold > 0 || menu.status === "Active";
    add({
      id: "no-recipe",
      level: needed ? "error" : "warn",
      area: "recipe",
      title: "ยังไม่มีสูตร",
      detail:
        usedAsTopping.length > 0
          ? `มีกฎ ${usedAsTopping.length} ตัวใช้เมนูนี้เป็นท็อปปิ้ง/ของในชุด แต่ไม่มีสูตร = สั่งเพิ่มแล้วไม่ตัดของ`
          : "ขายเมนูนี้แล้วจะไม่ตัดวัตถุดิบเลย และไม่มีต้นทุน",
    });
  } else {
    add({ id: "no-recipe", level: "ok", area: "recipe", title: `มีสูตร ${menuLines.length} บรรทัด` });
  }

  const unpriced = [...new Set(menuLines.filter((l) => activeUnitCost(prices, l.skuId) <= 0).map((l) => l.skuId))];
  if (unpriced.length > 0)
    add({
      id: "unpriced",
      level: "warn",
      area: "recipe",
      title: `วัตถุดิบ ${unpriced.length} ตัวยังไม่มีราคา`,
      detail: `${unpriced.map(skuName).join(", ")} · ต้นทุนเมนูจะต่ำกว่าจริง ใส่ราคาที่หน้า Price`,
    });
  else if (menuLines.length > 0) add({ id: "unpriced", level: "ok", area: "recipe", title: "วัตถุดิบทุกตัวมีราคา" });

  const inactiveSkus = [...new Set(menuLines.filter((l) => skuById.get(l.skuId)?.status === "Inactive").map((l) => l.skuId))];
  if (inactiveSkus.length > 0)
    add({
      id: "inactive-sku",
      level: "warn",
      area: "recipe",
      title: `ใช้วัตถุดิบที่ปิดใช้งานแล้ว ${inactiveSkus.length} ตัว`,
      detail: `${inactiveSkus.map(skuName).join(", ")} · เปลี่ยนเป็นตัวที่ใช้อยู่จริง`,
    });

  const badYield = menuLines.filter((l) => !(l.yieldPct > 0 && l.yieldPct <= 100) || !(l.qtyPerServing > 0));
  if (badYield.length > 0)
    add({
      id: "bad-qty",
      level: "error",
      area: "recipe",
      title: `ปริมาณหรือ % yield ผิด ${badYield.length} บรรทัด`,
      detail: `${badYield.map((l) => skuName(l.skuId)).join(", ")} · ปริมาณต้องมากกว่า 0 และ yield 1–100%`,
    });

  // Same SKU listed twice at one branch (shared + branch, or twice in shared) counts double
  const doubles: string[] = [];
  for (const b of branches) {
    const seen = new Map<string, number>();
    for (const l of b.lines) seen.set(l.skuId, (seen.get(l.skuId) ?? 0) + 1);
    for (const [skuId, n] of seen) if (n > 1) doubles.push(`${skuName(skuId)} (${b.branchName})`);
  }
  if (sellingBranches.length === 0) {
    const seen = new Map<string, number>();
    for (const l of sharedLines) seen.set(l.skuId, (seen.get(l.skuId) ?? 0) + 1);
    for (const [skuId, n] of seen) if (n > 1) doubles.push(skuName(skuId));
  }
  if (doubles.length > 0)
    add({
      id: "double",
      level: "warn",
      area: "recipe",
      title: `วัตถุดิบซ้ำในสูตร ${doubles.length} รายการ`,
      detail: `${[...new Set(doubles)].join(", ")} · บรรทัดซ้ำถูกตัดบวกกัน ถ้าตั้งใจให้สาขาใช้ปริมาณต่าง ให้ลบบรรทัดกลางแล้วตั้งแยกรายสาขา`,
    });

  const otherBrandLines = menuLines.filter((l) => l.branchId && !sellingBranches.some((b) => b.id === l.branchId));
  if (otherBrandLines.length > 0)
    add({
      id: "foreign-branch",
      level: "warn",
      area: "recipe",
      title: `มีบรรทัดเฉพาะสาขาที่ไม่ได้ขายแบรนด์นี้ ${otherBrandLines.length} บรรทัด`,
      detail: "บรรทัดพวกนี้ไม่ถูกใช้เลย ลบทิ้งได้",
    });

  // ── Branches ──
  if (sellingBranches.length === 0)
    add({
      id: "no-branch",
      level: "warn",
      area: "branches",
      title: `ไม่มีสาขาที่เปิดอยู่ของแบรนด์ ${menu.brandName || "(ไม่ระบุแบรนด์)"}`,
      detail: "เช็คชื่อแบรนด์ของเมนูให้ตรงกับชื่อแบรนด์ของสาขา",
    });
  for (const b of branches) {
    if (!b.open && b.sold > 0)
      add({
        id: `closed-sold-${b.branchId}`,
        level: "warn",
        area: "branches",
        title: `${b.branchName}: ปิดขายไว้ แต่ยังมียอดขาย`,
        detail: `ขายไป ${b.sold.toLocaleString()} ที่ · ระบบยังตัดของตามยอดขายจริง ถ้ายังขายอยู่ให้เปิดกลับ`,
      });
  }
  if (menuLines.length > 0 || linkedRecipes.length > 0)
    for (const b of branches) {
      // Real bills at this branch already answer this (see the bill check above)
      if ((billed?.platesByBranch[b.branchId] ?? 0) > 0) continue;
      const reached = b.lines.length > 0 || linkedRecipes.some(({ rule }) => rule.branchIds.length === 0 || rule.branchIds.includes(b.branchId));
      if (b.open && !reached)
        add({
          id: `unreached-${b.branchId}`,
          // Only a real problem once that branch actually sells it
          level: b.sold > 0 ? "error" : "warn",
          area: "branches",
          title: `${b.branchName}: ขายแล้วไม่ตัดของ`,
          detail: `กฎที่ดึงสูตร ${linkedRecipes.map((x) => x.menu.menuCode).join(", ")} ไม่ได้เลือกสาขานี้ · เพิ่มสาขานี้ในกฎ หรือปิดขายที่สาขานี้`,
        });
    }
  if (sellingBranches.length > 0 && !checks.some((c) => c.area === "branches"))
    add({
      id: "branches",
      level: "ok",
      area: "branches",
      title: `เปิดขาย ${branches.filter((b) => b.open).length} จาก ${branches.length} สาขา`,
    });

  // ── Rules ──
  for (const r of ownRules) {
    if (!r.isActive) continue;
    if (r.ruleType === "swap" && r.swapSkuId) {
      const ruleBranches = r.branchIds.length > 0 ? branches.filter((b) => r.branchIds.includes(b.branchId)) : branches;
      const missing = ruleBranches.filter((b) => !b.lines.some((l) => l.skuId === r.swapSkuId));
      // A line that comes from a linked recipe isn't "missing": delivery bills (e.g. Line Man)
      // carry only the menu name, no options, so the swap never fires on them anyway
      const notFound = missing.filter(
        (b) => !linkedRecipes.some(({ menu: sub }) => input.lines.some((l) => l.menuId === sub.id && l.skuId === r.swapSkuId && (!l.branchId || l.branchId === b.branchId))),
      );
      if (notFound.length > 0 || (branches.length === 0 && !sharedLines.some((l) => l.skuId === r.swapSkuId)))
        add({
          id: `swap-${r.id}`,
          level: "error",
          area: "rules",
          title: `กฎเปลี่ยน "${r.keyword}" หา ${skuName(r.swapSkuId)} ในสูตรไม่เจอ`,
          detail: `${notFound.length ? notFound.map((b) => b.branchName).join(", ") + ": " : ""}ระบบจะใส่ ${skuName(r.skuId)} เพิ่มโดยไม่เอาของเดิมออก = ตัดเกิน ใส่ ${skuName(r.swapSkuId)} ในสูตร หรือแก้กฎ`,
        });
    }
    if (r.ruleType === "submenu" && r.submenuId) {
      const sub = menus.find((m) => m.id === r.submenuId);
      if (!sub)
        add({ id: `sub-${r.id}`, level: "error", area: "rules", title: `กฎ "${r.keyword}" ชี้ไปเมนูที่ถูกลบแล้ว`, detail: "เลือกเมนูท็อปปิ้งใหม่ หรือปิดกฎนี้" });
      else if (!input.lines.some((l) => l.menuId === sub.id))
        add({
          id: `sub-${r.id}`,
          level: "error",
          area: "rules",
          title: `กฎ "${r.keyword}" ใส่ ${sub.menuName} ที่ยังไม่มีสูตร`,
          detail: `สั่งเพิ่มแล้วไม่ตัดของ · ไปตั้งสูตรของ ${sub.menuCode}`,
        });
    }
    if ((r.ruleType === "add" || r.ruleType === "swap") && !r.skuId)
      add({ id: `nosku-${r.id}`, level: "error", area: "rules", title: `กฎ "${r.keyword}" ยังไม่ได้เลือกวัตถุดิบ`, detail: "กฎนี้จะไม่ตัดอะไรเลย" });
  }
  if (!checks.some((c) => c.area === "rules"))
    add({
      id: "rules",
      level: "ok",
      area: "rules",
      title: ownRules.length ? `กฎของเมนูนี้ ${ownRules.length} ตัว ตั้งครบ` : "ไม่มีกฎเฉพาะเมนูนี้",
    });

  const worst: CheckLevel = checks.some((c) => c.level === "error") ? "error" : checks.some((c) => c.level === "warn") ? "warn" : "ok";
  return { branches, sharedLines, branchLines, ownRules, usedAsTopping, globalRuleCount, linkedRecipes, checks, worst, bills: input.bills };
}

/** True when a rule keyword is the menu's own code or part of its own name, so it fires on every sale */
function alwaysFires(keyword: string, menu: Menu): boolean {
  const k = keyword.trim().toLowerCase();
  if (!k) return false;
  return k === menu.menuCode.trim().toLowerCase() || menu.menuName.toLowerCase().includes(k);
}

/** Plain-Thai sentence for what a rule does, for people who never saw the rule form */
export function describeRule(rule: ModifierRule, skus: SKU[], menus: Menu[]): string {
  const name = (id: string | null) => (id ? skus.find((s) => s.id === id)?.name ?? "วัตถุดิบที่ถูกลบไปแล้ว" : "—");
  const kw = `ถ้าบิลมีคำว่า "${rule.keyword}"`;
  if (rule.ruleType === "swap")
    return `${kw} → เอา ${name(rule.swapSkuId)} ออก ใส่ ${name(rule.skuId)} ${rule.qtyPerMatch} ${rule.uom || ""} แทน`.trim();
  if (rule.ruleType === "submenu") {
    const sub = menus.find((m) => m.id === rule.submenuId);
    const codeLike = /^[A-Z]{2,3}-\d+$/i.test(rule.keyword.trim());
    return `${codeLike ? `ถ้าบิลเป็นรหัส ${rule.keyword} หรือมีคำนี้` : kw} → ตัดของตามสูตร ${sub ? `${sub.menuCode} ${sub.menuName}` : "เมนูที่ถูกลบแล้ว"}`;
  }
  return `${kw} → ตัด ${name(rule.skuId)} เพิ่ม ${rule.qtyPerMatch} ${rule.uom || ""}`.trim();
}
