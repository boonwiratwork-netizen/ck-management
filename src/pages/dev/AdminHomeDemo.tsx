import { useMemo } from "react";
import AdminHome from "@/pages/AdminHome";
import type { AdminLoader } from "@/hooks/use-admin-home";
import type { AdminMasters, AdminRaw } from "@/lib/admin-home";
import { daysBetween, weekStartOf } from "@/lib/team-score";
import { shiftDay } from "@/lib/day-follow";
import type { SKU } from "@/types/sku";
import type { Branch } from "@/types/branch";

/**
 * Dev harness for /dev/admin — MADE-UP rows (clearly marked on the page), never the
 * database: 6 branches (one with a very long name, one doing badly), the kitchen, RD.
 * Shows the real page and the real score engine on fixed data at a fixed clock.
 */
const TODAY = "2026-11-06";
const NOW = Date.parse(`${TODAY}T10:00:00+07:00`);

const sku = (id: string, code: string, name: string, type: SKU["type"], packSize = 1): SKU => ({
  id,
  skuId: code,
  name,
  type,
  category: "",
  status: "Active",
  specNote: "",
  packSize,
  packUnit: "",
  purchaseUom: "ก.",
  usageUom: "ก.",
  converter: 1,
  storageCondition: "Chilled",
  shelfLife: 0,
  vat: false,
  supplier1: "",
  supplier2: "",
  leadTime: 0,
  isDistributable: false,
});

const SKUS: SKU[] = [sku("s1", "SM-0001", "ชาชูหมู", "SM", 1000), sku("s2", "RM-0002", "เนยจืด", "RM"), sku("s3", "SM-0003", "ไข่ดอง", "SM"), sku("s4", "RM-0004", "เส้นราเมน", "RM"), sku("s5", "RM-0005", "หมูสามชั้น", "RM")];
const BR = (id: string, branchName: string, brandName: string): Branch => ({ id, branchName, brandName, location: "", status: "Active", avgSellingPrice: null });
const BRANCHES: Branch[] = [
  BR("b1", "Thaniya", "Sendo"),
  BR("b2", "ไก่สวรรค์ เซ็นทรัลเวิลด์ ชั้น 7 โซนอาหารญี่ปุ่น", "Sendo"),
  BR("b3", "สยามสแควร์วัน", "Shiro"),
  BR("b4", "เอกมัย", "Wanmai"),
  BR("b5", "อารีย์", "Thaniya"),
  BR("b6", "บางนา", "Shiro"),
];

const MASTERS: AdminMasters = {
  skus: SKUS,
  prices: SKUS.map((s, i) => ({ id: `p${i}`, skuId: s.id, supplierId: "sup", pricePerPurchaseUom: 0, pricePerUsageUom: [0.32, 0.4, 0.12, 0.09, 0.28][i], vat: false, isActive: true, effectiveDate: "2026-01-01", note: "" })),
  menus: [{ id: "m1", menuCode: "MN-001", menuName: "ราเมนชาชู", category: "Ramen", sellingPrice: 189, status: "Active", brandName: "Sendo", isMaindish: true }],
  menuBomLines: [
    { id: "l1", menuId: "m1", skuId: "s1", qtyPerServing: 60, uom: "ก.", yieldPct: 100, effectiveQty: 60, costPerServing: 0 },
    { id: "l2", menuId: "m1", skuId: "s4", qtyPerServing: 140, uom: "ก.", yieldPct: 100, effectiveQty: 140, costPerServing: 0 },
    { id: "l3", menuId: "m1", skuId: "s2", qtyPerServing: 5, uom: "ก.", yieldPct: 100, effectiveQty: 5, costPerServing: 0 },
  ],
  modifierRules: [],
  spBomLines: [],
  branches: BRANCHES,
};

/** How each branch behaves (b3 is the one with problems) */
const late = (b: string, i: number) => (b === "b3" ? i % 2 === 0 : b === "b1" ? i % 9 === 0 : false);

