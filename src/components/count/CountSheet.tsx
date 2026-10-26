import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Search, WifiOff } from "lucide-react";
import type { SKU } from "@/types/sku";
import type { DailyStockCountRow } from "@/hooks/use-daily-stock-count";
import { isPacksMode } from "@/lib/receive-rows";
import { ZONES, differenceOf, isBigDifference, zoneLabel, zoneOf, type Zone } from "@/lib/stock-count";
import { ActionFooter } from "@/components/receive/parts";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const n0 = (n: number) => Math.round(n).toLocaleString();
// The name column never goes below 220px: names are what people count by
const GRID = "grid grid-cols-[minmax(220px,1fr)_80px_80px_100px_110px_100px_150px_120px] items-center gap-3";
// Less room (a laptop with the side menu open, Windows zoom 125–150%): opening /
// received / used move under the name, the boxes and the result keep their columns
const GRID_COMPACT = "grid grid-cols-[minmax(200px,1fr)_104px_96px_150px_96px] items-center gap-3";
/** Room the sheet itself has (not the screen): full table, compact table, or cards */
const FULL_AT = 1100;
const COMPACT_AT = 740;
type Layout = "full" | "compact" | "cards";
const PACK_MODE_KEY = "ck-count-pack-mode";
const readPackMode = (): Record<string, boolean> => {
  try {
    return JSON.parse(localStorage.getItem(PACK_MODE_KEY) || "{}");
  } catch {
    return {};
  }
};

export interface SheetLine {
  row: DailyStockCountRow;
  sku: SKU;
  /** Kitchen + supplier, in usage units */
  received: number;
}

/**
 * The counting screen: zone tabs (or the person's own order as one list), one
 * box per product on the right, Enter to the next product; the next zone and
 * finally the review screen follow on their own.
 */
