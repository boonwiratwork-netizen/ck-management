import { useCallback, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { addDays, format } from "date-fns";
import { ArrowLeft, HelpCircle, History } from "lucide-react";
import type { SKU } from "@/types/sku";
import type { Price } from "@/types/price";
import type { Branch } from "@/types/branch";
import type { Supplier } from "@/types/supplier";
import { useAuth } from "@/hooks/use-auth";
import { useReceiveData, type HistoryReceipt, type PendingTO } from "@/hooks/use-receive-data";
import { stdUnitPriceFor, type ReceiptRow } from "@/lib/receive-rows";
import { getRecentSupplierIds, pushRecentSupplier } from "@/lib/receive-scan";
import { ReceiveHome } from "@/components/receive/ReceiveHome";
import { ReceiveTransferOrder, DeclineDialog } from "@/components/receive/ReceiveTransferOrder";
import { ReceiveSupplier } from "@/components/receive/ReceiveSupplier";
import { ReceiveKitchenAdHoc, ReceiveFromBranch, type PricedSku } from "@/components/receive/ReceiveOther";
import { ReceiveHistory } from "@/components/receive/ReceiveHistory";
import { packLabel } from "@/components/receive/parts";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { GuideTour, useGuide, type GuideStep } from "@/components/GuideTour";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface MenuLite {
  id: string;
  brandName: string;
  status: string;
}
interface MenuBomLite {
  menuId: string;
  skuId: string;
}

interface Props {
  skus: SKU[];
  prices: Price[];
  branches: Branch[];
  suppliers?: Supplier[];
  menus?: MenuLite[];
  menuBomLines?: MenuBomLite[];
  getBomCostPerGram?: (smSkuId: string) => number;
  /** Dev harness only: an in-memory stand-in for the database layer */
  demoData?: ReturnType<typeof useReceiveData>;
}

const LAST_BRANCH_KEY = "ck-receive-branch";
const HISTORY_DAYS = 30;
const GUIDE: GuideStep[] = [
  {
    title: "หน้ารับของแบบใหม่",
    body: "รวมหน้ารับของบนคอมกับบนมือถือเป็นหน้าเดียว ของที่รอรับขึ้นมาให้ก่อน กดรับได้ในไม่กี่ขั้น ใช้เวลาอ่านไม่ถึงนาที",
  },
  {
    target: "recv-branch",
    title: "สาขาและวันที่รับ",
    body: "ดูให้แน่ใจว่าเป็นสาขาที่ถูก ถ้ารับของย้อนหลัง เปลี่ยนวันที่ตรงนี้ก่อน ระบบจะเตือนเมื่อไม่ใช่วันนี้",
  },
  {
    target: "recv-waiting",
    title: "ของที่รอรับ",
    body: (
      <>
        <b>ใบโอนจากครัวกลาง</b> กด “รับของ” แล้วใส่จำนวนที่ได้จริง ถ้าไม่รับทั้งใบกด “ปฏิเสธ” พร้อมเหตุผล · <b>ใบขอซื้อที่ถึงกำหนด</b> กด “รับตามใบ” ระบบใส่รายการที่สั่งไว้ให้
      </>
    ),
  },
  {
    target: "recv-other",
    title: "ของที่ไม่มีใบ",
    body: "ค้นชื่อซัพพลายเออร์ หรือเลือก “ครัวกลาง (ไม่มีใบโอน)” / “รับจากสาขาอื่น” แล้วกดเพิ่มสินค้า นับเป็นแพ็ค ถ้าชั่งได้น้ำหนักจริงกด “ชั่งจริง”",
  },
  {
    target: "recv-history",
    title: "แก้หรือลบสิ่งที่รับไปแล้ว",
    body: "กด “ดูประวัติ” ดูย้อนหลัง 30 วัน แก้จำนวนหรือราคา และลบได้ (มีถามยืนยันก่อนลบ)",
  },
  {
    title: "ดูคำแนะนำนี้อีกครั้งได้",
    body: "กดปุ่ม “วิธีใช้” ด้านบนของหน้านี้เมื่อไหร่ก็ได้",
  },
];

const NOT_A_SHOP = /^(central kitchen|ck\b|ck \(|ครัวกลาง|store production|bom calculation)/i;

/**
 * One receiving page for phones and computers (replaces Branch Receipt and the
 * phone receive page). The URL hash holds the screen: "" queue, "to/<id>",
 * "sup/<id>", "ck", "branch", "history" — so the back button and bottom bar work.
 */
export default function ReceivePage({ skus, prices, branches, suppliers = [], menus = [], menuBomLines = [], getBomCostPerGram, demoData }: Props) {
  const { isStoreManager, profile } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const view = decodeURIComponent(location.hash.slice(1));
  const go = (v: string, replace = false) => navigate({ pathname: location.pathname, hash: v ? `#${v}` : "" }, { replace });
  const guide = useGuide("receive-v2");

  // ── Branch & date ──
  const activeBranches = useMemo(() => branches.filter((b) => b.status === "Active"), [branches]);
  const lockedBranch = isStoreManager && profile?.branch_id ? profile.branch_id : null;
  const [pickedBranch, setPickedBranch] = useState<string>(() => {
    try {
      return localStorage.getItem(LAST_BRANCH_KEY) || "";
    } catch {
      return "";
    }
  });
  // Start loading with the branch remembered on this device right away; checking it
  // against the branch list waits for the app's base data (~2.5 s on the live site)
  const branchId =
    lockedBranch ??
    (activeBranches.length === 0 ? pickedBranch : activeBranches.some((b) => b.id === pickedBranch) ? pickedBranch : activeBranches[0].id);
  const branch = activeBranches.find((b) => b.id === branchId);
  const [date, setDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const today = format(new Date(), "yyyy-MM-dd");
  const [range, setRange] = useState(() => ({ from: format(addDays(new Date(), -HISTORY_DAYS), "yyyy-MM-dd"), to: today }));

  const live = useReceiveData({
    branchId: demoData ? null : branchId || null,
    historyBranchIds: demoData || !branchId ? [] : [branchId],
    historyFrom: range.from,
    historyTo: range.to,
  });
  const data = demoData ?? live;

  // ── What this branch can receive (same rules as the old pages) ──
  const skuMap = useMemo(() => new Map(skus.map((s) => [s.id, s])), [skus]);
  const brandSkuIdsFor = useCallback(
    (brandName: string) => {
      const ids = new Set(menus.filter((m) => m.brandName === brandName && m.status === "Active").map((m) => m.id));
      return new Set(menuBomLines.filter((l) => ids.has(l.menuId)).map((l) => l.skuId));
    },
    [menus, menuBomLines],
  );
  const brandSkuIds = useMemo(() => (branch ? brandSkuIdsFor(branch.brandName) : new Set<string>()), [branch, brandSkuIdsFor]);
  const brandSupplierIds = useMemo(() => new Set(prices.filter((p) => p.isActive && brandSkuIds.has(p.skuId)).map((p) => p.supplierId)), [prices, brandSkuIds]);
  // Supplier records that stand for the kitchen or for calculations, not real shops.
  // Receiving through them would write a kitchen-named row with supplier units;
  // the kitchen has its own buttons above. Hidden here only (data untouched).
  const activeSuppliers = useMemo(
    () => suppliers.filter((s) => s.status === "Active" && !NOT_A_SHOP.test(s.name.trim())).sort((a, b) => a.name.localeCompare(b.name)),
    [suppliers],
  );
  const brandSuppliers = activeSuppliers.filter((s) => brandSupplierIds.has(s.id));
  const otherSuppliers = activeSuppliers.filter((s) => !brandSupplierIds.has(s.id));
  const purchasableSkus = useMemo(() => skus.filter((s) => s.status === "Active" && (s.type === "RM" || s.type === "PK")).sort((a, b) => a.skuId.localeCompare(b.skuId)), [skus]);
  const supplierSkusFor = useCallback(
    (supplierId: string) => {
      const seen = new Set<string>();
      const list: SKU[] = [];
      for (const p of prices) {
        if (p.supplierId !== supplierId || !p.isActive || !brandSkuIds.has(p.skuId) || seen.has(p.skuId)) continue;
        const s = skuMap.get(p.skuId);
        if (!s || (s.type !== "RM" && s.type !== "PK")) continue;
        seen.add(s.id);
        list.push(s);
      }
      return list.sort((a, b) => a.skuId.localeCompare(b.skuId));
    },
    [prices, brandSkuIds, skuMap],
  );
  const kitchenItems = useMemo<PricedSku[]>(
    () =>
      skus
        .filter((s) => s.status === "Active" && brandSkuIds.has(s.id) && (s.type === "SM" || ((s.type === "RM" || s.type === "PK") && s.isDistributable === true)))
        .map((s) => ({ sku: s, stdUnitPrice: s.type === "SM" ? getBomCostPerGram?.(s.id) ?? 0 : stdUnitPriceFor(prices, s.id) }))
        .sort((a, b) => a.sku.skuId.localeCompare(b.sku.skuId)),
    [skus, brandSkuIds, getBomCostPerGram, prices],
  );
  const branchItemsFor = useCallback(
    (sourceId: string): PricedSku[] => {
      const src = branches.find((b) => b.id === sourceId);
      if (!src) return [];
      const ids = brandSkuIdsFor(src.brandName);
      const order = (t: string) => (t === "SM" ? 0 : t === "RM" ? 1 : 2);
      return skus
        .filter((s) => s.status === "Active" && ids.has(s.id))
        .map((s) => ({ sku: s, stdUnitPrice: stdUnitPriceFor(prices, s.id) }))
        .sort((a, b) => order(a.sku.type) - order(b.sku.type) || a.sku.skuId.localeCompare(b.sku.skuId));
    },
    [branches, brandSkuIdsFor, skus, prices],
  );

  // ── Saving ──
  const [declineFor, setDeclineFor] = useState<PendingTO | null>(null);
  const describe = (r: HistoryReceipt) => `${skuMap.get(r.skuId)?.name ?? ""} ${packLabel(skuMap.get(r.skuId), r.qtyReceived)} (${r.receiptDate}, ${r.toNumber ?? "ไม่มีใบโอน"})`;
  const findDoubles = (against: boolean) => async (lines: { skuId: string; qty: number }[]) =>
    (await data.findKitchenDoubles(new Date(`${date}T00:00:00`), lines, against)).map(describe);
  const done = (count: number) => {
    toast.success(`บันทึกรับของ ${count} รายการแล้ว`);
    go("", true);
  };

  const to = view.startsWith("to/") ? data.pendingTOs.find((t) => t.id === view.slice(3)) : undefined;
  const supplier = view.startsWith("sup/") ? suppliers.find((s) => s.id === view.slice(4)) : undefined;
  const todays = data.history.filter((r) => r.receiptDate === today);
  const workOpen = view !== "" && view !== "history";

  let work: React.ReactNode = null;
  if (!branchId) work = <Empty text="ยังไม่มีสาขาที่เปิดอยู่" />;
  else if (view.startsWith("to/"))
    work = to ? (
      <ReceiveTransferOrder
        key={to.id}
        to={to}
        branchId={branchId}
        receiptDate={date}
        skuMap={skuMap}
        findDoubles={findDoubles(false)}
        onDecline={async (reason) => {
          const ok = await data.declineTransferOrder(to, reason);
          if (ok) {
            toast.success(`ปฏิเสธใบโอน ${to.toNumber} แล้ว`);
            go("", true);
          }
          return ok;
        }}
        onReceive={async (rows: ReceiptRow[], byLine) => {
          const n = await data.receiveTransferOrder(to, rows, byLine);
          if (n) done(n);
          return n > 0;
        }}
      />
    ) : (
      <Empty text={data.loading ? "กำลังโหลด…" : "ใบโอนนี้รับหรือปฏิเสธไปแล้ว"} />
    );
  else if (view.startsWith("sup/"))
    work = supplier ? (
      <ReceiveSupplier
        key={`${supplier.id}-${branchId}`}
        supplier={supplier}
        branchId={branchId}
        receiptDate={date}
        supplierSkus={supplierSkusFor(supplier.id)}
        allSkus={purchasableSkus}
        skuMap={skuMap}
        prices={prices}
        prGroup={data.prGroups.find((g) => g.supplierId === supplier.id)}
        onSave={async (rows, prIds) => {
          const n = await data.saveRows(rows);
          if (!n) return false;
          pushRecentSupplier(supplier.id);
          await data.fulfilPurchaseRequests(supplier.id, prIds);
          done(n);
          return true;
        }}
      />
    ) : (
      <Empty text="ไม่พบซัพพลายเออร์นี้" />
    );
  else if (view === "ck")
    work = (
      <ReceiveKitchenAdHoc
        key={branchId}
        branchId={branchId}
        receiptDate={date}
        items={kitchenItems}
        findDoubles={findDoubles(true)}
        onSave={async (rows) => {
          const n = await data.saveRows(rows);
          if (n) done(n);
          return n > 0;
        }}
      />
    );
  else if (view === "branch")
    work = (
      <ReceiveFromBranch
        key={branchId}
        branchId={branchId}
        receiptDate={date}
        sourceBranches={activeBranches.filter((b) => b.id !== branchId)}
        itemsFor={branchItemsFor}
        onSave={async (rows) => {
          const n = await data.saveRows(rows);
          if (n) done(n);
          return n > 0;
        }}
      />
    );

  const history = (
    <ReceiveHistory
      history={data.history}
      loading={data.loading}
      skuMap={skuMap}
      branches={branches}
      showBranch={false}
      from={range.from}
      to={range.to}
      onRange={(from, to) => setRange({ from, to })}
      onUpdate={data.updateReceipt}
      onDelete={async (r) => {
        const ok = await data.deleteReceipt(r);
        if (ok) toast.success("ลบแล้ว");
        return ok;
      }}
    />
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Branch + date: on phones only on the queue screen */}
      <div data-tour="recv-branch" className={cn("flex flex-wrap items-end gap-3", workOpen && "hidden lg:flex")}>
        <div className="mr-auto">
          <h1 className="text-2xl font-bold">รับของ</h1>
          <p className="text-sm text-muted-foreground">{branch ? `${branch.branchName} · ${branch.brandName}` : "เลือกสาขา"}</p>
        </div>
        {!lockedBranch && activeBranches.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            {activeBranches.map((b) => (
              <button
                key={b.id}
                type="button"
                aria-pressed={b.id === branchId}
                onClick={() => {
                  setPickedBranch(b.id);
                  try {
                    localStorage.setItem(LAST_BRANCH_KEY, b.id);
                  } catch {
                    // remembered only on this device; fine without
                  }
                  go("", true);
                }}
                className={cn("min-h-[40px] rounded-full border px-4 text-sm", b.id === branchId ? "border-primary bg-primary font-semibold text-primary-foreground" : "border-border bg-card")}
              >
                {b.branchName}
              </button>
            ))}
          </div>
        )}
        <label className="flex flex-col text-sm">
          <span className="text-muted-foreground">วันที่รับ</span>
          <Input type="date" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} className="h-10 w-[160px]" />
        </label>
        <Button variant="outline" className="h-10" onClick={guide.start}>
          <HelpCircle className="h-4 w-4" /> วิธีใช้
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <div className={cn("min-w-0", view !== "" && "hidden lg:block")}>
          {branchId ? (
            <ReceiveHome
              pendingTOs={data.pendingTOs}
              prGroups={data.prGroups}
              loading={data.loading}
              brandSuppliers={brandSuppliers}
              otherSuppliers={otherSuppliers}
              recentIds={getRecentSupplierIds()}
              todayCount={todays.length}
              todayTotal={todays.reduce((s, r) => s + r.actualTotal, 0)}
              activeView={view}
              onOpen={(v) => go(v)}
              onDeclineAsk={setDeclineFor}
            />
          ) : (
            <Empty text="ยังไม่มีสาขาที่เปิดอยู่" />
          )}
        </div>
        <div className={cn("min-w-0", view === "" && "hidden lg:block")}>
          {view !== "" && (
            <button type="button" onClick={() => go("")} className="-ml-2 mb-2 inline-flex min-h-[44px] items-center gap-1 rounded-full px-2 text-sm text-muted-foreground hover:text-foreground lg:hidden">
              <ArrowLeft className="h-4 w-4" /> รับของ
            </button>
          )}
          {date !== today && workOpen && (
            <div className="mb-3 rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning">บันทึกเป็นวันที่ {date} (ไม่ใช่วันนี้)</div>
          )}
          {workOpen ? work : history}
          {workOpen && (
            <button type="button" onClick={() => go("history")} className="mt-6 hidden min-h-[44px] items-center gap-2 text-sm text-muted-foreground hover:text-foreground lg:inline-flex">
              <History className="h-4 w-4" /> ดูประวัติ
            </button>
          )}
        </div>
      </div>

      <GuideTour steps={GUIDE} open={guide.open && view === ""} onClose={guide.close} />
      <DeclineDialog
        open={declineFor !== null}
        toNumber={declineFor?.toNumber ?? ""}
        onClose={() => setDeclineFor(null)}
        onDecline={async (reason) => {
          if (!declineFor) return;
          if (await data.declineTransferOrder(declineFor, reason)) {
            toast.success(`ปฏิเสธใบโอน ${declineFor.toNumber} แล้ว`);
            setDeclineFor(null);
          }
        }}
      />
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">{text}</div>;
}