function makeRaw(readFrom: string): Omit<AdminRaw, "today" | "nowMs" | "readFrom"> {
  const raw: Omit<AdminRaw, "today" | "nowMs" | "readFrom"> = { sales: [], counts: [], tos: [], toLines: [], receipts: [], plans: [], production: [], bills: [], priceChanges: [], recipeCopies: [], corrections: [] };
  const days = daysBetween(readFrom, shiftDay(TODAY, -1));
  days.forEach((day, i) => {
    for (const b of BRANCHES) {
      const bad = b.id === "b3";
      // Sales: 40 bowls, imported next morning (b3 skips one day in five)
      if (!(bad && i % 5 === 0))
        for (let k = 0; k < 4; k++) raw.sales.push({ sale_date: day, branch_id: b.id, menu_code: "MN-001", menu_name: "ราเมนชาชู", qty: 10, net_amount: 1890 + (b.id.charCodeAt(1) * 37) % 400, receipt_no: `${day}-${k}`, created_at: `${day}T14:00:00Z` });
      // Count: closed 22:00 (late ones 23:40), b3's difference big every other day
      const at = `${day}T${late(b.id, i) ? "16:40" : "15:00"}:00Z`;
      SKUS.forEach((s, k) =>
        raw.counts.push({ branch_id: b.id, count_date: day, sku_id: s.id, physical_count: 1000, variance: bad && i % 2 === 1 ? -2200 - k * 300 : -150 + k * 40, waste: k === 0 ? (bad ? 40 : 8) : 0, expected_usage: 2000, is_submitted: true, submitted_at: at }),
      );
      // A transfer order every other day; b3 receives late
      if (i % 2 === 0) {
        const id = `to-${b.id}-${day}`;
        raw.tos.push({ id, branch_id: b.id, to_number: `TO-${day.replace(/-/g, "").slice(2)}-${b.id}`, status: "Received", sent_at: `${day}T01:00:00Z`, delivery_date: day, total_value: 4003 });
        raw.receipts.push({ transfer_order_id: id, created_at: bad ? `${shiftDay(day, 2)}T03:00:00Z` : `${day}T07:00:00Z` });
        raw.toLines.push({ to_id: id, sku_id: "s1", tr_line_id: `tr-${id}`, planned_qty: 3000, actual_qty: i % 6 === 0 ? 1200 : 3000, packs_count: i % 6 === 0 ? 1 : 3, unit_cost: 0.34, uom: "ก." });
      }
    }
    raw.production.push({ sm_sku_id: "s1", production_date: day, actual_output_g: i % 4 === 0 ? 7000 : 10000 });
    raw.bills.push({ supplier_id: "sup", receipt_date: day, created_at: i % 10 === 0 ? `${shiftDay(day, 1)}T03:00:00Z` : `${day}T04:00:00Z` });
  });
  for (let w = weekStartOf(readFrom); w <= TODAY; w = shiftDay(w, 7)) raw.plans.push({ week_start: w, sku_id: "s1", planned_qty_uom: 70000 });
  // Still waiting: sent 2 days ago to b3, not received
  raw.tos.push({ id: "to-open", branch_id: "b3", to_number: "TO-2026-11-005", status: "Sent", sent_at: `${shiftDay(TODAY, -2)}T01:00:00Z`, delivery_date: shiftDay(TODAY, -2), total_value: 4003 });
  // เนยจืด up 14% three days ago
  raw.priceChanges.push({ skuId: "s2", pricePerUsageUom: 0.35, validFrom: "2026-09-01T00:00:00Z" }, { skuId: "s2", pricePerUsageUom: 0.4, validFrom: `${shiftDay(TODAY, -3)}T03:00:00Z` });
  return raw;
}

export default function AdminHomeDemo() {
  const loader = useMemo<AdminLoader>(
    () => ({
      load: async (_ids, _today, readFrom) => {
        await new Promise((r) => setTimeout(r, 150));
        return makeRaw(readFrom);
      },
      costGaps: async (months) => months.map((m) => (m === "2026-10-01" ? { month: m, pct: 1.2, count: "pass" as const } : { month: m, pct: null, why: "ไม่มีผลนับวัตถุดิบปลายช่วง (ตัวอย่าง)", count: "fail" as const })),
    }),
    [],
  );
  return (
    <div className="min-h-screen bg-background px-4 py-4">
      <p className="mx-auto mb-3 max-w-[640px] rounded-xl bg-warning-soft px-3 py-2 text-xs font-semibold text-warning">DEV · ข้อมูลตัวอย่างที่แต่งขึ้น ไม่ใช่ข้อมูลจริง</p>
      <AdminHome masters={MASTERS} demo={{ loader, today: TODAY, nowMs: NOW }} />
    </div>
  );
}
