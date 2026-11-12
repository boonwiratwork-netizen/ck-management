/**
 * "ส่งสูตรให้หน้าร้าน": one recipe (a menu, or a kitchen SM item) as a sheet a shop can
 * prepare and order from. Pure — the screen (components/recipe-sheet) and the image/PDF/
 * clipboard actions all read what this builds, and the tests check the numbers.
 *
 * Per row:
 *   รวมที่ใช้        = ใช้ต่อ portion (or ต่อรอบ) × จำนวน portion (or รอบ)
 *   เตรียมก่อน Yield = รวมที่ใช้ ÷ yield%        (what has to be prepped/bought before trimming)
 *   สั่ง (แพ็ค)      = ceil(Σ เตรียม of the SAME item over every row ÷ (pack size × converter)),
 *                    rounded up once per item (an item in two steps, or in a menu and inside
 *                    its SP, is ordered as one); shown on the item's first row
 *                    with Usage QTY = Purchase QTY × pack_size × converter (CLAUDE.md UOM rule),
 *                    so one pack = pack_size × converter usage units
 *   ยอดสั่ง          = แพ็ค × ราคา/แพ็ค (the SKU's active price row, per purchase pack), per item
 *
 * A kitchen-made item whose pack isn't set (pack_size ≤ 1 or no pack unit) is requested in
 * its usage unit (g) rather than in made-up packs.
 *
 * Only the CENTRAL recipe goes on the sheet (menu_bom.branch_id null; SM bom_lines are
 * global by nature). Kitchen-made items (SM, or a SKU whose price comes from the central
 * kitchen supplier) are requested from the kitchen, not bought: quantities, no price.
 * An SP line (made at the shop) is listed as "ทำที่ร้าน" with its sp_bom ingredients
 * indented under it — the same expansion sales usage uses (src/lib/sale-usage.ts:
 * ingredient = qtyPerBatch ÷ batchYieldQty × the SP's effective qty), and those
 * ingredients are what gets ordered.
 */

export interface SheetSku {
  id: string;
  skuId: string;
  name: string;
  type: string; // RM | SM | SP | PK
  specNote?: string | null;
  packSize: number;
  packUnit: string;
  purchaseUom: string;
  usageUom: string;
  converter: number;
}
export interface SheetPrice {
  skuId: string;
  supplierId: string;
  pricePerPurchaseUom: number;
  pricePerUsageUom: number;
  isActive: boolean;
}
export interface SheetSupplier {
  id: string;
  name: string;
  isCentralKitchen?: boolean;
}
export interface SheetMenuLine {
  id: string;
  skuId: string;
  qtyPerServing: number;
  yieldPct: number; // 100 = no loss
  branchId?: string | null;
  specNote?: string | null;
}
export interface SheetSpLine {
  spSkuId: string;
  ingredientSkuId: string;
  qtyPerBatch: number;
  batchYieldQty: number;
}
export interface SheetBomHeader {
  id: string;
  bomMode: string; // simple | multistep
  batchSize: number;
  yieldPercent: number; // 1 = 100%
}
export interface SheetBomLine {
  id: string;
  rmSkuId: string;
  qtyPerBatch: number;
  yieldPercent?: number | null; // 1 = 100% (simple mode only)
  stepId?: string | null;
  qtyType?: string | null;
  percentOfInput?: number | null;
  specNote?: string | null;
}
export interface SheetBomStep {
  id: string;
  stepNumber: number;
  stepName: string;
  yieldPercent: number;
}

export type RowKind = "buy" | "kitchen" | "shop";

/** What to order/request for one item (on the item's first row only) */
export interface SheetOrder {
  qty: number;
  unit: string;
  /** Whole packs (bought, or a kitchen item with a real pack) vs. usage units (g) */
  byPack: boolean;
}

export interface SheetRow {
  key: string;
  skuId: string;
  /** Under an SP "ทำที่ร้าน" row (its ingredients) */
  indent: boolean;
  kind: RowKind;
  name: string;
  code: string;
  /** Per portion / per batch, usage unit */
  perUnit: number;
  uom: string;
  /** 100 = no loss */
  yieldPct: number;
  /** perUnit × multiplier */
  total: number;
  /** total ÷ yield */
  prep: number;
  /** Purchase units in one pack (pack_size) and their unit; null for shop-made rows and
   *  kitchen items requested by weight */
  packSize: number | null;
  purchaseUom: string;
  /** What a pack is called (packUnit, else "แพ็ค") */
  packUnit: string;
  pricePerPack: number | null;
  /** Packs to order for the whole item (first row of the item only, else null) */
  packs: number | null;
  /** packs × price for the whole item (first row only) */
  amount: number | null;
  /** The item's order (first row only) */
  order: SheetOrder | null;
  /** This row carries the item's order; false = its amount is ordered on the item's first row */
  orderOnRow: boolean;
  /** On the first row: how many rows the item has and their prep together */
  itemRows: number;
  itemPrep: number;
  /** Line note, else the SKU's spec note, else "" */
  note: string;
  supplier: string;
  /** A row to buy that has no active price: not in the total */
  noPrice: boolean;
}

