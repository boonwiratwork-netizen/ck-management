import { useMemo } from "react";
import Reconcile from "@/pages/Reconcile";
import type { ReconcileLoader, ReconcileMasters } from "@/hooks/use-reconcile";
import { kitchenRows, type RcCount, type RcSale } from "@/lib/reconcile";
import type { KitchenResult } from "@/lib/reconcile-kitchen";
import { daysBetween } from "@/lib/team-score";
import type { SKU } from "@/types/sku";
import type { Branch } from "@/types/branch";

/**
 * Dev harness for /dev/reconcile — MADE-UP rows (marked on the page), never the database.
 * Covers every label: หลายสาขาเหมือนกัน (เส้นราเมน), หน้าร้าน (ชาชูหมู opposite ways; เนยจืด one
 * branch), ใกล้สูตร (ไข่ดอง), ข้อมูลนับผิด (ต้นหอม), a bottle-bought sauce received in
 * bottles (× converter), Shiro with no sheet on 2 and 5 Nov and one sheet counted before
 * the sales came in, a long branch name (3 branch columns scroll on a phone), and the kitchen.
 */
const TODAY = "2026-11-08";

const sku = (id: string, code: string, name: string, type: SKU["type"], purchaseUom = "ก.", converter = 1): SKU => ({
  id,
  skuId: code,
  name,
  type,
  category: "",
  status: "Active",
  specNote: "",
  packSize: 1,
  packUnit: "",
  purchaseUom,
  usageUom: "ก.",
  converter,
  storageCondition: "Chilled",
  shelfLife: 0,
  vat: false,
  supplier1: "",
  supplier2: "",
  leadTime: 0,
  isDistributable: false,
});

const SKUS: SKU[] = [
  sku("s1", "SM-0101", "เส้นราเมน", "SM"),
  sku("s2", "SM-0102", "ชาชูหมู", "SM"),
  sku("s3", "SM-0103", "ไข่ดองโชยุ", "SM"),
  sku("s4", "RM-0104", "ต้นหอมซอย", "RM"),
  sku("s5", "RM-0105", "เนยจืด", "RM"),
  sku("s6", "RM-0106", "ซอสโชยุญี่ปุ่น ขวดใหญ่", "RM", "ขวด", 1000),
  sku("k1", "RM-0201", "หมูสามชั้น", "RM"),
  sku("k2", "RM-0202", "กระดูกหมู", "RM"),
  sku("k3", "RM-0203", "ซีอิ๊วขาว", "RM"),
  sku("k4", "RM-0204", "น้ำตาลทราย", "RM"),
];
const PRICE: Record<string, number> = { s1: 0.06, s2: 0.42, s3: 0.12, s4: 0.08, s5: 0.4, s6: 0.09, k1: 0.19, k2: 0.05, k3: 0.07, k4: 0.03 };
const BR = (id: string, branchName: string, brandName: string): Branch => ({ id, branchName, brandName, location: "", status: "Active", avgSellingPrice: null });
const BRANCHES: Branch[] = [BR("b1", "Thaniya", "Thaniya"), BR("b2", "Shiro", "Shiro"), BR("b3", "Sendo เซ็นทรัลเวิลด์ ชั้น 7", "Sendo")];
const MENUS = [
  { id: "m1", menuCode: "MN-T01", menuName: "ทานิยะราเมนชาชู", brand: "Thaniya" },
  { id: "m2", menuCode: "MN-S01", menuName: "ชิโระราเมน", brand: "Shiro" },
  { id: "m3", menuCode: "MN-D01", menuName: "เซ็นโดะโชยุราเมน", brand: "Sendo" },
];
/** Grams per serving of each item in every brand's ramen */
const PER: Record<string, number> = { s1: 140, s2: 60, s3: 50, s4: 10, s5: 5, s6: 20 };
const SOLD_PER_DAY = 40;

const MASTERS: ReconcileMasters = {
  skus: SKUS,
  prices: SKUS.map((s, i) => ({ id: `p${i}`, skuId: s.id, supplierId: "sup", pricePerPurchaseUom: 0, pricePerUsageUom: PRICE[s.id], vat: false, isActive: true, effectiveDate: "2026-01-01", note: "" })),
  menus: MENUS.map((m) => ({ id: m.id, menuCode: m.menuCode, menuName: m.menuName, category: "Ramen", sellingPrice: 189, status: "Active", brandName: m.brand, isMaindish: true })),
  menuBomLines: MENUS.flatMap((m) => Object.entries(PER).map(([skuId, q], i) => ({ id: `${m.id}-${i}`, menuId: m.id, skuId, qtyPerServing: q, uom: "ก.", yieldPct: 100, effectiveQty: q, costPerServing: 0, branchId: null }))),
  branches: BRANCHES,
};

