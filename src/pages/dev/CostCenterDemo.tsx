import { useEffect, useState } from "react";
import CostCenterPage from "@/pages/CostCenter";
import type { Menu } from "@/types/menu";
import type { MenuBomLine } from "@/types/menu-bom";
import type { ModifierRule } from "@/types/modifier-rule";
import type { SKU } from "@/types/sku";
import type { Price } from "@/types/price";
import type { Branch } from "@/types/branch";
import type { Supplier } from "@/types/supplier";
import type { SpBomLine } from "@/types/sp-bom";
import type { BOMHeader, BOMLine } from "@/types/bom";
import { EMPTY_SUPPLIER } from "@/types/supplier";
import { recost } from "@/lib/cost-engine";
import { BOM_SUPPLIER_ID } from "@/lib/bom-price-sync";

interface Fixture {
  menus: Menu[];
  lines: MenuBomLine[];
  rules: ModifierRule[];
  skus: SKU[];
  prices: Price[];
  branches: Branch[];
  spLines: SpBomLine[];
}

const CATS = [
  ["SF", "อาหารทะเล"], ["DG", "ของแห้ง"], ["PK", "แพ็คเกจจิ้ง"], ["MT", "เนื้อสัตว์"], ["SC", "ซอส"], ["VG", "ผัก"],
  ["PF", "โพรเซสฟู้ด"], ["BV", "เครื่องดื่ม"], ["DY", "นม/ผลิตภัณฑ์นม"], ["OL", "น้ำมัน"], ["FR", "ผลไม้"],
].map(([code, nameTh], i) => ({ id: `c${i}`, code, nameEn: code, nameTh }));
const SUP: Supplier[] = [
  { ...EMPTY_SUPPLIER, id: "s-fk", name: "Freshket (เฟรชเก็ต)", leadTime: 1, moq: 1500, creditTerms: "1 วัน", status: "Active" },
  { ...EMPTY_SUPPLIER, id: "s-mk", name: "Makro Pro (แมคโคร)", status: "Active" },
  { ...EMPTY_SUPPLIER, id: "s-kb", name: "Kobeya (โกเบย่า)", leadTime: 2, status: "Active" },
  { ...EMPTY_SUPPLIER, id: "s-pj", name: "พี่โจ (ทาเระ)", leadTime: 7, creditTerms: "30 วัน", status: "Active" },
];
// Real figures (live data, 25 Oct 2026): category / pack of the items the demo looks at
const CURATED: Record<string, Partial<SKU>> = {
  "RM-0027": { category: "VG", packSize: 1000, packUnit: "แพ็ค", storageCondition: "Chilled", isDistributable: true, leadTime: 1 },
  "RM-0165": { category: "VG", packSize: 1000, packUnit: "แพ็ค", storageCondition: "Chilled" },
  "RM-0198": { category: "VG", packSize: 2000, packUnit: "แพ็ค", storageCondition: "Chilled" },
  "RM-0199": { category: "VG", packSize: 1000, packUnit: "แพ็ค", storageCondition: "Ambient" },
  "RM-0047": { category: "DG", packSize: 1000, packUnit: "แพ็ค", storageCondition: "Ambient" },
  "RM-0048": { category: "DG", packSize: 1000, packUnit: "แพ็ค", storageCondition: "Ambient" },
  "RM-0195": { category: "MT", packSize: 5000, packUnit: "แพ็ค", storageCondition: "Frozen" },
  "RM-0196": { category: "MT", packSize: 500, packUnit: "แพ็ค", storageCondition: "Frozen" },
  "RM-0197": { category: "MT", packSize: 1000, packUnit: "แพ็ค", storageCondition: "Frozen" },
  "SM-0051": { category: "SC", packSize: 3000, packUnit: "แพ็ค", storageCondition: "Frozen", shelfLife: 30 },
};
const REAL_PRICE: Record<string, number> = { "RM-0047": 0.522, "RM-0165": 0.095, "RM-0195": 0.025, "RM-0048": 0.74, "RM-0198": 0.045, "RM-0196": 0.11, "RM-0199": 0.032, "RM-0197": 0.094, "RM-0027": 0.1 };

