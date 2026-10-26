/**
 * Change history for Cost Center (change_log, filled by a database trigger on product,
 * price, recipe and menu tables): each row described in one plain Thai line, and
 * what undoing it means. Pure, so it is tested; the reads and writes live in
 * change-history-db.ts.
 */

/** The "BOM Calculation" supplier of recipe-cost price rows (bom-price-sync.ts) */
const RECIPE_SUPPLIER_ID = "45cd33bb-82b7-4865-be1e-3c88f085cc72";

export interface ChangeRow {
  id: number;
  table_name: string;
  row_id: string | null;
  op: "INSERT" | "UPDATE" | "DELETE";
  old_row: Record<string, unknown> | null;
  new_row: Record<string, unknown> | null;
  changed_by: string | null;
  changed_at: string;
}

export interface Names {
  sku: (id: string) => { name: string; packUnit: string; usageUom: string } | undefined;
  supplier: (id: string) => string | undefined;
}

export interface Described {
  text: string;
  /** Field-level changes "before → after" (shown under the line) */
  details: { label: string; from: string; to: string }[];
  /** Can be put back with one tap (else why not) */
  undoable: boolean;
}

const SKU_FIELDS: Record<string, string> = {
  name: "ชื่อ",
  category: "หมวด",
  status: "สถานะ",
  storage_condition: "ช่องเก็บ",
  pack_size: "1 หน่วยที่ซื้อมีกี่",
  pack_unit: "หน่วยที่ซื้อ",
  purchase_uom: "หน่วยในบิล",
  usage_uom: "หน่วยในสูตร",
  converter: "ตัวแปลง",
  shelf_life: "อายุ (วัน)",
  lead_time: "สั่งล่วงหน้า (วัน)",
  is_distributable: "ส่งให้สาขาได้",
  vat: "VAT",
  spec_note: "หมายเหตุสเปก",
};
const STATUS: Record<string, string> = { Active: "เปิดใช้", Inactive: "ปิดใช้", Draft: "ร่าง" };
const STORAGE: Record<string, string> = { Frozen: "ช่องแช่แข็ง", Chilled: "ตู้เย็น", Ambient: "ของแห้ง" };

