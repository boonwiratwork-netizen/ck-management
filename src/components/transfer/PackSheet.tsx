import { useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, Check, MoreHorizontal, Plus, Undo2, X } from "lucide-react";
import type { SKU } from "@/types/sku";
import type { PendingTRLine, TOLine } from "@/hooks/use-transfer-order";
import { checkBeforeSend, packsOf, type LotLine, type ProdRecord, type SendCheck } from "@/lib/transfer-lines";
import { ActionFooter, FieldBox, NoteField, PackStepper, baht, onEnterNext } from "@/components/receive/parts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { thaiDay } from "@/components/sales/SalesDays";
import { cn } from "@/lib/utils";

export interface PackForm {
  toId: string;
  toNumber: string;
  branchId: string;
  branchName: string;
  deliveryDate: string;
  notes: string;
  trId?: string;
  trNumber?: string;
  requiredDate?: string;
  lines: TOLine[];
  /** Request lines taken off with "ส่งไม่ได้" */
  declined: { line: PendingTRLine; reason: string }[];
  isEditingSent?: boolean;
}

export interface LotsApi {
  stock: Record<string, number>;
  lots: Record<string, LotLine[]>;
  loading: boolean;
  isLotLine: (skuId: string) => boolean;
  visibleFor: (lineId: string, skuId: string) => ProdRecord[];
  setLotPacks: (lineId: string, skuId: string, record: ProdRecord, packs: number) => void;
  fillToPacks: (line: TOLine, packs: number) => void;
}

const num = (n: number) => Math.round(n).toLocaleString("th-TH");
const shortDate = (iso: string) => {
  const d = new Date(iso + "T00:00:00");
  return `${d.getDate()} ${["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."][d.getMonth()]}`;
};
/** Packs mode: the line is counted in packs (pack size above 1), else in its unit */
export const isPackLine = (sku: SKU | undefined) => (sku?.packSize ?? 0) > 1;

export function useSendCheck(form: PackForm, skuOf: (id: string) => SKU | undefined, lots: LotsApi): SendCheck {
  return useMemo(
    () => checkBeforeSend(form.lines, (id) => { const s = skuOf(id); return s ? { type: s.type, packSize: s.packSize } : undefined; }, lots.stock, lots.lots),
    [form.lines, skuOf, lots.stock, lots.lots],
  );
}

/** What the right-hand column and the small text under a name say for one line */
function lineFacts(line: TOLine, sku: SKU | undefined, lots: LotsApi) {
  const ps = sku?.packSize ?? 0;
  const packMode = isPackLine(sku);
  const packs = packsOf(line, ps);
  const stock = lots.stock[line.skuId];
  const over = stock != null && line.actualQty > 0 && line.actualQty > stock;
  const stockText = stock == null ? "" : packMode ? `${num(Math.max(0, Math.floor(stock / ps)))} แพ็ค` : `${num(Math.max(0, stock))} ${line.uom}`;
  const lotLine = lots.isLotLine(line.skuId);
  const lineLots = (lots.lots[line.id] || []).filter((l) => l.packs > 0);
  const assigned = lineLots.reduce((s, l) => s + l.packs, 0);
  const records = lotLine ? lots.visibleFor(line.id, line.skuId) : [];
  return { ps, packMode, packs, over, stockText, lotLine, lineLots, assigned, records };
}

