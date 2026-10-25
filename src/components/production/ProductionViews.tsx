import { useMemo, useState } from "react";
import { addDays, format } from "date-fns";
import { ChevronDown, ChevronLeft, ChevronRight, Search, Sparkles } from "lucide-react";
import type { SKU } from "@/types/sku";
import type { ProductionRecord } from "@/types/production";
import { daysTone, gramsText, planFacts } from "@/lib/production";
import { NoteField, SkuPicker, onEnterNext } from "@/components/receive/parts";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { thaiDay } from "@/components/sales/SalesDays";
import { cn } from "@/lib/utils";

const iso = (d: Date) => format(d, "yyyy-MM-dd");
const parse = (raw: string) => Math.max(0, Number(raw.replace(/,/g, "")) || 0);
const toneText = { red: "text-destructive", amber: "text-warning", green: "text-success", none: "text-muted-foreground" } as const;
const daysText = (d: number) => (d === Infinity ? "—" : d <= 0 ? "หมด" : `${d.toLocaleString("th-TH", { maximumFractionDigits: 1 })} วัน`);
const chip = (on: boolean) => cn("min-h-[44px] rounded-xl border px-3 text-sm", on ? "border-primary bg-primary font-semibold text-primary-foreground" : "border-border bg-card");

export interface ProdRow {
  sku: SKU;
  perBatch: number;
  plan: number;
  made: number;
  dailyNeed: number;
  stock: number;
  target: number;
  hasBom: boolean;
}

// ─── Left column: mode, week progress, the day's records ───