const fmt = (v: unknown, field?: string): string => {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "ใช่" : "ไม่";
  if (field === "status") return STATUS[String(v)] ?? String(v);
  if (field === "storage_condition") return STORAGE[String(v)] ?? String(v);
  if (typeof v === "number") return v.toLocaleString("th-TH", { maximumFractionDigits: 4 });
  return String(v);
};
const baht = (v: unknown) => `฿${Number(v ?? 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (v: unknown) => `${Math.round(Number(v ?? 0) * 1000) / 10}%`;

/** Fields that differ, ignoring bookkeeping columns */
export function changedFields(row: ChangeRow): string[] {
  if (row.op !== "UPDATE" || !row.old_row || !row.new_row) return [];
  const quiet = new Set(["updated_at", "created_at", "cost_per_serving", "cost_per_unit"]);
  return Object.keys(row.new_row).filter((k) => !quiet.has(k) && JSON.stringify(row.old_row![k]) !== JSON.stringify(row.new_row![k]));
}

export function describeChange(row: ChangeRow, names: Names): Described {
  const r = (row.new_row ?? row.old_row ?? {}) as Record<string, unknown>;
  const fields = changedFields(row);
  const skuName = (id: unknown) => names.sku(String(id ?? ""))?.name ?? "—";
  const supplier = (id: unknown) => names.supplier(String(id ?? "")) ?? "—";
  const unitOf = (id: unknown) => names.sku(String(id ?? ""));

  switch (row.table_name) {
    case "skus":
      if (row.op === "INSERT") return { text: `สร้างสินค้า ${fmt(r.name)}`, details: [], undoable: false };
      if (row.op === "DELETE") return { text: `ลบสินค้า ${fmt(r.name)}`, details: [], undoable: false };
      return {
        text: fields.length === 1 && fields[0] === "status" ? `${fmt(row.new_row!.status, "status")}` : "แก้ข้อมูลสินค้า",
        details: fields.filter((f) => SKU_FIELDS[f]).map((f) => ({ label: SKU_FIELDS[f], from: fmt(row.old_row![f], f), to: fmt(row.new_row![f], f) })),
        undoable: fields.some((f) => SKU_FIELDS[f]),
      };
    case "prices": {
      // Recipe costs are worked out by the system (and again after any undo): nothing to put back
      if (r.supplier_id === RECIPE_SUPPLIER_ID) return { text: "ต้นทุนจากสูตรคิดใหม่", details: [], undoable: false };
      // Price undo = set that supplier's price back to the old amount through the
      // normal save (one active per supplier, per-gram price from today's pack size)
      const pack = unitOf(r.sku_id)?.packUnit || "หน่วย";
      if (row.op === "INSERT") return { text: `ตั้งราคา ${supplier(r.supplier_id)} ${baht(r.price_per_purchase_uom)}/${pack}`, details: [], undoable: !!row.new_row?.is_active };
      // A deleted price comes back only if it was a live one
      if (row.op === "DELETE") return { text: `ลบราคา ${supplier(r.supplier_id)} ${baht(r.price_per_purchase_uom)}/${pack}`, details: [], undoable: !!row.old_row?.is_active };
      if (!fields.includes("price_per_purchase_uom")) {
        if (fields.includes("is_active")) return { text: `${row.new_row!.is_active ? "เปิด" : "ปิด"}ราคา ${supplier(r.supplier_id)} ${baht(r.price_per_purchase_uom)}`, details: [], undoable: false };
        // Only the per-gram price moved: the pack size changed (undo that instead)
        if (fields.length === 1 && fields[0] === "price_per_usage_uom") return { text: `คิดราคาต่อหน่วยใหม่ ${supplier(r.supplier_id)} (หน่วยเปลี่ยน)`, details: [], undoable: false };
        return { text: `แก้รายละเอียดราคา ${supplier(r.supplier_id)}`, details: [], undoable: false };
      }
      return {
        text: `แก้ราคา ${supplier(r.supplier_id)}`,
        details: [{ label: `ราคา/${pack}`, from: baht(row.old_row!.price_per_purchase_uom), to: baht(row.new_row!.price_per_purchase_uom) }],
        // Moved to another item/supplier or switched on in the same edit: too tangled to put back in one tap
        undoable: !fields.some((f) => f === "supplier_id" || f === "sku_id" || f === "is_active"),
      };
    }
    case "bom_lines": {
      const ing = skuName(r.rm_sku_id);
      const uom = unitOf(r.rm_sku_id)?.usageUom ?? "";
      if (row.op === "INSERT") return { text: `เพิ่ม ${ing} ${fmt(r.qty_per_batch)} ${uom} ในสูตร`, details: [], undoable: true };
      if (row.op === "DELETE") return { text: `เอา ${ing} ออกจากสูตร`, details: [], undoable: true };
      const details = [
        ...(fields.includes("qty_per_batch") ? [{ label: `${ing} ต่อรอบ`, from: `${fmt(row.old_row!.qty_per_batch)} ${uom}`, to: `${fmt(row.new_row!.qty_per_batch)} ${uom}` }] : []),
        ...(fields.includes("yield_percent") ? [{ label: `${ing} ใช้ได้จริง`, from: pct(row.old_row!.yield_percent), to: pct(row.new_row!.yield_percent) }] : []),
        ...(fields.includes("rm_sku_id") ? [{ label: "วัตถุดิบ", from: skuName(row.old_row!.rm_sku_id), to: skuName(row.new_row!.rm_sku_id) }] : []),
      ];
      return { text: "แก้สูตร", details, undoable: details.length > 0 };
    }
    case "bom_headers": {
      if (row.op !== "UPDATE") return { text: row.op === "INSERT" ? "เริ่มทำสูตร" : "ลบสูตรทั้งสูตร", details: [], undoable: false };
      const details = [
        ...(fields.includes("batch_size") ? [{ label: "ผลิตรอบละ", from: fmt(row.old_row!.batch_size), to: fmt(row.new_row!.batch_size) }] : []),
        ...(fields.includes("yield_percent") ? [{ label: "ได้จริง", from: pct(row.old_row!.yield_percent), to: pct(row.new_row!.yield_percent) }] : []),
      ];
      return { text: "แก้สูตร", details, undoable: details.length > 0 };
    }
    case "sp_bom": {
      const ing = skuName(r.ingredient_sku_id);
      const uom = unitOf(r.ingredient_sku_id)?.usageUom ?? "";
      if (row.op === "INSERT") return { text: `เพิ่ม ${ing} ${fmt(r.qty_per_batch)} ${uom} ในสูตร`, details: [], undoable: true };
      if (row.op === "DELETE") return { text: `เอา ${ing} ออกจากสูตร`, details: [], undoable: true };
      const qty = fields.includes("qty_per_batch") ? [{ label: `${ing} ต่อรอบ`, from: `${fmt(row.old_row!.qty_per_batch)} ${uom}`, to: `${fmt(row.new_row!.qty_per_batch)} ${uom}` }] : [];
      const batch = fields.includes("batch_yield_qty") ? [{ label: "ทำรอบละ", from: fmt(row.old_row!.batch_yield_qty), to: fmt(row.new_row!.batch_yield_qty) }] : [];
      // "ทำรอบละ" is written on every line of the recipe: putting back one line would
      // split it, so that one is retyped in the recipe instead
      return { text: "แก้สูตร", details: [...qty, ...batch], undoable: qty.length > 0 && !batch.length };
    }
    default:
      return { text: `แก้ ${row.table_name}`, details: [], undoable: false };
  }
}

/**
 * Whether undoing is still safe: the row must still look exactly as this change left
 * it (nothing written on top since). `current` = the row as it is now (null = gone).
 */
export function canUndo(row: ChangeRow, current: Record<string, unknown> | null): { ok: boolean; why?: string } {
  if (row.op === "INSERT") return current ? { ok: true } : { ok: false, why: "ถูกลบไปแล้ว" };
  if (row.op === "DELETE") return current ? { ok: false, why: "มีอยู่แล้ว" } : { ok: true };
  if (!current) return { ok: false, why: "ถูกลบไปแล้ว" };
  const moved = changedFields(row).filter((f) => JSON.stringify(current[f]) !== JSON.stringify(row.new_row![f]));
  return moved.length ? { ok: false, why: "มีการแก้ทับไปแล้ว" } : { ok: true };
}

/** Product fields an undo may put back (not its code or bookkeeping) */
const UNDO_SKU_FIELDS = new Set(Object.keys(SKU_FIELDS));

/** The write that puts a change back: what to update, delete or re-insert (prices are handled as "set the old price") */
export function undoPlan(row: ChangeRow): { kind: "update"; patch: Record<string, unknown> } | { kind: "delete" } | { kind: "insert"; values: Record<string, unknown> } {
  if (row.op === "INSERT") return { kind: "delete" };
  if (row.op === "DELETE") return { kind: "insert", values: row.old_row! };
  const fields = changedFields(row).filter((f) => row.table_name !== "skus" || UNDO_SKU_FIELDS.has(f));
  return { kind: "update", patch: Object.fromEntries(fields.map((f) => [f, row.old_row![f]])) };
}

/**
 * For a price change: the price that supplier should have again. INSERT → the one the
 * new price switched off in the same save (none = the supplier had no price before);
 * UPDATE → its old amount; DELETE → the deleted amount.
 */
export function priceToRestore(row: ChangeRow, history: ChangeRow[]): { skuId: string; supplierId: string; amount: number | null; vat: boolean } {
  const r = (row.new_row ?? row.old_row ?? {}) as Record<string, unknown>;
  const base = { skuId: String(r.sku_id), supplierId: String(r.supplier_id) };
  if (row.op === "UPDATE" || row.op === "DELETE") return { ...base, amount: Number(row.old_row!.price_per_purchase_uom), vat: !!row.old_row!.vat };
  const at = Date.parse(row.changed_at);
  const off = history.find(
    (h) =>
      h.table_name === "prices" &&
      h.op === "UPDATE" &&
      h.id > row.id &&
      h.old_row?.is_active === true &&
      h.new_row?.is_active === false &&
      h.new_row?.sku_id === r.sku_id &&
      h.new_row?.supplier_id === r.supplier_id &&
      Date.parse(h.changed_at) - at < 10000,
  );
  return { ...base, amount: off ? Number(off.old_row!.price_per_purchase_uom) : null, vat: !!(off ?? row).new_row?.vat };
}