function LotChip({ v, onOpen }: { v: ReturnType<typeof lineFacts>; onOpen: () => void }) {
  if (!v.lotLine || v.packs <= 0) return null;
  if (v.records.length === 0 && v.lineLots.length === 0)
    return <span className="text-sm text-warning">ไม่มีบันทึกการผลิต เลือกล็อตไม่ได้</span>;
  const ok = v.assigned === v.packs;
  const text = v.lineLots.map((l) => `${shortDate(l.productionDate)} ×${l.packs}`).join(" · ") || "ยังไม่ได้เลือกล็อต";
  const gap = v.packs - v.assigned;
  return (
    <button
      type="button"
      data-tour="to-lot"
      onClick={onOpen}
      className={cn(
        "inline-flex min-h-[32px] max-w-full items-center gap-1 self-start rounded-full border px-3 text-left text-[13px] font-semibold",
        ok ? "border-success/30 bg-success-soft text-success" : "border-warning/40 bg-warning-soft text-warning",
      )}
    >
      <span className="truncate">ล็อต {text}</span>
      {ok ? <Check className="h-3.5 w-3.5 shrink-0" /> : <span className="shrink-0">· {gap > 0 ? `ขาด ${gap}` : `เกิน ${-gap}`} แพ็ค</span>}
    </button>
  );
}

/** Weight box under the packs: empty = packs × pack size; type the scale reading when it differs */
function WeightBox({ line, v, onWeight, disabled }: { line: TOLine; v: ReturnType<typeof lineFacts>; onWeight: (g: number) => void; disabled?: boolean }) {
  const standard = v.packs * v.ps;
  const typed = Math.abs(line.actualQty - standard) > 0.5 ? line.actualQty : 0;
  return (
    <FieldBox label="" unit={line.uom}>
      <input
        inputMode="decimal"
        disabled={disabled}
        key={`${line.id}-${line.actualQty}-${v.packs}`}
        defaultValue={typed ? String(typed) : ""}
        placeholder={num(standard)}
        onFocus={(e) => e.target.select()}
        onBlur={(e) => {
          const g = Math.max(0, Number(e.target.value.replace(/,/g, "")) || 0);
          if (g > 0 && Math.abs(g - line.actualQty) > 0.5) onWeight(g);
        }}
        className="h-full w-full min-w-0 bg-transparent px-3 text-right font-mono text-base tabular-nums outline-none placeholder:text-muted-foreground/60"
        aria-label={`น้ำหนักจริง ${line.skuName}`}
      />
    </FieldBox>
  );
}

function QtyBox({ line, onQty, disabled }: { line: TOLine; onQty: (q: number) => void; disabled?: boolean }) {
  return (
    <FieldBox label="" unit={line.uom}>
      <input
        inputMode="decimal"
        disabled={disabled}
        key={`${line.id}-${line.actualQty}`}
        defaultValue={line.actualQty ? String(line.actualQty) : ""}
        placeholder="0"
        onFocus={(e) => e.target.select()}
        onBlur={(e) => {
          const q = Math.max(0, Number(e.target.value.replace(/,/g, "")) || 0);
          if (q !== line.actualQty) onQty(q);
        }}
        className="h-full w-full min-w-0 bg-transparent px-3 text-right font-mono text-base tabular-nums outline-none placeholder:text-muted-foreground/60"
        aria-label={`จำนวนส่ง ${line.skuName}`}
      />
    </FieldBox>
  );
}

function requestedText(line: TOLine, v: ReturnType<typeof lineFacts>) {
  if (!line.trLineId) return "สาขาไม่ได้ขอ · ครัวเพิ่มเอง";
  return v.packMode ? `สาขาขอ ${num(line.plannedQty / v.ps)} แพ็ค` : `สาขาขอ ${num(line.plannedQty)} ${line.uom}`;
}

