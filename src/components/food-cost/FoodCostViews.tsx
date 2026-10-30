import { useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { useFitsWidth } from "@/hooks/use-fits-width";
import { FC_TARGET, type ActualRow, type Attention, type DayRow, type MenuRow, type SkuRow } from "@/lib/food-cost";
import { cn } from "@/lib/utils";

export const n0 = (n: number) => Math.round(n).toLocaleString("th-TH");
export const baht = (n: number) => `${n < 0 ? "−" : ""}฿${n0(Math.abs(n))}`;
const signedBaht = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}฿${n0(Math.abs(n))}`;
const pctTone = (p: number) => (p > FC_TARGET ? "text-destructive" : p > 30 ? "text-warning" : "text-success");
/** Less than the recipe (cheaper) is good: green; more is red */
const varTone = (n: number | null) => (n === null || Math.abs(n) < 0.5 ? "text-muted-foreground" : n < 0 ? "text-success" : "text-destructive");
const thaiDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("th-TH", { day: "numeric", month: "short" });

// ─── Things worth a look ───

export function AttentionBox({ items, onSku, onMenu }: { items: Attention[]; onSku: (id: string) => void; onMenu: (code: string) => void }) {
  if (!items.length) return null;
  const dot = { red: "bg-destructive", amber: "bg-warning", info: "bg-muted-foreground" } as const;
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card">
      <h2 className="px-4 pt-3 text-base font-bold">
        เรื่องที่ควรดู <span className="text-sm font-normal text-muted-foreground">· แตะเพื่อดูที่มาหรือไปแก้ที่ต้นทาง</span>
      </h2>
      {items.map((a) => {
        const go = a.skuId ? () => onSku(a.skuId!) : a.menuCode ? () => onMenu(a.menuCode!) : undefined;
        const body = (
          <>
            <span className={cn("mt-2 h-2 w-2 shrink-0 rounded-full", dot[a.tone])} />
            <span className="min-w-0 flex-1">
              <span className="block break-words font-semibold">{a.title}</span>
              <span className="block break-words text-sm text-muted-foreground">{a.detail}</span>
            </span>
            {go && <span className="shrink-0 self-center text-sm text-brand">{a.menuCode ? "เปิดเมนู ›" : "ดูที่มา ›"}</span>}
          </>
        );
        return go ? (
          <button key={a.key} type="button" onClick={go} className="flex w-full items-start gap-3 border-t border-border px-4 py-3 text-left hover:bg-secondary/50 first-of-type:border-t-0">
            {body}
          </button>
        ) : (
          <div key={a.key} className="flex items-start gap-3 border-t border-border px-4 py-3">
            {body}
          </div>
        );
      })}
    </section>
  );
}

// ─── Menus ───

type MenuSort = "pct" | "revenue" | "qty";
export function MenuView({ rows, onOpen }: { rows: MenuRow[]; onOpen: (code: string) => void }) {
  const [sort, setSort] = useState<MenuSort>("pct");
  const [overOnly, setOverOnly] = useState(false);
  const [measure, wide] = useFitsWidth(760);
  const shown = rows
    .filter((r) => !overOnly || r.pct > FC_TARGET)
    .sort((a, b) => (sort === "pct" ? b.pct - a.pct : sort === "revenue" ? b.revenue - a.revenue : b.qty - a.qty));
  const chip = (on: boolean) => cn("inline-flex min-h-[36px] items-center rounded-full border px-3 text-sm", on ? "border-primary bg-primary font-semibold text-primary-foreground" : "border-border bg-card");
  const bar = (p: number) => (
    <span className="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-secondary">
      <span className={cn("block h-full rounded-full", p > FC_TARGET ? "bg-destructive" : p > 30 ? "bg-warning" : "bg-success")} style={{ width: `${Math.min(100, p * 2)}%` }} />
    </span>
  );
  return (
    <div ref={measure} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">เรียงตาม</span>
        <button type="button" className={chip(sort === "pct")} onClick={() => setSort("pct")}>% ต้นทุนสูงสุด</button>
        <button type="button" className={chip(sort === "revenue")} onClick={() => setSort("revenue")}>ยอดขาย</button>
        <button type="button" className={chip(sort === "qty")} onClick={() => setSort("qty")}>ขายได้</button>
        <button type="button" className={cn(chip(overOnly), "ml-auto")} onClick={() => setOverOnly((v) => !v)}>
          เฉพาะเกินเป้า {FC_TARGET}%
        </button>
      </div>
      {!shown.length ? (
        <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">ไม่มีเมนูในช่วงนี้</p>
      ) : wide ? (
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <table className="w-full table-fixed text-sm">
            <colgroup>
              <col />
              <col style={{ width: "150px" }} />
              <col style={{ width: "90px" }} />
              <col style={{ width: "120px" }} />
              <col style={{ width: "130px" }} />
              <col style={{ width: "150px" }} />
              <col style={{ width: "110px" }} />
            </colgroup>
            <thead className="bg-secondary/60 text-left text-[13px] text-muted-foreground">
              <tr>
                <th className="px-3 py-2.5 font-medium">เมนู</th>
                <th className="px-3 py-2.5 font-medium">หมวด</th>
                <th className="px-3 py-2.5 text-right font-medium">ขายได้</th>
                <th className="px-3 py-2.5 text-right font-medium">ยอดขาย</th>
                <th className="px-3 py-2.5 text-right font-medium">ต้นทุนตามสูตร</th>
                <th className="px-3 py-2.5 font-medium">% ต้นทุน</th>
                <th className="px-3 py-2.5 text-right font-medium">ต้นทุน/ที่</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.code} onClick={() => onOpen(r.code)} className="cursor-pointer border-t border-border hover:bg-secondary/40">
                  <td className="break-words px-3 py-2.5">
                    <span className="font-semibold">{r.name}</span> <span className="font-mono text-xs text-muted-foreground">{r.code}</span>
                  </td>
                  <td className="break-words px-3 py-2.5 text-muted-foreground">{r.category || "—"}</td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums">{n0(r.qty)}</td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums">{baht(r.revenue)}</td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums">{baht(r.stdCost)}</td>
                  <td className="px-3 py-2.5">
                    <b className={cn("font-mono tabular-nums", pctTone(r.pct))}>{r.revenue > 0 ? `${r.pct.toFixed(1)}%` : "ไม่มีราคาขาย"}</b>
                    {r.revenue > 0 && bar(r.pct)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums">฿{r.perServing.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ul className="overflow-hidden rounded-2xl border border-border bg-card">
          {shown.map((r, i) => (
            <li key={r.code}>
              <button type="button" onClick={() => onOpen(r.code)} className={cn("flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-secondary/40", i > 0 && "border-t border-border")}>
                <span className="min-w-0 flex-1">
                  <span className="block break-words font-semibold">{r.name}</span>
                  <span className="block text-[13px] text-muted-foreground">
                    ขาย {n0(r.qty)} · ยอด {baht(r.revenue)} · ต้นทุน ฿{r.perServing.toFixed(2)}/ที่
                  </span>
                </span>
                <b className={cn("shrink-0 font-mono tabular-nums", pctTone(r.pct))}>{r.revenue > 0 ? `${r.pct.toFixed(1)}%` : "—"}</b>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">แตะเมนู = เปิดใน Cost Center แก้สูตรหรือราคาแล้วกลับมาที่นี่ · ต้นทุนรายเมนูไม่รวมรายการปรับ</p>
    </div>
  );
}

// ─── Ingredients ───

type IngSort = "var" | "cost";
export function IngredientView({ rows, actual, onOpen }: { rows: SkuRow[]; actual: ActualRow[] | null; onOpen: (id: string) => void }) {
  const [picked, setSort] = useState<IngSort>("var");
  // "Most off the recipe" needs the actual; without it the list is by cost
  const sort: IngSort = actual ? picked : "cost";
  const [type, setType] = useState<"all" | "RM" | "SM">("all");
  const [measure, wide] = useFitsWidth(actual ? 900 : 640);
  const list: (SkuRow & Partial<ActualRow>)[] = (actual ?? rows)
    .filter((r) => type === "all" || r.type === type)
    .slice()
    .sort((a, b) => (sort === "var" && actual ? Math.abs((b as ActualRow).totalVar ?? 0) - Math.abs((a as ActualRow).totalVar ?? 0) : b.stdCost - a.stdCost));
  const chip = (on: boolean) => cn("inline-flex min-h-[36px] items-center rounded-full border px-3 text-sm", on ? "border-primary bg-primary font-semibold text-primary-foreground" : "border-border bg-card");
  const pct = (r: SkuRow & Partial<ActualRow>) => (r.qtyVar != null && r.stdQty > 0 ? Math.round((r.qtyVar / r.stdQty) * 100) : null);
  const badge = (t: string) => <span className={cn("mr-1.5 rounded-md px-1.5 py-0.5 text-[11px] font-bold", t === "SM" ? "bg-foreground text-background" : "bg-brand-soft text-brand-soft-foreground")}>{t}</span>;
  return (
    <div ref={measure} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {actual && (
          <button type="button" className={chip(sort === "var")} onClick={() => setSort("var")}>ต่างจากสูตรมากสุด</button>
        )}
        <button type="button" className={chip(sort === "cost")} onClick={() => setSort("cost")}>ต้นทุนสูงสุด</button>
        <span className="mx-1 h-6 w-px bg-border" />
        <button type="button" className={chip(type === "all")} onClick={() => setType("all")}>ทั้งหมด</button>
        <button type="button" className={chip(type === "RM")} onClick={() => setType("RM")}>RM</button>
        <button type="button" className={chip(type === "SM")} onClick={() => setType("SM")}>SM</button>
      </div>
      {!list.length ? (
        <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">ไม่มีวัตถุดิบในช่วงนี้</p>
      ) : wide ? (
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <table className="w-full table-fixed text-sm">
            <colgroup>
              <col />
              <col style={{ width: "130px" }} />
              {actual ? (
                <>
                  <col style={{ width: "130px" }} />
                  <col style={{ width: "140px" }} />
                  <col style={{ width: "120px" }} />
                  <col style={{ width: "120px" }} />
                  <col style={{ width: "120px" }} />
                </>
              ) : (
                <>
                  <col style={{ width: "120px" }} />
                  <col style={{ width: "130px" }} />
                </>
              )}
            </colgroup>
            <thead className="bg-secondary/60 text-left text-[13px] text-muted-foreground">
              <tr>
                <th className="px-3 py-2.5 font-medium">วัตถุดิบ</th>
                <th className="px-3 py-2.5 text-right font-medium">ตามสูตร</th>
                {actual ? (
                  <>
                    <th className="px-3 py-2.5 text-right font-medium">ใช้จริง</th>
                    <th className="px-3 py-2.5 text-right font-medium">ต่าง (จำนวน)</th>
                    <th className="px-3 py-2.5 text-right font-medium">ต่างเพราะราคา</th>
                    <th className="px-3 py-2.5 text-right font-medium">ต่างเพราะใช้</th>
                    <th className="px-3 py-2.5 text-right font-medium">ต่างรวม</th>
                  </>
                ) : (
                  <>
                    <th className="px-3 py-2.5 text-right font-medium">฿/หน่วย</th>
                    <th className="px-3 py-2.5 text-right font-medium">ต้นทุนตามสูตร</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {list.map((r) => {
                const p = pct(r);
                const usageVar = r.totalVar != null ? r.totalVar - (r.priceVar ?? 0) : null;
                return (
                  <tr key={r.skuId} onClick={() => onOpen(r.skuId)} className="cursor-pointer border-t border-border hover:bg-secondary/40">
                    <td className="break-words px-3 py-2.5">
                      {badge(r.type)}
                      <span className="font-semibold">{r.name}</span>
                      {r.correction && <span className="block text-xs text-muted-foreground">ปรับ {r.correction.qty > 0 ? "+" : "−"}{n0(Math.abs(r.correction.qty))} {r.uom} · {r.correction.reasons.join(" · ")}</span>}
                      {p !== null && Math.abs(p) > 25 && <span className="block text-xs text-muted-foreground">ใช้จริง{p > 0 ? "มากกว่า" : "น้อยกว่า"}สูตร {Math.abs(p)}% · แตะดูที่มา</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                      {n0(r.stdQty)} <span className="font-sans text-xs text-muted-foreground">{r.uom}</span>
                    </td>
                    {actual ? (
                      <>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums">{r.actQty != null ? <>{n0(r.actQty)} <span className="font-sans text-xs text-muted-foreground">{r.uom}</span></> : <span className="font-sans text-xs text-muted-foreground">ไม่มียอดนับ</span>}</td>
                        <td className={cn("px-3 py-2.5 text-right font-mono tabular-nums", varTone(r.qtyVar ?? null))}>{r.qtyVar != null ? `${r.qtyVar > 0 ? "+" : r.qtyVar < 0 ? "−" : ""}${n0(Math.abs(r.qtyVar))}${p !== null ? ` (${p > 0 ? "+" : ""}${p}%)` : ""}` : "—"}</td>
                        <td className={cn("px-3 py-2.5 text-right font-mono tabular-nums", varTone(r.priceVar ?? null))}>{r.priceVar != null ? signedBaht(r.priceVar) : "—"}</td>
                        <td className={cn("px-3 py-2.5 text-right font-mono tabular-nums", varTone(usageVar))}>{usageVar != null ? signedBaht(usageVar) : "—"}</td>
                        <td className={cn("px-3 py-2.5 text-right font-mono font-semibold tabular-nums", varTone(r.totalVar ?? null))}>{r.totalVar != null ? signedBaht(r.totalVar) : "—"}</td>
                      </>
                    ) : (
                      <>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums">{r.stdPrice ? r.stdPrice.toLocaleString("th-TH", { maximumFractionDigits: 3 }) : <span className="font-sans text-xs font-semibold text-destructive">ไม่มีราคา</span>}</td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums">{baht(r.stdCost)}</td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <ul className="overflow-hidden rounded-2xl border border-border bg-card">
          {list.map((r, i) => {
            const p = pct(r);
            return (
              <li key={r.skuId}>
                <button type="button" onClick={() => onOpen(r.skuId)} className={cn("flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-secondary/40", i > 0 && "border-t border-border")}>
                  <span className="min-w-0 flex-1">
                    <span className="block break-words font-semibold">
                      {badge(r.type)}
                      {r.name}
                    </span>
                    <span className="block text-[13px] text-muted-foreground">
                      สูตร {n0(r.stdQty)} {r.uom}
                      {actual && (r.actQty != null ? ` · ใช้จริง ${n0(r.actQty)}${p !== null ? ` (${p > 0 ? "+" : ""}${p}%)` : ""}` : " · ไม่มียอดนับ")}
                    </span>
                    {r.correction && <span className="block text-xs text-muted-foreground">ปรับ {r.correction.qty > 0 ? "+" : "−"}{n0(Math.abs(r.correction.qty))} · {r.correction.reasons.join(" · ")}</span>}
                  </span>
                  <b className={cn("shrink-0 font-mono tabular-nums", actual ? varTone(r.totalVar ?? null) : "")}>{actual ? (r.totalVar != null ? signedBaht(r.totalVar) : "—") : baht(r.stdCost)}</b>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        {actual ? "เขียว = ใช้น้อยกว่า/ถูกกว่าสูตร · แดง = มากกว่า · " : "ต้นทุนจริงดูได้เมื่อเลือกสาขาเดียว และเดือนที่จบแล้ว · "}แตะแถว = ดูที่มาและไปแก้สูตร
      </p>
    </div>
  );
}

// ─── Day by day ───

export function DayView({ days }: { days: DayRow[] }) {
  if (days.length < 2) return <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">ดูรายวันได้เมื่อเลือกช่วงมากกว่า 1 วัน</p>;
  // Day of month; with dates from two months, day/month so "1" isn't ambiguous
  const twoMonths = days[0].date.slice(0, 7) !== days[days.length - 1].date.slice(0, 7);
  const data = days.map((d) => ({ label: twoMonths ? `${Number(d.date.slice(8))}/${Number(d.date.slice(5, 7))}` : String(Number(d.date.slice(8))), revenue: Math.round(d.revenue), pct: d.revenue > 0 ? Math.round((d.stdCost / d.revenue) * 1000) / 10 : null }));
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-3">
      <div className="h-[260px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} tickLine={false} />
            <YAxis yAxisId="r" tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} tickLine={false} axisLine={false} />
            <YAxis yAxisId="p" orientation="right" domain={[0, 50]} tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => `${v}%`} tickLine={false} axisLine={false} />
            <Tooltip formatter={(v: number, k: string) => (k === "revenue" ? [`฿${n0(v)}`, "ยอดขาย"] : [`${v}%`, "% ต้นทุนตามสูตร"])} labelFormatter={(l) => `วันที่ ${l}`} />
            <Bar yAxisId="r" dataKey="revenue" fill="hsl(var(--muted-foreground) / 0.35)" radius={[4, 4, 0, 0]} />
            <Line yAxisId="p" dataKey="pct" stroke="hsl(var(--brand))" strokeWidth={2} dot={false} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="text-xs text-muted-foreground">แท่ง = ยอดขายต่อวัน · เส้น = % ต้นทุนตามสูตร (แกนขวา) · วันที่ไม่มียอดขายไม่แสดง · ไม่รวมรายการปรับ</p>
    </div>
  );
}

// ─── One ingredient: where the numbers come from ───

export function IngredientSheet({
  row,
  actual,
  period,
  onClose,
  onOpenProduct,
  onHistory,
}: {
  row: SkuRow;
  actual: ActualRow | null;
  period: string;
  onClose: () => void;
  onOpenProduct: () => void;
  onHistory?: () => void;
}) {
  const a = actual;
  const had = a?.opening ? a.opening.qty + a.received : null;
  const impossible = a && had !== null && row.stdQty > had * 1.1 + 1;
  const line = "flex items-baseline justify-between gap-3 border-t border-border py-2 text-[15px]";
  return (
    <div className="fixed inset-0 z-[45] flex items-end justify-center bg-black/30 md:items-center" onClick={onClose}>
      <div role="dialog" aria-label={row.name} className="flex max-h-[90dvh] w-full flex-col gap-3 overflow-y-auto rounded-t-2xl bg-card p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-raised md:max-w-md md:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">
              {period} · {row.code}
            </p>
            <h3 className="break-words text-lg font-bold">{row.name}</h3>
          </div>
          <Button variant="ghost" className="h-10 shrink-0 px-3" onClick={onClose}>
            ปิด
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-secondary px-3 py-2">
            <div className="text-xs text-muted-foreground">ตามสูตร (จากยอดขาย)</div>
            <div className="font-mono text-lg font-semibold">
              {n0(row.stdQty)} <span className="font-sans text-sm font-normal">{row.uom}</span>
            </div>
          </div>
          <div className="rounded-xl border-[1.5px] border-foreground px-3 py-2">
            <div className="text-xs text-muted-foreground">ใช้จริง</div>
            <div className="font-mono text-lg font-semibold">{a?.actQty != null ? <>{n0(a.actQty)} <span className="font-sans text-sm font-normal">{row.uom}</span></> : <span className="font-sans text-sm font-normal text-muted-foreground">{a ? "ไม่มียอดนับตัวนี้ช่วงต้น/ปลายเดือน" : "ดูได้เมื่อเลือกสาขาเดียว เดือนที่จบแล้ว"}</span>}</div>
          </div>
        </div>
        {row.correction && (
          <p className="rounded-xl bg-secondary px-3 py-2 text-sm">
            ตามสูตรปรับแล้ว {row.correction.qty > 0 ? "+" : "−"}
            {n0(Math.abs(row.correction.qty))} {row.uom} · {row.correction.reasons.join(" · ")}
          </p>
        )}
        {a && a.actQty != null && (
          <div>
            <div className="mb-0.5 font-semibold">ใช้จริงมาจาก</div>
            <div className={line}>
              <span>ยกมา · {a.opening ? `นับ ${thaiDate(a.opening.date)}${a.opening.estimated ? " (ยอดระบบ)" : ""}` : "ไม่มียอดนับ"}</span>
              <b className="font-mono">{n0(a.opening?.qty ?? 0)}</b>
            </div>
            <div className={line}>
              <span>+ รับเข้าทั้งช่วง{a.receipts ? ` (${a.receipts} ครั้ง)` : ""}</span>
              <b className="font-mono text-success">+{n0(a.received)}</b>
            </div>
            <div className={line}>
              <span>− ปิดช่วง · {a.closing ? `นับ ${thaiDate(a.closing.date)}${a.closing.estimated ? " (ยอดระบบ)" : ""}` : "ไม่มียอดนับ"}</span>
              <b className="font-mono">−{n0(a.closing?.qty ?? 0)}</b>
            </div>
            <div className={cn(line, "border-t-[1.5px] border-foreground")}>
              <b>= ใช้จริง</b>
              <b className="font-mono">
                {n0(a.actQty)} {row.uom}
              </b>
            </div>
            {(a.opening?.nearby || a.closing?.nearby) && <p className="mt-1 text-xs text-muted-foreground">ไม่มียอดนับตรงวัน ระบบใช้วันที่ใกล้สุดในช่วง ±3 วัน</p>}
          </div>
        )}
        {impossible && (
          <p className="rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning">
            ทั้งช่วงมีแค่ {n0(had!)} {row.uom} (ยกมา + รับ) แต่สูตรบอกใช้ {n0(row.stdQty)} ⇒ <b>สูตรน่าจะนับซ้ำหรือใส่จำนวนเกิน</b> ดูว่าเมนูไหนใช้ตัวนี้ใน Cost Center
          </p>
        )}
        <Button variant="brand" className="h-12 text-[15px]" onClick={onOpenProduct}>
          ดูสูตรและเมนูที่ใช้ตัวนี้ใน Cost Center
        </Button>
        {onHistory && (
          <Button variant="outline" className="h-12 text-[15px]" onClick={onHistory}>
            ประวัติเข้า-ออกที่สาขา
          </Button>
        )}
      </div>
    </div>
  );
}

export { signedBaht, pctTone };
