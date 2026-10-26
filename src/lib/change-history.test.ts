import { describe, expect, it } from "vitest";
import { canUndo, describeChange, priceToRestore, undoPlan, type ChangeRow } from "./change-history";

const names = {
  sku: (id: string) => ({ "RM-0027": { name: "ต้นหอมไทย", packUnit: "แพ็ค", usageUom: "ก." }, "RM-0165": { name: "ต้นหอมญี่ปุ่น", packUnit: "แพ็ค", usageUom: "ก." } })[id],
  supplier: (id: string) => ({ fk: "Freshket" })[id],
};
const row = (over: Partial<ChangeRow>): ChangeRow => ({ id: 1, table_name: "skus", row_id: "x", op: "UPDATE", old_row: null, new_row: null, changed_by: null, changed_at: "2026-10-26T03:00:00Z", ...over });

describe("describeChange", () => {
  it("a product's pack size change, with before → after", () => {
    const d = describeChange(row({ old_row: { name: "ต้นหอมไทย", pack_size: 1000, updated_at: "a" }, new_row: { name: "ต้นหอมไทย", pack_size: 500, updated_at: "b" } }), names);
    expect(d.text).toBe("แก้ข้อมูลสินค้า");
    expect(d.details).toEqual([{ label: "1 หน่วยที่ซื้อมีกี่", from: "1,000", to: "500" }]);
    expect(d.undoable).toBe(true);
  });

  it("a new standard price, and a price switched off by it", () => {
    expect(describeChange(row({ table_name: "prices", op: "INSERT", new_row: { sku_id: "RM-0027", supplier_id: "fk", price_per_purchase_uom: 220, is_active: true } }), names).text).toBe("ตั้งราคา Freshket ฿220.00/แพ็ค");
    const off = describeChange(row({ table_name: "prices", old_row: { sku_id: "RM-0027", supplier_id: "fk", price_per_purchase_uom: 100, is_active: true }, new_row: { sku_id: "RM-0027", supplier_id: "fk", price_per_purchase_uom: 100, is_active: false } }), names);
    expect(off.text).toBe("ปิดราคา Freshket ฿100.00");
    expect(off.undoable).toBe(false);
  });

  it("a recipe line's quantity", () => {
    const d = describeChange(row({ table_name: "bom_lines", old_row: { rm_sku_id: "RM-0165", qty_per_batch: 1000, yield_percent: 0.9 }, new_row: { rm_sku_id: "RM-0165", qty_per_batch: 2000, yield_percent: 0.9 } }), names);
    expect(d.details).toEqual([{ label: "ต้นหอมญี่ปุ่น ต่อรอบ", from: "1,000 ก.", to: "2,000 ก." }]);
  });
});

describe("price undo = set the old price again", () => {
  const add = row({ id: 10, table_name: "prices", op: "INSERT", row_id: "p2", new_row: { id: "p2", sku_id: "RM-0027", supplier_id: "fk", price_per_purchase_uom: 220, is_active: true }, changed_at: "2026-10-26T03:00:00Z" });
  const off = row({ id: 11, table_name: "prices", op: "UPDATE", row_id: "p1", old_row: { id: "p1", sku_id: "RM-0027", supplier_id: "fk", price_per_purchase_uom: 100, is_active: true }, new_row: { id: "p1", sku_id: "RM-0027", supplier_id: "fk", price_per_purchase_uom: 100, is_active: false }, changed_at: "2026-10-26T03:00:01Z" });
  it("a new price: back to the one it switched off", () => {
    expect(priceToRestore(add, [off, add])).toEqual({ skuId: "RM-0027", supplierId: "fk", amount: 100, vat: false });
  });
  it("a first price (nothing switched off): nothing to set back to", () => {
    expect(priceToRestore(add, [add]).amount).toBeNull();
  });
  it("only the per-gram price moved (pack size changed): not undoable here", () => {
    const d = describeChange(row({ table_name: "prices", old_row: { sku_id: "RM-0027", supplier_id: "fk", price_per_purchase_uom: 100, price_per_usage_uom: 0.1 }, new_row: { sku_id: "RM-0027", supplier_id: "fk", price_per_purchase_uom: 100, price_per_usage_uom: 0.2 } }), names);
    expect(d.undoable).toBe(false);
  });
});

describe("undo", () => {
  const upd = row({ old_row: { id: "x", pack_size: 1000 }, new_row: { id: "x", pack_size: 500 } });
  it("only while nothing was written on top", () => {
    expect(canUndo(upd, { id: "x", pack_size: 500 })).toEqual({ ok: true });
    expect(canUndo(upd, { id: "x", pack_size: 250 })).toEqual({ ok: false, why: "มีการแก้ทับไปแล้ว" });
    expect(canUndo(upd, null)).toEqual({ ok: false, why: "ถูกลบไปแล้ว" });
  });
  it("puts back exactly the fields that changed", () => {
    expect(undoPlan(upd)).toEqual({ kind: "update", patch: { pack_size: 1000 } });
    expect(undoPlan(row({ op: "INSERT", new_row: { id: "x" } }))).toEqual({ kind: "delete" });
    expect(undoPlan(row({ op: "DELETE", old_row: { id: "x", qty_per_batch: 5 } }))).toEqual({ kind: "insert", values: { id: "x", qty_per_batch: 5 } });
  });
});