/** Choose which production lots the packs come from */
export function LotDialog({ line, sku, lots, onClose }: { line: TOLine; sku: SKU | undefined; lots: LotsApi; onClose: () => void }) {
  const v = lineFacts(line, sku, lots);
  const current = lots.lots[line.id] || [];
  const gap = v.packs - v.assigned;
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 md:items-center" onClick={onClose}>
      <div role="dialog" aria-label={`เลือกล็อต ${line.skuName}`} className="flex max-h-[85dvh] w-full flex-col gap-3 rounded-t-2xl bg-card p-4 shadow-raised md:max-w-lg md:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold">{line.skuName}</h2>
            <p className="text-sm text-muted-foreground">หยิบจากล็อตไหน รวมให้ได้ {num(v.packs)} แพ็ค</p>
          </div>
          <button type="button" aria-label="ปิด" onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-xl hover:bg-secondary">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className={cn("rounded-xl px-3 py-2.5 text-sm font-semibold", gap === 0 ? "bg-success-soft text-success" : "bg-warning-soft text-warning")}>
          เลือกแล้ว {num(v.assigned)} / {num(v.packs)} แพ็ค{gap > 0 ? ` · ขาดอีก ${num(gap)}` : gap < 0 ? ` · เกิน ${num(-gap)}` : " · ครบ"}
        </div>
        <ul className="flex flex-col gap-2 overflow-y-auto">
          {v.records.map((r, i) => {
            const packs = current.find((l) => l.productionRecordId === r.id)?.packs ?? 0;
            return (
              <li key={r.id} className="flex items-center gap-3 rounded-2xl border border-border p-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-semibold">ผลิต {thaiDay(r.productionDate)}</div>
                  <div className="text-sm text-muted-foreground">{i === 0 ? "เก่าสุดที่ยังเหลือ · หยิบก่อน" : `${r.batchesProduced} ชุด`}</div>
                </div>
                <PackStepper value={packs} label={`แพ็คจากล็อต ${shortDate(r.productionDate)}`} onChange={(p) => lots.setLotPacks(line.id, line.skuId, r, Math.round(p))} className="w-[128px]" />
              </li>
            );
          })}
        </ul>
        <p className="text-sm text-muted-foreground">โชว์เฉพาะล็อตที่ยังมีของในครัว (ล็อตเก่าที่ส่งหมดแล้วซ่อนไว้)</p>
        <div className="flex gap-2 pb-[env(safe-area-inset-bottom)]">
          <Button variant="outline" className="h-12 flex-1" onClick={onClose}>
            ปิด
          </Button>
          <Button variant="brand" className="h-12 flex-[2]" disabled={gap === 0} onClick={() => lots.fillToPacks(line, v.packs)}>
            {gap >= 0 ? "เติมจากล็อตเก่าสุดให้ครบ" : "ตัดล็อตใหม่สุดออกให้พอดี"}
          </Button>
        </div>
      </div>
    </div>
  );
}

interface SheetProps {
  form: PackForm;
  skuOf: (id: string) => SKU | undefined;
  lots: LotsApi;
  check: SendCheck;
  busy: boolean;
  onPacks: (line: TOLine, packs: number) => void;
  onQty: (line: TOLine, qty: number) => void;
  onWeight: (line: TOLine, grams: number) => void;
  onNote: (line: TOLine, note: string) => void;
  onDecline: (line: TOLine) => void;
  onRestore: (d: PackForm["declined"][number]) => void;
  /** The declined line being put back (its button waits) */
  restoring?: string | null;
  onAdd: () => void;
  onBack: () => void;
  onDiscard: () => void;
  onNext: () => void;
}

/**
 * Packing an order: one line per product, the inputs on the right (ส่งกี่แพ็ค →
 * น้ำหนักจริง, Enter moves on), lots under the name. Saved as typed — no draft
 * button. A table on computers, cards on phones.
 */
