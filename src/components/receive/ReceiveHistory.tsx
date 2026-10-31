import { useMemo, useState } from "react";
import { MessageSquare, Pencil, Trash2 } from "lucide-react";
import type { SKU } from "@/types/sku";
import type { Branch } from "@/types/branch";
import type { HistoryReceipt } from "@/hooks/use-receive-data";
import { CK_SUPPLIER_NAME } from "@/lib/receive-rows";
import { useProgressiveList } from "@/hooks/use-progressive-list";
import { ShowMoreRows } from "@/components/ShowMoreRows";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { baht, packLabel } from "./parts";
import { cn } from "@/lib/utils";

interface Props {
  history: HistoryReceipt[];
  loading: boolean;
  skuMap: Map<string, SKU>;
  branches: Branch[];
  showBranch: boolean;
  from: string;
  to: string;
  onRange: (from: string, to: string) => void;
  onUpdate: (r: HistoryReceipt, edit: { qtyReceived: number; actualTotal: number; notes: string }) => Promise<boolean>;
  onDelete: (r: HistoryReceipt) => Promise<boolean>;
  /** Rows this account may fix or remove (kitchen goods on an order: management only); all when not given */
  canChange?: (r: HistoryReceipt) => boolean;
}

const thaiDay = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("th-TH", { weekday: "short", day: "numeric", month: "short" });