export interface SheetGroup {
  /** null for a recipe without steps */
  title: string | null;
  rows: SheetRow[];
}

export interface RecipeSheet {
  kind: "menu" | "sm";
  title: string;
  code: string;
  brand: string;
  date: string;
  sentBy: string;
  /** "portion" or "รอบ" */
  unitLabel: string;
  multiplier: number;
  /** SM: what one batch makes and the whole run */
  batchOutput: { perBatch: number; total: number; uom: string } | null;
  groups: SheetGroup[];
  total: number;
  /** Rows to buy that had no active price (left out of the total) */
  noPriceCount: number;
}

export const KITCHEN_SUPPLIER = "ขอเบิกจากครัวกลาง";
export const SHOP_MADE = "ทำที่ร้าน";
export const NO_PRICE = "ไม่มีราคา";
export const SHEET_NOTE = "จำนวนแพ็คปัดขึ้นเต็มแพ็ค · ยอดสั่งยังไม่หักของที่เหลือในร้าน";

/** Line note, else the SKU's spec note, else nothing (the product name carries the spec) */
export function pickNote(lineNote: string | null | undefined, skuNote: string | null | undefined): string {
  const a = (lineNote ?? "").trim();
  if (a) return a;
  return (skuNote ?? "").trim();
}

/** Packs to order for a prep amount in usage units (rounded up to whole packs) */
export function packsFor(prepUsage: number, sku: Pick<SheetSku, "packSize" | "converter">): number {
  if (!(prepUsage > 0)) return 0;
  const converter = sku.converter > 0 ? sku.converter : 1;
  const packSize = sku.packSize > 0 ? sku.packSize : 1;
  const inPurchaseUnits = prepUsage / converter;
  // A hair under a whole pack from float maths (2.0000000001) is still 2 packs
  return Math.ceil(inPurchaseUnits / packSize - 1e-9);
}

/** Quantity before yield loss: 100 g at 80% → 125 g to prep */
export function beforeYield(total: number, yieldPct: number): number {
  return yieldPct > 0 ? total / (yieldPct / 100) : total;
}

export interface SheetContext {
  skus: SheetSku[];
  prices: SheetPrice[];
  suppliers: SheetSupplier[];
}

/** First active price of an item (the same one recipe costs read: activeUnitCost) */
function activePrice(prices: SheetPrice[], skuId: string): SheetPrice | undefined {
  return prices.find((p) => p.skuId === skuId && p.isActive);
}

/** The central kitchen's name for "ส่งโดย" */
export function kitchenName(suppliers: SheetSupplier[]): string {
  return suppliers.find((s) => s.isCentralKitchen)?.name || "ครัวกลาง";
}