/** How far each branch's use runs from the recipe, per item (+ = used more = stock short) */
const OFF: Record<string, Record<string, number>> = {
  s1: { b1: 0.24, b2: 0.2, b3: 0.3 },
  s2: { b1: 0.24, b2: -0.25, b3: 0.02 },
  s3: { b1: 0.03, b2: -0.04, b3: 0.01 },
  s4: { b1: 0.05, b2: -1.4, b3: 0.0 },
  s5: { b1: 0.45, b2: 0.05, b3: -0.03 },
  s6: { b1: -0.12, b2: 0.06, b3: 0.04 },
};

function makeRows(from: string, to: string): { counts: RcCount[]; sales: RcSale[] } {
  const counts: RcCount[] = [];
  const sales: RcSale[] = [];
  for (const b of BRANCHES) {
    const menu = MENUS.find((m) => m.brand === b.brandName)!;
    for (const d of daysBetween(from, to)) {
      // Shiro: no count sheet on 2 and 5 Nov (sales came in), and 3 Nov counted in the morning
      const noSheet = b.id === "b2" && (d === "2026-11-02" || d === "2026-11-05");
      const early = b.id === "b2" && d === "2026-11-03";
      sales.push({ branch_id: b.id, sale_date: d, created_at: `${d}T${early ? "20" : "15"}:00:00+07:00`, net_amount: SOLD_PER_DAY * 189, menu_code: menu.menuCode, qty: SOLD_PER_DAY });
      if (noSheet) continue;
      for (const [id, per] of Object.entries(PER)) {
        const expected = per * SOLD_PER_DAY;
        counts.push({
          branch_id: b.id,
          count_date: d,
          sku_id: id,
          physical_count: 500,
          variance: -expected * OFF[id][b.id],
          waste: id === "s2" ? 40 : id === "s4" ? 15 : 0,
          expected_usage: expected,
          is_submitted: true,
          submitted_at: `${d}T${early ? "08" : "22"}:00:00+07:00`,
          received_from_ck: id === "s1" || id === "s2" || id === "s3" ? expected : 0,
          // The sauce comes in bottles: stored as bought (1 bottle = 1,000 ก.)
          received_external: id === "s6" ? 1 : id === "s4" || id === "s5" ? expected : 0,
        });
      }
    }
  }
  return { counts, sales };
}

const KITCHEN: KitchenResult = {
  kind: "rows",
  opening: "2026-09-30",
  closing: "2026-10-31",
  uncounted: 1,
  rows: kitchenRows({
    lines: [
      { skuId: "k1", isRm: true, expected: 182_000, actual: null },
      { skuId: "k2", isRm: true, expected: 410_000, actual: null },
      { skuId: "k3", isRm: true, expected: 36_000, actual: null },
      { skuId: "k4", isRm: true, expected: 9_000, actual: null },
    ],
    rmUsed: new Map([
      ["k1", 201_500],
      ["k2", 398_000],
      ["k3", 26_500],
      ["k4", 9_000],
    ]),
    uncounted: new Set(["k4"]),
    skus: SKUS.map((s) => ({ id: s.id, code: s.skuId, name: s.name, purchaseUom: s.purchaseUom, usageUom: s.usageUom, converter: s.converter })),
    price: (id) => PRICE[id] ?? 0,
    opening: "2026-09-30",
    closing: "2026-10-31",
  }),
};

export default function ReconcileDemo() {
  const loader = useMemo<ReconcileLoader>(
    () => ({
      load: async (_ids, from, to) => {
        await new Promise((r) => setTimeout(r, 150));
        return makeRows(from, to);
      },
    }),
    [],
  );
  return (
    <div className="min-h-screen bg-background px-4 py-4">
      <p className="mx-auto mb-3 max-w-[960px] rounded-xl bg-warning-soft px-3 py-2 text-xs font-semibold text-warning">DEV · ข้อมูลตัวอย่างที่แต่งขึ้น ไม่ใช่ข้อมูลจริง</p>
      <Reconcile masters={MASTERS} demo={{ loader, today: TODAY, kitchen: KITCHEN }} />
    </div>
  );
}
