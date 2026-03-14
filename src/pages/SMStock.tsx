import { useState, useMemo, useEffect } from 'react';
import { SKU, CATEGORY_LABELS, Category, StorageCondition } from '@/types/sku';
import { useSortableTable } from '@/hooks/use-sortable-table';
import { SortableHeader } from '@/components/SortableHeader';
import { StockAdjustment } from '@/types/stock';
import { SMStockBalance } from '@/hooks/use-sm-stock-data';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SlidersHorizontal, Search, Package } from 'lucide-react';
import { StockAdjustmentModal } from '@/components/StockAdjustmentModal';
import { StatusDot } from '@/components/ui/status-dot';
import { toast } from 'sonner';
import { useLanguage } from '@/hooks/use-language';
import { table } from '@/lib/design-tokens';
import { cn } from '@/lib/utils';

interface Props {
  skus: SKU[];
  smStockData: {
    stockBalances: SMStockBalance[];
    setOpeningStock: (skuId: string, qty: number) => void;
    addAdjustment: (adj: Omit<StockAdjustment, 'id'>) => void;
    getBomCostPerGram: (skuId: string) => number;
    getLastProductionDate: (skuId: string) => string | null;
    openingStocks: Record<string, number>;
  };
}

export default function SMStockPage({ skus, smStockData }: Props) {
  const { stockBalances, addAdjustment, getBomCostPerGram, getLastProductionDate } = smStockData;
  const { t } = useLanguage();

  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [filterStorage, setFilterStorage] = useState<string>('all');
  const [adjustModal, setAdjustModal] = useState<{ skuId: string; skuName: string; usageUom: string; currentStock: number } | null>(null);

  const [smDailyUsage, setSmDailyUsage] = useState<Record<string, number>>({});

  useEffect(() => {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    import('@/integrations/supabase/client').then(({ supabase }) => {
      Promise.all([
        supabase.from('sales_entries').select('menu_code, qty')
          .gte('sale_date', sevenDaysAgo.toISOString().split('T')[0]),
        supabase.from('menu_bom').select('menu_id, sku_id, effective_qty'),
        supabase.from('menus').select('id, menu_code'),
      ]).then(([salesRes, bomRes, menusRes]) => {
        if (!salesRes.data || !bomRes.data || !menusRes.data) return;
        const menuCodeToId = new Map(
          menusRes.data.map((m: any) => [m.menu_code, m.id])
        );
        const smSkuIds = new Set(skus.filter(s => s.type === 'SM').map(s => s.id));
        const usage: Record<string, number> = {};
        salesRes.data.forEach((sale: any) => {
          const menuId = menuCodeToId.get(sale.menu_code);
          if (!menuId) return;
          bomRes.data!
            .filter((l: any) => l.menu_id === menuId && smSkuIds.has(l.sku_id))
            .forEach((line: any) => {
              usage[line.sku_id] = (usage[line.sku_id] || 0) +
                (line.effective_qty * Number(sale.qty)) / 7;
            });
        });
        setSmDailyUsage(usage);
      });
    });
  }, [skus]);

  const smSkus = useMemo(() => skus.filter(s => s.type === 'SM'), [skus]);

  type SMRow = { sku: SKU; balance: any; lastDate: string | null; currentStock: number; stockValue: number; healthStatus: 'red' | 'green' };

  const smComparators = useMemo(() => ({
    skuId: (a: SMRow, b: SMRow) => a.sku.skuId.localeCompare(b.sku.skuId),
    name: (a: SMRow, b: SMRow) => a.sku.name.localeCompare(b.sku.name),
    category: (a: SMRow, b: SMRow) => a.sku.category.localeCompare(b.sku.category),
    currentStock: (a: SMRow, b: SMRow) => a.currentStock - b.currentStock,
    stockValue: (a: SMRow, b: SMRow) => a.stockValue - b.stockValue,
    coverDay: (a: SMRow, b: SMRow) => {
      const aUsage = smDailyUsage[a.sku.id] || 0;
      const bUsage = smDailyUsage[b.sku.id] || 0;
      const aCd = aUsage > 0 ? a.currentStock / aUsage : Infinity;
      const bCd = bUsage > 0 ? b.currentStock / bUsage : Infinity;
      return aCd - bCd;
    },
  }), [smDailyUsage]);

  const filteredRows = useMemo(() => {
    return smSkus
      .map(sku => {
        const balance = stockBalances.find(b => b.skuId === sku.id);
        const lastDate = getLastProductionDate(sku.id);
        const currentStock = balance?.currentStock ?? 0;
        const stockValue = currentStock * getBomCostPerGram(sku.id);
        const healthStatus: 'red' | 'green' = currentStock <= 0 ? 'red' : 'green';
        return { sku, balance, lastDate, currentStock, stockValue, healthStatus };
      })
      .filter(row => {
        if (search && !row.sku.name.toLowerCase().includes(search.toLowerCase()) && !row.sku.skuId.toLowerCase().includes(search.toLowerCase())) return false;
        if (filterCategory !== 'all' && row.sku.category !== filterCategory) return false;
        if (filterStorage !== 'all' && row.sku.storageCondition !== filterStorage) return false;
        return true;
      });
  }, [smSkus, stockBalances, getLastProductionDate, getBomCostPerGram, search, filterCategory, filterStorage]);

  const { sorted: sortedRows, sortKey, sortDir, handleSort } = useSortableTable(filteredRows, smComparators);

  const totalStockValue = useMemo(() => filteredRows.reduce((s, r) => s + r.stockValue, 0), [filteredRows]);

  const coverDayByStorage = useMemo(() => {
    const groups: Record<string, number[]> = { Chilled: [], Frozen: [], Ambient: [] };
    filteredRows.forEach(row => {
      const dailyUsage = smDailyUsage[row.sku.id] || 0;
      if (dailyUsage > 0) {
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
  }, [filteredRows, smDailyUsage]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">{t('title.smStock')}</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Semi-finished product stock balances</p>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('summary.smSkus')}</p>
          <p className="text-2xl font-bold mt-1">{smSkus.length}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">TOTAL STOCK VALUE</p>
          <p className="text-2xl font-bold mt-1 font-mono">฿{Math.round(totalStockValue).toLocaleString()}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">COVER DAY BY STORAGE</p>
          <div className="mt-1 space-y-0.5">
            {(['Chilled', 'Frozen', 'Ambient'] as const).map(storage => (
              <div key={storage} className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{storage}</span>
                <span className="text-sm font-mono">
                  {coverDayByStorage[storage] === '—' ? '—' : `${coverDayByStorage[storage]} วัน`}
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
          <Input placeholder="Search SKU..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={filterCategory} onValueChange={setFilterCategory}>
          <SelectTrigger className="w-[150px]"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('common.allCategories')}</SelectItem>
            {(Object.entries(CATEGORY_LABELS) as [Category, string][]).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterStorage} onValueChange={setFilterStorage}>
          <SelectTrigger className="w-[150px]"><SelectValue placeholder="Storage" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('common.allStorage')}</SelectItem>
            {(['Frozen', 'Chilled', 'Ambient'] as StorageCondition[]).map(s => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className={cn(table.wrapper, 'overflow-auto max-h-[70vh]')}>
        <table className={table.base}>
          <colgroup>
            <col style={{ width: '28px' }} />
            <col style={{ width: '72px' }} />
            <col style={{ width: 'auto' }} />
            <col style={{ width: '85px' }} />
            <col style={{ width: '48px' }} />
            <col style={{ width: '90px' }} />
            <col style={{ width: '90px' }} />
            <col style={{ width: '80px' }} />
            <col style={{ width: '40px' }} />
          </colgroup>
          <thead className="sticky top-0 z-[5]">
            <tr className={table.headerRow}>
              <th className={table.headerCell}></th>
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
              <th className={table.headerCell}>{t('col.lastProduction')}</th>
              <th className={table.headerCellNumeric} onClick={() => handleSort('coverDay')} style={{ cursor: 'pointer' }}>
                <SortableHeader label={t('col.daysLeft')} sortKey="coverDay" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="justify-end" />
              </th>
              <th className={table.headerCell}></th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <tr>
                <td colSpan={9} className={table.emptyState}>
                  <Package className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  No SM SKUs found.
                </td>
              </tr>
            ) : (
              sortedRows.map(row => {
                const dailyUsage = smDailyUsage[row.sku.id] || 0;
                const coverDay = dailyUsage > 0 ? row.currentStock / dailyUsage : null;
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
                    <td className={table.dataCellCenter}>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => setAdjustModal({
                          skuId: row.sku.id,
                          skuName: row.sku.name,
                          usageUom: row.sku.usageUom || '',
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
