import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, CheckCircle2, ChevronRight, CircleDashed, XCircle } from "lucide-react";
import type { SKU, StorageCondition } from "@/types/sku";
import type { Price } from "@/types/price";
import type { Supplier } from "@/types/supplier";
import type { Menu } from "@/types/menu";
import type { SkuCategory } from "@/hooks/use-sku-categories";
import type { TabKey } from "@/components/AppSidebar";
import { unitLooksOff, type ProductArea, type ProductCheck, type ProductLevel, type ProductSummary } from "@/lib/product-health";
import { affectedRecipes, resolveSm, smCost, spCost, type RecipeBook } from "@/lib/cost-engine";
import { BOM_SUPPLIER_ID } from "@/lib/bom-price-sync";
import { SegmentedTabs } from "@/components/SegmentedTabs";
import { SearchableSelect } from "@/components/SearchableSelect";
import { SaveBar } from "@/components/form/SaveBar";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn, toLocalDateStr } from "@/lib/utils";
import { Chain, KindBadge, KIND_NAME, baht, perUnit, type ChainNode } from "./parts";
import { packPriceLabel } from "./ProductList";
import { RecipeEditor, type RecipeEditActions } from "./RecipeEditor";
import type { BOMHeader, BOMLine } from "@/types/bom";
import type { SpBomLine } from "@/types/sp-bom";

type WorkTab = "health" | "info" | "price" | "recipe" | "use";

const STORAGE: { value: StorageCondition; label: string }[] = [
  { value: "Frozen", label: "ช่องแช่แข็ง" },
  { value: "Chilled", label: "ตู้เย็น" },
  { value: "Ambient", label: "ของแห้ง" },
];
export const storageLabel = (s: string) => STORAGE.find((x) => x.value === s)?.label ?? s;

const levelStyle: Record<ProductLevel, { icon: React.ElementType; text: string; bg: string; label: string }> = {
  ok: { icon: CheckCircle2, text: "text-success", bg: "bg-success-soft", label: "ครบ" },
  warn: { icon: AlertTriangle, text: "text-warning", bg: "bg-warning-soft", label: "ควรดู" },
  error: { icon: XCircle, text: "text-destructive", bg: "bg-destructive-soft", label: "ต้องแก้" },
  idle: { icon: CircleDashed, text: "text-muted-foreground", bg: "bg-secondary", label: "ไม่ได้ใช้" },
};

export interface ProductActions {
  updateSku: (id: string, data: Partial<Omit<SKU, "id" | "skuId">>) => Promise<boolean>;
  addPrice: (data: Omit<Price, "id" | "pricePerUsageUom">, sku: SKU | undefined) => Promise<boolean>;
  updatePrice: (id: string, data: Omit<Price, "id" | "pricePerUsageUom">, sku: SKU | undefined) => Promise<boolean>;
  repriceUnits: (sku: SKU) => Promise<boolean>;
  recost: (...skuIds: string[]) => Promise<void>;
}

interface Props {
  summary: ProductSummary;
  skus: SKU[];
  prices: Price[];
  suppliers: Supplier[];
  menus: Menu[];
  categories: SkuCategory[];
  book: RecipeBook;
  /** True cost of every recipe-made item today (allRecipeCosts) */
  recipeCosts: Map<string, number>;
  /** The recipe rows themselves (with ids), for editing */
  recipeRows: { headers: BOMHeader[]; lines: BOMLine[]; spLines: SpBomLine[] };
  recipeActions: RecipeEditActions;
  canEdit: boolean;
  actions: ProductActions;
  onBack: () => void;
  onOpenProduct: (skuId: string) => void;
  onOpenMenu: (menu: Menu) => void;
  onOpenSupplier: (supplierId: string) => void;
  onNavigate: (tab: TabKey) => void;
}

