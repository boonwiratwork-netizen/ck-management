import { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import type { SKU } from "@/types/sku";
import type { BOMHeader, BOMLine, BOMStep } from "@/types/bom";
import type { BomByproduct } from "@/types/byproduct";
import type { SpBomLine } from "@/types/sp-bom";
import { resolveSm, spCost } from "@/lib/cost-engine";
import { SearchableSelect } from "@/components/SearchableSelect";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useFitsWidth } from "@/hooks/use-fits-width";
import { KindBadge, baht, perUnit } from "./parts";
import { RecipeLineSheet, type SheetLine } from "./RecipeLineSheet";
import { useRecostSoon } from "./use-recost-soon";

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
  deleteHeader: (id: string) => Promise<boolean>;
  addStep: (data: Omit<BOMStep, "id">) => Promise<string>;
  updateStep: (id: string, data: Partial<Omit<BOMStep, "id" | "bomHeaderId">>) => Promise<boolean>;
  deleteStep: (id: string) => Promise<boolean>;
  addByproduct: (data: Omit<BomByproduct, "id">) => Promise<boolean>;
  updateByproduct: (id: string, data: Partial<Omit<BomByproduct, "id" | "bomHeaderId">>) => Promise<boolean>;
  deleteByproduct: (id: string) => Promise<boolean>;
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
  /** By-products' total share of the pot's cost (0–100): comes off this item's cost */
  byproductPct?: number;
}

