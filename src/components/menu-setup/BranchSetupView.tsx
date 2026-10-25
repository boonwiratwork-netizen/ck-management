import { useMemo, useState } from "react";
import { Search, CheckCircle2, AlertTriangle, XCircle, ChevronRight, Store } from "lucide-react";
import type { Menu } from "@/types/menu";
import type { ModifierRule } from "@/types/modifier-rule";
import type { Branch } from "@/types/branch";
import type { TabKey } from "@/components/AppSidebar";
import type { CheckLevel, MenuSetupSummary } from "@/lib/menu-health";
import { summarizeBranch } from "@/lib/branch-health";
import { SALES_WINDOW_DAYS } from "@/hooks/use-menu-setup-extras";
import { SegmentedTabs } from "@/components/SegmentedTabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

interface BranchSetupViewProps {
  initialBranchId?: string;
  branches: Branch[];
  menus: Menu[];
  rules: ModifierRule[];
  summaries: Map<string, MenuSetupSummary>;
  soldByCode: Record<string, Record<string, number>> | null;
  canEdit: boolean;
  setBranchOpenMany: (menuIds: string[], branchId: string, open: boolean) => Promise<boolean>;
  onOpenMenu: (m: Menu) => void;
  onNavigate: (tab: TabKey) => void;
}

type Filter = "all" | "open" | "closed" | "norecipe";

const levelStyle: Record<CheckLevel, { icon: React.ElementType; text: string; bg: string }> = {
  ok: { icon: CheckCircle2, text: "text-success", bg: "bg-success-soft" },
  warn: { icon: AlertTriangle, text: "text-warning", bg: "bg-warning-soft" },
  error: { icon: XCircle, text: "text-destructive", bg: "bg-destructive-soft" },
};

const pct = (n: number | null) => (n === null ? "—" : `${n.toFixed(1)}%`);

/**
 * One branch at a time: is it ready (brand matches menus, every code it sells is a
 * menu, rules include it), and which menus it sells — open/close many at once.
 * This is the branch-side view that used to live only inside the Branches page.
 */
