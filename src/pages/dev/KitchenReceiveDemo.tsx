import { useState } from "react";
import type { SKU } from "@/types/sku";
import type { Supplier } from "@/types/supplier";
import type { Price } from "@/types/price";
import type { GoodsReceipt } from "@/types/goods-receipt";
import type { useGoodsReceiptData } from "@/hooks/use-goods-receipt-data";
import KitchenReceivePage from "@/pages/KitchenReceive";

/**
 * Dev-only harness (route exists only under `npm run dev`): the kitchen receiving
 * screens on made-up bills shaped like the real ones. Saving stays in memory.
 */
const sku = (id: string, name: string, std: number, uom = "ก.", type = "RM"): [SKU, Price] => [
  { id, skuId: id, name, type, packSize: 1000, packUnit: "", usageUom: uom, purchaseUom: uom, status: "Active", isDistributable: false, converter: 1 } as unknown as SKU,
  { id: `p-${id}`, skuId: id, supplierId: "fk", pricePerPurchaseUom: std, pricePerUsageUom: std, vat: false, isActive: true, effectiveDate: "2026-03-23", note: "" },
];
const ITEMS = [sku("skin", "หนังไก่", 0.064), sku("breast", "อกไก่บด", 0.1), sku("hom", "ต้นหอมไทย", 0.1), sku("fat", "มันหมูบดหยาบ", 0.094), sku("pot", "มันฝรั่ง", 0.032), sku("oba", "ใบโอบะ", 1.5, "ใบ"), sku("ginger", "ขิงแก่", 0.1), sku("pork", "เนื้อหมูบด", 0.116)];
const SKUS = ITEMS.map((i) => i[0]);
const PRICES = ITEMS.map((i) => i[1]);
const SUPPLIERS = [
  { id: "fk", name: "Freshket (เฟรชเก็ต)" },
  { id: "kt", name: "ไก่ตลาดคลองเตย" },
  { id: "kb", name: "Kobeya (โกเบย่า)" },
  { id: "pc", name: "Pitcha (พิทชา)" },
  { id: "mk", name: "Makro Pro (แมคโคร)" },
].map((s) => ({ ...s, leadTime: 1, moq: 0, moqUnit: "", contactPerson: "", phone: "", creditTerms: "", status: "Active" }) as unknown as Supplier);
const today = new Date().toISOString().slice(0, 10);
let n = 0;
const rec = (skuId: string, supplierId: string, date: string, qty: number, total: number, std: number, created?: string, note = ""): GoodsReceipt => ({
  id: `r${n++}`,
  receiptDate: date,
  weekNumber: 43,
  skuId,
  supplierId,
  quantityReceived: qty,
  usageUom: "ก.",
  actualTotal: total,
  actualUnitPrice: total / qty,
  stdUnitPrice: std,
  standardPrice: std * qty,
  priceVariance: total - std * qty,
  note,
  createdAt: created ?? `${date}T02:10:00Z`,
});
const START: GoodsReceipt[] = [
  rec("skin", "fk", today, 20000, 1400, 0.064, `${today}T02:12:00Z`),
  rec("skin", "fk", "2026-10-19", 20000, 1380, 0.064),
  rec("breast", "fk", "2026-10-23", 5000, 565, 0.1),
  rec("breast", "fk", "2026-10-19", 5000, 560, 0.1),
  rec("hom", "fk", "2026-10-23", 1000, 150, 0.1),
  rec("hom", "fk", "2026-10-16", 1000, 220, 0.1),
  rec("fat", "fk", "2026-10-23", 2000, 202, 0.094),
  rec("oba", "fk", "2026-10-23", 10, 20, 1.5),
  rec("ginger", "fk", "2026-10-22", 1000, 75, 0.1, "2026-10-24T03:15:00Z"),
  rec("ginger", "fk", "2026-10-14", 1000, 75, 0.1),
  rec("skin", "kt", today, 3000, 2180, 0.7),
  rec("pork", "fk", "2026-10-24", 2000, 0, 0.116, undefined, "[Supplier: ของเคลม / ของแถม] หมูเคลม"),
];

export default function KitchenReceiveDemo() {
  const [receipts, setReceipts] = useState<GoodsReceipt[]>(START);
  const data = {
    receipts,
    addReceipt: async () => undefined,
    addReceipts: async (rows: { data: Omit<GoodsReceipt, "id" | "weekNumber" | "usageUom" | "stdUnitPrice" | "standardPrice" | "priceVariance" | "actualUnitPrice">; sku: SKU | undefined }[], prices: Price[]) => {
      setReceipts((p) => [
        ...rows.map(({ data: d }) => {
          const std = prices.find((x) => x.skuId === d.skuId && x.supplierId === d.supplierId)?.pricePerUsageUom ?? 0;
          return rec(d.skuId, d.supplierId, d.receiptDate, d.quantityReceived, d.actualTotal, std, new Date().toISOString(), d.note);
        }),
        ...p,
      ]);
      return true;
    },
    updateReceipt: async () => true,
    editReceipt: async (r: GoodsReceipt, qty: number, total: number, note: string) => {
      setReceipts((p) => p.map((x) => (x.id === r.id ? { ...x, quantityReceived: qty, actualTotal: total, note } : x)));
      return true;
    },
    deleteReceipt: async (id: string) => {
      setReceipts((p) => p.filter((r) => r.id !== id));
      return true;
    },
    isFullHistory: false,
    loadAllHistory: async () => undefined,
    isLoadingAll: false,
    fetchReceipts: async () => undefined,
  } as unknown as ReturnType<typeof useGoodsReceiptData>;
  return (
    <div className="min-h-screen bg-background">
      <div className="page-shell">
        <KitchenReceivePage receiptData={data} skus={SKUS} suppliers={SUPPLIERS} prices={PRICES} />
      </div>
    </div>
  );
}
