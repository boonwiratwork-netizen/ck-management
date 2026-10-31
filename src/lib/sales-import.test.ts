import { describe, expect, it } from "vitest";
import type { POSMappingProfile } from "@/hooks/use-sales-entry-data";
import { cleanBase, codeResolver, dayWrites, defaultMode, isReadable, manualRow, planDays, posBase, readWithEachFormat, noCodeBases, rowsNotInDb, shortName, skippedByName, withTimeout, writeDay, type DayWrites, type SalesWriter, type ExistingRow } from "./sales-import";

// The two formats saved on the live site (25 Oct 2026)
const FOODSTORY: POSMappingProfile = {
  id: "fs",
  name: "FoodStory POS",
  separator: "tab",
  hasHeaderRow: false,
  dateFormat: "DD/MM/YYYY",
  mappings: { channel: 15, date: 0, menu_code: 5, menu_name: 6, net_amount: 13, order_type: 7, qty: 8, receipt_no: 2, unit_price: 9 },
};
const SUPERPOS: POSMappingProfile = {
  id: "sp",
  name: "SuperPOS",
  separator: "tab",
  hasHeaderRow: true,
  dateFormat: "DD/MM/YYYY",
  mappings: { channel: 9, date: 2, menu_code: 11, menu_name: 12, net_amount: 17, qty: 13, receipt_no: 5, unit_price: 14 },
};
const fsLine = (date: string, bill: string, code: string, name: string, qty: number, price: number, net: number) => {
  const c = Array(16).fill("");
  Object.assign(c, { 0: date, 2: bill, 5: code, 6: name, 7: "Dine-In", 8: String(qty), 9: String(price), 13: String(net), 15: "หน้าร้าน" });
  return c.join("\t");
};
const CODES = new Set(["MN-001", "MN-032", "MN-080"]);

describe("reading a POS paste", () => {
  const text = [fsLine("24/10/2026", "1IM5N", "MN-001", "Standard Shio Ramen", 1, 369, 339), fsLine("24/10/2026", "1IM5N", "MN-032", "Mineral water", 2, 30, 60)].join("\n");

  it("picks the format whose rows carry real menu codes", () => {
    const [best] = readWithEachFormat(text, [SUPERPOS, FOODSTORY], CODES, "paste");
    expect(best.profile.name).toBe("FoodStory POS");
    expect(best.known).toBe(2);
    expect(isReadable(best)).toBe(true);
    expect(best.rows[0]).toMatchObject({ saleDate: "2026-10-24", receiptNo: "1IM5N", menuCode: "MN-001", qty: 1, unitPrice: 369, netAmount: 339, channel: "หน้าร้าน", orderType: "Dine-In" });
  });

  it("refuses text whose 'menu codes' are not menus (Shiro 9 Oct: คิดภาษี)", () => {
    const junk = [fsLine("09/10/2026", "POS", "คิดภาษี", "0.00", 1, 0, 0), fsLine("09/10/2026", "POS", "คิดภาษี", "40.00", 1, 0, 0)].join("\n");
    const [best] = readWithEachFormat(junk, [FOODSTORY, SUPERPOS], CODES, "paste");
    expect(best.rows.length).toBe(2);
    expect(isReadable(best)).toBe(false);
  });

  it("counts the old POS option codes as usable", () => {
    const t = fsLine("02/04/2026", "A1", "OP122", "แก้วน้ำแข็ง", 1, 0, 0);
    expect(readWithEachFormat(t, [FOODSTORY], CODES, "paste")[0].known).toBe(1);
  });
});

