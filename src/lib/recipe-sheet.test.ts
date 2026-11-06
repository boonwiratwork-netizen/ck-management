import { describe, expect, it } from "vitest";
import {
  beforeYield,
  buildMenuSheet,
  buildSmSheet,
  KITCHEN_SUPPLIER,
  NO_PRICE,
  packsFor,
  MERGED_ORDER,
  pageCuts,
  parseCount,
  pickNote,
  SHEET_NOTE,
  SHOP_MADE,
  sheetColumns,
  sheetFileName,
  toHtmlTable,
  toLineText,
  toTsv,
  type SheetPrice,
  type SheetSku,
  type SheetSupplier,
} from "./recipe-sheet";

const sku = (id: string, over: Partial<SheetSku> = {}): SheetSku => ({ id, skuId: id.toUpperCase(), name: id, type: "RM", specNote: "", packSize: 1000, packUnit: "ถุง", purchaseUom: "g", usageUom: "g", converter: 1, ...over });
const price = (skuId: string, perPack: number, supplierId = "fk", usage = 0): SheetPrice => ({ skuId, supplierId, pricePerPurchaseUom: perPack, pricePerUsageUom: usage, isActive: true });
const SUP: SheetSupplier[] = [
  { id: "fk", name: "Freshket" },
  { id: "ck", name: "ครัวกลาง Live to Eat", isCentralKitchen: true },
];
const MENU = { menuCode: "MN-001", menuName: "ราเมนโชยุ", brandName: "Sendo" };

function menuSheet(over: Partial<Parameters<typeof buildMenuSheet>[0]> = {}) {
  return buildMenuSheet({ menu: MENU, lines: [], spLines: [], skus: [], prices: [], suppliers: SUP, portions: 1, date: "7 พ.ย. 2569", ...over });
}
const rowsOf = (s: ReturnType<typeof menuSheet>) => s.groups.flatMap((g) => g.rows);

describe("numbers", () => {
  it("yield: prep = total ÷ yield%", () => {
    expect(beforeYield(100, 80)).toBe(125);
    expect(beforeYield(100, 100)).toBe(100);
    expect(beforeYield(100, 0)).toBe(100); // no yield set: never divide by zero
  });

  it("packs round up to whole packs, float noise is not an extra pack", () => {
    expect(packsFor(1, { packSize: 1000, converter: 1 })).toBe(1);
    expect(packsFor(1000, { packSize: 1000, converter: 1 })).toBe(1);
    expect(packsFor(1000.5, { packSize: 1000, converter: 1 })).toBe(2);
    expect(packsFor(0.1 * 3 * 1000, { packSize: 300, converter: 1 })).toBe(1); // 300.00000000000006
    expect(packsFor(0, { packSize: 1000, converter: 1 })).toBe(0);
  });

  it("UOM: purchase unit ≠ usage unit — 1 pack = pack_size × converter usage units", () => {
    // Bought in kg cartons of 10 kg, used in g: converter 1000, pack_size 10
    expect(packsFor(25_000, { packSize: 10, converter: 1000 })).toBe(3);
    expect(packsFor(10_000, { packSize: 10, converter: 1000 })).toBe(1);
    // Bad master data (0) counts as 1, never Infinity
    expect(packsFor(5, { packSize: 0, converter: 0 })).toBe(5);
  });
});

