import { useState, useRef, useCallback, useMemo } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useTransferRequest, TRHistoryRow, TRDetailLine } from '@/hooks/use-transfer-request';
import { useBranchData } from '@/hooks/use-branch-data';
import { BranchSmStockStatus } from '@/hooks/use-branch-sm-stock';
import { DatePicker } from '@/components/ui/date-picker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusDot, StatusDotStatus } from '@/components/ui/status-dot';
import { UnitLabel } from '@/components/ui/unit-label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { typography, table as tableTokens, formatNumber } from '@/lib/design-tokens';
import { toLocalDateStr } from '@/lib/utils';
import { Plus, Eye, Printer, Ban } from 'lucide-react';
import { toast } from 'sonner';

const stockStatusToDot: Record<BranchSmStockStatus, StatusDotStatus> = {
  critical: 'red',
  low: 'amber',
  sufficient: 'green',
  'no-data': 'red',
};

const trStatusBadge: Record<string, string> = {
  Draft: 'bg-muted text-muted-foreground',
  Submitted: 'bg-warning/15 text-warning border border-warning/30',
  Acknowledged: 'bg-primary/15 text-primary border border-primary/30',
  Fulfilled: 'bg-success/15 text-success border border-success/30',
  Cancelled: 'bg-destructive/15 text-destructive border border-destructive/30',
};

