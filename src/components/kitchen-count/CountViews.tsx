import { useMemo, useState } from "react";
import { ArrowLeft, MoreHorizontal, Printer, RefreshCw, Search } from "lucide-react";
import type { SKU } from "@/types/sku";
import type { StockCountLine, StockCountSession } from "@/types/stock-count";
import { NoteField, baht, onEnterNext } from "@/components/receive/parts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { thaiDay } from "@/components/sales/SalesDays";
import { cn, toLocalDateStr } from "@/lib/utils";
import type { CountDayEvent, CountTiming } from "@/lib/count-anchor";

export type CountType = "SM" | "RM" | "PK";
export const TYPES: CountType[] = ["SM", "RM", "PK"];
export const STORAGES = [
  { key: "Frozen", label: "แช่แข็ง" },
  { key: "Chilled", label: "ตู้เย็น" },
  { key: "Ambient", label: "ของแห้ง" },
];
const storageRank = (s: string) => {
  const i = STORAGES.findIndex((x) => x.key === s);
  return i < 0 ? 9 : i;
};
/** Same order as the printed sheet: storage, then code */
export const sheetOrder = (skuOf: (id: string) => SKU | undefined) => (a: StockCountLine, b: StockCountLine) => {
  const sa = skuOf(a.skuId);
  const sb = skuOf(b.skuId);
  return storageRank(sa?.storageCondition ?? "") - storageRank(sb?.storageCondition ?? "") || (sa?.skuId ?? "").localeCompare(sb?.skuId ?? "");
};

/** Off by more than 20% (or counted where the system had none) */
export function isBigDiff(l: StockCountLine): boolean {
  if (l.physicalQty === null || Math.abs(l.variance) < 0.5) return false;
  if (l.systemQty <= 0) return l.physicalQty > 0;
  return Math.abs(l.variance) / l.systemQty > 0.2;
}

const qty = (v: number, uom: string) => {
  const u = (uom || "").trim();
  const n = (x: number) => x.toLocaleString("th-TH", { maximumFractionDigits: 1 });
  if (["ก.", "g", "กรัม"].includes(u) && Math.abs(v) >= 1000) return `${n(v / 1000)} กก.`;
  return `${n(v)} ${u}`.trim();
};
const parse = (raw: string) => Math.max(0, Number(raw.replace(/,/g, "")) || 0);
const chip = (on: boolean) => cn("min-h-[44px] rounded-xl border px-3 text-sm", on ? "border-primary bg-primary font-semibold text-primary-foreground" : "border-border bg-card");

// ─── Home ───

export interface SessionSummary {
  session: StockCountSession;
  counted: number;
  total: number;
  value: number;
  big: number;
}

