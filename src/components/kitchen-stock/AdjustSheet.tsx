import { useState } from "react";
import { X } from "lucide-react";
import type { SKU } from "@/types/sku";
import { afterCount, type CountAnchor } from "@/lib/count-anchor";
import { Button } from "@/components/ui/button";
import { cn, toLocalDateStr } from "@/lib/utils";

/** The reasons the kitchen really types (60 days of adjustments, Oct 2026) */
const REASONS = ["Workshop", "ส่งเทสสูตร", "ใช้ในครัว", "เสีย / ทิ้ง", "อื่นๆ"] as const;

const n0 = (n: number) => Math.round(n).toLocaleString();
const thaiDate = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("th-TH", { day: "numeric", month: "short" });

/**
 * Add or take out stock by hand (Workshop, a test, kitchen use, waste). Says when the
 * chosen date falls before the last count (the count already includes it, so the
 * balance won't move), and only closes once the save really went through.
 */
export function AdjustSheet({
  sku,
  stock,
  anchor,
  onSave,
  onClose,
}: {
  sku: SKU;
  stock: number;
  anchor: CountAnchor | null;
  onSave: (adj: { skuId: string; date: string; quantity: number; reason: string }) => Promise<boolean>;
  onClose: () => void;
}) {
  const today = toLocalDateStr(new Date());
  const [dir, setDir] = useState<"in" | "out">("out");
  const [reason, setReason] = useState<(typeof REASONS)[number] | null>(null);
  const [note, setNote] = useState("");
  const [qty, setQty] = useState("");
  const [date, setDate] = useState(today);
  const [busy, setBusy] = useState(false);

  const amount = Math.max(0, Number(qty.replace(/,/g, "")) || 0);
  const beforeCount = !!anchor && !afterCount(anchor, date);
  const after = beforeCount ? stock : stock + (dir === "in" ? amount : -amount);
  const text = reason === "อื่นๆ" ? note.trim() : [reason, note.trim()].filter(Boolean).join(" · ");
  // Reason words other screens read as a type (production, delivery, count) stay out
  const safe = /^(Production|Distribution)/.test(text) || text.includes("Stock Count") ? `ปรับยอด: ${text}` : text;
  const ready = amount > 0 && !!reason && !!text && !!date;

  const save = async () => {
    if (!ready || busy) return;
    setBusy(true);
    const ok = await onSave({ skuId: sku.id, date, quantity: dir === "in" ? amount : -amount, reason: safe });
    setBusy(false);
    if (ok) onClose();
  };

  const seg = (on: boolean) => cn("min-h-[44px] flex-1 rounded-[11px] text-[15px]", on ? "bg-card font-semibold shadow-card" : "text-muted-foreground");
  const chip = (on: boolean) => cn("min-h-[40px] rounded-full border px-4 text-sm", on ? "border-primary bg-primary font-semibold text-primary-foreground" : "border-border bg-card");

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={`ปรับยอด ${sku.name}`} className="flex max-h-[92dvh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-t-3xl bg-background p-5 sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="break-words text-xl font-bold">ปรับยอด · {sku.name}</h2>
            <p className="text-sm text-muted-foreground">
              ในระบบตอนนี้ <span className="font-mono">{n0(stock)} {sku.usageUom}</span>
              {anchor ? ` · นับล่าสุด ${thaiDate(anchor.count_date)}` : " · ยังไม่เคยนับ"}
            </p>
          </div>
          <button type="button" aria-label="ปิด" onClick={onClose} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div>
          <span className="mb-1.5 block text-sm font-semibold">เพิ่มหรือลด</span>
          <div className="flex gap-1 rounded-[14px] bg-secondary p-1">
            <button type="button" className={seg(dir === "in")} onClick={() => setDir("in")}>
              + เพิ่มเข้า
            </button>
            <button type="button" className={seg(dir === "out")} onClick={() => setDir("out")}>
              − ตัดออก
            </button>
          </div>
        </div>

        <div>
          <span className="mb-1.5 block text-sm font-semibold">เหตุผล</span>
          <div className="flex flex-wrap gap-1.5">
            {REASONS.map((r) => (
              <button key={r} type="button" className={chip(reason === r)} onClick={() => setReason(r)}>
                {r}
              </button>
            ))}
          </div>
          {reason && (
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={reason === "อื่นๆ" ? "พิมพ์เหตุผล" : "รายละเอียด (ไม่ใส่ก็ได้)"}
              className="mt-2 h-12 w-full rounded-xl border border-input bg-card px-3 text-base"
            />
          )}
          <p className="mt-1.5 text-xs text-muted-foreground">ยอดที่นับได้ใส่ที่หน้านับสต๊อก ไม่ใช่ที่นี่</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            จำนวน ({sku.usageUom})
            <input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} className="h-12 rounded-xl border border-input bg-card px-3 text-right font-mono text-base" />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            วันที่
            <input type="date" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} className={cn("h-12 rounded-xl border bg-card px-3 text-base", beforeCount ? "border-warning" : "border-input")} />
          </label>
        </div>

        {beforeCount && anchor && (
          <div className="rounded-2xl bg-warning-soft px-4 py-3 text-sm text-warning">
            <div className="font-semibold">วันที่นี้อยู่ก่อนวันนับ ({thaiDate(anchor.count_date)})</div>
            ยอดที่นับได้รวมรายการนี้ไปแล้ว บันทึกไปจะไม่เปลี่ยนยอดในระบบ · ถ้าเกิดหลังวันนับ เปลี่ยนวันที่เป็นวันจริง
          </div>
        )}

        <div className="flex items-center justify-between border-t border-border pt-3 text-sm">
          <span className="text-muted-foreground">หลังบันทึก</span>
          <span className={cn("font-mono font-semibold", beforeCount && "text-warning")}>
            {beforeCount ? `ไม่เปลี่ยน · ${n0(stock)}` : `${n0(stock)} → ${n0(after)}`} {sku.usageUom}
          </span>
        </div>
        <Button variant="brand" className="h-12 text-base" disabled={!ready} loading={busy} onClick={save}>
          {dir === "in" ? "เพิ่มเข้า" : "ตัดออก"} {amount > 0 ? `${n0(amount)} ${sku.usageUom}` : ""}
        </Button>
      </div>
    </div>
  );
}
