import { useMemo, useState } from "react";
import { toast } from "sonner";
import { X } from "lucide-react";
import type { SKU } from "@/types/sku";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { newRowId } from "@/lib/write-timeout";
import { outputCheck, saveWipBatch, type WipBatch, type WipInput } from "@/lib/wip";
import { thaiDay } from "@/components/sales/SalesDays";

const n0 = (n: number) => Math.round(n).toLocaleString("th-TH");
const parse = (v: string) => {
  const n = Number(v.replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * Record one batch of a WIP made at the branch: weigh what went in, each kind on its own
 * line; what came out starts as their total (the usual case) and can be changed. Saving
 * takes each input out of the branch's stock and puts the WIP in, all at once.
 * Opened again on a saved batch, it edits that batch (the same id replaces it).
 */
export function WipSheet({
  wip,
  inputs,
  skus,
  branchId,
  branchName,
  date,
  dateNote,
  batch,
  balanceOf,
  onClose,
  onSaved,
  save: saveFn = saveWipBatch,
}: {
  /** Dev demo: where a save goes (default: the database) */
  save?: typeof saveWipBatch;
  wip: SKU;
  inputs: WipInput[];
  skus: SKU[];
  branchId: string;
  branchName: string;
  /** The day it's recorded on (the count day it belongs to) */
  date: string;
  /** Why it's on that day, when it isn't today's sheet (today's count already sent) */
  dateNote?: string;
  /** Editing a saved batch */
  batch?: WipBatch;
  /** What the system has of an input at the branch now (null = not known) */
  balanceOf?: (skuId: string) => number | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const byId = useMemo(() => new Map(skus.map((s) => [s.id, s])), [skus]);
  // What may go in, plus (editing) what the batch had even if it was taken off the list since
  const listed = inputs.filter((i) => i.wipSkuId === wip.id && byId.get(i.skuId));
  const own = [...listed, ...(batch?.lines ?? []).filter((l) => !listed.some((i) => i.skuId === l.skuId) && byId.get(l.skuId)).map((l) => ({ id: `old-${l.skuId}`, wipSkuId: wip.id, skuId: l.skuId }))];
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries((batch?.lines ?? []).map((l) => [l.skuId, String(l.qty)])));
  // What came out: follows the total until it's typed in
  const [out, setOut] = useState<string>(batch ? String(batch.outputQty) : "");
  const [outTyped, setOutTyped] = useState(!!batch);
  const [busy, setBusy] = useState(false);
  // The id is made once per sheet: pressed again after no answer, the same batch is replaced, never doubled
  const [id] = useState(() => batch?.id ?? newRowId());
  const uom = wip.usageUom || "ก.";

  const lines = own.map((i) => ({ skuId: i.skuId, qty: parse(qty[i.skuId] ?? "") }));
  const used = lines.filter((l) => l.qty > 0);
  const total = used.reduce((s, l) => s + l.qty, 0);
  const output = outTyped ? parse(out) : total;
  const check = outputCheck(total, output);
  const short = used.filter((l) => {
    const b = balanceOf?.(l.skuId);
    // The batch's own amounts are already out of the balance while editing it
    const back = batch?.lines.find((x) => x.skuId === l.skuId)?.qty ?? 0;
    return b !== null && b !== undefined && l.qty > b + back + 0.5;
  });
  const canSave = used.length > 0 && output > 0 && !busy;

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    const res = await saveFn({ id, branchId, wipSkuId: wip.id, madeDate: date, outputQty: output, note: "", lines: used });
    setBusy(false);
    if (!res.ok) {
      toast.error("บันทึกไม่ได้: " + ("message" in res ? res.message : ""));
      return;
    }
    toast.success(`บันทึก${wip.name} ${n0(output)} ${uom} แล้ว`, { description: `ใช้ ${used.length} อย่าง รวม ${n0(total)} ${uom}` });
    onSaved();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 md:items-center" onClick={busy ? undefined : onClose}>
      <div role="dialog" aria-label={`ทำ${wip.name}`} className="flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-card shadow-raised md:max-w-lg md:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3 border-b border-border p-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold">
              {batch ? "แก้" : "ทำ"}
              {wip.name}
            </h2>
            <p className="text-sm text-muted-foreground">
              {branchName} · ของวันที่ {thaiDay(date)}
            </p>
            {dateNote && <p className="mt-1 text-sm text-warning">{dateNote}</p>}
          </div>
          <button type="button" aria-label="ปิด" onClick={onClose} className="grid h-11 w-11 place-items-center rounded-xl text-muted-foreground hover:bg-secondary">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex flex-col gap-3 overflow-y-auto p-4">
          {own.length === 0 ? (
            <p className="rounded-xl bg-warning-soft p-3 text-sm text-warning">ยังไม่ได้ตั้งว่าใส่อะไรได้บ้าง · แจ้งผู้ดูแลให้ตั้งใน Cost Center</p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">ชั่งแต่ละอย่างที่ใส่ · อย่างไหนไม่ได้ใส่ เว้นว่าง</p>
              <ul className="flex flex-col gap-2">
                {own.map((i) => {
                  const s = byId.get(i.skuId)!;
                  const b = balanceOf?.(i.skuId);
                  const isShort = short.some((x) => x.skuId === i.skuId);
                  return (
                    <li key={i.skuId} className="grid grid-cols-[minmax(0,1fr)_150px] items-center gap-3">
                      <span className="min-w-0">
                        <span className="block text-[15px] leading-snug">{s.name}</span>
                        {b !== null && b !== undefined && <span className={cn("block text-[13px]", isShort ? "font-semibold text-destructive" : "text-muted-foreground")}>ในระบบเหลือ {n0(b)} {s.usageUom}</span>}
                      </span>
                      <span className={cn("flex h-11 items-center overflow-hidden rounded-xl border bg-background focus-within:ring-2 focus-within:ring-ring", isShort ? "border-warning" : "border-input")}>
                        <input
                          inputMode="decimal"
                          value={qty[i.skuId] ?? ""}
                          placeholder="0"
                          onChange={(e) => setQty((q) => ({ ...q, [i.skuId]: e.target.value }))}
                          onFocus={(e) => e.target.select()}
                          aria-label={`น้ำหนัก ${s.name}`}
                          className="h-full w-full min-w-0 bg-transparent px-3 text-right font-mono text-base tabular-nums outline-none placeholder:text-muted-foreground/50"
                        />
                        <span className="shrink-0 pr-3 text-sm text-muted-foreground">{s.usageUom || "ก."}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
              {short.length > 0 && (
                <p className="rounded-xl bg-warning-soft p-3 text-sm text-warning">
                  {short.map((l) => byId.get(l.skuId)?.name).join(" · ")} ใส่มากกว่าที่ระบบมี · บันทึกได้ (ยอดจะติดลบ) แต่เช็คตัวเลขก่อน
                </p>
              )}
              <div className="flex items-center justify-between rounded-xl bg-secondary px-3 py-2.5 text-[15px]">
                <span>รวมที่ใส่ · {used.length} อย่าง</span>
                <b className="font-mono">
                  {n0(total)} {uom}
                </b>
              </div>
              <label className="grid grid-cols-[minmax(0,1fr)_150px] items-center gap-3">
                <span>
                  <span className="block text-[15px]">{wip.name}ที่ได้</span>
                  <span className="block text-[13px] text-muted-foreground">ใส่ให้เท่ารวม · แก้ได้ถ้าชั่งรวมแล้วไม่เท่า</span>
                </span>
                <span className={cn("flex h-11 items-center overflow-hidden rounded-xl border bg-background focus-within:ring-2 focus-within:ring-ring", check !== "ok" ? "border-warning" : "border-input")}>
                  <input
                    inputMode="decimal"
                    value={outTyped ? out : total ? String(Math.round(total * 100) / 100) : ""}
                    placeholder="0"
                    onChange={(e) => {
                      setOutTyped(true);
                      setOut(e.target.value);
                    }}
                    onFocus={(e) => e.target.select()}
                    aria-label={`${wip.name}ที่ได้`}
                    className="h-full w-full min-w-0 bg-transparent px-3 text-right font-mono text-base tabular-nums outline-none placeholder:text-muted-foreground/50"
                  />
                  <span className="shrink-0 pr-3 text-sm text-muted-foreground">{uom}</span>
                </span>
              </label>
              {check === "over" && <p className="rounded-xl bg-warning-soft p-3 text-sm text-warning">ได้มากกว่าที่ใส่ · ชั่งถูกไหม (ถ้าเติมน้ำหรือซอสด้วย บันทึกได้)</p>}
              {check === "loss" && <p className="rounded-xl bg-warning-soft p-3 text-sm text-warning">ได้น้อยกว่าที่ใส่ {n0(total - output)} {uom} · ชั่งถูกไหม</p>}
            </>
          )}
        </div>

        <div className="flex flex-col gap-1.5 border-t border-border p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <Button variant="brand" className="h-12 text-base" disabled={!canSave} loading={busy} onClick={save}>
            บันทึก
          </Button>
          {used.length > 0 && (
            <p className="text-center text-[13px] text-muted-foreground">
              หลังบันทึก: {used.length} อย่าง −{n0(total)} {uom} · {wip.name} +{n0(output)} {uom}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
