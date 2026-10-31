/**
 * The six things that can be added in bulk from a file (Cost Center › นำเข้า/ส่งออก
 * ไฟล์), each with its columns, an example row, today's data in those columns, and
 * a check that sorts every row before anything is saved: new · changed (with the
 * old and new value) · same as now · skipped · a problem. The rules are the old
 * import pages' rules (which replaced the pages): products, suppliers and menus
 * are only added, never overwritten; a price row adds that price; a recipe file
 * replaces the whole recipe of each menu / SP it lists.
 */
import type { SKU } from "@/types/sku";
import type { Supplier } from "@/types/supplier";
import type { Price } from "@/types/price";
import type { Menu } from "@/types/menu";
import type { MenuBomLine } from "@/types/menu-bom";
import type { SpBomLine } from "@/types/sp-bom";
import { LINE, type FileRow } from "./import-file";

export type DatasetKey = "skus" | "suppliers" | "prices" | "menus" | "menu-bom" | "sp-bom";
export type Verdict = "new" | "change" | "same" | "skip" | "error";

export interface PreviewRow {
  /** Line in the file (the header is line 1) */
  line: number;
  verdict: Verdict;
  title: string;
  /** Why (skip / problem) or what changes */
  detail?: string;
  was?: string;
  now?: string;
  /** Rows to save for this entry (a recipe entry carries all its lines) */
  rows: FileRow[];
}

export interface ImportContext {
  skus: SKU[];
  suppliers: Supplier[];
  prices: Price[];
  menus: Menu[];
  menuBomLines: MenuBomLine[];
  spLines: SpBomLine[];
  /** Brands of the branches (a menu's brand must be one) */
  brands: string[];
}

export interface Column {
  name: string;
  required?: boolean;
  /** What goes in it, in Thai */
  hint: string;
}

export interface Dataset {
  key: DatasetKey;
  label: string;
  unit: string;
  columns: Column[];
  example: FileRow;
  /** Extra columns in an export only, for reading (an import ignores them) */
  exportOnly?: string[];
  /** Today's data in the file's columns */
  current: (ctx: ImportContext) => FileRow[];
  check: (rows: FileRow[], ctx: ImportContext) => PreviewRow[];
}

/** The row's line in the file (rows read from a file carry it; others count from 2) */
const lineOf = (r: FileRow, i: number) => Number(r[LINE]) || i + 2;
const low = (s: string | undefined) => (s ?? "").trim().toLowerCase();
const num = (s: string | undefined) => Number(String(s ?? "").replace(/[,%]/g, "").trim());
/** Same number at full precision (0.012 vs 0.014 kg is a change) */
const eq = (a: number, b: number) => Math.abs(a - b) < 1e-9;
/**
 * A date as YYYY-MM-DD, from YYYY-MM-DD or Thai day-first D/M/YYYY (Buddhist years
 * too); null when it can't be read. Blank stays blank (= today).
 */
export function isoDate(s: string | undefined): string | null | "" {
  const t = (s ?? "").trim();
  if (!t) return "";
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  let y: number, mo: number, d: number;
  if (m) [y, mo, d] = [+m[1], +m[2], +m[3]];
  else if ((m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/))) [d, mo, y] = [+m[1], +m[2], +m[3]];
  else return null;
  if (y > 2400) y -= 543;
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
const n2 = (v: number) => (Math.round(v * 100) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });
const bad = (line: number, title: string, detail: string): PreviewRow => ({ line, verdict: "error", title, detail, rows: [] });

const SKU_TYPES = ["RM", "SM", "SP", "PK"];
const STORAGE = ["Frozen", "Chilled", "Ambient"];