/** One row from an item and how much of it is used per portion/batch (orders come in finish) */
function makeRow(ctx: SheetContext, key: string, skuId: string, perUnit: number, yieldPct: number, multiplier: number, lineNote: string | null | undefined, indent: boolean): SheetRow {
  const sku = ctx.skus.find((s) => s.id === skuId);
  const total = perUnit * multiplier;
  const prep = beforeYield(total, yieldPct);
  const base = {
    key,
    skuId,
    indent,
    name: sku?.name ?? "วัตถุดิบที่ถูกลบไปแล้ว",
    code: sku?.skuId ?? "",
    perUnit,
    uom: sku?.usageUom ?? "",
    yieldPct,
    total,
    prep,
    purchaseUom: sku?.purchaseUom ?? "",
    packUnit: sku?.packUnit || "แพ็ค",
    note: pickNote(lineNote, sku?.specNote),
    packs: null,
    amount: null,
    order: null,
    orderOnRow: false,
    itemRows: 1,
    itemPrep: prep,
  };
  if (sku?.type === "SP" || sku?.type === "WIP") return { ...base, kind: "shop", packSize: null, pricePerPack: null, supplier: SHOP_MADE, noPrice: false };
  const price = activePrice(ctx.prices, skuId);
  const supplier = price ? ctx.suppliers.find((s) => s.id === price.supplierId) : undefined;
  const packSize = sku && sku.packSize > 0 ? sku.packSize : 1;
  if (sku?.type === "SM" || supplier?.isCentralKitchen) {
    // No real pack set: request by weight, not in made-up packs
    const realPack = !!sku && sku.packSize > 1 && !!sku.packUnit.trim();
    return { ...base, kind: "kitchen", packSize: realPack ? packSize : null, pricePerPack: null, supplier: KITCHEN_SUPPLIER, noPrice: false };
  }
  const usagePerPack = packSize * (sku && sku.converter > 0 ? sku.converter : 1);
  const pricePerPack = price ? (price.pricePerPurchaseUom > 0 ? price.pricePerPurchaseUom : price.pricePerUsageUom * usagePerPack) : 0;
  if (!(pricePerPack > 0)) return { ...base, kind: "buy", packSize, pricePerPack: null, supplier: supplier?.name ?? "—", noPrice: true };
  return { ...base, kind: "buy", packSize, pricePerPack, supplier: supplier?.name ?? "—", noPrice: false };
}

/**
 * Orders per ITEM: every row of the same item (several steps, the menu and its SP…) adds
 * its prep, then packs are rounded up once and the money worked out once — on the item's
 * first row. The other rows keep their own quantities and point up to it.
 */
function finish(ctx: SheetContext, sheet: Omit<RecipeSheet, "total" | "noPriceCount">): RecipeSheet {
  const rows = sheet.groups.flatMap((g) => g.rows);
  const bySku = new Map<string, SheetRow[]>();
  for (const r of rows) {
    if (r.kind === "shop") continue;
    const list = bySku.get(r.skuId) ?? [];
    list.push(r);
    bySku.set(r.skuId, list);
  }
  let total = 0;
  let noPriceCount = 0;
  for (const [skuId, list] of bySku) {
    const first = list[0];
    const prep = list.reduce((s, r) => s + r.prep, 0);
    const sku = ctx.skus.find((s) => s.id === skuId);
    first.orderOnRow = true;
    first.itemRows = list.length;
    first.itemPrep = prep;
    const packs = sku ? packsFor(prep, sku) : null;
    if (first.kind === "kitchen") {
      if (first.packSize !== null && packs !== null) {
        first.packs = packs;
        first.order = { qty: packs, unit: first.packUnit, byPack: true };
      } else first.order = { qty: prep, unit: first.uom, byPack: false };
      continue;
    }
    first.packs = packs;
    if (packs !== null) first.order = { qty: packs, unit: first.packUnit, byPack: true };
    if (first.noPrice) {
      noPriceCount += 1;
      continue;
    }
    first.amount = packs !== null && first.pricePerPack !== null ? packs * first.pricePerPack : null;
    total += first.amount ?? 0;
  }
  return { ...sheet, total, noPriceCount };
}

/** The typed count: "1,000" → 1000; null when it isn't a usable number (empty, 0, too big) */
export function parseCount(text: string): number | null {
  const t = text.replace(/,/g, "").trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 && n <= 10000 ? n : null;
}

const safeMultiplier = (n: number) => (Number.isFinite(n) && n > 0 ? n : 1);

/** A menu's central recipe for `portions` portions */
export function buildMenuSheet(input: SheetContext & {
  menu: { menuCode: string; menuName: string; brandName: string };
  lines: SheetMenuLine[];
  spLines: SheetSpLine[];
  portions: number;
  date: string;
}): RecipeSheet {
  const portions = safeMultiplier(input.portions);
  const skuType = new Map(input.skus.map((s) => [s.id, s.type]));
  const rows: SheetRow[] = [];
  for (const line of input.lines) {
    // Central recipe only: a branch's own extra lines are that branch's business
    if (line.branchId) continue;
    const row = makeRow(input, line.id, line.skuId, line.qtyPerServing, line.yieldPct, portions, line.specNote, false);
    rows.push(row);
    if (skuType.get(line.skuId) !== "SP") continue;
    // The SP's ingredients for this much of it (sale-usage.ts expands SP the same way)
    for (const sp of input.spLines.filter((l) => l.spSkuId === line.skuId)) {
      const per = sp.batchYieldQty > 0 ? sp.qtyPerBatch / sp.batchYieldQty : sp.qtyPerBatch;
      const perPortion = per * beforeYield(line.qtyPerServing, line.yieldPct);
      rows.push(makeRow(input, `${line.id}:${sp.ingredientSkuId}`, sp.ingredientSkuId, perPortion, 100, portions, null, true));
    }
  }
  return finish(input, {
    kind: "menu",
    title: input.menu.menuName,
    code: input.menu.menuCode,
    brand: input.menu.brandName,
    date: input.date,
    sentBy: kitchenName(input.suppliers),
    unitLabel: "portion",
    multiplier: portions,
    batchOutput: null,
    groups: [{ title: null, rows }],
  });
}

