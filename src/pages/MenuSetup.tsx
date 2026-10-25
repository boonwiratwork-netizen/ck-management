import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, AlertTriangle, XCircle, Search, ChevronRight, ListFilter, Layers } from "lucide-react";
import type { Menu } from "@/types/menu";
import type { MenuBomLine } from "@/types/menu-bom";
import type { ModifierRule } from "@/types/modifier-rule";
import type { SKU } from "@/types/sku";
import type { Price } from "@/types/price";
import type { Branch } from "@/types/branch";
import type { TabKey } from "@/components/AppSidebar";
import { useMenuSetupExtras, SALES_WINDOW_DAYS } from "@/hooks/use-menu-setup-extras";
import { useMenuCategories } from "@/hooks/use-menu-categories";
import { summarizeMenu, describeRule, brandBranches, type CheckLevel, type CheckArea, type HealthCheck, type MenuSetupSummary } from "@/lib/menu-health";
import { RecipeEditor, type RecipeActions } from "@/components/menu-setup/RecipeEditor";
import { PosOptionsView } from "@/components/menu-setup/PosOptionsView";
import { usePosOptionsData } from "@/hooks/use-pos-options-data";
import type { Bill } from "@/lib/pos-options";
import { SegmentedTabs } from "@/components/SegmentedTabs";
import { SaveBar } from "@/components/form/SaveBar";
import { FieldError } from "@/components/form/FieldError";
import { SearchableSelect } from "@/components/SearchableSelect";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

interface MenuSetupProps {
  menus: Menu[];
  updateMenu: (id: string, data: Partial<Omit<Menu, "id">>) => Promise<boolean>;
  menuBom: RecipeActions & { lines: MenuBomLine[]; loading: boolean };
  rules: ModifierRule[];
  skus: SKU[];
  prices: Price[];
  branches: Branch[];
  readOnly?: boolean;
  onNavigate: (tab: TabKey) => void;
  addRule: (data: Omit<ModifierRule, "id">) => Promise<ModifierRule | null>;
  /** Dev harness only: use these instead of what the hooks load */
  demoExtras?: { overrides: Record<string, Record<string, boolean>>; soldByCode: Record<string, Record<string, number>>; bills: Bill[] };
}

const POS_HASH = "pos";

type WorkTab = "health" | "recipe" | "branches" | "rules" | "info";
type MenuFilter = "all" | "error" | "warn" | "inactive";

