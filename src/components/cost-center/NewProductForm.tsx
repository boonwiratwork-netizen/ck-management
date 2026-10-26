import { useMemo, useState } from "react";
import { ArrowLeft, Check } from "lucide-react";
import type { SKU, SKUType, StorageCondition } from "@/types/sku";
import type { Price } from "@/types/price";
import type { Supplier } from "@/types/supplier";
import type { SkuCategory } from "@/hooks/use-sku-categories";
import { unitLooksOff } from "@/lib/product-health";
import { SearchableSelect } from "@/components/SearchableSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn, toLocalDateStr } from "@/lib/utils";
import { KindBadge, KIND_NAME, perUnit } from "./parts";

const TYPES: SKUType[] = ["RM", "SM", "PK", "SP"];
const STORAGE: { value: StorageCondition; label: string }[] = [
  { value: "Frozen", label: "ช่องแช่แข็ง" },
  { value: "Chilled", label: "ตู้เย็น" },
  { value: "Ambient", label: "ของแห้ง" },
];
const USAGE = ["ก.", "มล.", "ชิ้น"];

/**
 * Existing products with a name like this one. Thai has no spaces between words, so
 * names match on any shared run of 5 letters ("ต้นหอมซอย" ~ "ต้นหอมไทย"), or when one
 * name is inside the other.
 */
export function similarNames(name: string, skus: SKU[]): SKU[] {
  const n = name.trim().toLowerCase().replace(/\s+/g, "");
  if (n.length < 3) return [];
  const chunks = new Set<string>();
  for (let i = 0; i + 5 <= n.length; i++) chunks.add(n.slice(i, i + 5));
  return skus
    .filter((s) => s.status !== "Inactive")
    .filter((s) => {
      const o = s.name.toLowerCase().replace(/\s+/g, "");
      return o.includes(n) || n.includes(o) || [...chunks].some((c) => o.includes(c));
    })
    .slice(0, 4);
}

interface Props {
  skus: SKU[];
  prices: Price[];
  suppliers: Supplier[];
  categories: SkuCategory[];
  addSku: (data: Omit<SKU, "id" | "skuId">) => Promise<SKU | null>;
  updateSku: (id: string, data: Partial<Omit<SKU, "id" | "skuId">>) => Promise<boolean>;
  addPrice: (data: Omit<Price, "id" | "pricePerUsageUom">, sku: SKU | undefined) => Promise<boolean>;
  onCreated: (sku: SKU) => void;
  onOpenExisting: (sku: SKU) => void;
  onCancel: () => void;
}

/**
 * A new product with a checklist on the side. RM/PK need a standard price to be
 * ready; SM/SP need a recipe, made right after. Not ready = saved as a draft that
 * daily pages don't show yet.
 */
