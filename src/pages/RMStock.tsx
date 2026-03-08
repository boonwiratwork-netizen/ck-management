import { useState, useMemo } from 'react';
import { SKU, CATEGORY_LABELS, Category, StorageCondition } from '@/types/sku';
import { StockBalance, StockAdjustment } from '@/types/stock';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Pencil, SlidersHorizontal, Search, Package } from 'lucide-react';
import { StockAdjustmentModal } from '@/components/StockAdjustmentModal';
import { toast } from 'sonner';

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

  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [filterStorage, setFilterStorage] = useState<string>('all');
  const [adjustModal, setAdjustModal] = useState<{ skuId: string; skuName: string; usageUom: string; currentStock: number } | null>(null);
  const [editingOpening, setEditingOpening] = useState<string | null>(null);
  const [openingValue, setOpeningValue] = useState('');

  const rmSkus = useMemo(() => skus.filter(s => s.type === 'RM'), [skus]);

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
          <h2 className="text-2xl font-heading font-bold">RM Stock</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Auto-calculated raw material stock balances</p>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div className="rounded-lg border bg-card p-5">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">RM SKUs</p>
          <p className="text-3xl font-heading font-bold mt-1">{rmSkus.length}</p>
        </div>
        <div className="rounded-lg border bg-card p-5">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Stock Value</p>
          <p className="text-3xl font-heading font-bold mt-1">฿{totalStockValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</p>
        </div>
        <div className="rounded-lg border bg-card p-5">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Out of Stock</p>
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
            <SelectItem value="all">All Categories</SelectItem>
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
            <SelectItem value="all">All Storage</SelectItem>
            {(['Frozen', 'Chilled', 'Ambient'] as StorageCondition[]).map(s => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="rounded-lg border overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8"></TableHead>
              <TableHead>SKU ID</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Storage</TableHead>
              <TableHead className="text-right">Opening</TableHead>
              <TableHead className="text-right">Received</TableHead>
              <TableHead className="text-right">Adjustments</TableHead>
              <TableHead className="text-right">Current Stock</TableHead>
              <TableHead>UOM</TableHead>
              <TableHead className="text-right">Stock Value</TableHead>
              <TableHead>Last Receipt</TableHead>
              <TableHead className="text-right">Days Left</TableHead>
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
              filteredRows.map(row => {
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
