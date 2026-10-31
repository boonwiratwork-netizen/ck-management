import { useMemo, useState } from "react";
import { Search, ChevronDown, CheckCircle2, AlertTriangle, XCircle, MinusCircle, Plus, Info } from "lucide-react";
import type { Menu } from "@/types/menu";
import type { MenuBomLine } from "@/types/menu-bom";
import type { ModifierRule } from "@/types/modifier-rule";
import type { SKU } from "@/types/sku";
import type { Price } from "@/types/price";
import type { Branch } from "@/types/branch";
import { buildCatalog, groupKey, specificKeywords, testDraft, type Bill, type OptionEntry, type OptionStatus, type RuleDraft } from "@/lib/pos-options";
import { describeRule } from "@/lib/menu-health";
import { SALES_WINDOW_DAYS } from "@/hooks/use-menu-setup-extras";
import { SegmentedTabs } from "@/components/SegmentedTabs";
import { SearchableSelect } from "@/components/SearchableSelect";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { FieldError } from "@/components/form/FieldError";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { skuOptions } from "./sku-options";

interface PosOptionsViewProps {
  bills: Bill[] | null;
  /** Loading bills failed */
  loadError?: boolean;
  noStock: Set<string>;
  setNoStockKeys: (keys: string[], on: boolean) => Promise<boolean>;
  menus: Menu[];
  lines: MenuBomLine[];
  rules: ModifierRule[];
  skus: SKU[];
  prices: Price[];
  branches: Branch[];
  canEdit: boolean;
  addRule: (data: Omit<ModifierRule, "id">) => Promise<ModifierRule | null>;
}

type Filter = "todo" | "partial" | "covered" | "ignored" | "all";

const statusStyle: Record<OptionStatus, { icon: React.ElementType; text: string; bg: string; label: string }> = {
  covered: { icon: CheckCircle2, text: "text-success", bg: "bg-success-soft", label: "มีกฎ" },
  partial: { icon: AlertTriangle, text: "text-warning", bg: "bg-warning-soft", label: "กฎครอบไม่หมด" },
  none: { icon: XCircle, text: "text-destructive", bg: "bg-destructive-soft", label: "ยังไม่มีกฎ" },
  ignored: { icon: MinusCircle, text: "text-muted-foreground", bg: "bg-secondary", label: "ไม่กระทบวัตถุดิบ" },
};

/**
 * Every option customers picked in the last 30 days, and whether a rule turns it
 * into stock usage. Options that change nothing (saltiness, noodle firmness) are
 * marked once and drop out of the to-do list.
 */