const skus: Dataset = {
  key: "skus",
  label: "สินค้า",
  unit: "ตัว",
  columns: [
    { name: "Name", required: true, hint: "ชื่อสินค้า (ชื่อซ้ำกับที่มีจะข้าม)" },
    { name: "Type", required: true, hint: "RM · SM · SP · PK" },
    { name: "Category", required: true, hint: "รหัสหมวด เช่น MT (ไม่มีจะสร้างให้)" },
    { name: "Status", hint: "Active หรือ Inactive" },
    { name: "Spec Note", hint: "รายละเอียด" },
    { name: "Pack Size", hint: "ขนาดแพ็ค (ตัวเลข)" },
    { name: "Pack Unit", hint: "หน่วยแพ็ค" },
    { name: "Purchase UOM", hint: "หน่วยตอนซื้อ" },
    { name: "Usage UOM", hint: "หน่วยตอนใช้ เช่น g" },
    { name: "Converter", hint: "ตัวแปลงหน่วย (ตัวเลข)" },
    { name: "Storage Condition", hint: "Frozen · Chilled · Ambient" },
    { name: "Shelf Life", hint: "อายุ (วัน)" },
    { name: "VAT", hint: "true หรือ false" },
    { name: "Lead Time", hint: "วันรอของ" },
  ],
  example: { Name: "ตัวอย่าง เส้นราเมน", Type: "RM", Category: "DG", Status: "Active", "Pack Size": "1000", "Pack Unit": "แพ็ค", "Purchase UOM": "แพ็ค", "Usage UOM": "g", Converter: "1", "Storage Condition": "Chilled" },
  current: ({ skus }) =>
    skus.map((s) => ({
      Name: s.name,
      Type: s.type,
      Category: s.category,
      Status: s.status,
      "Spec Note": s.specNote ?? "",
      "Pack Size": String(s.packSize ?? ""),
      "Pack Unit": s.packUnit ?? "",
      "Purchase UOM": s.purchaseUom ?? "",
      "Usage UOM": s.usageUom ?? "",
      Converter: String(s.converter ?? ""),
      "Storage Condition": s.storageCondition ?? "",
      "Shelf Life": String(s.shelfLife ?? ""),
      VAT: s.vat ? "true" : "false",
      "Lead Time": String(s.leadTime ?? ""),
    })),
  check: (rows, { skus }) => {
    const have = new Set(skus.map((s) => low(s.name)));
    const seen = new Set<string>();
    return rows.map((r, i) => {
      const line = lineOf(r, i);
      const name = r["Name"]?.trim();
      const type = r["Type"]?.trim().toUpperCase();
      if (!name) return bad(line, "(ไม่มีชื่อ)", "ไม่มีชื่อสินค้า");
      if (!SKU_TYPES.includes(type)) return bad(line, name, `Type ต้องเป็น ${SKU_TYPES.join(" / ")}`);
      const storage = r["Storage Condition"]?.trim();
      if (storage && !STORAGE.includes(storage)) return bad(line, name, `Storage Condition ต้องเป็น ${STORAGE.join(" / ")}`);
      if (have.has(low(name))) return { line, verdict: "skip", title: name, detail: "มีสินค้าชื่อนี้แล้ว (ไฟล์ไม่แก้ของเดิม แก้ที่หน้าสินค้า)", rows: [] };
      if (seen.has(low(name))) return { line, verdict: "skip", title: name, detail: "ชื่อซ้ำในไฟล์", rows: [] };
      seen.add(low(name));
      return { line, verdict: "new", title: name, detail: `${type} · ${r["Category"]?.trim().toUpperCase() || "MT"}`, rows: [r] };
    });
  },
};

