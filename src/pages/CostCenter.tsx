import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { HelpCircle, Layers } from "lucide-react";
import type { SKU } from "@/types/sku";
import type { Price } from "@/types/price";
import type { Supplier } from "@/types/supplier";
import type { Menu } from "@/types/menu";
import type { BOMHeader, BOMLine, BOMStep } from "@/types/bom";
import type { BomByproduct } from "@/types/byproduct";
import type { SkuCategory } from "@/hooks/use-sku-categories";
import type { TabKey } from "@/components/AppSidebar";
import MenuSetupPage from "@/pages/MenuSetup";
import { useKitchenBills } from "@/hooks/use-kitchen-bills";
import { allRecipeCosts, recipeItemIds, summarizeProduct, type Bill, type ProductSummary } from "@/lib/product-health";
import type { RecipeBook } from "@/lib/cost-engine";
import { SegmentedTabs } from "@/components/SegmentedTabs";
import { GuideTour, useGuide, type GuideStep } from "@/components/GuideTour";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ProductList, type ProductFilter } from "@/components/cost-center/ProductList";
import { ProductWorkspace, type ProductActions } from "@/components/cost-center/ProductWorkspace";
import { NewProductForm } from "@/components/cost-center/NewProductForm";
import { SupplierView } from "@/components/cost-center/SupplierView";
import { ProductOverview } from "@/components/cost-center/ProductOverview";
import { KindBadge } from "@/components/cost-center/parts";
import { BillPriceUpdate } from "@/components/cost-center/BillPriceUpdate";
import type { RecipeEditActions } from "@/components/cost-center/RecipeEditor";
import type { SpBomLine } from "@/types/sp-bom";

type MenuSetupProps = React.ComponentProps<typeof MenuSetupPage>;

interface Props {
  /** Everything the menu side needs (the old Menu Setup page, unchanged inside) */
  menuSetup: Omit<MenuSetupProps, "header" | "overviewExtra" | "listHash">;
  skus: SKU[];
  prices: Price[];
  suppliers: Supplier[];
  menus: Menu[];
  categories: SkuCategory[];
  bomHeaders: BOMHeader[];
  bomLines: BOMLine[];
  bomSteps: BOMStep[];
  byproducts: BomByproduct[];
  spLines: SpBomLine[];
  recipeActions: RecipeEditActions;
  menuLines: { menuId: string; skuId: string }[];
  /** Management or CK manager: products, prices and suppliers */
  canEditProducts: boolean;
  addSku: (data: Omit<SKU, "id" | "skuId">) => Promise<SKU | null>;
  productActions: ProductActions;
  addSupplier: (data: Omit<Supplier, "id">) => Promise<Supplier | null>;
  updateSupplier: (id: string, data: Partial<Omit<Supplier, "id">>) => Promise<boolean>;
  onNavigate: (tab: TabKey) => void;
  /** Whether this role can open a page (the old tools are linked only when it can) */
  canOpen: (tab: TabKey) => boolean;
  /** Dev harness only: kitchen bills instead of reading them */
  demoBills?: Bill[];
}

type View = "overview" | "menus" | "branches" | "pos" | "products" | "suppliers";
const VIEWS: { key: View; label: string }[] = [
  { key: "overview", label: "ภาพรวม" },
  { key: "menus", label: "เมนู" },
  { key: "branches", label: "สาขา" },
  { key: "pos", label: "ตัวเลือก POS" },
  { key: "products", label: "สินค้า" },
  { key: "suppliers", label: "ซัพพลายเออร์" },
];