export function BranchSetupView({ initialBranchId, branches, menus, rules, summaries, soldByCode, canEdit, setBranchOpenMany, onOpenMenu, onNavigate }: BranchSetupViewProps) {
  const active = branches.filter((b) => b.status === "Active");
  const [branchId, setBranchId] = useState(initialBranchId ?? active[0]?.id ?? "");
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  const branch = active.find((b) => b.id === branchId) ?? active[0];
  const setup = useMemo(
    () => (branch ? summarizeBranch({ branch, menus, rules, summaries, soldByCode: soldByCode ?? undefined }) : null),
    [branch, menus, rules, summaries, soldByCode],
  );

  const shown = useMemo(() => {
    if (!setup) return [];
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return setup.rows
      .filter((r) => (filter === "open" ? r.open : filter === "closed" ? !r.open : filter === "norecipe" ? r.noRecipe : true))
      .filter((r) => words.every((w) => `${r.menu.menuCode} ${r.menu.menuName} ${r.menu.category}`.toLowerCase().includes(w)))
      .sort((a, b) => b.sold - a.sold || a.menu.menuCode.localeCompare(b.menu.menuCode));
  }, [setup, filter, query]);

  if (!branch || !setup)
    return <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">ยังไม่มีสาขาที่เปิดอยู่</div>;

  const counts = {
    all: setup.rows.length,
    open: setup.rows.filter((r) => r.open).length,
    closed: setup.rows.filter((r) => !r.open).length,
    norecipe: setup.rows.filter((r) => r.noRecipe).length,
  };
  const tabs: { key: Filter; label: string }[] = [
    { key: "all", label: `ทั้งหมด ${counts.all}` },
    { key: "open", label: `เปิดขาย ${counts.open}` },
    { key: "closed", label: `ปิดขาย ${counts.closed}` },
    { key: "norecipe", label: `ไม่ตัดของ ${counts.norecipe}` },
  ];

  const apply = async (ids: string[], open: boolean, key: string) => {
    setBusy(key);
    const ok = await setBranchOpenMany(ids, branch.id, open);
    setBusy(null);
    if (ok) setPicked(new Set());
  };
  const pickedIds = [...picked].filter((id) => shown.some((r) => r.menu.id === id));
  const allShownPicked = shown.length > 0 && shown.every((r) => picked.has(r.menu.id));

  return (
    <div className="flex flex-col gap-4">
      {/* Branch picker */}
      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:flex-wrap md:px-0 [&::-webkit-scrollbar]:hidden">
        {active.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => {
              setBranchId(b.id);
              setPicked(new Set());
            }}
            className={cn(
              "min-h-[44px] shrink-0 rounded-full border px-4 text-sm transition-colors",
              b.id === branch.id ? "border-primary bg-primary font-semibold text-primary-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {b.branchName} <span className="opacity-60">· {b.brandName || "ไม่มีแบรนด์"}</span>
          </button>
        ))}
        {canEdit && (
          <Button variant="ghost" className="h-11 shrink-0 text-brand" onClick={() => onNavigate("branches")}>
            <Store className="h-4 w-4" /> เพิ่ม/แก้สาขา
          </Button>
        )}
      </div>

      {/* Readiness checklist */}
      <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
        <header className="border-b border-border px-4 py-3">
          <h4 className="text-base font-semibold">สาขา {branch.branchName} พร้อมขายไหม</h4>
          <p className="text-sm text-muted-foreground">เช็คจากเมนู กฎ และยอดขาย {SALES_WINDOW_DAYS} วัน{soldByCode ? "" : " (กำลังโหลดยอดขาย…)"}</p>
        </header>
        <ul className="divide-y divide-border">
          {setup.checks.map((c) => {
            const st = levelStyle[c.level];
            return (
              <li key={c.id} className="flex items-start gap-3 px-4 py-3">
                <span className={cn("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full", st.bg)}>
                  <st.icon className={cn("h-4 w-4", st.text)} aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-medium">{c.title}</div>
                  {c.detail && <p className="mt-0.5 break-words text-sm text-muted-foreground">{c.detail}</p>}
                </div>
                {c.level !== "ok" && c.id === "rules-elsewhere" && (
                  <Button variant="outline" size="sm" className="h-9 shrink-0" onClick={() => onNavigate("modifier-rules")}>
                    ไปกฎพิเศษ
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {/* Menus at this branch */}
      <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
        <div className="flex flex-col gap-3 border-b border-border p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ค้นเมนู…" className="h-11 pl-9" aria-label="ค้นเมนู" />
          </div>
          <SegmentedTabs<Filter> tabs={tabs} value={filter} onChange={setFilter} className="[&_button]:min-h-[36px] [&_button]:px-3" />
          {canEdit && (
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex min-h-[40px] items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-[hsl(var(--primary))]"
                  checked={allShownPicked}
                  onChange={() => setPicked(allShownPicked ? new Set() : new Set(shown.map((r) => r.menu.id)))}
                />
                เลือกทั้งหมดที่เห็น
              </label>
              <span className="text-sm text-muted-foreground">{pickedIds.length ? `เลือก ${pickedIds.length}` : ""}</span>
              <div className="ml-auto flex gap-2">
                <Button variant="outline" className="h-10" disabled={!pickedIds.length} loading={busy === "close"} onClick={() => apply(pickedIds, false, "close")}>
                  ปิดขายที่เลือก
                </Button>
                <Button variant="brand" className="h-10" disabled={!pickedIds.length} loading={busy === "open"} onClick={() => apply(pickedIds, true, "open")}>
                  เปิดขายที่เลือก
                </Button>
              </div>
            </div>
          )}
        </div>
        <ul className="divide-y divide-border">
          {shown.map((r) => (
            <li key={r.menu.id} className={cn("flex items-center gap-3 px-4 py-2.5", !r.open && "bg-secondary/40")}>
              {canEdit && (
                <input
                  type="checkbox"
                  className="h-5 w-5 shrink-0 accent-[hsl(var(--primary))]"
                  aria-label={`เลือก ${r.menu.menuName}`}
                  checked={picked.has(r.menu.id)}
                  onChange={() =>
                    setPicked((p) => {
                      const n = new Set(p);
                      if (n.has(r.menu.id)) n.delete(r.menu.id);
                      else n.add(r.menu.id);
                      return n;
                    })
                  }
                />
              )}
              <button type="button" onClick={() => onOpenMenu(r.menu)} className="flex min-h-[48px] min-w-0 flex-1 items-center gap-2 text-left">
                <div className="min-w-0 flex-1">
                  <div className={cn("truncate text-[15px] font-medium", !r.open && "text-muted-foreground")}>{r.menu.menuName}</div>
                  <div className="truncate text-sm text-muted-foreground">
                    <span className="font-mono">{r.menu.menuCode}</span>
                    {r.noRecipe ? <span className={r.sold > 0 ? "text-destructive" : "text-warning"}> · {r.sold > 0 ? "ขายแล้วไม่ตัดของ" : "ไม่มีสูตร"}</span> : <> · ต้นทุน {pct(r.costPct)}</>}
                    {soldByCode && ` · ขาย ${r.sold.toLocaleString()}`}
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </button>
              <Switch
                checked={r.open}
                disabled={!canEdit || busy === r.menu.id}
                onCheckedChange={(v) => apply([r.menu.id], v, r.menu.id)}
                aria-label={`เปิดขาย ${r.menu.menuName} ที่ ${branch.branchName}`}
              />
            </li>
          ))}
          {shown.length === 0 && <li className="px-4 py-10 text-center text-sm text-muted-foreground">ไม่มีเมนูในกลุ่มนี้</li>}
        </ul>
      </section>
    </div>
  );
}