const suppliers: Dataset = {
  key: "suppliers",
  label: "ซัพพลายเออร์",
  unit: "ราย",
  columns: [
    { name: "Name", required: true, hint: "ชื่อซัพ (ชื่อซ้ำกับที่มีจะข้าม)" },
    { name: "Lead Time", hint: "วันรอของ" },
    { name: "MOQ", hint: "สั่งขั้นต่ำ (ตัวเลข)" },
    { name: "MOQ Unit", hint: "หน่วยสั่งขั้นต่ำ" },
    { name: "Contact Person", hint: "คนติดต่อ" },
    { name: "Phone", hint: "เบอร์" },
    { name: "Credit Terms", hint: "เครดิต" },
    { name: "Status", hint: "Active หรือ Inactive" },
  ],
  example: { Name: "ตัวอย่าง ซัพผัก", "Lead Time": "1", Status: "Active" },
  current: ({ suppliers }) =>
    suppliers.map((s) => ({
      Name: s.name,
      "Lead Time": String(s.leadTime ?? ""),
      MOQ: String(s.moq ?? ""),
      "MOQ Unit": s.moqUnit ?? "",
      "Contact Person": s.contactPerson ?? "",
      Phone: s.phone ?? "",
      "Credit Terms": s.creditTerms ?? "",
      Status: s.status,
    })),
  check: (rows, { suppliers }) => {
    const have = new Set(suppliers.map((s) => low(s.name)));
    const seen = new Set<string>();
    return rows.map((r, i) => {
      const line = lineOf(r, i);
      const name = r["Name"]?.trim();
      if (!name) return bad(line, "(ไม่มีชื่อ)", "ไม่มีชื่อซัพ");
      if (have.has(low(name))) return { line, verdict: "skip", title: name, detail: "มีซัพชื่อนี้แล้ว (ไฟล์ไม่แก้ของเดิม)", rows: [] };
      if (seen.has(low(name))) return { line, verdict: "skip", title: name, detail: "ชื่อซ้ำในไฟล์", rows: [] };
      seen.add(low(name));
      return { line, verdict: "new", title: name, rows: [r] };
    });
  },
};

