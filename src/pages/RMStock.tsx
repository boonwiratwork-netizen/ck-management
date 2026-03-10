import { useState, useMemo } from 'react';
import { SKU, CATEGORY_LABELS, Category, StorageCondition } from '@/types/sku';
import { useSortableTable } from '@/hooks/use-sortable-table';
import { SortableHeader } from '@/components/SortableHeader';
import { StockBalance, StockAdjustment } from '@/types/stock';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Pencil, SlidersHorizontal, Search, Package } from 'lucide-react';
import { StockAdjustmentModal } from '@/components/StockAdjustmentModal';
import { toast } from 'sonner';
import { useLanguage } from '@/hooks/use-language';

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
}

export default function RMStockPage({ skus, stockData }: Props) {
  const { stockBalances, setOpeningStock, addAdjustment, getStdUnitPrice, getLastReceiptDate, openingStocks } = stockData;
  const { t } = useLanguage();

  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [filterStorage, setFilterStorage] = useState<string>('all');
  const [adjustModal, setAdjustModal] = useState<{ skuId: string; skuName: string; usageUom: string; currentStock: number } | null>(null);
  const [editingOpening, setEditingOpening] = useState<string | null>(null);
  const [openingValue, setOpeningValue] = useState('');

  const rmSkus = useMemo(() => skus.filter(s => s.type === 'RM'), [skus]);

  type RMRow = { sku: SKU; balance: any; stdUnit: number; lastDate: string | null; currentStock: number; opening: number; stockValue: number; healthStatus: 'red' | 'yellow' | 'green' };

  const rmComparators = useMemo(() => ({
    skuId: (a: RMRow, b: RMRow) => a.sku.skuId.localeCompare(b.sku.skuId),
    name: (a: RMRow, b: RMRow) => a.sku.name.localeCompare(b.sku.name),
    category: (a: RMRow, b: RMRow) => a.sku.category.localeCompare(b.sku.category),
    storage: (a: RMRow, b: RMRow) => a.sku.storageCondition.localeCompare(b.sku.storageCondition),
    opening: (a: RMRow, b: RMRow) => a.opening - b.opening,
    received: (a: RMRow, b: RMRow) => (a.balance?.totalReceived ?? 0) - (b.balance?.totalReceived ?? 0),
    currentStock: (a: RMRow, b: RMRow) => a.currentStock - b.currentStock,
    stockValue: (a: RMRow, b: RMRow) => a.stockValue - b.stockValue,
  }), []);

  const filteredRows = useMemo(() => {
    return rmSkus
      .map(sku => {
        const balance = stockBalances.find(b => b.skuId === sku.id);
        const stdUnit = getStdUnitPrice(sku.id);
        const lastDate = getLastReceiptDate(sku.id);
        const currentStock = balance?.currentStock ?? 0;
        const opening = balance?.openingStock ?? 0;
        const stockValue = currentStock * stdUnit;

        let healthStatus: 'red' | 'yellow' | 'green' = 'green';
        if (currentStock <= 0) healthStatus = 'red';
        else if (opening > 0 && currentStock < opening * 0.2) healthStatus = 'yellow';

        return { sku, balance, stdUnit, lastDate, currentStock, opening, stockValue, healthStatus };
      })
      .filter(row => {
        if (search && !row.sku.name.toLowerCase().includes(search.toLowerCase()) && !row.sku.skuId.toLowerCase().includes(search.toLowerCase())) return false;
        if (filterCategory !== 'all' && row.sku.category !== filterCategory) return false;
        if (filterStorage !== 'all' && row.sku.storageCondition !== filterStorage) return false;
        return true;
      });
  }, [rmSkus, stockBalances, getStdUnitPrice, getLastReceiptDate, search, filterCategory, filterStorage]);

  const { sorted: sortedRows, sortKey, sortDir, handleSort } = useSortableTable(filteredRows, rmComparators);
  const totalStockValue = useMemo(() => filteredRows.reduce((s, r) => s + r.stockValue, 0), [filteredRows]);

  const handleOpeningSubmit = (skuId: string) => {
    setOpeningStock(skuId, Number(openingValue) || 0);
    setEditingOpening(null);
    toast.success('Opening stock set');
  };

  const statusDot = (status: 'red' | 'yellow' | 'green') => {
    const colors = {
      red: 'bg-destructive',
      yellow: 'bg-warning',
      green: 'bg-success',
    };
    return <span className={`inline-block w-2.5 h-2.5 rounded-full ${colors[status]}`} />;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-heading font-bold">{t('title.rmStock')}</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Auto-calculated raw material stock balances</p>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div className="rounded-lg border bg-card p-5">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('summary.rmSkus')}</p>
          <p className="text-3xl font-heading font-bold mt-1">{rmSkus.length}</p>
        </div>
        <div className="rounded-lg border bg-card p-5">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('summary.totalStockValue')}</p>
          <p className="text-3xl font-heading font-bold mt-1">฿{totalStockValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</p>
        </div>
        <div className="rounded-lg border bg-card p-5">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('summary.outOfStock')}</p>
          <p className="text-3xl font-heading font-bold mt-1 text-destructive">
            {filteredRows.filter(r => r.healthStatus === 'red').length}
          </p>
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
      </div>

      {/* Table */}
      <div className="rounded-lg border overflow-auto max-h-[70vh]">
        <Table>
          <TableHeader className="sticky-thead">
            <TableRow>
              <TableHead className="w-8"></TableHead>
              <TableHead className="cursor-pointer hover:bg-muted/50" onClick={() => handleSort('skuId')}>
                <SortableHeader label={t('col.skuId')} sortKey="skuId" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
              </TableHead>
              <TableHead className="cursor-pointer hover:bg-muted/50" onClick={() => handleSort('name')}>
                <SortableHeader label={t('col.name')} sortKey="name" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
              </TableHead>
              <TableHead className="cursor-pointer hover:bg-muted/50" onClick={() => handleSort('category')}>
                <SortableHeader label={t('col.category')} sortKey="category" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
              </TableHead>
              <TableHead className="cursor-pointer hover:bg-muted/50" onClick={() => handleSort('storage')}>
                <SortableHeader label={t('col.storage')} sortKey="storage" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
              </TableHead>
              <TableHead className="text-right cursor-pointer hover:bg-muted/50" onClick={() => handleSort('opening')}>
                <SortableHeader label={t('col.opening')} sortKey="opening" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="justify-end" />
              </TableHead>
              <TableHead className="text-right cursor-pointer hover:bg-muted/50" onClick={() => handleSort('received')}>
                <SortableHeader label={t('col.received')} sortKey="received" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="justify-end" />
              </TableHead>
              <TableHead className="text-right">{t('col.adjustments')}</TableHead>
              <TableHead className="text-right cursor-pointer hover:bg-muted/50" onClick={() => handleSort('currentStock')}>
                <SortableHeader label={t('col.currentStock')} sortKey="currentStock" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="justify-end" />
              </TableHead>
              <TableHead>{t('col.uom')}</TableHead>
              <TableHead className="text-right cursor-pointer hover:bg-muted/50" onClick={() => handleSort('stockValue')}>
                <SortableHeader label={t('col.stockValue')} sortKey="stockValue" activeSortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="justify-end" />
              </TableHead>
              <TableHead>{t('col.lastReceipt')}</TableHead>
              <TableHead className="text-right">{t('col.daysLeft')}</TableHead>
              <TableHead className="w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={14} className="text-center py-10 text-muted-foreground">
                  <Package className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  No RM SKUs found
                </TableCell>
              </TableRow>
            ) : (
              sortedRows.map(row => {
                const netAdj = (row.balance?.adjustments ?? []).reduce((s, a) => s + a.quantity, 0);
                return (
                  <TableRow key={row.sku.id}>
                    <TableCell>{statusDot(row.healthStatus)}</TableCell>
                    <TableCell className="font-mono text-xs">{row.sku.skuId}</TableCell>
                    <TableCell className="font-medium">{row.sku.name}</TableCell>
                    <TableCell>{CATEGORY_LABELS[row.sku.category]}</TableCell>
                    <TableCell>{row.sku.storageCondition}</TableCell>
                    <TableCell className="text-right">
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
                          className="cursor-pointer hover:underline"
                          onClick={() => { setEditingOpening(row.sku.id); setOpeningValue(String(row.opening)); }}
                        >
                          {row.opening.toLocaleString()}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">{(row.balance?.totalReceived ?? 0).toLocaleString()}</TableCell>
                    <TableCell className={`text-right ${netAdj > 0 ? 'text-success' : netAdj < 0 ? 'text-destructive' : ''}`}>
                      {netAdj !== 0 ? (netAdj > 0 ? '+' : '') + netAdj.toLocaleString() : '—'}
                    </TableCell>
                    <TableCell className="text-right font-semibold">{row.currentStock.toLocaleString()}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{row.sku.usageUom}</TableCell>
                    <TableCell className="text-right">฿{row.stockValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                    <TableCell className="text-xs">{row.lastDate ?? '—'}</TableCell>
                    <TableCell className="text-right text-muted-foreground">0</TableCell>
                    <TableCell>
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
