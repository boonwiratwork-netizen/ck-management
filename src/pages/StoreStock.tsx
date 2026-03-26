import { useState, useMemo, useEffect, useCallback } from "react";
import { SKU } from "@/types/sku";
import { Branch } from "@/types/branch";
import { BOMHeader, BOMLine } from "@/types/bom";
import { Menu } from "@/types/menu";
import { MenuBomLine } from "@/types/menu-bom";
import { SpBomLine } from "@/types/sp-bom";
import { ModifierRule } from "@/types/modifier-rule";
import { useAuth } from "@/hooks/use-auth";
import { useLanguage } from "@/hooks/use-language";
import { supabase } from "@/integrations/supabase/client";
import { table } from "@/lib/design-tokens";
import { StatusDot } from "@/components/ui/status-dot";
import { StockCard } from "@/components/StockCard";

import { SearchInput } from "@/components/SearchInput";
import { SkeletonTable } from "@/components/SkeletonTable";
import { EmptyState } from "@/components/EmptyState";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { History, Package } from "lucide-react";

interface Props {
  skus: SKU[];
  branches: Branch[];
  bomHeaders: BOMHeader[];
  bomLines: BOMLine[];
  menus: Menu[];
  menuBomLines: MenuBomLine[];
  spBomLines: SpBomLine[];
  modifierRules: ModifierRule[];
}

interface CountRow {
  id: string;
  branch_id: string;
  sku_id: string;
  count_date: string;
  physical_count: number | null;
  calculated_balance: number;
  expected_usage: number;
  is_submitted: boolean;
}

