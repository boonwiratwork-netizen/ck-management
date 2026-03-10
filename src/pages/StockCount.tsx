import { useState, useMemo } from 'react';
import { useLanguage } from '@/hooks/use-language';
import { SKU, StorageCondition } from '@/types/sku';
import { useSortableTable } from '@/hooks/use-sortable-table';
import { SortableHeader } from '@/components/SortableHeader';
import { StockCountSession, StockCountLine } from '@/types/stock-count';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Plus, ClipboardCheck, Lock, Trash2, ChevronRight, AlertTriangle, CheckCircle2, Package } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  skus: SKU[];
  stockCountData: {
    sessions: StockCountSession[];
    createSession: (date: string, note: string) => string | Promise<string>;
    updateLine: (lineId: string, physicalQty: number | null, note?: string) => void | Promise<void>;
    confirmSession: (sessionId: string) => void | Promise<void>;
    deleteSession: (sessionId: string) => void | Promise<void>;
    getLinesForSession: (sessionId: string) => StockCountLine[];
  };
  getStdUnitPrice: (skuId: string) => number;
}

export default function StockCountPage({ skus, stockCountData, getStdUnitPrice }: Props) {
  const { sessions, createSession, updateLine, confirmSession, deleteSession, getLinesForSession } = stockCountData;
  const { t } = useLanguage();

  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newDate, setNewDate] = useState(new Date().toISOString().slice(0, 10));
  const [newNote, setNewNote] = useState('');
  const [activeTab, setActiveTab] = useState<string>('RM');
  const [filterStorage, setFilterStorage] = useState<string>('all');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const selectedSession = sessions.find(s => s.id === selectedSessionId) ?? null;
  const sessionLines = selectedSessionId ? getLinesForSession(selectedSessionId) : [];
  const isCompleted = selectedSession?.status === 'Completed';

  const skuMap = useMemo(() => {
    const m: Record<string, SKU> = {};
    skus.forEach(s => { m[s.id] = s; });
    return m;
  }, [skus]);

  const filteredLines = useMemo(() => {
    return sessionLines.filter(line => {
      const sku = skuMap[line.skuId];
      if (!sku) return false;
      if (line.type !== activeTab) return false;
      if (filterStorage !== 'all' && sku.storageCondition !== filterStorage) return false;
      return true;
    });
  }, [sessionLines, skuMap, activeTab, filterStorage]);

  const scComparators = useMemo(() => ({
    skuId: (a: StockCountLine, b: StockCountLine) => (skuMap[a.skuId]?.skuId || '').localeCompare(skuMap[b.skuId]?.skuId || ''),
    name: (a: StockCountLine, b: StockCountLine) => (skuMap[a.skuId]?.name || '').localeCompare(skuMap[b.skuId]?.name || ''),
    storage: (a: StockCountLine, b: StockCountLine) => (skuMap[a.skuId]?.storageCondition || '').localeCompare(skuMap[b.skuId]?.storageCondition || ''),
    systemQty: (a: StockCountLine, b: StockCountLine) => a.systemQty - b.systemQty,
    variance: (a: StockCountLine, b: StockCountLine) => a.variance - b.variance,
  }), [skuMap]);

  const { sorted: sortedLines, sortKey: scSortKey, sortDir: scSortDir, handleSort: scHandleSort } = useSortableTable(filteredLines, scComparators);

  const summary = useMemo(() => {
    const counted = sessionLines.filter(l => l.physicalQty !== null).length;
    const withVariance = sessionLines.filter(l => l.physicalQty !== null && l.variance !== 0).length;
    const totalVarianceValue = sessionLines
      .filter(l => l.physicalQty !== null && l.variance !== 0)
      .reduce((sum, l) => {
        const price = getStdUnitPrice(l.skuId);
        return sum + l.variance * price;
      }, 0);
    return { total: sessionLines.length, counted, withVariance, totalVarianceValue };
  }, [sessionLines, getStdUnitPrice]);

  const rmCount = useMemo(() => sessionLines.filter(l => l.type === 'RM').length, [sessionLines]);
  const smCount = useMemo(() => sessionLines.filter(l => l.type === 'SM').length, [sessionLines]);

  const varianceLines = useMemo(() => {
    return sessionLines.filter(l => l.physicalQty !== null && l.variance !== 0);
  }, [sessionLines]);

  const handleCreate = () => {
    if (!newDate) { toast.error('Date is required'); return; }
    const result = createSession(newDate, newNote);
    if (result instanceof Promise) {
      result.then(id => setSelectedSessionId(id));
    } else {
      setSelectedSessionId(result);
    }
    setCreateOpen(false);
    setNewNote('');
    toast.success('Stock count session created');
  };

  const handleConfirmAdjust = () => {
    if (!selectedSessionId) return;
    confirmSession(selectedSessionId);
    setConfirmOpen(false);
    toast.success('Stock adjustments applied and session locked');
  };

  const handleDelete = () => {
    if (!deleteConfirm) return;
    if (selectedSessionId === deleteConfirm) setSelectedSessionId(null);
    deleteSession(deleteConfirm);
    setDeleteConfirm(null);
    toast.success('Session deleted');
  };

  const thClass = 'text-left px-3 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wider';

  const renderCountTable = () => (
    <div className="rounded-lg border overflow-auto max-h-[65vh]">
      <table className="w-full text-sm">
        <thead className="sticky-thead">
          <tr className="border-b bg-muted/50">
            <th className={`${thClass} cursor-pointer hover:bg-muted/50`} onClick={() => scHandleSort('skuId')}>
              <SortableHeader label={t('col.skuId')} sortKey="skuId" activeSortKey={scSortKey} sortDir={scSortDir} onSort={scHandleSort} />
            </th>
            <th className={`${thClass} cursor-pointer hover:bg-muted/50`} onClick={() => scHandleSort('name')}>
              <SortableHeader label={t('col.name')} sortKey="name" activeSortKey={scSortKey} sortDir={scSortDir} onSort={scHandleSort} />
            </th>
            <th className={`${thClass} cursor-pointer hover:bg-muted/50`} onClick={() => scHandleSort('storage')}>
              <SortableHeader label={t('col.storage')} sortKey="storage" activeSortKey={scSortKey} sortDir={scSortDir} onSort={scHandleSort} />
            </th>
            <th className={`${thClass} text-right bg-muted/50 cursor-pointer hover:bg-muted/70`} onClick={() => scHandleSort('systemQty')}>
              <SortableHeader label="System Qty" sortKey="systemQty" activeSortKey={scSortKey} sortDir={scSortDir} onSort={scHandleSort} className="justify-end" />
            </th>
            <th className={`${thClass} text-right`}>
              <div>Physical Qty</div>
              <div className="text-[9px] font-normal text-muted-foreground">(Usage UOM)</div>
            </th>
            <th className={`${thClass} text-right cursor-pointer hover:bg-muted/50`} onClick={() => scHandleSort('variance')}>
              <SortableHeader label={t('col.variance')} sortKey="variance" activeSortKey={scSortKey} sortDir={scSortDir} onSort={scHandleSort} className="justify-end" />
            </th>
            <th className={thClass}>{t('col.note')}</th>
          </tr>
        </thead>
        <tbody>
          {filteredLines.length === 0 ? (
            <tr>
              <td colSpan={7} className="text-center py-10 text-muted-foreground">
                <Package className="w-8 h-8 mx-auto mb-2 opacity-40" />
                No {activeTab} SKUs match filters
              </td>
            </tr>
          ) : (
            sortedLines.map(line => {
              const sku = skuMap[line.skuId];
              if (!sku) return null;
              const hasVariance = line.physicalQty !== null && line.variance !== 0;
              return (
                <tr key={line.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-3 py-2 font-mono text-xs">{sku.skuId}</td>
                  <td className="px-3 py-2 text-xs font-medium">{sku.name}</td>
                  <td className="px-3 py-2 text-xs">{sku.storageCondition}</td>
                  <td className="px-3 py-2 text-right bg-muted/30 font-mono text-xs">
                    {line.systemQty.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    <span className="ml-0.5 text-[9px] text-muted-foreground">{sku.usageUom}</span>
                  </td>
                  <td className="px-1.5 py-1.5 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Input
                        type="number"
                        min={0}
                        step="any"
                        defaultValue={line.physicalQty ?? ''}
                        key={`phys-${line.id}-${line.physicalQty}`}
                        placeholder="—"
                        onBlur={e => {
                          const val = e.target.value === '' ? null : Number(e.target.value);
                          if (val !== line.physicalQty) updateLine(line.id, val);
                        }}
                        className="h-8 text-xs text-right w-[80px] font-mono"
                      />
                      <span className="text-[10px] text-muted-foreground w-6 text-left">{sku.usageUom}</span>
                    </div>
                  </td>
                  <td className={`px-3 py-2 text-right font-mono text-xs font-medium ${
                    !hasVariance ? 'text-muted-foreground' :
                    line.variance > 0 ? 'text-success' : 'text-destructive'
                  }`}>
                    {line.physicalQty === null ? '—' :
                      line.variance === 0 ? '0' :
                      (line.variance > 0 ? '+' : '') + line.variance.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-1.5 py-1.5">
                    <Input
                      defaultValue={line.note}
                      key={`note-${line.id}-${line.note}`}
                      placeholder="Optional"
                      onBlur={e => {
                        if (e.target.value !== line.note) updateLine(line.id, line.physicalQty, e.target.value);
                      }}
                      className="h-8 text-xs w-32"
                    />
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="page-title">{t('title.stockCount')}</h2>
          <p className="page-subtitle">Physical inventory counts and variance adjustments</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4" /> {t('btn.newCountSession')}
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-6">
        {/* Sessions List */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-1">{t('section.sessions')}</p>
          {sessions.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                <ClipboardCheck className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">No count sessions yet</p>
                <p className="text-xs mt-1">Create a new session to start counting</p>
              </CardContent>
            </Card>
          ) : (
            sessions.map(session => {
              const sLines = getLinesForSession(session.id);
              const counted = sLines.filter(l => l.physicalQty !== null).length;
              const isSelected = selectedSessionId === session.id;
              return (
                <Card
                  key={session.id}
                  className={`cursor-pointer transition-colors hover:border-primary/50 ${isSelected ? 'border-primary ring-1 ring-primary/20' : ''}`}
                  onClick={() => setSelectedSessionId(session.id)}
                >
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <p className="font-medium text-xs">{session.date}</p>
                          <Badge variant={session.status === 'Completed' ? 'default' : 'secondary'} className="text-[10px] px-1.5 py-0">
                            {session.status === 'Completed' ? <Lock className="w-2.5 h-2.5 mr-0.5" /> : null}
                            {session.status === 'Completed' ? t('status.completed') : t('status.draft')}
                          </Badge>
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{session.note || 'No note'}</p>
                        <p className="text-[10px] text-muted-foreground">{counted}/{sLines.length} counted</p>
                      </div>
                      <div className="flex items-center gap-0.5">
                        {session.status === 'Draft' && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6"
                            onClick={e => { e.stopPropagation(); setDeleteConfirm(session.id); }}
                          >
                            <Trash2 className="w-3 h-3 text-destructive" />
                          </Button>
                        )}
                        <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>

        {/* Count Sheet */}
        <div className="space-y-4">
          {!selectedSession ? (
            <Card>
              <CardContent className="py-16 text-center text-muted-foreground">
                <ClipboardCheck className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="font-medium">Select a session to view the count sheet</p>
                <p className="text-sm mt-1">Or create a new count session to begin</p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Session Info */}
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-sm">Count Date: {selectedSession.date}</p>
                      {selectedSession.note && <p className="text-xs text-muted-foreground">{selectedSession.note}</p>}
                    </div>
                    <Badge variant={isCompleted ? 'default' : 'secondary'} className="text-[10px] px-2 py-0.5">
                      {isCompleted ? <><Lock className="w-3 h-3 mr-1" /> Completed</> : 'Draft'}
                    </Badge>
                  </div>
                </CardContent>
              </Card>

              {/* Tabs for RM / SM */}
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <div className="flex items-center justify-between">
                  <TabsList>
                    <TabsTrigger value="RM" className="text-xs">RM ({rmCount})</TabsTrigger>
                    <TabsTrigger value="SM" className="text-xs">SM ({smCount})</TabsTrigger>
                  </TabsList>

                  <Select value={filterStorage} onValueChange={setFilterStorage}>
                    <SelectTrigger className="w-[130px] h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Storage</SelectItem>
                      {(['Frozen', 'Chilled', 'Ambient'] as StorageCondition[]).map(s => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <TabsContent value="RM" className="mt-3">
                  {renderCountTable()}
                </TabsContent>
                <TabsContent value="SM" className="mt-3">
                  {renderCountTable()}
                </TabsContent>
              </Tabs>

              {/* Summary */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">{t('summary.totalSkus')}</p>
                    <p className="text-2xl font-bold mt-1">{summary.total}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">{t('summary.counted')}</p>
                    <p className="text-2xl font-bold mt-1">{summary.counted}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">{t('summary.withVariance')}</p>
                    <p className={`text-2xl font-bold mt-1 ${summary.withVariance > 0 ? 'text-destructive' : ''}`}>{summary.withVariance}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">{t('summary.varianceValue')}</p>
                    <p className={`text-2xl font-bold mt-1 ${summary.totalVarianceValue < 0 ? 'text-destructive' : summary.totalVarianceValue > 0 ? 'text-success' : ''}`}>
                      ฿{summary.totalVarianceValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* Confirm Button */}
              {!isCompleted && (
                <div className="flex justify-end">
                  <Button
                    onClick={() => setConfirmOpen(true)}
                    disabled={summary.counted === 0}
                    className="gap-2"
                  >
                    <CheckCircle2 className="w-4 h-4" /> {t('btn.confirmAdjust')}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Create Session Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Stock Count Session</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Count Date *</label>
              <Input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium">Note</label>
              <Textarea value={newNote} onChange={e => setNewNote(e.target.value)} placeholder="e.g. Monthly physical inventory count" rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>{t('btn.cancel')}</Button>
            <Button onClick={handleCreate}>{t('btn.add')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm Adjustment Dialog */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-warning" /> Confirm Stock Adjustments
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              The following adjustments will be applied. This action cannot be undone.
            </p>
            {varianceLines.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">No variances found — no adjustments needed.</p>
            ) : (
              <div className="rounded-lg border overflow-auto max-h-[300px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>SKU</TableHead>
                      <TableHead className="text-right">System</TableHead>
                      <TableHead className="text-right">Physical</TableHead>
                      <TableHead className="text-right">Adjustment</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {varianceLines.map(line => {
                      const sku = skuMap[line.skuId];
                      return (
                        <TableRow key={line.id}>
                          <TableCell className="text-xs font-medium">{sku?.name ?? line.skuId}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{line.systemQty.toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{line.physicalQty?.toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
                          <TableCell className={`text-right font-mono text-xs font-medium ${line.variance > 0 ? 'text-success' : 'text-destructive'}`}>
                            {(line.variance > 0 ? '+' : '') + line.variance.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button onClick={handleConfirmAdjust}>
              <CheckCircle2 className="w-4 h-4 mr-1" /> Apply {varianceLines.length} Adjustments
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!deleteConfirm}
        onOpenChange={open => !open && setDeleteConfirm(null)}
        title="Delete Count Session"
        description="Are you sure you want to delete this draft session? This cannot be undone."
        confirmLabel="Delete"
        onConfirm={handleDelete}
      />
    </div>
  );
}