export function ProdSide({
  mode,
  onMode,
  weekLabel,
  done,
  planned,
  dayRecords,
  day,
  nameOf,
  canEdit,
  canDelete,
  onEdit,
  onDelete,
}: {
  mode: "record" | "plan";
  onMode: (m: "record" | "plan") => void;
  weekLabel: string;
  done: number;
  planned: number;
  dayRecords: ProductionRecord[];
  day: string;
  nameOf: (id: string) => string;
  canEdit: boolean;
  /** Deleting a record is management only (as before) */
  canDelete: boolean;
  onEdit: (r: ProductionRecord) => void;
  onDelete: (r: ProductionRecord) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-1.5" data-tour="prod-mode">
        <button type="button" className={cn(chip(mode === "record"), "flex-1")} onClick={() => onMode("record")}>
          บันทึกผลผลิต
        </button>
        <button type="button" className={cn(chip(mode === "plan"), "flex-1")} onClick={() => onMode("plan")}>
          วางแผน
        </button>
      </div>
      <div className="rounded-2xl border border-border bg-card p-3 shadow-card">
        <div className="text-[13px] text-muted-foreground">สัปดาห์นี้ · {weekLabel}</div>
        <div className="font-mono text-2xl font-bold">
          {done} / {planned}
        </div>
        <div className="text-[13px] text-muted-foreground">รายการผลิตครบตามแผน</div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-secondary">
          <div className="h-full bg-success" style={{ width: `${planned ? Math.min(100, (done / planned) * 100) : 0}%` }} />
        </div>
      </div>
      <section className="flex flex-col gap-1.5">
        <h2 className="text-[13px] font-bold">บันทึก{day === iso(new Date()) ? "วันนี้" : thaiDay(day)}</h2>
        {dayRecords.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card px-4 py-4 text-sm text-muted-foreground">ยังไม่มี</div>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card text-sm">
            {dayRecords.map((r) => (
              <li key={r.id} className="flex items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{nameOf(r.smSkuId)}</span>
                  {r.notes && <span className="block truncate text-[13px] text-muted-foreground">{r.notes}</span>}
                </span>
                <span className="shrink-0 font-mono">{gramsText(r.actualOutputG)}</span>
                {canEdit && (
                  <button type="button" onClick={() => onEdit(r)} className="min-h-[36px] rounded-lg px-1.5 text-primary hover:bg-secondary">
                    แก้
                  </button>
                )}
                {canDelete && (
                  <button type="button" onClick={() => onDelete(r)} className="min-h-[36px] rounded-lg px-1.5 text-muted-foreground hover:text-destructive">
                    ลบ
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ─── Recording ───

export function RecordView({
  day,
  onDay,
  rows,
  extraSkus,
  dayRecords,
  canEdit,
  busy,
  onRecord,
  onGoPlan,
}: {
  day: string;
  onDay: (d: string) => void;
  /** This week's planned products plus any added "นอกแผน" */
  rows: ProdRow[];
  /** Products with a recipe that can be made outside the plan */
  extraSkus: SKU[];
  dayRecords: ProductionRecord[];
  canEdit: boolean;
  busy: string | null;
  onRecord: (skuId: string, grams: number, notes: string) => Promise<boolean>;
  onGoPlan: () => void;
}) {
  const today = iso(new Date());
  const yesterday = iso(addDays(new Date(), -1));
  const [added, setAdded] = useState<string[]>([]);
  const [picking, setPicking] = useState(false);
  const [typed, setTyped] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [again, setAgain] = useState<{ skuId: string; grams: number; text: string } | null>(null);
  const [showDone, setShowDone] = useState(false);

  const all = useMemo(() => {
    const extra = added.filter((id) => !rows.some((r) => r.sku.id === id)).map((id) => extraSkus.find((s) => s.id === id)).filter(Boolean) as SKU[];
    return [...rows, ...extra.map((sku) => ({ sku, perBatch: 0, plan: 0, made: 0, dailyNeed: 0, stock: 0, target: 0, hasBom: true }))];
  }, [rows, added, extraSkus]);
  const isDone = (r: ProdRow) => r.plan > 0 && r.made >= r.plan && !added.includes(r.sku.id);
  const todo = all
    .filter((r) => !isDone(r) && (r.plan > 0 || added.includes(r.sku.id)))
    .sort((a, b) => {
      const da = a.dailyNeed > 0 ? a.stock / a.dailyNeed : Infinity;
      const db = b.dailyNeed > 0 ? b.stock / b.dailyNeed : Infinity;
      return da - db;
    });
  const done = all.filter(isDone);

  const record = async (skuId: string, force = false, typedNow?: number) => {
    const grams = typedNow ?? typed[skuId] ?? 0;
    if (grams <= 0) return;
    const before = dayRecords.filter((r) => r.smSkuId === skuId);
    if (before.length && !force) {
      const sum = before.reduce((s, r) => s + r.actualOutputG, 0);
      const at = before[0].createdAt ? format(new Date(before[0].createdAt), "HH:mm") : "";
      setAgain({ skuId, grams, text: `บันทึก${day === today ? "วันนี้" : "วันนั้น"}ไปแล้ว ${gramsText(sum)}${at ? ` ตอน ${at}` : ""}` });
      return;
    }
    if (await onRecord(skuId, grams, notes[skuId] || "")) {
      setTyped((p) => ({ ...p, [skuId]: 0 }));
      setNotes((p) => ({ ...p, [skuId]: "" }));
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-xl font-bold">ยังต้องผลิตสัปดาห์นี้</h2>
        <div className="flex gap-1.5" data-tour="prod-day">
          <button type="button" className={chip(day === today)} onClick={() => onDay(today)}>
            วันนี้
          </button>
          <button type="button" className={chip(day === yesterday)} onClick={() => onDay(yesterday)}>
            เมื่อวาน
          </button>
          <label className={cn(chip(day !== today && day !== yesterday), "relative flex items-center")}>
            {day !== today && day !== yesterday ? thaiDay(day) : "วันอื่น"}
            <input type="date" max={today} value={day} onChange={(e) => e.target.value && onDay(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" aria-label="วันที่ผลิต" />
          </label>
        </div>
        {canEdit && (
          <Button variant="outline" className="h-11" onClick={() => setPicking(true)}>
            <Search className="h-4 w-4" /> ผลิตนอกแผน
          </Button>
        )}
      </div>

      {todo.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
          {rows.some((r) => r.plan > 0) ? (
            "ผลิตครบตามแผนแล้ว"
          ) : (
            <>
              สัปดาห์นี้ยังไม่มีแผน
              {canEdit && (
                <Button variant="outline" className="h-10" onClick={onGoPlan}>
                  ไปวางแผน
                </Button>
              )}
            </>
          )}
        </div>
      ) : (
        <>
          {/* Computer */}
          <div data-tour="prod-lines" className="hidden overflow-hidden rounded-2xl border border-border bg-card shadow-card lg:block" onKeyDown={onEnterNext}>
            <table className="w-full table-fixed text-sm">
              <colgroup>
                <col />
                <col style={{ width: "200px" }} />
                <col style={{ width: "110px" }} />
                <col style={{ width: "180px" }} />
                <col style={{ width: "120px" }} />
              </colgroup>
              <thead>
                <tr className="bg-secondary/60 text-left text-[13px] text-muted-foreground">
                  <th className="px-3 py-2.5 font-medium">สินค้า</th>
                  <th className="px-3 py-2.5 font-medium">ผลิตแล้ว / แผน</th>
                  <th className="px-3 py-2.5 text-right font-medium">พอใช้</th>
                  <th className="px-3 py-2.5 text-right font-medium">ผลิตได้</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {todo.map((r) => (
                  <RecordRow key={r.sku.id} r={r} grams={typed[r.sku.id] || 0} note={notes[r.sku.id] || ""} busy={busy === r.sku.id} canEdit={canEdit} onGrams={(g) => setTyped((p) => ({ ...p, [r.sku.id]: g }))} onNote={(n) => setNotes((p) => ({ ...p, [r.sku.id]: n }))} onRecord={(g) => record(r.sku.id, false, g)} desk />
                ))}
              </tbody>
            </table>
          </div>
          {/* Phone */}
          <ul data-tour="prod-lines" className="flex flex-col gap-2 lg:hidden" onKeyDown={onEnterNext}>
            {todo.map((r) => (
              <RecordRow key={r.sku.id} r={r} grams={typed[r.sku.id] || 0} note={notes[r.sku.id] || ""} busy={busy === r.sku.id} canEdit={canEdit} onGrams={(g) => setTyped((p) => ({ ...p, [r.sku.id]: g }))} onNote={(n) => setNotes((p) => ({ ...p, [r.sku.id]: n }))} onRecord={(g) => record(r.sku.id, false, g)} />
            ))}
          </ul>
        </>
      )}

      {done.length > 0 && (
        <section>
          <button type="button" onClick={() => setShowDone((s) => !s)} className="flex min-h-[44px] items-center gap-1 text-sm font-bold">
            ครบแล้ว {done.length} รายการ <ChevronDown className={cn("h-4 w-4 transition-transform", showDone && "rotate-180")} />
          </button>
          {showDone && (
            <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card text-sm">
              {done.map((r) => (
                <li key={r.sku.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="truncate">{r.sku.name}</span>
                  <span className="flex shrink-0 items-center gap-2 font-mono">
                    {gramsText(r.made)} / {gramsText(r.plan)}
                    {canEdit && (
                      <button type="button" onClick={() => setAdded((p) => [...p, r.sku.id])} className="min-h-[36px] rounded-lg px-2 font-sans text-primary hover:bg-secondary">
                        ผลิตเพิ่ม
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <SkuPicker
        open={picking}
        title="ผลิตนอกแผน"
        skus={extraSkus}
        onPick={(s) => {
          setPicking(false);
          setAdded((p) => (p.includes(s.id) ? p : [...p, s.id]));
        }}
        onClose={() => setPicking(false)}
      />
      <ConfirmDialog
        open={!!again}
        onOpenChange={(o) => !o && setAgain(null)}
        title={`${all.find((r) => r.sku.id === again?.skuId)?.sku.name ?? ""} · บันทึกซ้ำ?`}
        description={again?.text ?? ""}
        confirmLabel="บันทึกเพิ่ม"
        cancelLabel="ไม่ใช่"
        onConfirm={() => {
          const a = again;
          setAgain(null);
          if (a) record(a.skuId, true, a.grams);
        }}
      />
    </div>
  );
}

function RecordRow({
  r,
  grams,
  note,
  busy,
  canEdit,
  onGrams,
  onNote,
  onRecord,
  desk,
}: {
  r: ProdRow;
  grams: number;
  note: string;
  busy: boolean;
  canEdit: boolean;
  onGrams: (g: number) => void;
  onNote: (n: string) => void;
  /** With the value just typed (Enter), else the saved one (button) */
  onRecord: (grams?: number) => void;
  desk?: boolean;
}) {
  const days = r.dailyNeed > 0 ? r.stock / r.dailyNeed : Infinity;
  const tone = daysTone(days, r.target, r.dailyNeed);
  const share = r.perBatch > 0 && grams > 0 ? grams / r.perBatch : 0;
  const pct = r.plan > 0 ? Math.min(100, (r.made / r.plan) * 100) : 0;
  const input = (
    <span className="flex h-11 w-full items-center overflow-hidden rounded-xl border border-input bg-background focus-within:ring-2 focus-within:ring-ring">
      <input
        inputMode="decimal"
        disabled={!canEdit}
        key={`${r.sku.id}-${grams}`}
        defaultValue={grams || ""}
        placeholder={r.plan > r.made ? Math.round(r.plan - r.made).toLocaleString("th-TH") : "0"}
        onFocus={(e) => e.target.select()}
        onBlur={(e) => onGrams(parse(e.target.value))}
        onKeyDown={(e) => {
          // Enter records the row (then the list moves on)
          if (e.key === "Enter") {
            const g = parse((e.target as HTMLInputElement).value);
            onGrams(g);
            if (g > 0) onRecord(g);
          }
        }}
        data-noflow=""
        className="h-full w-full min-w-0 bg-transparent px-3 text-right font-mono text-base tabular-nums outline-none placeholder:text-muted-foreground/50"
        aria-label={`ผลิตได้ ${r.sku.name}`}
      />
      <span className="shrink-0 pr-3 text-sm text-muted-foreground">{r.sku.usageUom || "ก."}</span>
    </span>
  );
  const button = (
    <Button variant={grams > 0 ? "brand" : "outline"} className="h-11 w-full" loading={busy} disabled={!canEdit || grams <= 0} onClick={() => onRecord()}>
      บันทึก
    </Button>
  );
  const progress = r.plan > 0 && (
    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-secondary">
      <div className={cn("h-full", pct >= 100 ? "bg-success" : "bg-warning")} style={{ width: `${pct}%` }} />
    </div>
  );
  const nameBlock = (
    <>
      <div className="font-semibold leading-snug">{r.sku.name}</div>
      <div className="text-[13px] text-muted-foreground">{r.perBatch > 0 ? `1 ชุด ≈ ${gramsText(r.perBatch)}` : r.plan === 0 ? "นอกแผน" : ""}</div>
      <div className="max-w-[260px]">
        <NoteField value={note} onChange={onNote} />
      </div>
    </>
  );
  if (desk)
    return (
      <tr className={cn("border-t border-border align-top", tone === "red" && "bg-destructive/5")}>
        <td className="px-3 py-2.5">{nameBlock}</td>
        <td className="px-3 py-3">
          <div className="font-mono text-[13px]">{r.plan > 0 ? `${gramsText(r.made)} / ${gramsText(r.plan)}` : gramsText(r.made)}</div>
          {progress}
        </td>
        <td className={cn("px-3 py-3 text-right font-semibold", toneText[tone])}>{daysText(days)}</td>
        <td className="px-3 py-2">
          {input}
          {share > 0 && <div className="mt-0.5 text-right text-[13px] text-muted-foreground">≈ {share.toLocaleString("th-TH", { maximumFractionDigits: 2 })} ชุด</div>}
        </td>
        <td className="px-3 py-2">{button}</td>
      </tr>
    );
  return (
    <li className={cn("flex gap-3 rounded-2xl border bg-card p-3 shadow-card", tone === "red" ? "border-destructive/30" : "border-border")}>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {nameBlock}
        <div className="font-mono text-[13px]">{r.plan > 0 ? `${gramsText(r.made)} / ${gramsText(r.plan)}` : ""}</div>
        {progress}
        <div className={cn("text-[13px] font-semibold", toneText[tone])}>พอใช้ {daysText(days)}</div>
      </div>
      <div className="flex w-[136px] shrink-0 flex-col items-end gap-1">
        <span className="text-[13px] text-muted-foreground">ผลิตได้</span>
        {input}
        {share > 0 && <span className="text-[13px] text-muted-foreground">≈ {share.toLocaleString("th-TH", { maximumFractionDigits: 2 })} ชุด</span>}
        {button}
      </div>
    </li>
  );
}

// ─── Planning ───

export function PlanView({
  weekStart,
  thisWeek,
  onWeek,
  target,
  onTarget,
  rows,
  noBom,
  plan,
  onPlan,
  dirty,
  saving,
  canEdit,
  onSave,
  onAgent,
  onSetupBom,
  stockReady,
}: {
  /** SM stock has loaded (suggestions need it, as the old page waited for it) */
  stockReady: boolean;
  weekStart: string;
  thisWeek: string;
  onWeek: (ws: string) => void;
  target: number;
  onTarget: (n: number) => void;
  rows: ProdRow[];
  noBom: SKU[];
  plan: Record<string, number>;
  onPlan: (skuId: string, g: number) => void;
  dirty: boolean;
  saving: boolean;
  canEdit: boolean;
  onSave: () => void;
  onAgent: () => void;
  onSetupBom: () => void;
}) {
  const [only, setOnly] = useState(true);
  const nextWeek = iso(addDays(new Date(thisWeek + "T00:00:00"), 7));
  const facts = rows.map((r) => ({ r, f: planFacts(r.dailyNeed, r.stock, r.target, plan[r.sku.id] || 0) }));
  const need = facts.filter(({ f }) => f.suggest > 0);
  const shown = (only ? need : facts).sort((a, b) => a.f.daysNow - b.f.daysNow);
  const planned = Object.values(plan).filter((g) => g > 0).length;
  const short = facts.filter(({ f, r }) => f.dailyNeed > 0 && f.daysAfter < r.target).length;
  const wsDate = new Date(weekStart + "T00:00:00");
  const label = `${thaiDay(weekStart).replace(/^\S+ /, "")} – ${thaiDay(iso(addDays(wsDate, 6))).replace(/^\S+ /, "")}`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-xl font-bold">แผนผลิต · {label}</h2>
        <div className="flex items-center gap-1.5" data-tour="prod-week">
          <button type="button" className={chip(weekStart === thisWeek)} onClick={() => onWeek(thisWeek)}>
            สัปดาห์นี้
          </button>
          <button type="button" className={chip(weekStart === nextWeek)} onClick={() => onWeek(nextWeek)}>
            สัปดาห์หน้า
          </button>
          <button type="button" aria-label="สัปดาห์ก่อน" className={chip(false)} onClick={() => onWeek(iso(addDays(wsDate, -7)))}>
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button type="button" aria-label="สัปดาห์ถัดไป" className={chip(false)} onClick={() => onWeek(iso(addDays(wsDate, 7)))}>
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <label className="flex items-center gap-2 text-sm">
          ให้พอใช้
          <Input inputMode="numeric" defaultValue={target} key={target} disabled={!canEdit} onBlur={(e) => parse(e.target.value) > 0 && parse(e.target.value) !== target && onTarget(parse(e.target.value))} className="h-11 w-[72px] text-right font-mono text-base" />
          วัน
        </label>
        <Button variant="outline" className="h-11" onClick={onAgent}>
          <Sparkles className="h-4 w-4" /> ผู้ช่วยวางแผน
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" className={chip(only)} onClick={() => setOnly(true)}>
          ควรผลิต {need.length}
        </button>
        <button type="button" className={chip(!only)} onClick={() => setOnly(false)}>
          ทั้งหมด {facts.length}
        </button>
        {!stockReady && <span className="ml-auto text-sm text-muted-foreground">กำลังโหลดสต๊อก…</span>}
        {canEdit && stockReady && need.length > 0 && (
          <Button variant="outline" data-tour="prod-fill" className="ml-auto h-11 border-dashed border-brand bg-brand-soft/40 font-semibold text-brand" onClick={() => need.forEach(({ r, f }) => onPlan(r.sku.id, Math.ceil(f.suggest / 100) * 100))}>
            ใส่ตามแนะนำทั้ง {need.length} รายการ
          </Button>
        )}
      </div>

      <div data-tour="prod-plan" className="overflow-x-auto rounded-2xl border border-border bg-card shadow-card" onKeyDown={onEnterNext}>
        <table className="w-full min-w-[860px] table-fixed text-sm">
          <colgroup>
            <col />
            <col style={{ width: "110px" }} />
            <col style={{ width: "100px" }} />
            <col style={{ width: "100px" }} />
            <col style={{ width: "110px" }} />
            <col style={{ width: "190px" }} />
            <col style={{ width: "130px" }} />
          </colgroup>
          <thead>
            <tr className="bg-secondary/60 text-left text-[13px] text-muted-foreground">
              <th className="px-3 py-2.5 font-medium">สินค้า</th>
              <th className="px-3 py-2.5 text-right font-medium">คงเหลือ</th>
              <th className="px-3 py-2.5 text-right font-medium">ใช้/วัน</th>
              <th className="px-3 py-2.5 text-right font-medium">พอใช้</th>
              <th className="px-3 py-2.5 text-right font-medium">แนะนำ</th>
              <th className="px-3 py-2.5 text-right font-medium">แผน</th>
              <th className="px-3 py-2.5 text-right font-medium">หลังผลิตพอใช้</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(({ r, f }) => {
              const g = plan[r.sku.id] || 0;
              const toneNow = daysTone(f.daysNow, r.target, f.dailyNeed);
              const toneAfter = daysTone(f.daysAfter, r.target, f.dailyNeed);
              const sug = Math.ceil(f.suggest / 100) * 100;
              return (
                <tr key={r.sku.id} className="border-t border-border align-top">
                  <td className="px-3 py-2.5">
                    <div className="font-semibold leading-snug">{r.sku.name}</div>
                    {r.perBatch > 0 && <div className="text-[13px] text-muted-foreground">1 ชุด ≈ {gramsText(r.perBatch)}</div>}
                  </td>
                  <td className="px-3 py-3 text-right font-mono">{gramsText(Math.max(0, r.stock))}</td>
                  <td className="px-3 py-3 text-right font-mono">{f.dailyNeed > 0 ? gramsText(f.dailyNeed) : "—"}</td>
                  <td className={cn("px-3 py-3 text-right font-semibold", toneText[toneNow])}>{daysText(f.daysNow)}</td>
                  <td className="px-3 py-3 text-right font-mono">{sug > 0 ? gramsText(sug) : "—"}</td>
                  <td className="px-3 py-2">
                    <span className="flex h-11 w-full items-center overflow-hidden rounded-xl border border-input bg-background focus-within:ring-2 focus-within:ring-ring">
                      <input
                        inputMode="decimal"
                        disabled={!canEdit}
                        key={`${r.sku.id}-${g}`}
                        defaultValue={g || ""}
                        placeholder="0"
                        onFocus={(e) => e.target.select()}
                        onBlur={(e) => parse(e.target.value) !== g && onPlan(r.sku.id, parse(e.target.value))}
                        className="h-full w-full min-w-0 bg-transparent px-3 text-right font-mono text-base tabular-nums outline-none placeholder:text-muted-foreground/50"
                        aria-label={`แผน ${r.sku.name}`}
                      />
                      <span className="shrink-0 pr-3 text-sm text-muted-foreground">{r.sku.usageUom || "ก."}</span>
                    </span>
                    <div className="mt-0.5 flex justify-end gap-2 text-[13px]">
                      {g > 0 && r.perBatch > 0 && <span className="text-muted-foreground">= {(g / r.perBatch).toLocaleString("th-TH", { maximumFractionDigits: 1 })} ชุด</span>}
                      {g === 0 && sug > 0 && canEdit && stockReady && (
                        <button type="button" onClick={() => onPlan(r.sku.id, sug)} className="font-semibold text-brand hover:underline">
                          ใส่ {gramsText(sug)}
                        </button>
                      )}
                    </div>
                  </td>
                  <td className={cn("px-3 py-3 text-right font-semibold", toneText[toneAfter])}>{daysText(f.daysAfter)}</td>
                </tr>
              );
            })}
            {shown.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                  ทุกรายการพอใช้ถึงเป้าแล้ว
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {noBom.length > 0 && (
        <p className="text-sm text-muted-foreground">
          {noBom.length} รายการยังไม่มีสูตร (BOM) ·{" "}
          <button type="button" onClick={onSetupBom} className="text-primary hover:underline">
            ไปตั้งสูตร
          </button>
        </p>
      )}

      <div data-tour="prod-save" className="sticky bottom-[calc(64px+env(safe-area-inset-bottom))] z-30 mt-2 md:bottom-4">
        <div className="flex items-center gap-3 rounded-2xl bg-primary py-3 pl-4 pr-3 text-primary-foreground shadow-raised">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-semibold">แผน {planned} รายการ</div>
            {short > 0 && <div className="truncate text-sm text-primary-foreground/70">ยังพอใช้ไม่ถึงเป้า {short} รายการ</div>}
          </div>
          <Button variant="brand" className="h-12 min-w-[120px] text-base" loading={saving} disabled={!canEdit || !dirty} onClick={onSave}>
            {dirty ? "บันทึกแผน" : "บันทึกแล้ว"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Fix a saved record: day, output, note */
export function EditRecordDialog({ r, name, busy, onCancel, onSave }: { r: ProductionRecord; name: string; busy?: boolean; onCancel: () => void; onSave: (day: string, grams: number, notes: string) => void }) {
  const [day, setDay] = useState(r.productionDate);
  const [grams, setGrams] = useState(String(r.actualOutputG));
  const [notes, setNotes] = useState(r.notes ?? "");
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 md:items-center" onClick={onCancel}>
      <div role="dialog" aria-label={`แก้ ${name}`} className="flex w-full flex-col gap-3 rounded-t-2xl bg-card p-4 shadow-raised md:max-w-md md:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold">{name}</h2>
        <label className="flex items-center justify-between gap-3 text-sm">
          วันที่ผลิต
          <Input type="date" max={iso(new Date())} value={day} onChange={(e) => setDay(e.target.value)} className="h-11 w-[180px]" />
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          ผลิตได้ (ก.)
          <Input inputMode="decimal" value={grams} onChange={(e) => setGrams(e.target.value)} className="h-11 w-[180px] text-right font-mono text-base" />
        </label>
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="หมายเหตุ" className="h-11" />
        <div className="flex gap-2 pb-[env(safe-area-inset-bottom)]">
          <Button variant="outline" className="h-12 flex-1" onClick={onCancel}>
            ยกเลิก
          </Button>
          <Button variant="brand" className="h-12 flex-[2]" loading={busy} disabled={busy || parse(grams) <= 0 || !day} onClick={() => onSave(day, parse(grams), notes)}>
            บันทึก
          </Button>
        </div>
      </div>
    </div>
  );
}
