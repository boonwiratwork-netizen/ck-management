import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, Search, X } from "lucide-react";
import type { SKU } from "@/types/sku";
import type { Price } from "@/types/price";
import type { GoodsReceipt } from "@/types/goods-receipt";
import { checksFor, frequentFor, lineTotal, perUnitText, qtyText, type DraftLine } from "@/lib/goods-receipt";
import { NoteField, SkuPicker, baht, onEnterNext } from "@/components/receive/parts";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { thaiDay } from "@/components/sales/SalesDays";
import { cn } from "@/lib/utils";

export const FREE_PLACE = "ของเคลม / ของแถม";

export interface Row {
  key: string;
  skuId: string;
  qty: number;
  /** Amount on the bill; null = not typed (the standard is used) */
  total: number | null;
  note: string;
}

export interface SavedBill {
  rows: (Row & { stdUnit: number; supplierId: string })[];
  place: string;
  /** The typed place is a supplier's name: lines go under it, no place in the note */
  named: boolean;
}

interface Props {
  date: string;
  /** null = "ซื้อที่อื่น" (market, online, claimed items) */
  supplierId: string | null;
  supplierName: string;
  skus: SKU[];
  prices: Price[];
  /** Every supplier, active or not (a typed place is matched against all, as before) */
  suppliers: { id: string; name: string }[];
  receipts: GoodsReceipt[];
  busy: boolean;
  onBack: () => void;
  /** Resolves true once saved */
  onSave: (bill: SavedBill) => Promise<boolean>;
}

const SHOW_FIRST = 12;
const draftKey = (date: string, supplierId: string | null) => `ck-gr-draft:${date}:${supplierId ?? "other"}`;
/** A draft older than this is dropped (it may already have been typed in another way) */
const DRAFT_DAYS = 2;
interface Draft {
  rows: Row[];
  place?: string;
  billTotal?: number | null;
  savedAt?: number;
}
function readDraft(date: string, supplierId: string | null): Draft | null {
  try {
    const d: Draft | null = JSON.parse(localStorage.getItem(draftKey(date, supplierId)) || "null");
    if (!d?.rows || (d.savedAt && Date.now() - d.savedAt > DRAFT_DAYS * 86400000)) return null;
    return d;
  } catch {
    return null;
  }
}
const parse = (raw: string) => Math.max(0, Number(raw.replace(/,/g, "")) || 0);

/**
 * One supplier bill: the products bought from this supplier most often first,
 * the quantity received and the bill's amount on the right (Enter moves on), a
 * check against the bill's total, then a short review before saving. What's typed
 * is kept on this device until saved, so a refresh loses nothing.
 */