const baht = (n: number) => `฿${n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (n: number | null) => (n === null ? "—" : `${n.toFixed(1)}%`);

const levelStyle: Record<CheckLevel, { icon: React.ElementType; text: string; bg: string; label: string }> = {
  ok: { icon: CheckCircle2, text: "text-success", bg: "bg-success-soft", label: "ครบ" },
  warn: { icon: AlertTriangle, text: "text-warning", bg: "bg-warning-soft", label: "ควรดู" },
  error: { icon: XCircle, text: "text-destructive", bg: "bg-destructive-soft", label: "ต้องแก้" },
};

const areaTab: Record<CheckArea, WorkTab> = { info: "info", recipe: "recipe", branches: "branches", rules: "rules" };

function HealthDot({ level }: { level: CheckLevel }) {
  return (
    <span
      className={cn("h-2.5 w-2.5 shrink-0 rounded-full", level === "ok" ? "bg-success" : level === "warn" ? "bg-warning" : "bg-destructive")}
      aria-label={levelStyle[level].label}
    />
  );
}

/** Cost range across branches, e.g. "฿61.20" or "฿58.00–฿61.20" */
function costLabel(s: MenuSetupSummary): string {
  if (s.branches.length === 0) return "—";
  const costs = s.branches.map((b) => b.cost);
  const lo = Math.min(...costs);
  const hi = Math.max(...costs);
  return Math.abs(hi - lo) < 0.005 ? baht(lo) : `${baht(lo)}–${baht(hi)}`;
}

/**
 * Menu Setup Center: one place per menu for its recipe, where it's sold, the
 * POS-option rules that touch it, and a checklist of setup mistakes.
 * Selected menu lives in the URL hash (/menu-setup#MN-073) so links and the
 * phone back button work.
 */
export default function MenuSetupPage({ menus, updateMenu, menuBom, rules, skus, prices, branches, readOnly = false, onNavigate, addRule, demoExtras }: MenuSetupProps) {
  const loaded = useMenuSetupExtras();
  const extras = demoExtras ? { ...loaded, ...demoExtras, setBranchOpen: async () => true } : loaded;
  const canEdit = !readOnly;

  const [code, setCode] = useState(() => decodeURIComponent(window.location.hash.slice(1)));
  useEffect(() => {
    const onHash = () => setCode(decodeURIComponent(window.location.hash.slice(1)));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const open = (m: Menu | null) => {
    if (m) window.location.hash = encodeURIComponent(m.menuCode);
    else if (window.location.hash) window.history.back();
  };

  const summaries = useMemo(() => {
    const out = new Map<string, MenuSetupSummary>();
    for (const menu of menus) {
      out.set(
        menu.id,
        summarizeMenu({
          menu,
          menus,
          lines: menuBom.lines,
          rules,
          skus,
          prices,
          branches,
          overrides: extras.overrides[menu.id] ?? {},
          soldByBranch: extras.soldByCode ? extras.soldByCode[menu.menuCode] ?? {} : undefined,
        }),
      );
    }
    return out;
  }, [menus, menuBom.lines, rules, skus, prices, branches, extras.overrides, extras.soldByCode]);

  // "#pos" opens the POS option catalog; any other hash is a menu code
  const posView = code === POS_HASH;
  const selected = posView ? null : menus.find((m) => m.menuCode === code) ?? null;
  const pos = usePosOptionsData(posView && !demoExtras);
  const [demoNoStock, setDemoNoStock] = useState<Set<string>>(new Set());

  const viewTabs: { key: "menus" | "pos"; label: string }[] = [
    { key: "menus", label: "เมนู" },
    { key: "pos", label: "ตัวเลือก POS" },
  ];
  const header = (
    <div className={cn("flex flex-col gap-3 md:flex-row md:items-end md:justify-between", selected && "hidden lg:flex")}>
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-bold">ตั้งค่าเมนู</h2>
        <p className="text-sm text-muted-foreground">สูตร · สาขาที่ขาย · กฎตัวเลือก POS · เช็คว่าตั้งครบ — ครบในที่เดียว</p>
      </div>
      <SegmentedTabs<"menus" | "pos">
        tabs={viewTabs}
        value={posView ? "pos" : "menus"}
        onChange={(v) => {
          window.location.hash = v === "pos" ? POS_HASH : "";
        }}
      />
    </div>
  );

  if (posView)
    return (
      <div className="flex flex-col gap-4">
        {header}
        <PosOptionsView
          bills={demoExtras ? demoExtras.bills : pos.bills}
          noStock={demoExtras ? demoNoStock : pos.noStock}
          setNoStockKeys={
            demoExtras
              ? async (keys, on) => {
                  setDemoNoStock((prev) => {
                    const next = new Set(prev);
                    for (const k of keys) {
                      if (on) next.add(k);
                      else next.delete(k);
                    }
                    return next;
                  });
                  return true;
                }
              : pos.setNoStockKeys
          }
          menus={menus}
          lines={menuBom.lines}
          rules={rules}
          skus={skus}
          prices={prices}
          branches={branches}
          canEdit={canEdit}
          addRule={addRule}
        />
      </div>
    );

  return (
    <div className="flex flex-col gap-4">
      {header}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <div className={cn("min-w-0", selected && "hidden lg:block")}>
          <MenuList menus={menus} summaries={summaries} selectedId={selected?.id ?? null} onSelect={open} loading={menuBom.loading} />
        </div>
        <div className={cn("min-w-0", !selected && "hidden lg:block")}>
          {selected ? (
            <MenuWorkspace
              key={selected.id}
              menu={selected}
              menus={menus}
              summary={summaries.get(selected.id)!}
              skus={skus}
              prices={prices}
              branches={brandBranches(branches, selected.brandName)}
              allBranches={branches}
              canEdit={canEdit}
              salesLoaded={extras.soldByCode !== null}
              updateMenu={updateMenu}
              setBranchOpen={extras.setBranchOpen}
              recipeActions={menuBom}
              onBack={() => open(null)}
              onOpenMenu={(m) => open(m)}
              onNavigate={onNavigate}
            />
          ) : (
            <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-card p-8 text-center">
              <Layers className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
              <p className="font-medium">เลือกเมนูทางซ้าย</p>
              <p className="text-sm text-muted-foreground">จุดแดง = ต้องแก้ · จุดเหลือง = ควรดู</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── List ─────────────────────────

function MenuList({
  menus,
  summaries,
  selectedId,
  onSelect,
  loading,
}: {
  menus: Menu[];
  summaries: Map<string, MenuSetupSummary>;
  selectedId: string | null;
  onSelect: (m: Menu) => void;
  loading: boolean;
}) {
  const [query, setQuery] = useState("");
  const [brand, setBrand] = useState("all");
  const [filter, setFilter] = useState<MenuFilter>("all");

  const brands = useMemo(() => [...new Set(menus.map((m) => m.brandName).filter(Boolean))].sort(), [menus]);
  const counts = useMemo(() => {
    const c = { all: 0, error: 0, warn: 0, inactive: 0 };
    for (const m of menus) {
      if (brand !== "all" && m.brandName !== brand) continue;
      c.all++;
      if (m.status === "Inactive") c.inactive++;
      else if (summaries.get(m.id)?.worst === "error") c.error++;
      else if (summaries.get(m.id)?.worst === "warn") c.warn++;
    }
    return c;
  }, [menus, summaries, brand]);

  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const order: Record<CheckLevel, number> = { error: 0, warn: 1, ok: 2 };
    return menus
      .filter((m) => brand === "all" || m.brandName === brand)
      .filter((m) => {
        const worst = summaries.get(m.id)?.worst ?? "ok";
        if (filter === "inactive") return m.status === "Inactive";
        if (filter === "error") return m.status !== "Inactive" && worst === "error";
        if (filter === "warn") return m.status !== "Inactive" && worst === "warn";
        return true;
      })
      .filter((m) => {
        const hay = `${m.menuCode} ${m.menuName} ${m.category}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      })
      .sort((a, b) => {
        // Active first, then problems first, then by code
        if (a.status !== b.status) return a.status === "Active" ? -1 : 1;
        const d = order[summaries.get(a.id)?.worst ?? "ok"] - order[summaries.get(b.id)?.worst ?? "ok"];
        return d || a.menuCode.localeCompare(b.menuCode);
      });
  }, [menus, summaries, query, brand, filter]);

  const filters: { key: MenuFilter; label: string }[] = [
    { key: "all", label: `ทั้งหมด ${counts.all}` },
    { key: "error", label: `ต้องแก้ ${counts.error}` },
    { key: "warn", label: `ควรดู ${counts.warn}` },
    { key: "inactive", label: `ปิดเมนู ${counts.inactive}` },
  ];

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-card lg:sticky lg:top-20 lg:max-h-[calc(100dvh-7rem)]">
      <div className="flex flex-col gap-3 border-b border-border p-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ค้นรหัส ชื่อ หรือหมวด…" className="h-11 pl-9" aria-label="ค้นเมนู" />
        </div>
        {brands.length > 1 && (
          <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {["all", ...brands].map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => setBrand(b)}
                className={cn(
                  "min-h-[36px] shrink-0 rounded-full border px-3.5 text-sm transition-colors",
                  brand === b ? "border-primary bg-primary font-semibold text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {b === "all" ? "ทุกแบรนด์" : b}
              </button>
            ))}
          </div>
        )}
        <SegmentedTabs<MenuFilter> tabs={filters} value={filter} onChange={setFilter} className="[&_button]:min-h-[36px] [&_button]:px-3" />
      </div>

      <ul className="flex-1 divide-y divide-border overflow-y-auto overscroll-contain" aria-busy={loading}>
        {shown.map((m) => {
          const s = summaries.get(m.id);
          const first = s?.branches[0];
          return (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => onSelect(m)}
                aria-current={selectedId === m.id ? "true" : undefined}
                className={cn(
                  "flex min-h-[64px] w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-secondary/60",
                  selectedId === m.id && "bg-secondary shadow-[inset_3px_0_0_hsl(var(--brand))]",
                  m.status === "Inactive" && "opacity-60",
                )}
              >
                <HealthDot level={s?.worst ?? "ok"} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-medium">{m.menuName}</div>
                  <div className="truncate text-sm text-muted-foreground">
                    <span className="font-mono">{m.menuCode}</span> · {m.brandName || "ไม่ระบุแบรนด์"}
                    {m.status === "Inactive" && " · ปิดเมนู"}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-mono text-sm tabular-nums">{s ? costLabel(s) : "—"}</div>
                  <div className="font-mono text-sm tabular-nums text-muted-foreground">{first ? pct(first.costPct) : ""}</div>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground lg:hidden" aria-hidden="true" />
              </button>
            </li>
          );
        })}
        {shown.length === 0 && <li className="px-4 py-10 text-center text-sm text-muted-foreground">{loading ? "กำลังโหลด…" : "ไม่พบเมนู"}</li>}
      </ul>
    </div>
  );
}