describe("menu sheet", () => {
  const skus = [sku("pork", { name: "หมูสามชั้น", packSize: 1, packUnit: "แพ็ค", purchaseUom: "kg", converter: 1000 }), sku("egg", { name: "ไข่", usageUom: "ฟอง", purchaseUom: "ฟอง", packSize: 30, packUnit: "แผง" })];
  const prices = [price("pork", 250), price("egg", 120)];

  it("portions multiply, yield divides, packs and order amount from the active price", () => {
    const s = menuSheet({
      skus,
      prices,
      portions: 10,
      lines: [
        { id: "l1", skuId: "pork", qtyPerServing: 80, yieldPct: 80 },
        { id: "l2", skuId: "egg", qtyPerServing: 1, yieldPct: 100 },
      ],
    });
    const [pork, egg] = rowsOf(s);
    expect(pork).toMatchObject({ perUnit: 80, total: 800, prep: 1000, packSize: 1, purchaseUom: "kg", packs: 1, pricePerPack: 250, amount: 250, supplier: "Freshket", kind: "buy" });
    expect(egg).toMatchObject({ total: 10, prep: 10, packs: 1, amount: 120, packUnit: "แผง" });
    expect(s.total).toBe(370);
    expect(s.noPriceCount).toBe(0);
    expect(s).toMatchObject({ unitLabel: "portion", multiplier: 10, brand: "Sendo", sentBy: "ครัวกลาง Live to Eat" });
  });

  it("central recipe only: branch lines stay off the sheet", () => {
    const s = menuSheet({ skus, prices, lines: [{ id: "l1", skuId: "egg", qtyPerServing: 1, yieldPct: 100 }, { id: "l2", skuId: "pork", qtyPerServing: 50, yieldPct: 100, branchId: "b1" }] });
    expect(rowsOf(s).map((r) => r.key)).toEqual(["l1"]);
  });

  it("no active price: says so, not in the total, counted", () => {
    const s = menuSheet({ skus, prices: [price("egg", 120), { ...price("pork", 250), isActive: false }], lines: [{ id: "l1", skuId: "pork", qtyPerServing: 100, yieldPct: 100 }, { id: "l2", skuId: "egg", qtyPerServing: 2, yieldPct: 100 }] });
    const [pork] = rowsOf(s);
    expect(pork).toMatchObject({ noPrice: true, pricePerPack: null, amount: null, packs: 1, supplier: "—" });
    expect(s.total).toBe(120);
    expect(s.noPriceCount).toBe(1);
  });

  it("a price row with only a per-unit price still prices the pack", () => {
    const s = menuSheet({ skus, prices: [price("pork", 0, "fk", 0.25)], lines: [{ id: "l1", skuId: "pork", qtyPerServing: 100, yieldPct: 100 }] });
    expect(rowsOf(s)[0]).toMatchObject({ pricePerPack: 250, amount: 250 });
  });

  it("kitchen-made: SM items and items priced from the central kitchen are requested, not bought", () => {
    const s = menuSheet({
      skus: [sku("soup", { type: "SM", name: "น้ำซุป", packSize: 3000 }), sku("noodle", { name: "เส้น", packSize: 500 })],
      prices: [price("soup", 0, "bom", 0.05), price("noodle", 40, "ck")],
      portions: 20,
      lines: [{ id: "l1", skuId: "soup", qtyPerServing: 300, yieldPct: 100 }, { id: "l2", skuId: "noodle", qtyPerServing: 150, yieldPct: 100 }],
    });
    for (const r of rowsOf(s)) expect(r).toMatchObject({ kind: "kitchen", supplier: KITCHEN_SUPPLIER, pricePerPack: null, amount: null, noPrice: false });
    expect(rowsOf(s)[0]).toMatchObject({ prep: 6000, packs: 2 });
    expect(s.total).toBe(0);
    expect(s.noPriceCount).toBe(0);
  });

  it("SP: one 'made at the shop' row, its ingredients indented under it as sale-usage expands them", () => {
    const s = menuSheet({
      skus: [sku("tare", { type: "SP", name: "ทาเระ" }), sku("soy", { name: "โชยุ", packSize: 1000 }), sku("sugar", { name: "น้ำตาล" })],
      prices: [price("soy", 100), price("sugar", 30)],
      spLines: [
        { spSkuId: "tare", ingredientSkuId: "soy", qtyPerBatch: 800, batchYieldQty: 1000 },
        { spSkuId: "tare", ingredientSkuId: "sugar", qtyPerBatch: 200, batchYieldQty: 1000 },
      ],
      portions: 10,
      // 30 g at 75% → 40 g of tare per portion (the effective qty sales usage multiplies)
      lines: [{ id: "l1", skuId: "tare", qtyPerServing: 30, yieldPct: 75 }],
    });
    const [tare, soy, sugar] = rowsOf(s);
    expect(tare).toMatchObject({ kind: "shop", supplier: SHOP_MADE, indent: false, prep: 400, packs: null, amount: null });
    expect(soy).toMatchObject({ indent: true, kind: "buy", perUnit: 32, total: 320, prep: 320, packs: 1, amount: 100 });
    expect(sugar.prep).toBeCloseTo(80);
    expect(s.total).toBe(130);
  });

  it("note: the line's own, else the product's spec, else nothing", () => {
    expect(pickNote("หั่นเต๋า 1 ซม.", "ไม่เอาหนัง")).toBe("หั่นเต๋า 1 ซม.");
    expect(pickNote("  ", "ไม่เอาหนัง")).toBe("ไม่เอาหนัง");
    expect(pickNote(null, null)).toBe("");
    const s = menuSheet({ skus: [sku("a", { specNote: "เกรด A" }), sku("b", { specNote: "เกรด B" })], prices: [], lines: [{ id: "1", skuId: "a", qtyPerServing: 1, yieldPct: 100, specNote: "ล้างก่อน" }, { id: "2", skuId: "b", qtyPerServing: 1, yieldPct: 100 }] });
    expect(rowsOf(s).map((r) => r.note)).toEqual(["ล้างก่อน", "เกรด B"]);
  });

  it("a nonsense multiplier counts as 1", () => {
    expect(menuSheet({ portions: 0 }).multiplier).toBe(1);
    expect(menuSheet({ portions: NaN }).multiplier).toBe(1);
  });
});