export function BillEntry({ date, supplierId, supplierName, skus, prices, suppliers, receipts, busy, onBack, onSave }: Props) {
  const skuOf = useMemo(() => new Map(skus.map((s) => [s.id, s])), [skus]);
  const activeFor = useMemo(() => {
    const m = new Map<string, Price>();
    for (const p of prices) if (p.isActive && !m.has(`${p.skuId}|${p.supplierId}`)) m.set(`${p.skuId}|${p.supplierId}`, p);
    return m;
  }, [prices]);
  const anyActive = useMemo(() => {
    const m = new Map<string, Price>();
    for (const p of prices) if (p.isActive && !m.has(p.skuId)) m.set(p.skuId, p);
    return m;
  }, [prices]);
  const other = supplierId == null;

  const [draft] = useState(() => readDraft(date, supplierId));
  const [place, setPlace] = useState(draft?.place ?? "");
  // The supplier a line is saved under: the bill's, or in "ซื้อที่อื่น" a supplier
  // whose name was typed, else the product's usual supplier (as the old page did)
  const placeSupplier = suppliers.find((s) => s.name.trim().toLowerCase() === place.trim().toLowerCase());
  const supplierFor = (skuId: string) => supplierId ?? placeSupplier?.id ?? anyActive.get(skuId)?.supplierId ?? "";
  const stdFor = (skuId: string) => activeFor.get(`${skuId}|${supplierFor(skuId)}`)?.pricePerUsageUom ?? 0;

  const frequent = useMemo(() => (supplierId ? frequentFor(receipts, supplierId).filter((f) => ["RM", "PK"].includes(skuOf.get(f.skuId)?.type ?? "")) : []), [receipts, supplierId, skuOf]);
  const lastBuy = useMemo(() => new Map(frequent.map((f) => [f.skuId, f.last])), [frequent]);

  const [rows, setRows] = useState<Row[]>(() => draft?.rows ?? frequent.map((f) => ({ key: f.skuId, skuId: f.skuId, qty: 0, total: null, note: "" })));
  // Receipts may still be loading when the bill opens (refresh): fill the list once they come
  useEffect(() => {
    if (!draft && frequent.length && rows.length === 0) setRows(frequent.map((f) => ({ key: f.skuId, skuId: f.skuId, qty: 0, total: null, note: "" })));
  }, [frequent]); // eslint-disable-line react-hooks/exhaustive-deps
  const [showAll, setShowAll] = useState(false);
  const [billTotal, setBillTotal] = useState<number | null>(draft?.billTotal ?? null);
  const [picking, setPicking] = useState(false);
  const [step, setStep] = useState<"enter" | "review">("enter");
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    try {
      if (rows.some((r) => r.qty > 0)) localStorage.setItem(draftKey(date, supplierId), JSON.stringify({ rows, place, billTotal, savedAt: Date.now() } satisfies Draft));
      else localStorage.removeItem(draftKey(date, supplierId));
    } catch {
      // storage blocked: kept until the page closes
    }
  }, [rows, place, billTotal, date, supplierId]);
  const set = (key: string, patch: Partial<Row>) => setRows((p) => p.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const filled = rows.filter((r) => r.qty > 0);
  const total = filled.reduce((s, r) => s + lineTotal(r.total, stdFor(r.skuId), r.qty), 0);
  const standard = filled.reduce((s, r) => s + stdFor(r.skuId) * r.qty, 0);
  const diff = total - standard;
  const matches = billTotal != null && Math.abs(billTotal - total) < 1;

  // Show the products typed into, then the most bought, the rest on request
  const shown = showAll || other ? rows : rows.filter((r, i) => i < SHOW_FIRST || r.qty > 0 || !lastBuy.has(r.skuId));
  const hidden = rows.length - shown.length;

  const pickable = useMemo(() => {
    const on = new Set(rows.map((r) => r.skuId));
    // In use only: drafts (still being set up in Cost Center) and switched-off items stay out
    const rm = skus.filter((s) => (s.type === "RM" || s.type === "PK") && s.status === "Active" && !on.has(s.id) && (other ? anyActive.has(s.id) : true));
    // This supplier's own products first
    return supplierId ? [...rm.filter((s) => activeFor.has(`${s.id}|${supplierId}`)), ...rm.filter((s) => !activeFor.has(`${s.id}|${supplierId}`))] : rm;
  }, [skus, rows, other, anyActive, activeFor, supplierId]);

  const draftLines: DraftLine[] = filled.map((r) => ({ key: r.key, skuId: r.skuId, name: skuOf.get(r.skuId)?.name ?? "", qty: r.qty, total: r.total, stdUnit: stdFor(r.skuId) }));
  const uomOf = (skuId: string) => skuOf.get(skuId)?.purchaseUom || skuOf.get(skuId)?.usageUom || "";
  const sameDay = receipts.filter((x) => x.receiptDate === date && (supplierId ? x.supplierId === supplierId : true));
  const checks = checksFor(
    draftLines,
    sameDay,
    (id, p) => perUnitText(p, uomOf(id)),
    (id, q) => qtyText(q, uomOf(id)),
  ).filter((c) => !(other && place === FREE_PLACE && c.kind === "nototal"));

  // A product with no usual supplier can't be saved from "ซื้อที่อื่น" (as before)
  const noSupplier = filled.filter((r) => !supplierFor(r.skuId));
  const save = () =>
    onSave({
      named: !!placeSupplier,
      place: other ? place.trim() : "",
      rows: filled.map((r) => ({ ...r, total: other && place === FREE_PLACE ? 0 : r.total, stdUnit: stdFor(r.skuId), supplierId: supplierFor(r.skuId) })),
    });
  const clearDraft = () => {
    try {
      localStorage.removeItem(draftKey(date, supplierId));
    } catch {
      // fine
    }
  };

  const title = other ? "ซื้อที่อื่น" : `บิล ${supplierName}`;
  const recentPlaces = useMemo(() => {
    const seen = new Set<string>();
    for (const r of receipts) {
      const m = /^\[Supplier: ([^\]]*)\]/.exec(r.note || "");
      if (m && m[1].trim()) seen.add(m[1].trim());
      if (seen.size >= 4) break;
    }
    return [...seen];
  }, [receipts]);

  if (step === "review")
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <button type="button" aria-label="กลับ" onClick={() => setStep("enter")} className="-ml-2 flex h-11 w-11 items-center justify-center rounded-xl hover:bg-secondary">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h2 className="text-xl font-bold">ตรวจก่อนบันทึก</h2>
            <p className="text-sm text-muted-foreground">
              {other ? place || "ซื้อที่อื่น" : supplierName} · {thaiDay(date)}
            </p>
          </div>
        </div>
        {checks.length > 0 && (
          <section className="rounded-2xl border border-border border-l-4 border-l-brand bg-card p-3 shadow-card">
            <h3 className="mb-1 text-[15px] font-bold">เช็คอีกที {checks.length} รายการ</h3>
            {checks.map((c) => (
              <div key={`${c.key}-${c.kind}`} className="border-b border-border py-1.5 last:border-0">
                <div className="text-sm font-semibold">
                  {c.name} · {c.label}
                </div>
                <div className="text-[13px] text-warning">{c.detail}</div>
              </div>
            ))}
          </section>
        )}
        <section className="rounded-2xl border border-border bg-card p-3 text-sm shadow-card">
          <div className="flex justify-between py-0.5">
            <span>รวมในบิล</span>
            <span className="font-mono">{baht(other && place === FREE_PLACE ? 0 : total)}</span>
          </div>
          {!(other && place === FREE_PLACE) && (
            <>
              <div className="flex justify-between py-0.5">
                <span>ราคามาตรฐาน</span>
                <span className="font-mono">{baht(standard)}</span>
              </div>
              {Math.abs(diff) >= 1 && (
                <div className={cn("flex justify-between py-0.5 font-semibold", diff > 0 ? "text-destructive" : "text-success")}>
                  <span>{diff > 0 ? "แพงกว่ามาตรฐาน" : "ถูกกว่ามาตรฐาน"}</span>
                  <span className="font-mono">{baht(Math.abs(diff))}</span>
                </div>
              )}
              {billTotal != null && (
                <div className={cn("flex justify-between py-0.5 font-semibold", matches ? "text-success" : "text-destructive")}>
                  <span>{matches ? "ตรงกับยอดท้ายบิล" : `ยอดท้ายบิล ${baht(billTotal)}`}</span>
                  <span>{matches ? <Check className="h-4 w-4" /> : `ต่าง ${baht(Math.abs(billTotal - total))}`}</span>
                </div>
              )}
            </>
          )}
        </section>
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card text-sm shadow-card">
          {filled.map((r) => (
            <li key={r.key} className="flex justify-between gap-3 px-3 py-2">
              <span className="min-w-0 truncate">{skuOf.get(r.skuId)?.name}</span>
              <span className="shrink-0 font-mono">
                {qtyText(r.qty, uomOf(r.skuId))} · {baht(other && place === FREE_PLACE ? 0 : lineTotal(r.total, stdFor(r.skuId), r.qty))}
              </span>
            </li>
          ))}
        </ul>
        <Footer
          tour="gr-confirm"
          title={`${filled.length} รายการ · ${baht(other && place === FREE_PLACE ? 0 : total)}`}
          action="บันทึกบิล"
          busy={busy}
          onAction={async () => {
            if (await save()) clearDraft();
          }}
        />
      </div>
    );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" aria-label="กลับ" onClick={() => (filled.length ? setLeaving(true) : onBack())} className="-ml-2 flex h-11 w-11 items-center justify-center rounded-xl hover:bg-secondary">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h2 className="mr-auto text-xl font-bold">
          {title} · <span className="font-normal">{thaiDay(date)}</span>
        </h2>
        <Button variant="outline" className="h-11 min-w-[200px] justify-start text-muted-foreground" onClick={() => setPicking(true)}>
          <Search className="h-4 w-4" /> ค้นสินค้า
        </Button>
      </div>

      {other && (
        <section className="flex flex-col gap-2">
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            ซื้อจากไหน
            <Input value={place} onChange={(e) => setPlace(e.target.value)} placeholder="เช่น ตลาดคลองเตย" className="h-11 font-normal" data-noflow="" />
          </label>
          <div className="flex flex-wrap gap-1.5">
            {[...recentPlaces.filter((p) => p !== FREE_PLACE), FREE_PLACE].map((p) => (
              <button key={p} type="button" aria-pressed={place === p} onClick={() => setPlace(p)} className={cn("min-h-[40px] rounded-full border px-4 text-sm", place === p ? "border-primary bg-primary font-semibold text-primary-foreground" : "border-border bg-card")}>
                {p}
              </button>
            ))}
          </div>
        </section>
      )}

      {!other && <h3 className="text-[13px] font-bold">ที่ซื้อบ่อย</h3>}
      {rows.length === 0 && (
        <button type="button" onClick={() => setPicking(true)} className="rounded-2xl border border-dashed border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground hover:bg-secondary/50">
          + เพิ่มสินค้า
        </button>
      )}

      {/* Computer */}
      {rows.length > 0 && (
        <div data-tour="gr-lines" className="hidden overflow-hidden rounded-2xl border border-border bg-card shadow-card lg:block" onKeyDown={onEnterNext}>
          <table className="w-full table-fixed text-sm">
            <colgroup>
              <col />
              <col style={{ width: "130px" }} />
              <col style={{ width: "170px" }} />
              <col style={{ width: "170px" }} />
              <col style={{ width: "140px" }} />
              <col style={{ width: "48px" }} />
            </colgroup>
            <thead>
              <tr className="bg-secondary/60 text-left text-[13px] text-muted-foreground">
                <th className="px-3 py-2.5 font-medium">สินค้า</th>
                <th className="px-3 py-2.5 text-right font-medium">มาตรฐาน</th>
                <th className="px-3 py-2.5 text-right font-medium">รับจริง</th>
                <th className="px-3 py-2.5 text-right font-medium">ยอดเงินในบิล</th>
                <th className="px-3 py-2.5 text-right font-medium">เทียบมาตรฐาน</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <DeskRow key={r.key} r={r} sku={skuOf.get(r.skuId)} std={stdFor(r.skuId)} last={lastBuy.get(r.skuId)} free={other && place === FREE_PLACE} canRemove={other || !lastBuy.has(r.skuId)} set={set} onRemove={() => setRows((p) => p.filter((x) => x.key !== r.key))} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Phone */}
      <ul className="flex flex-col gap-2 lg:hidden" onKeyDown={onEnterNext} data-tour="gr-lines">
        {shown.map((r) => (
          <MobileCard key={r.key} r={r} sku={skuOf.get(r.skuId)} std={stdFor(r.skuId)} last={lastBuy.get(r.skuId)} free={other && place === FREE_PLACE} canRemove={other || !lastBuy.has(r.skuId)} set={set} onRemove={() => setRows((p) => p.filter((x) => x.key !== r.key))} />
        ))}
      </ul>

      {hidden > 0 && (
        <button type="button" onClick={() => setShowAll(true)} className="self-start text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
          + อีก {hidden} รายการ
        </button>
      )}
      {rows.length > 0 && (
        <button type="button" onClick={() => setPicking(true)} className="self-start text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
          + เพิ่มสินค้า
        </button>
      )}

      <div data-tour="gr-save" className="sticky bottom-[calc(64px+env(safe-area-inset-bottom))] z-30 mt-2 md:bottom-4">
        <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-primary py-3 pl-4 pr-3 text-primary-foreground shadow-raised">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-semibold">
              {filled.length} รายการ · {baht(other && place === FREE_PLACE ? 0 : total)}
            </div>
            {!(other && place === FREE_PLACE) && Math.abs(diff) >= 1 && <div className="truncate text-sm text-primary-foreground/70">{diff > 0 ? `+${baht(diff)}` : `−${baht(-diff)}`} จากมาตรฐาน</div>}
          </div>
          {!(other && place === FREE_PLACE) && (
            <label className="hidden items-center gap-2 text-sm text-primary-foreground/70 sm:flex">
              ยอดท้ายบิล
              <input
                inputMode="decimal"
                data-tour="gr-total"
                defaultValue={billTotal ?? ""}
                onBlur={(e) => setBillTotal(e.target.value.trim() ? parse(e.target.value) : null)}
                className="h-11 w-[120px] rounded-xl bg-primary-foreground/10 px-3 text-right font-mono text-base text-primary-foreground outline-none placeholder:text-primary-foreground/40 focus:ring-2 focus:ring-brand"
                placeholder="ไม่บังคับ"
                aria-label="ยอดรวมท้ายบิล"
              />
              {billTotal != null && (matches ? <Check className="h-4 w-4 text-success" /> : <X className="h-4 w-4 text-brand" />)}
            </label>
          )}
          {noSupplier.length > 0 && <div className="w-full text-sm text-brand">ไม่มีเจ้าประจำ: {noSupplier.map((r) => skuOf.get(r.skuId)?.name).join(", ")} · พิมพ์ชื่อเจ้าในช่อง “ซื้อจากไหน”</div>}
          <Button variant="brand" className="h-12 min-w-[120px] text-base" disabled={filled.length === 0 || (other && !place.trim()) || noSupplier.length > 0} onClick={() => setStep("review")}>
            บันทึกบิล
          </Button>
        </div>
      </div>

      <SkuPicker
        open={picking}
        title={other ? "เพิ่มสินค้า" : `เพิ่มสินค้าในบิล ${supplierName}`}
        skus={pickable}
        onPick={(s) => {
          setPicking(false);
          setRows((p) => [...p, { key: `${s.id}-${Date.now()}`, skuId: s.id, qty: 0, total: null, note: "" }]);
          setShowAll(true);
          setTimeout(() => {
            const inputs = [...document.querySelectorAll<HTMLInputElement>(`[data-row="${s.id}"] input`)].filter((el) => el.getBoundingClientRect().height > 0);
            inputs[0]?.focus();
          }, 50);
        }}
        onClose={() => setPicking(false)}
      />
      <ConfirmDialog
        open={leaving}
        onOpenChange={setLeaving}
        title="ยังไม่ได้บันทึกบิลนี้"
        description="ที่ใส่ไว้ยังเก็บในเครื่องนี้ กลับมาเลือกเจ้านี้อีกครั้งจะเห็นต่อ"
        confirmLabel="ออกไปก่อน"
        cancelLabel="อยู่ต่อ"
        onConfirm={() => {
          setLeaving(false);
          onBack();
        }}
      />
    </div>
  );
}

