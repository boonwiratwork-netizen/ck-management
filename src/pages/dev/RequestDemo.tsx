import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { RequestItem } from "@/hooks/use-request-data";
import { lineMessage, suggestedPacks, type Pending } from "@/lib/request-lines";
import { RequestForm } from "@/components/request/RequestForm";
import { RequestDetail, RequestHome, RequestSent, type AnyRequest } from "@/components/request/RequestViews";

/**
 * Dev-only harness (route exists only under `npm run dev`): the request screens
 * on made-up stock figures. Sending writes nothing; it shows the LINE message.
 */
const item = (code: string, name: string, stock: number, avg: number, rop: number, par: number, pack: number, uom = "ก."): RequestItem => ({
  skuId: code,
  code,
  name,
  packSize: pack,
  uom,
  packUnit: "แพ็ค",
  stockOnHand: stock,
  avgDailyUsage: avg,
  peakDailyUsage: avg * 1.5,
  rop,
  parstock: par,
  suggestedQty: Math.max(0, par - stock),
  skuType: "RM",
});
const ITEMS: RequestItem[] = [
  item("RM-0044", "หมูสันนอก (ติดมัน เต็มเส้น เก็บชาย)", 0, 67, 100, 244, 1000),
  item("RM-0021", "ดักแซล", 158, 26, 200, 376, 100),
  item("RM-0022", "ยูซุเพสต์", 173, 20, 200, 265, 100),
  item("RM-0023", "ซอสเผ็ด", 150, 15, 200, 260, 100),
  item("RM-0017", "ทาเระ ชิโอะ", 7415, 396, 2000, 4224, 5500),
  item("RM-0027", "ต้นหอมไทย", 3621, 1000, 3000, 3996, 1000),
  item("RM-0050", "ผงปลา KATSUO RAMEN YO KONGOU", 0, 0, 0, 0, 1000),
];
const PENDING = new Map<string, Pending>([["RM-0023", { qty: 200, due: "2026-10-26" }]]);
const tr = (n: string, status: string, d: string, items: number): AnyRequest => ({
  kind: "tr",
  row: { id: n, trNumber: n, branchId: "t", branchName: "Thaniya", requestedDate: d, requiredDate: d, status, notes: "", itemCount: items, createdAt: d },
});
const RECENT = [tr("TR-2026-10-017", "Submitted", "2026-10-24", 9), tr("TR-2026-10-015", "Fulfilled", "2026-10-23", 16), tr("TR-2026-10-014", "Acknowledged", "2026-10-21", 8)];

export default function RequestDemo() {
  const location = useLocation();
  const navigate = useNavigate();
  const view = location.hash.slice(1);
  const go = (v: string) => navigate({ hash: v ? `#${v}` : "" });
  const [sent, setSent] = useState<{ number: string; count: number; date: string; message: string } | null>(null);
  return (
    <div className="min-h-screen bg-background">
      <div className="page-shell grid grid-cols-1 gap-6 split:grid-cols-[360px_minmax(0,1fr)]">
        <div className={view ? "hidden split:block" : ""}>
          <RequestHome
            needCount={ITEMS.filter((i) => suggestedPacks(i, PENDING.get(i.skuId)?.qty ?? 0) > 0).length}
            loading={false}
            canCreate
            recent={RECENT}
            onNew={() => go("new")}
            onOpen={() => go("r")}
            onHistory={() => undefined}
            onSupplier={() => undefined}
          />
        </div>
        <div className={view ? "" : "hidden split:block"}>
          {view === "new" && (
            <RequestForm
              title="ขอเบิกจากครัวกลาง"
              subtitle="Thaniya · Sendo"
              items={ITEMS}
              pending={PENDING}
              loading={false}
              busy={false}
              onSubmit={(date, notes, picked) => {
                setSent({
                  number: "TR-2026-10-018",
                  count: picked.length,
                  date,
                  message: lineMessage({ branch: "Thaniya", date, notes, items: picked.map(({ item: i, packs }) => ({ name: i.name, packSize: i.packSize, uom: i.uom, packs, packUnit: i.packUnit })) }),
                });
                go("sent");
              }}
            />
          )}
          {view === "sent" && sent && <RequestSent {...sent} onDone={() => go("")} />}
          {view === "r" && (
            <RequestDetail
              r={RECENT[0]}
              loadLines={async () => [
                { id: "1", skuId: "a", skuCode: "RM-0044", skuName: "หมูสันนอก", uom: "ก.", packSize: 1000, requestedQty: 2000, suggestedQty: 0, stockOnHand: 0, avgDailyUsage: 67, peakDailyUsage: 90, rop: 100, parstock: 244, declineReason: null, declinedAt: null },
                { id: "2", skuId: "b", skuCode: "RM-0021", skuName: "ดักแซล", uom: "ก.", packSize: 100, requestedQty: 300, suggestedQty: 0, stockOnHand: 158, avgDailyUsage: 26, peakDailyUsage: 30, rop: 200, parstock: 376, declineReason: "ของหมด", declinedAt: null },
              ]}
              message={() => "(ข้อความไลน์)"}
              canEdit
              onCancel={async () => undefined}
            />
          )}
        </div>
      </div>
    </div>
  );
}
