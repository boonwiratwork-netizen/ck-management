import { useMemo } from "react";
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

/** The dashboard card; its own component so the reads run only for the roles that see it */
function MonthCard({ m, demo }: { m: FoodCostMasters; demo?: Props["demo"] }) {
  const navigate = useNavigate();
  const period = useMemo(() => lastClosedMonth(demo?.today ?? bangkokDate()), [demo?.today]);
  const v = useCostVariance(m, period, demo ? { loader: demo.loader, kitchen: demo.kitchen } : undefined);
  const code = useMemo(() => new Map(m.skus.map((s) => [s.id, s.skuId])), [m.skus]);
  const monthLabel = new Date(`${period.from}T00:00:00Z`).toLocaleDateString("th-TH", { month: "short", year: "numeric", timeZone: "UTC" });
  return (
    <CostSummary
      v={v}
      monthLabel={monthLabel}
      // A place opens กระทบยอด on that month, its side; an item opens it on that item alone
      onOpenPlace={(r) => navigate(`/reconcile#${rcHash({ month: period.month, kitchen: r.kind === "kitchen" })}`)}
      onOpenMover={(x) => navigate(`/reconcile#${rcHash({ month: period.month, kitchen: x.kind === "kitchen", sku: code.get(x.skuId) ?? null })}`)}
    />
  );
}
