import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Hammer } from "lucide-react";
import type { SKU } from "@/types/sku";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { cn } from "@/lib/utils";
import { deleteWipBatch, loadWipBatches, loadWipInputs, type WipBatch, type WipInput } from "@/lib/wip";
import { WipSheet } from "./WipSheet";

const n0 = (n: number) => Math.round(n).toLocaleString("th-TH");
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });

/**
 * "ทำ WIP วันนี้" in the count page's checklist: what the branch made itself on that day,
 * a button to record a batch, and each batch with edit / delete (until that day's count is
 * sent). Shows nothing while no WIP is set up (no change for branches that don't make one).
 */
export function WipCheck({
  branchId,
  branchName,
  date,
  closed,
  nextDate,
  skus,
  canEdit,
  balanceOf,
  onChanged,
  demo,
}: {
  /** Dev demo: in-memory WIP set-up and batches, nothing written */
  demo?: { inputs: WipInput[]; batches: WipBatch[]; save: (b: WipBatch) => void; remove: (id: string) => void };
  branchId: string;
  branchName: string;
  /** The count day */
  date: string;
  /** That day's count is sent: new batches go to the next day */
  closed: boolean;
  nextDate: string;
  skus: SKU[];
  canEdit: boolean;
  balanceOf?: (skuId: string) => number | null;
  /** A batch saved or deleted: the sheet moves with it */
  onChanged: () => void;
}) {
  const [inputs, setInputs] = useState<WipInput[] | null>(null);
  const [batches, setBatches] = useState<WipBatch[]>([]);
  const [open, setOpen] = useState<{ wip: SKU; batch?: WipBatch } | null>(null);
  const [deleting, setDeleting] = useState<WipBatch | null>(null);
  const day = closed ? nextDate : date;

  // The latest demo data (a save's callback runs after the parent re-rendered with it)
  const demoRef = useRef(demo);
  demoRef.current = demo;
  const load = useCallback(() => {
    const d = demoRef.current;
    if (d) {
      setInputs(d.inputs);
      setBatches(d.batches);
      return;
    }
    loadWipInputs().then(setInputs, () => setInputs([]));
    loadWipBatches(branchId, date, nextDate).then(setBatches, () => setBatches([]));
  }, [branchId, date, nextDate, demo]); // eslint-disable-line react-hooks/exhaustive-deps -- demo: a demo save re-reads it
  useEffect(() => load(), [load]);

  const wips = useMemo(() => {
    const withInputs = new Set((inputs ?? []).map((i) => i.wipSkuId));
    return skus.filter((s) => s.type === "WIP" && s.status === "Active" && withInputs.has(s.id));
  }, [skus, inputs]);
  if (!inputs || !wips.length) return null;

  const name = (id: string) => skus.find((s) => s.id === id)?.name ?? "";
  const uom = (id: string) => skus.find((s) => s.id === id)?.usageUom || "ก.";
  const today = batches.filter((b) => b.madeDate === day);
  const summary = today.length
    ? [...new Set(today.map((b) => b.wipSkuId))].map((w) => `${name(w)} ${today.filter((b) => b.wipSkuId === w).length} รอบ · ${n0(today.filter((b) => b.wipSkuId === w).reduce((s, b) => s + b.outputQty, 0))} ${uom(w)}`).join(" · ")
    : "ยังไม่ได้บันทึก · ทำแล้วบันทึกก่อนนับ";
  const changed = () => {
    load();
    onChanged();
  };

  return (
    <div className="border-t border-border bg-secondary/40 px-4 py-2">
      <div className="flex min-h-[52px] items-center gap-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-card text-foreground">
          <Hammer className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px]">ทำเองที่ร้าน (WIP){closed ? " · พรุ่งนี้" : " วันนี้"}</span>
          <span className="block text-sm text-muted-foreground">{summary}</span>
        </span>
        {canEdit && (
          <span className="flex shrink-0 flex-wrap justify-end gap-1.5">
            {wips.map((w) => (
              <button key={w.id} type="button" onClick={() => setOpen({ wip: w })} className="min-h-[44px] rounded-xl border border-border bg-card px-3 text-sm font-semibold">
                + ทำ{w.name}
              </button>
            ))}
          </span>
        )}
      </div>
      {today.length > 0 && (
        <ul className="mb-1 ml-10 divide-y divide-border rounded-xl border border-border bg-card text-sm">
          {today.map((b) => (
            <li key={b.id} className="flex min-h-[44px] items-center gap-2 px-3">
              <span className="flex-1">
                {hhmm(b.createdAt)} · {name(b.wipSkuId)} {n0(b.outputQty)} {uom(b.wipSkuId)} · จาก {b.lines.length} อย่าง
              </span>
              {canEdit && (
                <>
                  <button type="button" className="min-h-[40px] px-2 font-semibold text-brand" onClick={() => setOpen({ wip: skus.find((s) => s.id === b.wipSkuId)!, batch: b })}>
                    แก้
                  </button>
                  <button type="button" className={cn("min-h-[40px] px-2 text-muted-foreground")} onClick={() => setDeleting(b)}>
                    ลบ
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {open && (
        <WipSheet
          wip={open.wip}
          inputs={inputs}
          skus={skus}
          branchId={branchId}
          branchName={branchName}
          date={open.batch?.madeDate ?? day}
          dateNote={closed && !open.batch ? "ใบนับของวันนี้ส่งแล้ว รอบนี้จะเข้าใบนับของวันถัดไป" : undefined}
          batch={open.batch}
          balanceOf={closed ? undefined : balanceOf}
          onClose={() => setOpen(null)}
          onSaved={changed}
          save={
            demo
              ? async (b) => {
                  demo.save({ ...b, inputQty: b.lines.reduce((s, l) => s + l.qty, 0), costPerUnit: 0, createdAt: new Date().toISOString() });
                  return { ok: true as const };
                }
              : undefined
          }
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={deleting ? `ลบ${name(deleting.wipSkuId)} ${n0(deleting.outputQty)} ${uom(deleting.wipSkuId)}?` : ""}
        description={deleting ? `ของที่ใส่จะกลับเข้าสต๊อก และ${name(deleting.wipSkuId)}รอบนี้จะออกจากสต๊อก` : ""}
        confirmLabel="ลบ"
        cancelLabel="ไม่ลบ"
        onConfirm={async () => {
          const b = deleting;
          setDeleting(null);
          if (!b) return;
          const res = demo ? (demo.remove(b.id), { ok: true as const }) : await deleteWipBatch(b.id);
          if ("message" in res) return void toast.error("ลบไม่ได้: " + res.message);
          toast.success("ลบแล้ว");
          changed();
        }}
      />
    </div>
  );
}
