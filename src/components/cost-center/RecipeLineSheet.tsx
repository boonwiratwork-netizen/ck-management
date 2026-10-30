import { useEffect, useRef, useState } from "react";
import type { SKU } from "@/types/sku";
import { SearchableSelect } from "@/components/SearchableSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { baht } from "./parts";

export interface SheetLine {
  skuId: string;
  qty: number;
  /** null for SP recipes (no usable % per line) */
  yieldPct: number | null;
  /** A step line put in as "% of what goes in" (12 = 12%); qty is then what that comes to */
  pct?: number | null;
}

interface Props {
  /** Editing a line in the recipe, or adding a new one (line = null) */
  line: SheetLine | null;
  recipeName: string;
  isSp: boolean;
  byId: Map<string, SKU>;
  /** What can go in this recipe; the line's own item is added to the list */
  options: { value: string; label: string; sublabel?: string }[];
  priceOf: (skuId: string) => number;
  /** A new recipe also asks what one batch makes */
  askBatch: { label: string; uom: string } | null;
  /** A line in a step of a multi-step recipe: grams, or a % of the step's base (what this is) */
  step?: { name: string; base: number };
  busy: boolean;
  onSave: (next: SheetLine, batch: number | null) => void;
  onRemove?: () => void;
  onClose: () => void;
}

const num = (v: string) => {
  const n = Number(v.replace(/,/g, ""));
  return Number.isFinite(n) ? n : NaN;
};

/**
 * Sits under the confirm pop-ups (z-50) so "ต่างกัน 10 เท่า" / "ลบ?" show on top,
 * and over the phone's bottom bar (z-40).
 *
 * One recipe line on its own sheet (phone, and "เปลี่ยน" on a computer): pick or
 * swap the item, type how much a batch uses and how much of it is usable. Swapping
 * keeps the amount and %, so nothing has to be remembered or typed again.
 */