function Footer({ title, action, busy, onAction, tour }: { title: string; action: string; busy: boolean; onAction: () => void; tour?: string }) {
  return (
    <div data-tour={tour} className="sticky bottom-[calc(64px+env(safe-area-inset-bottom))] z-30 mt-2 md:bottom-4">
      <div className="flex items-center gap-3 rounded-2xl bg-primary py-3 pl-4 pr-3 text-primary-foreground shadow-raised">
        <div className="min-w-0 flex-1 truncate text-[15px] font-semibold">{title}</div>
        <Button variant="brand" className="h-12 min-w-[120px] text-base" loading={busy} onClick={onAction}>
          {action}
        </Button>
      </div>
    </div>
  );
}

interface RowProps {
  r: Row;
  sku: SKU | undefined;
  std: number;
  last?: { qty: number; total: number };
  free: boolean;
  canRemove: boolean;
  set: (key: string, patch: Partial<Row>) => void;
  onRemove: () => void;
}

function rowFacts({ r, sku, std, last }: RowProps) {
  const uom = sku?.purchaseUom || sku?.usageUom || "";
  const shown = r.qty > 0 ? lineTotal(r.total, std, r.qty) : 0;
  const diff = r.qty > 0 && r.total != null ? r.total - std * r.qty : 0;
  const pct = std * r.qty > 0 ? Math.round((diff / (std * r.qty)) * 100) : 0;
  const lastText = last ? `ครั้งก่อน ${qtyText(last.qty, uom)} · ${baht(last.total)}` : "";
  return { uom, shown, diff, pct, lastText };
}

