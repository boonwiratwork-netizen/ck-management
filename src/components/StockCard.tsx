import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ClipboardList, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { table } from "@/lib/design-tokens";
import type { SKU } from "@/types/sku";

interface StockCardProps {
  skuId: string;
  skuType: "RM" | "SM";
  sku: SKU;
  skus: SKU[];
  currentStock: number;
  stockValue: number;
  onClose: () => void;
}

interface Movement {
  date: string;
  sortKey: string;
  type: "Opening" | "Receipt" | "Production" | "Delivery" | "Adjustment" | "StockCount";
  reference: string;
  qtyIn: number | null;
  qtyOut: number | null;
  runningBalance?: number;
  isProductionUse?: boolean;
}

const STORAGE_BADGES: Record<string, string> = {
  Frozen: "bg-blue-100 text-blue-700",
  Chilled: "bg-cyan-100 text-cyan-700",
  Ambient: "bg-muted text-muted-foreground",
};

function formatDateCompact(iso: string): string {
  if (!iso || iso === "—") return "—";
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}/${mm}/${yy}`;
}

const fmt0 = (v: number) => Math.round(v).toLocaleString();

function classifyAdjustment(quantity: number, reason: string, skus: SKU[]): Movement {
  const base = { date: "", sortKey: "", qtyIn: null as number | null, qtyOut: null as number | null };

  if (reason.startsWith("Production:")) {
    const match = reason.match(/Production:\s*(\d+)\s*batches?\s*of\s+(.+)/i);
    let ref = reason;
    if (match) {
      const batches = match[1];
      const uuidOrCode = match[2].trim();
      const found = skus.find((s) => s.id === uuidOrCode);
      ref = `${batches} batch${Number(batches) > 1 ? "es" : ""} · ${found ? found.skuId : uuidOrCode}`;
    }
    return {
      ...base,
      type: "Adjustment",
      reference: ref,
      qtyIn: null,
      qtyOut: Math.abs(quantity),
      isProductionUse: true,
    };
  }

  if (reason.toLowerCase().includes("stock count")) {
    return {
      ...base,
      type: "StockCount",
      reference: "Physical count",
      qtyIn: quantity > 0 ? quantity : null,
      qtyOut: quantity < 0 ? Math.abs(quantity) : null,
    };
  }

  return {
    ...base,
    type: "Adjustment",
    reference: reason || "Manual adjustment",
    qtyIn: quantity > 0 ? quantity : null,
    qtyOut: quantity < 0 ? Math.abs(quantity) : null,
  };
}

type TypeBadgeKey = Movement["type"];

const TYPE_BADGE_STYLES: Record<TypeBadgeKey, string> = {
  Opening: "bg-muted text-muted-foreground",
  Receipt: "bg-success/15 text-success",
  Production: "bg-success/15 text-success",
  Delivery: "bg-warning/15 text-warning",
  Adjustment: "bg-primary/15 text-primary",
  StockCount: "bg-violet-500/15 text-violet-600",
};

export function StockCard({ skuId, skuType, sku, skus, currentStock, stockValue, onClose }: StockCardProps) {
  const [movements, setMovements] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetch() {
      setLoading(true);
      try {
        if (skuType === "RM") {
          const [obRes, receiptsRes, adjRes, suppRes] = await Promise.all([
            supabase.from("stock_opening_balances").select("quantity").eq("sku_id", skuId).maybeSingle(),
            supabase
              .from("goods_receipts")
              .select("receipt_date, quantity_received, supplier_id, created_at")
              .eq("sku_id", skuId)
              .order("receipt_date", { ascending: true })
              .order("created_at", { ascending: true }),
            supabase
              .from("stock_adjustments")
              .select("adjustment_date, quantity, reason, created_at")
              .eq("sku_id", skuId)
              .eq("stock_type", "RM")
              .order("adjustment_date", { ascending: true })
              .order("created_at", { ascending: true }),
            supabase.from("suppliers").select("id, name"),
          ]);
          if (cancelled) return;

          const supplierMap = new Map<string, string>();
          (suppRes.data ?? []).forEach((s) => supplierMap.set(s.id, s.name));

          const openingQty = obRes.data?.quantity ?? 0;
          const converter = sku.converter ?? 1;

          const mvts: Movement[] = [
            {
              date: "—",
              sortKey: "0000-00-00",
              type: "Opening",
              reference: "—",
              qtyIn: openingQty > 0 ? openingQty : null,
              qtyOut: null,
            },
          ];

          (receiptsRes.data ?? []).forEach((r) => {
            mvts.push({
              date: r.receipt_date,
              sortKey: `${r.receipt_date}|${r.created_at}`,
              type: "Receipt",
              reference: supplierMap.get(r.supplier_id) ?? "—",
              qtyIn: r.quantity_received * converter,
              qtyOut: null,
            });
          });

          (adjRes.data ?? []).forEach((a) => {
            const classified = classifyAdjustment(a.quantity, a.reason, skus);
            mvts.push({ ...classified, date: a.adjustment_date, sortKey: `${a.adjustment_date}|${a.created_at}` });
          });

          // Sort (keep Opening first)
          const opening = mvts[0];
          const rest = mvts.slice(1).sort((a, b) => a.sortKey.localeCompare(b.sortKey));
          const sorted = [opening, ...rest];

          // Running balance
          let bal = 0;
          sorted.forEach((m) => {
            bal += (m.qtyIn ?? 0) - (m.qtyOut ?? 0);
            m.runningBalance = bal;
          });

          setMovements(sorted);
        } else {
          // SM
          const [obRes, prodRes, toRes, adjRes] = await Promise.all([
            supabase.from("stock_opening_balances").select("quantity").eq("sku_id", skuId).maybeSingle(),
            supabase
              .from("production_records")
              .select("production_date, actual_output_g, batches_produced, created_at")
              .eq("sm_sku_id", skuId)
              .order("production_date", { ascending: true })
              .order("created_at", { ascending: true }),
            supabase
              .from("transfer_order_lines")
              .select(
                "actual_qty, planned_qty, transfer_orders!inner(to_number, delivery_date, status, branches(branch_name))",
              )
              .eq("sku_id", skuId)
              .in("transfer_orders.status", ["Sent", "Received"]),
            supabase
              .from("stock_adjustments")
              .select("adjustment_date, quantity, reason, created_at")
              .eq("sku_id", skuId)
              .eq("stock_type", "SM")
              .order("adjustment_date", { ascending: true })
              .order("created_at", { ascending: true }),
          ]);
          if (cancelled) return;

          const openingQty = obRes.data?.quantity ?? 0;

          const mvts: Movement[] = [
            {
              date: "—",
              sortKey: "0000-00-00",
              type: "Opening",
              reference: "—",
              qtyIn: openingQty > 0 ? openingQty : null,
              qtyOut: null,
            },
          ];

          (prodRes.data ?? []).forEach((p) => {
            mvts.push({
              date: p.production_date,
              sortKey: `${p.production_date}|${p.created_at}`,
              type: "Production",
              reference: `${p.batches_produced} batch${p.batches_produced > 1 ? "es" : ""}`,
              qtyIn: p.actual_output_g,
              qtyOut: null,
            });
          });

          (toRes.data ?? []).forEach((line: any) => {
            const to = line.transfer_orders;
            if (!to) return;
            const qty = line.actual_qty > 0 ? line.actual_qty : line.planned_qty;
            const branchName = to.branches?.branch_name ?? "";
            mvts.push({
              date: to.delivery_date,
              sortKey: `${to.delivery_date}|${to.delivery_date}`,
              type: "Delivery",
              reference: `${to.to_number} · ${branchName}`,
              qtyIn: null,
              qtyOut: qty,
            });
          });

          (adjRes.data ?? []).forEach((a) => {
            const classified = classifyAdjustment(a.quantity, a.reason, skus);
            mvts.push({ ...classified, date: a.adjustment_date, sortKey: `${a.adjustment_date}|${a.created_at}` });
          });

          const opening = mvts[0];
          const rest = mvts.slice(1).sort((a, b) => a.sortKey.localeCompare(b.sortKey));
          const sorted = [opening, ...rest];

          let bal = 0;
          sorted.forEach((m) => {
            bal += (m.qtyIn ?? 0) - (m.qtyOut ?? 0);
            m.runningBalance = bal;
          });

          setMovements(sorted);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetch();
    return () => {
      cancelled = true;
    };
  }, [skuId, skuType, sku.converter, skus]);

  const finalBalance = movements.length > 0 ? (movements[movements.length - 1].runningBalance ?? 0) : 0;
  const hasMismatch = Math.abs(finalBalance - currentStock) > 1;
  const hasMovements = movements.length > 1;

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent side="right" className="w-[620px] max-w-none p-0 flex flex-col">
        <SheetHeader className="px-5 pt-5 pb-0 space-y-0">
          <SheetTitle className="sr-only">Stock Card</SheetTitle>
          {/* Line 1 */}
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-sm text-muted-foreground">{sku.skuId}</span>
            <span className="font-semibold text-foreground">{sku.name}</span>
          </div>
          {/* Line 2 */}
          <div className="flex items-center gap-2 mt-1">
            <span className={`${table.badge.base} ${STORAGE_BADGES[sku.storageCondition] ?? STORAGE_BADGES.Ambient}`}>
              {sku.storageCondition}
            </span>
            <span className="text-xs text-muted-foreground">{sku.usageUom}</span>
          </div>
        </SheetHeader>

        <div className="border-b mx-5 mt-3" />

        {/* Stat pills */}
        <div className="flex gap-3 px-5 py-3">
          <div className="flex-1 rounded-md border px-3 py-2">
            <div className="text-xs text-muted-foreground">Current Stock</div>
            <div className="text-lg font-bold font-mono">
              {fmt0(currentStock)} <span className="text-xs font-normal text-muted-foreground">{sku.usageUom}</span>
            </div>
          </div>
          <div className="flex-1 rounded-md border px-3 py-2">
            <div className="text-xs text-muted-foreground">Stock Value</div>
            <div className="text-lg font-bold font-mono">฿{fmt0(stockValue)}</div>
          </div>
        </div>

        <div className="border-b mx-5" />

        {/* Scrollable content */}
        <div className="flex-1 overflow-auto px-5 py-3">
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex gap-2">
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-4 flex-1" />
                  <Skeleton className="h-4 w-12" />
                  <Skeleton className="h-4 w-12" />
                  <Skeleton className="h-4 w-14" />
                </div>
              ))}
            </div>
          ) : (
            <>
              <div className={table.wrapper}>
                <div className="overflow-x-auto">
                  <table className={table.base}>
                    <colgroup>
                      <col style={{ width: "72px" }} />
                      <col style={{ width: "88px" }} />
                      <col />
                      <col style={{ width: "65px" }} />
                      <col style={{ width: "65px" }} />
                      <col style={{ width: "90px" }} />
                    </colgroup>
                    <thead>
                      <tr className={table.headerRow}>
                        <th className={table.headerCell}>Date</th>
                        <th className={table.headerCell}>Type</th>
                        <th className={table.headerCell}>Reference / Note</th>
                        <th className={table.headerCellNumeric}>In</th>
                        <th className={table.headerCellNumeric}>Out</th>
                        <th className={table.headerCellNumeric}>Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {movements.map((m, i) => (
                        <tr key={i} className={table.dataRow}>
                          <td className={table.dataCellCompact}>{formatDateCompact(m.date)}</td>
                          <td className={table.dataCellCompact}>
                            <span
                              className={`inline-flex items-center text-xs font-medium px-1.5 py-0.5 rounded-full ${
                                m.isProductionUse ? "bg-warning/15 text-warning" : TYPE_BADGE_STYLES[m.type]
                              }`}
                            >
                              {m.type}
                            </span>
                          </td>
                          <td className={table.truncatedCellCompact} title={m.reference}>
                            <span className="block truncate">{m.reference}</span>
                          </td>
                          <td className={table.dataCellCompactMono}>
                            {m.qtyIn != null && m.qtyIn > 0 ? (
                              <span className="text-success">{fmt0(m.qtyIn)}</span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className={table.dataCellCompactMono}>
                            {m.qtyOut != null && m.qtyOut > 0 ? (
                              <span className="text-warning">{fmt0(m.qtyOut)}</span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td
                            className={`${table.dataCellCompactMono} font-semibold ${
                              (m.runningBalance ?? 0) < 0
                                ? "text-destructive"
                                : (m.runningBalance ?? 0) === 0
                                  ? "text-muted-foreground"
                                  : "text-foreground"
                            }`}
                          >
                            {fmt0(m.runningBalance ?? 0)}
                          </td>
                        </tr>
                      ))}
                      {!hasMovements && (
                        <tr>
                          <td colSpan={6} className={table.emptyState}>
                            <div className="flex flex-col items-center gap-2">
                              <ClipboardList className="h-8 w-8 text-muted-foreground/50" />
                              <span>No movements recorded yet for this SKU.</span>
                            </div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {hasMismatch && hasMovements && (
                <div className="flex items-center gap-2 mt-3 text-xs text-warning">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>Balance mismatch — some movements may be missing</span>
                </div>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