export function RecipeLineSheet({ line, recipeName, isSp, byId, options, priceOf, askBatch, step, busy, onSave, onRemove, onClose }: Props) {
  const [skuId, setSkuId] = useState(line?.skuId ?? "");
  const [pctMode, setPctMode] = useState(line?.pct != null);
  const [qty, setQty] = useState(line ? String(line.pct ?? line.qty) : "");
  const [yieldPct, setYieldPct] = useState(line?.yieldPct != null ? String(line.yieldPct) : "100");
  const [batch, setBatch] = useState("");
  const ing = byId.get(skuId);
  const was = line ? byId.get(line.skuId) : undefined;
  const q = num(qty);
  // Step lines have no usable % of their own (the step's yield covers the loss)
  const y = isSp || step ? 100 : num(yieldPct);
  const b = askBatch ? num(batch) : null;
  // A % needs something to be a % of (step 1 with no gram lines yet has nothing)
  const valid = !!skuId && q > 0 && y > 0 && y <= 100 && (b === null || b > 0) && (!pctMode || (q <= 1000 && !!step && step.base > 0));
  // Same as the cost engine: a line at 80% usable buys qty ÷ 0.8; a % line is that share of the step's base
  const bought = !valid ? 0 : pctMode && step ? (q / 100) * step.base : q / (y / 100);
  // Switching grams ↔ % keeps the amount (the box shows the same thing the other way)
  const flip = (toPct: boolean) => {
    if (toPct === pctMode) return;
    setPctMode(toPct);
    if (!(q > 0) || !step || !(step.base > 0)) return;
    const next = toPct ? (q / step.base) * 100 : (q / 100) * step.base;
    setQty(String(Math.round(next * 100) / 100));
  };
  const unitChanged = !!line && !!was && !!ing && was.usageUom !== ing.usageUom;
  const list = line && !options.some((o) => o.value === line.skuId) && was ? [{ value: was.id, label: was.name, sublabel: `${was.skuId} · ${was.usageUom}` }, ...options] : options;
  const field = "h-12 w-full text-right font-mono text-[17px]";
  // Keep the keyboard inside the sheet: Tab past the end must not reach another
  // row's "เปลี่ยน" behind it (that would save this sheet onto the wrong line)
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.focus({ preventScroll: true });
  }, []);
  const trap = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const el = panel.current;
    // Keys typed in the picker's list (a portal outside the panel) are its own
    if (!el || !el.contains(e.target as Node)) return;
    if (e.key === "Escape") return onClose();
    if (e.key !== "Tab") return;
    const all = [...el.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled])")];
    if (!all.length) return;
    const first = all[0];
    const last = all[all.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === el)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="fixed inset-0 z-[45] flex items-end justify-center bg-black/30 md:items-center" onClick={onClose}>
      <div role="dialog" aria-label={line ? `แก้ ${was?.name ?? "วัตถุดิบ"}` : "เพิ่มวัตถุดิบ"} ref={panel} tabIndex={-1} aria-modal="true" onKeyDown={trap} className="flex max-h-[90dvh] w-full flex-col gap-4 overflow-y-auto rounded-t-2xl bg-card p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-raised outline-none md:max-w-md md:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">{line ? "แก้วัตถุดิบในสูตร" : "เพิ่มวัตถุดิบ"} · {recipeName}</p>
            <h3 className="break-words text-lg font-bold">{line ? was?.name ?? "—" : "เลือกวัตถุดิบ"}</h3>
          </div>
          <Button variant="ghost" className="h-10 shrink-0 px-3" onClick={onClose}>
            ปิด
          </Button>
        </div>

        {askBatch && (
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-semibold">สูตรใหม่ · {askBatch.label} ({askBatch.uom})</span>
            <Input value={batch} onChange={(e) => setBatch(e.target.value)} inputMode="decimal" className={field} aria-label={askBatch.label} />
            <span className="text-xs text-muted-foreground">ใส่ก่อน ถึงคิดต้นทุนต่อหน่วยได้ถูก</span>
          </label>
        )}

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold">วัตถุดิบ</span>
          <SearchableSelect value={skuId} onValueChange={setSkuId} options={list} placeholder="ค้นชื่อหรือรหัส…" triggerClassName="h-12 text-[16px]" />
          {line && <span className="text-xs text-muted-foreground">เปลี่ยนเป็นตัวอื่นได้เลย จำนวนและ % ด้านล่างติดไปให้</span>}
          {unitChanged && (
            <span className="text-sm font-semibold text-warning">
              หน่วยเปลี่ยนจาก {was!.usageUom} เป็น {ing!.usageUom} · เช็คจำนวนด้านล่างอีกที
            </span>
          )}
        </div>

        {step && (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-semibold">ใส่แบบ</span>
            <div role="radiogroup" aria-label="ใส่แบบ" className="grid grid-cols-2 overflow-hidden rounded-xl border border-border text-[15px]">
              {[false, true].map((p) => (
                <button key={String(p)} type="button" role="radio" aria-checked={pctMode === p} onClick={() => flip(p)} className={pctMode === p ? "h-11 bg-brand-soft font-semibold text-brand-soft-foreground" : "h-11 bg-card"}>
                  {p ? "% ของที่เข้าขั้นนี้" : `${ing?.usageUom ?? "กรัม"} ต่อรอบ`}
                </button>
              ))}
            </div>
            {pctMode && (step.base > 0 ? <span className="text-xs text-muted-foreground">คิดจาก {Math.round(step.base).toLocaleString()} ก. ที่เข้าขั้น {step.name} · ใส่ 12 = 12% ของตรงนั้น</span> : <span className="text-sm font-semibold text-destructive">ขั้นนี้ยังไม่มีวัตถุดิบที่เป็นกรัม ใส่เป็น % ไม่ได้</span>)}
          </div>
        )}

        <div className={isSp || step ? "grid grid-cols-1" : "grid grid-cols-[1.3fr_1fr] gap-3"}>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-semibold">{pctMode ? "% ของที่เข้า" : `ใช้ต่อรอบ${ing ? ` (${ing.usageUom})` : ""}`}</span>
            <Input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" className={field} aria-label={pctMode ? "% ของที่เข้า" : "ใช้ต่อรอบ"} />
          </label>
          {!isSp && !step && (
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold">ใช้ได้จริง %</span>
              <Input value={yieldPct} onChange={(e) => setYieldPct(e.target.value)} inputMode="decimal" className={field} aria-label="ใช้ได้จริง %" />
            </label>
          )}
        </div>

        {valid && (
          <div className="flex items-center justify-between gap-3 rounded-xl bg-secondary px-3 py-2.5 text-sm">
            <span className="text-muted-foreground">
              {pctMode ? `= ${(Math.round(bought * 10) / 10).toLocaleString()} ${ing?.usageUom ?? ""} · ` : !isSp && y < 100 ? `ซื้อจริงต่อรอบ ${Math.round(bought).toLocaleString()} ${ing?.usageUom ?? ""} · ` : ""}ต้นทุนแถวนี้
            </span>
            <span className={priceOf(skuId) ? "font-mono font-semibold" : "font-semibold text-destructive"}>{priceOf(skuId) ? baht(bought * priceOf(skuId)) : "ไม่มีราคา"}</span>
          </div>
        )}

        <div className="flex gap-2">
          {onRemove && (
            <Button variant="outline" className="h-12 border-destructive/40 px-4 text-destructive" onClick={onRemove} disabled={busy}>
              ลบออกจากสูตร
            </Button>
          )}
          <Button className="h-12 flex-1 text-[16px]" loading={busy} disabled={!valid} onClick={() => onSave(step ? { skuId, qty: bought, yieldPct: null, pct: pctMode ? q : null } : { skuId, qty: q, yieldPct: isSp ? null : y }, b)}>
            {line ? "บันทึก" : "เพิ่มเข้าสูตร"}
          </Button>
        </div>
        <p className="text-center text-xs text-muted-foreground">บันทึกแล้วคิดต้นทุนสูตรนี้และเมนูที่ใช้ใหม่ให้เอง{onRemove ? " · ลบต้องกดยืนยันอีกครั้ง" : ""}</p>
      </div>
    </div>
  );
}
