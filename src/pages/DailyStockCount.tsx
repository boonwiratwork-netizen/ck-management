import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useDailyStockCount, DailyStockCountRow } from '@/hooks/use-daily-stock-count';
import { useAuth } from '@/hooks/use-auth';
import { SKU } from '@/types/sku';
import { MenuBomLine } from '@/types/menu-bom';
import { ModifierRule } from '@/types/modifier-rule';
import { SpBomLine } from '@/types/sp-bom';
import { Menu } from '@/types/menu';
import { Branch } from '@/types/branch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SkeletonTable } from '@/components/SkeletonTable';
import { EmptyState } from '@/components/EmptyState';
import { ClipboardCheck, Loader2, Lock, Unlock, CheckCircle2, ChevronDown, ChevronUp, PartyPopper, ClipboardList } from 'lucide-react';
import { toast } from 'sonner';

interface DailyStockCountPageProps {
  skus: SKU[];
  menuBomLines: MenuBomLine[];
  modifierRules: ModifierRule[];
  spBomLines: SpBomLine[];
  menus: Menu[];
  branches: Branch[];
}

export default function DailyStockCountPage({
  skus, menuBomLines, modifierRules, spBomLines, menus, branches,
}: DailyStockCountPageProps) {
  const { isManagement, isStoreManager, profile } = useAuth();
  const today = new Date().toISOString().slice(0, 10);

  const [selectedDate, setSelectedDate] = useState(today);
  const [selectedBranch, setSelectedBranch] = useState<string>(
    isStoreManager && profile?.branch_id ? profile.branch_id : ''
  );
  const [showUnused, setShowUnused] = useState(false);
  const [justSubmitted, setJustSubmitted] = useState(false);
  const physicalCountRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  const {
    rows, loading, generating,
    loadSheet, generateSheet, updatePhysicalCount,
    submitSheet, unlockSheet,
  } = useDailyStockCount({ skus, menuBomLines, modifierRules, spBomLines, menus, branches });

  const availableBranches = useMemo(() => {
    if (isManagement) return branches.filter(b => b.status === 'Active');
    if (isStoreManager && profile?.branch_id) return branches.filter(b => b.id === profile.branch_id);
    return branches.filter(b => b.status === 'Active');
  }, [branches, isManagement, isStoreManager, profile]);

  useEffect(() => {
    if (selectedBranch && selectedDate) {
      loadSheet(selectedBranch, selectedDate);
    }
  }, [selectedBranch, selectedDate, loadSheet]);

  const skuMap = useMemo(() => {
    const m = new Map<string, SKU>();
    skus.forEach(s => m.set(s.id, s));
    return m;
  }, [skus]);

  const isSubmitted = rows.length > 0 && rows[0]?.isSubmitted;

  const handleGenerate = useCallback(() => {
    if (!selectedBranch) return;
    generateSheet(selectedBranch, selectedDate);
  }, [selectedBranch, selectedDate, generateSheet]);

  const handleSubmit = useCallback(async () => {
    await submitSheet(selectedBranch, selectedDate);
    setJustSubmitted(true);
    setTimeout(() => setJustSubmitted(false), 3000);
  }, [selectedBranch, selectedDate, submitSheet]);

  const handleUnlock = useCallback(() => {
    unlockSheet(selectedBranch, selectedDate);
  }, [selectedBranch, selectedDate, unlockSheet]);

  // Variance color based on percentage thresholds
  const getVarianceClass = (variance: number, physicalCount: number | null, calculatedBalance: number) => {
    if (physicalCount === null) return 'var-neutral';
    if (variance === 0) return 'var-neutral';
    const pct = calculatedBalance !== 0 ? (variance / calculatedBalance) * 100 : 0;
    if (variance < 0) {
      // Negative variance = physical > calculated = good
      if (Math.abs(pct) >= 10) return 'var-great';
      return 'var-good';
    } else {
      // Positive variance = physical < calculated = loss
      if (pct >= 10) return 'var-major-loss';
      return 'var-minor-loss';
    }
  };

  // Sort and separate active vs unused rows
  const { activeRows, unusedRows } = useMemo(() => {
    const sorted = [...rows].sort((a, b) => {
      const skuA = skuMap.get(a.skuId);
      const skuB = skuMap.get(b.skuId);
      if (!skuA || !skuB) return 0;
      if (skuA.type !== skuB.type) return skuA.type < skuB.type ? -1 : 1;
      return skuA.skuId.localeCompare(skuB.skuId);
    });

    const active: typeof sorted = [];
    const unused: typeof sorted = [];

    sorted.forEach(row => {
      const isUnused = row.openingBalance === 0 && row.receivedFromCk === 0 && 
        row.receivedExternal === 0 && row.expectedUsage === 0 && row.physicalCount === null;
      if (isUnused) unused.push(row);
      else active.push(row);
    });

    return { activeRows: active, unusedRows: unused };
  }, [rows, skuMap]);

  const hasAnyPhysicalCount = rows.some(r => r.physicalCount !== null);

  // Auto-advance to next row's physical count on Enter
  const handlePhysicalCountKeyDown = (e: React.KeyboardEvent, rowId: string, index: number) => {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      const nextRow = activeRows[index + 1];
      if (nextRow) {
        const nextRef = physicalCountRefs.current.get(nextRow.id);
        if (nextRef) nextRef.focus();
      }
    }
  };

  const setRef = (id: string, el: HTMLInputElement | null) => {
    if (el) physicalCountRefs.current.set(id, el);
    else physicalCountRefs.current.delete(id);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-heading font-bold">Daily Stock Count</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Generate and manage daily stock count sheets for each branch
        </p>
      </div>

      {/* Controls */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="text-xs text-muted-foreground label-required">Date</label>
              <Input
                type="date"
                value={selectedDate}
                onChange={e => setSelectedDate(e.target.value)}
                className="w-44"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground label-required">Branch</label>
              <Select value={selectedBranch} onValueChange={setSelectedBranch}>
                <SelectTrigger className="w-56">
                  <SelectValue placeholder="Select branch" />
                </SelectTrigger>
                <SelectContent>
                  {availableBranches.map(b => (
                    <SelectItem key={b.id} value={b.id}>{b.branchName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={handleGenerate}
              disabled={!selectedBranch || generating}
            >
              {generating ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Generating...</>
              ) : (
                <><ClipboardCheck className="w-4 h-4" /> Generate Count Sheet</>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Submitted banner */}
      {isSubmitted && (
        <div className="flex items-center justify-between bg-success/5 border border-success/20 rounded-lg px-4 py-3">
          <div className="flex items-center gap-2 text-success">
            <CheckCircle2 className="w-5 h-5" />
            <span className="font-medium">Submitted</span>
            <span className="text-sm opacity-80">
              — {rows[0]?.submittedAt ? new Date(rows[0].submittedAt).toLocaleString() : ''}
            </span>
          </div>
          {isManagement && (
            <Button variant="outline" size="sm" onClick={handleUnlock}>
              <Unlock className="w-4 h-4" /> Unlock
            </Button>
          )}
        </div>
      )}

      {/* Celebration */}
      {justSubmitted && (
        <div className="flex items-center justify-center gap-2 text-success py-4 animate-in fade-in duration-500">
          <PartyPopper className="w-6 h-6" />
          <span className="font-medium text-lg">Great job! Daily count submitted! 🎉</span>
        </div>
      )}

      {/* Count sheet table */}
      {loading ? (
        <SkeletonTable columns={10} rows={12} />
      ) : rows.length > 0 ? (
        <>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-auto max-h-[70vh]">
                <div className="px-4 py-2 border-b bg-muted/30">
                  <p className="kbd-hint">
                    <kbd>Tab</kbd> / <kbd>Enter</kbd> to advance to next row · Physical Count auto-selects on focus
                  </p>
                </div>
                <Table>
                  <TableHeader className="sticky-thead">
                    <TableRow className="bg-table-header">
                      <TableHead className="table-header whitespace-nowrap">SKU Code</TableHead>
                      <TableHead className="table-header">SKU Name</TableHead>
                      <TableHead className="table-header">Type</TableHead>
                      <TableHead className="text-right table-header">Opening</TableHead>
                      <TableHead className="text-right table-header whitespace-nowrap">From CK</TableHead>
                      <TableHead className="text-right table-header whitespace-nowrap">
                        <div>Ext. Received</div>
                        <div className="text-[10px] font-normal text-muted-foreground">(Purchase UOM)</div>
                      </TableHead>
                      <TableHead className="text-right table-header whitespace-nowrap">
                        <div>Exp. Usage</div>
                        <div className="text-[10px] font-normal text-muted-foreground">(Usage UOM)</div>
                      </TableHead>
                      <TableHead className="text-right table-header whitespace-nowrap">
                        <div>Calc. Balance</div>
                        <div className="text-[10px] font-normal text-muted-foreground">(Usage UOM)</div>
                      </TableHead>
                      <TableHead className="text-right table-header whitespace-nowrap">
                        <div>Physical Count</div>
                        <div className="text-[10px] font-normal text-muted-foreground">(Purchase UOM)</div>
                      </TableHead>
                      <TableHead className="text-right table-header">Variance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activeRows.map((row, idx) => {
                      const sku = skuMap.get(row.skuId);
                      if (!sku) return null;
                      const varClass = getVarianceClass(row.variance, row.physicalCount, row.calculatedBalance);

                      return (
                        <TableRow key={row.id} className={`table-row-hover ${idx % 2 === 1 ? 'bg-table-alt' : ''}`}>
                          <TableCell className="font-mono text-xs">{sku.skuId}</TableCell>
                          <TableCell className="max-w-[180px] truncate">{sku.name}</TableCell>
                          <TableCell>
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                              sku.type === 'RM' ? 'badge-rm' : sku.type === 'SM' ? 'badge-sm' : sku.type === 'SP' ? 'badge-sp' : 'badge-pk'
                            }`}>
                              {sku.type}
                            </span>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{row.openingBalance.toFixed(2)}</TableCell>
                          <TableCell className="text-right tabular-nums">{row.receivedFromCk.toFixed(2)}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {row.receivedExternal.toFixed(2)}
                            <span className="ml-1 text-[10px] text-muted-foreground">{sku.purchaseUom}</span>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {row.expectedUsage.toFixed(2)}
                            <span className="ml-1 text-[10px] text-muted-foreground">{sku.usageUom}</span>
                          </TableCell>
                          <TableCell className="text-right tabular-nums font-medium">
                            {row.calculatedBalance.toFixed(2)}
                            <span className="ml-1 text-[10px] text-muted-foreground">{sku.usageUom}</span>
                          </TableCell>
                          <TableCell className="text-right w-32">
                            {isSubmitted ? (
                              <span className="tabular-nums">
                                {row.physicalCount !== null ? row.physicalCount.toFixed(2) : '—'}
                                <span className="ml-1 text-[10px] text-muted-foreground">{sku.purchaseUom}</span>
                              </span>
                            ) : (
                              <div className="flex items-center justify-end gap-1">
                                <Input
                                  ref={(el) => setRef(row.id, el)}
                                  type="number"
                                  step="0.01"
                                  value={row.physicalCount !== null ? row.physicalCount : ''}
                                  onChange={e => {
                                    const val = e.target.value === '' ? null : Number(e.target.value);
                                    updatePhysicalCount(row.id, val);
                                  }}
                                  onKeyDown={e => handlePhysicalCountKeyDown(e, row.id, idx)}
                                  className="h-9 w-24 text-sm font-medium border-2 border-input focus:border-primary"
                                  placeholder="—"
                                />
                                <span className="text-[10px] text-muted-foreground whitespace-nowrap">{sku.purchaseUom}</span>
                              </div>
                            )}
                          </TableCell>
                          <TableCell className={`text-right tabular-nums font-medium rounded px-2 ${varClass}`}>
                            {row.physicalCount !== null ? row.variance.toFixed(2) : '—'}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Unused SKUs toggle */}
          {unusedRows.length > 0 && (
            <button
              type="button"
              onClick={() => setShowUnused(!showUnused)}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {showUnused ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              {showUnused ? 'Hide' : 'Show'} unused SKUs ({unusedRows.length})
            </button>
          )}

          {showUnused && unusedRows.length > 0 && (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-auto max-h-[50vh]">
                  <Table>
                    <TableHeader className="sticky-thead">
                      <TableRow className="bg-table-header">
                        <TableHead className="table-header">SKU Code</TableHead>
                        <TableHead className="table-header">SKU Name</TableHead>
                        <TableHead className="table-header">Type</TableHead>
                        <TableHead className="text-right table-header">Physical Count</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {unusedRows.map(row => {
                        const sku = skuMap.get(row.skuId);
                        if (!sku) return null;
                        return (
                          <TableRow key={row.id} className="text-muted-foreground">
                            <TableCell className="font-mono text-xs">{sku.skuId}</TableCell>
                            <TableCell>{sku.name}</TableCell>
                            <TableCell>
                              <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                sku.type === 'RM' ? 'badge-rm' : 'badge-sm'
                              }`}>{sku.type}</span>
                            </TableCell>
                            <TableCell className="text-right w-28">
                              {!isSubmitted && (
                                <Input
                                  type="number"
                                  step="0.01"
                                  value={row.physicalCount !== null ? row.physicalCount : ''}
                                  onChange={e => {
                                    const val = e.target.value === '' ? null : Number(e.target.value);
                                    updatePhysicalCount(row.id, val);
                                  }}
                                  className="h-8 w-24 text-sm"
                                  placeholder="—"
                                />
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      ) : selectedBranch ? (
        <EmptyState
          icon={ClipboardList}
          title="No count sheet for this date"
          description='Click "Generate Count Sheet" to create one'
        />
      ) : null}

      {/* Submit button */}
      {rows.length > 0 && !isSubmitted && (
        <div className="flex justify-end">
          <Button onClick={handleSubmit} disabled={!hasAnyPhysicalCount} className="gap-2">
            <Lock className="w-4 h-4" /> Submit Count
          </Button>
        </div>
      )}
    </div>
  );
}
