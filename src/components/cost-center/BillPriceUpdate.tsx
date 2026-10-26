import { useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import type { SKU } from "@/types/sku";
import type { Price } from "@/types/price";
import type { Supplier } from "@/types/supplier";
import type { Bill, ProductSummary } from "@/lib/product-health";
import { BILL_DRIFT } from "@/lib/product-health";
import { Button } from "@/components/ui/button";
import { cn, toLocalDateStr } from "@/lib/utils";
import { KindBadge, baht } from "./parts";

interface Props {
  supplier: Supplier;
  date: string;
  bills: Bill[];
  skus: SKU[];
  prices: Price[];
  summaries: ProductSummary[];
  canEdit: boolean;
  addPrice: (data: Omit<Price, "id" | "pricePerUsageUom">, sku: SKU | undefined, opts?: { batch?: boolean }) => Promise<boolean>;
  recost: (...skuIds: string[]) => Promise<void>;
  onBack: () => void;
  onOpenProduct: (skuId: string) => void;
}

/**
 * One supplier's bill (one day): every item's bill price per pack against the price
 * set for that supplier. Items more than 10% off are ticked; one tap sets them all as
 * the new prices (and the standard), then costs are worked out once.
 */
export function BillPriceUpdate({ supplier, date, bills, skus, prices, summaries, canEdit, addPrice, recost, onBack, onOpenProduct }: Props) {
  const byId = useMemo(() => new Map(skus.map((s) => [s.id, s])), [skus]);
  const rows = useMemo(() => {
    // Lines with a quantity and a price only (a blank line would read as ฿0)
    const lines = bills.filter((b) => b.supplierId === supplier.id && b.date === date && b.unitPrice > 0 && b.qty > 0);
    const bySku = new Map<string, { qty: number; total: number }>();
    for (const b of lines) {
      const cur = bySku.get(b.skuId) ?? { qty: 0, total: 0 };
      cur.qty += b.qty;
      cur.total += b.unitPrice * b.qty;
      bySku.set(b.skuId, cur);
    }
    return [...bySku]
      .map(([skuId, t]) => {
        const sku = byId.get(skuId);
        const own = prices.find((p) => p.skuId === skuId && p.supplierId === supplier.id && p.isActive) ?? prices.find((p) => p.skuId === skuId && p.isActive);
        const billPack = t.qty > 0 ? (t.total / t.qty) * (sku?.packSize || 1) : 0;
        const ref = own?.pricePerPurchaseUom ?? 0;
        const s = summaries.find((x) => x.sku.id === skuId);
        // A later bill from this supplier already exists: this one is older news
        const newer = bills.some((b) => b.skuId === skuId && b.supplierId === supplier.id && b.date > date && b.unitPrice > 0 && b.qty > 0);
        return { skuId, sku, billPack, ref, diff: ref > 0 ? billPack / ref - 1 : null, usage: s?.usage, newer };
      })
      .filter((r) => r.sku && r.billPack > 0)
      .sort((a, b) => Math.abs(b.diff ?? 9) - Math.abs(a.diff ?? 9));
  }, [bills, supplier.id, date, byId, prices, summaries]);

  // Ticked: far off from the price set, and no newer bill (an item with no price set is left to choose)
  const [picked, setPicked] = useState<Set<string>>(() => new Set(rows.filter((r) => r.diff !== null && Math.abs(r.diff) > BILL_DRIFT && !r.newer).map((r) => r.skuId)));
  const [busy, setBusy] = useState(false);
  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const chosen = rows.filter((r) => picked.has(r.skuId));
  const recipes = new Set(chosen.flatMap((r) => [...(r.usage?.inSm ?? []), ...(r.usage?.inSp ?? [])]));
  const menus = new Set(chosen.flatMap((r) => r.usage?.inMenus ?? []));
  const dateText = new Date(date + "T00:00:00").toLocaleDateString("th-TH", { day: "numeric", month: "short" });

  const apply = async () => {
    if (!chosen.length || busy) return;
    setBusy(true);
    const done: string[] = [];
    for (const r of chosen) {
      const ok = await addPrice(
        { skuId: r.skuId, supplierId: supplier.id, pricePerPurchaseUom: Math.round(r.billPack * 100) / 100, vat: r.sku!.vat, isActive: true, effectiveDate: toLocalDateStr(new Date()), note: `จากบิล ${dateText}` },
        r.sku,
        { batch: true },
      );
      if (ok) done.push(r.skuId);
    }
    if (done.length) await recost(...done);
    setBusy(false);
    // Saved ones are unticked (a second tap never adds them twice); leave only when all went through
    setPicked((p) => new Set([...p].filter((id) => !done.includes(id))));
    if (done.length === chosen.length) onBack();
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onBack} aria-label="กลับ" className="-ml-2 flex h-11 w-11 items-center justify-center rounded-xl hover:bg-secondary">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h3 className="text-xl font-bold">
            อัปเดตราคาจากบิล · {supplier.name} · {dateText}
          </h3>
          <p className="text-sm text-muted-foreground">{rows.length} รายการ · ติ๊กไว้ให้แล้วตัวที่ต่างเกิน 10% · ราคาต่อหน่วยที่ซื้อ</p>
        </div>
      </div>
      <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] table-fixed text-sm">
            <colgroup>
              <col style={{ width: "52px" }} />
              <col />
              <col style={{ width: "120px" }} />
              <col style={{ width: "120px" }} />
              <col style={{ width: "90px" }} />
              <col style={{ width: "150px" }} />
            </colgroup>
            <thead className="text-muted-foreground">
              <tr>
                <th />
                <th className="px-2 py-2 text-left font-medium">สินค้า</th>
                <th className="px-2 py-2 text-right font-medium">ราคาที่ตั้งไว้</th>
                <th className="px-2 py-2 text-right font-medium">ในบิล</th>
                <th className="px-2 py-2 text-right font-medium">ต่าง</th>
                <th className="px-4 py-2 text-left font-medium">คิดใหม่ให้</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const on = picked.has(r.skuId);
                const pack = r.sku!.packUnit || r.sku!.purchaseUom;
                return (
                  <tr key={r.skuId} className={cn("border-t border-border", on && "bg-brand-soft/40")}>
                    <td className="px-3 py-2">
                      <input type="checkbox" className="h-5 w-5" disabled={!canEdit} checked={on} onChange={() => toggle(r.skuId)} aria-label={`อัปเดต ${r.sku!.name}`} />
                    </td>
                    <td className="truncate px-2 py-2">
                      <button type="button" onClick={() => onOpenProduct(r.skuId)} className="flex min-w-0 items-center gap-2 text-left hover:underline">
                        <KindBadge kind={r.sku!.type} />
                        <span className="truncate">
                          {r.sku!.name} <span className="text-muted-foreground">/{pack}</span>
                          {r.newer && <span className="ml-1 text-xs text-muted-foreground">· มีบิลใหม่กว่า</span>}
                        </span>
                      </button>
                    </td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums">{r.ref ? baht(r.ref) : "ไม่มี"}</td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums">{baht(r.billPack)}</td>
                    <td className={cn("px-2 py-2 text-right font-mono tabular-nums", r.diff !== null && Math.abs(r.diff) > BILL_DRIFT && (r.diff > 0 ? "font-semibold text-warning" : "font-semibold text-success"))}>
                      {r.diff === null ? "—" : `${r.diff > 0 ? "+" : "−"}${Math.abs(Math.round(r.diff * 100))}%`}
                    </td>
                    <td className="px-4 py-2 text-sm text-muted-foreground">
                      {[r.usage?.inSm.length ? `${r.usage.inSm.length} สูตรครัว` : "", r.usage?.inMenus.length ? `${r.usage.inMenus.length} เมนู` : ""].filter(Boolean).join(" · ") || "—"}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                    ไม่มีรายการในบิลนี้
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      {canEdit && (
        <div className="sticky bottom-[calc(64px+env(safe-area-inset-bottom))] z-30 flex flex-col gap-3 rounded-2xl bg-primary p-4 text-primary-foreground shadow-raised sm:flex-row sm:items-center md:bottom-4">
          <div className="min-w-0 flex-1">
            <div className="font-semibold">อัปเดต {chosen.length} ราคา</div>
            <div className="text-sm text-primary-foreground/70">
              คิดต้นทุนใหม่ {recipes.size} สูตร · {menus.size} เมนู · ราคาใหม่เป็นราคามาตรฐาน · เก็บในประวัติทุกตัว
            </div>
          </div>
          <Button variant="brand" className="h-12 min-w-[150px] text-base" loading={busy} disabled={!chosen.length} onClick={apply}>
            อัปเดต {chosen.length} ราคา
          </Button>
        </div>
      )}
    </div>
  );
}