describe("planning days", () => {
  const row = (date: string, bill: string, code: string, net = 100) => ({ saleDate: date, receiptNo: bill, menuCode: code, menuName: code, orderType: "", qty: 1, unitPrice: net, netAmount: net, channel: "" });
  const ex = (id: string, date: string, bill: string, code: string, net = 100): ExistingRow => ({ id, sale_date: date, receipt_no: bill, menu_code: code, menu_name: code, net_amount: net });

  it("matches the old duplicate rule: a key twice in the paste and once saved leaves one new row", () => {
    const rows = [row("2026-10-22", "B1", "MN-001"), row("2026-10-22", "B1", "MN-001"), row("2026-10-22", "B2", "MN-032")];
    expect(rowsNotInDb(rows, [ex("x", "2026-10-22", "B1", "MN-001")]).map((r) => r.receiptNo)).toEqual(["B1", "B2"]);
  });

  it("skips a day that is already complete, adds a new one", () => {
    const rows = [row("2026-10-22", "B1", "MN-001"), row("2026-10-23", "C1", "MN-001", 250)];
    const plans = planDays(rows, new Map([["2026-10-22", [ex("x", "2026-10-22", "B1", "MN-001")]]]));
    expect(plans.map((p) => [p.date, defaultMode(p), p.total, p.existingTotal])).toEqual([
      ["2026-10-22", "skip", 100, 100],
      ["2026-10-23", "add", 250, 0],
    ]);
  });

  it("replace makes the day equal the paste: a saved line with the same key is updated in place, new ones inserted, the rest removed", () => {
    const rows = [row("2026-10-22", "B1", "MN-001"), row("2026-10-22", "B2", "MN-032")];
    const [plan] = planDays(rows, new Map([["2026-10-22", [ex("old1", "2026-10-22", "B1", "MN-001"), ex("old2", "2026-10-22", "B9", "MN-080")]]]));
    const w = dayWrites("br", plan, "replace");
    expect(w.insert.map((r) => r.receipt_no)).toEqual(["B2"]);
    // Saved row read without its numbers: written again, never inserted twice
    expect(w.update.map((u) => u.id)).toEqual(["old1"]);
    expect(w.deleteIds).toEqual(["old2"]);
    expect(dayWrites("br", plan, "add").insert.map((r) => r.receipt_no)).toEqual(["B2"]);
    expect(dayWrites("br", plan, "skip")).toEqual({ insert: [], update: [], deleteIds: [], kept: 0 });
  });

  it("writes the same row shape as the old import", () => {
    const [plan] = planDays([row("2026-10-23", "C1", "MN-001", 339)], new Map());
    expect(dayWrites("br", plan, "add").insert[0]).toEqual({
      branch_id: "br",
      sale_date: "2026-10-23",
      receipt_no: "C1",
      menu_code: "MN-001",
      menu_name: "MN-001",
      order_type: "",
      qty: 1,
      unit_price: 339,
      net_amount: 339,
      channel: "",
    });
  });
});

describe("manual entry", () => {
  it("is the old manual row", () => {
    expect(manualRow({ branchId: "br", date: "2026-10-25", menuCode: "MN-001", menuName: "Shio Ramen", optionKeyword: "เส้นโฮมเมด", qty: 2, unitPrice: 339, now: 1 })).toEqual({
      branch_id: "br",
      sale_date: "2026-10-25",
      receipt_no: "MANUAL-1",
      menu_code: "MN-001",
      menu_name: "Shio Ramen เส้นโฮมเมด",
      order_type: "Manual",
      qty: 2,
      unit_price: 339,
      net_amount: 678,
      channel: "Manual",
    });
  });
});

describe("short bill names", () => {
  it("keeps the menu and the choices", () => {
    expect(shortName("Standard Shio Ramen เลือกเส้น : เส้นโฮมเมด x 1 ระดับเส้น : ลวกเส้น : ปกติ x 1 ความเค็ม : ความเค็ม : ปกติ x 1")).toEqual({
      base: "Standard Shio Ramen",
      options: "เส้นโฮมเมด · ลวกเส้น ปกติ · ความเค็ม ปกติ",
    });
    expect(shortName("Mineral water อุณหภูมิ : เย็น x 1 แก้ว : น้ำแข็ง x 3")).toEqual({ base: "Mineral water", options: "เย็น · น้ำแข็ง ×3" });
    expect(shortName("Trio Set")).toEqual({ base: "Trio Set", options: "" });
  });
});

