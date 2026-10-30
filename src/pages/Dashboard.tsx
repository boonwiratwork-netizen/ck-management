import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCkPeriod } from "@/hooks/use-ck-production";
import { useFitsWidth } from "@/hooks/use-fits-width";
import { Button } from "@/components/ui/button";
import type { SKU } from "@/types/sku";
import type { Price } from "@/types/price";
import type { BOMLine } from "@/types/bom";
import type { SmProductionCost } from "@/lib/ck-production-cost";
import { cn, toLocalDateStr } from "@/lib/utils";

interface Props {
  skus: SKU[];
  prices: Price[];
  bomLines: BOMLine[];
  rmStockBalances: { skuId: string; currentStock: number }[];
  smStockBalances: { skuId: string; currentStock: number }[];
  /** Today's kitchen balances have loaded (they stand in for a missing closing count) */
  stockReady: boolean;
}

const n0 = (n: number) => Math.round(n).toLocaleString("th-TH");
const baht = (n: number) => `${n < 0 ? "−" : ""}฿${n0(Math.abs(n))}`;
const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}฿${n0(Math.abs(n))}`;
const pct = (v: number, base: number) => (base > 0 ? (v / base) * 100 : 0);
const thai = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("th-TH", { day: "numeric", month: "short" });
const grams = (g: number, uom: string) => (uom === "ก." && Math.abs(g) >= 1000 ? `${(g / 1000).toLocaleString("th-TH", { maximumFractionDigits: 1 })} กก.` : `${n0(g)} ${uom}`);
/** Over the recipe is red, under is green (cheaper) */
const tone = (v: number) => (Math.abs(v) < 0.5 ? "text-muted-foreground" : v > 0 ? "text-destructive" : "text-success");

/**
 * The kitchen at a glance: what production cost against its recipes for the month
 * (opens on it, works it out at once), whether the raw-material counts are there to
 * trust it, what's worth a look, and what was bought and sent. "Now" numbers sit in
 * their own section so they aren't read as the month's.
 */
export default function Dashboard({ skus, prices, bomLines, rmStockBalances, smStockBalances, stockReady }: Props) {
  const navigate = useNavigate();
  const now = new Date();
  const today = toLocalDateStr(now);
  const months = useMemo(
    () => [0, 1, 2].map((k) => ({ from: toLocalDateStr(new Date(now.getFullYear(), now.getMonth() - k, 1)), to: toLocalDateStr(new Date(now.getFullYear(), now.getMonth() - k + 1, 0)) })),
    [today], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const [period, setPeriod] = useState(() => (now.getDate() <= 7 ? months[1] : months[0]));
  const [custom, setCustom] = useState(false);
  const { data: loaded, loading, error } = useCkPeriod(period.from, period.to, rmStockBalances, stockReady);
  // Another period's numbers are never shown under this period's dates
  const data = loaded && loaded.from === period.from && loaded.to === period.to ? loaded : null;
  const [open, setOpen] = useState<SmProductionCost | null>(null);
  const [measure, wide] = useFitsWidth(820);

  const byId = useMemo(() => new Map(skus.map((s) => [s.id, s])), [skus]);
  const name = (id: string) => byId.get(id)?.name ?? id;
  const code = (id: string) => byId.get(id)?.skuId ?? "";
  const monthLabel = (from: string) => new Date(`${from}T00:00:00`).toLocaleDateString("th-TH", { month: "short", year: "2-digit" });
  const openProduct = (id: string) => code(id) && navigate(`/cost-center#p/${encodeURIComponent(code(id))}`);

  // Stock right now (not the period): raw materials for recipes / for branches, kitchen-made
  const stockNow = useMemo(() => {
    const price = new Map<string, number>();
    for (const p of prices) if (p.isActive && !price.has(p.skuId)) price.set(p.skuId, p.pricePerUsageUom);
    const inRecipe = new Set(bomLines.map((l) => l.rmSkuId));
    let rmProd = 0;
    let rmDist = 0;
    for (const b of rmStockBalances) {
      const v = Math.max(0, b.currentStock) * (price.get(b.skuId) ?? 0);
      if (inRecipe.has(b.skuId)) rmProd += v;
      else if (byId.get(b.skuId)?.isDistributable) rmDist += v;
    }
    const sm = smStockBalances.reduce((t, b) => t + Math.max(0, b.currentStock) * (price.get(b.skuId) ?? 0), 0);
    return { rmProd, rmDist, sm };
  }, [prices, bomLines, rmStockBalances, smStockBalances, byId]);

  const cost = data?.cost ?? null;
  // Things worth a look
  const attention: { key: string; tone: "red" | "amber"; title: string; detail: string; go?: () => void; label?: string }[] = [];
  if (data && data.produced && (data.blocked || data.estimated)) {
    attention.push({
      key: "count",
      tone: data.blocked ? "red" : "amber",
      title: data.blocked ? "ยังคิดต้นทุนจริงไม่ได้" : "ยังไม่ได้นับวัตถุดิบปลายช่วง · ยังเทียบกับของจริงไม่ได้",
      detail: data.blocked ?? "ตอนนี้ใช้ยอดคงเหลือในระบบแทนยอดนับ ซึ่งหักตามสูตรอยู่แล้ว ส่วนต่างจึงใกล้ 0 เสมอ · นับวัตถุดิบแล้วถึงเห็นของจริง",
      go: () => navigate("/stockcount"),
      label: "ไปนับสต๊อกครัว",
    });
  }
  if (data && data.uncounted.length)
    attention.push({ key: "uncounted", tone: "amber", title: `วัตถุดิบ ${data.uncounted.length} ตัวไม่มีในใบนับ · คิดตามสูตรไปก่อน`, detail: `${data.uncounted.slice(0, 4).map(name).join(" · ")}${data.uncounted.length > 4 ? " · …" : ""} · นับให้ครบรอบหน้า ตัวเลขจะแม่นขึ้น` });
  if (cost) {
    for (const r of cost.rows.filter((r) => r.stdCost <= 0 && r.outputG > 0).slice(0, 2))
      attention.push({ key: `zero-${r.smSkuId}`, tone: "red", title: `${name(r.smSkuId)}: ผลิต ${grams(r.outputG, "ก.")} แต่ไม่มีสูตรหรือราคา`, detail: "ต้นทุนตามสูตรเป็น ฿0 · ตั้งสูตรใน Cost Center", go: () => openProduct(r.smSkuId), label: "ไปตั้งสูตร" });
    for (const r of cost.rows.filter((r) => r.stdCost > 0 && Math.abs(r.actCost - r.stdCost) >= 300 && Math.abs(pct(r.actCost - r.stdCost, r.stdCost)) >= 10).slice(0, 3)) {
      const d = r.actCost - r.stdCost;
      attention.push({ key: `var-${r.smSkuId}`, tone: "amber", title: `${name(r.smSkuId)}: ${d > 0 ? "แพงกว่า" : "ถูกกว่า"}สูตร ${signed(d)} (${pct(d, r.stdCost) > 0 ? "+" : ""}${pct(d, r.stdCost).toFixed(1)}%)`, detail: data?.estimated ? `เพราะราคา ${signed(r.priceVar)} · ส่วนใช้ รอนับปลายช่วง` : `เพราะราคา ${signed(r.priceVar)} · เพราะใช้ ${signed(r.usageVar)}`, go: () => setOpen(r), label: "ดูวัตถุดิบ" });
    }
    const neg = [...cost.rmUsed].filter(([, q]) => q < -0.5);
    if (neg.length)
      attention.push({ key: "neg", tone: "amber", title: `วัตถุดิบใช้ติดลบ ${neg.length} ตัว`, detail: `${neg.slice(0, 3).map(([id]) => name(id)).join(" · ")} · ยอดปลายช่วงมากกว่าต้นช่วง + ซื้อ = ของเข้าไม่ได้บันทึก หรือนับผิด` });
  }

  const chip = (on: boolean) => cn("inline-flex min-h-[40px] items-center gap-1.5 rounded-full border px-3.5 text-sm", on ? "border-primary bg-primary font-semibold text-primary-foreground" : "border-border bg-card");
  const card = "min-w-0 rounded-2xl border border-border bg-card px-4 py-3";

  return (
    <div ref={measure} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-bold">ภาพรวมครัวกลาง</h1>
          <p className="text-sm text-muted-foreground">ต้นทุนผลิตจริงเทียบสูตร (สูตรเดียวกับ Cost Center) · ซื้อเข้า · ส่งสาขา</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">เดือน</span>
        {months.map((m, i) => (
          <button key={m.from} type="button" className={chip(!custom && period.from === m.from)} onClick={() => (setCustom(false), setPeriod(m))}>
            {monthLabel(m.from)}
            {i === 0 && <span className="text-xs opacity-80">· ยังไม่จบ</span>}
          </button>
        ))}
        <button type="button" className={chip(custom)} onClick={() => setCustom(true)}>
          เลือกช่วงเอง
        </button>
        {custom && (
          <span className="flex flex-wrap items-center gap-2">
            <input type="date" aria-label="ตั้งแต่" value={period.from} max={period.to} onChange={(e) => e.target.value && setPeriod((p) => ({ ...p, from: e.target.value }))} className="h-10 rounded-xl border border-border bg-card px-3 text-base sm:text-sm" />
            <span className="text-sm text-muted-foreground">ถึง</span>
            <input type="date" aria-label="ถึง" value={period.to} min={period.from} onChange={(e) => e.target.value && setPeriod((p) => ({ ...p, to: e.target.value }))} className="h-10 rounded-xl border border-border bg-card px-3 text-base sm:text-sm" />
          </span>
        )}
      </div>
      {error && <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      {!data ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-[96px] animate-pulse rounded-2xl bg-secondary" />
          ))}
        </div>
      ) : (
        <div className={cn("flex flex-col gap-4 transition-opacity", loading && "opacity-50")}>
          <p className="text-xs font-semibold text-muted-foreground">
            ต้นทุนผลิต · {data.opening ? `ผลิตระหว่างนับ ${thai(data.opening.date)} – ${data.closing ? thai(data.closing.date) : "วันนี้"}` : `${thai(period.from)} – ${thai(period.to)}`}
            {data.estimated && !data.blocked ? " · ประมาณการ" : ""} · วัตถุดิบดิบเท่านั้น (ของครัวผลิตที่ใส่ในสูตรอื่น นับในแถวของตัวเองแล้ว)
          </p>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className={card}>
              <div className="text-sm text-muted-foreground">ต้นทุนตามสูตร</div>
              <div className="break-all font-mono text-xl font-semibold sm:text-2xl">{cost ? baht(cost.stdCost) : "—"}</div>
              <div className="text-xs text-muted-foreground">ถ้าใช้ตามสูตรพอดี</div>
            </div>
            <div className={cn(card, cost && "border-[1.5px] border-foreground")}>
              <div className="text-sm text-muted-foreground">ต้นทุนจริง</div>
              <div className="break-all font-mono text-xl font-semibold sm:text-2xl">{cost ? baht(cost.actCost) : "—"}</div>
              <div className="text-xs text-muted-foreground">วัตถุดิบที่ใช้ไปจริง ราคาที่จ่าย</div>
            </div>
            <div className={card}>
              <div className="text-sm text-muted-foreground">จริงต่างจากสูตร</div>
              {cost ? (
                <>
                  <div className={cn("break-all font-mono text-xl font-semibold sm:text-2xl", tone(cost.actCost - cost.stdCost))}>
                    {signed(cost.actCost - cost.stdCost)} <span className="text-sm">({pct(cost.actCost - cost.stdCost, cost.stdCost).toFixed(1)}%)</span>
                  </div>
                  <div className="text-xs text-muted-foreground">{data.estimated ? `ราคา ${signed(cost.priceVar)} · ส่วนใช้ รอนับปลายช่วง` : `ราคา ${signed(cost.priceVar)} · ใช้ ${signed(cost.usageVar)}`}</div>
                </>
              ) : (
                <div className="text-xl font-semibold text-muted-foreground">—</div>
              )}
            </div>
            <div className={card}>
              <div className="text-sm text-muted-foreground">นับวัตถุดิบ</div>
              <div className={cn("text-[15px] font-semibold", !data.opening && "text-destructive")}>ต้นช่วง {data.opening ? `✓ ${thai(data.opening.date)}` : "· ไม่มี"}</div>
              <div className={cn("text-[15px] font-semibold", !data.closing && (period.to < today ? "text-destructive" : "text-warning"))}>ปลายช่วง {data.closing ? `✓ ${thai(data.closing.date)}` : period.to < today ? "· ไม่มี" : "· ยังไม่นับ"}</div>
            </div>
          </div>

          {attention.length > 0 && (
            <section className="overflow-hidden rounded-2xl border border-border bg-card">
              <h2 className="px-4 pt-3 text-base font-bold">เรื่องที่ควรดู</h2>
              {attention.map((a, i) => (
                <div key={a.key} className={cn("flex items-start gap-3 px-4 py-3", i > 0 && "border-t border-border")}>
                  <span className={cn("mt-2 h-2 w-2 shrink-0 rounded-full", a.tone === "red" ? "bg-destructive" : "bg-warning")} />
                  <span className="min-w-0 flex-1">
                    <span className="block break-words font-semibold">{a.title}</span>
                    <span className="block break-words text-sm text-muted-foreground">{a.detail}</span>
                  </span>
                  {a.go && (
                    <Button variant="outline" className="h-10 shrink-0" onClick={a.go}>
                      {a.label}
                    </Button>
                  )}
                </div>
              ))}
            </section>
          )}

          {cost && cost.rows.length > 0 ? (
            wide ? (
              <div className="overflow-hidden rounded-2xl border border-border bg-card">
                <table className="w-full table-fixed text-sm">
                  <colgroup>
                    <col />
                    <col style={{ width: "120px" }} />
                    <col style={{ width: "130px" }} />
                    <col style={{ width: "130px" }} />
                    <col style={{ width: "130px" }} />
                    <col style={{ width: "90px" }} />
                  </colgroup>
                  <thead className="bg-secondary/60 text-left text-[13px] text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2.5 font-medium">ของที่ผลิต (ต่างจากสูตรมากสุดก่อน)</th>
                      <th className="px-3 py-2.5 text-right font-medium">ผลิตได้</th>
                      <th className="px-3 py-2.5 text-right font-medium">ตามสูตร</th>
                      <th className="px-3 py-2.5 text-right font-medium">จริง</th>
                      <th className="px-3 py-2.5 text-right font-medium">ต่าง</th>
                      <th className="px-3 py-2.5 text-right font-medium">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cost.rows.map((r) => {
                      const d = r.actCost - r.stdCost;
                      return (
                        <tr key={r.smSkuId} onClick={() => setOpen(r)} className="cursor-pointer border-t border-border hover:bg-secondary/40">
                          <td className="break-words px-3 py-2.5">
                            <span className="font-semibold">{name(r.smSkuId)}</span> <span className="font-mono text-xs text-muted-foreground">{code(r.smSkuId)}</span>
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono tabular-nums">{grams(r.outputG, byId.get(r.smSkuId)?.usageUom ?? "ก.")}</td>
                          <td className="px-3 py-2.5 text-right font-mono tabular-nums">{baht(r.stdCost)}</td>
                          <td className="px-3 py-2.5 text-right font-mono tabular-nums">{baht(r.actCost)}</td>
                          <td className={cn("px-3 py-2.5 text-right font-mono tabular-nums", tone(d))}>{signed(d)}</td>
                          <td className={cn("px-3 py-2.5 text-right font-mono tabular-nums", tone(d))}>{r.stdCost > 0 ? `${pct(d, r.stdCost) > 0 ? "+" : ""}${pct(d, r.stdCost).toFixed(1)}%` : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground">แตะแถว = วัตถุดิบของตัวนั้น ตามสูตร vs ใช้จริง · ต้นทุนทั้งหม้อ (รวมผลพลอยได้)</p>
              </div>
            ) : (
              <ul className="overflow-hidden rounded-2xl border border-border bg-card">
                {cost.rows.map((r, i) => {
                  const d = r.actCost - r.stdCost;
                  return (
                    <li key={r.smSkuId}>
                      <button type="button" onClick={() => setOpen(r)} className={cn("flex w-full items-start gap-3 px-4 py-3 text-left", i > 0 && "border-t border-border")}>
                        <span className="min-w-0 flex-1">
                          <span className="block break-words font-semibold">{name(r.smSkuId)}</span>
                          <span className="block text-[13px] text-muted-foreground">
                            {grams(r.outputG, byId.get(r.smSkuId)?.usageUom ?? "ก.")} · สูตร {baht(r.stdCost)} · จริง {baht(r.actCost)}
                          </span>
                        </span>
                        <b className={cn("shrink-0 font-mono tabular-nums", tone(d))}>{r.stdCost > 0 ? `${pct(d, r.stdCost) > 0 ? "+" : ""}${pct(d, r.stdCost).toFixed(1)}%` : "—"}</b>
                      </button>
                    </li>
                  );
                })}
                <li className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground">แตะ = วัตถุดิบของตัวนั้น · ต้นทุนทั้งหม้อ (รวมผลพลอยได้)</li>
              </ul>
            )
          ) : (
            !data.blocked && <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">ไม่มีการผลิตในช่วงนี้</p>
          )}

          <div className="grid gap-3 lg:grid-cols-2">
            <section className={card}>
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="font-semibold">ซื้อเข้า</h3>
                <b className="font-mono">{baht(data.purchases.total)}</b>
              </div>
              <ul className="mt-2 flex flex-col gap-1.5 text-sm">
                {data.purchases.top.map((s) => (
                  <li key={s.name} className="flex items-center gap-3">
                    <span className="min-w-0 flex-1 break-words">{s.name}</span>
                    <span className="w-24 overflow-hidden rounded-full bg-secondary">
                      <span className="block h-1.5 rounded-full bg-muted-foreground/60" style={{ width: `${pct(s.value, data.purchases.total)}%` }} />
                    </span>
                    <span className="w-24 shrink-0 text-right font-mono tabular-nums">{baht(s.value)}</span>
                  </li>
                ))}
                {!data.purchases.top.length && <li className="text-muted-foreground">ไม่มีการซื้อในช่วงนี้</li>}
              </ul>
            </section>
            <section className={card}>
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="font-semibold">ส่งสาขา</h3>
                <b className="font-mono">{baht(data.distribution.sm + data.distribution.rm)}</b>
              </div>
              <ul className="mt-2 flex flex-col gap-1.5 text-sm">
                {data.distribution.byBranch.map((b) => (
                  <li key={b.name} className="flex items-baseline gap-3">
                    <span className="min-w-0 flex-1 break-words">{b.name}</span>
                    <span className="text-xs text-muted-foreground">
                      ครัวผลิต {baht(b.sm)} · วัตถุดิบ {baht(b.rm)}
                    </span>
                    <span className="w-24 shrink-0 text-right font-mono tabular-nums">{baht(b.sm + b.rm)}</span>
                  </li>
                ))}
                {!data.distribution.byBranch.length && <li className="text-muted-foreground">ไม่มีการส่งในช่วงนี้</li>}
              </ul>
            </section>
          </div>
        </div>
      )}

      <p className="mt-2 text-xs font-semibold text-muted-foreground">ตอนนี้ (ไม่ขึ้นกับเดือนที่เลือก)</p>
      <div className={card}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-sm text-muted-foreground">สต๊อกครัวตอนนี้</span>
          <b className="font-mono text-xl">{baht(stockNow.rmProd + stockNow.rmDist + stockNow.sm)}</b>
        </div>
        <div className="text-sm text-muted-foreground">
          วัตถุดิบสำหรับผลิต {baht(stockNow.rmProd)} · วัตถุดิบส่งสาขา {baht(stockNow.rmDist)} · ครัวผลิต (SM) {baht(stockNow.sm)} ·{" "}
          <button type="button" className="font-semibold text-brand" onClick={() => navigate("/stock")}>
            ดูสต๊อกครัว ›
          </button>
        </div>
      </div>

      {open && (
        <div className="fixed inset-0 z-[45] flex items-end justify-center bg-black/30 md:items-center" onClick={() => setOpen(null)}>
          <div role="dialog" aria-label={name(open.smSkuId)} className="flex max-h-[90dvh] w-full flex-col gap-3 overflow-y-auto rounded-t-2xl bg-card p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-raised md:max-w-lg md:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm text-muted-foreground">
                  {thai(period.from)} – {thai(period.to)} · ผลิต {grams(open.outputG, "ก.")} ({open.runs.toLocaleString("th-TH", { maximumFractionDigits: 1 })} รอบ)
                </p>
                <h3 className="break-words text-lg font-bold">{name(open.smSkuId)}</h3>
                <p className="text-sm">
                  สูตร {baht(open.stdCost)} · จริง {baht(open.actCost)} · <span className={tone(open.actCost - open.stdCost)}>{signed(open.actCost - open.stdCost)}</span>
                </p>
              </div>
              <Button variant="ghost" className="h-10 shrink-0 px-3" onClick={() => setOpen(null)}>
                ปิด
              </Button>
            </div>
            <ul className="divide-y divide-border rounded-xl border border-border">
              {open.lines.map((l) => {
                const uom = byId.get(l.skuId)?.usageUom ?? "";
                const d = l.actual !== null ? (l.actual - l.expected) * l.stdPrice + (l.actPrice - l.stdPrice) * l.actual : 0;
                return (
                  <li key={l.skuId} className="flex items-start gap-3 px-3 py-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="block break-words font-semibold">{name(l.skuId)}</span>
                      <span className="block text-[13px] text-muted-foreground">
                        สูตร {grams(l.expected, uom)}
                        {l.actual !== null ? ` · ใช้จริง ${grams(l.actual, uom)}` : " · ของครัวผลิต (ต้นทุนอยู่ในแถวของตัวเอง ไม่นับซ้ำ)"}
                        {l.actual !== null && Math.abs(l.actPrice - l.stdPrice) > l.stdPrice * 0.02 ? ` · ราคาจ่าย ${l.actPrice.toLocaleString("th-TH", { maximumFractionDigits: 3 })}/${uom} (สูตร ${l.stdPrice.toLocaleString("th-TH", { maximumFractionDigits: 3 })})` : ""}
                      </span>
                    </span>
                    <b className={cn("shrink-0 font-mono tabular-nums", tone(d))}>{l.actual !== null ? signed(d) : "—"}</b>
                  </li>
                );
              })}
            </ul>
            <p className="text-xs text-muted-foreground">วัตถุดิบที่หลายสูตรใช้ แบ่งยอดใช้จริงตามที่แต่ละสูตรควรใช้</p>
            <Button variant="brand" className="h-12 text-[15px]" onClick={() => openProduct(open.smSkuId)}>
              เปิดสูตรใน Cost Center
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
