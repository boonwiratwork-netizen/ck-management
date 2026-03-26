import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { GoodsReceipt, getWeekNumber } from "@/types/goods-receipt";
import { SKU } from "@/types/sku";
import { Supplier } from "@/types/supplier";
import { Price } from "@/types/price";
import { BOMLine } from "@/types/bom";
import { useGoodsReceiptData } from "@/hooks/use-goods-receipt-data";
import { useSortableTable } from "@/hooks/use-sortable-table";
import { SortableHeader } from "@/components/SortableHeader";
import { SearchInput } from "@/components/SearchInput";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { Save, Plus, Trash2, Pencil, Check, CheckCircle, Search, PackageOpen } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useLanguage } from "@/hooks/use-language";
import { SearchableSelect } from "@/components/SearchableSelect";

interface Props {
  receiptData: ReturnType<typeof useGoodsReceiptData>;
  skus: SKU[];
  suppliers: Supplier[];
  prices: Price[];
  bomLines?: BOMLine[];
}

interface RowEdit {
  qty: number;
  actualTotal: number;
  actualManuallyEdited: boolean;
  note: string;
}

interface AdHocRow {
  tempId: string;
  skuId: string;
  qty: number;
  actualTotal: number;
  note: string;
  // SKU-mode fields
  supplierName?: string;
  resolvedSupplierId?: string;
  stdUnitPrice?: number;
}

