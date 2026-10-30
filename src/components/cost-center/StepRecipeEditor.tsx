import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import type { SKU } from "@/types/sku";
import type { BOMHeader, BOMLine, BOMStep } from "@/types/bom";
import { resolveSteps } from "@/lib/cost-engine";
import { gramsToPercent } from "@/lib/recipe-mode";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useFitsWidth } from "@/hooks/use-fits-width";
import { KindBadge, baht, perUnit } from "./parts";
import { RecipeLineSheet, type SheetLine } from "./RecipeLineSheet";
import { enterNext, num, type RecipeEditActions } from "./RecipeEditor";
import { useRecostSoon } from "./use-recost-soon";

interface Props {
  sku: SKU;
  skus: SKU[];
  header: BOMHeader;
  /** This recipe's lines and steps */
  lines: BOMLine[];
  steps: BOMStep[];
  priceOf: (skuId: string) => number;
  canEdit: boolean;
  actions: RecipeEditActions;
  onChanged: () => void;
  onOpenProduct: (skuId: string) => void;
  dependents: Set<string>;
  /** By-products' total share of the pot's cost (0–100) */
  byproductPct: number;
}

const g = (n: number) => (Math.round(n * 10) / 10).toLocaleString();
const pctText = (fraction: number) => `${Math.round(fraction * 10000) / 100}`;
// Grams kept to 2 decimals: a % turned back into grams shouldn't read 98.3999999
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * A multi-step SM recipe (trim → sous vide → smoke), edited in place: every step
 * shows what goes in, what is left and what comes out, with the numbers production
 * and the cost use (resolveSteps). A line goes in as grams or as a % of what goes
 * into its step; switching keeps the amount.
 */
