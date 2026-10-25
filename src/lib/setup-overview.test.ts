import { describe, it, expect } from "vitest";
import { checkKind, groupIssues, unpricedSkus } from "./setup-overview";
import type { Menu } from "@/types/menu";
import type { MenuSetupSummary } from "./menu-health";
import type { MenuBomLine } from "@/types/menu-bom";
import type { SKU } from "@/types/sku";
import type { Price } from "@/types/price";

const menu = (id: string, status: "Active" | "Inactive" = "Active") => ({ id, menuCode: id, menuName: id, status }) as Menu;
const summary = (checks: { id: string; level: "ok" | "warn" | "error" }[]) =>
  ({ checks: checks.map((c) => ({ ...c, area: "recipe", title: c.id })) }) as unknown as MenuSetupSummary;

describe("checkKind", () => {
  it("strips the rule or branch id", () => {
    expect(checkKind("swap-6ed19fbf-f820-461e-ba1b-e3cb6ce1a33d")).toBe("swap");
    expect(checkKind("closed-sold-abc")).toBe("closed-sold");
    expect(checkKind("no-recipe")).toBe("no-recipe");
  });
});

describe("groupIssues", () => {
  it("groups the same problem across menus, errors first, skips inactive menus", () => {
    const menus = [menu("a"), menu("b"), menu("c", "Inactive")];
    const s = new Map([
      ["a", summary([{ id: "unpriced", level: "warn" }, { id: "no-recipe", level: "error" }])],
      ["b", summary([{ id: "unpriced", level: "warn" }])],
      ["c", summary([{ id: "no-recipe", level: "error" }])],
    ]);
    const g = groupIssues(menus, s);
    expect(g.map((x) => x.kind)).toEqual(["no-recipe", "unpriced"]);
    expect(g[0].menus.map((m) => m.menu.id)).toEqual(["a"]);
    expect(g[1].menus).toHaveLength(2);
  });
});

describe("unpricedSkus", () => {
  it("ranks unpriced ingredients by menus affected", () => {
    const lines = [
      { menuId: "a", skuId: "x" },
      { menuId: "b", skuId: "x" },
      { menuId: "a", skuId: "y" },
      { menuId: "a", skuId: "p" },
    ] as MenuBomLine[];
    const prices = [{ skuId: "p", pricePerUsageUom: 2, isActive: true }] as Price[];
    const r = unpricedSkus([menu("a"), menu("b")], lines, [{ id: "x", name: "X" }] as SKU[], prices);
    expect(r.map((u) => [u.skuId, u.menus.length])).toEqual([["x", 2], ["y", 1]]);
  });
});
