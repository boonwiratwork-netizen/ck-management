import { useState } from "react";
import type { SKU } from "@/types/sku";
import type { BOMHeader } from "@/types/bom";
import type { ProductionRecord } from "@/types/production";
import type { useProductionData } from "@/hooks/use-production-data";
import ProducePage from "@/pages/Produce";

/**
 * Dev-only harness (route exists only under `npm run dev`): the production screens
 * on made-up kitchen figures. Saving stays in memory; the weekly plan isn't loaded.
 */
const sm = (id: string, name: string): SKU => ({ id, skuId: id, name, type: "SM", status: "Active", usageUom: "ก.", purchaseUom: "ก.", packSize: 1000, packUnit: "แพ็ค" }) as unknown as SKU;
const SKUS = [sm("soup", "ซุปทงคตสึ"), sm("tori", "ซุปโทริ ไพตัน"), sm("duck", "อกเป็ดชาชู ซูวีด์ รมควัน"), sm("neck", "สันคอหมูชาชู ซูวีด์ รมควัน"), sm("oil", "น้ำมันชิโอะ"), sm("x", "ซอสใหม่ (ยังไม่มีสูตร)")];
const PER: Record<string, number> = { soup: 33000, tori: 33000, duck: 3300, neck: 1200, oil: 3000 };
const HEADERS = Object.keys(PER).map((id) => ({ id: `h-${id}`, smSkuId: id, productionType: "CK", bomMode: "simple", batchSize: PER[id], yieldPercent: 1 }) as BOMHeader);
const today = new Date().toISOString().slice(0, 10);

export default function ProduceDemo() {
  const [records, setRecords] = useState<ProductionRecord[]>([
    { id: "r1", planId: "p", productionDate: today, smSkuId: "tori", batchesProduced: 1, actualOutputG: 31900, createdAt: new Date().toISOString(), notes: "" },
  ]);
  const data = {
    plans: [],
    records,
    addPlan: async () => "p",
    updatePlan: async () => undefined,
    deletePlan: async () => undefined,
    addRecord: async (d: { smSkuId: string; productionDate: string; actualOutputG: number; notes?: string }) => {
      const id = `r${Date.now()}`;
      setRecords((p) => [{ id, planId: "p", productionDate: d.productionDate, smSkuId: d.smSkuId, batchesProduced: 1, actualOutputG: d.actualOutputG, createdAt: new Date().toISOString(), notes: d.notes }, ...p]);
      return id;
    },
    updateRecordWithDelta: async (id: string, d: { productionDate: string; actualOutputG: number; notes?: string }) => {
      setRecords((p) => p.map((r) => (r.id === id ? { ...r, ...d } : r)));
      return true;
    },
    deleteRecord: async (id: string) => {
      setRecords((p) => p.filter((r) => r.id !== id));
      return true;
    },
    getRecordsForPlan: () => [],
    getTotalProducedForPlan: () => 0,
    getOutputPerBatch: (id: string) => PER[id] ?? 0,
  } as unknown as ReturnType<typeof useProductionData>;
  return (
    <div className="min-h-screen bg-background">
      <div className="page-shell">
        <ProducePage
          productionData={data}
          skus={SKUS}
          bomHeaders={HEADERS}
          bomLines={[]}
          bomSteps={[]}
          smStockBalances={[
            { skuId: "soup", currentStock: 8000 },
            { skuId: "tori", currentStock: 31100 },
            { skuId: "duck", currentStock: 1653 },
            { skuId: "neck", currentStock: 7110 },
            { skuId: "oil", currentStock: 3000 },
          ] as never}
          smDailyUsage={{ soup: 4000, tori: 2400, duck: 470, neck: 1270, oil: 230 }}
          demoCanEdit
        />
      </div>
    </div>
  );
}