const prices: Dataset = {
  key: "prices",
  label: "ราคา",
  unit: "ราคา",
  columns: [
    { name: "SKU Name", required: true, hint: "ชื่อสินค้า ตรงกับในระบบ" },
    { name: "Supplier Name", required: true, hint: "ชื่อซัพ ตรงกับในระบบ" },
    { name: "Price Per Purchase UOM", required: true, hint: "ราคาต่อหน่วยตอนซื้อ" },
    { name: "VAT", hint: "true หรือ false" },
    { name: "Active", hint: "false = เก็บไว้เฉย ๆ ไม่ใช้" },
    { name: "Effective Date", hint: "วันที่เริ่มใช้ (YYYY-MM-DD) ว่าง = วันนี้" },
    { name: "Note", hint: "หมายเหตุ" },
  ],
  example: { "SKU Name": "ตัวอย่าง เส้นราเมน", "Supplier Name": "ตัวอย่าง ซัพผัก", "Price Per Purchase UOM": "120", VAT: "false", Active: "true" },
  // What the old price list export had besides the import columns
  exportOnly: ["SKU Code", "Type", "Purchase UOM", "Pack Size", "Usage UOM", "Price Per Usage UOM"],
  current: ({ prices, skus, suppliers }) =>
    prices
      .filter((p) => p.isActive)
      .map((p) => {
        const sku = skus.find((s) => s.id === p.skuId);
        return {
        "SKU Code": sku?.skuId ?? "",
        Type: sku?.type ?? "",
        "Purchase UOM": sku?.purchaseUom ?? "",
        "Pack Size": String(sku?.packSize ?? ""),
        "Usage UOM": sku?.usageUom ?? "",
        "Price Per Usage UOM": String(p.pricePerUsageUom ?? ""),
        "SKU Name": sku?.name ?? "",
        "Supplier Name": suppliers.find((s) => s.id === p.supplierId)?.name ?? "",
        "Price Per Purchase UOM": String(p.pricePerPurchaseUom),
        VAT: p.vat ? "true" : "false",
        Active: "true",
        "Effective Date": p.effectiveDate ?? "",
        Note: p.note ?? "",
        };
      })
      .filter((r) => r["SKU Name"] && r["Supplier Name"])
      .sort((a, b) => a["SKU Code"].localeCompare(b["SKU Code"])),
  check: (rows, { skus, suppliers, prices }) =>
    rows.map((r, i) => {
      const line = lineOf(r, i);
      const skuName = r["SKU Name"]?.trim();
      const supName = r["Supplier Name"]?.trim();
      const price = num(r["Price Per Purchase UOM"]);
      const title = `${skuName || "(ไม่มีชื่อสินค้า)"} · ${supName || "(ไม่มีซัพ)"}`;
      if (!skuName) return bad(line, title, "ไม่มีชื่อสินค้า");
      if (!supName) return bad(line, title, "ไม่มีชื่อซัพ");
      if (!(price > 0)) return bad(line, title, "ราคาต้องเป็นตัวเลขมากกว่า 0");
      const sku = skus.find((s) => low(s.name) === low(skuName));
      if (!sku) return bad(line, title, `ไม่มีสินค้าชื่อ "${skuName}" ในระบบ`);
      const sup = suppliers.find((s) => low(s.name) === low(supName));
      if (!sup) return bad(line, title, `ไม่มีซัพชื่อ "${supName}" ในระบบ`);
      // Recipe-made items get their price from the recipe, never from a file
      if (sku.type === "SM" || sku.type === "SP") return { line, verdict: "skip", title, detail: "ของที่ทำเอง ราคามาจากสูตร", rows: [] };
      const date = isoDate(r["Effective Date"]);
      if (date === null) return bad(line, title, `วันที่ "${r["Effective Date"]}" อ่านไม่ได้ · ใช้ 2026-11-01 หรือ 1/11/2026`);
      const fixed = date ? { ...r, "Effective Date": date } : r;
      const active = low(r["Active"]) !== "false" && r["Active"]?.trim() !== "0";
      const vat = low(r["VAT"]) === "true" || r["VAT"]?.trim() === "1";
      // Kept on file only: the price in use doesn't change
      if (!active) return { line, verdict: "new", title, now: `฿${n2(price)}`, detail: "เก็บไว้ ไม่ใช้ (Active = false) · ราคาที่ใช้อยู่ไม่เปลี่ยน", rows: [fixed] };
      const now = prices.find((p) => p.skuId === sku.id && p.supplierId === sup.id && p.isActive);
      if (!now) return { line, verdict: "new", title, now: `฿${n2(price)}`, rows: [fixed] };
      const what = [
        !eq(now.pricePerPurchaseUom, price) && "ราคา",
        !!now.vat !== vat && "VAT",
        date && date !== (now.effectiveDate ?? "") && "วันที่เริ่มใช้",
        (r["Note"]?.trim() ?? "") !== (now.note ?? "") && "หมายเหตุ",
      ].filter(Boolean) as string[];
      if (!what.length) return { line, verdict: "same", title, was: `฿${n2(price)}`, rows: [] };
      return { line, verdict: "change", title, was: `฿${n2(now.pricePerPurchaseUom)}`, now: `฿${n2(price)}`, detail: `เปลี่ยน ${what.join(" · ")}`, rows: [fixed] };
    }),
};

