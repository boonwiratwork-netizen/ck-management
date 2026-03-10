import { useState, useMemo, useCallback } from 'react';
import { useLanguage } from '@/hooks/use-language';
import { useSalesEntryData, SalesEntry } from '@/hooks/use-sales-entry-data';
import { useAuth } from '@/hooks/use-auth';
import { Branch } from '@/types/branch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { SearchInput } from '@/components/SearchInput';
import { SkeletonTable } from '@/components/SkeletonTable';
import { EmptyState } from '@/components/EmptyState';
import { Upload, Trash2, ClipboardPaste, CheckCircle2, AlertTriangle, ChevronDown, Loader2, ShoppingCart, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import { toast } from 'sonner';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

const POS_COLUMNS = [
  'Date','Time','Receipt No','INV No','Tray Code','Menu Code','Menu Name',
  'Order Type','Qty','Unit Price','Before Discount','Discount','Discount%',
  'Net Amount','Tax Type','Channel','Table','Customer','Phone','Payment',
  'Record Method','Custom Payment','Note','Promo Type','Group','Category',
  'Opened By','Closed By','Branch',
];

const EXPECTED_COL_COUNT = 29;

interface SalesEntryPageProps {
  branches: Branch[];
}

export default function SalesEntryPage({ branches }: SalesEntryPageProps) {
  const { isManagement, isStoreManager, profile } = useAuth();
  const { t } = useLanguage();
  const { entries, loading, fetchEntries, bulkInsert, deleteEntry } = useSalesEntryData();

  const availableBranches = useMemo(() => {
    if (isManagement) return branches.filter(b => b.status === 'Active');
    if (isStoreManager && profile?.branch_id) return branches.filter(b => b.id === profile.branch_id);
    return branches.filter(b => b.status === 'Active');
  }, [branches, isManagement, isStoreManager, profile]);

  const [selectedBranch, setSelectedBranch] = useState<string>(
    isStoreManager && profile?.branch_id ? profile.branch_id : ''
  );

  const [pastedText, setPastedText] = useState('');
  const [parsedRows, setParsedRows] = useState<string[][]>([]);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ inserted: number; skipped: number; skippedRows?: string[][] } | null>(null);
  const [showSkipped, setShowSkipped] = useState(false);

  const [filterBranch, setFilterBranch] = useState<string>('__all__');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [historySearch, setHistorySearch] = useState('');

  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);

  // Column count validation
  const columnCounts = useMemo(() => {
    if (parsedRows.length === 0) return [];
    return parsedRows.map(r => r.length);
  }, [parsedRows]);

  const hasValidColumns = useMemo(() => {
    if (parsedRows.length === 0) return true;
    return parsedRows.every(r => r.length >= EXPECTED_COL_COUNT - 2 && r.length <= EXPECTED_COL_COUNT + 2);
  }, [parsedRows]);

  const avgColCount = useMemo(() => {
    if (columnCounts.length === 0) return 0;
    return Math.round(columnCounts.reduce((a, b) => a + b, 0) / columnCounts.length);
  }, [columnCounts]);

  // Parse pasted text
  const handlePasteChange = useCallback((text: string) => {
    setPastedText(text);
    setImportResult(null);
    if (!text.trim()) { setParsedRows([]); return; }
    const lines = text.trim().split('\n');
    const rows = lines.map(line => line.split('\t'));
    const filtered = rows.filter(r => {
      if (r.length < 5) return false;
      if (r[0]?.trim().toLowerCase() === 'date' || r[0]?.trim() === POS_COLUMNS[0]) return false;
      return true;
    });
    setParsedRows(filtered);
  }, []);

  const handleImport = useCallback(async () => {
    if (!selectedBranch) { toast.error('Please select a branch'); return; }
    if (parsedRows.length === 0) { toast.error('No data to import'); return; }

    setImporting(true);
    const mapped: Omit<SalesEntry, 'id' | 'branchId'>[] = [];

    for (const cols of parsedRows) {
      const dateStr = cols[0]?.trim() || '';
      const receiptNo = cols[2]?.trim() || '';
      const menuCode = cols[5]?.trim() || '';
      const menuName = cols[6]?.trim() || '';
      const orderType = cols[7]?.trim() || '';
      const qty = Number(cols[8]?.trim()) || 0;
      const unitPrice = Number(cols[9]?.trim()) || 0;
      const netAmount = Number(cols[13]?.trim()) || 0;
      const channel = cols[15]?.trim() || '';

      let saleDate = '';
      if (dateStr) {
        const parts = dateStr.split(/[\/\-\.]/);
        if (parts.length === 3) {
          const [d, m, y] = parts;
          const year = y.length === 2 ? '20' + y : y;
          saleDate = `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
        } else {
          saleDate = dateStr;
        }
      }

      if (!receiptNo && !menuCode) continue;
      mapped.push({ saleDate, receiptNo, menuCode, menuName, orderType, qty, unitPrice, netAmount, channel });
    }

    if (mapped.length === 0) { toast.error('No valid rows found'); setImporting(false); return; }

    const totalImportRevenue = mapped.reduce((s, r) => s + r.netAmount, 0);
    const result = await bulkInsert(selectedBranch, mapped);
    if (result) {
      setImportResult({ inserted: result.inserted, skipped: result.skipped });
      const revStr = `฿${totalImportRevenue.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      if (result.inserted > 0) {
        const parts = [`${result.inserted} rows imported`, revStr + ' total revenue'];
        if (result.skipped > 0) parts.push(`${result.skipped} duplicates skipped`);
        toast.success(parts.join(' · '));
      } else if (result.skipped > 0) {
        toast.warning(`${result.skipped} duplicate rows skipped`);
      }
      setPastedText('');
      setParsedRows([]);
      fetchEntries(filterBranch !== '__all__' ? { branchId: filterBranch } : undefined);
    }
    setImporting(false);
  }, [selectedBranch, parsedRows, bulkInsert, fetchEntries, filterBranch]);

  const handleApplyFilter = useCallback(() => {
    const filters: { branchId?: string; dateFrom?: string; dateTo?: string } = {};
    if (filterBranch !== '__all__') filters.branchId = filterBranch;
    if (filterDateFrom) filters.dateFrom = filterDateFrom;
    if (filterDateTo) filters.dateTo = filterDateTo;
    fetchEntries(filters);
  }, [filterBranch, filterDateFrom, filterDateTo, fetchEntries]);

  const totalQty = useMemo(() => entries.reduce((s, e) => s + e.qty, 0), [entries]);
  const totalRevenue = useMemo(() => entries.reduce((s, e) => s + e.netAmount, 0), [entries]);

  const branchMap = useMemo(() => {
    const m: Record<string, string> = {};
    branches.forEach(b => { m[b.id] = b.branchName; });
    return m;
  }, [branches]);

  // Sorting
  type SESortKey = 'saleDate' | 'menuCode' | 'menuName' | 'orderType' | 'qty' | 'unitPrice' | 'netAmount' | 'channel' | 'branch';
  const [seSortKey, setSeSortKey] = useState<SESortKey>('saleDate');
  const [seSortDir, setSeSortDir] = useState<'asc' | 'desc'>('desc');

  const handleSeSort = (key: SESortKey) => {
    if (seSortKey === key) {
      setSeSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSeSortKey(key);
      setSeSortDir('asc');
    }
  };

  const SeSortIcon = ({ col }: { col: SESortKey }) => {
    if (seSortKey !== col) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-30" />;
    return seSortDir === 'asc'
      ? <ArrowUp className="w-3 h-3 ml-1 text-primary" />
      : <ArrowDown className="w-3 h-3 ml-1 text-primary" />;
  };

  // Filter history with search
  const filteredEntries = useMemo(() => {
    let list = entries;
    if (historySearch) {
      const q = historySearch.toLowerCase();
      list = list.filter(e =>
        e.menuCode.toLowerCase().includes(q) ||
        e.menuName.toLowerCase().includes(q) ||
        e.receiptNo.toLowerCase().includes(q) ||
        e.channel.toLowerCase().includes(q)
      );
    }
    list = [...list].sort((a, b) => {
      let cmp = 0;
      switch (seSortKey) {
        case 'saleDate': cmp = a.saleDate.localeCompare(b.saleDate); break;
        case 'menuCode': cmp = a.menuCode.localeCompare(b.menuCode); break;
        case 'menuName': cmp = a.menuName.localeCompare(b.menuName); break;
        case 'orderType': cmp = a.orderType.localeCompare(b.orderType); break;
        case 'qty': cmp = a.qty - b.qty; break;
        case 'unitPrice': cmp = a.unitPrice - b.unitPrice; break;
        case 'netAmount': cmp = a.netAmount - b.netAmount; break;
        case 'channel': cmp = a.channel.localeCompare(b.channel); break;
        case 'branch': cmp = (branchMap[a.branchId] || '').localeCompare(branchMap[b.branchId] || ''); break;
      }
      return seSortDir === 'desc' ? -cmp : cmp;
    });
    return list;
  }, [entries, historySearch, seSortKey, seSortDir, branchMap]);

  // Preview first 3 rows
  const previewRows = parsedRows.slice(0, 3);

  return (
    <div className="space-y-8">
      {/* SECTION 1: PASTE SALES DATA */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardPaste className="w-5 h-5" />
            {t('title.pasteSalesData')}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Copy rows from your POS export and paste them below. Expected: {EXPECTED_COL_COUNT} tab-separated columns.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Branch selector */}
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium whitespace-nowrap label-required">Branch</label>
            <Select value={selectedBranch} onValueChange={setSelectedBranch}>
              <SelectTrigger className="w-64">
                <SelectValue placeholder="Select branch" />
              </SelectTrigger>
              <SelectContent>
                {availableBranches.map(b => (
                  <SelectItem key={b.id} value={b.id}>{b.branchName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Column header reference */}
          <div className="overflow-x-auto">
            <div className="flex gap-0 text-[10px] text-muted-foreground font-mono border rounded-t-md bg-muted/30 min-w-max">
              {POS_COLUMNS.map((col, i) => (
                <div key={i} className={`px-2 py-1 border-r last:border-r-0 whitespace-nowrap ${[0,2,5,6,7,8,9,13,15].includes(i) ? 'bg-primary/10 font-semibold text-foreground' : ''}`}>
                  {i + 1}. {col}
                </div>
              ))}
            </div>
          </div>

          {/* Paste area */}
          <Textarea
            placeholder="Paste POS data here (Ctrl+V)... Each row should have 29 tab-separated columns."
            value={pastedText}
            onChange={e => handlePasteChange(e.target.value)}
            rows={8}
            className="font-mono text-xs"
          />

          {/* Paste feedback */}
          {parsedRows.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-4 text-sm">
                <span className="text-muted-foreground font-medium">{parsedRows.length} rows detected</span>
                {hasValidColumns ? (
                  <span className="text-success flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> ✓ {avgColCount} columns detected
                  </span>
                ) : (
                  <span className="text-warning flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" /> ⚠️ Expected {EXPECTED_COL_COUNT} columns, got {avgColCount}
                  </span>
                )}
              </div>

              {/* Preview first 3 rows */}
              {previewRows.length > 0 && (
                <div className="rounded-md border bg-muted/30 p-3">
                  <p className="text-xs font-medium text-muted-foreground mb-2">Preview (first {previewRows.length} rows):</p>
                  <div className="overflow-x-auto">
                    <table className="text-[11px] font-mono">
                      <thead>
                        <tr>
                          <th className="px-1.5 py-1 text-left text-muted-foreground">Date</th>
                          <th className="px-1.5 py-1 text-left text-muted-foreground">Receipt</th>
                          <th className="px-1.5 py-1 text-left text-muted-foreground">Menu Code</th>
                          <th className="px-1.5 py-1 text-left text-muted-foreground">Menu Name</th>
                          <th className="px-1.5 py-1 text-right text-muted-foreground">Qty</th>
                          <th className="px-1.5 py-1 text-right text-muted-foreground">Net Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previewRows.map((r, i) => (
                          <tr key={i}>
                            <td className="px-1.5 py-0.5">{r[0]}</td>
                            <td className="px-1.5 py-0.5">{r[2]}</td>
                            <td className="px-1.5 py-0.5">{r[5]}</td>
                            <td className="px-1.5 py-0.5 max-w-[150px] truncate">{r[6]}</td>
                            <td className="px-1.5 py-0.5 text-right">{r[8]}</td>
                            <td className="px-1.5 py-0.5 text-right">{r[13]}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Import result summary */}
          {importResult && (
            <div className="rounded-lg border bg-success/5 border-success/20 p-3 space-y-2">
              <p className="text-sm font-medium text-success flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" />
                {importResult.inserted} rows imported{importResult.skipped > 0 && `, ${importResult.skipped} duplicates skipped`}
              </p>
            </div>
          )}

          <Button onClick={handleImport} disabled={importing || parsedRows.length === 0 || !selectedBranch || !hasValidColumns}>
            {importing ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> {t('btn.import')}...</>
            ) : (
              <><Upload className="w-4 h-4" /> {t('btn.importPastedData')} ({parsedRows.length} rows)</>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* SECTION 2: SALES HISTORY */}
      <Card>
        <CardHeader>
          <CardTitle>{t('title.salesHistory')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap items-end gap-3">
            {isManagement && (
              <div>
                <label className="text-xs text-muted-foreground">Branch</label>
                <Select value={filterBranch} onValueChange={setFilterBranch}>
                  <SelectTrigger className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All Branches</SelectItem>
                    {branches.filter(b => b.status === 'Active').map(b => (
                      <SelectItem key={b.id} value={b.id}>{b.branchName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <label className="text-xs text-muted-foreground">From</label>
              <Input type="date" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)} className="w-40" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">To</label>
              <Input type="date" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)} className="w-40" />
            </div>
            <Button variant="outline" onClick={handleApplyFilter}>Apply</Button>
          </div>

          {/* Search within results */}
          {entries.length > 0 && (
            <SearchInput
              value={historySearch}
              onChange={setHistorySearch}
              placeholder="Search menu, receipt no, channel..."
              totalCount={entries.length}
              filteredCount={filteredEntries.length}
              entityName="entries"
            />
          )}

          {/* Table */}
          {loading ? (
            <SkeletonTable columns={9} rows={8} />
          ) : (
            <div className="rounded-lg border bg-card overflow-hidden">
              <div className="overflow-auto max-h-[70vh]">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-table-header sticky top-0 z-10" style={{ backgroundColor: 'hsl(var(--table-header))' }}>
                      <th className="text-left px-4 py-3 table-header cursor-pointer select-none hover:bg-muted/50 transition-colors" onClick={() => handleSeSort('saleDate')}>
                        <span className="inline-flex items-center">Date<SeSortIcon col="saleDate" /></span>
                      </th>
                      <th className="text-left px-4 py-3 table-header cursor-pointer select-none hover:bg-muted/50 transition-colors" onClick={() => handleSeSort('menuCode')}>
                        <span className="inline-flex items-center">Menu Code<SeSortIcon col="menuCode" /></span>
                      </th>
                      <th className="text-left px-4 py-3 table-header cursor-pointer select-none hover:bg-muted/50 transition-colors" onClick={() => handleSeSort('menuName')}>
                        <span className="inline-flex items-center">Menu Name<SeSortIcon col="menuName" /></span>
                      </th>
                      <th className="text-left px-4 py-3 table-header cursor-pointer select-none hover:bg-muted/50 transition-colors" onClick={() => handleSeSort('orderType')}>
                        <span className="inline-flex items-center">Order Type<SeSortIcon col="orderType" /></span>
                      </th>
                      <th className="text-right px-4 py-3 table-header cursor-pointer select-none hover:bg-muted/50 transition-colors" onClick={() => handleSeSort('qty')}>
                        <span className="inline-flex items-center justify-end">Qty<SeSortIcon col="qty" /></span>
                      </th>
                      <th className="text-right px-4 py-3 table-header cursor-pointer select-none hover:bg-muted/50 transition-colors" onClick={() => handleSeSort('unitPrice')}>
                        <span className="inline-flex items-center justify-end">Unit Price<SeSortIcon col="unitPrice" /></span>
                      </th>
                      <th className="text-right px-4 py-3 table-header cursor-pointer select-none hover:bg-muted/50 transition-colors" onClick={() => handleSeSort('netAmount')}>
                        <span className="inline-flex items-center justify-end">Net Amount<SeSortIcon col="netAmount" /></span>
                      </th>
                      <th className="text-left px-4 py-3 table-header cursor-pointer select-none hover:bg-muted/50 transition-colors" onClick={() => handleSeSort('channel')}>
                        <span className="inline-flex items-center">Channel<SeSortIcon col="channel" /></span>
                      </th>
                      <th className="text-left px-4 py-3 table-header cursor-pointer select-none hover:bg-muted/50 transition-colors" onClick={() => handleSeSort('branch')}>
                        <span className="inline-flex items-center">Branch<SeSortIcon col="branch" /></span>
                      </th>
                      {isManagement && <th className="w-10 px-4 py-3 table-header" />}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEntries.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="px-4">
                          <EmptyState
                            icon={ShoppingCart}
                            title={entries.length === 0 ? 'No sales data yet' : 'No entries match your search'}
                            description={entries.length === 0 ? 'Paste your first POS export above to get started' : 'Try adjusting your search or filter'}
                          />
                        </td>
                      </tr>
                    ) : filteredEntries.map((e, idx) => (
                      <tr key={e.id} className={`border-b border-table-border last:border-0 table-row-hover transition-colors ${idx % 2 === 1 ? 'bg-table-alt' : ''}`}>
                        <td className="px-4 py-3 whitespace-nowrap">{e.saleDate}</td>
                        <td className="px-4 py-3 font-mono text-xs">{e.menuCode}</td>
                        <td className="px-4 py-3 max-w-[200px] truncate">{e.menuName}</td>
                        <td className="px-4 py-3">{e.orderType}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{e.qty}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{e.unitPrice.toFixed(2)}</td>
                        <td className="px-4 py-3 text-right tabular-nums font-medium">{e.netAmount.toFixed(2)}</td>
                        <td className="px-4 py-3">{e.channel}</td>
                        <td className="px-4 py-3">{branchMap[e.branchId] || '-'}</td>
                        {isManagement && (
                          <td className="px-4 py-3">
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button variant="ghost" size="icon" className="icon-btn-delete h-7 w-7" onClick={() => setDeleteConfirm({ id: e.id, name: `${e.menuCode} — ${e.saleDate}` })}>
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Delete</TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Summary */}
          {entries.length > 0 && (
            <div className="flex gap-6 text-sm pt-2 border-t">
              <span>Total Qty: <strong>{totalQty.toLocaleString()}</strong></span>
              <span>Total Revenue: <strong>฿{totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong></span>
              <span className="text-muted-foreground">{filteredEntries.length} rows</span>
            </div>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!deleteConfirm}
        onOpenChange={open => !open && setDeleteConfirm(null)}
        title="Delete Sales Entry"
        description={`Delete "${deleteConfirm?.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={() => { if (deleteConfirm) { deleteEntry(deleteConfirm.id); setDeleteConfirm(null); toast.success('Entry deleted'); } }}
      />
    </div>
  );
}
