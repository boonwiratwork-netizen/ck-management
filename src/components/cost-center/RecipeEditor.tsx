import { useEffect, useMemo, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import type { SKU } from "@/types/sku";
import type { BOMHeader, BOMLine } from "@/types/bom";
import type { SpBomLine } from "@/types/sp-bom";
import { resolveSm, spCost } from "@/lib/cost-engine";
import { SearchableSelect } from "@/components/SearchableSelect";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { KindBadge, baht, perUnit } from "./parts";

export interface RecipeEditActions {
  addHeader: (data: Omit<BOMHeader, "id">) => Promise<string>;
  updateHeader: (id: string, data: Partial<Omit<BOMHeader, "id">>) => Promise<boolean>;
  addLine: (data: Omit<BOMLine, "id">) => Promise<boolean>;
  updateLine: (id: string, data: Partial<Omit<BOMLine, "id" | "bomHeaderId">>) => Promise<boolean>;
  deleteLine: (id: string) => Promise<boolean>;
  spAddLine: (data: Omit<SpBomLine, "id">) => Promise<boolean>;
  spUpdateLine: (id: string, data: Partial<Omit<SpBomLine, "id">>) => Promise<boolean>;
  spUpdateBatchYield: (spSkuId: string, qty: number, uom: string) => Promise<boolean>;
  spDeleteLine: (id: string) => Promise<boolean>;
}

interface Props {
  sku: SKU;
  skus: SKU[];
  header: BOMHeader | null;
  lines: BOMLine[];
  spLines: SpBomLine[];
  /** True cost per usage unit of anything (recipe items at their recipe cost) */
  priceOf: (skuId: string) => number;
  canEdit: boolean;
  actions: RecipeEditActions;
  /** After a saved change: recost this item and everything built on it */
  onChanged: () => void;
  onOpenProduct: (skuId: string) => void;
  /** Items built on this one (directly or deeper): can't go into its recipe (a loop) */
  dependents: Set<string>;
}

const num = (v: string) => {
  const n = Number(v.replace(/,/g, ""));
  return Number.isFinite(n) ? n : NaN;
};
const enterNext = (e: React.KeyboardEvent<HTMLInputElement>) => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  const all = [...document.querySelectorAll<HTMLInputElement>("[data-rcp-field]")];
  const next = all[all.indexOf(e.currentTarget) + 1];
  // blur first so the save fires before the cursor moves (table input pattern)
  e.currentTarget.blur();
  next?.focus();
};

/**
 * A simple SM recipe or an SP recipe, edited in place: every number saves when you
 * leave the box (Enter goes to the next one), then the cost of this item and every
 * recipe and menu built on it is worked out again.
 */
