import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { moveRows, type MoveKind } from "@/lib/branch-stock";
import type { SKU } from "@/types/sku";
import type { Branch } from "@/types/branch";
import { cn, toLocalDateStr } from "@/lib/utils";

const KINDS: { kind: MoveKind; title: string; hint: string }[] = [
  { kind: "branch", title: "ให้สาขาอื่น", hint: "บันทึก 2 ฝั่งพร้อมกัน" },
  { kind: "kitchen", title: "ส่งคืนครัวกลาง", hint: "เข้าสต๊อกครัวพร้อมกัน" },
  { kind: "waste", title: "ของเสีย / หมดอายุ", hint: "หักออก" },
  { kind: "fix", title: "แก้ตัวเลขผิด", hint: "ต้องบอกเหตุผล" },
];

/**
 * Move stock out of a branch or correct it. Moves between places write both
 * sides in one insert, so neither side can be left alone (Thaniya +50, 23 Oct).
 * Saves only once the write went through; the sheet stays open on failure.
 */
export function MoveSheet({
  sku,
  balance,
  branch,
  branches,
  onClose,
  onSaved,
  write = async (rows) => !(await supabase.from("stock_adjustments").insert(rows as never)).error,
}: {
  sku: SKU;
  /** null: on no count sheet in 5 weeks, not known */
  balance: number | null;
  branch: Branch;
  branches: Branch[];
  onClose: () => void;
  onSaved: () => void;
  /** Dev demo only */
  write?: (rows: unknown[]) => Promise<boolean>;
}) {
  const [kind, setKind] = useState<MoveKind>("branch");
  const others = branches.filter((b) => b.id !== branch.id && b.status === "Active");
  const [to, setTo] = useState(others[0]?.id ?? "");
  const [qty, setQty] = useState("");
  const [sign, setSign] = useState<1 | -1>(-1);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const q = Math.abs(Number(qty.replace(/,/g, "")) || 0);
  const target = others.find((b) => b.id === to);
  const uom = sku.usageUom;
  const ready = q > 0 && (kind !== "branch" || !!target) && (kind !== "fix" || note.trim().length > 0);
  const n0 = (n: number) => Math.round(n).toLocaleString("th-TH");

  const summary =
    kind === "branch"
      ? `${branch.branchName} −${n0(q)} → ${target?.branchName ?? "…"} +${n0(q)} ${uom} · บันทึกพร้อมกัน`
      : kind === "kitchen"
        ? `${branch.branchName} −${n0(q)} → ครัวกลาง +${n0(q)} ${uom} · บันทึกพร้อมกัน`
        : kind === "waste"
          ? `${branch.branchName} −${n0(q)} ${uom}`
          : `${branch.branchName} ${sign > 0 ? "+" : "−"}${n0(q)} ${uom}`;

  const save = async () => {
    if (!ready || busy) return;
    let rows;
    try {
      rows = moveRows({ kind, fromBranch: { id: branch.id, name: branch.branchName }, toBranch: target ? { id: target.id, name: target.branchName } : undefined, skuId: sku.id, skuType: sku.type, qty: q, sign, note, date: toLocalDateStr(new Date()) });
    } catch (e) {
      toast.error((e as Error).message);
      return;
    }
    setBusy(true);
    const ok = await write(rows);
    setBusy(false);
    if (!ok) {
      toast.error("บันทึกไม่สำเร็จ ยังไม่มีอะไรถูกบันทึก ลองใหม่อีกครั้ง");
      return;
    }
    toast.success(kind === "branch" ? `ย้าย ${n0(q)} ${uom} ไป ${target?.branchName} แล้ว` : kind === "kitchen" ? `ส่งคืนครัวกลาง ${n0(q)} ${uom} แล้ว` : "บันทึกแล้ว");
    onSaved();
    onClose();
  };

  const field = "h-12 w-full rounded-xl border border-input bg-background px-3 text-right font-mono text-[17px]";
  return (
    <div className="fixed inset-0 z-[45] flex items-end justify-center bg-black/30 md:items-center" onClick={() => !busy && onClose()}>
      <div role="dialog" aria-label={`ย้ายของ / ปรับยอด ${sku.name}`} className="flex max-h-[92dvh] w-full flex-col gap-3 overflow-y-auto rounded-t-2xl bg-card p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-raised md:max-w-md md:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">
              {branch.branchName} · {sku.name}
            </p>
            <h3 className="text-lg font-bold">ย้ายของ / ปรับยอด</h3>
            <p className={cn("text-sm", balance !== null && balance < 0 ? "text-destructive" : "text-muted-foreground")}>
              {balance === null ? "คงเหลือ ไม่รู้ยอด (ไม่ได้นับเกิน 5 สัปดาห์)" : `คงเหลือ ${n0(balance)} ${uom}`}
            </p>
          </div>
          <Button variant="ghost" className="h-10 shrink-0 px-3" onClick={onClose} disabled={busy}>
            ปิด
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {KINDS.map((k) => (
            <button key={k.kind} type="button" onClick={() => setKind(k.kind)} className={cn("rounded-xl border bg-card p-2.5 text-left", kind === k.kind ? "border-[1.5px] border-foreground" : "border-border")}>
              <span className="block font-semibold">{k.title}</span>
              <span className="block text-xs text-muted-foreground">{k.hint}</span>
            </button>
          ))}
        </div>
        {kind === "branch" &&
          (others.length ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">ให้สาขา</span>
              {others.map((b) => (
                <button key={b.id} type="button" onClick={() => setTo(b.id)} className={cn("min-h-[40px] rounded-full border px-4 text-sm", to === b.id ? "border-primary bg-primary font-semibold text-primary-foreground" : "border-border bg-card")}>
                  {b.branchName}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">ไม่มีสาขาอื่นให้ย้ายไป</p>
          ))}
        {kind === "fix" && (
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setSign(-1)} className={cn("min-h-[44px] rounded-xl border", sign < 0 ? "border-[1.5px] border-foreground font-semibold" : "border-border")}>
              หักออก
            </button>
            <button type="button" onClick={() => setSign(1)} className={cn("min-h-[44px] rounded-xl border", sign > 0 ? "border-[1.5px] border-foreground font-semibold" : "border-border")}>
              เพิ่มเข้า
            </button>
          </div>
        )}
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold">จำนวน ({uom})</span>
          <input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" className={field} aria-label="จำนวน" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold">{kind === "fix" ? "เหตุผล (ต้องใส่)" : "หมายเหตุ (ถ้ามี)"}</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} className="h-12 w-full rounded-xl border border-input bg-background px-3 text-base" aria-label="หมายเหตุ" placeholder={kind === "fix" ? "เช่น นับผิด 26 ต.ค." : ""} />
        </label>
        {q > 0 && <p className="rounded-xl bg-secondary px-3 py-2 text-sm">{summary}</p>}
        <Button variant="brand" className="h-12 text-[16px]" loading={busy} disabled={!ready} onClick={save}>
          {kind === "branch" ? `ยืนยันย้าย${q ? ` ${n0(q)} ${uom}` : ""}${target ? ` ไป ${target.branchName}` : ""}` : kind === "kitchen" ? "ยืนยันส่งคืนครัวกลาง" : "ยืนยัน"}
        </Button>
      </div>
    </div>
  );
}
