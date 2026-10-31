import { describe, expect, it } from "vitest";
import type { GoodsReceipt } from "@/types/goods-receipt";
import { billDraftKey, billsOf, checksFor, frequentFor, hasBillDraft, noteWithoutPlace, perUnitText, placeOf, qtyText, stalePrices, supplierRank } from "./goods-receipt";

const r = (o: Partial<GoodsReceipt>): GoodsReceipt => ({
  id: Math.random().toString(),
  receiptDate: "2026-10-23",
  weekNumber: 43,
  skuId: "s1",
  supplierId: "fk",
  quantityReceived: 1000,
  usageUom: "ก.",
  actualTotal: 100,
  actualUnitPrice: 0.1,
  stdUnitPrice: 0.1,
  standardPrice: 100,
  priceVariance: 0,
  note: "",
  ...o,
});

describe("what to show first", () => {
  it("a supplier's products by how often they're bought, with the last buy", () => {
    const list = frequentFor([r({ skuId: "a", receiptDate: "2026-10-01" }), r({ skuId: "b" }), r({ skuId: "a", receiptDate: "2026-10-20", quantityReceived: 5000 }), r({ skuId: "c", supplierId: "other" })], "fk");
    expect(list.map((x) => x.skuId)).toEqual(["a", "b"]);
    expect(list[0].last.qty).toBe(5000);
  });
  it("suppliers by how often", () => expect(supplierRank([r({ supplierId: "x" }), r({}), r({})])).toEqual(["fk", "x"]));
});

describe("bills", () => {
  it("groups by day, supplier and free-text place; flags late entry", () => {
    const bills = billsOf([
      r({ actualTotal: 100, standardPrice: 90, priceVariance: 10, createdAt: "2026-10-23T02:00:00Z" }),
      r({ actualTotal: 50, createdAt: "2026-10-25T02:00:00Z" }),
      r({ note: "[Supplier: ตลาดคลองเตย] สด", actualTotal: 75 }),
    ]);
    expect(bills.length).toBe(2);
    expect(bills[0]).toMatchObject({ place: "", total: 150, variance: 10, late: true });
    expect(bills[1].place).toBe("ตลาดคลองเตย");
  });
  it("reads the place out of the note", () => {
    expect(placeOf("[Supplier: CK] นำหมูที่เคลม")).toBe("CK");
    expect(noteWithoutPlace("[Supplier: CK] นำหมูที่เคลม")).toBe("นำหมูที่เคลม");
  });
});

describe("checks before saving", () => {
  const unit = (_: string, p: number) => perUnitText(p, "ก.");
  const qty = (_: string, q: number) => qtyText(q, "ก.");
  it("price far off, already received today, no amount typed", () => {
    const c = checksFor(
      [
        { key: "1", skuId: "hom", name: "ต้นหอมไทย", qty: 1000, total: 220, stdUnit: 0.1 },
        { key: "2", skuId: "skin", name: "หนังไก่", qty: 20000, total: 1400, stdUnit: 0.064 },
        { key: "3", skuId: "pot", name: "มันฝรั่ง", qty: 1000, total: null, stdUnit: 0.032 },
      ],
      [r({ skuId: "skin", quantityReceived: 20000, createdAt: "2026-10-25T09:12:00" })],
      unit,
      qty,
    );
    expect(c.map((x) => [x.name, x.kind])).toEqual([
      ["ต้นหอมไทย", "price"],
      ["หนังไก่", "again"],
      ["มันฝรั่ง", "nototal"],
    ]);
    expect([c[0].label, c[0].detail]).toEqual(["แพงกว่าปกติ", "฿220/กก. · มาตรฐาน ฿100/กก."]);
    expect(c[1].detail).toBe("20 กก. ตอน 09:12");
  });
  it("a free item at ฿0 is not flagged as cheap", () => {
    expect(checksFor([{ key: "1", skuId: "x", name: "หมูบด", qty: 2000, total: 0, stdUnit: 0.1 }], [], unit, qty)).toEqual([]);
  });
});

describe("standard prices that look old", () => {
  it("paid off by more than 15% on recent receipts", () => {
    const list = stalePrices([
      r({ skuId: "hom", actualTotal: 220, receiptDate: "2026-10-01" }),
      r({ skuId: "hom", actualTotal: 210, receiptDate: "2026-10-10" }),
      r({ skuId: "ok", actualTotal: 101 }),
      r({ skuId: "ok", actualTotal: 99 }),
      r({ skuId: "once", actualTotal: 300 }),
    ]);
    expect(list.map((x) => x.skuId)).toEqual(["hom"]);
    expect(list[0].off).toBeGreaterThan(1);
  });
});

describe("units for people", () => {
  it("per kg / litre / unit", () => {
    expect(perUnitText(0.064, "ก.")).toBe("฿64/กก.");
    expect(perUnitText(1.5, "ใบ")).toBe("฿1.5/ใบ");
    expect(qtyText(20000, "ก.")).toBe("20 กก.");
    expect(qtyText(450, "ก.")).toBe("450 ก.");
  });
});

describe("a bill typed but not saved", () => {
  it("keeps the kitchen receive page on its day (the page follows today otherwise)", () => {
    localStorage.removeItem(billDraftKey("2026-10-31", "fk"));
    expect(hasBillDraft("2026-10-31", "fk")).toBe(false);
    localStorage.setItem(billDraftKey("2026-10-31", "fk"), JSON.stringify({ rows: [{ key: "s1", skuId: "s1", qty: 500, total: null, note: "" }] }));
    expect(hasBillDraft("2026-10-31", "fk")).toBe(true);
    expect(hasBillDraft("2026-11-01", "fk")).toBe(false);
    expect(hasBillDraft("2026-10-31", null)).toBe(false);
    localStorage.removeItem(billDraftKey("2026-10-31", "fk"));
  });
});