describe("SM sheet", () => {
  const skus = [sku("bone", { name: "กระดูกหมู", packSize: 5000 }), sku("onion", { name: "หอมใหญ่" }), sku("salt", { name: "เกลือ" })];
  const prices = [price("bone", 500), price("onion", 40), price("salt", 20)];
  const smSku = { skuId: "SM-0010", name: "น้ำสต๊อก", usageUom: "g" };

  it("simple: per batch × runs, line yield, batch output", () => {
    const s = buildSmSheet({
      sku: smSku,
      header: { id: "h", bomMode: "simple", batchSize: 30000, yieldPercent: 0.8 },
      lines: [
        { id: "a", rmSkuId: "bone", qtyPerBatch: 6000, yieldPercent: 1 },
        { id: "b", rmSkuId: "onion", qtyPerBatch: 900, yieldPercent: 0.9 },
      ],
      steps: [],
      skus,
      prices,
      suppliers: SUP,
      batches: 2,
      date: "x",
    });
    const [bone, onion] = s.groups[0].rows;
    expect(s.groups[0].title).toBeNull();
    expect(bone).toMatchObject({ perUnit: 6000, total: 12000, prep: 12000, packs: 3, amount: 1500 });
    expect(onion).toMatchObject({ yieldPct: 90, total: 1800, packs: 2, amount: 80 });
    expect(onion.prep).toBeCloseTo(2000);
    expect(s.batchOutput).toEqual({ perBatch: 24000, total: 48000, uom: "g" });
    expect(s).toMatchObject({ kind: "sm", unitLabel: "รอบ", multiplier: 2, total: 1580 });
  });

  it("multistep: rows grouped by step, % lines resolved like production", () => {
    const s = buildSmSheet({
      sku: smSku,
      header: { id: "h", bomMode: "multistep", batchSize: 0, yieldPercent: 1 },
      steps: [
        { id: "s2", stepNumber: 2, stepName: "ต้ม", yieldPercent: 0.5 },
        { id: "s1", stepNumber: 1, stepName: "ล้าง", yieldPercent: 0.9 },
      ],
      lines: [
        { id: "a", rmSkuId: "bone", qtyPerBatch: 10000, stepId: "s1", qtyType: "fixed", specNote: "ไม่เอาไขมัน" },
        { id: "b", rmSkuId: "salt", qtyPerBatch: 0, stepId: "s2", qtyType: "percent", percentOfInput: 0.01 },
      ],
      skus,
      prices,
      suppliers: SUP,
      batches: 1,
      date: "x",
    });
    expect(s.groups.map((g) => g.title)).toEqual(["ขั้นที่ 1 · ล้าง", "ขั้นที่ 2 · ต้ม"]);
    expect(s.groups[0].rows[0]).toMatchObject({ prep: 10000, note: "ไม่เอาไขมัน", yieldPct: 100 });
    // Step 2's base = step 1's output 9,000 g → 1% = 90 g
    expect(s.groups[1].rows[0].prep).toBeCloseTo(90);
    expect(s.batchOutput?.perBatch).toBeCloseTo((9000 + 90) * 0.5);
  });
});

