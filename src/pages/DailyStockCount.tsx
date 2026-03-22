import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useLanguage } from "@/hooks/use-language";
import { toLocalDateStr } from "@/lib/utils";
import { useDailyStockCount, DailyStockCountRow } from "@/hooks/use-daily-stock-count";
import { useAuth } from "@/hooks/use-auth";
import { SKU } from "@/types/sku";
import { MenuBomLine } from "@/types/menu-bom";
import { ModifierRule } from "@/types/modifier-rule";
import { SpBomLine } from "@/types/sp-bom";
import { Menu } from "@/types/menu";
import { Branch } from "@/types/branch";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SkeletonTable } from "@/components/SkeletonTable";
import { EmptyState } from "@/components/EmptyState";
import {
  ClipboardCheck,
  Loader2,
  Lock,
  Unlock,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  PartyPopper,
  ClipboardList,
} from "lucide-react";
import { toast } from "sonner";

interface DailyStockCountPageProps {
  skus: SKU[];
  menuBomLines: MenuBomLine[];
  modifierRules: ModifierRule[];
  spBomLines: SpBomLine[];
  menus: Menu[];
  branches: Branch[];
}

type SortKey = "skuCode" | "skuName" | "type";
type SortDir = "asc" | "desc";

const TYPE_ORDER: Record<string, number> = { SM: 0, RM: 1, PK: 2 };

