import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useLanguage } from "@/hooks/use-language";
import { useSortableTable } from "@/hooks/use-sortable-table";
import { SortableHeader } from "@/components/SortableHeader";
import { useAuth } from "@/hooks/use-auth";
import { useBranchReceiptData, BranchReceipt } from "@/hooks/use-branch-receipt-data";
import { SKU } from "@/types/sku";
import { Price } from "@/types/price";
import { Branch } from "@/types/branch";
import { Supplier } from "@/types/supplier";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { DatePicker } from "@/components/ui/date-picker";
import { Save, Plus, Trash2, CheckCircle, Search, Truck, Zap, PackageOpen, X } from "lucide-react";
import { StatusDot } from "@/components/ui/status-dot";
import { Separator } from "@/components/ui/separator";
import { SearchableSelect } from "@/components/SearchableSelect";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { getWeekNumber } from "@/types/goods-receipt";
import { supabase } from "@/integrations/supabase/client";
import { usePurchaseRequest } from "@/hooks/use-purchase-request";

interface Menu {
  id: string;
  menuCode: string;
  menuName: string;
  brandName: string;
  status: string;
  sellingPrice: number;
  category: string;
}

interface MenuBomLine {
  id: string;
  menuId: string;
  skuId: string;
  qtyPerServing: number;
  uom: string;
  yieldPct: number;
  effectiveQty: number;
  costPerServing: number;
}

interface PendingTO {
  id: string;
  toNumber: string;
  deliveryDate: string;
  branchId: string;
  itemCount: number;
  lines: TOLine[];
}

interface TOLine {
  id: string;
  skuId: string;
  plannedQty: number;
  actualQty: number;
  uom: string;
  unitCost: number;
  lineValue: number;
  notes: string;
}

interface Props {
  skus: SKU[];
  prices: Price[];
  branches: Branch[];
  suppliers?: Supplier[];
  menus?: Menu[];
  menuBomLines?: MenuBomLine[];
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
}

// CK receipt line from TO
interface CKLineEdit {
  toLineId: string;
  skuId: string;
  plannedQty: number;
  receivedQty: number;
  uom: string;
  unitCost: number;
  note: string;
}

function getRowEditFromPrev(prev: Record<string, RowEdit>, skuId: string): RowEdit {
  return prev[skuId] || { qty: 0, actualTotal: 0, actualManuallyEdited: false, note: "" };
}

const CK_SUPPLIER_ID = "__central_kitchen__";

