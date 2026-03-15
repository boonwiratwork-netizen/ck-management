import { useState, useMemo, useEffect, useCallback } from "react";
import { SKU } from "@/types/sku";
import { Branch } from "@/types/branch";
import { BOMHeader, BOMLine } from "@/types/bom";
import { Menu } from "@/types/menu";
import { MenuBomLine } from "@/types/menu-bom";
import { SpBomLine } from "@/types/sp-bom";
import { useAuth } from "@/hooks/use-auth";
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

export default function StoreStockPage({
  skus,
  branches,
  bomHeaders,
  bomLines,
  menus,
  menuBomLines,
  spBomLines,
}: Props) {
  const { isManagement, isStoreManager, isAreaManager, profile } = useAuth();
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

  // Store Manager with no branch
  const noBranch = isStoreManager && !profile?.branch_id;

  // Auto-set branch for store manager
  useEffect(() => {
    if (isStoreManager && profile?.branch_id) {
      setSelectedBranch(profile.branch_id);
    }
  }, [isStoreManager, profile?.branch_id]);

  // Fetch data
  const fetchData = useCallback(async () => {
    if (noBranch) {
      setLoading(false);
      return;
    }
    setLoading(true);

    let query = supabase
      .from("daily_stock_counts")
      .select("id, branch_id, sku_id, count_date, physical_count, calculated_balance, expected_usage, is_submitted")
      .eq("is_submitted", true)
      .order("count_date", { ascending: false })
      .limit(5000);

    if (isStoreManager && profile?.branch_id) {
      query = query.eq("branch_id", profile.branch_id);
    } else if (selectedBranch !== "all") {
      query = query.eq("branch_id", selectedBranch);
    }

    const [{ data }, { data: pricesData }] = await Promise.all([
      query,
      supabase.from("prices").select("sku_id, price_per_usage_uom").eq("is_active", true),
    ]);

    // Build price lookup
    const pm: Record<string, number> = {};
    (pricesData || []).forEach((p: any) => {
      pm[p.sku_id] = Number(p.price_per_usage_uom);
    });
    setPriceMap(pm);

    // Dedup: keep most recent per branch+sku
    const latestByKey = new Map<string, CountRow>();
    (data || []).forEach((row: any) => {
      const key = row.branch_id + "|" + row.sku_id;
      const existing = latestByKey.get(key);
      if (!existing || row.count_date > existing.count_date) {
        latestByKey.set(key, row as CountRow);
      }
    });

    setRows(Array.from(latestByKey.values()));
    setLoading(false);
  }, [noBranch, isStoreManager, profile?.branch_id, selectedBranch]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

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
  const getDisplayCount = (row: CountRow) =>
    row.physical_count !== null ? Number(row.physical_count) : Number(row.calculated_balance);

  // Summary cards
  const totalSkus = filteredRows.length;
  const totalStockValue = filteredRows.reduce((sum, row) => {
    const price = priceMap[row.sku_id] ?? 0;
    const count = Number(row.physical_count ?? row.calculated_balance ?? 0);
    return sum + (price * count);
  }, 0);

  // Cover Day By Storage
  const coverByStorage = useMemo(() => {
    const groups: Record<string, number[]> = { Chilled: [], Frozen: [], Ambient: [] };
    for (const row of filteredRows) {
      const sku = skuMap.get(row.sku_id);
      if (!sku) continue;
      const dc = getDisplayCount(row);
      const eu = Number(row.expected_usage);
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
  }, [filteredRows, skuMap]);

  // All branches mode
  const showBranchCol = (isManagement || isAreaManager) && selectedBranch === "all";


  // No branch assigned
  if (noBranch) {
    return <EmptyState icon={Package} title="No branch assigned to your account. Contact your manager." />;
  }

  return (
    <div className="space-y-4">
      {/* Page Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Store Stock</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Branch-level stock balances from daily count sheets
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Total SKUs</p>
            <p className="text-2xl font-bold font-mono">{totalSkus.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">TOTAL STOCK VALUE</p>
            <p className="text-2xl font-bold font-mono">฿{Math.round(totalStockValue).toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Cover Day By Storage</p>
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
      <div className="flex items-center gap-3 flex-wrap">
        <SearchInput value={search} onChange={setSearch} placeholder="Search SKU ID or name…" className="w-64" />
        {(isManagement || isAreaManager) && (
          <Select value={selectedBranch} onValueChange={setSelectedBranch}>
            <SelectTrigger className="w-48 h-10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Branches</SelectItem>
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
        <SkeletonTable columns={showBranchCol ? 11 : 10} rows={8} />
      ) : filteredRows.length === 0 ? (
        rows.length === 0 ? (
          <EmptyState
            icon={Package}
            title="No count sheets submitted yet for this branch. Submit a Daily Stock Count to see stock here."
          />
        ) : (
          <EmptyState icon={Package} title="No SKUs match your search." />
        )
      ) : (
        <div className="rounded-lg border overflow-auto">
          <table className="w-full table-fixed text-sm">
            <colgroup>
              <col style={{ width: "28px" }} />
              <col style={{ width: "72px" }} />
              <col />
              {showBranchCol && <col style={{ width: "90px" }} />}
              <col style={{ width: "85px" }} />
              <col style={{ width: "48px" }} />
              <col style={{ width: "90px" }} />
              <col style={{ width: "95px" }} />
              <col style={{ width: "80px" }} />
              <col style={{ width: "85px" }} />
              <col style={{ width: "40px" }} />
            </colgroup>
            <thead>
              <tr className={table.headerRow}>
                <th className={table.headerCell} />
                <th className={table.headerCell}>SKU ID</th>
                <th className={table.headerCell}>Name</th>
                {showBranchCol && <th className={table.headerCell}>Branch</th>}
                <th className={table.headerCellNumeric}>Count</th>
                <th className={table.headerCellCenter}>UOM</th>
                <th className={table.headerCellNumeric}>Stock Value</th>
                <th className={table.headerCell}>Last Count</th>
                <th className={table.headerCellNumeric}>Cover Day</th>
                <th className={table.headerCellNumeric}>Avg/Week</th>
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
                const coverDay = dc > 0 && Number(row.expected_usage) > 0 ? dc / Number(row.expected_usage) : null;
                const avgWeek =
                  Number(row.expected_usage) > 0 ? Math.round(Number(row.expected_usage) * 7).toLocaleString() : "—";
                const branch = branchMap.get(row.branch_id);

                return (
                  <tr key={row.id} className={table.dataRow}>
                    <td className={table.dataCell}>
                      <StatusDot status={dc > 0 ? "green" : "red"} />
                    </td>
                    <td className={`${table.dataCell} font-mono text-xs`}>{sku.skuId}</td>
                    <td className={table.truncatedCell} title={sku.name}>
                      {sku.name}
                    </td>
                    {showBranchCol && (
                      <td className={table.truncatedCell} title={branch?.branchName || ""}>
                        {branch?.branchName || "—"}
                      </td>
                    )}
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
                        const count = Number(row.physical_count ?? row.calculated_balance ?? 0);
                        const stockValue = price * count;
                        return stockValue > 0
                          ? '฿' + Math.round(stockValue).toLocaleString()
                          : <span className="text-muted-foreground">—</span>;
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
