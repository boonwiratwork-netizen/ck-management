import { useState, useMemo, useCallback, useRef, useEffect, Fragment } from "react";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { DatePicker } from "@/components/ui/date-picker";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import {
  Save,
  Plus,
  Trash2,
  Pencil,
  CheckCircle,
  Search,
  Truck,
  Zap,
  PackageOpen,
  X,
  MessageSquare,
} from "lucide-react";
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
  getBomCostPerGram?: (smSkuId: string) => number;
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

interface PendingPRGroup {
  supplierId: string;
  supplierName: string;
  prIds: string[];
  prNumbers: string[];
  lines: { skuId: string; suggestedQty: number; packSize: number }[];
}

interface BatchRowEdit {
  qty: number;
  actualTotal: number;
  actualManuallyEdited: boolean;
}

function getRowEditFromPrev(prev: Record<string, RowEdit>, skuId: string): RowEdit {
  return prev[skuId] || { qty: 0, actualTotal: 0, actualManuallyEdited: false, note: "" };
}

const CK_SUPPLIER_ID = "__central_kitchen__";
const BRANCH_TRANSFER_ID = "__branch_transfer__";

export default function BranchReceiptPage({
  skus,
  prices,
  branches,
  suppliers = [],
  menus = [],
  menuBomLines = [],
  getBomCostPerGram,
}: Props) {
  const { isManagement, isStoreManager, isAreaManager, profile, brandAssignments } = useAuth();
  const canSeeActions = isManagement || isStoreManager || isAreaManager;
  const { t } = useLanguage();
  const { receipts, saveReceipts, updateReceipt, deleteReceipt, fetchReceipts } = useBranchReceiptData();

  const [receiptDate, setReceiptDate] = useState<Date>(new Date());
  const [branchId, setBranchId] = useState<string>(isStoreManager && profile?.branch_id ? profile.branch_id : "");
  const [supplierId, setSupplierId] = useState<string>("");
  const [sourceBranchId, setSourceBranchId] = useState<string>("");
  const [rowEdits, setRowEdits] = useState<Record<string, RowEdit>>({});
  const [adHocRows, setAdHocRows] = useState<AdHocRow[]>([]);
  const [isCkAdHoc, setIsCkAdHoc] = useState(false);
  const [ckAdHocEdits, setCkAdHocEdits] = useState<Record<string, RowEdit>>({});
  const [savedCount, setSavedCount] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingSupplierId, setPendingSupplierId] = useState<string>("");
  const [supplierSearch, setSupplierSearch] = useState("");
  const [supplierDropdownOpen, setSupplierDropdownOpen] = useState(false);
  const supplierDropdownRef = useRef<HTMLDivElement>(null);
  const qtyRefs = useRef<Record<string, HTMLInputElement | null>>({});

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

  // Batch receive state
  const [pendingPRItems, setPendingPRItems] = useState<PendingPRGroup[]>([]);
  const [isBatchMode, setIsBatchMode] = useState(false);
  const [batchRowEdits, setBatchRowEdits] = useState<Record<string, BatchRowEdit>>({});
  const [batchSaving, setBatchSaving] = useState(false);
  const [prRefreshKey, setPrRefreshKey] = useState(0);

  // Fetch pending PR items for batch receive
  const fetchPendingPRItems = useCallback(async () => {
    if (!branchId) {
      setPendingPRItems([]);
      return;
    }
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = format(yesterday, "yyyy-MM-dd");
    const todayStr = format(new Date(), "yyyy-MM-dd");

    const { data: prs } = await supabase
      .from("purchase_requests")
      .select("id, pr_number")
      .eq("branch_id", branchId)
      .in("status", ["Submitted", "Acknowledged"])
      .lte("required_date", todayStr);

    if (!prs || prs.length === 0) {
      setPendingPRItems([]);
      return;
    }

    const prIds = prs.map((p) => p.id);
    const prNumberMap: Record<string, string> = {};
    for (const p of prs) prNumberMap[p.id] = p.pr_number;

    const { data: lines } = await supabase
      .from("purchase_request_lines")
      .select("pr_id, sku_id, requested_qty, pack_size, supplier_id")
      .in("pr_id", prIds);

    if (!lines || lines.length === 0) {
      setPendingPRItems([]);
      return;
    }

    const supplierIds = [...new Set(lines.map((l) => l.supplier_id).filter(Boolean) as string[])];
    let supplierNameMap: Record<string, string> = {};
    if (supplierIds.length > 0) {
      const { data: sups } = await supabase.from("suppliers").select("id, name").in("id", supplierIds);
      for (const s of sups || []) supplierNameMap[s.id] = s.name;
    }

    const groups: Record<
      string,
      {
        supplierName: string;
        prIds: Set<string>;
        prNumbers: Set<string>;
        lineMap: Record<string, { suggestedQty: number; packSize: number }>;
      }
    > = {};
    for (const l of lines) {
      const sid = l.supplier_id;
      if (!sid) continue;
      if (!groups[sid]) {
        groups[sid] = { supplierName: supplierNameMap[sid] || "", prIds: new Set(), prNumbers: new Set(), lineMap: {} };
      }
      groups[sid].prIds.add(l.pr_id);
      groups[sid].prNumbers.add(prNumberMap[l.pr_id] || "");
      if (groups[sid].lineMap[l.sku_id]) {
        groups[sid].lineMap[l.sku_id].suggestedQty += Number(l.requested_qty) || 0;
      } else {
        groups[sid].lineMap[l.sku_id] = {
          suggestedQty: Number(l.requested_qty) || 0,
          packSize: Number(l.pack_size) || 1,
        };
      }
    }

    setPendingPRItems(
      Object.entries(groups).map(([sid, g]) => ({
        supplierId: sid,
        supplierName: g.supplierName,
        prIds: [...g.prIds],
        prNumbers: [...g.prNumbers].filter(Boolean),
        lines: Object.entries(g.lineMap).map(([skuId, v]) => ({
          skuId,
          suggestedQty: v.suggestedQty,
          packSize: v.packSize,
        })),
      })),
    );
  }, [branchId]);

  useEffect(() => {
    fetchPendingPRItems();
  }, [fetchPendingPRItems, prRefreshKey]);

  const pendingPRSupplierCount = pendingPRItems.length;
  const pendingPRSkuCount = pendingPRItems.reduce((s, g) => s + g.lines.length, 0);

  // TO integration state
  const [pendingTOs, setPendingTOs] = useState<PendingTO[]>([]);
  const [selectedTOId, setSelectedTOId] = useState<string>("");
  const [ckLines, setCkLines] = useState<CKLineEdit[]>([]);

  // Decline TO state
  const [declineDialogOpen, setDeclineDialogOpen] = useState(false);
  const [declineTOId, setDeclineTOId] = useState<string>("");
  const [declineTONumber, setDeclineTONumber] = useState<string>("");
  const [declineReason, setDeclineReason] = useState<string>("");

  // History filters
  const [historyDateFrom, setHistoryDateFrom] = useState<Date | undefined>(undefined);
  const [historyDateTo, setHistoryDateTo] = useState<Date | undefined>(undefined);
  const [historyBranch, setHistoryBranch] = useState<string>("all");

  const dateStr = format(receiptDate, "yyyy-MM-dd");
  const weekNum = getWeekNumber(dateStr);

  const rmSkus = useMemo(
    () => skus.filter((s) => (s.type === "RM" || s.type === "PK") && s.status === "Active"),
    [skus],
  );
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
  const selectedSupplier = supplierId === CK_SUPPLIER_ID || supplierId === BRANCH_TRANSFER_ID ? null : supplierMap[supplierId];
  const isCKSupplier = supplierId === CK_SUPPLIER_ID;
  const isBranchTransfer = supplierId === BRANCH_TRANSFER_ID;

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
        note: l.notes,
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

  // Ad-hoc CK rows — SM distributable SKUs for the selected branch's brand
  const ckAdHocRows = useMemo(() => {
    if (!branchId || !selectedBranch) return [] as { skuId: string; sku: SKU; stdUnitPrice: number }[];
    const brandSmSkuIds = brandRmSkuIds; // brandRmSkuIds is actually all SKU ids (RM/SM/PK) referenced by brand's active menu BOMs
    return skus
      .filter(
        (s) =>
          s.type === "SM" &&
          s.status === "Active" &&
          s.isDistributable === true &&
          brandSmSkuIds.has(s.id),
      )
      .map((s) => ({
        skuId: s.id,
        sku: s,
        stdUnitPrice: getBomCostPerGram?.(s.id) ?? 0,
      }))
      .sort((a, b) => a.sku.skuId.localeCompare(b.sku.skuId));
  }, [branchId, selectedBranch, skus, brandRmSkuIds, getBomCostPerGram]);

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
        if (!sku || (sku.type !== "RM" && sku.type !== "PK")) return null;
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

  // SKUs available when receiving from another branch (filtered by source branch's brand)
  const branchTransferRows = useMemo(() => {
    if (!isBranchTransfer || !sourceBranchId) return [];
    const sourceBranch = branchMap[sourceBranchId];
    if (!sourceBranch) return [];
    const brandName = sourceBranch.brandName;
    const brandMenus = menus.filter((m) => m.brandName === brandName && m.status === "Active");
    const menuIds = new Set(brandMenus.map((m) => m.id));
    const relevantSkuIds = new Set(menuBomLines.filter((l) => menuIds.has(l.menuId)).map((l) => l.skuId));

    return skus
      .filter((s) => s.status === "Active" && relevantSkuIds.has(s.id))
      .map((s) => {
        const activePrice = prices.find((p) => p.skuId === s.id && p.isActive);
        return {
          skuId: s.id,
          sku: s,
          stdUnitPrice: activePrice?.pricePerUsageUom ?? 0,
        };
      })
      .sort((a, b) => {
        const typeOrder = (type: string) => (type === "SM" ? 0 : type === "RM" ? 1 : 2);
        const tDiff = typeOrder(a.sku.type) - typeOrder(b.sku.type);
        if (tDiff !== 0) return tDiff;
        return a.sku.skuId.localeCompare(b.sku.skuId);
      });
  }, [isBranchTransfer, sourceBranchId, branchMap, menus, menuBomLines, skus, prices]);

  const hasAnyQty = useMemo(() => {
    if (isBatchMode) return Object.values(batchRowEdits).some((e) => e.qty > 0) || adHocRows.some((r) => r.qty > 0);
    if (isBranchTransfer) return Object.values(rowEdits).some((e) => e.qty > 0) || adHocRows.some((r) => r.qty > 0);
    if (isCKSupplier && isCkAdHoc) return Object.values(ckAdHocEdits).some((e) => e.qty > 0);
    if (isCKSupplier) return ckLines.some((l) => l.receivedQty > 0);
    return Object.values(rowEdits).some((e) => e.qty > 0) || adHocRows.some((r) => r.qty > 0);
  }, [rowEdits, adHocRows, isCKSupplier, ckLines, isBatchMode, batchRowEdits, isBranchTransfer, isCkAdHoc, ckAdHocEdits]);

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
        setSourceBranchId("");
        setCkAdHocEdits({});
        // Auto ad-hoc when no pending TOs
        setIsCkAdHoc(newId === CK_SUPPLIER_ID && pendingTOCount === 0);
      }
      setSupplierDropdownOpen(false);
      setSupplierSearch("");
    },
    [supplierId, hasAnyQty, pendingTOCount],
  );

  const confirmSupplierChange = useCallback(() => {
    setSupplierId(pendingSupplierId);
    setRowEdits({});
    setAdHocRows([]);
    setSavedCount(null);
    setSelectedTOId("");
    setCkLines([]);
    setSourceBranchId("");
    setCkAdHocEdits({});
    setIsCkAdHoc(pendingSupplierId === CK_SUPPLIER_ID && pendingTOCount === 0);
    setConfirmOpen(false);
  }, [pendingSupplierId, pendingTOCount]);

  const handleBranchChange = useCallback((newId: string) => {
    setBranchId(newId);
    setSupplierId("");
    setRowEdits({});
    setAdHocRows([]);
    setSavedCount(null);
    setSelectedTOId("");
    setCkLines([]);
    setIsBatchMode(false);
    setBatchRowEdits({});
    setSourceBranchId("");
    setCkAdHocEdits({});
    setIsCkAdHoc(false);
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

  // Batch receive helpers
  const getBatchEdit = (supplierId: string, skuId: string): BatchRowEdit =>
    batchRowEdits[`${supplierId}-${skuId}`] || { qty: 0, actualTotal: 0, actualManuallyEdited: false };

  const updateBatchEdit = useCallback((supplierId: string, skuId: string, updates: Partial<BatchRowEdit>) => {
    const key = `${supplierId}-${skuId}`;
    setBatchRowEdits((prev) => ({
      ...prev,
      [key]: { ...(prev[key] || { qty: 0, actualTotal: 0, actualManuallyEdited: false }), ...updates },
    }));
  }, []);

  // Save all — handles both external and CK receipts
  const handleSaveAll = useCallback(async () => {
    if (!branchId) {
      toast.error("Please select a branch");
      return;
    }
    setSaving(true);

    if (isCKSupplier && isCkAdHoc) {
      const linesToSave = ckAdHocRows.filter((row) => (ckAdHocEdits[row.skuId]?.qty ?? 0) > 0);
      if (linesToSave.length === 0) {
        toast.error("No items with quantity to save");
        setSaving(false);
        return;
      }

      const rows: Omit<BranchReceipt, "id" | "createdAt">[] = linesToSave.map((row) => {
        const edit = ckAdHocEdits[row.skuId];
        const stdTotal = edit.qty * row.stdUnitPrice;
        return {
          branchId,
          receiptDate: dateStr,
          skuId: row.skuId,
          supplierName: "Central Kitchen",
          qtyReceived: edit.qty,
          uom: row.sku.usageUom || "น.",
          actualUnitPrice: row.stdUnitPrice,
          actualTotal: stdTotal,
          stdUnitPrice: row.stdUnitPrice,
          stdTotal,
          priceVariance: 0,
          notes: edit.note || "",
          transferOrderId: null,
        };
      });

      const count = await saveReceipts(rows);
      if (count) {
        setSavedCount(count);
        setCkAdHocEdits({});
        setIsCkAdHoc(false);
        setSupplierId("");
        setTimeout(() => setSavedCount(null), 4000);
      }
      setSaving(false);
      return;
    }

    if (isCKSupplier) {
      // CK receipt from TO
      if (!selectedTOId) {
        toast.error("Please select a Transfer Order");
        setSaving(false);
        return;
      }
      const capturedTOId = selectedTOId;
      const capturedTOLines = pendingTOs.find((t) => t.id === selectedTOId)?.lines ?? [];
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
        const selectedTO = pendingTOs.find((t) => t.id === selectedTOId);
        let allReceived = true;
        let anyPartial = false;
        for (const toLine of capturedTOLines || []) {
          const ckLine = ckLines.find((l) => l.toLineId === toLine.id);
          const received = ckLine?.receivedQty || 0;
          const planned = toLine.plannedQty;
          if (received < planned) {
            allReceived = false;
            if (received > 0) anyPartial = true;
          }
        }

        const newStatus = allReceived ? "Received" : anyPartial ? "Partially Received" : "Sent";

        const { error: toUpdateError } = await supabase
          .from("transfer_orders")
          .update({ status: newStatus })
          .eq("id", capturedTOId);
        if (toUpdateError) {
          toast.error("รับของสำเร็จ แต่ไม่สามารถอัปเดตสถานะใบโอนได้: " + toUpdateError.message);
          setSaving(false);
          return;
        }

        if (selectedTO) {
          const { data: toData } = await supabase
            .from("transfer_orders")
            .select("tr_id")
            .eq("id", capturedTOId)
            .single();
          if (toData?.tr_id) {
            await supabase.from("transfer_requests").update({ status: "Fulfilled" }).eq("id", toData.tr_id);
          }
        }

        await fetchPendingTOs();
        setSavedCount(count);
        setSelectedTOId("");
        setCkLines([]);
        setSupplierId("");
        setSaving(false);
        setTimeout(() => setSavedCount(null), 4000);
      }
      setSaving(false);
      return;
    }

    if (isBranchTransfer) {
      const sourceBranch = branchMap[sourceBranchId];
      const supplierLabel = `รับจากสาขา · ${sourceBranch?.branchName ?? ""}`;
      const rowsToSave: { skuId: string; qty: number; actualTotal: number; note: string; stdUnitPrice: number }[] = [];
      for (const r of adHocRows) {
        if (r.skuId && r.qty > 0) {
          const stdUnit = branchTransferRows.find((b) => b.skuId === r.skuId)?.stdUnitPrice ?? getStdUnitPrice(r.skuId);
          rowsToSave.push({ skuId: r.skuId, qty: r.qty, actualTotal: r.actualTotal, note: r.note, stdUnitPrice: stdUnit });
        }
      }
      if (rowsToSave.length === 0) {
        toast.error("No rows with quantity to save");
        setSaving(false);
        return;
      }
      const rows: Omit<BranchReceipt, "id" | "createdAt">[] = rowsToSave.map((r) => {
        const sku = skuMap[r.skuId];
        const stdTotal = r.qty * r.stdUnitPrice;
        return {
          branchId,
          receiptDate: dateStr,
          skuId: r.skuId,
          supplierName: supplierLabel,
          qtyReceived: r.qty,
          uom: sku?.usageUom || "",
          actualUnitPrice: r.stdUnitPrice,
          actualTotal: stdTotal,
          stdUnitPrice: r.stdUnitPrice,
          stdTotal,
          priceVariance: 0,
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
        setSourceBranchId("");
        setTimeout(() => setSavedCount(null), 4000);
      }
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
    isBranchTransfer,
    sourceBranchId,
    branchTransferRows,
    branchMap,
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
    isCkAdHoc,
    ckAdHocRows,
    ckAdHocEdits,
  ]);

  // Batch save all
  const handleBatchSaveAll = useCallback(async () => {
    if (!branchId) return;
    setBatchSaving(true);

    const allRows: Omit<BranchReceipt, "id" | "createdAt">[] = [];
    const allPrIds: string[] = [];

    for (const group of pendingPRItems) {
      for (const line of group.lines) {
        const edit = batchRowEdits[`${group.supplierId}-${line.skuId}`];
        if (!edit || edit.qty <= 0) continue;
        const sku = skuMap[line.skuId];
        const stdUnit = getStdUnitPrice(line.skuId);
        const stdTotal = stdUnit * edit.qty;
        const actualTotal = edit.actualManuallyEdited ? edit.actualTotal : stdTotal;
        const actualUnitPrice = edit.qty > 0 ? actualTotal / edit.qty : 0;
        const priceVariance = actualTotal - stdTotal;

        allRows.push({
          branchId,
          receiptDate: dateStr,
          skuId: line.skuId,
          supplierName: group.supplierName,
          qtyReceived: edit.qty,
          uom: sku?.purchaseUom || "",
          actualUnitPrice,
          actualTotal,
          stdUnitPrice: stdUnit,
          stdTotal,
          priceVariance,
          notes: "",
          transferOrderId: null,
        });
      }
      const groupHasQty = group.lines.some(
        (line) => (batchRowEdits[`${group.supplierId}-${line.skuId}`]?.qty ?? 0) > 0,
      );
      if (groupHasQty) allPrIds.push(...group.prIds);
    }

    // Ad-hoc rows
    for (const r of adHocRows) {
      if (r.skuId && r.qty > 0) {
        const sku = skuMap[r.skuId];
        const stdUnit = getStdUnitPrice(r.skuId);
        const stdTotal = stdUnit * r.qty;
        const actualTotal = r.actualTotal || stdTotal;
        const actualUnitPrice = r.qty > 0 ? actualTotal / r.qty : 0;
        const priceVariance = actualTotal - stdTotal;
        allRows.push({
          branchId,
          receiptDate: dateStr,
          skuId: r.skuId,
          supplierName: "",
          qtyReceived: r.qty,
          uom: sku?.purchaseUom || "",
          actualUnitPrice,
          actualTotal,
          stdUnitPrice: stdUnit,
          stdTotal,
          priceVariance,
          notes: "",
          transferOrderId: null,
        });
      }
    }

    if (allRows.length === 0) {
      toast.error("No rows with quantity to save");
      setBatchSaving(false);
      return;
    }

    const count = await saveReceipts(allRows);
    if (count) {
      // Mark PRs as Fulfilled
      if (allPrIds.length > 0) {
        await supabase.from("purchase_requests").update({ status: "Fulfilled" }).in("id", allPrIds);
      }
      setSavedCount(count);
      setIsBatchMode(false);
      setBatchRowEdits({});
      setAdHocRows([]);
      setPrRefreshKey((k) => k + 1);
      setTimeout(() => setSavedCount(null), 4000);
    }
    setBatchSaving(false);
  }, [branchId, pendingPRItems, batchRowEdits, adHocRows, skuMap, getStdUnitPrice, dateStr, saveReceipts]);

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

  const [editReceipt, setEditReceipt] = useState<BranchReceipt | null>(null);
  const [editForm, setEditForm] = useState({ qtyReceived: 0, actualTotal: 0, notes: "" });
  const [editSaving, setEditSaving] = useState(false);
  const [toNumberMap, setToNumberMap] = useState<Record<string, string>>({});
  const [toNotesMap, setToNotesMap] = useState<Record<string, string>>({});
  const [toDetailOpen, setToDetailOpen] = useState(false);
  const [toDetailData, setToDetailData] = useState<{ toNumber: string; lines: any[]; toNotes: string } | null>(null);

  const handleTORefClick = useCallback(async (toId: string, toNumber: string) => {
    const [toRes, linesRes] = await Promise.all([
      supabase.from("transfer_orders").select("notes").eq("id", toId).single(),
      supabase.from("transfer_order_lines").select("sku_id, actual_qty, uom, unit_cost, notes").eq("to_id", toId),
    ]);
    const skuIds = (linesRes.data || []).map((l: any) => l.sku_id);
    let skuNameMap: Record<string, string> = {};
    if (skuIds.length > 0) {
      const { data: skuRows } = await supabase.from("skus").select("id, sku_id, name").in("id", skuIds);
      for (const s of skuRows || []) skuNameMap[s.id] = s.name;
    }
    setToDetailData({
      toNumber,
      toNotes: toRes.data?.notes || "",
      lines: (linesRes.data || []).map((l: any) => ({
        skuId: l.sku_id,
        skuName: skuNameMap[l.sku_id] || l.sku_id,
        actualQty: l.actual_qty,
        uom: l.uom,
        unitCost: l.unit_cost,
        lineValue: l.actual_qty * l.unit_cost,
        note: l.notes || "",
      })),
    });
    setToDetailOpen(true);
  }, []);

  const handleDeclineTO = useCallback(async () => {
    if (!declineTOId) return;
    const { error } = await supabase
      .from("transfer_orders")
      .update({ status: "Declined", decline_reason: declineReason.trim() || null })
      .eq("id", declineTOId);
    if (error) {
      toast.error("ไม่สามารถปฏิเสธใบโอนได้: " + error.message);
      return;
    }
    toast.success(`ปฏิเสธใบโอน ${declineTONumber} แล้ว`);
    setDeclineDialogOpen(false);
    setDeclineTOId("");
    setDeclineTONumber("");
    setDeclineReason("");
    await fetchPendingTOs();
  }, [declineTOId, declineTONumber, declineReason, fetchPendingTOs]);
  useEffect(() => {
    const toIds = [...new Set(receipts.filter((r) => r.transferOrderId).map((r) => r.transferOrderId!))];
    if (toIds.length === 0) {
      setToNumberMap({});
      return;
    }
    supabase
      .from("transfer_orders")
      .select("id, to_number, notes")
      .in("id", toIds)
      .then(({ data }) => {
        const m: Record<string, string> = {};
        const n: Record<string, string> = {};
        (data || []).forEach((to) => {
          m[to.id] = to.to_number;
          n[to.id] = to.notes || "";
        });
        setToNumberMap(m);
        setToNotesMap(n);
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
    if (isCKSupplier && isCkAdHoc) {
      return Object.values(ckAdHocEdits).filter((e) => e.qty > 0).length;
    }
    if (isCKSupplier) return ckLines.filter((l) => l.receivedQty > 0).length;
    if (isBranchTransfer) {
      let c = 0;
      for (const r of adHocRows) {
        if (r.skuId && r.qty > 0) c++;
      }
      return c;
    }
    let c = 0;
    for (const row of preloadedRows) {
      const edit = rowEdits[row.skuId];
      if (edit && edit.qty > 0) c++;
    }
    for (const r of adHocRows) {
      if (r.skuId && r.qty > 0) c++;
    }
    return c;
  }, [preloadedRows, rowEdits, adHocRows, isCKSupplier, ckLines, isBranchTransfer, branchTransferRows, isCkAdHoc, ckAdHocEdits]);

  const batchSavableCount = useMemo(() => {
    if (!isBatchMode) return 0;
    let c = Object.values(batchRowEdits).filter((e) => e.qty > 0).length;
    for (const r of adHocRows) {
      if (r.skuId && r.qty > 0) c++;
    }
    return c;
  }, [isBatchMode, batchRowEdits, adHocRows]);

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
  const showCKSheet = isCKSupplier && !isCkAdHoc && selectedTOId && ckLines.length > 0;
  const showCkAdHocSheet = isCKSupplier && isCkAdHoc && ckAdHocRows.length > 0;
  const showExternalSheet = bothSelected && !isCKSupplier && !isBranchTransfer && preloadedRows.length > 0;
  const showBranchTransferSheet = isBranchTransfer && !!sourceBranchId;

  // Does CK search match?
  const ckMatchesSearch = "central kitchen".includes(supplierSearch.toLowerCase());

  const isFormActive = showCKSheet || showCkAdHocSheet || showExternalSheet || showBranchTransferSheet || isBatchMode;

  // Source label for header strip
  const formSourceLabel = isCKSupplier
    ? isCkAdHoc
      ? "Central Kitchen · Ad-hoc"
      : `Central Kitchen · ${pendingTOs.find((to) => to.id === selectedTOId)?.toNumber || ""}`
    : isBranchTransfer
      ? `รับจากสาขา · ${branchMap[sourceBranchId]?.branchName ?? ""}`
      : selectedSupplier?.name || "";

  // Batch total value
  const batchTotalValue = useMemo(() => {
    if (!isBatchMode) return 0;
    let total = 0;
    for (const group of pendingPRItems) {
      for (const line of group.lines) {
        const edit = batchRowEdits[`${group.supplierId}-${line.skuId}`];
        if (!edit || edit.qty <= 0) continue;
        const stdUnit = getStdUnitPrice(line.skuId);
        const stdTotal = stdUnit * edit.qty;
        total += edit.actualManuallyEdited ? edit.actualTotal : stdTotal;
      }
    }
    for (const r of adHocRows) {
      if (r.skuId && r.qty > 0) total += r.actualTotal;
    }
    return total;
  }, [isBatchMode, pendingPRItems, batchRowEdits, adHocRows, getStdUnitPrice]);

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
            <Plus className="w-4 h-4 mr-1" /> {t("br.newReceipt")}
          </Button>
        )}
      </div>

      {/* ── 2. PENDING TO DELIVERIES QUEUE ── */}
      {branchId && pendingTOCount > 0 && !isFormActive && (
        <div className="rounded-lg border border-success/30 border-l-4 border-l-success bg-success/[0.06] p-4 space-y-3">
          <div className="flex items-center gap-2">
            <StatusDot status="green" size="md" />
            <span className="text-sm font-semibold">
              {t("br.deliveriesPending").replace("{n}", String(pendingTOCount))}
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
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setDeclineTOId(to.id);
                      setDeclineTONumber(to.toNumber);
                      setDeclineReason("");
                      setDeclineDialogOpen(true);
                    }}
                  >
                    ปฏิเสธ
                  </Button>
                  <Button
                    size="sm"
                    className="bg-success hover:bg-success/90 text-success-foreground"
                    onClick={() => {
                      setSupplierId(CK_SUPPLIER_ID);
                      setSelectedTOId(to.id);
                    }}
                  >
                    {t("br.receive")}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── 2b. PENDING PR BATCH RECEIVE BANNER ── */}
      {branchId && pendingPRSupplierCount > 0 && !isFormActive && (
        <div className="rounded-lg border border-warning/30 border-l-4 border-l-warning bg-warning/[0.06] p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <StatusDot status="amber" size="md" />
              <span className="text-sm font-semibold">
                {pendingPRSupplierCount} supplier{pendingPRSupplierCount !== 1 ? "s" : ""} · {pendingPRSkuCount} item
                {pendingPRSkuCount !== 1 ? "s" : ""} pending delivery today
              </span>
            </div>
            <Button
              className="bg-warning text-warning-foreground hover:bg-warning/90"
              size="sm"
              onClick={() => {
                setIsBatchMode(true);
                setBatchRowEdits({});
                setAdHocRows([]);
                setSavedCount(null);
              }}
            >
              Receive All
            </Button>
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
                  ) : isBranchTransfer ? (
                    <>
                      <PackageOpen className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      รับจากสาขา
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
                    {ckMatchesSearch && (
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
                        {pendingTOCount > 0 && (
                          <span className="bg-success/15 text-success text-xs rounded px-1.5 py-0.5 font-medium">
                            {pendingTOCount} pending
                          </span>
                        )}
                      </button>
                    )}
                    {ckMatchesSearch && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleSupplierChange(BRANCH_TRANSFER_ID)}
                          className={cn(
                            "w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors flex items-center gap-1.5",
                            supplierId === BRANCH_TRANSFER_ID && "bg-accent font-medium",
                          )}
                        >
                          <PackageOpen className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          <span className="font-medium">รับจากสาขา</span>
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
          {/* Source branch selector when "รับจากสาขา" selected */}
          {isBranchTransfer && branchId && (
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block label-required">
                สาขาต้นทาง
              </label>
              <select
                value={sourceBranchId}
                onChange={(e) => setSourceBranchId(e.target.value)}
                className="h-9 w-[200px] px-3 text-sm border rounded-md bg-background"
              >
                <option value="">เลือกสาขา</option>
                {availableBranches
                  .filter((b) => b.id !== branchId)
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.branchName}
                    </option>
                  ))}
              </select>
            </div>
          )}
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
          {isBatchMode ? (
            <div className="flex items-center justify-between px-5 py-3 bg-primary/[0.06] border-b border-primary/10">
              <div className="flex items-center gap-4">
                <span className="font-mono text-sm font-semibold bg-muted px-2.5 py-1 rounded">BR-{dateStr}</span>
                <span className="text-sm font-medium">{t("br.batchReceive")}</span>
                {selectedBranch && <span className="text-xs text-muted-foreground">→ {selectedBranch.branchName}</span>}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setIsBatchMode(false);
                    setBatchRowEdits({});
                    setAdHocRows([]);
                    setSavedCount(null);
                  }}
                >
                  <X className="w-4 h-4 mr-1" /> {t("to.cancel")}
                </Button>
                <Button
                  size="sm"
                  className="bg-success hover:bg-success/90 text-success-foreground"
                  onClick={handleBatchSaveAll}
                  disabled={batchSavableCount === 0 || batchSaving}
                >
                  <CheckCircle className="w-4 h-4 mr-1" />
                  {batchSaving ? "Saving..." : t("br.confirmAll").replace("{n}", String(batchSavableCount))}
                </Button>
              </div>
            </div>
          ) : (
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
                  <X className="w-4 h-4 mr-1" /> {t("to.cancel")}
                </Button>
                <Button variant="outline" size="sm" disabled={savableCount === 0}>
                  <Save className="w-4 h-4 mr-1" /> {t("to.saveDraft")}
                </Button>
                <Button
                  size="sm"
                  className="bg-success hover:bg-success/90 text-success-foreground"
                  onClick={handleSaveAll}
                  disabled={savableCount === 0 || saving}
                >
                  <CheckCircle className="w-4 h-4 mr-1" />
                  {saving ? "Saving..." : t("br.confirmReceipt").replace("{n}", String(savableCount))}
                </Button>
              </div>
            </div>
          )}

          {/* Meta bar */}
          {isBatchMode ? (
            <div className="flex items-center gap-6 px-5 py-2.5 border-b bg-muted/30 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Date:</span>
                <span className="font-medium">{dateStr}</span>
                <span className="text-xs text-muted-foreground ml-1">W{weekNum}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Scope:</span>
                <span className="font-medium">
                  {pendingPRSupplierCount} supplier{pendingPRSupplierCount !== 1 ? "s" : ""} · {pendingPRSkuCount} item
                  {pendingPRSkuCount !== 1 ? "s" : ""}
                </span>
              </div>
            </div>
          ) : (
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
          )}

          {/* CK Receipt sheet from TO */}
          {showCKSheet && (
            <div className="overflow-y-auto max-h-[65vh]">
              <table className="w-full text-sm table-fixed">
                <colgroup>
                  <col style={{ width: 100 }} />
                  <col />
                  <col style={{ width: 140 }} />
                  <col style={{ width: 140 }} />
                  <col style={{ width: 140 }} />
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
                        <td className={`${tdReadOnly} align-middle`}>
                          <div className="truncate" title={sku?.name}>
                            {sku?.name || "—"}
                          </div>
                          {line.note && (
                            <div className="truncate text-xs text-muted-foreground" title={line.note}>
                              {line.note}
                            </div>
                          )}
                          {!line.note && <div className="text-xs invisible">·</div>}
                        </td>
                        {/* PLANNED */}
                        <td className={`${tdReadOnly} text-right font-mono align-middle`}>
                          {isPacksMode ? (
                            <div className="text-right">
                              <span className="text-sm font-medium">{plannedPacks}</span>
                              <span className="text-xs text-muted-foreground ml-1">{packUnit}</span>
                              <div className="text-xs text-muted-foreground">{line.plannedQty.toLocaleString()} g</div>
                            </div>
                          ) : (
                            <span className="font-mono text-sm">{line.plannedQty.toLocaleString()}</span>
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
                                  placeholder=""
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
                                  placeholder=""
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
                                <span className="font-bold">{sku?.purchaseUom || "g"}</span>
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
                        return `${totalPacks} packs`;
                      })()}
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* ── BATCH RECEIVE SHEET ── */}
          {isBatchMode && (
            <>
              <div className="overflow-y-auto max-h-[65vh]">
                <table className="w-full text-sm table-fixed">
                  <colgroup>
                    <col style={{ width: 100 }} />
                    <col />
                    <col style={{ width: 140 }} />
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
                      <th className={thClass}>SKU CODE</th>
                      <th className={thClass}>SKU NAME</th>
                      <th className={thClass}>SUPPLIER</th>
                      <th className="text-right px-3 py-2 text-xs font-medium uppercase tracking-wide whitespace-nowrap !bg-foreground text-background">
                        PACKS
                      </th>
                      <th className={`${thClass} text-right`}>WEIGHT</th>
                      <th className={`${thClass} text-right`}>ACTUAL TOTAL</th>
                      <th className={`${thClass} text-right`}>STD TOTAL</th>
                      <th className={`${thClass} text-right`}>ACTUAL UNIT</th>
                      <th className={`${thClass} text-right`}>STD UNIT</th>
                      <th className={`${thClass} text-right`}>VARIANCE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingPRItems.map((group) => (
                      <Fragment key={group.supplierId}>
                        {/* Section divider */}
                        <tr className="bg-muted/40">
                          <td colSpan={10} className="px-3 py-2">
                            <span className="font-semibold text-sm">{group.supplierName}</span>
                            <span className="font-mono text-xs text-muted-foreground ml-2">
                              {group.prNumbers.join(", ")}
                            </span>
                          </td>
                        </tr>
                        {/* SKU lines */}
                        {group.lines.map((line) => {
                          const sku = skuMap[line.skuId];
                          if (!sku) return null;
                          const edit = getBatchEdit(group.supplierId, line.skuId);
                          const packSize = sku.packSize ?? 0;
                          const packUnit = sku.packUnit ?? "";
                          const isPacksMode = packSize > 1 && packUnit.length > 0;
                          const currentPacks = isPacksMode ? Math.round(edit.qty / packSize) : 0;
                          const stdUnit = getStdUnitPrice(line.skuId);
                          const stdTotal = stdUnit * edit.qty;
                          const actualTotal = edit.actualManuallyEdited ? edit.actualTotal : stdTotal;
                          const unitPrice = edit.qty > 0 ? actualTotal / edit.qty : 0;
                          const variance = actualTotal - stdTotal;
                          const hasQty = edit.qty > 0;
                          const actualMatchesStd =
                            !edit.actualManuallyEdited || Math.abs(actualTotal - stdTotal) < 0.01;
                          const suggestedPacks = isPacksMode
                            ? Math.round(line.suggestedQty / packSize)
                            : line.suggestedQty;

                          return (
                            <tr
                              key={`${group.supplierId}-${line.skuId}`}
                              className={cn(
                                "border-b last:border-0 transition-colors",
                                hasQty ? "bg-success/5 border-l-[3px] border-l-success" : "opacity-60",
                              )}
                            >
                              <td className={`${tdReadOnly} font-mono text-xs align-middle`}>
                                <div>
                                  {sku.skuId}
                                  {isPacksMode && <div className="text-xs mt-0.5 invisible">·</div>}
                                </div>
                              </td>
                              <td className={`${tdReadOnly} align-middle`} title={sku.name}>
                                <div>
                                  <span className={cn("block truncate", hasQty ? "font-semibold" : "")}>
                                    {sku.name}
                                  </span>
                                  {isPacksMode && <div className="text-xs mt-0.5 invisible">·</div>}
                                </div>
                              </td>
                              <td className={`${tdReadOnly} text-muted-foreground truncate align-middle`}>
                                <div>
                                  {group.supplierName}
                                  {isPacksMode && <div className="text-xs mt-0.5 invisible">·</div>}
                                </div>
                              </td>
                              {/* PACKS */}
                              <td className="px-1 py-1 align-middle">
                                {isPacksMode ? (
                                  <div>
                                    <div className="flex items-center gap-1">
                                      <input
                                        type="number"
                                        inputMode="numeric"
                                        min={0}
                                        step={1}
                                        defaultValue=""
                                        key={`batch-packs-${group.supplierId}-${line.skuId}-${savedCount}`}
                                        onBlur={(e) => {
                                          const packs = Math.round(Number(e.target.value) || 0);
                                          const grams = packs * packSize;
                                          updateBatchEdit(group.supplierId, line.skuId, {
                                            qty: grams,
                                            ...(!batchRowEdits[`${group.supplierId}-${line.skuId}`]
                                              ?.actualManuallyEdited
                                              ? { actualTotal: stdUnit * grams }
                                              : {}),
                                          });
                                        }}
                                        onFocus={(e) => e.target.select()}
                                        className={cn(
                                          "h-8 text-sm text-right w-full font-mono px-2 rounded-md border-2 border-primary/40 bg-amber-50 focus:border-primary focus:ring-0 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none",
                                          hasQty && "border-success font-bold text-success",
                                        )}
                                        placeholder=""
                                      />
                                      <span className="text-xs font-medium text-muted-foreground whitespace-nowrap ml-1">
                                        {packUnit}
                                      </span>
                                    </div>
                                    <div className="text-xs text-muted-foreground mt-0.5">
                                      แนะนำ {suggestedPacks} {packUnit}
                                    </div>
                                  </div>
                                ) : (
                                  <div>
                                    <div className="flex items-center gap-1">
                                      <input
                                        type="number"
                                        min={0}
                                        step="any"
                                        defaultValue=""
                                        key={`batch-qty-${group.supplierId}-${line.skuId}-${savedCount}`}
                                        onBlur={(e) => {
                                          const val = Number(e.target.value) || 0;
                                          updateBatchEdit(group.supplierId, line.skuId, {
                                            qty: val,
                                            ...(!batchRowEdits[`${group.supplierId}-${line.skuId}`]
                                              ?.actualManuallyEdited
                                              ? { actualTotal: stdUnit * val }
                                              : {}),
                                          });
                                        }}
                                        onFocus={(e) => e.target.select()}
                                        className={cn(
                                          "h-8 text-sm text-right w-full font-mono px-2 rounded-md border-2 border-primary/40 bg-amber-50 focus:border-primary focus:ring-0 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none",
                                          hasQty && "border-success font-bold text-success",
                                        )}
                                        placeholder=""
                                      />
                                      <span className="text-xs font-medium text-muted-foreground whitespace-nowrap ml-1">
                                        {sku.usageUom}
                                      </span>
                                    </div>
                                    <div className="text-xs text-muted-foreground mt-0.5">
                                      แนะนำ {line.suggestedQty.toLocaleString()} {sku.usageUom}
                                    </div>
                                  </div>
                                )}
                              </td>
                              {/* WEIGHT */}
                              <td className="px-1 py-1 align-middle">
                                {isPacksMode ? (
                                  <div>
                                    <input
                                      type="number"
                                      inputMode="numeric"
                                      min={0}
                                      step={1}
                                      defaultValue={edit.qty || ""}
                                      key={`batch-wt-${group.supplierId}-${line.skuId}-${savedCount}-${edit.qty}`}
                                      onBlur={(e) => {
                                        const grams = Number(e.target.value) || 0;
                                        if (grams > 0) {
                                          updateBatchEdit(group.supplierId, line.skuId, {
                                            qty: grams,
                                            ...(!batchRowEdits[`${group.supplierId}-${line.skuId}`]
                                              ?.actualManuallyEdited
                                              ? { actualTotal: stdUnit * grams }
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
                                      <span className="font-bold">{sku?.purchaseUom || "g"}</span>
                                    </div>
                                  </div>
                                ) : (
                                  <span className="text-muted-foreground text-xs">—</span>
                                )}
                              </td>
                              {/* ACTUAL TOTAL */}
                              <td className="px-1 py-1 align-middle">
                                <div>
                                  <div className="flex items-center gap-1">
                                    <input
                                      type="number"
                                      min={0}
                                      step="any"
                                      defaultValue={actualTotal ? Number(actualTotal).toFixed(2) : ""}
                                      key={`batch-actual-${line.skuId}-${edit.qty}-${edit.actualManuallyEdited ? "m" : "a"}-${savedCount}`}
                                      tabIndex={-1}
                                      onBlur={(e) => {
                                        const val = Number(e.target.value) || 0;
                                        updateBatchEdit(group.supplierId, line.skuId, {
                                          actualTotal: val,
                                          actualManuallyEdited: true,
                                        });
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
                                  </div>
                                  {isPacksMode && <div className="text-xs mt-0.5 invisible">·</div>}
                                </div>
                              </td>
                              {/* STD TOTAL */}
                              <td className={`${tdReadOnly} text-right font-mono text-muted-foreground align-middle`}>
                                <div>
                                  {stdTotal > 0
                                    ? stdTotal.toLocaleString(undefined, {
                                        minimumFractionDigits: 0,
                                        maximumFractionDigits: 0,
                                      })
                                    : "—"}
                                  {isPacksMode && <div className="text-xs mt-0.5 invisible">·</div>}
                                </div>
                              </td>
                              {/* ACTUAL UNIT */}
                              <td className={`${tdReadOnly} text-right font-mono text-muted-foreground align-middle`}>
                                <div>
                                  {unitPrice > 0 ? unitPrice.toFixed(2) : "—"}
                                  {isPacksMode && <div className="text-xs mt-0.5 invisible">·</div>}
                                </div>
                              </td>
                              {/* STD UNIT */}
                              <td className={`${tdReadOnly} text-right font-mono text-muted-foreground align-middle`}>
                                <div>
                                  {stdUnit > 0 ? stdUnit.toFixed(2) : "—"}
                                  {isPacksMode && <div className="text-xs mt-0.5 invisible">·</div>}
                                </div>
                              </td>
                              {/* VARIANCE */}
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
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Ad-hoc rows for batch mode */}
              <div className="px-4 py-3 space-y-2 border-t">
                {adHocRows.length > 0 && (
                  <>
                    <p className="text-xs font-medium text-muted-foreground">Ad-hoc items (not in active PRs)</p>
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
                                  <div>
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
                                    <div className="text-xs mt-0.5 invisible">·</div>
                                  </div>
                                </td>
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
                                          key={`batch-adhoc-packs-${row.tempId}-${row.skuId}`}
                                          onBlur={(e) => {
                                            const packs = Math.round(Number(e.target.value) || 0);
                                            updateAdHoc(row.tempId, { qty: packs * packSize });
                                          }}
                                          onFocus={(e) => e.target.select()}
                                          className="h-8 text-xs text-right w-full font-mono px-2 py-1 rounded-md border-2 border-primary/40 bg-amber-50 focus:border-primary outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                          placeholder=""
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
                                          defaultValue={row.qty || ""}
                                          key={`batch-adhoc-qty-${row.tempId}-${row.skuId}`}
                                          onBlur={(e) => updateAdHoc(row.tempId, { qty: Number(e.target.value) || 0 })}
                                          onFocus={(e) => e.target.select()}
                                          className="h-8 text-xs text-right w-full font-mono px-2 py-1 border-2 border-primary/30 rounded-md bg-amber-50 focus:border-primary outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                          placeholder=""
                                        />
                                        <span className="text-xs font-medium text-muted-foreground whitespace-nowrap ml-1">
                                          {sku?.usageUom || "—"}
                                        </span>
                                      </div>
                                      <div className="text-xs mt-0.5 invisible">·</div>
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
                                        key={`batch-adhoc-wt-${row.tempId}-${row.skuId}-${row.qty}`}
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
                                        <span className="font-bold">{sku?.purchaseUom || "g"}</span>
                                      </div>
                                    </div>
                                  ) : (
                                    <div>
                                      <span className="text-muted-foreground text-xs">—</span>
                                      <div className="text-xs mt-0.5 invisible">·</div>
                                    </div>
                                  )}
                                </td>
                                <td className="px-1 py-1 align-middle">
                                  <div>
                                    <input
                                      type="number"
                                      min={0}
                                      step="any"
                                      defaultValue={row.actualTotal || ""}
                                      key={`batch-adhoc-actual-${row.tempId}`}
                                      onBlur={(e) =>
                                        updateAdHoc(row.tempId, { actualTotal: Number(e.target.value) || 0 })
                                      }
                                      onFocus={(e) => e.target.select()}
                                      className="h-8 text-xs text-right w-full font-mono px-2 py-1 border rounded-md bg-warning/5 border-warning/20 focus:border-primary outline-none"
                                      placeholder="0.00"
                                    />
                                    <div className="text-xs mt-0.5 invisible">·</div>
                                  </div>
                                </td>
                                <td className="px-1 py-1 text-center align-middle">
                                  <div>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 text-destructive hover:text-destructive"
                                      onClick={() => deleteAdHoc(row.tempId)}
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </Button>
                                    <div className="text-xs mt-0.5 invisible">·</div>
                                  </div>
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
                      <th className={`${thClass} text-right`}>{t("col.stdTotal")}</th>
                      <th className={`${thClass} text-right`}>{t("col.actualUnit")}</th>
                      <th className={`${thClass} text-right`}>{t("col.stdUnit")}</th>
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
                                    ref={(el) => {
                                      qtyRefs.current[row.skuId] = el;
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") {
                                        e.preventDefault();
                                        const idx = preloadedRows.findIndex((r) => r.skuId === row.skuId);
                                        const nextRow = preloadedRows[idx + 1];
                                        if (nextRow) qtyRefs.current[nextRow.skuId]?.focus();
                                      }
                                    }}
                                    className={cn(
                                      "h-8 text-sm text-right w-full font-mono px-2 rounded-md border-2 border-primary/40 bg-amber-50 focus:border-primary focus:ring-0 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none",
                                      hasQty && "border-success font-bold text-success",
                                    )}
                                    placeholder=""
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
                                  ref={(el) => {
                                    qtyRefs.current[row.skuId] = el;
                                  }}
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
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      e.preventDefault();
                                      const idx = preloadedRows.findIndex((r) => r.skuId === row.skuId);
                                      const nextRow = preloadedRows[idx + 1];
                                      if (nextRow) qtyRefs.current[nextRow.skuId]?.focus();
                                    }
                                  }}
                                  className={cn(
                                    "h-8 text-sm text-right w-full font-mono px-2 rounded-md border-2 border-primary/40 bg-amber-50 focus:border-primary focus:ring-0 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none",
                                    hasQty && "border-success font-bold text-success",
                                  )}
                                  placeholder=""
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
                              </div>
                              {isPacksMode && <div className="text-xs mt-0.5 invisible">·</div>}
                            </div>
                          </td>
                          <td className={`${tdReadOnly} text-right font-mono text-muted-foreground align-middle`}>
                            <div>
                              {stdTotal > 0
                                ? stdTotal.toLocaleString(undefined, {
                                    minimumFractionDigits: 0,
                                    maximumFractionDigits: 0,
                                  })
                                : "—"}
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
                                  <div>
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
                                    <div className="text-xs mt-0.5 invisible">·</div>
                                  </div>
                                </td>
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
                                          key={`adhoc-packs-${row.tempId}-${row.skuId}`}
                                          onBlur={(e) => {
                                            const packs = Math.round(Number(e.target.value) || 0);
                                            updateAdHoc(row.tempId, { qty: packs * packSize });
                                          }}
                                          onFocus={(e) => e.target.select()}
                                          className="h-8 text-xs text-right w-full font-mono px-2 py-1 rounded-md border-2 border-primary/40 bg-amber-50 focus:border-primary outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                          placeholder=""
                                        />
                                        <span className="text-xs font-medium text-muted-foreground whitespace-nowrap ml-1">
                                          {packUnit}
                                        </span>
                                        <div className="text-xs mt-0.5 invisible">·</div>
                                      </div>
                                    </div>
                                  ) : (
                                    <div>
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
                                          placeholder=""
                                        />
                                        <span className="text-xs font-medium text-muted-foreground whitespace-nowrap ml-1">
                                          {sku?.usageUom || "—"}
                                        </span>
                                      </div>
                                      <div className="text-xs mt-0.5 invisible">·</div>
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
                                        <span className="font-bold">{sku?.purchaseUom || "g"}</span>
                                      </div>
                                    </div>
                                  ) : (
                                    <div>
                                      <span className="text-muted-foreground text-xs">—</span>
                                      <div className="text-xs mt-0.5 invisible">·</div>
                                    </div>
                                  )}
                                </td>

                                <td className="px-1 py-1 align-middle">
                                  <div>
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
                                    <div className="text-xs mt-0.5 invisible">·</div>
                                  </div>
                                </td>

                                <td className="px-1 py-1 text-center align-middle">
                                  <div>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 text-destructive hover:text-destructive"
                                      onClick={() => deleteAdHoc(row.tempId)}
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </Button>
                                    <div className="text-xs mt-0.5 invisible">·</div>
                                  </div>
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

          {/* Branch transfer sheet — ad-hoc only */}
          {showBranchTransferSheet && (
            <div className="px-4 py-3 space-y-2 border-t">
              {adHocRows.length > 0 && (
                <div className="rounded-lg border bg-card overflow-hidden">
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
                      <col style={{ width: 50 }} />
                    </colgroup>
                    <thead>
                      <tr className="bg-table-header border-b">
                        <th className={thClass}>{t("col.sku")}</th>
                        <th className={thClass}>{t("col.skuName")}</th>
                        <th className={thClass}>{t("col.supplier")}</th>
                        <th className="text-right px-3 py-2 text-xs font-medium uppercase tracking-wide whitespace-nowrap !bg-foreground text-background">
                          PACKS
                        </th>
                        <th className={`${thClass} text-right`}>WEIGHT</th>
                        <th className={`${thClass} text-right`}>{t("col.actualTotal")}</th>
                        <th className={`${thClass} text-right`}>{t("col.stdTotal")}</th>
                        <th className={`${thClass} text-right`}>{t("col.actualUnit")}</th>
                        <th className={`${thClass} text-right`}>{t("col.stdUnit")}</th>
                        <th className={`${thClass} text-right`}>{t("col.variance")}</th>
                        <th className={`${thClass} text-center`}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {adHocRows.map((row) => {
                        const sku = skuMap[row.skuId];
                        const packSize = sku?.packSize ?? 0;
                        const packUnit = sku?.packUnit ?? "";
                        const isPacksMode = !!sku && packSize > 1 && packUnit.length > 0;
                        const currentPacks = isPacksMode ? Math.round(row.qty / packSize) : 0;
                        const stdUnitPrice = branchTransferRows.find((r) => r.skuId === row.skuId)?.stdUnitPrice ?? 0;
                        const stdTotal = stdUnitPrice * row.qty;
                        const actualTotal = row.actualTotal || stdTotal;
                        const unitPrice = row.qty > 0 ? actualTotal / row.qty : 0;
                        const variance = actualTotal - stdTotal;
                        const hasQty = row.qty > 0;

                        return (
                          <tr
                            key={row.tempId}
                            className={cn(
                              "border-b last:border-0 transition-colors",
                              hasQty ? "bg-success/5 border-l-[3px] border-l-success" : "bg-accent/30",
                            )}
                          >
                            <td className="px-1 py-1 align-middle" colSpan={2}>
                              <SearchableSelect
                                value={row.skuId}
                                onValueChange={(v) => updateAdHoc(row.tempId, { skuId: v })}
                                options={branchTransferRows.map((r) => ({
                                  value: r.skuId,
                                  label: `${r.sku.skuId} — ${r.sku.name}`,
                                  sublabel: r.sku.skuId,
                                }))}
                                placeholder="Select SKU"
                                triggerClassName="h-8 text-xs truncate"
                              />
                            </td>
                            <td className={`${tdReadOnly} text-muted-foreground truncate align-middle`}>
                              {branchMap[sourceBranchId]?.branchName ?? ""}
                            </td>
                            {/* PACKS */}
                            <td className="px-1 py-1 align-middle">
                              {isPacksMode ? (
                                <div className="flex items-center gap-1">
                                  <input
                                    type="number"
                                    inputMode="numeric"
                                    min={0}
                                    step={1}
                                    defaultValue={currentPacks || ""}
                                    key={`bt-packs-${row.tempId}-${row.skuId}`}
                                    onBlur={(e) => {
                                      const packs = Math.round(Number(e.target.value) || 0);
                                      updateAdHoc(row.tempId, { qty: packs * packSize });
                                    }}
                                    onFocus={(e) => e.target.select()}
                                    className={cn(
                                      "h-8 text-sm text-right w-full font-mono px-2 rounded-md border-2 border-primary/40 bg-amber-50 focus:border-primary focus:ring-0 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none",
                                      hasQty && "border-success font-bold text-success",
                                    )}
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
                                    key={`bt-qty-${row.tempId}-${row.skuId}`}
                                    onBlur={(e) => updateAdHoc(row.tempId, { qty: Number(e.target.value) || 0 })}
                                    onFocus={(e) => e.target.select()}
                                    className={cn(
                                      "h-8 text-sm text-right w-full font-mono px-2 rounded-md border-2 border-primary/40 bg-amber-50 focus:border-primary focus:ring-0 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none",
                                      hasQty && "border-success font-bold text-success",
                                    )}
                                  />
                                  <span className="text-xs font-medium text-muted-foreground whitespace-nowrap ml-1">
                                    {sku?.usageUom || "—"}
                                  </span>
                                </div>
                              )}
                            </td>
                            {/* WEIGHT */}
                            <td className="px-1 py-1 align-middle">
                              {isPacksMode ? (
                                <div>
                                  <input
                                    type="number"
                                    inputMode="numeric"
                                    min={0}
                                    step={1}
                                    defaultValue={row.qty || ""}
                                    key={`bt-wt-${row.tempId}-${row.skuId}-${row.qty}`}
                                    onBlur={(e) => {
                                      const grams = Number(e.target.value) || 0;
                                      if (grams > 0) updateAdHoc(row.tempId, { qty: grams });
                                    }}
                                    onFocus={(e) => e.target.select()}
                                    placeholder="ยอดนับจริง"
                                    className="h-8 w-full text-sm font-sans text-right px-2 rounded-md border border-input bg-amber-50/60 opacity-80 focus:border-primary focus:ring-0 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                  />
                                  <div className="text-xs text-muted-foreground mt-0.5 text-right">
                                    est. {(currentPacks * packSize).toLocaleString()}{" "}
                                    <span className="font-bold">{sku?.purchaseUom || "g"}</span>
                                  </div>
                                </div>
                              ) : (
                                <span className="text-muted-foreground text-xs">—</span>
                              )}
                            </td>
                            {/* ACTUAL TOTAL */}
                            <td className="px-1 py-1 align-middle">
                              <input
                                type="number"
                                min={0}
                                step="any"
                                defaultValue={row.actualTotal ? Number(row.actualTotal).toFixed(2) : ""}
                                key={`bt-actual-${row.tempId}-${row.qty}`}
                                tabIndex={-1}
                                onBlur={(e) => updateAdHoc(row.tempId, { actualTotal: Number(e.target.value) || 0 })}
                                onFocus={(e) => e.target.select()}
                                className="h-8 text-xs text-right w-full font-mono px-2 py-1 border rounded-md bg-warning/5 border-warning/20 focus:border-primary outline-none"
                                placeholder="0.00"
                              />
                            </td>
                            <td className={`${tdReadOnly} text-right font-mono text-muted-foreground align-middle`}>
                              {stdTotal > 0
                                ? stdTotal.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })
                                : "—"}
                            </td>
                            <td className={`${tdReadOnly} text-right font-mono text-muted-foreground align-middle`}>
                              {unitPrice > 0 ? unitPrice.toFixed(2) : "—"}
                            </td>
                            <td className={`${tdReadOnly} text-right font-mono text-muted-foreground align-middle`}>
                              {stdUnitPrice > 0 ? stdUnitPrice.toFixed(2) : "—"}
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
                              {hasQty ? (
                                <>
                                  {variance > 0 ? "+" : ""}
                                  {variance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </>
                              ) : (
                                "—"
                              )}
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
              )}
              <button
                type="button"
                onClick={handleAddAdHoc}
                className="w-full border-2 border-dashed border-primary/40 text-primary hover:border-primary/60 hover:bg-accent rounded-md py-2 text-sm transition-colors flex items-center justify-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" /> {t("btn.addRow")}
              </button>
            </div>
          )}

          {/* Footer bar */}
          {isBatchMode ? (
            <div className="flex items-center justify-between px-5 py-3 border-t bg-muted/30">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground uppercase tracking-wide">{t("br.totalValue")}</span>
                <span className="text-lg font-heading font-bold">
                  ฿{batchTotalValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
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
                  onClick={handleBatchSaveAll}
                  disabled={batchSavableCount === 0 || batchSaving}
                >
                  <CheckCircle className="w-4 h-4 mr-1" />
                  {batchSaving ? "Saving..." : t("br.confirmAll").replace("{n}", String(batchSavableCount))}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between px-5 py-3 border-t bg-muted/30">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground uppercase tracking-wide">{t("br.totalValue")}</span>
                <span className="text-lg font-heading font-bold">
                  ฿
                  {(isCKSupplier
                    ? ckLines.reduce((s, l) => s + l.receivedQty * l.unitCost, 0)
                    : showBranchTransferSheet
                      ? adHocRows.reduce((s, r) => s + r.actualTotal, 0)
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
                  {saving ? "Saving..." : t("br.confirmReceipt").replace("{n}", String(savableCount))}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── 4. EMPTY STATE ── */}
      {!isFormActive && branchId && pendingTOCount === 0 && pendingPRSupplierCount === 0 && (
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
        <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          {t("br.receiptHistory")}
        </span>
      </div>

      <div className="space-y-4">
        <div className="flex flex-wrap gap-3">
          <DateRangePicker
            from={historyDateFrom}
            to={historyDateTo}
            onChange={(r) => {
              setHistoryDateFrom(r.from);
              setHistoryDateTo(r.to);
            }}
            placeholder={`${t("common.from")} – ${t("common.to")}`}
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
                <col style={{ width: 85 }} /> {/* date */}
                <col style={{ width: 70 }} /> {/* sku */}
                <col style={{ width: 195 }} /> {/* name */}
                <col style={{ width: 70 }} /> {/* supplier */}
                <col style={{ width: 115 }} /> {/* TO ref */}
                <col style={{ width: 65 }} /> {/* qty */}
                <col style={{ width: 60 }} /> {/* uom */}
                <col style={{ width: 75 }} /> {/* actual */}
                <col style={{ width: 75 }} /> {/* std */}
                <col style={{ width: 70 }} /> {/* variance */}
                {isManagement && <col style={{ width: 50 }} />} {/* branch */}
                {canSeeActions && <col style={{ width: 50 }} />} {/* actions */}
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
                  {canSeeActions && <th className={`${thClass} text-center`}></th>}
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
                      <td className={`${tdReadOnly} truncate`}>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="truncate">{sku?.skuId || "—"}</span>
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
                        <div className="flex items-center gap-1 min-w-0">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="truncate block">{sku?.name || "—"}</span>
                              </TooltipTrigger>
                              <TooltipContent side="top">
                                <p>{sku?.name}</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                          {r.notes && (
                            <TooltipProvider delayDuration={200}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <MessageSquare className="w-3 h-3 text-muted-foreground shrink-0" />
                                </TooltipTrigger>
                                <TooltipContent side="top" className="max-w-xs">
                                  <p className="text-xs">{r.notes}</p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                        </div>
                      </td>
                      <td className={`${tdReadOnly} truncate`}>
                        {isCK ? (
                          <span className="bg-primary/10 text-primary text-xs rounded px-1 font-medium shrink-0">
                            CK
                          </span>
                        ) : (
                          r.supplierName || "—"
                        )}
                      </td>
                      <td className={`${tdReadOnly} font-mono text-xs`}>
                        {toNum && r.transferOrderId ? (
                          <button
                            type="button"
                            className="text-primary hover:underline font-mono text-xs inline-flex items-center gap-1"
                            onClick={() => handleTORefClick(r.transferOrderId!, toNum)}
                          >
                            {toNum}
                            {toNotesMap[r.transferOrderId!] && (
                              <MessageSquare className="w-3 h-3 text-muted-foreground shrink-0" />
                            )}
                          </button>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
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
                      {canSeeActions && (() => {
                        const canEditRow =
                          isManagement ||
                          (isStoreManager && r.branchId === profile?.branch_id) ||
                          (isAreaManager && brandAssignments.includes(branchMap[r.branchId]?.brandName));
                        if (!canEditRow) return <td className={tdReadOnly}></td>;
                        return (
                          <td className={`${tdReadOnly} text-center`}>
                            <span className="inline-flex gap-0.5">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => {
                                  setEditReceipt(r);
                                  setEditForm({ qtyReceived: r.qtyReceived, actualTotal: r.actualTotal, notes: r.notes });
                                }}
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </Button>
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
                            </span>
                          </td>
                        );
                      })()}
                    </tr>
                  );
                })}
                {filteredHistory.length === 0 && (
                  <tr>
                    <td colSpan={12} className="px-4 py-12 text-center text-muted-foreground">
                      {t("br.noReceiptsFound")}
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
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {t("br.totalActualSpend")}
              </p>
              <p className="text-2xl font-heading font-bold mt-1">
                ฿{totalActual.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
            <div className="rounded-lg border bg-card p-4">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {t("br.totalStdSpend")}
              </p>
              <p className="text-2xl font-heading font-bold mt-1">
                ฿{totalStd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
            <div className="rounded-lg border bg-card p-4">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {t("br.totalVariance")}
              </p>
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

      <Dialog
        open={!!editReceipt}
        onOpenChange={(open) => {
          if (!open) setEditReceipt(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit Receipt</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Qty Received</label>
              <Input
                type="number"
                min={0}
                step="any"
                value={editForm.qtyReceived}
                onChange={(e) => setEditForm((f) => ({ ...f, qtyReceived: Number(e.target.value) || 0 }))}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Actual Total (฿)</label>
              <Input
                type="number"
                min={0}
                step="any"
                value={editForm.actualTotal}
                onChange={(e) => setEditForm((f) => ({ ...f, actualTotal: Number(e.target.value) || 0 }))}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Notes</label>
              <Input value={editForm.notes} onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditReceipt(null)}>
              Cancel
            </Button>
            <Button
              disabled={editSaving}
              onClick={async () => {
                if (!editReceipt) return;
                setEditSaving(true);
                const ok = await updateReceipt(editReceipt.id, {
                  qtyReceived: editForm.qtyReceived,
                  actualTotal: editForm.actualTotal,
                  notes: editForm.notes,
                  stdUnitPrice: editReceipt.stdUnitPrice,
                });
                setEditSaving(false);
                if (ok) {
                  setEditReceipt(null);
                  toast.success("Receipt updated");
                }
              }}
            >
              {editSaving ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* TO Detail Modal */}
      <Dialog open={toDetailOpen} onOpenChange={setToDetailOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-mono">{toDetailData?.toNumber}</DialogTitle>
          </DialogHeader>
          {toDetailData?.toNotes && (
            <div className="rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Notes:</span> {toDetailData.toNotes}
            </div>
          )}
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-table-header border-b">
                  <th className={thClass}>SKU Name</th>
                  <th className={`${thClass} text-right`}>Actual Qty</th>
                  <th className={`${thClass} text-center`}>UOM</th>
                  <th className={`${thClass} text-right`}>Line Value</th>
                  <th className={thClass}>Note</th>
                </tr>
              </thead>
              <tbody>
                {(toDetailData?.lines || []).map((l: any, i: number) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className={tdReadOnly}>{l.skuName}</td>
                    <td className={`${tdReadOnly} text-right font-mono`}>{l.actualQty.toLocaleString()}</td>
                    <td className={`${tdReadOnly} text-center`}>{l.uom}</td>
                    <td className={`${tdReadOnly} text-right font-mono`}>
                      ฿{l.lineValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                    </td>
                    <td className={`${tdReadOnly} text-muted-foreground text-xs`}>{l.note || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Change supplier?"
        description="Changing supplier will clear current entries. Continue?"
        confirmLabel="Continue"
        variant="warning"
        onConfirm={confirmSupplierChange}
      />
      {/* Decline TO Dialog */}
      <Dialog
        open={declineDialogOpen}
        onOpenChange={(o) => {
          if (!o) {
            setDeclineDialogOpen(false);
            setDeclineReason("");
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>ปฏิเสธการรับของจาก {declineTONumber}?</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Input
              placeholder="เหตุผล เช่น สินค้าเทส"
              value={declineReason}
              onChange={(e) => setDeclineReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeclineDialogOpen(false);
                setDeclineReason("");
              }}
            >
              ยกเลิก
            </Button>
            <Button variant="destructive" onClick={handleDeclineTO}>
              ยืนยันปฏิเสธ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
