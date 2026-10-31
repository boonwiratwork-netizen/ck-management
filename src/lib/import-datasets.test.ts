import { describe, expect, it } from "vitest";
import { DATASETS, isoDate, summarize, type ImportContext } from "./import-datasets";
import { parseCsv } from "./import-file";
import type { SKU } from "@/types/sku";

const ds = (k: string) => DATASETS.find((d) => d.key === k)!;
const ctx: ImportContext = {
  skus: [
    { id: "s1", skuId: "RM-0001", name: "เส้นราเมน", type: "RM" } as SKU,
    { id: "s2", skuId: "RM-0002", name: "ต้นหอม", type: "RM" } as SKU,
    { id: "sp", skuId: "SP-0001", name: "ซอส", type: "SP" } as SKU,
  ],
  suppliers: [{ id: "u1", name: "Makro" } as never],
  prices: [{ id: "p1", skuId: "s1", supplierId: "u1", pricePerPurchaseUom: 120, isActive: true } as never],
  menus: [{ id: "m1", menuCode: "MN-001", menuName: "ราเมน" } as never],
  menuBomLines: [
    { id: "b1", menuId: "m1", skuId: "s1", qtyPerServing: 100, yieldPct: 100, branchId: null } as never,
    { id: "b2", menuId: "m1", skuId: "s2", qtyPerServing: 5, yieldPct: 100, branchId: "thaniya" } as never,
  ],
  spLines: [],
  brands: ["Sendo"],
};

describe("import checks", () => {
  it("adds new products only, skips names already there", () => {
    const p = ds("skus").check(
      [
        { Name: "เส้นราเมน", Type: "RM", Category: "DG" },
        { Name: "ไข่", Type: "RM", Category: "DY" },
        { Name: "ไข่", Type: "RM", Category: "DY" },
        { Name: "X", Type: "ZZ", Category: "DG" },
      ],
      ctx,
    );
    expect(p.map((r) => r.verdict)).toEqual(["skip", "new", "skip", "error"]);
    expect(summarize(p).toSave).toHaveLength(1);
  });

  it("price: same price is not written again, a different one shows old → new, recipe-made items are skipped", () => {
    const p = ds("prices").check(
      [
        { "SKU Name": "เส้นราเมน", "Supplier Name": "makro", "Price Per Purchase UOM": "120" },
        { "SKU Name": "เส้นราเมน", "Supplier Name": "Makro", "Price Per Purchase UOM": "1,350" },
        { "SKU Name": "ต้นหอม", "Supplier Name": "Makro", "Price Per Purchase UOM": "40" },
        { "SKU Name": "ซอส", "Supplier Name": "Makro", "Price Per Purchase UOM": "40" },
        { "SKU Name": "ไม่มี", "Supplier Name": "Makro", "Price Per Purchase UOM": "40" },
      ],
      ctx,
    );
    expect(p.map((r) => r.verdict)).toEqual(["same", "change", "new", "skip", "error"]);
    expect(p[1]).toMatchObject({ was: "฿120", now: "฿1,350" });
  });

  it("menu recipe: one entry per menu, compared with the shared lines only", () => {
    const same = ds("menu-bom").check([{ menu_code: "MN-001", sku_code: "RM-0001", qty: "100" }], ctx);
    expect(same).toHaveLength(1);
    expect(same[0].verdict).toBe("same");
    const changed = ds("menu-bom").check(
      [
        { menu_code: "mn-001", sku_code: "RM-0001", qty: "100" },
        { menu_code: "MN-001", sku_code: "RM-0002", qty: "10" },
        { menu_code: "MN-001", sku_code: "RM-0002", qty: "12" },
        { menu_code: "MN-404", sku_code: "RM-0001", qty: "1" },
      ],
      ctx,
    );
    const entry = changed.find((r) => r.title.startsWith("MN-001"))!;
    expect(entry).toMatchObject({ verdict: "change", was: "1 วัตถุดิบ", now: "2 วัตถุดิบ" });
    expect(entry.rows).toHaveLength(2);
    expect(changed.filter((r) => r.verdict === "skip")).toHaveLength(1);
    expect(changed.filter((r) => r.verdict === "error")).toHaveLength(1);
  });

  it("what is exported reads back as no change", () => {
    for (const d of DATASETS) {
      const rows = d.current(ctx);
      const p = d.check(rows, ctx);
      expect(summarize(p).toSave, d.key).toHaveLength(0);
    }
  });
});

