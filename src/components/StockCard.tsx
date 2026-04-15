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
  context?: "ck" | "branch";
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
  lotText?: string;
  timestamp?: string;
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
  Frozen: "bg-[#E6F1FB] text-blue-700",
  Chilled: "bg-[#E6F1FB] text-cyan-700",
  Ambient: "bg-muted text-muted-foreground",
};

function formatDateCompact(iso: string, timeIso?: string): string {
  if (!iso || iso === "—") return "—";
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  const base = `${dd}/${mm}/${yy}`;
  if (!timeIso) return base;
  const t = new Date(timeIso);
  const hh = String(t.getHours()).padStart(2, "0");
  const min = String(t.getMinutes()).padStart(2, "0");
  return `${base} ${hh}:${min}`;
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
  context = "ck",
  branchId,
}: StockCardProps) {
  const [movements, setMovements] = useState<Movement[]>([]);
  const [branchRows, setBranchRows] = useState<BranchCountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [smAnchorDate, setSmAnchorDate] = useState<string | null>(null);
  const [daysBack, setDaysBack] = useState(14);

  useEffect(() => {
    let cancelled = false;

    // Calculate fromDate for CK context date filtering
    const fromD = new Date();
    fromD.setDate(fromD.getDate() - daysBack);
    const fromDate = fromD.toISOString().slice(0, 10);

    async function fetch() {
      setLoading(true);
      try {
        if (context === "branch") {
          // Branch context: reconstruct day-by-day ledger from raw transactions

          // Step 1 — Find earliest snap date
          const resolvedStartDate = fromDate;

          // Step 2 — Fetch all data in parallel
           const [dscRes, brRes, salesRes, mbRes, menusRes, spRes, mrRes, ruleMenusRes, skusRes, adjStockRes] = await Promise.all([
            supabase
              .from("daily_stock_counts")
              .select(
                "count_date, opening_balance, received_from_ck, received_external, expected_usage, waste, calculated_balance, physical_count, variance, is_submitted",
              )
              .eq("branch_id", branchId!)
              .eq("sku_id", skuId)
              .gte("count_date", resolvedStartDate)
              .order("count_date", { ascending: true }),
            supabase
              .from("branch_receipts")
              .select("receipt_date, qty_received, transfer_order_id, sku_id")
              .eq("branch_id", branchId!)
              .eq("sku_id", skuId)
              .gte("receipt_date", resolvedStartDate)
              .order("receipt_date", { ascending: true }),
            supabase
              .from("sales_entries")
              .select("sale_date, menu_code, menu_name, qty")
              .eq("branch_id", branchId!)
              .gte("sale_date", resolvedStartDate)
              .order("sale_date", { ascending: true }),
            supabase
              .from("menu_bom")
              .select("menu_id, sku_id, effective_qty")
              .or(`branch_id.is.null,branch_id.eq.${branchId}`),
            supabase.from("menus").select("id, menu_code"),
            supabase.from("sp_bom").select("sp_sku_id, ingredient_sku_id, qty_per_batch, batch_yield_qty"),
            supabase.from("menu_modifier_rules").select("*").eq("is_active", true),
            supabase.from("modifier_rule_menus").select("rule_id, menu_id"),
            supabase.from("skus").select("id, type"),
            supabase
              .from("stock_adjustments")
              .select("adjustment_date, quantity, reason, created_at")
              .eq("branch_id", branchId!)
              .eq("sku_id", skuId)
              .gte("adjustment_date", resolvedStartDate)
              .order("adjustment_date", { ascending: true })
              .order("created_at", { ascending: true }),
           ]);
          if (cancelled) return;

          const receipts = brRes.data ?? [];
          const sales = salesRes.data ?? [];
          const menuBomLines = mbRes.data ?? [];
          const menus = menusRes.data ?? [];
          const spBomLines = spRes.data ?? [];
          const modRules = mrRes.data ?? [];
          const ruleMenus = ruleMenusRes.data ?? [];
          const allSkus = skusRes.data ?? [];
          const dscRows = dscRes.data ?? [];

          // Build adjustment map by date
          const adjByDate = new Map<string, { quantity: number; reason: string; createdAt: string }[]>();
          for (const a of adjStockRes.data ?? []) {
            const arr = adjByDate.get(a.adjustment_date) ?? [];
            arr.push({ quantity: Number(a.quantity), reason: a.reason ?? "", createdAt: a.created_at });
            adjByDate.set(a.adjustment_date, arr);
          }

          // Build menu code → id map
          const menuCodeToId = new Map<string, string>();
          menus.forEach((m: any) => menuCodeToId.set(m.menu_code, m.id));

          // Build rule → menuIds map
          const ruleMenuMap = new Map<string, string[]>();
          ruleMenus.forEach((rm: any) => {
            const arr = ruleMenuMap.get(rm.rule_id) ?? [];
            arr.push(rm.menu_id);
            ruleMenuMap.set(rm.rule_id, arr);
          });

          // SKU type map
          const skuTypeMap = new Map<string, string>();
          allSkus.forEach((s: any) => skuTypeMap.set(s.id, s.type));

          // Step 3 — Calculate daily usage from sales for this specific SKU
          const salesByDate = new Map<string, any[]>();
          sales.forEach((s: any) => {
            const arr = salesByDate.get(s.sale_date) ?? [];
            arr.push(s);
            salesByDate.set(s.sale_date, arr);
          });

          const usageByDate = new Map<string, number>();
          for (const [date, daySales] of salesByDate) {
            const usageMap = new Map<string, number>();

            for (const sale of daySales) {
              const menuId = menuCodeToId.get(sale.menu_code);
              if (!menuId) continue;
              const qty = Number(sale.qty) || 0;

              // Base BOM ingredients
              const bomLines = menuBomLines.filter((b: any) => b.menu_id === menuId);
              for (const line of bomLines) {
                const ingredientSkuId = line.sku_id;
                const ingredientType = skuTypeMap.get(ingredientSkuId);
                if (ingredientType === "SP") {
                  // Expand SP via sp_bom
                  const spLines = spBomLines.filter((sp: any) => sp.sp_sku_id === ingredientSkuId);
                  for (const sp of spLines) {
                    const spQty =
                      (Number(line.effective_qty) * qty * Number(sp.qty_per_batch)) / Number(sp.batch_yield_qty);
                    usageMap.set(sp.ingredient_sku_id, (usageMap.get(sp.ingredient_sku_id) ?? 0) + spQty);
                  }
                } else {
                  usageMap.set(
                    ingredientSkuId,
                    (usageMap.get(ingredientSkuId) ?? 0) + Number(line.effective_qty) * qty,
                  );
                }
              }

              // Modifier Rules
              const menuName = (sale.menu_name || "").toLowerCase();
              for (const rule of modRules) {
                if (!rule.keyword || !rule.is_active) continue;
                const keyword = rule.keyword.toLowerCase();
                if (!menuName.includes(keyword)) continue;

                // Check menu scope
                const scopeMenuIds = ruleMenuMap.get(rule.id) ?? [];
                if (scopeMenuIds.length > 0 && !scopeMenuIds.includes(menuId)) continue;

                if (rule.rule_type === "swap") {
                  if (rule.swap_sku_id) {
                    usageMap.set(
                      rule.swap_sku_id,
                      (usageMap.get(rule.swap_sku_id) ?? 0) - Number(rule.qty_per_match) * qty,
                    );
                  }
                  if (rule.sku_id) {
                    usageMap.set(rule.sku_id, (usageMap.get(rule.sku_id) ?? 0) + Number(rule.qty_per_match) * qty);
                  }
                } else if (rule.rule_type === "submenu") {
                  if (rule.submenu_id) {
                    const subBom = menuBomLines.filter((b: any) => b.menu_id === rule.submenu_id);
                    for (const line of subBom) {
                      const ingType = skuTypeMap.get(line.sku_id);
                      if (ingType === "SP") {
                        const spLines = spBomLines.filter((sp: any) => sp.sp_sku_id === line.sku_id);
                        for (const sp of spLines) {
                          const spQty =
                            (Number(line.effective_qty) * qty * Number(sp.qty_per_batch)) / Number(sp.batch_yield_qty);
                          usageMap.set(sp.ingredient_sku_id, (usageMap.get(sp.ingredient_sku_id) ?? 0) + spQty);
                        }
                      } else {
                        usageMap.set(line.sku_id, (usageMap.get(line.sku_id) ?? 0) + Number(line.effective_qty) * qty);
                      }
                    }
                  }
                } else if (rule.rule_type === "add") {
                  if (rule.sku_id) {
                    usageMap.set(rule.sku_id, (usageMap.get(rule.sku_id) ?? 0) + Number(rule.qty_per_match) * qty);
                  }
                }
              }
            }

            const skuUsage = usageMap.get(skuId) ?? 0;
            if (skuUsage > 0) usageByDate.set(date, skuUsage);
          }

          // Step 4 — Calculate daily receipts per day
          const converter = sku.converter ?? 1;
          const receiptsByDate = new Map<string, { ck: number; ext: number }>();
          for (const r of receipts) {
            const date = r.receipt_date;
            const entry = receiptsByDate.get(date) ?? { ck: 0, ext: 0 };
            if (r.transfer_order_id) {
              entry.ck += Number(r.qty_received);
            } else {
              entry.ext += Number(r.qty_received) * converter;
            }
            receiptsByDate.set(date, entry);
          }

          // DSC rows by date for physical counts and waste
          const dscByDate = new Map<string, any>();
          for (const row of dscRows) {
            if (row.is_submitted && row.physical_count !== null) {
              dscByDate.set(row.count_date, row);
            }
          }

          // Step 5 — Build day-by-day ledger
          const today = new Date().toISOString().slice(0, 10);
          const allDates: string[] = [];
          const d = new Date(resolvedStartDate);
          const end = new Date(today);
          while (d <= end) {
            allDates.push(d.toISOString().slice(0, 10));
            d.setDate(d.getDate() + 1);
          }

          const ledger: BranchCountRow[] = [];
          let prevBalance = 0;

          for (const date of allDates) {
            const rec = receiptsByDate.get(date) ?? { ck: 0, ext: 0 };
            const totalReceived = rec.ck + rec.ext;
            const usage = usageByDate.get(date) ?? 0;
            const dsc = dscByDate.get(date);
            const waste = dsc ? Number(dsc.waste) : 0;
            const hasPhysical = !!dsc;
            const physicalCount = hasPhysical ? Number(dsc.physical_count) : null;

            const opening = prevBalance;
            const calcBal = opening + totalReceived - usage - waste;

            // Only include days with activity
            if (totalReceived === 0 && usage === 0 && !hasPhysical && waste === 0) {
              // No movement — skip but keep prevBalance
              continue;
            }

            const variance = physicalCount !== null ? physicalCount - calcBal : 0;

            ledger.push({
              count_date: date,
              opening_balance: opening,
              received_from_ck: rec.ck,
              received_external: rec.ext,
              expected_usage: usage,
              waste,
              calculated_balance: calcBal,
              physical_count: physicalCount,
              variance,
            });

            // Snap balance to physical if available
            prevBalance = physicalCount !== null ? physicalCount : calcBal;
          }

          setBranchRows(ledger);
        } else if (skuType === "RM") {
          const [obRes, receiptsRes, adjRes, suppRes] = await Promise.all([
            supabase.from("stock_opening_balances").select("quantity").eq("sku_id", skuId).maybeSingle(),
            supabase
              .from("goods_receipts")
              .select("receipt_date, quantity_received, supplier_id, created_at")
              .eq("sku_id", skuId)
              .gte("receipt_date", fromDate)
              .order("receipt_date", { ascending: true })
              .order("created_at", { ascending: true }),
            supabase
              .from("stock_adjustments")
              .select("adjustment_date, quantity, reason, created_at")
              .eq("sku_id", skuId)
              .eq("stock_type", "RM")
              .gte("adjustment_date", fromDate)
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
              timestamp: r.created_at,
            });
          });

          (adjRes.data ?? []).forEach((a) => {
            const classified = classifyAdjustment(a.quantity, a.reason, skus);
            mvts.push({
              ...classified,
              date: a.adjustment_date,
              sortKey: `${a.adjustment_date}|${a.created_at}`,
              timestamp: a.created_at,
            });
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
          // SM — anchor-based ledger matching useSmStockData logic
          // Step 1: Find latest completed stock count for this SKU (two-step query)
          const { data: completedSessions } = await supabase
            .from("stock_count_sessions")
            .select("id, count_date, completed_at")
            .eq("status", "Completed")
            .is("deleted_at", null);
          if (cancelled) return;

          const sessionIds = (completedSessions || []).map((s: any) => s.id);
          const sessionDateMap: Record<string, string> = {};
          for (const s of completedSessions || []) sessionDateMap[s.id] = s.count_date;

          let anchorDate: string | null = null;
          let anchorQty = 0;
          let anchorCompletedAt: string | null = null;

          if (sessionIds.length > 0) {
            const { data: anchorLines } = await supabase
              .from("stock_count_lines")
              .select("physical_qty, session_id")
              .eq("sku_id", skuId)
              .eq("type", "SM")
              .in("session_id", sessionIds)
              .not("physical_qty", "is", null);
            if (cancelled) return;

            const sessionCompletedAtMap: Record<string, string> = {};
            for (const s of completedSessions || []) {
              if (s.completed_at) sessionCompletedAtMap[s.id] = s.completed_at;
            }

            for (const row of anchorLines ?? []) {
              const cd = sessionDateMap[row.session_id];
              if (!cd) continue;
              if (!anchorDate || cd > anchorDate) {
                anchorDate = cd;
                anchorQty = row.physical_qty!;
                anchorCompletedAt = sessionCompletedAtMap[row.session_id] ?? null;
              }
            }
          }

          // Step 2: Fetch all transactions within daysBack window
          const [obRes, prodRes, toRes, adjRes] = await Promise.all([
            anchorDate
              ? Promise.resolve({ data: null })
              : supabase.from("stock_opening_balances").select("quantity").eq("sku_id", skuId).maybeSingle(),
            supabase
              .from("production_records")
              .select("production_date, actual_output_g, batches_produced, created_at")
              .eq("sm_sku_id", skuId)
              .gte("production_date", fromDate)
              .order("production_date", { ascending: true })
              .order("created_at", { ascending: true }),
            supabase
              .from("transfer_order_lines")
              .select(
                "id, actual_qty, planned_qty, transfer_orders!inner(to_number, delivery_date, status, updated_at, branches(branch_name))",
              )
              .eq("sku_id", skuId)
              .in("transfer_orders.status", ["Sent", "Received"])
              .gte("transfer_orders.delivery_date", fromDate),
            supabase
              .from("stock_adjustments")
              .select("adjustment_date, quantity, reason, created_at")
              .eq("sku_id", skuId)
              .eq("stock_type", "SM")
              .gte("adjustment_date", fromDate)
              .order("adjustment_date", { ascending: true })
              .order("created_at", { ascending: true }),
          ]);
          if (cancelled) return;

          const mvts: Movement[] = [];

          if (anchorDate) {
            // Anchor-based: start from physical count
            mvts.push({
              date: anchorDate,
              sortKey: `${anchorDate}|${anchorCompletedAt ?? anchorDate}`,
              type: "StockCount",
              reference: "Physical count",
              qtyIn: anchorQty,
              qtyOut: null,
              timestamp: anchorCompletedAt ?? undefined,
            });
          } else {
            // Fallback: opening balance
            const openingQty = obRes.data?.quantity ?? 0;
            mvts.push({
              date: "—",
              sortKey: "0000-00-00",
              type: "Opening",
              reference: "—",
              qtyIn: openingQty > 0 ? openingQty : null,
              qtyOut: null,
            });
          }

          (prodRes.data ?? []).forEach((p) => {
            if (anchorDate && p.production_date < anchorDate) return;
            mvts.push({
              date: p.production_date,
              sortKey: `${p.production_date}|${p.created_at}`,
              type: "Production",
              reference: `${p.batches_produced} batch${p.batches_produced > 1 ? "es" : ""}`,
              qtyIn: p.actual_output_g,
              qtyOut: null,
              timestamp: p.created_at,
            });
          });

          // Fetch lot lines for all TO lines in one batched query
          const toLines = toRes.data ?? [];
          const toLineIds = toLines.map((l: any) => l.id).filter(Boolean);
          let lotLookup: Record<string, { production_date: string; packs: number }[]> = {};
          if (toLineIds.length > 0) {
            const { data: lotData } = await supabase
              .from("transfer_order_lot_lines")
              .select("to_line_id, production_date, packs")
              .in("to_line_id", toLineIds);
            if (cancelled) return;
            for (const lot of lotData ?? []) {
              const arr = lotLookup[lot.to_line_id] ?? [];
              arr.push({ production_date: lot.production_date, packs: lot.packs });
              lotLookup[lot.to_line_id] = arr;
            }
          }

          toLines.forEach((line: any) => {
            const to = line.transfer_orders;
            if (!to) return;
            if (anchorDate && to.delivery_date < anchorDate) return;
            const qty = line.actual_qty > 0 ? line.actual_qty : line.planned_qty;
            const branchName = to.branches?.branch_name ?? "";
            const lots = lotLookup[line.id] ?? [];
            let lotText = "";
            if (lots.length > 0) {
              lotText = lots
                .sort((a, b) => a.production_date.localeCompare(b.production_date))
                .map((l) => {
                  const d = new Date(l.production_date);
                  return `${d.getDate()}/${d.getMonth() + 1} ×${l.packs}`;
                })
                .join(", ");
            }
            mvts.push({
              date: to.delivery_date,
              sortKey: `${to.delivery_date}|${to.updated_at ?? to.delivery_date}`,
              type: "Delivery",
              reference: `${to.to_number} · ${branchName}`,
              qtyIn: null,
              qtyOut: qty,
              lotText: lotText || undefined,
              timestamp: to.updated_at ?? undefined,
            });
          });

          // Filter out Stock Count adjustments when anchor exists
          (adjRes.data ?? []).forEach((a) => {
            if (anchorDate && a.adjustment_date <= anchorDate && (a.reason || "").includes("Stock Count")) return;
            if (anchorDate && a.adjustment_date < anchorDate) return;
            const classified = classifyAdjustment(a.quantity, a.reason, skus);
            mvts.push({
              ...classified,
              date: a.adjustment_date,
              sortKey: `${a.adjustment_date}|${a.created_at}`,
              timestamp: a.created_at,
            });
          });

          const sorted = [...mvts].sort((a, b) => a.sortKey.localeCompare(b.sortKey));

          let bal = 0;
          sorted.forEach((m) => {
            bal += (m.qtyIn ?? 0) - (m.qtyOut ?? 0);
            m.runningBalance = bal;
          });

          setMovements(sorted);
          // Store anchor date for footer display
          setSmAnchorDate(anchorDate);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetch();
    return () => {
      cancelled = true;
    };
  }, [skuId, skuType, sku.converter, skus, context, branchId, daysBack]);

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
      <div className="fixed inset-y-0 right-0 z-[1000] flex flex-col bg-background border-l shadow-xl w-[660px]">
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
              {fmt0(context === "branch" ? Number(branchCurrentStock) : currentStock)}{" "}
              <span className="text-xs font-normal text-muted-foreground">{sku.usageUom}</span>
            </div>
          </div>
          {context === "ck" && (
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
          ) : context === "branch" ? (
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
                          <td className={table.dataCellCompactMono}>
                            {received > 0 ? (
                              received.toLocaleString()
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className={table.dataCellCompactMono}>
                            {Number(r.expected_usage) > 0 ? (
                              fmt0(Number(r.expected_usage))
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className={table.dataCellCompactMono}>
                            {Number(r.waste) > 0 ? (
                              fmt0(Number(r.waste))
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className={`${table.dataCellCompactMono} font-semibold`}>
                            {fmt0(Number(r.calculated_balance))}
                          </td>
                          <td className={table.dataCellCompactMono}>
                            {hasPhysical ? (
                              <span className="font-semibold">{fmt0(Number(r.physical_count))}</span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className={table.dataCellCompactMono}>
                            {hasPhysical ? (
                              <span
                                className={
                                  variance > 0
                                    ? "text-success"
                                    : variance < 0
                                      ? "text-destructive"
                                      : "text-muted-foreground"
                                }
                              >
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
              <div className="mt-3 text-xs text-muted-foreground">
                {daysBack === 14 ? (
                  <>
                    Showing last 14 days ·{" "}
                    <button className="underline hover:text-foreground" onClick={() => setDaysBack(30)}>
                      Load 30 days
                    </button>
                  </>
                ) : daysBack === 30 ? (
                  <>
                    Showing last 30 days ·{" "}
                    <button className="underline hover:text-foreground" onClick={() => setDaysBack(3650)}>
                      Load all history
                    </button>
                  </>
                ) : (
                  <>Showing all history</>
                )}
              </div>
            </>
          ) : (
            /* ─── CK context table (existing) ─── */
            <>
              <table className="w-full table-fixed text-xs">
                <colgroup>
                  <col style={{ width: "100px" }} />
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
                      <td className={table.dataCellCompact}>{formatDateCompact(m.date, m.timestamp)}</td>
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
                        {m.lotText && (
                          <span className="block truncate text-[10px] text-muted-foreground mt-0.5" title={m.lotText}>
                            {m.lotText}
                          </span>
                        )}
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

              <div className="mt-3 text-xs text-muted-foreground">
                {skuType === "SM" && smAnchorDate ? (
                  <>Showing movements since last count · {formatDateCompact(smAnchorDate)}</>
                ) : daysBack === 14 ? (
                  <>
                    Showing last 14 days ·{" "}
                    <button className="underline hover:text-foreground" onClick={() => setDaysBack(30)}>
                      Load 30 days
                    </button>
                  </>
                ) : daysBack === 30 ? (
                  <>
                    Showing last 30 days ·{" "}
                    <button className="underline hover:text-foreground" onClick={() => setDaysBack(3650)}>
                      Load all history
                    </button>
                  </>
                ) : (
                  <>Showing all history</>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