export default function GoodsReceiptPage({ receiptData, skus, suppliers, prices, bomLines = [] }: Props) {
  const { receipts, addReceipt, deleteReceipt } = receiptData;
  const { t } = useLanguage();

  const [receiptDate, setReceiptDate] = useState<Date>(new Date());
  const [supplierId, setSupplierId] = useState<string>("");
  const [isSkuMode, setIsSkuMode] = useState(false);
  const [rowEdits, setRowEdits] = useState<Record<string, RowEdit>>({});
  const [adHocRows, setAdHocRows] = useState<AdHocRow[]>([]);
  const [savedCount, setSavedCount] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingSupplierId, setPendingSupplierId] = useState<string>("");
  const [supplierSearch, setSupplierSearch] = useState("");
  const [supplierDropdownOpen, setSupplierDropdownOpen] = useState(false);
  const supplierDropdownRef = useRef<HTMLDivElement>(null);

  // History filters
  const [histSearch, setHistSearch] = useState("");
  const [histFilterSupplier, setHistFilterSupplier] = useState("all");

  const dateStr = format(receiptDate, "yyyy-MM-dd");
  const weekNum = getWeekNumber(dateStr);

  const rmSkus = useMemo(() => skus.filter((s) => s.type === "RM"), [skus]);
  const skuMap = useMemo(() => Object.fromEntries(skus.map((s) => [s.id, s])), [skus]);
  const supplierMap = useMemo(() => Object.fromEntries(suppliers.map((s) => [s.id, s])), [suppliers]);
  const activeSuppliers = useMemo(() => suppliers.filter((s) => s.status === "Active"), [suppliers]);

  // BOM ingredient SKU IDs — SKUs that appear in any bom_lines
  const bomIngredientSkuIds = useMemo(() => {
    return new Set(bomLines.map((l) => l.rmSkuId));
  }, [bomLines]);

  // CK supplier IDs — suppliers with at least one SKU in BOM ingredients in active prices
  const ckSupplierIds = useMemo(() => {
    const ids = new Set<string>();
    prices.filter((p) => p.isActive && bomIngredientSkuIds.has(p.skuId)).forEach((p) => ids.add(p.supplierId));
    return ids;
  }, [prices, bomIngredientSkuIds]);

  // Grouped suppliers for searchable dropdown
  const groupedSuppliers = useMemo(() => {
    const ckGroup = activeSuppliers.filter((s) => ckSupplierIds.has(s.id)).sort((a, b) => a.name.localeCompare(b.name));
    const otherGroup = activeSuppliers
      .filter((s) => !ckSupplierIds.has(s.id))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { ck: ckGroup, other: otherGroup };
  }, [activeSuppliers, ckSupplierIds]);

  // Filter suppliers by search
  const filteredGroupedSuppliers = useMemo(() => {
    const q = supplierSearch.toLowerCase();
    if (!q) return groupedSuppliers;
    return {
      ck: groupedSuppliers.ck.filter((s) => s.name.toLowerCase().includes(q)),
      other: groupedSuppliers.other.filter((s) => s.name.toLowerCase().includes(q)),
    };
  }, [groupedSuppliers, supplierSearch]);

  // Close supplier dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (supplierDropdownRef.current && !supplierDropdownRef.current.contains(e.target as Node)) {
        setSupplierDropdownOpen(false);
      }
    };
    if (supplierDropdownOpen) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [supplierDropdownOpen]);

  // Pre-loaded SKUs for selected supplier from active Price Master, filtered to BOM ingredients
  const preloadedRows = useMemo(() => {
    if (!supplierId) return [];
    const activePrices = prices.filter((p) => p.supplierId === supplierId && p.isActive);
    return activePrices
      .map((p) => {
        const sku = skuMap[p.skuId];
        if (!sku || sku.type !== "RM") return null;
        // FIX 2: Only include SKUs that are BOM ingredients
        if (!bomIngredientSkuIds.has(p.skuId) && !sku.isDistributable) return null;
        return { priceId: p.id, skuId: p.skuId, sku, stdUnitPrice: p.pricePerUsageUom };
      })
      .filter(Boolean)
      .sort((a, b) => a!.sku.skuId.localeCompare(b!.sku.skuId)) as {
      priceId: string;
      skuId: string;
      sku: SKU;
      stdUnitPrice: number;
    }[];
  }, [supplierId, prices, skuMap, bomIngredientSkuIds]);

  const selectedSupplier = supplierMap[supplierId];

  const hasAnyQty = useMemo(() => {
    return Object.values(rowEdits).some((e) => e.qty > 0) || adHocRows.some((r) => r.qty > 0);
  }, [rowEdits, adHocRows]);

  const handleSupplierChange = useCallback(
    (newId: string) => {
      if (newId === supplierId) return;
      if (hasAnyQty) {
        setPendingSupplierId(newId);
        setConfirmOpen(true);
      } else {
        setSupplierId(newId);
        setRowEdits({});
        setAdHocRows([]);
        setSavedCount(null);
      }
      setSupplierDropdownOpen(false);
      setSupplierSearch("");
    },
    [supplierId, hasAnyQty],
  );

  const confirmSupplierChange = useCallback(() => {
    setSupplierId(pendingSupplierId);
    setRowEdits({});
    setAdHocRows([]);
    setSavedCount(null);
    setConfirmOpen(false);
  }, [pendingSupplierId]);

  const getRowEdit = (skuId: string): RowEdit =>
    rowEdits[skuId] || { qty: 0, actualTotal: 0, actualManuallyEdited: false, note: "" };

  const updateRowEdit = useCallback((skuId: string, updates: Partial<RowEdit>) => {
    setRowEdits((prev) => ({
      ...prev,
      [skuId]: { ...getRowEditFromPrev(prev, skuId), ...updates },
    }));
  }, []);

  const qtyRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Save all
  const handleSaveAll = useCallback(async () => {
    if (isSaving) return;
    setIsSaving(true);
    const rowsToSave: { skuId: string; qty: number; actualTotal: number; note: string; overrideSupplierId?: string; overridePriceVariance?: number }[] = [];

    // Pre-loaded rows with qty > 0 (supplier mode only)
    for (const row of preloadedRows) {
      const edit = rowEdits[row.skuId];
      if (edit && edit.qty > 0) {
        rowsToSave.push({ skuId: row.skuId, qty: edit.qty, actualTotal: edit.actualTotal, note: edit.note });
      }
    }

    // Ad-hoc rows with qty > 0
    for (const r of adHocRows) {
      if (r.skuId && r.qty > 0) {
        if (isSkuMode) {
          // Resolve supplier for SKU mode
          const typedName = (r.supplierName || "").trim();
          const matchedSupplier = suppliers.find((s) => s.name.toLowerCase() === typedName.toLowerCase());
          if (matchedSupplier) {
            rowsToSave.push({ skuId: r.skuId, qty: r.qty, actualTotal: r.actualTotal, note: r.note, overrideSupplierId: matchedSupplier.id });
          } else if (r.resolvedSupplierId) {
            // Free text — store typed name in notes, variance = 0
            const noteWithSupplier = typedName ? `[Supplier: ${typedName}] ${r.note}`.trim() : r.note;
            rowsToSave.push({ skuId: r.skuId, qty: r.qty, actualTotal: r.actualTotal, note: noteWithSupplier, overrideSupplierId: r.resolvedSupplierId, overridePriceVariance: 0 });
          } else {
            toast.error(`No supplier resolved for SKU ${skuMap[r.skuId]?.name || r.skuId}`);
            setIsSaving(false);
            return;
          }
        } else {
          rowsToSave.push({ skuId: r.skuId, qty: r.qty, actualTotal: r.actualTotal, note: r.note });
        }
      }
    }

    if (rowsToSave.length === 0) {
      toast.error("No rows with quantity to save");
      setIsSaving(false);
      return;
    }

    let count = 0;
    for (const row of rowsToSave) {
      const sku = skuMap[row.skuId];
      const effectiveSupplierId = row.overrideSupplierId || supplierId;
      await addReceipt(
        {
          receiptDate: dateStr,
          skuId: row.skuId,
          supplierId: effectiveSupplierId,
          quantityReceived: row.qty,
          actualTotal: row.actualTotal,
          note: row.note,
        },
        sku,
        prices,
      );
      count++;
    }

    setIsSaving(false);
    if (count > 0) {
      setSavedCount(count);
      toast.success(`${count} items saved`);
      // Auto-close: reset to idle state
      setSupplierId("");
      setIsSkuMode(false);
      setRowEdits({});
      setAdHocRows([]);
      setTimeout(() => setSavedCount(null), 4000);
    }
  }, [preloadedRows, rowEdits, adHocRows, dateStr, supplierId, skuMap, prices, addReceipt, isSaving, isSkuMode, suppliers]);

  // Ad-hoc row management
  const handleAddAdHoc = useCallback(() => {
    setAdHocRows((prev) => [...prev, { tempId: crypto.randomUUID(), skuId: "", qty: 0, actualTotal: 0, note: "" }]);
  }, []);

  const updateAdHoc = useCallback((tempId: string, updates: Partial<AdHocRow>) => {
    setAdHocRows((prev) => prev.map((r) => {
      if (r.tempId !== tempId) return r;
      const updated = { ...r, ...updates };
      // In SKU mode, auto-fill supplier when SKU changes
      if (isSkuMode && updates.skuId && updates.skuId !== r.skuId) {
        const activePrice = prices.find((p) => p.skuId === updates.skuId && p.isActive);
        if (activePrice) {
          const sup = supplierMap[activePrice.supplierId];
          updated.supplierName = sup?.name || "";
          updated.resolvedSupplierId = activePrice.supplierId;
          updated.stdUnitPrice = activePrice.pricePerUsageUom;
        } else {
          updated.supplierName = "";
          updated.resolvedSupplierId = "";
          updated.stdUnitPrice = 0;
        }
      }
      return updated;
    }));
  }, [isSkuMode, prices, supplierMap]);

  const deleteAdHoc = useCallback((tempId: string) => {
    setAdHocRows((prev) => prev.filter((r) => r.tempId !== tempId));
  }, []);

  // Receipt history
  const filteredHistory = useMemo(() => {
    return receipts.filter((r) => {
      const sku = skuMap[r.skuId];
      const supplier = supplierMap[r.supplierId];
      const matchesSearch =
        (sku?.name || "").toLowerCase().includes(histSearch.toLowerCase()) ||
        (sku?.skuId || "").toLowerCase().includes(histSearch.toLowerCase()) ||
        (supplier?.name || "").toLowerCase().includes(histSearch.toLowerCase());
      const matchesSupplier = histFilterSupplier === "all" || r.supplierId === histFilterSupplier;
      return matchesSearch && matchesSupplier;
    });
  }, [receipts, skuMap, supplierMap, histSearch, histFilterSupplier]);

  const comparators = useMemo(
    () => ({
      date: (a: GoodsReceipt, b: GoodsReceipt) => a.receiptDate.localeCompare(b.receiptDate),
      week: (a: GoodsReceipt, b: GoodsReceipt) => a.weekNumber - b.weekNumber,
      sku: (a: GoodsReceipt, b: GoodsReceipt) =>
        (skuMap[a.skuId]?.name || "").localeCompare(skuMap[b.skuId]?.name || ""),
      supplier: (a: GoodsReceipt, b: GoodsReceipt) =>
        (supplierMap[a.supplierId]?.name || "").localeCompare(supplierMap[b.supplierId]?.name || ""),
      qty: (a: GoodsReceipt, b: GoodsReceipt) => a.quantityReceived - b.quantityReceived,
      actualTotal: (a: GoodsReceipt, b: GoodsReceipt) => a.actualTotal - b.actualTotal,
      variance: (a: GoodsReceipt, b: GoodsReceipt) => a.priceVariance - b.priceVariance,
    }),
    [skuMap, supplierMap],
  );

  const {
    sorted: sortedHistory,
    sortKey: hSortKey,
    sortDir: hSortDir,
    handleSort: hHandleSort,
  } = useSortableTable(filteredHistory, comparators);
  const displayHistory = hSortKey
    ? sortedHistory
    : [...filteredHistory].sort((a, b) => b.receiptDate.localeCompare(a.receiptDate));

  const thClass =
    "text-left px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground whitespace-nowrap";
  const tdReadOnly = "px-3 py-2 text-sm";

  const savableCount = useMemo(() => {
    let c = 0;
    for (const row of preloadedRows) {
      const edit = rowEdits[row.skuId];
      if (edit && edit.qty > 0) c++;
    }
    for (const r of adHocRows) {
      if (r.skuId && r.qty > 0) c++;
    }
    return c;
  }, [preloadedRows, rowEdits, adHocRows]);

  // Compute total actual value for form footer
  const totalActualValue = useMemo(() => {
    let total = 0;
    for (const row of preloadedRows) {
      const edit = rowEdits[row.skuId];
      if (edit && edit.qty > 0) {
        total += edit.actualManuallyEdited ? edit.actualTotal : row.stdUnitPrice * edit.qty;
      }
    }
    for (const r of adHocRows) {
      if (r.skuId && r.qty > 0) total += r.actualTotal;
    }
    return total;
  }, [preloadedRows, rowEdits, adHocRows]);

  const ConfirmReceiptButton = ({ className: btnClassName }: { className?: string }) => (
    <div className={cn("flex items-center gap-2", btnClassName)}>
      <Button
        onClick={handleSaveAll}
        disabled={savableCount === 0 || isSaving}
        className="bg-success hover:bg-success/90 text-success-foreground"
      >
        <CheckCircle className="w-4 h-4 mr-1" /> Confirm Receipt ({savableCount})
      </Button>
      {savedCount !== null && (
        <span className="text-xs text-success font-medium flex items-center gap-1 animate-fade-in">
          <CheckCircle className="w-3.5 h-3.5" /> {savedCount} {t("gr.itemsSaved")}
        </span>
      )}
    </div>
  );

  const isFormActive = !!supplierId || isSkuMode;

  return (
    <div className="space-y-6">
      {/* ── Page Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-heading font-bold">{t("title.goodsReceipt")}</h2>
          <p className="text-sm text-muted-foreground mt-0.5">{t("gr.subtitle")}</p>
        </div>
        {!isFormActive && (
          <div className="flex items-center gap-2">
            <DatePicker
              value={receiptDate}
              onChange={(d) => d && setReceiptDate(d)}
              defaultToday
              align="end"
            />
          </div>
        )}
      </div>

      {/* ── Active Receipt Form ── */}
      {isFormActive ? (
        <div className="rounded-lg border-2 border-primary/20 bg-card overflow-hidden shadow-sm">
          {/* Header strip */}
          <div className="flex items-center justify-between px-5 py-3 bg-primary/[0.06] border-b border-primary/10">
            <div className="flex items-center gap-4">
              <span className="font-mono text-sm font-semibold text-foreground bg-muted px-2.5 py-1 rounded">
                GR-{dateStr.replace(/-/g, "").slice(2)}
              </span>
              {isSkuMode ? (
                <span className="text-sm font-medium text-foreground">Receive by SKU</span>
              ) : (
                <>
                  <span className="text-sm font-medium text-foreground">{selectedSupplier?.name}</span>
                  <span className="text-xs text-muted-foreground">{preloadedRows.length} items</span>
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSupplierId("");
                  setIsSkuMode(false);
                  setRowEdits({});
                  setAdHocRows([]);
                  setSavedCount(null);
                }}
              >
                Cancel
              </Button>
              <Button variant="outline" size="sm" disabled>
                <Save className="w-3.5 h-3.5 mr-1" /> Save Draft
              </Button>
              <ConfirmReceiptButton />
            </div>
          </div>

          {/* Meta bar */}
          <div className="flex flex-wrap items-end gap-4 px-5 py-3 bg-muted/30 border-b">
            <DatePicker
              value={receiptDate}
              onChange={(d) => d && setReceiptDate(d)}
              defaultToday
              label={t("col.date")}
              required
              labelPosition="above"
              align="start"
            />
            {/* Supplier selector */}
            <div className="relative" ref={supplierDropdownRef}>
              <label className="text-xs font-medium text-muted-foreground mb-1 block label-required">
                {t("col.supplier")}
              </label>
              <button
                type="button"
                onClick={() => setSupplierDropdownOpen(!supplierDropdownOpen)}
                className={cn(
                  "flex items-center justify-between w-[240px] h-9 px-3 py-2 text-sm border rounded-md bg-background hover:bg-accent/50 transition-colors",
                  !supplierId && "text-muted-foreground",
                )}
              >
                <span className="truncate">{selectedSupplier?.name || "— Select supplier —"}</span>
                <Search className="w-3.5 h-3.5 ml-2 shrink-0 text-muted-foreground" />
              </button>
              {supplierDropdownOpen && (
                <div className="absolute z-50 top-full mt-1 w-[280px] bg-popover border rounded-lg shadow-lg">
                  <div className="p-2 border-b">
                    <input
                      type="text"
                      value={supplierSearch}
                      onChange={(e) => setSupplierSearch(e.target.value)}
                      placeholder="Search supplier..."
                      className="w-full h-8 px-2 text-sm border rounded-md bg-background focus:border-primary outline-none"
                      autoFocus
                    />
                  </div>
                  <div className="max-h-60 overflow-y-auto py-1">
                    {filteredGroupedSuppliers.ck.length > 0 && (
                      <>
                        <div className="px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          {t("gr.ckSuppliers")}
                        </div>
                        {filteredGroupedSuppliers.ck.map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => handleSupplierChange(s.id)}
                            className={cn(
                              "w-full text-left px-3 py-1.5 text-sm hover:bg-accent transition-colors",
                              s.id === supplierId && "bg-accent font-medium",
                            )}
                          >
                            {s.name}
                          </button>
                        ))}
                      </>
                    )}
                    {filteredGroupedSuppliers.other.length > 0 && (
                      <>
                        <div className="px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          {t("gr.otherSuppliers")}
                        </div>
                        {filteredGroupedSuppliers.other.map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => handleSupplierChange(s.id)}
                            className={cn(
                              "w-full text-left px-3 py-1.5 text-sm hover:bg-accent transition-colors",
                              s.id === supplierId && "bg-accent font-medium",
                            )}
                          >
                            {s.name}
                          </button>
                        ))}
                      </>
                    )}
                    {filteredGroupedSuppliers.ck.length === 0 && filteredGroupedSuppliers.other.length === 0 && (
                      <p className="px-3 py-4 text-sm text-muted-foreground text-center">{t("gr.noSuppliersFound")}</p>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="kbd-hint">
              <kbd>Tab</kbd> — next QTY · <kbd>Enter</kbd> — save · <kbd>Esc</kbd> — cancel
            </div>
          </div>

          {/* SKU spreadsheet table */}
          {preloadedRows.length > 0 && (
            <div className="overflow-y-auto max-h-[65vh]">
              <table className="w-full text-sm table-fixed">
                <colgroup>
                  <col style={{ width: 90 }} />
                  <col style={{ width: 36 }} />
                  <col style={{ width: 200 }} />
                  <col style={{ width: 120 }} />
                  <col style={{ width: 80 }} />
                  <col style={{ width: 50 }} />
                  <col style={{ width: 90 }} />
                  <col style={{ width: 70 }} />
                  <col style={{ width: 70 }} />
                  <col style={{ width: 80 }} />
                  <col style={{ width: 80 }} />
                  <col style={{ width: 100 }} />
                </colgroup>
                <thead className="sticky top-0 z-[5]">
                  <tr className="bg-table-header border-b">
                    <th className={thClass}>{t("col.date")}</th>
                    <th className={`${thClass} text-center`}>{t("col.week")}</th>
                    <th className={thClass}>{t("col.sku")}</th>
                    <th className={thClass}>{t("col.supplier")}</th>
                    <th className={`${thClass} text-right !bg-foreground !text-background font-semibold`}>
                      {t("col.qty")}
                    </th>
                    <th className={`${thClass} text-center`}>{t("col.uom")}</th>
                    <th className={`${thClass} text-right`}>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help border-b border-dashed border-muted-foreground">
                              {t("gr.colActualBaht")}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="top">
                            <p>Verify actual price paid</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </th>
                    <th className={`${thClass} text-right`}>{t("gr.colUnitBaht")}</th>
                    <th className={`${thClass} text-right`}>{t("gr.colStdBaht")}</th>
                    <th className={`${thClass} text-right`}>{t("gr.colStdTot")}</th>
                    <th className={`${thClass} text-right`}>{t("gr.colVar")}</th>
                    <th className={thClass}>{t("col.note")}</th>
                  </tr>
                </thead>
                <tbody>
                  {preloadedRows.map((row, idx) => {
                    const edit = getRowEdit(row.skuId);
                    const stdTotal = row.stdUnitPrice * edit.qty;
                    const actualTotal = edit.actualManuallyEdited ? edit.actualTotal : stdTotal;
                    const unitPrice = edit.qty > 0 ? actualTotal / edit.qty : 0;
                    const variance = actualTotal - stdTotal;
                    const hasQty = edit.qty > 0;
                    const actualMatchesStd = !edit.actualManuallyEdited || Math.abs(actualTotal - stdTotal) < 0.01;

                    return (
                      <tr
                        key={row.skuId}
                        className={cn(
                          "border-b last:border-0 transition-colors",
                          hasQty ? "bg-success/5 border-l-[3px] border-l-success" : "opacity-40",
                        )}
                      >
                        <td className={`${tdReadOnly} text-muted-foreground`}>{dateStr}</td>
                        <td className={`${tdReadOnly} text-center font-mono text-muted-foreground`}>{weekNum}</td>
                        <td className={tdReadOnly}>
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="truncate">
                                  <span
                                    className={cn(
                                      "font-mono text-xs",
                                      hasQty ? "text-foreground/70 font-medium" : "text-muted-foreground",
                                    )}
                                  >
                                    {row.sku.skuId}
                                  </span>
                                  <span className={cn("ml-1", hasQty ? "font-semibold text-foreground" : "")}>
                                    {row.sku.name}
                                  </span>
                                </div>
                              </TooltipTrigger>
                              <TooltipContent side="top">
                                <p className="font-medium">
                                  {row.sku.skuId} — {row.sku.name}
                                </p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </td>
                        <td className={`${tdReadOnly} text-muted-foreground truncate`}>{selectedSupplier?.name}</td>
                        <td className="px-1 py-1">
                          <input
                            ref={(el) => {
                              qtyRefs.current[row.skuId] = el;
                            }}
                            type="number"
                            min={0}
                            step="any"
                            defaultValue={edit.qty || ""}
                            key={`qty-${row.skuId}-${savedCount}`}
                            onBlur={(e) => {
                              const val = Number(e.target.value) || 0;
                              updateRowEdit(row.skuId, {
                                qty: val,
                                ...(!rowEdits[row.skuId]?.actualManuallyEdited
                                  ? { actualTotal: row.stdUnitPrice * val }
                                  : {}),
                              });
                            }}
                            onFocus={(e) => e.target.select()}
                            className={cn(
                              "h-8 text-xs text-right w-full font-mono px-2 py-1 border-2 rounded-md bg-background focus:border-primary focus:ring-1 focus:ring-primary/30 outline-none",
                              hasQty ? "border-success font-bold text-success" : "border-primary/30",
                            )}
                            placeholder="0"
                          />
                        </td>
                        <td className={`${tdReadOnly} text-center text-muted-foreground`}>{row.sku.purchaseUom}</td>
                        <td className="px-1 py-1">
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              min={0}
                              step="any"
                              defaultValue={actualTotal || ""}
                              key={`actual-${row.skuId}-${edit.qty}-${edit.actualManuallyEdited ? "manual" : "auto"}-${savedCount}`}
                              tabIndex={-1}
                              onBlur={(e) => {
                                const val = Number(e.target.value) || 0;
                                updateRowEdit(row.skuId, { actualTotal: val, actualManuallyEdited: true });
                              }}
                              onFocus={(e) => e.target.select()}
                              className={cn(
                                "h-8 text-xs text-right font-mono px-2 py-1 border rounded-md outline-none min-w-0 flex-1",
                                hasQty && !actualMatchesStd
                                  ? "bg-warning/10 border-warning/40 focus:border-warning"
                                  : "bg-warning/5 border-warning/20 focus:border-primary",
                              )}
                              placeholder="0.00"
                            />
                            {hasQty && actualMatchesStd && (
                              <span className="text-xs text-muted-foreground bg-muted px-1 rounded whitespace-nowrap shrink-0">
                                = STD
                              </span>
                            )}
                          </div>
                        </td>
                        <td className={`${tdReadOnly} text-right font-mono text-muted-foreground`}>
                          {unitPrice > 0 ? unitPrice.toFixed(2) : "—"}
                        </td>
                        <td className={`${tdReadOnly} text-right font-mono text-muted-foreground`}>
                          {row.stdUnitPrice > 0 ? row.stdUnitPrice.toFixed(2) : "—"}
                        </td>
                        <td className={`${tdReadOnly} text-right font-mono text-muted-foreground`}>
                          {stdTotal > 0
                            ? stdTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                            : "—"}
                        </td>
                        <td
                          className={cn(
                            `${tdReadOnly} text-right font-mono`,
                            hasQty && variance !== 0 ? "font-bold" : "font-semibold",
                            variance < 0 ? "text-success" : variance > 0 ? "text-destructive" : "text-muted-foreground",
                          )}
                        >
                          {hasQty ? (
                            <>
                              {variance > 0 ? "+" : ""}
                              {variance.toLocaleString(undefined, {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-1 py-1">
                          <input
                            type="text"
                            defaultValue={edit.note}
                            key={`note-${row.skuId}-${savedCount}`}
                            tabIndex={-1}
                            onBlur={(e) => updateRowEdit(row.skuId, { note: e.target.value })}
                            className="h-8 text-xs w-full px-2 py-1 border rounded-md bg-background focus:border-primary outline-none"
                            placeholder="Note"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Ad-hoc rows */}
          <div className="px-5 py-3 space-y-2 border-t">
            {adHocRows.length > 0 && (
              <>
                <p className="text-xs font-medium text-muted-foreground">
                  {isSkuMode ? "Items" : t("gr.adHocItems")}
                </p>
                <div className="rounded-lg border bg-card overflow-hidden">
                  <table className="w-full text-sm table-fixed">
                    <colgroup>
                      <col style={{ width: 220 }} />
                      {isSkuMode && <col style={{ width: 150 }} />}
                      <col style={{ width: 80 }} />
                      <col style={{ width: 50 }} />
                      {isSkuMode && <col style={{ width: 70 }} />}
                      <col style={{ width: 90 }} />
                      <col style={{ width: 100 }} />
                      <col style={{ width: 50 }} />
                    </colgroup>
                    <thead>
                      <tr className="bg-table-header border-b">
                        <th className={thClass}>{t("col.sku")}</th>
                        {isSkuMode && <th className={thClass}>{t("col.supplier")}</th>}
                        <th className={`${thClass} text-right`}>{t("col.qty")}</th>
                        <th className={`${thClass} text-center`}>{t("col.uom")}</th>
                        {isSkuMode && <th className={`${thClass} text-right`}>{t("gr.colStdBaht")}</th>}
                        <th className={`${thClass} text-right`}>{t("gr.colActualBaht")}</th>
                        <th className={thClass}>{t("col.note")}</th>
                        <th className={`${thClass} text-center`}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {adHocRows.map((row) => {
                        const sku = skuMap[row.skuId];
                        return (
                          <tr key={row.tempId} className="border-b last:border-0 bg-accent/50">
                            <td className="px-1 py-1">
                              <SearchableSelect
                                value={row.skuId}
                                onValueChange={(v) => updateAdHoc(row.tempId, { skuId: v })}
                                options={rmSkus.map((s) => ({
                                  value: s.id,
                                  label: `${s.skuId} — ${s.name}`,
                                  sublabel: s.skuId,
                                }))}
                                placeholder="Select SKU"
                                triggerClassName="h-8 text-xs truncate"
                              />
                            </td>
                            {isSkuMode && (
                              <td className="px-1 py-1">
                                <input
                                  type="text"
                                  value={row.supplierName ?? ""}
                                  onChange={(e) => updateAdHoc(row.tempId, { supplierName: e.target.value })}
                                  className="h-8 text-xs w-full px-2 py-1 border rounded-md bg-background focus:border-primary outline-none"
                                  placeholder="Supplier"
                                />
                              </td>
                            )}
                            <td className="px-1 py-1">
                              <input
                                type="number"
                                min={0}
                                step="any"
                                defaultValue={row.qty || ""}
                                key={`adhoc-qty-${row.tempId}`}
                                onBlur={(e) => updateAdHoc(row.tempId, { qty: Number(e.target.value) || 0 })}
                                onFocus={(e) => e.target.select()}
                                className="h-8 text-xs text-right w-full font-mono px-2 py-1 border-2 border-primary/30 rounded-md bg-background focus:border-primary outline-none"
                                placeholder="0"
                              />
                            </td>
                            <td className={`${tdReadOnly} text-center text-muted-foreground`}>
                              {sku?.purchaseUom || "—"}
                            </td>
                            {isSkuMode && (
                              <td className={`${tdReadOnly} text-right font-mono text-muted-foreground`}>
                                {(row.stdUnitPrice ?? 0) > 0 ? row.stdUnitPrice!.toFixed(2) : "—"}
                              </td>
                            )}
                            <td className="px-1 py-1">
                              <input
                                type="number"
                                min={0}
                                step="any"
                                defaultValue={row.actualTotal || ""}
                                key={`adhoc-actual-${row.tempId}`}
                                onBlur={(e) => updateAdHoc(row.tempId, { actualTotal: Number(e.target.value) || 0 })}
                                onFocus={(e) => e.target.select()}
                                className="h-8 text-xs text-right w-full font-mono px-2 py-1 border rounded-md bg-warning/5 border-warning/20 focus:border-primary outline-none"
                                placeholder="0.00"
                              />
                            </td>
                            <td className="px-1 py-1">
                              <input
                                type="text"
                                defaultValue={row.note}
                                key={`adhoc-note-${row.tempId}`}
                                onBlur={(e) => updateAdHoc(row.tempId, { note: e.target.value })}
                                className="h-8 text-xs w-full px-2 py-1 border rounded-md bg-background focus:border-primary outline-none"
                                placeholder="Note"
                              />
                            </td>
                            <td className="px-1 py-1 text-center">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-destructive hover:text-destructive"
                                onClick={() => deleteAdHoc(row.tempId)}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            <button
              type="button"
              onClick={handleAddAdHoc}
              className="w-full border-2 border-dashed border-primary/40 text-primary hover:border-primary/60 hover:bg-accent rounded-md py-2 text-sm transition-colors flex items-center justify-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" /> {t("btn.addRow")}
            </button>
          </div>

          {/* Footer bar */}
          <div className="flex items-center justify-between px-5 py-3 bg-muted/30 border-t">
            <div className="text-sm text-muted-foreground">
              Total Value:{" "}
              <span className="font-mono font-semibold text-foreground">
                ฿{totalActualValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
            <ConfirmReceiptButton />
          </div>
        </div>
      ) : (
        /* ── Empty State — two mode buttons ── */
        <div className="rounded-lg border bg-card">
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <div className="w-14 h-14 rounded-full bg-success/10 flex items-center justify-center">
              <PackageOpen className="w-7 h-7 text-success" />
            </div>
            <div className="text-center">
              <p className="font-medium text-foreground">No active receipt</p>
              <p className="text-sm text-muted-foreground mt-1">Choose a receiving mode to start</p>
            </div>
            <div className="flex items-center gap-3 mt-2">
              {/* Receive by Supplier — triggers existing supplier dropdown */}
              <div className="relative" ref={!isFormActive ? supplierDropdownRef : undefined}>
                <button
                  type="button"
                  onClick={() => setSupplierDropdownOpen(!supplierDropdownOpen)}
                  className="inline-flex items-center gap-2 bg-success hover:bg-success/90 text-success-foreground px-4 py-2 rounded-md text-sm font-medium transition-colors"
                >
                  <Plus className="w-4 h-4" /> Receive by Supplier
                </button>
                {supplierDropdownOpen && (
                  <div className="absolute z-50 top-full mt-1 left-1/2 -translate-x-1/2 w-[280px] bg-popover border rounded-lg shadow-lg">
                    <div className="p-2 border-b">
                      <input
                        type="text"
                        value={supplierSearch}
                        onChange={(e) => setSupplierSearch(e.target.value)}
                        placeholder="Search supplier..."
                        className="w-full h-8 px-2 text-sm border rounded-md bg-background focus:border-primary outline-none"
                        autoFocus
                      />
                    </div>
                    <div className="max-h-60 overflow-y-auto py-1">
                      {filteredGroupedSuppliers.ck.length > 0 && (
                        <>
                          <div className="px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            {t("gr.ckSuppliers")}
                          </div>
                          {filteredGroupedSuppliers.ck.map((s) => (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => handleSupplierChange(s.id)}
                              className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent transition-colors"
                            >
                              {s.name}
                            </button>
                          ))}
                        </>
                      )}
                      {filteredGroupedSuppliers.other.length > 0 && (
                        <>
                          <div className="px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            {t("gr.otherSuppliers")}
                          </div>
                          {filteredGroupedSuppliers.other.map((s) => (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => handleSupplierChange(s.id)}
                              className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent transition-colors"
                            >
                              {s.name}
                            </button>
                          ))}
                        </>
                      )}
                      {filteredGroupedSuppliers.ck.length === 0 && filteredGroupedSuppliers.other.length === 0 && (
                        <p className="px-3 py-4 text-sm text-muted-foreground text-center">{t("gr.noSuppliersFound")}</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
              {/* Receive by SKU */}
              <Button
                variant="outline"
                onClick={() => {
                  setIsSkuMode(true);
                  setAdHocRows([{ tempId: crypto.randomUUID(), skuId: "", qty: 0, actualTotal: 0, note: "" }]);
                }}
              >
                <Search className="w-4 h-4 mr-1" /> Receive by SKU
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── GR History — separated by divider ── */}
      <div className="pt-2">
        <Separator className="mb-3" />
        <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">GR History</span>
      </div>

      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <SearchInput
            value={histSearch}
            onChange={setHistSearch}
            placeholder="Search SKU or supplier..."
            className="flex-1"
            totalCount={receipts.length}
            filteredCount={filteredHistory.length}
            entityName="receipts"
          />
          <Select value={histFilterSupplier} onValueChange={setHistFilterSupplier}>
            <SelectTrigger className="w-full sm:w-[200px]">
              <SelectValue placeholder="All Suppliers" />
            </SelectTrigger>
            <SelectContent className="max-h-60">
              <SelectItem value="all">{t("common.allSuppliers")}</SelectItem>
              {suppliers.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="overflow-y-auto max-h-[65vh]">
            <table className="w-full text-sm table-fixed">
              <colgroup>
                <col style={{ width: 90 }} />
                <col style={{ width: 36 }} />
                <col style={{ width: 200 }} />
                <col style={{ width: 120 }} />
                <col style={{ width: 70 }} />
                <col style={{ width: 50 }} />
                <col style={{ width: 90 }} />
                <col style={{ width: 70 }} />
                <col style={{ width: 70 }} />
                <col style={{ width: 80 }} />
                <col style={{ width: 80 }} />
                <col style={{ width: 80 }} />
                <col style={{ width: 60 }} />
              </colgroup>
              <thead className="sticky top-0 z-[5]">
                <tr className="bg-table-header border-b">
                  <th className={`${thClass} cursor-pointer`} onClick={() => hHandleSort("date")}>
                    <SortableHeader
                      label={t("col.date")}
                      sortKey="date"
                      activeSortKey={hSortKey}
                      sortDir={hSortDir}
                      onSort={hHandleSort}
                    />
                  </th>
                  <th className={`${thClass} text-center cursor-pointer`} onClick={() => hHandleSort("week")}>
                    <SortableHeader
                      label={t("col.week")}
                      sortKey="week"
                      activeSortKey={hSortKey}
                      sortDir={hSortDir}
                      onSort={hHandleSort}
                    />
                  </th>
                  <th className={`${thClass} cursor-pointer`} onClick={() => hHandleSort("sku")}>
                    <SortableHeader
                      label={t("col.sku")}
                      sortKey="sku"
                      activeSortKey={hSortKey}
                      sortDir={hSortDir}
                      onSort={hHandleSort}
                    />
                  </th>
                  <th className={`${thClass} cursor-pointer`} onClick={() => hHandleSort("supplier")}>
                    <SortableHeader
                      label={t("col.supplier")}
                      sortKey="supplier"
                      activeSortKey={hSortKey}
                      sortDir={hSortDir}
                      onSort={hHandleSort}
                    />
                  </th>
                  <th className={`${thClass} text-right cursor-pointer`} onClick={() => hHandleSort("qty")}>
                    <SortableHeader
                      label={t("col.qty")}
                      sortKey="qty"
                      activeSortKey={hSortKey}
                      sortDir={hSortDir}
                      onSort={hHandleSort}
                      className="justify-end"
                    />
                  </th>
                  <th className={`${thClass} text-center`}>{t("col.uom")}</th>
                  <th className={`${thClass} text-right cursor-pointer`} onClick={() => hHandleSort("actualTotal")}>
                    <SortableHeader
                      label={t("gr.colActualBaht")}
                      sortKey="actualTotal"
                      activeSortKey={hSortKey}
                      sortDir={hSortDir}
                      onSort={hHandleSort}
                      className="justify-end"
                    />
                  </th>
                  <th className={`${thClass} text-right`}>{t("gr.colUnitBaht")}</th>
                  <th className={`${thClass} text-right`}>{t("gr.colStdBaht")}</th>
                  <th className={`${thClass} text-right`}>{t("gr.colStdTot")}</th>
                  <th className={`${thClass} text-right cursor-pointer`} onClick={() => hHandleSort("variance")}>
                    <SortableHeader
                      label={t("gr.colVar")}
                      sortKey="variance"
                      activeSortKey={hSortKey}
                      sortDir={hSortDir}
                      onSort={hHandleSort}
                      className="justify-end"
                    />
                  </th>
                  <th className={thClass}>{t("col.note")}</th>
                  <th className={`${thClass} text-center`}></th>
                </tr>
              </thead>
              <tbody>
                {displayHistory.length === 0 ? (
                  <tr>
                    <td colSpan={13} className="px-4 py-12 text-center text-muted-foreground">
                      {t("gr.noReceiptsFound")}
                    </td>
                  </tr>
                ) : (
                  displayHistory.map((r) => {
                    const sku = skuMap[r.skuId];
                    const supplier = supplierMap[r.supplierId];
                    return (
                      <TooltipProvider key={r.id}>
                        <tr className="border-b border-table-border last:border-0 hover:bg-table-hover transition-colors">
                          <td className={tdReadOnly}>{r.receiptDate}</td>
                          <td className={`${tdReadOnly} text-center font-mono`}>{r.weekNumber}</td>
                          <td className={tdReadOnly}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="truncate">
                                  <span className="font-mono text-xs text-muted-foreground">{sku?.skuId}</span>
                                  <span className="ml-1 font-medium">{sku?.name || "—"}</span>
                                </div>
                              </TooltipTrigger>
                              <TooltipContent side="top">
                                <p>
                                  {sku?.skuId} — {sku?.name}
                                </p>
                              </TooltipContent>
                            </Tooltip>
                          </td>
                          <td className={`${tdReadOnly} truncate`}>{supplier?.name || "—"}</td>
                          <td className={`${tdReadOnly} text-right font-mono font-semibold `}>
                            {r.quantityReceived.toLocaleString()}
                          </td>
                          <td className={`${tdReadOnly} text-center text-muted-foreground`}>
                            {sku?.purchaseUom || r.usageUom}
                          </td>
                          <td className={`${tdReadOnly} text-right font-mono`}>
                            {r.actualTotal.toLocaleString(undefined, {
                              minimumFractionDigits: 0,
                              maximumFractionDigits: 0,
                            })}
                          </td>
                          <td className={`${tdReadOnly} text-right font-mono text-muted-foreground`}>
                            {r.actualUnitPrice.toFixed(2)}
                          </td>
                          <td className={`${tdReadOnly} text-right font-mono text-muted-foreground`}>
                            {r.stdUnitPrice.toFixed(2)}
                          </td>
                          <td className={`${tdReadOnly} text-right font-mono`}>
                            {r.standardPrice.toLocaleString(undefined, {
                              minimumFractionDigits: 0,
                              maximumFractionDigits: 0,
                            })}
                          </td>
                          <td
                            className={`${tdReadOnly} text-right font-mono  ${
                              r.priceVariance > 0 ? "text-destructive" : r.priceVariance < 0 ? "text-success" : ""
                            }`}
                          >
                            {r.priceVariance > 0 ? "+" : ""}
                            {r.priceVariance.toFixed(0)}
                          </td>
                          <td className={`${tdReadOnly} text-muted-foreground truncate`}>{r.note}</td>
                          <td className={`${tdReadOnly} text-center`}>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={() => deleteReceipt(r.id)}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </td>
                        </tr>
                      </TooltipProvider>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {displayHistory.length} of {receipts.length} receipts shown
            {!receiptData.isFullHistory && <> · Last 90 days</>}
          </p>
          {!receiptData.isFullHistory && (
            <Button
              variant="link"
              size="sm"
              className="text-xs h-auto p-0"
              disabled={receiptData.isLoadingAll}
              onClick={receiptData.loadAllHistory}
            >
              {receiptData.isLoadingAll ? "Loading…" : "Load all history"}
            </Button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t("gr.changeSupplierTitle")}
        description={t("gr.changeSupplierDesc")}
        confirmLabel={t("btn.confirm")}
        variant="warning"
        onConfirm={confirmSupplierChange}
      />
    </div>
  );
}

function getRowEditFromPrev(prev: Record<string, RowEdit>, skuId: string): RowEdit {
  return prev[skuId] || { qty: 0, actualTotal: 0, actualManuallyEdited: false, note: "" };
}
