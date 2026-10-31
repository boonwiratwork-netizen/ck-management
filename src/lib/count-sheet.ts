/**
 * The paper count sheet for the central kitchen's monthly count, as one A4 HTML
 * page set: SM, then RM, then PK (each starts on a new page), split by storage
 * inside, with an empty box to write the count. The system figure is left off on
 * purpose so the count isn't nudged towards it; the last finished count can be
 * shown beside it (the kitchen asked for it — counted, not calculated). Header
 * rows repeat on every page and a row never splits across pages.
 */

export interface SheetItem {
  code: string;
  name: string;
  unit: string;
  storage: string;
  /** What the last finished count found (null = not counted then) */
  last?: number | null;
}

export interface SheetGroup {
  type: "SM" | "RM" | "PK";
  items: SheetItem[];
}

const TYPE_TITLE: Record<SheetGroup["type"], string> = { SM: "SM · ของที่ครัวผลิต", RM: "RM · วัตถุดิบ", PK: "PK · บรรจุภัณฑ์" };
const STORAGE_TITLE: Record<string, string> = { Frozen: "ช่องแช่แข็ง", Chilled: "ตู้เย็น", Ambient: "ของแห้ง" };
const STORAGE_ORDER = ["Frozen", "Chilled", "Ambient"];

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const qty = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 2 });

/** `lastLabel` (e.g. "ยอดนับ 30 ก.ย.") adds the last count's column */
export function countSheetHtml(p: { title: string; dateText: string; groups: SheetGroup[]; lastLabel?: string }): string {
  const withLast = !!p.lastLabel;
  const cols = withLast ? 6 : 5;
  const sections = p.groups
    .filter((g) => g.items.length)
    .map((g) => {
      const byStorage = [...STORAGE_ORDER, ...new Set(g.items.map((i) => i.storage).filter((s) => !STORAGE_ORDER.includes(s)))]
        .map((st) => ({ st, items: g.items.filter((i) => i.storage === st).sort((a, b) => a.code.localeCompare(b.code)) }))
        .filter((x) => x.items.length);
      let n = 0;
      const rows = byStorage
        .map(
          ({ st, items }) =>
            `<tr class="zone"><td colspan="${cols}">${esc(STORAGE_TITLE[st] ?? (st || "ไม่ระบุช่องเก็บ"))} · ${items.length} รายการ</td></tr>` +
            items
              .map((i) => `<tr><td class="no">${++n}</td><td class="code">${esc(i.code)}</td><td class="name">${esc(i.name)}</td><td class="unit">${esc(i.unit)}</td>${withLast ? `<td class="last">${i.last == null ? "—" : qty(i.last)}</td>` : ""}<td class="box"></td></tr>`)
              .join(""),
        )
        .join("");
      // The title sits in the table header so it repeats on every page of the type
      return `<section>
  <table>
    <colgroup><col style="width:9mm"><col style="width:22mm"><col><col style="width:16mm">${withLast ? `<col style="width:28mm">` : ""}<col style="width:34mm"></colgroup>
    <thead>
      <tr class="title"><th colspan="${cols}"><div class="head"><h1>${esc(p.title)} · ${esc(TYPE_TITLE[g.type])}</h1><div class="meta">${esc(p.dateText)} · ${g.items.length} รายการ</div></div></th></tr>
      <tr><th>#</th><th>รหัส</th><th>สินค้า</th><th>หน่วย</th>${withLast ? `<th class="last">${esc(p.lastLabel!)}</th>` : ""}<th>นับได้</th></tr>
    </thead>
    <tbody><tr class="who"><td colspan="${cols}"><span>ผู้นับ ____________________</span><span>ผู้ตรวจ ____________________</span></td></tr></tbody>
    <tbody>
    <tbody>${rows}</tbody>
  </table>
</section>`;
    })
    .join("");
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${esc(p.title)}</title>
<style>
@page { size: A4 portrait; margin: 12mm 10mm 12mm 10mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: "Sarabun", "Thonburi", "Tahoma", sans-serif; color: #000; font-size: 11pt; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
section { break-after: page; page-break-after: always; }
section:last-child { break-after: auto; page-break-after: auto; }
.head { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 1.5pt solid #000; padding-bottom: 2mm; }
h1 { font-size: 14pt; margin: 0; }
.meta { font-size: 10pt; }
tr.title th { border-bottom: 0; padding: 0 0 1mm; font-weight: normal; }
tr.who td { border: 0; height: 9mm; font-size: 10pt; }
tr.who td span { display: inline-block; width: 50%; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; }
thead { display: table-header-group; }
tr { break-inside: avoid; page-break-inside: avoid; }
th { font-size: 9.5pt; text-align: left; border-bottom: 1pt solid #000; padding: 1.5mm 1.5mm; }
td { border-bottom: 0.5pt solid #999; padding: 0 1.5mm; height: 8.5mm; vertical-align: middle; }
td.no { font-size: 9pt; color: #444; }
td.code { font-family: "Menlo", "Courier New", monospace; font-size: 8.5pt; }
td.name { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
td.unit { font-size: 10pt; }
td.last, th.last { text-align: right; font-size: 10pt; color: #444; padding-right: 2mm; white-space: nowrap; }
td.box { border: 0.75pt solid #000; }
tr.zone td { height: 7mm; background: #eee; font-weight: bold; font-size: 10pt; border-bottom: 1pt solid #000; }
@media screen { body { background: #888; } section { background: #fff; width: 210mm; min-height: 297mm; margin: 8mm auto; padding: 12mm 10mm; } }
</style></head><body>${sections}</body></html>`;
}
