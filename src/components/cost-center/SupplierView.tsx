import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronRight, Plus } from "lucide-react";
import type { SKU } from "@/types/sku";
import type { Price } from "@/types/price";
import type { Supplier } from "@/types/supplier";
import { EMPTY_SUPPLIER } from "@/types/supplier";
import type { Bill } from "@/lib/product-health";
import { SegmentedTabs } from "@/components/SegmentedTabs";
import { SaveBar } from "@/components/form/SaveBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { KindBadge, baht } from "./parts";

type Filter = "buying" | "idle" | "inactive";

interface Props {
  suppliers: Supplier[];
  skus: SKU[];
  prices: Price[];
  bills: Bill[] | null;
  selectedId: string | null;
  canEdit: boolean;
  onSelect: (id: string | null) => void;
  onOpenProduct: (skuId: string) => void;
  addSupplier: (data: Omit<Supplier, "id">) => Promise<Supplier | null>;
  onOpenBill: (supplierId: string, date: string) => void;
  updateSupplier: (id: string, data: Partial<Omit<Supplier, "id">>) => Promise<boolean>;
}

const shortDate = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("th-TH", { day: "numeric", month: "short" });

/** Suppliers: who we buy from (90 days of kitchen bills), their prices and their details */
export function SupplierView(props: Props) {
  const { suppliers, bills, prices, selectedId } = props;
  const stats = useMemo(() => {
    const m = new Map<string, { spend: number; days: Set<string>; last: string; items: Map<string, number> }>();
    for (const b of bills ?? []) {
      const s = m.get(b.supplierId) ?? { spend: 0, days: new Set<string>(), last: "", items: new Map<string, number>() };
      const total = b.unitPrice * b.qty;
      s.spend += total;
      s.days.add(b.date);
      if (b.date > s.last) s.last = b.date;
      s.items.set(b.skuId, (s.items.get(b.skuId) ?? 0) + total);
      m.set(b.supplierId, s);
    }
    return m;
  }, [bills]);
  const activePrices = (id: string) => prices.filter((p) => p.supplierId === id && p.isActive);
  const selected = suppliers.find((s) => s.id === selectedId) ?? null;
  const [creating, setCreating] = useState(false);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
      <div className={cn("min-w-0", (selected || creating) && "hidden lg:block")}>
        <SupplierList {...props} stats={stats} activeCount={(id) => activePrices(id).length} onNew={props.canEdit ? () => setCreating(true) : undefined} />
      </div>
      <div className={cn("min-w-0", !selected && !creating && "hidden lg:block")}>
        {creating ? (
          <NewSupplier
            onCancel={() => setCreating(false)}
            onCreate={async (name) => {
              const s = await props.addSupplier({ ...EMPTY_SUPPLIER, name });
              if (s) {
                setCreating(false);
                props.onSelect(s.id);
              }
            }}
            existing={suppliers}
          />
        ) : selected ? (
          <SupplierWorkspace key={selected.id} {...props} supplier={selected} stat={stats.get(selected.id)} active={activePrices(selected.id)} />
        ) : (
          <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-card p-8 text-center">
            <p className="font-medium">เลือกซัพพลายเออร์ทางซ้าย</p>
            <p className="text-sm text-muted-foreground">เรียงตามยอดซื้อ 90 วัน</p>
          </div>
        )}
      </div>
    </div>
  );
}

