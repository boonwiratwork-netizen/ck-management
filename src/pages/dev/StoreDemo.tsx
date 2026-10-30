import { useEffect, useMemo, useState } from "react";
import StoreStockPage from "@/pages/StoreStock";
import StoreOverview from "@/pages/StoreOverview";
import type { BranchStockLoader } from "@/hooks/use-branch-stock";
import type { SKU } from "@/types/sku";
import type { Branch } from "@/types/branch";

/**
 * Dev harness for /dev/store (?v=overview for the day view): live SKUs/branches
 * (fixture) and Thaniya's real 29 Oct count with that day's expected use.
 */
const REAL: [string, number, number][] = [
  ["SM-0051", 14050, 3000],
  ["SM-0013", 9122, 2787],
  ["SM-0014", 10537, 2578],
  ["SM-0015", 9656, 1444],
  ["SM-0008", 2863, 900],
  ["SM-0006", 1135, 878],
  ["RM-0055", 6250, 575],
  ["RM-0167", 3051, 563],
  ["RM-0027", 2156, 557],
  ["SM-0007", 1881, 556],
  ["RM-0006", 2669, 525],
  ["RM-0171", -12, 40],
];

export default function StoreDemo() {
  const [fx, setFx] = useState<{ skus: SKU[]; branches: Branch[] } | null>(null);
  useEffect(() => {
    fetch("/fixtures.local/menu-setup.json")
      .then((r) => r.json())
      .then((d) => setFx({ skus: d.skus.map((s: SKU) => ({ ...s, storageCondition: s.skuId.startsWith("SM") ? "Frozen" : "Chilled" })), branches: d.branches }));
  }, []);
  const loader = useMemo<BranchStockLoader | null>(() => {
    if (!fx) return null;
    const id = (code: string) => fx.skus.find((s) => s.skuId === code)?.id ?? code;
    return {
      load: async () => {
        await new Promise((r) => setTimeout(r, 200));
        const usage: Record<string, Record<string, number>> = {};
        for (const [c, , u] of REAL) usage[id(c)] = Object.fromEntries([24, 25, 26, 27, 28, 29].map((d) => [`2026-10-${d}`, u]));
        return {
          counts: REAL.map(([c, q]) => ({ sku_id: id(c), count_date: "2026-10-29", physical_count: q })),
          receipts: [],
          adjustments: [],
          waste: [],
          usageByDay: usage,
          sellingDays: 6,
          prices: new Map(REAL.map(([c]) => [id(c), 0.15])),
        };
      },
    };
  }, [fx]);
  if (!fx || !loader) return <div className="p-6 text-muted-foreground">กำลังโหลดข้อมูลตัวอย่าง…</div>;
  const overview = new URLSearchParams(location.search).get("v") === "overview";
  return (
    <div className="min-h-screen bg-background px-4 py-4 md:p-6">
      {overview ? (
        <StoreOverview
          branches={fx.branches}
          onNavigate={(t) => alert(`ไปหน้า ${t}`)}
          load={async (ids) =>
            Object.fromEntries(
              ids.map((b, i) => [
                b,
                i === 0
                  ? { salesYesterday: null, salesMonth: 1_210_000, countYesterday: "done" as const, toReceive: 0, low: [] }
                  : { salesYesterday: 16522, salesMonth: 551_699, countYesterday: "done" as const, toReceive: 1, low: [{ name: "สันคอหมูชาชู ซูวีด์ รมควัน", days: 1.3 }] },
              ]),
            )
          }
        />
      ) : (
        <StoreStockPage skus={fx.skus} branches={fx.branches} loader={loader} write={async (rows) => (alert(JSON.stringify(rows, null, 1)), true)} />
      )}
    </div>
  );
}
