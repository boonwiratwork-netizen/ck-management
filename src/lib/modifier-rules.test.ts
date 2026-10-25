import { describe, it, expect } from "vitest";
import { ruleMatchesSale } from "./modifier-rules";

describe("ruleMatchesSale", () => {
  const dIY = "Tonkotsu (D.I.Y.) เลือกเส้น : Upgrade เส้นโฮมเมด  x 1 Topping  : Ajitama x 1";

  it("matches a keyword inside the POS name", () => {
    expect(ruleMatchesSale({ keyword: "Ajitama", ruleType: "submenu" }, { menu_code: "MN-081", menu_name: dIY })).toBe(true);
  });

  it("ignores upper/lower case", () => {
    expect(ruleMatchesSale({ keyword: "ajitama", ruleType: "add" }, { menu_name: dIY })).toBe(true);
  });

  it("submenu matches on menu_code too", () => {
    expect(ruleMatchesSale({ keyword: "MN-011", ruleType: "submenu" }, { menu_code: "MN-011", menu_name: "เต้าหู้ทอด" })).toBe(true);
  });

  it("submenu matches a code written inside the name", () => {
    expect(
      ruleMatchesSale({ keyword: "MN-011", ruleType: "submenu" }, { menu_code: "MN-052", menu_name: "Set Shoyu  Set Menu : MN-011 เต๋าหู้ทอด x 1" }),
    ).toBe(true);
  });

  it("add/swap do not match on menu_code alone", () => {
    expect(ruleMatchesSale({ keyword: "MN-011", ruleType: "add" }, { menu_code: "MN-011", menu_name: "เต้าหู้ทอด" })).toBe(false);
  });

  it("does not fire on the negative option", () => {
    const rule = { keyword: "กระเทียมสด : ใส่กระเทียมสด", ruleType: "submenu" };
    expect(ruleMatchesSale(rule, { menu_name: "กระเทียมสด : ไม่ใส่กระเทียมสด x 1" })).toBe(false);
    expect(ruleMatchesSale(rule, { menu_name: "กระเทียมสด : ใส่กระเทียมสด x 1" })).toBe(true);
  });

  it("never matches an empty keyword", () => {
    expect(ruleMatchesSale({ keyword: "  ", ruleType: "add" }, { menu_name: "anything" })).toBe(false);
  });

  it("reads snake_case rule_type from raw rows", () => {
    expect(ruleMatchesSale({ keyword: "MN-014", rule_type: "submenu" }, { menu_code: "MN-014" })).toBe(true);
  });
});