// ───────────────────────── Workspace ─────────────────────────

interface WorkspaceProps {
  menu: Menu;
  menus: Menu[];
  summary: MenuSetupSummary;
  skus: SKU[];
  prices: Price[];
  /** Active branches of this menu's brand */
  branches: Branch[];
  allBranches: Branch[];
  canEdit: boolean;
  salesLoaded: boolean;
  updateMenu: MenuSetupProps["updateMenu"];
  setBranchOpen: (menuId: string, branchId: string, open: boolean) => Promise<boolean>;
  recipeActions: RecipeActions;
  onBack: () => void;
  onOpenMenu: (m: Menu) => void;
  onNavigate: (tab: TabKey) => void;
}

function MenuWorkspace(props: WorkspaceProps) {
  const { menu, summary, onBack } = props;
  const [tab, setTab] = useState<WorkTab>(summary.worst === "ok" ? "recipe" : "health");
  const problems = summary.checks.filter((c) => c.level !== "ok").length;
  const lineCount = summary.sharedLines.length + Object.values(summary.branchLines).reduce((s, l) => s + l.length, 0);

  const tabs: { key: WorkTab; label: string }[] = [
    { key: "health", label: problems ? `เช็คการตั้งค่า · ${problems}` : "เช็คการตั้งค่า" },
    { key: "recipe", label: `สูตร · ${lineCount}` },
    { key: "branches", label: `สาขา · ${summary.branches.filter((b) => b.open).length}/${summary.branches.length}` },
    { key: "rules", label: `กฎตัวเลือก · ${summary.ownRules.length + summary.usedAsTopping.length}` },
    { key: "info", label: "ข้อมูลเมนู" },
  ];

  const hero = summary.branches.length === 1 ? summary.branches[0] : null;

  return (
    <div className="flex flex-col gap-4">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-2xl bg-primary p-5 text-primary-foreground shadow-raised md:p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-end">
          <div className="min-w-0 flex-1">
            <button type="button" onClick={onBack} className="-ml-2 mb-2 inline-flex min-h-[40px] items-center gap-1 rounded-full px-2 text-sm text-primary-foreground/70 hover:text-primary-foreground lg:hidden">
              <ArrowLeft className="h-4 w-4" /> เมนูทั้งหมด
            </button>
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-primary-foreground/60">
              {menu.menuCode} · {menu.brandName || "ไม่ระบุแบรนด์"} · {menu.category || "ไม่มีหมวด"}
            </div>
            <h3 className="mt-1 text-2xl font-bold leading-tight md:text-3xl">{menu.menuName}</h3>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium", levelStyle[summary.worst].bg, levelStyle[summary.worst].text)}>
                {(() => {
                  const Icon = levelStyle[summary.worst].icon;
                  return <Icon className="h-4 w-4" aria-hidden="true" />;
                })()}
                {summary.worst === "ok" ? "ตั้งครบแล้ว" : `${levelStyle[summary.worst].label} ${problems} เรื่อง`}
              </span>
              {menu.status === "Inactive" && <span className="rounded-full bg-white/10 px-3 py-1 text-sm">ปิดเมนู</span>}
            </div>
          </div>
          <div className="flex gap-6 md:text-right">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-primary-foreground/60">ต้นทุนตามสูตร</div>
              <div className="mt-1 font-mono text-2xl font-bold tabular-nums">{costLabel(summary)}</div>
              <div className="text-sm text-primary-foreground/60">ขาย {menu.sellingPrice > 0 ? baht(menu.sellingPrice) : "—"}</div>
            </div>
            {hero && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-primary-foreground/60">% ต้นทุน</div>
                <div className="mt-1 font-mono text-4xl font-bold tabular-nums text-highlight">{pct(hero.costPct)}</div>
              </div>
            )}
          </div>
        </div>
        {summary.branches.length > 1 && (
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {summary.branches.map((b) => (
              <div key={b.branchId} className="rounded-xl bg-white/[0.06] px-3 py-2">
                <div className="truncate text-sm text-primary-foreground/70">{b.branchName}</div>
                <div className="font-mono text-base tabular-nums">
                  {baht(b.cost)} <span className="text-highlight">{pct(b.costPct)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <SegmentedTabs<WorkTab> tabs={tabs} value={tab} onChange={setTab} />

      {tab === "health" && <HealthPanel checks={summary.checks} onGo={(area) => setTab(areaTab[area])} />}
      {tab === "recipe" && summary.linkedRecipes.length > 0 && (
        <section className="flex flex-col gap-2 rounded-2xl bg-brand-soft p-4 text-brand-soft-foreground">
          <p className="text-sm">ทุกบิลของเมนูนี้ตัดของตามสูตรเมนูอื่นผ่านกฎ — แก้สูตรที่เมนูต้นทาง</p>
          {summary.linkedRecipes.map(({ rule, menu: sub }) => (
            <button
              key={rule.id}
              type="button"
              onClick={() => props.onOpenMenu(sub)}
              className="flex min-h-[48px] items-center gap-3 rounded-xl bg-card px-4 text-left text-foreground shadow-card hover:bg-secondary"
            >
              <span className="min-w-0 flex-1 truncate text-[15px] font-medium">
                <span className="font-mono text-muted-foreground">{sub.menuCode}</span> {sub.menuName}
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </button>
          ))}
        </section>
      )}
      {tab === "recipe" && (
        <RecipeEditor
          menu={menu}
          sharedLines={summary.sharedLines}
          branchLines={summary.branchLines}
          branches={props.branches}
          skus={props.skus}
          prices={props.prices}
          actions={props.recipeActions}
          canEdit={props.canEdit}
          hasLinked={summary.linkedRecipes.length > 0}
        />
      )}
      {tab === "branches" && <BranchesPanel {...props} />}
      {tab === "rules" && <RulesPanel {...props} />}
      {tab === "info" && <InfoPanel {...props} />}
    </div>
  );
}

function HealthPanel({ checks, onGo }: { checks: HealthCheck[]; onGo: (area: CheckArea) => void }) {
  const order: Record<CheckLevel, number> = { error: 0, warn: 1, ok: 2 };
  const sorted = [...checks].sort((a, b) => order[a.level] - order[b.level]);
  const areaLabel: Record<CheckArea, string> = { info: "ข้อมูลเมนู", recipe: "สูตร", branches: "สาขา", rules: "กฎตัวเลือก" };
  return (
    <ul className="flex flex-col gap-2">
      {sorted.map((c) => {
        const st = levelStyle[c.level];
        return (
          <li key={c.id} className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4 shadow-card">
            <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full", st.bg)}>
              <st.icon className={cn("h-4 w-4", st.text)} aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-medium">{c.title}</div>
              {c.detail && <p className="mt-0.5 text-sm text-muted-foreground">{c.detail}</p>}
            </div>
            {c.level !== "ok" && (
              <Button variant="outline" size="sm" className="h-9 shrink-0" onClick={() => onGo(c.area)}>
                ไป{areaLabel[c.area]}
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function BranchesPanel({ menu, summary, canEdit, salesLoaded, setBranchOpen }: WorkspaceProps) {
  const [busy, setBusy] = useState<string | null>(null);
  if (summary.branches.length === 0)
    return (
      <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground shadow-card">
        ไม่มีสาขาที่เปิดอยู่ของแบรนด์ "{menu.brandName || "ไม่ระบุ"}" — เช็คชื่อแบรนด์ที่แท็บข้อมูลเมนู
      </div>
    );
  return (
    <div className="flex flex-col gap-2">
      <ul className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
        {summary.branches.map((b, i) => (
          <li key={b.branchId} className={cn("flex items-center gap-3 px-4 py-3", i > 0 && "border-t border-border")}>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-medium">{b.branchName}</div>
              <div className="text-sm text-muted-foreground">
                ต้นทุน <span className="font-mono">{baht(b.cost)}</span> · {pct(b.costPct)} ·{" "}
                {salesLoaded ? `ขาย ${b.sold.toLocaleString()} ที่ใน ${SALES_WINDOW_DAYS} วัน` : "กำลังโหลดยอดขาย…"}
              </div>
              {!b.open && b.sold > 0 && <p className="mt-1 text-sm text-warning">ปิดขายไว้แต่ยังมียอดขาย — ระบบยังตัดของตามยอดขายจริง</p>}
            </div>
            <label className="flex min-h-[44px] shrink-0 items-center gap-2 text-sm">
              <span className={b.open ? "text-foreground" : "text-muted-foreground"}>{b.open ? "เปิดขาย" : "ปิดขาย"}</span>
              <Switch
                checked={b.open}
                disabled={!canEdit || busy === b.branchId}
                onCheckedChange={async (v) => {
                  setBusy(b.branchId);
                  await setBranchOpen(menu.id, b.branchId, v);
                  setBusy(null);
                }}
                aria-label={`เปิดขายที่ ${b.branchName}`}
              />
            </label>
          </li>
        ))}
      </ul>
      <p className="px-1 text-sm text-muted-foreground">ปิดขาย = ซ่อนจากรายการของสาขานั้น ถ้า POS ยังส่งยอดขายเข้ามา ระบบยังตัดวัตถุดิบตามจริง</p>
    </div>
  );
}

function RulesPanel({ menu, menus, summary, skus, allBranches, onNavigate, onOpenMenu }: WorkspaceProps) {
  const branchNames = (ids: string[]) => ids.map((id) => allBranches.find((b) => b.id === id)?.branchName ?? "สาขาที่ถูกลบ").join(", ");
  const typeLabel = { add: "เพิ่ม", swap: "เปลี่ยน", submenu: "ท็อปปิ้ง/ชุด" } as const;
  const ruleCard = (r: ModifierRule, extra?: React.ReactNode) => (
    <li key={r.id} className={cn("flex flex-col gap-1.5 px-4 py-3", !r.isActive && "opacity-60")}>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="neutral">{typeLabel[r.ruleType]}</Badge>
        {!r.isActive && <Badge variant="warning">ปิดอยู่</Badge>}
        {r.branchIds.length > 0 && <Badge variant="brand">เฉพาะ {branchNames(r.branchIds)}</Badge>}
      </div>
      <p className="text-[15px]">{describeRule(r, skus, menus)}</p>
      {extra}
    </li>
  );
  return (
    <div className="flex flex-col gap-4">
      <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
        <header className="border-b border-border px-4 py-3">
          <h4 className="text-base font-semibold">กฎที่เลือกเมนูนี้ไว้</h4>
          <p className="text-sm text-muted-foreground">ทำงานเมื่อชื่อในบิลของเมนูนี้มีคำที่ตั้งไว้</p>
        </header>
        {summary.ownRules.length ? (
          <ul className="divide-y divide-border">{summary.ownRules.map((r) => ruleCard(r))}</ul>
        ) : (
          <p className="px-4 py-4 text-sm text-muted-foreground">ไม่มี</p>
        )}
      </section>

      {summary.usedAsTopping.length > 0 && (
        <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
          <header className="border-b border-border px-4 py-3">
            <h4 className="text-base font-semibold">เมนูนี้ถูกใช้เป็นท็อปปิ้ง/ของในชุด</h4>
            <p className="text-sm text-muted-foreground">สั่งเพิ่มในเมนูอื่นแล้ว ระบบตัดของตามสูตรของ {menu.menuCode}</p>
          </header>
          <ul className="divide-y divide-border">
            {summary.usedAsTopping.map((r) =>
              ruleCard(
                r,
                r.menuIds.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {r.menuIds.map((id) => {
                      const m = menus.find((x) => x.id === id);
                      return m ? (
                        <button key={id} type="button" onClick={() => onOpenMenu(m)} className="min-h-[32px] rounded-full border border-border px-3 text-sm hover:bg-secondary">
                          {m.menuCode} {m.menuName}
                        </button>
                      ) : null;
                    })}
                  </div>
                ),
              ),
            )}
          </ul>
        </section>
      )}

      <div className="flex flex-col gap-3 rounded-2xl bg-secondary p-4 sm:flex-row sm:items-center">
        <ListFilter className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <p className="flex-1 text-sm text-muted-foreground">
          มีกฎอีก {summary.globalRuleCount} ตัวที่ไม่ได้เลือกเมนู — ใช้กับทุกเมนูที่ชื่อในบิลมีคำนั้น
        </p>
        <Button variant="outline" className="h-11" onClick={() => onNavigate("modifier-rules")}>
          จัดการกฎทั้งหมด
        </Button>
      </div>
    </div>
  );
}

function InfoPanel({ menu, canEdit, updateMenu }: WorkspaceProps) {
  const { categories } = useMenuCategories();
  const initial = { menuName: menu.menuName, category: menu.category, sellingPrice: String(menu.sellingPrice ?? 0), status: menu.status, isMaindish: menu.isMaindish };
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const dirty = (Object.keys(initial) as (keyof typeof initial)[]).filter((k) => String(form[k]) !== String(initial[k])).length;
  const errors = {
    name: !form.menuName.trim() ? "ใส่ชื่อเมนู" : null,
    price: form.sellingPrice === "" || Number(form.sellingPrice) < 0 || Number.isNaN(Number(form.sellingPrice)) ? "ราคาต้องเป็นตัวเลข 0 ขึ้นไป" : null,
  };
  const valid = !errors.name && !errors.price;
  const catOptions = useMemo(() => {
    const names = new Set(categories.map((c) => c.name));
    if (menu.category) names.add(menu.category);
    return [...names].sort().map((n) => ({ value: n, label: n }));
  }, [categories, menu.category]);

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    const ok = await updateMenu(menu.id, {
      menuName: form.menuName.trim(),
      category: form.category,
      sellingPrice: Number(form.sellingPrice),
      status: form.status,
      isMaindish: form.isMaindish,
    });
    setSaving(false);
    // On success the menu prop updates, so `initial` catches up and the bar hides
    if (!ok) return;
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 rounded-2xl border border-border bg-card p-4 shadow-card md:grid-cols-2 md:p-5">
        <div className="md:col-span-2">
          <label className="mb-1.5 block text-sm font-medium" htmlFor="ms-name">ชื่อเมนู</label>
          <Input id="ms-name" value={form.menuName} disabled={!canEdit} onChange={(e) => set("menuName", e.target.value)} className="h-11" />
          <FieldError message={errors.name} />
        </div>
        <div>
          <span className="mb-1.5 block text-sm font-medium">รหัสเมนู</span>
          <div className="flex h-11 items-center rounded-xl bg-secondary px-3 font-mono">{menu.menuCode}</div>
          <p className="mt-1.5 text-sm text-muted-foreground">ล็อกไว้ — ยอดขายจาก POS จับคู่ด้วยรหัสนี้</p>
        </div>
        <div>
          <span className="mb-1.5 block text-sm font-medium">แบรนด์</span>
          <div className="flex h-11 items-center rounded-xl bg-secondary px-3">{menu.brandName || "—"}</div>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium" htmlFor="ms-price">ราคาขาย (บาท)</label>
          <Input id="ms-price" type="number" inputMode="decimal" min={0} step="any" value={form.sellingPrice} disabled={!canEdit} onChange={(e) => set("sellingPrice", e.target.value)} className="h-11 text-right font-mono" />
          <FieldError message={errors.price} />
        </div>
        <div>
          <span className="mb-1.5 block text-sm font-medium">หมวด</span>
          <SearchableSelect value={form.category} onValueChange={(v) => set("category", v)} options={catOptions} placeholder="เลือกหมวด" disabled={!canEdit} triggerClassName="h-11 w-full" />
        </div>
        <label className="flex min-h-[48px] items-center justify-between gap-3 rounded-xl bg-secondary px-4">
          <span>
            <span className="block text-[15px] font-medium">เปิดเมนู</span>
            <span className="block text-sm text-muted-foreground">ปิด = ซ่อนจากทุกสาขา</span>
          </span>
          <Switch checked={form.status === "Active"} disabled={!canEdit} onCheckedChange={(v) => set("status", v ? "Active" : "Inactive")} />
        </label>
        <label className="flex min-h-[48px] items-center justify-between gap-3 rounded-xl bg-secondary px-4">
          <span>
            <span className="block text-[15px] font-medium">จานหลัก</span>
            <span className="block text-sm text-muted-foreground">นับเป็นฐานของสัดส่วนเมนูในหน้า Food Cost</span>
          </span>
          <Switch checked={form.isMaindish} disabled={!canEdit} onCheckedChange={(v) => set("isMaindish", v)} />
        </label>
      </div>
      {canEdit && <SaveBar pending={dirty} saving={saving} onSave={save} onDiscard={() => setForm(initial)} />}
    </div>
  );
}
