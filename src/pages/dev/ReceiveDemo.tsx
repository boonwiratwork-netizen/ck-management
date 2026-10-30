import { useMemo, useState } from "react";
import ReceivePage from "@/pages/Receive";
import type { SKU } from "@/types/sku";
import type { Price } from "@/types/price";
import type { Branch } from "@/types/branch";
import type { Supplier } from "@/types/supplier";
import type { HistoryReceipt, PendingTO, PRGroup } from "@/hooks/use-receive-data";
import { transferOrderStatusAfter, type ReceiptRow } from "@/lib/receive-rows";

/**
 * Dev-only harness (route exists only under `npm run dev`): the Receive page on
 * made-up products with an in-memory database. Every write is listed at the
 * bottom — the exact branch_receipts rows and status changes the real page sends.
 */

const sku = (id: string, code: string, name: string, type: SKU["type"], p: Partial<SKU> = {}): SKU =>
  ({ id, skuId: code, name, type, status: "Active", category: "", specNote: "", packSize: 1, packUnit: "", purchaseUom: "ก.", usageUom: "ก.", converter: 1, storageCondition: "Chilled", shelfLife: 0, vat: false, supplier1: "", supplier2: "", leadTime: 0, isDistributable: false, ...p }) as SKU;

const SKUS: SKU[] = [
  sku("pork", "RM-0101", "เนื้อหมูบด", "RM", { packSize: 1000, packUnit: "แพ็ค" }),
  sku("shrimp", "RM-0102", "กุ้งขาว ขนาด 35-40", "RM", { packSize: 1000, packUnit: "แพ็ค" }),
  sku("tofu", "RM-0103", "เต้าหู้คินุ ตราโอฮาเย", "RM", { packSize: 12, packUnit: "กล่อง", purchaseUom: "กล่อง", usageUom: "กล่อง" }),
  sku("onion", "RM-0104", "ต้นหอมญี่ปุ่น", "RM"),
  sku("cup", "PK-0001", "แก้วกระดาษ 16oz", "PK", { packSize: 50, packUnit: "แถว", purchaseUom: "ใบ", usageUom: "ใบ", isDistributable: true }),
  sku("soup", "SM-0051", "ซุปทงคตสึ", "SM", { packSize: 2000, packUnit: "ถุง" }),
  sku("chashu", "SM-0006", "สันคอหมูชาชู ซูวีด์", "SM", { packSize: 500, packUnit: "แพ็ค" }),
  sku("tare", "SM-0020", "ทาเระ ชิโอะ", "SM", { packSize: 1000, packUnit: "ขวด", purchaseUom: "มล.", usageUom: "มล." }),
];
const BRANCHES: Branch[] = [
  { id: "thaniya", branchName: "Thaniya", brandName: "Sendo", location: "", status: "Active", avgSellingPrice: null },
  { id: "shiro", branchName: "Shiro", brandName: "Sendo", location: "", status: "Active", avgSellingPrice: null },
];
const SUPPLIERS = [
  { id: "makro", name: "Makro Pro (แมคโคร)", status: "Active" },
  { id: "freshket", name: "Freshket (เฟรชเก็ต)", status: "Active" },
  { id: "tops", name: "Tops", status: "Active" },
] as Supplier[];
const price = (skuId: string, supplierId: string, perUnit: number) => ({ id: `${skuId}-${supplierId}`, skuId, supplierId, pricePerPurchaseUom: 0, pricePerUsageUom: perUnit, vat: false, isActive: true, effectiveDate: "2026-10-01", note: "" }) as Price;
const PRICES: Price[] = [price("pork", "makro", 0.127), price("shrimp", "makro", 0.28), price("tofu", "makro", 36.67), price("onion", "freshket", 0.19), price("cup", "makro", 1.2)];
const MENUS = [{ id: "m1", brandName: "Sendo", status: "Active" }];
const MENU_BOM = ["pork", "shrimp", "tofu", "onion", "cup", "soup", "chashu", "tare"].map((skuId) => ({ menuId: "m1", skuId }));
const BOM_COST: Record<string, number> = { soup: 0.069, chashu: 0.318, tare: 0.25 };

const initialTOs: PendingTO[] = [
  {
    id: "to25",
    toNumber: "TO-2026-10-025",
    deliveryDate: "2026-10-25",
    trId: "tr9",
    lines: [
      { id: "l1", skuId: "soup", plannedQty: 8000, actualQty: 8000, uom: "ก.", unitCost: 0.069, notes: "", sentPacks: null },
      // 3 packs that weigh more than 3 × 500 g: still 3 packs (the 27 Oct case: 5 packs at 2,005 g)
      { id: "l2", skuId: "chashu", plannedQty: 1500, actualQty: 1800, uom: "ก.", unitCost: 0.318, notes: "", sentPacks: 3 },
      { id: "l3", skuId: "tare", plannedQty: 2000, actualQty: 0, uom: "มล.", unitCost: 0.25, notes: "", sentPacks: null },
    ],
  },
];
const initialPRs: PRGroup[] = [{ supplierId: "makro", prIds: ["pr1"], prNumbers: ["PR-2026-10-031"], lines: [{ skuId: "pork", suggestedQty: 2000 }, { skuId: "tofu", suggestedQty: 36 }] }];