export function PosOptionsView(props: PosOptionsViewProps) {
  const { bills, noStock, setNoStockKeys, menus, rules, branches, canEdit } = props;
  const [filter, setFilter] = useState<Filter>("todo");
  const [query, setQuery] = useState("");
  const [branch, setBranch] = useState("all");
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const catalog = useMemo(() => {
    if (!bills) return [];
    const scoped = branch === "all" ? bills : bills.filter((b) => b.branch_id === branch);
    return buildCatalog(scoped, menus, rules, noStock);
  }, [bills, branch, menus, rules, noStock]);

  const counts = useMemo(() => {
    const c = { none: 0, partial: 0, covered: 0, ignored: 0 };
    for (const e of catalog) c[e.status]++;
    return c;
  }, [catalog]);

  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return catalog.filter((e) => {
      if (filter === "todo" && e.status !== "none") return false;
      if (filter === "partial" && e.status !== "partial") return false;
      if (filter === "covered" && e.status !== "covered") return false;
      if (filter === "ignored" && e.status !== "ignored") return false;
      const hay = `${e.group} ${e.value}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [catalog, filter, query]);

  // Keep groups together, biggest group first
  const groups = useMemo(() => {
    const m = new Map<string, OptionEntry[]>();
    for (const e of shown) m.set(e.group, [...(m.get(e.group) ?? []), e]);
    return [...m.entries()].sort((a, b) => b[1].reduce((s, e) => s + e.plates, 0) - a[1].reduce((s, e) => s + e.plates, 0));
  }, [shown]);

  const branchName = (id: string) => branches.find((b) => b.id === id)?.branchName ?? "สาขาที่ถูกลบ";
  const branchIds = useMemo(() => [...new Set((bills ?? []).map((b) => b.branch_id))], [bills]);

  const toggle = async (keys: string[], on: boolean, id: string) => {
    setBusy(id);
    await setNoStockKeys(keys, on);
    setBusy(null);
  };

  if (!bills && props.loadError)
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card p-8 text-center shadow-card">
        <p className="text-sm text-muted-foreground">โหลดบิลขายไม่สำเร็จ</p>
        <Button variant="outline" className="h-11" onClick={() => window.location.reload()}>
          ลองใหม่
        </Button>
      </div>
    );

  if (!bills)
    return (
      <div className="flex flex-col gap-2" aria-busy="true">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-16 animate-pulse rounded-2xl bg-card shadow-card" />
        ))}
      </div>
    );

  const tabs: { key: Filter; label: string }[] = [
    { key: "todo", label: `ยังไม่มีกฎ ${counts.none}` },
    { key: "partial", label: `ครอบไม่หมด ${counts.partial}` },
    { key: "covered", label: `มีกฎ ${counts.covered}` },
    { key: "ignored", label: `ไม่กระทบ ${counts.ignored}` },
    { key: "all", label: `ทั้งหมด ${catalog.length}` },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-card">
        <p className="text-sm text-muted-foreground">
          ตัวเลือกที่ลูกค้ากดใน POS ช่วง {SALES_WINDOW_DAYS} วัน — ตัวเลือกที่ใช้วัตถุดิบต้องมีกฎ ที่ไม่ใช้วัตถุดิบ (เช่น ความเค็ม) กด "ไม่กระทบวัตถุดิบ" ครั้งเดียวพอ
        </p>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ค้นตัวเลือก…" className="h-11 pl-9" aria-label="ค้นตัวเลือก" />
        </div>
        {branchIds.length > 1 && (
          <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {["all", ...branchIds].map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => setBranch(b)}
                className={cn(
                  "min-h-[36px] shrink-0 rounded-full border px-3.5 text-sm transition-colors",
                  branch === b ? "border-primary bg-primary font-semibold text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {b === "all" ? "ทุกสาขา" : branchName(b)}
              </button>
            ))}
          </div>
        )}
        <SegmentedTabs<Filter> tabs={tabs} value={filter} onChange={setFilter} className="[&_[role=tab]]:min-h-[36px] [&_[role=tab]]:px-3" />
      </div>

      {groups.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
          {filter === "todo" ? "ทุกตัวเลือกมีกฎหรือถูกตั้งว่าไม่กระทบวัตถุดิบแล้ว" : "ไม่มีตัวเลือกในกลุ่มนี้"}
        </div>
      )}

      {groups.map(([group, entries]) => {
        const gk = groupKey(group);
        const groupIgnored = noStock.has(gk);
        return (
          <section key={group} className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
            <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
              <div className="min-w-0 flex-1">
                <h4 className="text-base font-semibold">{group || "ไม่มีชื่อกลุ่ม"}</h4>
                <p className="text-sm text-muted-foreground">{entries.length} ตัวเลือก</p>
              </div>
              {canEdit && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9"
                  loading={busy === gk}
                  onClick={() => toggle([gk], !groupIgnored, gk)}
                >
                  {groupIgnored ? "ยกเลิก: ทั้งกลุ่มไม่กระทบ" : "ทั้งกลุ่มไม่กระทบวัตถุดิบ"}
                </Button>
              )}
            </header>
            <ul className="divide-y divide-border">
              {entries.map((e) => {
                const st = statusStyle[e.status];
                const expanded = open === e.key;
                return (
                  <li key={e.key}>
                    <button
                      type="button"
                      onClick={() => setOpen(expanded ? null : e.key)}
                      aria-expanded={expanded}
                      className="flex min-h-[56px] w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-secondary/60"
                    >
                      <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full", st.bg)}>
                        <st.icon className={cn("h-4 w-4", st.text)} aria-hidden="true" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[15px] font-medium">{e.value}</div>
                        <div className="text-sm text-muted-foreground">
                          {st.label}
                          {e.status === "partial" && ` · ${(e.plates - e.coveredPlates).toLocaleString()} จานไม่โดนกฎ`}
                        </div>
                      </div>
                      <span className="shrink-0 font-mono text-sm tabular-nums text-muted-foreground">{e.plates.toLocaleString()} จาน</span>
                      <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-180")} aria-hidden="true" />
                    </button>
                    {expanded && (
                      <OptionDetail
                        {...props}
                        entry={e}
                        ignored={noStock.has(e.key)}
                        groupIgnored={groupIgnored}
                        busy={busy === e.key}
                        onIgnore={(on) => toggle([e.key], on, e.key)}
                        branchName={branchName}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function OptionDetail(
  props: PosOptionsViewProps & {
    entry: OptionEntry;
    ignored: boolean;
    groupIgnored: boolean;
    busy: boolean;
    onIgnore: (on: boolean) => void;
    branchName: (id: string) => string;
  },
) {
  const { entry: e, menus, skus, canEdit, ignored, groupIgnored, busy, onIgnore, branchName } = props;
  const [drafting, setDrafting] = useState(false);
  const menuByCode = new Map(menus.map((m) => [m.menuCode, m]));
  const topMenus = [...e.menuCodes.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div className="flex flex-col gap-3 bg-secondary/50 px-4 pb-4 pt-1">
      <div className="text-sm">
        <span className="text-muted-foreground">ขายใน: </span>
        {topMenus.slice(0, 6).map(([code, n], i) => (
          <span key={code}>
            {i > 0 && " · "}
            <span className="font-mono">{code}</span> {menuByCode.get(code)?.menuName ?? <span className="text-destructive">(ไม่มีในรายการเมนู)</span>} {n}
          </span>
        ))}
        {topMenus.length > 6 && ` · อีก ${topMenus.length - 6} เมนู`}
        <span className="text-muted-foreground"> · {[...e.branchIds].map(branchName).join(", ")}</span>
      </div>

      {e.rules.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {e.rules.map((r) => (
            <li key={r.id} className="rounded-xl bg-card px-3 py-2 text-sm shadow-card">
              {describeRule(r, skus, menus)}
              {(r.menuIds.length > 0 || r.branchIds.length > 0) && (
                <span className="text-muted-foreground">
                  {" "}
                  · {r.menuIds.length > 0 ? `${r.menuIds.length} เมนู` : "ทุกเมนู"} · {r.branchIds.length > 0 ? r.branchIds.map(branchName).join(", ") : "ทุกสาขา"}
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">ยังไม่มีกฎที่มีคำนี้</p>
      )}

      <p className="break-words font-mono text-xs leading-relaxed text-muted-foreground">ตัวอย่างบิล: {e.example}</p>

      {canEdit && !drafting && (
        <div className="flex flex-wrap gap-2">
          <Button variant="brand" className="h-11" onClick={() => setDrafting(true)}>
            <Plus className="h-4 w-4" /> สร้างกฎจากตัวเลือกนี้
          </Button>
          {!groupIgnored && (
            <Button variant="outline" className="h-11" loading={busy} onClick={() => onIgnore(!ignored)}>
              {ignored ? "ยกเลิก: ไม่กระทบวัตถุดิบ" : "ไม่กระทบวัตถุดิบ"}
            </Button>
          )}
        </div>
      )}
      {drafting && <RuleDraftForm {...props} onDone={() => setDrafting(false)} />}
    </div>
  );
}

/**
 * Builds a rule and tests it on real bills before saving. From the POS catalog it
 * starts from an option (entry); from a menu's rules tab it starts empty, limited
 * to that menu (presetMenus); from the list of every rule it opens one (rule) to
 * change, turn off or delete.
 */
export function RuleDraftForm({
  entry,
  presetMenus,
  rule,
  updateRule,
  deleteRule,
  bills,
  menus,
  lines,
  skus,
  prices,
  branches,
  addRule,
  onDone,
  branchName,
}: Pick<PosOptionsViewProps, "bills" | "menus" | "lines" | "skus" | "prices" | "branches" | "addRule"> & {
  entry?: OptionEntry;
  presetMenus?: Menu[];
  rule?: ModifierRule;
  updateRule?: (id: string, data: Partial<Omit<ModifierRule, "id">>) => Promise<boolean>;
  deleteRule?: (id: string) => Promise<boolean>;
  onDone: () => void;
  branchName: (id: string) => string;
}) {
  const menuByCode = useMemo(() => new Map(menus.map((m) => [m.menuCode, m])), [menus]);
  // Menus picked from the full list, beyond the ones the option or rule came with
  const [added, setAdded] = useState<string[]>([]);
  const seenMenus = useMemo(() => {
    const base = rule
      ? rule.menuIds.map((id) => menus.find((m) => m.id === id)).filter((m): m is Menu => !!m)
      : entry
        ? [...entry.menuCodes.keys()].map((c) => menuByCode.get(c)).filter((m): m is Menu => !!m)
        : presetMenus ?? [];
    return [...base, ...added.map((id) => menus.find((m) => m.id === id)).filter((m): m is Menu => !!m && !base.some((b) => b.id === m.id))];
  }, [rule, entry, presetMenus, menuByCode, menus, added]);
  const [draft, setDraft] = useState<RuleDraft>(
    rule
      ? { ruleType: rule.ruleType, keyword: rule.keyword, skuId: rule.skuId || null, swapSkuId: rule.swapSkuId, submenuId: rule.submenuId, qtyPerMatch: rule.qtyPerMatch, menuIds: rule.menuIds, branchIds: rule.branchIds ?? [] }
      : {
          ruleType: entry?.group.toLowerCase().includes("topping") ? "submenu" : "add",
          keyword: entry?.value ?? "",
          skuId: null,
          swapSkuId: null,
          submenuId: null,
          qtyPerMatch: 0,
          menuIds: seenMenus.map((m) => m.id),
          branchIds: [],
        },
  );
  const [qty, setQty] = useState(rule && rule.ruleType !== "submenu" ? String(rule.qtyPerMatch) : "");
  const [askDelete, setAskDelete] = useState(false);
  const [allMenus, setAllMenus] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tried, setTried] = useState(false);
  const set = <K extends keyof RuleDraft>(k: K, v: RuleDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const live = { ...draft, qtyPerMatch: Number(qty) || 0 };
  const test = useMemo(() => testDraft(live, bills ?? [], menus, lines), [live.ruleType, live.keyword, live.skuId, live.swapSkuId, live.qtyPerMatch, live.menuIds, live.branchIds, bills, menus, lines]); // eslint-disable-line react-hooks/exhaustive-deps
  // When the keyword also hits other options, offer the POS's longer wording
  const better = useMemo(() => {
    if (!entry || test.options.length <= 1) return null;
    for (const k of specificKeywords(entry, entry.example)) {
      if (k === draft.keyword) continue;
      const t = testDraft({ ...live, keyword: k }, bills ?? [], menus, lines);
      if (t.plates > 0 && t.options.length === 1 && t.inMenuName === 0) return k;
    }
    return null;
  }, [test.options.length, entry, draft.keyword, bills, menus, lines]); // eslint-disable-line react-hooks/exhaustive-deps
  const sku = skus.find((s) => s.id === draft.skuId);
  const skuOpts = useMemo(() => skuOptions(skus, prices), [skus, prices]);
  const menuOpts = useMemo(
    () => menus.filter((m) => m.status === "Active").map((m) => ({ value: m.id, label: m.menuName, sublabel: m.menuCode })),
    [menus],
  );

  const errors = {
    keyword: !draft.keyword.trim() ? "ใส่คำที่อยู่ในบิล" : null,
    sku: draft.ruleType !== "submenu" && !draft.skuId ? (draft.ruleType === "swap" ? "เลือกของที่ใส่แทน" : "เลือกวัตถุดิบ") : null,
    swap: draft.ruleType === "swap" && !draft.swapSkuId ? "เลือกของที่เอาออก" : null,
    submenu: draft.ruleType === "submenu" && !draft.submenuId ? "เลือกเมนูที่ใช้สูตร" : null,
    qty: draft.ruleType !== "submenu" && !(Number(qty) > 0) ? "ใส่ปริมาณมากกว่า 0" : null,
  };
  const valid = Object.values(errors).every((x) => !x);

  const save = async () => {
    setTried(true);
    if (!valid) return;
    setSaving(true);
    if (rule && updateRule) {
      const ok = await updateRule(rule.id, {
        keyword: draft.keyword.trim(),
        skuId: draft.ruleType === "submenu" ? "" : draft.skuId ?? "",
        qtyPerMatch: draft.ruleType === "submenu" ? 1 : Number(qty),
        uom: draft.ruleType === "submenu" ? "" : sku?.usageUom ?? "",
        ruleType: draft.ruleType,
        swapSkuId: draft.ruleType === "swap" ? draft.swapSkuId : null,
        submenuId: draft.ruleType === "submenu" ? draft.submenuId : null,
        menuIds: draft.menuIds,
        branchIds: draft.branchIds,
      });
      setSaving(false);
      if (ok) onDone();
      return;
    }
    const ok = await addRule({
      keyword: draft.keyword.trim(),
      skuId: draft.ruleType === "submenu" ? "" : draft.skuId ?? "",
      qtyPerMatch: draft.ruleType === "submenu" ? 1 : Number(qty),
      uom: draft.ruleType === "submenu" ? "" : sku?.usageUom ?? "",
      description: entry ? `สร้างจากตัวเลือก POS: ${entry.group} : ${entry.value}` : "สร้างจากหน้าตั้งค่าเมนู",
      isActive: true,
      menuId: null,
      menuIds: draft.menuIds,
      ruleType: draft.ruleType,
      swapSkuId: draft.ruleType === "swap" ? draft.swapSkuId : null,
      submenuId: draft.ruleType === "submenu" ? draft.submenuId : null,
      branchIds: draft.branchIds,
    });
    setSaving(false);
    if (ok) onDone();
  };

  const typeTabs: { key: RuleDraft["ruleType"]; label: string }[] = [
    { key: "add", label: "เพิ่มวัตถุดิบ" },
    { key: "swap", label: "เปลี่ยนวัตถุดิบ" },
    { key: "submenu", label: "ใช้สูตรเมนู" },
  ];
  const toggleIn = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  return (
    <form
      className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 shadow-card"
      onSubmit={(ev) => {
        ev.preventDefault();
        save();
      }}
    >
      <SegmentedTabs tabs={typeTabs} value={draft.ruleType} onChange={(v) => set("ruleType", v)} />
      <p className="-mt-2 text-sm text-muted-foreground">
        {draft.ruleType === "add" && "ลูกค้าเลือกแล้วใช้วัตถุดิบเพิ่ม เช่น ไข่ น้ำมัน ท็อปปิ้ง"}
        {draft.ruleType === "swap" && "ลูกค้าเลือกแล้วเอาของในสูตรออก ใส่อีกอย่างแทน เช่น เปลี่ยนเส้น"}
        {draft.ruleType === "submenu" && "ลูกค้าเลือกแล้วตัดของตามสูตรของเมนูอื่น เช่น ท็อปปิ้งที่ตั้งสูตรเป็นเมนูไว้"}
      </p>

      <div>
        <label className="mb-1.5 block text-sm font-medium" htmlFor="rd-kw">คำในบิลที่ทำให้กฎทำงาน</label>
        <Input id="rd-kw" value={draft.keyword} onChange={(ev) => set("keyword", ev.target.value)} className="h-11" />
        <FieldError message={tried ? errors.keyword : null} />
      </div>

      {draft.ruleType === "swap" && (
        <div>
          <span className="mb-1.5 block text-sm font-medium">เอาออกจากสูตร</span>
          <SearchableSelect value={draft.swapSkuId ?? ""} onValueChange={(v) => set("swapSkuId", v)} options={skuOpts} placeholder="ค้นชื่อหรือรหัส…" triggerClassName="h-11 w-full" />
          <FieldError message={tried ? errors.swap : null} />
        </div>
      )}
      {draft.ruleType !== "submenu" ? (
        <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
          <div>
            <span className="mb-1.5 block text-sm font-medium">{draft.ruleType === "swap" ? "ใส่แทน" : "วัตถุดิบ"}</span>
            <SearchableSelect value={draft.skuId ?? ""} onValueChange={(v) => set("skuId", v)} options={skuOpts} placeholder="ค้นชื่อหรือรหัส…" triggerClassName="h-11 w-full" />
            <FieldError message={tried ? errors.sku : null} />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium" htmlFor="rd-qty">ปริมาณต่อจาน{sku ? ` (${sku.usageUom})` : ""}</label>
            <Input id="rd-qty" type="number" inputMode="decimal" min={0} step="any" value={qty} onChange={(ev) => setQty(ev.target.value)} className="h-11 text-right font-mono" />
            <FieldError message={tried ? errors.qty : null} />
          </div>
        </div>
      ) : (
        <div>
          <span className="mb-1.5 block text-sm font-medium">ตัดของตามสูตรของเมนู</span>
          <SearchableSelect value={draft.submenuId ?? ""} onValueChange={(v) => set("submenuId", v)} options={menuOpts} placeholder="ค้นชื่อหรือรหัสเมนู…" triggerClassName="h-11 w-full" />
          <FieldError message={tried ? errors.submenu : null} />
        </div>
      )}

      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">ใช้กับเมนู{draft.menuIds.length ? ` · เลือก ${draft.menuIds.length}` : ""}</legend>
        <div className="flex flex-wrap gap-1.5">
          <Chip on={draft.menuIds.length === 0} onClick={() => set("menuIds", draft.menuIds.length === 0 ? seenMenus.map((m) => m.id) : [])}>
            ทุกเมนู
          </Chip>
          {(allMenus ? seenMenus : seenMenus.slice(0, 6)).map((m) => (
            <Chip key={m.id} on={draft.menuIds.includes(m.id)} onClick={() => set("menuIds", toggleIn(draft.menuIds, m.id))}>
              {m.menuCode} {m.menuName}
            </Chip>
          ))}
          {!allMenus && seenMenus.length > 6 && (
            <button type="button" onClick={() => setAllMenus(true)} className="min-h-[36px] rounded-full px-3 text-sm font-medium text-brand">
              ดูอีก {seenMenus.length - 6} เมนู
            </button>
          )}
        </div>
        <div className="mt-2 max-w-sm">
          <SearchableSelect
            value=""
            onValueChange={(id) => {
              if (!id) return;
              setAdded((a) => (a.includes(id) ? a : [...a, id]));
              set("menuIds", draft.menuIds.includes(id) ? draft.menuIds : [...draft.menuIds, id]);
              setAllMenus(true);
            }}
            options={menuOpts}
            placeholder="+ เพิ่มเมนู…"
            triggerClassName="h-10 w-full"
          />
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">ใช้กับสาขา</legend>
        <div className="flex flex-wrap gap-1.5">
          <Chip on={draft.branchIds.length === 0} onClick={() => set("branchIds", [])}>
            ทุกสาขา
          </Chip>
          {branches
            .filter((b) => b.status === "Active")
            .map((b) => (
              <Chip key={b.id} on={draft.branchIds.includes(b.id)} onClick={() => set("branchIds", toggleIn(draft.branchIds, b.id))}>
                {b.branchName}
              </Chip>
            ))}
        </div>
      </fieldset>

      {/* Live test on real bills */}
      <div className="flex flex-col gap-2 rounded-xl bg-secondary p-3 text-sm">
        <div className="flex items-center gap-2 font-medium">
          <Info className="h-4 w-4 text-brand" aria-hidden="true" /> ลองกับบิลจริง {SALES_WINDOW_DAYS} วัน
        </div>
        {test.plates === 0 ? (
          <p className="text-warning">กฎนี้จะไม่ทำงานกับบิลไหนเลย — เช็คคำ หรือเมนู/สาขาที่เลือก</p>
        ) : (
          <p>
            ทำงาน <b className="font-mono">{test.plates.toLocaleString()}</b> จาน
            {draft.ruleType !== "submenu" && sku && (
              <>
                {" "}· ตัด {sku.name} รวม <b className="font-mono">{test.totalQty.toLocaleString()}</b> {sku.usageUom}
              </>
            )}
          </p>
        )}
        {test.options.length > 1 && (
          <p className="text-warning">
            คำนี้ไปโดนตัวเลือกอื่นด้วย: {test.options.filter((o) => !(o.value === entry?.value && o.group === entry?.group)).map((o) => `${o.group} : ${o.value} (${o.plates})`).join(", ")} — ใช้คำที่เจาะจงกว่านี้
          </p>
        )}
        {better && (
          <Button type="button" variant="outline" className="h-11 justify-start self-start" onClick={() => set("keyword", better)}>
            ใช้คำ "{better}" แทน
          </Button>
        )}
        {test.inMenuName > 0 && <p className="text-warning">คำนี้อยู่ในชื่อเมนูเอง {test.inMenuName.toLocaleString()} จาน — กฎจะทำงานทุกจานของเมนูนั้น</p>}
        {test.swapMissing > 0 && (
          <p className="text-destructive">{test.swapMissing.toLocaleString()} จาน: ของที่เอาออกไม่อยู่ในสูตรของเมนูนั้น — จะใส่ของใหม่เพิ่มโดยไม่เอาของเดิมออก</p>
        )}
        {test.leftOut > 0 && <p className="text-muted-foreground">อีก {test.leftOut.toLocaleString()} จานมีคำนี้ แต่อยู่นอกเมนู/สาขาที่เลือก</p>}
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        {rule && updateRule && (
          <Button
            type="button"
            variant="ghost"
            className={cn("mr-auto h-11", rule.isActive ? "text-muted-foreground" : "text-success")}
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              const ok = await updateRule(rule.id, { isActive: !rule.isActive });
              setSaving(false);
              if (ok) onDone();
            }}
          >
            {rule.isActive ? "ปิดกฎนี้" : "เปิดกฎนี้อีกครั้ง"}
          </Button>
        )}
        {rule && deleteRule && (
          <Button type="button" variant="ghost" className="h-11 text-destructive" disabled={saving} onClick={() => setAskDelete(true)}>
            ลบ
          </Button>
        )}
        <Button type="button" variant="outline" className="h-11" onClick={onDone}>
          ยกเลิก
        </Button>
        <Button type="submit" variant="brand" className="h-11 min-w-[112px]" loading={saving}>
          บันทึกกฎ
        </Button>
      </div>
      {rule && deleteRule && (
        <ConfirmDialog
          open={askDelete}
          onOpenChange={setAskDelete}
          title="ลบกฎนี้?"
          description={`"${rule.keyword}" จะไม่ตัดวัตถุดิบอีก · ถ้าอาจใช้อีก กด "ปิดกฎนี้" แทน`}
          confirmLabel="ลบ"
          cancelLabel="ไม่ลบ"
          variant="destructive"
          onConfirm={async () => {
            setAskDelete(false);
            setSaving(true);
            const ok = await deleteRule(rule.id);
            setSaving(false);
            if (ok) onDone();
          }}
        />
      )}
      <p className="-mt-2 text-right text-xs text-muted-foreground">
        {entry ? `สาขาที่ขาย: ${[...entry.branchIds].map(branchName).join(", ")}` : rule ? "แก้แล้วมีผลกับยอดขายที่นำเข้าหลังจากนี้" : "ใส่คำตามที่ POS เขียนในบิล ดูตัวอย่างได้ที่แท็บบิลจริง"}
      </p>
    </form>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        "min-h-[36px] rounded-full border px-3 text-sm transition-colors",
        on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