// LINE MAN deals FoodStory sends with a price but no menu code (seen live, Oct 2026)
describe("priced lines without a menu code", () => {
  const D = "29/10/2026";
  const BLACK = "Black Garlic Ramen ลดพิเศษ! [เฉพาะที่ LINE MAN] [ดีลเดือด] เลือกเส้น : เส้นโฮมเมด x 1";
  const RED = "Red Spicy Ramen ลดพิเศษ! [เฉพาะที่ LINE MAN] [ดีลเดือด]";
  const CREMA = "White Crema Truffle Ramen ลดพิเศษ! [เฉพาะที่ LINE MAN] [ดีลเดือด]";
  const CHASHU = "Chashu Don with Truffle Sauce ลดพิเศษ! [เฉพาะที่ LINE MAN] [ดีลเดือด]";
  const SET_A = "[โปรโมชัน] Delivery Set A ราเมน x1+ของทานเล่น x1 ลดพิเศษ! [เฉพาะที่ LINE MAN] [ดีลเดือด] เลือกราเมนชามที่ 1 : Standard Shio Ramen x 1 เลือกของทานเล่น : Tori Karaage x 1";
  const TORI = "Standard Tori Paitan Ramen ลดพิเศษ! [เฉพาะที่ LINE MAN] [ดีลเดือด]";
  const WAGYU = "Thai Wagyu Mini Don Sendo Recipe ลดพิเศษ! [เฉพาะที่ LINE MAN] [ดีลเดือด]";
  const menus = [
    { id: "m1", menuCode: "MN-001", menuName: "Standard Shio Ramen" },
    { id: "m56", menuCode: "MN-056", menuName: "แบล็ค การ์ลิค ราเมน" },
    { id: "m3", menuCode: "MN-003", menuName: "สแตนดาร์ด โทริ ไพตัน ราเมน" },
    { id: "m75", menuCode: "MN-075", menuName: "เดลิเวอรี่ เซ็ต A" },
    { id: "m41", menuCode: "MN-041", menuName: "ชาชูดง ทรัฟเฟิล (Chashu Don with Truffle Sauce)" },
    { id: "m60", menuCode: "MN-060", menuName: "white crema truffle ramen" },
    // Live: the "(Line Man)" copies have NO menu_bom lines (MN-003 has 13)
    { id: "m3L", menuCode: "MN-003L", menuName: "Standard Tori Paitan Ramen (Line Man)" },
  ];
  const codes = new Set(menus.map((m) => m.menuCode));
  const recipe = new Set(menus.filter((m) => m.id !== "m3L").map((m) => m.id));
  const resolver = (h: { menu_code: string; menu_name: string }[], r: Set<string> | null = recipe) => codeResolver(menus, h, codes, r);
  // What this branch's dine-in lines carried (FoodStory names, CK codes)
  const history = [
    { menu_code: "MN-056", menu_name: "Black Garlic Ramen เลือกเส้น : เส้นโฮมเมด x 1" },
    { menu_code: "MN-056", menu_name: "Black Garlic Ramen" },
    { menu_code: "MN-003", menu_name: "Standard Tori Paitan Ramen" },
    { menu_code: "MN-075", menu_name: "[โปรโมชัน] Delivery Set A ราเมน x1+ของทานเล่น x1 เลือกราเมนชามที่ 1 : Black Garlic Ramen x 1" },
  ];
  const text = [
    fsLine(D, "LM1", "MN-001", "Standard Shio Ramen", 1, 339, 339),
    fsLine(D, "LM1", "", BLACK, 1, 329, 329),
    fsLine(D, "LM2", "", RED, 1, 329, 329),
    fsLine(D, "LM2", "", CREMA, 1, 349, 349),
    fsLine(D, "LM3", "", CHASHU, 1, 259, 259),
    fsLine(D, "LM3", "", SET_A, 1, 399, 399),
    fsLine(D, "LM4", "", TORI, 1, 299, 299),
    fsLine(D, "LM4", "", WAGYU, 1, 289, 289),
    // Free add-ons stay out, as before
    fsLine(D, "LM4", "", "ไม่รับช้อนส้อมพลาสติก", 1, 0, 0),
    fsLine(D, "LM4", "", "รับเครื่องปรุง", 1, 0, 0),
    fsLine(D, "LM4", "", "Ice", 1, 0, 0),
    fsLine(D, "LM4", "", "Glass", 1, 0, 0),
  ].join("\n");

  it("cuts the name before its options and drops the promo tags", () => {
    expect(posBase(BLACK)).toBe("Black Garlic Ramen ลดพิเศษ! [เฉพาะที่ LINE MAN] [ดีลเดือด]");
    expect(cleanBase(BLACK)).toBe("Black Garlic Ramen");
    expect(cleanBase(SET_A)).toBe("Delivery Set A ราเมน x1+ของทานเล่น x1");
    expect(cleanBase(TORI)).toBe("Standard Tori Paitan Ramen");
  });

  it("finds codes from the menu list (whole name, English part) and from past sales", () => {
    const resolve = resolver(history);
    expect(resolve(BLACK)).toBe("MN-056");
    expect(resolve(TORI)).toBe("MN-003");
    expect(resolve(SET_A)).toBe("MN-075");
    expect(resolve(CHASHU)).toBe("MN-041");
    expect(resolve(CREMA)).toBe("MN-060");
    expect(resolve(RED)).toBeNull();
    expect(resolve(WAGYU)).toBeNull();
  });

  it("imports resolved lines with the FULL POS name; the rest is listed, free add-ons are not", () => {
    const [best] = readWithEachFormat(text, [FOODSTORY], codes, "paste", resolver(history));
    expect(best.resolved).toBe(5);
    expect(best.rows.find((r) => r.menuCode === "MN-075")).toMatchObject({ menuName: SET_A, netAmount: 399, qty: 1, receiptNo: "LM3", channel: "หน้าร้าน", codeFromName: true });
    expect(best.rows.find((r) => r.menuCode === "MN-056")?.menuName).toBe(BLACK);
    expect(best.skipped.map((s) => s.menuName)).toEqual([RED, WAGYU]);
    expect(skippedByName(best.skipped)).toEqual([
      { name: RED, lines: 1, amount: 329 },
      { name: WAGYU, lines: 1, amount: 289 },
    ]);
    // Never written: the flag stays out of the database row
    const [plan] = planDays(best.rows, new Map());
    expect(Object.keys(dayWrites("br", plan, "add").insert[1])).not.toContain("codeFromName");
  });

  it("without a resolver nothing changes: every priced no-code line is listed", () => {
    const [best] = readWithEachFormat(text, [FOODSTORY], codes, "paste");
    expect(best.resolved).toBe(0);
    expect(best.skipped.length).toBe(7);
  });

  it("asks past sales for every priced no-code name, cleaned", () => {
    const reads = readWithEachFormat(text, [FOODSTORY], codes, "paste");
    expect(noCodeBases(reads)).toEqual(["Black Garlic Ramen", "Red Spicy Ramen", "White Crema Truffle Ramen", "Chashu Don with Truffle Sauce", "Delivery Set A ราเมน x1+ของทานเล่น x1", "Standard Tori Paitan Ramen", "Thai Wagyu Mini Don Sendo Recipe"]);
  });

  it("never picks a menu without a recipe: Tori Paitan goes to MN-003 from history, else stays unresolved", () => {
    expect(resolver(history)(TORI)).toBe("MN-003");
    // Without history only the recipe-less "(Line Man)" copy matches the English name: not taken
    expect(resolver([])(TORI)).toBeNull();
    // Even if both had recipes, a name matching two codes is not guessed
    expect(resolver([], new Set(menus.map((m) => m.id)))(TORI)).toBe("MN-003L");
    const twin = [...menus, { id: "m3x", menuCode: "MN-003", menuName: "Standard Tori Paitan Ramen" }];
    expect(codeResolver(twin, [], codes, new Set(twin.map((m) => m.id)))(TORI)).toBeNull();
    // Menu list not loaded: no name matching at all, history still works
    expect(resolver([], null)(CHASHU)).toBeNull();
    expect(resolver(history, null)(BLACK)).toBe("MN-056");
  });

  it("past sales win over the menu list", () => {
    const h = [...Array(5)].map(() => ({ menu_code: "MN-001", menu_name: "Chashu Don with Truffle Sauce" }));
    expect(resolver(h)(CHASHU)).toBe("MN-001");
  });

  it("a deal saved under a resolved code is not added again when the POS later sends a real code", () => {
    const saved: ExistingRow[] = [{ id: "e1", sale_date: "2026-10-29", receipt_no: "LM4", menu_code: "MN-003", menu_name: TORI, net_amount: 299 }];
    const coded = readWithEachFormat(fsLine(D, "LM4", "MN-003L", TORI, 1, 299, 299), [FOODSTORY], codes, "paste")[0].rows;
    expect(coded[0].codeFromName).toBeUndefined();
    expect(rowsNotInDb(coded, saved)).toEqual([]);
    // Exact matches go first: the any-code pass never steals a row another line matches exactly
    const two = readWithEachFormat([fsLine(D, "LM4", "MN-003L", TORI, 1, 299, 299), fsLine(D, "LM4", "MN-003", TORI, 1, 299, 299)].join("\n"), [FOODSTORY], codes, "paste")[0].rows;
    expect(rowsNotInDb(two, saved).map((r) => r.menuCode)).toEqual(["MN-003L"]);
  });

  it("does not trust a name past sales split between two codes", () => {
    const split = [...Array(3)].map(() => ({ menu_code: "MN-056", menu_name: "Red Spicy Ramen" })).concat([{ menu_code: "MN-003", menu_name: "Red Spicy Ramen" }]);
    expect(resolver(split)(RED)).toBeNull();
    // Codes the app does not know are never taught
    expect(resolver([{ menu_code: "MN-999", menu_name: "Red Spicy Ramen" }])(RED)).toBeNull();
  });

  it("re-import: a resolved line already saved (under any code) is not new", () => {
    const [best] = readWithEachFormat(text, [FOODSTORY], codes, "paste", resolver(history));
    const saved: ExistingRow[] = best.rows.map((r, i) => ({ id: `e${i}`, sale_date: r.saleDate, receipt_no: r.receiptNo, menu_code: r.menuCode, menu_name: r.menuName, net_amount: r.netAmount }));
    expect(rowsNotInDb(best.rows, saved)).toEqual([]);
    // Staff fixed Black Garlic's code by hand in History: still the same line
    const fixed = saved.map((e) => (e.menu_name === BLACK ? { ...e, menu_code: "MN-099" } : e));
    expect(rowsNotInDb(best.rows, fixed)).toEqual([]);
    // Days saved before this change lack the deal lines: re-pasting adds exactly those
    const before = saved.filter((e) => e.menu_code === "MN-001");
    expect(rowsNotInDb(best.rows, before).length).toBe(5);
  });

  it("two coded lines with the same code and name on one bill fold too; a resolved twin of a coded line folds in", () => {
    const t = [fsLine(D, "B7", "MN-001", "Standard Shio Ramen", 1, 339, 339), fsLine(D, "B7", "MN-001", "Standard Shio Ramen", 1, 339, 339), fsLine(D, "B7", "MN-001", "Standard Shio Ramen", 1, 339, 339)].join("\n");
    const [best] = readWithEachFormat(t, [FOODSTORY], codes, "paste");
    expect(best.rows).toEqual([expect.objectContaining({ menuCode: "MN-001", qty: 3, netAmount: 1017 })]);
    const mixed = [fsLine(D, "B8", "MN-003", TORI, 1, 299, 299), fsLine(D, "B8", "", TORI, 1, 299, 299)].join("\n");
    const [m] = readWithEachFormat(mixed, [FOODSTORY], codes, "paste", resolver(history));
    expect(m.rows).toEqual([expect.objectContaining({ menuCode: "MN-003", qty: 2, netAmount: 598, codeFromName: undefined })]);
    expect(m.resolved).toBe(0);
  });

  it("two identical deal lines on one bill become one line (the table's unique key), and stay one on re-paste", () => {
    const twice = [fsLine(D, "LM9", "", TORI, 1, 299, 299), fsLine(D, "LM9", "", TORI, 1, 299, 299)].join("\n");
    const resolve = resolver(history);
    const [best] = readWithEachFormat(twice, [FOODSTORY], codes, "paste", resolve);
    expect(best.rows).toHaveLength(1);
    expect(best.rows[0]).toMatchObject({ menuCode: "MN-003", qty: 2, netAmount: 598 });
    const [again] = readWithEachFormat(twice, [FOODSTORY], codes, "paste", resolve);
    expect(rowsNotInDb(again.rows, [{ id: "x", sale_date: "2026-10-29", receipt_no: "LM9", menu_code: "MN-003", menu_name: TORI, net_amount: 598 }])).toEqual([]);
  });
});

