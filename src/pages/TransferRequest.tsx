import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useTransferRequest, TRHistoryRow, TRDetailLine } from "@/hooks/use-transfer-request";
import { usePurchaseRequest, PRHistoryRow, PRDetailLine } from "@/hooks/use-purchase-request";
import { useBranchData } from "@/hooks/use-branch-data";
import { useBranchSmStock, BranchSmStockStatus } from "@/hooks/use-branch-sm-stock";
import { useBranchRmStock, BranchRmStockStatus } from "@/hooks/use-branch-rm-stock";
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
import { cn } from "@/lib/utils";
import { Plus, Eye, Printer, Ban, Info, Copy, Search, Zap, AlertTriangle, X, ClipboardList } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { useLanguage } from "@/hooks/use-language";
import { supabase } from "@/integrations/supabase/client";

const stockStatusToDot: Record<BranchSmStockStatus | BranchRmStockStatus, StatusDotStatus> = {
  critical: "red",
  low: "amber",
  sufficient: "green",
  "no-data": "red",
};

const statusBadgeClass: Record<string, string> = {
  Draft: "bg-[#F1EFE8] text-[#5F5E5A]",
  Submitted: "bg-[#FAEEDA] text-[#633806]",
  Acknowledged: "bg-[#E6F1FB] text-[#0C447C]",
  Fulfilled: "bg-[#EAF3DE] text-[#27500A]",
  Cancelled: "bg-[#FCEBEB] text-[#791F1F]",
};

const CK_SUPPLIER_ID = "__central_kitchen__";

interface SupplierOption {
  id: string;
  name: string;
  isCK: boolean;
  pendingPRCount: number;
}

