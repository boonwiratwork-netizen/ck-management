import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ClipboardList, AlertTriangle, X } from "lucide-react";
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
  disableMismatchCheck?: boolean;
  context?: 'ck' | 'branch';
  branchId?: string;
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

interface BranchCountRow {
  count_date: string;
  opening_balance: number;
  received_from_ck: number;
  received_external: number;
  expected_usage: number;
  waste: number;
  calculated_balance: number;
  physical_count: number | null;
  variance: number;
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

export function StockCard({
  skuId,
  skuType,
  sku,
  skus,
  currentStock,
  stockValue,
  onClose,
  disableMismatchCheck,
  context = 'ck',
  branchId,
}: StockCardProps) {
  const [movements, setMovements] = useState<Movement[]>([]);
  const [branchRows, setBranchRows] = useState<BranchCountRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetch() {
      setLoading(true);
      try {
        if (context === 'branch') {
          // Branch context: fetch daily_stock_counts history
          const { data } = await supabase
            .from('daily_stock_counts')
            .select('count_date, opening_balance, received_from_ck, received_external, expected_usage, waste, calculated_balance, physical_count, variance')
            .eq('branch_id', branchId!)
            .eq('sku_id', skuId)
            .eq('is_submitted', true)
            .order('count_date', { ascending: true });
          if (cancelled) return;
          setBranchRows((data as BranchCountRow[]) || []);
        } else if (skuType === "RM") {
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
  }, [skuId, skuType, sku.converter, skus, context, branchId]);

  const finalBalance = movements.length > 0 ? (movements[movements.length - 1].runningBalance ?? 0) : 0;
  const hasMismatch = Math.abs(finalBalance - currentStock) > 1;
  const hasMovements = movements.length > 1;

  // Branch context: use currentStock prop directly (already the live calculated balance from caller)
  const branchCurrentStock = currentStock;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <>
      <div className="fixed top-0 bottom-0 left-0 right-0 z-[999] bg-black/25" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 z-[1000] flex flex-col bg-background border-l shadow-xl w-[620px]">
        <div className="px-5 pt-5 pb-0 flex items-start justify-between">
          <div>
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
          </div>
          <button onClick={onClose} className="rounded-sm opacity-70 hover:opacity-100 transition-opacity mt-1">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="border-b mx-5 mt-3" />

        {/* Stat pills */}
        <div className="flex gap-3 px-5 py-3">
          <div className="flex-1 rounded-md border px-3 py-2">
            <div className="text-xs text-muted-foreground">Current Stock</div>
            <div className="text-lg font-bold font-mono">
              {fmt0(context === 'branch' ? Number(branchCurrentStock) : currentStock)}{" "}
              <span className="text-xs font-normal text-muted-foreground">{sku.usageUom}</span>
            </div>
          </div>
          {context === 'ck' && (
            <div className="flex-1 rounded-md border px-3 py-2">
              <div className="text-xs text-muted-foreground">Stock Value</div>
              <div className="text-lg font-bold font-mono">฿{fmt0(stockValue)}</div>
            </div>
          )}
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
          ) : context === 'branch' ? (
            /* ─── Branch context table ─── */
            <>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                Branch Stock History
              </p>
              {branchRows.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-12 text-sm text-muted-foreground">
                  <ClipboardList className="h-8 w-8 text-muted-foreground/50" />
                  <span>No submitted count sheets found for this SKU at this branch.</span>
                </div>
              ) : (
                <table className="w-full table-fixed text-xs">
                  <colgroup>
                    <col style={{ width: "72px" }} />
                    <col style={{ width: "68px" }} />
                    <col style={{ width: "72px" }} />
                    <col style={{ width: "72px" }} />
                    <col style={{ width: "55px" }} />
                    <col style={{ width: "72px" }} />
                    <col style={{ width: "72px" }} />
                    <col style={{ width: "72px" }} />
                  </colgroup>
                  <thead>
                    <tr className={table.headerRow}>
                      <th className={table.headerCell}>Date</th>
                      <th className={table.headerCellNumeric}>Opening</th>
                      <th className={table.headerCellNumeric}>Received</th>
                      <th className={table.headerCellNumeric}>Exp.Usage</th>
                      <th className={table.headerCellNumeric}>Waste</th>
                      <th className={table.headerCellNumeric}>Calc.Bal</th>
                      <th className={table.headerCellNumeric}>Physical</th>
                      <th className={table.headerCellNumeric}>Variance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {branchRows.map((r, i) => {
                      const received = Math.round(Number(r.received_from_ck) + Number(r.received_external));
                      const hasPhysical = r.physical_count !== null;
                      const variance = Number(r.variance);

                      return (
                        <tr key={i} className={table.dataRow}>
                          <td className={table.dataCellCompact}>{formatDateCompact(r.count_date)}</td>
                          <td className={table.dataCellCompactMono}>{fmt0(Number(r.opening_balance))}</td>
                          <td className={table.dataCellCompactMono}>{received > 0 ? received.toLocaleString() : <span className="text-muted-foreground">—</span>}</td>
                          <td className={table.dataCellCompactMono}>{Number(r.expected_usage) > 0 ? fmt0(Number(r.expected_usage)) : <span className="text-muted-foreground">—</span>}</td>
                          <td className={table.dataCellCompactMono}>{Number(r.waste) > 0 ? fmt0(Number(r.waste)) : <span className="text-muted-foreground">—</span>}</td>
                          <td className={`${table.dataCellCompactMono} font-semibold`}>{fmt0(Number(r.calculated_balance))}</td>
                          <td className={table.dataCellCompactMono}>
                            {hasPhysical ? (
                              <span className="font-semibold">{fmt0(Number(r.physical_count))}</span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className={table.dataCellCompactMono}>
                            {hasPhysical ? (
                              <span className={
                                variance > 0 ? "text-success" :
                                variance < 0 ? "text-destructive" :
                                "text-muted-foreground"
                              }>
                                {fmt0(variance)}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </>
          ) : (
            /* ─── CK context table (existing) ─── */
            <>
              <table className="w-full table-fixed text-xs">
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

              {hasMismatch && hasMovements && !disableMismatchCheck && (
                <div className="flex items-center gap-2 mt-3 text-xs text-warning">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>Balance mismatch — some movements may be missing</span>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