describe("replace keeps saved rows that equal a pasted line", () => {
  const row = (bill: string, code: string, net: number) => ({ saleDate: "2026-10-22", receiptNo: bill, menuCode: code, menuName: code, orderType: "Dine-In", qty: 1, unitPrice: net, netAmount: net, channel: "หน้าร้าน" });
  const saved = (id: string, bill: string, code: string, net: number): ExistingRow => ({ id, sale_date: "2026-10-22", receipt_no: bill, menu_code: code, menu_name: code, net_amount: net, qty: 1, unit_price: net, order_type: "Dine-In", channel: "หน้าร้าน" });

  it("unchanged lines are left alone (inserting them first hit the unique key), changed ones update, the rest insert/delete", () => {
    const [plan] = planDays([row("B1", "MN-001", 339), row("B2", "MN-032", 35), row("B3", "MN-080", 49)], new Map([["2026-10-22", [saved("a", "B1", "MN-001", 339), saved("b", "B2", "MN-032", 30), saved("c", "B9", "MN-016", 119)]]]));
    const w = dayWrites("br", plan, "replace");
    expect(w.kept).toBe(1);
    expect(w.update).toEqual([{ id: "b", patch: { order_type: "Dine-In", qty: 1, unit_price: 35, net_amount: 35, channel: "หน้าร้าน" } }]);
    expect(w.insert.map((r) => r.receipt_no)).toEqual(["B3"]);
    expect(w.deleteIds).toEqual(["c"]);
    // No insert shares a key with a saved row that is not being deleted
    const live = new Set(plan.existing.filter((e) => !w.deleteIds.includes(e.id)).map((e) => `${e.receipt_no}|${e.menu_code}|${e.menu_name}`));
    expect(w.insert.some((r) => live.has(`${r.receipt_no}|${r.menu_code}|${r.menu_name}`))).toBe(false);
  });

  it("re-pasting an unchanged day writes nothing but counts it", () => {
    const [plan] = planDays([row("B1", "MN-001", 339)], new Map([["2026-10-22", [saved("a", "B1", "MN-001", 339)]]]));
    expect(dayWrites("br", plan, "replace")).toEqual({ insert: [], update: [], deleteIds: [], kept: 1 });
  });
});

