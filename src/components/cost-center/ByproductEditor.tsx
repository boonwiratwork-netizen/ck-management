import { useEffect, useMemo, useRef, useState } from "react";
import type { SKU } from "@/types/sku";
import type { BomByproduct } from "@/types/byproduct";
import { SearchableSelect } from "@/components/SearchableSelect";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useFitsWidth } from "@/hooks/use-fits-width";
import { baht } from "./parts";
import { enterNext, num, type RecipeEditActions } from "./RecipeEditor";
import { useRecostSoon } from "./use-recost-soon";

interface Props {
  sku: SKU;
  skus: SKU[];
  headerId: string;
  byproducts: BomByproduct[];
  /** Ingredient cost of one batch, and what it gives of the main item */
  batchCost: number;
  mainOutput: number;
  canEdit: boolean;
  actions: RecipeEditActions;
  onChanged: () => void;
  onOpenProduct: (skuId: string) => void;
  /** Items that have a recipe of their own (a by-product's cost would be set twice) */
  hasRecipe: (skuId: string) => boolean;
  /** This recipe's ingredients and what is built on it: a by-product from those is a loop */
  blocked: Set<string>;
}

const one = (n: number) => Math.round(n * 10) / 10;

/**
 * What the same pot also gives (น้ำสต๊อก → น้ำมันไก่, ไพตัน) and the share of the
 * pot's cost each one takes. Every box saves when you leave it; the % is only
 * worked out from the weights when you press "แบ่งตามน้ำหนัก" (the old page
 * rewrote typed % whenever a weight changed).
 */