/** Shared usage calculation: Menu BOM + SP expansion + Modifier Rules */
function calculateUsageFromSales(
  sales: { menu_code: string; menu_name: string; qty: number }[],
  menus: Menu[],
  menuBomLines: MenuBomLine[],
  modifierRules: ModifierRule[],
  spBomLines: SpBomLine[],
  skus: SKU[],
): Record<string, number> {
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

    const menu = menuByCode.get(sale.menu_code);
    if (!menu) continue;

    const lines = bomByMenuId.get(menu.id) || [];
    for (const line of lines) {
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

    // Modifier Rules
    const menuName = sale.menu_name || "";
    for (const rule of activeRules) {
      if (rule.menuIds.length > 0 && !rule.menuIds.includes(menu.id)) continue;
      if (!menuName.includes(rule.keyword)) continue;

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
        // ADD type
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

  return usage;
}

export default function StoreStockPage({
  skus,
  branches,
  bomHeaders,
  bomLines,
  menus,
  menuBomLines,
  spBomLines,
  modifierRules,
}: Props) {
  const { isManagement, isStoreManager, isAreaManager, profile } = useAuth();
  const { t } = useLanguage();
  const [rows, setRows] = useState<CountRow[]>([]);
  const [priceMap, setPriceMap] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedBranch, setSelectedBranch] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<"All" | "SM" | "RM">("All");
  const [stockCard, setStockCard] = useState<{
    skuId: string;
    skuType: "RM" | "SM";
    sku: SKU;
    currentStock: number;
    branchId: string;
  } | null>(null);
  const [liveDailyUsage, setLiveDailyUsage] = useState<Record<string, number>>({});

  // Store Manager with no branch
  const noBranch = isStoreManager && !profile?.branch_id;

  // Auto-set branch for store manager
  useEffect(() => {
    if (isStoreManager && profile?.branch_id) {
      setSelectedBranch(profile.branch_id);
    }
  }, [isStoreManager, profile?.branch_id]);

  // Effective branch ID (null if "all" selected)
  const effectiveBranchId = useMemo(() => {
    if (isStoreManager && profile?.branch_id) return profile.branch_id;
    if (selectedBranch !== "all") return selectedBranch;
    return null;
  }, [isStoreManager, profile?.branch_id, selectedBranch]);

  // Fetch data — live balance from transactions
  const fetchData = useCallback(async () => {
    if (noBranch || !effectiveBranchId) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);

    const branchId = effectiveBranchId;
    const today = new Date().toISOString().split("T")[0];

    // Step 2 — Prices
    const { data: pricesData } = await supabase
      .from("prices")
      .select("sku_id, price_per_usage_uom")
      .eq("is_active", true);
    const pm: Record<string, number> = {};
    (pricesData || []).forEach((p: any) => {
      pm[p.sku_id] = Number(p.price_per_usage_uom);
    });
    setPriceMap(pm);

    // Step 3 — Most recent physical_count per SKU (last 90 days only)
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const ninetyDaysAgoStr = ninetyDaysAgo.toISOString().split("T")[0];

    const { data: countData } = await supabase
      .from("daily_stock_counts")
      .select("sku_id, physical_count, count_date")
      .eq("branch_id", branchId)
      .gte("count_date", ninetyDaysAgoStr)
      .lte("count_date", today)
      .order("count_date", { ascending: false });

    const lastSnapBySku = new Map<string, { balance: number; date: string }>();
    (countData || []).forEach((r: any) => {
      if (lastSnapBySku.has(r.sku_id)) return; // already have more recent
      if (r.physical_count !== null) {
        lastSnapBySku.set(r.sku_id, { balance: Number(r.physical_count), date: r.count_date });
      }
    });

    // Step 4 — Earliest snap date
    let earliestSnap = "2020-01-01";
    if (lastSnapBySku.size > 0) {
      earliestSnap = [...lastSnapBySku.values()].reduce(
        (min, s) => (s.date < min ? s.date : min),
        [...lastSnapBySku.values()][0].date,
      );
    }

    // Steps 5-7 — Fetch CK receipts, external receipts, sales all in parallel
    const skuConverterMap = new Map<string, { converter: number; purchaseUom: string; usageUom: string }>();
    skus.forEach((s) =>
      skuConverterMap.set(s.id, { converter: s.converter, purchaseUom: s.purchaseUom, usageUom: s.usageUom }),
    );

    const [ckRes, extRes, salesRes] = await Promise.all([
      // Step 5 — CK receipts (transfer_order_lines)
      supabase
        .from("transfer_order_lines")
        .select("sku_id, actual_qty, planned_qty, transfer_orders!inner(branch_id, delivery_date, status)")
        .eq("transfer_orders.branch_id", branchId)
        .gt("transfer_orders.delivery_date", earliestSnap)
        .lte("transfer_orders.delivery_date", today)
        .in("transfer_orders.status", ["Sent", "Received", "Partially Received"]),
      // Step 6 — External receipts (branch_receipts)
      supabase
        .from("branch_receipts")
        .select("sku_id, qty_received, receipt_date")
        .eq("branch_id", branchId)
        .is("transfer_order_id", null)
        .gt("receipt_date", earliestSnap)
        .lte("receipt_date", today),
      // Step 7 — Sales (paginated)
      (async () => {
        let allSales: any[] = [];
        const PAGE = 1000;
        let from = 0;
        while (true) {
          const { data, error } = await supabase
            .from("sales_entries")
            .select("menu_code, menu_name, qty, sale_date")
            .eq("branch_id", branchId)
            .gt("sale_date", earliestSnap)
            .lte("sale_date", today)
            .range(from, from + PAGE - 1);
          if (error || !data || data.length === 0) break;
          allSales = allSales.concat(data);
          if (data.length < PAGE) break;
          from += PAGE;
        }
        return { data: allSales, error: null };
      })(),
    ]);

    // Build CK receipt totals per SKU per date
    const ckBySkuDate = new Map<string, Map<string, number>>();
    (ckRes.data || []).forEach((line: any) => {
      const qty = Number(line.actual_qty) > 0 ? Number(line.actual_qty) : Number(line.planned_qty);
      const deliveryDate = (line.transfer_orders as any).delivery_date;
      if (!ckBySkuDate.has(line.sku_id)) ckBySkuDate.set(line.sku_id, new Map());
      const m = ckBySkuDate.get(line.sku_id)!;
      m.set(deliveryDate, (m.get(deliveryDate) || 0) + qty);
    });

    // Build external receipt totals per SKU per date (with converter)
    const extBySkuDate = new Map<string, Map<string, number>>();
    (extRes.data || []).forEach((r: any) => {
      const skuInfo = skuConverterMap.get(r.sku_id);
      const conv = skuInfo && skuInfo.purchaseUom !== skuInfo.usageUom ? skuInfo.converter : 1;
      const qty = Number(r.qty_received) * conv;
      if (!extBySkuDate.has(r.sku_id)) extBySkuDate.set(r.sku_id, new Map());
      const m = extBySkuDate.get(r.sku_id)!;
      m.set(r.receipt_date, (m.get(r.receipt_date) || 0) + qty);
    });

    // Build usage per SKU per date from sales
    const salesByDate = new Map<string, { menu_code: string; menu_name: string; qty: number }[]>();
    (salesRes.data || []).forEach((s: any) => {
      const arr = salesByDate.get(s.sale_date) || [];
      arr.push({ menu_code: s.menu_code, menu_name: s.menu_name || "", qty: Number(s.qty) });
      salesByDate.set(s.sale_date, arr);
    });

    const usageBySkuDate = new Map<string, Map<string, number>>();
    for (const [date, dateSales] of salesByDate) {
      const dayUsage = calculateUsageFromSales(dateSales, menus, menuBomLines, modifierRules, spBomLines, skus);
      for (const [skuId, qty] of Object.entries(dayUsage)) {
        if (!usageBySkuDate.has(skuId)) usageBySkuDate.set(skuId, new Map());
        const m = usageBySkuDate.get(skuId)!;
        m.set(date, (m.get(date) || 0) + qty);
      }
    }

    // Step 8 — Compute final balance per SKU
    const activeSkus = skus.filter((s) => s.status === "Active" && (s.type === "RM" || s.type === "SM"));
    const resultRows: CountRow[] = [];

    for (const sku of activeSkus) {
      const snap = lastSnapBySku.get(sku.id);
      const base = snap?.balance ?? 0;
      const snapDate = snap?.date ?? earliestSnap;

      // Sum CK receipts after snap date
      let ckIn = 0;
      const ckDates = ckBySkuDate.get(sku.id);
      if (ckDates) {
        for (const [d, q] of ckDates) {
          if (d > snapDate) ckIn += q;
        }
      }

      // Sum external receipts after snap date
      let extIn = 0;
      const extDates = extBySkuDate.get(sku.id);
      if (extDates) {
        for (const [d, q] of extDates) {
          if (d > snapDate) extIn += q;
        }
      }

      // Sum usage after snap date
      let usageOut = 0;
      const usageDates = usageBySkuDate.get(sku.id);
      if (usageDates) {
        for (const [d, q] of usageDates) {
          if (d > snapDate) usageOut += q;
        }
      }

      const balance = Math.max(0, base + ckIn + extIn - usageOut);

      // Only include if there's any activity or a snap
      if (balance > 0 || snap || ckIn > 0 || extIn > 0 || usageOut > 0) {
        resultRows.push({
          id: sku.id,
          branch_id: branchId,
          sku_id: sku.id,
          count_date: snap?.date ?? "—",
          physical_count: snap?.balance ?? null,
          calculated_balance: balance,
          expected_usage: 0,
          is_submitted: true,
        });
      }
    }

    setRows(resultRows);
    // Compute live daily usage from already-fetched sales (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const since = sevenDaysAgo.toISOString().split("T")[0];
    const recentSales: { menu_code: string; menu_name: string; qty: number }[] = [];
    for (const [date, dateSales] of salesByDate) {
      if (date > since) recentSales.push(...dateSales);
    }
    const totalUsage = calculateUsageFromSales(recentSales, menus, menuBomLines, modifierRules, spBomLines, skus);
    const daily: Record<string, number> = {};
    for (const [skuId, total] of Object.entries(totalUsage)) {
      daily[skuId] = total / 7;
    }
    setLiveDailyUsage(daily);
    setLoading(false);
  }, [noBranch, effectiveBranchId, skus, menus, menuBomLines, modifierRules, spBomLines]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Live daily usage from last 7 days sales with full Modifier Rules
  useEffect(() => {
    if (!effectiveBranchId) {
      setLiveDailyUsage({});
      return;
    }

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const since = sevenDaysAgo.toISOString().split("T")[0];

    const run = async () => {
      let allSalesData: any[] = [];
      const PAGE = 1000;
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("sales_entries")
          .select("menu_code, menu_name, qty")
          .eq("branch_id", effectiveBranchId)
          .gte("sale_date", since)
          .range(from, from + PAGE - 1);
        if (error || !data || data.length === 0) break;
        allSalesData = allSalesData.concat(data);
        if (data.length < PAGE) break;
        from += PAGE;
      }

      const salesData = allSalesData;
      if (!salesData.length) return;

      const sales = salesData.map((s: any) => ({
        menu_code: s.menu_code,
        menu_name: s.menu_name || "",
        qty: Number(s.qty),
      }));

      const totalUsage = calculateUsageFromSales(sales, menus, menuBomLines, modifierRules, spBomLines, skus);

      // Divide by 7 for daily average
      const daily: Record<string, number> = {};
      for (const [skuId, total] of Object.entries(totalUsage)) {
        daily[skuId] = total / 7;
      }
      setLiveDailyUsage(daily);
    };
    run();
  }, [effectiveBranchId, menus, menuBomLines, modifierRules, spBomLines, skus]);

  // Relevant SKU filter based on branch brand menus
  const { relevantSmIds, relevantRmIds } = useMemo(() => {
    const viewBranches =
      selectedBranch === "all"
        ? branches.filter((b) => b.status === "Active")
        : branches.filter((b) => b.id === selectedBranch);
    const brandNames = new Set(viewBranches.map((b) => b.brandName));

    // Active menu IDs for these brands
    const brandMenuIds = new Set(
      menus.filter((m) => brandNames.has(m.brandName) && m.status === "Active").map((m) => m.id),
    );

    // Menu BOM lines for these menus
    const relevantMBL = menuBomLines.filter((l) => brandMenuIds.has(l.menuId));

    // SM SKUs directly in menu_bom
    const smIds = new Set<string>();
    const spIds = new Set<string>();
    const directRmIds = new Set<string>();

    for (const l of relevantMBL) {
      const sku = skus.find((s) => s.id === l.skuId);
      if (!sku) continue;
      if (sku.type === "SM") smIds.add(l.skuId);
      else if (sku.type === "SP") spIds.add(l.skuId);
      else if (sku.type === "RM") directRmIds.add(l.skuId);
    }

    // RM via SP BOM ingredients
    const spRmIds = new Set(spBomLines.filter((l) => spIds.has(l.spSkuId)).map((l) => l.ingredientSkuId));

    const rmIds = new Set([...directRmIds, ...spRmIds]);

    return { relevantSmIds: smIds, relevantRmIds: rmIds };
  }, [selectedBranch, branches, menus, menuBomLines, spBomLines, skus]);

  // SKU lookup
  const skuMap = useMemo(() => {
    const m = new Map<string, SKU>();
    skus.forEach((s) => m.set(s.id, s));
    return m;
  }, [skus]);

  // Branch lookup
  const branchMap = useMemo(() => {
    const m = new Map<string, Branch>();
    branches.forEach((b) => m.set(b.id, b));
    return m;
  }, [branches]);

  const activeBranches = useMemo(() => branches.filter((b) => b.status === "Active"), [branches]);

  // Filter & sort rows
  const filteredRows = useMemo(() => {
    const q = search.toLowerCase();
    return rows
      .filter((row) => {
        const sku = skuMap.get(row.sku_id);
        if (!sku) return false;
        // Only SM/RM
        if (sku.type !== "SM" && sku.type !== "RM") return false;
        // Relevant filter
        if (sku.type === "SM" && !relevantSmIds.has(sku.id)) return false;
        if (sku.type === "RM" && !relevantRmIds.has(sku.id)) return false;
        // Type filter
        if (typeFilter !== "All" && sku.type !== typeFilter) return false;
        // Search
        if (q && !sku.skuId.toLowerCase().includes(q) && !sku.name.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => {
        const sa = skuMap.get(a.sku_id)!;
        const sb = skuMap.get(b.sku_id)!;
        // SM first
        if (sa.type !== sb.type) return sa.type === "SM" ? -1 : 1;
        return sa.skuId.localeCompare(sb.skuId);
      });
  }, [rows, skuMap, relevantSmIds, relevantRmIds, search, typeFilter]);

  // Display count helper
  const getDisplayCount = (row: CountRow) => row.calculated_balance;

  // Summary cards
  const totalSkus = filteredRows.length;
  const totalStockValue = filteredRows.reduce((sum, row) => {
    const price = priceMap[row.sku_id] ?? 0;
    const count = getDisplayCount(row);
    return sum + price * count;
  }, 0);

  // Cover Day By Storage
  const coverByStorage = useMemo(() => {
    const groups: Record<string, number[]> = { Chilled: [], Frozen: [], Ambient: [] };
    for (const row of filteredRows) {
      const sku = skuMap.get(row.sku_id);
      if (!sku) continue;
      const dc = getDisplayCount(row);
      const eu = liveDailyUsage[row.sku_id] ?? 0;
      if (dc > 0 && eu > 0) {
        const cd = dc / eu;
        const sc = sku.storageCondition || "Ambient";
        if (groups[sc]) groups[sc].push(cd);
      }
    }
    const avg = (arr: number[]) => (arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
    return {
      Chilled: avg(groups.Chilled),
      Frozen: avg(groups.Frozen),
      Ambient: avg(groups.Ambient),
    };
  }, [filteredRows, skuMap, liveDailyUsage]);

  // No branch assigned
  if (noBranch) {
    return <EmptyState icon={Package} title={t("ss.noBranchAssigned")} />;
  }

  return (
    <div className="space-y-4">
      {/* Page Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">{t("ss.title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t("ss.subtitle")}</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{t("ss.totalSkus")}</p>
            <p className="text-2xl font-bold font-mono">{totalSkus.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{t("ss.totalStockValue")}</p>
            <p className="text-2xl font-bold font-mono">฿{Math.round(totalStockValue).toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{t("ss.coverByStorage")}</p>
            <div className="mt-1 space-y-0.5 text-sm font-mono">
              <div className="flex justify-between">
                <span className="text-muted-foreground text-xs">Chilled</span>
                <span>{coverByStorage.Chilled !== null ? coverByStorage.Chilled.toFixed(1) + " วัน" : "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground text-xs">Frozen</span>
                <span>{coverByStorage.Frozen !== null ? coverByStorage.Frozen.toFixed(1) + " วัน" : "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground text-xs">Ambient</span>
                <span>{coverByStorage.Ambient !== null ? coverByStorage.Ambient.toFixed(1) + " วัน" : "—"}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap sticky top-0 z-10 bg-background py-2">
        <SearchInput value={search} onChange={setSearch} placeholder="Search SKU ID or name…" className="w-64" />
        {(isManagement || isAreaManager) && (
          <Select value={selectedBranch} onValueChange={setSelectedBranch}>
            <SelectTrigger className="w-48 h-10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("common.allBranches")}</SelectItem>
              {activeBranches.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.branchName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as any)}>
          <SelectTrigger className="w-28 h-10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="All">All</SelectItem>
            <SelectItem value="SM">SM</SelectItem>
            <SelectItem value="RM">RM</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      {loading ? (
        <SkeletonTable columns={10} rows={8} />
      ) : !effectiveBranchId ? (
        <EmptyState icon={Package} title={t("ss.selectBranchPrompt")} />
      ) : filteredRows.length === 0 ? (
        rows.length === 0 ? (
          <EmptyState icon={Package} title={t("ss.noStockData")} />
        ) : (
          <EmptyState icon={Package} title={t("ss.noSkusMatch")} />
        )
      ) : (
        <div className="rounded-lg border overflow-x-auto overflow-y-auto max-h-[70vh]">
          <table className="w-full table-fixed text-sm">
            <colgroup>
              <col style={{ width: "28px" }} />
              <col style={{ width: "72px" }} />
              <col style={{ width: "200px" }} />
              <col style={{ width: "90px" }} />
              <col style={{ width: "48px" }} />
              <col style={{ width: "95px" }} />
              <col style={{ width: "95px" }} />
              <col style={{ width: "75px" }} />
              <col style={{ width: "95px" }} />
              <col style={{ width: "40px" }} />
            </colgroup>
            <thead className="sticky top-0 z-[5]">
              <tr className={table.headerRow}>
                <th className={table.headerCell} />
                <th className={table.headerCell}>{t("ss.colSkuId")}</th>
                <th className={table.headerCell}>{t("ss.colName")}</th>
                <th className={table.headerCellNumeric}>{t("ss.colCurrentStock")}</th>
                <th className={table.headerCellCenter}>UOM</th>
                <th className={table.headerCellNumeric}>{t("ss.colStockValue")}</th>
                <th className={table.headerCell}>{t("ss.colLastCount")}</th>
                <th className={table.headerCellNumeric}>{t("ss.colCoverDay")}</th>
                <th className={table.headerCellNumeric}>{t("ss.colAvgWeek")}</th>
                <th className={table.headerCell} />
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => {
                const sku = skuMap.get(row.sku_id);
                if (!sku) return null;
                const dc = getDisplayCount(row);
                const isPhysical = row.physical_count !== null;
                const showDash = dc === 0 && !isPhysical;
                const dailyUsage = liveDailyUsage[row.sku_id] ?? 0;
                const coverDay = dc > 0 && dailyUsage > 0 ? dc / dailyUsage : null;
                const avgU = liveDailyUsage[row.sku_id] ?? 0;
                const avgWeek = avgU > 0 ? Math.round(avgU * 7).toLocaleString() : "—";

                return (
                  <tr key={row.id} className={table.dataRow}>
                    <td className={table.dataCell}>
                      <StatusDot status={dc > 0 ? "green" : "red"} />
                    </td>
                    <td className={`${table.dataCell} font-mono text-xs`}>{sku.skuId}</td>
                    <td className={table.truncatedCell} title={sku.name}>
                      {sku.name}
                    </td>
                    <td className={table.dataCellMono}>
                      {showDash ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span className={isPhysical ? "font-semibold" : ""}>{Math.round(dc).toLocaleString()}</span>
                      )}
                    </td>
                    <td className={`${table.dataCellCenter} text-xs font-medium text-primary`}>{sku.usageUom}</td>
                    <td className={table.dataCellMono}>
                      {(() => {
                        const price = priceMap[row.sku_id] ?? 0;
                        const stockValue = price * dc;
                        return stockValue > 0 ? (
                          "฿" + Math.round(stockValue).toLocaleString()
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        );
                      })()}
                    </td>
                    <td className={table.dataCell}>{row.count_date}</td>
                    <td className={`${table.dataCellMono} text-muted-foreground`}>
                      {coverDay !== null ? coverDay.toFixed(1) : "—"}
                    </td>
                    <td className={`${table.dataCellMono} text-muted-foreground`}>{avgWeek}</td>
                    <td className={table.dataCell}>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title="Stock card"
                        onClick={() =>
                          setStockCard({
                            skuId: sku.id,
                            skuType: sku.type as "RM" | "SM",
                            sku,
                            currentStock: dc,
                            branchId: row.branch_id,
                          })
                        }
                      >
                        <History className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Stock Card Drawer */}
      {stockCard && (
        <StockCard
          skuId={stockCard.skuId}
          skuType={stockCard.skuType}
          sku={stockCard.sku}
          skus={skus}
          currentStock={stockCard.currentStock}
          stockValue={0}
          disableMismatchCheck
          context="branch"
          branchId={stockCard.branchId}
          onClose={() => setStockCard(null)}
        />
      )}
    </div>
  );
}