/** What was received, day by day, with totals; each row can be fixed or removed */
export function ReceiveHistory({ history, loading, skuMap, branches, showBranch, from, to, onRange, onUpdate, onDelete, canChange = () => true }: Props) {
  const [editing, setEditing] = useState<HistoryReceipt | null>(null);
  const [deleting, setDeleting] = useState<HistoryReceipt | null>(null);
  const page = useProgressiveList(history, 100);
  const days = useMemo(() => {
    const m = new Map<string, HistoryReceipt[]>();
    for (const r of page.visible) m.set(r.receiptDate, [...(m.get(r.receiptDate) ?? []), r]);
    return [...m.entries()];
  }, [page.visible]);
  const totals = useMemo(() => {
    let actual = 0;
    let std = 0;
    for (const r of history) {
      actual += r.actualTotal;
      std += r.stdTotal;
    }
    return { actual, std, variance: actual - std };
  }, [history]);
  const dayTotal = (d: string) => history.filter((r) => r.receiptDate === d).reduce((s, r) => s + r.actualTotal, 0);
  const branchName = (id: string) => branches.find((b) => b.id === id)?.branchName ?? "";
  const source = (r: HistoryReceipt) => (r.toNumber ? r.toNumber : r.supplierName === CK_SUPPLIER_NAME ? "ครัวกลาง (กรณีไม่มีใบโอน)" : r.supplierName || "—");

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <h2 className="mr-auto text-lg font-bold">ประวัติรับของ</h2>
        <label className="flex flex-col text-sm">
          <span className="text-muted-foreground">ตั้งแต่</span>
          <Input type="date" value={from} max={to} onChange={(e) => e.target.value && onRange(e.target.value, to)} className="h-10 w-[150px]" />
        </label>
        <label className="flex flex-col text-sm">
          <span className="text-muted-foreground">ถึง</span>
          <Input type="date" value={to} min={from} onChange={(e) => e.target.value && onRange(from, e.target.value)} className="h-10 w-[150px]" />
        </label>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl bg-card px-3 py-2 shadow-card"><div className="text-sm text-muted-foreground">จ่ายจริง</div><div className="font-mono text-base font-bold tabular-nums">{baht(totals.actual)}</div></div>
        <div className="rounded-xl bg-card px-3 py-2 shadow-card"><div className="text-sm text-muted-foreground">ราคามาตรฐาน</div><div className="font-mono text-base font-bold tabular-nums">{baht(totals.std)}</div></div>
        <div className="rounded-xl bg-card px-3 py-2 shadow-card"><div className="text-sm text-muted-foreground">ต่าง</div><div className={cn("font-mono text-base font-bold tabular-nums", totals.variance > 0.5 ? "text-warning" : "text-success")}>{totals.variance > 0 ? "+" : ""}{baht(totals.variance)}</div></div>
      </div>

      {loading && history.length === 0 ? (
        <div className="h-32 animate-pulse rounded-2xl bg-card shadow-card" aria-busy="true" />
      ) : history.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">ไม่มีการรับของในช่วงนี้</div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
          {days.map(([day, rows]) => (
            <section key={day}>
              <header className="flex items-center justify-between bg-secondary/70 px-4 py-2 text-sm">
                <span className="font-semibold">{thaiDay(day)}</span>
                <span className="text-muted-foreground">{rows.length} รายการ · <span className="font-mono">{baht(dayTotal(day))}</span></span>
              </header>
              <ul className="divide-y divide-border">
                {rows.map((r) => {
                  const sku = skuMap.get(r.skuId);
                  return (
                    <li key={r.id} className="flex items-center gap-2 px-4 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="break-words text-[15px]">{sku?.name ?? "สินค้าที่ถูกลบไปแล้ว"}</span>
                          {r.notes && <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label={r.notes} />}
                        </div>
                        <div className="truncate text-sm text-muted-foreground">
                          <span className={cn(r.toNumber && "font-mono")}>{source(r)}</span>
                          {showBranch && ` · ${branchName(r.branchId)}`} · {packLabel(sku, r.qtyReceived)}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="font-mono text-sm tabular-nums">{baht(r.actualTotal)}</div>
                        {Math.abs(r.priceVariance) > 0.5 && <div className={cn("font-mono text-xs", r.priceVariance > 0 ? "text-warning" : "text-success")}>{r.priceVariance > 0 ? "+" : ""}{baht(r.priceVariance)}</div>}
                      </div>
                      {canChange(r) ? (
                        <>
                          <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0" aria-label="แก้รายการ" onClick={() => setEditing(r)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0 text-destructive hover:text-destructive" aria-label="ลบรายการ" onClick={() => setDeleting(r)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </>
                      ) : (
                        // Kitchen goods on an order: management fixes them, or the kitchen edits the order
                        <span className="w-20 shrink-0 text-right text-xs text-muted-foreground">แก้โดยครัวกลาง</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          <ShowMoreRows shown={page.shown} total={page.total} hasMore={page.hasMore} onMore={page.showMore} onAll={page.showAll} />
        </div>
      )}

      {editing && <EditReceipt r={editing} sku={skuMap.get(editing.skuId)} onClose={() => setEditing(null)} onSave={onUpdate} />}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="ลบรายการรับของ"
        description={deleting ? `ลบ ${skuMap.get(deleting.skuId)?.name ?? "รายการนี้"} ${packLabel(skuMap.get(deleting.skuId), deleting.qtyReceived)} วันที่ ${deleting.receiptDate}?\nสต๊อกและต้นทุนของสาขาจะคำนวณใหม่โดยไม่มีรายการนี้` : ""}
        confirmLabel="ลบ"
        cancelLabel="ยกเลิก"
        variant="destructive"
        onConfirm={async () => {
          const r = deleting;
          setDeleting(null);
          if (r) await onDelete(r);
        }}
      />
    </div>
  );
}

function EditReceipt({ r, sku, onClose, onSave }: { r: HistoryReceipt; sku?: SKU; onClose: () => void; onSave: Props["onUpdate"] }) {
  // Edit the stored amount itself (as before): converting to packs would round a weighed qty
  const [amount, setAmount] = useState(String(r.qtyReceived));
  const [total, setTotal] = useState(String(Math.round(r.actualTotal * 100) / 100));
  const [notes, setNotes] = useState(r.notes);
  const [saving, setSaving] = useState(false);
  const qty = Math.max(0, Number(amount) || 0);
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/30 md:items-center" onClick={onClose}>
      <div role="dialog" aria-label="แก้รายการรับของ" className="flex w-full flex-col gap-3 rounded-t-2xl bg-card p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-raised md:max-w-md md:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold">{sku?.name ?? "แก้รายการ"}</h3>
        <p className="-mt-2 text-sm text-muted-foreground">{r.receiptDate} · {r.toNumber ?? r.supplierName}</p>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            จำนวน ({r.uom || sku?.usageUom || ""})
            <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-11 text-right font-mono" />
            {sku && packLabel(sku, qty) !== `${qty.toLocaleString()} ${sku.usageUom || sku.purchaseUom || ""}`.trim() && (
              <span className="font-normal text-muted-foreground">≈ {packLabel(sku, qty)}</span>
            )}
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            ยอดจ่ายจริง (บาท)
            <Input inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} className="h-11 text-right font-mono" />
          </label>
        </div>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          หมายเหตุ
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} className="h-11" />
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="outline" className="h-11" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button
            variant="brand"
            className="h-11"
            loading={saving}
            disabled={!(qty > 0)}
            onClick={async () => {
              setSaving(true);
              const ok = await onSave(r, { qtyReceived: qty, actualTotal: Math.max(0, Number(total) || 0), notes });
              setSaving(false);
              if (ok) onClose();
            }}
          >
            บันทึก
          </Button>
        </div>
      </div>
    </div>
  );
}