/** One product's workspace in Cost Center: where it sits, its checklist, data, price or recipe, and where it's used */
export function ProductWorkspace(props: Props) {
  const { summary, onBack } = props;
  const { sku } = summary;
  const made = sku.type === "SM" || sku.type === "SP";
  const problems = summary.checks.filter((c) => c.level === "error" || c.level === "warn").length;
  const [tab, setTab] = useState<WorkTab>(problems ? "health" : made ? "recipe" : "price");
  const usedCount = summary.usage.inSm.length + summary.usage.inSp.length + summary.usage.inMenus.length + summary.usage.inRules;
  const supplierName = (id: string) => (id === BOM_SUPPLIER_ID ? "คิดจากสูตร" : props.suppliers.find((s) => s.id === id)?.name ?? "—");
  const pack = sku.packUnit || sku.purchaseUom;
  const lastBill = summary.bills.find((b) => b.unitPrice > 0);

  const tabs: { key: WorkTab; label: string }[] = [
    { key: "health", label: problems ? `เช็คการตั้งค่า · ${problems}` : "เช็คการตั้งค่า" },
    { key: "info", label: "ข้อมูล" },
    made ? { key: "recipe", label: `สูตร · ${summary.madeFrom.length}` } : { key: "price", label: "ราคา" },
    { key: "use", label: `ใช้ที่ไหน · ${usedCount}` },
  ];

  const name = (id: string) => props.skus.find((s) => s.id === id)?.name ?? "—";
  const nodes: ChainNode[] = [];
  if (made) {
    nodes.push({ kind: "RM", title: `${summary.madeFrom.length} วัตถุดิบ`, sub: summary.madeFrom.slice(0, 1).map(name).join("") + (summary.madeFrom.length > 1 ? ` · +${summary.madeFrom.length - 1}` : ""), onOpen: () => setTab("recipe") });
  } else if (summary.standard) {
    nodes.push({ kind: "supplier", title: supplierName(summary.standard.supplierId), sub: `มาตรฐาน ${baht(summary.standard.pricePerPurchaseUom)}/${pack}`, onOpen: () => props.onOpenSupplier(summary.standard!.supplierId) });
  } else {
    nodes.push({ kind: "supplier", title: "ยังไม่มีราคา", sub: "ใส่ราคามาตรฐาน", onOpen: () => setTab("price") });
  }
  nodes.push({ kind: sku.type, title: sku.name, sub: "กำลังดูอยู่", current: true });
  if (summary.usage.inSm.length) nodes.push({ kind: "SM", title: `${summary.usage.inSm.length} สูตรครัว`, sub: name(summary.usage.inSm[0]) + (summary.usage.inSm.length > 1 ? ` · +${summary.usage.inSm.length - 1}` : ""), onOpen: () => setTab("use") });
  if (summary.usage.inSp.length) nodes.push({ kind: "SP", title: `${summary.usage.inSp.length} สูตรหน้าร้าน`, sub: name(summary.usage.inSp[0]), onOpen: () => setTab("use") });
  const menuName = (id: string) => props.menus.find((m) => m.id === id)?.menuName ?? "—";
  nodes.push(
    summary.usage.inMenus.length
      ? { kind: "menu", title: `${summary.usage.inMenus.length} เมนู`, sub: menuName(summary.usage.inMenus[0]) + (summary.usage.inMenus.length > 1 ? ` · +${summary.usage.inMenus.length - 1}` : ""), onOpen: () => setTab("use") }
      : { kind: "menu", title: "ไม่อยู่ในเมนูโดยตรง", sub: summary.usage.inSm.length || summary.usage.inSp.length ? "ผ่านสูตรทางซ้าย" : undefined },
  );

  return (
    <div className="flex flex-col gap-4">
      <section className="relative overflow-hidden rounded-2xl bg-primary p-5 text-primary-foreground shadow-raised md:p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-end">
          <div className="min-w-0 flex-1">
            <button type="button" onClick={onBack} className="-ml-2 mb-2 inline-flex min-h-[40px] items-center gap-1 rounded-full px-2 text-sm text-primary-foreground/70 hover:text-primary-foreground lg:hidden">
              <ArrowLeft className="h-4 w-4" /> กลับ
            </button>
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-primary-foreground/60">
              {sku.skuId} · {KIND_NAME[sku.type]} · {props.categories.find((c) => c.code === sku.category)?.nameTh || sku.category} · {storageLabel(sku.storageCondition)}
            </div>
            <h3 className="mt-1 text-2xl font-bold leading-tight md:text-3xl">{sku.name}</h3>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium", levelStyle[summary.level].bg, levelStyle[summary.level].text)}>
                {(() => {
                  const Icon = levelStyle[summary.level].icon;
                  return <Icon className="h-4 w-4" aria-hidden="true" />;
                })()}
                {summary.level === "ok" ? "ตั้งครบแล้ว" : summary.level === "idle" ? "ไม่ได้ใช้" : `${levelStyle[summary.level].label} ${problems} เรื่อง`}
              </span>
              {sku.status !== "Active" && <span className="rounded-full bg-white/10 px-3 py-1 text-sm">{sku.status === "Draft" ? "ร่าง" : "ปิดใช้"}</span>}
            </div>
          </div>
          <div className="flex flex-wrap gap-6 md:text-right">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-primary-foreground/60">{made ? "ต้นทุน" : "ราคามาตรฐาน"}</div>
              <div className="mt-1 font-mono text-2xl font-bold tabular-nums">{packPriceLabel(summary) || "—"}</div>
            </div>
            {!made && lastBill && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-primary-foreground/60">บิลล่าสุด</div>
                <div className={cn("mt-1 font-mono text-2xl font-bold tabular-nums", summary.billRatio && Math.abs(summary.billRatio - 1) > 0.1 && "text-highlight")}>
                  {baht(lastBill.unitPrice * (sku.packSize || 1))}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <Chain nodes={nodes} />

      <div data-tour="cc-tabs">
        <SegmentedTabs<WorkTab> tabs={tabs} value={tab} onChange={setTab} />
      </div>

      {tab === "health" && (
        <HealthPanel
          checks={summary.checks}
          onGo={setTab}
          onRecost={() => props.actions.recost(sku.id)}
          // A draft goes live once nothing else is wrong
          onActivate={summary.checks.some((c) => c.level === "error" || c.id === "no-price") ? undefined : () => props.actions.updateSku(sku.id, { status: "Active" })}
          canEdit={props.canEdit}
          made={made}
        />
      )}
      {tab === "info" && <InfoPanel key={sku.id} {...props} />}
      {tab === "price" && <PricePanel key={sku.id} {...props} supplierName={supplierName} />}
      {tab === "recipe" && <RecipePanel {...props} />}
      {tab === "use" && <UsePanel {...props} />}
    </div>
  );
}

// ───────────────────────── Check ─────────────────────────

function HealthPanel({ checks, onGo, onRecost, onActivate, canEdit, made }: { checks: ProductCheck[]; onGo: (t: WorkTab) => void; onRecost: () => void; onActivate?: () => void; canEdit: boolean; made: boolean }) {
  const order: Record<ProductLevel, number> = { error: 0, warn: 1, idle: 2, ok: 3 };
  const sorted = [...checks].sort((a, b) => order[a.level] - order[b.level]);
  const areaTab: Record<ProductArea, WorkTab> = { info: "info", price: made ? "recipe" : "price", recipe: "recipe", use: "use" };
  const areaLabel: Record<ProductArea, string> = { info: "ข้อมูล", price: "ราคา", recipe: "สูตร", use: "ใช้ที่ไหน" };
  if (!sorted.length)
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-card">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-success-soft">
          <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />
        </span>
        <span className="text-[15px] font-medium">ตั้งครบแล้ว ไม่มีเรื่องต้องแก้</span>
      </div>
    );
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
            {c.id === "draft" && canEdit ? (
              onActivate ? (
                <Button variant="brand" size="sm" className="h-9 shrink-0" onClick={onActivate}>
                  เปิดใช้
                </Button>
              ) : (
                <span className="shrink-0 self-center text-sm text-muted-foreground">ใส่ราคา/สูตรให้ครบก่อน</span>
              )
            ) : c.id === "stale-cost" && canEdit ? (
              <Button variant="outline" size="sm" className="h-9 shrink-0" onClick={onRecost}>
                คิดใหม่
              </Button>
            ) : (
              <Button variant="outline" size="sm" className="h-9 shrink-0" onClick={() => onGo(areaTab[c.area])}>
                ไป{areaLabel[c.area]}
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ───────────────────────── Info ─────────────────────────

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="grid grid-cols-1 items-center gap-1.5 border-t border-border py-2.5 first:border-t-0 sm:grid-cols-[1fr_minmax(0,240px)] sm:gap-3">
      <span className="text-[15px]">
        {label}
        {hint && <span className="block text-sm text-muted-foreground">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

const enterNext = (e: React.KeyboardEvent<HTMLElement>) => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  const all = [...document.querySelectorAll<HTMLElement>("[data-cc-field]")];
  all[all.indexOf(e.currentTarget) + 1]?.focus();
};

function InfoPanel({ summary, skus, prices, categories, canEdit, actions }: Props) {
  const { sku } = summary;
  const [form, setForm] = useState(sku);
  const [saving, setSaving] = useState(false);
  const [confirmUnit, setConfirmUnit] = useState<string | null>(null);
  useEffect(() => setForm(sku), [sku]);
  const set = <K extends keyof SKU>(k: K, v: SKU[K]) => setForm((f) => ({ ...f, [k]: v }));
  const keys: (keyof SKU)[] = ["name", "category", "storageCondition", "shelfLife", "leadTime", "isDistributable", "status", "purchaseUom", "packUnit", "packSize", "usageUom", "converter", "vat", "specNote"];
  const changed = keys.filter((k) => form[k] !== sku[k]);
  const used = summary.usage.inSm.length + summary.usage.inSp.length + summary.usage.inMenus.length + summary.usage.inRules;
  const unitChanged = form.packSize !== sku.packSize || form.converter !== sku.converter;
  const usagePerPack = (form.packSize || 0) * (form.converter || 1);
  const offStill = form.status === "Inactive" && sku.status !== "Inactive" && used > 0;
  const invalid = !form.name.trim() || !(form.packSize > 0) || !(form.converter > 0) || offStill;

  const save = async () => {
    if (invalid) return;
    // Units changed on an item already in recipes: its recipe quantities stay, its price
    // per usage unit moves, so every recipe and menu on it changes cost — ask first
    // ...and does the price per usage unit still look like this kind of item? Both
    // warnings go in one question.
    if (unitChanged && !confirmUnit) {
      const notes: string[] = [];
      if (used > 0) notes.push(`ตัวนี้อยู่ใน ${used} สูตร/เมนู · ปริมาณในสูตรไม่เปลี่ยน แต่ราคาต่อ ${form.usageUom} จะเปลี่ยน ต้นทุนสูตรและเมนูที่ใช้จะเปลี่ยนตาม`);
      if (summary.standard) {
        const next = summary.standard.pricePerPurchaseUom / form.packSize / form.converter;
        const off = unitLooksOff(next, form.category, skus, prices, form.usageUom);
        if (off) notes.push(`ราคาจะเป็น ${perUnit(next, form.usageUom)} · ต่างจากของส่วนใหญ่ ${off.ratio > 1 ? Math.round(off.ratio) : `1/${Math.round(1 / off.ratio)}`} เท่า (ส่วนใหญ่ราวๆ ${perUnit(off.median, form.usageUom)})`);
      }
      if (notes.length) {
        setConfirmUnit(`${notes.join("\n\n")}\n\n1 ${form.packUnit || form.purchaseUom} = ${usagePerPack.toLocaleString()} ${form.usageUom} ถูกแล้วใช่ไหม?`);
        return;
      }
    }
    setConfirmUnit(null);
    setSaving(true);
    const patch = Object.fromEntries(changed.map((k) => [k, form[k]])) as Partial<SKU>;
    const ok = await actions.updateSku(sku.id, patch);
    if (ok && unitChanged) await actions.repriceUnits({ ...sku, ...patch });
    setSaving(false);
  };

  const field = "h-11 w-full rounded-xl border border-input bg-background px-3 text-[16px]";
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <section className="rounded-2xl border border-border bg-card px-4 py-2 shadow-card">
          <h4 className="py-2 font-semibold">ข้อมูลหลัก</h4>
          <Row label="ชื่อ">
            <Input data-cc-field disabled={!canEdit} value={form.name} onChange={(e) => set("name", e.target.value)} onKeyDown={enterNext} className="h-11 text-[16px]" />
          </Row>
          <Row label="ประเภท" hint="เปลี่ยนไม่ได้ เพราะสูตร บิล และสต๊อกอ้างถึงแล้ว">
            <span className="flex h-11 items-center gap-2 rounded-xl bg-secondary px-3 text-[15px]">
              <KindBadge kind={sku.type} /> {KIND_NAME[sku.type]}
            </span>
          </Row>
          <Row label="หมวด">
            <select data-cc-field disabled={!canEdit} value={form.category} onChange={(e) => set("category", e.target.value)} onKeyDown={enterNext} className={field}>
              {categories.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} {c.nameTh || c.nameEn}
                </option>
              ))}
            </select>
          </Row>
          <Row label="ช่องเก็บ">
            <select data-cc-field disabled={!canEdit} value={form.storageCondition} onChange={(e) => set("storageCondition", e.target.value as StorageCondition)} onKeyDown={enterNext} className={field}>
              {STORAGE.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </Row>
          <Row label="อายุ (วัน) · สั่งล่วงหน้า (วัน)">
            <span className="flex gap-2">
              <Input data-cc-field type="number" inputMode="numeric" min={0} disabled={!canEdit} value={form.shelfLife} onChange={(e) => set("shelfLife", Number(e.target.value) || 0)} onKeyDown={enterNext} className="h-11 text-right font-mono text-[16px]" aria-label="อายุ (วัน)" />
              <Input data-cc-field type="number" inputMode="numeric" min={0} disabled={!canEdit} value={form.leadTime} onChange={(e) => set("leadTime", Number(e.target.value) || 0)} onKeyDown={enterNext} className="h-11 text-right font-mono text-[16px]" aria-label="สั่งล่วงหน้า (วัน)" />
            </span>
          </Row>
          {(sku.type === "RM" || sku.type === "PK") && (
            <Row label="ส่งให้สาขาได้" hint="ขึ้นในใบขอเบิกของสาขา">
              <Switch disabled={!canEdit} checked={form.isDistributable} onCheckedChange={(v) => set("isDistributable", v)} />
            </Row>
          )}
          <Row label="สถานะ" hint={offStill ? `ยังอยู่ใน ${used} สูตร/เมนู · เอาออกก่อนถึงปิดได้` : undefined}>
            <select data-cc-field disabled={!canEdit} value={form.status} onChange={(e) => set("status", e.target.value as SKU["status"])} onKeyDown={enterNext} className={cn(field, offStill && "border-destructive")}>
              {sku.status === "Draft" ? <option value="Draft">ร่าง · เปิดใช้จากแท็บเช็คการตั้งค่า</option> : <option value="Active">เปิดใช้</option>}
              <option value="Inactive">ปิดใช้</option>
            </select>
          </Row>
        </section>

        <section className="rounded-2xl border border-border bg-card px-4 py-2 shadow-card">
          <h4 className="py-2 font-semibold">หน่วย</h4>
          <Row label="หน่วยที่ซื้อ" hint="เช่น แพ็ค ถุง ขวด">
            <Input data-cc-field disabled={!canEdit} value={form.packUnit} onChange={(e) => set("packUnit", e.target.value)} onKeyDown={enterNext} className="h-11 text-[16px]" />
          </Row>
          <Row label={`1 ${form.packUnit || "หน่วยที่ซื้อ"} มีกี่ ${form.purchaseUom || "หน่วย"}`}>
            <Input data-cc-field type="number" inputMode="decimal" min={0} disabled={!canEdit} value={form.packSize} onChange={(e) => set("packSize", Number(e.target.value) || 0)} onKeyDown={enterNext} className="h-11 text-right font-mono text-[16px]" />
          </Row>
          <Row label="หน่วยในบิล">
            <Input data-cc-field disabled={!canEdit} value={form.purchaseUom} onChange={(e) => set("purchaseUom", e.target.value)} onKeyDown={enterNext} className="h-11 text-[16px]" />
          </Row>
          <Row label="หน่วยที่ใช้ในสูตร">
            <Input data-cc-field disabled={!canEdit} value={form.usageUom} onChange={(e) => set("usageUom", e.target.value)} onKeyDown={enterNext} className="h-11 text-[16px]" />
          </Row>
          <Row label="ตัวแปลง" hint={`1 ${form.purchaseUom || "หน่วยในบิล"} = กี่ ${form.usageUom || "หน่วยสูตร"} (ส่วนใหญ่คือ 1)`}>
            <Input data-cc-field type="number" inputMode="decimal" min={0} disabled={!canEdit} value={form.converter} onChange={(e) => set("converter", Number(e.target.value) || 0)} onKeyDown={enterNext} className="h-11 text-right font-mono text-[16px]" />
          </Row>
          <Row label="มี VAT">
            <Switch disabled={!canEdit} checked={form.vat} onCheckedChange={(v) => set("vat", v)} />
          </Row>
          <p className="my-2 rounded-xl bg-secondary px-3 py-2.5 text-[15px] leading-relaxed">
            อ่านแบบนี้: ซื้อ <b>1 {form.packUnit || form.purchaseUom}</b> ได้ใช้ <b className="font-mono">{usagePerPack.toLocaleString()} {form.usageUom}</b>
            {summary.standard && (
              <>
                <br />
                ราคา {baht(summary.standard.pricePerPurchaseUom)}/{form.packUnit || form.purchaseUom} = <b className="font-mono">{perUnit(usagePerPack > 0 ? summary.standard.pricePerPurchaseUom / usagePerPack : 0, form.usageUom)}</b> ในสูตร
              </>
            )}
          </p>
        </section>
      </div>
      <section className="rounded-2xl border border-border bg-card px-4 py-2 shadow-card">
        <Row label="หมายเหตุสเปก">
          <Input disabled={!canEdit} value={form.specNote} onChange={(e) => set("specNote", e.target.value)} className="h-11 text-[16px]" />
        </Row>
      </section>
      {canEdit && changed.length > 0 && invalid && (
        <p className="rounded-xl bg-destructive-soft px-3 py-2 text-sm text-destructive">
          {!form.name.trim() ? "ใส่ชื่อก่อนบันทึก" : !(form.packSize > 0) ? "จำนวนต่อหน่วยที่ซื้อต้องมากกว่า 0" : !(form.converter > 0) ? "ตัวแปลงต้องมากกว่า 0" : `ยังอยู่ใน ${used} สูตร/เมนู · เอาออกก่อนถึงปิดใช้ได้`}
        </p>
      )}
      {canEdit && <SaveBar pending={changed.length} saving={saving} onSave={save} onDiscard={() => setForm(sku)} />}
      <ConfirmDialog
        open={!!confirmUnit}
        onOpenChange={(o) => !o && setConfirmUnit(null)}
        title="เช็คหน่วยก่อนบันทึก"
        description={confirmUnit ?? ""}
        confirmLabel="ถูกแล้ว บันทึก"
        cancelLabel="กลับไปแก้"
        variant="default"
        onConfirm={save}
      />
    </div>
  );
}

