import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { HelpCircle } from "lucide-react";
import type { SKU } from "@/types/sku";
import type { Supplier } from "@/types/supplier";
import type { Price } from "@/types/price";
import type { GoodsReceipt } from "@/types/goods-receipt";
import type { useGoodsReceiptData } from "@/hooks/use-goods-receipt-data";
import { billsOf, lineTotal, noteWithoutPlace, placeOf, supplierRank, type Bill } from "@/lib/goods-receipt";
import { BillEntry, type SavedBill } from "@/components/goods-receipt/BillEntry";
import { EditLineDialog, GRHistory, GRSide } from "@/components/goods-receipt/GRViews";
import { GuideTour, useGuide, type GuideStep } from "@/components/GuideTour";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const GUIDE: GuideStep[] = [
  {
    title: "รับของเข้าครัว 3 ขั้น",
    body: (
      <>
        <b>1 เลือกเจ้า</b> → <b>2 ใส่จำนวนกับยอดเงินตามบิล</b> → <b>3 บันทึกบิล</b>
      </>
    ),
  },
  { target: "gr-date", title: "วันที่รับ", body: "ปกติเป็นวันนี้ ถ้าใส่บิลของเมื่อวานให้เปลี่ยนก่อน" },
  { target: "gr-first", title: "ขั้น 1: แตะเจ้าที่ส่งของมา", body: "เจ้าที่ซื้อบ่อยอยู่บนสุด", until: "click" },
  {
    target: "gr-lines",
    title: "ขั้น 2: ใส่ตามบิล",
    body: (
      <>
        <b>รับจริง</b> แล้ว <b>ยอดเงินในบิล</b> · กด Enter ไปช่องถัดไป · ไม่ใส่ยอดเงิน = ใช้ราคามาตรฐาน
      </>
    ),
  },
  { target: "gr-save", title: "ขั้น 3: แตะ “บันทึกบิล”", body: "ใส่ยอดท้ายบิลไว้เช็คได้ (ไม่บังคับ) หน้าถัดไปจะเตือนถ้ามีอะไรแปลก", until: "click" },
  { target: "gr-confirm", title: "ตรวจแล้วบันทึก", body: "ดูคำเตือน แล้วแตะ “บันทึกบิล” อีกครั้ง" },
];

interface Props {
  receiptData: ReturnType<typeof useGoodsReceiptData>;
  skus: SKU[];
  suppliers: Supplier[];
  prices: Price[];
}

/**
 * The central kitchen receives supplier bills (replaces GoodsReceipt). Screens by
 * hash: "" home, "bill/<supplierId>" or "bill/other", "history".
 */