const menus: Dataset = {
  key: "menus",
  label: "เมนู",
  unit: "เมนู",
  columns: [
    { name: "menu_code", required: true, hint: "รหัสเมนู เช่น MN-099 (รหัสที่มีแล้วจะข้าม)" },
    { name: "menu_name", required: true, hint: "ชื่อเมนู" },
    { name: "category", hint: "หมวดเมนู (ไม่มีจะสร้างให้)" },
    { name: "selling_price", required: true, hint: "ราคาขาย" },
    { name: "status", hint: "Active หรือ Inactive" },
    { name: "brand_name", required: true, hint: "แบรนด์ ตรงกับของสาขา" },
  ],
  example: { menu_code: "MN-999", menu_name: "ตัวอย่าง ราเมน", category: "Ramen", selling_price: "259", status: "Active", brand_name: "Sendo" },
  current: ({ menus }) =>
    menus.map((m) => ({ menu_code: m.menuCode, menu_name: m.menuName, category: m.category ?? "", selling_price: String(m.sellingPrice ?? ""), status: m.status, brand_name: m.brandName ?? "" })),
  check: (rows, { menus, brands }) => {
    const have = new Set(menus.map((m) => low(m.menuCode)));
    const brandSet = new Set(brands.map(low));
    const seen = new Set<string>();
    return rows.map((r, i) => {
      const line = lineOf(r, i);
      const code = r["menu_code"]?.trim();
      const name = r["menu_name"]?.trim();
      const title = `${code || "(ไม่มีรหัส)"} ${name ?? ""}`.trim();
      const status = low(r["status"]);
      if (!code) return bad(line, title, "ไม่มีรหัสเมนู");
      if (!name) return bad(line, title, "ไม่มีชื่อเมนู");
      if (!r["selling_price"]?.trim() || isNaN(num(r["selling_price"]))) return bad(line, title, "ราคาขายต้องเป็นตัวเลข");
      if (!r["brand_name"]?.trim()) return bad(line, title, "ไม่มีแบรนด์");
      if (!brandSet.has(low(r["brand_name"]))) return bad(line, title, `ไม่มีแบรนด์ "${r["brand_name"].trim()}" ในสาขาไหน`);
      if (status && status !== "active" && status !== "inactive") return bad(line, title, "status ต้องเป็น Active หรือ Inactive");
      if (have.has(low(code))) return { line, verdict: "skip", title, detail: "มีรหัสเมนูนี้แล้ว (ไฟล์ไม่แก้ของเดิม)", rows: [] };
      if (seen.has(low(code))) return bad(line, title, "รหัสซ้ำในไฟล์");
      seen.add(low(code));
      return { line, verdict: "new", title, detail: `฿${n2(num(r["selling_price"]))} · ${r["brand_name"].trim()}`, rows: [r] };
    });
  },
};

/** A number as a comparison key, at full precision (0.012 and 0.014 kg differ) */
const k = (v: number) => String(+v);

/**
 * A recipe file: lines grouped per menu / SP, each group replaces that whole
 * recipe. A group with any problem line is not saved at all (saving it would drop
 * that ingredient from the recipe without saying so).
 */
function recipeCheck(
  rows: FileRow[],
  opts: {
    ownerCol: string;
    findOwner: (code: string) => { id: string; title: string; ok: boolean; why?: string };
    before: (ownerId: string) => { count: number; sig: string };
    lineSig: (r: FileRow) => string;
    validate: (r: FileRow) => string | null;
    /** Menu recipes keep one line per ingredient; SP recipes keep every line as the old import did */
    mergeDuplicates: boolean;
    /** Whole-group check (an SP's batch yield must be one number) */
    groupProblem?: (rows: FileRow[]) => string | null;
  },
): PreviewRow[] {
  const out: PreviewRow[] = [];
  const groups = new Map<string, { line: number; title: string; id: string; rows: FileRow[]; seen: Set<string>; problems: number }>();
  const groupOf = (id: string, title: string, line: number) => {
    const g = groups.get(id) ?? { line, title, id, rows: [], seen: new Set<string>(), problems: 0 };
    groups.set(id, g);
    return g;
  };
  rows.forEach((r, i) => {
    const line = lineOf(r, i);
    const code = r[opts.ownerCol]?.trim();
    if (!code) return out.push(bad(line, "(ไม่มีรหัส)", `ไม่มี ${opts.ownerCol}`));
    const owner = opts.findOwner(code);
    if (!owner.ok) return out.push(bad(line, code, owner.why ?? `ไม่มี "${code}" ในระบบ`));
    const g = groupOf(owner.id, owner.title, line);
    const why = opts.validate(r);
    if (why) {
      g.problems++;
      return out.push(bad(line, `${owner.title} · ${r["sku_code"] ?? ""}`, why));
    }
    const key = low(r["sku_code"]);
    if (opts.mergeDuplicates && g.seen.has(key)) return out.push({ line, verdict: "skip", title: `${owner.title} · ${r["sku_code"]}`, detail: "วัตถุดิบซ้ำในสูตรเดียวกัน ใช้แถวแรก", rows: [] });
    g.seen.add(key);
    g.rows.push(r);
  });
  for (const g of groups.values()) {
    const whole = g.rows.length && opts.groupProblem ? opts.groupProblem(g.rows) : null;
    if (g.problems || whole || !g.rows.length) {
      out.push(bad(g.line, g.title, whole ?? `สูตรนี้ยังไม่บันทึก · มีแถวที่มีปัญหา ${g.problems} แถว แก้แล้วนำเข้าอีกครั้ง (บันทึกไปจะเสียวัตถุดิบตัวนั้นจากสูตร)`));
      continue;
    }
    const was = opts.before(g.id);
    const now = g.rows.map(opts.lineSig).sort().join("|");
    const verdict: Verdict = !was.count ? "new" : was.sig === now ? "same" : "change";
    out.push({ line: g.line, verdict, title: g.title, was: was.count ? `${was.count} วัตถุดิบ` : undefined, now: `${g.rows.length} วัตถุดิบ`, detail: verdict === "change" ? "แทนสูตรเดิมทั้งสูตร" : undefined, rows: verdict === "same" ? [] : g.rows });
  }
  return out.sort((a, b) => a.line - b.line);
}