describe("text out (Thai kept)", () => {
  const s = menuSheet({
    skus: [sku("pork", { name: "หมูสามชั้น\tสไลซ์" }), sku("soup", { type: "SM", name: "น้ำซุป <ไก่>" })],
    prices: [price("pork", 250)],
    lines: [{ id: "1", skuId: "pork", qtyPerServing: 100, yieldPct: 100, specNote: "หนา 3 มม." }, { id: "2", skuId: "soup", qtyPerServing: 300, yieldPct: 100 }],
    portions: 2,
  });

  it("TSV: header lines, column titles, one row per item, total, notes — plain numbers, units in their own columns", () => {
    const lines = toTsv(s).split("\n");
    expect(lines[0]).toBe("สูตร ราเมนโชยุ (MN-001)");
    const cols = sheetColumns(s).map((c) => c.key);
    const head = lines.find((l) => l.startsWith("วัตถุดิบ"))!;
    expect(head.split("\t")).toEqual(sheetColumns(s).map((c) => c.label));
    const pork = lines.find((l) => l.startsWith("หมูสามชั้น"))!.split("\t");
    expect(pork).toHaveLength(cols.length);
    const cell = (k: string) => pork[cols.indexOf(k)];
    expect(pork[0]).toBe("หมูสามชั้น สไลซ์");
    expect(cell("prep")).toBe("200");
    expect(cell("pack")).toBe("1000");
    expect(cell("packUom")).toBe("g");
    expect(cell("packPrice")).toBe("250.00");
    expect(cell("order")).toBe("1");
    expect(cell("orderUnit")).toBe("ถุง");
    expect(cell("amount")).toBe("250.00");
    expect(cell("note")).toBe("หนา 3 มม.");
    // Numeric cells never carry ฿, % or a unit
    for (const c of sheetColumns(s).filter((c) => c.numeric)) for (const l of lines.slice(4)) {
      const v = l.split("\t")[cols.indexOf(c.key)];
      if (v) expect(v).toMatch(/^-?\d+(\.\d+)?$/);
    }
    expect(lines.find((l) => l.startsWith("ยอดสั่งรวม"))!.split("\t")[cols.indexOf("amount")]).toBe("250.00");
    expect(lines).toContain(SHEET_NOTE);
  });

  it("HTML: a real table with a styled header, escaped text, plain numbers", () => {
    const html = toHtmlTable(s);
    expect(html).toContain("<table");
    expect(html).toMatch(/<th style="[^"]*background:#eeeeee/);
    expect(html).toContain("น้ำซุป &lt;ไก่&gt;");
    expect(html).toContain(KITCHEN_SUPPLIER);
    expect(html).toContain(">250.00<");
    expect(html).not.toContain("฿");
  });

  it("LINE text: header, total, one bullet per item with prep → order (supplier) · spec", () => {
    const text = toLineText(s);
    expect(text).toContain("ยอดสั่งรวม ฿250.00");
    expect(text).toContain("• หมูสามชั้น\tสไลซ์ · เตรียม 200 g → สั่ง 1 ถุง (Freshket) · สเปค: หนา 3 มม.");
    expect(text).toContain(`• น้ำซุป <ไก่> · เตรียม 600 g → ${KITCHEN_SUPPLIER} 1 ถุง`);
    expect(text).toContain(SHEET_NOTE);
  });

  it("LINE text says when an item has no price", () => {
    const t = toLineText(menuSheet({ skus: [sku("x", { name: "ผักชี" })], lines: [{ id: "1", skuId: "x", qtyPerServing: 5, yieldPct: 100 }] }));
    expect(t).toContain(NO_PRICE);
    expect(t).toContain("มี 1 รายการที่ไม่มีราคา");
  });

  it("file name keeps Thai, drops characters files can't have", () => {
    expect(sheetFileName({ code: "MN-001", title: 'ราเมน/โชยุ "พิเศษ"' }, "jpg")).toBe("สูตร-MN-001-ราเมนโชยุ-พิเศษ.jpg");
  });
});

