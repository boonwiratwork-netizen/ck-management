import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { ArrowDown, ArrowUp, Download, HelpCircle, History, Search, SlidersHorizontal } from "lucide-react";
import type { SKU } from "@/types/sku";
import type { Supplier } from "@/types/supplier";
import type { BOMHeader, BOMLine } from "@/types/bom";
import type { SkuCategory } from "@/hooks/use-sku-categories";
import type { KitchenItemStock } from "@/hooks/use-kitchen-item-stock";
import type { useSmStockData } from "@/hooks/use-sm-stock-data";
import { buildStockRow, coverByStorage, matchesFilter, shownOnPage, LOW_DAYS, type StockFilter, type StockRow, type StockType } from "@/lib/kitchen-stock-view";
import { useFitsWidth } from "@/hooks/use-fits-width";
import { SegmentedTabs } from "@/components/SegmentedTabs";
import { GuideTour, useGuide, type GuideStep } from "@/components/GuideTour";
import { StockCard } from "@/components/StockCard";
import { AdjustSheet } from "@/components/kitchen-stock/AdjustSheet";
import { Button } from "@/components/ui/button";
import { cn, toLocalDateStr } from "@/lib/utils";
import { UseReadError } from "@/components/UseReadError";

type SmStock = ReturnType<typeof useSmStockData>;

const TABS: { key: StockType; label: string }[] = [
  { key: "RM", label: "วัตถุดิบ RM" },
  { key: "SM", label: "ครัวผลิต SM" },
  { key: "PK", label: "บรรจุภัณฑ์ PK" },
];
const STORAGE: Record<string, string> = { Frozen: "แช่แข็ง", Chilled: "แช่เย็น", Ambient: "ของแห้ง" };
const n0 = (n: number) => Math.round(n).toLocaleString();
const baht = (n: number) => `฿${Math.round(n).toLocaleString()}`;
const thaiDate = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("th-TH", { day: "numeric", month: "short" });
type SortKey = "name" | "stock" | "value" | "days";

const GUIDE: GuideStep[] = [
  { title: "สต๊อกครัว ที่เดียว 3 แท็บ", body: "วัตถุดิบ · ของที่ครัวผลิต · บรรจุภัณฑ์ ยอดและมูลค่าคิดแบบเดียวกับใบโอนและ Cost Center" },
  { target: "ks-tabs", title: "สลับแท็บ RM / SM / PK", body: "แต่ละแท็บมีเรื่องที่ต้องดูของตัวเอง" },
  { target: "ks-attention", title: "เรื่องที่ต้องดู", body: "ใกล้หมด · ติดลบ · ยอดผิดปกติ · ไม่ได้นับนาน แตะเพื่อดูเฉพาะกลุ่มนั้น" },
  { target: "ks-list", title: "นับล่าสุด บอกว่ายอดเชื่อได้แค่ไหน", body: "ยอดในระบบ = ที่นับได้ + ของเข้า − ของออก หลังวันนับ · กด “ประวัติ” ดูว่าเข้าออกอะไรบ้าง · กด “ปรับยอด” เมื่อเอาของไป Workshop / ส่งเทส / ทิ้ง" },
];

interface Props {
  type: StockType;
  onType: (t: StockType) => void;
  skus: SKU[];
  suppliers: Supplier[];
  categories: SkuCategory[];
  bomHeaders: BOMHeader[];
  bomLines: BOMLine[];
  rm: KitchenItemStock;
  pk: KitchenItemStock;
  sm: SmStock;
  smDailyUsage: Record<string, number>;
  /** The daily-use read failed: SM days left are unknown, not "none used" */
  smUseError?: boolean;
  onSmUseRetry?: () => void;
  canEdit: boolean;
}

/**
 * Kitchen stock — RM, SM and PK on one page (they were three copies that each
 * worked numbers out their own way). Value = stock × the standard cost Cost Center
 * keeps; "นับล่าสุด" on every row shows how far the balance is from a real count.
 */
