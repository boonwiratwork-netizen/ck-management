import { useMemo, useState } from "react";
import DailyCountPage from "@/pages/DailyCount";
import type { SKU } from "@/types/sku";
import type { Branch } from "@/types/branch";
import type { Menu } from "@/types/menu";
import type { DailyStockCountRow, useDailyStockCount } from "@/hooks/use-daily-stock-count";
import type { CountStatus, useCountStatus } from "@/hooks/use-count-status";
import { businessDate } from "@/lib/stock-count";

/**
 * Dev-only harness (route exists only under `npm run dev`): the count page on
 * made-up products with an in-memory sheet. ?open=1 adds two unfinished days,
 * ?sales=0 pretends sales weren't imported, ?offline=1 makes every save wait.
 */
const sku = (id: string, name: string, storage: SKU["storageCondition"], uom = "ก.", p: Partial<SKU> = {}): SKU =>
  ({ id, skuId: id.toUpperCase(), name, type: "RM", status: "Active", category: "", specNote: "", packSize: 1, packUnit: "", purchaseUom: uom, usageUom: uom, converter: 1, storageCondition: storage, shelfLife: 0, vat: false, supplier1: "", supplier2: "", leadTime: 1, isDistributable: false, ...p }) as SKU;
const SKUS: SKU[] = [
  sku("rm-0044", "หมูสันนอก (ติดมัน เต็มเส้น เก็บชาย)", "Frozen", "ก.", { packSize: 1000, packUnit: "แพ็ค" }),
  sku("rm-0051", "ไข่ปลาหมึกกระดอง", "Frozen", "ก.", { packSize: 1000, packUnit: "แพ็ค" }),
  sku("sm-0006", "ชาชูหมู", "Chilled"),
  sku("rm-0012", "ซอสเทริยากิ ตรายามาซ่า", "Chilled", "ก.", { packSize: 1000, packUnit: "ขวด" }),
  sku("rm-0018", "ทาเระ โชยุ", "Chilled", "ก.", { packSize: 5500, packUnit: "แกลลอน" }),
  sku("rm-0040", "ไข่ไก่ เบอร์ 2", "Chilled", "ฟอง"),
  sku("rm-0033", "มิโสะ", "Ambient"),
  sku("rm-0070", "น้ำตาลทราย", "Ambient", "ก.", { packSize: 1000, packUnit: "แพ็ค" }),
  sku("rm-0107", "ไก่พี่หมึก", "Frozen"),
  sku("rm-0114", "เบียร์สดซัปโปโร", "Chilled", "มล."),
];
const BRANCHES: Branch[] = [{ id: "thaniya", branchName: "Thaniya", brandName: "Sendo", location: "", status: "Active", avgSellingPrice: null }];
const MENUS = [{ id: "m1", menuCode: "MN-001", menuName: "x", category: "", sellingPrice: 1, status: "Active", brandName: "Sendo", isMaindish: true }] as Menu[];

const row = (id: string, opening: number, ck: number, usage: number, physical: number | null = null): DailyStockCountRow => {
  const calc = opening + ck - usage;
  return { id: `r-${id}`, branchId: "thaniya", countDate: "", skuId: id, openingBalance: opening, receivedFromCk: ck, receivedExternal: 0, expectedUsage: usage, waste: 0, calculatedBalance: calc, physicalCount: physical, variance: physical === null ? 0 : physical - calc, isSubmitted: false, submittedAt: null, adjNet: 0, adjDetails: [] };
};
const seed = (date: string) =>
  [
    row("rm-0044", 0, 2000, 67),
    row("rm-0051", 0, 0, 0, 0),
    row("sm-0006", 900, 1500, 900),
    row("rm-0012", 1200, 1000, 408),
    row("rm-0018", 9633, 0, 0),
    row("rm-0040", 60, 30, 36),
    row("rm-0033", 2600, 0, 50),
    row("rm-0070", 1040, 0, 24),
    row("rm-0107", 0, 0, 0),
    row("rm-0114", 0, 0, 0),
  ].map((r) => ({ ...r, countDate: date }));

export default function DailyCountDemo() {
  const params = new URLSearchParams(window.location.search);
  const today = businessDate(new Date());
  const [rows, setRows] = useState<DailyStockCountRow[]>([]);
  const [saveState, setSaveState] = useState<Record<string, "saving" | "waiting">>({});
  const [openDays, setOpenDays] = useState(
    params.get("open")
      ? [
          { date: "2026-10-24", counted: 0, total: 124 },
          { date: "2026-10-23", counted: 60, total: 124 },
        ]
      : [],
  );
  const [finished, setFinished] = useState(false);
  const offline = params.get("offline") === "1";
  const recalc = (r: DailyStockCountRow) => {
    const calc = r.openingBalance + r.receivedFromCk - r.expectedUsage - r.waste;
    return { ...r, calculatedBalance: calc, variance: r.physicalCount === null ? 0 : r.physicalCount - calc };
  };

  const dsc = {
    rows,
    loading: false,
    generating: false,
    loadSheet: async () => undefined,
    generateSheet: async (_b: string, date: string) => setRows(seed(date)),
    updatePhysicalCount: async (id: string, v: number | null) => {
      setRows((p) => p.map((r) => (r.id === id ? recalc({ ...r, physicalCount: v }) : r)));
      if (offline) setSaveState((s) => ({ ...s, [id]: "waiting" }));
    },
    updateWaste: async (id: string, v: number) => setRows((p) => p.map((r) => (r.id === id ? recalc({ ...r, waste: v }) : r))),
    setZero: async (ids: string[]) => setRows((p) => p.map((r) => (ids.includes(r.id) ? recalc({ ...r, physicalCount: 0 }) : r))),
    refreshCounts: async () => undefined,
    saveState,
    flushQueue: async () => !offline,
    finishDays: async () => {
      setOpenDays([]);
      return true;
    },
    deleteRow: async () => undefined,
    submitSheet: async () => {
      if (offline) return false;
      setRows((p) => p.map((r) => ({ ...r, isSubmitted: true })));
      setFinished(true);
      return true;
    },
    unlockSheet: async () => setRows((p) => p.map((r) => ({ ...r, isSubmitted: false }))),
  } as unknown as ReturnType<typeof useDailyStockCount>;

  const status: CountStatus = useMemo(
    () => ({ salesLines: params.get("sales") === "0" ? 0 : 98, receipts: 3, waitingTransfers: 1, openDays, todayFinished: finished }),
    [openDays, finished], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const statusHook = { status, loading: false, reload: async () => undefined } as ReturnType<typeof useCountStatus>;

  return (
    <div className="min-h-screen bg-background">
      <div className="page-shell">
        <DailyCountPage
          skus={SKUS}
          menuBomLines={[]}
          modifierRules={[]}
          spBomLines={[]}
          menus={MENUS}
          branches={BRANCHES}
          onNavigate={(t) => alert(`ไปหน้า ${t}`)}
          demo={{ dsc, status: statusHook, customOrder: params.get("own") ? ["rm-0033", "sm-0006", "rm-0044", "rm-0012"] : null }}
        />
        <p className="mt-8 text-xs text-muted-foreground">วันนับ: {today}</p>
      </div>
    </div>
  );
}