function QtyInput({ r, uom, set, name }: { r: Row; uom: string; set: RowProps["set"]; name: string }) {
  return (
    <span className="flex h-11 w-full items-center overflow-hidden rounded-xl border border-input bg-background focus-within:ring-2 focus-within:ring-ring">
      <input
        inputMode="decimal"
        key={`q-${r.key}-${r.qty}`}
        defaultValue={r.qty || ""}
        placeholder="0"
        onFocus={(e) => e.target.select()}
        onBlur={(e) => {
          const v = parse(e.target.value);
          if (v !== r.qty) set(r.key, { qty: v });
        }}
        className="h-full w-full min-w-0 bg-transparent px-3 text-right font-mono text-base tabular-nums outline-none placeholder:text-muted-foreground/60"
        aria-label={`รับจริง ${name}`}
      />
      <span className="shrink-0 pr-3 text-sm text-muted-foreground">{uom}</span>
    </span>
  );
}

function TotalInput({ r, std, free, set, name }: { r: Row; std: number; free: boolean; set: RowProps["set"]; name: string }) {
  return (
    <span className={cn("flex h-11 w-full items-center overflow-hidden rounded-xl border border-input bg-background focus-within:ring-2 focus-within:ring-ring", free && "opacity-60")}>
      <span className="shrink-0 pl-3 text-sm text-muted-foreground">฿</span>
      <input
        inputMode="decimal"
        disabled={free}
        key={`t-${r.key}-${r.total}-${r.qty}`}
        defaultValue={free ? "0" : r.total ?? ""}
        placeholder={r.qty > 0 && std > 0 ? (std * r.qty).toLocaleString("th-TH", { maximumFractionDigits: 0 }) : "—"}
        onFocus={(e) => e.target.select()}
        onBlur={(e) => {
          const raw = e.target.value.trim();
          const v = raw ? parse(raw) : null;
          if (v !== r.total) set(r.key, { total: v });
        }}
        className="h-full w-full min-w-0 bg-transparent px-2 text-right font-mono text-base tabular-nums outline-none placeholder:text-muted-foreground/60"
        aria-label={`ยอดเงินในบิล ${name}`}
      />
    </span>
  );
}

