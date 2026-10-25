import { describe, expect, it } from "vitest";
import type { POSMappingProfile } from "@/hooks/use-sales-entry-data";
import { dayWrites, defaultMode, isReadable, manualRow, planDays, readWithEachFormat, rowsNotInDb, shortName, type ExistingRow } from "./sales-import";

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

  it("replace writes EVERY pasted row and removes the old ones (old page kept only unseen rows)", () => {
    const rows = [row("2026-10-22", "B1", "MN-001"), row("2026-10-22", "B2", "MN-032")];
    const [plan] = planDays(rows, new Map([["2026-10-22", [ex("old1", "2026-10-22", "B1", "MN-001")]]]));
    const w = dayWrites("br", plan, "replace");
    expect(w.insert.map((r) => r.receipt_no)).toEqual(["B1", "B2"]);
    expect(w.deleteIds).toEqual(["old1"]);
    expect(dayWrites("br", plan, "add").insert.map((r) => r.receipt_no)).toEqual(["B2"]);
    expect(dayWrites("br", plan, "skip")).toEqual({ insert: [], deleteIds: [] });
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
