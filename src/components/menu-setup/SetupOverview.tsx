import { useMemo, useState } from "react";
import { CheckCircle2, AlertTriangle, XCircle, ChevronDown, ChevronRight, ListChecks } from "lucide-react";
import type { Menu } from "@/types/menu";
import type { MenuBomLine } from "@/types/menu-bom";
import type { ModifierRule } from "@/types/modifier-rule";
import type { SKU } from "@/types/sku";
import type { Price } from "@/types/price";
import type { Branch } from "@/types/branch";
import type { TabKey } from "@/components/AppSidebar";
import type { CheckLevel, MenuSetupSummary } from "@/lib/menu-health";
import { summarizeBranch } from "@/lib/branch-health";
import { groupIssues, unpricedSkus } from "@/lib/setup-overview";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface SetupOverviewProps {
  menus: Menu[];
  lines: MenuBomLine[];
  rules: ModifierRule[];
  skus: SKU[];
  prices: Price[];
  branches: Branch[];
  summaries: Map<string, MenuSetupSummary>;
  soldByCode: Record<string, Record<string, number>> | null;
  onOpenMenu: (m: Menu) => void;
  onOpenBranch: (branchId: string) => void;
  onOpenPos: () => void;
  onNavigate: (tab: TabKey) => void;
}

const levelStyle: Record<CheckLevel, { icon: React.ElementType; text: string; bg: string }> = {
  ok: { icon: CheckCircle2, text: "text-success", bg: "bg-success-soft" },
  warn: { icon: AlertTriangle, text: "text-warning", bg: "bg-warning-soft" },
  error: { icon: XCircle, text: "text-destructive", bg: "bg-destructive-soft" },
};

/**
 * The whole setup on one screen: how many menus are fully set up, which branches
 * are ready, every problem grouped by kind with the menus it touches, and the
 * unpriced ingredients that make costs too low. Everything links to where it's fixed.
 */