function SupplierList({
  suppliers,
  selectedId,
  onSelect,
  onNew,
  stats,
  activeCount,
}: Props & { stats: Map<string, { spend: number; last: string }>; activeCount: (id: string) => number; onNew?: () => void }) {
  const [filter, setFilter] = useState<Filter>("buying");
  const [query, setQuery] = useState("");
  const live = suppliers.filter((s) => s.status === "Active");
  const counts = { buying: live.filter((s) => stats.has(s.id)).length, idle: live.filter((s) => !stats.has(s.id)).length, inactive: suppliers.length - live.length };
  const shown = suppliers
    .filter((s) => (filter === "inactive" ? s.status !== "Active" : s.status === "Active" && (filter === "buying") === stats.has(s.id)))
    .filter((s) => s.name.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => (stats.get(b.id)?.spend ?? 0) - (stats.get(a.id)?.spend ?? 0) || a.name.localeCompare(b.name));
  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-card lg:sticky lg:top-20 lg:max-h-[calc(100dvh-7rem)]">
      <div className="flex flex-col gap-3 border-b border-border p-4">
        {onNew && (
          <Button variant="brand" className="h-11 w-full" onClick={onNew}>
            <Plus className="h-4 w-4" /> ซัพพลายเออร์ใหม่
          </Button>
        )}
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ค้นชื่อ…" className="h-11" aria-label="ค้นซัพพลายเออร์" />
        <SegmentedTabs<Filter>
          tabs={[
            { key: "buying", label: `ซื้อใน 90 วัน ${counts.buying}` },
            { key: "idle", label: `ไม่ได้ซื้อ ${counts.idle}` },
            { key: "inactive", label: `ปิดใช้ ${counts.inactive}` },
          ]}
          value={filter}
          onChange={setFilter}
          className="[&_[role=tab]]:min-h-[36px] [&_[role=tab]]:px-3"
        />
      </div>
      <ul className="flex-1 divide-y divide-border overflow-y-auto overscroll-contain">
        {shown.map((s) => {
          const st = stats.get(s.id);
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onSelect(s.id)}
                aria-current={selectedId === s.id ? "true" : undefined}
                className={cn("flex min-h-[60px] w-full items-center gap-3 px-4 py-3 text-left hover:bg-secondary/60", selectedId === s.id && "bg-secondary shadow-[inset_3px_0_0_hsl(var(--brand))]")}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-medium">{s.name}</div>
                  <div className="truncate text-sm text-muted-foreground">
                    {activeCount(s.id)} ราคา{st ? ` · ล่าสุด ${shortDate(st.last)}` : ""}
                  </div>
                </div>
                {st && <div className="shrink-0 font-mono text-sm tabular-nums">{baht(st.spend, 0)}</div>}
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground lg:hidden" aria-hidden="true" />
              </button>
            </li>
          );
        })}
        {shown.length === 0 && <li className="px-4 py-10 text-center text-sm text-muted-foreground">ไม่พบ</li>}
      </ul>
    </div>
  );
}

function NewSupplier({ onCancel, onCreate, existing }: { onCancel: () => void; onCreate: (name: string) => Promise<void>; existing: Supplier[] }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const dup = existing.find((s) => s.name.trim().toLowerCase() === name.trim().toLowerCase());
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-card">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onCancel} aria-label="กลับ" className="-ml-2 flex h-11 w-11 items-center justify-center rounded-xl hover:bg-secondary">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h3 className="text-xl font-bold">ซัพพลายเออร์ใหม่</h3>
      </div>
      <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="ชื่อ" className="h-11 text-[16px]" aria-label="ชื่อซัพพลายเออร์" />
      {dup && <p className="text-sm text-destructive">มีชื่อนี้อยู่แล้ว</p>}
      <Button
        variant="brand"
        className="h-11 self-start"
        loading={busy}
        disabled={!name.trim() || !!dup}
        onClick={async () => {
          setBusy(true);
          await onCreate(name.trim());
          setBusy(false);
        }}
      >
        สร้าง แล้วใส่รายละเอียดต่อ
      </Button>
    </section>
  );
}

