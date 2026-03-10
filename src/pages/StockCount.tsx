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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
  const [filterType, setFilterType] = useState<string>('all');
  const [filterStorage, setFilterStorage] = useState<string>('all');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const selectedSession = sessions.find(s => s.id === selectedSessionId) ?? null;
  const sessionLines = selectedSessionId ? getLinesForSession(selectedSessionId) : [];
  const isReadOnly = selectedSession?.status === 'Completed';

  const skuMap = useMemo(() => {
    const m: Record<string, SKU> = {};
    skus.forEach(s => { m[s.id] = s; });
    return m;
  }, [skus]);

  const filteredLines = useMemo(() => {
    return sessionLines.filter(line => {
      const sku = skuMap[line.skuId];
      if (!sku) return false;
      if (filterType !== 'all' && line.type !== filterType) return false;
      if (filterStorage !== 'all' && sku.storageCondition !== filterStorage) return false;
      return true;
    });
  }, [sessionLines, skuMap, filterType, filterStorage]);

  const scComparators = useMemo(() => ({
    skuId: (a: StockCountLine, b: StockCountLine) => (skuMap[a.skuId]?.skuId || '').localeCompare(skuMap[b.skuId]?.skuId || ''),
    name: (a: StockCountLine, b: StockCountLine) => (skuMap[a.skuId]?.name || '').localeCompare(skuMap[b.skuId]?.name || ''),
    type: (a: StockCountLine, b: StockCountLine) => a.type.localeCompare(b.type),
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-heading font-bold">{t('title.stockCount')}</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Physical inventory counts and variance adjustments</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4" /> {t('btn.newCountSession')}
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6">
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
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-sm">{session.date}</p>
                          <Badge variant={session.status === 'Completed' ? 'default' : 'secondary'} className="text-[10px]">
                            {session.status === 'Completed' ? <Lock className="w-3 h-3 mr-1" /> : null}
                            {session.status === 'Completed' ? t('status.completed') : t('status.draft')}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">{session.note || 'No note'}</p>
                        <p className="text-xs text-muted-foreground mt-1">{counted}/{sLines.length} SKUs counted</p>
                      </div>
                      <div className="flex items-center gap-1">
                        {session.status === 'Draft' && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={e => { e.stopPropagation(); setDeleteConfirm(session.id); }}
                          >
                            <Trash2 className="w-3.5 h-3.5 text-destructive" />
                          </Button>
                        )}
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
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
                      <p className="font-medium">Count Date: {selectedSession.date}</p>
                      {selectedSession.note && <p className="text-sm text-muted-foreground">{selectedSession.note}</p>}
                    </div>
                    <Badge variant={isReadOnly ? 'default' : 'secondary'}>
                      {isReadOnly ? <><Lock className="w-3 h-3 mr-1" /> Completed</> : 'Draft'}
                    </Badge>
                  </div>
                </CardContent>
              </Card>

              {/* Filters */}
              <div className="flex flex-wrap items-center gap-3">
                <Select value={filterType} onValueChange={setFilterType}>
                  <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    <SelectItem value="RM">RM</SelectItem>
                    <SelectItem value="SM">SM</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={filterStorage} onValueChange={setFilterStorage}>
                  <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Storage</SelectItem>
                    {(['Frozen', 'Chilled', 'Ambient'] as StorageCondition[]).map(s => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Count Table */}
              <div className="rounded-lg border overflow-auto max-h-[70vh]">
                <Table>
                  <TableHeader className="sticky-thead">
                    <TableRow>
                      <TableHead className="cursor-pointer hover:bg-muted/50" onClick={() => scHandleSort('skuId')}>
                        <SortableHeader label={t('col.skuId')} sortKey="skuId" activeSortKey={scSortKey} sortDir={scSortDir} onSort={scHandleSort} />
                      </TableHead>
                      <TableHead className="cursor-pointer hover:bg-muted/50" onClick={() => scHandleSort('name')}>
                        <SortableHeader label={t('col.name')} sortKey="name" activeSortKey={scSortKey} sortDir={scSortDir} onSort={scHandleSort} />
                      </TableHead>
                      <TableHead className="cursor-pointer hover:bg-muted/50" onClick={() => scHandleSort('type')}>
                        <SortableHeader label={t('col.type')} sortKey="type" activeSortKey={scSortKey} sortDir={scSortDir} onSort={scHandleSort} />
                      </TableHead>
                      <TableHead className="cursor-pointer hover:bg-muted/50" onClick={() => scHandleSort('storage')}>
                        <SortableHeader label={t('col.storage')} sortKey="storage" activeSortKey={scSortKey} sortDir={scSortDir} onSort={scHandleSort} />
                      </TableHead>
                      <TableHead className="text-right bg-muted/50 cursor-pointer hover:bg-muted/70" onClick={() => scHandleSort('systemQty')}>
                        <SortableHeader label={t('col.systemQty')} sortKey="systemQty" activeSortKey={scSortKey} sortDir={scSortDir} onSort={scHandleSort} className="justify-end" />
                      </TableHead>
                      <TableHead className="text-right">{t('col.physicalQty')}</TableHead>
                      <TableHead className="text-right cursor-pointer hover:bg-muted/50" onClick={() => scHandleSort('variance')}>
                        <SortableHeader label={t('col.variance')} sortKey="variance" activeSortKey={scSortKey} sortDir={scSortDir} onSort={scHandleSort} className="justify-end" />
                      </TableHead>
                      <TableHead>{t('col.note')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredLines.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center py-10 text-muted-foreground">
                          <Package className="w-8 h-8 mx-auto mb-2 opacity-40" />
                          No SKUs match filters
                        </TableCell>
                      </TableRow>
                    ) : (
                      sortedLines.map(line => {
                        const sku = skuMap[line.skuId];
                        if (!sku) return null;
                        const hasVariance = line.physicalQty !== null && line.variance !== 0;
                        return (
                          <TableRow key={line.id}>
                            <TableCell className="font-mono text-xs">{sku.skuId}</TableCell>
                            <TableCell className="font-medium">{sku.name}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-[10px]">{line.type}</Badge>
                            </TableCell>
                            <TableCell className="text-xs">{sku.storageCondition}</TableCell>
                            <TableCell className="text-right bg-muted/30 font-mono">
                              {line.systemQty.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                            </TableCell>
                            <TableCell className="text-right">
                              {isReadOnly ? (
                                <span className="font-mono">
                                  {line.physicalQty !== null ? line.physicalQty.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}
                                </span>
                              ) : (
                                <Input
                                  type="number"
                                  className="w-24 h-7 text-xs text-right ml-auto"
                                  value={line.physicalQty ?? ''}
                                  placeholder="—"
                                  onChange={e => {
                                    const val = e.target.value === '' ? null : Number(e.target.value);
                                    updateLine(line.id, val);
                                  }}
                                />
                              )}
                            </TableCell>
                            <TableCell className={`text-right font-mono font-medium ${
                              !hasVariance ? 'text-muted-foreground' :
                              line.variance > 0 ? 'text-success' : 'text-destructive'
                            }`}>
                              {line.physicalQty === null ? '—' :
                                line.variance === 0 ? '0' :
                                (line.variance > 0 ? '+' : '') + line.variance.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                            </TableCell>
                            <TableCell>
                              {isReadOnly ? (
                                <span className="text-xs text-muted-foreground">{line.note || '—'}</span>
                              ) : (
                                <Input
                                  className="h-7 text-xs w-32"
                                  value={line.note}
                                  placeholder="Optional"
                                  onChange={e => updateLine(line.id, line.physicalQty, e.target.value)}
                                />
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>

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
              {!isReadOnly && (
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
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate}>Create Session</Button>
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
