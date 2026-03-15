import { useState, useMemo, useEffect } from 'react';
import { SKU, CATEGORY_LABELS, Category, StorageCondition } from '@/types/sku';
import { useSortableTable } from '@/hooks/use-sortable-table';
import { SortableHeader } from '@/components/SortableHeader';
import { StockBalance, StockAdjustment } from '@/types/stock';
import { BOMHeader, BOMLine } from '@/types/bom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { SlidersHorizontal, Search, Package, History } from 'lucide-react';
import { StockAdjustmentModal } from '@/components/StockAdjustmentModal';
import { StockCard } from '@/components/StockCard';
import { StatusDot } from '@/components/ui/status-dot';
import { UnitLabel } from '@/components/ui/unit-label';
import { toast } from 'sonner';
import { useLanguage } from '@/hooks/use-language';
import { table, formatNumber } from '@/lib/design-tokens';
import { cn } from '@/lib/utils';

interface Props {
  skus: SKU[];
  stockData: {
    stockBalances: StockBalance[];
    setOpeningStock: (skuId: string, qty: number) => void;
    addAdjustment: (adj: Omit<StockAdjustment, 'id'>) => void;
    getStdUnitPrice: (skuId: string) => number;
    getLastReceiptDate: (skuId: string) => string | null;
    openingStocks: Record<string, number>;
  };
  bomHeaders: BOMHeader[];
  bomLines: BOMLine[];
}