export default function KitchenStockPage(p: Props) {
  const { type } = p;
  const today = toLocalDateStr(new Date());
  const guide = useGuide("kitchen-stock-v1");
  const [filter, setFilter] = useState<StockFilter>("all");
  const [storage, setStorage] = useState<string>("all");
  const [category, setCategory] = useState<string>("all");
  const [ckOnly, setCkOnly] = useState(true);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "name", dir: 1 });
  const [adjustFor, setAdjustFor] = useState<StockRow | null>(null);
  const [cardFor, setCardFor] = useState<StockRow | null>(null);
  // A new tab (also by Back or the sidebar) starts clean: no filter left on, and no
  // sheet still open for an item of the other tab
  useEffect(() => {
    setFilter("all");
    setCategory("all");
    setAdjustFor(null);
    setCardFor(null);
  }, [type]);
  // Every column from ~940px (a 1280px laptop with the side menu open); cards below
  const [fitRef, fits] = useFitsWidth(940);

  const supplierName = useMemo(() => new Map(p.suppliers.map((s) => [s.id, s.name])), [p.suppliers]);
  const catName = useMemo(() => new Map(p.categories.map((c) => [c.code, c.nameTh || c.nameEn || c.code])), [p.categories]);

  // RM the kitchen really uses: in a recipe of an active SM, or sent to branches
  const ckRmIds = useMemo(() => {
    const activeSm = new Set(p.skus.filter((s) => s.type === "SM" && s.status === "Active").map((s) => s.id));
    const headers = new Set(p.bomHeaders.filter((h) => activeSm.has(h.smSkuId)).map((h) => h.id));
    const ids = new Set<string>();
    p.bomLines.forEach((l) => headers.has(l.bomHeaderId) && ids.add(l.rmSkuId));
    p.skus.forEach((s) => s.type === "RM" && s.isDistributable && ids.add(s.id));
    return ids;
  }, [p.skus, p.bomHeaders, p.bomLines]);

  const rows = useMemo(() => {
    const skuById = new Map(p.skus.map((s) => [s.id, s]));
    const out: StockRow[] = [];
    if (type === "SM") {
      for (const b of p.sm.stockBalances) {
        const sku = skuById.get(b.skuId);
        if (!sku) continue;
        const a = p.sm.getAnchor(b.skuId);
        const last = p.sm.getLastProductionDate(b.skuId);
        out.push(buildStockRow("SM", { sku, stock: b.currentStock, unitCost: p.sm.getBomCostPerGram(b.skuId), perDay: p.smDailyUsage[b.skuId] || 0, lastCount: a?.count_date ?? null, movesAfter: p.sm.movesAfterCount(b.skuId), lastIn: last ? { date: last } : null }, today));
      }
    } else {
      const src = type === "RM" ? p.rm : p.pk;
      for (const b of src.stockBalances) {
        const sku = skuById.get(b.skuId);
        if (!sku) continue;
        const a = src.getAnchor(b.skuId);
        const last = src.getLastReceipt(b.skuId);
        out.push(buildStockRow(type, { sku, stock: b.currentStock, unitCost: src.getStdUnitPrice(b.skuId), perDay: src.usagePerDay(b.skuId, today), lastCount: a?.count_date ?? null, movesAfter: src.movesAfterCount(b.skuId), lastIn: last ? { date: last.date, from: supplierName.get(last.supplierId) } : null }, today));
      }
    }
    return out.filter(shownOnPage);
  }, [type, p.skus, p.sm, p.rm, p.pk, p.smDailyUsage, supplierName, today]);

  // Base set for this tab (CK-only switch on RM), before the chips / storage / search
  const base = useMemo(() => (type === "RM" && ckOnly ? rows.filter((r) => ckRmIds.has(r.sku.id)) : rows), [rows, type, ckOnly, ckRmIds]);
  const counts = useMemo(
    () => ({
      low: base.filter((r) => r.flags.low).length,
      negative: base.filter((r) => r.flags.negative).length,
      unusual: base.filter((r) => r.flags.unusual).length,
      stale: base.filter((r) => r.flags.stale).length,
    }),
    [base],
  );
  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const list = base.filter(
      (r) =>
        matchesFilter(r, filter) &&
        (storage === "all" || r.sku.storageCondition === storage) &&
        (category === "all" || r.sku.category === category) &&
        words.every((w) => `${r.sku.name} ${r.sku.skuId}`.toLowerCase().includes(w)),
    );
    const val = (r: StockRow) => (sort.key === "name" ? 0 : sort.key === "stock" ? r.stock : sort.key === "value" ? r.value : (r.daysLeft ?? Number.POSITIVE_INFINITY));
    return [...list].sort((a, b) => (sort.key === "name" ? a.sku.name.localeCompare(b.sku.name, "th") * sort.dir : (val(a) - val(b)) * sort.dir));
  }, [base, filter, storage, category, query, sort]);

  const totalValue = base.reduce((s, r) => s + r.value, 0);
  const cover = coverByStorage(base);
  const lastCount = base.reduce<string | null>((m, r) => (r.lastCount && (!m || r.lastCount > m) ? r.lastCount : m), null);
  const neverCounted = base.filter((r) => r.lastCount === null && r.stock !== 0).length;
  const catsHere = [...new Set(base.map((r) => r.sku.category))].sort();
  const lowNames = base.filter((r) => r.flags.low).sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0));
  const unusualNames = base.filter((r) => r.flags.unusual);
  const negativeNames = base.filter((r) => r.flags.negative);

  const setSortKey = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === "name" ? 1 : -1 }));
  const exportExcel = () => {
    const data = shown.map((r) => ({
      รหัส: r.sku.skuId,
      ชื่อ: r.sku.name,
      หมวด: catName.get(r.sku.category) ?? r.sku.category,
      ช่องเก็บ: STORAGE[r.sku.storageCondition] ?? r.sku.storageCondition,
      คงเหลือ: Math.round(r.stock * 100) / 100,
      หน่วย: r.sku.usageUom,
      "ต้นทุน/หน่วย": Math.round(r.unitCost * 10000) / 10000,
      มูลค่า: Math.round(r.value * 100) / 100,
      นับล่าสุด: r.lastCount ?? "ไม่เคยนับ",
    }));
    data.push({ รหัส: "", ชื่อ: "รวม", หมวด: "", ช่องเก็บ: "", คงเหลือ: 0, หน่วย: "", "ต้นทุน/หน่วย": 0, มูลค่า: Math.round(shown.reduce((s, r) => s + r.value, 0) * 100) / 100, นับล่าสุด: "" });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), `สต๊อก ${type}`);
    XLSX.writeFile(wb, `สต๊อกครัว-${type}-${today}.xlsx`);
  };

  const chip = (on: boolean, tone?: "bad" | "warn") =>
    cn("inline-flex min-h-[40px] items-center gap-1.5 rounded-full border px-3.5 text-sm", on ? "border-primary bg-primary font-semibold text-primary-foreground" : tone === "bad" ? "border-destructive/40 bg-card text-destructive" : tone === "warn" ? "border-warning/50 bg-card text-warning" : "border-border bg-card");
  const select = "h-10 rounded-xl border border-border bg-card px-3 text-sm";
  const lastInLabel = type === "SM" ? "ผลิตล่าสุด" : "ซื้อเข้าล่าสุด";

  const daysCell = (r: StockRow) =>
    r.daysLeft === null ? <span className="text-muted-foreground">—</span> : <span className={cn(r.flags.low && "font-semibold text-destructive", r.flags.unusual && "font-semibold text-warning")}>{r.daysLeft >= 100 ? "100+" : r.daysLeft.toFixed(1)} วัน</span>;
  const countCell = (r: StockRow) =>
    r.lastCount ? (
      <span className={cn(r.flags.stale && "text-warning")}>
        {thaiDate(r.lastCount)}
        <span className="text-xs text-muted-foreground"> · {r.movesAfter} รายการหลังนับ</span>
      </span>
    ) : (
      <span className={cn(r.stock !== 0 ? "font-semibold text-destructive" : "text-muted-foreground")}>ไม่เคยนับ</span>
    );
  const tags = (r: StockRow) => (
    <>
      {r.flags.inactive && <span className="ml-1.5 rounded-md bg-secondary px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">ปิดใช้</span>}
      {r.flags.unusual && <span className="ml-1.5 rounded-md bg-warning-soft px-1.5 py-0.5 text-[11px] font-semibold text-warning">ยอดผิดปกติ</span>}
    </>
  );
  const SortTh = ({ k, children, right }: { k: SortKey; children: React.ReactNode; right?: boolean }) => (
    <th className={cn("px-3 py-2.5 font-medium", right && "text-right")}>
      <button type="button" onClick={() => setSortKey(k)} className={cn("inline-flex items-center gap-1 hover:text-foreground", sort.key === k && "text-foreground")}>
        {children}
        {sort.key === k && (sort.dir === 1 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
      </button>
    </th>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-bold">สต๊อกครัว</h1>
          <p className="text-sm text-muted-foreground">ยอดในระบบ = นับล่าสุด + ของเข้า − ของออก หลังวันนับ · มูลค่าคิดจากต้นทุนใน Cost Center</p>
        </div>
        <Button variant="outline" className="h-10" onClick={exportExcel}>
          <Download className="h-4 w-4" /> ส่งออก Excel
        </Button>
        <Button variant="outline" className="h-10" onClick={guide.start}>
          <HelpCircle className="h-4 w-4" /> วิธีใช้
        </Button>
        <div data-tour="ks-tabs" className="min-w-0">
          <SegmentedTabs<StockType> tabs={TABS} value={type} onChange={p.onType} />
        </div>
      </div>

      {type === "SM" && p.smUseError && <UseReadError onRetry={p.onSmUseRetry} />}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-border bg-card px-4 py-3">
          <div className="text-sm text-muted-foreground">มูลค่าสต๊อก {type}</div>
          <div className="font-mono text-2xl font-semibold">{baht(totalValue)}</div>
          <div className="text-xs text-muted-foreground">{base.length} รายการ{type === "RM" && ckOnly ? " · เฉพาะของที่ครัวใช้" : ""}</div>
        </div>
        <div className="rounded-2xl border border-border bg-card px-4 py-3">
          <div className="text-sm text-muted-foreground">เหลือใช้ได้ (เฉลี่ยตามช่องเก็บ)</div>
          <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1">
            {(["Chilled", "Frozen", "Ambient"] as const).map((k) => (
              <div key={k}>
                <div className="text-xs text-muted-foreground">{STORAGE[k]}</div>
                <div className="font-mono text-lg font-semibold">{cover[k] != null ? `${cover[k]!.toFixed(1)} วัน` : "—"}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-card px-4 py-3">
          <div className="text-sm text-muted-foreground">นับล่าสุด</div>
          <div className="text-xl font-semibold">{lastCount ? new Date(lastCount + "T00:00:00").toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" }) : "ยังไม่เคยนับ"}</div>
          <div className="text-xs text-muted-foreground">{neverCounted ? `ยังไม่เคยนับ ${neverCounted} รายการที่มียอด` : "ทุกรายการที่มียอดเคยนับแล้ว"}</div>
        </div>
      </div>

      {(lowNames.length > 0 || negativeNames.length > 0 || unusualNames.length > 0) && (
        <section data-tour="ks-attention" className="overflow-hidden rounded-2xl border border-border bg-card">
          <h2 className="px-4 pt-3 text-base font-bold">เรื่องที่ต้องดู</h2>
          {lowNames.length > 0 && (
            <button type="button" onClick={() => setFilter("low")} className="flex w-full items-start gap-3 border-t border-border px-4 py-3 text-left hover:bg-secondary/50 first-of-type:border-t-0">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-destructive/10 font-bold text-destructive">!</span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">ใกล้หมด · เหลือน้อยกว่า {LOW_DAYS} วัน ({lowNames.length})</span>
                <span className="block break-words text-sm text-muted-foreground">{lowNames.slice(0, 5).map((r) => `${r.sku.name} ${r.daysLeft!.toFixed(1)} วัน`).join(" · ")}{lowNames.length > 5 ? " · …" : ""}</span>
              </span>
            </button>
          )}
          {negativeNames.length > 0 && (
            <button type="button" onClick={() => setFilter("negative")} className="flex w-full items-start gap-3 border-t border-border px-4 py-3 text-left hover:bg-secondary/50">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-destructive/10 font-bold text-destructive">−</span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">ติดลบ ({negativeNames.length}) · ใช้มากกว่าที่ระบบเห็นว่ามี ควรเช็คของเข้าหรือนับใหม่</span>
                <span className="block break-words text-sm text-muted-foreground">{negativeNames.slice(0, 5).map((r) => `${r.sku.name} ${n0(r.stock)} ${r.sku.usageUom}`).join(" · ")}{negativeNames.length > 5 ? " · …" : ""}</span>
              </span>
            </button>
          )}
          {unusualNames.length > 0 && (
            <button type="button" onClick={() => setFilter("unusual")} className="flex w-full items-start gap-3 border-t border-border px-4 py-3 text-left hover:bg-secondary/50">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-warning-soft font-bold text-warning">!</span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">ยอดโตผิดปกติ · ควรนับจริง ({unusualNames.length})</span>
                <span className="block break-words text-sm text-muted-foreground">{unusualNames.slice(0, 5).map((r) => `${r.sku.name} ${n0(r.stock)} ${r.sku.usageUom}${r.lastCount ? ` · พอใช้ ${r.daysLeft ? Math.round(r.daysLeft) : "—"} วัน` : " · ไม่เคยนับ"}`).join(" · ")}</span>
              </span>
            </button>
          )}
        </section>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative">
          <span className="sr-only">ค้นหา</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ค้นรหัส หรือชื่อ…" className="h-10 w-[220px] rounded-xl border border-border bg-card pl-9 pr-3 text-base sm:text-sm" />
        </label>
        <button type="button" className={chip(filter === "all")} onClick={() => setFilter("all")}>ทั้งหมด {base.length}</button>
        <button type="button" className={chip(filter === "low", "bad")} onClick={() => setFilter("low")}>ใกล้หมด {counts.low}</button>
        <button type="button" className={chip(filter === "negative", "bad")} onClick={() => setFilter("negative")}>ติดลบ {counts.negative}</button>
        {type === "SM" && <button type="button" className={chip(filter === "unusual", "warn")} onClick={() => setFilter("unusual")}>ยอดผิดปกติ {counts.unusual}</button>}
        <button type="button" className={chip(filter === "stale", "warn")} onClick={() => setFilter("stale")}>ไม่ได้นับนาน {counts.stale}</button>
        <select aria-label="หมวด" value={category} onChange={(e) => setCategory(e.target.value)} className={select}>
          <option value="all">ทุกหมวด</option>
          {catsHere.map((c) => (
            <option key={c} value={c}>{catName.get(c) ?? c}</option>
          ))}
        </select>
        <select aria-label="ช่องเก็บ" value={storage} onChange={(e) => setStorage(e.target.value)} className={select}>
          <option value="all">ทุกช่องเก็บ</option>
          {Object.entries(STORAGE).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        {type === "RM" && (
          <label className="ml-auto inline-flex min-h-[40px] cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" className="h-5 w-5" checked={ckOnly} onChange={(e) => setCkOnly(e.target.checked)} />
            เฉพาะของที่ครัวใช้ (อยู่ในสูตร SM หรือส่งสาขา)
          </label>
        )}
      </div>

      <div ref={fitRef} data-tour="ks-list">
        {fits ? (
          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            <table className="w-full table-fixed text-sm">
              <colgroup>
                <col />
                <col style={{ width: "104px" }} />
                <col style={{ width: "88px" }} />
                <col style={{ width: "128px" }} />
                <col style={{ width: "120px" }} />
                <col style={{ width: "84px" }} />
                <col style={{ width: "96px" }} />
                <col style={{ width: "92px" }} />
              </colgroup>
              <thead className="bg-secondary/60 text-left text-[13px] text-muted-foreground">
                <tr>
                  <SortTh k="name">สินค้า</SortTh>
                  <SortTh k="stock" right>คงเหลือ</SortTh>
                  <SortTh k="value" right>มูลค่า</SortTh>
                  <th className="px-3 py-2.5 font-medium">นับล่าสุด</th>
                  <th className="px-3 py-2.5 font-medium">{lastInLabel}</th>
                  <SortTh k="days" right>เหลือใช้ได้</SortTh>
                  <th className="px-3 py-2.5 text-right font-medium">ใช้/สัปดาห์</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.sku.id} className="border-t border-border align-top">
                    <td className="px-3 py-2.5">
                      <button type="button" onClick={() => setCardFor(r)} className="break-words text-left font-semibold leading-snug hover:underline">
                        {r.sku.name}
                      </button>
                      {tags(r)}
                      <div className="break-words font-mono text-xs text-muted-foreground">
                        {r.sku.skuId} · {STORAGE[r.sku.storageCondition] ?? r.sku.storageCondition}
                      </div>
                    </td>
                    <td className={cn("px-3 py-2.5 text-right font-mono tabular-nums", r.flags.negative && "text-destructive")}>
                      {n0(r.stock)} <span className="font-sans text-xs text-muted-foreground">{r.sku.usageUom}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums">{r.unitCost > 0 ? baht(r.value) : <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-3 py-2.5 text-[13px]">{countCell(r)}</td>
                    <td className="break-words px-3 py-2.5 text-[13px]">
                      {r.lastIn ? (
                        <>
                          {thaiDate(r.lastIn.date)}
                          {r.lastIn.from && <span className="block text-xs text-muted-foreground">{r.lastIn.from}</span>}
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums">{daysCell(r)}</td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums">{r.perDay > 0 ? n0(r.perDay * 7) : <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-2 py-2">
                      <div className="flex justify-end gap-1">
                        {p.canEdit && (
                          <button type="button" aria-label={`ปรับยอด ${r.sku.name}`} title="ปรับยอด" onClick={() => setAdjustFor(r)} className="flex h-10 w-10 items-center justify-center rounded-xl border border-border hover:bg-secondary">
                            <SlidersHorizontal className="h-4 w-4" />
                          </button>
                        )}
                        <button type="button" aria-label={`ประวัติเข้า-ออก ${r.sku.name}`} title="ประวัติเข้า-ออก" onClick={() => setCardFor(r)} className="flex h-10 w-10 items-center justify-center rounded-xl border border-border hover:bg-secondary">
                          <History className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!shown.length && (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">ไม่มีรายการ</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
            {shown.map((r) => (
              <li key={r.sku.id} className="flex flex-col gap-1.5 px-4 py-3">
                <button type="button" onClick={() => setCardFor(r)} className="flex items-start justify-between gap-3 text-left">
                  <span className="min-w-0">
                    <span className="break-words font-semibold leading-snug">{r.sku.name}</span>
                    {tags(r)}
                    <span className="block font-mono text-xs text-muted-foreground">{r.sku.skuId}</span>
                  </span>
                  <span className={cn("shrink-0 text-right font-mono font-semibold tabular-nums", r.flags.negative && "text-destructive")}>
                    {n0(r.stock)} <span className="font-sans text-xs font-normal text-muted-foreground">{r.sku.usageUom}</span>
                    <span className="block text-xs font-normal text-muted-foreground">{r.unitCost > 0 ? baht(r.value) : "—"}</span>
                  </span>
                </button>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
                  <span>เหลือใช้ {daysCell(r)}</span>
                  <span>นับ {countCell(r)}</span>
                  {r.lastIn && <span className="text-muted-foreground">{lastInLabel} {thaiDate(r.lastIn.date)}</span>}
                </div>
                {p.canEdit && (
                  <div className="flex gap-2">
                    <Button variant="outline" className="h-10 flex-1" onClick={() => setAdjustFor(r)}>ปรับยอด</Button>
                    <Button variant="outline" className="h-10 flex-1" onClick={() => setCardFor(r)}>ประวัติ</Button>
                  </div>
                )}
              </li>
            ))}
            {!shown.length && <li className="px-4 py-10 text-center text-muted-foreground">ไม่มีรายการ</li>}
          </ul>
        )}
      </div>

      {adjustFor && (
        <AdjustSheet
          sku={adjustFor.sku}
          stock={adjustFor.stock}
          anchor={(type === "SM" ? p.sm.getAnchor(adjustFor.sku.id) : (type === "RM" ? p.rm : p.pk).getAnchor(adjustFor.sku.id)) ?? null}
          onSave={(adj) => (type === "SM" ? p.sm.addAdjustment(adj) : (type === "RM" ? p.rm : p.pk).addAdjustment(adj))}
          onClose={() => setAdjustFor(null)}
        />
      )}
      {cardFor && (
        <StockCard
          skuId={cardFor.sku.id}
          skuType={type}
          sku={cardFor.sku}
          skus={p.skus}
          currentStock={cardFor.stock}
          stockValue={cardFor.value}
          onClose={() => setCardFor(null)}
        />
      )}
      <GuideTour steps={GUIDE} open={guide.open} onClose={guide.close} />
    </div>
  );
}
