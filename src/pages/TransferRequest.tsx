import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useTransferRequest, TRHistoryRow, TRDetailLine } from "@/hooks/use-transfer-request";
import { useBranchData } from "@/hooks/use-branch-data";
import { useBranchSmStock, BranchSmStockStatus } from "@/hooks/use-branch-sm-stock";
import { DatePicker } from "@/components/ui/date-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusDot, StatusDotStatus } from "@/components/ui/status-dot";
import { UnitLabel } from "@/components/ui/unit-label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { typography, table as tableTokens, formatNumber } from "@/lib/design-tokens";
import { toLocalDateStr } from "@/lib/utils";
import { Plus, Eye, Printer, Ban, Info } from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/hooks/use-language";

const stockStatusToDot: Record<BranchSmStockStatus, StatusDotStatus> = {
  critical: "red",
  low: "amber",
  sufficient: "green",
  "no-data": "red",
};

const trStatusBadge: Record<string, string> = {
  Draft: "bg-muted text-muted-foreground",
  Submitted: "bg-warning/15 text-warning border border-warning/30",
  Acknowledged: "bg-primary/15 text-primary border border-primary/30",
  Fulfilled: "bg-success/15 text-success border border-success/30",
  Cancelled: "bg-destructive/15 text-destructive border border-destructive/30",
};

