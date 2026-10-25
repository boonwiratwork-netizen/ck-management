import { useMemo, useState } from "react";
import { Check, PencilLine } from "lucide-react";
import type { SKU } from "@/types/sku";
import type { PendingTO } from "@/hooks/use-receive-data";
import { isPacksMode, packsFromQty, qtyFromPacks, transferOrderRow, transferOrderStatusAfter, type ReceiptRow } from "@/lib/receive-rows";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ActionFooter, NoteField, PackStepper, WeightField, baht, packHint, packLabel } from "./parts";
import { cn } from "@/lib/utils";

interface Props {
  to: PendingTO;
  branchId: string;
  receiptDate: string;
  skuMap: Map<string, SKU>;
  onReceive: (rows: ReceiptRow[], receivedByLine: Map<string, number>) => Promise<boolean>;
  onDecline: (reason: string) => Promise<boolean>;
  /** Returns kitchen receipts without a transfer order that look like the same goods */
  findDoubles: (lines: { skuId: string; qty: number }[]) => Promise<string[]>;
}

type LineState = { qty: number; checked: boolean; note: string; editing: boolean };

/**
 * Receiving a central-kitchen transfer order. Every line starts at what was sent
 * (actual qty, else planned — as before); staff tap "ครบ" or adjust the short
 * ones. Saving with lines not yet checked asks first.
 */
