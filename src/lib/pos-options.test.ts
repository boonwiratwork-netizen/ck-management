import { describe, it, expect } from "vitest";
import { parseOptions, buildCatalog, testDraft, specificKeywords, Bill, RuleDraft } from "./pos-options";
import type { Menu } from "@/types/menu";
import type { ModifierRule } from "@/types/modifier-rule";
import type { MenuBomLine } from "@/types/menu-bom";

const DIY =
  "Tonkotsu (D.I.Y.) เลือกเส้น : เส้นโฮมเมด x 1 ระดับเส้น : ลวกเส้น : ปกติ x 1 ความเค็ม : ความเค็ม : ลดเค็ม x 1 Topping  : Ajitama x 1 ADD-ONS : เมนไทโกะ x 1";

describe("parseOptions", () => {
  it("reads every option out of a FoodStory bill name", () => {
    expect(parseOptions(DIY).map(({ group, value }) => ({ group, value }))).toEqual([
      { group: "เลือกเส้น", value: "เส้นโฮมเมด" },
      { group: "ระดับเส้น", value: "ปกติ" },
      { group: "ความเค็ม", value: "ลดเค็ม" },
      { group: "Topping", value: "Ajitama" },
      { group: "ADD-ONS", value: "เมนไทโกะ" },
    ]);
  });
  it("gives nothing for a plain name", () => {
    expect(parseOptions("Standard Shio Ramen (Line Man)")).toEqual([]);
  });
  it("drops brackets around a group name", () => {
    expect(parseOptions("Ramen (Topping) : Ajitama x 1")[0].group).toBe("Topping");
  });
  it("handles a drink with a quantity above 1", () => {
    expect(parseOptions("Mugicha แก้ว : น้ำแข็ง x 2")).toEqual([{ group: "แก้ว", value: "น้ำแข็ง", raw: "แก้ว : น้ำแข็ง" }]);
  });
});

const menus = [
  { id: "m81", menuCode: "MN-081", menuName: "Tonkotsu DIY" },
  { id: "m04", menuCode: "MN-004", menuName: "Signature Shio" },
] as Menu[];
const rule = (r: Partial<ModifierRule>): ModifierRule => ({
  id: "r",
  keyword: "",
  skuId: "sku",
  qtyPerMatch: 1,
  uom: "",
  description: "",
  isActive: true,
  menuId: null,
  menuIds: [],
  ruleType: "add",
  swapSkuId: null,
  submenuId: null,
  branchIds: [],
  ...r,
});
const bills: Bill[] = [
  { menu_code: "MN-081", menu_name: DIY, qty: 2, branch_id: "thaniya" },
  { menu_code: "MN-004", menu_name: "Signature Shio Ramen เลือกเส้น : เส้นโฮมเมด x 1", qty: 1, branch_id: "shiro" },
];

describe("buildCatalog", () => {
  it("marks an option covered, partly covered, or without a rule", () => {
    const rules = [
      rule({ id: "home", ruleType: "swap", keyword: "เส้นโฮมเมด", branchIds: ["thaniya"] }),
      rule({ id: "egg", ruleType: "submenu", keyword: "Ajitama" }),
    ];
    const cat = buildCatalog(bills, menus, rules, new Set(["ความเค็ม|ลดเค็ม", "ระดับเส้น|*"]));
    const by = (v: string) => cat.find((e) => e.value === v)!;
    expect(by("เส้นโฮมเมด").plates).toBe(3);
    expect(by("เส้นโฮมเมด").status).toBe("partial"); // Shiro bill not covered
    expect(by("Ajitama").status).toBe("covered");
    expect(by("เมนไทโกะ").status).toBe("none");
    expect(by("ลดเค็ม").status).toBe("ignored");
    expect(by("ปกติ").status).toBe("ignored"); // whole ระดับเส้น group
  });
});

describe("testDraft", () => {
  const draft = (d: Partial<RuleDraft>): RuleDraft => ({
    ruleType: "add",
    keyword: "",
    skuId: "sku",
    swapSkuId: null,
    submenuId: null,
    qtyPerMatch: 10,
    menuIds: [],
    branchIds: [],
    ...d,
  });

  it("counts plates and usage the draft would hit", () => {
    const t = testDraft(draft({ keyword: "เมนไทโกะ" }), bills, menus, []);
    expect(t.plates).toBe(2);
    expect(t.totalQty).toBe(20);
    expect(t.options).toEqual([{ value: "เมนไทโกะ", group: "ADD-ONS", plates: 2 }]);
  });

  it("shows a keyword that is too broad", () => {
    const t = testDraft(draft({ keyword: "เส้น" }), bills, menus, []);
    expect(t.options.length).toBeGreaterThan(0);
    expect(t.options.map((o) => o.value)).toContain("เส้นโฮมเมด");
  });

  it("counts plates left out by the menu pick", () => {
    const t = testDraft(draft({ keyword: "เส้นโฮมเมด", menuIds: ["m81"] }), bills, menus, []);
    expect(t.plates).toBe(2);
    expect(t.leftOut).toBe(1);
  });

  it("warns when a swap's old item isn't in the recipe", () => {
    const lines = [{ menuId: "m81", skuId: "wholewheat", branchId: null }] as MenuBomLine[];
    const t = testDraft(draft({ ruleType: "swap", keyword: "เส้นโฮมเมด", swapSkuId: "wholewheat" }), bills, menus, lines);
    expect(t.swapMissing).toBe(1); // MN-004 has no wholewheat line
  });
});

describe("specificKeywords", () => {
  it("adds the label the POS writes before the choice", () => {
    const ex = "Tonkotsu (D.I.Y.) กระเทียมสด : กระเทียม : เติม x 1";
    expect(specificKeywords({ group: "กระเทียมสด", value: "เติม" }, ex)).toEqual(["กระเทียม : เติม", "กระเทียมสด : เติม"]);
  });
  it("a more specific keyword stops matching the opposite choice", () => {
    const b: Bill[] = [
      { menu_code: "MN-081", menu_name: "X กระเทียมสด : กระเทียม : เติม x 1", qty: 1, branch_id: "t" },
      { menu_code: "MN-081", menu_name: "X กระเทียมสด : กระเทียม : ไม่เติม x 1", qty: 1, branch_id: "t" },
    ];
    const d: RuleDraft = { ruleType: "add", keyword: "เติม", skuId: "g", swapSkuId: null, submenuId: null, qtyPerMatch: 5, menuIds: [], branchIds: [] };
    expect(testDraft(d, b, menus, []).plates).toBe(2);
    const t = testDraft({ ...d, keyword: "กระเทียม : เติม" }, b, menus, []);
    expect(t.plates).toBe(1);
    expect(t.options).toHaveLength(1);
    expect(t.inMenuName).toBe(0);
  });
});
