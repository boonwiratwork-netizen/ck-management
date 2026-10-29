import { useEffect, useMemo, useState } from "react";
import { addDays, format } from "date-fns";
import { Check, ChevronRight, Copy, Printer, Search, Store, Truck } from "lucide-react";
import type { TRDetailLine, TRHistoryRow } from "@/hooks/use-transfer-request";
import type { PRDetailLine, PRHistoryRow } from "@/hooks/use-purchase-request";
import type { SupplierOption } from "@/hooks/use-request-data";
import { canCancel, prStatusLabel, statusLabel } from "@/lib/request-lines";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { thaiDay } from "@/components/sales/SalesDays";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/** A request in either list: kitchen (TR) or supplier (PR) */
export type AnyRequest = { kind: "tr"; row: TRHistoryRow } | { kind: "pr"; row: PRHistoryRow };
export const numberOf = (r: AnyRequest) => (r.kind === "tr" ? r.row.trNumber : r.row.prNumber);

const toneClass = { wait: "bg-warning-soft text-warning", work: "bg-info/10 text-info", done: "bg-success-soft text-success", off: "bg-secondary text-muted-foreground" };

export function StatusChip({ r }: { r: AnyRequest }) {
  const s = (r.kind === "tr" ? statusLabel : prStatusLabel)[r.row.status] ?? { text: r.row.status, tone: "off" as const };
  return <span className={cn("inline-flex min-h-[28px] shrink-0 items-center rounded-full px-2.5 text-[13px] font-semibold", toneClass[s.tone])}>{s.text}</span>;
}

