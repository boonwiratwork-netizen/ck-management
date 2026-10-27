import { useState } from "react";
import KitchenStockPage from "@/pages/KitchenStock";
import type { SKU } from "@/types/sku";
import type { StockType } from "@/lib/kitchen-stock-view";
import type { KitchenItemStock } from "@/hooks/use-kitchen-item-stock";

/** Dev harness for /dev/kitchen-stock: numbers from the live kitchen, 26–27 Oct 2026 */
const sku = (id: string, skuId: string, name: string, type: "RM" | "SM" | "PK", storage: string, over: Partial<SKU> = {}) =>
  ({ id, skuId, name, type, status: "Active", storageCondition: storage, usageUom: "ก.", category: type === "PK" ? "PK" : "MT", isDistributable: false, converter: 1, packSize: 1000, packUnit: "แพ็ค", ...over }) as unknown as SKU;

const SKUS: SKU[] = [
  sku("sm5", "SM-0005", "อกเป็ดชาชู ซูวีด์ รมควัน", "SM", "Frozen"),
  sku("sm52", "SM-0052", "น้ำมันทงคตสึ", "SM", "Chilled"),
  sku("sm2", "SM-0002", "น้ำมันไก่", "SM", "Frozen"),
  sku("sm16", "SM-0016", "น้ำสต๊อกโทริ ไพตัน", "SM", "Chilled"),
  sku("sm51", "SM-0051", "ซุปทงคตสึ", "SM", "Chilled"),
  sku("sm13", "SM-0013", "ซุปโทริ ไพตัน", "SM", "Chilled"),
  sku("rm36", "RM-0036", "หอยตลับ (ทั้งเปลือก) ตราเฟรชเก็ต", "RM", "Chilled", { status: "Inactive", category: "SF" }),
  sku("rm97", "RM-0097", "หอยตลับสด (ทั้งเปลือก) ฟาร์มพี่ยม", "RM", "Chilled", { category: "SF" }),
  sku("rm40", "RM-0040", "โครงไก่", "RM", "Frozen"),
  sku("rm44", "RM-0044", "หมูสันนอก (ติดมัน เต็มเส้น เก็บชาย)", "RM", "Frozen", { isDistributable: true }),
  sku("pk1", "PK-0001", "ชามกระดาษ Eco พร้อมฝา PP + ช่องแบ่ง 1 ช่อง 850 ml", "PK", "Ambient", { usageUom: "ใบ" }),
];
const SM = { sm5: [1653, 0.296, 1 / 7 * 3895, "2026-09-30", "2026-10-22"], sm52: [1000, 0.156, 271, "2026-09-30", "2026-10-20"], sm2: [28949, 0.0574, 337, "2026-09-30", "2026-10-23"], sm16: [361455, 0.0574, 0, null, null], sm51: [71000, 0.0685, 4629, "2026-09-30", "2026-10-24"], sm13: [31100, 0.1088, 2629, "2026-09-30", "2026-10-19"] } as const;
const ITEM = { rm36: [18000, 0.052, 210, "2026-09-30", "2026-10-23", "fk"], rm97: [-28000, 0.0543, 1167, "2026-09-30", "2026-10-08", "py"], rm40: [52000, 0.03, 3100, "2026-09-30", "2026-10-25", "fk"], rm44: [0, 0.19, 67, "2026-09-30", "2026-10-20", "fk"], pk1: [420, 4.2, 35, "2026-08-31", "2026-10-02", "fk"] } as const;

const itemHook = (type: "RM" | "PK"): KitchenItemStock =>
  ({
    stockBalances: Object.entries(ITEM).filter(([id]) => SKUS.find((s) => s.id === id)?.type === type).map(([id, v]) => ({ skuId: id, currentStock: v[0], adjustments: [], openingStock: 0, totalReceived: 0, totalConsumed: 0 })),
    getStdUnitPrice: (id: string) => ITEM[id as keyof typeof ITEM]?.[1] ?? 0,
    usagePerDay: (id: string) => ITEM[id as keyof typeof ITEM]?.[2] ?? 0,
    getAnchor: (id: string) => (ITEM[id as keyof typeof ITEM]?.[3] ? { physical_qty: 0, count_date: ITEM[id as keyof typeof ITEM][3], completed_at: null, timing: "after" } : null),
    movesAfterCount: () => 9,
    getLastReceipt: (id: string) => ({ date: ITEM[id as keyof typeof ITEM][4], supplierId: ITEM[id as keyof typeof ITEM][5], skuId: id, qty: 0 }),
    addAdjustment: async () => true,
  }) as unknown as KitchenItemStock;

export default function KitchenStockDemo() {
  const [type, setType] = useState<StockType>(() => (new URLSearchParams(location.search).get("t") as StockType) || "SM");
  const sm = {
    stockBalances: Object.entries(SM).map(([id, v]) => ({ skuId: id, currentStock: v[0], adjustments: [], openingStock: 0, totalProduced: 0, totalDelivered: 0 })),
    getBomCostPerGram: (id: string) => SM[id as keyof typeof SM][1],
    getAnchor: (id: string) => (SM[id as keyof typeof SM][3] ? { physical_qty: 0, count_date: SM[id as keyof typeof SM][3]!, completed_at: null, timing: "after" as const } : null),
    movesAfterCount: () => 12,
    getLastProductionDate: (id: string) => SM[id as keyof typeof SM][4],
    addAdjustment: async () => true,
  };
  return (
    <div className="page-shell p-6">
      <KitchenStockPage
        type={type}
        onType={setType}
        skus={SKUS}
        suppliers={[{ id: "fk", name: "Freshket" }, { id: "py", name: "ฟาร์มพี่ยม" }] as never}
        categories={[{ id: "1", code: "MT", nameEn: "Meat", nameTh: "เนื้อสัตว์" }, { id: "2", code: "SF", nameEn: "Seafood", nameTh: "อาหารทะเล" }, { id: "3", code: "PK", nameEn: "Packaging", nameTh: "บรรจุภัณฑ์" }]}
        bomHeaders={[{ id: "h", smSkuId: "sm13" }] as never}
        bomLines={[{ bomHeaderId: "h", rmSkuId: "rm40" }, { bomHeaderId: "h", rmSkuId: "rm97" }, { bomHeaderId: "h", rmSkuId: "rm36" }] as never}
        rm={itemHook("RM")}
        pk={itemHook("PK")}
        sm={sm as never}
        smDailyUsage={Object.fromEntries(Object.entries(SM).map(([id, v]) => [id, v[2]]))}
        canEdit
      />
    </div>
  );
}