export function ReceiveTransferOrder({ to, branchId, receiptDate, skuMap, onReceive, onDecline, findDoubles }: Props) {
  const sentQty = (l: PendingTO["lines"][number]) => (l.actualQty > 0 ? l.actualQty : l.plannedQty);
  const [lines, setLines] = useState<Record<string, LineState>>(() =>
    Object.fromEntries(to.lines.map((l) => [l.id, { qty: sentQty(l), checked: false, note: l.notes, editing: false }])),
  );
  const [saving, setSaving] = useState(false);
  const [confirmUnchecked, setConfirmUnchecked] = useState(false);
  const [dupText, setDupText] = useState<string | null>(null);
  const [declineOpen, setDeclineOpen] = useState(false);
  const set = (id: string, patch: Partial<LineState>) => setLines((p) => ({ ...p, [id]: { ...p[id], ...patch } }));

  const counts = useMemo(() => {
    let full = 0;
    let short = 0;
    let unchecked = 0;
    for (const l of to.lines) {
      const s = lines[l.id];
      if (!s.checked) unchecked++;
      else if (s.qty >= sentQty(l)) full++;
      else short++;
    }
    return { full, short, unchecked };
  }, [lines, to.lines]);
  const total = to.lines.reduce((sum, l) => sum + lines[l.id].qty * l.unitCost, 0);

  const doSave = async (skipDupCheck: boolean) => {
    const toSave = to.lines.filter((l) => lines[l.id].qty > 0);
    if (toSave.length === 0) return;
    setSaving(true);
    if (!skipDupCheck) {
      const dups = await findDoubles(toSave.map((l) => ({ skuId: l.skuId, qty: lines[l.id].qty })));
      if (dups.length) {
        setDupText(`ของเหล่านี้เพิ่งรับจากครัวกลางแบบไม่มีใบโอนไปแล้ว:\n${dups.join("\n")}\n\nถ้าเป็นของชุดเดียวกัน ให้กดยกเลิก แล้วลบรายการเก่าที่ไม่มีใบโอนในประวัติก่อน`);
        setSaving(false);
        return;
      }
    }
    const rows = toSave.map((l) =>
      transferOrderRow({ branchId, receiptDate, sku: skuMap.get(l.skuId), skuId: l.skuId, lineUom: l.uom, qty: lines[l.id].qty, unitCost: l.unitCost, note: lines[l.id].note, transferOrderId: to.id }),
    );
    await onReceive(rows, new Map(to.lines.map((l) => [l.id, lines[l.id].qty])));
    setSaving(false);
  };

  const save = () => {
    if (counts.unchecked > 0) setConfirmUnchecked(true);
    else doSave(false);
  };
  const status = transferOrderStatusAfter(to.lines, new Map(to.lines.map((l) => [l.id, lines[l.id].qty])));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm text-muted-foreground">ครัวกลาง · ส่ง {to.deliveryDate}</div>
          <h2 className="font-mono text-xl font-bold">{to.toNumber}</h2>
        </div>
        <Button variant="outline" className="h-10" onClick={() => setDeclineOpen(true)}>
          ปฏิเสธใบนี้
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl bg-success-soft px-3 py-2 text-success"><div className="text-sm">ครบ</div><div className="text-lg font-bold">{counts.full}</div></div>
        <div className="rounded-xl bg-warning-soft px-3 py-2 text-warning"><div className="text-sm">ไม่ครบ</div><div className="text-lg font-bold">{counts.short}</div></div>
        <div className="rounded-xl bg-secondary px-3 py-2"><div className="text-sm text-muted-foreground">ยังไม่เช็ค</div><div className="text-lg font-bold">{counts.unchecked}</div></div>
      </div>
      {counts.unchecked > 0 && (
        <Button variant="outline" className="h-11 border-dashed" onClick={() => setLines((p) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v.checked ? v : { ...v, checked: true }])))}>
          ที่เหลือครบตามที่ส่งทั้งหมด
        </Button>
      )}

      <ul className="flex flex-col gap-2">
        {to.lines.map((l) => {
          const sku = skuMap.get(l.skuId);
          const s = lines[l.id];
          const sent = sentQty(l);
          const isShort = s.checked && s.qty < sent;
          const showStepper = s.editing || isShort;
          return (
            <li key={l.id} className={cn("flex flex-col gap-2 rounded-2xl border bg-card p-3 shadow-card", isShort ? "border-warning/50" : "border-border")}>
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-semibold">{sku?.name ?? "สินค้าที่ถูกลบไปแล้ว"}</div>
                  <div className={cn("text-sm", isShort ? "text-warning" : "text-muted-foreground")}>
                    ส่งมา {packLabel(sku, sent)}
                    {isShort && ` · ได้จริง ${packLabel(sku, s.qty)}`}
                    {!isShort && packHint(sku) && ` · ${packHint(sku)}`}
                  </div>
                </div>
                {!showStepper &&
                  (s.checked ? (
                    <span className="flex min-h-[36px] items-center gap-1 rounded-full bg-success-soft px-3 text-sm font-semibold text-success">
                      <Check className="h-4 w-4" /> ครบ
                    </span>
                  ) : (
                    <Button variant="outline" className="h-11 border-foreground px-4 font-semibold" onClick={() => set(l.id, { checked: true, qty: sent })}>
                      ครบ
                    </Button>
                  ))}
                {!showStepper && (
                  <button type="button" aria-label="แก้จำนวน" onClick={() => set(l.id, { editing: true, checked: true })} className="flex h-11 w-11 items-center justify-center rounded-xl border border-border">
                    <PencilLine className="h-4 w-4" />
                  </button>
                )}
                {showStepper && (
                  <PackStepper
                    label={`จำนวนที่ได้ ${sku?.name ?? ""}`}
                    value={packsFromQty(sku, s.qty)}
                    step={isPacksMode(sku) ? 1 : 1}
                    onChange={(v) => set(l.id, { qty: qtyFromPacks(sku, v), checked: true })}
                  />
                )}
              </div>
              {showStepper && (
                <div className="flex flex-wrap items-center gap-x-4">
                  <WeightField sku={sku} qty={s.qty} onChange={(qty) => set(l.id, { qty, checked: true })} />
                  <div className="min-w-0 flex-1"><NoteField value={s.note} onChange={(note) => set(l.id, { note })} /></div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <ActionFooter
        title={status === "Received" ? "รับครบทั้งใบ" : status === "Partially Received" ? `รับบางส่วน · ${counts.full} จาก ${to.lines.length}` : "ยังไม่ได้รับอะไร"}
        sub={`มูลค่า ${baht(total)}${counts.unchecked ? ` · ยังไม่เช็ค ${counts.unchecked}` : ""}`}
        action="บันทึก"
        busy={saving}
        disabled={status === "Sent"}
        onAction={save}
      />

      <ConfirmDialog
        open={confirmUnchecked}
        onOpenChange={setConfirmUnchecked}
        title={`ยังไม่เช็ค ${counts.unchecked} รายการ`}
        description="ถือว่ารายการที่ยังไม่เช็คได้ครบตามที่ส่งมา แล้วบันทึกเลยไหม?"
        confirmLabel="ครบตามที่ส่ง บันทึก"
        cancelLabel="กลับไปเช็ค"
        variant="warning"
        onConfirm={() => {
          setConfirmUnchecked(false);
          doSave(false);
        }}
      />
      <ConfirmDialog
        open={dupText !== null}
        onOpenChange={(o) => !o && setDupText(null)}
        title="อาจรับของซ้ำ"
        description={dupText ?? ""}
        confirmLabel="ไม่ซ้ำ บันทึกต่อ"
        cancelLabel="ยกเลิก"
        variant="warning"
        onConfirm={() => {
          setDupText(null);
          doSave(true);
        }}
      />
      <DeclineDialog
        open={declineOpen}
        toNumber={to.toNumber}
        onClose={() => setDeclineOpen(false)}
        onDecline={async (reason) => {
          if (await onDecline(reason)) setDeclineOpen(false);
        }}
      />
    </div>
  );
}

/** Decline a transfer order with a reason (bottom sheet on phones) */
export function DeclineDialog({ open, toNumber, onClose, onDecline }: { open: boolean; toNumber: string; onClose: () => void; onDecline: (reason: string) => Promise<void> | void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/30 md:items-center" onClick={onClose}>
      <div role="dialog" aria-label="ปฏิเสธใบโอน" className="flex w-full flex-col gap-3 rounded-t-2xl bg-card p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-raised md:max-w-md md:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold">ปฏิเสธใบโอน {toNumber}?</h3>
        <p className="text-sm text-muted-foreground">ใบนี้จะไม่ถูกรับเข้าสต๊อก ครัวกลางจะเห็นเหตุผลนี้</p>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เหตุผล เช่น ส่งผิดสาขา ของเสีย" className="min-h-[88px] text-base" aria-label="เหตุผล" />
        <div className="flex justify-end gap-2">
          <Button variant="outline" className="h-11" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button
            variant="destructive"
            className="h-11"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              await onDecline(reason);
              setBusy(false);
              setReason("");
            }}
          >
            ปฏิเสธ
          </Button>
        </div>
      </div>
    </div>
  );
}
