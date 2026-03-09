import { useState, useMemo, useCallback, useEffect } from 'react';
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
import { ClipboardCheck, Loader2, Lock, Unlock, CheckCircle2 } from 'lucide-react';

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
  const { isAdmin, isBranchManager, profile } = useAuth();
  const today = new Date().toISOString().slice(0, 10);

  const [selectedDate, setSelectedDate] = useState(today);
  const [selectedBranch, setSelectedBranch] = useState<string>(
    isBranchManager && profile?.branch_id ? profile.branch_id : ''
  );

  const {
    rows, loading, generating,
    loadSheet, generateSheet, updatePhysicalCount,
    submitSheet, unlockSheet,
  } = useDailyStockCount({ skus, menuBomLines, modifierRules, spBomLines, menus, branches });

  const availableBranches = useMemo(() => {
    if (isAdmin) return branches.filter(b => b.status === 'Active');
    if (isBranchManager && profile?.branch_id) return branches.filter(b => b.id === profile.branch_id);
    return [];
  }, [branches, isAdmin, isBranchManager, profile]);

  // Auto-load when branch + date are selected
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

  const handleSubmit = useCallback(() => {
    submitSheet(selectedBranch, selectedDate);
  }, [selectedBranch, selectedDate, submitSheet]);

  const handleUnlock = useCallback(() => {
    unlockSheet(selectedBranch, selectedDate);
  }, [selectedBranch, selectedDate, unlockSheet]);

  const getVarianceColor = (variance: number, physicalCount: number | null) => {
    if (physicalCount === null) return '';
    const abs = Math.abs(variance);
    if (abs === 0) return 'text-green-600 bg-green-50';
    if (abs <= 5) return 'text-yellow-600 bg-yellow-50';
    return 'text-red-600 bg-red-50';
  };

  // Sort rows: by SKU type then SKU code
  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const skuA = skuMap.get(a.skuId);
      const skuB = skuMap.get(b.skuId);
      if (!skuA || !skuB) return 0;
      if (skuA.type !== skuB.type) return skuA.type < skuB.type ? -1 : 1;
      return skuA.skuId.localeCompare(skuB.skuId);
    });
  }, [rows, skuMap]);

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
              <label className="text-xs text-muted-foreground">Date</label>
              <Input
                type="date"
                value={selectedDate}
                onChange={e => setSelectedDate(e.target.value)}
                className="w-44"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Branch</label>
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
        <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-lg px-4 py-3">
          <div className="flex items-center gap-2 text-green-700">
            <CheckCircle2 className="w-5 h-5" />
            <span className="font-medium">Submitted</span>
            <span className="text-sm text-green-600">
              — {rows[0]?.submittedAt ? new Date(rows[0].submittedAt).toLocaleString() : ''}
            </span>
          </div>
          {isAdmin && (
            <Button variant="outline" size="sm" onClick={handleUnlock}>
              <Unlock className="w-4 h-4" /> Unlock
            </Button>
          )}
        </div>
      )}

      {/* Count sheet table */}
      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading...
        </div>
      ) : rows.length > 0 ? (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="whitespace-nowrap">SKU Code</TableHead>
                    <TableHead>SKU Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Opening</TableHead>
                    <TableHead className="text-right whitespace-nowrap">From CK</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Ext. Received</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Exp. Usage</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Calc. Balance</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Physical Count</TableHead>
                    <TableHead className="text-right">Variance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedRows.map(row => {
                    const sku = skuMap.get(row.skuId);
                    if (!sku) return null;
                    const varColor = getVarianceColor(row.variance, row.physicalCount);

                    return (
                      <TableRow key={row.id}>
                        <TableCell className="font-mono text-xs">{sku.skuId}</TableCell>
                        <TableCell className="max-w-[180px] truncate">{sku.name}</TableCell>
                        <TableCell>
                          <Badge variant={sku.type === 'RM' ? 'default' : 'secondary'} className="text-[10px]">
                            {sku.type}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{row.openingBalance.toFixed(2)}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.receivedFromCk.toFixed(2)}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.receivedExternal.toFixed(2)}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.expectedUsage.toFixed(2)}</TableCell>
                        <TableCell className="text-right tabular-nums font-medium">{row.calculatedBalance.toFixed(2)}</TableCell>
                        <TableCell className="text-right w-28">
                          {isSubmitted ? (
                            <span className="tabular-nums">{row.physicalCount !== null ? row.physicalCount.toFixed(2) : '—'}</span>
                          ) : (
                            <Input
                              type="number"
                              step="0.01"
                              value={row.physicalCount !== null ? row.physicalCount : ''}
                              onChange={e => {
                                const val = e.target.value === '' ? null : Number(e.target.value);
                                updatePhysicalCount(row.id, val);
                              }}
                              className="h-8 w-24 text-right tabular-nums text-sm"
                              placeholder="—"
                            />
                          )}
                        </TableCell>
                        <TableCell className={`text-right tabular-nums font-medium rounded ${varColor}`}>
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
      ) : selectedBranch ? (
        <div className="text-center py-12 text-muted-foreground">
          No count sheet for this date. Click "Generate Count Sheet" to create one.
        </div>
      ) : null}

      {/* Submit button */}
      {rows.length > 0 && !isSubmitted && (
        <div className="flex justify-end">
          <Button onClick={handleSubmit} className="gap-2">
            <Lock className="w-4 h-4" /> Submit Count
          </Button>
        </div>
      )}
    </div>
  );
}