function SupplierWorkspace({ supplier, stat, active, skus, bills, prices, canEdit, updateSupplier, onSelect, onOpenProduct, onOpenBill }: Props & { supplier: Supplier; stat?: { spend: number; days: Set<string>; items: Map<string, number> }; active: Price[] }) {
  const [form, setForm] = useState(supplier);
  const [saving, setSaving] = useState(false);
  useEffect(() => setForm(supplier), [supplier]);
  const keys: (keyof Supplier)[] = ["name", "leadTime", "moq", "moqUnit", "creditTerms", "contactPerson", "phone", "status"];
  const changed = keys.filter((k) => form[k] !== supplier[k]);
  const byId = new Map(skus.map((s) => [s.id, s]));
  const top = [...(stat?.items ?? new Map<string, number>())].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const row = "grid grid-cols-1 items-center gap-1.5 border-t border-border py-2.5 first:border-t-0 sm:grid-cols-[1fr_minmax(0,220px)] sm:gap-3";
  const set = <K extends keyof Supplier>(k: K, v: Supplier[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-2xl bg-primary p-5 text-primary-foreground shadow-raised md:p-6">
        <button type="button" onClick={() => onSelect(null)} className="-ml-2 mb-2 inline-flex min-h-[40px] items-center gap-1 rounded-full px-2 text-sm text-primary-foreground/70 hover:text-primary-foreground lg:hidden">
          <ArrowLeft className="h-4 w-4" /> ซัพพลายเออร์ทั้งหมด
        </button>
        <div className="flex flex-col gap-4 md:flex-row md:items-end">
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-primary-foreground/60">ซัพพลายเออร์ · {supplier.status === "Active" ? "เปิดใช้" : "ปิดใช้"}</div>
            <h3 className="mt-1 text-2xl font-bold md:text-3xl">{supplier.name}</h3>
          </div>
          <div className="flex flex-wrap gap-6 md:text-right">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-primary-foreground/60">ซื้อ 90 วัน</div>
              <div className="mt-1 font-mono text-2xl font-bold tabular-nums">{baht(stat?.spend ?? 0, 0)}</div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-primary-foreground/60">วันที่รับของ</div>
              <div className="mt-1 font-mono text-2xl font-bold tabular-nums">{stat?.days.size ?? 0}</div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-primary-foreground/60">ราคาที่ใช้อยู่</div>
              <div className="mt-1 font-mono text-2xl font-bold tabular-nums">{active.length}</div>
            </div>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <section className="rounded-2xl border border-border bg-card px-4 py-2 shadow-card">
          <h4 className="py-2 font-semibold">ข้อมูลติดต่อและเงื่อนไข</h4>
          <label className={row}>
            <span>ชื่อ</span>
            <Input disabled={!canEdit} value={form.name} onChange={(e) => set("name", e.target.value)} className="h-11 text-[16px]" />
          </label>
          <label className={row}>
            <span>สั่งล่วงหน้า (วัน)</span>
            <Input disabled={!canEdit} type="number" inputMode="numeric" min={0} value={form.leadTime} onChange={(e) => set("leadTime", Number(e.target.value) || 0)} className="h-11 text-right font-mono text-[16px]" />
          </label>
          <label className={row}>
            <span>สั่งขั้นต่ำ · หน่วย</span>
            <span className="flex gap-2">
              <Input disabled={!canEdit} type="number" inputMode="decimal" min={0} value={form.moq} onChange={(e) => set("moq", Number(e.target.value) || 0)} className="h-11 text-right font-mono text-[16px]" aria-label="สั่งขั้นต่ำ" />
              <Input disabled={!canEdit} value={form.moqUnit} onChange={(e) => set("moqUnit", e.target.value)} placeholder="บาท / กก." className="h-11 text-[16px]" aria-label="หน่วยขั้นต่ำ" />
            </span>
          </label>
          <label className={row}>
            <span>เครดิต</span>
            <Input disabled={!canEdit} value={form.creditTerms} onChange={(e) => set("creditTerms", e.target.value)} className="h-11 text-[16px]" />
          </label>
          <label className={row}>
            <span>ผู้ติดต่อ</span>
            <Input disabled={!canEdit} value={form.contactPerson} onChange={(e) => set("contactPerson", e.target.value)} className="h-11 text-[16px]" />
          </label>
          <label className={row}>
            <span>โทร</span>
            <Input disabled={!canEdit} type="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} className="h-11 text-[16px]" />
          </label>
          <label className={row}>
            <span>สถานะ</span>
            <select disabled={!canEdit} value={form.status} onChange={(e) => set("status", e.target.value as Supplier["status"])} className="h-11 rounded-xl border border-input bg-background px-3 text-[16px]">
              <option value="Active">เปิดใช้</option>
              <option value="Inactive">ปิดใช้ (ไม่ขึ้นตอนรับของ)</option>
            </select>
          </label>
        </section>

        <div className="flex flex-col gap-3">
          <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
            <h4 className="px-4 py-3 font-semibold">บิลล่าสุด · กดเพื่ออัปเดตราคาทั้งบิล</h4>
            {(() => {
              const days = new Map<string, { n: number; off: number }>();
              for (const b of bills ?? []) {
                if (b.supplierId !== supplier.id || !(b.unitPrice > 0)) continue;
                const d = days.get(b.date) ?? { n: 0, off: 0 };
                d.n++;
                const sku = skus.find((s) => s.id === b.skuId);
                const ref = (prices.find((p) => p.skuId === b.skuId && p.supplierId === supplier.id && p.isActive) ?? prices.find((p) => p.skuId === b.skuId && p.isActive))?.pricePerPurchaseUom ?? 0;
                if (ref > 0 && Math.abs((b.unitPrice * (sku?.packSize || 1)) / ref - 1) > 0.1) d.off++;
                days.set(b.date, d);
              }
              const list = [...days].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 6);
              if (!list.length) return <p className="border-t border-border px-4 py-6 text-center text-sm text-muted-foreground">ไม่มีบิลใน 90 วัน</p>;
              return (
                <ul className="divide-y divide-border border-t border-border">
                  {list.map(([date, d]) => (
                    <li key={date}>
                      <button type="button" onClick={() => onOpenBill(supplier.id, date)} className="flex min-h-[46px] w-full items-center gap-3 px-4 text-left hover:bg-secondary/60">
                        <span className="min-w-0 flex-1">{shortDate(date)} · {d.n} รายการ</span>
                        {d.off > 0 ? <span className="text-sm font-semibold text-warning">ราคาต่าง {d.off}</span> : <span className="text-sm text-muted-foreground">ตรงราคา</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              );
            })()}
          </section>
          <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
            <h4 className="px-4 py-3 font-semibold">ซื้อมากสุด 90 วัน</h4>
            {top.length === 0 ? (
              <p className="border-t border-border px-4 py-6 text-center text-sm text-muted-foreground">ไม่ได้ซื้อใน 90 วัน</p>
            ) : (
              <ul className="divide-y divide-border border-t border-border">
                {top.map(([id, spend]) => (
                  <li key={id}>
                    <button type="button" onClick={() => onOpenProduct(id)} className="flex min-h-[46px] w-full items-center gap-3 px-4 text-left hover:bg-secondary/60">
                      {byId.get(id) && <KindBadge kind={byId.get(id)!.type} />}
                      <span className="min-w-0 flex-1 truncate">{byId.get(id)?.name ?? "—"}</span>
                      <span className="font-mono text-sm tabular-nums">{baht(spend, 0)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
            <h4 className="px-4 py-3 font-semibold">เป็นราคามาตรฐานของ · {active.length}</h4>
            <ul className="max-h-[320px] divide-y divide-border overflow-y-auto border-t border-border">
              {active.map((p) => {
                const s = byId.get(p.skuId);
                return (
                  <li key={p.id}>
                    <button type="button" onClick={() => onOpenProduct(p.skuId)} className="flex min-h-[46px] w-full items-center gap-3 px-4 text-left hover:bg-secondary/60">
                      {s && <KindBadge kind={s.type} />}
                      <span className="min-w-0 flex-1 truncate">{s?.name ?? "—"}</span>
                      <span className="font-mono text-sm tabular-nums">
                        {baht(p.pricePerPurchaseUom)}/{s?.packUnit || s?.purchaseUom}
                      </span>
                    </button>
                  </li>
                );
              })}
              {active.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted-foreground">ไม่มี</li>}
            </ul>
          </section>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">ปิดใช้ได้ทุกเมื่อ (ประวัติบิลไม่หาย) · ปิดแล้วไม่ขึ้นตอนรับของ</p>
      {canEdit && (
        <SaveBar
          pending={changed.length}
          saving={saving}
          onDiscard={() => setForm(supplier)}
          onSave={async () => {
            if (!form.name.trim()) return;
            setSaving(true);
            await updateSupplier(supplier.id, Object.fromEntries(changed.map((k) => [k, form[k]])) as Partial<Supplier>);
            setSaving(false);
          }}
        />
      )}
    </div>
  );
}
