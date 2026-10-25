import { fetchAllRows } from "@/lib/fetch-all";
import { useState, useCallback, useEffect, useRef } from "react";
import { ruleMatchesSale } from "@/lib/modifier-rules";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { toLocalDateStr } from "@/lib/utils";
import { SKU } from "@/types/sku";
import { MenuBomLine } from "@/types/menu-bom";
import { ModifierRule } from "@/types/modifier-rule";
import { SpBomLine } from "@/types/sp-bom";
import { Menu } from "@/types/menu";
import { Branch } from "@/types/branch";

export interface AdjDetail {
  quantity: number;
  reason: string;
}

export interface DailyStockCountRow {
  id: string;
  branchId: string;
  countDate: string;
  skuId: string;
  openingBalance: number;
  receivedFromCk: number;
  receivedExternal: number;
  expectedUsage: number;
  waste: number;
  calculatedBalance: number;
  physicalCount: number | null;
  variance: number;
  isSubmitted: boolean;
  submittedAt: string | null;
  adjNet: number;
  adjDetails: AdjDetail[];
}

const toLocal = (r: any): DailyStockCountRow => ({
  id: r.id,
  branchId: r.branch_id,
  countDate: r.count_date,
  skuId: r.sku_id,
  openingBalance: Number(r.opening_balance),
  receivedFromCk: Number(r.received_from_ck),
  receivedExternal: Number(r.received_external),
  expectedUsage: Number(r.expected_usage),
  waste: Number(r.waste ?? 0),
  calculatedBalance: Number(r.calculated_balance),
  physicalCount: r.physical_count !== null ? Number(r.physical_count) : null,
  variance: Number(r.variance),
  isSubmitted: r.is_submitted,
  submittedAt: r.submitted_at,
  adjNet: 0,
  adjDetails: [],
});

interface UseDailyStockCountProps {
  skus: SKU[];
  menuBomLines: MenuBomLine[];
  modifierRules: ModifierRule[];
  spBomLines: SpBomLine[];
  menus: Menu[];
  branches: Branch[];
}

