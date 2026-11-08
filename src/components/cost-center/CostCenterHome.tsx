import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, ChevronRight, FileText, HelpCircle, Leaf, ListChecks, PieChart, Scale, SlidersHorizontal, Store, Truck } from "lucide-react";
import type { TabKey } from "@/components/AppSidebar";
import { CostSummary } from "@/components/cost-center/CostSummary";
import { useCostVariance, type KitchenMonth } from "@/hooks/use-cost-variance";
import type { FoodCostLoader, FoodCostMasters } from "@/hooks/use-food-cost";
import { lastClosedMonth } from "@/lib/cost-variance";
import { rcHash } from "@/lib/reconcile";
import { bangkokDate } from "@/lib/day-follow";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { shiftDay } from "../../../supabase/functions/_shared/day-math.ts";

/**
 * Cost Center's front page (owner, 8 Nov 2026): the food cost dashboard on top, then one
 * small fixed menu of every place to drill into, then one line for what needs fixing.
 * No tabs here; the inner screens keep theirs.
 */
interface Props {
  /** Given only to the roles that see costs (management, kitchen manager) */
  costMasters?: FoodCostMasters;
  canOpen: (tab: TabKey) => boolean;
  onNavigate: (tab: TabKey) => void;
  /** Go to a Cost Center screen by its address ("menus", "usage", "issues" …) */
  go: (hash: string) => void;
  /** Products with something to fix (the product checks' red count) */
  toFix: number;
  onGuide: () => void;
  /** Dev harness only */
  demo?: { today: string; loader: FoodCostLoader; kitchen: KitchenMonth };
}

interface Door {
  label: string;
  icon: React.ElementType;
  open: () => void;
}

export function CostCenterHome({ costMasters, canOpen, onNavigate, go, toFix, onGuide, demo }: Props) {
  const navigate = useNavigate();
  // A fixed set in a fixed order; a place this role can't open is left out
  const doors: Door[] = [
    ...(canOpen("food-cost") ? [{ label: "ต้นทุนเมนู", icon: PieChart, open: () => onNavigate("food-cost") }] : []),
    { label: "ต้นทุนวัตถุดิบ", icon: Leaf, open: () => go("products") },
    ...(canOpen("reconcile") ? [{ label: "กระทบยอด", icon: Scale, open: () => navigate("/reconcile") }] : []),
    { label: "สูตรเมนู", icon: FileText, open: () => go("menus") },
    { label: "แก้ทุกเมนู", icon: SlidersHorizontal, open: () => go("usage") },
    { label: "ตัวเลือกบิล", icon: ListChecks, open: () => go("pos") },
    { label: "เมนูสาขา", icon: Store, open: () => go("branches") },
    { label: "ซัพพลายเออร์", icon: Truck, open: () => go("suppliers") },
  ];

  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-2xl font-bold">Cost Center</h2>
        <Button variant="outline" className="h-10 shrink-0" onClick={onGuide}>
          <HelpCircle className="h-4 w-4" /> วิธีใช้
        </Button>
      </div>

      {costMasters && <MonthCard m={costMasters} demo={demo} />}

      <nav aria-label="ไปที่" className="grid grid-cols-4 gap-x-1 gap-y-3 rounded-2xl border border-border bg-card px-1.5 py-3 shadow-card">
        {doors.map((d) => (
          <button key={d.label} type="button" onClick={d.open} className="flex min-h-[72px] min-w-0 flex-col items-center gap-1.5 text-center text-xs leading-tight">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-soft text-brand" aria-hidden>
              <d.icon className="h-5 w-5" />
            </span>
            <span className="whitespace-nowrap">{d.label}</span>
          </button>
        ))}
      </nav>

      <button type="button" onClick={() => go("issues")} className="flex min-h-[44px] items-center gap-2 self-start text-sm">
        {toFix > 0 ? <AlertCircle className="h-4 w-4 shrink-0 text-destructive" aria-hidden /> : null}
        <span className={toFix > 0 ? "text-destructive" : "text-muted-foreground"}>{toFix > 0 ? `สินค้า ${toFix} ตัว ต้องแก้ข้อมูล` : "เช็คข้อมูลสูตรและไฟล์"}</span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      </button>
    </div>
  );
}

/** 7 days ending yesterday (as the home page and กระทบยอด count a week) */
function lastWeek(today: string): { from: string; to: string } {
  const to = shiftDay(today, -1);
  return { from: shiftDay(to, -6), to };
}

const thDay = (d: string, opts: Intl.DateTimeFormatOptions) => new Date(`${d}T00:00:00Z`).toLocaleDateString("th-TH", { ...opts, timeZone: "UTC" });

/**
 * The dashboard card; its own component so the reads run only for the roles that see it.
 * Opens on the last 7 days (owner, 8 Nov 2026); the last closed month is one tap away.
 */
function MonthCard({ m, demo }: { m: FoodCostMasters; demo?: Props["demo"] }) {
  const navigate = useNavigate();
  const today = demo?.today ?? bangkokDate();
  const [kind, setKind] = useState<"week" | "month">("week");
  const month = useMemo(() => lastClosedMonth(today), [today]);
  const week = useMemo(() => lastWeek(today), [today]);
  const period = useMemo(() => (kind === "week" ? { ...week, week: true } : { from: month.from, to: month.to }), [kind, week, month]);
  const v = useCostVariance(m, period, month, { ...(demo ? { loader: demo.loader, kitchen: demo.kitchen } : {}), today });
  const code = useMemo(() => new Map(m.skus.map((s) => [s.id, s.skuId])), [m.skus]);
  const monthShort = thDay(month.from, { month: "short" });
  // "1–7 พ.ย." / "26 ต.ค.–1 พ.ย."; "ต.ค. 2569"
  const label =
    kind === "week"
      ? week.from.slice(0, 7) === week.to.slice(0, 7)
        ? `${Number(week.from.slice(8))}–${thDay(week.to, { day: "numeric", month: "short" })}`
        : `${thDay(week.from, { day: "numeric", month: "short" })}–${thDay(week.to, { day: "numeric", month: "short" })}`
      : thDay(month.from, { month: "short", year: "numeric" });
  // A link into กระทบยอด on the same period: the week is its default, the month by name
  const rcMonth = kind === "month" ? month.month : null;
  return (
    <>
      <div className="grid grid-cols-2 rounded-xl bg-secondary p-[3px]" role="group" aria-label="ช่วงเวลา">
        {(["week", "month"] as const).map((k) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} className={cn("h-[38px] rounded-[10px] text-sm", kind === k ? "bg-card font-semibold text-foreground shadow-sm" : "text-muted-foreground")}>
            {k === "week" ? "7 วันล่าสุด" : `${monthShort} (ปิดเดือนแล้ว)`}
          </button>
        ))}
      </div>
      <CostSummary
        v={v}
        monthLabel={label}
        // A place opens กระทบยอด on that period, its side; an item opens it on that item alone
        onOpenPlace={(r) => navigate(`/reconcile#${rcHash({ month: rcMonth, kitchen: r.kind === "kitchen" })}`)}
        onOpenMover={(x) => navigate(`/reconcile#${rcHash({ month: rcMonth, kitchen: x.kind === "kitchen", sku: code.get(x.skuId) ?? null })}`)}
      />
    </>
  );
}