export function CountSheet({
  lines,
  zoned,
  locked,
  salesIn,
  saveState,
  onCount,
  onWaste,
  onOpenCard,
  onDone,
  onZoneChange,
}: {
  lines: SheetLine[];
  /** false = the person's own saved order, one list */
  zoned: boolean;
  locked: boolean;
  /** Sales for the day are in, so balances and differences mean something */
  salesIn: boolean;
  saveState: Record<string, "saving" | "waiting">;
  onCount: (rowId: string, value: number | null) => void;
  onWaste: (rowId: string, value: number) => void;
  onOpenCard: (skuId: string) => void;
  onDone: () => void;
  onZoneChange?: () => void;
}) {
  const zonesHere = useMemo(() => ZONES.filter((z) => lines.some((l) => zoneOf(l.sku) === z.key)), [lines]);
  const firstOpen = zonesHere.find((z) => lines.some((l) => zoneOf(l.sku) === z.key && l.row.physicalCount === null))?.key ?? zonesHere[0]?.key ?? "dry";
  const [zone, setZone] = useState<Zone>(firstOpen);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [packMode, setPackMode] = useState<Record<string, boolean>>(readPackMode);
  const listRef = useRef<HTMLUListElement>(null);
  const focusFirstOnZone = useRef(false);
  // The layout follows the room this sheet has, not the screen: with the side menu
  // and the panel on the left, a 1280px laptop leaves the table ~600px and a fixed
  // 8-column table squeezed the names to nothing
  const rootRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<Layout>(() => (typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches ? "compact" : "cards"));
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      setLayout(w >= FULL_AT ? "full" : w >= COMPACT_AT ? "compact" : "cards");
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const wide = layout !== "cards";
  const grid = layout === "full" ? GRID : GRID_COMPACT;

  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = words.length
    ? lines.filter((l) => words.every((w) => `${l.sku.name} ${l.sku.skuId}`.toLowerCase().includes(w)))
    : zoned
      ? lines.filter((l) => zoneOf(l.sku) === zone)
      : lines;
  const counted = lines.filter((l) => l.row.physicalCount !== null).length;
  const zoneCounted = (z: Zone) => lines.filter((l) => zoneOf(l.sku) === z && l.row.physicalCount !== null).length;
  const zoneTotal = (z: Zone) => lines.filter((l) => zoneOf(l.sku) === z).length;
  const waiting = Object.values(saveState).filter((s) => s === "waiting").length;
  const zoneIdx = zonesHere.findIndex((z) => z.key === zone);
  const nextZone = zoned && !words.length ? zonesHere[zoneIdx + 1] : undefined;

  const goZone = (z: Zone, focus = false) => {
    focusFirstOnZone.current = focus;
    setZone(z);
    onZoneChange?.();
    window.scrollTo({ top: 0 });
  };
  useEffect(() => {
    if (!focusFirstOnZone.current) return;
    focusFirstOnZone.current = false;
    setTimeout(() => listRef.current?.querySelector<HTMLInputElement>("input:not([data-noflow])")?.focus(), 50);
  }, [zone]);

  /** Enter: next box; after the last box of a zone the next zone; after the last of all, review */
  const onKeyDown = (e: React.KeyboardEvent<HTMLUListElement>) => {
    const t = e.target as HTMLInputElement;
    if (e.key !== "Enter" || t.tagName !== "INPUT") return;
    e.preventDefault();
    const list = e.currentTarget;
    const before = [...list.querySelectorAll("input:not([data-noflow])")].indexOf(t);
    t.blur();
    setTimeout(() => {
      const next = [...list.querySelectorAll<HTMLInputElement>("input:not([data-noflow])")][before + 1];
      if (next) {
        next.focus();
        next.scrollIntoView({ block: "center" });
      } else if (nextZone) goZone(nextZone.key, true);
      else onDone();
    }, 0);
  };

  const togglePack = (skuId: string) =>
    setPackMode((p) => {
      const n = { ...p, [skuId]: !p[skuId] };
      try {
        localStorage.setItem(PACK_MODE_KEY, JSON.stringify(n));
      } catch {
        // remembered only for this visit
      }
      return n;
    });

  return (
    <div ref={rootRef} className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        {zoned ? (
          <div role="tablist" data-tour="count-zones" className="grid flex-1 grid-cols-3 gap-1.5">
            {zonesHere.map((z) => {
              const done = zoneCounted(z.key) === zoneTotal(z.key);
              return (
                <button
                  key={z.key}
                  role="tab"
                  type="button"
                  aria-selected={zone === z.key && !words.length}
                  onClick={() => goZone(z.key)}
                  className={cn(
                    "flex min-h-[52px] flex-col items-center justify-center rounded-xl border text-[13px]",
                    zone === z.key && !words.length ? "border-primary bg-primary font-semibold text-primary-foreground" : done ? "border-border bg-success-soft" : "border-border bg-card",
                  )}
                >
                  {z.label}
                  <span className={cn("font-mono text-xs", zone === z.key && !words.length ? "opacity-80" : done ? "text-success" : "text-muted-foreground")}>
                    {zoneCounted(z.key)}/{zoneTotal(z.key)}
                    {done && " ✓"}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-1 items-center gap-2">
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
              <span className="block h-full bg-success" style={{ width: `${lines.length ? (counted / lines.length) * 100 : 0}%` }} />
            </span>
            <span className="font-mono text-sm">
              {counted}/{lines.length}
            </span>
          </div>
        )}
        {searching ? (
          <label className="relative block w-40">
            <span className="sr-only">ค้นสินค้า</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} onBlur={() => !query && setSearching(false)} placeholder="ค้น…" className="h-11 pl-9 text-base" />
          </label>
        ) : (
          <button type="button" aria-label="ค้นสินค้า" onClick={() => setSearching(true)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border bg-card">
            <Search className="h-4 w-4" />
          </button>
        )}
      </div>
      {!zoned && <p className="-mt-1 text-xs text-muted-foreground">เรียงตามลำดับที่จัดไว้เอง</p>}
      {!salesIn && <div className="rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning">ยังไม่ได้นำเข้ายอดขายวันนี้ นับได้ตามปกติ แต่คงเหลือกับขาด/เกินจะยังไม่ถูก ตัวเลขจะอัปเดตเองหลังนำเข้า</div>}

      {wide && (
        <div className={cn(grid, "rounded-t-2xl border border-b-0 border-border bg-secondary px-4 py-2.5 text-xs font-semibold text-muted-foreground")}>
          <span>สินค้า</span>
          {layout === "full" && (
            <>
              <span className="text-right">ยกมา</span>
              <span className="text-right">รับเข้า</span>
              <span className="text-right">ใช้ (ตัด BOM)</span>
            </>
          )}
          <span className="text-right">ของเสีย</span>
          <span className="text-right">คงเหลือ</span>
          <span className="text-right text-foreground">นับได้</span>
          <span className="text-right">ขาด / เกิน</span>
        </div>
      )}
      <ul ref={listRef} data-tour="count-list" className={cn("flex flex-col", wide ? "-mt-3 divide-y divide-border overflow-hidden rounded-b-2xl border border-border bg-card" : "gap-2")} onKeyDown={onKeyDown}>
        {shown.map((l, idx) => wide ? (
          <DesktopRow
            key={l.row.id}
            line={l}
            compact={layout === "compact"}
            first={idx === 0}
            locked={locked}
            salesIn={salesIn}
            save={saveState[l.row.id]}
            onCount={onCount}
            onWaste={onWaste}
            onOpenCard={onOpenCard}
          />
        ) : (
          <CountRow
            key={l.row.id}
            line={l}
            first={idx === 0}
            locked={locked}
            salesIn={salesIn}
            showZone={!zoned || words.length > 0}
            packMode={!!packMode[l.sku.id] && isPacksMode(l.sku)}
            onTogglePack={() => togglePack(l.sku.id)}
            save={saveState[l.row.id]}
            onCount={onCount}
            onWaste={onWaste}
            onOpenCard={onOpenCard}
          />
        ))}
        {!shown.length && <li className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">ไม่พบสินค้า</li>}
      </ul>

      <ActionFooter
        title={zoned && !words.length ? `${zoneLabel(zone)} ${zoneCounted(zone)}/${zoneTotal(zone)} · ทั้งหมด ${counted}/${lines.length}` : `นับแล้ว ${counted}/${lines.length}`}
        sub={waiting ? `เน็ตหลุด · ยังไม่บันทึก ${waiting} รายการ` : "บันทึกให้อัตโนมัติทุกช่อง"}
        action={nextZone && counted < lines.length ? "โซนถัดไป" : "ตรวจและนับเสร็จ"}
        onAction={() => (nextZone && counted < lines.length ? goZone(nextZone.key) : onDone())}
      />
    </div>
  );
}

function CountRow({
  line,
  first,
  locked,
  salesIn,
  showZone,
  packMode,
  onTogglePack,
  save,
  onCount,
  onWaste,
  onOpenCard,
}: {
  line: SheetLine;
  first: boolean;
  locked: boolean;
  salesIn: boolean;
  showZone: boolean;
  packMode: boolean;
  onTogglePack: () => void;
  save?: "saving" | "waiting";
  onCount: (rowId: string, value: number | null) => void;
  onWaste: (rowId: string, value: number) => void;
  onOpenCard: (skuId: string) => void;
}) {
  const { row, sku, received } = line;
  const uom = sku.usageUom;
  const [wasteOpen, setWasteOpen] = useState(row.waste > 0);
  const diff = differenceOf(row);
  const big = isBigDifference(row, sku.packSize || 1);
  const packs = isPacksMode(sku);
  const commit = (raw: string) => {
    if (raw.trim() === "") return row.physicalCount !== null && onCount(row.id, null);
    const v = Math.max(0, Number(raw.replace(/,/g, "")) || 0);
    if (v !== row.physicalCount) onCount(row.id, v);
  };
  // Pack mode: full packs + loose units, saved as their sum
  const fullPacks = row.physicalCount !== null ? Math.floor(row.physicalCount / (sku.packSize || 1)) : null;
  const loose = row.physicalCount !== null && fullPacks !== null ? row.physicalCount - fullPacks * (sku.packSize || 1) : null;
  const packRef = useRef<HTMLInputElement>(null);
  const looseRef = useRef<HTMLInputElement>(null);
  const commitPacks = () => {
    const p = packRef.current?.value.trim() ?? "";
    const l = looseRef.current?.value.trim() ?? "";
    if (p === "" && l === "") return row.physicalCount !== null && onCount(row.id, null);
    const v = (Math.max(0, Math.round(Number(p) || 0)) * (sku.packSize || 1)) + Math.max(0, Number(l.replace(/,/g, "")) || 0);
    if (v !== row.physicalCount) onCount(row.id, v);
  };
  const box = "flex h-11 w-[140px] items-center overflow-hidden rounded-xl border bg-background focus-within:ring-2 focus-within:ring-ring";
  const inputCls = "h-full w-full min-w-0 bg-transparent px-2 text-right font-mono text-[17px] tabular-nums outline-none placeholder:font-sans placeholder:text-sm placeholder:text-muted-foreground/70";

  return (
    <li className={cn("flex flex-col gap-2 rounded-2xl border bg-card p-3", big ? "border-warning" : row.physicalCount === null ? "border-dashed border-border" : "border-border")}>
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {showZone && <span className="text-xs text-muted-foreground">{zoneLabel(zoneOf(sku))}</span>}
          <button type="button" onClick={() => onOpenCard(sku.id)} className="text-left text-[15px] font-semibold leading-snug hover:underline">
            {sku.name}
          </button>
          <div className="text-sm">
            {salesIn ? (
              <>
                คงเหลือ <b className={cn("font-mono", row.calculatedBalance < 0 && "text-destructive")}>{n0(row.calculatedBalance)}</b> {uom}
              </>
            ) : (
              <span className="text-warning">คงเหลือ รอยอดขาย</span>
            )}
          </div>
          {packs && <div className="text-xs text-muted-foreground">1 {sku.packUnit} = {n0(sku.packSize)} {uom}</div>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="text-xs text-muted-foreground">นับได้</span>
          {packMode ? (
            <>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                เต็ม
                <span className={cn(box, "w-[96px]", "border-input")}>
                  <input ref={packRef} aria-label={`${sku.packUnit}เต็ม ${sku.name}`} inputMode="numeric" enterKeyHint="next" disabled={locked} defaultValue={fullPacks ?? ""} key={`p${row.physicalCount}`} onBlur={commitPacks} onFocus={(e) => e.target.select()} className={inputCls} />
                </span>
                {sku.packUnit}
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                + เศษ
                <span className={cn(box, "w-[96px]", "border-input")}>
                  <input ref={looseRef} aria-label={`เศษ ${sku.name}`} inputMode="decimal" enterKeyHint="next" disabled={locked} defaultValue={loose ?? ""} key={`l${row.physicalCount}`} onBlur={commitPacks} onFocus={(e) => e.target.select()} className={inputCls} />
                </span>
                {uom}
              </div>
              {row.physicalCount !== null && <span className="text-sm font-semibold">= {n0(row.physicalCount)} {uom}</span>}
            </>
          ) : (
            <span data-tour={first ? "count-box" : undefined} className={cn(box, row.physicalCount !== null ? "border-[1.5px] border-foreground" : "border-input bg-secondary/40")}>
              <input
                aria-label={`นับได้ ${sku.name}`}
                inputMode="decimal"
                enterKeyHint="next"
                disabled={locked}
                defaultValue={row.physicalCount ?? ""}
                key={`c${row.physicalCount}`}
                placeholder="ยังไม่นับ"
                onBlur={(e) => commit(e.target.value)}
                onFocus={(e) => e.target.select()}
                className={inputCls}
              />
              <span className="shrink-0 pr-3 text-sm text-muted-foreground">{uom}</span>
            </span>
          )}
          {save === "waiting" ? (
            <span className="flex items-center gap-1 text-xs font-semibold text-warning">
              <WifiOff className="h-3 w-3" /> เน็ตหลุด ยังไม่บันทึก
            </span>
          ) : diff !== null && salesIn ? (
            <span className={cn("text-xs", big ? "font-semibold text-warning" : "text-success")}>
              {diff === 0 ? "ตรง" : diff > 0 ? `เกิน ${n0(diff)} ${uom}` : `ขาด ${n0(-diff)} ${uom}`}
              {big && " นับซ้ำอีกที?"}
              {save !== "saving" && !big && <Check className="ml-1 inline h-3 w-3" />}
            </span>
          ) : row.physicalCount === null ? (
            <span className="text-xs text-muted-foreground">ไม่มีของ ใส่ 0</span>
          ) : (
            <span className="text-xs text-muted-foreground">บันทึกแล้ว</span>
          )}
        </div>
      </div>

      {/* Reconcile: where the balance comes from */}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 rounded-lg bg-secondary/60 px-2.5 py-1.5 font-mono text-xs text-muted-foreground">
        <span>ยกมา {n0(row.openingBalance)}</span>
        <span className={received ? "text-success" : ""}>รับ +{n0(received)}</span>
        {salesIn ? <span>ใช้ (ตัด BOM) −{n0(row.expectedUsage)}</span> : <span className="text-warning">ใช้ (ตัด BOM) รอยอดขาย</span>}
        <span>เสีย −{n0(row.waste)}</span>
        {row.adjNet !== 0 && <span>ปรับ {row.adjNet > 0 ? "+" : "−"}{n0(Math.abs(row.adjNet))}</span>}
        {salesIn && <span className={cn("font-semibold text-foreground", row.calculatedBalance < 0 && "text-destructive")}>= {n0(row.calculatedBalance)}</span>}
      </div>

      {!locked && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
          {wasteOpen ? (
            <label className="flex items-center gap-1.5 text-muted-foreground">
              ของเสีย (ทิ้งวันนี้)
              <span className="flex h-9 w-[90px] items-center overflow-hidden rounded-lg border border-input bg-background">
                <input
                  data-noflow=""
                  aria-label={`ของเสีย ${sku.name}`}
                  inputMode="decimal"
                  defaultValue={row.waste || ""}
                  key={`w${row.waste}`}
                  onBlur={(e) => {
                    const v = Math.max(0, Number(e.target.value.replace(/,/g, "")) || 0);
                    if (v !== row.waste) onWaste(row.id, v);
                  }}
                  className="h-full w-full min-w-0 bg-transparent px-2 text-right font-mono text-base outline-none"
                />
              </span>
              {uom}
            </label>
          ) : (
            <button type="button" onClick={() => setWasteOpen(true)} className="min-h-[32px] text-muted-foreground hover:text-foreground">
              + ของเสีย (ทิ้งวันนี้)
            </button>
          )}
          {packs && (
            <button type="button" onClick={onTogglePack} className="min-h-[32px] font-semibold text-brand">
              {packMode ? `นับเป็น ${uom}` : `นับเป็น${sku.packUnit}`}
            </button>
          )}
        </div>
      )}
    </li>
  );
}

/** One product as a table line (computers): the old columns, two boxes, Enter flows down */
function DesktopRow({
  line,
  compact,
  first,
  locked,
  salesIn,
  save,
  onCount,
  onWaste,
  onOpenCard,
}: {
  line: SheetLine;
  /** Opening / received / used shown under the name instead of in columns */
  compact: boolean;
  first: boolean;
  locked: boolean;
  salesIn: boolean;
  save?: "saving" | "waiting";
  onCount: (rowId: string, value: number | null) => void;
  onWaste: (rowId: string, value: number) => void;
  onOpenCard: (skuId: string) => void;
}) {
  const { row, sku, received } = line;
  const diff = differenceOf(row);
  const big = isBigDifference(row, sku.packSize || 1);
  const num = "text-right font-mono text-sm tabular-nums";
  return (
    <li className={cn(compact ? GRID_COMPACT : GRID, "px-4 py-2", big && "bg-warning-soft/40")}>
      {/* The whole name, on as many lines as it needs: never cut */}
      <span className="min-w-0">
        <button type="button" onClick={() => onOpenCard(sku.id)} className="block max-w-full break-words text-left text-sm font-semibold leading-snug hover:underline">
          {sku.name}
        </button>
        <span className="block break-words text-xs text-muted-foreground">
          {sku.skuId} · {sku.usageUom}
          {isPacksMode(sku) && ` · 1 ${sku.packUnit} = ${n0(sku.packSize)}`}
        </span>
        {compact && (
          <span className="block font-mono text-xs tabular-nums text-muted-foreground">
            ยกมา {n0(row.openingBalance)} · รับ {received ? `+${n0(received)}` : "—"} · ใช้ {salesIn ? `−${n0(row.expectedUsage)}` : "รอยอดขาย"}
          </span>
        )}
      </span>
      {!compact && (
        <>
          <span className={num}>{n0(row.openingBalance)}</span>
          <span className={cn(num, received ? "text-success" : "text-muted-foreground")}>{received ? `+${n0(received)}` : "—"}</span>
          <span className={num}>{salesIn ? `−${n0(row.expectedUsage)}` : <span className="font-sans text-xs text-warning">รอยอดขาย</span>}</span>
        </>
      )}
      <span className="flex justify-end">
        <span className="flex h-10 w-[96px] items-center overflow-hidden rounded-lg border border-input bg-background">
          <input
            data-noflow=""
            aria-label={`ของเสีย ${sku.name}`}
            inputMode="decimal"
            disabled={locked}
            defaultValue={row.waste || ""}
            key={`w${row.waste}`}
            onBlur={(e) => {
              const v = Math.max(0, Number(e.target.value.replace(/,/g, "")) || 0);
              if (v !== row.waste) onWaste(row.id, v);
            }}
            className="h-full w-full min-w-0 bg-transparent px-2 text-right font-mono text-sm outline-none"
          />
        </span>
      </span>
      <span className={cn(num, "font-semibold", row.calculatedBalance < 0 && "text-destructive")}>{salesIn ? n0(row.calculatedBalance) : "—"}</span>
      <span className="flex justify-end">
        <span data-tour={first ? "count-box" : undefined} className={cn("flex h-10 w-[140px] items-center overflow-hidden rounded-lg border bg-background focus-within:ring-2 focus-within:ring-ring", row.physicalCount !== null ? "border-[1.5px] border-foreground" : "border-input bg-secondary/40")}>
          <input
            aria-label={`นับได้ ${sku.name}`}
            inputMode="decimal"
            enterKeyHint="next"
            disabled={locked}
            defaultValue={row.physicalCount ?? ""}
            key={`c${row.physicalCount}`}
            placeholder="ยังไม่นับ"
            onFocus={(e) => e.target.select()}
            onBlur={(e) => {
              const raw = e.target.value;
              if (raw.trim() === "") return row.physicalCount !== null && onCount(row.id, null);
              const v = Math.max(0, Number(raw.replace(/,/g, "")) || 0);
              if (v !== row.physicalCount) onCount(row.id, v);
            }}
            className="h-full w-full min-w-0 bg-transparent px-2 text-right font-mono text-base tabular-nums outline-none placeholder:font-sans placeholder:text-xs placeholder:text-muted-foreground/70"
          />
        </span>
      </span>
      <span className={cn("text-right text-sm", save === "waiting" ? "font-semibold text-warning" : big ? "font-semibold text-warning" : "text-success")}>
        {save === "waiting" ? "เน็ตหลุด" : diff === null || !salesIn ? <span className="text-muted-foreground">—</span> : diff === 0 ? "ตรง" : diff > 0 ? `เกิน ${n0(diff)}` : `ขาด ${n0(-diff)}`}
      </span>
    </li>
  );
}