/** Dev-only harness: Cost Center on the local menu export + real figures for a few items. Saves stay in memory. */
export default function CostCenterDemo() {
  const [fx, setFx] = useState<Fixture | null>(null);
  const [skus, setSkus] = useState<SKU[]>([]);
  const [prices, setPrices] = useState<Price[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>(SUP);
  const [headers, setHeaders] = useState<BOMHeader[]>([]);
  const [bomLines, setBomLines] = useState<BOMLine[]>([]);

  useEffect(() => {
    fetch("/fixtures.local/menu-setup.json")
      .then((r) => r.json())
      .then((d: Fixture) => {
        setFx(d);
        const sk = d.skus.map((s) => ({ ...s, category: s.type === "PK" ? "PK" : "DG", packSize: 1000, packUnit: "แพ็ค", storageCondition: "Chilled" as const, ...(CURATED[s.skuId] ?? {}) }));
        const id = (code: string) => sk.find((s) => s.skuId === code)!.id;
        setSkus(sk);
        const pr: Price[] = d.prices
          .filter((p) => sk.some((s) => s.id === p.skuId))
          .filter((p) => !["RM-0202"].includes(sk.find((s) => s.id === p.skuId)!.skuId))
          .map((p) => {
            const s = sk.find((x) => x.id === p.skuId)!;
            const made = s.type === "SM" || s.type === "SP";
            const unit = REAL_PRICE[s.skuId] ?? p.pricePerUsageUom;
            return { ...p, supplierId: made ? BOM_SUPPLIER_ID : "s-fk", pricePerUsageUom: unit, pricePerPurchaseUom: made ? 0 : Math.round(unit * s.packSize * 100) / 100 };
          });
        // น้ำมันถั่วเหลือง: two suppliers active (one of the 6 live cases)
        pr.push({ id: "p-mk-oil", skuId: id("RM-0030"), supplierId: "s-mk", pricePerPurchaseUom: 271, pricePerUsageUom: 0.271, vat: false, isActive: true, effectiveDate: "2026-09-01", note: "" });
        setPrices(pr);
        const h: BOMHeader = { id: "h-0051", smSkuId: id("SM-0051"), productionType: "CK", bomMode: "simple", batchSize: 33000, yieldPercent: 1 };
        setHeaders([h]);
        setBomLines(
          [["RM-0047", 80, 1], ["RM-0165", 1000, 0.9], ["RM-0195", 30000, 1], ["RM-0048", 250, 1], ["RM-0198", 2000, 0.9], ["RM-0196", 6000, 1], ["RM-0199", 2000, 1], ["RM-0197", 4000, 1]].map(([c, q, y], i) => ({
            id: `bl${i}`,
            bomHeaderId: h.id,
            rmSkuId: id(c as string),
            qtyPerBatch: q as number,
            yieldPercent: y as number,
          })),
        );
      });
  }, []);

  if (!fx || !skus.length) return <div className="p-6 text-muted-foreground">กำลังโหลดข้อมูลตัวอย่าง…</div>;
  const wait = () => new Promise((r) => setTimeout(r, 300));
  const idOf = (code: string) => skus.find((s) => s.skuId === code)?.id ?? "";
  const bills = [
    ["2026-10-16", 0.22], ["2026-10-12", 0.22], ["2026-10-05", 0.23], ["2026-09-05", 0.115],
  ].map(([date, u]) => ({ skuId: idOf("RM-0027"), supplierId: "s-fk", date: date as string, unitPrice: u as number, stdUnitPrice: 0.1, qty: 1000 }));
  const recostIn = (ps: Price[], ids: string[]) => {
    const book = { headers, lines: bomLines, steps: [], byproducts: [], spLines: fx.spLines };
    const map = new Map<string, number>();
    for (const p of ps) if (p.isActive && !map.has(p.skuId)) map.set(p.skuId, p.pricePerUsageUom);
    const out = recost(ids, book, map);
    return ps.map((p) => (p.isActive && out.has(p.skuId) ? { ...p, pricePerUsageUom: out.get(p.skuId)! } : p));
  };
  const usage = (s: SKU | undefined, purchase: number) => (s ? purchase / (s.packSize || 1) / (s.converter || 1) : 0);

  return (
    <div className="min-h-screen bg-background px-4 py-4 md:p-6">
      <CostCenterPage
        menuSetup={{
          menus: fx.menus,
          updateMenu: async () => true,
          menuBom: { lines: fx.lines, loading: false, addLine: async () => true, updateLine: async () => true, deleteLine: async () => true } as never,
          rules: fx.rules,
          skus,
          prices,
          branches: fx.branches,
          readOnly: false,
          onNavigate: () => {},
          addRule: async () => null,
          addMenu: async () => null,
          getNextCode: () => "MN-999",
          spBomLines: fx.spLines,
          updateRule: async () => {},
          demoExtras: { overrides: {}, soldByCode: {}, bills: [], setBranchOpenMany: async () => true },
        }}
        skus={skus}
        prices={prices}
        suppliers={suppliers}
        menus={fx.menus}
        categories={CATS}
        bomHeaders={headers}
        bomLines={bomLines}
        bomSteps={[]}
        byproducts={[]}
        spLines={fx.spLines}
        menuLines={fx.lines.map((l) => ({ menuId: l.menuId, skuId: l.skuId }))}
        canEditProducts
        addSku={async (data) => {
          await wait();
          const s = { ...data, id: crypto.randomUUID(), skuId: `${data.type}-9${String(skus.length).padStart(3, "0")}` } as SKU;
          setSkus((p) => [s, ...p]);
          return s;
        }}
        productActions={{
          updateSku: async (id, patch) => (await wait(), setSkus((p) => p.map((s) => (s.id === id ? { ...s, ...patch } : s))), true),
          addPrice: async (data, sku) => {
            await wait();
            const row: Price = { ...data, id: crypto.randomUUID(), pricePerUsageUom: usage(sku, data.pricePerPurchaseUom) };
            setPrices((p) => recostIn([row, ...p.map((x) => (data.isActive && x.skuId === data.skuId ? { ...x, isActive: false } : x))], [data.skuId]));
            return true;
          },
          updatePrice: async (id, data, sku) => {
            await wait();
            setPrices((p) =>
              recostIn(
                p.map((x) => (x.id === id ? { ...x, ...data, pricePerUsageUom: usage(sku, data.pricePerPurchaseUom) } : data.isActive && x.skuId === data.skuId ? { ...x, isActive: false } : x)),
                [data.skuId],
              ),
            );
            return true;
          },
          repriceUnits: async () => true,
          recost: async (...ids) => setPrices((p) => recostIn(p, ids)),
        }}
        addSupplier={async (data) => {
          const s = { ...data, id: crypto.randomUUID() };
          setSuppliers((p) => [s, ...p]);
          return s;
        }}
        updateSupplier={async (id, patch) => (setSuppliers((p) => p.map((s) => (s.id === id ? { ...s, ...patch } : s))), true)}
        onNavigate={() => {}}
        demoBills={bills}
      />
    </div>
  );
}