/**
 * An SM recipe for `batches` production runs (bom_headers/bom_lines are per batch).
 * Multi-step: each step's lines under its own heading, amounts as production resolves
 * them (a "% of what goes in" line becomes grams; line yields don't apply in steps).
 */
export function buildSmSheet(input: SheetContext & {
  sku: { skuId: string; name: string; usageUom: string };
  header: SheetBomHeader;
  lines: SheetBomLine[];
  steps: SheetBomStep[];
  batches: number;
  date: string;
}): RecipeSheet {
  const batches = safeMultiplier(input.batches);
  const groups: SheetGroup[] = [];
  let perBatch = 0;
  if (input.header.bomMode === "multistep") {
    let prevOutput = 0;
    [...input.steps]
      .sort((a, b) => a.stepNumber - b.stepNumber)
      .forEach((step, idx) => {
        const own = input.lines.filter((l) => l.stepId === step.id);
        const base = idx === 0 ? own.filter((l) => l.qtyType !== "percent").reduce((s, l) => s + l.qtyPerBatch, 0) : prevOutput;
        const resolved = own.map((l) => ({ l, qty: l.qtyType === "percent" && l.percentOfInput ? l.percentOfInput * base : l.qtyPerBatch }));
        const stepInput = (idx === 0 ? 0 : prevOutput) + resolved.reduce((s, r) => s + r.qty, 0);
        prevOutput = stepInput * step.yieldPercent;
        groups.push({
          title: `ขั้นที่ ${idx + 1} · ${step.stepName}`,
          rows: resolved.map(({ l, qty }) => makeRow(input, l.id, l.rmSkuId, qty, 100, batches, l.specNote, false)),
        });
      });
    perBatch = prevOutput;
  } else {
    groups.push({
      title: null,
      rows: input.lines.map((l) => makeRow(input, l.id, l.rmSkuId, l.qtyPerBatch, Math.round((l.yieldPercent ?? 1) * 100000) / 1000, batches, l.specNote, false)),
    });
    perBatch = input.header.batchSize * input.header.yieldPercent;
  }
  return finish(input, {
    kind: "sm",
    title: input.sku.name,
    code: input.sku.skuId,
    brand: "",
    date: input.date,
    sentBy: kitchenName(input.suppliers),
    unitLabel: "รอบ",
    multiplier: batches,
    batchOutput: { perBatch, total: perBatch * batches, uom: input.sku.usageUom },
    groups,
  });
}

// ─── Formatting (shared by the screen, the image and the clipboard) ───

/** Today as the sheet shows it, e.g. "7 พ.ย. 2569" */
export const sheetDate = (d = new Date()) => d.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" });

