import { useState } from "react";
import { AlertTriangle, Check, ChevronRight, Lock } from "lucide-react";
import type { CountStatus, OpenDay } from "@/hooks/use-count-status";
import { ZONES, differenceHint, differenceOf, type Zone } from "@/lib/stock-count";
import type { SheetLine } from "./CountSheet";
import { ActionFooter } from "@/components/receive/parts";
import { Button } from "@/components/ui/button";
import { thaiDay } from "@/components/sales/SalesDays";
import { cn } from "@/lib/utils";

const n0 = (n: number) => Math.round(n).toLocaleString();

/** Before counting: the checklist, days left open, month-end, zones, start */
export function CountHome({
  date,
  status,
  statusLoading,
  hasSheet,
  finished,
  zoneProgress,
  dormantCount,
  monthEnd,
  canEdit,
  starting,
  onStart,
  onGoSales,
  onGoReceive,
  onFinishOpenDays,
  onOpenDay,
  onShowDormant,
}: {
  date: string;
  status: CountStatus;
  statusLoading: boolean;
  hasSheet: boolean;
  finished: boolean;
  zoneProgress: { zone: Zone; counted: number; total: number }[];
  dormantCount: number;
  monthEnd: string[] | null;
  canEdit: boolean;
  starting: boolean;
  onStart: () => void;
  onGoSales: () => void;
  onGoReceive: () => void;
  onFinishOpenDays: () => Promise<void>;
  onOpenDay: (d: string) => void;
  onShowDormant: () => void;
}) {
  const [closing, setClosing] = useState(false);
  const blocked = status.openDays.length > 0;
  const counted = zoneProgress.reduce((s, z) => s + z.counted, 0);
  const total = zoneProgress.reduce((s, z) => s + z.total, 0);

  return (
    <div className="flex flex-col gap-3">
      {blocked && canEdit && (
        <section data-tour="count-open" className="flex flex-col gap-3 rounded-2xl border-[1.5px] border-warning bg-card p-4">
          <div className="text-sm font-semibold text-warning">ต้องทำก่อน</div>
          <h2 className="text-lg font-bold leading-snug">ยังไม่ได้กด “นับเสร็จ” {status.openDays.length} วัน</h2>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border text-sm">
            {status.openDays.map((d: OpenDay) => (
              <li key={d.date}>
                <button type="button" onClick={() => onOpenDay(d.date)} className="flex min-h-[48px] w-full items-center gap-3 px-3 text-left hover:bg-secondary/60">
                  <span className="flex-1">{thaiDay(d.date)}</span>
                  <span className="font-mono">
                    {d.counted}/{d.total}
                  </span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </button>
              </li>
            ))}
          </ul>
          <p className="text-sm leading-relaxed text-muted-foreground">วันที่ผ่านไปแล้วนับย้อนหลังไม่ได้ ปิดได้เลย ยอดที่นับไว้ยังใช้ได้ และยอดยกมาของวันนี้ระบบไล่คิดให้ครบ</p>
          <Button
            variant="brand"
            className="h-12 text-base"
            loading={closing}
            onClick={async () => {
              setClosing(true);
              await onFinishOpenDays();
              setClosing(false);
            }}
          >
            ปิดวันที่ค้างทั้งหมด แล้วนับวันนี้
          </Button>
        </section>
      )}

      {monthEnd && (
        <section className="flex flex-col gap-2 rounded-2xl bg-primary p-4 text-primary-foreground">
          <div className="text-sm font-semibold text-brand-soft">ช่วงปิดเดือน</div>
          <h2 className="text-lg font-bold">ต้องนับครบทุกตัว 100%</h2>
          <p className="text-sm text-primary-foreground/75">ยอดนับช่วงนี้ใช้คิดต้นทุนอาหารของทั้งเดือน นับให้ครบทุกวันจนถึงวันที่ {Number(monthEnd[4].slice(8))}</p>
          <div className="grid grid-cols-5 gap-1.5 pt-1">
            {monthEnd.map((d) => (
              <span key={d} className={cn("flex min-h-[44px] flex-col items-center justify-center rounded-lg text-xs", d === date ? "bg-brand font-bold text-brand-foreground" : d < date ? "bg-success/80" : "border border-primary-foreground/20 text-primary-foreground/60")}>
                {Number(d.slice(8))}
                <span>{d === date ? "วันนี้" : d < date ? "✓" : "·"}</span>
              </span>
            ))}
          </div>
        </section>
      )}

      <section data-tour="count-check" className="overflow-hidden rounded-2xl border border-border bg-card">
        <h2 className="px-4 pb-1 pt-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">ก่อนนับ เช็คให้ครบ</h2>
        <CheckRow
          ok={status.salesLines > 0}
          loading={statusLoading}
          title="ยอดขายวันนี้"
          sub={status.salesLines > 0 ? `นำเข้าแล้ว ${status.salesLines} รายการ` : "ยังไม่ได้นำเข้า คงเหลือจะยังไม่หักยอดขาย"}
          action={status.salesLines > 0 ? undefined : { label: "ไปนำเข้า", onClick: onGoSales }}
        />
        <CheckRow ok loading={statusLoading} title="รับของวันนี้" sub={status.receipts > 0 ? `รับแล้ว ${status.receipts} รายการ` : "ยังไม่มีรายการรับของ (ถ้ามีของเข้า รับก่อนนับ)"} action={{ label: "ไปรับของ", onClick: onGoReceive, quiet: true }} />
        {status.waitingTransfers > 0 && (
          <CheckRow ok={false} loading={statusLoading} title={`ใบโอนครัวกลางยังไม่ได้รับ ${status.waitingTransfers} ใบ`} sub="ถ้าของมาแล้ว รับก่อน ไม่งั้นยอดจะขาด" action={{ label: "ไปรับ", onClick: onGoReceive }} />
        )}
      </section>

      <section data-tour="count-start" className={cn("flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-card", blocked && canEdit && "opacity-50")}>
        {finished ? (
          <div className="flex items-center gap-2 text-success">
            <Check className="h-5 w-5" />
            <span className="font-semibold">วันนี้นับเสร็จแล้ว</span>
          </div>
        ) : (
          <div className="flex items-baseline justify-between">
            <h2 className="text-base font-semibold">{hasSheet ? `นับแล้ว ${counted}/${total}` : "วันนี้ยังไม่เริ่มนับ"}</h2>
            {hasSheet && <span className="text-sm text-muted-foreground">บันทึกให้อัตโนมัติ</span>}
          </div>
        )}
        {hasSheet && (
          <div className="flex flex-col gap-2">
            {zoneProgress.map((z) => (
              <div key={z.zone} className="flex items-center gap-2.5 text-sm">
                <span className="w-24">{ZONES.find((x) => x.key === z.zone)!.label}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
                  <span className="block h-full bg-success" style={{ width: `${z.total ? (z.counted / z.total) * 100 : 0}%` }} />
                </span>
                <span className="w-14 text-right font-mono text-xs">
                  {z.counted}/{z.total}
                </span>
              </div>
            ))}
          </div>
        )}
        {canEdit && !finished && (
          <Button variant="brand" className="h-12 text-base" disabled={blocked} loading={starting} onClick={onStart}>
            {hasSheet && counted > 0 ? "นับต่อ" : "เริ่มนับ"}
          </Button>
        )}
        {finished && (
          <Button variant="outline" className="h-11" onClick={onStart}>
            ดูยอดที่นับ
          </Button>
        )}
        {blocked && canEdit && <p className="text-center text-sm text-muted-foreground">เริ่มได้หลังปิดวันที่ค้าง</p>}
      </section>

      {hasSheet && dormantCount > 0 && (
        <button type="button" onClick={onShowDormant} className="flex min-h-[52px] items-center gap-3 rounded-2xl border border-dashed border-border px-4 text-left text-sm text-muted-foreground hover:text-foreground">
          <span className="flex-1">
            ไม่มีที่สาขานี้ {dormantCount} รายการ {monthEnd ? "(ช่วงปิดเดือนต้องยืนยัน)" : "(พับไว้ ไม่ต้องนับ)"}
          </span>
          <span>ดู</span>
        </button>
      )}
    </div>
  );
}

