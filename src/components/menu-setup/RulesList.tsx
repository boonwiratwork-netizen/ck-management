import { useMemo, useState } from "react";
import { AlertTriangle, Plus, Search } from "lucide-react";
import type { Menu } from "@/types/menu";
import type { MenuBomLine } from "@/types/menu-bom";
import type { ModifierRule } from "@/types/modifier-rule";
import type { SKU } from "@/types/sku";
import type { Price } from "@/types/price";
import type { Branch } from "@/types/branch";
import type { Bill } from "@/lib/pos-options";
import { describeRule } from "@/lib/menu-health";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { RuleDraftForm } from "./PosOptionsView";

type Filter = "all" | "submenu" | "add" | "swap" | "one-branch" | "off";

interface Props {
  rules: ModifierRule[];
  menus: Menu[];
  lines: MenuBomLine[];
  skus: SKU[];
  prices: Price[];
  branches: Branch[];
  bills: Bill[] | null;
  canEdit: boolean;
  addRule: (data: Omit<ModifierRule, "id">) => Promise<ModifierRule | null>;
  updateRule: (id: string, data: Partial<Omit<ModifierRule, "id">>) => Promise<boolean>;
  deleteRule?: (id: string) => Promise<boolean>;
}

/**
 * Every POS option rule in one list (replaces the old English rules page): what
 * word in the bill sets it off, what it takes out of stock, which menus and which
 * branches. A rule set for one branch only is flagged: the other branch selling
 * the same set doesn't deduct (Delivery Set B at Shiro, 29 Oct 2026).
 */
