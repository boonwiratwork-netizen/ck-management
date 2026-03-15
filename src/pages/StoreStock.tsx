import { useState, useEffect, useMemo } from 'react';
import { SKU } from '@/types/sku';
import { Branch } from '@/types/branch';
import { useAuth } from '@/hooks/use-auth';
import { supabase } from '@/integrations/supabase/client';
import { StockCard } from '@/components/StockCard';
import { StockAdjustmentModal } from '@/components/StockAdjustmentModal';
import { StatusDot } from '@/components/ui/status-dot';
import { UnitLabel } from '@/components/ui/unit-label';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, SlidersHorizontal, History, ClipboardList, Package, Calendar } from 'lucide-react';
import { table } from '@/lib/design-tokens';
import { toast } from 'sonner';

interface Props {
  skus: SKU[];
  branches: Branch[];
}

interface StockRow {
  id: string;
  branch_id: string;
  sku_id: string;
  count_date: string;
  physical_count: number | null;
  expected_usage: number;
  is_submitted: boolean;
}

export default function StoreStockPage({ skus, branches }: Props) {
  const { isManagement, isStoreManager, profile } = useAuth();

  const [data, setData] = useState<StockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterBranch, setFilterBranch] = useState('all');
  const [filterType, setFilterType] = useState('all');

  const [adjustModal, setAdjustModal] = useState<{
    skuId: string; skuName: string; usageUom: string; currentStock: number; skuType: string;
  } | null>(null);

  const [stockCardSku, setStockCardSku] = useState<{
    skuId: string; skuType: 'RM' | 'SM'; sku: SKU; currentStock: number; stockValue: number;
  } | null>(null);

  // Store Manager with no branch
  const noAssignedBranch = isStoreManager && !profile?.branch_id;

  useEffect(() => {
    if (noAssignedBranch) { setLoading(false); return; }

    const fetchData = async () => {
      setLoading(true);
      let query = supabase
        .from('daily_stock_counts')
        .select('id, branch_id, sku_id, count_date, physical_count, expected_usage, is_submitted')
        .eq('is_submitted', true)
        .order('count_date', { ascending: false })
        .limit(5000);

      if (isStoreManager && profile?.branch_id) {
        query = query.eq('branch_id', profile.branch_id);
      }

      const { data: rows } = await query;

      // Dedup: keep most recent per branch+sku
      const latestByKey = new Map<string, StockRow>();
      (rows || []).forEach((row: StockRow) => {
        const key = row.branch_id + '|' + row.sku_id;
        const existing = latestByKey.get(key);
        if (!existing || row.count_date > existing.count_date) {
          latestByKey.set(key, row);
        }
      });
      setData(Array.from(latestByKey.values()));
      setLoading(false);
    };
    fetchData();
  }, [isStoreManager, profile?.branch_id, noAssignedBranch]);

  const skuMap = useMemo(() => {
    const m = new Map<string, SKU>();
    skus.forEach(s => m.set(s.id, s));
    return m;
  }, [skus]);

  const branchMap = useMemo(() => {
    const m = new Map<string, Branch>();
    branches.forEach(b => m.set(b.id, b));
    return m;
  }, [branches]);

  // Filter to SM and RM only, then apply search/branch/type filters
  const filteredRows = useMemo(() => {
    let rows = data.filter(r => {
      const sku = skuMap.get(r.sku_id);
      return sku && (sku.type === 'SM' || sku.type === 'RM');
    });

    if (filterBranch !== 'all') {
      rows = rows.filter(r => r.branch_id === filterBranch);
    }

    if (filterType !== 'all') {
      rows = rows.filter(r => {
        const sku = skuMap.get(r.sku_id);
        return sku?.type === filterType;
      });
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(r => {
        const sku = skuMap.get(r.sku_id);
        if (!sku) return false;
        return sku.skuId.toLowerCase().includes(q) || sku.name.toLowerCase().includes(q);
      });
    }

    // Sort: SM first, then RM. Within each type sort by skuId ASC
    rows.sort((a, b) => {
      const skuA = skuMap.get(a.sku_id);
      const skuB = skuMap.get(b.sku_id);
      if (!skuA || !skuB) return 0;
      const typeOrder = skuA.type === skuB.type ? 0 : skuA.type === 'SM' ? -1 : 1;
      if (typeOrder !== 0) return typeOrder;
      return skuA.skuId.localeCompare(skuB.skuId);
    });

    return rows;
  }, [data, search, filterBranch, filterType, skuMap]);

  // Summary cards
  const totalSkus = new Set(filteredRows.map(r => r.sku_id)).size;
  const outOfStock = filteredRows.filter(r => (r.physical_count ?? 0) <= 0).length;
  const lastUpdated = filteredRows.reduce((latest, r) => {
    return r.count_date > latest ? r.count_date : latest;
  }, '');
  const lastUpdatedDisplay = lastUpdated
    ? new Date(lastUpdated).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : '—';

  const showBranchCol = isManagement && filterBranch === 'all';
  const activeBranches = branches.filter(b => b.status === 'Active');

  const handleAdjustSubmit = async (adjData: { skuId: string; date: string; quantity: number; reason: string }) => {
    const sku = skuMap.get(adjData.skuId);
    await supabase.from('stock_adjustments').insert({
      sku_id: adjData.skuId,
      adjustment_date: adjData.date,
      quantity: adjData.quantity,
      reason: adjData.reason,
      stock_type: sku?.type === 'SM' ? 'SM' : 'RM',
    });
    toast.success('Stock adjusted. Physical count updates after next Daily Stock Count.');
    setAdjustModal(null);
  };

  if (noAssignedBranch) {
    return (
      <div className="section-gap">
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Package className="w-12 h-12 text-muted-foreground mb-4" />
          <p className="text-muted-foreground">No branch assigned to your account. Contact your manager.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="section-gap space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Total SKUs</p>
          <p className="text-2xl font-bold">{totalSkus}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Out of Stock</p>
          <p className="text-2xl font-bold text-destructive">{outOfStock}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-1">
            <Calendar className="w-3 h-3" /> Last Updated
          </p>
          <p className="text-2xl font-bold">{lastUpdatedDisplay}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative w-56">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search SKU..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
        {isManagement && (
          <Select value={filterBranch} onValueChange={setFilterBranch}>
            <SelectTrigger className="w-48 h-9">
              <SelectValue placeholder="All Branches" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Branches</SelectItem>
              {activeBranches.map(b => (
                <SelectItem key={b.id} value={b.id}>{b.branchName}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-28 h-9">
            <SelectValue placeholder="All" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="SM">SM</SelectItem>
            <SelectItem value="RM">RM</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className={table.wrapper}>
        <div className="overflow-x-auto">
          <table className={table.base}>
            <colgroup>
              <col style={{ width: '28px' }} />
              <col style={{ width: '72px' }} />
              <col /> {/* Name — auto */}
              {showBranchCol && <col style={{ width: '90px' }} />}
              <col style={{ width: '52px' }} />
              <col style={{ width: '85px' }} />
              <col style={{ width: '48px' }} />
              <col style={{ width: '90px' }} />
              <col style={{ width: '80px' }} />
              <col style={{ width: '85px' }} />
              <col style={{ width: '40px' }} />
              <col style={{ width: '40px' }} />
            </colgroup>
            <thead>
              <tr className={table.headerRow}>
                <th className={table.headerCell} />
                <th className={table.headerCell}>SKU ID</th>
                <th className={table.headerCell}>Name</th>
                {showBranchCol && <th className={table.headerCell}>Branch</th>}
                <th className={table.headerCellCenter}>Type</th>
                <th className={table.headerCellNumeric}>Count</th>
                <th className={table.headerCellCenter}>UOM</th>
                <th className={table.headerCell}>Last Count</th>
                <th className={table.headerCellNumeric}>Cover Day</th>
                <th className={table.headerCellNumeric}>Avg/Week</th>
                <th className={table.headerCell} />
                <th className={table.headerCell} />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className={table.dataRow}>
                    {Array.from({ length: showBranchCol ? 12 : 11 }).map((_, j) => (
                      <td key={j} className={table.dataCell}>
                        <div className={j === 2 ? table.skeletonCellName : table.skeletonCellNumeric} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={showBranchCol ? 12 : 11} className={table.emptyState}>
                    <div className="flex flex-col items-center gap-2">
                      <ClipboardList className="w-8 h-8 text-muted-foreground" />
                      <span>
                        {data.length === 0
                          ? 'No count sheets submitted yet for this branch. Generate and submit a Daily Stock Count to see stock here.'
                          : 'No SKUs match your search.'}
                      </span>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredRows.map(row => {
                  const sku = skuMap.get(row.sku_id);
                  if (!sku) return null;
                  const branch = branchMap.get(row.branch_id);
                  const pc = row.physical_count;
                  const isOut = (pc ?? 0) <= 0;
                  const coverDay = (pc != null && pc > 0 && row.expected_usage > 0)
                    ? pc / row.expected_usage
                    : null;
                  const avgWeek = row.expected_usage > 0
                    ? Math.round(row.expected_usage * 7)
                    : null;

                  return (
                    <tr key={row.id} className={table.dataRow}>
                      <td className={table.dataCellCenter}>
                        <StatusDot color={isOut ? 'red' : 'green'} />
                      </td>
                      <td className={`${table.dataCell} font-mono text-xs`}>{sku.skuId}</td>
                      <td className={table.truncatedCell} title={sku.name}>{sku.name}</td>
                      {showBranchCol && (
                        <td className={table.truncatedCell} title={branch?.branchName || ''}>
                          {branch?.branchName || '—'}
                        </td>
                      )}
                      <td className={table.dataCellCenter}>
                        <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-xs font-medium ${
                          sku.type === 'SM'
                            ? 'bg-primary/15 text-primary'
                            : 'bg-muted text-muted-foreground'
                        }`}>
                          {sku.type}
                        </span>
                      </td>
                      <td className={table.dataCellMono}>
                        {pc != null ? (
                          <span className={isOut ? 'text-destructive' : ''}>
                            {Math.round(pc).toLocaleString()}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className={`${table.dataCellCenter} text-xs font-medium text-primary`}>
                        {sku.usageUom}
                      </td>
                      <td className={`${table.dataCell} text-xs text-muted-foreground`}>{row.count_date}</td>
                      <td className={table.dataCellMono}>
                        <span className="text-muted-foreground">
                          {coverDay != null ? coverDay.toFixed(1) : '—'}
                        </span>
                      </td>
                      <td className={table.dataCellMono}>
                        <span className="text-muted-foreground">
                          {avgWeek != null ? avgWeek.toLocaleString() : '—'}
                        </span>
                      </td>
                      <td className={table.dataCellCenter}>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          title="Adjust stock"
                          onClick={() => setAdjustModal({
                            skuId: sku.id,
                            skuName: sku.name,
                            usageUom: sku.usageUom,
                            currentStock: pc ?? 0,
                            skuType: sku.type,
                          })}
                        >
                          <SlidersHorizontal className="w-3.5 h-3.5" />
                        </Button>
                      </td>
                      <td className={table.dataCellCenter}>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          title="Stock history"
                          onClick={() => setStockCardSku({
                            skuId: sku.id,
                            skuType: sku.type as 'RM' | 'SM',
                            sku,
                            currentStock: pc ?? 0,
                            stockValue: 0,
                          })}
                        >
                          <History className="w-3.5 h-3.5" />
                        </Button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modals */}
      {adjustModal && (
        <StockAdjustmentModal
          open={!!adjustModal}
          onClose={() => setAdjustModal(null)}
          skuId={adjustModal.skuId}
          skuName={adjustModal.skuName}
          usageUom={adjustModal.usageUom}
          currentStock={adjustModal.currentStock}
          onSubmit={handleAdjustSubmit}
        />
      )}

      {stockCardSku && (
        <StockCard
          skuId={stockCardSku.skuId}
          skuType={stockCardSku.skuType}
          sku={stockCardSku.sku}
          skus={skus}
          currentStock={stockCardSku.currentStock}
          stockValue={stockCardSku.stockValue}
          onClose={() => setStockCardSku(null)}
        />
      )}
    </div>
  );
}
