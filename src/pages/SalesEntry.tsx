import { useState, useMemo, useCallback, useRef } from 'react';
import { useSalesEntryData, SalesEntry } from '@/hooks/use-sales-entry-data';
import { useAuth } from '@/hooks/use-auth';
import { Branch } from '@/types/branch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Upload, Trash2, ClipboardPaste } from 'lucide-react';
import { toast } from 'sonner';
import { Textarea } from '@/components/ui/textarea';

const POS_COLUMNS = [
  'Date','Time','Receipt No','INV No','Tray Code','Menu Code','Menu Name',
  'Order Type','Qty','Unit Price','Before Discount','Discount','Discount%',
  'Net Amount','Tax Type','Channel','Table','Customer','Phone','Payment',
  'Record Method','Custom Payment','Note','Promo Type','Group','Category',
  'Opened By','Closed By','Branch',
];

interface SalesEntryPageProps {
  branches: Branch[];
}

export default function SalesEntryPage({ branches }: SalesEntryPageProps) {
  const { isAdmin, isBranchManager, profile } = useAuth();
  const { entries, loading, fetchEntries, bulkInsert, deleteEntry } = useSalesEntryData();

  // Branch selector
  const availableBranches = useMemo(() => {
    if (isAdmin) return branches.filter(b => b.status === 'Active');
    if (isBranchManager && profile?.branch_id) return branches.filter(b => b.id === profile.branch_id);
    return [];
  }, [branches, isAdmin, isBranchManager, profile]);

  const [selectedBranch, setSelectedBranch] = useState<string>(
    isBranchManager && profile?.branch_id ? profile.branch_id : ''
  );

  // Paste area
  const [pastedText, setPastedText] = useState('');
  const [parsedRows, setParsedRows] = useState<string[][]>([]);
  const [importing, setImporting] = useState(false);

  // History filters
  const [filterBranch, setFilterBranch] = useState<string>('__all__');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');

  // Delete confirm
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string } | null>(null);

  // Auto-select branch for branch manager
  useState(() => {
    if (isBranchManager && profile?.branch_id && !selectedBranch) {
      setSelectedBranch(profile.branch_id);
    }
  });

  // Parse pasted text
  const handlePasteChange = useCallback((text: string) => {
    setPastedText(text);
    if (!text.trim()) { setParsedRows([]); return; }
    const lines = text.trim().split('\n');
    const rows = lines.map(line => line.split('\t'));
    // Filter out header row if it matches POS columns
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
      // Extract needed columns by index (0-based): Date(0), ReceiptNo(2), MenuCode(5), MenuName(6), OrderType(7), Qty(8), UnitPrice(9), NetAmount(13), Channel(15)
      const dateStr = cols[0]?.trim() || '';
      const receiptNo = cols[2]?.trim() || '';
      const menuCode = cols[5]?.trim() || '';
      const menuName = cols[6]?.trim() || '';
      const orderType = cols[7]?.trim() || '';
      const qty = Number(cols[8]?.trim()) || 0;
      const unitPrice = Number(cols[9]?.trim()) || 0;
      const netAmount = Number(cols[13]?.trim()) || 0;
      const channel = cols[15]?.trim() || '';

      // Parse date - try common formats
      let saleDate = '';
      if (dateStr) {
        // Try DD/MM/YYYY or DD-MM-YYYY
        const parts = dateStr.split(/[\/\-\.]/);
        if (parts.length === 3) {
          const [d, m, y] = parts;
          const year = y.length === 2 ? '20' + y : y;
          saleDate = `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
        } else {
          // Try as-is (YYYY-MM-DD)
          saleDate = dateStr;
        }
      }

      if (!receiptNo && !menuCode) continue; // skip empty rows

      mapped.push({ saleDate, receiptNo, menuCode, menuName, orderType, qty, unitPrice, netAmount, channel });
    }

    if (mapped.length === 0) { toast.error('No valid rows found'); setImporting(false); return; }

    const result = await bulkInsert(selectedBranch, mapped);
    if (result) {
      if (result.inserted > 0) toast.success(`${result.inserted} rows imported successfully`);
      if (result.skipped > 0) toast.warning(`${result.skipped} duplicate rows skipped`);
      setPastedText('');
      setParsedRows([]);
      fetchEntries(filterBranch !== '__all__' ? { branchId: filterBranch } : undefined);
    }
    setImporting(false);
  }, [selectedBranch, parsedRows, bulkInsert, fetchEntries, filterBranch]);

  // Filter history
  const handleApplyFilter = useCallback(() => {
    const filters: { branchId?: string; dateFrom?: string; dateTo?: string } = {};
    if (filterBranch !== '__all__') filters.branchId = filterBranch;
    if (filterDateFrom) filters.dateFrom = filterDateFrom;
    if (filterDateTo) filters.dateTo = filterDateTo;
    fetchEntries(filters);
  }, [filterBranch, filterDateFrom, filterDateTo, fetchEntries]);

  // Summary
  const totalQty = useMemo(() => entries.reduce((s, e) => s + e.qty, 0), [entries]);
  const totalRevenue = useMemo(() => entries.reduce((s, e) => s + e.netAmount, 0), [entries]);

  const branchMap = useMemo(() => {
    const m: Record<string, string> = {};
    branches.forEach(b => { m[b.id] = b.branchName; });
    return m;
  }, [branches]);

  return (
    <div className="space-y-6">
      {/* SECTION 1: PASTE SALES DATA */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardPaste className="w-5 h-5" />
            Paste Sales Data
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Copy rows from your POS export and paste them below. The grid expects 29 tab-separated columns.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Branch selector */}
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium whitespace-nowrap">Branch:</label>
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

          {parsedRows.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {parsedRows.length} rows detected
            </p>
          )}

          <Button onClick={handleImport} disabled={importing || parsedRows.length === 0 || !selectedBranch}>
            <Upload className="w-4 h-4" />
            {importing ? 'Importing...' : `Import Pasted Data (${parsedRows.length} rows)`}
          </Button>
        </CardContent>
      </Card>

      {/* SECTION 2: SALES HISTORY */}
      <Card>
        <CardHeader>
          <CardTitle>Sales History</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap items-end gap-3">
            {isAdmin && (
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

          {/* Table */}
          <div className="border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Menu Code</TableHead>
                  <TableHead>Menu Name</TableHead>
                  <TableHead>Order Type</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Unit Price</TableHead>
                  <TableHead className="text-right">Net Amount</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Branch</TableHead>
                  {isAdmin && <TableHead className="w-10" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground">Loading...</TableCell></TableRow>
                ) : entries.length === 0 ? (
                  <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground">No sales data</TableCell></TableRow>
                ) : entries.map(e => (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap">{e.saleDate}</TableCell>
                    <TableCell className="font-mono text-xs">{e.menuCode}</TableCell>
                    <TableCell className="max-w-[200px] truncate">{e.menuName}</TableCell>
                    <TableCell>{e.orderType}</TableCell>
                    <TableCell className="text-right">{e.qty}</TableCell>
                    <TableCell className="text-right">{e.unitPrice.toFixed(2)}</TableCell>
                    <TableCell className="text-right">{e.netAmount.toFixed(2)}</TableCell>
                    <TableCell>{e.channel}</TableCell>
                    <TableCell>{branchMap[e.branchId] || '-'}</TableCell>
                    {isAdmin && (
                      <TableCell>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setDeleteConfirm({ id: e.id })}>
                          <Trash2 className="w-3.5 h-3.5 text-destructive" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Summary */}
          {entries.length > 0 && (
            <div className="flex gap-6 text-sm pt-2 border-t">
              <span>Total Qty: <strong>{totalQty.toLocaleString()}</strong></span>
              <span>Total Revenue: <strong>฿{totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong></span>
              <span className="text-muted-foreground">{entries.length} rows</span>
            </div>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!deleteConfirm}
        onOpenChange={open => !open && setDeleteConfirm(null)}
        title="Delete Sales Entry"
        description="Are you sure you want to delete this sales entry?"
        confirmLabel="Delete"
        onConfirm={() => { if (deleteConfirm) { deleteEntry(deleteConfirm.id); setDeleteConfirm(null); } }}
      />
    </div>
  );
}