describe("orders per item", () => {
  const skus = [sku("bone", { name: "กระดูกหมู", packSize: 1000 }), sku("tare", { type: "SP", name: "ทาเระ" }), sku("soy", { name: "โชยุ", packSize: 1000 })];
  const prices = [price("bone", 100), price("soy", 50)];

  it("the same item in two steps: prep added up, packs rounded up ONCE, order on the first row", () => {
    const s = buildSmSheet({
      sku: { skuId: "SM-1", name: "x", usageUom: "g" },
      header: { id: "h", bomMode: "multistep", batchSize: 0, yieldPercent: 1 },
      steps: [{ id: "s1", stepNumber: 1, stepName: "a", yieldPercent: 1 }, { id: "s2", stepNumber: 2, stepName: "b", yieldPercent: 1 }],
      lines: [{ id: "a", rmSkuId: "bone", qtyPerBatch: 600, stepId: "s1", qtyType: "fixed" }, { id: "b", rmSkuId: "bone", qtyPerBatch: 300, stepId: "s2", qtyType: "fixed" }],
      skus, prices, suppliers: SUP, batches: 1, date: "x",
    });
    const [first, second] = s.groups.flatMap((g) => g.rows);
    // per row it would be 1 + 1 packs; together 900 g = 1 pack
    expect(first).toMatchObject({ orderOnRow: true, itemRows: 2, itemPrep: 900, packs: 1, amount: 100, order: { qty: 1, unit: "ถุง", byPack: true } });
    expect(second).toMatchObject({ orderOnRow: false, packs: null, amount: null, order: null, prep: 300 });
    expect(s.total).toBe(100);
    expect(toLineText(s)).toContain(MERGED_ORDER);
  });

  it("an item used directly and inside an SP is ordered once", () => {
    const s = menuSheet({
      skus, prices, portions: 1,
      spLines: [{ spSkuId: "tare", ingredientSkuId: "soy", qtyPerBatch: 500, batchYieldQty: 1000 }],
      lines: [{ id: "l1", skuId: "soy", qtyPerServing: 700, yieldPct: 100 }, { id: "l2", skuId: "tare", qtyPerServing: 1000, yieldPct: 100 }],
    });
    const soyRows = rowsOf(s).filter((r) => r.skuId === "soy");
    expect(soyRows.map((r) => r.prep)).toEqual([700, 500]);
    expect(soyRows[0]).toMatchObject({ packs: 2, amount: 100, itemRows: 2 });
    expect(soyRows[1]).toMatchObject({ orderOnRow: false, amount: null });
    expect(s.total).toBe(100);
  });

  it("no price is counted once per item", () => {
    const s = menuSheet({ skus: [sku("x")], lines: [{ id: "1", skuId: "x", qtyPerServing: 5, yieldPct: 100 }, { id: "2", skuId: "x", qtyPerServing: 5, yieldPct: 100, specNote: "อีกแถว" }] });
    expect(s.noPriceCount).toBe(1);
  });

  it("kitchen item without a real pack (pack_size ≤ 1 or no pack unit): requested in grams", () => {
    const s = menuSheet({
      skus: [sku("oil", { type: "SM", name: "น้ำมันไก่", packSize: 1, packUnit: "" }), sku("stock", { type: "SM", name: "น้ำสต๊อก", packSize: 3000, packUnit: "" })],
      portions: 10,
      lines: [{ id: "1", skuId: "oil", qtyPerServing: 5, yieldPct: 100 }, { id: "2", skuId: "stock", qtyPerServing: 300, yieldPct: 100 }],
    });
    for (const r of rowsOf(s)) {
      expect(r.packSize).toBeNull();
      expect(r.packs).toBeNull();
      expect(r.order?.byPack).toBe(false);
      expect(r.order?.unit).toBe("g");
    }
    expect(rowsOf(s)[1].order?.qty).toBe(3000);
    expect(toLineText(s)).toContain(`→ ${KITCHEN_SUPPLIER} 3,000 g`);
  });
});

describe("count box", () => {
  it("accepts 1,000; refuses empty, 0, negatives, text and over 10,000 (no quiet 1)", () => {
    expect(parseCount("1,000")).toBe(1000);
    expect(parseCount(" 2.5 ")).toBe(2.5);
    for (const bad of ["", "  ", "0", "-3", "abc", "10001"]) expect(parseCount(bad)).toBeNull();
  });
});

describe("PDF page cuts", () => {
  it("one page when it fits", () => {
    expect(pageCuts(500, 800, [100, 200])).toEqual([0, 500]);
  });
  it("cuts at the last row edge that fits", () => {
    expect(pageCuts(1000, 400, [120, 350, 390, 600, 790, 900])).toEqual([0, 390, 790, 1000]);
  });
  it("a row taller than a page is cut at the page end", () => {
    expect(pageCuts(1000, 400, [900])).toEqual([0, 400, 800, 1000]);
  });
});
