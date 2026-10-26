import { useMemo, useState } from "react";
import { addDays, format } from "date-fns";
import { ChevronDown, ChevronRight, Plus, Search, X } from "lucide-react";
import type { SKU } from "@/types/sku";
import type { GoodsReceipt } from "@/types/goods-receipt";
import { billsOf, noteWithoutPlace, perUnitText, qtyText, stalePrices, type Bill } from "@/lib/goods-receipt";
import { baht } from "@/components/receive/parts";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { thaiDay } from "@/components/sales/SalesDays";
import { cn } from "@/lib/utils";

const iso = (d: Date) => format(d, "yyyy-MM-dd");
const chip = (on: boolean) => cn("min-h-[44px] rounded-xl border px-3 text-sm", on ? "border-primary bg-primary font-semibold text-primary-foreground" : "border-border bg-card");

// ─── Left column: day, supplier, today's bills ───

export function GRSide({
  date,
  onDate,
  suppliers,
  topIds,
  bills,
  supplierName,
  canEdit,
  onSupplier,
  onOther,
  onOpenBill,
  onHistory,
}: {
  date: string;
  onDate: (d: string) => void;
  suppliers: { id: string; name: string }[];
  /** Suppliers bought from most often, first */
  topIds: string[];
  /** Bills of the chosen day */
  bills: Bill[];
  supplierName: (id: string) => string;
  canEdit: boolean;
  onSupplier: (id: string) => void;
  onOther: () => void;
  onOpenBill: (b: Bill) => void;
  onHistory: () => void;
}) {
  const today = iso(new Date());
  const yesterday = iso(addDays(new Date(), -1));
  const [finding, setFinding] = useState(false);
  const [q, setQ] = useState("");
  const top = topIds.slice(0, 4).filter((id) => suppliers.some((s) => s.id === id));
  const found = suppliers.filter((s) => s.name.toLowerCase().includes(q.toLowerCase())).slice(0, 30);
  return (
    <div className="flex flex-col gap-4">
      <section data-tour="gr-date">
        <h2 className="mb-1.5 text-[13px] font-bold">วันที่รับ</h2>
        <div className="flex gap-1.5">
          <button type="button" className={cn(chip(date === today), "flex-1")} onClick={() => onDate(today)}>
            วันนี้
          </button>
          <button type="button" className={cn(chip(date === yesterday), "flex-1")} onClick={() => onDate(yesterday)}>
            เมื่อวาน
          </button>
          <label className={cn(chip(date !== today && date !== yesterday), "relative flex items-center")}>
            {date !== today && date !== yesterday ? thaiDay(date) : "วันอื่น"}
            <input type="date" max={today} value={date} onChange={(e) => e.target.value && onDate(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" aria-label="เลือกวันที่รับ" />
          </label>
        </div>
      </section>

      {canEdit && (
        <section data-tour="gr-supplier" className="flex flex-col gap-1.5">
          <h2 className="text-[13px] font-bold">จากเจ้าไหน</h2>
          {top.map((id, i) => (
            <button key={id} type="button" data-tour={i === 0 ? "gr-first" : undefined} onClick={() => onSupplier(id)} className="flex min-h-[48px] items-center justify-between rounded-xl border border-border bg-card px-3 text-left text-[15px] font-semibold hover:bg-secondary/60">
              {supplierName(id)}
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </button>
          ))}
          {finding ? (
            <div className="flex flex-col gap-1 rounded-xl border border-border bg-card p-2">
              <div className="flex items-center gap-1">
                <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นชื่อเจ้า" className="h-11" />
                <button type="button" aria-label="ปิด" onClick={() => setFinding(false)} className="flex h-11 w-11 items-center justify-center rounded-xl hover:bg-secondary">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <ul className="max-h-64 overflow-y-auto">
                {found.map((s) => (
                  <li key={s.id}>
                    <button type="button" onClick={() => onSupplier(s.id)} className="flex min-h-[44px] w-full items-center rounded-lg px-2 text-left text-sm hover:bg-secondary">
                      {s.name}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <button type="button" onClick={() => setFinding(true)} className="flex min-h-[48px] items-center gap-2 rounded-xl border border-border bg-card px-3 text-left text-sm text-muted-foreground hover:bg-secondary/60">
              <Search className="h-4 w-4" /> เจ้าอื่น…
            </button>
          )}
          <button type="button" onClick={onOther} className="min-h-[48px] rounded-xl border border-dashed border-border bg-card px-3 text-left text-sm hover:bg-secondary/60">
            ซื้อที่อื่น (ตลาด · ออนไลน์ · ของเคลม)
          </button>
        </section>
      )}

      <section className="flex flex-col gap-1.5">
        <h2 className="text-[13px] font-bold">บิล{date === today ? "วันนี้" : thaiDay(date)}</h2>
        {bills.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card px-4 py-4 text-sm text-muted-foreground">ยังไม่มี</div>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
            {bills.map((b) => (
              <li key={b.key}>
                <button type="button" onClick={() => onOpenBill(b)} className="flex min-h-[56px] w-full items-center gap-3 px-3 py-2 text-left hover:bg-secondary/60">
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-sm font-semibold">{b.place || supplierName(b.supplierId)}</span>
                    <span className="block text-[13px] text-muted-foreground">{b.lines.length} รายการ</span>
                  </span>
                  <span className="font-mono text-sm">{baht(b.total)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <Button variant="outline" className="h-11" onClick={onHistory}>
          ดูบิลย้อนหลัง
        </Button>
      </section>
    </div>
  );
}

// ─── History: receipts as bills ───

type RangeKey = "7" | "this" | "last" | "90";
export function rangeOf(k: RangeKey) {
  const now = new Date();
  if (k === "7") return { from: iso(addDays(now, -6)), to: iso(now) };
  if (k === "this") return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now) };
  if (k === "last") return { from: iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: iso(new Date(now.getFullYear(), now.getMonth(), 0)) };
  return { from: iso(addDays(now, -89)), to: iso(now) };
}

export function GRHistory({
  receipts,
  skus,
  supplierName,
  topIds,
  canEdit,
  openKey,
  fullHistory,
  loadingAll,
  onLoadAll,
  onBack,
  onEdit,
  onDeleteLines,
  onAddToBill,
  onUpdatePrices,
}: {
  receipts: GoodsReceipt[];
  skus: SKU[];
  supplierName: (id: string) => string;
  topIds: string[];
  canEdit: boolean;
  openKey?: string;
  fullHistory: boolean;
  loadingAll: boolean;
  onLoadAll: () => void;
  onBack: () => void;
  onEdit: (r: GoodsReceipt) => void;
  onDeleteLines: (ids: string[]) => Promise<void>;
  onAddToBill: (b: Bill) => void;
  /** Open this bill in Cost Center to update its prices together */
  onUpdatePrices?: (b: Bill) => void;
}) {
  const skuOf = useMemo(() => new Map(skus.map((s) => [s.id, s])), [skus]);
  const [who, setWho] = useState<string>("all");
  // A bill opened from another month starts on a range that shows it
  const [range, setRange] = useState<RangeKey>(() => (openKey && openKey.slice(0, 10) < rangeOf("this").from ? "90" : "this"));
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(openKey ?? null);
  const [showStale, setShowStale] = useState(false);
  const [confirm, setConfirm] = useState<{ title: string; ids: string[] } | null>(null);
  const { from, to } = rangeOf(range);

  const inRange = receipts.filter((r) => r.receiptDate >= from && r.receiptDate <= to);
  const matching = inRange.filter((r) => (who === "all" || r.supplierId === who) && (!q || (skuOf.get(r.skuId)?.name ?? "").toLowerCase().includes(q.toLowerCase())));
  const bills = billsOf(matching);
  const spend = matching.reduce((s, r) => s + (r.actualTotal || 0), 0);
  const over = matching.reduce((s, r) => s + (r.priceVariance || 0), 0);
  const late = matching.filter((r) => r.createdAt && format(new Date(r.createdAt), "yyyy-MM-dd") > r.receiptDate).length;
  const stale = useMemo(() => stalePrices(receipts), [receipts]);
  const byDay = new Map<string, Bill[]>();
  for (const b of bills) byDay.set(b.date, [...(byDay.get(b.date) || []), b]);
  const tab = (on: boolean) => cn("min-h-[40px] rounded-full border px-4 text-sm", on ? "border-primary bg-primary font-semibold text-primary-foreground" : "border-border bg-card");

  return (
    <div className="flex flex-col gap-3">
      <button type="button" onClick={onBack} className="-ml-2 inline-flex min-h-[44px] items-center gap-1 self-start rounded-full px-2 text-sm text-muted-foreground hover:text-foreground">
        <ChevronRight className="h-4 w-4 rotate-180" /> รับของเข้าครัว
      </button>
      <h2 className="text-xl font-bold">บิลรับของย้อนหลัง</h2>
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" className={tab(who === "all")} onClick={() => setWho("all")}>
          ทุกเจ้า
        </button>
        {topIds.slice(0, 4).map((id) => (
          <button key={id} type="button" className={tab(who === id)} onClick={() => setWho(id)}>
            {supplierName(id)}
          </button>
        ))}
        <span className="mx-1 hidden h-7 w-px bg-border sm:block" />
        {(
          [
            ["7", "7 วัน"],
            ["this", "เดือนนี้"],
            ["last", "เดือนก่อน"],
            ["90", "90 วัน"],
          ] as const
        ).map(([k, t]) => (
          <button key={k} type="button" className={tab(range === k)} onClick={() => setRange(k)}>
            {t}
          </button>
        ))}
        <div className="relative ml-auto w-full sm:w-[240px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นสินค้า" className="h-11 pl-9" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Stat label="ซื้อ" value={baht(spend)} sub={`${bills.length} บิล`} />
        <Stat label="เทียบมาตรฐาน" value={`${over >= 0 ? "+" : "−"}${baht(Math.abs(over))}`} sub={spend > 0 ? `${((over / spend) * 100).toFixed(1)}%` : ""} tone={over > 0 ? "bad" : "good"} />
        <Stat label="ใส่ย้อนหลัง" value={matching.length ? `${Math.round((late / matching.length) * 100)}%` : "—"} sub="ของรายการ" />
        <button type="button" onClick={() => setShowStale((s) => !s)} className="rounded-2xl border border-warning/30 bg-warning-soft/60 p-3 text-left">
          <div className="text-[13px] text-warning">ราคามาตรฐานเก่า</div>
          <div className="font-mono text-xl font-semibold text-warning">{stale.length} รายการ</div>
          <div className="text-[13px] text-warning">{showStale ? "ซ่อน" : "ดูรายการ"} ›</div>
        </button>
      </div>
      {showStale && stale.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-border bg-card text-sm shadow-card">
          {stale.map((s) => {
            const sku = skuOf.get(s.skuId);
            const uom = sku?.purchaseUom || sku?.usageUom || "";
            return (
              <div key={`${s.skuId}${s.supplierId}`} className="flex flex-wrap justify-between gap-x-3 border-t border-border px-3 py-2 first:border-0">
                <span className="min-w-0 break-words">
                  {sku?.name} <span className="text-muted-foreground">· {supplierName(s.supplierId)}</span>
                </span>
                <span className="font-mono">
                  จ่าย {perUnitText(s.paid, uom)} · มาตรฐาน {perUnitText(s.std, uom)} <b className={s.off > 0 ? "text-destructive" : "text-success"}>({s.off > 0 ? "+" : ""}{Math.round(s.off * 100)}%)</b>
                </span>
              </div>
            );
          })}
        </div>
      )}

      {bills.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">ไม่มีบิลในช่วงนี้</div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
          {[...byDay.entries()].map(([day, list]) => (
            <div key={day}>
              <div className="bg-secondary/60 px-4 py-1.5 text-[13px] font-semibold text-muted-foreground">{thaiDay(day)}</div>
              {list.map((b) => {
                const isOpen = open === b.key;
                return (
                  <div key={b.key} className="border-t border-border first:border-0">
                    <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : b.key)} className="grid w-full grid-cols-[1fr_auto_auto] items-center gap-3 px-4 py-3 text-left hover:bg-secondary/40">
                      <span className="min-w-0 text-sm">
                        <b>{b.place || supplierName(b.supplierId)}</b> <span className="text-muted-foreground">· {b.lines.length} รายการ</span>
                        {b.late && <span className="ml-2 rounded-full bg-secondary px-2 py-0.5 text-[12px] text-muted-foreground">ใส่ย้อนหลัง</span>}
                      </span>
                      <span className="text-right font-mono text-sm">
                        {baht(b.total)}
                        {Math.abs(b.variance) >= 1 && <span className={cn("ml-2", b.variance > 0 ? "text-destructive" : "text-success")}>{b.variance > 0 ? "+" : "−"}{baht(Math.abs(b.variance))}</span>}
                      </span>
                      <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", isOpen && "rotate-180")} />
                    </button>
                    {isOpen && (
                      <div className="px-4 pb-3">
                        <div className="overflow-x-auto rounded-xl border border-border">
                          <table className="w-full min-w-[560px] table-fixed text-sm">
                            <colgroup>
                              <col />
                              <col style={{ width: "120px" }} />
                              <col style={{ width: "110px" }} />
                              <col style={{ width: "110px" }} />
                              <col style={{ width: "100px" }} />
                              <col style={{ width: "96px" }} />
                            </colgroup>
                            <thead>
                              <tr className="bg-secondary/60 text-left text-[13px] text-muted-foreground">
                                <th className="px-3 py-2 font-medium">สินค้า</th>
                                <th className="px-3 py-2 text-right font-medium">รับ</th>
                                <th className="px-3 py-2 text-right font-medium">ยอดเงิน</th>
                                <th className="px-3 py-2 text-right font-medium">มาตรฐาน</th>
                                <th className="px-3 py-2 text-right font-medium">ต่าง</th>
                                <th />
                              </tr>
                            </thead>
                            <tbody>
                              {b.lines.map((r) => {
                                const sku = skuOf.get(r.skuId);
                                const note = noteWithoutPlace(r.note);
                                return (
                                  <tr key={r.id} className="border-t border-border">
                                    <td className="break-words px-3 py-2" title={sku?.name}>
                                      {sku?.name ?? "สินค้าที่ถูกลบ"}
                                      {note && <span className="block truncate text-[13px] text-muted-foreground">{note}</span>}
                                    </td>
                                    <td className="px-3 py-2 text-right font-mono">{qtyText(r.quantityReceived, sku?.purchaseUom || r.usageUom)}</td>
                                    <td className="px-3 py-2 text-right font-mono">{baht(r.actualTotal)}</td>
                                    <td className="px-3 py-2 text-right font-mono text-muted-foreground">{baht(r.standardPrice)}</td>
                                    <td className={cn("px-3 py-2 text-right font-mono", r.priceVariance > 0.5 ? "text-destructive" : r.priceVariance < -0.5 ? "text-success" : "text-muted-foreground")}>
                                      {Math.abs(r.priceVariance) < 0.5 ? "—" : `${r.priceVariance > 0 ? "+" : "−"}${baht(Math.abs(r.priceVariance))}`}
                                    </td>
                                    <td className="px-2 py-1 text-right">
                                      {canEdit && (
                                        <span className="flex justify-end gap-1">
                                          <button type="button" onClick={() => onEdit(r)} className="min-h-[36px] rounded-lg px-2 text-sm text-primary hover:bg-secondary">
                                            แก้
                                          </button>
                                          <button type="button" aria-label={`ลบ ${sku?.name}`} onClick={() => setConfirm({ title: `ลบ ${sku?.name ?? "รายการนี้"}?`, ids: [r.id] })} className="min-h-[36px] rounded-lg px-2 text-sm text-muted-foreground hover:text-destructive">
                                            ลบ
                                          </button>
                                        </span>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        {canEdit && (
                          <div className="mt-2 flex flex-wrap justify-end gap-2">
                            {!b.place && onUpdatePrices && b.lines.some((r) => r.standardPrice > 0 && Math.abs(r.actualTotal / r.standardPrice - 1) > 0.1) && (
                              <Button variant="outline" className="h-10" onClick={() => onUpdatePrices(b)}>
                                อัปเดตราคาจากบิลนี้ ›
                              </Button>
                            )}
                            {!b.place && (
                              <Button variant="outline" className="h-10" onClick={() => onAddToBill(b)}>
                                <Plus className="h-4 w-4" /> เพิ่มรายการในบิลนี้
                              </Button>
                            )}
                            <Button variant="ghost" className="h-10 text-destructive hover:text-destructive" onClick={() => setConfirm({ title: `ลบทั้งบิล ${b.place || supplierName(b.supplierId)} (${b.lines.length} รายการ)?`, ids: b.lines.map((l) => l.id) })}>
                              ลบทั้งบิล
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
      {range === "90" && !fullHistory && (
        <Button variant="outline" className="h-11 self-start" loading={loadingAll} onClick={onLoadAll}>
          โหลดเก่ากว่า 90 วัน
        </Button>
      )}

      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm?.title ?? ""}
        description="สต๊อกวัตถุดิบในครัวจะลดลงตามที่ลบ"
        confirmLabel="ลบ"
        cancelLabel="ไม่ใช่"
        variant="destructive"
        onConfirm={async () => {
          const c = confirm;
          setConfirm(null);
          if (c) await onDeleteLines(c.ids);
        }}
      />
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "bad" | "good" }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-3 shadow-card">
      <div className="text-[13px] text-muted-foreground">{label}</div>
      <div className={cn("font-mono text-xl font-semibold", tone === "bad" && "text-destructive", tone === "good" && "text-success")}>{value}</div>
      {sub && <div className="text-[13px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

/** Change one saved line: quantity, the bill's amount, note */
export function EditLineDialog({ r, sku, onCancel, onSave }: { r: GoodsReceipt; sku: SKU | undefined; onCancel: () => void; onSave: (qty: number, total: number, note: string) => void }) {
  const [qty, setQty] = useState(String(r.quantityReceived));
  const [total, setTotal] = useState(String(r.actualTotal));
  const [note, setNote] = useState(noteWithoutPlace(r.note));
  const uom = sku?.purchaseUom || r.usageUom;
  const n = (v: string) => Math.max(0, Number(v.replace(/,/g, "")) || 0);
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 md:items-center" onClick={onCancel}>
      <div role="dialog" aria-label={`แก้ ${sku?.name}`} className="flex w-full flex-col gap-3 rounded-t-2xl bg-card p-4 shadow-raised md:max-w-md md:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold">{sku?.name}</h2>
        <p className="text-sm text-muted-foreground">{thaiDay(r.receiptDate)}</p>
        <label className="flex items-center justify-between gap-3 text-sm">
          รับจริง ({uom})
          <Input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} className="h-11 w-[160px] text-right font-mono text-base" />
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          ยอดเงินในบิล (฿)
          <Input inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} className="h-11 w-[160px] text-right font-mono text-base" />
        </label>
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="หมายเหตุ" className="h-11" />
        <div className="flex gap-2 pb-[env(safe-area-inset-bottom)]">
          <Button variant="outline" className="h-12 flex-1" onClick={onCancel}>
            ยกเลิก
          </Button>
          <Button variant="brand" className="h-12 flex-[2]" disabled={n(qty) <= 0} onClick={() => onSave(n(qty), n(total), note)}>
            บันทึก
          </Button>
        </div>
      </div>
    </div>
  );
}
