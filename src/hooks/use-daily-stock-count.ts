import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { toLocalDateStr } from "@/lib/utils";
import { SKU } from "@/types/sku";
import { MenuBomLine } from "@/types/menu-bom";
import { ModifierRule } from "@/types/modifier-rule";
import { SpBomLine } from "@/types/sp-bom";
import { Menu } from "@/types/menu";
import { Branch } from "@/types/branch";

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

  // Helper: calculate expected usage from sales across a date range using BOM+SP+Modifier Rules
  const calculateExpectedUsageRange = useCallback(
    async (branchId: string, fromDate: string, toDate: string): Promise<Record<string, number>> => {
      const [salesRes, overridesRes] = await Promise.all([
        supabase
          .from("sales_entries")
          .select("*")
          .eq("branch_id", branchId)
          .gt("sale_date", fromDate)
          .lt("sale_date", toDate),
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

      const bomByMenuId = new Map<string, MenuBomLine[]>();
      menuBomLines.forEach((l) => {
        const arr = bomByMenuId.get(l.menuId) || [];
        arr.push(l);
        bomByMenuId.set(l.menuId, arr);
      });

      const activeRules = modifierRules.filter((r) => r.isActive);

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

        if (menu && !suppressedMenuIds.has(menu.id)) {
          const bomLines = bomByMenuId.get(menu.id) || [];
          for (const line of bomLines) {
            const ingredientQty = line.effectiveQty * qty;
            const sku = skuMap.get(line.skuId);
            if (sku && sku.type === "SP") {
              const spLines = spBomBySpSku.get(line.skuId) || [];
              for (const spLine of spLines) {
                addUsage(spLine.ingredientSkuId, (spLine.qtyPerBatch / spLine.batchYieldQty) * ingredientQty);
              }
            } else {
              addUsage(line.skuId, ingredientQty);
            }
          }

          for (const rule of activeRules) {
            if (rule.menuIds.length > 0 && !rule.menuIds.includes(menu.id)) continue;
            if (menuName.includes(rule.keyword)) {
              if (rule.ruleType === "swap") {
                if (rule.swapSkuId) {
                  const bomLines2 = bomByMenuId.get(menu.id) || [];
                  for (const line of bomLines2) {
                    if (line.skuId === rule.swapSkuId) {
                      addUsage(rule.swapSkuId, -(line.effectiveQty * qty));
                    }
                  }
                }
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

  // Gap-resilient opening balance: reconstructs from last submitted count + gap transactions
  const computeOpeningWithGap = useCallback(
    async (branchId: string, beforeDate: string): Promise<Record<string, number>> => {
      // Step 1 — Find most recent count per SKU (submitted or not — calculated_balance is valid regardless)
      const { data: recentCounts } = await supabase
        .from("daily_stock_counts")
        .select("sku_id, physical_count, calculated_balance, count_date")
        .eq("branch_id", branchId)
        .lt("count_date", beforeDate)
        .order("count_date", { ascending: false });

      const lastCountBySku = new Map<string, any>();
      (recentCounts || []).forEach((r) => {
        if (lastCountBySku.has(r.sku_id)) return;
        if (r.physical_count !== null) {
          lastCountBySku.set(r.sku_id, r);
        }
      });
      (recentCounts || []).forEach((r) => {
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

      // Step 3 — Fetch gap transactions + calculate usage from raw sales
      const [gapToLinesRes, gapExtLinesRes, gapUsageBySku] = await Promise.all([
        supabase
          .from("transfer_order_lines")
          .select("sku_id, actual_qty, planned_qty, transfer_orders!inner(branch_id, delivery_date, status)")
          .eq("transfer_orders.branch_id", branchId)
          .gt("transfer_orders.delivery_date", gapStartDate)
          .lt("transfer_orders.delivery_date", beforeDate)
          .in("transfer_orders.status", ["Sent", "Received", "Partially Received"]),
        supabase
          .from("branch_receipts")
          .select("sku_id, qty_received")
          .eq("branch_id", branchId)
          .is("transfer_order_id", null)
          .gt("receipt_date", gapStartDate)
          .lt("receipt_date", beforeDate),
        calculateExpectedUsageRange(branchId, gapStartDate, beforeDate),
      ]);

      const gapCkBySku: Record<string, number> = {};
      (gapToLinesRes.data || []).forEach((line: any) => {
        const qty = Number(line.actual_qty) > 0 ? Number(line.actual_qty) : Number(line.planned_qty);
        gapCkBySku[line.sku_id] = (gapCkBySku[line.sku_id] || 0) + qty;
      });

      const gapExtBySku: Record<string, number> = {};
      (gapExtLinesRes.data || []).forEach((r) => {
        gapExtBySku[r.sku_id] = (gapExtBySku[r.sku_id] || 0) + Number(r.qty_received);
      });

      // waste from gap = 0 (no count sheet data available for it)

      // Step 4 — Compute final opening per SKU
      const result: Record<string, number> = {};
      const allSkuIds = new Set([
        ...Object.keys(baseOpening),
        ...Object.keys(gapCkBySku),
        ...Object.keys(gapExtBySku),
        ...Object.keys(gapUsageBySku),
      ]);

      allSkuIds.forEach((skuId) => {
        const base = baseOpening[skuId] ?? 0;
        const ck = gapCkBySku[skuId] ?? 0;
        const ext = gapExtBySku[skuId] ?? 0;
        const extConv = getSkuConverter(skuId);
        const usage = gapUsageBySku[skuId] ?? 0;
        result[skuId] = Math.max(0, base + ck + ext * extConv - usage);
      });

      return result;
    },
    [getSkuConverter, calculateExpectedUsageRange],
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

      // FROM CK: read from transfer_order_lines (migrated from deliveries table)
      const { data: toLineData } = await supabase
        .from("transfer_order_lines")
        .select("sku_id, actual_qty, planned_qty, transfer_orders!inner(branch_id, delivery_date, status)")
        .eq("transfer_orders.branch_id", branchId)
        .eq("transfer_orders.delivery_date", date)
        .in("transfer_orders.status", ["Sent", "Received", "Partially Received"]);

      const ckBySku: Record<string, number> = {};
      (toLineData || []).forEach((d: any) => {
        const qty = Number(d.actual_qty) > 0 ? Number(d.actual_qty) : Number(d.planned_qty);
        ckBySku[d.sku_id] = (ckBySku[d.sku_id] || 0) + qty;
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

      const bomByMenuId = new Map<string, MenuBomLine[]>();
      menuBomLines.forEach((l) => {
        const arr = bomByMenuId.get(l.menuId) || [];
        arr.push(l);
        bomByMenuId.set(l.menuId, arr);
      });

      const activeRules = modifierRules.filter((r) => r.isActive);

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

        if (menu && !suppressedMenuIds.has(menu.id)) {
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
            if (menuName.includes(rule.keyword)) {
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
        return;
      }
      const data = sheetResult.data || [];

      // Fetch gap-resilient opening balances
      const openingBySku = await computeOpeningWithGap(branchId, date);

      // Patch rows with live receipt data, live expected usage, AND corrected opening balance
      const patched = data.map((r) => {
        const ext = receipts.extBySku[r.sku_id] ?? Number(r.received_external);
        const ck = receipts.ckBySku[r.sku_id] ?? Number(r.received_from_ck);
        const expUsage = expectedUsage[r.sku_id] ?? 0;
        const waste = Number(r.waste ?? 0);
        // ext is raw Purchase UOM — apply converter for calcBalance (Usage UOM)
        const extConv = getSkuConverter(r.sku_id);
        const opening = openingBySku[r.sku_id] ?? Number(r.opening_balance);
        const calcBalance = opening + ck + ext * extConv - expUsage - waste;
        const variance = r.physical_count !== null ? Number(r.physical_count) - calcBalance : 0;
        return {
          ...r,
          opening_balance: opening,
          received_external: ext,
          received_from_ck: ck,
          expected_usage: expUsage,
          calculated_balance: calcBalance,
          variance,
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
      if (updates.length > 0) {
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
      const activeSkus = skus.filter((s) => s.status === "Active" && (s.type === "RM" || s.type === "SM"));
      const newSkuRows: any[] = [];
      for (const sku of activeSkus) {
        if (
          !existingSkuIds.has(sku.id) &&
          (expectedUsage[sku.id] || receipts.extBySku[sku.id] || receipts.ckBySku[sku.id])
        ) {
          const expUsage = expectedUsage[sku.id] ?? 0;
          const ext = receipts.extBySku[sku.id] ?? 0;
          const ck = receipts.ckBySku[sku.id] ?? 0;
          const extConvNew = getSkuConverter(sku.id);
          const calcBalance = ck + ext * extConvNew - expUsage;
          newSkuRows.push({
            branch_id: branchId,
            count_date: date,
            sku_id: sku.id,
            opening_balance: 0,
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
      setRows([...patched, ...insertedRows].map(toLocal));
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

      const activeSkus = skus.filter((s) => s.status === "Active" && (s.type === "RM" || s.type === "SM"));

      const insertRows = activeSkus.map((sku) => {
        const opening = openingBySku[sku.id] ?? 0;
        const fromCk = receipts.ckBySku[sku.id] ?? 0;
        const receivedExternal = receipts.extBySku[sku.id] ?? 0;
        const expUsage = expectedUsage[sku.id] ?? 0;
        // ext is raw Purchase UOM — apply converter for calcBalance (Usage UOM)
        const extConv = getSkuConverter(sku.id);
        const calcBalance = opening + fromCk + receivedExternal * extConv - expUsage;

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

      setRows(allInserted.map(toLocal));
      toast.success(`Count sheet generated with ${allInserted.length} SKUs`);
      setGenerating(false);
    },
    [skus, calculateExpectedUsage, fetchReceiptTotals, loadSheet, getSkuConverter, computeOpeningWithGap],
  );

  // Update physical count — staff enters directly in Usage UOM, no conversion needed
  const updatePhysicalCount = useCallback(
    async (rowId: string, physicalCount: number | null) => {
      const row = rows.find((r) => r.id === rowId);
      if (!row || row.isSubmitted) return;

      const variance = physicalCount !== null ? physicalCount - row.calculatedBalance : 0;
      const { error } = await supabase
        .from("daily_stock_counts")
        .update({ physical_count: physicalCount, variance })
        .eq("id", rowId);
      if (error) {
        toast.error("Failed to update");
        return;
      }
      setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, physicalCount, variance } : r)));
    },
    [rows],
  );

  // Update waste
  const updateWaste = useCallback(
    async (rowId: string, waste: number) => {
      const row = rows.find((r) => r.id === rowId);
      if (!row || row.isSubmitted) return;

      // receivedExternal is raw Purchase UOM — apply converter for calcBalance
      const extConv = getSkuConverter(row.skuId);
      const calcBalance =
        row.openingBalance + row.receivedFromCk + row.receivedExternal * extConv - row.expectedUsage - waste;
      const variance = row.physicalCount !== null ? row.physicalCount - calcBalance : 0;
      const { error } = await supabase
        .from("daily_stock_counts")
        .update({ waste, calculated_balance: calcBalance, variance })
        .eq("id", rowId);
      if (error) {
        toast.error("Failed to update waste");
        return;
      }
      setRows((prev) =>
        prev.map((r) => (r.id === rowId ? { ...r, waste, calculatedBalance: calcBalance, variance } : r)),
      );
    },
    [rows],
  );

  // Submit count
  const submitSheet = useCallback(async (branchId: string, date: string) => {
    const now = new Date().toISOString();
    const { error } = await supabase
      .from("daily_stock_counts")
      .update({ is_submitted: true, submitted_at: now })
      .eq("branch_id", branchId)
      .eq("count_date", date);
    if (error) {
      toast.error("Failed to submit: " + error.message);
      return;
    }
    setRows((prev) => prev.map((r) => ({ ...r, isSubmitted: true, submittedAt: now })));
    toast.success("Count sheet submitted");
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
    submitSheet,
    unlockSheet,
  };
}
