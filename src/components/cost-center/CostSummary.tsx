import { ChevronRight } from "lucide-react";
import type { CostVariance, Mover, PlaceRow } from "@/lib/cost-variance";
import { cn } from "@/lib/utils";

/**
 * Cost Center's top card (owner, 8 Nov 2026, board "แบบ 6"): one closed month's food
 * cost, actual against the recipes, the difference by place (kitchen, each branch) and
 * by cause (amount used / price), and the items that moved it most — either way.
 * Colour only on the totals: red = cost more than the recipe, green = less. Numbers in the
 * text face with even-width digits (the owner found the typewriter face heavy here).
 */
interface Props {
  v: CostVariance;
  /** "ต.ค. 2569" */
  monthLabel: string;
  onOpenPlace?: (row: PlaceRow) => void;
  onOpenMover?: (m: Mover) => void;
}

const baht = (n: number) => Math.round(Math.abs(n)).toLocaleString("en-US");
const signed = (n: number) => {
  const r = Math.round(n);
  return r === 0 ? "0" : `${r > 0 ? "+" : "−"}${baht(r)}`;
};
const signedBaht = (n: number) => {
  const r = Math.round(n);
  return r === 0 ? "฿0" : `${r > 0 ? "+" : "−"}฿${baht(r)}`;
};
const tone = (n: number) => (Math.round(n) > 0 ? "text-destructive" : Math.round(n) < 0 ? "text-success" : "text-muted-foreground");
const pct = (n: number | null) => (n === null ? "–" : `${n.toFixed(1)}%`);

const STATE_TEXT: Record<Exclude<PlaceRow["state"], "ok">, string> = {
  loading: "กำลังคิด…",
  failed: "โหลดไม่ได้",
  nocount: "ไม่มียอดนับปิดเดือน",
};

export function CostSummary({ v, monthLabel, onOpenPlace, onOpenMover }: Props) {
  const busy = !v.done;
  return (
    <section aria-label={`Food cost ${monthLabel}`} className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 shadow-card">
      <h2 className="text-base font-bold">Food cost · {monthLabel}</h2>

      <div className="grid grid-cols-[auto_auto_1fr] items-end gap-x-4">
        <div className="min-w-0">
          <p className="text-[13px] text-muted-foreground">ใช้จริง</p>
          <p className="text-[28px] font-bold leading-tight tabular-nums">{busy ? "…" : pct(v.actPct)}</p>
        </div>
        <div className="min-w-0">
          <p className="text-[13px] text-muted-foreground">ตามสูตร</p>
          <p className="text-[22px] font-bold leading-tight text-muted-foreground tabular-nums">{pct(v.stdPct)}</p>
        </div>
        <div className="min-w-0 text-right">
          <p className="text-[13px] text-muted-foreground">จริง − สูตร</p>
          <p className={cn("whitespace-nowrap text-[22px] font-bold leading-tight tabular-nums", busy ? "text-muted-foreground" : tone(v.total))}>{busy ? "…" : signedBaht(v.total)}</p>
        </div>
      </div>

      {/* The % covers only the places counted at both month ends: say so, never a quiet low figure */}
      {v.done && v.counted < v.places && (
        <p className="text-[13px] text-muted-foreground">
          นับครบ {v.counted}/{v.places} ที่ · ตัวเลขข้างบนคิดจากที่นับครบเท่านั้น
        </p>
      )}

      <p className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
        <span className="text-destructive">+ แดง = จ่ายเกินสูตร</span>
        <span className="text-success">− เขียว = ประหยัดกว่าสูตร</span>
      </p>

      <div>
        <div className="grid grid-cols-[minmax(0,1fr)_64px_64px_76px] pb-1.5 text-right text-xs text-muted-foreground">
          <span />
          <span>ปริมาณ</span>
          <span>ราคา</span>
          <span>รวม</span>
        </div>
        <ul className="flex flex-col">
          {v.rows.map((r) => (
            <li key={r.key} className="border-t border-border/70">
              <button
                type="button"
                disabled={!onOpenPlace || r.state !== "ok"}
                onClick={() => onOpenPlace?.(r)}
                className="grid min-h-[44px] w-full grid-cols-[minmax(0,1fr)_64px_64px_76px] items-center text-right text-sm disabled:cursor-default"
              >
                <span className="truncate text-left text-foreground">{r.name}</span>
                {r.state === "ok" ? (
                  <>
                    <span className="tabular-nums text-muted-foreground">{signed(r.usage)}</span>
                    <span className="tabular-nums text-muted-foreground">{signed(r.price)}</span>
                    <span className={cn("font-semibold tabular-nums", tone(r.total))}>{signed(r.total)}</span>
                  </>
                ) : (
                  <span className="col-span-3 text-[13px] text-muted-foreground">{r.note ?? STATE_TEXT[r.state]}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>

      {v.movers.length > 0 && (
        <div>
          <p className="pb-1 text-[13px] text-muted-foreground">ขยับมากสุด</p>
          <ul className="flex flex-col">
            {v.movers.map((m) => (
              <li key={`${m.placeKey}-${m.skuId}`}>
                <button type="button" disabled={!onOpenMover} onClick={() => onOpenMover?.(m)} className="flex min-h-[40px] w-full items-center gap-2 text-left text-sm disabled:cursor-default">
                  {/* The whole name (they run long: "เส้นตรง แป้งโฮลวีท ขนาด 1.5 มม."), the place under it */}
                  <span className="min-w-0 flex-1 py-1.5 leading-snug">
                    <span className="block break-words">{m.name}</span>
                    <span className="block text-[13px] text-muted-foreground">{m.place}</span>
                  </span>
                  <span className="shrink-0 text-[13px] text-muted-foreground">{m.total > 0 ? (m.cause === "usage" ? "ใช้เกิน" : "แพงกว่า") : m.cause === "usage" ? "ใช้น้อย" : "ถูกกว่า"}</span>
                  <span className={cn("shrink-0 tabular-nums", tone(m.total))}>{signed(m.total)}</span>
                  {onOpenMover && <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
