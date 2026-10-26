import { useMemo, useState } from "react";
import { ChevronRight, ClipboardList, Search, Truck } from "lucide-react";
import type { Supplier } from "@/types/supplier";
import type { PendingTO, PRGroup } from "@/hooks/use-receive-data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { baht } from "./parts";
import { cn } from "@/lib/utils";

interface Props {
  pendingTOs: PendingTO[];
  prGroups: PRGroup[];
  loading: boolean;
  /** Suppliers that sell this brand's products first, then the rest */
  brandSuppliers: Supplier[];
  otherSuppliers: Supplier[];
  recentIds: string[];
  todayCount: number;
  todayTotal: number;
  activeView: string;
  onOpen: (view: string) => void;
  onDeclineAsk: (to: PendingTO) => void;
}

/** The branch's receiving queue: what's waiting first, then where else goods can come from */
export function ReceiveHome({ pendingTOs, prGroups, loading, brandSuppliers, otherSuppliers, recentIds, todayCount, todayTotal, activeView, onOpen, onDeclineAsk }: Props) {
  const [query, setQuery] = useState("");
  const supplierById = useMemo(() => new Map([...brandSuppliers, ...otherSuppliers].map((s) => [s.id, s])), [brandSuppliers, otherSuppliers]);
  const recent = recentIds.map((id) => supplierById.get(id)).filter((s): s is Supplier => !!s).slice(0, 5);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const match = (s: Supplier) => words.every((w) => s.name.toLowerCase().includes(w));

  const row = (view: string, label: React.ReactNode, sub?: React.ReactNode) => (
    <li key={view}>
      <button
        type="button"
        onClick={() => onOpen(view)}
        className={cn("flex min-h-[56px] w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-secondary/60", activeView === view && "bg-secondary shadow-[inset_3px_0_0_hsl(var(--brand))]")}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px]">{label}</span>
          {sub && <span className="block truncate text-sm text-muted-foreground">{sub}</span>}
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>
    </li>
  );

  return (
    <div className="flex flex-col gap-3">
      <div data-tour="recv-waiting" className="flex flex-col gap-3">
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">รอรับจากครัวกลาง · {loading ? "…" : pendingTOs.length}</div>
        {!loading && pendingTOs.length === 0 && <div className="rounded-2xl border border-dashed border-border bg-card px-4 py-5 text-sm text-muted-foreground">ยังไม่มีใบโอนจากครัวกลางที่รอรับ</div>}
        {pendingTOs.map((to, ti) => (
          <section key={to.id} className={cn("flex flex-col gap-3 rounded-2xl border bg-card p-4 shadow-card", activeView === `to/${to.id}` ? "border-primary" : "border-border")}>
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-soft">
                <Truck className="h-5 w-5 text-brand" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-semibold">ใบโอนจากครัวกลาง</div>
                <div className="truncate text-sm text-muted-foreground">
                  <span className="font-mono">{to.toNumber}</span> · {to.lines.length} รายการ · ส่ง {to.deliveryDate}
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="h-11 flex-1" onClick={() => onDeclineAsk(to)}>
                ปฏิเสธ
              </Button>
              <Button data-tour={ti === 0 ? "recv-take" : undefined} variant="brand" className="h-11 flex-[2] text-[15px]" onClick={() => onOpen(`to/${to.id}`)}>
                รับของ
              </Button>
            </div>
          </section>
        ))}
        {prGroups.length > 0 && <div className="mt-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">ใบขอซื้อถึงกำหนด · {prGroups.length}</div>}
        {prGroups.map((g) => {
          const s = supplierById.get(g.supplierId);
          return (
            <button
              key={g.supplierId}
              type="button"
              onClick={() => onOpen(`sup/${g.supplierId}`)}
              className={cn("flex items-center gap-3 rounded-2xl border bg-card p-4 text-left shadow-card hover:bg-secondary/40", activeView === `sup/${g.supplierId}` ? "border-primary" : "border-border")}
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-secondary">
                <ClipboardList className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block break-words text-[15px] font-semibold">{s?.name ?? "ซัพพลายเออร์"} · ใบขอซื้อถึงกำหนด</span>
                <span className="block truncate text-sm text-muted-foreground">{g.lines.length} รายการ · {g.prNumbers.join(", ")}</span>
              </span>
              <span className="shrink-0 text-sm font-semibold">รับตามใบ</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-3">
        <div data-tour="recv-other" className="mt-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">รับจากที่อื่น</div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ค้นซัพพลายเออร์…" className="h-11 pl-9" aria-label="ค้นซัพพลายเออร์" />
        </div>
        {!words.length && recent.length > 0 && (
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {recent.map((s) => (
              <button key={s.id} type="button" onClick={() => onOpen(`sup/${s.id}`)} className="min-h-[40px] shrink-0 whitespace-nowrap rounded-full border border-border bg-card px-4 text-sm hover:bg-secondary">
                {s.name}
              </button>
            ))}
          </div>
        )}
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
          {!words.length && row("ck", "ครัวกลาง (กรณีไม่มีใบโอน)")}
          {!words.length && row("branch", "รับจากสาขาอื่น")}
          {brandSuppliers.filter(match).map((s) => row(`sup/${s.id}`, s.name))}
          {otherSuppliers.filter(match).length > 0 && (
            <li className="bg-secondary/60 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">ซัพพลายเออร์อื่น</li>
          )}
          {otherSuppliers.filter(match).map((s) => row(`sup/${s.id}`, s.name))}
        </ul>
      </div>

      <button data-tour="recv-history" type="button" onClick={() => onOpen("history")} className="flex min-h-[48px] items-center justify-between px-1 text-sm">
        <span>
          รับแล้ววันนี้ {todayCount} รายการ · <span className="font-mono">{baht(todayTotal)}</span>
        </span>
        <span className="font-semibold text-brand">ดูประวัติ</span>
      </button>
    </div>
  );
}
