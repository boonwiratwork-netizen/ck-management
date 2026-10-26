import { useMemo, useState } from "react";
import { ChevronRight, Plus, Search } from "lucide-react";
import type { SKU, SKUType } from "@/types/sku";
import type { ProductLevel, ProductSummary } from "@/lib/product-health";
import { SegmentedTabs } from "@/components/SegmentedTabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { KindBadge, LevelDot, baht } from "./parts";

export type ProductFilter = "all" | "error" | "warn" | "idle" | "inactive";
type TypeFilter = "all" | SKUType;

/** What one row shows on the right: the standard price per pack, or the recipe cost per pack */
export function packPriceLabel(s: ProductSummary): string {
  const { sku } = s;
  const pack = sku.packUnit || sku.purchaseUom;
  // Under ฿1 (a recipe cost per gram) shows 3 decimals, like the cost line under the recipe
  const amount = (n: number) => baht(n, n < 1 ? 3 : 2);
  if (sku.type === "SM" || sku.type === "SP") return s.recipeCost ? `${amount(s.recipeCost * (sku.packSize || 1))}/${pack || sku.usageUom}` : "";
  if (s.standard) return `${amount(s.standard.pricePerPurchaseUom)}/${pack}`;
  return "";
}

export function ProductList({
  summaries,
  selectedId,
  onSelect,
  onNew,
  initialFilter = "all",
}: {
  summaries: ProductSummary[];
  selectedId: string | null;
  onSelect: (sku: SKU) => void;
  onNew?: () => void;
  initialFilter?: ProductFilter;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ProductFilter>(initialFilter);
  const [type, setType] = useState<TypeFilter>("all");

  const counts = useMemo(() => {
    const c = { all: 0, error: 0, warn: 0, idle: 0, inactive: 0 };
    for (const s of summaries) {
      if (type !== "all" && s.sku.type !== type) continue;
      c.all++;
      if (s.sku.status === "Inactive") c.inactive++;
      else if (s.level === "error") c.error++;
      else if (s.level === "warn") c.warn++;
      else if (s.level === "idle") c.idle++;
    }
    return c;
  }, [summaries, type]);

  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const order: Record<ProductLevel, number> = { error: 0, warn: 1, ok: 2, idle: 3 };
    return summaries
      .filter((s) => type === "all" || s.sku.type === type)
      .filter((s) => {
        const off = s.sku.status === "Inactive";
        if (filter === "inactive") return off;
        if (filter === "all") return true;
        return !off && s.level === filter;
      })
      .filter((s) => words.every((w) => `${s.sku.skuId} ${s.sku.name} ${s.sku.category}`.toLowerCase().includes(w)))
      .sort((a, b) => {
        const offA = a.sku.status === "Inactive" ? 1 : 0;
        const offB = b.sku.status === "Inactive" ? 1 : 0;
        if (offA !== offB) return offA - offB;
        return order[a.level] - order[b.level] || a.sku.skuId.localeCompare(b.sku.skuId);
      });
  }, [summaries, query, filter, type]);

  const filters: { key: ProductFilter; label: string }[] = [
    { key: "all", label: `ทั้งหมด ${counts.all}` },
    { key: "error", label: `ต้องแก้ ${counts.error}` },
    { key: "warn", label: `ควรดู ${counts.warn}` },
    { key: "idle", label: `ไม่ได้ใช้ ${counts.idle}` },
    { key: "inactive", label: `ปิดใช้ ${counts.inactive}` },
  ];
  const types: TypeFilter[] = ["all", "RM", "SM", "SP", "PK"];

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-card split:sticky split:top-20 split:max-h-[calc(100dvh-7rem)]">
      <div className="flex flex-col gap-3 border-b border-border p-4">
        {onNew && (
          <Button data-tour="cc-new" variant="brand" className="h-11 w-full" onClick={onNew}>
            <Plus className="h-4 w-4" /> สินค้าใหม่
          </Button>
        )}
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ค้นรหัส ชื่อ หรือหมวด…" className="h-11 pl-9" aria-label="ค้นสินค้า" />
        </div>
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {types.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={cn(
                "min-h-[36px] shrink-0 rounded-full border px-3.5 text-sm transition-colors",
                type === t ? "border-primary bg-primary font-semibold text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {t === "all" ? "ทุกประเภท" : t}
            </button>
          ))}
        </div>
        <div data-tour="cc-filter">
          <SegmentedTabs<ProductFilter> tabs={filters} value={filter} onChange={setFilter} className="[&_[role=tab]]:min-h-[36px] [&_[role=tab]]:px-3" />
        </div>
      </div>

      <ul className="flex-1 divide-y divide-border overflow-y-auto overscroll-contain">
        {shown.map((s, i) => {
          const why = s.checks.find((c) => c.level === s.level && s.level !== "ok");
          return (
            <li key={s.sku.id} data-tour={i === 0 ? "cc-list" : undefined}>
              <button
                type="button"
                onClick={() => onSelect(s.sku)}
                aria-current={selectedId === s.sku.id ? "true" : undefined}
                className={cn(
                  "flex min-h-[64px] w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-secondary/60",
                  selectedId === s.sku.id && "bg-secondary shadow-[inset_3px_0_0_hsl(var(--brand))]",
                  s.sku.status === "Inactive" && "opacity-60",
                )}
              >
                <LevelDot level={s.level} />
                <KindBadge kind={s.sku.type} />
                <div className="min-w-0 flex-1">
                  <div className="break-words text-[15px] font-medium">{s.sku.name}</div>
                  <div className={cn("truncate text-sm", why ? (s.level === "error" ? "text-destructive" : "text-muted-foreground") : "text-muted-foreground")}>
                    {why ? why.title : <span className="font-mono">{s.sku.skuId}</span>}
                  </div>
                </div>
                <div className="shrink-0 text-right font-mono text-sm tabular-nums">{packPriceLabel(s)}</div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground split:hidden" aria-hidden="true" />
              </button>
            </li>
          );
        })}
        {shown.length === 0 && <li className="px-4 py-10 text-center text-sm text-muted-foreground">ไม่พบสินค้า</li>}
      </ul>
    </div>
  );
}