function DiffText({ diff, pct, free }: { diff: number; pct: number; free: boolean }) {
  if (free) return <span className="text-[13px] font-semibold text-success">ไม่มีค่าใช้จ่าย</span>;
  if (Math.abs(diff) < 1) return null;
  return (
    <span className={cn("font-semibold", diff > 0 ? "text-destructive" : "text-success", Math.abs(pct) > 20 && "font-bold")}>
      {diff > 0 ? "+" : "−"}
      {baht(Math.abs(diff))} ({Math.abs(pct)}%)
    </span>
  );
}

function DeskRow(p: RowProps) {
  const { r, sku, std, free, set, canRemove, onRemove } = p;
  const f = rowFacts(p);
  const name = sku?.name ?? "";
  return (
    <tr data-row={r.skuId} className={cn("border-t border-border align-top", r.qty > 0 && "bg-success-soft/40")}>
      <td className="px-3 py-2.5">
        <div className="font-semibold leading-snug">{name}</div>
        {f.lastText && <div className="text-[13px] text-muted-foreground">{f.lastText}</div>}
        <div className="max-w-[260px]">
          <NoteField value={r.note} onChange={(n) => set(r.key, { note: n })} />
        </div>
      </td>
      <td className="px-3 py-3 text-right font-mono text-[13px] text-muted-foreground">{std > 0 ? perUnitText(std, f.uom) : "—"}</td>
      <td className="px-3 py-2">
        <QtyInput r={r} uom={f.uom} set={set} name={name} />
      </td>
      <td className="px-3 py-2">
        <TotalInput r={r} std={std} free={free} set={set} name={name} />
      </td>
      <td className="px-3 py-3 text-right">
        <DiffText diff={f.diff} pct={f.pct} free={free && r.qty > 0} />
      </td>
      <td className="px-1 py-2">
        {canRemove && (
          <button type="button" aria-label={`เอา ${name} ออก`} onClick={onRemove} className="flex h-11 w-10 items-center justify-center rounded-xl text-muted-foreground hover:text-destructive">
            <X className="h-4 w-4" />
          </button>
        )}
      </td>
    </tr>
  );
}

