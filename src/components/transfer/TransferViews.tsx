import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Check, ChevronDown, ChevronRight, Copy, Pencil, Plus, Printer, Undo2 } from "lucide-react";
import type { PendingTR, TOHistoryRow, TOLine } from "@/hooks/use-transfer-order";
import { isShort, kitchenSentShort, sentQtyOf, transferBadges, type Badge, type SendCheck } from "@/lib/transfer-lines";
import { ActionFooter, baht } from "@/components/receive/parts";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { thaiDay } from "@/components/sales/SalesDays";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { PackForm } from "./PackSheet";

const num = (n: number) => Math.round(n).toLocaleString("th-TH");
const time = (iso: string) => format(new Date(iso), "HH:mm");
const todayIso = () => format(new Date(), "yyyy-MM-dd");

const toneClass: Record<Badge["tone"], string> = {
  wait: "bg-warning-soft text-warning",
  info: "bg-info/10 text-info",
  done: "bg-success-soft text-success",
  warn: "bg-warning-soft text-warning",
  kitchen: "bg-brand-soft text-brand",
  off: "bg-secondary text-muted-foreground",
};
export function Badges({ row }: { row: Pick<TOHistoryRow, "status" | "kitchenShort" | "branchShort"> }) {
  return (
    <span className="flex flex-wrap justify-end gap-1">
      {transferBadges(row).map((b) => (
        <span key={b.text} className={cn("inline-flex min-h-[26px] items-center whitespace-nowrap rounded-full px-2.5 text-[13px] font-semibold", toneClass[b.tone])}>
          {b.text}
        </span>
      ))}
    </span>
  );
}

function needWhen(required: string) {
  const today = todayIso();
  if (required < today) return { text: `เลยกำหนด (${thaiDay(required)})`, urgent: true };
  if (required === today) return { text: "ต้องการวันนี้", urgent: true };
  const tomorrow = format(new Date(Date.now() + 86400000), "yyyy-MM-dd");
  return { text: required === tomorrow ? "ต้องการพรุ่งนี้" : `ต้องการ ${thaiDay(required)}`, urgent: false };
}

// ─── Home ───

