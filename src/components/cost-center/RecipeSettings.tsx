import { useState } from "react";
import type { SKU } from "@/types/sku";
import type { Price } from "@/types/price";
import type { BOMHeader, BOMLine, BOMStep, ProductionType } from "@/types/bom";
import { toMultistep, toSimple } from "@/lib/recipe-mode";
import { exportSmBom } from "@/lib/bom-export";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { RecipeEditActions } from "./RecipeEditor";

interface Props {
  sku: SKU;
  header: BOMHeader;
  /** This recipe's lines and steps */
  lines: BOMLine[];
  steps: BOMStep[];
  /** Every SM recipe, for the Excel export */
  all: { headers: BOMHeader[]; lines: BOMLine[]; steps: BOMStep[] };
  skus: SKU[];
  prices: Price[];
  canEdit: boolean;
  actions: RecipeEditActions;
  onChanged: () => void;
  /** After the whole recipe is deleted (its by-products go with it) */
  onDeleted: (headerId: string) => void;
}

/**
 * The jobs that only the old BOM page did: made here or bought in, made in one go or
 * step by step, export every SM recipe, delete the recipe. Switching how it is made
 * keeps what it costs and what a batch gives (recipe-mode.ts).
 */
export function RecipeSettings({ sku, header, lines, steps, all, skus, prices, canEdit, actions, onChanged, onDeleted }: Props) {
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ text: string; run: () => Promise<void>; danger?: boolean } | null>(null);
  const multi = header.bomMode === "multistep";

  const setType = async (t: ProductionType) => {
    if (t === header.productionType) return;
    setBusy(true);
    await actions.updateHeader(header.id, { productionType: t });
    setBusy(false);
  };

  // Lines in no step are counted by neither side the same way: sort them out first
  const loose = multi ? lines.filter((l) => !steps.some((st) => st.id === l.stepId)) : [];
  const switchMode = () => {
    if (loose.length) return toast.error(`มีวัตถุดิบ ${loose.length} ตัวที่ไม่อยู่ในขั้นไหน · กด "ย้ายเข้าขั้นที่ 1" ก่อนแล้วค่อยเปลี่ยน`);
    setConfirm({
      text: multi
        ? `รวม ${steps.length} ขั้นเป็นสูตรเดียว? วัตถุดิบทุกตัวใช้เท่าเดิมต่อรอบ · ผลิตรอบละ = ที่ได้จากขั้นสุดท้าย · ต้นทุนและน้ำหนักที่ได้เท่าเดิม`
        : `เปลี่ยนเป็นทำทีละขั้น? วัตถุดิบทั้งหมดไปอยู่ขั้นที่ 1 (ใช้ % ได้จริงของแต่ละตัวรวมเข้าไปแล้ว) · ต้นทุนและน้ำหนักที่ได้เท่าเดิม แล้วค่อยแบ่งขั้นเอง`,
      // Written in an order where every step on the way still costs and deducts the
      // same (a write failing halfway leaves a recipe that is right, just untidy)
      run: async () => {
        try {
          if (multi) {
            const sm = toSimple(header, lines, steps);
            // 1. Amounts first: a multi-step recipe ignores qty on % lines and line yields
            for (const u of sm.lines) if (!(await actions.updateLine(u.id, { qtyPerBatch: u.qtyPerBatch, yieldPercent: 1 }))) return;
            // 2. The switch itself: from here every line counts at its amount
            if (!(await actions.updateHeader(header.id, { bomMode: "simple", batchSize: sm.batchSize, yieldPercent: sm.yieldPercent }))) return;
            // 3. Tidy up (a simple recipe reads neither)
            for (const u of sm.lines) if (!(await actions.updateLine(u.id, { stepId: null, qtyType: null, percentOfInput: null }))) return;
            for (const st of steps) if (!(await actions.deleteStep(st.id))) return;
          } else {
            // Steps left from the old page would run after the new step 1
            for (const st of steps) if (!(await actions.deleteStep(st.id))) return;
            const m = toMultistep(header, lines);
            const stepId = await actions.addStep({ bomHeaderId: header.id, stepNumber: 1, stepName: "ขั้นที่ 1", yieldPercent: m.stepYield });
            if (!stepId) return;
            // Each line in one write: amount bought at 100% is the same amount bought
            for (const u of m.lines) {
              const { id, ...data } = u;
              if (!(await actions.updateLine(id, { ...data, stepId }))) return;
            }
            await actions.updateHeader(header.id, { bomMode: "multistep" });
          }
        } finally {
          onChanged();
        }
      },
    });
  };

  const remove = () =>
    setConfirm({
      text: `ลบสูตร ${sku.name} ทั้งสูตร (วัตถุดิบ ${lines.length} ตัว${steps.length ? ` · ${steps.length} ขั้น` : ""} · ผลพลอยได้)? ผลิตแล้วจะไม่ตัดวัตถุดิบจนกว่าจะทำสูตรใหม่`,
      danger: true,
      run: async () => {
        if (await actions.deleteHeader(header.id)) onDeleted(header.id);
      },
    });

  const seg = (on: boolean) => cn("h-10 px-3 text-sm", on ? "bg-brand-soft font-semibold text-brand-soft-foreground" : "bg-card");
  return (
    <section className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl border border-border bg-card px-4 py-3 text-sm shadow-card">
      <span className="font-semibold">ตั้งค่าสูตร</span>
      <span className="flex items-center gap-2">
        ทำที่
        <span role="radiogroup" aria-label="ทำที่" className="inline-flex overflow-hidden rounded-lg border border-border">
          {(["CK", "Outsource"] as const).map((t) => (
            <button key={t} type="button" role="radio" aria-checked={header.productionType === t} disabled={!canEdit || busy} onClick={() => setType(t)} className={seg(header.productionType === t)}>
              {t === "CK" ? "ครัวกลางทำเอง" : "จ้างข้างนอก"}
            </button>
          ))}
        </span>
      </span>
      <span className="flex items-center gap-2">
        ทำแบบ
        <span role="radiogroup" aria-label="ทำแบบ" className="inline-flex overflow-hidden rounded-lg border border-border">
          {[false, true].map((m) => (
            <button key={String(m)} type="button" role="radio" aria-checked={multi === m} disabled={!canEdit || busy} onClick={() => multi !== m && switchMode()} className={seg(multi === m)}>
              {m ? "ทีละขั้น" : "รวดเดียว"}
            </button>
          ))}
        </span>
      </span>
      <span className="flex-1" />
      <Button variant="outline" className="h-10" onClick={() => exportSmBom(all.headers, all.lines, all.steps, skus, prices)}>
        ส่งออก Excel ทุกสูตร SM
      </Button>
      {canEdit && (
        <Button variant="outline" className="h-10 text-destructive" disabled={busy} onClick={remove}>
          ลบทั้งสูตร
        </Button>
      )}
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="เช็คอีกที"
        description={confirm?.text ?? ""}
        confirmLabel={confirm?.danger ? "ลบทั้งสูตร" : "ใช่ เปลี่ยน"}
        cancelLabel="ไม่ใช่"
        variant={confirm?.danger ? "destructive" : "default"}
        onConfirm={async () => {
          const go = confirm?.run;
          setConfirm(null);
          if (!go) return;
          setBusy(true);
          await go();
          setBusy(false);
        }}
      />
    </section>
  );
}