const GUIDE: GuideStep[] = [
  { title: "Cost Center ที่เดียวครบ", body: "เมนู สินค้า ราคา สูตร ซัพพลายเออร์ เชื่อมกันหมด แก้ราคาวัตถุดิบตรงไหน ต้นทุนสูตรและเมนูคิดใหม่ให้เอง" },
  { target: "cc-views", title: "แท็บข้างบนพาไปทุกเรื่อง", body: "ภาพรวม = เรื่องที่ต้องแก้ทั้งระบบ · เมนู/สาขา/ตัวเลือก POS = ฝั่งเมนู · สินค้า/ซัพพลายเออร์ = ฝั่งของที่ซื้อและที่ครัวทำ" },
  { target: "cc-filter", title: "จุดสีบอกว่าต้องทำอะไร", body: "แดง = ต้องแก้ · เหลือง = ควรดู · เทา = ไม่ได้ใช้ แตะ “ต้องแก้” ดูเฉพาะที่ต้องทำ" },
  { target: "cc-list", title: "แตะสินค้าเพื่อเปิด", body: "ลองแตะตัวแรกในรายการ", until: "click" },
  { target: "cc-chain", title: "เส้นทางของสินค้า", body: "ซื้อจากใคร → ใช้ในสูตรไหน → เมนูไหน แตะกล่องไหนก็เปิดเรื่องนั้นต่อได้" },
  { target: "cc-tabs", title: "ทุกอย่างของสินค้าอยู่ในแท็บนี้", body: "เช็คการตั้งค่า · ข้อมูล · ราคา (หรือสูตร) · ใช้ที่ไหน แก้แล้วกดบันทึกที่แถบล่างจอ" },
];

/**
 * Cost Center: menus and everything behind them — products, prices, recipes,
 * suppliers — under one header and one row of tabs. The menu side is the Menu
 * Setup page; the product side lives here. The view is in the URL hash:
 * #overview · #menus · #branches · #pos · #<menu code> (menu side) ·
 * #products · #p/<code> · #new-product · #suppliers · #s/<id> (product side).
 */