export function RulesList({ rules, menus, lines, skus, prices, branches, bills, canEdit, addRule, updateRule, deleteRule }: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | "new" | null>(null);
  const active = branches.filter((b) => b.status === "Active");
  const branchName = (id: string) => branches.find((b) => b.id === id)?.branchName ?? "สาขาที่ปิดแล้ว";
  // One branch only, while more than one branch is open
  const oneBranch = (r: ModifierRule) => r.isActive && active.length > 1 && (r.branchIds ?? []).length > 0 && active.some((b) => !r.branchIds.includes(b.id));
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: rules.length, submenu: 0, add: 0, swap: 0, "one-branch": 0, off: 0 };
    for (const r of rules) {
      if (!r.isActive) c.off++;
      else c[r.ruleType]++;
      if (oneBranch(r)) c["one-branch"]++;
    }
    return c;
  }, [rules, branches]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return rules
      .filter((r) => {
        if (filter === "off" && r.isActive) return false;
        if (filter !== "all" && filter !== "off" && filter !== "one-branch" && (!r.isActive || r.ruleType !== filter)) return false;
        if (filter === "one-branch" && !oneBranch(r)) return false;
        const hay = `${r.keyword} ${describeRule(r, skus, menus)}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      })
      .sort((a, b) => Number(oneBranch(b)) - Number(oneBranch(a)) || Number(b.isActive) - Number(a.isActive) || a.keyword.localeCompare(b.keyword));
  }, [rules, filter, query, skus, menus, branches]); // eslint-disable-line react-hooks/exhaustive-deps

  const menuLabel = (r: ModifierRule) => {
    if (!r.menuIds.length) return "ทุกเมนู";
    const ms = r.menuIds.map((id) => menus.find((m) => m.id === id)).filter((m): m is Menu => !!m);
    return ms.slice(0, 3).map((m) => m.menuName).join(" · ") + (ms.length > 3 ? ` · +${ms.length - 3}` : "");
  };
  const branchLabel = (r: ModifierRule) => (!(r.branchIds ?? []).length ? "ทุกสาขา" : r.branchIds.map(branchName).join(" · "));
  const missing = (r: ModifierRule) => active.filter((b) => !r.branchIds.includes(b.id)).map((b) => b.branchName).join(", ");

  const chips: { key: Filter; label: string }[] = [
    { key: "all", label: "ทั้งหมด" },
    { key: "submenu", label: "ตัดตามสูตรเมนู" },
    { key: "add", label: "เพิ่มของ" },
    { key: "swap", label: "เปลี่ยนของ" },
    { key: "one-branch", label: "ใช้สาขาเดียว" },
    { key: "off", label: "ปิดอยู่" },
  ];
  const form = (rule?: ModifierRule) => (
    <RuleDraftForm
      rule={rule}
      presetMenus={rule ? undefined : []}
      bills={bills}
      menus={menus}
      lines={lines}
      skus={skus}
      prices={prices}
      branches={branches}
      addRule={addRule}
      updateRule={updateRule}
      deleteRule={deleteRule}
      branchName={branchName}
      onDone={() => setOpen(null)}
    />
  );

  return (
    <div className="flex flex-col gap-4">
      {counts["one-branch"] > 0 && (
        <div className="flex flex-col gap-2 rounded-2xl border border-warning/40 bg-warning-soft p-4 sm:flex-row sm:items-center">
          <AlertTriangle className="h-5 w-5 shrink-0 text-warning" aria-hidden="true" />
          <p className="flex-1 text-sm">
            <b>กฎ {counts["one-branch"]} ตัวใช้ได้บางสาขา</b> · ถ้าสาขาอื่นขายเมนูนั้นด้วย สาขานั้นจะไม่ตัดวัตถุดิบ
          </p>
          <Button variant="outline" className="h-10 shrink-0" onClick={() => setFilter("one-branch")}>
            ดู {counts["one-branch"]} ตัว
          </Button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {chips.map((c) => (
          <button
            key={c.key}
            type="button"
            aria-pressed={filter === c.key}
            onClick={() => setFilter(c.key)}
            className={cn(
              "min-h-[40px] rounded-full border px-3 text-sm",
              filter === c.key ? "border-foreground bg-foreground font-semibold text-background" : "border-border bg-card text-muted-foreground hover:text-foreground",
              c.key === "one-branch" && counts["one-branch"] > 0 && filter !== c.key && "border-warning/50 text-warning",
            )}
          >
            {c.label} <span className="font-mono">{counts[c.key]}</span>
          </button>
        ))}
        <div className="relative ml-auto min-w-[200px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ค้นคำในบิล หรือวัตถุดิบ" className="h-10 pl-9 text-base md:text-sm" />
        </div>
        {canEdit && (
          <Button variant="brand" className="h-10" onClick={() => setOpen("new")}>
            <Plus className="h-4 w-4" /> เพิ่มกฎ
          </Button>
        )}
      </div>
      {open === "new" && form()}
      <ul className="overflow-hidden rounded-2xl border border-border bg-card">
        {shown.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted-foreground">ไม่มีกฎที่ตรงกับที่เลือก</li>}
        {shown.map((r) => (
          <li key={r.id} className="border-t border-border first:border-t-0">
            <button
              type="button"
              disabled={!canEdit}
              aria-expanded={open === r.id}
              onClick={() => setOpen(open === r.id ? null : r.id)}
              className={cn("flex w-full flex-col gap-1 px-4 py-3 text-left enabled:hover:bg-secondary/50 md:grid md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.9fr)] md:items-start md:gap-3", oneBranch(r) && "bg-warning-soft/50", !r.isActive && "opacity-60")}
            >
              <span className="min-w-0 break-words font-medium">
                {r.keyword}
                {!r.isActive && <span className="ml-2 rounded-full bg-secondary px-2 py-0.5 text-xs font-normal text-muted-foreground">ปิดอยู่</span>}
              </span>
              <span className="min-w-0 break-words text-sm">{describeRule(r, skus, menus).replace(/^ถ้าบิลมีคำว่า "[^"]*" → /, "").replace(/^ถ้าบิลเป็นรหัส \S+ หรือมีคำนี้ → /, "")}</span>
              <span className="min-w-0 break-words text-sm text-muted-foreground">{menuLabel(r)}</span>
              <span className="min-w-0 break-words text-sm text-muted-foreground">
                {branchLabel(r)}
                {oneBranch(r) && <span className="block font-medium text-warning">{missing(r)} ไม่ตัด</span>}
              </span>
            </button>
            {open === r.id && <div className="border-t border-border bg-secondary/30 p-3">{form(r)}</div>}
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">แตะกฎเพื่อแก้ · แก้แล้วมีผลกับยอดขายที่นำเข้าหลังจากนี้ ใบนับที่กดเสร็จแล้วไม่คิดใหม่</p>
    </div>
  );
}
