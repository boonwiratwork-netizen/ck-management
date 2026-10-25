import { describe, it, expect } from "vitest";
import { summarizeBranch } from "./branch-health";
import { summarizeMenu } from "./menu-health";
import type { Menu } from "@/types/menu";
import type { ModifierRule } from "@/types/modifier-rule";
import type { Branch } from "@/types/branch";
import type { MenuBomLine } from "@/types/menu-bom";

const menu = (id: string, code: string, brandName = "Sendo"): Menu =>
  ({ id, menuCode: code, menuName: code, category: "", sellingPrice: 100, status: "Active", brandName, isMaindish: true }) as Menu;
const branch = { id: "new", branchName: "New", brandName: "Sendo", status: "Active" } as Branch;
const old = { id: "old", branchName: "Old", brandName: "Sendo", status: "Active" } as Branch;
const rule = (r: Partial<ModifierRule>) => ({ id: "r", keyword: "k", skuId: "", qtyPerMatch: 1, uom: "", description: "", isActive: true, menuId: null, menuIds: [], ruleType: "add", swapSkuId: null, submenuId: null, branchIds: [], ...r }) as ModifierRule;

function run(opts: { menus: Menu[]; lines?: MenuBomLine[]; rules?: ModifierRule[]; sold?: Record<string, Record<string, number>>; br?: Branch }) {
  const br = opts.br ?? branch;
  const summaries = new Map(
    opts.menus.map((m) => [m.id, summarizeMenu({ menu: m, menus: opts.menus, lines: opts.lines ?? [], rules: opts.rules ?? [], skus: [], prices: [], branches: [br, old], overrides: {} })]),
  );
  return summarizeBranch({ branch: br, menus: opts.menus, rules: opts.rules ?? [], summaries, soldByCode: opts.sold });
}
const ids = (s: ReturnType<typeof run>, level: string) => s.checks.filter((c) => c.level === level).map((c) => c.id);

describe("summarizeBranch", () => {
  it("flags a brand name that matches no menu", () => {
    expect(ids(run({ menus: [menu("a", "MN-1")], br: { ...branch, brandName: "sendo " } }), "error")).toContain("brand");
  });

  it("flags codes sold here that aren't menus", () => {
    const s = run({ menus: [menu("a", "MN-1")], sold: { "MN-1": { new: 3 }, "MN-99": { new: 5, old: 1 }, OP122: { new: 9 }, "OP-027": { new: 2 }, คิดภาษี: { new: 4 } } });
    expect(s.unknownCodes).toEqual([{ code: "MN-99", qty: 5 }]);
    expect(ids(s, "error")).toContain("unknown-codes");
  });

  it("flags open menus that sell here without a recipe, not unsold toppings", () => {
    const s = run({ menus: [menu("a", "MN-1"), menu("b", "MN-2")], sold: { "MN-1": { new: 2 } } });
    const c = s.checks.find((x) => x.id === "no-recipe");
    expect(c?.detail).toContain("MN-1");
    expect(c?.detail).not.toContain("MN-2");
  });

  it("doesn't call a set menu fed by set rules 'no recipe'", () => {
    const set = menu("s", "MN-075");
    const s = run({ menus: [menu("a", "MN-1"), set], lines: [{ menuId: "a", skuId: "x", branchId: null, qtyPerServing: 1, yieldPct: 100 } as MenuBomLine], rules: [rule({ ruleType: "submenu", submenuId: "a", menuIds: ["s"] })], sold: { "MN-075": { new: 4 } } });
    expect(s.checks.find((c) => c.id === "no-recipe")).toBeUndefined();
  });

  it("warns about rules limited to other branches", () => {
    const s = run({ menus: [menu("a", "MN-1")], rules: [rule({ branchIds: ["old"], menuIds: ["a"] })] });
    expect(ids(s, "warn")).toContain("rules-elsewhere");
    const other = run({ menus: [menu("a", "MN-1"), menu("z", "TH-1", "Thaniya")], rules: [rule({ branchIds: ["old"], menuIds: ["z"] })] });
    expect(ids(other, "warn")).not.toContain("rules-elsewhere");
  });
});