export function SetupOverview({ menus, lines, rules, skus, prices, branches, summaries, soldByCode, onOpenMenu, onOpenBranch, onOpenPos, onNavigate }: SetupOverviewProps) {
  const [open, setOpen] = useState<string | null>(null);
  const [allUnpriced, setAllUnpriced] = useState(false);

  const active = menus.filter((m) => m.status === "Active");
  const tally = useMemo(() => {
    const t = { ok: 0, warn: 0, error: 0 };
    for (const m of active) t[summaries.get(m.id)?.worst ?? "ok"]++;
    return t;
  }, [active, summaries]);
  const groups = useMemo(() => groupIssues(menus, summaries), [menus, summaries]);
  const unpriced = useMemo(() => unpricedSkus(menus, lines, skus, prices), [menus, lines, skus, prices]);
  const branchRows = useMemo(
    () =>
      branches
        .filter((b) => b.status === "Active")
        .map((b) => {
          const s = summarizeBranch({ branch: b, menus, rules, summaries, soldByCode: soldByCode ?? undefined });
          return { branch: b, errors: s.checks.filter((c) => c.level === "error"), warns: s.checks.filter((c) => c.level === "warn") };
        }),
    [branches, menus, rules, summaries, soldByCode],
  );
  const readyPct = active.length ? Math.round((tally.ok / active.length) * 100) : 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Hero */}
      <section className="rounded-2xl bg-primary p-5 text-primary-foreground shadow-raised md:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-primary-foreground/60">เมนูที่ตั้งครบ</div>
            <div className="mt-1 font-mono text-5xl font-bold tabular-nums text-highlight">{readyPct}%</div>
            <div className="text-sm text-primary-foreground/60">
              {tally.ok.toLocaleString()} จาก {active.length.toLocaleString()} เมนูที่เปิดอยู่
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:w-[340px]">
            {(
              [
                ["error", "ต้องแก้", tally.error],
                ["warn", "ควรดู", tally.warn],
                ["ok", "ครบ", tally.ok],
              ] as const
            ).map(([lvl, label, n]) => (
              <div key={lvl} className="rounded-xl bg-white/[0.06] px-3 py-2">
                <div className="text-sm text-primary-foreground/70">{label}</div>
                <div className={cn("font-mono text-xl font-bold tabular-nums", lvl === "error" && n > 0 && "text-[hsl(var(--palette-red-soft))]")}>{n}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Branches */}
      <section className="flex flex-col gap-2">
        <h3 className="px-1 text-base font-semibold">สาขาพร้อมขายไหม</h3>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {branchRows.map(({ branch, errors, warns }) => {
            const lvl: CheckLevel = errors.length ? "error" : warns.length ? "warn" : "ok";
            const st = levelStyle[lvl];
            return (
              <button
                key={branch.id}
                type="button"
                onClick={() => onOpenBranch(branch.id)}
                className="flex min-h-[72px] min-w-0 items-center gap-3 rounded-2xl border border-border bg-card p-4 text-left shadow-card transition-colors hover:bg-secondary/60"
              >
                <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full", st.bg)}>
                  <st.icon className={cn("h-5 w-5", st.text)} aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold">
                    {branch.branchName} <span className="font-normal text-muted-foreground">· {branch.brandName || "ไม่มีแบรนด์"}</span>
                  </span>
                  <span className="block truncate text-sm text-muted-foreground">
                    {lvl === "ok" ? "พร้อม" : [...errors, ...warns].map((c) => c.title).join(" · ")}
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </button>
            );
          })}
        </div>
      </section>

      {/* Problems by kind */}
      <section className="flex flex-col gap-2">
        <h3 className="px-1 text-base font-semibold">เรื่องที่ต้องตั้งให้ครบ</h3>
        {groups.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card p-6 text-center text-sm text-muted-foreground shadow-card">ทุกเมนูตั้งครบแล้ว</div>
        ) : (
          <ul className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
            {groups.map((g, i) => {
              const st = levelStyle[g.level];
              const expanded = open === g.kind;
              return (
                <li key={g.kind} className={cn(i > 0 && "border-t border-border")}>
                  <button
                    type="button"
                    onClick={() => setOpen(expanded ? null : g.kind)}
                    aria-expanded={expanded}
                    className="flex min-h-[64px] w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-secondary/60"
                  >
                    <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full", st.bg)}>
                      <st.icon className={cn("h-4 w-4", st.text)} aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-medium">{g.title}</span>
                      <span className="block text-sm text-muted-foreground">{g.why}</span>
                    </span>
                    <span className="shrink-0 font-mono text-sm tabular-nums">{g.menus.length} เมนู</span>
                    <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-180")} aria-hidden="true" />
                  </button>
                  {expanded && (
                    <ul className="flex flex-col gap-1.5 bg-secondary/50 px-4 pb-4 pt-1">
                      {g.menus.map(({ menu, detail }) => (
                        <li key={menu.id}>
                          <button
                            type="button"
                            onClick={() => onOpenMenu(menu)}
                            className="flex min-h-[48px] w-full items-center gap-3 rounded-xl bg-card px-3 py-2 text-left shadow-card hover:bg-secondary"
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[15px]">
                                <span className="font-mono text-muted-foreground">{menu.menuCode}</span> {menu.menuName}
                              </span>
                              {detail !== g.title && <span className="block truncate text-sm text-muted-foreground">{detail}</span>}
                            </span>
                            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Unpriced ingredients */}
      {unpriced.length > 0 && (
        <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
          <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-semibold">วัตถุดิบในสูตรที่ยังไม่มีราคา {unpriced.length} ตัว</h3>
              <p className="text-sm text-muted-foreground">ใส่ราคาตัวบนสุดก่อน — กระทบหลายเมนูที่สุด</p>
            </div>
            <Button variant="outline" className="h-10" onClick={() => onNavigate("price")}>
              ไปหน้าราคา
            </Button>
          </header>
          <ul className="divide-y divide-border">
            {(allUnpriced ? unpriced : unpriced.slice(0, 8)).map((u) => (
              <li key={u.skuId} className="flex items-center gap-3 px-4 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px]">{u.sku?.name ?? "วัตถุดิบที่ถูกลบไปแล้ว"}</span>
                  <span className="block truncate text-sm text-muted-foreground">
                    <span className="font-mono">{u.sku?.skuId ?? "—"}</span> · {u.menus.map((m) => m.menuCode).slice(0, 6).join(", ")}
                    {u.menus.length > 6 ? " …" : ""}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-sm tabular-nums">{u.menus.length} เมนู</span>
              </li>
            ))}
          </ul>
          {!allUnpriced && unpriced.length > 8 && (
            <div className="border-t border-border p-2">
              <Button variant="ghost" className="h-11 w-full text-brand" onClick={() => setAllUnpriced(true)}>
                ดูอีก {unpriced.length - 8} ตัว
              </Button>
            </div>
          )}
        </section>
      )}

      <button
        type="button"
        onClick={onOpenPos}
        className="flex min-h-[64px] items-center gap-3 rounded-2xl border border-border bg-card p-4 text-left shadow-card hover:bg-secondary/60"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary">
          <ListChecks className="h-5 w-5 text-brand" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold">ตัวเลือก POS</span>
          <span className="block text-sm text-muted-foreground">เช็คว่าตัวเลือกที่ลูกค้ากดมีกฎตัดของครบ</span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>
    </div>
  );
}
