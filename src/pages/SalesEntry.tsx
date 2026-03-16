import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useLanguage } from '@/hooks/use-language';
import { useSalesEntryData, SalesEntry, POSMappingProfile, ParsedRow, SkippedRow, parseData, ParseSource } from '@/hooks/use-sales-entry-data';
import { useAuth } from '@/hooks/use-auth';
import { Branch } from '@/types/branch';
import { Menu } from '@/types/menu';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DatePicker } from '@/components/ui/date-picker';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { SearchInput } from '@/components/SearchInput';
import { SkeletonTable } from '@/components/SkeletonTable';
import { EmptyState } from '@/components/EmptyState';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { POSProfileModal } from '@/components/POSProfileModal';
import { Upload, Trash2, ClipboardPaste, CheckCircle2, ChevronDown, ChevronRight, Loader2, ShoppingCart, ArrowUp, ArrowDown, ArrowUpDown, Plus, Pencil, FileUp } from 'lucide-react';
import { toast } from 'sonner';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Checkbox } from '@/components/ui/checkbox';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { supabase } from '@/integrations/supabase/client';
import { cn, toLocalDateStr } from '@/lib/utils';
import { table as tableTokens } from '@/lib/design-tokens';

interface SalesEntryPageProps {
  branches: Branch[];
  menus: Menu[];
}