export const num = (v: string) => {
  const n = Number(v.replace(/,/g, ""));
  return Number.isFinite(n) ? n : NaN;
};
export const enterNext = (e: React.KeyboardEvent<HTMLInputElement>) => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  // Only boxes on screen: the phone cards and the computer table both carry them
  const all = [...document.querySelectorAll<HTMLInputElement>("[data-rcp-field]")].filter((el) => el.offsetParent !== null);
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
export function RecipeEditor({ sku, skus, header, lines, spLines, priceOf, canEdit, actions, onChanged: changedNow, onOpenProduct, dependents, byproductPct: bpPct = 0 }: Props) {
  const onChanged = useRecostSoon(changedNow);
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
  // One line on its own sheet: tap a card (phone) or "เปลี่ยน" (computer), or add
  // Holds the line's id only: the sheet always reads the live line (an inline save
  // landing after it opened must not leave it comparing against an old number)
  const [sheet, setSheet] = useState<{ rowId: string | null } | null>(null);
  // The table needs ~620px; a phone (or a squeezed laptop) gets cards instead
  const [measure, wide] = useFitsWidth(620);

  const rows = isSp
    ? spLines.map((l) => ({ id: l.id, skuId: l.ingredientSkuId, qty: l.qtyPerBatch, yieldPct: null as number | null, used: l.qtyPerBatch }))
    : header
      ? resolveSm(header, lines, []).lines.map((r) => ({ id: (r.line as BOMLine).id, skuId: r.line.rmSkuId, qty: r.line.qtyPerBatch, yieldPct: Math.round((r.line.yieldPercent ?? 1) * 1000) / 10, used: r.qty }))
      : [];
  const batchCost = rows.reduce((s, r) => s + r.used * priceOf(r.skuId), 0);
  const output = isSp ? spLines[0]?.batchYieldQty ?? 0 : header ? header.batchSize * header.yieldPercent : 0;
  // By-products take their set share of the pot's cost (same as the cost engine)
  const perUse = output > 0 ? (batchCost * Math.max(0, 100 - bpPct)) / 100 / output : 0;
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
    setConfirm({
      text: `เอา ${byId.get(r.skuId)?.name ?? ""} ออกจากสูตร?`,
      run: async () => {
        setBusy(true);
        const ok = await (isSp ? actions.spDeleteLine(r.id) : actions.deleteLine(r.id));
        setBusy(false);
        if (ok) {
          setSheet(null);
          onChanged();
        }
      },
    });
  // No recipe yet, or a recipe without a batch size (some old ones): ask for it here
  const firstLine = isSp ? !spLines.length : !header || !(header.batchSize > 0);
  const addItem = async (skuId: string, q: number, batch: number, yieldPct = 100): Promise<boolean> => {
    if (!skuId || !(q > 0) || !(batch > 0) || busy) return false;
    setBusy(true);
    let ok = false;
    if (isSp) {
      ok = await actions.spAddLine({ spSkuId: sku.id, ingredientSkuId: skuId, qtyPerBatch: q, uom: byId.get(skuId)?.usageUom ?? "", batchYieldQty: batch, batchYieldUom: sku.usageUom, costPerUnit: 0 });
    } else {
      let headerId = header?.id;
      if (headerId && firstLine && !(await actions.updateHeader(headerId, { batchSize: batch }))) {
        setBusy(false);
        return false;
      }
      if (!headerId) headerId = await actions.addHeader({ smSkuId: sku.id, productionType: "CK", bomMode: "simple", batchSize: batch, yieldPercent: 1 });
      if (headerId) ok = await actions.addLine({ bomHeaderId: headerId, rmSkuId: skuId, qtyPerBatch: q, yieldPercent: yieldPct / 100 });
    }
    setBusy(false);
    if (ok) onChanged();
    return ok;
  };
  const add = async () => {
    if (!(await addItem(adding, num(addQty), firstLine ? num(addBatch) : output))) return;
    setAdding("");
    setAddQty("");
    setAddBatch("");
  };
  // Save a sheet: only what changed, in one write (item, amount and % together)
  const saveSheet = async (next: SheetLine, batch: number | null) => {
    const r = rows.find((x) => x.id === sheet?.rowId);
    if (!r) {
      if (await addItem(next.skuId, next.qty, batch ?? output, next.yieldPct ?? 100)) setSheet(null);
      return;
    }
    const swapped = next.skuId !== r.skuId;
    const write = async () => {
      setBusy(true);
      const ok = isSp
        ? await actions.spUpdateLine(r.id, {
            ...(swapped && { ingredientSkuId: next.skuId, uom: byId.get(next.skuId)?.usageUom ?? "" }),
            ...(next.qty !== r.qty && { qtyPerBatch: next.qty }),
          })
        : await actions.updateLine(r.id, {
            ...(swapped && { rmSkuId: next.skuId }),
            ...(next.qty !== r.qty && { qtyPerBatch: next.qty }),
            ...(next.yieldPct !== r.yieldPct && { yieldPercent: (next.yieldPct ?? 100) / 100 }),
          });
      setBusy(false);
      if (ok) {
        setSheet(null);
        onChanged();
      }
    };
    if (!swapped && next.qty === r.qty && next.yieldPct === r.yieldPct) return setSheet(null);
    // Another unit (ก. → กก./ชิ้น): the same number means something else, so always ask
    const from = byId.get(r.skuId)?.usageUom;
    const to = byId.get(next.skuId)?.usageUom;
    if (swapped && from !== to)
      return setConfirm({ text: `หน่วยเปลี่ยนจาก ${from} เป็น ${to} · ใช้ ${byId.get(next.skuId)?.name ?? ""} ${next.qty.toLocaleString()} ${to} ต่อรอบ ใช่ไหม?`, run: write });
    guarded(r.qty, next.qty, `${byId.get(next.skuId)?.name ?? ""} ต่อรอบ`, write);
  };

  const inRecipe = new Set(rows.map((r) => r.skuId));
  const options = skus
    .filter((s) => s.status === "Active" && s.id !== sku.id && !inRecipe.has(s.id) && !dependents.has(s.id) && (isSp ? s.type === "RM" : s.type === "RM" || s.type === "SM"))
    .map((s) => ({ value: s.id, label: s.name, sublabel: `${s.skuId} · ${s.usageUom}` }));
  const field = "h-10 w-full text-right font-mono text-[16px]";
  const total = isSp ? spTotal!.batchCost : batchCost;
  // undefined = no sheet · null = adding · a line = editing it (gone once deleted)
  const sheetRow = !sheet ? undefined : sheet.rowId === null ? null : rows.find((r) => r.id === sheet.rowId);

  return (
    <div ref={measure} className="flex flex-col gap-3">
      {!wide && (
        <>
          {!firstLine && (
            <div className={cn("grid gap-2", !isSp && header && "grid-cols-2")}>
              <label className="rounded-2xl border border-border bg-card px-3 py-2">
                <span className="block text-xs text-muted-foreground">
                  {isSp ? "ทำรอบละ" : "ผลิตรอบละ"} ({sku.usageUom})
                </span>
                <Input data-rcp-field key={`b${gen}${isSp ? output : header?.batchSize}`} disabled={!canEdit} defaultValue={isSp ? output || "" : header?.batchSize || ""} inputMode="decimal" onBlur={(e) => setBatch(e.target.value)} onKeyDown={enterNext} className="h-10 border-0 px-0 text-left font-mono text-[18px] font-semibold shadow-none" aria-label={isSp ? "ทำรอบละ" : "ผลิตรอบละ"} />
              </label>
              {!isSp && header && (
                <label className="rounded-2xl border border-border bg-card px-3 py-2">
                  <span className="block text-xs text-muted-foreground">ได้จริง (%)</span>
                  <Input data-rcp-field key={`y${gen}${header.yieldPercent}`} disabled={!canEdit} defaultValue={Math.round(header.yieldPercent * 1000) / 10} inputMode="decimal" onBlur={(e) => setHeaderYield(e.target.value)} onKeyDown={enterNext} className="h-10 border-0 px-0 text-left font-mono text-[18px] font-semibold shadow-none" aria-label="ได้จริง %" />
                </label>
              )}
            </div>
          )}
          {canEdit && rows.length > 0 && <p className="-mb-1 px-1 text-sm text-muted-foreground">แตะวัตถุดิบเพื่อแก้จำนวน หรือเปลี่ยนเป็นตัวอื่น</p>}
          <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
            {rows.map((r, i) => {
              const ing = byId.get(r.skuId);
              const p = priceOf(r.skuId);
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => (canEdit ? setSheet({ rowId: r.id }) : onOpenProduct(r.skuId))}
                  className={cn("flex w-full items-start gap-2.5 px-4 py-3 text-left hover:bg-secondary/40", i > 0 && "border-t border-border")}
                >
                  {ing && <KindBadge kind={ing.type} className="mt-0.5 shrink-0" />}
                  <span className="min-w-0 flex-1">
                    <span className="block break-words font-semibold">
                      {ing?.name ?? "—"}
                      {ing?.status === "Inactive" && <span className="font-normal text-destructive"> · ปิดใช้แล้ว</span>}
                    </span>
                    <span className="block text-[13px] text-muted-foreground">
                      ใช้ <span className="font-mono">{r.qty.toLocaleString()} {ing?.usageUom}</span>
                      {r.yieldPct != null && <> · ใช้ได้ {r.yieldPct}%</>}
                    </span>
                  </span>
                  <span className={cn("shrink-0 font-mono font-semibold tabular-nums", !p && "text-destructive")}>{p ? baht(r.used * p) : "ไม่มีราคา"}</span>
                </button>
              );
            })}
            {canEdit && (
              <div className={cn("px-4 py-3", rows.length > 0 && "border-t border-border")}>
                <Button variant="outline" className="h-12 w-full border-dashed text-[15px]" onClick={() => setSheet({ rowId: null })}>
                  + เพิ่มวัตถุดิบ
                </Button>
              </div>
            )}
            <div className="flex items-center justify-between gap-3 border-t border-border bg-secondary/40 px-4 py-3 font-semibold">
              <span>รวมต่อรอบ</span>
              <span className="font-mono tabular-nums">{baht(total)}</span>
            </div>
          </section>
        </>
      )}
      <section className={cn("overflow-hidden rounded-2xl border border-border bg-card shadow-card", !wide && "hidden")}>
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
              <col style={{ width: canEdit ? "128px" : "12px" }} />
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
                    <td className="px-1 py-2">
                      {canEdit && (
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="outline" className="h-9 px-3 text-sm" onClick={() => setSheet({ rowId: r.id })} aria-label={`เปลี่ยน ${ing?.name}`}>
                            เปลี่ยน
                          </Button>
                          <Button variant="ghost" size="icon" className="h-10 w-10" onClick={() => remove(r)} aria-label={`เอา ${ing?.name} ออก`}>
                            <Trash2 className="h-4 w-4 text-muted-foreground" />
                          </Button>
                        </div>
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
                <td className="px-2 py-2.5 text-right font-mono tabular-nums">{baht(total)}</td>
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
      {sheetRow !== undefined && (
        <RecipeLineSheet
          // A new line, or the line changed underneath: start the sheet afresh
          key={sheetRow ? `${sheetRow.id}${sheetRow.skuId}${sheetRow.qty}${sheetRow.yieldPct}` : "new"}
          line={sheetRow ? { skuId: sheetRow.skuId, qty: sheetRow.qty, yieldPct: sheetRow.yieldPct } : null}
          recipeName={sku.name}
          isSp={isSp}
          byId={byId}
          options={options}
          priceOf={priceOf}
          askBatch={!sheetRow && firstLine ? { label: isSp ? "ทำรอบละ" : "ผลิตรอบละ", uom: sku.usageUom } : null}
          busy={busy}
          onSave={saveSheet}
          onRemove={sheetRow ? () => remove(sheetRow) : undefined}
          onClose={() => setSheet(null)}
        />
      )}
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