export default function BranchReceiptPage({
  skus,
  prices,
  branches,
  suppliers = [],
  menus = [],
  menuBomLines = [],
}: Props) {
  const { isManagement, isStoreManager, profile } = useAuth();
  const { t } = useLanguage();
  const { receipts, saveReceipts, deleteReceipt, fetchReceipts } = useBranchReceiptData();

  const [receiptDate, setReceiptDate] = useState<Date>(new Date());
  const [branchId, setBranchId] = useState<string>(isStoreManager && profile?.branch_id ? profile.branch_id : "");
  const [supplierId, setSupplierId] = useState<string>("");
  const [rowEdits, setRowEdits] = useState<Record<string, RowEdit>>({});
  const [adHocRows, setAdHocRows] = useState<AdHocRow[]>([]);
  const [savedCount, setSavedCount] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingSupplierId, setPendingSupplierId] = useState<string>("");
  const [supplierSearch, setSupplierSearch] = useState("");
  const [supplierDropdownOpen, setSupplierDropdownOpen] = useState(false);
  const supplierDropdownRef = useRef<HTMLDivElement>(null);

  // Pending PR counts per supplier
  const prHook = usePurchaseRequest(branchId || null);
  const [pendingPRCounts, setPendingPRCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!branchId) {
      setPendingPRCounts({});
      return;
    }
    prHook.getPendingPRCountsBySupplier(branchId).then(setPendingPRCounts);
  }, [branchId]);

  // TO integration state
  const [pendingTOs, setPendingTOs] = useState<PendingTO[]>([]);
  const [selectedTOId, setSelectedTOId] = useState<string>("");
  const [ckLines, setCkLines] = useState<CKLineEdit[]>([]);

  // History filters
  const [historyDateFrom, setHistoryDateFrom] = useState<Date | undefined>(undefined);
  const [historyDateTo, setHistoryDateTo] = useState<Date | undefined>(undefined);
  const [historyBranch, setHistoryBranch] = useState<string>("all");

  const dateStr = format(receiptDate, "yyyy-MM-dd");
  const weekNum = getWeekNumber(dateStr);

  const rmSkus = useMemo(() => skus.filter((s) => s.type === "RM" && s.status === "Active"), [skus]);
  const skuMap = useMemo(() => Object.fromEntries(skus.map((s) => [s.id, s])), [skus]);
  const supplierMap = useMemo(() => Object.fromEntries(suppliers.map((s) => [s.id, s])), [suppliers]);
  const branchMap = useMemo(() => Object.fromEntries(branches.map((b) => [b.id, b])), [branches]);

  const activeBranches = useMemo(() => branches.filter((b) => b.status === "Active"), [branches]);
  const availableBranches = useMemo(() => {
    if (isManagement) return activeBranches;
    if (isStoreManager && profile?.branch_id) return activeBranches.filter((b) => b.id === profile.branch_id);
    return activeBranches;
  }, [isManagement, isStoreManager, profile, activeBranches]);

  const selectedBranch = branchMap[branchId];
  const selectedSupplier = supplierId === CK_SUPPLIER_ID ? null : supplierMap[supplierId];
  const isCKSupplier = supplierId === CK_SUPPLIER_ID;

  // Fetch pending TOs for this branch
  const fetchPendingTOs = useCallback(async () => {
    if (!branchId) {
      setPendingTOs([]);
      return;
    }
    const { data, error } = await supabase
      .from("transfer_orders")
      .select(
        "id, to_number, delivery_date, branch_id, transfer_order_lines!to_id(id, sku_id, planned_qty, actual_qty, uom, unit_cost, line_value, notes)",
      )
      .eq("branch_id", branchId)
      .eq("status", "Sent");
    if (error) {
      setPendingTOs([]);
      return;
    }
    const tos: PendingTO[] = (data || []).map((to: any) => ({
      id: to.id,
      toNumber: to.to_number,
      deliveryDate: to.delivery_date,
      branchId: to.branch_id,
      itemCount: (to.transfer_order_lines || []).length,
      lines: (to.transfer_order_lines || []).map((l: any) => ({
        id: l.id,
        skuId: l.sku_id,
        plannedQty: Number(l.planned_qty),
        actualQty: Number(l.actual_qty),
        uom: l.uom,
        unitCost: Number(l.unit_cost),
        lineValue: Number(l.line_value),
        notes: l.notes || "",
      })),
    }));
    setPendingTOs(tos);
  }, [branchId]);

  useEffect(() => {
    fetchPendingTOs();
  }, [fetchPendingTOs]);

  const pendingTOCount = pendingTOs.length;

  // When TO selected, populate CK lines
  useEffect(() => {
    if (!selectedTOId) {
      setCkLines([]);
      return;
    }
    const to = pendingTOs.find((t) => t.id === selectedTOId);
    if (!to) {
      setCkLines([]);
      return;
    }
    setCkLines(
      to.lines.map((l) => ({
        toLineId: l.id,
        skuId: l.skuId,
        plannedQty: l.actualQty > 0 ? l.actualQty : l.plannedQty,
        receivedQty: l.actualQty > 0 ? l.actualQty : l.plannedQty,
        uom: l.uom,
        unitCost: l.unitCost,
        note: "",
      })),
    );
  }, [selectedTOId, pendingTOs]);

  // Get RM SKU IDs relevant to the selected branch's brand
  const brandRmSkuIds = useMemo(() => {
    if (!branchId || !selectedBranch) return new Set<string>();
    const brandName = selectedBranch.brandName;
    const brandMenus = menus.filter((m) => m.brandName === brandName && m.status === "Active");
    const menuIds = new Set(brandMenus.map((m) => m.id));
    return new Set(menuBomLines.filter((l) => menuIds.has(l.menuId)).map((l) => l.skuId));
  }, [branchId, selectedBranch, menus, menuBomLines]);

  // Brand supplier IDs — suppliers with active prices for brand's RM SKUs
  const brandSupplierIds = useMemo(() => {
    const ids = new Set<string>();
    prices.filter((p) => p.isActive && brandRmSkuIds.has(p.skuId)).forEach((p) => ids.add(p.supplierId));
    return ids;
  }, [prices, brandRmSkuIds]);

  // Grouped suppliers for searchable dropdown
  const groupedSuppliers = useMemo(() => {
    const active = suppliers.filter((s) => s.status === "Active");
    if (!branchId) {
      return { brand: active.sort((a, b) => a.name.localeCompare(b.name)), other: [] as Supplier[] };
    }
    const brandGroup = active.filter((s) => brandSupplierIds.has(s.id)).sort((a, b) => a.name.localeCompare(b.name));
    const otherGroup = active.filter((s) => !brandSupplierIds.has(s.id)).sort((a, b) => a.name.localeCompare(b.name));
    return { brand: brandGroup, other: otherGroup };
  }, [suppliers, branchId, brandSupplierIds]);

  // Filter suppliers by search
  const filteredGroupedSuppliers = useMemo(() => {
    const q = supplierSearch.toLowerCase();
    if (!q) return groupedSuppliers;
    return {
      brand: groupedSuppliers.brand.filter((s) => s.name.toLowerCase().includes(q)),
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

  // Pre-loaded SKUs for external supplier
  const preloadedRows = useMemo(() => {
    if (!branchId || !supplierId || !selectedBranch || isCKSupplier) return [];
    const activePrices = prices.filter((p) => p.supplierId === supplierId && p.isActive && brandRmSkuIds.has(p.skuId));
    return activePrices
      .map((p) => {
        const sku = skuMap[p.skuId];
        if (!sku || sku.type !== "RM") return null;
        return { priceId: p.id, skuId: p.skuId, sku, stdUnitPrice: p.pricePerUsageUom };
      })
      .filter(Boolean)
      .sort((a, b) => a!.sku.skuId.localeCompare(b!.sku.skuId)) as {
      priceId: string;
      skuId: string;
      sku: SKU;
      stdUnitPrice: number;
    }[];
  }, [branchId, supplierId, selectedBranch, brandRmSkuIds, prices, skuMap, isCKSupplier]);

  const hasAnyQty = useMemo(() => {
    if (isCKSupplier) return ckLines.some((l) => l.receivedQty > 0);
    return Object.values(rowEdits).some((e) => e.qty > 0) || adHocRows.some((r) => r.qty > 0);
  }, [rowEdits, adHocRows, isCKSupplier, ckLines]);

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
        setSelectedTOId("");
        setCkLines([]);
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
    setSelectedTOId("");
    setCkLines([]);
    setConfirmOpen(false);
  }, [pendingSupplierId]);

  const handleBranchChange = useCallback((newId: string) => {
    setBranchId(newId);
    setSupplierId("");
    setRowEdits({});
    setAdHocRows([]);
    setSavedCount(null);
    setSelectedTOId("");
    setCkLines([]);
  }, []);

  const getRowEdit = (skuId: string): RowEdit =>
    rowEdits[skuId] || { qty: 0, actualTotal: 0, actualManuallyEdited: false, note: "" };

  const updateRowEdit = useCallback((skuId: string, updates: Partial<RowEdit>) => {
    setRowEdits((prev) => ({
      ...prev,
      [skuId]: { ...getRowEditFromPrev(prev, skuId), ...updates },
    }));
  }, []);

  const getStdUnitPrice = useCallback(
    (skuId: string): number => {
      const active = prices.find((p) => p.skuId === skuId && p.isActive);
      return active?.pricePerUsageUom ?? 0;
    },
    [prices],
  );

  const updateCkLine = useCallback((toLineId: string, updates: Partial<CKLineEdit>) => {
    setCkLines((prev) => prev.map((l) => (l.toLineId === toLineId ? { ...l, ...updates } : l)));
  }, []);

  // Save all — handles both external and CK receipts
  const handleSaveAll = useCallback(async () => {
    if (!branchId) {
      toast.error("Please select a branch");
      return;
    }
    setSaving(true);

    if (isCKSupplier) {
      // CK receipt from TO
      if (!selectedTOId) {
        toast.error("Please select a Transfer Order");
        setSaving(false);
        return;
      }
      const linesToSave = ckLines.filter((l) => l.receivedQty > 0);
      if (linesToSave.length === 0) {
        toast.error("No items with quantity to save");
        setSaving(false);
        return;
      }

      const rows: Omit<BranchReceipt, "id" | "createdAt">[] = linesToSave.map((l) => {
        const sku = skuMap[l.skuId];
        const stdTotal = l.receivedQty * l.unitCost;
        return {
          branchId,
          receiptDate: dateStr,
          skuId: l.skuId,
          supplierName: "Central Kitchen",
          qtyReceived: l.receivedQty,
          uom: sku?.usageUom || l.uom || "น.",
          actualUnitPrice: l.unitCost,
          actualTotal: stdTotal,
          stdUnitPrice: l.unitCost,
          stdTotal,
          priceVariance: 0,
          notes: l.note,
          transferOrderId: selectedTOId,
        };
      });

      const count = await saveReceipts(rows);
      if (count) {
        // Update TO status based on received vs planned
        const selectedTO = pendingTOs.find((t) => t.id === selectedTOId);
        let allReceived = true;
        let anyPartial = false;
        for (const toLine of selectedTO?.lines || []) {
          const ckLine = ckLines.find((l) => l.toLineId === toLine.id);
          const received = ckLine?.receivedQty || 0;
          const planned = toLine.plannedQty;
          if (received < planned) {
            allReceived = false;
            if (received > 0) anyPartial = true;
          }
        }

        const newStatus = allReceived ? "Received" : anyPartial ? "Partially Received" : "Received";
        await supabase.from("transfer_orders").update({ status: newStatus }).eq("id", selectedTOId);

        // Update TR status if linked
        if (selectedTO) {
          const { data: toData } = await supabase
            .from("transfer_orders")
            .select("tr_id")
            .eq("id", selectedTOId)
            .single();
          if (toData?.tr_id) {
            await supabase.from("transfer_requests").update({ status: "Fulfilled" }).eq("id", toData.tr_id);
          }
        }

        setSavedCount(count);
        setSelectedTOId("");
        setCkLines([]);
        setSupplierId("");
        setSaving(false);
        await fetchPendingTOs();
        setTimeout(() => setSavedCount(null), 4000);
      }
      setSaving(false);
      return;
    }

    // External supplier receipt (existing logic)
    const rowsToSave: { skuId: string; qty: number; actualTotal: number; note: string; stdUnitPrice: number }[] = [];
    for (const row of preloadedRows) {
      const edit = rowEdits[row.skuId];
      if (edit && edit.qty > 0) {
        const actualTotal = edit.actualManuallyEdited ? edit.actualTotal : row.stdUnitPrice * edit.qty;
        rowsToSave.push({
          skuId: row.skuId,
          qty: edit.qty,
          actualTotal,
          note: edit.note,
          stdUnitPrice: row.stdUnitPrice,
        });
      }
    }
    for (const r of adHocRows) {
      if (r.skuId && r.qty > 0) {
        const stdUnit = getStdUnitPrice(r.skuId);
        rowsToSave.push({
          skuId: r.skuId,
          qty: r.qty,
          actualTotal: r.actualTotal,
          note: r.note,
          stdUnitPrice: stdUnit,
        });
      }
    }
    if (rowsToSave.length === 0) {
      toast.error("No rows with quantity to save");
      return;
    }

    const rows: Omit<BranchReceipt, "id" | "createdAt">[] = rowsToSave.map((r) => {
      const sku = skuMap[r.skuId];
      const actualUnitPrice = r.qty > 0 ? r.actualTotal / r.qty : 0;
      const stdTotal = r.qty * r.stdUnitPrice;
      const priceVariance = r.actualTotal - stdTotal;
      return {
        branchId,
        receiptDate: dateStr,
        skuId: r.skuId,
        supplierName: selectedSupplier?.name || "",
        qtyReceived: r.qty,
        uom: sku?.purchaseUom || "",
        actualUnitPrice,
        actualTotal: r.actualTotal,
        stdUnitPrice: r.stdUnitPrice,
        stdTotal,
        priceVariance,
        notes: r.note,
        transferOrderId: null,
      };
    });

    const count = await saveReceipts(rows);
    setSaving(false);
    if (count) {
      setSavedCount(count);
      setRowEdits({});
      setAdHocRows([]);
      setSupplierId("");
      setTimeout(() => setSavedCount(null), 4000);
    }
  }, [
    branchId,
    isCKSupplier,
    selectedTOId,
    ckLines,
    preloadedRows,
    rowEdits,
    adHocRows,
    dateStr,
    skuMap,
    selectedSupplier,
    getStdUnitPrice,
    saveReceipts,
    pendingTOs,
    fetchPendingTOs,
  ]);

  // Ad-hoc
  const handleAddAdHoc = useCallback(() => {
    setAdHocRows((prev) => [...prev, { tempId: crypto.randomUUID(), skuId: "", qty: 0, actualTotal: 0, note: "" }]);
  }, []);

  const updateAdHoc = useCallback((tempId: string, updates: Partial<AdHocRow>) => {
    setAdHocRows((prev) => prev.map((r) => (r.tempId === tempId ? { ...r, ...updates } : r)));
  }, []);

  const deleteAdHoc = useCallback((tempId: string) => {
    setAdHocRows((prev) => prev.filter((r) => r.tempId !== tempId));
  }, []);

  // History
  const filteredHistory = useMemo(() => {
    return receipts.filter((r) => {
      if (historyBranch !== "all" && r.branchId !== historyBranch) return false;
      if (isStoreManager && profile?.branch_id && r.branchId !== profile.branch_id) return false;
      if (historyDateFrom && r.receiptDate < format(historyDateFrom, "yyyy-MM-dd")) return false;
      if (historyDateTo && r.receiptDate > format(historyDateTo, "yyyy-MM-dd")) return false;
      return true;
    });
  }, [receipts, historyBranch, historyDateFrom, historyDateTo, isStoreManager, profile]);

  // TO number lookup for history
  const [toNumberMap, setToNumberMap] = useState<Record<string, string>>({});
  useEffect(() => {
    const toIds = [...new Set(receipts.filter((r) => r.transferOrderId).map((r) => r.transferOrderId!))];
    if (toIds.length === 0) {
      setToNumberMap({});
      return;
    }
    supabase
      .from("transfer_orders")
      .select("id, to_number")
      .in("id", toIds)
      .then(({ data }) => {
        const m: Record<string, string> = {};
        (data || []).forEach((to) => {
          m[to.id] = to.to_number;
        });
        setToNumberMap(m);
      });
  }, [receipts]);

  const historyComparators = useMemo(
    () => ({
      date: (a: BranchReceipt, b: BranchReceipt) => a.receiptDate.localeCompare(b.receiptDate),
      sku: (a: BranchReceipt, b: BranchReceipt) =>
        (skuMap[a.skuId]?.skuId || "").localeCompare(skuMap[b.skuId]?.skuId || ""),
      supplier: (a: BranchReceipt, b: BranchReceipt) => a.supplierName.localeCompare(b.supplierName),
      qty: (a: BranchReceipt, b: BranchReceipt) => a.qtyReceived - b.qtyReceived,
      actualTotal: (a: BranchReceipt, b: BranchReceipt) => a.actualTotal - b.actualTotal,
      variance: (a: BranchReceipt, b: BranchReceipt) => a.priceVariance - b.priceVariance,
    }),
    [skuMap],
  );

  const {
    sorted: sortedHistory,
    sortKey: hSortKey,
    sortDir: hSortDir,
    handleSort: hHandleSort,
  } = useSortableTable(filteredHistory, historyComparators);
  const displayHistory = hSortKey
    ? sortedHistory
    : [...filteredHistory].sort((a, b) => b.receiptDate.localeCompare(a.receiptDate));
  const totalActual = useMemo(() => filteredHistory.reduce((s, r) => s + r.actualTotal, 0), [filteredHistory]);
  const totalStd = useMemo(() => filteredHistory.reduce((s, r) => s + r.stdTotal, 0), [filteredHistory]);
  const totalVariance = totalActual - totalStd;

  const thClass =
    "text-left px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground whitespace-nowrap";
  const tdReadOnly = "px-3 py-2 text-sm";

  const savableCount = useMemo(() => {
    if (isCKSupplier) return ckLines.filter((l) => l.receivedQty > 0).length;
    let c = 0;
    for (const row of preloadedRows) {
      const edit = rowEdits[row.skuId];
      if (edit && edit.qty > 0) c++;
    }
    for (const r of adHocRows) {
      if (r.skuId && r.qty > 0) c++;
    }
    return c;
  }, [preloadedRows, rowEdits, adHocRows, isCKSupplier, ckLines]);

  const SaveButton = () => (
    <div className="flex items-center gap-2">
      <Button
        onClick={handleSaveAll}
        disabled={savableCount === 0}
        className="bg-success hover:bg-success/90 text-success-foreground"
      >
        <Save className="w-4 h-4 mr-1" /> {t("br.saveAll").replace("{n}", String(savableCount))}
      </Button>
      {savedCount !== null && (
        <span className="text-xs text-success font-medium flex items-center gap-1 animate-fade-in">
          <CheckCircle className="w-3.5 h-3.5" /> {t("br.savedConfirm").replace("{n}", String(savedCount))}
        </span>
      )}
    </div>
  );

  const bothSelected = branchId && supplierId;

  // CK supplier selected check: need TO as well
  const showCKSheet = isCKSupplier && selectedTOId && ckLines.length > 0;
  const showExternalSheet = bothSelected && !isCKSupplier && preloadedRows.length > 0;

  // Does CK search match?
  const ckMatchesSearch = "central kitchen".includes(supplierSearch.toLowerCase());

  const isFormActive = showCKSheet || showExternalSheet;

  // Source label for header strip
  const formSourceLabel = isCKSupplier
    ? `Central Kitchen · ${pendingTOs.find((to) => to.id === selectedTOId)?.toNumber || ""}`
    : selectedSupplier?.name || "";

  return (
    <div className="space-y-6">
      {/* ── 1. PAGE HEADER ── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-heading font-bold">{t("title.branchReceipt")}</h2>
          <p className="text-sm text-muted-foreground mt-0.5">{t("br.subtitle")}</p>
        </div>
        {!isFormActive && (
          <Button
            className="bg-success hover:bg-success/90 text-success-foreground"
            onClick={() => {
              setSupplierDropdownOpen(true);
            }}
            disabled={!branchId}
          >
            <Plus className="w-4 h-4 mr-1" /> New Receipt
          </Button>
        )}
      </div>

      {/* ── 2. PENDING TO DELIVERIES QUEUE ── */}
      {branchId && pendingTOCount > 0 && !isFormActive && (
        <div className="rounded-lg border border-success/30 border-l-4 border-l-success bg-success/[0.06] p-4 space-y-3">
          <div className="flex items-center gap-2">
            <StatusDot status="green" size="md" />
            <span className="text-sm font-semibold">
              {pendingTOCount} Delivery{pendingTOCount !== 1 ? "ies" : ""} Pending
            </span>
          </div>
          <div className="space-y-2">
            {pendingTOs.map((to) => (
              <div key={to.id} className="flex items-center justify-between rounded-md border bg-card px-4 py-2.5">
                <div className="flex items-center gap-4">
                  <Truck className="w-4 h-4 text-muted-foreground" />
                  <span className="font-mono text-sm font-medium">{to.toNumber}</span>
                  <span className="text-sm text-muted-foreground">{to.deliveryDate}</span>
                  <span className="text-xs text-muted-foreground">{to.itemCount} items</span>
                </div>
                <Button
                  size="sm"
                  className="bg-success hover:bg-success/90 text-success-foreground"
                  onClick={() => {
                    setSupplierId(CK_SUPPLIER_ID);
                    setSelectedTOId(to.id);
                  }}
                >
                  Receive
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── HEADER CONTROLS (branch/supplier/date selectors) ── */}
      {!isFormActive && (
        <div className="flex flex-wrap items-end gap-3">
          <DatePicker
            value={receiptDate}
            onChange={(d) => d && setReceiptDate(d)}
            defaultToday
            label={t("br.dateLabel")}
            required
            labelPosition="above"
            align="start"
          />
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block label-required">
              {t("br.branchLabel")}
            </label>
            <Select
              value={branchId || "_none"}
              onValueChange={(v) => handleBranchChange(v === "_none" ? "" : v)}
              disabled={isStoreManager}
            >
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder={t("br.selectBranch")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_none">{t("br.selectBranch")}</SelectItem>
                {availableBranches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.branchName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {branchId && (
            <div className="relative" ref={supplierDropdownRef}>
              <label className="text-xs font-medium text-muted-foreground mb-1 block label-required">
                {t("br.supplierLabel")}
              </label>
              <button
                type="button"
                onClick={() => setSupplierDropdownOpen(!supplierDropdownOpen)}
                className={cn(
                  "flex items-center justify-between w-[240px] h-9 px-3 py-2 text-sm border rounded-md bg-background hover:bg-accent/50 transition-colors",
                  !supplierId && "text-muted-foreground",
                )}
              >
                <span className="truncate flex items-center gap-1.5">
                  {isCKSupplier ? (
                    <>
                      <Zap className="w-3.5 h-3.5 text-primary shrink-0" />
                      Central Kitchen
                    </>
                  ) : (
                    selectedSupplier?.name || t("br.selectSupplier")
                  )}
                </span>
                <Search className="w-3.5 h-3.5 ml-2 shrink-0 text-muted-foreground" />
              </button>
              {supplierDropdownOpen && (
                <div className="absolute z-50 top-full mt-1 w-[280px] bg-popover border rounded-lg shadow-lg">
                  <div className="p-2 border-b">
                    <input
                      type="text"
                      value={supplierSearch}
                      onChange={(e) => setSupplierSearch(e.target.value)}
                      placeholder={t("br.searchSupplier")}
                      className="w-full h-8 px-2 text-sm border rounded-md bg-background focus:border-primary outline-none"
                      autoFocus
                    />
                  </div>
                  <div className="max-h-60 overflow-y-auto py-1">
                    {pendingTOCount > 0 && ckMatchesSearch && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleSupplierChange(CK_SUPPLIER_ID)}
                          className={cn(
                            "w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors flex items-center justify-between",
                            supplierId === CK_SUPPLIER_ID && "bg-accent font-medium",
                          )}
                        >
                          <span className="flex items-center gap-1.5">
                            <Zap className="w-3.5 h-3.5 text-primary shrink-0" />
                            <span className="font-medium">Central Kitchen</span>
                          </span>
                          <span className="bg-success/15 text-success text-xs rounded px-1.5 py-0.5 font-medium">
                            {pendingTOCount} pending
                          </span>
                        </button>
                        <div className="border-b my-1" />
                      </>
                    )}
                    {branchId ? (
                      <>
                        {filteredGroupedSuppliers.brand.length > 0 && (
                          <>
                            <div className="px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                              {t("br.brandSuppliers")}
                            </div>
                            {filteredGroupedSuppliers.brand.map((s) => (
                              <button
                                key={s.id}
                                type="button"
                                onClick={() => handleSupplierChange(s.id)}
                                className={cn(
                                  "w-full text-left px-3 py-1.5 text-sm hover:bg-accent transition-colors flex items-center justify-between",
                                  s.id === supplierId && "bg-accent font-medium",
                                )}
                              >
                                <span>{s.name}</span>
                                {(pendingPRCounts[s.id] || 0) > 0 && (
                                  <span className="bg-warning/15 text-warning text-xs rounded-full px-1.5 py-0.5 font-medium">
                                    {pendingPRCounts[s.id]} pending
                                  </span>
                                )}
                              </button>
                            ))}
                          </>
                        )}
                        {filteredGroupedSuppliers.other.length > 0 && (
                          <>
                            <div className="px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                              {t("br.otherSuppliers")}
                            </div>
                            {filteredGroupedSuppliers.other.map((s) => (
                              <button
                                key={s.id}
                                type="button"
                                onClick={() => handleSupplierChange(s.id)}
                                className={cn(
                                  "w-full text-left px-3 py-1.5 text-sm hover:bg-accent transition-colors flex items-center justify-between",
                                  s.id === supplierId && "bg-accent font-medium",
                                )}
                              >
                                <span>{s.name}</span>
                                {(pendingPRCounts[s.id] || 0) > 0 && (
                                  <span className="bg-warning/15 text-warning text-xs rounded-full px-1.5 py-0.5 font-medium">
                                    {pendingPRCounts[s.id]} pending
                                  </span>
                                )}
                              </button>
                            ))}
                          </>
                        )}
                      </>
                    ) : (
                      filteredGroupedSuppliers.brand.map((s) => (
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
                      ))
                    )}
                    {filteredGroupedSuppliers.brand.length === 0 &&
                      filteredGroupedSuppliers.other.length === 0 &&
                      pendingTOCount === 0 && (
                        <p className="px-3 py-4 text-sm text-muted-foreground text-center">{t("br.noSuppliers")}</p>
                      )}
                  </div>
                </div>
              )}
            </div>
          )}
          {/* TO selector when CK supplier selected */}
          {isCKSupplier && branchId && (
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block label-required">
                {t("br.toLabel")}
              </label>
              <Select value={selectedTOId || "_none"} onValueChange={(v) => setSelectedTOId(v === "_none" ? "" : v)}>
                <SelectTrigger className="w-[320px]">
                  <SelectValue placeholder={t("br.selectTO")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">{t("br.selectTO")}</SelectItem>
                  {pendingTOs.map((to) => (
                    <SelectItem key={to.id} value={to.id}>
                      {to.toNumber} · {to.deliveryDate} · {to.itemCount} items
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      )}

      {/* ── 3. ACTIVE RECEIPT FORM ── */}
      {isFormActive && (
        <div className="rounded-lg border-2 border-primary/20 bg-card overflow-hidden">
          {/* Header strip */}
          <div className="flex items-center justify-between px-5 py-3 bg-primary/[0.06] border-b border-primary/10">
            <div className="flex items-center gap-4">
              <span className="font-mono text-sm font-semibold bg-muted px-2.5 py-1 rounded">BR-{dateStr}</span>
              <span className="text-sm font-medium flex items-center gap-1.5">
                {isCKSupplier && <Zap className="w-3.5 h-3.5 text-primary" />}
                {formSourceLabel}
              </span>
              {selectedBranch && <span className="text-xs text-muted-foreground">→ {selectedBranch.branchName}</span>}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSupplierId("");
                  setSelectedTOId("");
                  setCkLines([]);
                  setRowEdits({});
                  setAdHocRows([]);
                  setSavedCount(null);
                }}
              >
                <X className="w-4 h-4 mr-1" /> Cancel
              </Button>
              <Button variant="outline" size="sm" disabled={savableCount === 0}>
                <Save className="w-4 h-4 mr-1" /> Save Draft
              </Button>
              <Button
                size="sm"
                className="bg-success hover:bg-success/90 text-success-foreground"
                onClick={handleSaveAll}
                disabled={savableCount === 0 || saving}
              >
                <CheckCircle className="w-4 h-4 mr-1" />
                {saving ? "Saving..." : `Confirm Receipt (${savableCount})`}
              </Button>
            </div>
          </div>

          {/* Meta bar */}
          <div className="flex items-center gap-6 px-5 py-2.5 border-b bg-muted/30 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Date:</span>
              <span className="font-medium">{dateStr}</span>
              <span className="text-xs text-muted-foreground ml-1">W{weekNum}</span>
            </div>
            {isCKSupplier && selectedTOId && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">TO Ref:</span>
                <span className="font-mono text-xs font-medium">
                  {pendingTOs.find((to) => to.id === selectedTOId)?.toNumber}
                </span>
              </div>
            )}
            {!isCKSupplier && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Items:</span>
                <span className="font-medium">{preloadedRows.length} SKUs</span>
              </div>
            )}
          </div>

          {/* CK Receipt sheet from TO */}
          {showCKSheet && (
            <div className="overflow-y-auto max-h-[65vh]">
              <table className="w-full text-sm table-fixed">
                <colgroup>
                  <col style={{ width: 100 }} /> // SKU CODE
                  <col /> // SKU NAME
                  <col style={{ width: 140 }} /> // PLANNED
                  <col style={{ width: 140 }} /> // PACKS
                  <col style={{ width: 140 }} /> // WEIGHT
                </colgroup>
                <thead className="sticky top-0 z-[5]">
                  <tr className="bg-table-header border-b">
                    <th className={thClass}>{t("col.skuCode")}</th>
                    <th className={thClass}>{t("col.skuName")}</th>
                    <th className={`${thClass} text-right`}>{t("br.colPlanned")}</th>
                    <th className="text-right px-3 py-2 text-xs font-medium uppercase tracking-wide whitespace-nowrap !bg-foreground text-background">
                      PACKS
                    </th>
                    <th className={`${thClass} text-right`}>WEIGHT (g)</th>
                  </tr>
                </thead>
                <tbody>
                  {ckLines.map((line) => {
                    const sku = skuMap[line.skuId];
                    const packSize = sku?.packSize ?? 0;
                    const packUnit = sku?.packUnit ?? "";
                    const isPacksMode = packSize > 1 && packUnit.length > 0;
                    const plannedPacks = isPacksMode ? Math.round(line.plannedQty / packSize) : 0;
                    const currentPacks = isPacksMode ? Math.round(line.receivedQty / packSize) : 0;
                    return (
                      <tr
                        key={line.toLineId}
                        className={cn(
                          "border-b last:border-0 transition-colors",
                          line.receivedQty > 0 ? "bg-success/5 border-l-[3px] border-l-success" : "opacity-60",
                        )}
                      >
                        <td className={`${tdReadOnly} font-mono align-middle`}>{sku?.skuId || "—"}</td>
                        <td className={`${tdReadOnly} truncate align-middle`} title={sku?.name}>
                          {sku?.name || "—"}
                        </td>
                        {/* PLANNED */}
                        <td className={`${tdReadOnly} text-right font-mono align-middle`}>
                          {isPacksMode ? (
                            <div>
                              <span className="text-sm">{plannedPacks}</span>
                              <span className="text-xs text-muted-foreground ml-1">{packUnit}</span>
                              <div className="text-xs text-muted-foreground">{line.plannedQty.toLocaleString()}g</div>
                            </div>
                          ) : (
                            <div>
                              <span>{line.plannedQty.toLocaleString()}</span>
                              <div className="text-xs mt-0.5 invisible">·</div>
                            </div>
                          )}
                        </td>
                        {/* PACKS — primary amber input */}
                        <td className="px-1 py-1 align-middle">
                          {isPacksMode ? (
                            <div>
                              <div className="flex items-center gap-1">
                                <input
                                  type="number"
                                  inputMode="numeric"
                                  min={0}
                                  step={1}
                                  defaultValue={currentPacks || ""}
                                  key={`ck-packs-${line.toLineId}-${savedCount}`}
                                  onBlur={(e) => {
                                    const packs = Math.round(Number(e.target.value) || 0);
                                    updateCkLine(line.toLineId, { receivedQty: packs * packSize });
                                  }}
                                  onFocus={(e) => e.target.select()}
                                  className={cn(
                                    "h-8 text-sm text-right w-full font-mono px-2 rounded-md border-2 border-primary/40 bg-amber-50 focus:border-primary focus:ring-0 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none",
                                    line.receivedQty > 0 && "border-success font-bold text-success",
                                  )}
                                  placeholder="0"
                                />
                                <span className="text-xs font-medium text-muted-foreground whitespace-nowrap ml-1">
                                  {packUnit}
                                </span>
                              </div>
                              <div className="text-xs mt-0.5 invisible">·</div>
                            </div>
                          ) : (
                            <div>
                              <div className="flex items-center gap-1">
                                <input
                                  type="number"
                                  min={0}
                                  step="any"
                                  defaultValue={line.receivedQty || ""}
                                  key={`ck-units-${line.toLineId}-${savedCount}`}
                                  onBlur={(e) =>
                                    updateCkLine(line.toLineId, { receivedQty: Number(e.target.value) || 0 })
                                  }
                                  onFocus={(e) => e.target.select()}
                                  className={cn(
                                    "h-8 text-sm text-right w-full font-mono px-2 rounded-md border-2 border-primary/40 bg-amber-50 focus:border-primary focus:ring-0 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none",
                                    line.receivedQty > 0 && "border-success font-bold text-success",
                                  )}
                                  placeholder="0"
                                />
                                <span className="text-xs font-medium text-muted-foreground whitespace-nowrap ml-1">
                                  {sku?.usageUom || line.uom}
                                </span>
                              </div>
                              <div className="text-xs mt-0.5 invisible">·</div>
                            </div>
                          )}
                        </td>
                        {/* WEIGHT (g) — secondary override, packs mode only */}
                        <td className="px-1 py-1 align-middle">
                          {isPacksMode ? (
                            <div>
                              <input
                                type="number"
                                inputMode="numeric"
                                min={0}
                                step={1}
                                defaultValue={line.receivedQty || ""}
                                key={`ck-wt-${line.toLineId}-${savedCount}`}
                                onBlur={(e) => {
                                  const grams = Number(e.target.value) || 0;
                                  if (grams > 0) {
                                    updateCkLine(line.toLineId, { receivedQty: grams });
                                  }
                                }}
                                onFocus={(e) => e.target.select()}
                                placeholder="ยอดนับจริง"
                                className="h-8 w-full text-sm font-mono text-right px-2 rounded-md border border-input bg-amber-50/60 opacity-80 focus:border-primary focus:ring-0 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                              />
                              <div className="text-xs text-muted-foreground mt-0.5 text-right">
                                est. {(currentPacks * packSize).toLocaleString()}{" "}
                                <span className="font-bold">{sku.purchaseUom || "g"}</span>
                              </div>
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-muted/50 font-semibold border-t">
                    <td colSpan={2} className={`${tdReadOnly} text-right font-medium text-muted-foreground`}>
                      Total
                    </td>
                    <td className={`${tdReadOnly} text-right font-mono`}>
                      {(() => {
                        const totalPacks = ckLines.reduce((s, l) => {
                          const sku = skuMap[l.skuId];
                          const ps = sku?.packSize ?? 0;
                          const pu = sku?.packUnit ?? "";
                          return s + (ps > 1 && pu ? Math.round(l.receivedQty / ps) : 0);
                        }, 0);
                        const totalG = ckLines.reduce((s, l) => s + l.receivedQty, 0);
                        return `${totalPacks} packs`;
                      })()}
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* External supplier sheet */}
          {showExternalSheet && (
            <>
              <div className="overflow-y-auto max-h-[65vh]">
                <table className="w-full text-sm table-fixed">
                  <colgroup>
                    <col style={{ width: 100 }} />
                    <col />
                    <col style={{ width: 130 }} />
                    <col style={{ width: 140 }} />
                    <col style={{ width: 140 }} />
                    <col style={{ width: 140 }} />
                    <col style={{ width: 100 }} />
                    <col style={{ width: 100 }} />
                    <col style={{ width: 100 }} />
                    <col style={{ width: 100 }} />
                  </colgroup>
                  <thead className="sticky top-0 z-[5]">
                    <tr className="bg-table-header border-b">
                      <th className={thClass}>{t("col.sku")}</th>
                      <th className={thClass}>{t("col.skuName")}</th>
                      <th className={thClass}>{t("col.supplier")}</th>
                      <th className="text-right px-3 py-2 text-xs font-medium uppercase tracking-wide whitespace-nowrap !bg-foreground text-background">
                        PACKS
                      </th>
                      <th className={`${thClass} text-right`}>WEIGHT</th>
                      <th className={`${thClass} text-right`}>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="cursor-help border-b border-dashed border-muted-foreground">
                                {t("col.actualTotal")}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="top">
                              <p>{t("col.totalPaid")}</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </th>
                      <th className={`${thClass} text-right`}>{t("col.actualUnit")}</th>
                      <th className={`${thClass} text-right`}>{t("col.stdUnit")}</th>
                      <th className={`${thClass} text-right`}>{t("col.stdTotal")}</th>
                      <th className={`${thClass} text-right`}>{t("col.variance")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preloadedRows.map((row) => {
                      const edit = getRowEdit(row.skuId);
                      const sku = row.sku;
                      const packSize = sku.packSize ?? 0;
                      const packUnit = sku.packUnit ?? "";
                      const isPacksMode = packSize > 1 && packUnit.length > 0;
                      const currentPacks = isPacksMode ? Math.round(edit.qty / packSize) : 0;
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
                            hasQty ? "bg-success/5 border-l-[3px] border-l-success" : "opacity-60",
                          )}
                        >
                          <td className={`${tdReadOnly} font-mono text-xs align-middle`} title={sku.skuId}>
                            <div>
                              <span className={cn(hasQty ? "text-foreground/70 font-medium" : "text-muted-foreground")}>
                                {sku.skuId}
                              </span>
                              {isPacksMode && <div className="text-xs mt-0.5 invisible">·</div>}
                            </div>
                          </td>
                          <td className={`${tdReadOnly} align-middle`} title={sku.name}>
                            <div>
                              <span className={cn("block truncate", hasQty ? "font-semibold text-foreground" : "")}>
                                {sku.name}
                              </span>
                              {isPacksMode && <div className="text-xs mt-0.5 invisible">·</div>}
                            </div>
                          </td>
                          <td className={`${tdReadOnly} text-muted-foreground truncate align-middle`}>
                            <div>
                              {selectedSupplier?.name}
                              {isPacksMode && <div className="text-xs mt-0.5 invisible">·</div>}
                            </div>
                          </td>
                          {/* PACKS — smart input */}
                          <td className="px-1 py-1 align-middle">
                            {isPacksMode ? (
                              <div>
                                <div className="flex items-center gap-1">
                                  <input
                                    type="number"
                                    inputMode="numeric"
                                    min={0}
                                    step={1}
                                    defaultValue={currentPacks || ""}
                                    key={`packs-${row.skuId}-${savedCount}`}
                                    onBlur={(e) => {
                                      const packs = Math.round(Number(e.target.value) || 0);
                                      const grams = packs * packSize;
                                      updateRowEdit(row.skuId, {
                                        qty: grams,
                                        ...(!rowEdits[row.skuId]?.actualManuallyEdited
                                          ? { actualTotal: row.stdUnitPrice * grams }
                                          : {}),
                                      });
                                    }}
                                    onFocus={(e) => e.target.select()}
                                    className={cn(
                                      "h-8 text-sm text-right w-full font-mono px-2 rounded-md border-2 border-primary/40 bg-amber-50 focus:border-primary focus:ring-0 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none",
                                      hasQty && "border-success font-bold text-success",
                                    )}
                                    placeholder="0"
                                  />
                                  <span className="text-xs font-medium text-muted-foreground whitespace-nowrap ml-1">
                                    {packUnit}
                                  </span>
                                </div>
                                <div className="text-xs mt-0.5 invisible">·</div>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1">
                                <input
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
                                    "h-8 text-sm text-right w-full font-mono px-2 rounded-md border-2 border-primary/40 bg-amber-50 focus:border-primary focus:ring-0 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none",
                                    hasQty && "border-success font-bold text-success",
                                  )}
                                  placeholder="0"
                                />
                                <span className="text-xs font-medium text-muted-foreground whitespace-nowrap ml-1">
                                  {sku.usageUom}
                                </span>
                              </div>
                            )}
                          </td>
                          {/* WEIGHT — secondary override, packs mode only */}
                          <td className="px-1 py-1 align-middle">
                            {isPacksMode ? (
                              <div>
                                <input
                                  type="number"
                                  inputMode="numeric"
                                  min={0}
                                  step={1}
                                  defaultValue={edit.qty || ""}
                                  key={`wt-${row.skuId}-${savedCount}-${edit.qty}`}
                                  onBlur={(e) => {
                                    const grams = Number(e.target.value) || 0;
                                    if (grams > 0) {
                                      updateRowEdit(row.skuId, {
                                        qty: grams,
                                        ...(!rowEdits[row.skuId]?.actualManuallyEdited
                                          ? { actualTotal: row.stdUnitPrice * grams }
                                          : {}),
                                      });
                                    }
                                  }}
                                  onFocus={(e) => e.target.select()}
                                  placeholder="ยอดนับจริง"
                                  className="h-8 w-full text-sm font-sans text-right px-2 rounded-md border border-input bg-amber-50/60 opacity-80 focus:border-primary focus:ring-0 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                />
                                <div className="text-xs text-muted-foreground mt-0.5 text-right">
                                  est. {(currentPacks * packSize).toLocaleString()}{" "}
                                  <span className="font-bold">{sku.purchaseUom || "g"}</span>
                                </div>
                              </div>
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </td>

                          <td className="px-1 py-1 align-middle">
                            <div>
                              <div className="flex items-center gap-1">
                                <input
                                  type="number"
                                  min={0}
                                  step="any"
                                  defaultValue={actualTotal ? Number(actualTotal).toFixed(2) : ""}
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
                              {isPacksMode && <div className="text-xs mt-0.5 invisible">·</div>}
                            </div>
                          </td>
                          <td className={`${tdReadOnly} text-right font-mono text-muted-foreground align-middle`}>
                            <div>
                              {unitPrice > 0 ? unitPrice.toFixed(2) : "—"}
                              {isPacksMode && <div className="text-xs mt-0.5 invisible">·</div>}
                            </div>
                          </td>
                          <td className={`${tdReadOnly} text-right font-mono text-muted-foreground align-middle`}>
                            <div>
                              {row.stdUnitPrice > 0 ? row.stdUnitPrice.toFixed(2) : "—"}
                              {isPacksMode && <div className="text-xs mt-0.5 invisible">·</div>}
                            </div>
                          </td>
                          <td className={`${tdReadOnly} text-right font-mono text-muted-foreground align-middle`}>
                            <div>
                              {stdTotal > 0
                                ? stdTotal.toLocaleString(undefined, {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  })
                                : "—"}
                              {isPacksMode && <div className="text-xs mt-0.5 invisible">·</div>}
                            </div>
                          </td>
                          <td
                            className={cn(
                              `${tdReadOnly} text-right font-mono align-middle`,
                              hasQty && variance !== 0 ? "font-bold" : "font-semibold",
                              variance < 0
                                ? "text-success"
                                : variance > 0
                                  ? "text-destructive"
                                  : "text-muted-foreground",
                            )}
                          >
                            <div>
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
                              {isPacksMode && <div className="text-xs mt-0.5 invisible">·</div>}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Ad-hoc rows */}
              <div className="px-4 py-3 space-y-2 border-t">
                {adHocRows.length > 0 && (
                  <>
                    <p className="text-xs font-medium text-muted-foreground">Ad-hoc items (not in active menus)</p>
                    <div className="rounded-lg border bg-card overflow-hidden">
                      <table className="w-full text-sm table-fixed">
                        <colgroup>
                          <col style={{ width: 240 }} />
                          <col style={{ width: 110 }} />
                          <col style={{ width: 100 }} />
                          <col style={{ width: 90 }} />
                          <col style={{ width: 50 }} />
                        </colgroup>
                        <thead>
                          <tr className="bg-table-header border-b">
                            <th className={thClass}>{t("col.sku")}</th>
                            <th className={`${thClass} text-right`}>PACKS</th>
                            <th className={`${thClass} text-right`}>WEIGHT</th>
                            <th className={`${thClass} text-right`}>{t("col.actualTotal")}</th>
                            <th className={`${thClass} text-center`}></th>
                          </tr>
                        </thead>
                        <tbody>
                          {adHocRows.map((row) => {
                            const sku = skuMap[row.skuId];
                            const packSize = sku?.packSize ?? 0;
                            const packUnit = sku?.packUnit ?? "";
                            const isPacksMode = sku && packSize > 1 && packUnit.length > 0;
                            const currentPacks = isPacksMode ? Math.round(row.qty / packSize) : 0;
                            return (
                              <tr key={row.tempId} className="border-b last:border-0 bg-accent/50">
                                <td className="px-1 py-1 align-middle">
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
                                <td className="px-1 py-1 align-middle">
                                  {isPacksMode ? (
                                    <div className="flex items-center gap-1">
                                      <input
                                        type="number"
                                        inputMode="numeric"
                                        min={0}
                                        step={1}
                                        defaultValue={currentPacks || ""}
                                        key={`adhoc-packs-${row.tempId}-${row.skuId}`}
                                        onBlur={(e) => {
                                          const packs = Math.round(Number(e.target.value) || 0);
                                          updateAdHoc(row.tempId, { qty: packs * packSize });
                                        }}
                                        onFocus={(e) => e.target.select()}
                                        className="h-8 text-xs text-right w-full font-mono px-2 py-1 rounded-md border-2 border-primary/40 bg-amber-50 focus:border-primary outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                        placeholder="0"
                                      />
                                      <span className="text-xs font-medium text-muted-foreground whitespace-nowrap ml-1">
                                        {packUnit}
                                      </span>
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-1">
                                      <input
                                        type="number"
                                        min={0}
                                        step="any"
                                        defaultValue={row.qty || ""}
                                        key={`adhoc-qty-${row.tempId}-${row.skuId}`}
                                        onBlur={(e) => updateAdHoc(row.tempId, { qty: Number(e.target.value) || 0 })}
                                        onFocus={(e) => e.target.select()}
                                        className="h-8 text-xs text-right w-full font-mono px-2 py-1 border-2 border-primary/30 rounded-md bg-amber-50 focus:border-primary outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                        placeholder="0"
                                      />
                                      <span className="text-xs font-medium text-muted-foreground whitespace-nowrap ml-1">
                                        {sku?.usageUom || "—"}
                                      </span>
                                    </div>
                                  )}
                                </td>
                                <td className="px-1 py-1 align-middle">
                                  {isPacksMode ? (
                                    <div>
                                      <input
                                        type="number"
                                        inputMode="numeric"
                                        min={0}
                                        step={1}
                                        defaultValue={row.qty || ""}
                                        key={`adhoc-wt-${row.tempId}-${row.skuId}-${row.qty}`}
                                        onBlur={(e) => {
                                          const grams = Number(e.target.value) || 0;
                                          if (grams > 0) updateAdHoc(row.tempId, { qty: grams });
                                        }}
                                        onFocus={(e) => e.target.select()}
                                        placeholder="ยอดนับจริง"
                                        className="h-8 w-full text-xs font-sans text-right px-2 rounded-md border border-input bg-amber-50/60 opacity-80 focus:border-primary outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                      />
                                      <div className="text-xs text-muted-foreground mt-0.5 text-right">
                                        est. {(currentPacks * packSize).toLocaleString()}{" "}
                                        <span className="font-bold">{sku.purchaseUom || "g"}</span>
                                      </div>
                                    </div>
                                  ) : (
                                    <span className="text-muted-foreground text-xs">—</span>
                                  )}
                                </td>

                                <td className="px-1 py-1 align-middle">
                                  <input
                                    type="number"
                                    min={0}
                                    step="any"
                                    defaultValue={row.actualTotal || ""}
                                    key={`adhoc-actual-${row.tempId}`}
                                    onBlur={(e) =>
                                      updateAdHoc(row.tempId, { actualTotal: Number(e.target.value) || 0 })
                                    }
                                    onFocus={(e) => e.target.select()}
                                    className="h-8 text-xs text-right w-full font-mono px-2 py-1 border rounded-md bg-warning/5 border-warning/20 focus:border-primary outline-none"
                                    placeholder="0.00"
                                  />
                                </td>

                                <td className="px-1 py-1 text-center align-middle">
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
            </>
          )}

          {/* Footer bar */}
          <div className="flex items-center justify-between px-5 py-3 border-t bg-muted/30">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground uppercase tracking-wide">Total Value:</span>
              <span className="text-lg font-heading font-bold">
                ฿
                {(isCKSupplier
                  ? ckLines.reduce((s, l) => s + l.receivedQty * l.unitCost, 0)
                  : preloadedRows.reduce((s, row) => {
                      const edit = getRowEdit(row.skuId);
                      const stdTotal = row.stdUnitPrice * edit.qty;
                      return s + (edit.actualManuallyEdited ? edit.actualTotal : stdTotal);
                    }, 0) + adHocRows.reduce((s, r) => s + r.actualTotal, 0)
                ).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {savedCount !== null && (
                <span className="text-xs text-success font-medium flex items-center gap-1 animate-fade-in">
                  <CheckCircle className="w-3.5 h-3.5" /> {t("br.savedConfirm").replace("{n}", String(savedCount))}
                </span>
              )}
              <Button
                className="bg-success hover:bg-success/90 text-success-foreground"
                onClick={handleSaveAll}
                disabled={savableCount === 0 || saving}
              >
                <CheckCircle className="w-4 h-4 mr-1" />
                {saving ? "Saving..." : `Confirm Receipt (${savableCount})`}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── 4. EMPTY STATE ── */}
      {!isFormActive && branchId && pendingTOCount === 0 && (
        <div className="rounded-lg border bg-card py-16 flex flex-col items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-success/10 flex items-center justify-center">
            <PackageOpen className="w-7 h-7 text-success" />
          </div>
          <div className="text-center">
            <p className="font-medium text-foreground">No active receipt</p>
            <p className="text-sm text-muted-foreground mt-1">Select a supplier above to start receiving</p>
          </div>
        </div>
      )}

      {/* Keyboard hints */}
      {isFormActive && <div className="kbd-hint">{t("br.keyboardHint")}</div>}

      {/* ── 5. RECEIPT HISTORY ── */}
      <div className="pt-2">
        <Separator className="mb-3" />
        <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Receipt History</span>
      </div>

      <div className="space-y-4">
        <div className="flex flex-wrap gap-3">
          <DatePicker
            value={historyDateFrom}
            onChange={setHistoryDateFrom}
            placeholder="Start"
            label={t("common.from")}
            labelPosition="left"
            align="start"
          />
          <DatePicker
            value={historyDateTo}
            onChange={setHistoryDateTo}
            placeholder="End"
            label={t("common.to")}
            labelPosition="left"
            align="start"
          />
          {isManagement && (
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-muted-foreground whitespace-nowrap">{t("col.branch")}</label>
              <Select value={historyBranch} onValueChange={setHistoryBranch}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("common.allBranches")}</SelectItem>
                  {activeBranches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.branchName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="overflow-y-auto max-h-[65vh]">
            <table className="w-full text-sm table-fixed">
              <colgroup>
                <col style={{ width: 110 }} />
                <col style={{ width: 90 }} />
                <col />
                <col style={{ width: 140 }} />
                <col style={{ width: 140 }} />
                <col style={{ width: 70 }} />
                <col style={{ width: 70 }} />
                <col style={{ width: 100 }} />
                <col style={{ width: 100 }} />
                <col style={{ width: 110 }} />
                {isManagement && <col style={{ width: 110 }} />}
                {isManagement && <col style={{ width: 50 }} />}
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
                  <th className={`${thClass} cursor-pointer`} onClick={() => hHandleSort("sku")}>
                    <SortableHeader
                      label={t("col.sku")}
                      sortKey="sku"
                      activeSortKey={hSortKey}
                      sortDir={hSortDir}
                      onSort={hHandleSort}
                    />
                  </th>
                  <th className={thClass}>{t("col.skuName")}</th>
                  <th className={`${thClass} cursor-pointer`} onClick={() => hHandleSort("supplier")}>
                    <SortableHeader
                      label={t("col.supplier")}
                      sortKey="supplier"
                      activeSortKey={hSortKey}
                      sortDir={hSortDir}
                      onSort={hHandleSort}
                    />
                  </th>
                  <th className={thClass}>TO Ref</th>
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
                      label={t("col.actualTotal")}
                      sortKey="actualTotal"
                      activeSortKey={hSortKey}
                      sortDir={hSortDir}
                      onSort={hHandleSort}
                      className="justify-end"
                    />
                  </th>
                  <th className={`${thClass} text-right`}>{t("col.stdTotal")}</th>
                  <th className={`${thClass} text-right cursor-pointer`} onClick={() => hHandleSort("variance")}>
                    <SortableHeader
                      label={t("col.variance")}
                      sortKey="variance"
                      activeSortKey={hSortKey}
                      sortDir={hSortDir}
                      onSort={hHandleSort}
                      className="justify-end"
                    />
                  </th>
                  {isManagement && <th className={thClass}>{t("col.branch")}</th>}
                  {isManagement && <th className={`${thClass} text-center`}></th>}
                </tr>
              </thead>
              <tbody>
                {displayHistory.map((r) => {
                  const sku = skuMap[r.skuId];
                  const branch = branchMap[r.branchId];
                  const isCK = !!r.transferOrderId;
                  const toNum = r.transferOrderId ? toNumberMap[r.transferOrderId] : null;
                  return (
                    <tr
                      key={r.id}
                      className="border-b border-table-border last:border-0 hover:bg-table-hover transition-colors"
                    >
                      <td className={tdReadOnly}>{r.receiptDate}</td>
                      <td className={`${tdReadOnly} font-mono truncate`}>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="block truncate">{sku?.skuId || "—"}</span>
                            </TooltipTrigger>
                            {sku?.skuId && (
                              <TooltipContent side="top">
                                <p>{sku.skuId}</p>
                              </TooltipContent>
                            )}
                          </Tooltip>
                        </TooltipProvider>
                      </td>
                      <td className={tdReadOnly}>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="block truncate">{sku?.name || "—"}</span>
                            </TooltipTrigger>
                            {sku?.name && (
                              <TooltipContent side="top">
                                <p>{sku.name}</p>
                              </TooltipContent>
                            )}
                          </Tooltip>
                        </TooltipProvider>
                      </td>
                      <td className={`${tdReadOnly} truncate`}>
                        {isCK ? (
                          <span className="flex items-center gap-1">
                            Central Kitchen
                            <span className="bg-primary/10 text-primary text-xs rounded px-1 font-medium shrink-0">
                              CK
                            </span>
                          </span>
                        ) : (
                          r.supplierName || "—"
                        )}
                      </td>
                      <td className={`${tdReadOnly} font-mono text-xs text-muted-foreground`}>{toNum || "—"}</td>
                      <td className={`${tdReadOnly} text-right font-mono font-semibold`}>
                        {r.qtyReceived.toLocaleString()}
                      </td>
                      <td className={`${tdReadOnly} text-center`}>{sku?.purchaseUom || r.uom}</td>
                      <td className={`${tdReadOnly} text-right font-mono `}>
                        ฿
                        {r.actualTotal.toLocaleString(undefined, {
                          minimumFractionDigits: 0,
                          maximumFractionDigits: 0,
                        })}
                      </td>
                      <td className={`${tdReadOnly} text-right font-mono`}>
                        ฿{r.stdTotal.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                      </td>
                      <td
                        className={`${tdReadOnly} text-right font-mono tabular-nums ${r.priceVariance > 0 ? "text-destructive" : "text-success"}`}
                      >
                        {r.priceVariance > 0
                          ? `+฿${r.priceVariance.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
                          : `฿${r.priceVariance.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`}
                      </td>
                      {isManagement && <td className={tdReadOnly}>{branch?.branchName || "—"}</td>}
                      {isManagement && (
                        <td className={`${tdReadOnly} text-center`}>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={() => {
                              deleteReceipt(r.id);
                              toast.success("Deleted");
                            }}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </td>
                      )}
                    </tr>
                  );
                })}
                {filteredHistory.length === 0 && (
                  <tr>
                    <td colSpan={12} className="px-4 py-12 text-center text-muted-foreground">
                      No receipts found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {filteredHistory.length > 0 && (
          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-lg border bg-card p-4">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Actual Spend</p>
              <p className="text-2xl font-heading font-bold mt-1">
                ฿{totalActual.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
            <div className="rounded-lg border bg-card p-4">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Std Spend</p>
              <p className="text-2xl font-heading font-bold mt-1">
                ฿{totalStd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
            <div className="rounded-lg border bg-card p-4">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Variance</p>
              <p
                className={`text-2xl font-heading font-bold mt-1 ${totalVariance > 0 ? "text-destructive" : "text-success"}`}
              >
                {totalVariance > 0 ? "+" : ""}฿
                {totalVariance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Change supplier?"
        description="Changing supplier will clear current entries. Continue?"
        confirmLabel="Continue"
        variant="warning"
        onConfirm={confirmSupplierChange}
      />
    </div>
  );
}