export default function TransferRequestPage() {
  const { profile, role, isManagement, isStoreManager, isAreaManager, isCkManager, brandAssignments } = useAuth();
  const branchId = profile?.branch_id || null;
  const { branches } = useBranchData();

  // Get profile ID from profiles
  const [profileId, setProfileId] = useState<string | null>(null);
  // Lazy load profile id
  useState(() => {
    if (profile && branchId) {
      import('@/integrations/supabase/client').then(({ supabase }) => {
        supabase.from('profiles').select('id').eq('branch_id', branchId).limit(1).maybeSingle()
          .then(({ data }) => { if (data) setProfileId(data.id); });
      });
    }
  });

  const {
    lines, updateLineQty, isLoading,
    requiredDate, setRequiredDate,
    notes, setNotes,
    submitTR, canSubmit, itemsToOrder,
    history, historyLoading, fetchHistory,
    fetchTRDetail, cancelTR,
  } = useTransferRequest(isStoreManager ? branchId : null, profileId);

  const [formOpen, setFormOpen] = useState(false);
  const [sortMode, setSortMode] = useState<'code' | 'priority'>('code');

  const statusOrder: Record<string, number> = { critical: 0, low: 1, sufficient: 2, 'no-data': 3 };

  const sortedLines = useMemo(() => {
    const arr = [...lines];
    if (sortMode === 'priority') {
      arr.sort((a, b) => {
        const sa = statusOrder[a.status] ?? 9;
        const sb = statusOrder[b.status] ?? 9;
        if (sa !== sb) return sa - sb;
        return a.skuCode.localeCompare(b.skuCode);
      });
    } else {
      arr.sort((a, b) => a.skuCode.localeCompare(b.skuCode));
    }
    return arr;
  }, [lines, sortMode]);
  const [submitting, setSubmitting] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailTR, setDetailTR] = useState<TRHistoryRow | null>(null);
  const [detailLines, setDetailLines] = useState<TRDetailLine[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  // History filters
  const [filterBranch, setFilterBranch] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('All');
  const [filterFrom, setFilterFrom] = useState<Date | undefined>(undefined);
  const [filterTo, setFilterTo] = useState<Date | undefined>(undefined);

  const branchName = useMemo(() => {
    if (!branchId) return '';
    return branches.find(b => b.id === branchId)?.branchName || '';
  }, [branchId, branches]);

  // Filter branches for area manager
  const visibleBranches = useMemo(() => {
    if (isManagement) return branches;
    if (isAreaManager) return branches.filter(b => brandAssignments.includes(b.brandName));
    return branches;
  }, [branches, isManagement, isAreaManager, brandAssignments]);

  const tomorrow = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }, []);

  const handleSubmit = useCallback(async () => {
    setSubmitting(true);
    const result = await submitTR();
    setSubmitting(false);
    if ('error' in result) {
      toast.error(result.error);
    } else {
      toast.success(`Transfer Request ${result.trNumber} submitted`);
      setFormOpen(false);
    }
  }, [submitTR]);

  const handleViewDetail = useCallback(async (tr: TRHistoryRow) => {
    setDetailTR(tr);
    setDetailOpen(true);
    setDetailLoading(true);
    const lines = await fetchTRDetail(tr.id);
    setDetailLines(lines);
    setDetailLoading(false);
  }, [fetchTRDetail]);

  const handleFilterApply = useCallback(() => {
    fetchHistory({
      branchId: filterBranch || undefined,
      status: filterStatus,
      dateFrom: filterFrom ? toLocalDateStr(filterFrom) : undefined,
      dateTo: filterTo ? toLocalDateStr(filterTo) : undefined,
    });
  }, [fetchHistory, filterBranch, filterStatus, filterFrom, filterTo]);

  // Tab key navigation for REQUEST QTY inputs
  const qtyInputRefs = useRef<Record<string, HTMLInputElement>>({});

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className={typography.pageTitle}>Transfer Request</h2>
          <p className="text-sm text-muted-foreground">Request SM ingredients from Central Kitchen</p>
        </div>
        {isStoreManager && !formOpen && (
          <Button onClick={() => setFormOpen(true)} className="h-9">
            <Plus className="w-4 h-4 mr-1" /> New TR
          </Button>
        )}
      </div>

      {/* ─── TR Creation Form ─── */}
      {isStoreManager && formOpen && (
        <div className="rounded-lg border bg-card p-6 space-y-4">
          {/* Metadata row */}
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">Branch</label>
              <div className="h-10 px-3 py-2 rounded-md border border-input bg-muted/30 text-sm min-w-[200px] flex items-center">
                {branchName || 'Not assigned'}
              </div>
            </div>
            <DatePicker
              value={requiredDate}
              onChange={setRequiredDate}
              label="Required Date"
              required
              labelPosition="above"
              minDate={tomorrow}
              placeholder="Select date"
            />
            <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
              <label className="text-sm text-muted-foreground">Notes</label>
              <Input
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Optional notes..."
                className="h-10"
              />
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setFormOpen(false)}>Cancel</Button>
              <Button onClick={handleSubmit} disabled={!canSubmit || submitting}>
                {submitting ? 'Submitting...' : 'Submit TR'}
              </Button>
            </div>
          </div>

          {/* SKU Sheet */}
          <div className="flex items-end justify-between">
            <div>
              <p className="text-sm font-semibold">SM Items for {branchName}</p>
              <p className="text-xs text-muted-foreground">Pre-loaded from active menus. Adjust quantities as needed.</p>
            </div>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setSortMode('code')}
                className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${
                  sortMode === 'code'
                    ? 'bg-primary text-primary-foreground'
                    : 'border border-input text-muted-foreground hover:bg-accent'
                }`}
              >
                Sort by Code
              </button>
              <button
                type="button"
                onClick={() => setSortMode('priority')}
                className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${
                  sortMode === 'priority'
                    ? 'bg-primary text-primary-foreground'
                    : 'border border-input text-muted-foreground hover:bg-accent'
                }`}
              >
                Sort by Priority
              </button>
            </div>
          </div>

          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground text-sm">Loading SM items...</div>
          ) : lines.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">No SM SKUs found for this branch's menus.</div>
          ) : (
            <>
              <div className={tableTokens.wrapper}>
                <table className={tableTokens.base}>
                  <colgroup>
                    <col style={{ width: 40 }} />
                    <col style={{ width: 100 }} />
                    <col />
                    <col style={{ width: 90 }} />
                    <col style={{ width: 80 }} />
                    <col style={{ width: 90 }} />
                    <col style={{ width: 110 }} />
                    <col style={{ width: 110 }} />
                    <col style={{ width: 60 }} />
                  </colgroup>
                  <thead>
                    <tr className={tableTokens.headerRow}>
                      <th className={`${tableTokens.headerCell} text-center`}></th>
                      <th className={tableTokens.headerCell}>SKU CODE</th>
                      <th className={tableTokens.headerCell}>SKU NAME</th>
                      <th className={`${tableTokens.headerCell} text-right`}>STOCK NOW</th>
                      <th className={`${tableTokens.headerCell} text-right`}>ROP</th>
                      <th className={`${tableTokens.headerCell} text-right`}>PARSTOCK</th>
                      <th className={`${tableTokens.headerCell} text-right`}>SUGGESTED</th>
                      <th className={`${tableTokens.headerCell} text-right`}>REQUEST QTY</th>
                      <th className={`${tableTokens.headerCell} text-center`}>UOM</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedLines.map((line, idx) => {
                      const isSufficient = line.status === 'sufficient';
                      const isNoData = line.status === 'no-data';
                      const dotStatus: StatusDotStatus | undefined = isNoData ? undefined : stockStatusToDot[line.status];

                      return (
                        <tr
                          key={line.skuId}
                          className={`${tableTokens.dataRow} ${isSufficient ? 'opacity-60' : ''}`}
                        >
                          <td className={`${tableTokens.dataCell} text-center`}>
                            {dotStatus ? (
                              <StatusDot status={dotStatus} size="sm" />
                            ) : (
                              <span className="inline-block w-2 h-2 rounded-full bg-muted" />
                            )}
                          </td>
                          <td className={`${tableTokens.dataCell} font-mono text-xs`}>{line.skuCode}</td>
                          <td className={`${tableTokens.truncatedCell}`} title={line.skuName}>{line.skuName}</td>
                          <td className={tableTokens.dataCellMono}>{formatNumber(line.stockOnHand, 1)}</td>
                          <td className={`${tableTokens.dataCellMono} text-muted-foreground`}>{formatNumber(line.rop, 1)}</td>
                          <td className={`${tableTokens.dataCellMono} text-muted-foreground`}>{formatNumber(line.parstock, 1)}</td>
                          <td className={`${tableTokens.dataCellMono} text-primary font-medium`}>
                            {isNoData ? '—' : formatNumber(line.suggestedQty, 1)}
                          </td>
                          <td className={`${tableTokens.dataCell} text-right`}>
                            <input
                              ref={el => { if (el) qtyInputRefs.current[line.skuId] = el; }}
                              type="number"
                              inputMode="decimal"
                              min={0}
                              defaultValue={line.requestedQty || ''}
                              onBlur={e => updateLineQty(line.skuId, Number(e.target.value) || 0)}
                              onKeyDown={e => {
                                if (e.key === 'Tab') {
                                  e.preventDefault();
                                  const nextIdx = e.shiftKey ? idx - 1 : idx + 1;
                                  if (nextIdx >= 0 && nextIdx < lines.length) {
                                    const nextSkuId = lines[nextIdx].skuId;
                                    qtyInputRefs.current[nextSkuId]?.focus();
                                    qtyInputRefs.current[nextSkuId]?.select();
                                  }
                                }
                              }}
                              className="h-8 w-full text-sm font-mono text-right px-2 rounded-md border border-input bg-amber-50 focus:border-ring focus:ring-0 focus:outline-none"
                            />
                          </td>
                          <td className={`${tableTokens.dataCell} text-center`}>
                            <UnitLabel unit={line.uom} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-end gap-4">
                <span className="text-sm text-muted-foreground">
                  Items to order: <span className="font-semibold text-foreground">{itemsToOrder}</span>
                </span>
                <Button onClick={handleSubmit} disabled={!canSubmit || submitting}>
                  {submitting ? 'Submitting...' : 'Submit TR'}
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ─── TR History ─── */}
      <div className="space-y-3">
        <h3 className={typography.sectionTitle}>TR History</h3>

        {/* Filters */}
        <div className="flex flex-wrap items-end gap-3">
          {(isManagement || isAreaManager || isCkManager) && (
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">Branch</label>
              <Select value={filterBranch} onValueChange={v => { setFilterBranch(v === '__all__' ? '' : v); }}>
                <SelectTrigger className="w-[200px] h-9">
                  <SelectValue placeholder="All branches" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All branches</SelectItem>
                  {visibleBranches.map(b => (
                    <SelectItem key={b.id} value={b.id}>{b.branchName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="flex flex-col gap-1">
            <label className="text-sm text-muted-foreground">Status</label>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-[160px] h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {['All', 'Draft', 'Submitted', 'Acknowledged', 'Fulfilled', 'Cancelled'].map(s => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DatePicker value={filterFrom} onChange={setFilterFrom} label="From" labelPosition="above" placeholder="From" />
          <DatePicker value={filterTo} onChange={setFilterTo} label="To" labelPosition="above" placeholder="To" />
          <Button variant="outline" className="h-9" onClick={handleFilterApply}>Filter</Button>
        </div>

        {/* History table */}
        <div className={tableTokens.wrapper}>
          <table className={tableTokens.base}>
            <colgroup>
              <col style={{ width: 150 }} />
              <col style={{ width: 110 }} />
              <col style={{ width: 110 }} />
              <col />
              <col style={{ width: 70 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 100 }} />
            </colgroup>
            <thead>
              <tr className={tableTokens.headerRow}>
                <th className={tableTokens.headerCell}>TR NUMBER</th>
                <th className={tableTokens.headerCell}>DATE</th>
                <th className={tableTokens.headerCell}>REQUIRED DATE</th>
                <th className={tableTokens.headerCell}>BRANCH</th>
                <th className={`${tableTokens.headerCell} text-right`}>ITEMS</th>
                <th className={tableTokens.headerCell}>STATUS</th>
                <th className={`${tableTokens.headerCell} text-center`}>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {historyLoading ? (
                <tr><td colSpan={7} className="text-center py-8 text-muted-foreground text-sm">Loading...</td></tr>
              ) : history.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-8 text-muted-foreground text-sm">No transfer requests found.</td></tr>
              ) : history.map(tr => (
                <tr key={tr.id} className={tableTokens.dataRow}>
                  <td className={`${tableTokens.dataCell} font-mono text-xs cursor-pointer text-primary hover:underline`}
                    onClick={() => handleViewDetail(tr)}>
                    {tr.trNumber}
                  </td>
                  <td className={tableTokens.dataCell}>{tr.requestedDate}</td>
                  <td className={tableTokens.dataCell}>{tr.requiredDate}</td>
                  <td className={tableTokens.truncatedCell} title={tr.branchName}>{tr.branchName}</td>
                  <td className={tableTokens.dataCellMono}>{tr.itemCount}</td>
                  <td className={tableTokens.dataCell}>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${trStatusBadge[tr.status] || ''}`}>
                      {tr.status}
                    </span>
                  </td>
                  <td className={`${tableTokens.dataCell} text-center`}>
                    <div className="flex items-center justify-center gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleViewDetail(tr)} title="View">
                        <Eye className="w-4 h-4" />
                      </Button>
                      {isManagement && tr.status !== 'Cancelled' && tr.status !== 'Fulfilled' && (
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => cancelTR(tr.id)} title="Cancel">
                          <Ban className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ─── TR Detail Modal ─── */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto print:max-w-full print:max-h-full print:overflow-visible">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <span className="font-mono">{detailTR?.trNumber}</span>
              {detailTR && (
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${trStatusBadge[detailTR.status] || ''}`}>
                  {detailTR.status}
                </span>
              )}
            </DialogTitle>
          </DialogHeader>

          {detailTR && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Branch: </span>
                  <span className="font-medium">{detailTR.branchName}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Requested: </span>
                  <span>{detailTR.requestedDate}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Required: </span>
                  <span>{detailTR.requiredDate}</span>
                </div>
                {detailTR.notes && (
                  <div className="col-span-2">
                    <span className="text-muted-foreground">Notes: </span>
                    <span>{detailTR.notes}</span>
                  </div>
                )}
              </div>

              {detailLoading ? (
                <div className="text-center py-6 text-muted-foreground text-sm">Loading lines...</div>
              ) : (
                <div className={tableTokens.wrapper}>
                  <table className={tableTokens.base}>
                    <colgroup>
                      <col style={{ width: 100 }} />
                      <col />
                      <col style={{ width: 90 }} />
                      <col style={{ width: 90 }} />
                      <col style={{ width: 80 }} />
                      <col style={{ width: 90 }} />
                      <col style={{ width: 60 }} />
                    </colgroup>
                    <thead>
                      <tr className={tableTokens.headerRow}>
                        <th className={tableTokens.headerCell}>SKU CODE</th>
                        <th className={tableTokens.headerCell}>SKU NAME</th>
                        <th className={`${tableTokens.headerCell} text-right`}>STOCK*</th>
                        <th className={`${tableTokens.headerCell} text-right`}>SUGGESTED</th>
                        <th className={`${tableTokens.headerCell} text-right`}>ROP</th>
                        <th className={`${tableTokens.headerCell} text-right`}>REQUESTED</th>
                        <th className={`${tableTokens.headerCell} text-center`}>UOM</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detailLines.map(l => (
                        <tr key={l.id} className={tableTokens.dataRow}>
                          <td className={`${tableTokens.dataCell} font-mono text-xs`}>{l.skuCode}</td>
                          <td className={tableTokens.truncatedCell} title={l.skuName}>{l.skuName}</td>
                          <td className={tableTokens.dataCellMono}>{formatNumber(l.stockOnHand, 1)}</td>
                          <td className={`${tableTokens.dataCellMono} text-muted-foreground`}>{formatNumber(l.suggestedQty, 1)}</td>
                          <td className={`${tableTokens.dataCellMono} text-muted-foreground`}>{formatNumber(l.rop, 1)}</td>
                          <td className={`${tableTokens.dataCellMono} font-medium`}>{formatNumber(l.requestedQty, 1)}</td>
                          <td className={`${tableTokens.dataCell} text-center`}>
                            <UnitLabel unit={l.uom} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <p className="text-xs text-muted-foreground">* Stock on hand at time of request</p>

              <div className="flex justify-end print:hidden">
                <Button variant="outline" onClick={() => window.print()}>
                  <Printer className="w-4 h-4 mr-1" /> Print
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