export function CountHome({
  dueDate,
  due,
  summaries,
  totals,
  canEdit,
  busy,
  onStart,
  onOpen,
  onPrint,
  onOther,
}: {
  dueDate: string;
  /** The session for the due date, if started */
  due: SessionSummary | null;
  summaries: SessionSummary[];
  totals: Record<CountType, number>;
  canEdit: boolean;
  busy: boolean;
  onStart: () => void;
  onOpen: (date: string) => void;
  onPrint: () => void;
  onOther: (date: string) => void;
}) {
  const [other, setOther] = useState("");
  const daysLeft = Math.round((new Date(dueDate + "T00:00:00").getTime() - new Date(new Date().toDateString()).getTime()) / 86400000);
  const month = thaiDay(dueDate).split(" ").slice(-1)[0];
  const done = summaries.filter((s) => s.session.status === "Completed");
  return (
    <div className="flex flex-col gap-4">
      <section data-tour="kc-due" className="flex flex-wrap items-center gap-3 rounded-2xl border border-border border-l-4 border-l-brand bg-card p-4 shadow-card">
        <div className="min-w-0 flex-1">
          <div className="text-lg font-bold">
            นับสิ้นเดือน {month} · {thaiDay(dueDate)}
          </div>
          <div className="text-sm text-muted-foreground">
            {due
              ? due.session.status === "Completed"
                ? "นับเสร็จแล้ว"
                : `นับแล้ว ${due.counted} / ${due.total}`
              : `${daysLeft > 0 ? `อีก ${daysLeft} วัน · ` : daysLeft === 0 ? "วันนี้ · " : ""}${totals.SM + totals.RM + totals.PK} รายการ (SM ${totals.SM} · RM ${totals.RM} · PK ${totals.PK})`}
          </div>
        </div>
        <Button variant="outline" className="h-11" onClick={onPrint}>
          <Printer className="h-4 w-4" /> พิมพ์ใบนับ
        </Button>
        {canEdit && (
          <Button variant="brand" className="h-12 min-w-[120px] text-base" loading={busy} data-tour="kc-start" onClick={due ? () => onOpen(dueDate) : onStart}>
            {due ? (due.session.status === "Completed" ? "ดูผล" : "นับต่อ") : "เริ่มนับ"}
          </Button>
        )}
      </section>

      {summaries.some((s) => s.session.status === "Draft" && s.session.date !== dueDate) && (
        <section className="flex flex-col gap-1.5">
          <h2 className="text-sm font-bold">ใบที่ยังนับไม่เสร็จ</h2>
          {summaries
            .filter((s) => s.session.status === "Draft" && s.session.date !== dueDate)
            .map((s) => (
              <button key={s.session.id} type="button" onClick={() => onOpen(s.session.date)} className="flex min-h-[52px] items-center justify-between rounded-2xl border border-warning/30 bg-warning-soft/60 px-4 text-left text-sm">
                <span>
                  <b>{thaiDay(s.session.date)}</b> · นับแล้ว {s.counted} / {s.total}
                </span>
                <span className="text-primary">นับต่อ</span>
              </button>
            ))}
        </section>
      )}

      <section className="flex flex-col gap-1.5">
        <h2 className="text-sm font-bold">นับที่ผ่านมา</h2>
        {done.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card px-4 py-4 text-sm text-muted-foreground">ยังไม่มี</div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-card">
            <table className="w-full min-w-[560px] table-fixed text-sm">
              <colgroup>
                <col />
                <col style={{ width: "130px" }} />
                <col style={{ width: "170px" }} />
                <col style={{ width: "120px" }} />
                <col style={{ width: "80px" }} />
              </colgroup>
              <thead>
                <tr className="bg-secondary/60 text-left text-[13px] text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">วันที่นับ</th>
                  <th className="px-3 py-2.5 text-right font-medium">นับครบ</th>
                  <th className="px-3 py-2.5 text-right font-medium">ต่างจากระบบ (มูลค่า)</th>
                  <th className="px-3 py-2.5 text-right font-medium">ต่างมาก</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {done.slice(0, 12).map((s) => (
                  <tr key={s.session.id} className="border-t border-border">
                    <td className="px-4 py-3 font-semibold">{thaiDay(s.session.date)}</td>
                    <td className="px-3 py-3 text-right font-mono">
                      {s.counted} / {s.total}
                    </td>
                    <td className={cn("px-3 py-3 text-right font-mono", s.value < -0.5 ? "text-destructive" : s.value > 0.5 ? "text-success" : "")}>
                      {s.value < 0 ? "−" : s.value > 0 ? "+" : ""}
                      {baht(Math.abs(s.value))}
                    </td>
                    <td className="px-3 py-3 text-right font-mono">{s.big} รายการ</td>
                    <td className="px-3 py-2 text-right">
                      <button type="button" onClick={() => onOpen(s.session.date)} className="min-h-[40px] rounded-lg px-2 text-primary hover:bg-secondary">
                        ดู
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {canEdit && (
        <section className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">นับวันอื่น (เช่น นับบางกลุ่มกลางเดือน)</span>
          <Input type="date" max={toLocalDateStr(new Date())} value={other} onChange={(e) => setOther(e.target.value)} className="h-11 w-[170px]" />
          <Button variant="outline" className="h-11" disabled={!other} onClick={() => onOther(other)}>
            เปิดใบนับ
          </Button>
        </section>
      )}
    </div>
  );
}

// ─── Counting ───

export function CountSheet({
  session,
  lines,
  skuOf,
  ckRmIds,
  priceOf,
  canEdit,
  canDelete,
  onBack,
  onCount,
  onNote,
  onRefresh,
  onPrint,
  onReview,
  onDelete,
  refreshed,
}: {
  /** System figures were brought up to date on this screen */
  refreshed: boolean;
  session: StockCountSession;
  lines: StockCountLine[];
  skuOf: (id: string) => SKU | undefined;
  ckRmIds: Set<string>;
  priceOf: (skuId: string) => number;
  canEdit: boolean;
  canDelete: boolean;
  onBack: () => void;
  onCount: (line: StockCountLine, v: number | null) => void;
  onNote: (line: StockCountLine, note: string) => void;
  onRefresh: () => void;
  onPrint: () => void;
  onReview: () => void;
  onDelete: () => void;
}) {
  const [type, setType] = useState<CountType>("SM");
  const [storage, setStorage] = useState<string>("all");
  const [ckOnly, setCkOnly] = useState(false);
  const [q, setQ] = useState("");
  const [menu, setMenu] = useState(false);
  const done = session.status === "Completed";
  const order = useMemo(() => sheetOrder(skuOf), [skuOf]);
  const ofType = (t: CountType) => lines.filter((l) => l.type === t);
  const shown = lines
    .filter((l) => l.type === type)
    .filter((l) => storage === "all" || skuOf(l.skuId)?.storageCondition === storage)
    .filter((l) => !(type === "RM" && ckOnly) || ckRmIds.has(l.skuId))
    .filter((l) => !q || `${skuOf(l.skuId)?.name ?? ""} ${skuOf(l.skuId)?.skuId ?? ""}`.toLowerCase().includes(q.toLowerCase()))
    .sort(order);
  const counted = lines.filter((l) => l.physicalQty !== null).length;
  const big = lines.filter(isBigDiff).length;
  const left = shown.filter((l) => l.physicalQty === null).length;
  const created = toLocalDateStr(new Date(session.createdAt));
  const stale = !done && !refreshed && created < toLocalDateStr(new Date());

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onBack} aria-label="กลับ" className="-ml-2 flex h-11 w-11 items-center justify-center rounded-xl hover:bg-secondary">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="mr-auto min-w-0">
          <h2 className="text-xl font-bold">
            {done ? "ผลนับ" : "นับสต๊อก"} · {thaiDay(session.date)}
          </h2>
          <p className="text-sm text-muted-foreground">
            นับแล้ว {counted} / {lines.length}
            {!done && " · บันทึกให้อัตโนมัติ"}
          </p>
        </div>
        <div className="relative w-full sm:w-[220px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นสินค้า" className="h-11 pl-9" data-noflow="" />
        </div>
        <Button variant="outline" className="h-11" onClick={onPrint}>
          <Printer className="h-4 w-4" /> พิมพ์ใบนับ
        </Button>
        {(canDelete || (stale && canEdit)) && (
          <div className="relative">
            <Button variant="outline" className="h-11 w-11 px-0" aria-label="เมนู" onClick={() => setMenu((m) => !m)}>
              <MoreHorizontal className="h-5 w-5" />
            </Button>
            {menu && (
              <div className="absolute right-0 top-12 z-40 w-60 rounded-xl border border-border bg-card p-1 shadow-raised">
                {stale && canEdit && (
                  <button type="button" className="flex min-h-[44px] w-full items-center gap-2 rounded-lg px-3 text-left text-sm hover:bg-secondary" onClick={() => { setMenu(false); onRefresh(); }}>
                    <RefreshCw className="h-4 w-4" /> อัปเดตยอดระบบเป็นตอนนี้
                  </button>
                )}
                {canDelete && (
                  <button type="button" className="flex min-h-[44px] w-full items-center rounded-lg px-3 text-left text-sm text-destructive hover:bg-secondary" onClick={() => { setMenu(false); onDelete(); }}>
                    ลบใบนับนี้
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {stale && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-warning-soft px-4 py-2.5 text-sm text-warning">
          ยอดระบบเป็นของวันที่ {thaiDay(created)}
          {canEdit && (
            <Button variant="outline" className="h-9" onClick={onRefresh}>
              <RefreshCw className="h-4 w-4" /> อัปเดตเป็นตอนนี้
            </Button>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5" data-tour="kc-types">
        {TYPES.map((t) => {
          const all = ofType(t);
          return (
            <button key={t} type="button" aria-pressed={type === t} className={cn(chip(type === t), "text-base")} onClick={() => setType(t)}>
              {t} {all.filter((l) => l.physicalQty !== null).length}/{all.length}
            </button>
          );
        })}
        <span className="mx-1 hidden h-7 w-px bg-border sm:block" />
        <button type="button" className={chip(storage === "all")} onClick={() => setStorage("all")}>
          ทุกช่องเก็บ
        </button>
        {STORAGES.map((s) => (
          <button key={s.key} type="button" className={chip(storage === s.key)} onClick={() => setStorage(s.key)}>
            {s.label}
          </button>
        ))}
        {type === "RM" && (
          <button type="button" aria-pressed={ckOnly} className={chip(ckOnly)} onClick={() => setCkOnly((c) => !c)}>
            เฉพาะของครัว
          </button>
        )}
        {!done && <span className="ml-auto text-sm text-muted-foreground">ยังไม่นับ {left}</span>}
      </div>

      <div data-tour="kc-lines" className="overflow-x-auto rounded-2xl border border-border bg-card shadow-card" onKeyDown={onEnterNext}>
        <table className="w-full min-w-[720px] table-fixed text-sm">
          <colgroup>
            <col />
            <col style={{ width: "130px" }} />
            <col style={{ width: "190px" }} />
            <col style={{ width: "150px" }} />
          </colgroup>
          <thead>
            <tr className="bg-secondary/60 text-left text-[13px] text-muted-foreground">
              <th className="px-3 py-2.5 font-medium">สินค้า</th>
              <th className="px-3 py-2.5 text-right font-medium">ระบบมี</th>
              <th className="px-3 py-2.5 text-right font-medium">นับได้</th>
              <th className="px-3 py-2.5 text-right font-medium">ต่าง</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((l, i) => {
              const sku = skuOf(l.skuId);
              const uom = sku?.usageUom ?? "";
              const prevStorage = i > 0 ? skuOf(shown[i - 1].skuId)?.storageCondition : null;
              const st = sku?.storageCondition ?? "";
              const flag = isBigDiff(l);
              return [
                storage === "all" && st !== prevStorage && (
                  <tr key={`z-${st}-${l.id}`} className="border-t border-border bg-secondary/40">
                    <td colSpan={4} className="px-3 py-1.5 text-[13px] font-semibold text-muted-foreground">
                      {STORAGES.find((s) => s.key === st)?.label ?? (st || "ไม่ระบุช่องเก็บ")}
                    </td>
                  </tr>
                ),
                <tr key={l.id} className={cn("border-t border-border align-top", flag && "bg-warning-soft/40")}>
                  <td className="px-3 py-2.5">
                    <div className="font-semibold leading-snug">{sku?.name ?? "สินค้าที่ถูกลบ"}</div>
                    <div className="font-mono text-[12px] text-muted-foreground">{sku?.skuId}</div>
                    {!done ? (
                      <div className="max-w-[260px]">
                        <NoteField value={l.note} onChange={(n) => n !== l.note && onNote(l, n)} />
                      </div>
                    ) : (
                      l.note && <div className="text-[13px] text-muted-foreground">{l.note}</div>
                    )}
                  </td>
                  <td className={cn("px-3 py-3 text-right font-mono", l.systemQty < 0 ? "text-destructive" : "text-muted-foreground")}>{qty(l.systemQty, uom)}</td>
                  <td className="px-3 py-2">
                    {done ? (
                      <div className="py-2.5 text-right font-mono">{l.physicalQty === null ? "—" : qty(l.physicalQty, uom)}</div>
                    ) : (
                      <span className="flex h-11 w-full items-center overflow-hidden rounded-xl border border-input bg-background focus-within:ring-2 focus-within:ring-ring">
                        <input
                          inputMode="decimal"
                          disabled={!canEdit}
                          key={`${l.id}-${l.physicalQty}`}
                          defaultValue={l.physicalQty ?? ""}
                          placeholder="—"
                          onFocus={(e) => e.target.select()}
                          onBlur={(e) => {
                            const raw = e.target.value.trim();
                            const v = raw === "" ? null : parse(raw);
                            if (v !== l.physicalQty) onCount(l, v);
                          }}
                          className="h-full w-full min-w-0 bg-transparent px-3 text-right font-mono text-base tabular-nums outline-none placeholder:text-muted-foreground/50"
                          aria-label={`นับได้ ${sku?.name ?? ""}`}
                        />
                        <span className="shrink-0 pr-3 text-sm text-muted-foreground">{uom}</span>
                      </span>
                    )}
                  </td>
                  <td className={cn("px-3 py-3 text-right font-mono", l.physicalQty === null || Math.abs(l.variance) < 0.5 ? "text-muted-foreground" : l.variance > 0 ? "text-success" : "text-destructive", flag && "font-semibold")}>
                    {l.physicalQty === null ? "" : Math.abs(l.variance) < 0.5 ? "—" : `${l.variance > 0 ? "+" : "−"}${qty(Math.abs(l.variance), uom)}`}
                    {flag && priceOf(l.skuId) > 0 && <div className="text-[12px]">{l.variance > 0 ? "+" : "−"}{baht(Math.abs(l.variance * priceOf(l.skuId)))}</div>}
                  </td>
                </tr>,
              ];
            })}
            {shown.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                  ไม่มีสินค้าในกลุ่มนี้
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {!done && (
        <div data-tour="kc-review" className="sticky bottom-[calc(64px+env(safe-area-inset-bottom))] z-30 mt-2 md:bottom-4">
          <div className="flex items-center gap-3 rounded-2xl bg-primary py-3 pl-4 pr-3 text-primary-foreground shadow-raised">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[15px] font-semibold">
                นับแล้ว {counted} / {lines.length}
              </div>
              {big > 0 && <div className="truncate text-sm text-primary-foreground/70">ต่างมาก {big} รายการ</div>}
            </div>
            <Button variant="brand" className="h-12 min-w-[140px] text-base" disabled={!canEdit || counted === 0} onClick={onReview}>
              ตรวจแล้วนับเสร็จ
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Review ───

export function CountReview({
  session,
  lines,
  skuOf,
  priceOf,
  busy,
  events,
  timing,
  onTiming,
  onBack,
  onFix,
  onConfirm,
}: {
  session: StockCountSession;
  lines: StockCountLine[];
  skuOf: (id: string) => SKU | undefined;
  priceOf: (skuId: string) => number;
  busy: boolean;
  /** The count day's movements (undefined while loading) */
  events: CountDayEvent[] | undefined;
  timing: CountTiming | null;
  onTiming: (t: CountTiming) => void;
  onBack: () => void;
  onFix: () => void;
  onConfirm: () => void;
}) {
  const mustAsk = !!events?.length;
  const counted = lines.filter((l) => l.physicalQty !== null);
  const value = counted.reduce((s, l) => s + l.variance * priceOf(l.skuId), 0);
  const big = lines.filter(isBigDiff).sort((a, b) => Math.abs(b.variance * priceOf(b.skuId)) - Math.abs(a.variance * priceOf(a.skuId)));
  const missing = lines.filter((l) => l.physicalQty === null);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onBack} aria-label="กลับ" className="-ml-2 flex h-11 w-11 items-center justify-center rounded-xl hover:bg-secondary">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h2 className="text-xl font-bold">ตรวจก่อนนับเสร็จ · {thaiDay(session.date)}</h2>
      </div>
      {mustAsk && <CountTimingAsk date={session.date} events={events!} timing={timing} onTiming={onTiming} />}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="rounded-2xl border border-border bg-card p-3 shadow-card">
          <div className="text-[13px] text-muted-foreground">นับแล้ว</div>
          <div className="font-mono text-2xl font-bold">
            {counted.length} / {lines.length}
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-3 shadow-card">
          <div className="text-[13px] text-muted-foreground">ต่างจากระบบ (มูลค่า)</div>
          <div className={cn("font-mono text-2xl font-bold", value < -0.5 ? "text-destructive" : value > 0.5 ? "text-success" : "")}>
            {value < 0 ? "−" : value > 0 ? "+" : ""}
            {baht(Math.abs(value))}
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-3 shadow-card">
          <div className="text-[13px] text-muted-foreground">ต่างมาก (เกิน 20%)</div>
          <div className="font-mono text-2xl font-bold">{big.length} รายการ</div>
        </div>
      </div>
      {big.length > 0 && (
        <section className="rounded-2xl border border-border border-l-4 border-l-brand bg-card p-3 shadow-card">
          <h3 className="mb-1 text-[15px] font-bold">ต่างมาก · เช็คอีกที</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <tbody>
                {big.map((l) => {
                  const sku = skuOf(l.skuId);
                  const uom = sku?.usageUom ?? "";
                  return (
                    <tr key={l.id} className="border-t border-border first:border-0">
                      <td className="py-2 pr-3">
                        {sku?.name} <span className="text-[12px] text-muted-foreground">· {l.type}</span>
                      </td>
                      <td className="py-2 pr-3 text-right font-mono text-muted-foreground">ระบบ {qty(l.systemQty, uom)}</td>
                      <td className="py-2 pr-3 text-right font-mono">นับ {qty(l.physicalQty ?? 0, uom)}</td>
                      <td className={cn("py-2 text-right font-mono", l.variance < 0 ? "text-destructive" : "text-success")}>
                        {l.variance < 0 ? "−" : "+"}
                        {baht(Math.abs(l.variance * priceOf(l.skuId)))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Button variant="outline" className="mt-2 h-10" onClick={onFix}>
            กลับไปแก้
          </Button>
        </section>
      )}
      {missing.length > 0 && (
        <section className="rounded-2xl border border-border bg-card p-3 text-sm shadow-card">
          <h3 className="mb-1 text-[15px] font-bold">ยังไม่นับ {missing.length} รายการ</h3>
          <p className="text-muted-foreground">
            {missing
              .slice(0, 12)
              .map((l) => skuOf(l.skuId)?.name ?? "")
              .join(" · ")}
            {missing.length > 12 && ` และอีก ${missing.length - 12}`} — ไม่นับ = ใช้ยอดระบบต่อ
          </p>
        </section>
      )}
      <div data-tour="kc-confirm" className="sticky bottom-[calc(64px+env(safe-area-inset-bottom))] z-30 mt-2 md:bottom-4">
        <div className="flex items-center gap-3 rounded-2xl bg-primary py-3 pl-4 pr-3 text-primary-foreground shadow-raised">
          <div className="min-w-0 flex-1 truncate text-[15px] font-semibold">
            {events === undefined ? "กำลังโหลด…" : mustAsk && !timing ? "ตอบคำถามด้านบนก่อน" : "นับเสร็จแล้ว สต๊อกในระบบจะเปลี่ยนตามที่นับ"}
          </div>
          <Button
            variant="brand"
            className="h-12 min-w-[120px] text-base"
            loading={busy}
            disabled={events === undefined || (mustAsk && !timing)}
            onClick={onConfirm}
          >
            นับเสร็จ
          </Button>
        </div>
      </div>
    </div>
  );
}

/** When it was keyed in: the time, plus the day if that wasn't the count day */
const enteredAt = (iso: string, countDate: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return toLocalDateStr(d) === countDate ? time : `${d.getDate()}/${d.getMonth() + 1} ${time}`;
};

/** "Were these in the fridge when you counted?" — one row per movement of the count day, then two answers */
function CountTimingAsk({ date, events, timing, onTiming }: { date: string; events: CountDayEvent[]; timing: CountTiming | null; onTiming: (t: CountTiming) => void }) {
  const day = date === toLocalDateStr(new Date()) ? "วันนี้" : "วันนับ";
  const options: { key: CountTiming; title: string; body: string; result: string }[] = [
    {
      key: "after",
      title: "นับหลังรายการพวกนี้",
      body: "ของที่รับ / ผลิต อยู่ในตู้แล้วตอนนับ · ของที่ส่งออกไปแล้วก่อนนับ",
      result: "ผล: ยอดที่นับ = สต๊อก ไม่บวก ไม่หักเพิ่ม",
    },
    {
      key: "before",
      title: "นับก่อนรายการพวกนี้",
      body: "ตอนนับยังไม่ได้รับ ยังไม่ได้ผลิต ยังไม่ได้ส่ง",
      result: "ผล: ยอดที่นับ + ของเข้า − ของออก ตามรายการด้านบน",
    },
  ];
  return (
    <section data-tour="kc-timing" className="rounded-2xl border border-border border-l-4 border-l-brand bg-card p-3 shadow-card">
      <h3 className="text-[15px] font-bold">
        {day} มีของเข้า-ออก {events.length} รายการ · ตอนนับ ของพวกนี้อยู่ในตู้หรือยัง?
      </h3>
      <ul className="mt-2 divide-y divide-border rounded-xl border border-border">
        {events.map((e, i) => (
          <li key={i} className="flex items-center gap-2 px-3 py-2 text-sm">
            <span className="w-[4.5rem] shrink-0 font-mono text-muted-foreground">{enteredAt(e.at, date)}</span>
            <span className={cn("w-4 text-center font-mono font-bold", e.sign === "+" ? "text-success" : "text-destructive")}>{e.sign}</span>
            <span className="min-w-0 flex-1">{e.text}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            onClick={() => onTiming(o.key)}
            aria-pressed={timing === o.key}
            className={cn(
              "min-h-[44px] rounded-xl border p-3 text-left transition-colors",
              timing === o.key ? "border-brand bg-brand/5 ring-1 ring-brand" : "border-border bg-card hover:bg-secondary",
            )}
          >
            <div className="text-[15px] font-bold">{o.title}</div>
            <div className="mt-0.5 text-[13px] text-muted-foreground">{o.body}</div>
            <div className="mt-1 text-[13px] font-semibold">{o.result}</div>
          </button>
        ))}
      </div>
      <p className="mt-2 text-[12px] text-muted-foreground">
        ถ้าบางอย่างก่อน บางอย่างหลัง เลือกแบบที่ตรงกับส่วนใหญ่ แล้วไปปรับยอดที่เหลือในหน้าสต๊อก
      </p>
      {timing === "after" && <p className="mt-1 text-[13px] font-semibold">ของที่เข้า-ออกหลังนับเสร็จ ให้ลงวันที่วันถัดไป ระบบถึงจะบวก/หักให้</p>}
    </section>
  );
}