export default function CostCenterPage(props: Props) {
  const { skus, prices, canEditProducts } = props;
  const location = useLocation();
  const navigate = useNavigate();
  const hash = (() => {
    try {
      return decodeURIComponent(location.hash.slice(1));
    } catch {
      return "";
    }
  })();
  const go = (h: string, opts?: { replace?: boolean; state?: unknown }) => navigate({ pathname: location.pathname, hash: h ? `#${h}` : "" }, { replace: opts?.replace, state: opts?.state });
  const guide = useGuide("cost-center-v1");

  // Opening Cost Center from the sidebar (no hash) lands on the overview
  useEffect(() => {
    if (!hash) go("overview", { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hash]);

  const productSide = hash === "products" || hash.startsWith("p/") || hash === "new-product";
  const supplierSide = hash === "suppliers" || hash.startsWith("s/") || hash.startsWith("bill/");
  const openBill = (supplierId: string, date: string) => go(`bill/${supplierId}/${date}`, { state: { from: hash } });
  const view: View = productSide ? "products" : supplierSide ? "suppliers" : hash === "overview" ? "overview" : hash === "pos" ? "pos" : hash === "branches" || hash.startsWith("branches/") ? "branches" : "menus";

  const loaded = useKitchenBills(!props.demoBills);
  const bills = props.demoBills ?? loaded.bills;
  const branchBought = props.demoBills ? new Set<string>() : loaded.branchBought;
  // Items an active modifier rule adds or swaps in count as used
  const ruleSkuIds = useMemo(() => {
    const set = new Set<string>();
    for (const r of props.menuSetup.rules) if (r.isActive) for (const id of [r.skuId, r.swapSkuId]) if (id) set.add(id);
    return set;
  }, [props.menuSetup.rules]);
  const book: RecipeBook = useMemo(
    () => ({
      headers: props.bomHeaders.map((h) => ({ id: h.id, smSkuId: h.smSkuId, bomMode: h.bomMode, batchSize: h.batchSize, yieldPercent: h.yieldPercent })),
      lines: props.bomLines.map((l) => ({ bomHeaderId: l.bomHeaderId, rmSkuId: l.rmSkuId, qtyPerBatch: l.qtyPerBatch, yieldPercent: l.yieldPercent, stepId: l.stepId ?? null, qtyType: l.qtyType ?? null, percentOfInput: l.percentOfInput ?? null })),
      steps: props.bomSteps.map((s) => ({ id: s.id, bomHeaderId: s.bomHeaderId, stepNumber: s.stepNumber, yieldPercent: s.yieldPercent })),
      byproducts: props.byproducts.map((b) => ({ bomHeaderId: b.bomHeaderId, skuId: b.skuId, outputQty: b.outputQty, costAllocationPct: b.costAllocationPct, tracksInventory: b.tracksInventory })),
      spLines: props.spLines.map((l) => ({ spSkuId: l.spSkuId, ingredientSkuId: l.ingredientSkuId, qtyPerBatch: l.qtyPerBatch, batchYieldQty: l.batchYieldQty })),
    }),
    [props.bomHeaders, props.bomLines, props.bomSteps, props.byproducts, props.spLines],
  );
  const recipeCosts = useMemo(() => allRecipeCosts(book, prices), [book, prices]);
  const summaries: ProductSummary[] = useMemo(() => {
    const ctx = {
      skus,
      prices,
      book,
      recipeCosts,
      menuLines: props.menuLines,
      activeMenuIds: new Set(props.menus.filter((m) => m.status === "Active").map((m) => m.id)),
      bills: bills ?? null,
      branchBought,
      ruleSkuIds,
    };
    return skus.map((s) => summarizeProduct(s, ctx));
  }, [skus, prices, book, recipeCosts, props.menuLines, props.menus, bills, branchBought, ruleSkuIds]);
  const stale = summaries.filter((s) => s.checks.some((c) => c.id === "stale-cost")).length;
  const [recosting, setRecosting] = useState(false);
  const recostAll = async () => {
    setRecosting(true);
    await props.productActions.recost(...recipeItemIds(book));
    setRecosting(false);
  };
  const counts = useMemo(() => {
    const live = summaries.filter((s) => s.sku.status !== "Inactive");
    // "Not used" counts the same items as its group below (some also have another problem)
    return { live: live.length, error: live.filter((s) => s.level === "error").length, warn: live.filter((s) => s.level === "warn").length, idle: live.filter((s) => s.checks.some((c) => c.id === "unused")).length };
  }, [summaries]);

  const openProduct = (skuId: string) => {
    const sku = skus.find((s) => s.id === skuId);
    if (sku) go(`p/${sku.skuId}`, { state: { from: hash } });
  };
  const openMenu = (m: Menu) => go(m.menuCode, { state: { from: hash } });
  // Back = the browser's back when we came from inside Cost Center (so the phone's back
  // button agrees), else the list
  const backTo = (fallback: string) => ((location.state as { from?: string } | null)?.from !== undefined ? navigate(-1) : go(fallback));

  const header = (
    <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-bold">Cost Center</h2>
        <p className="text-sm text-muted-foreground">เมนู · สินค้า · สูตร · ราคา · ซัพพลายเออร์ — ทุกอย่างเชื่อมกัน แก้ที่เดียว</p>
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <Button
          variant="outline"
          className="h-10 shrink-0"
          onClick={() => {
            go("products");
            guide.start();
          }}
        >
          <HelpCircle className="h-4 w-4" /> วิธีใช้
        </Button>
        <div data-tour="cc-views" className="min-w-0">
          <SegmentedTabs<View> tabs={VIEWS} value={view} onChange={(v) => go(v)} />
        </div>
      </div>
      <GuideTour steps={GUIDE} open={guide.open} onClose={guide.close} />
    </div>
  );

  // From the menu side: prices live in Products here; pages this role can't open say
  // so instead of throwing them out of Cost Center
  const menuNavigate = (tab: TabKey) => {
    if (tab === "price") return go("products");
    if (!props.canOpen(tab)) return toast.info("หน้านี้เปิดได้เฉพาะ management");
    props.onNavigate(tab);
  };
  const tools: { tab: TabKey; label: string }[] = [
    { tab: "sku-categories", label: "หมวดสินค้า" },
    { tab: "sku", label: "นำเข้า/ส่งออกสินค้า (CSV)" },
    { tab: "price", label: "ราคาทั้งหมด · ส่งออก Excel" },
    { tab: "supplier", label: "นำเข้าซัพพลายเออร์ (CSV)" },
    { tab: "bom", label: "สูตร SM หลายขั้นตอน · ผลพลอยได้" },
    { tab: "sp-bom", label: "นำเข้าสูตร SP (CSV)" },
    { tab: "menu-master", label: "นำเข้าเมนู (CSV)" },
    { tab: "menu-bom", label: "สูตรเมนูแบบตาราง" },
    { tab: "modifier-rules", label: "กฎพิเศษทั้งหมด" },
  ].filter((t) => props.canOpen(t.tab as TabKey)) as { tab: TabKey; label: string }[];

  if (!productSide && !supplierSide) {
    return (
      <MenuSetupPage
        {...props.menuSetup}
        onNavigate={menuNavigate}
        header={header}
        listHash="menus"
        overviewExtra={
          <section className="flex flex-col gap-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <AreaCard kind="menu" title={`${props.menus.filter((m) => m.status === "Active").length} เมนูที่เปิดขาย`} sub="ดูเรื่องที่ต้องแก้ด้านล่าง" onOpen={() => go("menus")} />
              <AreaCard kind="RM" title={`${counts.live} สินค้าที่ใช้อยู่`} sub={`ต้องแก้ ${counts.error} · ควรดู ${counts.warn} · ไม่ได้ใช้ ${counts.idle}`} onOpen={() => go("products")} />
              <AreaCard kind="supplier" title={`${props.suppliers.filter((s) => s.status === "Active").length} ซัพพลายเออร์`} sub="ยอดซื้อ 90 วัน · ราคาที่ใช้อยู่" onOpen={() => go("suppliers")} />
            </div>
            <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-base font-semibold">สินค้า · เรื่องที่ต้องตั้งให้ครบ</h3>
              {canEditProducts && stale > 0 && (
                <Button variant="brand" className="h-10" loading={recosting} onClick={recostAll}>
                  คิดต้นทุนสูตรใหม่ทั้งหมด · {stale} ตัวไม่ตรง
                </Button>
              )}
            </div>
            <ProductOverview summaries={summaries} onOpenProduct={openProduct} />
            {tools.length > 0 && (
              <details className="rounded-2xl border border-border bg-card px-4 py-3 shadow-card">
                <summary className="min-h-[32px] cursor-pointer text-[15px] font-medium">เครื่องมือเดิม (นำเข้าไฟล์ · หมวด · สูตรหลายขั้นตอน)</summary>
                <div className="mt-2 flex flex-wrap gap-2">
                  {tools.map((t) => (
                    <Button key={t.tab} variant="outline" className="h-10" onClick={() => props.onNavigate(t.tab)}>
                      {t.label}
                    </Button>
                  ))}
                </div>
              </details>
            )}
            <h3 className="mt-1 text-base font-semibold">เมนู</h3>
          </section>
        }
      />
    );
  }

  if (hash.startsWith("bill/")) {
    const [, supplierId, date] = hash.split("/");
    const supplier = props.suppliers.find((s) => s.id === supplierId);
    return (
      <div className="flex flex-col gap-4">
        <div className="hidden lg:block">{header}</div>
        {supplier && bills && prices.length > 0 ? (
          <BillPriceUpdate
            key={hash}
            supplier={supplier}
            date={date}
            bills={bills}
            skus={skus}
            prices={prices}
            summaries={summaries}
            canEdit={canEditProducts}
            addPrice={props.productActions.addPrice}
            recost={props.productActions.recost}
            onBack={() => backTo(`s/${supplierId}`)}
            onOpenProduct={openProduct}
          />
        ) : (
          <p className="rounded-2xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">{bills ? "ไม่พบบิลนี้" : "กำลังโหลดบิล…"}</p>
        )}
      </div>
    );
  }

  if (supplierSide)
    return (
      <div className="flex flex-col gap-4">
        <div className={cn(hash.startsWith("s/") && "hidden lg:block")}>{header}</div>
        <SupplierView
          suppliers={props.suppliers}
          skus={skus}
          prices={prices}
          bills={bills}
          selectedId={hash.startsWith("s/") ? hash.slice(2) : null}
          canEdit={canEditProducts}
          onSelect={(id) => go(id ? `s/${id}` : "suppliers")}
          onOpenProduct={openProduct}
          addSupplier={props.addSupplier}
          updateSupplier={props.updateSupplier}
          onOpenBill={openBill}
        />
      </div>
    );

  // Product side
  const code = hash.startsWith("p/") ? hash.slice(2) : null;
  const selected = code ? summaries.find((s) => s.sku.skuId === code) ?? null : null;
  const isNew = hash === "new-product" && canEditProducts;
  const initialFilter = ((location.state as { filter?: ProductFilter } | null)?.filter ?? "all") as ProductFilter;
  return (
    <div className="flex flex-col gap-4">
      <div className={cn((selected || isNew) && "hidden lg:block")}>{header}</div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
        <div className={cn("min-w-0", (selected || isNew) && "hidden lg:block")}>
          <ProductList summaries={summaries} selectedId={selected?.sku.id ?? null} onSelect={(s) => openProduct(s.id)} onNew={canEditProducts ? () => go("new-product") : undefined} initialFilter={initialFilter} />
        </div>
        <div className={cn("min-w-0", !selected && !isNew && "hidden lg:block")}>
          {isNew ? (
            <NewProductForm
              skus={skus}
              prices={prices}
              suppliers={props.suppliers}
              categories={props.categories}
              addSku={props.addSku}
              updateSku={props.productActions.updateSku}
              addPrice={props.productActions.addPrice}
              onCreated={(s) => go(`p/${s.skuId}`, { replace: true })}
              onOpenExisting={(s) => go(`p/${s.skuId}`)}
              onCancel={() => go("products")}
            />
          ) : selected ? (
            <ProductWorkspace
              key={selected.sku.id}
              summary={selected}
              skus={skus}
              prices={prices}
              suppliers={props.suppliers}
              menus={props.menus}
              categories={props.categories}
              book={book}
              recipeCosts={recipeCosts}
              recipeRows={{ headers: props.bomHeaders, lines: props.bomLines, spLines: props.spLines }}
              recipeActions={props.recipeActions}
              canEdit={canEditProducts}
              actions={props.productActions}
              onBack={() => backTo("products")}
              onOpenProduct={openProduct}
              onOpenMenu={openMenu}
              onOpenSupplier={(id) => go(`s/${id}`, { state: { from: hash } })}
              onOpenBill={openBill}
              onNavigate={props.onNavigate}
            />
          ) : (
            <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-card p-8 text-center">
              <Layers className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
              <p className="font-medium">{code ? "ไม่พบสินค้านี้" : "เลือกสินค้าทางซ้าย"}</p>
              <p className="text-sm text-muted-foreground">จุดแดง = ต้องแก้ · จุดเหลือง = ควรดู</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AreaCard({ kind, title, sub, onOpen }: { kind: "menu" | "RM" | "supplier"; title: string; sub: string; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="flex min-h-[72px] items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-left shadow-card hover:bg-secondary/60">
      <KindBadge kind={kind} label={kind === "RM" ? "สินค้า" : undefined} />
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{title}</span>
        <span className="block text-sm text-muted-foreground">{sub}</span>
      </span>
    </button>
  );
}