export default function SalesEntryPage({ branches, menus }: SalesEntryPageProps) {
  const { isManagement, isStoreManager, profile } = useAuth();
  const { t } = useLanguage();
  const { entries, loading, fetchEntries, bulkInsert, deleteEntry, profiles, saveProfile, deleteProfile, checkDuplicates } = useSalesEntryData();

  const availableBranches = useMemo(() => {
    if (isManagement) return branches.filter(b => b.status === 'Active');
    if (isStoreManager && profile?.branch_id) return branches.filter(b => b.id === profile.branch_id);
    return branches.filter(b => b.status === 'Active');
  }, [branches, isManagement, isStoreManager, profile]);

  // ——— Import section state ———
  const [selectedBranch, setSelectedBranch] = useState<string>(
    isStoreManager && profile?.branch_id ? profile.branch_id : ''
  );
  const [selectedProfileId, setSelectedProfileId] = useState<string>('');
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<POSMappingProfile | null>(null);
  const [pastedText, setPastedText] = useState('');
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [skippedNoCodeRows, setSkippedNoCodeRows] = useState<SkippedRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [showSkipped, setShowSkipped] = useState(false);
  const [showSkippedNoCode, setShowSkippedNoCode] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState('');
  const [pendingFileText, setPendingFileText] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ——— Manage Transactions state ———
  const [mgmtOpen, setMgmtOpen] = useState(false);
  const [mgmtBranch, setMgmtBranch] = useState('');
  const [mgmtDateFrom, setMgmtDateFrom] = useState<Date | undefined>(undefined);
  const [mgmtDateTo, setMgmtDateTo] = useState<Date | undefined>(undefined);
  const [mgmtTransactions, setMgmtTransactions] = useState<SalesEntry[]>([]);
  const [mgmtLoading, setMgmtLoading] = useState(false);
  const [mgmtSelectedIds, setMgmtSelectedIds] = useState<Set<string>>(new Set());
  const [mgmtDeleteType, setMgmtDeleteType] = useState<'selected' | 'all' | null>(null);

  // Auto-select first profile
  useEffect(() => {
    if (profiles.length > 0 && !selectedProfileId) {
      setSelectedProfileId(profiles[0].id);
    }
  }, [profiles, selectedProfileId]);

  const selectedProfile = useMemo(
    () => profiles.find(p => p.id === selectedProfileId) || null,
    [profiles, selectedProfileId]
  );

  // ——— Manual Entry State ———
  const [manualOpen, setManualOpen] = useState(true);
  const [manualDate, setManualDate] = useState(toLocalDateStr(new Date()));
  const [manualBranch, setManualBranch] = useState<string>(
    isStoreManager && profile?.branch_id ? profile.branch_id : ''
  );
  const [manualMenuSearch, setManualMenuSearch] = useState('');
  const [manualMenuId, setManualMenuId] = useState('');
  const [manualQty, setManualQty] = useState(1);
  const [manualSaving, setManualSaving] = useState(false);
  const [manualSuccess, setManualSuccess] = useState(false);
  const [menuDropdownOpen, setMenuDropdownOpen] = useState(false);
  const menuInputRef = useRef<HTMLInputElement>(null);
  const menuDropdownRef = useRef<HTMLDivElement>(null);

  const selectedMenu = useMemo(() => menus.find(m => m.id === manualMenuId), [menus, manualMenuId]);
  const manualUnitPrice = selectedMenu?.sellingPrice ?? 0;
  const manualNetAmount = manualQty * manualUnitPrice;
  const hasNoPrice = manualMenuId && manualUnitPrice <= 0;

  const filteredMenus = useMemo(() => {
    const q = manualMenuSearch.toLowerCase().trim();
    if (!q) return menus.filter(m => m.status === 'Active').slice(0, 20);
    return menus.filter(m =>
      m.status === 'Active' &&
      (m.menuCode.toLowerCase().includes(q) || m.menuName.toLowerCase().includes(q))
    ).slice(0, 20);
  }, [menus, manualMenuSearch]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuDropdownRef.current && !menuDropdownRef.current.contains(e.target as Node) &&
          menuInputRef.current && !menuInputRef.current.contains(e.target as Node)) {
        setMenuDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSelectMenu = useCallback((menu: Menu) => {
    setManualMenuId(menu.id);
    setManualMenuSearch(`${menu.menuCode} · ${menu.menuName}`);
    setMenuDropdownOpen(false);
  }, []);

  const handleManualAdd = useCallback(async () => {
    if (!manualBranch) { toast.error('Select a branch'); return; }
    if (!manualMenuId || !selectedMenu) { toast.error('Select a menu'); return; }
    if (manualUnitPrice <= 0) return;

    setManualSaving(true);
    const row = {
      branch_id: manualBranch,
      sale_date: manualDate,
      receipt_no: `MANUAL-${Date.now()}`,
      menu_code: selectedMenu.menuCode,
      menu_name: selectedMenu.menuName,
      order_type: 'Manual',
      qty: manualQty,
      unit_price: manualUnitPrice,
      net_amount: manualNetAmount,
      channel: 'Manual',
    };
    const { error } = await supabase.from('sales_entries').insert(row);
    if (error) { toast.error('Failed: ' + error.message); setManualSaving(false); return; }

    setManualSuccess(true);
    setTimeout(() => setManualSuccess(false), 1500);
    setManualMenuId('');
    setManualMenuSearch('');
    setManualQty(1);
    setManualSaving(false);
    fetchEntries(filterBranch !== '__all__' ? { branchId: filterBranch } : undefined);
    setTimeout(() => menuInputRef.current?.focus(), 100);
  }, [manualBranch, manualMenuId, selectedMenu, manualDate, manualQty, manualUnitPrice, manualNetAmount, fetchEntries]);

  // ——— History state ———
  const [filterBranch, setFilterBranch] = useState<string>('__all__');
  const todayStr = useMemo(() => toLocalDateStr(new Date()), []);
  const [filterDateFrom, setFilterDateFrom] = useState(todayStr);
  const [filterDateTo, setFilterDateTo] = useState(todayStr);
  const [historySearch, setHistorySearch] = useState('');
  const [appliedOnce, setAppliedOnce] = useState(false);

  // Lightweight preview: last 25 entries (no filters, no pagination)
  const [previewEntries, setPreviewEntries] = useState<SalesEntry[]>([]);
  const [previewLoading, setPreviewLoading] = useState(true);

  useEffect(() => {
    const loadPreview = async () => {
      setPreviewLoading(true);
      const { data } = await supabase
        .from('sales_entries')
        .select('*')
        .order('sale_date', { ascending: false })
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(25);
      if (data) {
        setPreviewEntries(data.map((r: any) => ({
          id: r.id,
          branchId: r.branch_id,
          saleDate: r.sale_date,
          receiptNo: r.receipt_no,
          menuCode: r.menu_code,
          menuName: r.menu_name,
          orderType: r.order_type,
          qty: Number(r.qty),
          unitPrice: Number(r.unit_price),
          netAmount: Number(r.net_amount),
          channel: r.channel,
        })));
      }
      setPreviewLoading(false);
    };
    loadPreview();
  }, []);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);

  type SESortKey = 'saleDate' | 'menuCode' | 'menuName' | 'orderType' | 'qty' | 'unitPrice' | 'netAmount' | 'channel' | 'branch';
  const [seSortKey, setSeSortKey] = useState<SESortKey>('saleDate');
  const [seSortDir, setSeSortDir] = useState<'asc' | 'desc'>('desc');

  const handleSeSort = (key: SESortKey) => {
    if (seSortKey === key) setSeSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSeSortKey(key); setSeSortDir('asc'); }
  };

  const SeSortIcon = ({ col }: { col: SESortKey }) => {
    if (seSortKey !== col) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-30" />;
    return seSortDir === 'asc'
      ? <ArrowUp className="w-3 h-3 ml-1 text-primary" />
      : <ArrowDown className="w-3 h-3 ml-1 text-primary" />;
  };

  const branchMap = useMemo(() => {
    const m: Record<string, string> = {};
    branches.forEach(b => { m[b.id] = b.branchName; });
    return m;
  }, [branches]);

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

  const totalQty = useMemo(() => entries.reduce((s, e) => s + e.qty, 0), [entries]);
  const totalRevenue = useMemo(() => entries.reduce((s, e) => s + e.netAmount, 0), [entries]);

  const handleApplyFilter = useCallback(() => {
    const filters: { branchId?: string; dateFrom?: string; dateTo?: string } = {};
    if (filterBranch !== '__all__') filters.branchId = filterBranch;
    if (filterDateFrom) filters.dateFrom = filterDateFrom;
    if (filterDateTo) filters.dateTo = filterDateTo;
    fetchEntries(filters);
    setAppliedOnce(true);
  }, [filterBranch, filterDateFrom, filterDateTo, fetchEntries]);

  // ——— Parse + duplicate check ———
  const processRawText = useCallback(async (text: string, source: ParseSource = 'paste') => {
    if (!text || text.trim() === '') {
      setParsedRows([]);
      setSkippedNoCodeRows([]);
      return;
    }
    if (!selectedProfile || !selectedBranch) {
      setParsedRows([]);
      setSkippedNoCodeRows([]);
      return;
    }
    const { rows: raw, skippedRows: skipped } = parseData(text, selectedProfile, selectedBranch, source);
    setSkippedNoCodeRows(skipped);
    if (raw.length === 0) {
      setParsedRows([]);
      toast.warning('No valid rows found in pasted data');
      return;
    }
    setChecking(true);
    try {
      const withDups = await checkDuplicates(selectedBranch, raw);
      setParsedRows(withDups);
      setShowSkipped(false);
      setShowSkippedNoCode(false);
    } catch (err) {
      console.error('checkDuplicates failed', err);
      setParsedRows(raw.map(r => ({ ...r, isDuplicate: false })));
    } finally {
      setChecking(false);
    }
  }, [selectedProfile, selectedBranch, checkDuplicates]);

  const handlePaste = useCallback((text: string) => {
    setPastedText(text);
    processRawText(text, 'paste');
  }, [processRawText]);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadedFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setPendingFileText(text);
    };
    reader.readAsText(file);
    e.target.value = '';
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file || !file.name.endsWith('.csv')) { toast.error('Please drop a .csv file'); return; }
    setUploadedFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setPendingFileText(text);
    };
    reader.readAsText(file);
  }, []);

  // Process pending file text once profile and branch are available
  useEffect(() => {
    if (pendingFileText && selectedProfile && selectedBranch) {
      processRawText(pendingFileText, 'csv');
      setPendingFileText(null);
    }
  }, [pendingFileText, selectedProfile, selectedBranch, processRawText]);

  const newRows = useMemo(() => parsedRows.filter(r => !r.isDuplicate), [parsedRows]);
  const skipRows = useMemo(() => parsedRows.filter(r => r.isDuplicate), [parsedRows]);

  const handleImport = useCallback(async () => {
    if (!selectedBranch || newRows.length === 0) return;
    setImporting(true);
    const result = await bulkInsert(selectedBranch, newRows);
    if (result) {
      const totalRev = newRows.reduce((s, r) => s + r.netAmount, 0);
      const revStr = `฿${totalRev.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      toast.success(`${result.inserted} rows imported · ${revStr} total revenue`);
      setPastedText('');
      setParsedRows([]);
      setSkippedNoCodeRows([]);
      setUploadedFileName('');
      fetchEntries(filterBranch !== '__all__' ? { branchId: filterBranch } : undefined);
    }
    setImporting(false);
  }, [selectedBranch, newRows, bulkInsert, fetchEntries, filterBranch]);

  // ——— Manage Transactions handlers ———
  const loadMgmtTransactions = useCallback(async () => {
    if (!mgmtBranch || !mgmtDateFrom || !mgmtDateTo) return;
    setMgmtLoading(true);
    setMgmtSelectedIds(new Set());
    const fromStr = toLocalDateStr(mgmtDateFrom);
    const toStr = toLocalDateStr(mgmtDateTo);
    const { data, error } = await supabase
      .from('sales_entries')
      .select('*')
      .eq('branch_id', mgmtBranch)
      .gte('sale_date', fromStr)
      .lte('sale_date', toStr)
      .order('sale_date', { ascending: false })
      .order('receipt_no');
    if (error) { toast.error('Failed to load: ' + error.message); }
    setMgmtTransactions((data || []).map(d => ({
      id: d.id,
      branchId: d.branch_id,
      saleDate: d.sale_date,
      receiptNo: d.receipt_no,
      menuCode: d.menu_code,
      menuName: d.menu_name,
      orderType: d.order_type,
      qty: d.qty,
      unitPrice: d.unit_price,
      netAmount: d.net_amount,
      channel: d.channel,
    })));
    setMgmtLoading(false);
  }, [mgmtBranch, mgmtDateFrom, mgmtDateTo]);

  const handleMgmtDelete = useCallback(async () => {
    const idsToDelete = mgmtDeleteType === 'all'
      ? mgmtTransactions.map(t => t.id)
      : Array.from(mgmtSelectedIds);
    if (idsToDelete.length === 0) return;
    const { error } = await supabase.from('sales_entries').delete().in('id', idsToDelete);
    if (error) { toast.error('Delete failed: ' + error.message); return; }
    toast.success(`${idsToDelete.length} transactions deleted successfully`);
    setMgmtDeleteType(null);
    setMgmtSelectedIds(new Set());
    loadMgmtTransactions();
    fetchEntries(filterBranch !== '__all__' ? { branchId: filterBranch } : undefined);
  }, [mgmtDeleteType, mgmtTransactions, mgmtSelectedIds, loadMgmtTransactions, fetchEntries, filterBranch]);

  const mgmtAllSelected = mgmtTransactions.length > 0 && mgmtSelectedIds.size === mgmtTransactions.length;
  const mgmtSomeSelected = mgmtSelectedIds.size > 0 && mgmtSelectedIds.size < mgmtTransactions.length;
  const mgmtSelectedSum = useMemo(() =>
    mgmtTransactions.filter(t => mgmtSelectedIds.has(t.id)).reduce((s, t) => s + t.netAmount, 0),
    [mgmtTransactions, mgmtSelectedIds]
  );
  const mgmtTotalSum = useMemo(() =>
    mgmtTransactions.reduce((s, t) => s + t.netAmount, 0),
    [mgmtTransactions]
  );
  const mgmtFromStr = mgmtDateFrom ? toLocalDateStr(mgmtDateFrom) : '';
  const mgmtToStr = mgmtDateTo ? toLocalDateStr(mgmtDateTo) : '';
  const mgmtBranchName = branchMap[mgmtBranch] || '';

  const toggleMgmtRow = useCallback((id: string) => {
    setMgmtSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleMgmtAll = useCallback(() => {
    if (mgmtAllSelected) {
      setMgmtSelectedIds(new Set());
    } else {
      setMgmtSelectedIds(new Set(mgmtTransactions.map(t => t.id)));
    }
  }, [mgmtAllSelected, mgmtTransactions]);

  // Profile dropdown handler
  const handleProfileChange = (val: string) => {
    if (val === '__new__') {
      setEditingProfile(null);
      setProfileModalOpen(true);
    } else {
      setSelectedProfileId(val);
    }
  };

  const handleEditProfile = () => {
    if (selectedProfile) {
      setEditingProfile(selectedProfile);
      setProfileModalOpen(true);
    }
  };

  const handleProfileSave = async (p: Omit<POSMappingProfile, 'id'> & { id?: string }) => {
    const success = await saveProfile(p);
    if (success && !p.id) {
      // After creating new profile, wait for profiles to refresh then select the newest
      setTimeout(() => {
        // The fetchProfiles inside saveProfile already updated profiles
        // We'll select by name match
      }, 100);
    }
    return success;
  };

  return (
    <div className="space-y-4">
      {/* ═══ SECTION 1: IMPORT SALES DATA ═══ */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <h2 className="text-lg font-semibold">Import Sales Data</h2>
            <div className="flex items-center gap-2">
              <Select value={selectedProfileId} onValueChange={handleProfileChange}>
                <SelectTrigger className="h-10 w-52">
                  <SelectValue placeholder="Select POS Profile" />
                </SelectTrigger>
                <SelectContent>
                  {profiles.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                  <SelectItem value="__new__">+ New Profile</SelectItem>
                </SelectContent>
              </Select>
              {selectedProfile && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-10 w-10" onClick={handleEditProfile}>
                        <Pencil className="w-4 h-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Edit profile</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Branch selector */}
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium whitespace-nowrap label-required">Branch</label>
            <Select value={selectedBranch} onValueChange={v => { setSelectedBranch(v); setPendingFileText(null); }}>
              <SelectTrigger className="w-64 h-10">
                <SelectValue placeholder="Select branch" />
              </SelectTrigger>
              <SelectContent>
                {availableBranches.map(b => (
                  <SelectItem key={b.id} value={b.id}>{b.branchName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Input Tabs */}
          <Tabs defaultValue="paste">
            <TabsList>
              <TabsTrigger value="paste" className="gap-1.5">
                <ClipboardPaste className="w-4 h-4" /> Paste
              </TabsTrigger>
              <TabsTrigger value="upload" className="gap-1.5">
                <FileUp className="w-4 h-4" /> Upload CSV
              </TabsTrigger>
            </TabsList>

            <TabsContent value="paste">
              <Textarea
                placeholder="Paste POS data here (Ctrl+V)..."
                value={pastedText}
                onChange={e => handlePaste(e.target.value)}
                rows={6}
                className="font-mono text-xs"
              />
            </TabsContent>

            <TabsContent value="upload">
              <div
                className="border-2 border-dashed border-border rounded-lg p-8 text-center bg-muted/20 hover:bg-muted/40 transition cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={handleDrop}
              >
                <Upload className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">
                  Drop CSV file here or click to browse
                </p>
                {uploadedFileName && (
                  <p className="text-sm font-medium text-foreground mt-2">{uploadedFileName}</p>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={handleFileUpload}
              />
            </TabsContent>
          </Tabs>

          {/* Checking indicator */}
          {checking && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Checking for duplicates...
            </div>
          )}

          {/* Preview section */}
          {parsedRows.length > 0 && (
            <div className="space-y-3">
              {/* Summary banner */}
              <div className="flex items-center gap-2 text-sm">
                <span>Found {parsedRows.length} rows</span>
                <span className="text-muted-foreground">·</span>
                <span className="text-green-600 font-semibold">{newRows.length} new</span>
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground">{skipRows.length} already imported</span>
              </div>

              {/* Skipped rows collapsible */}
              {skipRows.length > 0 && (
                <Collapsible open={showSkipped} onOpenChange={setShowSkipped}>
                  <CollapsibleTrigger className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
                    {showSkipped ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    Show {skipRows.length} skipped rows
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className={cn(tableTokens.wrapper, 'mt-2')}>
                      <table className={tableTokens.base}>
                        <colgroup>
                          <col width="88px" />
                          <col width="80px" />
                          <col width="80px" />
                          <col width="auto" />
                          <col width="65px" />
                        </colgroup>
                        <thead>
                          <tr className={tableTokens.headerRow}>
                            <th className={tableTokens.headerCell}>Date</th>
                            <th className={tableTokens.headerCell}>Receipt</th>
                            <th className={tableTokens.headerCell}>Menu Code</th>
                            <th className={tableTokens.headerCell}>Menu Name</th>
                            <th className={tableTokens.headerCellNumeric}>Qty</th>
                          </tr>
                        </thead>
                        <tbody>
                          {skipRows.map((r, i) => (
                            <tr key={i} className={cn(tableTokens.dataRow, 'opacity-50')}>
                              <td className={tableTokens.dataCell}>{r.saleDate}</td>
                              <td className={cn(tableTokens.dataCell, 'font-mono text-xs')}>{r.receiptNo}</td>
                              <td className={cn(tableTokens.dataCell, 'font-mono text-xs')}>{r.menuCode}</td>
                              <td className={tableTokens.truncatedCell} title={r.menuName}>{r.menuName}</td>
                              <td className={tableTokens.dataCellMono}>{r.qty}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              )}

              {/* Skipped rows — no menu code */}
              {skippedNoCodeRows.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-3">
                  <Collapsible open={showSkippedNoCode} onOpenChange={setShowSkippedNoCode}>
                    <CollapsibleTrigger className="flex items-center gap-1 text-sm font-medium text-amber-700 dark:text-amber-400 hover:text-amber-900 dark:hover:text-amber-300 transition-colors cursor-pointer w-full">
                      {showSkippedNoCode ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      {skippedNoCodeRows.length} rows skipped — no menu code. Add these manually.
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className={cn(tableTokens.wrapper, 'mt-2')}>
                        <table className={tableTokens.base}>
                          <colgroup>
                            <col width="88px" />
                            <col width="100px" />
                            <col width="auto" />
                          </colgroup>
                          <thead>
                            <tr className={tableTokens.headerRow}>
                              <th className={tableTokens.headerCell}>Date</th>
                              <th className={tableTokens.headerCell}>Receipt No</th>
                              <th className={tableTokens.headerCell}>Menu Name</th>
                            </tr>
                          </thead>
                          <tbody>
                            {skippedNoCodeRows.map((r, i) => (
                              <tr key={i} className={tableTokens.dataRow}>
                                <td className={tableTokens.dataCell}>{r.saleDate}</td>
                                <td className={cn(tableTokens.dataCell, 'font-mono text-xs')}>{r.receiptNo}</td>
                                <td className={tableTokens.truncatedCell} title={r.menuName}>{r.menuName}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                </div>
              )}

              {/* New rows preview table */}
              {newRows.length > 0 ? (
                <>
                <div className={tableTokens.wrapper}>
                  <div className="overflow-auto max-h-[50vh]">
                    <table className={tableTokens.base}>
                      <colgroup>
                        <col width="88px" />
                        <col width="80px" />
                        <col width="80px" />
                        <col width="auto" />
                        <col width="65px" />
                        <col width="95px" />
                        <col width="80px" />
                      </colgroup>
                      <thead>
                        <tr className={tableTokens.headerRow}>
                          <th className={tableTokens.headerCell}>Date</th>
                          <th className={tableTokens.headerCell}>Receipt</th>
                          <th className={tableTokens.headerCell}>Menu Code</th>
                          <th className={tableTokens.headerCell}>Menu Name</th>
                          <th className={tableTokens.headerCellNumeric}>Qty</th>
                          <th className={tableTokens.headerCellNumeric}>Net Amount</th>
                          <th className={tableTokens.headerCell}>Channel</th>
                        </tr>
                      </thead>
                      <tbody>
                        {newRows.map((r, i) => (
                          <tr key={i} className={tableTokens.dataRow}>
                            <td className={tableTokens.dataCell}>{r.saleDate}</td>
                            <td className={cn(tableTokens.dataCell, 'font-mono text-xs')}>{r.receiptNo}</td>
                            <td className={cn(tableTokens.dataCell, 'font-mono text-xs')}>{r.menuCode}</td>
                            <td className={tableTokens.truncatedCell} title={r.menuName}>{r.menuName}</td>
                            <td className={tableTokens.dataCellMono}>{r.qty}</td>
                            <td className={tableTokens.dataCellMono}>{r.netAmount.toFixed(2)}</td>
                            <td className={tableTokens.dataCell}>{r.channel}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                {/* Import preview summary */}
                <div className="flex gap-6 text-sm text-muted-foreground pt-2 border-t">
                  <span>Total Qty: <span className="font-semibold text-foreground">{newRows.reduce((s, r) => s + r.qty, 0).toLocaleString()}</span></span>
                  <span>Total Revenue: <span className="font-semibold font-mono text-foreground">฿{newRows.reduce((s, r) => s + r.netAmount, 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></span>
                  <span>{newRows.length} rows to import</span>
                </div>
                </>
              ) : (
                <div className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
                  All rows already imported.
                </div>
              )}

              {/* Import button */}
              <Button
                onClick={handleImport}
                disabled={importing || checking || newRows.length === 0 || !selectedBranch}
                className={cn(newRows.length === 0 && 'opacity-50')}
              >
                {importing ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Importing...</>
                ) : (
                  <><Upload className="w-4 h-4" /> Import {newRows.length} rows</>
                )}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ═══ SECTION 1.5: MANUAL ENTRY — UNCHANGED ═══ */}
      <Card>
        <Collapsible open={manualOpen} onOpenChange={setManualOpen}>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-accent transition-colors">
              <CardTitle className="flex items-center gap-2 text-lg font-semibold">
                <Plus className="w-5 h-5" />
                Manual Entry
                <ChevronDown className={cn('w-4 h-4 ml-auto transition-transform', manualOpen && 'rotate-180')} />
              </CardTitle>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0">
              <div className="flex items-end gap-2 flex-wrap">
                <div className="w-[200px]">
                  <DatePicker
                    value={manualDate ? new Date(manualDate + 'T00:00:00') : undefined}
                    onChange={d => setManualDate(d ? toLocalDateStr(d) : '')}
                    defaultToday
                    label="Date"
                    required
                    labelPosition="above"
                    align="start"
                  />
                </div>
                <div className="w-48">
                  <label className="text-xs text-muted-foreground">Branch</label>
                  <Select value={manualBranch} onValueChange={setManualBranch}>
                    <SelectTrigger tabIndex={2}>
                      <SelectValue placeholder="Select branch" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableBranches.map(b => (
                        <SelectItem key={b.id} value={b.id}>{b.branchName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="w-64 relative">
                  <label className="text-xs text-muted-foreground">Menu</label>
                  <Input
                    ref={menuInputRef}
                    placeholder="Search code or name..."
                    value={manualMenuSearch}
                    onChange={e => {
                      setManualMenuSearch(e.target.value);
                      setManualMenuId('');
                      setMenuDropdownOpen(true);
                    }}
                    onFocus={() => setMenuDropdownOpen(true)}
                    tabIndex={3}
                    autoComplete="off"
                  />
                  {menuDropdownOpen && (
                    <div
                      ref={menuDropdownRef}
                      className="absolute z-50 top-full left-0 right-0 mt-1 max-h-48 overflow-y-auto bg-popover border rounded-md shadow-lg"
                    >
                      {filteredMenus.length === 0 ? (
                        <div className="px-3 py-2 text-xs text-muted-foreground">No menus found</div>
                      ) : (
                        filteredMenus.map(m => (
                          <button
                            key={m.id}
                            type="button"
                            className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent transition-colors flex items-center gap-2"
                            onMouseDown={e => { e.preventDefault(); handleSelectMenu(m); }}
                          >
                            <span className="font-mono text-xs text-muted-foreground">{m.menuCode}</span>
                            <span className="truncate">{m.menuName}</span>
                            <span className="ml-auto text-xs text-muted-foreground">฿{m.sellingPrice.toFixed(0)}</span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
                <div className="w-20">
                  <label className="text-xs text-muted-foreground">Qty</label>
                  <Input
                    type="number"
                    value={manualQty}
                    onChange={e => setManualQty(Number(e.target.value) || 0)}
                    onFocus={e => e.target.select()}
                    min={1}
                    tabIndex={4}
                  />
                </div>
                <div className="w-24">
                  <label className="text-xs text-muted-foreground">Unit Price</label>
                  <div className={cn(
                    'h-10 flex items-center px-3 rounded-md border bg-muted/50 text-sm tabular-nums',
                    hasNoPrice && 'text-destructive border-destructive/50'
                  )}>
                    {!manualMenuId ? '—' : hasNoPrice ? 'No price' : `฿${manualUnitPrice.toFixed(2)}`}
                  </div>
                </div>
                <div className="w-28">
                  <label className="text-xs text-muted-foreground">Net Amount</label>
                  <div className="h-10 flex items-center px-3 rounded-md border bg-muted/50 text-sm font-medium tabular-nums">
                    {manualMenuId ? `฿${manualNetAmount.toFixed(2)}` : '—'}
                  </div>
                </div>
                <Button
                  onClick={handleManualAdd}
                  disabled={manualSaving || !manualMenuId || !manualBranch || !!hasNoPrice}
                  className="h-10"
                  tabIndex={5}
                >
                  {manualSuccess ? (
                    <CheckCircle2 className="w-4 h-4 text-success animate-in fade-in zoom-in" />
                  ) : (
                    <><Plus className="w-4 h-4" /> Add</>
                  )}
                </Button>
              </div>
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      {/* ═══ SECTION 2: SALES HISTORY ═══ */}
      <Card>
        <CardHeader>
          <CardTitle>{t('title.salesHistory')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
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
            <DatePicker
              value={filterDateFrom ? new Date(filterDateFrom + 'T00:00:00') : undefined}
              onChange={d => setFilterDateFrom(d ? toLocalDateStr(d) : '')}
              placeholder="From date"
              label="From"
              labelPosition="left"
              align="start"
            />
            <DatePicker
              value={filterDateTo ? new Date(filterDateTo + 'T00:00:00') : undefined}
              onChange={d => setFilterDateTo(d ? toLocalDateStr(d) : '')}
              placeholder="To date"
              label="To"
              labelPosition="left"
              align="start"
            />
            <Button variant="outline" onClick={handleApplyFilter}>{t('btn.apply')}</Button>
          </div>

          {/* Search — only after Apply */}
          {appliedOnce && entries.length > 0 && (
            <SearchInput
              value={historySearch}
              onChange={setHistorySearch}
              placeholder="Search menu, receipt no, channel..."
              totalCount={entries.length}
              filteredCount={filteredEntries.length}
              entityName="entries"
            />
          )}

          {/* Preview banner — before Apply */}
          {!appliedOnce && !loading && (
            <div className="rounded-md border border-border bg-muted/40 px-4 py-2 text-sm text-muted-foreground">
              Showing last 25 recent entries. Select filters and press Apply to load full history.
            </div>
          )}

          {(() => {
            const showEntries = appliedOnce ? filteredEntries : previewEntries;
            const isLoading = appliedOnce ? loading : previewLoading;
            const isEmpty = !isLoading && showEntries.length === 0;

            return isLoading ? (
              <SkeletonTable columns={9} rows={8} />
            ) : (
              <div className="rounded-lg border bg-card overflow-hidden">
                <div className="overflow-auto max-h-[70vh]">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-table-header sticky top-0 z-10">
                        <th className="text-left px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground cursor-pointer select-none hover:bg-muted/50 transition-colors" onClick={() => handleSeSort('saleDate')}>
                          <span className="inline-flex items-center">{t('col.date')}<SeSortIcon col="saleDate" /></span>
                        </th>
                        <th className="text-left px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground cursor-pointer select-none hover:bg-muted/50 transition-colors" onClick={() => handleSeSort('menuCode')}>
                          <span className="inline-flex items-center">{t('col.menuCode')}<SeSortIcon col="menuCode" /></span>
                        </th>
                        <th className="text-left px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground cursor-pointer select-none hover:bg-muted/50 transition-colors" onClick={() => handleSeSort('menuName')}>
                          <span className="inline-flex items-center">{t('col.menuName')}<SeSortIcon col="menuName" /></span>
                        </th>
                        <th className="text-left px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground cursor-pointer select-none hover:bg-muted/50 transition-colors" onClick={() => handleSeSort('orderType')}>
                          <span className="inline-flex items-center">{t('col.orderType')}<SeSortIcon col="orderType" /></span>
                        </th>
                        <th className="text-right px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground cursor-pointer select-none hover:bg-muted/50 transition-colors" onClick={() => handleSeSort('qty')}>
                          <span className="inline-flex items-center justify-end">{t('col.qty')}<SeSortIcon col="qty" /></span>
                        </th>
                        <th className="text-right px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground cursor-pointer select-none hover:bg-muted/50 transition-colors" onClick={() => handleSeSort('unitPrice')}>
                          <span className="inline-flex items-center justify-end">{t('col.unitPrice')}<SeSortIcon col="unitPrice" /></span>
                        </th>
                        <th className="text-right px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground cursor-pointer select-none hover:bg-muted/50 transition-colors" onClick={() => handleSeSort('netAmount')}>
                          <span className="inline-flex items-center justify-end">{t('col.netAmount')}<SeSortIcon col="netAmount" /></span>
                        </th>
                        <th className="text-left px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground cursor-pointer select-none hover:bg-muted/50 transition-colors" onClick={() => handleSeSort('channel')}>
                          <span className="inline-flex items-center">{t('col.channel')}<SeSortIcon col="channel" /></span>
                        </th>
                        <th className="text-left px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground cursor-pointer select-none hover:bg-muted/50 transition-colors" onClick={() => handleSeSort('branch')}>
                          <span className="inline-flex items-center">{t('col.branch')}<SeSortIcon col="branch" /></span>
                        </th>
                        {isManagement && <th className="w-10 px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground" />}
                      </tr>
                    </thead>
                    <tbody>
                      {isEmpty ? (
                        <tr>
                          <td colSpan={10} className="px-3">
                            <EmptyState
                              icon={ShoppingCart}
                              title={!appliedOnce ? 'No recent entries' : entries.length === 0 ? 'No sales data yet' : 'No entries match your search'}
                              description={!appliedOnce ? 'Press Apply to load filtered history' : entries.length === 0 ? 'Paste your first POS export above to get started' : 'Try adjusting your search or filter'}
                            />
                          </td>
                        </tr>
                      ) : showEntries.map((e) => (
                        <tr key={e.id} className={tableTokens.dataRow}>
                          <td className="px-3 py-2 text-sm whitespace-nowrap">{e.saleDate}</td>
                          <td className="px-3 py-2 font-mono text-xs">{e.menuCode}</td>
                          <td className="px-3 py-2 text-sm max-w-[200px] truncate" title={e.menuName}>{e.menuName}</td>
                          <td className="px-3 py-2 text-sm">{e.orderType}</td>
                          <td className="px-3 py-2 text-sm font-mono text-right">{e.qty}</td>
                          <td className="px-3 py-2 text-sm font-mono text-right">{e.unitPrice.toFixed(2)}</td>
                          <td className="px-3 py-2 text-sm font-mono text-right font-medium">{e.netAmount.toFixed(2)}</td>
                          <td className="px-3 py-2 text-sm">{e.channel}</td>
                          <td className="px-3 py-2 text-sm">{branchMap[e.branchId] || '-'}</td>
                          {isManagement && (
                            <td className="px-3 py-2">
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
            );
          })()}

          {/* Summary footer — only after Apply */}
          {appliedOnce && entries.length > 0 && (
            <div className="flex gap-6 text-sm pt-2 border-t">
              <span>{t('common.totalQty')}: <strong>{totalQty.toLocaleString()}</strong></span>
              <span>{t('common.totalRevenue')}: <strong className="font-mono">฿{totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong></span>
              <span className="text-muted-foreground">Showing {filteredEntries.length} of {entries.length} entries</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ═══ SECTION 3: MANAGE TRANSACTIONS (Management only) ═══ */}
      {isManagement && (
        <Card className="border-l-4 border-l-destructive">
          <Collapsible open={mgmtOpen} onOpenChange={setMgmtOpen}>
            <CollapsibleTrigger asChild>
              <CardHeader className="cursor-pointer hover:bg-accent transition-colors">
                <div>
                  <CardTitle className="flex items-center gap-2 text-lg font-semibold">
                    <Trash2 className="w-5 h-5 text-destructive" />
                    Manage Transactions
                    <ChevronDown className={cn('w-4 h-4 ml-auto transition-transform', mgmtOpen && 'rotate-180')} />
                  </CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">View and delete transaction records by date and branch</p>
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="pt-0 space-y-4">
                {/* Filters */}
                <div className="flex items-center gap-3 flex-wrap">
                  <div>
                    <label className="text-xs text-muted-foreground">Branch</label>
                    <Select value={mgmtBranch} onValueChange={setMgmtBranch}>
                      <SelectTrigger className="w-48 h-10">
                        <SelectValue placeholder="Select branch" />
                      </SelectTrigger>
                      <SelectContent>
                        {branches.filter(b => b.status === 'Active').map(b => (
                          <SelectItem key={b.id} value={b.id}>{b.branchName}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <DatePicker
                    value={mgmtDateFrom}
                    onChange={setMgmtDateFrom}
                    placeholder="From date"
                    label="From"
                    labelPosition="above"
                    required
                    align="start"
                  />
                  <DatePicker
                    value={mgmtDateTo}
                    onChange={setMgmtDateTo}
                    placeholder="To date"
                    label="To"
                    labelPosition="above"
                    required
                    align="start"
                  />
                  <div className="self-end">
                    <Button
                      onClick={loadMgmtTransactions}
                      disabled={!mgmtBranch || !mgmtDateFrom || !mgmtDateTo || mgmtLoading}
                    >
                      {mgmtLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Loading...</> : 'Load Transactions'}
                    </Button>
                  </div>
                </div>

                {/* Transactions table */}
                {mgmtTransactions.length > 0 || mgmtLoading ? (
                  <div className="space-y-3">
                    <div className={tableTokens.wrapper}>
                      <table className={tableTokens.base}>
                        <colgroup>
                          <col width="36px" />
                          <col width="88px" />
                          <col width="80px" />
                          <col width="auto" />
                          <col width="60px" />
                          <col width="90px" />
                          <col width="80px" />
                        </colgroup>
                        <thead>
                          <tr className={tableTokens.headerRow}>
                            <th className={cn(tableTokens.headerCellCenter, 'px-1')}>
                              <Checkbox
                                checked={mgmtAllSelected ? true : mgmtSomeSelected ? 'indeterminate' : false}
                                onCheckedChange={toggleMgmtAll}
                              />
                            </th>
                            <th className={tableTokens.headerCell}>Receipt</th>
                            <th className={tableTokens.headerCell}>Menu Code</th>
                            <th className={tableTokens.headerCell}>Menu Name</th>
                            <th className={tableTokens.headerCellNumeric}>Qty</th>
                            <th className={tableTokens.headerCellNumeric}>Net Amount</th>
                            <th className={tableTokens.headerCell}>Channel</th>
                          </tr>
                        </thead>
                        <tbody>
                          {mgmtLoading ? (
                            <tr><td colSpan={7} className={tableTokens.emptyState}><Loader2 className="w-4 h-4 animate-spin mx-auto" /></td></tr>
                          ) : mgmtTransactions.map(t => (
                            <tr
                              key={t.id}
                              className={mgmtSelectedIds.has(t.id) ? tableTokens.dataRowSelected : tableTokens.dataRow}
                            >
                              <td className={cn(tableTokens.dataCellCenter, 'px-1')}>
                                <Checkbox
                                  checked={mgmtSelectedIds.has(t.id)}
                                  onCheckedChange={() => toggleMgmtRow(t.id)}
                                />
                              </td>
                              <td className={cn(tableTokens.dataCell, 'font-mono text-xs')}>{t.receiptNo}</td>
                              <td className={cn(tableTokens.dataCell, 'font-mono text-xs')}>{t.menuCode}</td>
                              <td className={tableTokens.truncatedCell} title={t.menuName}>{t.menuName}</td>
                              <td className={tableTokens.dataCellMono}>{t.qty}</td>
                              <td className={tableTokens.dataCellMono}>{t.netAmount.toFixed(2)}</td>
                              <td className={tableTokens.dataCell}>{t.channel}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Summary */}
                    <div className="text-sm text-muted-foreground">
                      {mgmtSelectedIds.size > 0 ? (
                        <span><span className="font-semibold text-foreground">{mgmtSelectedIds.size}</span> selected · <span className="font-semibold font-mono text-foreground">฿{mgmtSelectedSum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span> selected</span>
                      ) : (
                        <span><span className="font-semibold text-foreground">{mgmtTransactions.length}</span> transactions · Total: <span className="font-semibold font-mono text-foreground">฿{mgmtTotalSum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></span>
                      )}
                    </div>

                    {/* Delete buttons */}
                    <div className="flex gap-3">
                      <Button
                        variant="destructive"
                        disabled={mgmtSelectedIds.size === 0}
                        onClick={() => setMgmtDeleteType('selected')}
                      >
                        <Trash2 className="w-4 h-4" /> Delete Selected ({mgmtSelectedIds.size})
                      </Button>
                      <Button
                        variant="destructive"
                        disabled={mgmtTransactions.length === 0}
                        onClick={() => setMgmtDeleteType('all')}
                      >
                        <Trash2 className="w-4 h-4" /> Delete All for {mgmtDateStr} · {mgmtBranchName}
                      </Button>
                    </div>
                  </div>
                ) : mgmtBranch && mgmtDate && !mgmtLoading && (
                  <div className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
                    No transactions found for this date and branch.
                  </div>
                )}
              </CardContent>
            </CollapsibleContent>
          </Collapsible>
        </Card>
      )}

      {/* Manage Transactions delete confirmation */}
      <AlertDialog open={!!mgmtDeleteType} onOpenChange={open => !open && setMgmtDeleteType(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {mgmtDeleteType === 'all'
                ? `Delete ALL transactions for ${mgmtDateStr}?`
                : `Delete ${mgmtSelectedIds.size} transactions?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {mgmtDeleteType === 'all'
                ? `This will permanently delete ALL ${mgmtTransactions.length} transactions for ${mgmtBranchName} on ${mgmtDateStr}. This cannot be undone. Re-upload correct data after deleting.`
                : `This will permanently delete ${mgmtSelectedIds.size} selected transactions for ${mgmtBranchName} on ${mgmtDateStr}. You can re-upload correct data after.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleMgmtDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {mgmtDeleteType === 'all'
                ? `Delete All ${mgmtTransactions.length} transactions`
                : `Delete ${mgmtSelectedIds.size} transactions`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ConfirmDialog
        open={!!deleteConfirm}
        onOpenChange={open => !open && setDeleteConfirm(null)}
        title="Delete Sales Entry"
        description={`Delete "${deleteConfirm?.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={() => { if (deleteConfirm) { deleteEntry(deleteConfirm.id); setDeleteConfirm(null); toast.success('Entry deleted'); } }}
      />

      <POSProfileModal
        open={profileModalOpen}
        onOpenChange={setProfileModalOpen}
        profile={editingProfile}
        onSave={handleProfileSave}
        onDelete={deleteProfile}
      />
    </div>
  );
}