function CheckRow({ ok, loading, title, sub, action }: { ok: boolean; loading: boolean; title: string; sub: string; action?: { label: string; onClick: () => void; quiet?: boolean } }) {
  return (
    <div className={cn("flex min-h-[60px] items-center gap-3 border-t border-border px-4 py-2 first-of-type:border-t-0", !ok && !loading && "bg-warning-soft/50")}>
      <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full", loading ? "bg-secondary" : ok ? "bg-success-soft text-success" : "bg-warning-soft text-warning")}>
        {loading ? "…" : ok ? <Check className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px]">{title}</span>
        <span className={cn("block text-sm", ok ? "text-muted-foreground" : "text-warning")}>{loading ? "กำลังเช็ค…" : sub}</span>
      </span>
      {action && (
        <button type="button" onClick={action.onClick} className={cn("min-h-[44px] shrink-0 px-2 text-sm font-semibold", action.quiet ? "text-muted-foreground" : "text-brand")}>
          {action.label}
        </button>
      )}
    </div>
  );
}

/** Before finishing: big differences to recount, what's not counted, the finish button */
export function CountReview({
  lines,
  dormant,
  monthEnd,
  salesIn,
  locked,
  busy,
  onCount,
  onZeroDormant,
  onFinish,
  onBack,
}: {
  lines: (SheetLine & { big: boolean })[];
  dormant: SheetLine[];
  monthEnd: boolean;
  salesIn: boolean;
  locked: boolean;
  busy: boolean;
  onCount: (rowId: string, value: number | null) => void;
  onZeroDormant: () => void;
  onFinish: () => void;
  onBack: () => void;
}) {
  const counted = lines.filter((l) => l.row.physicalCount !== null).length;
  const uncounted = lines.filter((l) => l.row.physicalCount === null);
  const big = lines.filter((l) => l.big);
  const dormantLeft = dormant.filter((l) => l.row.physicalCount === null);
  const wasted = lines.filter((l) => l.row.waste > 0).length;
  const allCounted = uncounted.length === 0 && (!monthEnd || dormantLeft.length === 0);
  const canFinish = !locked && (monthEnd ? allCounted : counted > 0);

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-xl font-bold">ตรวจก่อนนับเสร็จ</h2>
      <div className={cn("flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm", allCounted ? "bg-success-soft text-success" : "bg-warning-soft text-warning")}>
        {allCounted ? <Check className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
        นับแล้ว {counted}/{lines.length} รายการ · ของเสีย {wasted} รายการ
      </div>

      {big.length > 0 && salesIn && (
        <>
          <h3 className="mt-1 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">ขาด/เกินจากคงเหลือมาก ลองนับซ้ำ · {big.length}</h3>
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
            {big.map((l) => {
              const d = differenceOf(l.row)!;
              return (
                <li key={l.row.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-semibold">{l.sku.name}</div>
                    <div className="text-sm text-muted-foreground">
                      คงเหลือ {n0(l.row.calculatedBalance)} · นับได้ {n0(l.row.physicalCount!)} {l.sku.usageUom}
                    </div>
                    <div className={cn("text-sm font-semibold", d < 0 ? "text-warning" : "text-info")}>
                      {d < 0 ? `ขาด ${n0(-d)}` : `เกิน ${n0(d)}`} {l.sku.usageUom} · {differenceHint(l.row)}
                    </div>
                  </div>
                  <span className="flex h-11 w-[120px] items-center overflow-hidden rounded-xl border border-input bg-background">
                    <input
                      aria-label={`แก้ยอดนับ ${l.sku.name}`}
                      inputMode="decimal"
                      disabled={locked}
                      defaultValue={l.row.physicalCount ?? ""}
                      key={`r${l.row.physicalCount}`}
                      onBlur={(e) => {
                        const v = e.target.value.trim() === "" ? null : Math.max(0, Number(e.target.value.replace(/,/g, "")) || 0);
                        if (v !== l.row.physicalCount) onCount(l.row.id, v);
                      }}
                      className="h-full w-full min-w-0 bg-transparent px-2 text-right font-mono text-base outline-none"
                    />
                    <span className="shrink-0 pr-2 text-sm text-muted-foreground">{l.sku.usageUom}</span>
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="text-sm leading-relaxed text-muted-foreground">ถ้านับซ้ำแล้วได้เท่าเดิม ไม่ต้องแก้ ยอดที่นับคือของจริง และจะเป็นยอดยกมาของพรุ่งนี้</p>
        </>
      )}

      {uncounted.length > 0 && (
        <div className="rounded-2xl border border-warning/50 bg-card p-4 text-sm">
          <div className="font-semibold text-warning">ยังไม่ได้นับ {uncounted.length} รายการ</div>
          <div className="mt-1 text-muted-foreground">{uncounted.slice(0, 6).map((l) => l.sku.name).join(" · ")}{uncounted.length > 6 ? " …" : ""}</div>
          <Button variant="outline" className="mt-3 h-11 w-full" onClick={onBack}>
            กลับไปนับให้ครบ
          </Button>
          {!monthEnd && <p className="mt-2 text-xs text-muted-foreground">ตัวที่ไม่นับ ระบบใช้ยอดคงเหลือแทน</p>}
        </div>
      )}

      {monthEnd && dormantLeft.length > 0 && (
        <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 text-sm">
          <span className="flex-1">ไม่มีที่สาขานี้ {dormantLeft.length} ตัว ช่วงปิดเดือนต้องยืนยัน</span>
          <Button variant="outline" className="h-10" onClick={onZeroDormant}>
            ยืนยันว่าไม่มี = 0
          </Button>
        </div>
      )}

      {locked ? (
        <div className="flex items-center gap-2 rounded-xl bg-secondary px-3 py-3 text-sm text-muted-foreground">
          <Lock className="h-4 w-4" /> นับเสร็จแล้ว แก้ไม่ได้ · ผู้จัดการปลดล็อกได้
        </div>
      ) : (
        <div data-tour="count-finish">
          <ActionFooter
            title={allCounted ? "นับครบแล้ว" : monthEnd ? `ช่วงปิดเดือน ต้องนับครบก่อน` : `นับแล้ว ${counted}/${lines.length}`}
            sub={monthEnd && !allCounted ? "กดนับเสร็จได้เมื่อนับครบทุกตัว" : "กดแล้วแก้ไม่ได้ (ผู้จัดการปลดล็อกได้)"}
            action="นับเสร็จ"
            busy={busy}
            disabled={!canFinish}
            onAction={onFinish}
          />
        </div>
      )}
    </div>
  );
}