export default function KitchenReceivePage({ receiptData, skus, suppliers, prices }: Props) {
  const { receipts, addReceipts, editReceipt, deleteReceipt, isFullHistory, loadAllHistory, isLoadingAll } = receiptData;
  const location = useLocation();
  const navigate = useNavigate();
  const view = decodeURIComponent(location.hash.slice(1));
  const go = (v: string, replace = false) => navigate({ pathname: location.pathname, hash: v ? `#${v}` : "" }, { replace });
  const guide = useGuide("kitchen-receive-v1");

  const [date, setDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const skuOf = useMemo(() => new Map(skus.map((s) => [s.id, s])), [skus]);
  const supplierById = useMemo(() => new Map(suppliers.map((s) => [s.id, s])), [suppliers]);
  const supplierName = (id: string) => supplierById.get(id)?.name ?? "ไม่ทราบเจ้า";
  const active = useMemo(() => suppliers.filter((s) => s.status === "Active").map((s) => ({ id: s.id, name: s.name })), [suppliers]);
  const topIds = useMemo(() => supplierRank(receipts.filter((r) => !placeOf(r.note))), [receipts]);
  const dayBills = useMemo(() => billsOf(receipts.filter((r) => r.receiptDate === date)), [receipts, date]);

  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<GoodsReceipt | null>(null);
  const [openKey, setOpenKey] = useState<string | undefined>();

  const billFor = view.startsWith("bill/") ? view.slice(5) : null;
  const billSupplier = billFor && billFor !== "other" ? billFor : null;

  const [backDated, setBackDated] = useState(false);
  const saveBill = async (bill: SavedBill) => {
    setBusy(true);
    // "ซื้อที่อื่น" keeps the place in the note unless it names a supplier (as before)
    const named = bill.named;
    const ok = await addReceipts(
      bill.rows.map((r) => ({
        sku: skuOf.get(r.skuId),
        data: {
          receiptDate: date,
          skuId: r.skuId,
          supplierId: r.supplierId,
          quantityReceived: r.qty,
          actualTotal: lineTotal(r.total, r.stdUnit, r.qty),
          note: bill.place && !named ? `[Supplier: ${bill.place}] ${r.note}`.trim() : r.note,
        },
      })),
      prices,
    );
    setBusy(false);
    if (ok) {
      // Prices more than 10% off the price set: offer to update them from this bill
      const off = bill.rows.filter((r) => r.stdUnit > 0 && r.qty > 0 && Math.abs(lineTotal(r.total, r.stdUnit, r.qty) / (r.stdUnit * r.qty) - 1) > 0.1).length;
      const supplierId = bill.rows[0]?.supplierId;
      toast.success(
        `บันทึกบิลแล้ว ${bill.rows.length} รายการ${off ? ` · ราคาต่าง ${off} รายการ` : ""}`,
        off && supplierId && !bill.place ? { action: { label: "อัปเดตราคา", onClick: () => navigate(`/cost-center#bill/${supplierId}/${date}`) }, duration: 10000 } : undefined,
      );
      // A line added to an old bill doesn't leave the page on that old day
      if (backDated) {
        setDate(format(new Date(), "yyyy-MM-dd"));
        setBackDated(false);
      }
      go("", true);
    }
    return ok;
  };

  let work: React.ReactNode = null;
  if (billFor)
    work = (
      <BillEntry
        key={`${date}-${billFor}`}
        date={date}
        supplierId={billSupplier}
        supplierName={billSupplier ? supplierName(billSupplier) : ""}
        skus={skus}
        prices={prices}
        suppliers={suppliers.map((s) => ({ id: s.id, name: s.name }))}
        receipts={receipts}
        busy={busy}
        onBack={() => go("", true)}
        onSave={saveBill}
      />
    );
  else if (view === "history")
    work = (
      <GRHistory
        receipts={receipts}
        skus={skus}
        supplierName={supplierName}
        topIds={topIds}
        canEdit
        openKey={openKey}
        fullHistory={isFullHistory}
        loadingAll={isLoadingAll}
        onLoadAll={loadAllHistory}
        onBack={() => go("")}
        onEdit={setEditing}
        onDeleteLines={async (ids) => {
          let n = 0;
          for (const id of ids) if (await deleteReceipt(id)) n++;
          if (n) toast.success(`ลบแล้ว ${n} รายการ`);
        }}
        onUpdatePrices={(b) => navigate(`/cost-center#bill/${b.supplierId}/${b.date}`)}
        onAddToBill={(b: Bill) => {
          setDate(b.date);
          setBackDated(true);
          go(`bill/${b.supplierId}`);
        }}
      />
    );

  const isHome = !work;
  const wide = !!billFor;
  return (
    <div className="flex flex-col gap-4">
      <div className={cn("flex flex-wrap items-end gap-3", !isHome && "hidden", !isHome && !wide && "split:flex")}>
        <h1 className="mr-auto text-2xl font-bold">รับของเข้าครัวกลาง</h1>
        <Button
          variant="outline"
          className="h-10"
          onClick={() => {
            go("", true);
            guide.start();
          }}
        >
          <HelpCircle className="h-4 w-4" /> วิธีใช้
        </Button>
      </div>

      <div className={cn("grid grid-cols-1 gap-6", !wide && "split:grid-cols-[340px_minmax(0,1fr)]")}>
        <div className={cn("min-w-0", !isHome && "hidden", !isHome && !wide && "split:block")}>
          <GRSide
            date={date}
            onDate={setDate}
            suppliers={active}
            topIds={topIds}
            bills={dayBills}
            supplierName={supplierName}
            canEdit
            onSupplier={(id) => go(`bill/${id}`)}
            onOther={() => go("bill/other")}
            onOpenBill={(b) => {
              setOpenKey(b.key);
              go("history");
            }}
            onHistory={() => {
              setOpenKey(undefined);
              go("history");
            }}
          />
        </div>
        <div className={cn("min-w-0", isHome && "hidden split:block")}>
          {work ?? (
            <div className="hidden min-h-[320px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-card p-8 text-center split:flex">
              <p className="font-medium">เลือกเจ้าที่ส่งของมาทางซ้าย</p>
            </div>
          )}
        </div>
      </div>

      {editing && (
        <EditLineDialog
          r={editing}
          sku={skuOf.get(editing.skuId)}
          onCancel={() => setEditing(null)}
          onSave={async (qty, total, note) => {
            const r = editing;
            const place = placeOf(r.note);
            const ok = await editReceipt(r, qty, total, place ? `[Supplier: ${place}] ${noteWithoutPlace(note)}`.trim() : note);
            if (ok) {
              setEditing(null);
              toast.success("แก้แล้ว");
            }
          }}
        />
      )}
      <GuideTour steps={GUIDE} open={guide.open} onClose={guide.close} />
    </div>
  );
}
