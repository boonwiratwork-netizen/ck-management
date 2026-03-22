import { useState, useMemo } from "react";
import { useLanguage } from "@/hooks/use-language";
import { toLocalDateStr } from "@/lib/utils";
import { SKU, StorageCondition } from "@/types/sku";
import { useSortableTable } from "@/hooks/use-sortable-table";
import { SortableHeader } from "@/components/SortableHeader";
import { StockCountSession, StockCountLine } from "@/types/stock-count";
import { BOMHeader, BOMLine } from "@/types/bom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { UnitLabel } from "@/components/ui/unit-label";
import { Plus, ClipboardCheck, Lock, Trash2, AlertTriangle, CheckCircle2, Package } from "lucide-react";
import { toast } from "sonner";

interface Props {
  skus: SKU[];
  stockCountData: {
    sessions: StockCountSession[];
    createSession: (date: string, note: string) => string | Promise<string>;
    updateLine: (lineId: string, physicalQty: number | null, note?: string) => void | Promise<void>;
    confirmSession: (sessionId: string) => void | Promise<void>;
    softDeleteSession: (sessionId: string) => void | Promise<void>;
    getLinesForSession: (sessionId: string) => StockCountLine[];
  };
  getStdUnitPrice: (skuId: string) => number;
  bomHeaders: BOMHeader[];
  bomLines: BOMLine[];
  isManagement: boolean;
}