export default function DailyStockCountPage({
  skus,
  menuBomLines,
  modifierRules,
  spBomLines,
  menus,
  branches,
}: DailyStockCountPageProps) {
  const { isManagement, isStoreManager, profile } = useAuth();
  const { t } = useLanguage();
  const today = toLocalDateStr(new Date());

  const [selectedDate, setSelectedDate] = useState(today);
  const [selectedBranch, setSelectedBranch] = useState<string>(
    isStoreManager && profile?.branch_id ? profile.branch_id : "",
  );
  const [showUnused, setShowUnused] = useState(false);
  const [justSubmitted, setJustSubmitted] = useState(false);
  const physicalCountRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  // Sort state — default: TYPE column, SM→RM→PK
  const [sortKey, setSortKey] = useState<SortKey>("type");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const handleSort = useCallback((key: SortKey) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return key;
      }
      setSortDir("asc");
      return key;
    });
  }, []);

  const {
    rows,
    loading,
    generating,
    loadSheet,
    generateSheet,
    updatePhysicalCount,
    updateWaste,
    submitSheet,
    unlockSheet,
  } = useDailyStockCount({ skus, menuBomLines, modifierRules, spBomLines, menus, branches });

  const availableBranches = useMemo(() => {
    if (isManagement) return branches.filter((b) => b.status === "Active");
    if (isStoreManager && profile?.branch_id) return branches.filter((b) => b.id === profile.branch_id);
    return branches.filter((b) => b.status === "Active");
  }, [branches, isManagement, isStoreManager, profile]);

  useEffect(() => {
    if (selectedBranch && selectedDate) {
      loadSheet(selectedBranch, selectedDate);
    }
  }, [selectedBranch, selectedDate, loadSheet]);

  const skuMap = useMemo(() => {
    const m = new Map<string, SKU>();
    skus.forEach((s) => m.set(s.id, s));
    return m;
  }, [skus]);

  // Get converter for a SKU (only when purchase != usage UOM)
  const getConverter = useCallback(
    (skuId: string): number => {
      const sku = skuMap.get(skuId);
      if (!sku) return 1;
      if (sku.purchaseUom === sku.usageUom) return 1;
      return sku.converter || 1;
    },
    [skuMap],
  );

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
    if (physicalCount === null) return "var-neutral";
    if (variance === 0) return "var-neutral";
    const pct = calculatedBalance !== 0 ? (variance / calculatedBalance) * 100 : 0;
    if (variance < 0) {
      if (Math.abs(pct) >= 10) return "var-great";
      return "var-good";
    } else {
      if (pct >= 10) return "var-major-loss";
      return "var-minor-loss";
    }
  };

  // Comparator helper
  const compareRows = useCallback(
    (a: DailyStockCountRow, b: DailyStockCountRow): number => {
      const skuA = skuMap.get(a.skuId);
      const skuB = skuMap.get(b.skuId);
      if (!skuA || !skuB) return 0;

      const dir = sortDir === "asc" ? 1 : -1;

      if (sortKey === "type") {
        const ta = TYPE_ORDER[skuA.type] ?? 9;
        const tb = TYPE_ORDER[skuB.type] ?? 9;
        if (ta !== tb) return (ta - tb) * dir;
        return skuA.skuId.localeCompare(skuB.skuId);
      }
      if (sortKey === "skuCode") {
        return skuA.skuId.localeCompare(skuB.skuId) * dir;
      }
      if (sortKey === "skuName") {
        return skuA.name.localeCompare(skuB.name) * dir;
      }
      return 0;
    },
    [skuMap, sortKey, sortDir],
  );

  // Sort and separate active vs unused rows
  const { activeRows, unusedRows } = useMemo(() => {
    const sorted = [...rows].sort(compareRows);

    const active: typeof sorted = [];
    const unused: typeof sorted = [];

    sorted.forEach((row) => {
      const isUnused =
        row.openingBalance === 0 &&
        row.receivedFromCk === 0 &&
        row.receivedExternal === 0 &&
        row.expectedUsage === 0 &&
        row.physicalCount === null;
      if (isUnused) unused.push(row);
      else active.push(row);
    });

    return { activeRows: active, unusedRows: unused };
  }, [rows, compareRows]);

  const hasAnyPhysicalCount = rows.some((r) => r.physicalCount !== null);

  // Auto-advance to next row's physical count on Enter
  const handlePhysicalCountKeyDown = (e: React.KeyboardEvent, rowId: string, index: number) => {
    if (e.key === "Enter" || e.key === "Tab") {
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

  const thClass = "px-2 py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground whitespace-nowrap";

  // Sortable header helper
  const renderSortableHeader = (key: SortKey, label: string, extraClass = "") => {
    const isActive = sortKey === key;
    const Icon = isActive ? (sortDir === "asc" ? ChevronUp : ChevronDown) : null;
    return (
      <span
        className={`inline-flex items-center cursor-pointer select-none ${isActive ? "text-foreground" : "text-muted-foreground"} ${extraClass}`}
        onClick={() => handleSort(key)}
      >
        {label}
        {Icon && <Icon className="w-3 h-3 ml-0.5" />}
      </span>
    );
  };

  const fmt0 = (n: number) => Math.round(n).toLocaleString();

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">{t("title.dailyStockCount")}</h2>
        <p className="text-sm text-muted-foreground mt-0.5">{t("dsc.subtitle")}</p>
      </div>

      {/* Controls */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end gap-4">
            <DatePicker
              value={selectedDate ? new Date(selectedDate + "T00:00:00") : undefined}
              onChange={(d) => setSelectedDate(d ? toLocalDateStr(d) : today)}
              defaultToday
              label={t("dsc.dateLabel")}
              required
              labelPosition="above"
              align="start"
            />
            <div>
              <label className="text-xs text-muted-foreground label-required">{t("dsc.branchLabel")}</label>
              <Select value={selectedBranch} onValueChange={setSelectedBranch}>
                <SelectTrigger className="w-56">
                  <SelectValue placeholder={t("dsc.selectBranch")} />
                </SelectTrigger>
                <SelectContent>
                  {availableBranches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.branchName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleGenerate} disabled={!selectedBranch || generating}>
              {generating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> {t("btn.generate")}...
                </>
              ) : (
                <>
                  <ClipboardCheck className="w-4 h-4" /> {t("btn.generateCountSheet")}
                </>
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
            <span className="font-medium">{t("status.submitted")}</span>
            <span className="text-sm opacity-80">
              — {rows[0]?.submittedAt ? new Date(rows[0].submittedAt).toLocaleString() : ""}
            </span>
          </div>
          {isManagement && (
            <Button variant="outline" size="sm" onClick={handleUnlock}>
              <Unlock className="w-4 h-4" /> {t("btn.unlock")}
            </Button>
          )}
        </div>
      )}

      {/* Celebration */}
      {justSubmitted && (
        <div className="flex items-center justify-center gap-2 text-success py-4 animate-in fade-in duration-500">
          <PartyPopper className="w-6 h-6" />
          <span className="font-medium text-lg">{t("dsc.successMsg")}</span>
        </div>
      )}

      {/* Count sheet table */}
      {loading ? (
        <SkeletonTable columns={11} rows={12} />
      ) : rows.length > 0 ? (
        <>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-auto max-h-[70vh]">
                <div className="px-4 py-2 border-b bg-muted/50">
                  <p className="kbd-hint">{t("dsc.keyboardHint")}</p>
                </div>
                <table className="w-full table-fixed text-xs">
                  <colgroup>
                    <col style={{ width: 90 }} />
                    <col style={{ width: 150 }} />
                    <col style={{ width: 50 }} />
                    <col style={{ width: 60 }} />
                    <col style={{ width: 80 }} />
                    <col style={{ width: 90 }} />
                    <col style={{ width: 80 }} />
                    <col style={{ width: 80 }} />
                    <col style={{ width: 90 }} />
                    <col style={{ width: 90 }} />
                    <col style={{ width: 80 }} />
                  </colgroup>
                  <thead className="sticky-thead">
                    <tr className="bg-table-header border-b">
                      <th className={thClass}>{renderSortableHeader("skuCode", t("col.skuCode"))}</th>
                      <th className={thClass}>{renderSortableHeader("skuName", t("col.skuName"))}</th>
                      <th className={thClass}>{renderSortableHeader("type", t("col.type"))}</th>
                      <th className={thClass}>{t("dsc.colUnit")}</th>
                      <th className={`text-right ${thClass}`}>
                        <div>{t("col.opening")}</div>
                        <div className="text-xs font-normal text-muted-foreground">(Usage UOM)</div>
                      </th>
                      <th className={`text-right ${thClass}`}>
                        <div>{t("dsc.colReceived")}</div>
                        <div className="text-xs font-normal text-muted-foreground">(Usage UOM)</div>
                      </th>
                      <th className={`text-right ${thClass}`}>
                        <div>{t("col.expUsage")}</div>
                        <div className="text-xs font-normal text-muted-foreground">(Usage UOM)</div>
                      </th>
                      <th className={`text-right ${thClass}`}>
                        <div>{t("col.waste")}</div>
                        <div className="text-xs font-normal text-muted-foreground">(Usage UOM)</div>
                      </th>
                      <th className={`text-right ${thClass}`}>
                        <div>{t("col.calcBalance")}</div>
                        <div className="text-xs font-normal text-muted-foreground">(Usage UOM)</div>
                      </th>
                      <th className={`text-right ${thClass} !bg-foreground !text-background font-semibold`}>
                        <div>{t("col.physical")}</div>
                        <div className="text-xs font-normal opacity-60">(Usage UOM)</div>
                      </th>
                      <th className={`text-right ${thClass}`}>
                        <div>{t("col.variance")}</div>
                        <div className="text-xs font-normal text-muted-foreground">(Usage UOM)</div>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeRows.map((row, idx) => {
                      const sku = skuMap.get(row.skuId);
                      if (!sku) return null;
                      const varClass = getVarianceClass(row.variance, row.physicalCount, row.calculatedBalance);

                      return (
                        <tr
                          key={row.id}
                          className={`border-b border-table-border hover:bg-table-hover transition-colors ${idx % 2 === 1 ? "bg-table-alt" : ""}`}
                        >
                          <td className="font-mono text-xs px-2 py-1">{sku.skuId}</td>
                          <td className="max-w-[150px] truncate px-2 py-1 text-sm" title={sku.name}>
                            {sku.name}
                          </td>
                          <td className="px-2 py-1">
                            <span
                              className={`inline-flex px-1.5 py-0.5 rounded-full text-xs font-semibold ${
                                sku.type === "RM"
                                  ? "badge-rm"
                                  : sku.type === "SM"
                                    ? "badge-sm"
                                    : sku.type === "SP"
                                      ? "badge-sp"
                                      : "badge-pk"
                              }`}
                            >
                              {sku.type}
                            </span>
                          </td>
                          <td className="px-2 py-1 text-xs text-muted-foreground text-center">{sku.usageUom}</td>
                          <td className="text-right font-mono text-sm px-2 py-1">{fmt0(row.openingBalance)}</td>
                          <td className="text-right font-mono text-sm px-2 py-1">
                            {(() => {
                              const totalReceived = row.receivedFromCk + row.receivedExternal * getConverter(row.skuId);
                              return totalReceived > 0 ? (
                                fmt0(totalReceived)
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              );
                            })()}
                          </td>
                          <td className="text-right font-mono text-sm px-2 py-1">{fmt0(row.expectedUsage)}</td>
                          <td className="px-1.5 py-1 text-right">
                            {isSubmitted ? (
                              <span className="text-sm font-mono">{fmt0(row.waste)}</span>
                            ) : (
                              <Input
                                type="number"
                                min={0}
                                step="any"
                                defaultValue={row.waste || ""}
                                key={`waste-${row.id}-${row.waste}`}
                                onBlur={(e) => {
                                  const val = Number(e.target.value) || 0;
                                  if (val !== row.waste) updateWaste(row.id, val);
                                }}
                                className="h-8 text-xs text-right w-[80px] font-mono"
                                placeholder="0"
                              />
                            )}
                          </td>
                          <td className="text-right font-mono text-sm font-medium px-2 py-1">
                            {fmt0(Math.max(0, row.calculatedBalance))}
                          </td>
                          <td className="px-1.5 py-1 text-right">
                            {isSubmitted ? (
                              <span className="text-sm font-mono">
                                {row.physicalCount !== null ? fmt0(row.physicalCount) : "—"}
                              </span>
                            ) : (
                              <Input
                                ref={(el) => setRef(row.id, el)}
                                type="number"
                                min={0}
                                step="any"
                                defaultValue={row.physicalCount !== null ? row.physicalCount : ""}
                                key={`phys-${row.id}-${row.physicalCount}`}
                                onBlur={(e) => {
                                  if (e.target.value === "") {
                                    if (row.physicalCount !== null) updatePhysicalCount(row.id, null);
                                    return;
                                  }
                                  const val = Number(e.target.value);
                                  const clamped = val < 0 ? 0 : val;
                                  if (val < 0) e.target.value = "0";
                                  if (clamped !== row.physicalCount) updatePhysicalCount(row.id, clamped);
                                }}
                                onKeyDown={(e) => handlePhysicalCountKeyDown(e, row.id, idx)}
                                className="h-8 text-xs text-right w-[80px] font-mono"
                                placeholder="—"
                              />
                            )}
                          </td>
                          <td className={`text-right font-mono text-sm font-medium px-2 py-1 ${varClass}`}>
                            {row.physicalCount !== null ? fmt0(row.variance) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
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
              {showUnused ? t("dsc.hideUnused") : t("dsc.showUnused")} {t("dsc.unusedSkus")} ({unusedRows.length})
            </button>
          )}

          {showUnused && unusedRows.length > 0 && (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-auto max-h-[50vh]">
                  <Table>
                    <TableHeader className="sticky-thead">
                      <TableRow className="bg-table-header border-b">
                        <TableHead className={thClass}>{t("col.skuCode")}</TableHead>
                        <TableHead className={thClass}>{t("col.skuName")}</TableHead>
                        <TableHead className={thClass}>{t("col.type")}</TableHead>
                        <TableHead className={`text-right ${thClass}`}>{t("col.physical")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {unusedRows.map((row) => {
                        const sku = skuMap.get(row.skuId);
                        if (!sku) return null;

                        return (
                          <TableRow
                            key={row.id}
                            className="border-b border-table-border text-muted-foreground hover:bg-table-hover transition-colors"
                          >
                            <TableCell className="px-2 py-1 font-mono text-xs">{sku.skuId}</TableCell>
                            <TableCell className="px-2 py-1 text-sm">{sku.name}</TableCell>
                            <TableCell className="px-2 py-1">
                              <span
                                className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${
                                  sku.type === "RM" ? "badge-rm" : "badge-sm"
                                }`}
                              >
                                {sku.type}
                              </span>
                            </TableCell>
                            <TableCell className="text-right w-28 px-2 py-1">
                              {!isSubmitted && (
                                <Input
                                  type="number"
                                  min={0}
                                  step="0.01"
                                  defaultValue={row.physicalCount !== null ? row.physicalCount : ""}
                                  key={`phys-unused-${row.id}-${row.physicalCount}`}
                                  onBlur={(e) => {
                                    if (e.target.value === "") {
                                      if (row.physicalCount !== null) updatePhysicalCount(row.id, null);
                                      return;
                                    }
                                    const val = Number(e.target.value);
                                    const clamped = val < 0 ? 0 : val;
                                    if (val < 0) e.target.value = "0";
                                    if (clamped !== row.physicalCount) updatePhysicalCount(row.id, clamped);
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
        <EmptyState icon={ClipboardList} title={t("dsc.emptyTitle")} description={t("dsc.emptyHint")} />
      ) : null}

      {/* Submit button */}
      {rows.length > 0 && !isSubmitted && (
        <div className="flex justify-end">
          <Button onClick={handleSubmit} disabled={!hasAnyPhysicalCount} className="gap-2">
            <Lock className="w-4 h-4" /> {t("btn.submitCount")}
          </Button>
        </div>
      )}
    </div>
  );
}