/** yield_pct as a percent: blank = 100; an Excel % cell arrives as 0.85 (no real yield is 1% or less) */
export const yieldOf = (r: FileRow) => {
  if (!r["yield_pct"]?.trim()) return 100;
  const y = num(r["yield_pct"]);
  return y > 0 && y <= 1 ? y * 100 : y;
};
const skuProblem = (r: FileRow, skusList: SKU[]): string | null => {
  const code = r["sku_code"]?.trim();
  if (!code) return "ไม่มี sku_code";
  if (!skusList.some((s) => low(s.skuId) === low(code))) return `ไม่มีสินค้ารหัส "${code}"`;
  if (!(num(r["qty"]) > 0)) return "qty ต้องเป็นตัวเลขมากกว่า 0";
  return null;
};

const menuBom: Dataset = {
  key: "menu-bom",
  label: "สูตรเมนู",
  unit: "บรรทัด",
  columns: [
    { name: "menu_code", required: true, hint: "รหัสเมนู (เมนูที่อยู่ในไฟล์ แทนสูตรเดิมทั้งสูตร)" },
    { name: "sku_code", required: true, hint: "รหัสวัตถุดิบ เช่น RM-0027" },
    { name: "qty", required: true, hint: "ปริมาณต่อจาน" },
    { name: "yield_pct", hint: "% ได้จริง ว่าง = 100" },
  ],
  example: { menu_code: "MN-999", sku_code: "RM-0027", qty: "15", yield_pct: "100" },
  current: ({ menuBomLines, menus, skus }) =>
    menuBomLines
      .filter((l) => !l.branchId)
      .map((l) => ({ menu_code: menus.find((m) => m.id === l.menuId)?.menuCode ?? "", sku_code: skus.find((s) => s.id === l.skuId)?.skuId ?? "", qty: String(l.qtyPerServing), yield_pct: String(l.yieldPct ?? 100) }))
      .filter((r) => r.menu_code && r.sku_code)
      .sort((a, b) => a.menu_code.localeCompare(b.menu_code)),
  check: (rows, { menus, menuBomLines, skus }) =>
    recipeCheck(rows, {
      ownerCol: "menu_code",
      findOwner: (code) => {
        const m = menus.find((x) => low(x.menuCode) === low(code));
        return m ? { id: m.id, title: `${m.menuCode} ${m.menuName}`, ok: true } : { id: "", title: code, ok: false, why: `ไม่มีเมนูรหัส "${code}"` };
      },
      before: (id) => {
        // Only the shared recipe is replaced; a branch's own lines stay
        const own = menuBomLines.filter((l) => l.menuId === id && !l.branchId);
        return { count: own.length, sig: own.map((l) => `${low(skus.find((s) => s.id === l.skuId)?.skuId)}:${k(l.qtyPerServing)}:${k(l.yieldPct ?? 100)}`).sort().join("|") };
      },
      lineSig: (r) => `${low(r["sku_code"])}:${k(num(r["qty"]))}:${k(yieldOf(r))}`,
      validate: (r) => {
        const y = yieldOf(r);
        return skuProblem(r, skus) ?? (!(y > 0 && y <= 100) ? "yield_pct ต้องอยู่ระหว่าง 0 ถึง 100" : null);
      },
      mergeDuplicates: true,
    }),
};