export default function StockCountPage({
  skus,
  stockCountData,
  getStdUnitPrice,
  bomHeaders,
  bomLines,
  isManagement,
}: Props) {
  const { sessions, createSession, updateLine, confirmSession, softDeleteSession, getLinesForSession } = stockCountData;
  const { t } = useLanguage();

  const today = toLocalDateStr(new Date());
  const [selectedDate, setSelectedDate] = useState(today);
  const [activeTab, setActiveTab] = useState<string>("RM");
  const [filterStorage, setFilterStorage] = useState<string>("all");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [ckItemsOnly, setCkItemsOnly] = useState(false);

  // Derive CK RM SKU IDs
  const ckRmSkuIds = useMemo(() => {
    const activeSmSkuIds = new Set(skus.filter((s) => s.type === "SM" && s.status === "Active").map((s) => s.id));
    const activeHeaderIds = new Set(bomHeaders.filter((h) => activeSmSkuIds.has(h.smSkuId)).map((h) => h.id));
    const rmIds = new Set<string>();
    bomLines.forEach((l) => {
      if (activeHeaderIds.has(l.bomHeaderId)) rmIds.add(l.rmSkuId);
    });
    return rmIds;
  }, [skus, bomHeaders, bomLines]);

  const sessionForDate = useMemo(() => {
    return sessions.find((s) => s.date === selectedDate) ?? null;
  }, [sessions, selectedDate]);

  const selectedSession = sessionForDate;
  const selectedSessionId = selectedSession?.id ?? null;
  const sessionLines = selectedSessionId ? getLinesForSession(selectedSessionId) : [];
  const isCompleted = selectedSession?.status === "Completed";

  const skuMap = useMemo(() => {
    const m: Record<string, SKU> = {};
    skus.forEach((s) => {
      m[s.id] = s;
    });
    return m;
  }, [skus]);

  const filteredLines = useMemo(() => {
    return sessionLines.filter((line) => {
      const sku = skuMap[line.skuId];
      if (!sku) return false;
      if (line.type !== activeTab) return false;
      if (filterStorage !== "all" && sku.storageCondition !== filterStorage) return false;
      if (activeTab === "RM" && ckItemsOnly && !ckRmSkuIds.has(line.skuId)) return false;
      return true;
    });
  }, [sessionLines, skuMap, activeTab, filterStorage, ckItemsOnly, ckRmSkuIds]);

  const scComparators = useMemo(
    () => ({
      skuId: (a: StockCountLine, b: StockCountLine) =>
        (skuMap[a.skuId]?.skuId || "").localeCompare(skuMap[b.skuId]?.skuId || ""),
      name: (a: StockCountLine, b: StockCountLine) =>
        (skuMap[a.skuId]?.name || "").localeCompare(skuMap[b.skuId]?.name || ""),
      storage: (a: StockCountLine, b: StockCountLine) =>
        (skuMap[a.skuId]?.storageCondition || "").localeCompare(skuMap[b.skuId]?.storageCondition || ""),
      systemQty: (a: StockCountLine, b: StockCountLine) => a.systemQty - b.systemQty,
      variance: (a: StockCountLine, b: StockCountLine) => a.variance - b.variance,
    }),
    [skuMap],
  );

  const {
    sorted: sortedLines,
    sortKey: scSortKey,
    sortDir: scSortDir,
    handleSort: scHandleSort,
  } = useSortableTable(filteredLines, scComparators, "skuId", "asc");

  const summary = useMemo(() => {
    const counted = sessionLines.filter((l) => l.physicalQty !== null).length;
    const withVariance = sessionLines.filter((l) => l.physicalQty !== null && l.variance !== 0).length;
    const totalVarianceValue = sessionLines
      .filter((l) => l.physicalQty !== null && l.variance !== 0)
      .reduce((sum, l) => {
        const price = getStdUnitPrice(l.skuId);
        return sum + l.variance * price;
      }, 0);
    return { total: sessionLines.length, counted, withVariance, totalVarianceValue };
  }, [sessionLines, getStdUnitPrice]);

  const tabCounts = useMemo(
    () => ({
      RM: sessionLines.filter((l) => l.type === "RM").length,
      SM: sessionLines.filter((l) => l.type === "SM").length,
      PK: sessionLines.filter((l) => l.type === "PK").length,
    }),
    [sessionLines],
  );

  const varianceLines = useMemo(() => {
    return sessionLines.filter((l) => l.physicalQty !== null && l.variance !== 0);
  }, [sessionLines]);

  const sessionOptions = useMemo(() => {
    return sessions.map((s) => {
      const sLines = getLinesForSession(s.id);
      const counted = sLines.filter((l) => l.physicalQty !== null).length;
      return { id: s.id, date: s.date, counted, total: sLines.length, status: s.status };
    });
  }, [sessions, getLinesForSession]);

  const handleCreate = async () => {
    if (sessionForDate) {
      toast.error("A session already exists for this date");
      return;
    }
    const result = createSession(selectedDate, "");
    if (result instanceof Promise) {
      await result;
    }
    toast.success("Stock count session created");
  };

  const handleConfirmAdjust = () => {
    if (!selectedSessionId) return;
    confirmSession(selectedSessionId);
    setConfirmOpen(false);
    toast.success("Stock adjustments applied and session locked");
  };

  const handleSoftDelete = async () => {
    if (!deleteConfirm) return;
    await softDeleteSession(deleteConfirm);
    setDeleteConfirm(null);
    setSelectedDate(today);
    toast.success("Session deleted and adjustments reversed");
  };

  const thClass = "text-left px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground";

  const renderCountTable = () => (
    <div className="rounded-lg border overflow-auto max-h-[60vh]">
      <table className="w-full text-sm">
        <thead className="sticky-thead">
          <tr className="border-b bg-table-header">
            <th className={`${thClass} cursor-pointer hover:bg-muted/50`} onClick={() => scHandleSort("skuId")}>
              <SortableHeader
                label={t("col.skuId")}
                sortKey="skuId"
                activeSortKey={scSortKey}
                sortDir={scSortDir}
                onSort={scHandleSort}
              />
            </th>
            <th className={`${thClass} cursor-pointer hover:bg-muted/50`} onClick={() => scHandleSort("name")}>
              <SortableHeader
                label={t("col.name")}
                sortKey="name"
                activeSortKey={scSortKey}
                sortDir={scSortDir}
                onSort={scHandleSort}
              />
            </th>
            <th className={`${thClass} cursor-pointer hover:bg-muted/50`} onClick={() => scHandleSort("storage")}>
              <SortableHeader
                label={t("col.storage")}
                sortKey="storage"
                activeSortKey={scSortKey}
                sortDir={scSortDir}
                onSort={scHandleSort}
              />
            </th>
            <th
              className={`${thClass} text-right cursor-pointer hover:bg-muted/50`}
              onClick={() => scHandleSort("systemQty")}
            >
              <SortableHeader
                label="System Qty"
                sortKey="systemQty"
                activeSortKey={scSortKey}
                sortDir={scSortDir}
                onSort={scHandleSort}
                className="justify-end"
              />
            </th>
            <th className="text-right px-3 py-2 text-xs font-medium uppercase tracking-wide !bg-foreground text-background">
              Physical QTY (Usage UOM)
            </th>
            <th
              className={`${thClass} text-right cursor-pointer hover:bg-muted/50`}
              onClick={() => scHandleSort("variance")}
            >
              <SortableHeader
                label={t("col.variance")}
                sortKey="variance"
                activeSortKey={scSortKey}
                sortDir={scSortDir}
                onSort={scHandleSort}
                className="justify-end"
              />
            </th>
            <th className={thClass}>{t("col.note")}</th>
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
            sortedLines.map((line) => {
              const sku = skuMap[line.skuId];
              if (!sku) return null;
              const hasVariance = line.physicalQty !== null && line.variance !== 0;
              return (
                <tr
                  key={line.id}
                  className="border-b border-table-border last:border-0 hover:bg-table-hover transition-colors"
                >
                  <td className="px-3 py-2 font-mono text-xs">{sku.skuId}</td>
                  <td className="px-3 py-2 text-sm font-medium">{sku.name}</td>
                  <td className="px-3 py-2 text-sm">{sku.storageCondition}</td>
                  <td className="px-3 py-2 text-right font-mono text-sm">
                    {(line.type === "SM" ? Math.max(0, line.systemQty) : line.systemQty).toLocaleString(undefined, {
                      maximumFractionDigits: 2,
                    })}
                    <UnitLabel unit={sku.usageUom} />
                  </td>
                  <td className="px-1.5 py-1.5 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Input
                        type="number"
                        min={0}
                        step="any"
                        defaultValue={line.physicalQty ?? ""}
                        key={`phys-${line.id}-${line.physicalQty}`}
                        placeholder="—"
                        onBlur={(e) => {
                          const val = e.target.value === "" ? null : Number(e.target.value);
                          if (val !== line.physicalQty) updateLine(line.id, val);
                        }}
                        className="h-8 text-xs text-right w-[80px] font-mono border-2 border-primary/40 focus:border-primary bg-background"
                      />
                      <UnitLabel unit={sku.usageUom} className="w-6 text-left" />
                    </div>
                  </td>
                  <td
                    className={`px-3 py-2 text-right font-mono text-sm font-medium ${
                      !hasVariance ? "text-muted-foreground" : line.variance > 0 ? "text-success" : "text-destructive"
                    }`}
                  >
                    {line.physicalQty === null
                      ? "—"
                      : line.variance === 0
                        ? "0"
                        : (line.variance > 0 ? "+" : "") +
                          line.variance.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-1.5 py-1.5">
                    <Input
                      defaultValue={line.note}
                      key={`note-${line.id}-${line.note}`}
                      placeholder="Optional"
                      onBlur={(e) => {
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
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold tracking-tight">{t("title.stockCount")}</h2>
        <p className="text-sm text-muted-foreground mt-0.5">Physical inventory counts and variance adjustments</p>
      </div>

      {/* Top control bar */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-3 flex-wrap">
            <DatePicker
              value={selectedDate ? new Date(selectedDate + "T00:00:00") : undefined}
              onChange={(d) => setSelectedDate(d ? toLocalDateStr(d) : today)}
              defaultToday
              label="Date"
              labelPosition="left"
              align="start"
            />

            {sessionOptions.length > 0 && (
              <Select value={selectedDate} onValueChange={(val) => setSelectedDate(val)}>
                <SelectTrigger className="h-8 text-xs w-[320px]">
                  <SelectValue placeholder="Browse sessions" />
                </SelectTrigger>
                <SelectContent>
                  {sessionOptions.map((opt) => (
                    <SelectItem key={opt.id} value={opt.date} className="text-xs">
                      {opt.date} · {opt.counted}/{opt.total} counted · {opt.status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {sessionForDate && (
              <Badge variant={isCompleted ? "default" : "secondary"} className="text-xs px-2 py-0.5">
                {isCompleted ? (
                  <>
                    <Lock className="w-3 h-3 mr-1" /> Completed
                  </>
                ) : (
                  "Draft"
                )}
              </Badge>
            )}

            <div className="ml-auto flex items-center gap-2">
              {sessionForDate && isManagement && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-xs text-destructive hover:text-destructive"
                  onClick={() => setDeleteConfirm(selectedSessionId!)}
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete
                </Button>
              )}
              {!sessionForDate && (
                <Button size="sm" className="h-8 text-xs" onClick={handleCreate}>
                  <Plus className="w-3.5 h-3.5 mr-1" /> New Count Session
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Count Sheet */}
      {!selectedSession ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <ClipboardCheck className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No session for {selectedDate}</p>
            <p className="text-sm mt-1">Create a new count session to begin</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex gap-1 border rounded-lg p-1 bg-muted/40">
                {(["RM", "SM", "PK"] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setActiveTab(tab)}
                    className={cn(
                      "px-4 py-1.5 rounded-md text-sm font-medium transition-all",
                      activeTab === tab
                        ? "bg-foreground text-background shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {tab} ({tabCounts[tab]})
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-3">
                {activeTab === "RM" && (
                  <div className="flex items-center gap-2">
                    <Switch id="ck-items-toggle" checked={ckItemsOnly} onCheckedChange={setCkItemsOnly} />
                    <label htmlFor="ck-items-toggle" className="text-xs font-medium cursor-pointer">
                      CK Items Only
                    </label>
                  </div>
                )}

                <Select value={filterStorage} onValueChange={setFilterStorage}>
                  <SelectTrigger className="w-[130px] h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Storage</SelectItem>
                    {(["Frozen", "Chilled", "Ambient"] as StorageCondition[]).map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <TabsContent value="RM" className="mt-3">
              {renderCountTable()}
            </TabsContent>
            <TabsContent value="SM" className="mt-3">
              {renderCountTable()}
            </TabsContent>
            <TabsContent value="PK" className="mt-3">
              {renderCountTable()}
            </TabsContent>
          </Tabs>

          {/* Summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card>
              <CardContent className="p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t("summary.totalSkus")}
                </p>
                <p className="text-2xl font-bold mt-1">{summary.total}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t("summary.counted")}
                </p>
                <p className="text-2xl font-bold mt-1">{summary.counted}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t("summary.withVariance")}
                </p>
                <p className={`text-2xl font-bold mt-1 ${summary.withVariance > 0 ? "text-destructive" : ""}`}>
                  {summary.withVariance}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t("summary.varianceValue")}
                </p>
                <p
                  className={`text-2xl font-bold font-mono mt-1 ${summary.totalVarianceValue < 0 ? "text-destructive" : summary.totalVarianceValue > 0 ? "text-success" : ""}`}
                >
                  ฿
                  {summary.totalVarianceValue.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Confirm Button */}
          {!isCompleted && (
            <div className="flex justify-end">
              <Button
                variant="outline"
                onClick={() => setConfirmOpen(true)}
                disabled={summary.counted === 0}
                className="gap-2"
              >
                <CheckCircle2 className="w-4 h-4" /> {t("btn.confirmAdjust")}
              </Button>
            </div>
          )}
        </>
      )}

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
                    <TableRow className="bg-table-header border-b">
                      <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        SKU
                      </TableHead>
                      <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground text-right">
                        System
                      </TableHead>
                      <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground text-right">
                        Physical
                      </TableHead>
                      <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground text-right">
                        Adjustment
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {varianceLines.map((line) => {
                      const sku = skuMap[line.skuId];
                      return (
                        <TableRow
                          key={line.id}
                          className="border-b border-table-border hover:bg-table-hover transition-colors"
                        >
                          <TableCell className="px-3 py-2 text-sm font-medium">{sku?.name ?? line.skuId}</TableCell>
                          <TableCell className="px-3 py-2 text-sm font-mono text-right">
                            {line.systemQty.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                          </TableCell>
                          <TableCell className="px-3 py-2 text-sm font-mono text-right">
                            {line.physicalQty?.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                          </TableCell>
                          <TableCell
                            className={`px-3 py-2 text-sm font-mono text-right font-medium ${line.variance > 0 ? "text-success" : "text-destructive"}`}
                          >
                            {(line.variance > 0 ? "+" : "") +
                              line.variance.toLocaleString(undefined, { maximumFractionDigits: 2 })}
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
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleConfirmAdjust}>
              <CheckCircle2 className="w-4 h-4 mr-1" /> Apply {varianceLines.length} Adjustments
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!deleteConfirm}
        onOpenChange={(open) => !open && setDeleteConfirm(null)}
        title="Delete Count Session"
        description="This will reverse all stock adjustments from this session. This cannot be undone."
        confirmLabel="Delete"
        onConfirm={handleSoftDelete}
      />
    </div>
  );
}