function MobileCard(p: RowProps) {
  const { r, sku, std, free, set, canRemove, onRemove } = p;
  const f = rowFacts(p);
  const name = sku?.name ?? "";
  return (
    <li data-row={r.skuId} className={cn("flex gap-3 rounded-2xl border bg-card p-3 shadow-card", r.qty > 0 ? "border-success/40" : "border-border")}>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="text-[15px] font-semibold leading-snug">{name}</div>
        <div className="text-[13px] text-muted-foreground">{std > 0 ? `มาตรฐาน ${perUnitText(std, f.uom)}` : "ไม่มีราคามาตรฐาน"}</div>
        {f.lastText && <div className="text-[13px] text-muted-foreground">{f.lastText}</div>}
        <div className="text-sm">
          <DiffText diff={f.diff} pct={f.pct} free={free && r.qty > 0} />
        </div>
        <div className="flex items-center gap-3">
          <NoteField value={r.note} onChange={(n) => set(r.key, { note: n })} />
          {canRemove && (
            <button type="button" onClick={onRemove} className="min-h-[36px] text-sm text-muted-foreground hover:text-destructive">
              เอาออก
            </button>
          )}
        </div>
      </div>
      <div className="flex w-[136px] shrink-0 flex-col items-end gap-1">
        <span className="text-[13px] text-muted-foreground">รับจริง</span>
        <QtyInput r={r} uom={f.uom} set={set} name={name} />
        <span className="text-[13px] text-muted-foreground">ยอดเงินในบิล</span>
        <TotalInput r={r} std={std} free={free} set={set} name={name} />
      </div>
    </li>
  );
}