export default function TransferRequestPage() {
  const { t } = useLanguage();
  const { profile, role, isManagement, isStoreManager, isAreaManager, isCkManager, brandAssignments, user } = useAuth();
  const branchId = profile?.branch_id || null;
  const { branches } = useBranchData();

  // Management can select any branch for TR creation
  const [selectedBranchId, setSelectedBranchId] = useState<string>("");

  // Determine effective branch for TR form
  const effectiveBranchId = isManagement ? selectedBranchId : branchId;

  // Profile ID
  const [profileId, setProfileId] = useState<string | null>(null);
  useEffect(() => {
    if (user) {
      import("@/integrations/supabase/client").then(({ supabase }) => {
        supabase
          .from("profiles")
          .select("id")
          .eq("user_id", user.id)
          .maybeSingle()
          .then(({ data }) => {
            if (data) setProfileId(data.id);
          });
      });
    }
  }, [user]);

  const {
    lines,
    updateLineQty,
    isLoading,
    requiredDate,
    setRequiredDate,
    notes,
    setNotes,
    submitTR,
    canSubmit,
    itemsToOrder,
    history,
    historyLoading,
    fetchHistory,
    fetchTRDetail,
    cancelTR,
  } = useTransferRequest(effectiveBranchId || null, profileId);

  const canCreateTR = isStoreManager || isManagement;

  const [formOpen, setFormOpen] = useState(false);
  const [sortMode, setSortMode] = useState<"code" | "priority">("code");

  const statusOrder: Record<string, number> = { critical: 0, low: 1, sufficient: 2, "no-data": 3 };

  const sortedLines = useMemo(() => {
    const arr = [...lines];
    if (sortMode === "priority") {
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
  const [filterBranch, setFilterBranch] = useState<string>("");
  const [filterStatus, setFilterStatus] = useState<string>("All");
  const [filterFrom, setFilterFrom] = useState<Date | undefined>(undefined);
  const [filterTo, setFilterTo] = useState<Date | undefined>(undefined);

  const branchName = useMemo(() => {
    const bid = effectiveBranchId;
    if (!bid) return "";
    return branches.find((b) => b.id === bid)?.branchName || "";
  }, [effectiveBranchId, branches]);

  // Filter branches for area manager
  const visibleBranches = useMemo(() => {
    if (isManagement) return branches;
    if (isAreaManager) return branches.filter((b) => brandAssignments.includes(b.brandName));
    return branches;
  }, [branches, isManagement, isAreaManager, brandAssignments]);

  const activeBranches = useMemo(() => branches.filter((b) => b.status === "Active"), [branches]);

  const tomorrow = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }, []);

  const handleSubmit = useCallback(async () => {
    setSubmitting(true);
    const result = await submitTR();
    setSubmitting(false);
    if ("error" in result) {
      toast.error(result.error);
    } else {
      toast.success(`Transfer Request ${result.trNumber} submitted`);
      setFormOpen(false);
    }
  }, [submitTR]);

  const handleViewDetail = useCallback(
    async (tr: TRHistoryRow) => {
      setDetailTR(tr);
      setDetailOpen(true);
      setDetailLoading(true);
      const lines = await fetchTRDetail(tr.id);
      setDetailLines(lines);
      setDetailLoading(false);
    },
    [fetchTRDetail],
  );

  const handleFilterApply = useCallback(() => {
    fetchHistory({
      branchId: filterBranch || undefined,
      status: filterStatus,
      dateFrom: filterFrom ? toLocalDateStr(filterFrom) : undefined,
      dateTo: filterTo ? toLocalDateStr(filterTo) : undefined,
    });
  }, [fetchHistory, filterBranch, filterStatus, filterFrom, filterTo]);

  // Tab key navigation for REQUEST BATCH inputs
  const qtyInputRefs = useRef<Record<string, HTMLInputElement>>({});

  // Track local batch inputs for TOTAL UOM display
  const [batchInputs, setBatchInputs] = useState<Record<string, number>>({});

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className={typography.pageTitle}>{t("tr.pageTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("tr.pageSubtitle")}</p>
        </div>
        {canCreateTR && !formOpen && (
          <Button onClick={() => setFormOpen(true)} className="h-9">
            <Plus className="w-4 h-4 mr-1" /> {t("tr.newTR")}
          </Button>
        )}
      </div>

      {/* ─── TR Creation Form ─── */}
      {canCreateTR && formOpen && (
        <div className="rounded-lg border bg-card p-6 space-y-4">
          {/* Metadata row */}
          <div className="flex flex-wrap items-end gap-4">
            {isManagement ? (
              <div className="flex flex-col gap-1 min-w-[200px]">
                <label className="text-sm text-muted-foreground">
                  {t("tr.newBranch")} <span className="text-destructive">*</span>
                </label>
                <Select value={selectedBranchId} onValueChange={setSelectedBranchId}>
                  <SelectTrigger className="h-10 w-[240px]">
                    <SelectValue placeholder="Select branch" />
                  </SelectTrigger>
                  <SelectContent>
                    {activeBranches.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.branchName} — {b.brandName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <label className="text-sm text-muted-foreground">{t("col.branch")}</label>
                <div className="h-10 px-3 py-2 rounded-md border border-input bg-muted/30 text-sm min-w-[200px] flex items-center">
                  {branchName || "Not assigned"}
                </div>
              </div>
            )}
            <DatePicker
              value={requiredDate}
              onChange={setRequiredDate}
              label={t('tr.requiredDate')}
              required
              labelPosition="above"
              minDate={tomorrow}
              placeholder="Select date"
            />
            <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
              <label className="text-sm text-muted-foreground">Notes</label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional notes..."
                className="h-10"
              />
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setFormOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={!canSubmit || submitting || (isManagement && !selectedBranchId)}>
                {submitting ? t("tr.submitting") : t("tr.submitTR")}
              </Button>
            </div>
          </div>

          {/* SKU Sheet */}
          {effectiveBranchId && (
            <>
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-sm font-semibold">{t("tr.smItemsFor").replace("{branch}", branchName)}</p>
                  <p className="text-xs text-muted-foreground">{t("tr.smItemsHint")}</p>
                </div>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => setSortMode("code")}
                    className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${
                      sortMode === "code"
                        ? "bg-primary text-primary-foreground"
                        : "border border-input text-muted-foreground hover:bg-accent"
                    }`}
                  >
                    {t("tr.sortByCode")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSortMode("priority")}
                    className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${
                      sortMode === "priority"
                        ? "bg-primary text-primary-foreground"
                        : "border border-input text-muted-foreground hover:bg-accent"
                    }`}
                  >
                    {t("tr.sortByPriority")}
                  </button>
                </div>
              </div>

              {isLoading ? (
                <div className="text-center py-8 text-muted-foreground text-sm">{t("tr.loadingItems")}</div>
              ) : lines.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">{t("tr.noSmSkus")}</div>
              ) : (
                <>
                  <div className={tableTokens.wrapper}>
                    <table className={tableTokens.base}>
                      <colgroup>
                        <col style={{ width: 26 }} />
                        <col style={{ width: 76 }} />
                        <col />
                        <col style={{ width: 110 }} />
                        <col style={{ width: 72 }} />
                        <col style={{ width: 60 }} />
                        <col style={{ width: 76 }} />
                        <col style={{ width: 88 }} />
                        <col style={{ width: 88 }} />
                        <col style={{ width: 72 }} />
                        <col style={{ width: 52 }} />
                      </colgroup>
                      <thead>
                        <tr className={tableTokens.headerRow}>
                          <th className={tableTokens.headerCellCenter}></th>
                          <th className={tableTokens.headerCell}>{t("tr.colSkuCode")}</th>
                          <th className={tableTokens.headerCell}>{t("tr.colSkuName")}</th>
                          <th className={tableTokens.headerCell}>{t("tr.colBatchSize")}</th>
                          <th className={tableTokens.headerCellNumeric}>{t("tr.colStockNow")}</th>
                          <th className={tableTokens.headerCellNumeric}>{t("tr.colRop")}</th>
                          <th className={tableTokens.headerCellNumeric}>{t("tr.colParstock")}</th>
                          <th className={tableTokens.headerCellNumeric}>
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="inline-flex items-center gap-0.5 cursor-help justify-end">
                                    {t("tr.colSuggested")}
                                    <Info className="w-3 h-3 opacity-50" />
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p className="text-xs">{t("tr.roundedUpHint")}</p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </th>
                          <th className={tableTokens.headerCellNumeric}>{t("tr.colRequestBatch")}</th>
                          <th className={tableTokens.headerCellNumeric}>{t("tr.colTotalUom")}</th>
                          <th className={tableTokens.headerCellCenter}>{t("tr.colUnit")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedLines.map((line, idx) => {
                          const isSufficient = line.status === "sufficient";
                          const isNoData = line.status === "no-data";
                          const dotStatus: StatusDotStatus | undefined = isNoData
                            ? undefined
                            : stockStatusToDot[line.status];
                          const batchVal = batchInputs[line.skuId] ?? 0;
                          const totalUom = batchVal > 0 ? batchVal * line.packSize : 0;
                          const batchSizeLabel = `${formatNumber(line.packSize, 0)} ${line.uom}/แพ็ค`;

                          return (
                            <tr
                              key={line.skuId}
                              className={`${tableTokens.dataRow} ${isSufficient ? "opacity-60" : ""}`}
                            >
                              <td className={tableTokens.dataCellCompactCenter}>
                                {dotStatus ? (
                                  <StatusDot status={dotStatus} size="sm" />
                                ) : (
                                  <span className="inline-block w-2 h-2 rounded-full bg-muted" />
                                )}
                              </td>
                              <td className={`${tableTokens.dataCellCompact} font-mono`}>{line.skuCode}</td>
                              <td className={tableTokens.truncatedCellCompact} title={line.skuName}>
                                {line.skuName}
                              </td>
                              <td className={tableTokens.dataCellCompact} title={batchSizeLabel}>
                                <span className="whitespace-nowrap truncate block">{batchSizeLabel}</span>
                              </td>
                              <td className={tableTokens.dataCellCompactMono}>{formatNumber(line.stockOnHand, 0)}</td>
                              <td className={`${tableTokens.dataCellCompactMono} text-muted-foreground`}>
                                {formatNumber(line.rop, 0)}
                              </td>
                              <td className={`${tableTokens.dataCellCompactMono} text-muted-foreground`}>
                                {formatNumber(line.parstock, 0)}
                              </td>
                              <td
                                className={`${tableTokens.dataCellCompactMono} ${line.suggestedBatches > 0 ? "text-primary" : "text-muted-foreground"} font-medium`}
                              >
                                {isNoData ? "—" : line.suggestedBatches <= 0 ? 0 : line.suggestedBatches}
                              </td>
                              <td className={`${tableTokens.dataCellCompact} text-right`}>
                                <input
                                  ref={(el) => {
                                    if (el) qtyInputRefs.current[line.skuId] = el;
                                  }}
                                  type="number"
                                  inputMode="numeric"
                                  min={0}
                                  step={1}
                                  defaultValue=""
                                  placeholder="0"
                                  onBlur={(e) => {
                                    const v = Math.max(0, Math.round(Number(e.target.value) || 0));
                                    setBatchInputs((prev) => ({ ...prev, [line.skuId]: v }));
                                    updateLineQty(line.skuId, v);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === "Tab") {
                                      e.preventDefault();
                                      const nextIdx = e.shiftKey ? idx - 1 : idx + 1;
                                      if (nextIdx >= 0 && nextIdx < sortedLines.length) {
                                        const nextSkuId = sortedLines[nextIdx].skuId;
                                        qtyInputRefs.current[nextSkuId]?.focus();
                                        qtyInputRefs.current[nextSkuId]?.select();
                                      }
                                    }
                                  }}
                                  className={tableTokens.inputCell}
                                />
                              </td>
                              <td
                                className={`${tableTokens.dataCellCompactMono} ${totalUom > 0 ? "text-foreground" : "text-muted-foreground"}`}
                              >
                                {totalUom > 0 ? formatNumber(totalUom, 0) : "—"}
                              </td>
                              <td
                                className={`${tableTokens.dataCellCompactCenter} font-medium text-primary bg-orange-50`}
                              >
                                {line.uom}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex items-center justify-end gap-4">
                    <span className="text-sm text-muted-foreground">
                      {t("tr.itemsToOrder")} <span className="font-semibold text-foreground">{itemsToOrder}</span>
                    </span>
                    <Button
                      onClick={handleSubmit}
                      disabled={!canSubmit || submitting || (isManagement && !selectedBranchId)}
                    >
                      {submitting ? t("tr.submitting") : t("tr.submitTR")}
                    </Button>
                  </div>
                </>
              )}
            </>
          )}

          {isManagement && !selectedBranchId && (
            <div className="text-center py-8 text-muted-foreground text-sm">{t("tr.selectBranchHint")}</div>
          )}
        </div>
      )}

      {/* ─── TR History ─── */}
      <div className="space-y-3">
        <h3 className={typography.sectionTitle}>{t("tr.history")}</h3>

        {/* Filters */}
        <div className="flex flex-wrap items-end gap-3">
          {(isManagement || isAreaManager || isCkManager) && (
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">Branch</label>
              <Select
                value={filterBranch}
                onValueChange={(v) => {
                  setFilterBranch(v === "__all__" ? "" : v);
                }}
              >
                <SelectTrigger className="w-[200px] h-9">
                  <SelectValue placeholder={t("common.allBranches")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">{t("common.allBranches")}</SelectItem>
                  {visibleBranches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.branchName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="flex flex-col gap-1">
            <label className="text-sm text-muted-foreground">{t("col.status")}</label>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-[160px] h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["All", "Draft", "Submitted", "Acknowledged", "Fulfilled", "Cancelled"].map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DatePicker
            value={filterFrom}
            onChange={setFilterFrom}
            label="From"
            labelPosition="above"
            placeholder="From"
          />
          <DatePicker value={filterTo} onChange={setFilterTo} label="To" labelPosition="above" placeholder="To" />
          <Button variant="outline" className="h-9" onClick={handleFilterApply}>
            {t("btn.filter")}
          </Button>
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
                <th className={tableTokens.headerCell}>{t("tr.colTrNumber")}</th>
                <th className={tableTokens.headerCell}>{t("col.date")}</th>
                <th className={tableTokens.headerCell}>{t("tr.colRequiredDate")}</th>
                <th className={tableTokens.headerCell}>{t("col.branch")}</th>
                <th className={`${tableTokens.headerCell} text-right`}>{t("tr.colItems")}</th>
                <th className={tableTokens.headerCell}>{t("col.status")}</th>
                <th className={`${tableTokens.headerCell} text-center`}>{t("col.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {historyLoading ? (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-muted-foreground text-sm">
                    {t("common.loading")}
                  </td>
                </tr>
              ) : history.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-muted-foreground text-sm">
                    {t("tr.noResults")}
                  </td>
                </tr>
              ) : (
                history.map((tr) => (
                  <tr key={tr.id} className={tableTokens.dataRow}>
                    <td
                      className={`${tableTokens.dataCell} font-mono text-xs cursor-pointer text-primary hover:underline`}
                      onClick={() => handleViewDetail(tr)}
                    >
                      {tr.trNumber}
                    </td>
                    <td className={tableTokens.dataCell}>{tr.requestedDate}</td>
                    <td className={tableTokens.dataCell}>{tr.requiredDate}</td>
                    <td className={tableTokens.truncatedCell} title={tr.branchName}>
                      {tr.branchName}
                    </td>
                    <td className={tableTokens.dataCellMono}>{tr.itemCount}</td>
                    <td className={tableTokens.dataCell}>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${trStatusBadge[tr.status] || ""}`}
                      >
                        {tr.status}
                      </span>
                    </td>
                    <td className={`${tableTokens.dataCell} text-center`}>
                      <div className="flex items-center justify-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => handleViewDetail(tr)}
                          title="View"
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                        {(isManagement || isStoreManager) && tr.status !== "Cancelled" && tr.status !== "Fulfilled" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={() => cancelTR(tr.id)}
                            title="Cancel"
                          >
                            <Ban className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
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
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${trStatusBadge[detailTR.status] || ""}`}
                >
                  {detailTR.status}
                </span>
              )}
            </DialogTitle>
          </DialogHeader>

          {detailTR && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">{t("tr.detailBranch")} </span>
                  <span className="font-medium">{detailTR.branchName}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t("tr.detailRequested")} </span>
                  <span>{detailTR.requestedDate}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t("tr.detailRequired")} </span>
                  <span>{detailTR.requiredDate}</span>
                </div>
                {detailTR.notes && (
                  <div className="col-span-2">
                    <span className="text-muted-foreground">{t("tr.detailNotes")} </span>
                    <span>{detailTR.notes}</span>
                  </div>
                )}
              </div>

              {detailLoading ? (
                <div className="text-center py-6 text-muted-foreground text-sm">{t("tr.loadingLines")}</div>
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
                        <th className={tableTokens.headerCell}>{t("tr.colSkuCode")}</th>
                        <th className={tableTokens.headerCell}>{t("tr.colSkuName")}</th>
                        <th className={`${tableTokens.headerCell} text-right`}>{t("tr.colStock")}</th>
                        <th className={`${tableTokens.headerCell} text-right`}>{t("tr.colSuggested")}</th>
                        <th className={`${tableTokens.headerCell} text-right`}>{t("tr.colRop")}</th>
                        <th className={`${tableTokens.headerCell} text-right`}>{t("tr.colRequested")}</th>
                        <th className={`${tableTokens.headerCell} text-center`}>{t("col.uom")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detailLines.map((l) => (
                        <tr key={l.id} className={tableTokens.dataRow}>
                          <td className={`${tableTokens.dataCell} font-mono text-xs`}>{l.skuCode}</td>
                          <td className={tableTokens.truncatedCell} title={l.skuName}>
                            {l.skuName}
                          </td>
                          <td className={tableTokens.dataCellMono}>{formatNumber(l.stockOnHand, 0)}</td>
                          <td className={`${tableTokens.dataCellMono} text-muted-foreground`}>
                            {formatNumber(l.suggestedQty, 0)}
                          </td>
                          <td className={`${tableTokens.dataCellMono} text-muted-foreground`}>
                            {formatNumber(l.rop, 0)}
                          </td>
                          <td className={`${tableTokens.dataCellMono} font-medium`}>
                            {formatNumber(l.requestedQty, 0)}
                          </td>
                          <td className={`${tableTokens.dataCell} text-center`}>
                            <UnitLabel unit={l.uom} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <p className="text-xs text-muted-foreground">{t("tr.stockNote")}</p>

              <div className="flex justify-end print:hidden">
                <Button variant="outline" onClick={() => window.print()}>
                  <Printer className="w-4 h-4 mr-1" /> {t("btn.print")}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