export function PackSheet(p: SheetProps) {
  const { form, skuOf, lots, check } = p;
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [lotFor, setLotFor] = useState<TOLine | null>(null);
  const [menu, setMenu] = useState(false);
  const issueIds = new Set([...check.overStock.map((x) => x.lineId), ...check.lotMismatch.map((x) => x.lineId)]);
  const shown = onlyIssues ? form.lines.filter((l) => issueIds.has(l.id)) : form.lines;
  const value = form.lines.reduce((s, l) => s + l.actualQty * l.unitCost, 0);
  const sending = form.lines.filter((l) => l.actualQty > 0).length;
  const asked = form.lines.filter((l) => l.trLineId).length + form.declined.length;
  const edit = form.isEditingSent;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={p.onBack} aria-label="กลับ" className="-ml-2 flex h-11 w-11 items-center justify-center rounded-xl hover:bg-secondary">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-bold">{edit ? `แก้ใบที่ส่งแล้ว · ${form.branchName}` : `จัดของส่ง ${form.branchName}`}</h2>
          <p className="text-sm text-muted-foreground">
            <span className="font-mono">{form.toNumber}</span>
            {form.trNumber && <> · ตามใบขอ <span className="font-mono">{form.trNumber}</span></>}
            {form.requiredDate && <> · ต้องการ {thaiDay(form.requiredDate)}</>}
            {!edit && " · บันทึกให้อัตโนมัติ"}
            <span className="hidden lg:inline"> · กด Enter ไปช่องถัดไป</span>
          </p>
        </div>
        {!edit && (
          <div className="relative">
            <Button variant="outline" className="h-11 w-11 px-0" aria-label="เมนู" onClick={() => setMenu((m) => !m)}>
              <MoreHorizontal className="h-5 w-5" />
            </Button>
            {menu && (
              <div className="absolute right-0 top-12 z-40 w-56 rounded-xl border border-border bg-card p-1 shadow-raised">
                <button type="button" className="flex min-h-[44px] w-full items-center rounded-lg px-3 text-left text-sm text-destructive hover:bg-secondary" onClick={() => { setMenu(false); p.onDiscard(); }}>
                  ทิ้งใบนี้ (ยังไม่ได้ส่ง)
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {edit && (
        <div className="flex items-center gap-2 rounded-xl bg-warning-soft px-4 py-2.5 text-sm font-medium text-warning">
          <AlertTriangle className="h-4 w-4 shrink-0" /> ใบนี้ส่งไปแล้ว แก้แล้วกดบันทึก ตัวเลขจะเปลี่ยนทันที
        </div>
      )}

      {issueIds.size > 0 && (
        <div className="flex gap-1.5">
          <button type="button" aria-pressed={!onlyIssues} onClick={() => setOnlyIssues(false)} className={cn("min-h-[40px] rounded-full border px-4 text-sm", !onlyIssues ? "border-primary bg-primary font-semibold text-primary-foreground" : "border-border bg-card")}>
            ทั้งหมด {form.lines.length}
          </button>
          <button type="button" aria-pressed={onlyIssues} onClick={() => setOnlyIssues(true)} className={cn("min-h-[40px] rounded-full border px-4 text-sm font-semibold", onlyIssues ? "border-primary bg-primary text-primary-foreground" : "border-warning/40 bg-warning-soft text-warning")}>
            ต้องดู {issueIds.size}
          </button>
        </div>
      )}

      {lots.loading && <p className="text-sm text-muted-foreground">กำลังดูสต๊อกและล็อตในครัว…</p>}

      {/* Computer: a table */}
      <div data-tour="to-lines" className="hidden overflow-hidden rounded-2xl border border-border bg-card shadow-card lg:block" onKeyDown={onEnterNext}>
        <table className="w-full table-fixed text-sm">
          <colgroup>
            <col />
            <col style={{ width: "110px" }} />
            <col style={{ width: "150px" }} />
            <col style={{ width: "230px" }} />
            <col style={{ width: "240px" }} />
            <col style={{ width: "104px" }} />
          </colgroup>
          <thead>
            <tr className="bg-secondary/60 text-left text-[13px] text-muted-foreground">
              <th className="px-3 py-2.5 font-medium">สินค้า</th>
              <th className="px-3 py-2.5 text-right font-medium">สาขาขอ</th>
              <th className="px-3 py-2.5 text-right font-medium">ส่งกี่แพ็ค</th>
              <th className="px-3 py-2.5 text-right font-medium">น้ำหนักจริง</th>
              <th className="px-3 py-2.5 font-medium">ล็อตที่หยิบ</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((line) => (
              <DeskRow key={line.id} line={line} sku={skuOf(line.skuId)} lots={lots} edit={!!edit} onLot={() => setLotFor(line)} {...p} />
            ))}
            {!onlyIssues &&
              form.declined.map((d) => (
                <tr key={d.line.id} className="border-t border-border bg-secondary/40">
                  <td className="px-3 py-3">
                    <div className="font-semibold text-muted-foreground line-through">{d.line.skuName}</div>
                    <div className="text-[13px] font-semibold text-destructive">ไม่ส่ง · {d.reason || "ไม่ระบุเหตุผล"}</div>
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-muted-foreground">{num(d.line.requestedQty)} {d.line.uom}</td>
                  <td colSpan={3} className="px-3 py-3 text-sm text-muted-foreground">สาขาจะเห็นเหตุผลนี้ในหน้าขอเบิก</td>
                  <td className="px-3 py-2 text-right">
                    {!edit && (
                      <Button variant="outline" className="h-10" loading={p.restoring === d.line.id} disabled={!!p.restoring} onClick={() => p.onRestore(d)}>
                        <Undo2 className="h-4 w-4" /> ส่งได้แล้ว
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {/* Phone: cards */}
      <ul className="flex flex-col gap-2 lg:hidden" onKeyDown={onEnterNext} data-tour="to-lines">
        {shown.map((line) => (
          <MobileCard key={line.id} line={line} sku={skuOf(line.skuId)} lots={lots} edit={!!edit} onLot={() => setLotFor(line)} {...p} />
        ))}
        {!onlyIssues &&
          form.declined.map((d) => (
            <li key={d.line.id} className="flex items-center gap-3 rounded-2xl border border-border bg-secondary/40 p-3">
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-muted-foreground line-through">{d.line.skuName}</div>
                <div className="text-sm font-semibold text-destructive">ไม่ส่ง · {d.reason || "ไม่ระบุเหตุผล"}</div>
                <div className="text-[13px] text-muted-foreground">สาขาจะเห็นเหตุผลนี้ในหน้าขอเบิก</div>
              </div>
              {!edit && (
                <Button variant="outline" className="h-11" loading={p.restoring === d.line.id} disabled={!!p.restoring} onClick={() => p.onRestore(d)}>
                  ส่งได้แล้ว
                </Button>
              )}
            </li>
          ))}
      </ul>

      {!form.trId && !edit && (
        <Button variant="outline" className="h-12 border-dashed font-semibold" onClick={p.onAdd}>
          <Plus className="h-4 w-4" /> เพิ่มสินค้า
        </Button>
      )}
      {form.trId && !edit && (
        <button type="button" onClick={p.onAdd} className="self-start text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
          + เพิ่มสินค้าที่สาขาไม่ได้ขอ
        </button>
      )}

      <ActionFooter
        tour="to-review"
        title={edit ? `${sending} รายการ · ${baht(value)}` : `ส่ง ${sending}${asked ? ` จาก ${asked}` : ""} รายการ · ${baht(value)}`}
        sub={
          check.lotMismatch.length + check.overStock.length > 0
            ? `ต้องดู ${issueIds.size} รายการ${check.overStock.length ? " · ของในครัวไม่พอ" : ""}${check.lotMismatch.length ? " · ล็อตไม่ครบ" : ""}`
            : edit
              ? "การเปลี่ยนแปลงจะมีผลกับสต๊อกทันที"
              : "ทุกรายการพร้อมส่ง"
        }
        action={edit ? "บันทึกการแก้ไข" : "ตรวจแล้วส่ง"}
        busy={p.busy}
        disabled={sending === 0}
        onAction={p.onNext}
      />

      {lotFor && <LotDialog line={form.lines.find((l) => l.id === lotFor.id) ?? lotFor} sku={skuOf(lotFor.skuId)} lots={lots} onClose={() => setLotFor(null)} />}
    </div>
  );
}

type RowProps = SheetProps & { line: TOLine; sku: SKU | undefined; edit: boolean; onLot: () => void };

function DeskRow({ line, sku, lots, edit, onLot, onPacks, onQty, onWeight, onNote, onDecline }: RowProps) {
  const v = lineFacts(line, sku, lots);
  return (
    <tr id={`to-line-${line.id}`} className={cn("border-t border-border align-top", v.over && "bg-warning-soft/40")}>
      <td className="px-3 py-3">
        <div className="font-semibold leading-snug">{line.skuName}</div>
        <div className="text-[13px] text-muted-foreground">
          {v.packMode ? `1 แพ็ค = ${num(v.ps)} ${line.uom}` : sku?.type === "PK" ? "บรรจุภัณฑ์" : sku?.type === "RM" ? "วัตถุดิบ" : ""}
          {v.over && <span className="font-semibold text-warning"> · ในครัวเหลือ {v.stockText}</span>}
        </div>
        <div className="mt-1 max-w-[260px]">
          <NoteField value={line.note} onChange={(n) => n !== line.note && onNote(line, n)} />
        </div>
      </td>
      <td className="px-3 py-3 text-right font-mono text-muted-foreground">{line.trLineId ? requestedText(line, v).replace("สาขาขอ ", "") : "—"}</td>
      <td className="px-3 py-2">
        {v.packMode ? (
          <PackStepper value={v.packs} label={`แพ็ค ${line.skuName}`} onChange={(n) => onPacks(line, Math.round(n))} className={cn("ml-auto w-[128px]", v.over && "border-warning")} />
        ) : (
          <QtyBox line={line} onQty={(q) => onQty(line, q)} />
        )}
      </td>
      <td className="px-3 py-2">{v.packMode ? <WeightBox line={line} v={v} onWeight={(g) => onWeight(line, g)} /> : <span className="block py-2.5 text-right text-muted-foreground">—</span>}</td>
      <td className="px-3 py-3">{v.lotLine ? <LotChip v={v} onOpen={onLot} /> : <span className="text-[13px] text-muted-foreground">ไม่มีล็อต</span>}</td>
      <td className="px-3 py-2 text-right">
        {!edit && (
          <Button variant="ghost" className="h-10 px-3 text-muted-foreground hover:text-destructive" onClick={() => onDecline(line)}>
            ส่งไม่ได้
          </Button>
        )}
      </td>
    </tr>
  );
}

function MobileCard({ line, sku, lots, edit, onLot, onPacks, onQty, onWeight, onNote, onDecline }: RowProps) {
  const v = lineFacts(line, sku, lots);
  return (
    <li id={`to-line-m-${line.id}`} className={cn("flex gap-3 rounded-2xl border bg-card p-3 shadow-card", v.over ? "border-brand" : "border-border")}>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="text-[15px] font-semibold leading-snug">{line.skuName}</div>
        <div className="text-sm text-muted-foreground">{requestedText(line, v)}</div>
        {v.over && <div className="text-sm font-semibold text-warning">ในครัวเหลือ {v.stockText}</div>}
        {v.packMode && <div className="text-[13px] text-muted-foreground">1 แพ็ค = {num(v.ps)} {line.uom}</div>}
        {v.lotLine && <LotChip v={v} onOpen={onLot} />}
        <div className="flex flex-wrap items-center gap-x-3">
          <NoteField value={line.note} onChange={(n) => n !== line.note && onNote(line, n)} />
          {!edit && (
            <button type="button" onClick={() => onDecline(line)} className="min-h-[36px] text-sm text-muted-foreground hover:text-destructive">
              ส่งไม่ได้
            </button>
          )}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        {v.packMode ? (
          <>
            <span className="text-[13px] text-muted-foreground">ส่งกี่แพ็ค</span>
            <PackStepper value={v.packs} label={`แพ็ค ${line.skuName}`} onChange={(n) => onPacks(line, Math.round(n))} className={cn("w-[128px]", v.over && "border-brand")} />
            <WeightBoxStacked line={line} v={v} onWeight={(g) => onWeight(line, g)} />
          </>
        ) : (
          <QtyBoxStacked line={line} onQty={(q) => onQty(line, q)} />
        )}
      </div>
    </li>
  );
}

/** Phone layout: the label sits above the box so the column stays 128px wide */
function WeightBoxStacked({ line, v, onWeight }: { line: TOLine; v: ReturnType<typeof lineFacts>; onWeight: (g: number) => void }) {
  const standard = v.packs * v.ps;
  const typed = Math.abs(line.actualQty - standard) > 0.5 ? line.actualQty : 0;
  return (
    <label className="flex flex-col items-end gap-1 text-[13px] text-muted-foreground">
      น้ำหนักจริง ({line.uom})
      <Input
        inputMode="decimal"
        key={`${line.id}-${line.actualQty}-${v.packs}`}
        defaultValue={typed ? String(typed) : ""}
        placeholder={num(standard)}
        onFocus={(e) => e.target.select()}
        onBlur={(e) => {
          const g = Math.max(0, Number(e.target.value.replace(/,/g, "")) || 0);
          if (g > 0 && Math.abs(g - line.actualQty) > 0.5) onWeight(g);
        }}
        className="h-11 w-[128px] text-right font-mono text-base"
        aria-label={`น้ำหนักจริง ${line.skuName}`}
      />
    </label>
  );
}

function QtyBoxStacked({ line, onQty }: { line: TOLine; onQty: (q: number) => void }) {
  return (
    <label className="flex flex-col items-end gap-1 text-[13px] text-muted-foreground">
      ส่ง ({line.uom})
      <Input
        inputMode="decimal"
        key={`${line.id}-${line.actualQty}`}
        defaultValue={line.actualQty ? String(line.actualQty) : ""}
        placeholder="0"
        onFocus={(e) => e.target.select()}
        onBlur={(e) => {
          const q = Math.max(0, Number(e.target.value.replace(/,/g, "")) || 0);
          if (q !== line.actualQty) onQty(q);
        }}
        className="h-11 w-[128px] text-right font-mono text-base"
        aria-label={`จำนวนส่ง ${line.skuName}`}
      />
    </label>
  );
}

/** "ส่งไม่ได้": pick a reason the branch will see */
export function DeclineDialog({ line, onCancel, onConfirm }: { line: TOLine; onCancel: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  const chips = ["ของหมด", "ผลิตไม่ทัน", "ของไม่ผ่าน QC"];
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 md:items-center" onClick={onCancel}>
      <div role="dialog" aria-label={`ส่งไม่ได้ ${line.skuName}`} className="flex w-full flex-col gap-3 rounded-t-2xl bg-card p-4 shadow-raised md:max-w-md md:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold">ส่ง {line.skuName} ไม่ได้</h2>
        <p className="text-sm text-muted-foreground">{line.trLineId ? "เลือกเหตุผล สาขาจะเห็นในหน้าขอเบิก" : "เอารายการนี้ออกจากใบ"}</p>
        {line.trLineId && (
          <>
            <div className="flex flex-wrap gap-2">
              {chips.map((c) => (
                <button key={c} type="button" aria-pressed={reason === c} onClick={() => setReason(c)} className={cn("min-h-[44px] rounded-full border px-4 text-sm", reason === c ? "border-primary bg-primary font-semibold text-primary-foreground" : "border-border bg-card")}>
                  {c}
                </button>
              ))}
            </div>
            <Input value={chips.includes(reason) ? "" : reason} onChange={(e) => setReason(e.target.value)} placeholder="หรือพิมพ์เหตุผลอื่น" className="h-11" />
          </>
        )}
        <div className="flex gap-2 pb-[env(safe-area-inset-bottom)]">
          <Button variant="outline" className="h-12 flex-1" onClick={onCancel}>
            ยกเลิก
          </Button>
          <Button variant="destructive" className="h-12 flex-[2]" disabled={!!line.trLineId && !reason.trim()} onClick={() => onConfirm(reason.trim())}>
            ไม่ส่งรายการนี้
          </Button>
        </div>
      </div>
    </div>
  );
}