// ───────────────────────── Price (RM / PK) ─────────────────────────

function PricePanel({ summary, prices, suppliers, skus, canEdit, actions, supplierName, onOpenSupplier }: Props & { supplierName: (id: string) => string }) {
  const { sku } = summary;
  const pack = sku.packUnit || sku.purchaseUom;
  const usagePerPack = (sku.packSize || 1) * (sku.converter || 1);
  // Kitchen bills are priced per purchase unit (qty = packs × pack size, no converter)
  const billPerPack = (unitPrice: number) => unitPrice * (sku.packSize || 1);
  const own = prices.filter((p) => p.skuId === sku.id);
  // Latest price per supplier (older ones are history)
  const bySupplier = useMemo(() => {
    const m = new Map<string, Price>();
    for (const p of own) {
      const cur = m.get(p.supplierId);
      if (!cur || (p.isActive && !cur.isActive) || (p.isActive === cur.isActive && p.effectiveDate > cur.effectiveDate)) m.set(p.supplierId, p);
    }
    return [...m.values()].sort((a, b) => Number(b.isActive) - Number(a.isActive));
  }, [own]);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [amount, setAmount] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  const recent = summary.bills.filter((b) => b.unitPrice > 0).slice(0, 3);
  const lastBill = recent[0];
  const avg3 = recent.length ? recent.reduce((s, b) => s + b.unitPrice, 0) / recent.length : 0;
  // An average only makes sense as one supplier's price
  const oneSupplier = recent.every((b) => b.supplierId === recent[0]?.supplierId);
  const drift = summary.billRatio !== null && Math.abs(summary.billRatio - 1) > 0.1;

  const setStandardFromBill = async (unitPrice: number, supplier: string) => {
    setBusy(true);
    await actions.addPrice(
      { skuId: sku.id, supplierId: supplier, pricePerPurchaseUom: Math.round(billPerPack(unitPrice) * 100) / 100, vat: sku.vat, isActive: true, effectiveDate: toLocalDateStr(new Date()), note: "จากบิลรับของ" },
      sku,
    );
    setBusy(false);
  };
  // The standard is the price set most recently: setting this supplier's price again
  // (same amount, today) makes it the standard; its old row becomes history
  const setAsStandard = async (p: Price) => {
    setBusy(true);
    await actions.addPrice({ skuId: p.skuId, supplierId: p.supplierId, pricePerPurchaseUom: p.pricePerPurchaseUom, vat: p.vat, isActive: true, effectiveDate: toLocalDateStr(new Date()), note: p.note }, sku);
    setBusy(false);
  };

  const typed = Number(amount);
  const typedPerUnit = typed > 0 ? typed / usagePerPack : 0;
  const odd = typedPerUnit ? unitLooksOff(typedPerUnit, sku.category, skus, prices, sku.usageUom) : null;
  const addNew = async () => {
    if (!supplierId || !(typed > 0) || (odd && !confirmed)) return;
    setBusy(true);
    const ok = await actions.addPrice(
      { skuId: sku.id, supplierId, pricePerPurchaseUom: typed, vat: sku.vat, isActive: true, effectiveDate: toLocalDateStr(new Date()), note: "" },
      sku,
    );
    setBusy(false);
    if (ok) {
      setAdding(false);
      setAmount("");
      setSupplierId("");
      setConfirmed(false);
    }
  };
  const supplierOptions = suppliers.filter((s) => s.status === "Active").map((s) => ({ value: s.id, label: s.name }));

  return (
    <div className="flex flex-col gap-3">
      {drift && lastBill && canEdit && (
        <section className="flex flex-col gap-3 rounded-2xl border border-warning/40 bg-warning-soft p-4 md:flex-row md:items-center">
          <AlertTriangle className="h-5 w-5 shrink-0 text-warning" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <div className="font-semibold">
              บิลล่าสุด {supplierName(lastBill.supplierId)} {baht(billPerPack(lastBill.unitPrice))}/{pack} · ราคาที่ตั้งไว้ {baht((summary.active.find((p) => p.supplierId === lastBill.supplierId) ?? summary.standard)?.pricePerPurchaseUom ?? 0)}
            </div>
            <div className="text-sm text-muted-foreground">ใช้ราคาใหม่แล้ว ระบบคิดต้นทุนสูตรและเมนูที่ใช้ใหม่ให้ทันที</div>
          </div>
          <div className="flex flex-wrap gap-2">
            {recent.length > 1 && oneSupplier && (
              <Button variant="outline" className="h-11" disabled={busy} onClick={() => setStandardFromBill(avg3, lastBill.supplierId)}>
                เฉลี่ย {recent.length} บิล {baht(billPerPack(avg3))}
              </Button>
            )}
            <Button variant="brand" className="h-11" loading={busy} onClick={() => setStandardFromBill(lastBill.unitPrice, lastBill.supplierId)}>
              ใช้ {baht(billPerPack(lastBill.unitPrice))} เป็นมาตรฐาน
            </Button>
          </div>
        </section>
      )}

      <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div>
            <h4 className="font-semibold">ราคาจากซัพพลายเออร์</h4>
            <p className="text-sm text-muted-foreground">ต้นทุนคิดจากราคามาตรฐาน · บิลของแต่ละเจ้าเทียบกับราคาของเจ้านั้นเอง</p>
          </div>
          {canEdit && !adding && (
            <Button variant="outline" className="h-10" onClick={() => setAdding(true)}>
              + ราคาใหม่
            </Button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] table-fixed text-sm">
            <colgroup>
              <col style={{ width: "120px" }} />
              <col />
              <col style={{ width: "120px" }} />
              <col style={{ width: "110px" }} />
              <col style={{ width: "100px" }} />
            </colgroup>
            <thead className="text-muted-foreground">
              <tr className="border-t border-border">
                <th className="px-4 py-2 text-left font-medium">มาตรฐาน</th>
                <th className="px-2 py-2 text-left font-medium">เจ้า</th>
                <th className="px-2 py-2 text-right font-medium">ราคา/{pack}</th>
                <th className="px-2 py-2 text-right font-medium">ต่อ {sku.usageUom}</th>
                <th className="px-4 py-2 text-right font-medium">ตั้งเมื่อ</th>
              </tr>
            </thead>
            <tbody>
              {bySupplier.map((p) => (
                <tr key={p.id} className="border-t border-border">
                  <td className="px-4 py-2.5">
                    {p.id === summary.standard?.id ? (
                      <span className="font-semibold text-success">● มาตรฐาน</span>
                    ) : canEdit && p.isActive ? (
                      <Button variant="ghost" size="sm" className="h-9 px-2 text-brand" disabled={busy} onClick={() => setAsStandard(p)}>
                        ตั้งเป็นมาตรฐาน
                      </Button>
                    ) : (
                      <span className="text-muted-foreground">{p.isActive ? "ใช้กับบิลเจ้านี้" : "ราคาเก่า"}</span>
                    )}
                  </td>
                  <td className="truncate px-2 py-2.5">
                    <button type="button" className="hover:underline" onClick={() => onOpenSupplier(p.supplierId)}>
                      {supplierName(p.supplierId)}
                    </button>
                  </td>
                  <td className="px-2 py-2.5 text-right font-mono tabular-nums">{baht(p.pricePerPurchaseUom)}</td>
                  <td className="px-2 py-2.5 text-right font-mono tabular-nums">{perUnit(p.pricePerUsageUom, sku.usageUom).replace(`/${sku.usageUom}`, "")}</td>
                  <td className="px-4 py-2.5 text-right text-muted-foreground">{p.effectiveDate ? new Date(p.effectiveDate + "T00:00:00").toLocaleDateString("th-TH", { day: "numeric", month: "short" }) : ""}</td>
                </tr>
              ))}
              {bySupplier.length === 0 && (
                <tr className="border-t border-border">
                  <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                    ยังไม่มีราคา
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {adding && (
          <div className="flex flex-col gap-3 border-t border-border bg-secondary/40 px-4 py-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_160px]">
              <SearchableSelect value={supplierId} onValueChange={setSupplierId} options={supplierOptions} placeholder="เลือกซัพพลายเออร์…" triggerClassName="h-11" />
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                placeholder={`ราคา/${pack}`}
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setConfirmed(false);
                }}
                onKeyDown={(e) => e.key === "Enter" && addNew()}
                className="h-11 text-right font-mono text-[16px]"
                aria-label={`ราคาต่อ${pack}`}
              />
            </div>
            {typedPerUnit > 0 && (
              <p className={cn("rounded-xl px-3 py-2 text-[15px]", odd ? "border border-destructive/40 bg-destructive-soft" : "bg-card")}>
                = <b className="font-mono">{perUnit(typedPerUnit, sku.usageUom)}</b> ในสูตร
                {odd && (
                  <>
                    <br />
                    <b className="text-destructive">ต่างจากของส่วนใหญ่ {odd.ratio > 1 ? Math.round(odd.ratio) : `1/${Math.round(1 / odd.ratio)}`} เท่า</b> (ส่วนใหญ่ราวๆ {perUnit(odd.median, sku.usageUom)}) · 1 {pack} = {usagePerPack.toLocaleString()} {sku.usageUom} จริงไหม?
                    <label className="mt-2 flex min-h-[40px] items-center gap-2">
                      <input type="checkbox" className="h-5 w-5" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> ถูกแล้ว
                    </label>
                  </>
                )}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-muted-foreground">ราคาที่ตั้งล่าสุดเป็นราคามาตรฐาน</span>
              <div className="ml-auto flex gap-2">
                <Button variant="ghost" className="h-11" onClick={() => setAdding(false)}>
                  ยกเลิก
                </Button>
                <Button variant="brand" className="h-11" loading={busy} disabled={!supplierId || !(typed > 0) || (!!odd && !confirmed)} onClick={addNew}>
                  บันทึกราคา
                </Button>
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
        <h4 className="px-4 py-3 font-semibold">บิลรับของเข้าครัว · 90 วัน</h4>
        {summary.bills.length === 0 ? (
          <p className="border-t border-border px-4 py-6 text-center text-sm text-muted-foreground">ไม่ได้ซื้อใน 90 วัน</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] table-fixed text-sm">
              <colgroup>
                <col style={{ width: "90px" }} />
                <col />
                <col style={{ width: "110px" }} />
                <col style={{ width: "120px" }} />
                <col style={{ width: "100px" }} />
              </colgroup>
              <thead className="text-muted-foreground">
                <tr className="border-t border-border">
                  <th className="px-4 py-2 text-left font-medium">วันที่</th>
                  <th className="px-2 py-2 text-left font-medium">เจ้า</th>
                  <th className="px-2 py-2 text-right font-medium">จำนวน</th>
                  <th className="px-2 py-2 text-right font-medium">ในบิล/{pack}</th>
                  <th className="px-4 py-2 text-right font-medium">เทียบราคาเจ้านั้น</th>
                </tr>
              </thead>
              <tbody>
                {summary.bills.slice(0, 8).map((b, i) => {
                  const ref = (summary.active.find((p) => p.supplierId === b.supplierId) ?? summary.standard)?.pricePerPurchaseUom ?? 0;
                  const ratio = ref > 0 && b.unitPrice > 0 ? billPerPack(b.unitPrice) / ref : null;
                  return (
                    <tr key={i} className="border-t border-border">
                      <td className="px-4 py-2.5">{new Date(b.date + "T00:00:00").toLocaleDateString("th-TH", { day: "numeric", month: "short" })}</td>
                      <td className="truncate px-2 py-2.5">{supplierName(b.supplierId)}</td>
                      <td className="px-2 py-2.5 text-right font-mono tabular-nums">
                        {b.qty.toLocaleString()} {sku.purchaseUom}
                      </td>
                      <td className="px-2 py-2.5 text-right font-mono tabular-nums">{baht(billPerPack(b.unitPrice))}</td>
                      <td className={cn("px-4 py-2.5 text-right font-mono tabular-nums", ratio && Math.abs(ratio - 1) > 0.1 && "font-semibold text-warning")}>{ratio ? `×${ratio.toFixed(2)}` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

// ───────────────────────── Recipe (SM / SP) ─────────────────────────

function RecipePanel(props: Props) {
  const { summary, skus, prices, book, recipeCosts, canEdit, actions, onOpenProduct, onNavigate } = props;
  const { sku } = summary;
  // A recipe-made ingredient counts at its true cost (even if never saved); others at their standard price
  const priceOf = (id: string) => recipeCosts.get(id) ?? prices.find((p) => p.skuId === id && p.isActive)?.pricePerUsageUom ?? 0;
  const byId = new Map(skus.map((s) => [s.id, s]));
  const header = book.headers.find((h) => h.smSkuId === sku.id);
  const spLines = book.spLines.filter((l) => l.spSkuId === sku.id);
  const lines = header ? book.lines.filter((l) => l.bomHeaderId === header.id) : [];
  const result = header
    ? smCost(header, lines, book.steps.filter((s) => s.bomHeaderId === header.id), book.byproducts.filter((b) => b.bomHeaderId === header.id), priceOf)
    : spLines.length
      ? { ...spCost(spLines, priceOf), output: spLines[0].batchYieldQty }
      : null;
  // Same resolution the cost uses, so the rows add up to the total
  const rows = header
    ? resolveSm(header, lines, book.steps.filter((s) => s.bomHeaderId === header.id)).lines.map((r) => ({
        id: r.line.rmSkuId,
        qty: header.bomMode === "multistep" ? r.qty : r.line.qtyPerBatch,
        yieldPct: header.bomMode === "multistep" ? null : Math.round((r.line.yieldPercent ?? 1) * 1000) / 10,
        cost: r.qty * priceOf(r.line.rmSkuId),
      }))
    : spLines.map((l) => ({ id: l.ingredientSkuId, qty: l.qtyPerBatch, yieldPct: null as number | null, cost: l.qtyPerBatch * priceOf(l.ingredientSkuId) }));
  const stale = summary.checks.some((c) => c.id === "stale-cost");
  const editPage: TabKey = sku.type === "SM" ? "bom" : "sp-bom";
  const hasByproducts = !!header && book.byproducts.some((b) => b.bomHeaderId === header.id);

  // Simple SM recipes and SP recipes are edited right here. Multi-step recipes and
  // ones with by-products still open the BOM page (few of them, more to set).
  const editableHere = (sku.type === "SP" || !header || (header.bomMode !== "multistep" && !hasByproducts)) && !(summary.madeFrom.length && !header && !spLines.length);
  if (editableHere && (canEdit || header || spLines.length))
    return (
      <div className="flex flex-col gap-3">
        {stale && canEdit && (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-warning/40 bg-warning-soft px-4 py-3 text-sm">
            <span className="min-w-0 flex-1">{summary.checks.find((c) => c.id === "stale-cost")?.title}</span>
            <Button variant="outline" className="h-10" onClick={() => actions.recost(sku.id)}>
              คิดต้นทุนใหม่
            </Button>
          </div>
        )}
        <RecipeEditor
          sku={sku}
          skus={skus}
          header={props.recipeRows.headers.find((h) => h.smSkuId === sku.id) ?? null}
          lines={props.recipeRows.lines.filter((l) => l.bomHeaderId === header?.id)}
          spLines={props.recipeRows.spLines.filter((l) => l.spSkuId === sku.id)}
          priceOf={priceOf}
          canEdit={canEdit}
          actions={props.recipeActions}
          onChanged={() => actions.recost(sku.id)}
          onOpenProduct={onOpenProduct}
          dependents={new Set(affectedRecipes([sku.id], book))}
        />
      </div>
    );

  // A by-product: made by its parent's recipe
  const parentId = !header && !spLines.length ? summary.madeFrom[0] : undefined;
  if (parentId)
    return (
      <div className="flex flex-col items-start gap-3 rounded-2xl border border-border bg-card p-5 shadow-card">
        <p className="font-medium">ผลพลอยได้ · ได้จากการผลิต {byId.get(parentId)?.name}</p>
        <p className="text-sm text-muted-foreground">
          ต้นทุน {summary.recipeCost ? perUnit(summary.recipeCost, sku.usageUom) : "—"} · แบ่งจากต้นทุนสูตรต้นทางตามที่ตั้งไว้
        </p>
        <div className="flex gap-2">
          <Button variant="outline" className="h-10" onClick={() => onOpenProduct(parentId)}>
            เปิดสูตรต้นทาง
          </Button>
          {stale && canEdit && (
            <Button variant="outline" className="h-10" onClick={() => actions.recost(parentId)}>
              คิดต้นทุนใหม่
            </Button>
          )}
        </div>
      </div>
    );

  if (!result)
    return (
      <div className="flex flex-col items-start gap-3 rounded-2xl border border-dashed border-border bg-card p-6">
        <p className="font-medium">ยังไม่มีสูตร</p>
        <p className="text-sm text-muted-foreground">ผลิตแล้วจะไม่ตัดวัตถุดิบ และไม่มีต้นทุน</p>
        {canEdit && (
          <Button variant="brand" className="h-11" onClick={() => onNavigate(editPage)}>
            ทำสูตร
          </Button>
        )}
      </div>
    );

  return (
    <div className="flex flex-col gap-3">
      <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="text-sm">
            ผลิตรอบละ <b className="font-mono">{(result.output ?? 0).toLocaleString()} {sku.usageUom}</b>
            {header?.bomMode === "multistep" && <span className="text-muted-foreground"> · หลายขั้นตอน</span>}
          </div>
          <div className="flex gap-2">
            {stale && canEdit && (
              <Button variant="outline" className="h-10" onClick={() => actions.recost(sku.id)}>
                คิดต้นทุนใหม่
              </Button>
            )}
            {canEdit && (
              <Button variant="outline" className="h-10" onClick={() => onNavigate(editPage)}>
                {header?.bomMode === "multistep" ? "แก้สูตรหลายขั้นตอน" : hasByproducts ? "แก้สูตร + ผลพลอยได้" : "แก้สูตร"}
              </Button>
            )}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] table-fixed text-sm">
            <colgroup>
              <col />
              <col style={{ width: "110px" }} />
              <col style={{ width: "90px" }} />
              <col style={{ width: "90px" }} />
              <col style={{ width: "110px" }} />
            </colgroup>
            <thead className="text-muted-foreground">
              <tr className="border-t border-border">
                <th className="px-4 py-2 text-left font-medium">วัตถุดิบ</th>
                <th className="px-2 py-2 text-right font-medium">ใช้/รอบ</th>
                <th className="px-2 py-2 text-right font-medium">ใช้ได้จริง</th>
                <th className="px-2 py-2 text-right font-medium">฿/หน่วย</th>
                <th className="px-4 py-2 text-right font-medium">ต้นทุน</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const ing = byId.get(r.id);
                return (
                  <tr key={i} className="border-t border-border">
                    <td className="truncate px-4 py-2.5">
                      <button type="button" onClick={() => onOpenProduct(r.id)} className="flex min-w-0 items-center gap-2 text-left hover:underline">
                        {ing && <KindBadge kind={ing.type} />}
                        <span className="truncate">{ing?.name ?? "—"}</span>
                        {ing?.status === "Inactive" && <span className="shrink-0 text-destructive">· ปิดใช้แล้ว</span>}
                      </button>
                    </td>
                    <td className="px-2 py-2.5 text-right font-mono tabular-nums">
                      {r.qty.toLocaleString()} {ing?.usageUom}
                    </td>
                    <td className="px-2 py-2.5 text-right font-mono tabular-nums">{r.yieldPct === null ? "—" : `${r.yieldPct}%`}</td>
                    <td className={cn("px-2 py-2.5 text-right font-mono tabular-nums", !priceOf(r.id) && "font-semibold text-destructive")}>{priceOf(r.id) ? priceOf(r.id).toLocaleString("th-TH", { maximumFractionDigits: 3 }) : "ไม่มีราคา"}</td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums">{baht(r.cost)}</td>
                  </tr>
                );
              })}
              <tr className="border-t border-border bg-secondary/40 font-semibold">
                <td className="px-4 py-2.5">รวมต่อรอบ</td>
                <td colSpan={3} />
                <td className="px-4 py-2.5 text-right font-mono tabular-nums">{baht(result.batchCost)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      <p className="text-sm text-muted-foreground">
        ต้นทุน {perUnit(result.costPerUnit, sku.usageUom)} · {packPriceLabel(summary)} · คิดจากราคามาตรฐานของวัตถุดิบ แก้ราคาวัตถุดิบเมื่อไร ตัวนี้คิดใหม่ให้เอง
      </p>
    </div>
  );
}

// ───────────────────────── Where used ─────────────────────────

function UsePanel({ summary, skus, menus, onOpenProduct, onOpenMenu }: Props) {
  const byId = new Map(skus.map((s) => [s.id, s]));
  const groups: { title: string; items: { key: string; label: string; badge: "SM" | "SP" | "menu"; open: () => void }[] }[] = [
    { title: "สูตรของที่ครัวผลิต (SM)", items: summary.usage.inSm.map((id) => ({ key: id, label: `${byId.get(id)?.skuId ?? ""} ${byId.get(id)?.name ?? ""}`, badge: "SM" as const, open: () => onOpenProduct(id) })) },
    { title: "สูตรหน้าร้าน (SP)", items: summary.usage.inSp.map((id) => ({ key: id, label: `${byId.get(id)?.skuId ?? ""} ${byId.get(id)?.name ?? ""}`, badge: "SP" as const, open: () => onOpenProduct(id) })) },
    {
      title: "เมนูที่เปิดขาย",
      items: summary.usage.inMenus
        .map((id) => menus.find((m) => m.id === id))
        .filter((m): m is Menu => !!m)
        .map((m) => ({ key: m.id, label: `${m.menuCode} ${m.menuName}`, badge: "menu" as const, open: () => onOpenMenu(m) })),
    },
  ].filter((g) => g.items.length);
  if (!groups.length) return <p className="rounded-2xl border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">ไม่อยู่ในสูตรหรือเมนูไหน · ปิดใช้ได้</p>;
  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
      {groups.map((g) => (
        <section key={g.title} className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
          <h4 className="px-4 py-3 font-semibold">
            {g.title} · {g.items.length}
          </h4>
          <ul className="divide-y divide-border border-t border-border">
            {g.items.map((it) => (
              <li key={it.key}>
                <button type="button" onClick={it.open} className="flex min-h-[48px] w-full items-center gap-3 px-4 text-left hover:bg-secondary/60">
                  <KindBadge kind={it.badge} />
                  <span className="min-w-0 flex-1 truncate text-[15px]">{it.label}</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p className="text-sm text-muted-foreground xl:col-span-2">ปิดใช้ได้เมื่อไม่อยู่ในสูตรหรือเมนูไหนแล้ว · ลบไม่ได้ เพราะบิลและการนับสต๊อกเดิมยังอ้างถึง</p>
    </div>
  );
}