export function useDailyStockCount({
  skus,
  menuBomLines,
  modifierRules,
  spBomLines,
  menus,
  branches,
}: UseDailyStockCountProps) {
  const [rows, setRows] = useState<DailyStockCountRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);

  // Helper: compute branch-relevant SKU IDs from menus → BOM → SP expansion
  const getBranchRelevantSkuIds = useCallback(
    (branchId: string): Set<string> => {
      const branch = branches.find((b) => b.id === branchId);
      if (!branch) return new Set();
      const brandName = branch.brandName;
      const brandMenuIds = new Set(
        menus.filter((m) => m.brandName === brandName && m.status === "Active").map((m) => m.id),
      );
      const filteredLines = menuBomLines.filter(
        (l) => brandMenuIds.has(l.menuId) && (l.branchId === null || l.branchId === branchId),
      );
      const relevantSkuIds = new Set<string>();
      const skuMap = new Map<string, SKU>();
      skus.forEach((s) => skuMap.set(s.id, s));
      for (const line of filteredLines) {
        const sku = skuMap.get(line.skuId);
        if (sku && sku.type === "SP") {
          const spLines = spBomLines.filter((l) => l.spSkuId === line.skuId);
          for (const spLine of spLines) relevantSkuIds.add(spLine.ingredientSkuId);
        } else {
          relevantSkuIds.add(line.skuId);
        }
      }
      return relevantSkuIds;
    },
    [branches, menus, menuBomLines, spBomLines, skus],
  );

  // Helper: get converter for purchase→usage UOM conversion
  const getSkuConverter = useCallback(
    (skuId: string): number => {
      const sku = skus.find((s) => s.id === skuId);
      if (!sku) return 1;
      // Only convert when purchase and usage UOM differ
      if (sku.purchaseUom === sku.usageUom) return 1;
      return sku.converter || 1;
    },
    [skus],
  );

  // Helper: calculate expected usage from sales across a date range, broken down by date
  // Returns: Record<saleDate, Record<skuId, usageQty>>
  const calculateExpectedUsageRangeByDate = useCallback(
    async (branchId: string, fromDate: string, toDate: string): Promise<Record<string, Record<string, number>>> => {
      const [salesRes, overridesRes] = await Promise.all([
        fetchAllRows((a, b) =>
          supabase
            .from("sales_entries")
            .select("*")
            .eq("branch_id", branchId)
            .gt("sale_date", fromDate)
            .lt("sale_date", toDate)
            .order("id")
            .range(a, b),
        ),
        supabase
          .from("branch_menu_overrides")
          .select("menu_id, is_active")
          .eq("branch_id", branchId)
          .eq("is_active", false),
      ]);

      const suppressedMenuIds = new Set((overridesRes.data || []).map((o) => o.menu_id));

      const sales = salesRes.data || [];
      if (sales.length === 0) return {};

      const menuByCode = new Map<string, Menu>();
      menus.forEach((m) => menuByCode.set(m.menuCode, m));

      const filteredLines = menuBomLines.filter((l) => l.branchId === null || l.branchId === branchId);
      const bomByMenuId = new Map<string, MenuBomLine[]>();
      filteredLines.forEach((l) => {
        const arr = bomByMenuId.get(l.menuId) || [];
        arr.push(l);
        bomByMenuId.set(l.menuId, arr);
      });

      const activeRules = modifierRules.filter((r) => {
        if (!r.isActive) return false;
        if (r.branchIds && r.branchIds.length > 0 && !r.branchIds.includes(branchId)) return false;
        return true;
      });

      const spBomBySpSku = new Map<string, SpBomLine[]>();
      spBomLines.forEach((l) => {
        const arr = spBomBySpSku.get(l.spSkuId) || [];
        arr.push(l);
        spBomBySpSku.set(l.spSkuId, arr);
      });

      const skuMap = new Map<string, SKU>();
      skus.forEach((s) => skuMap.set(s.id, s));

      // Per-date usage: date → skuId → qty
      const usageByDate: Record<string, Record<string, number>> = {};
      const addUsage = (date: string, skuId: string, qty: number) => {
        if (!usageByDate[date]) usageByDate[date] = {};
        usageByDate[date][skuId] = (usageByDate[date][skuId] || 0) + qty;
      };

      for (const sale of sales) {
        const qty = Number(sale.qty) || 0;
        if (qty === 0) continue;

        const saleDate = sale.sale_date;
        const menuCode = sale.menu_code;
        const menuName = sale.menu_name || "";
        const menu = menuByCode.get(menuCode);

        // A menu closed at this branch still uses stock when the POS sold it
        if (menu) {
          const bomLines = bomByMenuId.get(menu.id) || [];
          for (const line of bomLines) {
            const ingredientQty = line.effectiveQty * qty;
            const sku = skuMap.get(line.skuId);
            if (sku && sku.type === "SP") {
              const spLines = spBomBySpSku.get(line.skuId) || [];
              for (const spLine of spLines) {
                addUsage(saleDate, spLine.ingredientSkuId, (spLine.qtyPerBatch / spLine.batchYieldQty) * ingredientQty);
              }
            } else {
              addUsage(saleDate, line.skuId, ingredientQty);
            }
          }

          for (const rule of activeRules) {
            if (rule.menuIds.length > 0 && !rule.menuIds.includes(menu.id)) continue;
            if (ruleMatchesSale(rule, sale)) {
              if (rule.ruleType === "swap") {
                if (rule.swapSkuId) {
                  const bomLines2 = bomByMenuId.get(menu.id) || [];
                  for (const line of bomLines2) {
                    if (line.skuId === rule.swapSkuId) {
                      addUsage(saleDate, rule.swapSkuId, -(line.effectiveQty * qty));
                    }
                  }
                }
                const modQty = rule.qtyPerMatch * qty;
                const modSku = skuMap.get(rule.skuId);
                if (modSku && modSku.type === "SP") {
                  const spLines = spBomBySpSku.get(rule.skuId) || [];
                  for (const spLine of spLines) {
                    addUsage(saleDate, spLine.ingredientSkuId, (spLine.qtyPerBatch / spLine.batchYieldQty) * modQty);
                  }
                } else {
                  addUsage(saleDate, rule.skuId, modQty);
                }
              } else if (rule.ruleType === "submenu") {
                if (rule.submenuId) {
                  const subBomLines = bomByMenuId.get(rule.submenuId) || [];
                  for (const line of subBomLines) {
                    const ingredientQty2 = line.effectiveQty * qty;
                    const sku2 = skuMap.get(line.skuId);
                    if (sku2 && sku2.type === "SP") {
                      const spLines = spBomBySpSku.get(line.skuId) || [];
                      for (const spLine of spLines) {
                        addUsage(
                          saleDate,
                          spLine.ingredientSkuId,
                          (spLine.qtyPerBatch / spLine.batchYieldQty) * ingredientQty2,
                        );
                      }
                    } else {
                      addUsage(saleDate, line.skuId, ingredientQty2);
                    }
                  }
                }
              } else {
                const modQty = rule.qtyPerMatch * qty;
                const modSku = skuMap.get(rule.skuId);
                if (modSku && modSku.type === "SP") {
                  const spLines = spBomBySpSku.get(rule.skuId) || [];
                  for (const spLine of spLines) {
                    addUsage(saleDate, spLine.ingredientSkuId, (spLine.qtyPerBatch / spLine.batchYieldQty) * modQty);
                  }
                } else {
                  addUsage(saleDate, rule.skuId, modQty);
                }
              }
            }
          }
        }
      }

      return usageByDate;
    },
    [menus, menuBomLines, modifierRules, spBomLines, skus],
  );

  // Gap-resilient opening balance: reconstructs from last submitted count + gap transactions
  const computeOpeningWithGap = useCallback(
    async (branchId: string, beforeDate: string): Promise<Record<string, number>> => {
      // Step 1 — Find most recent count per SKU (submitted or not — calculated_balance is valid regardless).
      // The last 14 days first (paged: one sheet is ~124 rows, so a single request
      // used to stop at ~8 days); then, for products with no physical count in that
      // window, their latest physical count further back. Without this a product
      // last counted more than ~8 days ago started from 0.
      const recentFrom = new Date(`${beforeDate}T00:00:00`);
      recentFrom.setDate(recentFrom.getDate() - 14);
      const { data: recentCounts } = await fetchAllRows((a, b) =>
        supabase
          .from("daily_stock_counts")
          .select("id, sku_id, physical_count, calculated_balance, count_date")
          .eq("branch_id", branchId)
          .lt("count_date", beforeDate)
          .gte("count_date", toLocalDateStr(recentFrom))
          .order("count_date", { ascending: false })
          .order("id")
          .range(a, b),
      );
      const countedRecently = new Set((recentCounts as any[]).filter((r) => r.physical_count !== null).map((r) => r.sku_id));
      const olderNeeded = [...new Set((recentCounts as any[]).map((r) => r.sku_id))].filter((id) => !countedRecently.has(id));
      let olderCounts: any[] = [];
      if (olderNeeded.length) {
        const { data } = await fetchAllRows((a, b) =>
          supabase
            .from("daily_stock_counts")
            .select("id, sku_id, physical_count, calculated_balance, count_date")
            .eq("branch_id", branchId)
            .lt("count_date", toLocalDateStr(recentFrom))
            .not("physical_count", "is", null)
            .in("sku_id", olderNeeded)
            .order("count_date", { ascending: false })
            .order("id")
            .range(a, b),
        );
        olderCounts = data as any[];
      }
      // Latest physical count wins; a product never counted keeps its latest calculated row
      const allCounts = [...(recentCounts as any[]), ...olderCounts].sort((x, y) => (x.count_date < y.count_date ? 1 : x.count_date > y.count_date ? -1 : 0));

      const lastCountBySku = new Map<string, any>();
      allCounts.forEach((r) => {
        if (lastCountBySku.has(r.sku_id)) return;
        if (r.physical_count !== null) {
          lastCountBySku.set(r.sku_id, r);
        }
      });
      allCounts.forEach((r) => {
        if (!lastCountBySku.has(r.sku_id)) {
          lastCountBySku.set(r.sku_id, r);
        }
      });
      const baseOpening: Record<string, number> = {};
      const lastCountDate: Record<string, string> = {};
      lastCountBySku.forEach((r, skuId) => {
        baseOpening[skuId] = Math.max(
          0,
          r.physical_count !== null ? Number(r.physical_count) : Number(r.calculated_balance),
        );
        lastCountDate[skuId] = r.count_date;
      });

      // Step 2 — Find earliest last count date for range query
      const gapStartDate =
        lastCountBySku.size > 0
          ? [...lastCountBySku.values()].reduce(
              (min, r) => (r.count_date < min ? r.count_date : min),
              [...lastCountBySku.values()][0].count_date,
            )
          : beforeDate;

      // Step 3 — Fetch gap transactions + calculate usage from raw sales (per-date)
      const [gapCkLinesRes, gapExtLinesRes, gapUsageByDate, gapAdjLinesRes] = await Promise.all([
        fetchAllRows((a, b) =>
          supabase
            .from("branch_receipts")
            .select("id, sku_id, qty_received, receipt_date")
            .eq("branch_id", branchId)
            .not("transfer_order_id", "is", null)
            .gt("receipt_date", gapStartDate)
            .lt("receipt_date", beforeDate)
            .order("id")
            .range(a, b),
        ),
        fetchAllRows((a, b) =>
          supabase
            .from("branch_receipts")
            .select("id, sku_id, qty_received, receipt_date")
            .eq("branch_id", branchId)
            .is("transfer_order_id", null)
            .gt("receipt_date", gapStartDate)
            .lt("receipt_date", beforeDate)
            .order("id")
            .range(a, b),
        ),
        calculateExpectedUsageRangeByDate(branchId, gapStartDate, beforeDate),
        fetchAllRows((a, b) =>
          supabase
            .from("stock_adjustments")
            .select("id, sku_id, quantity, adjustment_date, reason")
            .eq("branch_id", branchId)
            .gt("adjustment_date", gapStartDate)
            .lt("adjustment_date", beforeDate)
            .order("id")
            .range(a, b),
        ),
      ]);

      // Build per-SKU gap totals filtered by each SKU's own anchor date
      // CK receipts: group by sku, only include lines where receipt_date > SKU's anchor
      const gapCkBySku: Record<string, number> = {};
      (gapCkLinesRes.data || []).forEach((r: any) => {
        const anchor = lastCountDate[r.sku_id];
        if (anchor && r.receipt_date && r.receipt_date <= anchor) return;
        gapCkBySku[r.sku_id] = (gapCkBySku[r.sku_id] || 0) + Number(r.qty_received);
      });

      // External receipts: group by sku, only include lines where receipt_date > SKU's anchor
      const gapExtBySku: Record<string, number> = {};
      (gapExtLinesRes.data || []).forEach((r: any) => {
        const anchor = lastCountDate[r.sku_id];
        if (anchor && r.receipt_date && r.receipt_date <= anchor) return;
        gapExtBySku[r.sku_id] = (gapExtBySku[r.sku_id] || 0) + Number(r.qty_received);
      });

      // Stock adjustments: group by sku, only include rows where adjustment_date > SKU's anchor.
      // Also exclude "Stock Count" reason rows, matching the CK-side canonical formulas
      // (use-sm-stock-data.ts / use-stock-data.ts / use-pk-stock-data.ts) — currently a no-op
      // here since branch-level adjustments are only ever written by StoreStock.tsx's fixed
      // reason enum (never "Stock Count"), but kept as a defensive guard against future drift.
      const gapAdjBySku: Record<string, number> = {};
      (gapAdjLinesRes.data || []).forEach((r: any) => {
        const anchor = lastCountDate[r.sku_id];
        if (anchor && r.adjustment_date && r.adjustment_date <= anchor) return;
        if ((r.reason ?? "").includes("Stock Count")) return;
        gapAdjBySku[r.sku_id] = (gapAdjBySku[r.sku_id] || 0) + Number(r.quantity);
      });

      // Usage: sum per-date usage only for dates > SKU's anchor
      const gapUsageBySku: Record<string, number> = {};
      const allUsageSkuIds = new Set<string>();
      for (const dateStr of Object.keys(gapUsageByDate)) {
        for (const skuId of Object.keys(gapUsageByDate[dateStr])) {
          allUsageSkuIds.add(skuId);
          const anchor = lastCountDate[skuId];
          if (anchor && dateStr <= anchor) continue; // skip if before/on anchor
          gapUsageBySku[skuId] = (gapUsageBySku[skuId] || 0) + gapUsageByDate[dateStr][skuId];
        }
      }

      // waste from gap = 0 (no count sheet data available for it)

      // Step 4 — Compute final opening per SKU
      const result: Record<string, number> = {};
      const allSkuIds = new Set([
        ...Object.keys(baseOpening),
        ...Object.keys(gapCkBySku),
        ...Object.keys(gapExtBySku),
        ...Object.keys(gapAdjBySku),
        ...Object.keys(gapUsageBySku),
      ]);

      allSkuIds.forEach((skuId) => {
        const base = baseOpening[skuId] ?? 0;
        const ck = gapCkBySku[skuId] ?? 0;
        const ext = gapExtBySku[skuId] ?? 0;
        const extConv = getSkuConverter(skuId);
        const adj = gapAdjBySku[skuId] ?? 0;
        const usage = gapUsageBySku[skuId] ?? 0;
        result[skuId] = Math.max(0, base + ck + ext * extConv + adj - usage);
      });

      return result;
    },
    [getSkuConverter, calculateExpectedUsageRangeByDate],
  );

  // Fetch live receipt totals for a branch+date
  const fetchReceiptTotals = useCallback(
    async (branchId: string, date: string) => {
      const branch = branches.find((b) => b.id === branchId);
      const branchName = branch?.branchName || "";

      const { data: brData } = await supabase
        .from("branch_receipts")
        .select("sku_id, qty_received")
        .eq("branch_id", branchId)
        .eq("receipt_date", date)
        .is("transfer_order_id", null);

      const extBySku: Record<string, number> = {};
      (brData || []).forEach((r) => {
        // Store raw qty_received (Purchase UOM) for display; converter applied in calcBalance only
        extBySku[r.sku_id] = (extBySku[r.sku_id] || 0) + Number(r.qty_received);
      });

      // FROM CK: read from branch_receipts where transfer_order_id IS NOT NULL
      const { data: ckData } = await supabase
        .from("branch_receipts")
        .select("sku_id, qty_received")
        .eq("branch_id", branchId)
        .eq("receipt_date", date)
        .not("transfer_order_id", "is", null);

      const ckBySku: Record<string, number> = {};
      (ckData || []).forEach((r) => {
        ckBySku[r.sku_id] = (ckBySku[r.sku_id] || 0) + Number(r.qty_received);
      });

      return { extBySku, ckBySku };
    },
    [branches, getSkuConverter],
  );

  // Calculate expected usage from sales data × current BOM
  const calculateExpectedUsage = useCallback(
    async (branchId: string, date: string): Promise<Record<string, number>> => {
      const [salesRes, overridesRes] = await Promise.all([
        supabase.from("sales_entries").select("*").eq("branch_id", branchId).eq("sale_date", date),
        supabase
          .from("branch_menu_overrides")
          .select("menu_id, is_active")
          .eq("branch_id", branchId)
          .eq("is_active", false),
      ]);

      const suppressedMenuIds = new Set((overridesRes.data || []).map((o) => o.menu_id));

      const sales = salesRes.data || [];
      if (sales.length === 0) return {};

      const menuByCode = new Map<string, Menu>();
      menus.forEach((m) => menuByCode.set(m.menuCode, m));

      const filteredLines = menuBomLines.filter((l) => l.branchId === null || l.branchId === branchId);
      const bomByMenuId = new Map<string, MenuBomLine[]>();
      filteredLines.forEach((l) => {
        const arr = bomByMenuId.get(l.menuId) || [];
        arr.push(l);
        bomByMenuId.set(l.menuId, arr);
      });

      const activeRules = modifierRules.filter((r) => {
        if (!r.isActive) return false;
        if (r.branchIds && r.branchIds.length > 0 && !r.branchIds.includes(branchId)) return false;
        return true;
      });

      const spBomBySpSku = new Map<string, SpBomLine[]>();
      spBomLines.forEach((l) => {
        const arr = spBomBySpSku.get(l.spSkuId) || [];
        arr.push(l);
        spBomBySpSku.set(l.spSkuId, arr);
      });

      const skuMap = new Map<string, SKU>();
      skus.forEach((s) => skuMap.set(s.id, s));

      const usage: Record<string, number> = {};
      const addUsage = (skuId: string, qty: number) => {
        usage[skuId] = (usage[skuId] || 0) + qty;
      };

      for (const sale of sales) {
        const qty = Number(sale.qty) || 0;
        if (qty === 0) continue;

        const menuCode = sale.menu_code;
        const menuName = sale.menu_name || "";
        const menu = menuByCode.get(menuCode);

        // A menu closed at this branch still uses stock when the POS sold it
        if (menu) {
          const bomLines = bomByMenuId.get(menu.id) || [];
          for (const line of bomLines) {
            const ingredientQty = line.effectiveQty * qty;
            const sku = skuMap.get(line.skuId);

            if (sku && sku.type === "SP") {
              const spLines = spBomBySpSku.get(line.skuId) || [];
              for (const spLine of spLines) {
                const rmQty = (spLine.qtyPerBatch / spLine.batchYieldQty) * ingredientQty;
                addUsage(spLine.ingredientSkuId, rmQty);
              }
            } else {
              addUsage(line.skuId, ingredientQty);
            }
          }

          for (const rule of activeRules) {
            if (rule.menuIds.length > 0 && !rule.menuIds.includes(menu.id)) continue;
            if (ruleMatchesSale(rule, sale)) {
              if (rule.ruleType === "swap") {
                // Remove the swap SKU's BOM qty for this menu
                if (rule.swapSkuId) {
                  const bomLines2 = bomByMenuId.get(menu.id) || [];
                  for (const line of bomLines2) {
                    if (line.skuId === rule.swapSkuId) {
                      const removeQty = line.effectiveQty * qty;
                      addUsage(rule.swapSkuId, -removeQty);
                    }
                  }
                }
                // Add replacement SKU
                const modQty = rule.qtyPerMatch * qty;
                const modSku = skuMap.get(rule.skuId);
                if (modSku && modSku.type === "SP") {
                  const spLines = spBomBySpSku.get(rule.skuId) || [];
                  for (const spLine of spLines) {
                    addUsage(spLine.ingredientSkuId, (spLine.qtyPerBatch / spLine.batchYieldQty) * modQty);
                  }
                } else {
                  addUsage(rule.skuId, modQty);
                }
              } else if (rule.ruleType === "submenu") {
                // Expand the submenu's BOM
                if (rule.submenuId) {
                  const subBomLines = bomByMenuId.get(rule.submenuId) || [];
                  for (const line of subBomLines) {
                    const ingredientQty2 = line.effectiveQty * qty;
                    const sku2 = skuMap.get(line.skuId);
                    if (sku2 && sku2.type === "SP") {
                      const spLines = spBomBySpSku.get(line.skuId) || [];
                      for (const spLine of spLines) {
                        addUsage(spLine.ingredientSkuId, (spLine.qtyPerBatch / spLine.batchYieldQty) * ingredientQty2);
                      }
                    } else {
                      addUsage(line.skuId, ingredientQty2);
                    }
                  }
                }
              } else {
                // ADD type (existing behavior)
                const modQty = rule.qtyPerMatch * qty;
                const modSku = skuMap.get(rule.skuId);
                if (modSku && modSku.type === "SP") {
                  const spLines = spBomBySpSku.get(rule.skuId) || [];
                  for (const spLine of spLines) {
                    addUsage(spLine.ingredientSkuId, (spLine.qtyPerBatch / spLine.batchYieldQty) * modQty);
                  }
                } else {
                  addUsage(rule.skuId, modQty);
                }
              }
            }
          }
        }
      }

      return usage;
    },
    [menus, menuBomLines, modifierRules, spBomLines, skus],
  );

  // Load existing count sheet — recalculate received + expected usage live from current BOM
  const loadSheet = useCallback(
    async (branchId: string, date: string) => {
      setLoading(true);
      const [sheetResult, receipts, expectedUsage] = await Promise.all([
        supabase
          .from("daily_stock_counts")
          .select("*")
          .eq("branch_id", branchId)
          .eq("count_date", date)
          .order("created_at"),
        fetchReceiptTotals(branchId, date),
        calculateExpectedUsage(branchId, date),
      ]);

      if (sheetResult.error) {
        toast.error("Failed to load count sheet");
        setLoading(false);
        return;
      }
      const data = sheetResult.data || [];
      // No sheet yet: show nothing and create nothing. Opening a day used to create
      // its whole sheet, which left empty "not counted" sheets behind; a sheet is
      // now made only when counting starts (generateSheet)
      if (data.length === 0) {
        setRows([]);
        setLoading(false);
        return;
      }

      // Fetch gap-resilient opening balances
      const openingBySku = await computeOpeningWithGap(branchId, date);

      // Fetch branch adjustments for this date (adj_net term)
      const { data: adjRows } = await supabase
        .from("stock_adjustments")
        .select("sku_id, quantity, reason")
        .eq("branch_id", branchId)
        .eq("adjustment_date", date);

      // Build adj map: skuId → { net, details[] }
      const adjMap = new Map<string, { net: number; details: AdjDetail[] }>();
      for (const a of adjRows ?? []) {
        const entry = adjMap.get(a.sku_id) ?? { net: 0, details: [] };
        entry.net += Number(a.quantity);
        entry.details.push({ quantity: Number(a.quantity), reason: a.reason ?? "" });
        adjMap.set(a.sku_id, entry);
      }

      // Patch rows with live receipt data, live expected usage, corrected opening balance, and adj_net
      const patched = data.map((r) => {
        const ext = receipts.extBySku[r.sku_id] ?? Number(r.received_external);
        const ck = receipts.ckBySku[r.sku_id] ?? Number(r.received_from_ck);
        const expUsage = expectedUsage[r.sku_id] ?? 0;
        const waste = Number(r.waste ?? 0);
        // ext is raw Purchase UOM — apply converter for calcBalance (Usage UOM)
        const extConv = getSkuConverter(r.sku_id);
        const opening = openingBySku[r.sku_id] ?? Number(r.opening_balance);
        const adjEntry = adjMap.get(r.sku_id) ?? { net: 0, details: [] };
        const calcBalance = opening + ck + ext * extConv - expUsage - waste + adjEntry.net;
        const variance = r.physical_count !== null ? Number(r.physical_count) - calcBalance : 0;
        return {
          ...r,
          opening_balance: opening,
          received_external: ext,
          received_from_ck: ck,
          expected_usage: expUsage,
          calculated_balance: calcBalance,
          variance,
          adjNet: adjEntry.net,
          adjDetails: adjEntry.details,
        };
      });

      // Update DB in background for any changed rows
      const updates = patched.filter(
        (p, i) =>
          p.opening_balance !== Number(data[i].opening_balance) ||
          p.received_external !== Number(data[i].received_external) ||
          p.received_from_ck !== Number(data[i].received_from_ck) ||
          p.expected_usage !== Number(data[i].expected_usage),
      );
      // A finished (submitted) sheet is a record: opening it must not rewrite it
      const finished = data.length > 0 && data.every((r) => r.is_submitted);
      if (updates.length > 0 && !finished) {
        for (const u of updates) {
          supabase
            .from("daily_stock_counts")
            .update({
              opening_balance: u.opening_balance,
              received_external: u.received_external,
              received_from_ck: u.received_from_ck,
              expected_usage: u.expected_usage,
              calculated_balance: u.calculated_balance,
              variance: u.variance,
            })
            .eq("id", u.id)
            .then(() => {});
        }
      }

      // Add new SKU rows if BOM changes introduced new ingredients
      const existingSkuIds = new Set(data.map((r) => r.sku_id));
      const relevantSkuIds = getBranchRelevantSkuIds(branchId);
      const activeSkus = skus.filter(
        (s) => s.status === "Active" && (s.type === "RM" || s.type === "SM") && relevantSkuIds.has(s.id),
      );
      const newSkuRows: any[] = [];
      for (const sku of activeSkus) {
        if (!existingSkuIds.has(sku.id)) {
          const expUsage = expectedUsage[sku.id] ?? 0;
          const ext = receipts.extBySku[sku.id] ?? 0;
          const ck = receipts.ckBySku[sku.id] ?? 0;
          const extConvNew = getSkuConverter(sku.id);
          const openingNew = openingBySku[sku.id] ?? 0;
          const adjNew = adjMap.get(sku.id)?.net ?? 0;
          const calcBalance = openingNew + ck + ext * extConvNew - expUsage + adjNew;
          newSkuRows.push({
            branch_id: branchId,
            count_date: date,
            sku_id: sku.id,
            opening_balance: openingNew,
            received_from_ck: ck,
            received_external: ext,
            expected_usage: expUsage,
            waste: 0,
            calculated_balance: calcBalance,
            physical_count: null,
            variance: 0,
            is_submitted: false,
          });
        }
      }

      let insertedRows: any[] = [];
      if (newSkuRows.length > 0) {
        const { data: inserted } = await supabase.from("daily_stock_counts").insert(newSkuRows).select();
        if (inserted) insertedRows = inserted;
      }
      setLoading(false);
      // Merge adjNet/adjDetails into final rows (patched rows already have them; toLocal sets defaults for inserted)
      const patchedWithAdj = patched.map((r) => {
        const local = toLocal(r);
        local.adjNet = r.adjNet ?? 0;
        local.adjDetails = r.adjDetails ?? [];
        return local;
      });
      setRows([...patchedWithAdj, ...insertedRows.map(toLocal)]);
    },
    [fetchReceiptTotals, calculateExpectedUsage, skus, computeOpeningWithGap],
  );

  // Generate count sheet
  const generateSheet = useCallback(
    async (branchId: string, date: string) => {
      setGenerating(true);

      const { data: existing } = await supabase
        .from("daily_stock_counts")
        .select("id")
        .eq("branch_id", branchId)
        .eq("count_date", date)
        .limit(1);

      if (existing && existing.length > 0) {
        toast.info("Count sheet already exists, loading...");
        await loadSheet(branchId, date);
        setGenerating(false);
        return;
      }

      const [expectedUsage, receipts] = await Promise.all([
        calculateExpectedUsage(branchId, date),
        fetchReceiptTotals(branchId, date),
      ]);

      const openingBySku = await computeOpeningWithGap(branchId, date);

      // Fetch branch adjustments for this date (adj_net term)
      const { data: adjRows } = await supabase
        .from("stock_adjustments")
        .select("sku_id, quantity, reason")
        .eq("branch_id", branchId)
        .eq("adjustment_date", date);

      const adjMap = new Map<string, { net: number; details: AdjDetail[] }>();
      for (const a of adjRows ?? []) {
        const entry = adjMap.get(a.sku_id) ?? { net: 0, details: [] };
        entry.net += Number(a.quantity);
        entry.details.push({ quantity: Number(a.quantity), reason: a.reason ?? "" });
        adjMap.set(a.sku_id, entry);
      }

      const relevantSkuIds = getBranchRelevantSkuIds(branchId);
      const activeSkus = skus.filter(
        (s) => s.status === "Active" && (s.type === "RM" || s.type === "SM") && relevantSkuIds.has(s.id),
      );

      const insertRows = activeSkus.map((sku) => {
        const opening = openingBySku[sku.id] ?? 0;
        const fromCk = receipts.ckBySku[sku.id] ?? 0;
        const receivedExternal = receipts.extBySku[sku.id] ?? 0;
        const expUsage = expectedUsage[sku.id] ?? 0;
        const adjEntry = adjMap.get(sku.id) ?? { net: 0, details: [] };
        // ext is raw Purchase UOM — apply converter for calcBalance (Usage UOM)
        const extConv = getSkuConverter(sku.id);
        const calcBalance = opening + fromCk + receivedExternal * extConv - expUsage + adjEntry.net;

        return {
          branch_id: branchId,
          count_date: date,
          sku_id: sku.id,
          opening_balance: opening,
          received_from_ck: fromCk,
          received_external: receivedExternal,
          expected_usage: expUsage,
          waste: 0,
          calculated_balance: calcBalance,
          physical_count: null as number | null,
          variance: 0,
          is_submitted: false,
        };
      });

      if (insertRows.length === 0) {
        toast.warning("No active RM/SM SKUs found");
        setGenerating(false);
        return;
      }

      const chunkSize = 500;
      const allInserted: any[] = [];
      for (let i = 0; i < insertRows.length; i += chunkSize) {
        const chunk = insertRows.slice(i, i + chunkSize);
        const { data: inserted, error } = await supabase.from("daily_stock_counts").insert(chunk).select();
        if (error) {
          toast.error("Failed to generate count sheet: " + error.message);
          setGenerating(false);
          return;
        }
        if (inserted) allInserted.push(...inserted);
      }

      setRows(allInserted.map((r) => {
        const local = toLocal(r);
        const adjEntry = adjMap.get(r.sku_id) ?? { net: 0, details: [] };
        local.adjNet = adjEntry.net;
        local.adjDetails = adjEntry.details;
        return local;
      }));
      toast.success(`Count sheet generated with ${allInserted.length} SKUs`);
      setGenerating(false);
    },
    [skus, calculateExpectedUsage, fetchReceiptTotals, loadSheet, getSkuConverter, computeOpeningWithGap],
  );

  // ── Saving counts: every box saves on its own; when the phone has no internet
  // (walk-in freezers) the value waits on the device and is sent when it can be ──
  type Pending = { physical_count?: number | null; waste?: number; calculated_balance?: number; variance: number };
  const QUEUE_KEY = "ck-count-queue";
  const readQueue = (): Record<string, Pending> => {
    try {
      return JSON.parse(localStorage.getItem(QUEUE_KEY) || "{}");
    } catch {
      return {};
    }
  };
  const writeQueue = (q: Record<string, Pending>) => {
    try {
      if (Object.keys(q).length) localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
      else localStorage.removeItem(QUEUE_KEY);
    } catch {
      // storage blocked: the value stays in memory until the page closes
    }
  };
  const [saveState, setSaveState] = useState<Record<string, "saving" | "waiting">>({});
  const queueRef = useRef<Record<string, Pending>>(readQueue());
  const isOffline = (msg?: string) => (typeof navigator !== "undefined" && navigator.onLine === false) || /fetch|network|load failed/i.test(msg ?? "");

  const send = useCallback(async (rowId: string, patch: Pending) => {
    setSaveState((p) => ({ ...p, [rowId]: "saving" }));
    const { error } = await supabase.from("daily_stock_counts").update(patch).eq("id", rowId);
    if (!error) {
      const q = { ...queueRef.current };
      delete q[rowId];
      queueRef.current = q;
      writeQueue(q);
      setSaveState((p) => {
        const n = { ...p };
        delete n[rowId];
        return n;
      });
      return true;
    }
    if (isOffline(error.message)) {
      // Merge with anything already waiting for this row, newest value wins
      const q = { ...queueRef.current, [rowId]: { ...queueRef.current[rowId], ...patch } };
      queueRef.current = q;
      writeQueue(q);
      setSaveState((p) => ({ ...p, [rowId]: "waiting" }));
      return false;
    }
    setSaveState((p) => {
      const n = { ...p };
      delete n[rowId];
      return n;
    });
    toast.error("บันทึกไม่สำเร็จ: " + error.message);
    return false;
  }, []);

  /** Send everything waiting on this device; true when nothing is left */
  const flushQueue = useCallback(async () => {
    const entries = Object.entries(queueRef.current);
    for (const [rowId, patch] of entries) await send(rowId, patch);
    return Object.keys(queueRef.current).length === 0;
  }, [send]);

  useEffect(() => {
    // Values left from a page closed while offline show as waiting until sent
    const waiting = Object.keys(queueRef.current);
    if (waiting.length) setSaveState(Object.fromEntries(waiting.map((id) => [id, "waiting" as const])));
    const onOnline = () => flushQueue();
    window.addEventListener("online", onOnline);
    const t = setInterval(() => Object.keys(queueRef.current).length && flushQueue(), 20_000);
    return () => {
      window.removeEventListener("online", onOnline);
      clearInterval(t);
    };
  }, [flushQueue]);

  // Update physical count — staff enters directly in Usage UOM, no conversion needed
  const updatePhysicalCount = useCallback(
    async (rowId: string, physicalCount: number | null) => {
      const row = rows.find((r) => r.id === rowId);
      if (!row || row.isSubmitted) return;
      const variance = physicalCount !== null ? physicalCount - row.calculatedBalance : 0;
      // Shown at once; saved (or queued) behind it
      setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, physicalCount, variance } : r)));
      await send(rowId, { physical_count: physicalCount, variance });
    },
    [rows, send],
  );

  // Update waste
  const updateWaste = useCallback(
    async (rowId: string, waste: number) => {
      const row = rows.find((r) => r.id === rowId);
      if (!row || row.isSubmitted) return;

      // receivedExternal is raw Purchase UOM — apply converter for calcBalance
      const extConv = getSkuConverter(row.skuId);
      const calcBalance =
        row.openingBalance + row.receivedFromCk + row.receivedExternal * extConv - row.expectedUsage - waste + row.adjNet;
      const variance = row.physicalCount !== null ? row.physicalCount - calcBalance : 0;
      setRows((prev) =>
        prev.map((r) => (r.id === rowId ? { ...r, waste, calculatedBalance: calcBalance, variance } : r)),
      );
      await send(rowId, { waste, calculated_balance: calcBalance, variance });
    },
    [rows, send, getSkuConverter],
  );

  /** Several products counted as 0 at once (month-end: "not carried here") */
  const setZero = useCallback(
    async (rowIds: string[]) => {
      const targets = rows.filter((r) => rowIds.includes(r.id) && !r.isSubmitted);
      setRows((prev) => prev.map((r) => (rowIds.includes(r.id) && !r.isSubmitted ? { ...r, physicalCount: 0, variance: -r.calculatedBalance } : r)));
      await Promise.all(targets.map((r) => send(r.id, { physical_count: 0, variance: -r.calculatedBalance })));
    },
    [rows, send],
  );

  /**
   * Pick up what someone else counted on another phone (two people, two zones),
   * without touching values still waiting to be sent from this one.
   */
  const refreshCounts = useCallback(async (branchId: string, date: string) => {
    const { data } = await supabase.from("daily_stock_counts").select("id, physical_count, waste, variance").eq("branch_id", branchId).eq("count_date", date);
    if (!data) return;
    const byId = new Map(data.map((d) => [d.id, d]));
    setRows((prev) =>
      prev.map((r) => {
        const d = byId.get(r.id);
        if (!d || queueRef.current[r.id]) return r;
        const physicalCount = d.physical_count !== null ? Number(d.physical_count) : null;
        const waste = Number(d.waste ?? 0);
        if (physicalCount === r.physicalCount && waste === r.waste) return r;
        const calculatedBalance = r.calculatedBalance + r.waste - waste;
        return { ...r, physicalCount, waste, calculatedBalance, variance: physicalCount !== null ? physicalCount - calculatedBalance : 0 };
      }),
    );
  }, []);

  // Delete a single row — only while its sheet is unsubmitted (protects the
  // physical-count anchor every other stock formula in the app relies on).
  const deleteRow = useCallback(
    async (rowId: string) => {
      const row = rows.find((r) => r.id === rowId);
      if (!row || row.isSubmitted) return;

      const { error } = await supabase.from("daily_stock_counts").delete().eq("id", rowId);
      if (error) {
        toast.error("Failed to delete row");
        return;
      }
      setRows((prev) => prev.filter((r) => r.id !== rowId));
    },
    [rows],
  );

  // Submit count
  const submitSheet = useCallback(async (branchId: string, date: string) => {
    if (!(await flushQueue())) {
      toast.error("ยังมียอดนับที่ยังไม่บันทึก (เน็ตหลุด) ต่อเน็ตแล้วลองกดอีกครั้ง");
      return false;
    }
    const now = new Date().toISOString();
    const { error } = await supabase
      .from("daily_stock_counts")
      .update({ is_submitted: true, submitted_at: now })
      .eq("branch_id", branchId)
      .eq("count_date", date);
    if (error) {
      toast.error("Failed to submit: " + error.message);
      return false;
    }
    setRows((prev) => prev.map((r) => ({ ...r, isSubmitted: true, submittedAt: now })));
    return true;
  }, [flushQueue]);

  /** Finish days left open (staff off, sheet opened but not finished): counts kept as they are */
  const finishDays = useCallback(async (branchId: string, dates: string[]) => {
    if (!dates.length) return true;
    const { error } = await supabase
      .from("daily_stock_counts")
      .update({ is_submitted: true, submitted_at: new Date().toISOString() })
      .eq("branch_id", branchId)
      .in("count_date", dates)
      .eq("is_submitted", false);
    if (error) {
      toast.error("บันทึกไม่สำเร็จ: " + error.message);
      return false;
    }
    return true;
  }, []);

  // Unlock (admin only)
  const unlockSheet = useCallback(async (branchId: string, date: string) => {
    const { error } = await supabase
      .from("daily_stock_counts")
      .update({ is_submitted: false, submitted_at: null })
      .eq("branch_id", branchId)
      .eq("count_date", date);
    if (error) {
      toast.error("Failed to unlock: " + error.message);
      return;
    }
    setRows((prev) => prev.map((r) => ({ ...r, isSubmitted: false, submittedAt: null })));
    toast.success("Count sheet unlocked");
  }, []);

  return {
    rows,
    loading,
    generating,
    loadSheet,
    generateSheet,
    updatePhysicalCount,
    updateWaste,
    setZero,
    refreshCounts,
    saveState,
    flushQueue,
    finishDays,
    deleteRow,
    submitSheet,
    unlockSheet,
  };
}
