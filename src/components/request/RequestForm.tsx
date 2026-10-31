import { useMemo, useState } from "react";
import { addDays, format } from "date-fns";
import { Search, Sparkles } from "lucide-react";
import type { RequestItem } from "@/hooks/use-request-data";
import type { Pending } from "@/lib/request-lines";
import { lineState, suggestedPacks } from "@/lib/request-lines";
import { ActionFooter, PackStepper, onEnterNext } from "@/components/receive/parts";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { thaiDay } from "@/components/sales/SalesDays";
import { cn } from "@/lib/utils";

const iso = (d: Date) => format(d, "yyyy-MM-dd");
const n0 = (n: number) => Math.round(n).toLocaleString();

/**
 * Filling a request: delivery date (tomorrow unless changed), the products that
 * need ordering first, one stepper per product on the right, "ใส่ตามแนะนำ" to
 * fill suggestions. Works for the kitchen and for a supplier.
 */
export function RequestForm({
  title,
  subtitle,
  items,
  pending,
  loading,
  busy,
  onSubmit,
  stockError,
  onRetry,
}: {
  title: string;
  subtitle: string;
  items: RequestItem[];
  pending: Map<string, Pending>;
  loading: boolean;
  busy: boolean;
  onSubmit: (date: string, notes: string, picked: { item: RequestItem; packs: number }[]) => void;
  /** The branch's stock couldn't be read: products are listed, amounts can be typed, nothing is suggested */
  stockError?: boolean;
  onRetry?: () => void;
}) {
  const today = new Date();
  const choices = [
    { label: "พรุ่งนี้", date: iso(addDays(today, 1)) },
    { label: "มะรืน", date: iso(addDays(today, 2)) },
  ];
  const [date, setDate] = useState(choices[0].date);
  const [otherDate, setOtherDate] = useState(false);
  const [packs, setPacks] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState("");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);

  const rows = useMemo(
    () =>
      items.map((item) => {
        const p = pending.get(item.skuId);
        return { item, pending: p, state: lineState(item, p?.qty ?? 0), suggest: suggestedPacks(item, p?.qty ?? 0) };
      }),
    [items, pending],
  );
  const needing = rows.filter((r) => r.suggest > 0);
  const [onlyNeeded, setOnlyNeeded] = useState(true);
  const showNeeded = onlyNeeded && needing.length > 0;
  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const base = words.length ? rows : showNeeded ? rows.filter((r) => r.suggest > 0 || (packs[r.item.skuId] ?? 0) > 0) : rows;
    return base.filter((r) => words.every((w) => `${r.item.name} ${r.item.code}`.toLowerCase().includes(w)));
  }, [rows, query, showNeeded, packs]);

  const picked = rows.filter((r) => (packs[r.item.skuId] ?? 0) > 0);
  const notFilled = needing.filter((r) => !(packs[r.item.skuId] > 0));
  const fillAll = () => setPacks((p) => ({ ...p, ...Object.fromEntries(needing.map((r) => [r.item.skuId, r.suggest])) }));

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-xl font-bold">{title}</h2>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>

      <fieldset data-tour="req-date" className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-sm font-medium">ส่งวันไหน</legend>
        <div className="flex flex-wrap gap-1.5">
          {choices.map((c) => (
            <button
              key={c.date}
              type="button"
              aria-pressed={!otherDate && date === c.date}
              onClick={() => {
                setOtherDate(false);
                setDate(c.date);
              }}
              className={cn("min-h-[44px] flex-1 rounded-xl border px-3 text-sm", !otherDate && date === c.date ? "border-primary bg-primary font-semibold text-primary-foreground" : "border-border bg-card")}
            >
              {c.label} · {thaiDay(c.date).split(" ").slice(1).join(" ")}
            </button>
          ))}
          <button
            type="button"
            aria-pressed={otherDate}
            onClick={() => setOtherDate(true)}
            className={cn("min-h-[44px] rounded-xl border px-4 text-sm", otherDate ? "border-primary bg-primary font-semibold text-primary-foreground" : "border-border bg-card")}
          >
            วันอื่น
          </button>
        </div>
        {otherDate && <Input type="date" value={date} min={iso(today)} onChange={(e) => e.target.value && setDate(e.target.value)} className="h-11 max-w-[200px] text-base" aria-label="วันส่ง" />}
      </fieldset>

      <div className="flex items-center gap-1.5">
        {needing.length > 0 && (
          <button
            type="button"
            aria-pressed={showNeeded}
            onClick={() => setOnlyNeeded(true)}
            className={cn("min-h-[40px] rounded-full border px-4 text-sm", showNeeded ? "border-primary bg-primary font-semibold text-primary-foreground" : "border-border bg-card")}
          >
            ควรสั่ง {needing.length}
          </button>
        )}
        <button
          type="button"
          aria-pressed={!showNeeded}
          onClick={() => setOnlyNeeded(false)}
          className={cn("min-h-[40px] rounded-full border px-4 text-sm", !showNeeded ? "border-primary bg-primary font-semibold text-primary-foreground" : "border-border bg-card")}
        >
          ทั้งหมด {items.length}
        </button>
        {searching ? (
          <label className="relative ml-auto block min-w-0 flex-1">
            <span className="sr-only">ค้นสินค้า</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} onBlur={() => !query && setSearching(false)} placeholder="ค้นสินค้า…" className="h-10 pl-9 text-base md:text-sm" />
          </label>
        ) : (
          <button type="button" aria-label="ค้นสินค้า" onClick={() => setSearching(true)} className="ml-auto flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-card">
            <Search className="h-4 w-4" />
          </button>
        )}
      </div>

      {notFilled.length > 0 && (
        <button
          data-tour="req-fill"
          type="button"
          onClick={fillAll}
          className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl border-[1.5px] border-dashed border-brand bg-brand-soft/50 text-sm font-semibold text-brand"
        >
          <Sparkles className="h-4 w-4" /> ใส่ตามที่แนะนำ{notFilled.length === needing.length ? `ทั้ง ${needing.length} รายการ` : ` อีก ${notFilled.length} รายการ`}
        </button>
      )}

      {stockError && !loading && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-xl bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
          <span className="min-w-0 flex-1">โหลดสต๊อกสาขาไม่สำเร็จ ยังไม่รู้ว่าเหลือเท่าไร จึงยังไม่มีจำนวนแนะนำ ใส่จำนวนเองได้</span>
          {onRetry && (
            <button type="button" onClick={onRetry} className="min-h-[40px] rounded-full border border-destructive px-4 text-sm font-semibold">
              ลองใหม่
            </button>
          )}
        </div>
      )}

      {loading ? (
        <div className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">กำลังคำนวณของที่ควรสั่ง…</div>
      ) : (
        <ul data-tour="req-lines" className="flex flex-col gap-2" onKeyDown={onEnterNext}>
          {shown.map(({ item, pending: p, state, suggest }) => {
            const v = packs[item.skuId] ?? 0;
            const tone = item.stockUnknown
              ? "text-warning"
              : state.kind === "out" ? "text-destructive" : state.kind === "low" ? "text-warning" : state.kind === "coming" ? "text-info" : "text-muted-foreground";
            // Not known: the suggestion (if any) takes nothing on hand, a full round
            const word = item.stockUnknown
              ? suggest > 0
                ? "ไม่รู้ยอดคงเหลือ · แนะนำเต็มรอบ (คิดว่าไม่มีของ)"
                : "ยังไม่รู้ยอดคงเหลือ"
              : state.kind === "nodata"
                ? "ยังไม่มีข้อมูลการใช้"
                : state.kind === "out"
                  ? "หมดแล้ว"
                  : state.kind === "coming"
                    ? `กำลังมา ${n0(p!.qty)} ${item.uom} (ส่ง ${thaiDay(p!.due).split(" ").slice(1).join(" ")})`
                    : `พอขาย ${state.coverDays! >= 100 ? "100+" : state.coverDays!.toFixed(state.coverDays! < 10 ? 1 : 0)} วัน`;
            return (
              <li key={item.skuId} className={cn("flex items-start gap-3 rounded-2xl border border-border bg-card p-3", v > 0 && "shadow-card")}>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className={cn("text-[15px] leading-snug", v > 0 || suggest > 0 ? "font-semibold" : "text-foreground/80")}>{item.name}</div>
                  <div className={cn("text-sm font-medium", tone)}>{word}</div>
                  <div className="text-sm text-muted-foreground">
                    เหลือ <b className="font-mono text-[15px] text-foreground">{item.stockUnknown ? "—" : n0(Math.max(0, item.stockOnHand))}</b> {item.uom}
                    {item.avgDailyUsage > 0 && (
                      <>
                        {" "}· ใช้วันละ ~<b className="font-mono text-[15px] text-foreground">{n0(item.avgDailyUsage)}</b> {item.uom}
                      </>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    1 {item.packUnit} = {n0(item.packSize)} {item.uom}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <PackStepper label={`จำนวน ${item.name}`} value={v} onChange={(n) => setPacks((x) => ({ ...x, [item.skuId]: Math.max(0, Math.round(n)) }))} />
                  {v > 0 ? (
                    <span className="text-xs text-muted-foreground">
                      = {n0(v * item.packSize)} {item.uom}
                      {suggest > 0 && v !== suggest && ` · แนะนำ ${suggest}`}
                    </span>
                  ) : suggest > 0 ? (
                    <button type="button" onClick={() => setPacks((x) => ({ ...x, [item.skuId]: suggest }))} className="min-h-[32px] rounded-full border border-brand px-3 text-xs font-semibold text-brand">
                      ใส่ {suggest} ตามแนะนำ
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
          {!shown.length && <li className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{query ? "ไม่พบสินค้า" : "ไม่มีสินค้าให้ขอ"}</li>}
        </ul>
      )}

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">หมายเหตุ (ถ้ามี)</span>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="เช่น ขอก่อน 10 โมง" className="text-base md:text-sm" />
      </label>

      <ActionFooter
        tour="req-send"
        title={picked.length ? `${picked.length} รายการ · ส่ง ${thaiDay(date)}` : "ยังไม่ได้ใส่จำนวน"}
        sub={notFilled.length && picked.length ? `ยังมีของควรสั่งที่ยังไม่ใส่ ${notFilled.length} รายการ` : undefined}
        action="ส่งคำขอ"
        busy={busy}
        disabled={!picked.length}
        onAction={() => onSubmit(date, notes.trim(), picked.map((r) => ({ item: r.item, packs: packs[r.item.skuId] })))}
      />
    </div>
  );
}