export function RecipeEditor({ sku, skus, header, lines, spLines, priceOf, canEdit, actions, onChanged: changedNow, onOpenProduct, dependents }: Props) {
  // Several boxes in a row → one recost once typing stops
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const pending = useRef<(() => void) | null>(null);
  pending.current = pending.current && changedNow;
  const onChanged = () => {
    clearTimeout(timer.current);
    pending.current = changedNow;
    timer.current = setTimeout(() => {
      pending.current = null;
      changedNow();
    }, 800);
  };
  // Leaving the recipe before the wait is up still recosts (never dropped)
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      pending.current?.();
    },
    [],
  );
  const isSp = sku.type === "SP";
  const byId = useMemo(() => new Map(skus.map((s) => [s.id, s])), [skus]);
  const [adding, setAdding] = useState("");
  const [addQty, setAddQty] = useState("");
  // A new recipe needs what one batch makes before anything is costed (else the
  // cost per unit would be saved off a guessed batch)
  const [addBatch, setAddBatch] = useState("");
  const [busy, setBusy] = useState(false);
  // A number 10× off the old one asks first (30 typed for 30,000 g)
  const [confirm, setConfirm] = useState<{ text: string; run: () => void } | null>(null);
  // Bumped when a change is cancelled, so the boxes show the saved numbers again
  const [gen, setGen] = useState(0);

  const rows = isSp
    ? spLines.map((l) => ({ id: l.id, skuId: l.ingredientSkuId, qty: l.qtyPerBatch, yieldPct: null as number | null, used: l.qtyPerBatch }))
    : header
      ? resolveSm(header, lines, []).lines.map((r) => ({ id: (r.line as BOMLine).id, skuId: r.line.rmSkuId, qty: r.line.qtyPerBatch, yieldPct: Math.round((r.line.yieldPercent ?? 1) * 1000) / 10, used: r.qty }))
      : [];
  const batchCost = rows.reduce((s, r) => s + r.used * priceOf(r.skuId), 0);
  const output = isSp ? spLines[0]?.batchYieldQty ?? 0 : header ? header.batchSize * header.yieldPercent : 0;
  const perUse = output > 0 ? batchCost / output : 0;
  const spTotal = isSp ? spCost(spLines.map((l) => ({ ...l })), priceOf) : null;

  const saved = async (ok: boolean | Promise<boolean>) => {
    if (await ok) onChanged();
  };
  const guarded = (oldVal: number, newVal: number, label: string, run: () => void) => {
    if (oldVal > 0 && newVal > 0 && (newVal / oldVal >= 10 || oldVal / newVal >= 10)) setConfirm({ text: `${label} จาก ${oldVal.toLocaleString()} เป็น ${newVal.toLocaleString()} (ต่างกัน ${Math.round(Math.max(newVal / oldVal, oldVal / newVal))} เท่า) ใช่ไหม?`, run });
    else run();
  };

  // Out of range: say so and put the saved number back
  const reject = (msg: string) => {
    toast.error(msg);
    setGen((g) => g + 1);
  };
  const setQty = (r: (typeof rows)[number], v: string) => {
    const n = num(v);
    if (n === r.qty) return;
    if (!(n > 0)) return reject("ปริมาณต้องมากกว่า 0 · ถ้าไม่ใช้แล้วกดถังขยะ");
    guarded(r.qty, n, `${byId.get(r.skuId)?.name ?? ""} ต่อรอบ`, () => saved(isSp ? actions.spUpdateLine(r.id, { qtyPerBatch: n }) : actions.updateLine(r.id, { qtyPerBatch: n })));
  };
  const setYield = (r: (typeof rows)[number], v: string) => {
    const n = num(v);
    if (n === r.yieldPct) return;
    if (!(n > 0 && n <= 100)) return reject("ใช้ได้จริงต้องอยู่ระหว่าง 1–100%");
    saved(actions.updateLine(r.id, { yieldPercent: n / 100 }));
  };
  const setBatch = (v: string) => {
    const n = num(v);
    if (n === output || (!isSp && n === header?.batchSize)) return;
    if (!(n > 0)) return reject("ต้องมากกว่า 0");
    if (isSp) {
      if (n !== output) guarded(output, n, "ทำรอบละ", () => saved(actions.spUpdateBatchYield(sku.id, n, sku.usageUom)));
    } else if (header && n !== header.batchSize) guarded(header.batchSize, n, "ผลิตรอบละ", () => saved(actions.updateHeader(header.id, { batchSize: n })));
  };
  const setHeaderYield = (v: string) => {
    const n = num(v);
    // Compared as shown (one decimal), so passing through the box changes nothing
    if (!header || n === Math.round(header.yieldPercent * 1000) / 10) return;
    if (!(n > 0 && n <= 100)) return reject("ได้จริงต้องอยู่ระหว่าง 1–100%");
    saved(actions.updateHeader(header.id, { yieldPercent: n / 100 }));
  };
  const remove = (r: (typeof rows)[number]) =>
    setConfirm({ text: `เอา ${byId.get(r.skuId)?.name ?? ""} ออกจากสูตร?`, run: () => saved(isSp ? actions.spDeleteLine(r.id) : actions.deleteLine(r.id)) });
  // No recipe yet, or a recipe without a batch size (some old ones): ask for it here
  const firstLine = isSp ? !spLines.length : !header || !(header.batchSize > 0);
  const add = async () => {
    const q = num(addQty);
    const batch = firstLine ? num(addBatch) : output;
    if (!adding || !(q > 0) || !(batch > 0) || busy) return;
    setBusy(true);
    let ok = false;
    if (isSp) {
      ok = await actions.spAddLine({ spSkuId: sku.id, ingredientSkuId: adding, qtyPerBatch: q, uom: byId.get(adding)?.usageUom ?? "", batchYieldQty: batch, batchYieldUom: sku.usageUom, costPerUnit: 0 });
    } else {
      let headerId = header?.id;
      if (headerId && firstLine && !(await actions.updateHeader(headerId, { batchSize: batch }))) {
        setBusy(false);
        return;
      }
      if (!headerId) headerId = await actions.addHeader({ smSkuId: sku.id, productionType: "CK", bomMode: "simple", batchSize: batch, yieldPercent: 1 });
      if (headerId) ok = await actions.addLine({ bomHeaderId: headerId, rmSkuId: adding, qtyPerBatch: q, yieldPercent: 1 });
    }
    setBusy(false);
    if (ok) {
      setAdding("");
      setAddQty("");
      setAddBatch("");
      onChanged();
    }
  };

  const inRecipe = new Set(rows.map((r) => r.skuId));
  const options = skus
    .filter((s) => s.status === "Active" && s.id !== sku.id && !inRecipe.has(s.id) && !dependents.has(s.id) && (isSp ? s.type === "RM" : s.type === "RM" || s.type === "SM"))
    .map((s) => ({ value: s.id, label: s.name, sublabel: `${s.skuId} · ${s.usageUom}` }));
  const field = "h-10 w-full text-right font-mono text-[16px]";

  return (
    <div className="flex flex-col gap-3">
      <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
        <div className={cn("flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 text-[15px]", firstLine && "hidden")}>
          <label className="flex items-center gap-2">
            {isSp ? "ทำรอบละ" : "ผลิตรอบละ"}
            <Input data-rcp-field key={`b${gen}${isSp ? output : header?.batchSize}`} disabled={!canEdit || (!isSp && !header) || (isSp && !spLines.length)} defaultValue={isSp ? output || "" : header?.batchSize || ""} inputMode="decimal" onBlur={(e) => setBatch(e.target.value)} onKeyDown={enterNext} className={cn(field, "w-32")} aria-label={isSp ? "ทำรอบละ" : "ผลิตรอบละ"} />
            {sku.usageUom}
          </label>
          {!isSp && header && (
            <label className="flex items-center gap-2">
              ได้จริง
              <Input data-rcp-field key={`y${gen}${header.yieldPercent}`} disabled={!canEdit} defaultValue={Math.round(header.yieldPercent * 1000) / 10} inputMode="decimal" onBlur={(e) => setHeaderYield(e.target.value)} onKeyDown={enterNext} className={cn(field, "w-20")} aria-label="ได้จริง %" />%
            </label>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] table-fixed text-sm">
            <colgroup>
              <col />
              <col style={{ width: "130px" }} />
              {!isSp && <col style={{ width: "96px" }} />}
              <col style={{ width: "90px" }} />
              <col style={{ width: "110px" }} />
              <col style={{ width: "52px" }} />
            </colgroup>
            <thead className="text-muted-foreground">
              <tr className="border-t border-border">
                <th className="px-4 py-2 text-left font-medium">วัตถุดิบ</th>
                <th className="px-2 py-2 text-right font-medium">ใช้/รอบ</th>
                {!isSp && <th className="px-2 py-2 text-right font-medium">ใช้ได้จริง %</th>}
                <th className="px-2 py-2 text-right font-medium">฿/หน่วย</th>
                <th className="px-2 py-2 text-right font-medium">ต้นทุน</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const ing = byId.get(r.skuId);
                const p = priceOf(r.skuId);
                return (
                  <tr key={r.id} className="border-t border-border">
                    <td className="truncate px-4 py-2">
                      <button type="button" onClick={() => onOpenProduct(r.skuId)} className="flex min-w-0 items-center gap-2 text-left hover:underline">
                        {ing && <KindBadge kind={ing.type} />}
                        <span className="break-words">{ing?.name ?? "—"}</span>
                        {ing?.status === "Inactive" && <span className="shrink-0 text-destructive">· ปิดใช้แล้ว</span>}
                      </button>
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-1">
                        <Input data-rcp-field key={`q${gen}${r.id}${r.qty}`} disabled={!canEdit} defaultValue={r.qty} inputMode="decimal" onBlur={(e) => setQty(r, e.target.value)} onKeyDown={enterNext} className={field} aria-label={`${ing?.name} ต่อรอบ`} />
                        <span className="w-6 shrink-0 text-xs text-muted-foreground">{ing?.usageUom}</span>
                      </div>
                    </td>
                    {!isSp && (
                      <td className="px-2 py-2">
                        <Input data-rcp-field key={`y${gen}${r.id}${r.yieldPct}`} disabled={!canEdit} defaultValue={r.yieldPct ?? 100} inputMode="decimal" onBlur={(e) => setYield(r, e.target.value)} onKeyDown={enterNext} className={field} aria-label={`${ing?.name} ใช้ได้จริง %`} />
                      </td>
                    )}
                    <td className={cn("px-2 py-2 text-right font-mono tabular-nums", !p && "font-semibold text-destructive")}>{p ? p.toLocaleString("th-TH", { maximumFractionDigits: 3 }) : "ไม่มีราคา"}</td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums">{baht(r.used * p)}</td>
                    <td className="px-1 py-2 text-center">
                      {canEdit && (
                        <Button variant="ghost" size="icon" className="h-10 w-10" onClick={() => remove(r)} aria-label={`เอา ${ing?.name} ออก`}>
                          <Trash2 className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {canEdit && firstLine && (
                <tr className="border-t border-border bg-secondary/30">
                  <td colSpan={isSp ? 5 : 6} className="px-4 pt-3">
                    <label className="flex flex-wrap items-center gap-2 text-[15px]">
                      สูตรใหม่ · {isSp ? "ทำรอบละ" : "ผลิตรอบละ"}
                      <Input value={addBatch} onChange={(e) => setAddBatch(e.target.value)} inputMode="decimal" className={cn(field, "w-32")} aria-label="ทำรอบละ" />
                      {sku.usageUom}
                      <span className="text-sm text-muted-foreground">ใส่ก่อน ถึงคิดต้นทุนต่อหน่วยได้ถูก</span>
                    </label>
                  </td>
                </tr>
              )}
              {canEdit && (
                <tr className="border-t border-border bg-secondary/30">
                  <td className="px-4 py-2">
                    <SearchableSelect value={adding} onValueChange={setAdding} options={options} placeholder="+ เพิ่มวัตถุดิบ…" triggerClassName="h-10" />
                  </td>
                  <td className="px-2 py-2">
                    <Input value={addQty} onChange={(e) => setAddQty(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} inputMode="decimal" placeholder="ใช้/รอบ" className={field} aria-label="ปริมาณที่เพิ่ม" />
                  </td>
                  <td colSpan={isSp ? 3 : 4} className="px-2 py-2">
                    <Button variant="outline" className="h-10" loading={busy} disabled={!adding || !(num(addQty) > 0) || (firstLine && !(num(addBatch) > 0))} onClick={add}>
                      เพิ่ม
                    </Button>
                  </td>
                </tr>
              )}
              <tr className="border-t border-border bg-secondary/40 font-semibold">
                <td className="px-4 py-2.5">รวมต่อรอบ</td>
                <td colSpan={isSp ? 2 : 3} />
                <td className="px-2 py-2.5 text-right font-mono tabular-nums">{baht(isSp ? spTotal!.batchCost : batchCost)}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      <p className="text-sm text-muted-foreground">
        {output > 0 ? (
          <>
            ต้นทุน <b className="font-mono text-foreground">{perUnit(perUse, sku.usageUom)}</b>
            {sku.packSize > 1 && (
              <>
                {" "}
                · <b className="font-mono text-foreground">{baht(perUse * sku.packSize)}</b>/{sku.packUnit || "แพ็ค"}
              </>
            )}{" "}
            · แก้ตัวเลขแล้วกด Enter ไปช่องถัดไป บันทึกให้เองทันที แล้วคิดต้นทุนสูตรและเมนูที่ใช้ตัวนี้ใหม่ให้
          </>
        ) : (
          "ใส่ว่าทำรอบละเท่าไร ถึงจะคิดต้นทุนต่อหน่วยได้"
        )}
      </p>
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => {
          if (o) return;
          setConfirm(null);
          setGen((g) => g + 1);
        }}
        title="เช็คอีกที"
        description={confirm?.text ?? ""}
        confirmLabel="ใช่"
        cancelLabel="ไม่ใช่"
        variant="default"
        onConfirm={() => {
          confirm?.run();
          setConfirm(null);
        }}
      />
    </div>
  );
}