export function NewProductForm({ skus, prices, suppliers, categories, addSku, updateSku, addPrice, onCreated, onOpenExisting, onCancel }: Props) {
  const [name, setName] = useState("");
  const [type, setType] = useState<SKUType>("RM");
  const [packUnit, setPackUnit] = useState("แพ็ค");
  const [packSize, setPackSize] = useState("");
  const [usageUom, setUsageUom] = useState("ก.");
  // Chosen on purpose, never pre-filled (a wrong default would pass the checklist)
  const [category, setCategory] = useState("");
  const [storage, setStorage] = useState<StorageCondition | "">("");
  const [distributable, setDistributable] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [amount, setAmount] = useState("");
  const [unitOk, setUnitOk] = useState(false);
  const [busy, setBusy] = useState(false);

  const made = type === "SM" || type === "SP";
  const similar = useMemo(() => similarNames(name, skus), [name, skus]);
  const size = Number(packSize);
  const price = Number(amount);
  const perUse = size > 0 && price > 0 ? price / size : 0;
  const odd = perUse ? unitLooksOff(perUse, category, skus, prices, usageUom) : null;

  const steps = [
    { done: name.trim().length > 1, label: "ชื่อไม่ซ้ำ", sub: similar.length ? `มีชื่อคล้าย ${similar.length} ตัว · ดูแล้ว` : "ไม่พบชื่อซ้ำ" },
    { done: size > 0 && !!usageUom, label: "หน่วยครบ", sub: size > 0 ? `1 ${packUnit || "หน่วย"} = ${size.toLocaleString()} ${usageUom}` : "ใส่ว่า 1 หน่วยที่ซื้อมีเท่าไร" },
    made
      ? { done: false, label: "สูตร", sub: "ทำต่อหลังสร้าง · ระหว่างนี้เป็นร่าง" }
      : { done: !!supplierId && price > 0 && (!odd || unitOk), label: "มีราคามาตรฐาน", sub: perUse ? `${perUnit(perUse, usageUom)} · ${suppliers.find((s) => s.id === supplierId)?.name ?? "เลือกเจ้า"}` : "ไม่มีราคา = เป็นร่างไปก่อน" },
    { done: !!category && !!storage, label: "หมวดและช่องเก็บ", sub: category && storage ? `${categories.find((c) => c.code === category)?.nameTh ?? category} · ${STORAGE.find((s) => s.value === storage)?.label}` : "เลือกด้านล่าง" },
  ];
  const ready = steps.every((s) => s.done);
  const canCreate = name.trim().length > 1 && size > 0 && !!category && !!storage && !(odd && !unitOk && price > 0);

  const create = async () => {
    if (!canCreate || busy) return;
    setBusy(true);
    const sku = await addSku({
      name: name.trim(),
      type,
      category,
      // Saved as a draft first; it goes live only once its price is saved too
      status: "Draft",
      specNote: "",
      packSize: size,
      packUnit,
      purchaseUom: usageUom,
      usageUom,
      converter: 1,
      storageCondition: storage as StorageCondition,
      shelfLife: 0,
      vat: false,
      supplier1: "",
      supplier2: "",
      leadTime: 0,
      isDistributable: !made && distributable,
    });
    let live = false;
    if (sku && !made && supplierId && price > 0) {
      const priced = await addPrice({ skuId: sku.id, supplierId, pricePerPurchaseUom: price, vat: false, isActive: true, effectiveDate: toLocalDateStr(new Date()), note: "" }, sku);
      if (priced && ready) live = await updateSku(sku.id, { status: "Active" });
    }
    setBusy(false);
    if (sku) onCreated(live ? { ...sku, status: "Active" } : sku);
  };

  const box = "rounded-2xl border border-border bg-card px-4 py-3 shadow-card";
  const row = "grid grid-cols-1 items-center gap-1.5 border-t border-border py-2.5 sm:grid-cols-[1fr_minmax(0,280px)] sm:gap-3";
  const enter = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const all = [...document.querySelectorAll<HTMLElement>("[data-np-field]")];
    all[all.indexOf(e.currentTarget) + 1]?.focus();
  };
  const seg = (on: boolean) => cn("min-h-[44px] flex-1 rounded-xl border px-2 text-sm", on ? "border-primary bg-primary font-semibold text-primary-foreground" : "border-border bg-card");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onCancel} aria-label="กลับ" className="-ml-2 flex h-11 w-11 items-center justify-center rounded-xl hover:bg-secondary">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h3 className="text-xl font-bold">สินค้าใหม่</h3>
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-3">
          <section className={box}>
            <h4 className="pb-2 font-semibold">1 · ชื่อและประเภท</h4>
            <label className={row}>
              <span>ชื่อ</span>
              <Input data-np-field autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={enter} className="h-11 text-[16px]" />
            </label>
            {similar.length > 0 && (
              <div className="mb-2 rounded-xl border border-warning/40 bg-warning-soft px-3 py-2.5 text-sm">
                มีชื่อคล้ายกันอยู่แล้ว — ใช่ตัวเดียวกันไหม?
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {similar.map((s) => (
                    <button key={s.id} type="button" onClick={() => onOpenExisting(s)} className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-border bg-card px-3 hover:bg-secondary">
                      <KindBadge kind={s.type} className="h-5" /> {s.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className={row}>
              <span>ประเภท</span>
              <div className="flex gap-1.5" role="radiogroup" aria-label="ประเภท">
                {TYPES.map((t) => (
                  <button key={t} type="button" role="radio" aria-checked={type === t} onClick={() => setType(t)} className={seg(type === t)}>
                    {t} {KIND_NAME[t]}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className={box}>
            <h4 className="pb-2 font-semibold">2 · หน่วย</h4>
            <label className={row}>
              <span>{made ? "เก็บเป็น" : "ซื้อเป็น"}</span>
              <Input data-np-field value={packUnit} onChange={(e) => setPackUnit(e.target.value)} onKeyDown={enter} placeholder="แพ็ค ถุง ขวด" className="h-11 text-[16px]" />
            </label>
            <div className={row}>
              <span>ใช้ในสูตรเป็น</span>
              <div className="flex gap-1.5">
                {USAGE.map((u) => (
                  <button key={u} type="button" onClick={() => setUsageUom(u)} className={seg(usageUom === u)}>
                    {u}
                  </button>
                ))}
              </div>
            </div>
            <label className={row}>
              <span>
                1 {packUnit || "หน่วย"} มีกี่ {usageUom}
              </span>
              <Input data-np-field type="number" inputMode="decimal" min={0} value={packSize} onChange={(e) => setPackSize(e.target.value)} onKeyDown={enter} className="h-11 text-right font-mono text-[16px]" />
            </label>
            {size > 0 && (
              <p className="mt-1 rounded-xl bg-secondary px-3 py-2.5 text-[15px]">
                อ่านแบบนี้: {made ? "เก็บ" : "ซื้อ"} <b>1 {packUnit}</b> ได้ <b className="font-mono">{size.toLocaleString()} {usageUom}</b>
              </p>
            )}
          </section>

          {!made && (
            <section className={box}>
              <h4 className="pb-2 font-semibold">3 · ราคามาตรฐาน</h4>
              <div className={row}>
                <span>ซัพพลายเออร์</span>
                <SearchableSelect value={supplierId} onValueChange={setSupplierId} options={suppliers.filter((s) => s.status === "Active").map((s) => ({ value: s.id, label: s.name }))} placeholder="เลือก…" triggerClassName="h-11" />
              </div>
              <label className={row}>
                <span>ราคา/{packUnit || "หน่วย"}</span>
                <Input
                  data-np-field
                  type="number"
                  inputMode="decimal"
                  min={0}
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    setUnitOk(false);
                  }}
                  onKeyDown={enter}
                  className="h-11 text-right font-mono text-[16px]"
                />
              </label>
              {perUse > 0 && (
                <div className={cn("mt-1 rounded-xl px-3 py-2.5 text-[15px]", odd ? "border-2 border-destructive/50 bg-destructive-soft" : "bg-secondary")}>
                  = <b className="font-mono">{perUnit(perUse, usageUom)}</b> ในสูตร
                  {odd && (
                    <>
                      <div className="mt-1 font-semibold text-destructive">
                        {odd.ratio > 1 ? `แพงกว่าของส่วนใหญ่ ${Math.round(odd.ratio)} เท่า` : `ถูกกว่าของส่วนใหญ่ ${Math.round(1 / odd.ratio)} เท่า`}
                      </div>
                      <div>
                        ส่วนใหญ่ราวๆ {perUnit(odd.median, usageUom)} · 1 {packUnit} มีแค่ {size.toLocaleString()} {usageUom} จริงไหม?
                      </div>
                      <label className="mt-2 flex min-h-[40px] items-center gap-2">
                        <input type="checkbox" className="h-5 w-5" checked={unitOk} onChange={(e) => setUnitOk(e.target.checked)} /> ถูกแล้ว
                      </label>
                    </>
                  )}
                </div>
              )}
            </section>
          )}
        </div>

        <aside className="flex flex-col gap-3">
          <section className={box}>
            <h4 className="pb-1 font-semibold">ก่อนสร้าง เช็คให้ครบ</h4>
            {steps.map((s, i) => (
              <div key={i} className="flex items-start gap-3 border-t border-border py-2.5 first-of-type:border-t-0">
                <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold", s.done ? "bg-success-soft text-success" : "bg-secondary text-muted-foreground")}>{s.done ? <Check className="h-4 w-4" /> : i + 1}</span>
                <div className="min-w-0">
                  <div className="font-medium">{s.label}</div>
                  <div className="text-sm text-muted-foreground">{s.sub}</div>
                </div>
              </div>
            ))}
            <div className="grid grid-cols-2 gap-2 border-t border-border pt-3">
              <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="หมวด" className="h-11 rounded-xl border border-input bg-background px-2 text-[16px]">
                <option value="" disabled>
                  เลือกหมวด
                </option>
                {categories.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.nameTh || c.nameEn}
                  </option>
                ))}
              </select>
              <select value={storage} onChange={(e) => setStorage(e.target.value as StorageCondition)} aria-label="ช่องเก็บ" className="h-11 rounded-xl border border-input bg-background px-2 text-[16px]">
                <option value="" disabled>
                  เลือกช่องเก็บ
                </option>
                {STORAGE.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            {!made && (
              <label className="mt-3 flex min-h-[44px] items-center gap-2 text-[15px]">
                <input type="checkbox" className="h-5 w-5" checked={distributable} onChange={(e) => setDistributable(e.target.checked)} /> ส่งให้สาขาได้ (ขึ้นในใบขอเบิก)
              </label>
            )}
          </section>
          <Button variant="brand" className="h-12 text-base" loading={busy} disabled={!canCreate} onClick={create}>
            {ready ? "สร้างสินค้า" : "บันทึกเป็นร่าง"}
          </Button>
          <p className="text-sm text-muted-foreground">
            {ready ? "เลือกได้ในรับของเข้าครัวและในสูตรทันที" : "ร่าง = ยังไม่ขึ้นในรับของ ใบโอน ใบนับ และยังใส่ในสูตรไม่ได้ จนกว่าจะตั้งครบ"}
            {made && " · สร้างแล้วไปทำสูตรต่อ"}
          </p>
        </aside>
      </div>
    </div>
  );
}