export function TransferHome({
  pending,
  loading,
  drafts,
  recent,
  canEdit,
  onStart,
  onOpenDraft,
  onOpenRecent,
  onHistory,
  onStandalone,
  activeToId,
  busy,
}: {
  busy?: boolean;
  pending: PendingTR[];
  loading: boolean;
  /** Orders started without a request and not sent */
  drafts: TOHistoryRow[];
  recent: TOHistoryRow[];
  canEdit: boolean;
  onStart: (tr: PendingTR) => void;
  onOpenDraft: (row: TOHistoryRow) => void;
  onOpenRecent: (row: TOHistoryRow) => void;
  onHistory: () => void;
  onStandalone: () => void;
  activeToId?: string;
}) {
  const waiting = pending.filter((p) => !p.draft);
  const started = pending.filter((p) => p.draft);
  return (
    <div className="flex flex-col gap-4">
      <section data-tour="to-queue" className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[15px] font-semibold">รอจัดส่ง {loading ? "" : `${waiting.length} ใบ`}</h2>
          <span className="text-[13px] text-muted-foreground">เรียงตามวันที่สาขาต้องการ</span>
        </div>
        {loading ? (
          <div className="h-24 animate-pulse rounded-2xl bg-secondary" />
        ) : waiting.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card px-4 py-5 text-sm text-muted-foreground">ไม่มีใบขอเบิกค้าง</div>
        ) : (
          waiting.map((tr, i) => {
            const need = needWhen(tr.requiredDate);
            return (
              <div key={tr.trId} className={cn("flex items-start gap-3 rounded-2xl border border-border bg-card p-3 shadow-card", need.urgent && "border-l-4 border-l-destructive")}>
                <div className="min-w-0 flex-1">
                  <div className="text-base font-bold">{tr.branchName}</div>
                  <div className={cn("text-sm font-semibold", need.urgent && "text-destructive")}>
                    {need.text} · {tr.itemCount} รายการ
                  </div>
                  <div className="text-[13px] text-muted-foreground">
                    ขอเมื่อ {thaiDay(tr.createdAt.slice(0, 10))} {time(tr.createdAt)} · <span className="font-mono">{tr.trNumber}</span>
                  </div>
                </div>
                {canEdit && (
                  <Button variant={i === 0 ? "brand" : "outline"} className="h-11 min-w-[104px] font-semibold" disabled={busy} data-tour={i === 0 ? "to-start" : undefined} onClick={() => onStart(tr)}>
                    เริ่มจัดของ
                  </Button>
                )}
              </div>
            );
          })
        )}
      </section>

      {(started.length > 0 || drafts.length > 0) && (
        <section className="flex flex-col gap-2">
          <h2 className="text-[15px] font-semibold">จัดค้างไว้ ยังไม่ได้ส่ง</h2>
          {started.map((tr) => (
            <div key={tr.trId} className={cn("flex items-center gap-3 rounded-2xl border border-warning/30 bg-warning-soft/60 p-3", activeToId === tr.draft?.toId && "ring-2 ring-primary")}>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-bold">
                  {tr.branchName} · {tr.itemCount} รายการ
                </div>
                <div className="text-[13px] text-warning">
                  เริ่มเมื่อ {time(tr.draft!.createdAt)} · {needWhen(tr.requiredDate).text} · สาขายังไม่ได้รับของ
                </div>
              </div>
              {canEdit && (
                <Button className="h-11" disabled={busy} onClick={() => onStart(tr)}>
                  จัดต่อ
                </Button>
              )}
            </div>
          ))}
          {drafts.map((d) => (
            <div key={d.id} className={cn("flex items-center gap-3 rounded-2xl border border-warning/30 bg-warning-soft/60 p-3", activeToId === d.id && "ring-2 ring-primary")}>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-bold">
                  {d.branchName} · โอนเอง {d.itemCount} รายการ
                </div>
                <div className="text-[13px] text-warning">เริ่ม {thaiDay(d.createdAt.slice(0, 10))} {time(d.createdAt)} · ยังไม่ได้ส่ง</div>
              </div>
              {canEdit && (
                <Button className="h-11" disabled={busy} onClick={() => onOpenDraft(d)}>
                  จัดต่อ
                </Button>
              )}
            </div>
          ))}
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-[15px] font-semibold">ส่งแล้ว 3 วันล่าสุด</h2>
        {recent.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card px-4 py-4 text-sm text-muted-foreground">ยังไม่มี</div>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
            {recent.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => onOpenRecent(r)} className="flex min-h-[60px] w-full items-center gap-3 px-3 py-2 text-left hover:bg-secondary/60">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">
                      {r.branchName} · {r.itemCount} รายการ
                    </span>
                    <span className="block text-[13px] text-muted-foreground">ส่ง {thaiDay(r.updatedAt.slice(0, 10))} {time(r.updatedAt)}</span>
                  </span>
                  <Badges row={r} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <Button variant="outline" className="h-11" data-tour="to-history" onClick={onHistory}>
          ดูใบโอนทั้งหมด
        </Button>
      </section>

      {canEdit && (
        <Button variant="outline" className="h-12 border-dashed font-semibold" onClick={onStandalone}>
          <Plus className="h-4 w-4" /> โอนเองโดยไม่มีใบขอเบิก
        </Button>
      )}
    </div>
  );
}

// ─── Review before sending ───

export function ReviewSend({
  form,
  check,
  busy,
  onNotes,
  onFix,
  onFillLots,
  onSend,
  onBack,
  packSizeOf,
  onNotesDone,
}: {
  packSizeOf: (skuId: string) => number;
  onNotesDone?: (n: string) => void;
  form: PackForm;
  check: SendCheck;
  busy: boolean;
  onNotes: (n: string) => void;
  onFix: (lineId: string) => void;
  onFillLots: () => void;
  onSend: () => void;
  onBack: () => void;
}) {
  const sending = form.lines.filter((l) => l.actualQty > 0);
  const value = form.lines.reduce((s, l) => s + l.actualQty * l.unitCost, 0);
  const issues = check.overStock.length + check.lotMismatch.length;
  const changedIds = new Set([...check.short, ...check.changed].map((c) => c.lineId));
  const same = form.lines.filter((l) => l.trLineId && !changedIds.has(l.id)).length;
  const [showSame, setShowSame] = useState(false);
  // Pack items read in packs (with the weight when it isn't whole packs), others in their unit
  const qtyText = (l: TOLine, q: number, floor = false) => {
    const ps = packSizeOf(l.skuId);
    if (ps <= 1) return `${num(q)} ${l.uom}`;
    const packs = floor ? Math.floor(q / ps) : Math.round(q / ps);
    return Math.abs(packs * ps - q) > 0.5 && !floor ? `${num(packs)} แพ็ค (${num(q)} ${l.uom})` : `${num(packs)} แพ็ค`;
  };
  return (
    <div className="flex flex-col gap-3">
      <div>
        <button type="button" onClick={onBack} className="-ml-2 inline-flex min-h-[44px] items-center gap-1 rounded-full px-2 text-sm text-muted-foreground hover:text-foreground">
          <ChevronRight className="h-4 w-4 rotate-180" /> กลับไปจัดของ
        </button>
        <h2 className="text-xl font-bold">ตรวจก่อนส่ง {form.branchName}</h2>
        <p className="text-sm text-muted-foreground">
          <span className="font-mono">{form.toNumber}</span> · ส่ง {thaiDay(form.deliveryDate)}
        </p>
      </div>

      {issues > 0 && (
        <section className="rounded-2xl border border-border border-l-4 border-l-brand bg-card p-3 shadow-card">
          <h3 className="mb-1 text-[15px] font-bold">ต้องดู {issues} เรื่อง</h3>
          {check.lotMismatch.map((m) => (
            <div key={`lot-${m.lineId}`} className="flex items-center gap-2 border-b border-border py-2 last:border-0">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">{m.skuName}</div>
                <div className="text-[13px] text-warning">
                  ล็อตยังไม่ครบ {num(m.assigned)}/{num(m.packs)} แพ็ค · ต้องแก้ก่อนส่ง
                </div>
              </div>
              <Button variant="outline" className="h-10" onClick={() => onFix(m.lineId)}>
                แก้
              </Button>
            </div>
          ))}
          {check.overStock.map((m) => {
            const l = form.lines.find((x) => x.id === m.lineId)!;
            return (
              <div key={`st-${m.lineId}`} className="flex items-center gap-2 border-b border-border py-2 last:border-0">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">{m.skuName}</div>
                  <div className="text-[13px] text-warning">
                    ส่ง {qtyText(l, m.needed)} แต่ในครัวเหลือ {qtyText(l, Math.max(0, m.available), true)} · ส่งได้ถ้าตั้งใจ
                  </div>
                </div>
                <Button variant="outline" className="h-10" onClick={() => onFix(m.lineId)}>
                  แก้
                </Button>
              </div>
            );
          })}
          {check.lotMismatch.length > 1 && (
            <Button variant="outline" className="mt-2 h-11 w-full border-dashed" onClick={onFillLots}>
              เติมล็อตจากเก่าสุดให้ครบทุกรายการ
            </Button>
          )}
        </section>
      )}

      {(check.short.length > 0 || check.changed.length > 0 || form.declined.length > 0) && (
        <section className="rounded-2xl border border-border bg-card p-3 shadow-card">
          <h3 className="mb-1 text-[15px] font-bold">ไม่ตรงกับที่สาขาขอ {check.short.length + check.changed.length + form.declined.length} รายการ</h3>
          {[...check.short, ...check.changed].map((c) => {
            const l = form.lines.find((x) => x.id === c.lineId)!;
            const short = check.short.some((s) => s.lineId === c.lineId);
            return (
              <div key={c.lineId} className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
                <span className="min-w-0 break-words">{c.skuName}</span>
                <span className={cn("shrink-0 font-mono", short && "font-semibold text-brand")}>
                  {qtyText(l, c.sent)} <span className="text-muted-foreground">(ขอ {qtyText(l, c.requested)})</span>
                  {short && " · ส่งไม่ครบ"}
                </span>
              </div>
            );
          })}
          {form.declined.map((d) => (
            <div key={d.line.id} className="flex items-baseline justify-between gap-3 py-1.5 text-sm text-destructive">
              <span className="min-w-0 break-words">{d.line.skuName}</span>
              <span className="shrink-0">ไม่ส่ง · {d.reason || "ไม่ระบุเหตุผล"}</span>
            </div>
          ))}
          <p className="mt-1 text-[13px] text-muted-foreground">ใบนี้จะขึ้นป้าย “ครัวกลางส่งไม่ครบ” ถ้ามีรายการที่ไม่ส่ง หรือส่งน้อยกว่าที่ขอเกิน 10%</p>
        </section>
      )}

      {form.lines.some((l) => l.actualQty <= 0) && (
        <section className="rounded-2xl border border-border bg-card p-3 text-sm shadow-card">
          <h3 className="font-semibold">ใส่ 0 ไว้ {form.lines.filter((l) => l.actualQty <= 0).length} รายการ</h3>
          <p className="text-muted-foreground">{form.lines.filter((l) => l.actualQty <= 0).map((l) => l.skuName).join(", ")} — จะถือว่าส่งไม่ได้ สาขาจะเห็นว่าครัวไม่ได้ส่ง</p>
        </section>
      )}

      {same > 0 && (
        <section className="rounded-2xl border border-border bg-card p-3 shadow-card">
          <button type="button" onClick={() => setShowSame((s) => !s)} className="flex w-full items-center justify-between text-left">
            <span>
              <span className="block text-sm font-semibold">ตรงตามที่ขอ</span>
              <span className="block text-[13px] text-muted-foreground">{same} รายการ</span>
            </span>
            <ChevronDown className={cn("h-4 w-4 transition-transform", showSame && "rotate-180")} />
          </button>
          {showSame && (
            <ul className="mt-2 flex flex-col gap-1 text-sm">
              {form.lines
                .filter((l) => l.trLineId && !changedIds.has(l.id))
                .map((l) => (
                  <li key={l.id} className="flex justify-between gap-3">
                    <span className="break-words">{l.skuName}</span>
                    <span className="shrink-0 font-mono">{qtyText(l, l.actualQty)}</span>
                  </li>
                ))}
            </ul>
          )}
        </section>
      )}
      {form.lines.some((l) => !l.trLineId && l.actualQty > 0) && (
        <section className="rounded-2xl border border-border bg-card p-3 text-sm shadow-card">
          <h3 className="mb-1 font-semibold">ครัวเพิ่มเอง</h3>
          {form.lines
            .filter((l) => !l.trLineId && l.actualQty > 0)
            .map((l) => (
              <div key={l.id} className="flex justify-between gap-3 py-1">
                <span className="break-words">{l.skuName}</span>
                <span className="shrink-0 font-mono">{qtyText(l, l.actualQty)}</span>
              </div>
            ))}
        </section>
      )}

      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        หมายเหตุถึงสาขา (ถ้ามี)
        <Input value={form.notes} onChange={(e) => onNotes(e.target.value)} onBlur={(e) => onNotesDone?.(e.target.value)} placeholder="เช่น น้ำมันชิโอะ ส่งพรุ่งนี้" className="h-11 font-normal" />
      </label>

      <ActionFooter
        tour="to-send"
        title={`${sending.length} รายการ · ${baht(value)}`}
        sub={check.lotMismatch.length ? "แก้ล็อตให้ครบก่อน แล้วค่อยส่ง" : check.overStock.length ? "ยังส่งได้ ถ้าตั้งใจส่งเกินสต๊อก" : `ส่งให้ ${form.branchName}`}
        action="ส่งให้สาขา"
        busy={busy}
        disabled={check.lotMismatch.length > 0 || sending.length === 0}
        onAction={onSend}
      />
    </div>
  );
}

// ─── Sent ───

export function SentDone({
  toNumber,
  branchName,
  count,
  value,
  declined,
  message,
  next,
  onNext,
  onHome,
  onPrint,
}: {
  toNumber: string;
  branchName: string;
  count: number;
  value: number;
  declined: { name: string; reason: string }[];
  message: string;
  next?: PendingTR;
  onNext: () => void;
  onHome: () => void;
  onPrint: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 py-6">
      <div className="flex h-16 w-16 items-center justify-center self-center rounded-full bg-success-soft">
        <Check className="h-8 w-8 text-success" />
      </div>
      <div className="text-center">
        <h2 className="text-xl font-bold">ส่งให้ {branchName} แล้ว</h2>
        <p className="text-sm text-muted-foreground">
          <span className="font-mono">{toNumber}</span> · {count} รายการ · {baht(value)}
        </p>
      </div>
      <div className="rounded-2xl border border-border bg-card p-3 text-sm leading-relaxed shadow-card">
        สาขาจะเห็นใบนี้ใน <b>รับของ → รอรับจากครัวกลาง</b>
        <br />
        สต๊อกของครัวหักออกให้แล้ว
        {declined.length > 0 && (
          <>
            <br />
            ใบนี้ขึ้นป้าย <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[13px] font-semibold text-brand">ครัวกลางส่งไม่ครบ {declined.length}</span> ({declined.map((d) => `${d.name} · ${d.reason || "ไม่ระบุ"}`).join(", ")})
          </>
        )}
      </div>
      <Button variant="outline" className="h-12 font-semibold" onClick={onPrint}>
        <Printer className="h-4 w-4" /> พิมพ์ใบโอน (แนบไปกับของ)
      </Button>
      <Button
        variant="outline"
        className="h-12"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(message);
            setCopied(true);
            toast.success("คัดลอกแล้ว ไปวางในไลน์สาขาได้เลย");
          } catch {
            toast.error("คัดลอกไม่ได้");
          }
        }}
      >
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} คัดลอกข้อความส่งไลน์สาขา
      </Button>
      {next && (
        <div className="mt-2 flex items-center gap-3 rounded-2xl border border-border bg-card p-3 shadow-card">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] text-muted-foreground">ใบต่อไป</div>
            <div className="text-[15px] font-bold">
              {next.branchName} · {needWhen(next.requiredDate).text}
            </div>
          </div>
          <Button variant="brand" className="h-11" onClick={onNext}>
            จัดต่อเลย
          </Button>
        </div>
      )}
      <Button variant="ghost" className="h-11" onClick={onHome}>
        กลับหน้าแรก
      </Button>
    </div>
  );
}