export default function TransferRequestPage() {
  const { t } = useLanguage();
  const { profile, role, isManagement, isStoreManager, isAreaManager, isCkManager, brandAssignments, user } = useAuth();
  const branchId = profile?.branch_id || null;
  const { branches } = useBranchData();

  // Management can select any branch
  const [selectedBranchId, setSelectedBranchId] = useState<string>("");
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

  // Supplier selection
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>(CK_SUPPLIER_ID);
  const isCKSelected = selectedSupplierId === CK_SUPPLIER_ID;

  // Supplier dropdown state
  const [supplierDropdownOpen, setSupplierDropdownOpen] = useState(false);
  const [supplierSearch, setSupplierSearch] = useState("");
  const supplierDropdownRef = useRef<HTMLDivElement>(null);
  const [supplierOptions, setSupplierOptions] = useState<SupplierOption[]>([]);
  const [showAllSuppliers, setShowAllSuppliers] = useState(false);

  // TR hook (for CK)
  const trHook = useTransferRequest(isCKSelected ? effectiveBranchId || null : null, profileId);

  // PR hook
  const prHook = usePurchaseRequest(effectiveBranchId || null);

  // RM stock hook (for external supplier)
  const {
    rmStock,
    rmSkuList,
    loading: rmLoading,
    zeroLeadTimeCount,
  } = useBranchRmStock(!isCKSelected ? effectiveBranchId || null : null, !isCKSelected ? selectedSupplierId : null);

  // Pending PR counts per supplier
  const [pendingPRCounts, setPendingPRCounts] = useState<Record<string, number>>({});

  const canCreateTR = isStoreManager || isManagement;
  const [formOpen, setFormOpen] = useState(false);
  const [sortMode, setSortMode] = useState<"code" | "priority">("code");

  // Shared form state
  const [requiredDate, setRequiredDate] = useState<Date | undefined>(undefined);
  const [notes, setNotes] = useState("");

  // PR batch inputs (separate from TR)
  const [prBatchInputs, setPrBatchInputs] = useState<Record<string, number>>({});
  const [prSubmitting, setPrSubmitting] = useState(false);

  // TR detail state
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailTR, setDetailTR] = useState<TRHistoryRow | null>(null);
  const [detailLines, setDetailLines] = useState<TRDetailLine[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  // PR detail state
  const [prDetailOpen, setPrDetailOpen] = useState(false);
  const [detailPR, setDetailPR] = useState<PRHistoryRow | null>(null);
  const [prDetailLines, setPrDetailLines] = useState<PRDetailLine[]>([]);
  const [prDetailLoading, setPrDetailLoading] = useState(false);

  // History filters
  const [filterBranch, setFilterBranch] = useState<string>("");
  const [filterStatus, setFilterStatus] = useState<string>("All");
  const [filterFrom, setFilterFrom] = useState<Date | undefined>(undefined);
  const [filterTo, setFilterTo] = useState<Date | undefined>(undefined);

  // PR history filters
  const [prFilterBranch, setPrFilterBranch] = useState<string>("");
  const [prFilterStatus, setPrFilterStatus] = useState<string>("All");
  const [prFilterFrom, setPrFilterFrom] = useState<Date | undefined>(undefined);
  const [prFilterTo, setPrFilterTo] = useState<Date | undefined>(undefined);

  // PR search
  const [prSkuSearch, setPrSkuSearch] = useState("");

  // SKU finder (search by name flow)
  const [skuFinderOpen, setSkuFinderOpen] = useState(false);
  const [skuFinderQuery, setSkuFinderQuery] = useState("");
  const [skuFinderResults, setSkuFinderResults] = useState<
    Array<{ skuId: string; skuCode: string; skuName: string; supplierId: string; supplierName: string }>
  >([]);
  const [skuFinderTargetSkuId, setSkuFinderTargetSkuId] = useState<string | null>(null);
  const [skuFinderLoading, setSkuFinderLoading] = useState(false);

  const branchName = useMemo(() => {
    if (!effectiveBranchId) return "";
    return branches.find((b) => b.id === effectiveBranchId)?.branchName || "";
  }, [effectiveBranchId, branches]);

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

  const today = useMemo(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }, []);

  // ─── Load relevant suppliers for the selected branch ───
  useEffect(() => {
    if (!effectiveBranchId) {
      setSupplierOptions([]);
      return;
    }

    const loadSuppliers = async () => {
      // Get branch brand
      const branch = branches.find((b) => b.id === effectiveBranchId);
      if (!branch) return;

      // Get active menus for brand
      const { data: menus } = await supabase
        .from("menus")
        .select("id")
        .eq("brand_name", branch.brandName)
        .eq("status", "Active");
      const menuIds = (menus || []).map((m) => m.id);

      // Get SM sku_ids from menu_bom
      let ingredientSkuIds = new Set<string>();
      if (menuIds.length > 0) {
        const { data: bomLines } = await supabase.from("menu_bom").select("sku_id").in("menu_id", menuIds);
        const smIds = (bomLines || []).map((b) => b.sku_id);

        // Get RM ingredients from sp_bom
        if (smIds.length > 0) {
          const { data: spBomLines } = await supabase.from("sp_bom").select("ingredient_sku_id").in("sp_sku_id", smIds);
          (spBomLines || []).forEach((l) => ingredientSkuIds.add(l.ingredient_sku_id));
        }
        // Also include direct ingredients
        smIds.forEach((id) => ingredientSkuIds.add(id));
      }

      // Send request data from supabase
      const relevantSupplierIds = new Set<string>();
      const [suppliersResult, counts] = await Promise.all([
        supabase.from("suppliers").select("id, name, is_central_kitchen, status").eq("status", "Active"),
        prHook.getPendingPRCountsBySupplier(effectiveBranchId),
      ]);
      const allSuppliers = suppliersResult.data;

      if (ingredientSkuIds.size > 0) {
        const { data: priceData } = await supabase
          .from("prices")
          .select("supplier_id")
          .eq("is_active", true)
          .in("sku_id", [...ingredientSkuIds]);
        (priceData || []).forEach((p) => {
          if (p.supplier_id) relevantSupplierIds.add(p.supplier_id);
        });
      }

      setPendingPRCounts(counts);

      const opts: SupplierOption[] = [];

      // CK pinned at top
      const ckSupplier = (allSuppliers || []).find((s) => s.is_central_kitchen);
      opts.push({
        id: CK_SUPPLIER_ID,
        name: "Central Kitchen",
        isCK: true,
        pendingPRCount: 0,
      });

      // Relevant external suppliers
      const relevant = (allSuppliers || []).filter((s) => !s.is_central_kitchen && relevantSupplierIds.has(s.id));
      const other = (allSuppliers || []).filter((s) => !s.is_central_kitchen && !relevantSupplierIds.has(s.id));

      relevant.sort((a, b) => a.name.localeCompare(b.name));
      other.sort((a, b) => a.name.localeCompare(b.name));

      for (const s of relevant) {
        opts.push({ id: s.id, name: s.name, isCK: false, pendingPRCount: counts[s.id] || 0 });
      }

      // Store all suppliers in state; "show all" toggle will reveal `other`
      setSupplierOptions(opts);
      // Also store "other" suppliers — we'll append with the showAll flag
      setAllOtherSuppliers(
        other.map((s) => ({ id: s.id, name: s.name, isCK: false, pendingPRCount: counts[s.id] || 0 })),
      );
    };

    loadSuppliers();
  }, [effectiveBranchId, branches]);

  const [allOtherSuppliers, setAllOtherSuppliers] = useState<SupplierOption[]>([]);

  const displayedSuppliers = useMemo(() => {
    const base = showAllSuppliers ? [...supplierOptions, ...allOtherSuppliers] : supplierOptions;
    const q = supplierSearch.toLowerCase();
    if (!q) return base;
    return base.filter((s) => s.name.toLowerCase().includes(q));
  }, [supplierOptions, allOtherSuppliers, showAllSuppliers, supplierSearch]);

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

  const selectedSupplierName = useMemo(() => {
    if (isCKSelected) return "Central Kitchen";
    const all = [...supplierOptions, ...allOtherSuppliers];
    return all.find((s) => s.id === selectedSupplierId)?.name || "";
  }, [selectedSupplierId, isCKSelected, supplierOptions, allOtherSuppliers]);

  // ─── TR sorting ───
  const statusOrder: Record<string, number> = { critical: 0, low: 1, sufficient: 2, "no-data": 3 };

  const sortedTRLines = useMemo(() => {
    const arr = [...trHook.lines];
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
  }, [trHook.lines, sortMode]);

  // ─── PR SKU lines ───
  const prLines = useMemo(() => {
    return rmSkuList
      .map((sku) => {
        const stock = rmStock[sku.skuId] || {
          stockOnHand: 0,
          avgDailyUsage: 0,
          peakDailyUsage: 0,
          rop: 0,
          parstock: 0,
          suggestedOrder: 0,
          suggestedBatches: 0,
          status: "no-data" as BranchRmStockStatus,
        };
        return { ...sku, ...stock };
      })
      .sort((a, b) => a.skuCode.localeCompare(b.skuCode));
  }, [rmSkuList, rmStock]);

  const filteredPrLines = useMemo(() => {
    if (!prSkuSearch) return prLines;
    const q = prSkuSearch.toLowerCase();
    return prLines.filter((l) => l.skuCode.toLowerCase().includes(q) || l.skuName.toLowerCase().includes(q));
  }, [prLines, prSkuSearch]);

  // ─── TR form state ───
  const [submitting, setSubmitting] = useState(false);
  const [batchInputs, setBatchInputs] = useState<Record<string, number>>({});
  const [coverDayInputs, setCoverDayInputs] = useState<Record<string, number>>({});
  const qtyInputRefs = useRef<Record<string, HTMLInputElement>>({});
  const prQtyInputRefs = useRef<Record<string, HTMLInputElement>>({});

  // PR items to order
  const prItemsToOrder = useMemo(() => Object.values(prBatchInputs).filter((v) => v > 0).length, [prBatchInputs]);
  const calcCoverDay = (stockOnHand: number, avgDailyUsage: number, extraQty: number = 0) => {
    if (avgDailyUsage <= 0) return null;
    return (stockOnHand + extraQty) / avgDailyUsage;
  };
  const canSubmitPR = !!requiredDate && prItemsToOrder > 0;

  // ─── Handlers ───
  const handleTRSubmit = useCallback(async () => {
    setSubmitting(true);
    const result = await trHook.submitTR();
    setSubmitting(false);
    if ("error" in result) {
      toast.error(result.error);
    } else {
      toast.success(`Transfer Request ${result.trNumber} submitted`);
      navigator.clipboard
        .writeText(
          [
            `📦 [${branchName}] - สั่งวัตถุดิบ`,
            `วันส่งสินค้า: ${trHook.requiredDate ? toLocalDateStr(trHook.requiredDate) : ""}`,
            ``,
            `🧾 รายการ:`,
            ...sortedTRLines
              .filter((l) => (batchInputs[l.skuId] ?? 0) > 0)
              .map((l) => `- ${l.skuName} — ${formatNumber(l.packSize, 0)} ก. x ${batchInputs[l.skuId]} แพ็ค`),
            ``,
            `🙏 ถ้าคอนเฟิร์ม ฝากยืนยันออเดอร์ด้วยนะคะ`,
          ].join("\n"),
        )
        .then(() => toast.success("📋 Copied LINE message!"));
      setFormOpen(false);
      setBatchInputs({});
    }
  }, [trHook.submitTR]);

  const handlePRSubmit = useCallback(async () => {
    if (!effectiveBranchId) return;
    if (!requiredDate) return;
    if (prItemsToOrder === 0) return;
    setPrSubmitting(true);

    try {
      const now = new Date();
      const { data: prNumber, error: rpcError } = await supabase.rpc("next_doc_number", {
        p_type: "PR",
        p_year: now.getFullYear(),
        p_month: now.getMonth() + 1,
      });
      if (rpcError || !prNumber) {
        toast.error(rpcError?.message || "Failed to generate PR number");
        setPrSubmitting(false);
        return;
      }

      const { data: prRow, error: prError } = await supabase
        .from("purchase_requests")
        .insert({
          pr_number: prNumber,
          branch_id: effectiveBranchId,
          requested_by: profileId,
          requested_date: toLocalDateStr(now),
          required_date: toLocalDateStr(requiredDate),
          status: "Submitted",
          notes: notes,
        })
        .select("id")
        .single();
      if (prError || !prRow) {
        toast.error(prError?.message || "Failed to create PR");
        setPrSubmitting(false);
        return;
      }

      const lineInserts = prLines
        .filter((l) => (prBatchInputs[l.skuId] || 0) > 0)
        .map((l) => {
          const batches = prBatchInputs[l.skuId] || 0;
          return {
            pr_id: prRow.id,
            sku_id: l.skuId,
            supplier_id: selectedSupplierId,
            requested_qty: batches * l.packSize,
            uom: l.purchaseUom,
            suggested_qty: l.suggestedOrder,
            stock_on_hand: l.stockOnHand,
            avg_daily_usage: l.avgDailyUsage,
            rop: l.rop,
            pack_size: l.packSize,
            notes: "",
          };
        });

      const { error: linesError } = await supabase.from("purchase_request_lines").insert(lineInserts);
      if (linesError) {
        toast.error(linesError.message);
        setPrSubmitting(false);
        return;
      }

      toast.success(`Purchase Request ${prNumber} submitted`);
      navigator.clipboard
        .writeText(
          [
            `📦 [${branchName}] - สั่งวัตถุดิบ`,
            `วันส่งสินค้า: ${toLocalDateStr(requiredDate!)}`,
            ...(notes ? [`หมายเหตุ: ${notes}`] : []),
            ``,
            `🧾 รายการ:`,
            ...prLines
              .filter((l) => (prBatchInputs[l.skuId] || 0) > 0)
              .map(
                (l) =>
                  `- ${l.skuName} — ${formatNumber(l.packSize, 0)} ${l.usageUom} x ${prBatchInputs[l.skuId]} ${l.packUnit}`,
              ),
            ``,
            `🙏 ถ้าคอนเฟิร์ม ฝากยืนยันออเดอร์ด้วยนะคะ`,
          ].join("\n"),
        )
        .then(() => toast.success("📋 Copied LINE message!"));
      setFormOpen(false);
      setPrBatchInputs({});
      setNotes("");
      setRequiredDate(undefined);
      prHook.fetchHistory();
    } catch (e: any) {
      toast.error(e.message || "Unknown error");
    } finally {
      setPrSubmitting(false);
    }
  }, [
    effectiveBranchId,
    profileId,
    requiredDate,
    notes,
    prLines,
    prBatchInputs,
    selectedSupplierId,
    prItemsToOrder,
    prHook.fetchHistory,
  ]);

  const handleViewTRDetail = useCallback(
    async (tr: TRHistoryRow) => {
      setDetailTR(tr);
      setDetailOpen(true);
      setDetailLoading(true);
      const lines = await trHook.fetchTRDetail(tr.id);
      setDetailLines(lines);
      setDetailLoading(false);
    },
    [trHook.fetchTRDetail],
  );

  const handleViewPRDetail = useCallback(
    async (pr: PRHistoryRow) => {
      setDetailPR(pr);
      setPrDetailOpen(true);
      setPrDetailLoading(true);
      const lines = await prHook.fetchPRDetail(pr.id);
      setPrDetailLines(lines);
      setPrDetailLoading(false);
    },
    [prHook.fetchPRDetail],
  );

  const handleTRFilterApply = useCallback(() => {
    trHook.fetchHistory({
      branchId: filterBranch || undefined,
      status: filterStatus,
      dateFrom: filterFrom ? toLocalDateStr(filterFrom) : undefined,
      dateTo: filterTo ? toLocalDateStr(filterTo) : undefined,
    });
  }, [trHook.fetchHistory, filterBranch, filterStatus, filterFrom, filterTo]);

  const handlePRFilterApply = useCallback(() => {
    prHook.fetchHistory({
      branchId: prFilterBranch || undefined,
      status: prFilterStatus,
      dateFrom: prFilterFrom ? toLocalDateStr(prFilterFrom) : undefined,
      dateTo: prFilterTo ? toLocalDateStr(prFilterTo) : undefined,
    });
  }, [prHook.fetchHistory, prFilterBranch, prFilterStatus, prFilterFrom, prFilterTo]);

  // When form opens, sync TR hook state
  useEffect(() => {
    if (formOpen && isCKSelected) {
      trHook.setRequiredDate(requiredDate);
      trHook.setNotes(notes);
    }
  }, [requiredDate, notes, formOpen, isCKSelected]);

  useEffect(() => {
    if (!skuFinderTargetSkuId) return;
    const timer = setTimeout(() => {
      const row = document.querySelector(`tr[data-sku-id="${skuFinderTargetSkuId}"]`);
      if (!row) return;
      row.scrollIntoView({ behavior: "smooth", block: "center" });
      (row as HTMLElement).style.transition = "background-color 0.2s ease";
      (row as HTMLElement).style.backgroundColor = "rgba(186, 117, 23, 0.15)";
      setTimeout(() => {
        (row as HTMLElement).style.backgroundColor = "";
      }, 1500);
      setSkuFinderTargetSkuId(null);
    }, 300);
    return () => clearTimeout(timer);
  }, [skuFinderTargetSkuId, sortedTRLines, filteredPrLines]);

  // When supplier changes, reset inputs
  const handleSupplierChange = useCallback((newId: string) => {
    setSelectedSupplierId(newId);
    setBatchInputs({});
    setPrBatchInputs({});
    setPrSkuSearch("");
    setSupplierDropdownOpen(false);
    setSupplierSearch("");
    setSkuFinderOpen(false);
    setSkuFinderQuery("");
    setSkuFinderResults([]);
  }, []);

  // When form opens, reset
  const handleOpenForm = useCallback(() => {
    setFormOpen(true);
    setBatchInputs({});
    setPrBatchInputs({});
    setNotes("");
    setRequiredDate(undefined);
    // Default to CK
    setSelectedSupplierId(CK_SUPPLIER_ID);
  }, []);

  const handleCloseForm = useCallback(() => {
    setFormOpen(false);
    setBatchInputs({});
    setPrBatchInputs({});
  }, []);

  return (
    <div className="space-y-6">
      {/* ── 1. PAGE HEADER ── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className={typography.pageTitle}>{t("tr.pageTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("tr.pageSubtitle")}</p>
        </div>
        {canCreateTR && !formOpen && (
          <Button onClick={handleOpenForm} className="h-9 bg-warning text-warning-foreground hover:bg-warning/90">
            <Plus className="w-4 h-4 mr-1" /> {t("tr.newTR")}
          </Button>
        )}
      </div>

      {/* ── 2. ACTIVE FORM ── */}
      {canCreateTR && formOpen && (
        <div className="rounded-lg border-2 border-primary/20 bg-card overflow-hidden">
          {/* Header strip */}
          <div className="flex items-center justify-between px-5 py-3 bg-primary/[0.06] border-b border-primary/10">
            <div className="flex items-center gap-3">
              <span className="font-mono text-sm font-semibold bg-muted px-2.5 py-1 rounded">
                {isCKSelected ? "TR" : "PR"}-NEW
              </span>
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${isCKSelected ? "bg-[#E6F1FB] text-[#0C447C]" : "bg-[#FAEEDA] text-[#633806]"}`}
              >
                {isCKSelected ? "Transfer Request" : "Purchase Request"}
              </span>
              {branchName && <span className="text-sm text-muted-foreground">· {branchName}</span>}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={handleCloseForm}>
                <X className="w-4 h-4 mr-1" /> {t("tr.cancel")}
              </Button>
              <Button variant="outline" size="sm" disabled>
                {t("tr.saveDraft")}
              </Button>
              {isCKSelected ? (
                <Button
                  size="sm"
                  onClick={handleTRSubmit}
                  disabled={!trHook.canSubmit || submitting || (isManagement && !selectedBranchId)}
                  className="bg-warning hover:bg-warning/90 text-warning-foreground"
                >
                  {submitting ? t("tr.submitting") : t("tr.submitTR")}
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={handlePRSubmit}
                  disabled={!canSubmitPR || prSubmitting || (isManagement && !selectedBranchId)}
                  className="bg-warning hover:bg-warning/90 text-warning-foreground"
                >
                  {prSubmitting ? "Submitting..." : "Submit PR"}
                </Button>
              )}
            </div>
          </div>

          {/* Meta bar */}
          <div className="flex flex-wrap items-end gap-3 px-5 py-3 border-b bg-muted/30">
            {isManagement ? (
              <div className="flex flex-col gap-1 min-w-[200px]">
                <label className="text-xs font-medium text-muted-foreground">
                  {t("tr.newBranch")} <span className="text-destructive">*</span>
                </label>
                <Select value={selectedBranchId} onValueChange={setSelectedBranchId}>
                  <SelectTrigger className="h-10 w-[240px]">
                    <SelectValue placeholder={t("tr.selectBranch")} />
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
                <label className="text-xs font-medium text-muted-foreground">{t("col.branch")}</label>
                <div className="h-10 px-3 py-2 rounded-md border border-input bg-muted/30 text-sm min-w-[200px] flex items-center">
                  {branchName || t("tr.notAssigned")}
                </div>
              </div>
            )}

            {/* Supplier dropdown */}
            {effectiveBranchId && (
              <div className="relative" ref={supplierDropdownRef}>
                <label className="text-xs font-medium text-muted-foreground">
                  {t("tr.supplierLabel")} <span className="text-destructive">*</span>
                </label>
                <button
                  type="button"
                  onClick={() => setSupplierDropdownOpen(!supplierDropdownOpen)}
                  className={cn(
                    "flex items-center justify-between w-[220px] h-10 px-3 py-2 text-sm border rounded-md bg-background hover:bg-accent/50 transition-colors",
                  )}
                >
                  <span className="truncate flex items-center gap-1.5">
                    {isCKSelected ? (
                      <>
                        <Zap className="w-3.5 h-3.5 text-primary shrink-0" /> Central Kitchen
                      </>
                    ) : (
                      selectedSupplierName || "— Select —"
                    )}
                  </span>
                  <Search className="w-3.5 h-3.5 ml-1 shrink-0 text-muted-foreground" />
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
                      {displayedSuppliers.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => handleSupplierChange(s.id)}
                          className={cn(
                            "w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors flex items-center justify-between",
                            s.id === selectedSupplierId && "bg-accent font-medium",
                          )}
                        >
                          <span className="flex items-center gap-1.5">
                            {s.isCK && <Zap className="w-3.5 h-3.5 text-primary shrink-0" />}
                            <span className={s.isCK ? "font-medium" : ""}>{s.name}</span>
                          </span>
                          {s.pendingPRCount > 0 && (
                            <span className="bg-warning/15 text-warning text-xs rounded px-1.5 py-0.5 font-medium">
                              {s.pendingPRCount} pending
                            </span>
                          )}
                        </button>
                      ))}
                      {!showAllSuppliers && allOtherSuppliers.length > 0 && (
                        <>
                          <div className="border-t my-1" />
                          <button
                            type="button"
                            onClick={() => setShowAllSuppliers(true)}
                            className="w-full text-left px-3 py-2 text-xs text-muted-foreground hover:bg-accent transition-colors"
                          >
                            Show all suppliers ({allOtherSuppliers.length} more)
                          </button>
                        </>
                      )}
                      {displayedSuppliers.length === 0 && (
                        <p className="px-3 py-4 text-sm text-muted-foreground text-center">No suppliers found</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* SKU Finder — search by name */}
            {effectiveBranchId && !skuFinderOpen && (
              <div className="self-end">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 px-3 border-primary text-primary font-semibold hover:bg-primary hover:text-primary-foreground"
                  onClick={() => setSkuFinderOpen(true)}
                >
                  <Search className="w-3.5 h-3.5 mr-1.5" />
                  เสิร์จ SKU
                </Button>
              </div>
            )}
            {effectiveBranchId && skuFinderOpen && (
              <div className="self-end relative">
                <div className="flex items-center gap-1.5">
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                    <input
                      type="text"
                      value={skuFinderQuery}
                      onChange={async (e) => {
                        const q = e.target.value;
                        setSkuFinderQuery(q);
                        if (q.length < 2) {
                          setSkuFinderResults([]);
                          return;
                        }
                        setSkuFinderLoading(true);
                        const { data } = await supabase
                          .from("prices")
                          .select("sku_id, supplier_id, skus!inner(sku_id, name), suppliers!inner(name)")
                          .eq("is_active", true)
                          .or(`name.ilike.%${q}%,sku_id.ilike.%${q}%`, { referencedTable: "skus" });
                        const results = (data || []).map((row: any) => ({
                          skuId: row.sku_id,
                          skuCode: row.skus?.sku_id || "",
                          skuName: row.skus?.name || "",
                          supplierId: row.supplier_id,
                          supplierName: row.suppliers?.name || "",
                        }));
                        const seen = new Set<string>();
                        const unique = results.filter((r: any) => {
                          const key = `${r.skuId}-${r.supplierId}`;
                          if (seen.has(key)) return false;
                          seen.add(key);
                          return true;
                        });
                        setSkuFinderResults(unique.slice(0, 15));
                        setSkuFinderLoading(false);
                      }}
                      placeholder="พิมพ์ชื่อ หรือ รหัสวัตถุดิบ..."
                      className="w-[220px] h-10 pl-8 pr-2 text-sm border border-input rounded-md bg-background focus:border-primary outline-none"
                      autoFocus
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSkuFinderOpen(false);
                      setSkuFinderQuery("");
                      setSkuFinderResults([]);
                    }}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                {skuFinderQuery.length >= 2 && (
                  <div className="absolute z-50 top-full mt-1 w-[360px] bg-popover border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {skuFinderLoading ? (
                      <p className="px-3 py-4 text-sm text-muted-foreground text-center">Searching...</p>
                    ) : skuFinderResults.length === 0 ? (
                      <p className="px-3 py-4 text-sm text-muted-foreground text-center">
                        No SKUs found for this branch
                      </p>
                    ) : (
                      skuFinderResults.map((r, i) => (
                        <button
                          key={`${r.skuId}-${r.supplierId}-${i}`}
                          type="button"
                          onClick={() => {
                            setSkuFinderTargetSkuId(r.skuId);
                            handleSupplierChange(r.supplierId);
                          }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors flex items-center gap-3 border-b last:border-0"
                        >
                          <span className="font-mono text-xs text-muted-foreground shrink-0">{r.skuCode}</span>
                          <span className="truncate flex-1">{r.skuName}</span>
                          <span className="text-xs text-muted-foreground shrink-0">{r.supplierName}</span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}

            <DatePicker
              value={isCKSelected ? trHook.requiredDate : requiredDate}
              onChange={(d) => {
                if (isCKSelected) trHook.setRequiredDate(d);
                else setRequiredDate(d);
              }}
              label={t("tr.requiredDate")}
              required
              labelPosition="above"
              minDate={today}
              placeholder="Select date"
            />
            <div className="flex flex-col gap-1 flex-1 min-w-[140px]">
              <label className="text-xs font-medium text-muted-foreground">Notes</label>
              <Input
                value={isCKSelected ? trHook.notes : notes}
                onChange={(e) => {
                  if (isCKSelected) trHook.setNotes(e.target.value);
                  else setNotes(e.target.value);
                }}
                placeholder="Optional notes..."
                className="h-10"
              />
            </div>
          </div>

          {/* ─── SM SKU Sheet (CK selected) ─── */}
          {effectiveBranchId && isCKSelected && (
            <div className="p-4 space-y-4">
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-sm font-semibold">{t("tr.smItemsFor").replace("{branch}", branchName)}</p>
                  <p className="text-xs text-muted-foreground">{t("tr.smItemsHint")}</p>
                </div>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => setSortMode("code")}
                    className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${sortMode === "code" ? "bg-primary text-primary-foreground" : "border border-input text-muted-foreground hover:bg-accent"}`}
                  >
                    {t("tr.sortByCode")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSortMode("priority")}
                    className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${sortMode === "priority" ? "bg-primary text-primary-foreground" : "border border-input text-muted-foreground hover:bg-accent"}`}
                  >
                    {t("tr.sortByPriority")}
                  </button>
                </div>
              </div>

              {trHook.isLoading ? (
                <div className="text-center py-8 text-muted-foreground text-sm">{t("tr.loadingItems")}</div>
              ) : trHook.lines.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">{t("tr.noSmSkus")}</div>
              ) : (
                <div className={tableTokens.wrapper}>
                  <div className="overflow-y-auto max-h-[65vh]">
                    <table className={tableTokens.base}>
                      <colgroup>
                        <col style={{ width: 26 }} />
                        <col style={{ width: 76 }} />
                        <col style={{ width: 200 }} />
                        <col style={{ width: 110 }} />
                        <col style={{ width: 72 }} />
                        <col style={{ width: 72 }} />
                        <col style={{ width: 76 }} />
                        <col style={{ width: 88 }} /> {/* แนะนำ */}
                        <col style={{ width: 72 }} /> {/* cover day */}
                        <col style={{ width: 88 }} /> {/* request */}
                        <col style={{ width: 72 }} />
                        <col style={{ width: 52 }} />
                      </colgroup>
                      <thead className="sticky top-0 z-[5]">
                        <tr className={tableTokens.headerRow}>
                          <th className={tableTokens.headerCellCenter}></th>
                          <th className={tableTokens.headerCell}>{t("tr.colSkuCode")}</th>
                          <th className={tableTokens.headerCell}>{t("tr.colSkuName")}</th>
                          <th className={tableTokens.headerCell}>{t("tr.colBatchSize")}</th>
                          <th className={tableTokens.headerCellNumeric}>{t("tr.colStockNow")}</th>
                          <th className={tableTokens.headerCellNumeric}>เฉลี่ย/วัน</th>
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
                          <th className={tableTokens.headerCellNumeric}>พอขาย</th>
                          <th className="px-2 py-2 text-xs font-medium uppercase tracking-wide text-right !bg-foreground text-background">
                            {t("tr.colRequestBatch")}
                          </th>
                          <th className={tableTokens.headerCellNumeric}>{t("tr.colTotalUom")}</th>
                          <th className={tableTokens.headerCellCenter}>{t("tr.colUnit")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedTRLines.map((line, idx) => {
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
                              data-sku-id={line.skuId}
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
                              <td className={tableTokens.dataCellCompactMono}>
                                {formatNumber(Math.max(0, line.stockOnHand), 0)}
                              </td>
                              <td className={tableTokens.dataCellCompactMono}>
                                {line.avgDailyUsage > 0 ? formatNumber(line.avgDailyUsage, 0) : "—"}
                              </td>
                              <td className={`${tableTokens.dataCellCompactMono} text-muted-foreground`}>
                                {formatNumber(line.parstock, 0)}
                              </td>
                              <td
                                className={`${tableTokens.dataCellCompactMono} ${line.suggestedBatches > 0 ? "text-primary" : "text-muted-foreground"} font-medium`}
                              >
                                {isNoData ? "—" : line.suggestedBatches <= 0 ? 0 : line.suggestedBatches}
                              </td>
                              {/* Cover Day */}
                              <td className={tableTokens.dataCellCompactMono}>
                                {(() => {
                                  const extra = (coverDayInputs[line.skuId] ?? 0) * line.packSize;
                                  const cd = calcCoverDay(line.stockOnHand, line.avgDailyUsage, extra);
                                  if (cd === null) return <span className="text-muted-foreground">—</span>;
                                  const color =
                                    cd >= line.parstock / line.avgDailyUsage
                                      ? "text-success"
                                      : cd >= line.rop / line.avgDailyUsage
                                        ? "text-warning"
                                        : "text-destructive";
                                  return <span className={color}>{cd.toFixed(1)} วัน</span>;
                                })()}
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
                                  placeholder=""
                                  onBlur={(e) => {
                                    const v = Math.max(0, Math.round(Number(e.target.value) || 0));
                                    setBatchInputs((prev) => ({ ...prev, [line.skuId]: v }));
                                    setCoverDayInputs((prev) => ({ ...prev, [line.skuId]: v }));
                                    trHook.updateLineQty(line.skuId, v);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === "Tab" || e.key === "Enter") {
                                      e.preventDefault();
                                      const nextIdx = e.shiftKey ? idx - 1 : idx + 1;
                                      if (nextIdx >= 0 && nextIdx < sortedTRLines.length) {
                                        const nextSkuId = sortedTRLines[nextIdx].skuId;
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
                                className={`${tableTokens.dataCellCompactCenter} font-medium text-primary bg-primary/5`}
                              >
                                {line.uom}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ─── RM SKU Sheet (External supplier selected) ─── */}
          {effectiveBranchId && !isCKSelected && selectedSupplierId && (
            <div className="p-4 space-y-4">
              {zeroLeadTimeCount > 0 && (
                <div className="bg-warning/10 border border-warning/30 rounded-lg px-4 py-2.5 flex items-center gap-2 text-sm">
                  <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
                  <span>
                    {zeroLeadTimeCount} SKUs have no lead time set — defaulting to 1 day. Update in SKU Master.
                  </span>
                </div>
              )}

              <div className="flex items-end justify-between">
                <div>
                  <p className="text-sm font-semibold">
                    RM items for {branchName} from {selectedSupplierName}
                  </p>
                  <p className="text-xs text-muted-foreground">Enter batch quantities to request</p>
                </div>
                <div className="relative w-[220px]">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <input
                    type="text"
                    value={prSkuSearch}
                    onChange={(e) => setPrSkuSearch(e.target.value)}
                    placeholder="Search SKU..."
                    className="w-full h-8 pl-8 pr-2 text-sm border rounded-md bg-background focus:border-primary outline-none"
                  />
                </div>
              </div>

              {rmLoading ? (
                <div className="text-center py-8 text-muted-foreground text-sm">Loading items...</div>
              ) : prLines.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  No RM SKUs found for this supplier and branch.
                </div>
              ) : (
                <div className={tableTokens.wrapper}>
                  <div className="overflow-y-auto max-h-[65vh]">
                    <table className={tableTokens.base}>
                      <colgroup>
                        <col style={{ width: 26 }} />
                        <col style={{ width: 76 }} />
                        <col style={{ width: 200 }} />
                        <col style={{ width: 90 }} />
                        <col style={{ width: 72 }} />
                        <col style={{ width: 72 }} />
                        <col style={{ width: 68 }} />
                        <col style={{ width: 72 }} />
                        <col style={{ width: 72 }} />
                        <col style={{ width: 80 }} />
                        <col style={{ width: 72 }} />
                        <col style={{ width: 52 }} />
                      </colgroup>
                      <thead className="sticky top-0 z-[5]">
                        <tr className={tableTokens.headerRow}>
                          <th className={tableTokens.headerCellCenter}></th>
                          <th className={tableTokens.headerCell}>{t("tr.colSkuCode")}</th>
                          <th className={tableTokens.headerCell}>{t("tr.colSkuName")}</th>
                          <th className={tableTokens.headerCell}>{t("tr.colBatchSize")}</th>
                          <th className={tableTokens.headerCellNumeric}>{t("tr.colStockNow")}</th>

                          <th className={tableTokens.headerCellNumeric}>เฉลี่ย/วัน</th>
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
                                  <p className="text-xs">Batches to reach parstock</p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </th>
                          <th className={tableTokens.headerCellNumeric}>พอขาย</th>
                          <th className="px-2 py-2 text-xs font-medium uppercase tracking-wide text-right !bg-foreground text-background">
                            Request
                          </th>
                          <th className={tableTokens.headerCellNumeric}>Total</th>
                          <th className={tableTokens.headerCellCenter}>Unit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredPrLines.map((line, idx) => {
                          const isSufficient = line.status === "sufficient";
                          const isNoData = line.status === "no-data";
                          const dotStatus: StatusDotStatus | undefined = isNoData
                            ? undefined
                            : stockStatusToDot[line.status];
                          const batchVal = prBatchInputs[line.skuId] ?? 0;
                          const totalPurchaseUnits = batchVal > 0 ? batchVal * line.packSize : 0;
                          const stockInPurchase = Math.round(Math.max(0, line.stockOnHand) * 100) / 100;
                          const ropInPurchase = Math.round(line.rop * 100) / 100;
                          const parstockInPurchase = Math.round(line.parstock * 100) / 100;
                          const packLabel = `${formatNumber(line.packSize, 0)} ${line.usageUom}/${line.packUnit}`;

                          return (
                            <tr
                              key={line.skuId}
                              data-sku-id={line.skuId}
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
                              <td className={tableTokens.dataCellCompact} title={packLabel}>
                                <span className="whitespace-nowrap truncate block">{packLabel}</span>
                              </td>
                              <td className={tableTokens.dataCellCompactMono}>{formatNumber(stockInPurchase, 0)}</td>
                              <td className={tableTokens.dataCellCompactMono}>
                                {line.avgDailyUsage > 0 ? formatNumber(line.avgDailyUsage, 0) : "—"}
                              </td>
                              <td className={`${tableTokens.dataCellCompactMono} text-muted-foreground`}>
                                {formatNumber(parstockInPurchase, 0)}
                              </td>
                              <td
                                className={`${tableTokens.dataCellCompactMono} ${line.suggestedBatches > 0 ? "text-primary" : "text-muted-foreground"} font-medium`}
                              >
                                {isNoData ? "—" : line.suggestedBatches <= 0 ? 0 : line.suggestedBatches}
                              </td>
                              {/* Cover Day */}
                              <td className={tableTokens.dataCellCompactMono}>
                                {(() => {
                                  const extra = (coverDayInputs[line.skuId] ?? 0) * line.packSize;
                                  const cd = calcCoverDay(line.stockOnHand, line.avgDailyUsage, extra);
                                  if (cd === null) return <span className="text-muted-foreground">—</span>;
                                  const color =
                                    cd >= line.parstock / line.avgDailyUsage
                                      ? "text-success"
                                      : cd >= line.rop / line.avgDailyUsage
                                        ? "text-warning"
                                        : "text-destructive";
                                  return <span className={color}>{cd.toFixed(1)} วัน</span>;
                                })()}
                              </td>
                              <td className={`${tableTokens.dataCellCompact} text-right`}>
                                <input
                                  ref={(el) => {
                                    if (el) prQtyInputRefs.current[line.skuId] = el;
                                  }}
                                  type="number"
                                  inputMode="numeric"
                                  min={0}
                                  step={1}
                                  defaultValue=""
                                  placeholder=""
                                  onBlur={(e) => {
                                    const v = Math.max(0, Math.round(Number(e.target.value) || 0));
                                    setPrBatchInputs((prev) => ({ ...prev, [line.skuId]: v }));
                                    setCoverDayInputs((prev) => ({ ...prev, [line.skuId]: v }));
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === "Tab" || e.key === "Enter") {
                                      e.preventDefault();
                                      const nextIdx = e.shiftKey ? idx - 1 : idx + 1;
                                      if (nextIdx >= 0 && nextIdx < filteredPrLines.length) {
                                        const nextSkuId = filteredPrLines[nextIdx].skuId;
                                        prQtyInputRefs.current[nextSkuId]?.focus();
                                        prQtyInputRefs.current[nextSkuId]?.select();
                                      }
                                    }
                                  }}
                                  className={tableTokens.inputCell}
                                />
                              </td>
                              <td
                                className={`${tableTokens.dataCellCompactMono} ${totalPurchaseUnits > 0 ? "text-foreground" : "text-muted-foreground"}`}
                              >
                                {totalPurchaseUnits > 0 ? formatNumber(totalPurchaseUnits, 0) : "—"}
                              </td>
                              <td
                                className={`${tableTokens.dataCellCompactCenter} font-medium text-primary bg-primary/5`}
                              >
                                {line.usageUom}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {isManagement && !selectedBranchId && (
            <div className="text-center py-8 text-muted-foreground text-sm">{t("tr.selectBranchHint")}</div>
          )}

          {/* Footer bar */}
          <div className="flex items-center justify-between px-5 py-3 border-t bg-muted/30">
            <span className="text-sm text-muted-foreground">
              {t("tr.itemsToOrder")}{" "}
              <span className="font-semibold text-foreground">
                {isCKSelected ? trHook.itemsToOrder : prItemsToOrder}
              </span>
            </span>
            {isCKSelected ? (
              <Button
                onClick={handleTRSubmit}
                disabled={!trHook.canSubmit || submitting || (isManagement && !selectedBranchId)}
                className="bg-warning hover:bg-warning/90 text-warning-foreground"
              >
                {submitting ? t("tr.submitting") : t("tr.submitTR")}
              </Button>
            ) : (
              <Button
                onClick={handlePRSubmit}
                disabled={!canSubmitPR || prSubmitting || (isManagement && !selectedBranchId)}
                className="bg-warning hover:bg-warning/90 text-warning-foreground"
              >
                {prSubmitting ? "Submitting..." : "Submit PR"}
              </Button>
            )}
          </div>
        </div>
      )}

      {/* ── 3. EMPTY STATE ── */}
      {canCreateTR && !formOpen && (
        <div className="rounded-lg border bg-card py-16 flex flex-col items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-warning/10 flex items-center justify-center">
            <ClipboardList className="w-7 h-7 text-warning" />
          </div>
          <div className="text-center">
            <p className="font-medium text-foreground">{t("pr.emptyState")}</p>
            <p className="text-sm text-muted-foreground mt-1">{t("pr.emptyHint")}</p>
          </div>
          <Button onClick={handleOpenForm} className="mt-2 bg-warning hover:bg-warning/90 text-warning-foreground">
            <Plus className="w-4 h-4 mr-1" /> New PR / TR
          </Button>
        </div>
      )}

      {/* ── 4. TR HISTORY ── */}
      <div className="pt-2">
        <Separator className="mb-3" />
        <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">{t("tr.history")}</span>
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          {(isManagement || isAreaManager || isCkManager) && (
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">Branch</label>
              <Select value={filterBranch} onValueChange={(v) => setFilterBranch(v === "__all__" ? "" : v)}>
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
            <label className="text-xs font-medium text-muted-foreground">{t("col.status")}</label>
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
            label={t("common.from")}
            labelPosition="above"
            placeholder="From"
          />
          <DatePicker
            value={filterTo}
            onChange={setFilterTo}
            label={t("common.to")}
            labelPosition="above"
            placeholder="To"
          />
          <Button variant="outline" className="h-9" onClick={handleTRFilterApply}>
            {t("btn.filter")}
          </Button>
        </div>

        <div className={tableTokens.wrapper}>
          <div className="overflow-y-auto max-h-[65vh]">
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
              <thead className="sticky top-0 z-[5]">
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
                {trHook.historyLoading ? (
                  <tr>
                    <td colSpan={7} className="text-center py-8 text-muted-foreground text-sm">
                      {t("common.loading")}
                    </td>
                  </tr>
                ) : trHook.history.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-8 text-muted-foreground text-sm">
                      {t("tr.noResults")}
                    </td>
                  </tr>
                ) : (
                  trHook.history.map((tr) => (
                    <tr key={tr.id} className={tableTokens.dataRow}>
                      <td
                        className={`${tableTokens.dataCell} font-mono text-xs cursor-pointer text-primary hover:underline`}
                        onClick={() => handleViewTRDetail(tr)}
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
                          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${statusBadgeClass[tr.status] || ""}`}
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
                            onClick={() => handleViewTRDetail(tr)}
                            title="View"
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                          {(isManagement || isStoreManager) &&
                            tr.status !== "Cancelled" &&
                            tr.status !== "Fulfilled" && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-destructive hover:text-destructive"
                                onClick={() => trHook.cancelTR(tr.id)}
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
      </div>

      {/* ── 5. PR HISTORY ── */}
      <div className="pt-2">
        <Separator className="mb-3" />
        <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">{t("pr.history")}</span>
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          {(isManagement || isAreaManager || isCkManager) && (
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">Branch</label>
              <Select value={prFilterBranch} onValueChange={(v) => setPrFilterBranch(v === "__all__" ? "" : v)}>
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
            <label className="text-xs font-medium text-muted-foreground">{t("col.status")}</label>
            <Select value={prFilterStatus} onValueChange={setPrFilterStatus}>
              <SelectTrigger className="w-[160px] h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["All", "Submitted", "Acknowledged", "Fulfilled", "Cancelled"].map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DatePicker
            value={prFilterFrom}
            onChange={setPrFilterFrom}
            label={t("common.from")}
            labelPosition="above"
            placeholder="From"
          />
          <DatePicker
            value={prFilterTo}
            onChange={setPrFilterTo}
            label={t("common.to")}
            labelPosition="above"
            placeholder="To"
          />
          <Button variant="outline" className="h-9" onClick={handlePRFilterApply}>
            {t("btn.filter")}
          </Button>
        </div>

        <div className={tableTokens.wrapper}>
          <div className="overflow-y-auto max-h-[65vh]">
            <table className={tableTokens.base}>
              <colgroup>
                <col style={{ width: 150 }} />
                <col style={{ width: 110 }} />
                <col style={{ width: 110 }} />
                <col style={{ width: 140 }} />
                <col />
                <col style={{ width: 70 }} />
                <col style={{ width: 120 }} />
                <col style={{ width: 100 }} />
              </colgroup>
              <thead className="sticky top-0 z-[5]">
                <tr className={tableTokens.headerRow}>
                  <th className={tableTokens.headerCell}>{t("pr.colPrNumber")}</th>
                  <th className={tableTokens.headerCell}>{t("col.date")}</th>
                  <th className={tableTokens.headerCell}>วันส่งสินค้า</th>
                  <th className={tableTokens.headerCell}>{t("col.supplier")}</th>
                  <th className={tableTokens.headerCell}>{t("col.branch")}</th>
                  <th className={`${tableTokens.headerCell} text-right`}>{t("tr.colItems")}</th>
                  <th className={tableTokens.headerCell}>{t("col.status")}</th>
                  <th className={`${tableTokens.headerCell} text-center`}>{t("col.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {prHook.historyLoading ? (
                  <tr>
                    <td colSpan={8} className="text-center py-8 text-muted-foreground text-sm">
                      {t("common.loading")}
                    </td>
                  </tr>
                ) : prHook.history.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center py-8 text-muted-foreground text-sm">
                      {t("pr.noResults")}
                    </td>
                  </tr>
                ) : (
                  prHook.history.map((pr) => (
                    <tr key={pr.id} className={tableTokens.dataRow}>
                      <td
                        className={`${tableTokens.dataCell} font-mono text-xs cursor-pointer text-primary hover:underline`}
                        onClick={() => handleViewPRDetail(pr)}
                      >
                        {pr.prNumber}
                      </td>
                      <td className={tableTokens.dataCell}>{pr.requestedDate}</td>
                      <td className={tableTokens.dataCell}>{pr.requiredDate}</td>
                      <td className={tableTokens.truncatedCell} title={pr.supplierName}>
                        {pr.supplierName}
                      </td>
                      <td className={tableTokens.truncatedCell} title={pr.branchName}>
                        {pr.branchName}
                      </td>
                      <td className={tableTokens.dataCellMono}>{pr.itemCount}</td>
                      <td className={tableTokens.dataCell}>
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${statusBadgeClass[pr.status] || ""}`}
                        >
                          {pr.status}
                        </span>
                      </td>
                      <td className={`${tableTokens.dataCell} text-center`}>
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => handleViewPRDetail(pr)}
                            title="View"
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                          {(isManagement || isStoreManager) &&
                            pr.status !== "Cancelled" &&
                            pr.status !== "Fulfilled" && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-destructive hover:text-destructive"
                                onClick={() => prHook.cancelPR(pr.id)}
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
      </div>

      {/* ─── TR Detail Modal ─── */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto print:max-w-full print:max-h-full print:overflow-visible">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <span className="font-mono">{detailTR?.trNumber}</span>
              {detailTR && (
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${statusBadgeClass[detailTR.status] || ""}`}
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
              <div className="flex justify-end gap-2 print:hidden">
                {!detailLoading && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      if (!detailTR) return;
                      const branch = branches.find((b) => b.id === detailTR.branchId);
                      const brandName = branch?.brandName || "";
                      const copyLines = [
                        `📦 [${detailTR.branchName} — ${brandName}] - สั่งวัตถุดิบ`,
                        `วันส่งสินค้า: ${detailTR.requiredDate}`,
                        ``,
                        `🧾 รายการ:`,
                        ...detailLines.map(
                          (l) =>
                            `- ${l.skuName} — ${formatNumber(l.packSize, 0)} ก. x ${formatNumber(l.requestedQty / l.packSize, 0)} แพ็ค`,
                        ),
                        ``,
                        `🙏 ถ้าคอนเฟิร์ม ฝากยืนยันออเดอร์ด้วยนะคะ`,
                      ];
                      navigator.clipboard
                        .writeText(copyLines.join("\n"))
                        .then(() => toast.success("Copied to clipboard"));
                    }}
                  >
                    <Copy className="w-4 h-4 mr-1" /> Copy for LINE
                  </Button>
                )}
                <Button variant="outline" onClick={() => window.print()}>
                  <Printer className="w-4 h-4 mr-1" /> {t("btn.print")}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ─── PR Detail Modal ─── */}
      <Dialog open={prDetailOpen} onOpenChange={setPrDetailOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <span className="font-mono">{detailPR?.prNumber}</span>
              {detailPR && (
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${statusBadgeClass[detailPR.status] || ""}`}
                >
                  {detailPR.status}
                </span>
              )}
            </DialogTitle>
          </DialogHeader>
          {detailPR && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">{t("pr.detailBranch")} </span>
                  <span className="font-medium">{detailPR.branchName}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t("pr.detailSupplier")} </span>
                  <span className="font-medium">{detailPR.supplierName}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t("pr.detailRequested")} </span>
                  <span>{detailPR.requestedDate}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t("pr.detailRequired")} </span>
                  <span>{detailPR.requiredDate}</span>
                </div>
                {detailPR.notes && (
                  <div className="col-span-2">
                    <span className="text-muted-foreground">Notes: </span>
                    <span>{detailPR.notes}</span>
                  </div>
                )}
              </div>
              {prDetailLoading ? (
                <div className="text-center py-6 text-muted-foreground text-sm">{t("tr.loadingLines")}</div>
              ) : (
                <div className={tableTokens.wrapper}>
                  <table className={tableTokens.base}>
                    <colgroup>
                      <col style={{ width: 100 }} />
                      <col />
                      <col style={{ width: 80 }} />
                      <col style={{ width: 80 }} />
                      <col style={{ width: 80 }} />
                      <col style={{ width: 80 }} />
                      <col style={{ width: 60 }} />
                    </colgroup>
                    <thead>
                      <tr className={tableTokens.headerRow}>
                        <th className={tableTokens.headerCell}>SKU Code</th>
                        <th className={tableTokens.headerCell}>SKU Name</th>
                        <th className={`${tableTokens.headerCell} text-right`}>Stock</th>
                        <th className={`${tableTokens.headerCell} text-right`}>Suggested</th>
                        <th className={`${tableTokens.headerCell} text-right`}>ROP</th>
                        <th className={`${tableTokens.headerCell} text-right`}>Requested</th>
                        <th className={`${tableTokens.headerCell} text-center`}>UOM</th>
                      </tr>
                    </thead>
                    <tbody>
                      {prDetailLines.map((l) => {
                        const batches = l.packSize > 0 ? Math.round(l.requestedQty / l.packSize) : l.requestedQty;
                        return (
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
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="flex justify-end gap-2">
                {!prDetailLoading && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      if (!detailPR) return;
                      const branch = branches.find((b) => b.id === detailPR.branchId);
                      const brandName = branch?.brandName || "";
                      const copyLines = [
                        `📦 [${detailPR.branchName} — ${brandName}] - สั่งวัตถุดิบ`,
                        `วันส่งสินค้า: ${detailPR.requiredDate}`,
                        ...(detailPR.notes ? [`หมายเหตุ: ${detailPR.notes}`] : []),
                        ``,
                        `🧾 รายการ:`,
                        ...prDetailLines.map((l) => {
                          const batches = l.packSize > 0 ? Math.round(l.requestedQty / l.packSize) : l.requestedQty;
                          return `- ${l.skuName} — ${formatNumber(l.packSize, 0)} ${l.uom} x ${batches} ${l.packUnit}`;
                        }),
                        ``,
                        `🙏 ถ้าคอนเฟิร์ม ฝากยืนยันออเดอร์ด้วยนะคะ`,
                      ];
                      navigator.clipboard
                        .writeText(copyLines.join("\n"))
                        .then(() => toast.success("Copied to clipboard"));
                    }}
                  >
                    <Copy className="w-4 h-4 mr-1" /> Copy for LINE
                  </Button>
                )}
                <Button variant="outline" onClick={() => setPrDetailOpen(false)}>
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