export default function ReceiveDemo() {
  const [tos, setTos] = useState(initialTOs);
  const [prs, setPrs] = useState(initialPRs);
  const [history, setHistory] = useState<HistoryReceipt[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const note = (s: string) => setLog((l) => [s, ...l]);
  const wait = () => new Promise((r) => setTimeout(r, 300));
  const toHist = (r: ReceiptRow, toNumber: string | null = null): HistoryReceipt => ({ ...r, id: crypto.randomUUID(), createdAt: new Date().toISOString(), toNumber });

  const demoData = useMemo(
    () => ({
      pendingTOs: tos,
      prGroups: prs,
      history,
      loading: false,
      reload: async () => undefined,
      saveRows: async (rows: ReceiptRow[]) => {
        await wait();
        rows.forEach((r) => note(`INSERT branch_receipts ${JSON.stringify(r)}`));
        setHistory((h) => [...rows.map((r) => toHist(r)), ...h]);
        return rows.length;
      },
      receiveTransferOrder: async (to: PendingTO, rows: ReceiptRow[], byLine: Map<string, number>) => {
        await wait();
        rows.forEach((r) => note(`INSERT branch_receipts ${JSON.stringify(r)}`));
        const status = transferOrderStatusAfter(to.lines, byLine);
        note(`UPDATE transfer_orders ${to.toNumber} status=${status}`);
        if (to.trId) note(`UPDATE transfer_requests ${to.trId} status=Fulfilled`);
        setHistory((h) => [...rows.map((r) => toHist(r, to.toNumber)), ...h]);
        if (status !== "Sent") setTos((t) => t.filter((x) => x.id !== to.id));
        return rows.length;
      },
      declineTransferOrder: async (to: PendingTO, reason: string) => {
        await wait();
        note(`UPDATE transfer_orders ${to.toNumber} status=Declined decline_reason=${JSON.stringify(reason)}`);
        setTos((t) => t.filter((x) => x.id !== to.id));
        return true;
      },
      fulfilPurchaseRequests: async (supplierId: string, prIds: string[]) => {
        if (!prIds.length) return;
        note(`UPDATE purchase_requests ${prIds.join(",")} status=Fulfilled`);
        setPrs((p) => p.filter((g) => g.supplierId !== supplierId));
      },
      findKitchenDoubles: async (_d: Date, lines: { skuId: string; qty: number }[], against: boolean) =>
        history.filter((h) => h.supplierName === "Central Kitchen" && !!h.transferOrderId === against && lines.some((l) => l.skuId === h.skuId && l.qty === h.qtyReceived)),
      updateReceipt: async (r: HistoryReceipt, e: { qtyReceived: number; actualTotal: number; notes: string }) => {
        note(`UPDATE branch_receipts ${r.id.slice(0, 8)} ${JSON.stringify(e)}`);
        setHistory((h) => h.map((x) => (x.id === r.id ? { ...x, ...e, actualUnitPrice: e.qtyReceived > 0 ? e.actualTotal / e.qtyReceived : 0, stdTotal: e.qtyReceived * x.stdUnitPrice, priceVariance: e.actualTotal - e.qtyReceived * x.stdUnitPrice } : x)));
        return true;
      },
      deleteReceipt: async (r: HistoryReceipt) => {
        note(`DELETE branch_receipts ${r.id.slice(0, 8)}`);
        setHistory((h) => h.filter((x) => x.id !== r.id));
        return true;
      },
    }),
    [tos, prs, history],
  );

  return (
    <div className="min-h-screen bg-background">
      <div className="page-shell">
        <ReceivePage skus={SKUS} prices={PRICES} branches={BRANCHES} suppliers={SUPPLIERS} menus={MENUS} menuBomLines={MENU_BOM} getBomCostPerGram={(id) => BOM_COST[id] ?? 0} onNavigate={(t) => alert(`ไปหน้า ${t}`)} demoData={demoData} />
        <section id="write-log" className="mt-10 rounded-2xl border border-border bg-card p-4">
          <h2 className="mb-2 text-sm font-semibold">สิ่งที่จะเขียนลงฐานข้อมูล (ทดสอบ)</h2>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs">{log.join("\n") || "—"}</pre>
        </section>
      </div>
    </div>
  );
}