// ─── All orders ───

export interface OrderDetail {
  lines: TOLine[];
  receivedBySku: Map<string, number> | null;
  declined: { name: string; qty: number; uom: string; reason: string }[];
}

export type Kind = "all" | "waiting" | "kitchen" | "branch" | "cancelled";
export const kindLabel: Record<Kind, string> = { all: "ทั้งหมด", waiting: "รอสาขารับ", kitchen: "ครัวกลางส่งไม่ครบ", branch: "สาขารับไม่ครบ", cancelled: "ยกเลิก" };
export function ofKind(r: TOHistoryRow, k: Kind) {
  if (k === "all") return r.status !== "Draft";
  if (k === "waiting") return r.status === "Sent";
  if (k === "kitchen") return r.kitchenShort > 0;
  if (k === "branch") return r.branchShort > 0;
  return r.status === "Cancelled" || r.status === "Declined";
}

export function TransferHistory({
  rows,
  loading,
  branches,
  branchIds,
  onBranches,
  range,
  onRange,
  kind,
  onKind,
  staleDrafts,
  can,
  loadDetail,
  onEditSent,
  onCancel,
  onDelete,
  onDiscardDrafts,
  onPrint,
  onBack,
  openId,
  packSizeOf,
}: {
  packSizeOf: (skuId: string) => number;
  rows: TOHistoryRow[];
  loading: boolean;
  branches: { id: string; name: string }[];
  branchIds: string[];
  onBranches: (ids: string[]) => void;
  range: { from: string; to: string; label: string };
  onRange: (r: "7" | "30" | "this" | "last") => void;
  kind: Kind;
  onKind: (k: Kind) => void;
  staleDrafts: TOHistoryRow[];
  can: { editSent: boolean; cancel: boolean; remove: boolean; discard: boolean };
  loadDetail: (row: TOHistoryRow) => Promise<OrderDetail>;
  onEditSent: (row: TOHistoryRow) => void;
  onCancel: (row: TOHistoryRow) => void;
  onDelete: (row: TOHistoryRow) => void;
  onDiscardDrafts: () => void;
  onPrint: (row: TOHistoryRow, d: OrderDetail) => void;
  onBack: () => void;
  openId?: string;
}) {
  const [open, setOpen] = useState<string | null>(openId ?? null);
  const [confirmDrafts, setConfirmDrafts] = useState(false);
  const [showDrafts, setShowDrafts] = useState(false);
  const shown = rows.filter((r) => ofKind(r, kind));
  const byDay = new Map<string, TOHistoryRow[]>();
  for (const r of shown) {
    const day = (r.status === "Draft" ? r.createdAt : r.updatedAt).slice(0, 10);
    byDay.set(day, [...(byDay.get(day) || []), r]);
  }
  const chip = (on: boolean) => cn("min-h-[40px] rounded-full border px-4 text-sm", on ? "border-primary bg-primary font-semibold text-primary-foreground" : "border-border bg-card");
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onBack} className="-ml-2 inline-flex min-h-[44px] items-center gap-1 rounded-full px-2 text-sm text-muted-foreground hover:text-foreground">
          <ChevronRight className="h-4 w-4 rotate-180" /> โอนสินค้า
        </button>
      </div>
      <h2 className="text-xl font-bold">ใบโอนทั้งหมด</h2>
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" className={chip(branchIds.length === 0)} onClick={() => onBranches([])}>
          ทุกสาขา
        </button>
        {branches.map((b) => (
          <button key={b.id} type="button" aria-pressed={branchIds.includes(b.id)} className={chip(branchIds.includes(b.id))} onClick={() => onBranches(branchIds.includes(b.id) ? branchIds.filter((x) => x !== b.id) : [...branchIds, b.id])}>
            {b.name}
          </button>
        ))}
        <span className="mx-1 hidden h-7 w-px bg-border sm:block" />
        {(
          [
            ["7", "7 วัน"],
            ["30", "30 วัน"],
            ["this", "เดือนนี้"],
            ["last", "เดือนก่อน"],
          ] as const
        ).map(([k, t]) => (
          <button key={k} type="button" className={chip(range.label === t)} onClick={() => onRange(k)}>
            {t}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(kindLabel) as Kind[]).map((k) => (
          <button key={k} type="button" aria-pressed={kind === k} className={chip(kind === k)} onClick={() => onKind(k)}>
            {kindLabel[k]} {loading ? "" : rows.filter((r) => ofKind(r, k)).length}
          </button>
        ))}
      </div>

      {can.discard && staleDrafts.length > 0 && (
        <div className="flex flex-col gap-2 rounded-2xl border border-warning/30 bg-warning-soft/60 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-0 flex-1 text-sm">
              <b>จัดค้างไว้แต่ไม่ได้ส่ง {staleDrafts.length} ใบ</b> <span className="text-warning">(เก่ากว่า 2 วัน · ไม่เคยหักสต๊อก)</span>
            </div>
            <Button variant="outline" className="h-10" onClick={() => setShowDrafts((s) => !s)}>
              {showDrafts ? "ซ่อน" : "ดูรายการ"}
            </Button>
            <Button className="h-10" onClick={() => setConfirmDrafts(true)}>
              ทิ้งทั้งหมด
            </Button>
          </div>
          {showDrafts && (
            <ul className="text-sm">
              {staleDrafts.map((d) => (
                <li key={d.id} className="flex justify-between gap-3 py-0.5">
                  <span>
                    <span className="font-mono">{d.toNumber}</span> · {d.branchName}
                  </span>
                  <span className="text-muted-foreground">{thaiDay(d.createdAt.slice(0, 10))}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {loading ? (
        <div className="h-40 animate-pulse rounded-2xl bg-secondary" />
      ) : shown.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">ไม่มีใบโอนในช่วงนี้</div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
          {[...byDay.entries()].map(([day, list]) => (
            <div key={day}>
              <div className="bg-secondary/60 px-4 py-1.5 text-[13px] font-semibold text-muted-foreground">{thaiDay(day)}</div>
              {list.map((r) => (
                <HistoryRow
                  key={r.id}
                  row={r}
                  open={open === r.id}
                  onToggle={() => setOpen((o) => (o === r.id ? null : r.id))}
                  can={can}
                  loadDetail={loadDetail}
                  onEditSent={onEditSent}
                  onCancel={onCancel}
                  onDelete={onDelete}
                  onPrint={onPrint}
                  packSizeOf={packSizeOf}
                />
              ))}
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={confirmDrafts}
        onOpenChange={setConfirmDrafts}
        title={`ทิ้งใบที่จัดค้างไว้ ${staleDrafts.length} ใบ?`}
        description="ใบเหล่านี้ยังไม่เคยส่งและไม่เคยหักสต๊อก ใบขอเบิกที่ยังไม่มีใครส่ง จะกลับไปรอในคิว"
        confirmLabel="ทิ้งทั้งหมด"
        cancelLabel="ยกเลิก"
        variant="destructive"
        onConfirm={() => {
          setConfirmDrafts(false);
          onDiscardDrafts();
        }}
      />
    </div>
  );
}

function HistoryRow({
  row,
  open,
  onToggle,
  can,
  loadDetail,
  onEditSent,
  onCancel,
  onDelete,
  onPrint,
  packSizeOf,
}: {
  packSizeOf: (skuId: string) => number;
  row: TOHistoryRow;
  open: boolean;
  onToggle: () => void;
  can: { editSent: boolean; cancel: boolean; remove: boolean };
  loadDetail: (row: TOHistoryRow) => Promise<OrderDetail>;
  onEditSent: (row: TOHistoryRow) => void;
  onCancel: (row: TOHistoryRow) => void;
  onDelete: (row: TOHistoryRow) => void;
  onPrint: (row: TOHistoryRow, d: OrderDetail) => void;
}) {
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  useEffect(() => {
    if (open && !detail) loadDetail(row).then(setDetail);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const received = row.status === "Received" || row.status === "Partially Received";
  return (
    <div className="border-t border-border first:border-t-0">
      <button type="button" onClick={onToggle} aria-expanded={open} className="grid w-full grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 px-4 py-3 text-left hover:bg-secondary/40 lg:grid-cols-[150px_1fr_110px_120px_auto_20px]">
        <span className="font-mono text-sm lg:order-none">{row.toNumber}</span>
        <span className="col-span-2 row-start-2 text-sm lg:col-span-1 lg:row-start-auto">
          <b>{row.branchName}</b>{" "}
          <span className="text-muted-foreground">
            · {row.status === "Draft" ? "ยังไม่ได้ส่ง" : `ส่ง ${time(row.updatedAt)}`}
            {row.trRef !== "—" && ` · ตามใบขอ ${row.trRef}`}
          </span>
        </span>
        <span className="hidden text-right font-mono text-sm lg:block">{row.itemCount} รายการ</span>
        <span className="hidden text-right font-mono text-sm lg:block">{baht(row.totalValue)}</span>
        <span className="col-start-2 row-start-1 lg:col-start-auto lg:row-start-auto">
          <Badges row={row} />
        </span>
        <ChevronDown className={cn("hidden h-4 w-4 text-muted-foreground transition-transform lg:block", open && "rotate-180")} />
      </button>
      {open && (
        <div className="flex flex-col gap-2 px-4 pb-3">
          {!detail ? (
            <div className="h-16 animate-pulse rounded-xl bg-secondary" />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full min-w-[560px] table-fixed text-sm">
                <colgroup>
                  <col />
                  <col style={{ width: "110px" }} />
                  <col style={{ width: "110px" }} />
                  <col style={{ width: "110px" }} />
                  <col style={{ width: "190px" }} />
                </colgroup>
                <thead>
                  <tr className="bg-secondary/60 text-left text-[13px] text-muted-foreground">
                    <th className="px-3 py-2 font-medium">สินค้า</th>
                    <th className="px-3 py-2 text-right font-medium">สาขาขอ</th>
                    <th className="px-3 py-2 text-right font-medium">ครัวส่ง</th>
                    <th className="px-3 py-2 text-right font-medium">สาขารับ</th>
                    <th className="px-3 py-2 text-right font-medium">ผล</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.lines.map((l) => {
                    const sent = sentQtyOf(l);
                    const got = detail.receivedBySku?.get(l.skuId) ?? 0;
                    const kitchenShort = !!l.trLineId && kitchenSentShort(l, packSizeOf(l.skuId));
                    const branchShort = received && isShort(got, sent);
                    const diff = sent > 0 ? Math.round(((got - sent) / sent) * 100) : 0;
                    return (
                      <tr key={l.id} className="border-t border-border">
                        <td className="break-words px-3 py-2" title={l.skuName}>
                          {l.skuName}
                          {l.note && <span className="block truncate text-[13px] text-muted-foreground">{l.note}</span>}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-muted-foreground">{l.trLineId ? num(l.plannedQty) : "—"}</td>
                        <td className="px-3 py-2 text-right font-mono">{num(sent)}</td>
                        <td className="px-3 py-2 text-right font-mono">{received ? num(got) : "—"}</td>
                        <td className={cn("px-3 py-2 text-right text-[13px]", branchShort ? "font-semibold text-destructive" : kitchenShort ? "font-semibold text-brand" : "text-muted-foreground")}>
                          {branchShort
                            ? `สาขารับขาด ${num(sent - got)} ${l.uom} (${Math.abs(diff)}%)`
                            : kitchenShort
                              ? "ครัวกลางส่งไม่ครบ"
                              : received && Math.abs(got - sent) > 0.5
                                ? `ต่าง ${Math.abs(diff)}% · นับว่าครบ`
                                : received
                                  ? "ครบ"
                                  : ""}
                        </td>
                      </tr>
                    );
                  })}
                  {detail.declined.map((d) => (
                    <tr key={d.name} className="border-t border-border bg-secondary/40">
                      <td className="truncate px-3 py-2 text-muted-foreground line-through">{d.name}</td>
                      <td className="px-3 py-2 text-right font-mono text-muted-foreground">{num(d.qty)}</td>
                      <td className="px-3 py-2 text-right font-mono">0</td>
                      <td className="px-3 py-2 text-right">—</td>
                      <td className="px-3 py-2 text-right text-[13px] font-semibold text-brand">ไม่ส่ง · {d.reason || "ไม่ระบุ"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {row.notes && <p className="text-sm text-muted-foreground">หมายเหตุ: {row.notes}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            {detail && (
              <Button variant="outline" className="h-10" onClick={() => onPrint(row, detail)}>
                <Printer className="h-4 w-4" /> พิมพ์
              </Button>
            )}
            {can.editSent && (row.status === "Sent" || row.status === "Received" || row.status === "Partially Received") && (
              <Button variant="outline" className="h-10" onClick={() => onEditSent(row)}>
                <Pencil className="h-4 w-4" /> แก้ใบที่ส่งแล้ว
              </Button>
            )}
            {can.cancel && row.status === "Sent" && (
              <Button variant="outline" className="h-10" onClick={() => onCancel(row)}>
                <Undo2 className="h-4 w-4" /> ยกเลิกใบนี้
              </Button>
            )}
            {can.remove && (
              <Button variant="ghost" className="h-10 text-destructive hover:text-destructive" onClick={() => onDelete(row)}>
                ลบ
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Printing and the LINE message ───

export interface SlipLine {
  name: string;
  packs: number | null;
  qty: number;
  uom: string;
  note?: string;
}

/** A plain packing slip in a new window, printed straight away */
export function printSlip(p: { toNumber: string; branchName: string; date: string; lines: SlipLine[]; declined: { name: string; reason: string }[]; notes?: string }) {
  const w = window.open("", "_blank", "width=800,height=900");
  if (!w) {
    toast.error("เบราว์เซอร์บล็อกหน้าต่างพิมพ์ ลองอนุญาตป๊อปอัป");
    return;
  }
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const rows = p.lines
    .map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.name)}${l.note ? `<div class="n">${esc(l.note)}</div>` : ""}</td><td class="r">${l.packs != null ? num(l.packs) : ""}</td><td class="r">${num(l.qty)} ${esc(l.uom)}</td><td class="c">☐</td></tr>`)
    .join("");
  const declined = p.declined.length ? `<p><b>ไม่ได้ส่ง:</b> ${p.declined.map((d) => `${esc(d.name)} (${esc(d.reason || "ไม่ระบุ")})`).join(", ")}</p>` : "";
  w.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${esc(p.toNumber)}</title>
<style>body{font-family:system-ui,sans-serif;margin:24px;color:#111}h1{font-size:20px;margin:0}table{width:100%;border-collapse:collapse;margin-top:12px;font-size:14px}th,td{border-bottom:1px solid #ccc;padding:6px 4px;text-align:left;vertical-align:top}.r{text-align:right}.c{text-align:center}.n{font-size:12px;color:#555}.sig{display:flex;gap:40px;margin-top:40px}.sig div{flex:1;border-top:1px solid #333;padding-top:4px;font-size:13px}</style></head>
<body><h1>ใบโอนสินค้า ${esc(p.toNumber)}</h1><div>ครัวกลาง → <b>${esc(p.branchName)}</b> · ส่ง ${esc(thaiDay(p.date))}</div>
${p.notes ? `<p>หมายเหตุ: ${esc(p.notes)}</p>` : ""}
<table><thead><tr><th>#</th><th>สินค้า</th><th class="r">แพ็ค</th><th class="r">จำนวน</th><th class="c">รับ</th></tr></thead><tbody>${rows}</tbody></table>${declined}
<div class="sig"><div>ผู้ส่ง (ครัวกลาง)</div><div>ผู้รับ (สาขา)</div></div>
<script>window.onload=function(){window.print()}</script></body></html>`);
  w.document.close();
}

export function sentMessage(p: { branchName: string; date: string; toNumber: string; lines: SlipLine[]; declined: { name: string; reason: string }[]; notes?: string }) {
  const out = [`ครัวกลางส่งของให้ ${p.branchName} ${thaiDay(p.date)} (${p.toNumber})`];
  for (const l of p.lines) out.push(`- ${l.name} ${l.packs != null ? `${num(l.packs)} แพ็ค (${num(l.qty)} ${l.uom})` : `${num(l.qty)} ${l.uom}`}`);
  if (p.declined.length) out.push(`ไม่ได้ส่ง: ${p.declined.map((d) => `${d.name} (${d.reason || "ไม่ระบุ"})`).join(", ")}`);
  if (p.notes) out.push(`หมายเหตุ: ${p.notes}`);
  return out.join("\n");
}