export function ByproductEditor({ sku, skus, headerId, byproducts, batchCost, mainOutput, canEdit, actions, onChanged: changedNow, onOpenProduct, hasRecipe, blocked }: Props) {
  const onChanged = useRecostSoon(changedNow);
  const byId = useMemo(() => new Map(skus.map((s) => [s.id, s])), [skus]);
  const [measure, wide] = useFitsWidth(700);
  const [busy, setBusy] = useState(false);
  const [gen, setGen] = useState(0);
  const [sheet, setSheet] = useState<{ id: string | null } | null>(null);
  const [confirm, setConfirm] = useState<{ text: string; run: () => void; danger?: boolean } | null>(null);

  const totalPct = byproducts.reduce((s, b) => s + (b.costAllocationPct || 0), 0);
  const mainPct = 100 - totalPct;
  const over = totalPct > 100.0001;
  const name = (b: BomByproduct) => (b.skuId ? byId.get(b.skuId)?.name ?? b.name : b.name) || "ผลพลอยได้";
  const costOf = (pct: number) => (batchCost * pct) / 100;

  const reject = (msg: string) => {
    toast.error(msg);
    setGen((x) => x + 1);
  };
  const run = async (write: () => Promise<boolean>, after?: () => void) => {
    setBusy(true);
    const ok = await write();
    setBusy(false);
    if (ok) {
      after?.();
      onChanged();
    } else setGen((x) => x + 1);
  };
  const setOutput = (b: BomByproduct, v: string) => {
    const n = num(v);
    if (n === b.outputQty) return;
    if (!(n >= 0)) return reject("ได้ต่อรอบต้องเป็นตัวเลข 0 ขึ้นไป");
    run(() => actions.updateByproduct(b.id, { outputQty: n }));
  };
  const setPct = (b: BomByproduct, v: string) => {
    const n = num(v);
    if (n === one(b.costAllocationPct)) return;
    if (!(n >= 0 && n <= 100)) return reject("แบ่งต้นทุนต้องอยู่ระหว่าง 0–100%");
    // Over 100% would cost the pot more than it cost: say so instead of saving
    const rest = totalPct - (b.costAllocationPct || 0);
    if (rest + n > 100.0001) return reject(`รวมแล้วเกิน 100% (ตัวอื่นใช้ไป ${one(rest)}%) · ใส่ได้ไม่เกิน ${one(100 - rest)}%`);
    run(() => actions.updateByproduct(b.id, { costAllocationPct: n }));
  };
  const total = mainOutput + byproducts.reduce((s, b) => s + (b.outputQty || 0), 0);
  const byWeight = () =>
    setConfirm({
      text: `แบ่งต้นทุนตามน้ำหนัก: ${sku.name} ${one((mainOutput / total) * 100)}% · ${byproducts.map((b) => `${name(b)} ${one(((b.outputQty || 0) / total) * 100)}%`).join(" · ")} ใช่ไหม?`,
      run: () =>
        void run(async () => {
          for (const b of byproducts) if (!(await actions.updateByproduct(b.id, { costAllocationPct: ((b.outputQty || 0) / total) * 100 }))) return false;
          return true;
        }),
    });
  const remove = (b: BomByproduct) =>
    setConfirm({ text: `เอา ${name(b)} ออกจากผลพลอยได้? ต้นทุนส่วนของมันจะกลับไปอยู่ที่ ${sku.name}`, danger: true, run: () => void run(() => actions.deleteByproduct(b.id), () => setSheet(null)) });
  const save = (next: { skuId: string | null; name: string; outputQty: number; costAllocationPct: number }) => {
    const b = byproducts.find((x) => x.id === sheet?.id);
    const data = { ...next, tracksInventory: !!next.skuId };
    run(() => (b ? actions.updateByproduct(b.id, data) : actions.addByproduct({ bomHeaderId: headerId, ...data })), () => setSheet(null));
  };

  const taken = new Set(byproducts.map((b) => b.skuId).filter(Boolean));
  const options = skus.filter((s) => s.type === "SM" && s.status === "Active" && s.id !== sku.id && !blocked.has(s.id)).map((s) => ({ value: s.id, label: s.name, sublabel: s.skuId }));
  const onSheet = sheet?.id ? byproducts.find((b) => b.id === sheet.id) : undefined;
  const field = "h-10 w-full text-right font-mono text-[16px]";
  const conflicts = byproducts.filter((b) => b.skuId && hasRecipe(b.skuId));

  if (!byproducts.length && !canEdit) return null;
  return (
    <section ref={measure} className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <h3 className="min-w-0 flex-1 font-semibold">ได้จากหม้อเดียวกัน (ผลพลอยได้)</h3>
        {canEdit && byproducts.length > 0 && total > 0 && (
          <Button variant="outline" className="h-10 border-brand/50 text-brand-soft-foreground" disabled={busy} onClick={byWeight}>
            แบ่งต้นทุนตามน้ำหนัก
          </Button>
        )}
      </div>

      {byproducts.length > 0 && wide && (
        <table className="w-full table-fixed text-sm">
          <colgroup>
            <col />
            <col style={{ width: "140px" }} />
            <col style={{ width: "130px" }} />
            <col style={{ width: "110px" }} />
            <col style={{ width: "90px" }} />
            <col style={{ width: canEdit ? "120px" : "12px" }} />
          </colgroup>
          <thead className="text-muted-foreground">
            <tr className="border-t border-border">
              <th className="px-4 py-2 text-left font-medium">ของที่ได้</th>
              <th className="px-2 py-2 text-right font-medium">ได้/รอบ ({sku.usageUom})</th>
              <th className="px-2 py-2 text-right font-medium">แบ่งต้นทุน %</th>
              <th className="px-2 py-2 text-right font-medium">ต้นทุน</th>
              <th className="px-2 py-2 text-right font-medium">฿/{sku.usageUom}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-border bg-secondary/40">
              <td className="px-4 py-2">
                <b>{sku.name}</b> <span className="text-xs text-muted-foreground">ของหลัก</span>
              </td>
              <td className="px-2 py-2 text-right font-mono tabular-nums">{one(mainOutput).toLocaleString()}</td>
              <td className={cn("px-2 py-2 text-right font-mono tabular-nums", over && "font-semibold text-destructive")}>{one(mainPct)}%</td>
              <td className="px-2 py-2 text-right font-mono tabular-nums">{baht(costOf(Math.max(0, mainPct)), 0)}</td>
              <td className="px-2 py-2 text-right font-mono tabular-nums">{mainOutput > 0 ? (costOf(Math.max(0, mainPct)) / mainOutput).toFixed(3) : "—"}</td>
              <td />
            </tr>
            {byproducts.map((b) => (
              <tr key={b.id} className="border-t border-border">
                <td className="px-4 py-2">
                  <button type="button" disabled={!b.skuId} onClick={() => b.skuId && onOpenProduct(b.skuId)} className="min-w-0 break-words text-left font-semibold hover:underline disabled:no-underline">
                    {name(b)}
                  </button>{" "}
                  <span className="text-xs text-muted-foreground">{b.skuId ? `${byId.get(b.skuId)?.skuId ?? ""} · นับสต๊อก` : "ไม่นับสต๊อก"}</span>
                </td>
                <td className="px-2 py-2">
                  <Input data-rcp-field key={`o${gen}${b.id}${b.outputQty}`} disabled={!canEdit} defaultValue={b.outputQty} inputMode="decimal" onBlur={(e) => setOutput(b, e.target.value)} onKeyDown={enterNext} className={field} aria-label={`${name(b)} ได้ต่อรอบ`} />
                </td>
                <td className="px-2 py-2">
                  <Input data-rcp-field key={`p${gen}${b.id}${b.costAllocationPct}`} disabled={!canEdit} defaultValue={one(b.costAllocationPct)} inputMode="decimal" onBlur={(e) => setPct(b, e.target.value)} onKeyDown={enterNext} className={field} aria-label={`${name(b)} แบ่งต้นทุน %`} />
                </td>
                <td className="px-2 py-2 text-right font-mono tabular-nums">{baht(costOf(b.costAllocationPct), 0)}</td>
                <td className="px-2 py-2 text-right font-mono tabular-nums">{b.outputQty > 0 ? (costOf(b.costAllocationPct) / b.outputQty).toFixed(3) : "—"}</td>
                <td className="px-1 py-2">
                  {canEdit && (
                    <div className="flex justify-end gap-1">
                      <Button variant="outline" className="h-9 px-3 text-sm" onClick={() => setSheet({ id: b.id })}>
                        แก้
                      </Button>
                      <Button variant="ghost" className="h-9 px-2 text-sm text-destructive" onClick={() => remove(b)}>
                        ลบ
                      </Button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            <tr className="border-t border-border font-semibold">
              <td className="px-4 py-2.5" colSpan={2}>
                รวม
              </td>
              <td className={cn("px-2 py-2.5 text-right font-mono tabular-nums", over && "text-destructive")}>{one(Math.max(100, totalPct))}%</td>
              <td className="px-2 py-2.5 text-right font-mono tabular-nums">{baht(costOf(Math.max(100, totalPct)), 0)}</td>
              <td colSpan={2} />
            </tr>
          </tbody>
        </table>
      )}

      {byproducts.length > 0 && !wide && (
        <div className="border-t border-border">
          <div className="flex items-center justify-between gap-3 bg-secondary/40 px-4 py-2.5">
            <span>
              <b>{sku.name}</b> <span className="text-xs text-muted-foreground">ของหลัก</span>
            </span>
            <span className={cn("font-mono", over && "font-semibold text-destructive")}>{one(mainPct)}%</span>
          </div>
          {byproducts.map((b) => (
            <button key={b.id} type="button" onClick={() => (canEdit ? setSheet({ id: b.id }) : b.skuId && onOpenProduct(b.skuId))} className="flex w-full items-center gap-3 border-t border-border px-4 py-3 text-left hover:bg-secondary/40">
              <span className="min-w-0 flex-1">
                <b className="block break-words">{name(b)}</b>
                <span className="text-xs text-muted-foreground">
                  <span className="font-mono">
                    {(b.outputQty || 0).toLocaleString()} {sku.usageUom}
                  </span>{" "}
                  · {baht(costOf(b.costAllocationPct), 0)}
                  {b.outputQty > 0 && ` · ฿${(costOf(b.costAllocationPct) / b.outputQty).toFixed(3)}/${sku.usageUom}`}
                </span>
              </span>
              <span className="font-mono">{one(b.costAllocationPct)}%</span>
            </button>
          ))}
        </div>
      )}

      {(over || conflicts.length > 0) && (
        <div className="flex flex-col gap-1 border-t border-destructive/30 bg-destructive/5 px-4 py-2.5 text-sm">
          {over && <span className="font-semibold text-destructive">ผลพลอยได้รวม {one(totalPct)}% เกิน 100% · {sku.name} ไม่เหลือต้นทุนเลย ลด % ลงหรือกดแบ่งตามน้ำหนัก</span>}
          {conflicts.map((b) => (
            <span key={b.id} className="text-destructive">
              {name(b)} มีสูตรของตัวเองอยู่แล้ว · ต้นทุนจากสูตรนี้จะไปทับของสูตรมัน
            </span>
          ))}
        </div>
      )}

      {canEdit && (
        <div className="border-t border-border px-4 py-2.5">
          <Button variant="outline" className={cn("border-dashed", wide ? "h-10" : "h-11 w-full")} onClick={() => setSheet({ id: null })}>
            + เพิ่มผลพลอยได้
          </Button>
        </div>
      )}
      <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">แก้แล้วบันทึกทันที · จำนวนที่ได้จริงแต่ละหม้อใส่ตอนบันทึกผลิต</p>

      {sheet && (
        <ByproductSheet
          key={onSheet ? `${onSheet.id}${onSheet.outputQty}${onSheet.costAllocationPct}${onSheet.skuId}` : "new"}
          bp={onSheet ?? null}
          mainName={sku.name}
          uom={sku.usageUom}
          options={options.filter((o) => !taken.has(o.value) || o.value === onSheet?.skuId)}
          batchCost={batchCost}
          otherPct={totalPct - (onSheet?.costAllocationPct ?? 0)}
          busy={busy}
          onSave={save}
          onRemove={onSheet ? () => remove(onSheet) : undefined}
          onClose={() => setSheet(null)}
        />
      )}
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => {
          if (o) return;
          setConfirm(null);
          setGen((x) => x + 1);
        }}
        title="เช็คอีกที"
        description={confirm?.text ?? ""}
        confirmLabel={confirm?.danger ? "ลบ" : "ใช่"}
        cancelLabel="ไม่ใช่"
        variant={confirm?.danger ? "destructive" : "default"}
        onConfirm={() => {
          confirm?.run();
          setConfirm(null);
        }}
      />
    </section>
  );
}

/** One by-product on a sheet: a stock item or just a name, what a batch gives, its share */
function ByproductSheet({ bp, mainName, uom, options, batchCost, otherPct, busy, onSave, onRemove, onClose }: { bp: BomByproduct | null; mainName: string; uom: string; options: { value: string; label: string; sublabel?: string }[]; batchCost: number; otherPct: number; busy: boolean; onSave: (next: { skuId: string | null; name: string; outputQty: number; costAllocationPct: number }) => void; onRemove?: () => void; onClose: () => void }) {
  const [tracked, setTracked] = useState(bp ? !!bp.skuId : true);
  const [skuId, setSkuId] = useState(bp?.skuId ?? "");
  const [name, setName] = useState(bp && !bp.skuId ? bp.name : "");
  const [out, setOut] = useState(bp ? String(bp.outputQty) : "");
  const [pct, setPct] = useState(bp ? String(one(bp.costAllocationPct)) : "");
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.focus({ preventScroll: true });
  }, []);
  const o = num(out);
  const p = num(pct);
  const label = tracked ? options.find((x) => x.value === skuId)?.label ?? "" : name.trim();
  const valid = !!label && o >= 0 && p >= 0 && otherPct + p <= 100.0001;
  const field = "h-12 w-full text-right font-mono text-[17px]";
  return (
    <div className="fixed inset-0 z-[45] flex items-end justify-center bg-black/30 md:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={bp ? "แก้ผลพลอยได้" : "เพิ่มผลพลอยได้"} ref={panel} tabIndex={-1} onKeyDown={(e) => e.key === "Escape" && e.currentTarget.contains(e.target as Node) && onClose()} onClick={(e) => e.stopPropagation()} className="flex max-h-[90dvh] w-full flex-col gap-4 overflow-y-auto rounded-t-2xl bg-card p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-raised outline-none md:max-w-md md:rounded-2xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">ได้จากหม้อเดียวกับ {mainName}</p>
            <h3 className="break-words text-lg font-bold">{bp ? label || "ผลพลอยได้" : "เพิ่มผลพลอยได้"}</h3>
          </div>
          <Button variant="ghost" className="h-10 shrink-0 px-3" onClick={onClose}>
            ปิด
          </Button>
        </div>
        <div role="radiogroup" aria-label="ชนิด" className="grid grid-cols-2 overflow-hidden rounded-xl border border-border text-[15px]">
          {[true, false].map((t) => (
            <button key={String(t)} type="button" role="radio" aria-checked={tracked === t} onClick={() => setTracked(t)} className={tracked === t ? "h-11 bg-brand-soft font-semibold text-brand-soft-foreground" : "h-11 bg-card"}>
              {t ? "สินค้า SM (นับสต๊อก)" : "แค่ชื่อ (ไม่นับสต๊อก)"}
            </button>
          ))}
        </div>
        {tracked ? (
          <SearchableSelect value={skuId} onValueChange={setSkuId} options={options} placeholder="ค้นชื่อหรือรหัส SM…" triggerClassName="h-12 text-[16px]" />
        ) : (
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="เช่น กากไก่" className="h-12 text-[16px]" aria-label="ชื่อผลพลอยได้" />
        )}
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-semibold">ได้ต่อรอบ ({uom})</span>
            <Input value={out} onChange={(e) => setOut(e.target.value)} inputMode="decimal" className={field} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-semibold">แบ่งต้นทุน %</span>
            <Input value={pct} onChange={(e) => setPct(e.target.value)} inputMode="decimal" className={field} />
          </label>
        </div>
        {valid && (
          <div className="grid grid-cols-3 gap-1.5 text-center">
            <div className="rounded-xl border border-border bg-secondary/50 px-2 py-1.5">
              <div className="text-[11px] text-muted-foreground">ต้นทุน</div>
              <div className="font-mono font-semibold">{baht((batchCost * p) / 100, 0)}</div>
            </div>
            <div className="rounded-xl border border-border bg-secondary/50 px-2 py-1.5">
              <div className="text-[11px] text-muted-foreground">฿/{uom}</div>
              <div className="font-mono font-semibold">{o > 0 ? ((batchCost * p) / 100 / o).toFixed(3) : "—"}</div>
            </div>
            <div className={cn("rounded-xl border px-2 py-1.5", otherPct + p > 100 ? "border-destructive/50 bg-destructive/5" : "border-border bg-secondary/50")}>
              <div className="text-[11px] text-muted-foreground">ของหลักเหลือ</div>
              <div className={cn("font-mono font-semibold", otherPct + p > 100 && "text-destructive")}>{one(100 - otherPct - p)}%</div>
            </div>
          </div>
        )}
        <div className="flex gap-2">
          {onRemove && (
            <Button variant="outline" className="h-12 border-destructive/40 px-4 text-destructive" disabled={busy} onClick={onRemove}>
              ลบ
            </Button>
          )}
          <Button className="h-12 flex-1 text-[16px]" loading={busy} disabled={!valid} onClick={() => onSave({ skuId: tracked ? skuId : null, name: label, outputQty: o, costAllocationPct: p })}>
            {bp ? "บันทึก" : "เพิ่ม"}
          </Button>
        </div>
      </div>
    </div>
  );
}
