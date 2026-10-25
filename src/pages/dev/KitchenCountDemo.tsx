import { useState } from "react";
import type { SKU } from "@/types/sku";
import type { StockCountLine, StockCountSession } from "@/types/stock-count";
import type { useStockCountData } from "@/hooks/use-stock-count-data";
import KitchenCountPage from "@/pages/KitchenCount";
import { countDayEvents } from "@/lib/count-anchor";

/** Dev-only harness: the kitchen count screens on made-up figures (nothing is written). */
const sku = (id: string, name: string, type: string, storage: string, uom = "ก."): SKU => ({ id, skuId: id, name, type, status: "Active", storageCondition: storage, usageUom: uom, isDistributable: type !== "SM" }) as unknown as SKU;
const SKUS = [
  sku("SM-0005", "อกเป็ดชาชู ซูวีด์ รมควัน", "SM", "Frozen"),
  sku("SM-0006", "สันคอหมูชาชู ซูวีด์ รมควัน", "SM", "Frozen"),
  sku("SM-0051", "ซุปทงคตสึ", "SM", "Chilled"),
  sku("SM-0013", "ซุปโทริ ไพตัน", "SM", "Chilled"),
  sku("RM-0101", "หนังไก่", "RM", "Frozen"),
  sku("RM-0200", "ต้นหอมไทย", "RM", "Chilled"),
  sku("RM-0300", "โชยุ ตรา YAMASA HON KAISEKI", "RM", "Ambient", "มล."),
  sku("PK-0001", "ชามกระดาษ Eco 850 ml", "PK", "Ambient", "ชิ้น"),
];
const SYS: Record<string, number> = { "SM-0005": 12400, "SM-0006": 7100, "SM-0051": 8000, "SM-0013": 31100, "RM-0101": 18200, "RM-0200": 3600, "RM-0300": 9000, "PK-0001": 400 };
const PRICE: Record<string, number> = { "SM-0006": 0.7, "RM-0200": 0.1, "PK-0001": 1.6 };

export default function KitchenCountDemo() {
  const [sessions, setSessions] = useState<StockCountSession[]>([{ id: "old", date: "2026-09-30", note: "", status: "Completed", createdAt: "2026-09-30T08:00:00Z", completedAt: "2026-09-30T08:40:00Z" }]);
  const [lines, setLines] = useState<StockCountLine[]>(SKUS.map((s) => ({ id: `old-${s.id}`, sessionId: "old", skuId: s.id, type: s.type as "SM", systemQty: SYS[s.id], physicalQty: SYS[s.id] * 0.95, variance: -SYS[s.id] * 0.05, note: "" })));
  const [saved, setSaved] = useState<string | null>(null);
  // ?quiet = a count day with nothing moving (no question); read once, the page drops the query
  const [quiet] = useState(() => new URLSearchParams(window.location.search).has("quiet"));
  const data = {
    sessions,
    lines,
    createSession: async (date: string) => {
      const id = `s-${date}`;
      setSessions((p) => [{ id, date, note: "", status: "Draft", createdAt: "2026-10-29T08:00:00Z" }, ...p]);
      setLines((p) => [...SKUS.map((s) => ({ id: `${id}-${s.id}`, sessionId: id, skuId: s.id, type: s.type as "SM", systemQty: SYS[s.id], physicalQty: null, variance: 0, note: "" })), ...p]);
      return id;
    },
    updateLine: async (id: string, v: number | null, note?: string) =>
      setLines((p) => p.map((l) => (l.id === id ? { ...l, physicalQty: v, variance: v === null ? 0 : v - l.systemQty, note: note ?? l.note } : l))),
    confirmSession: async (id: string, timing?: string) => {
      setSessions((p) => p.map((s) => (s.id === id ? { ...s, status: "Completed" } : s)));
      setSaved(timing ?? "(ไม่ส่ง)");
      return true;
    },
    softDeleteSession: async (id: string) => setSessions((p) => p.filter((s) => s.id !== id)),
    getLinesForSession: (id: string) => lines.filter((l) => l.sessionId === id),
    refreshSystemQty: async () => true,
  } as unknown as ReturnType<typeof useStockCountData>;
  return (
    <div className="min-h-screen bg-background">
      <div className="page-shell">
        {saved && <div data-demo-saved className="mb-2 rounded-lg bg-secondary px-3 py-2 text-sm">demo: count_timing = {saved}</div>}
        <KitchenCountPage
          skus={SKUS}
          stockCountData={data}
          getStdUnitPrice={(id) => PRICE[id] ?? 0.2}
          bomHeaders={[]}
          bomLines={[]}
          canEdit
          loadDayEvents={async (date) =>
            quiet
              ? []
              : countDayEvents({
                  receipts: Array.from({ length: 12 }, (_, i) => ({ supplier: "Freshket", createdAt: `${date}T02:10:${String(i).padStart(2, "0")}Z` })),
                  deliveries: [{ branch: "Shiro สีลม", lines: 11, sentAt: `${date}T02:30:00Z` }],
                  production: [{ name: "ซุปโชยุ", grams: 30000, createdAt: `${date}T07:20:00Z` }],
                  adjustments: [],
                })
          }
        />
      </div>
    </div>
  );
}