export function RequestList({ items, onOpen, empty }: { items: AnyRequest[]; onOpen: (r: AnyRequest) => void; empty: string }) {
  if (!items.length) return <div className="rounded-2xl border border-dashed border-border bg-card px-4 py-5 text-sm text-muted-foreground">{empty}</div>;
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
      {items.map((r) => (
        <li key={numberOf(r)}>
          <button type="button" onClick={() => onOpen(r)} className="flex min-h-[64px] w-full items-center gap-3 px-4 py-2 text-left hover:bg-secondary/60">
            <span className="min-w-0 flex-1">
              <span className="block text-[15px]">
                {r.kind === "pr" ? `${r.row.supplierName || "ซัพพลายเออร์"} · ` : ""}ส่ง {thaiDay(r.row.requiredDate)}
              </span>
              <span className="block text-sm text-muted-foreground">
                <span className="font-mono">{numberOf(r)}</span> · {r.row.itemCount} รายการ
              </span>
            </span>
            <StatusChip r={r} />
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Home: the kitchen request card first, then what was already sent */
export function RequestHome({
  needCount,
  loading,
  canCreate,
  recent,
  onNew,
  onOpen,
  onHistory,
  onSupplier,
}: {
  needCount: number;
  loading: boolean;
  canCreate: boolean;
  recent: AnyRequest[];
  onNew: () => void;
  onOpen: (r: AnyRequest) => void;
  onHistory: () => void;
  onSupplier: () => void;
}) {
  const tomorrow = format(addDays(new Date(), 1), "yyyy-MM-dd");
  return (
    <div className="flex flex-col gap-3">
      <section data-tour="req-start" className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-card">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-soft">
            <Truck className="h-5 w-5 text-brand" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold">ขอเบิกจากครัวกลาง</h2>
            <p className="text-sm text-muted-foreground">ส่งพรุ่งนี้ {thaiDay(tomorrow)}</p>
          </div>
        </div>
        <div className={cn("flex items-baseline gap-2 rounded-xl px-3 py-2.5", needCount ? "bg-warning-soft text-warning" : "bg-success-soft text-success")}>
          {loading ? (
            <span className="text-sm">กำลังคำนวณของที่ควรสั่ง…</span>
          ) : needCount ? (
            <>
              <span className="font-mono text-2xl font-bold">{needCount}</span>
              <span className="text-sm">รายการควรสั่ง ของจะไม่พอก่อนรอบส่งถัดไป</span>
            </>
          ) : (
            <span className="text-sm font-medium">ของพอทุกตัว ยังไม่ต้องสั่ง</span>
          )}
        </div>
        {canCreate && (
          <Button data-tour="req-go" variant="brand" className="h-12 text-base" onClick={onNew}>
            เริ่มขอเบิก
          </Button>
        )}
      </section>

      <div data-tour="req-sent" className="flex flex-col gap-2">
        <h2 className="mt-1 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">ใบที่ส่งไปแล้ว</h2>
        <RequestList items={recent} onOpen={onOpen} empty="ยังไม่มีใบขอเบิก" />
        <button type="button" onClick={onHistory} className="flex min-h-[48px] items-center justify-between px-1 text-sm">
          <span>ดูทั้งหมด</span>
          <span className="font-semibold text-brand">ประวัติ</span>
        </button>
      </div>

      {canCreate && (
        <button data-tour="req-supplier" type="button" onClick={onSupplier} className="flex min-h-[52px] items-center gap-3 rounded-2xl border border-dashed border-border px-4 text-left text-sm text-muted-foreground hover:text-foreground">
          <Store className="h-4 w-4 shrink-0" /> สั่งซื้อจากซัพพลายเออร์ (นาน ๆ ใช้)
        </button>
      )}
    </div>
  );
}

/** After sending: the LINE message to copy (copying is a button: auto-copy fails on iPhone) */
export function RequestSent({ number, count, date, message, onDone }: { number: string; count: number; date: string; message: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-4 pt-4">
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-success-soft">
          <Check className="h-8 w-8 text-success" />
        </span>
        <h2 className="text-xl font-bold">ส่งคำขอแล้ว</h2>
        <p className="text-[15px] text-muted-foreground">
          <span className="font-mono">{number}</span> · {count} รายการ · ส่ง {thaiDay(date)}
        </p>
      </div>
      <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
        <h3 className="text-sm font-semibold">ข้อความสำหรับส่งในไลน์กลุ่ม</h3>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-xl bg-secondary p-3 font-sans text-sm leading-relaxed">{message}</pre>
        <Button
          className="h-12 bg-[#06C755] text-base text-white hover:bg-[#05b34c]"
          onClick={() =>
            navigator.clipboard.writeText(message).then(
              () => {
                setCopied(true);
                toast.success("คัดลอกแล้ว ไปวางในไลน์กลุ่มได้เลย");
              },
              () => toast.error("คัดลอกไม่ได้ กดค้างที่ข้อความเพื่อคัดลอกเอง"),
            )
          }
        >
          <Copy className="h-4 w-4" /> {copied ? "คัดลอกแล้ว" : "คัดลอกข้อความ"}
        </Button>
      </section>
      <Button variant="outline" className="h-12" onClick={onDone}>
        กลับหน้าขอเบิก
      </Button>
    </div>
  );
}

/** One request: its lines (declined ones with the kitchen's reason), copy, print, cancel */
export function RequestDetail({
  r,
  loadLines,
  message,
  canEdit,
  onCancel,
}: {
  r: AnyRequest;
  loadLines: () => Promise<(TRDetailLine | PRDetailLine)[]>;
  message: (lines: (TRDetailLine | PRDetailLine)[]) => string;
  canEdit: boolean;
  onCancel: () => Promise<void>;
}) {
  const [lines, setLines] = useState<(TRDetailLine | PRDetailLine)[] | null>(null);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    let live = true;
    loadLines().then((l) => live && setLines(l));
    return () => {
      live = false;
    };
  }, [loadLines]);
  const unit = (l: TRDetailLine | PRDetailLine) => ("packUnit" in l ? l.packUnit : "แพ็ค");
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start gap-2">
        <div className="mr-auto min-w-0">
          <div className="text-sm text-muted-foreground">{r.kind === "tr" ? "ขอเบิกจากครัวกลาง" : r.row.supplierName}</div>
          <h2 className="font-mono text-xl font-bold">{numberOf(r)}</h2>
          <p className="text-sm text-muted-foreground">
            ขอวันที่ {thaiDay(r.row.requestedDate)} · ส่ง {thaiDay(r.row.requiredDate)}
          </p>
        </div>
        <StatusChip r={r} />
      </div>
      {r.row.notes && <div className="rounded-xl bg-secondary px-3 py-2 text-sm">หมายเหตุ: {r.row.notes}</div>}
      <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
        {lines === null && <li className="p-6 text-center text-sm text-muted-foreground">กำลังโหลด…</li>}
        {lines?.map((l) => (
          <li key={l.id} className={cn("flex items-center gap-3 px-4 py-2.5", "declineReason" in l && l.declineReason && "bg-destructive/5")}>
            <div className="min-w-0 flex-1">
              <div className="text-[15px]">{l.skuName}</div>
              <div className="text-sm text-muted-foreground">
                <span className="font-mono text-xs">{l.skuCode}</span> · ตอนขอเหลือ <b className="font-mono text-[15px] text-foreground">{Math.round(l.stockOnHand).toLocaleString()}</b> {l.uom}
              </div>
              {"declineReason" in l && l.declineReason && <div className="text-sm font-medium text-destructive">ครัวกลางไม่ได้ส่ง: {l.declineReason}</div>}
            </div>
            <div className="shrink-0 text-right">
              <div className="font-mono text-[15px] font-semibold">
                {Math.round(l.requestedQty / Math.max(1, l.packSize)).toLocaleString()} {unit(l)}
              </div>
              <div className="font-mono text-xs text-muted-foreground">
                {Math.round(l.requestedQty).toLocaleString()} {l.uom}
              </div>
            </div>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2 print:hidden">
        <Button variant="outline" className="h-11 flex-1" disabled={!lines} onClick={() => lines && navigator.clipboard.writeText(message(lines)).then(() => toast.success("คัดลอกข้อความแล้ว"))}>
          <Copy className="h-4 w-4" /> คัดลอกข้อความไลน์
        </Button>
        <Button variant="outline" className="h-11 flex-1" onClick={() => window.print()}>
          <Printer className="h-4 w-4" /> พิมพ์
        </Button>
        {canEdit && canCancel(r.row.status) && (
          <Button variant="ghost" className="h-11 text-destructive hover:text-destructive" onClick={() => setConfirm(true)}>
            ยกเลิกใบนี้
          </Button>
        )}
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="ยกเลิกใบนี้?"
        description={`${numberOf(r)} จะถูกยกเลิก ${r.kind === "tr" ? "ครัวกลางจะไม่เตรียมของตามใบนี้" : "ใบนี้จะไม่ถูกนับเป็นของที่กำลังมา"} ถ้ายังต้องการของ ให้ขอใหม่`}
        confirmLabel="ยกเลิกใบ"
        cancelLabel="ไม่ยกเลิก"
        onConfirm={async () => {
          setConfirm(false);
          await onCancel();
        }}
      />
    </div>
  );
}

/** Pick a supplier for a purchase order: this brand's suppliers first, search for the rest */
export function SupplierPick({ suppliers, onPick }: { suppliers: SupplierOption[]; onPick: (s: SupplierOption) => void }) {
  const [q, setQ] = useState("");
  const [all, setAll] = useState(false);
  const list = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return suppliers.filter((s) => (all || words.length || s.relevant) && words.every((w) => s.name.toLowerCase().includes(w)));
  }, [suppliers, q, all]);
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-xl font-bold">สั่งซื้อจากซัพพลายเออร์</h2>
        <p className="text-sm text-muted-foreground">เลือกร้านที่จะสั่ง</p>
      </div>
      <label className="relative block">
        <span className="sr-only">ค้นซัพพลายเออร์</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นซัพพลายเออร์…" className="h-11 pl-9 text-base" />
      </label>
      <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
        {list.map((s) => (
          <li key={s.id}>
            <button type="button" onClick={() => onPick(s)} className="flex min-h-[56px] w-full items-center gap-3 px-4 text-left hover:bg-secondary/60">
              <span className="min-w-0 flex-1 break-words text-[15px]">{s.name}</span>
              {s.pendingCount > 0 && <span className="rounded-full bg-warning-soft px-2 py-0.5 text-xs font-semibold text-warning">ค้าง {s.pendingCount} ใบ</span>}
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </button>
          </li>
        ))}
        {!list.length && <li className="p-6 text-center text-sm text-muted-foreground">{suppliers.length ? "ไม่พบ" : "กำลังโหลด…"}</li>}
      </ul>
      {!all && !q && suppliers.some((s) => !s.relevant) && (
        <button type="button" onClick={() => setAll(true)} className="min-h-[44px] text-sm text-muted-foreground underline-offset-4 hover:underline">
          แสดงซัพพลายเออร์อื่นด้วย
        </button>
      )}
    </div>
  );
}