const spBom: Dataset = {
  key: "sp-bom",
  label: "สูตร SP",
  unit: "บรรทัด",
  columns: [
    { name: "sp_code", required: true, hint: "รหัส SP (SP ที่อยู่ในไฟล์ แทนสูตรเดิมทั้งสูตร)" },
    { name: "sku_code", required: true, hint: "รหัสวัตถุดิบ" },
    { name: "qty", required: true, hint: "ปริมาณต่อรอบ" },
    { name: "yield_pct", hint: "ไม่ใช้ (เก็บไว้ให้ไฟล์เก่าเปิดได้)" },
    { name: "batch_yield_qty", required: true, hint: "ทำรอบหนึ่งได้เท่าไร (ทุกแถวของ SP เดียวกันใส่เท่ากัน)" },
  ],
  example: { sp_code: "SP-0001", sku_code: "RM-0017", qty: "500", yield_pct: "100", batch_yield_qty: "1000" },
  current: ({ spLines, skus }) =>
    spLines
      .map((l) => ({ sp_code: skus.find((s) => s.id === l.spSkuId)?.skuId ?? "", sku_code: skus.find((s) => s.id === l.ingredientSkuId)?.skuId ?? "", qty: String(l.qtyPerBatch), yield_pct: "100", batch_yield_qty: String(l.batchYieldQty) }))
      .filter((r) => r.sp_code && r.sku_code)
      .sort((a, b) => a.sp_code.localeCompare(b.sp_code)),
  check: (rows, { spLines, skus }) =>
    recipeCheck(rows, {
      ownerCol: "sp_code",
      findOwner: (code) => {
        const s = skus.find((x) => low(x.skuId) === low(code));
        if (!s || s.type !== "SP") return { id: "", title: code, ok: false, why: `ไม่มี SP รหัส "${code}"` };
        return { id: s.id, title: `${s.skuId} ${s.name}`, ok: true };
      },
      before: (id) => {
        const own = spLines.filter((l) => l.spSkuId === id);
        return { count: own.length, sig: own.map((l) => `${low(skus.find((s) => s.id === l.ingredientSkuId)?.skuId)}:${k(l.qtyPerBatch)}:${k(l.batchYieldQty)}`).sort().join("|") };
      },
      // An SP line keeps the quantity as written; yield_pct isn't used (the old import did the same)
      lineSig: (r) => `${low(r["sku_code"])}:${k(num(r["qty"]))}:${k(num(r["batch_yield_qty"]))}`,
      validate: (r) => skuProblem(r, skus) ?? (!(num(r["batch_yield_qty"]) > 0) ? "batch_yield_qty ต้องเป็นตัวเลขมากกว่า 0" : null),
      mergeDuplicates: false,
      groupProblem: (rs) => (new Set(rs.map((r) => k(num(r["batch_yield_qty"])))).size > 1 ? "batch_yield_qty ไม่เท่ากันในแต่ละแถวของ SP นี้ · ใส่ตัวเลขเดียวกันทุกแถว" : null),
    }),
};

export const DATASETS: Dataset[] = [skus, suppliers, prices, menus, menuBom, spBom];

/** How many rows of each verdict, and how many will be written */
export function summarize(preview: PreviewRow[]) {
  const c: Record<Verdict, number> = { new: 0, change: 0, same: 0, skip: 0, error: 0 };
  for (const p of preview) c[p.verdict]++;
  return { ...c, toSave: preview.filter((p) => p.verdict === "new" || p.verdict === "change") };
}