describe("a read that hangs", () => {
  it("gives the fallback after the time limit, and on error", async () => {
    expect(await withTimeout(new Promise<number[]>(() => undefined), 10, [])).toEqual([]);
    expect(await withTimeout(Promise.reject(new Error("x")), 10, null)).toBeNull();
    expect(await withTimeout(Promise.resolve([1]), 10, [])).toEqual([1]);
  });
});

describe("writing a day", () => {
  const ins = (bill: string) => ({ branch_id: "br", sale_date: "2026-10-22", receipt_no: bill, menu_code: "MN-001", menu_name: "x", order_type: "", qty: 1, unit_price: 1, net_amount: 1, channel: "" });
  const patch = { order_type: "", qty: 2, unit_price: 1, net_amount: 2, channel: "" };
  const w: DayWrites = { insert: [ins("B1"), ins("B2"), ins("B3")], deleteIds: ["old"], update: [{ id: "u1", patch }, { id: "u2", patch }], kept: 4 };
  // A fake database that logs calls; `fail` names the step that says no
  const fake = (fail?: "insert2" | "insertShort" | "remove" | "update") => {
    const log: string[] = [];
    let n = 0;
    const db: SalesWriter = {
      insert: async (rows) => {
        n++;
        log.push(`insert ${rows.map((r) => r.receipt_no).join(",")}`);
        if (fail === "insert2" && n === 2) return { ids: [], error: "boom" };
        // RLS: no error, nothing came back
        if (fail === "insertShort") return { ids: [], error: null };
        return { ids: rows.map((r) => `new-${r.receipt_no}`), error: null };
      },
      remove: async (ids) => {
        log.push(`remove ${ids.join(",")}`);
        return fail === "remove" && ids.includes("old") ? "0 rows" : null;
      },
      update: async (id) => {
        log.push(`update ${id}`);
        return fail === "update" && id === "u2" ? "0 rows" : null;
      },
    };
    return { db, log };
  };

  it("inserts, then deletes, then updates; kept rows count as saved", async () => {
    const { db, log } = fake();
    expect(await writeDay(w, db, 2)).toEqual({ saved: 9, error: null, partial: false });
    expect(log).toEqual(["insert B1,B2", "insert B3", "remove old", "update u1", "update u2"]);
  });

  it("a failed insert takes back what went in and touches nothing else", async () => {
    const { db, log } = fake("insert2");
    expect(await writeDay(w, db, 2)).toEqual({ saved: 0, error: "boom", partial: false });
    expect(log).toEqual(["insert B1,B2", "insert B3", "remove new-B1,new-B2"]);
  });

  it("an insert RLS refuses without an error (0 rows back) is a failure, not saved", async () => {
    const { db } = fake("insertShort");
    expect((await writeDay(w, db, 2)).error).toBeTruthy();
  });

  it("a failed delete or update is reported as partial (check and save again repairs it)", async () => {
    const del = fake("remove");
    expect(await writeDay(w, del.db, 2)).toMatchObject({ saved: 3, error: "0 rows", partial: true });
    expect(del.log).not.toContain("update u1");
    const upd = fake("update");
    expect(await writeDay(w, upd.db, 2)).toMatchObject({ error: "0 rows", partial: true });
  });
});