export function StepRecipeEditor({ sku, skus, header, lines, steps, priceOf, canEdit, actions, onChanged: changedNow, onOpenProduct, dependents, byproductPct }: Props) {
  const onChanged = useRecostSoon(changedNow);
  const byId = useMemo(() => new Map(skus.map((s) => [s.id, s])), [skus]);
  const [measure, wide] = useFitsWidth(760);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ text: string; run: () => void; danger?: boolean } | null>(null);
  const [gen, setGen] = useState(0);
  // A line on its sheet (adding = lineId null), or a step on its sheet (phone)
  const [sheet, setSheet] = useState<{ stepId: string; lineId: string | null } | null>(null);
  const [stepSheet, setStepSheet] = useState<string | null>(null);

  const resolved = resolveSteps(lines, steps);
  const qtyOf = new Map(resolved.flatMap((s) => s.lines.map((r) => [(r.line as BOMLine).id, r.qty] as const)));
  const batchCost = resolved.reduce((t, s) => t + s.lines.reduce((u, r) => u + r.qty * priceOf(r.line.rmSkuId), 0), 0);
  const output = resolved.length ? resolved[resolved.length - 1].output : 0;
  const perUse = output > 0 ? (batchCost * Math.max(0, 100 - byproductPct)) / 100 / output : 0;
  // Lines in no step aren't counted anywhere (left over from the old page)
  const loose = lines.filter((l) => !steps.some((s) => s.id === l.stepId));

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
    return ok;
  };
  const guarded = (oldVal: number, newVal: number, label: string, go: () => void) => {
    if (oldVal > 0 && newVal > 0 && (newVal / oldVal >= 10 || oldVal / newVal >= 10)) setConfirm({ text: `${label} จาก ${g(oldVal)} เป็น ${g(newVal)} (ต่างกัน ${Math.round(Math.max(newVal / oldVal, oldVal / newVal))} เท่า) ใช่ไหม?`, run: go });
    else go();
  };

  // ── Lines ──
  const isPct = (l: BOMLine) => l.qtyType === "percent" && !!l.percentOfInput;
  // Step 1's % lines are a share of its gram lines: a gram line turning into % is
  // no longer one of them, so it is measured against the others (else 400 g of 1,000
  // would become 40% of the 600 g left = 240 g)
  const firstStepId = resolved[0]?.step.id;
  const baseFor = (l: BOMLine | undefined, base: number) => (l && l.stepId === firstStepId && !isPct(l) ? base - (qtyOf.get(l.id) ?? l.qtyPerBatch) : base);
  // The step that would come first may not start from % lines (nothing to be a % of)
  const pctIn = (stepId: string) => lines.some((l) => l.stepId === stepId && isPct(l));
  const setAmount = (l: BOMLine, base: number, v: string) => {
    const n = num(v);
    const name = byId.get(l.rmSkuId)?.name ?? "";
    if (isPct(l)) {
      if (n === Number(pctText(l.percentOfInput!))) return;
      if (!(n > 0 && n <= 1000)) return reject("% ของที่เข้าต้องมากกว่า 0 (ไม่เกิน 1000)");
      return void run(() => actions.updateLine(l.id, { percentOfInput: n / 100, qtyPerBatch: r2((n / 100) * base) }));
    }
    if (n === l.qtyPerBatch) return;
    if (!(n > 0)) return reject("ปริมาณต้องมากกว่า 0 · ถ้าไม่ใช้แล้วกดถังขยะ");
    guarded(l.qtyPerBatch, n, `${name} ต่อรอบ`, () => void run(() => actions.updateLine(l.id, { qtyPerBatch: n })));
  };
  const setKind = (l: BOMLine, rawBase: number, toPct: boolean) => {
    if (toPct === isPct(l)) return;
    const qty = r2(qtyOf.get(l.id) ?? l.qtyPerBatch);
    const base = baseFor(l, rawBase);
    if (toPct && !(base > 0)) return reject("ขั้นแรกต้องมีวัตถุดิบที่ใส่เป็นกรัมอย่างน้อย 1 ตัว (ตัวที่เป็น % คิดจากกรัมพวกนั้น)");
    run(() => actions.updateLine(l.id, toPct ? { qtyType: "percent", percentOfInput: gramsToPercent(qty, base), qtyPerBatch: qty } : { qtyType: "fixed", percentOfInput: null, qtyPerBatch: qty }));
  };
  const removeLine = (l: BOMLine) =>
    setConfirm({
      text: `เอา ${byId.get(l.rmSkuId)?.name ?? ""} ออกจากสูตร?`,
      danger: true,
      run: () => void run(() => actions.deleteLine(l.id), () => setSheet(null)),
    });
  const saveSheet = async (next: SheetLine) => {
    if (!sheet) return;
    const pct = next.pct != null ? next.pct / 100 : null;
    const kind = { qtyType: pct != null ? ("percent" as const) : ("fixed" as const), percentOfInput: pct, qtyPerBatch: r2(next.qty) };
    const l = lines.find((x) => x.id === sheet.lineId);
    if (!l) return void run(() => actions.addLine({ bomHeaderId: header.id, rmSkuId: next.skuId, yieldPercent: 1, stepId: sheet.stepId, ...kind }), () => setSheet(null));
    const swapped = next.skuId !== l.rmSkuId;
    const write = () => void run(() => actions.updateLine(l.id, { ...(swapped && { rmSkuId: next.skuId }), ...kind }), () => setSheet(null));
    const from = byId.get(l.rmSkuId)?.usageUom;
    const to = byId.get(next.skuId)?.usageUom;
    if (swapped && from !== to) return setConfirm({ text: `หน่วยเปลี่ยนจาก ${from} เป็น ${to} · ใช้ ${byId.get(next.skuId)?.name ?? ""} ${g(next.qty)} ${to} ต่อรอบ ใช่ไหม?`, run: write });
    guarded(qtyOf.get(l.id) ?? l.qtyPerBatch, next.qty, `${byId.get(next.skuId)?.name ?? ""} ต่อรอบ`, write);
  };

  // ── Steps ──
  const renameStep = (s: BOMStep, v: string) => {
    const name = v.trim();
    if (name === s.stepName) return;
    if (!name) return reject("ขั้นตอนต้องมีชื่อ");
    run(() => actions.updateStep(s.id, { stepName: name }));
  };
  const setStepYield = (s: BOMStep, v: string) => {
    const n = num(v);
    if (n === Number(pctText(s.yieldPercent))) return;
    // Over 100% is real (rice takes up water); 0 or a typo isn't
    if (!(n > 0 && n <= 1000)) return reject("เหลือต้องมากกว่า 0% (เกิน 100% ได้ถ้าน้ำหนักเพิ่ม เช่นเติมน้ำ)");
    run(() => actions.updateStep(s.id, { yieldPercent: n / 100 }));
  };
  const sorted = resolved.map((r) => r.step);
  const moveStep = (s: BOMStep, dir: -1 | 1) => {
    const i = sorted.findIndex((x) => x.id === s.id);
    const other = sorted[i + dir];
    if (!other) return;
    const nextFirst = i + dir === 0 ? s : i === 0 ? other : null;
    if (nextFirst && pctIn(nextFirst.id)) return reject(`ขั้น "${nextFirst.stepName}" มีวัตถุดิบที่ใส่เป็น % ขึ้นเป็นขั้นแรกไม่ได้ (ไม่มีอะไรให้คิด %) · เปลี่ยนเป็นกรัมก่อน`);
    run(async () => {
      if (!(await actions.updateStep(s.id, { stepNumber: other.stepNumber }))) return false;
      if (await actions.updateStep(other.id, { stepNumber: s.stepNumber })) return true;
      // Half a swap leaves two steps with one number: put the first back
      await actions.updateStep(s.id, { stepNumber: s.stepNumber });
      return false;
    });
  };
  const removeStep = (s: BOMStep) => {
    const n = lines.filter((l) => l.stepId === s.id).length;
    const i = sorted.findIndex((x) => x.id === s.id);
    const nextFirst = i === 0 ? sorted[1] : undefined;
    if (nextFirst && pctIn(nextFirst.id)) return reject(`ลบขั้นแรกแล้ว "${nextFirst.stepName}" จะกลายเป็นขั้นแรก แต่มีวัตถุดิบที่ใส่เป็น % · เปลี่ยนเป็นกรัมก่อน`);
    setConfirm({
      text: `ลบขั้น "${s.stepName}"${n ? ` พร้อมวัตถุดิบ ${n} ตัวในขั้นนี้` : ""}? ${i === 0 ? (sorted[1] ? `"${sorted[1].stepName}" จะเป็นขั้นแรก` : "") : `ขั้นถัดไปจะรับของต่อจาก "${sorted[i - 1].stepName}"`}`,
      danger: true,
      run: () =>
        void run(
          async () => {
            if (!(await actions.deleteStep(s.id))) return false;
            // Close the gap so the order stays 1, 2, 3…
            const rest = sorted.filter((x) => x.id !== s.id);
            for (let i = 0; i < rest.length; i++) if (rest[i].stepNumber !== i + 1 && !(await actions.updateStep(rest[i].id, { stepNumber: i + 1 }))) return false;
            return true;
          },
          () => setStepSheet(null),
        ),
    });
  };
  const addStep = () => {
    const n = sorted.length;
    run(async () => !!(await actions.addStep({ bomHeaderId: header.id, stepNumber: (sorted[n - 1]?.stepNumber ?? 0) + 1, stepName: `ขั้นที่ ${n + 1}`, yieldPercent: 1 })));
  };
  const adoptLoose = () => {
    const first = sorted[0];
    if (!first) return;
    run(async () => {
      for (const l of loose) if (!(await actions.updateLine(l.id, { stepId: first.id, qtyType: "fixed", percentOfInput: null, yieldPercent: 1, qtyPerBatch: l.qtyPerBatch / (l.yieldPercent || 1) }))) return false;
      return true;
    });
  };

  const inRecipe = new Set(lines.map((l) => l.rmSkuId));
  const options = skus
    .filter((s) => s.status === "Active" && s.id !== sku.id && !inRecipe.has(s.id) && !dependents.has(s.id) && (s.type === "RM" || s.type === "SM"))
    .map((s) => ({ value: s.id, label: s.name, sublabel: `${s.skuId} · ${s.usageUom}` }));
  const field = "h-10 w-full text-right font-mono text-[16px]";
  const sheetStep = sheet ? resolved.find((r) => r.step.id === sheet.stepId) : undefined;
  const sheetLine = sheet?.lineId ? lines.find((l) => l.id === sheet.lineId) : undefined;
  const stepOnSheet = stepSheet ? resolved.find((r) => r.step.id === stepSheet) : undefined;

  const Flow = ({ r, last }: { r: (typeof resolved)[number]; last: boolean }) => (
    <div className="grid grid-cols-3 gap-1.5">
      <Box label="เข้า" value={g(r.input)} />
      <Box label="เหลือ" value={`${pctText(r.step.yieldPercent)}%`} />
      <Box label={last ? "ได้ต่อรอบ" : "ออก"} value={g(r.output)} strong={last} />
    </div>
  );

  return (
    <div ref={measure} className="flex flex-col gap-3">
      <div className={cn("grid gap-2", wide ? "grid-cols-4" : "grid-cols-3")}>
        {wide && <Kpi label="ใส่เข้าขั้นแรก" value={`${g(resolved[0]?.input ?? 0)} ${sku.usageUom}`} />}
        <Kpi label="ได้ต่อรอบ" value={`${g(output)} ${sku.usageUom}`} />
        <Kpi label="ต้นทุนต่อรอบ" value={baht(batchCost, 0)} />
        <Kpi label={`ต้นทุน / ${sku.usageUom}`} value={output > 0 ? perUnit(perUse, sku.usageUom).replace(`/${sku.usageUom}`, "") : "—"} />
      </div>

      {loose.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-warning/40 bg-warning-soft px-4 py-3 text-sm">
          <span className="min-w-0 flex-1">
            วัตถุดิบ {loose.length} ตัวไม่อยู่ในขั้นไหน ({loose.map((l) => byId.get(l.rmSkuId)?.name ?? "—").join(", ")}) · ตอนนี้ไม่ถูกนับทั้งต้นทุนและตอนผลิต
          </span>
          {canEdit && sorted.length > 0 && (
            <Button variant="outline" className="h-10" loading={busy} onClick={adoptLoose}>
              ย้ายเข้าขั้นที่ 1
            </Button>
          )}
        </div>
      )}

      {resolved.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border bg-card p-5 text-sm text-muted-foreground">ยังไม่มีขั้นตอน · เพิ่มขั้นแรกแล้วใส่วัตถุดิบที่เข้าขั้นนั้น</div>
      )}

      {resolved.map((r, i) => {
        const last = i === resolved.length - 1;
        const own = lines.filter((l) => l.stepId === r.step.id);
        const added = r.input - (i === 0 ? 0 : resolved[i - 1].output);
        return (
          <section key={r.step.id} className={cn("overflow-hidden rounded-2xl border bg-card shadow-card", last ? "border-brand/40" : "border-border")}>
            {wide ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-3">
                <StepNo n={i + 1} />
                <Input key={`n${gen}${r.step.id}${r.step.stepName}`} disabled={!canEdit} defaultValue={r.step.stepName} onBlur={(e) => renameStep(r.step, e.target.value)} onKeyDown={enterNext} data-rcp-field className="h-10 w-44 text-[15px] font-semibold" aria-label={`ชื่อขั้นที่ ${i + 1}`} />
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="rounded-lg border border-border bg-secondary/50 px-2.5 py-1">
                    เข้า <b className="font-mono text-[15px]">{g(r.input)}</b>
                  </span>
                  {i > 0 && added > 0 && <span className="text-xs text-muted-foreground">({g(resolved[i - 1].output)} จากขั้นก่อน + ใส่เพิ่ม {g(added)})</span>}
                  <span className="text-muted-foreground">→ เหลือ</span>
                  <Input key={`y${gen}${r.step.id}${r.step.yieldPercent}`} disabled={!canEdit} defaultValue={pctText(r.step.yieldPercent)} inputMode="decimal" onBlur={(e) => setStepYield(r.step, e.target.value)} onKeyDown={enterNext} data-rcp-field className={cn(field, "w-20")} aria-label={`ขั้นที่ ${i + 1} เหลือ %`} />
                  <span className="text-muted-foreground">% →</span>
                  <span className={cn("rounded-lg border px-2.5 py-1", last ? "border-brand/50 bg-brand-soft" : "border-border bg-secondary/50")}>
                    {last ? "ได้" : "ออก"} <b className="font-mono text-[15px]">{g(r.output)}</b> {sku.usageUom}
                    {last && " ต่อรอบ"}
                  </span>
                </div>
                {canEdit && (
                  <div className="ml-auto flex items-center gap-1">
                    <Button variant="outline" size="icon" className="h-10 w-10" disabled={i === 0 || busy} onClick={() => moveStep(r.step, -1)} aria-label={`เลื่อนขั้น ${r.step.stepName} ขึ้น`}>
                      <ChevronUp className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="icon" className="h-10 w-10" disabled={last || busy} onClick={() => moveStep(r.step, 1)} aria-label={`เลื่อนขั้น ${r.step.stepName} ลง`}>
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" className="h-10 px-3 text-sm text-destructive" disabled={busy} onClick={() => removeStep(r.step)}>
                      ลบขั้น
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-2 border-b border-border px-3 py-3">
                <div className="flex items-center gap-2">
                  <StepNo n={i + 1} />
                  <b className="min-w-0 flex-1 break-words">{r.step.stepName}</b>
                  {canEdit && (
                    <Button variant="outline" className="h-9 px-3 text-sm" onClick={() => setStepSheet(r.step.id)}>
                      แก้ขั้น
                    </Button>
                  )}
                </div>
                <Flow r={r} last={last} />
              </div>
            )}

            {wide ? (
              own.length > 0 && (
                <table className="w-full table-fixed text-sm">
                  <colgroup>
                    <col />
                    <col style={{ width: "196px" }} />
                    <col style={{ width: "150px" }} />
                    <col style={{ width: "90px" }} />
                    <col style={{ width: "100px" }} />
                    <col style={{ width: canEdit ? "128px" : "12px" }} />
                  </colgroup>
                  <thead className="text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium">วัตถุดิบ</th>
                      <th className="px-2 py-2 text-left font-medium">ใส่แบบ</th>
                      <th className="px-2 py-2 text-right font-medium">จำนวน</th>
                      <th className="px-2 py-2 text-right font-medium">฿/หน่วย</th>
                      <th className="px-2 py-2 text-right font-medium">ต้นทุน</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {own.map((l) => {
                      const ing = byId.get(l.rmSkuId);
                      const p = priceOf(l.rmSkuId);
                      const q = qtyOf.get(l.id) ?? 0;
                      const pct = isPct(l);
                      return (
                        <tr key={l.id} className="border-t border-border">
                          <td className="px-4 py-2">
                            <button type="button" onClick={() => onOpenProduct(l.rmSkuId)} className="flex min-w-0 items-start gap-2 text-left hover:underline">
                              {ing && <KindBadge kind={ing.type} className="mt-0.5 shrink-0" />}
                              <span className="min-w-0 break-words">
                                {ing?.name ?? "—"}
                                {pct && (
                                  <span className="block text-xs text-muted-foreground no-underline">
                                    = {g(q)} {ing?.usageUom}
                                  </span>
                                )}
                              </span>
                            </button>
                          </td>
                          <td className="px-2 py-2">
                            <div role="radiogroup" aria-label={`${ing?.name} ใส่แบบ`} className="inline-flex overflow-hidden rounded-lg border border-border text-xs">
                              {[false, true].map((v) => (
                                <button key={String(v)} type="button" role="radio" aria-checked={pct === v} disabled={!canEdit || busy} onClick={() => setKind(l, r.base, v)} className={cn("h-9 px-2.5", pct === v ? "bg-brand-soft font-semibold text-brand-soft-foreground" : "bg-card")}>
                                  {v ? "% ของที่เข้า" : ing?.usageUom ?? "กรัม"}
                                </button>
                              ))}
                            </div>
                          </td>
                          <td className="px-2 py-2">
                            <div className="flex items-center gap-1">
                              <Input data-rcp-field key={`q${gen}${l.id}${pct}${l.qtyPerBatch}${l.percentOfInput}`} disabled={!canEdit} defaultValue={pct ? pctText(l.percentOfInput!) : l.qtyPerBatch} inputMode="decimal" onBlur={(e) => setAmount(l, r.base, e.target.value)} onKeyDown={enterNext} className={field} aria-label={`${ing?.name} ${pct ? "% ของที่เข้า" : "ต่อรอบ"}`} />
                              <span className="w-6 shrink-0 text-xs text-muted-foreground">{pct ? "%" : ing?.usageUom}</span>
                            </div>
                          </td>
                          <td className={cn("px-2 py-2 text-right font-mono tabular-nums", !p && "font-semibold text-destructive")}>{p ? p.toLocaleString("th-TH", { maximumFractionDigits: 3 }) : "ไม่มีราคา"}</td>
                          <td className="px-2 py-2 text-right font-mono tabular-nums">{baht(q * p)}</td>
                          <td className="px-1 py-2">
                            {canEdit && (
                              <div className="flex items-center justify-end gap-1">
                                <Button variant="outline" className="h-9 px-3 text-sm" onClick={() => setSheet({ stepId: r.step.id, lineId: l.id })} aria-label={`เปลี่ยน ${ing?.name}`}>
                                  เปลี่ยน
                                </Button>
                                <Button variant="ghost" size="icon" className="h-10 w-10" onClick={() => removeLine(l)} aria-label={`เอา ${ing?.name} ออก`}>
                                  <Trash2 className="h-4 w-4 text-muted-foreground" />
                                </Button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )
            ) : (
              own.map((l, j) => {
                const ing = byId.get(l.rmSkuId);
                const p = priceOf(l.rmSkuId);
                const q = qtyOf.get(l.id) ?? 0;
                return (
                  <button key={l.id} type="button" onClick={() => (canEdit ? setSheet({ stepId: r.step.id, lineId: l.id }) : onOpenProduct(l.rmSkuId))} className={cn("flex w-full items-start gap-2.5 px-3 py-3 text-left hover:bg-secondary/40", j > 0 && "border-t border-border")}>
                    {ing && <KindBadge kind={ing.type} className="mt-0.5 shrink-0" />}
                    <span className="min-w-0 flex-1">
                      <span className="block break-words font-semibold">{ing?.name ?? "—"}</span>
                      <span className="block text-[13px] text-muted-foreground">
                        {isPct(l) ? (
                          <>
                            {pctText(l.percentOfInput!)}% ของที่เข้า = <span className="font-mono">{g(q)} {ing?.usageUom}</span>
                          </>
                        ) : (
                          <>
                            ใช้ <span className="font-mono">{g(q)} {ing?.usageUom}</span>
                          </>
                        )}
                      </span>
                    </span>
                    <span className={cn("shrink-0 font-mono font-semibold tabular-nums", !p && "text-destructive")}>{p ? baht(q * p) : "ไม่มีราคา"}</span>
                  </button>
                );
              })
            )}
            {canEdit && (
              <div className={cn("px-3 py-2.5", own.length > 0 && "border-t border-border")}>
                <Button variant="outline" className={cn("border-dashed", wide ? "h-10" : "h-11 w-full text-[15px]")} onClick={() => setSheet({ stepId: r.step.id, lineId: null })}>
                  + เพิ่มวัตถุดิบในขั้นนี้
                </Button>
              </div>
            )}
          </section>
        );
      })}

      {canEdit && (
        <Button variant="outline" className={cn("border-dashed", wide ? "h-11 self-start" : "h-12 w-full text-[15px]")} loading={busy} onClick={addStep}>
          + เพิ่มขั้นตอน
        </Button>
      )}
      <p className="text-sm text-muted-foreground">
        {output > 0 && (
          <>
            ต้นทุน <b className="font-mono text-foreground">{perUnit(perUse, sku.usageUom)}</b>
            {byproductPct > 0 && <> (หลังแบ่งให้ผลพลอยได้ {Math.round(byproductPct * 10) / 10}%)</>} ·{" "}
          </>
        )}
        ตัวเลขชุดเดียวกับที่ตัดวัตถุดิบตอนผลิต · แก้แล้วคิดต้นทุนสูตรนี้และเมนูที่ใช้ใหม่ให้เอง
      </p>

      {sheet && sheetStep && (
        <RecipeLineSheet
          key={sheetLine ? `${sheetLine.id}${sheetLine.rmSkuId}${sheetLine.qtyPerBatch}${sheetLine.percentOfInput}` : `new${sheet.stepId}`}
          line={sheetLine ? { skuId: sheetLine.rmSkuId, qty: qtyOf.get(sheetLine.id) ?? sheetLine.qtyPerBatch, yieldPct: null, pct: isPct(sheetLine) ? Number(pctText(sheetLine.percentOfInput!)) : null } : null}
          recipeName={`${sku.name} · ${sheetStep.step.stepName}`}
          isSp={false}
          byId={byId}
          options={options}
          priceOf={priceOf}
          askBatch={null}
          step={{ name: sheetStep.step.stepName, base: baseFor(sheetLine, sheetStep.base) }}
          busy={busy}
          onSave={(next) => saveSheet(next)}
          onRemove={sheetLine ? () => removeLine(sheetLine) : undefined}
          onClose={() => setSheet(null)}
        />
      )}
      {stepOnSheet && (
        <StepSheet
          key={`${stepOnSheet.step.id}${stepOnSheet.step.stepName}${stepOnSheet.step.yieldPercent}${gen}`}
          step={stepOnSheet.step}
          index={sorted.indexOf(stepOnSheet.step)}
          count={sorted.length}
          input={stepOnSheet.input}
          busy={busy}
          onSave={(name, y) => {
            const st = stepOnSheet.step;
            const n = num(y);
            const patch = { ...(name.trim() && name.trim() !== st.stepName && { stepName: name.trim() }), ...(n > 0 && n <= 1000 && n !== Number(pctText(st.yieldPercent)) && { yieldPercent: n / 100 }) };
            if (!Object.keys(patch).length) return setStepSheet(null);
            run(() => actions.updateStep(st.id, patch), () => setStepSheet(null));
          }}
          onMove={(dir) => moveStep(stepOnSheet.step, dir)}
          onRemove={() => removeStep(stepOnSheet.step)}
          onClose={() => setStepSheet(null)}
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
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card px-3 py-2.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="break-words font-mono text-[17px] font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function Box({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn("rounded-xl border px-2 py-1.5 text-center", strong ? "border-brand/50 bg-brand-soft" : "border-border bg-secondary/50")}>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="font-mono text-[16px] font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function StepNo({ n }: { n: number }) {
  return <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-foreground text-[13px] font-semibold text-background">{n}</span>;
}

/** Phone: one step on a sheet — name, what's left, order, delete */
function StepSheet({ step, index, count, input, busy, onSave, onMove, onRemove, onClose }: { step: BOMStep; index: number; count: number; input: number; busy: boolean; onSave: (name: string, yieldPct: string) => void; onMove: (dir: -1 | 1) => void; onRemove: () => void; onClose: () => void }) {
  const [name, setName] = useState(step.stepName);
  const [y, setY] = useState(pctText(step.yieldPercent));
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.focus({ preventScroll: true });
  }, []);
  const n = num(y);
  return (
    <div className="fixed inset-0 z-[45] flex items-end justify-center bg-black/30 md:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={`แก้ขั้น ${step.stepName}`} ref={panel} tabIndex={-1} onKeyDown={(e) => e.key === "Escape" && onClose()} onClick={(e) => e.stopPropagation()} className="flex max-h-[90dvh] w-full flex-col gap-4 overflow-y-auto rounded-t-2xl bg-card p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-raised outline-none md:max-w-md md:rounded-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm text-muted-foreground">ขั้นที่ {index + 1} จาก {count}</p>
            <h3 className="break-words text-lg font-bold">{step.stepName}</h3>
          </div>
          <Button variant="ghost" className="h-10 shrink-0 px-3" onClick={onClose}>
            ปิด
          </Button>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold">ชื่อขั้น</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} className="h-12 text-[17px]" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold">เหลือหลังขั้นนี้ (%)</span>
          <Input value={y} onChange={(e) => setY(e.target.value)} inputMode="decimal" className="h-12 text-right font-mono text-[17px]" />
          <span className="text-xs text-muted-foreground">
            เข้า {g(input)} → ออก {n > 0 ? g((input * n) / 100) : "—"} · เกิน 100% ได้ถ้าน้ำหนักเพิ่ม (เช่นเติมน้ำ)
          </span>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" className="h-11" disabled={index === 0 || busy} onClick={() => onMove(-1)}>
            <ChevronUp className="mr-1 h-4 w-4" /> เลื่อนขึ้น
          </Button>
          <Button variant="outline" className="h-11" disabled={index === count - 1 || busy} onClick={() => onMove(1)}>
            <ChevronDown className="mr-1 h-4 w-4" /> เลื่อนลง
          </Button>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="h-12 border-destructive/40 px-4 text-destructive" disabled={busy} onClick={onRemove}>
            ลบขั้น
          </Button>
          <Button className="h-12 flex-1 text-[16px]" loading={busy} disabled={!name.trim() || !(n > 0 && n <= 1000)} onClick={() => onSave(name, y)}>
            บันทึก
          </Button>
        </div>
      </div>
    </div>
  );
}
