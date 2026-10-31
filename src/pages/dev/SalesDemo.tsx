import { useCallback, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { addDays, format } from "date-fns";
import SalesPage from "@/pages/Sales";
import type { Branch } from "@/types/branch";
import type { Menu } from "@/types/menu";
import type { ModifierRule } from "@/types/modifier-rule";
import type { POSMappingProfile } from "@/hooks/use-sales-entry-data";
import type { DaySummary, SaleLine, SalesData } from "@/hooks/use-sales-data";

/**
 * Dev-only harness (route exists only under `npm run dev`): the Sales page on
 * made-up sales with an in-memory database. Every write is listed at the bottom.
 */

const BRANCHES: Branch[] = [
  { id: "shiro", branchName: "Shiro", brandName: "Sendo", location: "", status: "Active", avgSellingPrice: null },
  { id: "thaniya", branchName: "Thaniya", brandName: "Sendo", location: "", status: "Active", avgSellingPrice: null },
];
const menu = (id: string, code: string, name: string, price: number): Menu => ({ id, menuCode: code, menuName: name, category: "", sellingPrice: price, status: "Active", brandName: "Sendo", isMaindish: false });
const MENUS: Menu[] = [
  menu("m1", "MN-001", "Standard Shio Ramen", 339),
  menu("m2", "MN-032", "Mineral water", 30),
  menu("m3", "MN-080", "Trio Set", 49),
  menu("m4", "MN-016", "Tori Karaage", 119),
  // CK names differ from FoodStory's: the deal lines below find these through past sales or the English part
  menu("m5", "MN-056", "แบล็ค การ์ลิค ราเมน", 329),
  menu("m6", "MN-003", "สแตนดาร์ด โทริ ไพตัน ราเมน", 339),
  menu("m7", "MN-041", "ชาชูดง ทรัฟเฟิล (Chashu Don with Truffle Sauce)", 259),
  // A LINE MAN copy with no recipe: a deal must never land here (it would take no stock)
  menu("m8", "MN-003L", "Standard Tori Paitan Ramen (Line Man)", 299),
];
// Menus with menu_bom lines (everything but the LINE MAN copy)
const WITH_RECIPE = new Set(MENUS.filter((m) => m.id !== "m8").map((m) => m.id));
const RULES = [{ id: "r1", keyword: "เส้นโฮมเมด", skuId: "x", qtyPerMatch: 1, uom: "g", description: "", isActive: true, menuId: null, menuIds: ["m1"], ruleType: "swap", swapSkuId: null, submenuId: null, branchIds: [] }] as ModifierRule[];
const PROFILES: POSMappingProfile[] = [
  { id: "fs", name: "FoodStory POS", separator: "tab", hasHeaderRow: false, dateFormat: "DD/MM/YYYY", mappings: { channel: 15, date: 0, menu_code: 5, menu_name: 6, net_amount: 13, order_type: 7, qty: 8, receipt_no: 2, unit_price: 9 } },
  { id: "sp", name: "SuperPOS", separator: "tab", hasHeaderRow: true, dateFormat: "DD/MM/YYYY", mappings: { channel: 9, date: 2, menu_code: 11, menu_name: 12, net_amount: 17, qty: 13, receipt_no: 5, unit_price: 14 } },
];

const today = new Date();
const iso = (d: Date) => format(d, "yyyy-MM-dd");

// LINE MAN deal lines as FoodStory sends them: priced, no menu code (Oct 2026). Copy into the paste box.
const fsLine = (date: string, bill: string, code: string, name: string, net: number) => {
  const c = Array(16).fill("");
  Object.assign(c, { 0: date, 2: bill, 5: code, 6: name, 7: "Delivery", 8: "1", 9: String(net), 13: String(net), 15: "LINE MAN" });
  return c.join("\t");
};
const dmy = (d: Date) => format(d, "dd/MM/yyyy");
const SAMPLE = [
  fsLine(dmy(today), "LM1", "MN-001", "Standard Shio Ramen เลือกเส้น : เส้นโฮมเมด x 1", 339),
  fsLine(dmy(today), "LM1", "", "Black Garlic Ramen ลดพิเศษ! [เฉพาะที่ LINE MAN] [ดีลเดือด] เลือกเส้น : เส้นโฮมเมด x 1", 329),
  fsLine(dmy(today), "LM2", "", "Chashu Don with Truffle Sauce ลดพิเศษ! [เฉพาะที่ LINE MAN] [ดีลเดือด]", 259),
  fsLine(dmy(today), "LM2", "", "Standard Tori Paitan Ramen ลดพิเศษ! [เฉพาะที่ LINE MAN] [ดีลเดือด]", 299),
  fsLine(dmy(today), "LM3", "", "Red Spicy Ramen ลดพิเศษ! [เฉพาะที่ LINE MAN] [ดีลเดือด]", 329),
  fsLine(dmy(today), "LM3", "", "ไม่รับช้อนส้อมพลาสติก", 0),
].join("\n");
function seed(): SaleLine[] {
  const out: SaleLine[] = [];
  let n = 0;
  for (let k = 13; k >= 1; k--) {
    if (k === 2 || k === 1 || k === 6) continue; // missing days
    const d = iso(addDays(today, -k));
    for (let b = 0; b < 4; b++) {
      const bill = `B${k}${b}`;
      out.push({ id: `s${n++}`, branch_id: "shiro", sale_date: d, receipt_no: bill, menu_code: "MN-001", menu_name: "Standard Shio Ramen เลือกเส้น : เส้นโฮมเมด x 1 ระดับเส้น : ลวกเส้น : ปกติ x 1 ความเค็ม : ความเค็ม : ปกติ x 1", order_type: "Dine-In", qty: 1, unit_price: 369, net_amount: 339, channel: "หน้าร้าน" });
      out.push({ id: `t${n++}`, branch_id: "thaniya", sale_date: d, receipt_no: `T${k}${b}`, menu_code: "MN-080", menu_name: "Trio Set", order_type: "Dine-In", qty: 1, unit_price: 49, net_amount: 49, channel: "หน้าร้าน" });
      // Dine-in lines carry the code; they teach the import what the LINE MAN deal names mean
      if (b === 0) out.push({ id: `s${n++}`, branch_id: "shiro", sale_date: d, receipt_no: bill, menu_code: "MN-056", menu_name: "Black Garlic Ramen เลือกเส้น : เส้นโฮมเมด x 1", order_type: "Dine-In", qty: 1, unit_price: 369, net_amount: 369, channel: "หน้าร้าน" });
      if (b === 1) out.push({ id: `s${n++}`, branch_id: "shiro", sale_date: d, receipt_no: bill, menu_code: "MN-003", menu_name: "Standard Tori Paitan Ramen", order_type: "Dine-In", qty: 1, unit_price: 339, net_amount: 339, channel: "หน้าร้าน" });
      out.push({ id: `s${n++}`, branch_id: "shiro", sale_date: d, receipt_no: bill, menu_code: "MN-032", menu_name: "Mineral water อุณหภูมิ : เย็น x 1 แก้ว : น้ำแข็ง x 2", order_type: "Dine-In", qty: 2, unit_price: 30, net_amount: 60, channel: "หน้าร้าน" });
    }
  }
  return out;
}

export default function SalesDemo() {
  const [db, setDb] = useState<SaleLine[]>(seed);
  const [log, setLog] = useState<string[]>([]);
  const location = useLocation();
  const note = (s: string) => setLog((l) => [s, ...l]);
  const wait = () => new Promise((r) => setTimeout(r, 250));

  const days = useMemo(() => {
    const m = new Map<string, DaySummary & { b: Set<string> }>();
    for (const r of db) {
      const d = m.get(r.sale_date) ?? { lines: 0, bills: 0, total: 0, b: new Set<string>() };
      d.lines++;
      d.total += r.net_amount;
      d.b.add(r.receipt_no);
      d.bills = d.b.size;
      m.set(r.sale_date, d);
    }
    return m as Map<string, DaySummary>;
  }, [db]);

  // The page tells the real hook which day is open through its hash; read it here too
  const h = decodeURIComponent(location.hash.slice(1));
  const day = h.startsWith("day/") ? h.slice(4) : ([...days.keys()].sort().pop() ?? null);

  const data: SalesData = {
    days,
    daysLoading: false,
    lines: db.filter((r) => r.sale_date === day).sort((a, b) => a.receipt_no.localeCompare(b.receipt_no)),
    linesLoading: false,
    profiles: PROFILES,
    reloadDays: async () => undefined,
    reloadLines: async () => undefined,
    existingOn: useCallback(async (dates: string[]) => {
      await wait();
      const m = new Map();
      for (const r of db) if (dates.includes(r.sale_date)) m.set(r.sale_date, [...(m.get(r.sale_date) ?? []), r]);
      return m;
    }, [db]),
    codeHistory: useCallback(
      async (bases: string[]) => {
        await wait();
        const has = (name: string, base: string) => base.toLowerCase().split(/\s+/).every((w) => name.toLowerCase().includes(w));
        return db.filter((r) => r.menu_code && bases.some((b) => has(r.menu_name, b))).map((r) => ({ menu_code: r.menu_code, menu_name: r.menu_name }));
      },
      [db],
    ),
    recipeMenuIds: async () => WITH_RECIPE,
    saveImport: async (writes) => {
      await wait();
      let inserted = 0;
      for (const w of writes) {
        w.update.forEach((u) => note(`UPDATE sales_entries ${u.id} ${JSON.stringify(u.patch)}`));
        if (w.kept) note(`KEEP ${w.kept} unchanged rows of ${w.date}`);
        setDb((d) => d.map((r) => ({ ...r, ...(w.update.find((u) => u.id === r.id)?.patch ?? {}) })));
        inserted += w.update.length + w.kept;
        w.insert.forEach((r) => note(`INSERT sales_entries ${JSON.stringify(r)}`));
        if (w.deleteIds.length) note(`DELETE sales_entries ${w.deleteIds.length} rows of ${w.date} (after the inserts)`);
        setDb((d) => [...d.filter((r) => !w.deleteIds.includes(r.id)), ...w.insert.map((r, k) => ({ ...r, id: `n${Date.now()}${k}` }))]);
        inserted += w.insert.length;
      }
      return { inserted, failedDay: null };
    },
    fetchHistory: useCallback(
      async (ids: string[], f: string, t: string) => {
        await wait();
        return db.filter((r) => ids.includes(r.branch_id) && r.sale_date >= f && r.sale_date <= t).sort((a, b) => b.sale_date.localeCompare(a.sale_date) || a.receipt_no.localeCompare(b.receipt_no));
      },
      [db],
    ),
    addLine: async (row) => {
      await wait();
      note(`INSERT sales_entries ${JSON.stringify(row)}`);
      setDb((d) => [...d, { ...row, id: `m${Date.now()}` }]);
      return true;
    },
    updateLine: async (id, patch) => {
      note(`UPDATE sales_entries ${id} ${JSON.stringify(patch)}`);
      setDb((d) => d.map((r) => (r.id === id ? { ...r, ...patch } : r)));
      return true;
    },
    deleteLines: async (ids) => {
      note(`DELETE sales_entries ${ids.length} rows`);
      setDb((d) => d.filter((r) => !ids.includes(r.id)));
      return true;
    },
    saveProfile: async () => true,
    deleteProfile: async () => true,
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="page-shell">
        <SalesPage branches={BRANCHES} menus={MENUS} modifierRules={RULES} onNavigate={(t) => alert(`ไปหน้า ${t}`)} demoData={data} />
        <section className="mt-10 rounded-2xl border border-border bg-card p-4">
          <h2 className="mb-2 text-sm font-semibold">ตัวอย่างบิล LINE MAN ที่ POS ไม่ส่งรหัสเมนู (คัดลอกไปวาง)</h2>
          <textarea id="sample-lineman" readOnly rows={4} value={SAMPLE} className="w-full rounded-xl border border-border bg-background p-2 font-mono text-xs" />
        </section>
        <section id="write-log" className="mt-10 rounded-2xl border border-border bg-card p-4">
          <h2 className="mb-2 text-sm font-semibold">สิ่งที่จะเขียนลงฐานข้อมูล (ทดสอบ)</h2>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs">{log.join("\n") || "—"}</pre>
        </section>
      </div>
    </div>
  );
}
