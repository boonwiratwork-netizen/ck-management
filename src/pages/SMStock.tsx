import { useState, useMemo } from 'react';
import { SKU, CATEGORY_LABELS, Category, StorageCondition } from '@/types/sku';
import { useSortableTable } from '@/hooks/use-sortable-table';
import { SortableHeader } from '@/components/SortableHeader';
import { StockAdjustment } from '@/types/stock';
import { SMStockBalance } from '@/hooks/use-sm-stock-data';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { SlidersHorizontal, Search, Package } from 'lucide-react';
import { StockAdjustmentModal } from '@/components/StockAdjustmentModal';
import { StatusDot } from '@/components/ui/status-dot';
import { UnitLabel } from '@/components/ui/unit-label';
import { toast } from 'sonner';
import { useLanguage } from '@/hooks/use-language';

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
  const { stockBalances, setOpeningStock, addAdjustment, getBomCostPerGram, getLastProductionDate, openingStocks } = smStockData;
  const { t } = useLanguage();

  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [filterStorage, setFilterStorage] = useState<string>('all');
  const [adjustModal, setAdjustModal] = useState<{ skuId: string; skuName: string; usageUom: string; currentStock: number } | null>(null);
  const [editingOpening, setEditingOpening] = useState<string | null>(null);
  const [openingValue, setOpeningValue] = useState('');

  const smSkus = useMemo(() => skus.filter(s => s.type === 'SM'), [skus]);

  type SMRow = { sku: SKU; balance: any; lastDate: string | null; currentStock: number; opening: number; stockValue: number; healthStatus: 'red' | 'yellow' | 'green' };

  const smComparators = useMemo(() => ({
    skuId: (a: SMRow, b: SMRow) => a.sku.skuId.localeCompare(b.sku.skuId),
    name: (a: SMRow, b: SMRow) => a.sku.name.localeCompare(b.sku.name),
    category: (a: SMRow, b: SMRow) => a.sku.category.localeCompare(b.sku.category),
    storage: (a: SMRow, b: SMRow) => a.sku.storageCondition.localeCompare(b.sku.storageCondition),
    opening: (a: SMRow, b: SMRow) => a.opening - b.opening,
    produced: (a: SMRow, b: SMRow) => (a.balance?.totalProduced ?? 0) - (b.balance?.totalProduced ?? 0),
    delivered: (a: SMRow, b: SMRow) => (a.balance?.totalDelivered ?? 0) - (b.balance?.totalDelivered ?? 0),
    currentStock: (a: SMRow, b: SMRow) => a.currentStock - b.currentStock,
  }), []);

  const filteredRows = useMemo(() => {
    return smSkus
      .map(sku => {
        const balance = stockBalances.find(b => b.skuId === sku.id);
        const lastDate = getLastProductionDate(sku.id);
        const currentStock = balance?.currentStock ?? 0;
        const opening = balance?.openingStock ?? 0;
        const stockValue = currentStock * getBomCostPerGram(sku.id);

        let healthStatus: 'red' | 'yellow' | 'green' = 'green';
        if (currentStock <= 0) healthStatus = 'red';
        else if (opening > 0 && currentStock < opening * 0.2) healthStatus = 'yellow';

        return { sku, balance, lastDate, currentStock, opening, stockValue, healthStatus };
      })
      .filter(row => {
        if (search && !row.sku.name.toLowerCase().includes(search.toLowerCase()) && !row.sku.skuId.toLowerCase().includes(search.toLowerCase())) return false;
        if (filterCategory !== 'all' && row.sku.category !== filterCategory) return false;
        if (filterStorage !== 'all' && row.sku.storageCondition !== filterStorage) return false;
        return true;
      });
  }, [smSkus, stockBalances, getLastProductionDate, search, filterCategory, filterStorage]);

  const { sorted: sortedRows, sortKey, sortDir, handleSort } = useSortableTable(filteredRows, smComparators);
  const handleOpeningSubmit = (skuId: string) => {
    setOpeningStock(skuId, Number(openingValue) || 0);
    setEditingOpening(null);
    toast.success('Opening stock set');
  };

  const mapHealth = (status: 'red' | 'yellow' | 'green'): 'red' | 'amber' | 'green' =>
    status === 'yellow' ? 'amber' : status;

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
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">TOTAL STOCK</p>
          <p className="text-2xl font-bold mt-1 font-mono">
            {filteredRows.reduce((s, r) => s + r.currentStock, 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}
          </p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('summary.outOfStock')}</p>
          <p className="text-2xl font-bold mt-1 text-destructive">
            {filteredRows.filter(r => r.healthStatus === 'red').length}
          </p>
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
      <div className="rounded-lg border overflow-auto max-h-[70vh]">
        <Table>
          <TableHeader className="sticky-thead">
            <TableRow className="bg-table-header border-b">
              <TableHead className="w-8"></TableHead>
              <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground cursor-pointer hover:bg-muted/50" onClick={() => handleSort('skuId')}>
                <SortableHeader label={t('col.skuId')} sortKey="skuId" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
              </TableHead>
              <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground cursor-pointer hover:bg-muted/50" onClick={() => handleSort('name')}>
                <SortableHeader label={t('col.name')} sortKey="name" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
              </TableHead>
              <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground cursor-pointer hover:bg-muted/50" onClick={() => handleSort('storage')}>
                <SortableHeader label={t('col.storage')} sortKey="storage" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
              </TableHead>
              <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground text-right cursor-pointer hover:bg-muted/50" onClick={() => handleSort('opening')}>
                <SortableHeader label="Opening" sortKey="opening" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="justify-end" />
              </TableHead>
              <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground text-right cursor-pointer hover:bg-muted/50" onClick={() => handleSort('produced')}>
                <SortableHeader label="Produced" sortKey="produced" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="justify-end" />
              </TableHead>
              <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground text-right cursor-pointer hover:bg-muted/50" onClick={() => handleSort('delivered')}>
                <SortableHeader label="Delivered" sortKey="delivered" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="justify-end" />
              </TableHead>
              <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground text-right">Adjustments</TableHead>
              <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground text-right cursor-pointer hover:bg-muted/50" onClick={() => handleSort('currentStock')}>
                <SortableHeader label="Current Stock" sortKey="currentStock" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="justify-end" />
              </TableHead>
              <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('col.uom')}</TableHead>
              <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground text-right">Stock Value</TableHead>
              <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('col.lastProduction')}</TableHead>
              <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground text-right">{t('col.daysLeft')}</TableHead>
              <TableHead className="w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={14} className="text-center py-10 text-muted-foreground">
                  <Package className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  No SM SKUs found
                </TableCell>
              </TableRow>
            ) : (
              sortedRows.map(row => {
                const netAdj = (row.balance?.adjustments ?? []).reduce((s, a) => s + a.quantity, 0);
                return (
                  <TableRow key={row.sku.id} className="border-b border-table-border hover:bg-table-hover transition-colors">
                    <TableCell className="px-3 py-2"><StatusDot status={mapHealth(row.healthStatus)} /></TableCell>
                    <TableCell className="px-3 py-2 font-mono text-xs">{row.sku.skuId}</TableCell>
                    <TableCell className="px-3 py-2 text-sm font-medium">{row.sku.name}</TableCell>
                    <TableCell className="px-3 py-2 text-sm">{row.sku.storageCondition}</TableCell>
                    <TableCell className="px-3 py-2 text-right">
                      {editingOpening === row.sku.id ? (
                        <div className="flex items-center gap-1 justify-end">
                          <Input
                            type="number"
                            className="w-24 h-7 text-xs text-right"
                            value={openingValue}
                            onChange={e => setOpeningValue(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleOpeningSubmit(row.sku.id)}
                            autoFocus
                          />
                          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => handleOpeningSubmit(row.sku.id)}>✓</Button>
                          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setEditingOpening(null)}>✗</Button>
                        </div>
                      ) : (
                        <span
                          className="cursor-pointer hover:underline text-sm font-mono"
                          onClick={() => { setEditingOpening(row.sku.id); setOpeningValue(String(row.opening)); }}
                        >
                          {row.opening.toLocaleString()}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="px-3 py-2 text-sm font-mono text-right">
                      {(row.balance?.totalProduced ?? 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}
                    </TableCell>
                    <TableCell className="px-3 py-2 text-sm font-mono text-right">
                      {(row.balance?.totalDelivered ?? 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}
                    </TableCell>
                    <TableCell className={`px-3 py-2 text-sm font-mono text-right ${netAdj > 0 ? 'text-success' : netAdj < 0 ? 'text-destructive' : ''}`}>
                      {netAdj !== 0 ? (netAdj > 0 ? '+' : '') + netAdj.toLocaleString() : '—'}
                    </TableCell>
                    <TableCell className="px-3 py-2 text-sm font-mono text-right font-semibold">
                      {row.currentStock.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                    </TableCell>
                    <TableCell className="px-3 py-2"><UnitLabel unit={row.sku.usageUom} /></TableCell>
                    <TableCell className="px-3 py-2 text-sm font-mono text-right">
                      {row.stockValue > 0 ? `฿${row.stockValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                    </TableCell>
                    <TableCell className="px-3 py-2 text-sm">{row.lastDate ?? '—'}</TableCell>
                    <TableCell className="px-3 py-2 text-sm font-mono text-right text-muted-foreground">0</TableCell>
                    <TableCell className="px-3 py-2">
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
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
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