export default function RMStockPage({ skus, stockData, bomHeaders, bomLines }: Props) {
  const { stockBalances, addAdjustment, getStdUnitPrice, getLastReceiptDate } = stockData;
  const { t } = useLanguage();

  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [filterStorage, setFilterStorage] = useState<string>('all');
  const [ckItemsOnly, setCkItemsOnly] = useState(true);
  const [adjustModal, setAdjustModal] = useState<{ skuId: string; skuName: string; usageUom: string; currentStock: number } | null>(null);
  const [stockCardSku, setStockCardSku] = useState<{ skuId: string; skuType: 'RM' | 'SM'; sku: SKU; currentStock: number; stockValue: number } | null>(null);

  const [rmDailyUsage, setRmDailyUsage] = useState<Record<string, number>>({});

  useEffect(() => {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    import('@/integrations/supabase/client').then(({ supabase }) => {
      supabase
        .from('production_records')
        .select('sm_sku_id, batches_produced')
        .gte('production_date', sevenDaysAgo.toISOString().split('T')[0])
        .then(({ data }) => {
          if (!data) return;
          const usage: Record<string, number> = {};
          data.forEach((rec: any) => {
            const header = bomHeaders.find(h => h.smSkuId === rec.sm_sku_id);
            if (!header) return;
            bomLines.filter(l => l.bomHeaderId === header.id).forEach(line => {
              usage[line.rmSkuId] = (usage[line.rmSkuId] || 0) +
                (rec.batches_produced * line.qtyPerBatch) / 7;
            });
          });
          setRmDailyUsage(usage);
        });
    });
  }, [bomHeaders, bomLines]);

  const rmSkus = useMemo(() => skus.filter(s => s.type === 'RM'), [skus]);

  const ckRmSkuIds = useMemo(() => {
    const activeSmSkuIds = new Set(
      skus.filter(s => s.type === 'SM' && s.status === 'Active').map(s => s.id)
    );
    const activeHeaderIds = new Set(
      bomHeaders.filter(h => activeSmSkuIds.has(h.smSkuId)).map(h => h.id)
    );
    const rmIds = new Set<string>();
    bomLines.forEach(l => {
      if (activeHeaderIds.has(l.bomHeaderId)) rmIds.add(l.rmSkuId);
    });
    return rmIds;
  }, [skus, bomHeaders, bomLines]);

  type RMRow = { sku: SKU; balance: any; stdUnit: number; lastDate: string | null; currentStock: number; stockValue: number; healthStatus: 'red' | 'green' };

  const rmComparators = useMemo(() => ({
    skuId: (a: RMRow, b: RMRow) => a.sku.skuId.localeCompare(b.sku.skuId),
    name: (a: RMRow, b: RMRow) => a.sku.name.localeCompare(b.sku.name),
    category: (a: RMRow, b: RMRow) => a.sku.category.localeCompare(b.sku.category),
    currentStock: (a: RMRow, b: RMRow) => a.currentStock - b.currentStock,
    stockValue: (a: RMRow, b: RMRow) => a.stockValue - b.stockValue,
    coverDay: (a: RMRow, b: RMRow) => {
      const aUsage = rmDailyUsage[a.sku.id] || 0;
      const bUsage = rmDailyUsage[b.sku.id] || 0;
      const aCd = (aUsage > 0 && a.currentStock > 0) ? a.currentStock / aUsage : Infinity;
      const bCd = (bUsage > 0 && b.currentStock > 0) ? b.currentStock / bUsage : Infinity;
      return aCd - bCd;
    },
    avgWeek: (a: RMRow, b: RMRow) => {
      const aUsage = rmDailyUsage[a.sku.id] || 0;
      const bUsage = rmDailyUsage[b.sku.id] || 0;
      return (aUsage * 7) - (bUsage * 7);
    },
  }), [rmDailyUsage]);

  const filteredRows = useMemo(() => {
    return rmSkus
      .map(sku => {
        const balance = stockBalances.find(b => b.skuId === sku.id);
        const stdUnit = getStdUnitPrice(sku.id);
        const lastDate = getLastReceiptDate(sku.id);
        const currentStock = balance?.currentStock ?? 0;
        const stockValue = currentStock * stdUnit;
        const healthStatus: 'red' | 'green' = currentStock <= 0 ? 'red' : 'green';
        return { sku, balance, stdUnit, lastDate, currentStock, stockValue, healthStatus };
      })
      .filter(row => {
        if (search && !row.sku.name.toLowerCase().includes(search.toLowerCase()) && !row.sku.skuId.toLowerCase().includes(search.toLowerCase())) return false;
        if (filterCategory !== 'all' && row.sku.category !== filterCategory) return false;
        if (filterStorage !== 'all' && row.sku.storageCondition !== filterStorage) return false;
        if (ckItemsOnly && !ckRmSkuIds.has(row.sku.id)) return false;
        return true;
      });
  }, [rmSkus, stockBalances, getStdUnitPrice, getLastReceiptDate, search, filterCategory, filterStorage, ckItemsOnly, ckRmSkuIds]);

  const { sorted: sortedRows, sortKey, sortDir, handleSort } = useSortableTable(filteredRows, rmComparators);
  const totalStockValue = useMemo(() => filteredRows.reduce((s, r) => s + r.stockValue, 0), [filteredRows]);

  const coverDayByStorage = useMemo(() => {
    const groups: Record<string, number[]> = { Chilled: [], Frozen: [], Ambient: [] };
    filteredRows.forEach(row => {
      const dailyUsage = rmDailyUsage[row.sku.id] || 0;
      if (dailyUsage > 0 && row.currentStock > 0) {
        const cd = row.currentStock / dailyUsage;
        const storage = row.sku.storageCondition;
        if (groups[storage]) groups[storage].push(cd);
      }
    });
    const avg = (arr: number[]) =>
      arr.length > 0 ? (arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(1) : '—';
    return {
      Chilled: avg(groups.Chilled),
      Frozen: avg(groups.Frozen),
      Ambient: avg(groups.Ambient),
    };
  }, [filteredRows, rmDailyUsage]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">{t('title.rmStock')}</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Auto-calculated raw material stock balances</p>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('summary.rmSkus')}</p>
          <p className="text-2xl font-bold mt-1">{rmSkus.length}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('summary.totalStockValue')}</p>
          <p className="text-2xl font-bold mt-1 font-mono">฿{Math.round(totalStockValue).toLocaleString()}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">Cover Day By Storage</p>
          <div className="space-y-1">
            {(['Chilled', 'Frozen', 'Ambient'] as const).map(s => (
              <div key={s} className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">{s}</span>
                <span className="text-sm font-mono font-semibold">
                  {coverDayByStorage[s]}
                  {coverDayByStorage[s] !== '—' && (
                    <span className="text-xs text-muted-foreground ml-1">วัน</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search SKU..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={filterCategory} onValueChange={setFilterCategory}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('common.allCategories')}</SelectItem>
            {(Object.entries(CATEGORY_LABELS) as [Category, string][]).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterStorage} onValueChange={setFilterStorage}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Storage" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('common.allStorage')}</SelectItem>
            {(['Frozen', 'Chilled', 'Ambient'] as StorageCondition[]).map(s => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Switch
            id="ck-items-toggle-rm"
            checked={ckItemsOnly}
            onCheckedChange={setCkItemsOnly}
          />
          <label htmlFor="ck-items-toggle-rm" className="text-xs font-medium cursor-pointer whitespace-nowrap">
            CK Items Only
          </label>
        </div>
      </div>

      {/* Table */}
      <div className={cn(table.wrapper, 'overflow-x-auto overflow-y-auto max-h-[70vh]')}>
        <table className={table.base}>
          <colgroup>
            <col style={{ width: '28px' }} />
            <col style={{ width: '80px' }} />
            <col style={{ width: '200px' }} />
            <col style={{ width: '90px' }} />
            <col style={{ width: '48px' }} />
            <col style={{ width: '95px' }} />
            <col style={{ width: '95px' }} />
            <col style={{ width: '75px' }} />
            <col style={{ width: '95px' }} />
            <col style={{ width: '40px' }} />
            <col style={{ width: '40px' }} />
          </colgroup>
          <thead className="sticky top-0 z-[5]">
            <tr className={table.headerRow}>
              <th className={table.headerCellCenter}></th>
              <th className={table.headerCellSortable} onClick={() => handleSort('skuId')}>
                <SortableHeader label={t('col.skuId')} sortKey="skuId" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
              </th>
              <th className={table.headerCellSortable} onClick={() => handleSort('name')}>
                <SortableHeader label={t('col.name')} sortKey="name" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
              </th>
              <th className={table.headerCellNumeric} onClick={() => handleSort('currentStock')} style={{ cursor: 'pointer' }}>
                <SortableHeader label={t('col.currentStock')} sortKey="currentStock" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="justify-end" />
              </th>
              <th className={table.headerCellCenter}>{t('col.uom')}</th>
              <th className={table.headerCellNumeric} onClick={() => handleSort('stockValue')} style={{ cursor: 'pointer' }}>
                <SortableHeader label={t('col.stockValue')} sortKey="stockValue" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="justify-end" />
              </th>
              <th className={table.headerCell}>{t('col.lastReceipt')}</th>
              <th className={table.headerCellNumeric} onClick={() => handleSort('coverDay')} style={{ cursor: 'pointer' }}>
                <SortableHeader label={t('col.daysLeft')} sortKey="coverDay" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="justify-end" />
              </th>
              <th className={table.headerCellNumeric} onClick={() => handleSort('avgWeek')} style={{ cursor: 'pointer' }}>
                <SortableHeader label="Avg/Week" sortKey="avgWeek" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="justify-end" />
              </th>
              <th className={table.headerCell}></th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <tr>
                <td colSpan={10} className={table.emptyState}>
                  <Package className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  No RM SKUs found.
                </td>
              </tr>
            ) : (
              sortedRows.map(row => {
                const dailyUsage = rmDailyUsage[row.sku.id] || 0;
                const coverDay = (dailyUsage > 0 && row.currentStock > 0) ? row.currentStock / dailyUsage : null;
                const avgWeek = dailyUsage * 7;
                return (
                  <tr key={row.sku.id} className={table.dataRow}>
                    <td className={table.dataCellCenter}><StatusDot status={row.healthStatus} /></td>
                    <td className={cn(table.dataCell, 'font-mono text-xs')}>{row.sku.skuId}</td>
                    <td className={table.truncatedCell} title={row.sku.name}>{row.sku.name}</td>
                    <td className={table.dataCellMono}>{row.currentStock > 0 ? Math.round(row.currentStock).toLocaleString() : '—'}</td>
                    <td className={cn(table.dataCellCenter, 'text-xs font-medium text-primary')}>{row.sku.usageUom}</td>
                    <td className={table.dataCellMono}>{row.stockValue > 0 ? `฿${Math.round(row.stockValue).toLocaleString()}` : '—'}</td>
                    <td className={table.dataCell}>{row.lastDate ?? '—'}</td>
                    <td className={cn(table.dataCellMono, 'text-muted-foreground')}>{coverDay !== null ? coverDay.toFixed(1) : '—'}</td>
                    <td className={table.dataCellMono}>
                      {avgWeek > 0 ? (
                        <>{Math.round(avgWeek).toLocaleString()} <UnitLabel unit={row.sku.usageUom} /></>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className={table.dataCellCenter}>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => setAdjustModal({
                          skuId: row.sku.id,
                          skuName: row.sku.name,
                          usageUom: row.sku.usageUom,
                          currentStock: row.currentStock,
                        })}
                      >
                        <SlidersHorizontal className="w-3.5 h-3.5" />
                      </Button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {adjustModal && (
        <StockAdjustmentModal
          open
          onClose={() => setAdjustModal(null)}
          skuId={adjustModal.skuId}
          skuName={adjustModal.skuName}
          usageUom={adjustModal.usageUom}
          currentStock={adjustModal.currentStock}
          onSubmit={data => {
            addAdjustment(data);
            toast.success('Stock adjusted');
          }}
        />
      )}
    </div>
  );
}