/** Quantities: up to 2 decimals, thousands separated */
export const fmtQty = (n: number) => n.toLocaleString("th-TH", { maximumFractionDigits: 2 });
/** Money: ฿ and 2 decimals */
export const fmtBaht = (n: number) => `฿${n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const fmtPct = (n: number) => `${n.toLocaleString("th-TH", { maximumFractionDigits: 1 })}%`;

export interface SheetColumn {
  key: string;
  label: string;
  numeric: boolean;
}

/**
 * Columns of the copied table (TSV/HTML): numbers are plain numbers and every unit has
 * its own column, so a spreadsheet can add them up.
 */
export function sheetColumns(sheet: Pick<RecipeSheet, "unitLabel">): SheetColumn[] {
  return [
    { key: "name", label: "วัตถุดิบ", numeric: false },
    { key: "code", label: "รหัส", numeric: false },
    { key: "perUnit", label: sheet.unitLabel === "รอบ" ? "ใช้ต่อรอบ" : "ใช้ต่อ portion", numeric: true },
    { key: "uom", label: "หน่วย", numeric: false },
    { key: "yield", label: "Yield (%)", numeric: true },
    { key: "total", label: "รวมที่ใช้", numeric: true },
    { key: "prep", label: "เตรียมก่อน Yield", numeric: true },
    { key: "pack", label: "ขนาด/แพ็ค", numeric: true },
    { key: "packUom", label: "หน่วยซื้อ", numeric: false },
    { key: "packPrice", label: "ราคา/แพ็ค (บาท)", numeric: true },
    { key: "order", label: "สั่ง", numeric: true },
    { key: "orderUnit", label: "หน่วยสั่ง", numeric: false },
    { key: "amount", label: "ยอดสั่ง (บาท)", numeric: true },
    { key: "note", label: "สเปค / หมายเหตุ", numeric: false },
    { key: "supplier", label: "ซัพพลายเออร์", numeric: false },
  ];
}

/** A plain number for a spreadsheet: no separators, at most 2 decimals */
export const plainNum = (n: number) => String(Math.round(n * 100) / 100);
const plainMoney = (n: number) => n.toFixed(2);
export const MERGED_ORDER = "รวมในแถวแรกของรายการนี้";

/** Who supplies it, with the missing price said in words (numeric cells stay empty) */
function supplierText(r: SheetRow): string {
  if (r.kind === "buy" && r.noPrice) return r.supplier === "—" ? NO_PRICE : `${r.supplier} (${NO_PRICE})`;
  return r.supplier;
}

/** One row's cells for the copied table, in sheetColumns order */
export function rowCells(r: SheetRow): string[] {
  const priced = r.kind === "buy" && r.pricePerPack !== null;
  return [
    r.name,
    r.code,
    plainNum(r.perUnit),
    r.uom,
    plainNum(r.yieldPct),
    plainNum(r.total),
    plainNum(r.prep),
    r.packSize === null ? "" : plainNum(r.packSize),
    r.packSize === null ? "" : r.purchaseUom,
    priced ? plainMoney(r.pricePerPack!) : "",
    r.order ? plainNum(r.order.qty) : "",
    r.order ? r.order.unit : r.kind !== "shop" && !r.orderOnRow ? MERGED_ORDER : "",
    r.orderOnRow && r.amount !== null ? plainMoney(r.amount) : "",
    r.note,
    supplierText(r),
  ];
}

/** Lines above the table: name, code/brand, date, sender, how many */
export function headerLines(sheet: RecipeSheet): string[] {
  const how =
    sheet.kind === "sm"
      ? `จำนวนรอบผลิต ${fmtQty(sheet.multiplier)} รอบ${sheet.batchOutput ? ` · ได้ ${fmtQty(sheet.batchOutput.total)} ${sheet.batchOutput.uom} (รอบละ ${fmtQty(sheet.batchOutput.perBatch)} ${sheet.batchOutput.uom})` : ""}`
      : `จำนวน ${fmtQty(sheet.multiplier)} portion`;
  return [
    `สูตร ${sheet.title} (${sheet.code})`,
    [sheet.brand && `แบรนด์ ${sheet.brand}`, `วันที่ ${sheet.date}`, `ส่งโดย ${sheet.sentBy}`].filter(Boolean).join(" · "),
    how,
  ];
}

/** Footer lines under the total */
export function footerNotes(sheet: RecipeSheet): string[] {
  return [SHEET_NOTE, ...(sheet.noPriceCount ? [`มี ${sheet.noPriceCount} รายการที่ไม่มีราคา ไม่ได้รวมในยอดสั่ง`] : [])];
}

const tsvCell = (s: string) => s.replace(/[\t\r\n]+/g, " ");

/** Tab-separated: pastes as a table into Google Sheets / Excel */
export function toTsv(sheet: RecipeSheet): string {
  const cols = sheetColumns(sheet);
  const out: string[][] = [];
  for (const l of headerLines(sheet)) out.push([l]);
  out.push(cols.map((c) => c.label));
  for (const g of sheet.groups) {
    if (g.title) out.push([g.title]);
    for (const r of g.rows) out.push(rowCells(r));
  }
  const totalRow = cols.map(() => "");
  totalRow[0] = "ยอดสั่งรวม";
  totalRow[cols.findIndex((c) => c.key === "amount")] = plainMoney(sheet.total);
  out.push(totalRow);
  for (const n of footerNotes(sheet)) out.push([n]);
  return out.map((row) => row.map(tsvCell).join("\t")).join("\n");
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * An HTML table with a styled header: pastes as a real table into Google Docs/Sheets.
 * Inline styles only (the clipboard carries no stylesheet); colours are plain neutrals
 * because the pasted document has none of the app's tokens.
 */
export function toHtmlTable(sheet: RecipeSheet): string {
  const cols = sheetColumns(sheet);
  const th = "border:1px solid #999;padding:4px 6px;background:#eeeeee;font-weight:bold;";
  const td = "border:1px solid #999;padding:4px 6px;vertical-align:top;";
  const head = `<tr>${cols.map((c) => `<th style="${th}text-align:${c.numeric ? "right" : "left"}">${esc(c.label)}</th>`).join("")}</tr>`;
  const body = sheet.groups
    .map((g) => {
      const title = g.title ? `<tr><td colspan="${cols.length}" style="${td}font-weight:bold;">${esc(g.title)}</td></tr>` : "";
      const rows = g.rows
        .map((r) => {
          const cells = rowCells(r);
          return `<tr>${cells.map((v, i) => `<td style="${td}text-align:${cols[i].numeric ? "right" : "left"}${i === 0 && r.indent ? ";padding-left:18px" : ""}">${esc(v)}</td>`).join("")}</tr>`;
        })
        .join("");
      return title + rows;
    })
    .join("");
  const amountIdx = cols.findIndex((c) => c.key === "amount");
  const foot = `<tr><td colspan="${amountIdx}" style="${td}font-weight:bold;">ยอดสั่งรวม</td><td style="${td}text-align:right;font-weight:bold;">${esc(plainMoney(sheet.total))}</td><td colspan="${cols.length - amountIdx - 1}" style="${td}"></td></tr>`;
  const top = headerLines(sheet).map((l, i) => (i === 0 ? `<p><b>${esc(l)}</b></p>` : `<p>${esc(l)}</p>`)).join("");
  const notes = footerNotes(sheet).map((n) => `<p>${esc(n)}</p>`).join("");
  return `<meta charset="utf-8">${top}<table style="border-collapse:collapse;">${`<thead>${head}</thead>`}<tbody>${body}${foot}</tbody></table>${notes}`;
}

/** Plain text for a LINE message */
export function toLineText(sheet: RecipeSheet): string {
  const out = [...headerLines(sheet), `ยอดสั่งรวม ${fmtBaht(sheet.total)}`, ""];
  for (const g of sheet.groups) {
    if (g.title) out.push(g.title);
    for (const r of g.rows) {
      const prep = `เตรียม ${fmtQty(r.prep)} ${r.uom}`.trim();
      const together = r.itemRows > 1 ? ` (รวม ${r.itemRows} แถว เตรียมรวม ${fmtQty(r.itemPrep)} ${r.uom})` : "";
      const qty = r.order ? `${fmtQty(r.order.qty)} ${r.order.unit}` : "";
      const what =
        r.kind === "shop"
          ? `(${SHOP_MADE})`
          : !r.orderOnRow
            ? `→ ${MERGED_ORDER}`
            : r.kind === "kitchen"
              ? `→ ${KITCHEN_SUPPLIER} ${qty}${together}`
              : `→ สั่ง ${qty}${together} (${r.noPrice ? `${r.supplier} · ${NO_PRICE}` : r.supplier})`;
      const note = r.note ? ` · สเปค: ${r.note}` : "";
      out.push(`${r.indent ? "   – " : "• "}${r.name} · ${prep} ${what}${note}`);
    }
  }
  out.push("", ...footerNotes(sheet));
  return out.join("\n");
}

/**
 * Where to cut a tall image into pages without splitting a row: the furthest row edge
 * that still fits on each page (a row taller than a page is cut where the page ends).
 * All in the same units (CSS px of the rendered node).
 */
export function pageCuts(totalHeight: number, pageHeight: number, rowEdges: number[]): number[] {
  if (!(pageHeight > 0) || !(totalHeight > 0)) return [0, Math.max(0, totalHeight)];
  const edges = [...new Set(rowEdges.filter((e) => e > 0 && e < totalHeight))].sort((a, b) => a - b);
  const cuts = [0];
  let top = 0;
  while (totalHeight - top > pageHeight) {
    const limit = top + pageHeight;
    const fit = edges.filter((e) => e > top && e <= limit);
    const next = fit.length ? fit[fit.length - 1] : limit;
    cuts.push(next);
    top = next;
  }
  cuts.push(totalHeight);
  return cuts;
}

/** A file name without characters phones and Windows refuse */
export function sheetFileName(sheet: Pick<RecipeSheet, "code" | "title">, ext: string): string {
  const base = `สูตร-${sheet.code}-${sheet.title}`.replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, "-").slice(0, 80);
  return `${base}.${ext}`;
}