describe("review fixes", () => {
  it("a recipe with a problem line is not saved at all", () => {
    const p = ds("menu-bom").check(
      [
        { menu_code: "MN-001", sku_code: "RM-0001", qty: "100" },
        { menu_code: "MN-001", sku_code: "RM-9999", qty: "5" },
      ],
      ctx,
    );
    expect(summarize(p).toSave).toHaveLength(0);
    expect(p.filter((r) => r.verdict === "error")).toHaveLength(2);
  });
  it("compares quantities at full precision, reads 0.85 as 85%", () => {
    const p = ds("menu-bom").check([{ menu_code: "MN-001", sku_code: "RM-0001", qty: "100.004" }], ctx);
    expect(p[0].verdict).toBe("change");
    const y = ds("menu-bom").check([{ menu_code: "MN-001", sku_code: "RM-0001", qty: "85", yield_pct: "0.85" }], ctx);
    expect(y[0].verdict).toBe("change");
  });
  it("price: VAT-only change is a change, an inactive row doesn't claim to change the price, dates are read day-first", () => {
    const p = ds("prices").check(
      [
        { "SKU Name": "เส้นราเมน", "Supplier Name": "Makro", "Price Per Purchase UOM": "120", VAT: "true" },
        { "SKU Name": "เส้นราเมน", "Supplier Name": "Makro", "Price Per Purchase UOM": "99", Active: "false" },
        { "SKU Name": "ต้นหอม", "Supplier Name": "Makro", "Price Per Purchase UOM": "40", "Effective Date": "5/10/2569" },
        { "SKU Name": "ต้นหอม", "Supplier Name": "Makro", "Price Per Purchase UOM": "40", "Effective Date": "31/02/2026" },
      ],
      ctx,
    );
    expect(p.map((r) => r.verdict)).toEqual(["change", "new", "new", "error"]);
    expect(p[0].detail).toContain("VAT");
    expect(p[1].detail).toContain("ไม่ใช้");
    expect(p[2].rows[0]["Effective Date"]).toBe("2026-10-05");
    expect(isoDate("2026-11-01")).toBe("2026-11-01");
  });
  it("SP: one batch yield per SP, repeated ingredients kept", () => {
    const mixed = ds("sp-bom").check(
      [
        { sp_code: "SP-0001", sku_code: "RM-0001", qty: "1", batch_yield_qty: "10" },
        { sp_code: "SP-0001", sku_code: "RM-0002", qty: "1", batch_yield_qty: "12" },
      ],
      ctx,
    );
    expect(mixed[0].verdict).toBe("error");
    const twice = ds("sp-bom").check(
      [
        { sp_code: "SP-0001", sku_code: "RM-0001", qty: "1", batch_yield_qty: "10" },
        { sp_code: "SP-0001", sku_code: "RM-0001", qty: "2", batch_yield_qty: "10" },
      ],
      ctx,
    );
    expect(twice).toHaveLength(1);
    expect(twice[0].rows).toHaveLength(2);
  });
});

describe("parseCsv", () => {
  it("reads quotes, commas inside quotes and a BOM", () => {
    expect(parseCsv('﻿Name,Note\n"ซอส, ญี่ปุ่น","ว่า ""ดี"""\n\n')).toEqual([{ Name: "ซอส, ญี่ปุ่น", Note: 'ว่า "ดี"', __line: "2" }]);
  });
  it("keeps each row's line number past blank lines", () => {
    expect(parseCsv("Name\nA\n\n,\nB\n").map((r) => r.__line)).toEqual(["2", "5"]);
  });
});
