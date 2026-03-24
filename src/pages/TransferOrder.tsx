import React, { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useLanguage } from "@/hooks/use-language";
import { useTransferOrder, TOLine, PendingTR, TOHistoryRow } from "@/hooks/use-transfer-order";
import { useBranchData } from "@/hooks/use-branch-data";
import { useSkuData } from "@/hooks/use-sku-data";
import { useSmStockData } from "@/hooks/use-sm-stock-data";
import { supabase } from "@/integrations/supabase/client";
import { DatePicker } from "@/components/ui/date-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UnitLabel } from "@/components/ui/unit-label";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/SearchableSelect";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusDot } from "@/components/ui/status-dot";
import { typography, table as tableTokens, formatNumber, fmtCurrency } from "@/lib/design-tokens";
import { toLocalDateStr } from "@/lib/utils";
import {
  Zap,
  Plus,
  Eye,
  Printer,
  Ban,
  Trash2,
  Send,
  Save,
  ChevronUp,
  ChevronDown,
  ArrowUpDown,
  Pencil,
  Package,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";

interface LotLineLocal {
  id?: string;
  productionRecordId: string;
  productionDate: string;
  packs: number;
  packWeightG: number;
}

interface ProdRecord {
  id: string;
  productionDate: string;
  actualOutputG: number;
  batchesProduced: number;
}
const toStatusBadge: Record<string, string> = {
  Draft: "bg-[#F1EFE8] text-[#5F5E5A]",
  Sent: "bg-[#FAEEDA] text-[#633806]",
  Received: "bg-[#EAF3DE] text-[#27500A]",
  "Partially Received": "bg-[#E6F1FB] text-[#0C447C]",
  Cancelled: "bg-[#FCEBEB] text-[#791F1F]",
};

type SortKey = "toNumber" | "date" | "branch" | "status";

interface TOFormState {
  toId: string;
  toNumber: string;
  branchId: string;
  branchName: string;
  deliveryDate: string;
  notes: string;
  trId?: string;
  trNumber?: string;
  lines: TOLine[];
}

export default function TransferOrderPage({
  getBomCostPerGram,
  refreshSmStock,
}: {
  getBomCostPerGram: (skuId: string) => number;
  refreshSmStock?: () => void;
}) {
  const { t } = useLanguage();
  const { role, isManagement, isCkManager, isAreaManager, user, profile } = useAuth();
  const { branches } = useBranchData();
  const { skus } = useSkuData();
  const {
    pendingTRs,
    toHistory,
    historyLoading,
    createTO,
    updateTOLine,
    sendTO,
    cancelTO,
    fetchHistory,
    fetchTODetail,
    addTOLine,
    deleteTOLine,
  } = useTransferOrder(getBomCostPerGram);

  const canEdit = isManagement || isCkManager;

  // ─── Form state ───
  const [formState, setFormState] = useState<TOFormState | null>(null);
  const [formSending, setFormSending] = useState(false);
  const [formSaving, setFormSaving] = useState(false);

  // Standalone form pre-create state
  const [standaloneOpen, setStandaloneOpen] = useState(false);
  const [standaloneBranch, setStandaloneBranch] = useState("");
  const [standaloneDate, setStandaloneDate] = useState<Date | undefined>(undefined);
  const [standaloneNotes, setStandaloneNotes] = useState("");

  // History filters
  const [filterBranch, setFilterBranch] = useState("");
  const [filterStatus, setFilterStatus] = useState("All");
  const [filterFrom, setFilterFrom] = useState<Date | undefined>(undefined);
  const [filterTo, setFilterTo] = useState<Date | undefined>(undefined);

  // Sorting
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Detail modal
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailTO, setDetailTO] = useState<TOHistoryRow | null>(null);
  const [detailLines, setDetailLines] = useState<TOLine[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  // SKU search for standalone
  const [skuSearchOpen, setSkuSearchOpen] = useState(false);

  const smSkus = useMemo(() => skus.filter((s) => s.type === "SM" && s.status === "Active"), [skus]);
  const distributableRmSkus = useMemo(() => skus.filter((s) => s.type === "RM" && s.status === "Active" && s.isDistributable), [skus]);

  // BOM-filtered SKU IDs
  const [bomSkuIds, setBomSkuIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    supabase
      .from("bom_headers")
      .select("sm_sku_id")
      .then(({ data }) => {
        if (data) setBomSkuIds(new Set(data.map((r: any) => r.sm_sku_id)));
      });
  }, []);
  const activeBranches = useMemo(() => branches.filter((b) => b.status === "Active"), [branches]);

  const isUrgent = (dateStr: string) => {
    const d = new Date(dateStr + "T00:00:00");
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    return d < tomorrow;
  };

  // ─── Profile ID ───
  const [profileId, setProfileId] = useState<string | null>(null);
  useEffect(() => {
    if (user) {
      supabase
        .from("profiles")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle()
        .then(({ data }) => {
          if (data) setProfileId(data.id);
        });
    }
  }, [user]);

  // ─── Production records per SKU (for lot assignment) ───
  const [prodRecordsMap, setProdRecordsMap] = useState<Record<string, ProdRecord[]>>({});
  // ─── Lot lines per TO line ───
  const [lotLines, setLotLines] = useState<Record<string, LotLineLocal[]>>({});
  // ─── Expanded lot rows ───
  const [expandedLines, setExpandedLines] = useState<Record<string, boolean>>({});
  // ─── Duplicate lot save guard ───
  const [savingLotLines, setSavingLotLines] = useState<Set<string>>(new Set());

  // Refs to avoid stale closures in onBlur handlers
  const lotLinesRef = useRef<Record<string, LotLineLocal[]>>({});
  const prodRecordsMapRef = useRef<Record<string, ProdRecord[]>>({});
  const savingLotLinesRef = useRef<Set<string>>(new Set());
  useEffect(() => { lotLinesRef.current = lotLines; }, [lotLines]);
  useEffect(() => { prodRecordsMapRef.current = prodRecordsMap; }, [prodRecordsMap]);
  useEffect(() => { savingLotLinesRef.current = savingLotLines; }, [savingLotLines]);

  // Fetch production data + existing lot lines when form opens
  useEffect(() => {
    if (!formState || formState.lines.length === 0) {
      setProdRecordsMap({});
      setLotLines({});
      setExpandedLines({});
      return;
    }
    const skuIds = formState.lines.map((l) => l.skuId);
    const lineIds = formState.lines.map((l) => l.id);

    // Query A: production records per SKU (for lot date dropdown)
    supabase
      .from("production_records")
      .select("id, sm_sku_id, production_date, actual_output_g, batches_produced")
      .in("sm_sku_id", skuIds)
      .order("production_date", { ascending: true })
      .then(({ data }) => {
        if (!data) return;
        const bySkuRecords: Record<string, ProdRecord[]> = {};
        for (const r of data) {
          if (!bySkuRecords[r.sm_sku_id]) bySkuRecords[r.sm_sku_id] = [];
          bySkuRecords[r.sm_sku_id].push({
            id: r.id,
            productionDate: r.production_date,
            actualOutputG: r.actual_output_g,
            batchesProduced: r.batches_produced,
          });
        }
        setProdRecordsMap(bySkuRecords);
      });

    // Query B: existing lot lines for this TO
    if (lineIds.length > 0) {
      supabase
        .from("transfer_order_lot_lines")
        .select("*")
        .in("to_line_id", lineIds)
        .then(({ data }) => {
          if (!data) return;
          const byLine: Record<string, LotLineLocal[]> = {};
          for (const r of data) {
            if (!byLine[r.to_line_id]) byLine[r.to_line_id] = [];
            byLine[r.to_line_id].push({
              id: r.id,
              productionRecordId: r.production_record_id || "",
              productionDate: r.production_date,
              packs: r.packs,
              packWeightG: r.pack_weight_g,
            });
          }
          setLotLines(byLine);
        });
    }
  }, [formState?.toId, formState?.lines.length]);

  // ─── Create TO from TR ───
  const handleCreateFromTR = useCallback(
    async (tr: PendingTR) => {
      const result = await createTO({
        trId: tr.trId,
        branchId: tr.branchId,
        deliveryDate: toLocalDateStr(new Date()),
        notes: "",
        profileId: profileId || undefined,
        trLines: tr.lines,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setFormState({
        toId: result.toId,
        toNumber: result.toNumber,
        branchId: tr.branchId,
        branchName: tr.branchName,
        deliveryDate: toLocalDateStr(new Date()),
        notes: "",
        trId: tr.trId,
        trNumber: tr.trNumber,
        lines: result.lines,
      });
      setStandaloneOpen(false);
      toast.success(`TO ${result.toNumber} created from ${tr.trNumber}`);
    },
    [createTO, profileId],
  );

  // ─── Create standalone TO ───
  const handleCreateStandalone = useCallback(async () => {
    if (!standaloneBranch || !standaloneDate) {
      toast.error("Please select branch and delivery date");
      return;
    }
    const result = await createTO({
      branchId: standaloneBranch,
      deliveryDate: toLocalDateStr(standaloneDate),
      notes: standaloneNotes,
      profileId: profileId || undefined,
    });
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    const branch = branches.find((b) => b.id === standaloneBranch);
    setFormState({
      toId: result.toId,
      toNumber: result.toNumber,
      branchId: standaloneBranch,
      branchName: branch?.branchName || "",
      deliveryDate: toLocalDateStr(standaloneDate),
      notes: standaloneNotes,
      lines: [],
    });
    setStandaloneOpen(false);
    setStandaloneBranch("");
    setStandaloneDate(undefined);
    setStandaloneNotes("");
    toast.success(`TO ${result.toNumber} created`);
  }, [standaloneBranch, standaloneDate, standaloneNotes, createTO, profileId, branches]);

  // ─── Update line locally ───
  const handleLineUpdate = useCallback(
    (lineId: string, field: "actualQty" | "note", value: any) => {
      setFormState((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          lines: prev.lines.map((l) => {
            if (l.id !== lineId) return l;
            const updated = { ...l, [field]: value };
            if (field === "actualQty") {
              updated.lineValue = updated.actualQty * updated.unitCost;
            }
            return updated;
          }),
        };
      });
      if (field === "actualQty") {
        updateTOLine(lineId, value as number);
      } else {
        updateTOLine(lineId, 0).then(() => {
          // Update note via separate call
          supabase.from("transfer_order_lines").update({ notes: value }).eq("id", lineId);
        });
      }
    },
    [updateTOLine],
  );

  // ─── Add item (standalone) ───
  const handleAddItem = useCallback(
    async (skuId: string) => {
      if (!formState) return;
      const sku = skus.find((s) => s.id === skuId);
      if (!sku) return;
      if (formState.lines.some((l) => l.skuId === skuId)) {
        toast.error(t("to.itemAlreadyAdded"));
        return;
      }
      const newLine = await addTOLine(formState.toId, skuId, sku.skuId, sku.name, sku.usageUom);
      if (newLine) {
        setFormState((prev) => (prev ? { ...prev, lines: [...prev.lines, newLine] } : prev));
      }
      setSkuSearchOpen(false);
    },
    [formState, skus, addTOLine, t],
  );

  // ─── Delete line ───
  const handleDeleteLine = useCallback(
    async (lineId: string) => {
      const ok = await deleteTOLine(lineId);
      if (ok) {
        setFormState((prev) => (prev ? { ...prev, lines: prev.lines.filter((l) => l.id !== lineId) } : prev));
      }
    },
    [deleteTOLine],
  );

  // ─── Save Draft ───
  const handleSaveDraft = useCallback(async () => {
    if (!formState) return;
    setFormSaving(true);
    for (const l of formState.lines) {
      if (l.actualQty > 0) {
        await updateTOLine(l.id, l.actualQty, l.note);
      }
    }
    const total = formState.lines.reduce((sum, l) => sum + l.actualQty * l.unitCost, 0);
    await supabase.from("transfer_orders").update({ total_value: total }).eq("id", formState.toId);
    setFormSaving(false);
    toast.success("Draft saved");
    fetchHistory();
  }, [formState, updateTOLine]);

  // ─── Send TO ───
  const handleSend = useCallback(async () => {
    if (!formState) return;
    const invalidLines = formState.lines.filter((l) => l.actualQty < 0);
    if (invalidLines.length > 0) {
      toast.error(t("to.qtyError"));
      return;
    }
    setFormSending(true);
    const result = await sendTO(formState.toId, formState.lines);
    setFormSending(false);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    toast.success(`${formState.toNumber} ${t("to.sentSuccess")}`);
    setFormState(null);
    fetchHistory();
    refreshSmStock?.();
  }, [formState, sendTO, fetchHistory, refreshSmStock, t]);

  // ─── Cancel form ───
  const handleCancelForm = useCallback(() => {
    setFormState(null);
  }, []);

  // ─── Filter apply ───
  const handleFilterApply = useCallback(() => {
    fetchHistory({
      branchId: filterBranch || undefined,
      status: filterStatus,
      dateFrom: filterFrom ? toLocalDateStr(filterFrom) : undefined,
      dateTo: filterTo ? toLocalDateStr(filterTo) : undefined,
    });
  }, [fetchHistory, filterBranch, filterStatus, filterFrom, filterTo]);

  // ─── Sort ───
  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      if (sortDir === "asc") setSortDir("desc");
      else {
        setSortKey("date");
        setSortDir("desc");
      }
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-30" />;
    return sortDir === "asc" ? (
      <ChevronUp className="w-3 h-3 ml-1 text-primary" />
    ) : (
      <ChevronDown className="w-3 h-3 ml-1 text-primary" />
    );
  };

  const sortedHistory = useMemo(() => {
    const list = [...toHistory];
    list.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "toNumber":
          cmp = a.toNumber.localeCompare(b.toNumber);
          break;
        case "date":
          cmp = a.deliveryDate.localeCompare(b.deliveryDate);
          break;
        case "branch":
          cmp = a.branchName.localeCompare(b.branchName);
          break;
        case "status":
          cmp = a.status.localeCompare(b.status);
          break;
      }
      return sortDir === "desc" ? -cmp : cmp;
    });
    return list;
  }, [toHistory, sortKey, sortDir]);

  // ─── Edit Draft TO ───
  const handleEditDraft = useCallback(
    async (to: TOHistoryRow) => {
      const lines = await fetchTODetail(to.id);
      setFormState({
        toId: to.id,
        toNumber: to.toNumber,
        branchId: to.branchId,
        branchName: to.branchName,
        deliveryDate: to.deliveryDate,
        notes: "",
        trId: to.trRef !== "—" ? undefined : undefined,
        trNumber: to.trRef !== "—" ? to.trRef : undefined,
        lines,
      });
    },
    [fetchTODetail],
  );

  // ─── View TO detail ───
  const handleViewDetail = useCallback(
    async (to: TOHistoryRow) => {
      setDetailTO(to);
      setDetailOpen(true);
      setDetailLoading(true);
      const lines = await fetchTODetail(to.id);
      setDetailLines(lines);
      setDetailLoading(false);
    },
    [fetchTODetail],
  );

  // ─── Send from detail modal ───
  const handleSendFromDetail = useCallback(async () => {
    if (!detailTO) return;
    setFormSending(true);
    const result = await sendTO(detailTO.id, detailLines);
    setFormSending(false);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    toast.success(`${detailTO.toNumber} ${t("to.sentSuccess")}`);
    setDetailOpen(false);
    fetchHistory();
    refreshSmStock?.();
  }, [detailTO, detailLines, sendTO, fetchHistory, refreshSmStock, t]);

  const totalFormValue = useMemo(
    () => formState?.lines.reduce((s, l) => s + l.actualQty * l.unitCost, 0) ?? 0,
    [formState?.lines],
  );

  const hasLinesWithQty = useMemo(() => {
    if (!formState) return false;
    return formState.lines.some((l) => l.actualQty > 0);
  }, [formState?.lines]);

  // Lot line helpers
  const handleToggleExpand = useCallback(
    (lineId: string, skuId: string) => {
      setExpandedLines((prev) => {
        const next = { ...prev, [lineId]: !prev[lineId] };
        // First expansion: auto-add oldest prod record if no lots exist
        if (next[lineId] && (!lotLines[lineId] || lotLines[lineId].length === 0)) {
          const records = prodRecordsMap[skuId];
          const packSize = skus.find((s) => s.id === skuId)?.packSize ?? 0;
          if (records && records.length > 0) {
            const oldest = records[0];
            setLotLines((p) => ({
              ...p,
              [lineId]: [
                {
                  productionRecordId: oldest.id,
                  productionDate: oldest.productionDate,
                  packs: 0,
                  packWeightG: packSize,
                },
              ],
            }));
          }
        }
        return next;
      });
    },
    [lotLines, prodRecordsMap, skus],
  );

  const handleLotLineSave = useCallback(
    async (toLineId: string, idx: number, lot: LotLineLocal) => {
      if (lot.packs <= 0 && !lot.id) return; // Don't save empty new lots
      const lockKey = `${toLineId}-${idx}`;
      if (savingLotLinesRef.current.has(lockKey)) return; // Prevent duplicate concurrent saves
      setSavingLotLines((prev) => new Set(prev).add(lockKey));
      try {
        if (lot.id) {
          // Update existing
          await supabase
            .from("transfer_order_lot_lines")
            .update({
              production_record_id: lot.productionRecordId || null,
              production_date: lot.productionDate,
              packs: lot.packs,
              pack_weight_g: lot.packWeightG,
            })
            .eq("id", lot.id);
        } else {
          // Insert new
          const { data } = await supabase
            .from("transfer_order_lot_lines")
            .insert({
              to_line_id: toLineId,
              production_record_id: lot.productionRecordId || null,
              production_date: lot.productionDate,
              packs: lot.packs,
              pack_weight_g: lot.packWeightG,
            })
            .select("id")
            .single();
          if (data) {
            setLotLines((prev) => {
              const arr = [...(prev[toLineId] || [])];
              arr[idx] = { ...arr[idx], id: data.id };
              return { ...prev, [toLineId]: arr };
            });
          }
        }
      } finally {
        setSavingLotLines((prev) => {
          const next = new Set(prev);
          next.delete(lockKey);
          return next;
        });
      }
    },
    [savingLotLines],
  );

  const handleDeleteLotLine = useCallback(
    async (toLineId: string, idx: number) => {
      const lot = lotLines[toLineId]?.[idx];
      if (lot?.id) {
        await supabase.from("transfer_order_lot_lines").delete().eq("id", lot.id);
      }
      setLotLines((prev) => {
        const arr = [...(prev[toLineId] || [])];
        arr.splice(idx, 1);
        return { ...prev, [toLineId]: arr };
      });
    },
    [lotLines],
  );

  const handleAddLotLine = useCallback(
    (toLineId: string, skuId: string) => {
      const records = prodRecordsMap[skuId];
      const first = records?.[0];
      const packSize = skus.find((s) => s.id === skuId)?.packSize ?? 0;
      setLotLines((prev) => ({
        ...prev,
        [toLineId]: [
          ...(prev[toLineId] || []),
          {
            productionRecordId: first?.id || "",
            productionDate: first?.productionDate || toLocalDateStr(new Date()),
            packs: 0,
            packWeightG: packSize,
          },
        ],
      }));
    },
    [prodRecordsMap, skus],
  );

  // Qty input refs for Tab navigation
  const qtyRefs = useRef<Record<string, HTMLInputElement>>({});

  const thSortable = `${tableTokens.headerCell} cursor-pointer select-none hover:bg-muted/50`;

  return (
    <div className="space-y-6">
      {/* ═══ Page Header ═══ */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className={typography.pageTitle}>{t("to.pageTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("to.pageSubtitle")}</p>
        </div>
        {canEdit && !formState && !standaloneOpen && (
          <Button
            onClick={() => setStandaloneOpen(true)}
            className="h-9 bg-warning text-warning-foreground hover:bg-warning/90"
          >
            <Plus className="w-4 h-4 mr-1" /> {t("to.newTO")}
          </Button>
        )}
      </div>

      {/* ═══ SECTION A: Pending TR Queue ═══ */}
      {canEdit && pendingTRs.length > 0 && !formState && (
        <div className="rounded-lg border border-warning/30 border-l-4 border-l-warning bg-warning/[0.06] p-4 space-y-3">
          <div className="flex items-center gap-2">
            <StatusDot status="amber" size="sm" />
            <Zap className="w-4 h-4 text-warning" />
            <span className="text-sm font-semibold text-foreground">
              {t("to.pendingTRs").replace("{n}", String(pendingTRs.length))}
            </span>
          </div>
          <div className={tableTokens.wrapper}>
            <div className="overflow-y-auto max-h-[65vh]">
              <table className={tableTokens.base}>
                <colgroup>
                  <col style={{ width: 150 }} />
                  <col />
                  <col style={{ width: 120 }} />
                  <col style={{ width: 70 }} />
                  <col style={{ width: 120 }} />
                </colgroup>
                <thead className="sticky top-0 z-[5]">
                  <tr className={tableTokens.headerRow}>
                    <th className={tableTokens.headerCell}>{t("tr.colTrNumber")}</th>
                    <th className={tableTokens.headerCell}>{t("col.branch")}</th>
                    <th className={tableTokens.headerCell}>{t("tr.colRequiredDate")}</th>
                    <th className={`${tableTokens.headerCell} text-right`}>{t("tr.colItems")}</th>
                    <th className={`${tableTokens.headerCell} text-center`}>{t("col.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingTRs.map((tr) => (
                    <tr key={tr.trId} className={tableTokens.dataRow}>
                      <td className={`${tableTokens.dataCell} font-mono text-xs`}>{tr.trNumber}</td>
                      <td className={tableTokens.truncatedCell} title={tr.branchName}>
                        {tr.branchName}
                      </td>
                      <td
                        className={`${tableTokens.dataCell} ${isUrgent(tr.requiredDate) ? "text-destructive font-medium" : ""}`}
                      >
                        {tr.requiredDate}
                      </td>
                      <td className={tableTokens.dataCellMono}>{tr.itemCount}</td>
                      <td className={`${tableTokens.dataCell} text-center`}>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs bg-warning text-warning-foreground hover:bg-warning/90"
                          onClick={() => handleCreateFromTR(tr)}
                        >
                          {t("to.createTO")}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Standalone TO creation form ═══ */}
      {canEdit && standaloneOpen && !formState && (
        <div className="rounded-lg border bg-card p-6 space-y-4">
          <h3 className={typography.sectionTitle}>{t("to.newFormTitle")}</h3>
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1 min-w-[200px]">
              <label className="text-sm text-muted-foreground">{t("to.branchRequired")}</label>
              <SearchableSelect
                value={standaloneBranch}
                onValueChange={setStandaloneBranch}
                options={activeBranches.map((b) => ({ value: b.id, label: `${b.branchName} — ${b.brandName}` }))}
                placeholder="Select branch"
                triggerClassName={`h-10 ${!standaloneBranch ? "ring-1 ring-destructive" : ""}`}
              />
            </div>
            <DatePicker
              value={standaloneDate}
              onChange={setStandaloneDate}
              label={t("to.deliveryDate")}
              required
              labelPosition="above"
              defaultToday
            />
            <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
              <label className="text-sm text-muted-foreground">{t("col.notes")}</label>
              <Input
                value={standaloneNotes}
                onChange={(e) => setStandaloneNotes(e.target.value)}
                placeholder={t("tr.notesPlaceholder")}
                className="h-10"
              />
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setStandaloneOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreateStandalone} disabled={!standaloneBranch || !standaloneDate}>
                {t("to.createTO")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ SECTION B: Active TO Form ═══ */}
      {formState && (
        <div className="rounded-lg border-2 border-primary/20 bg-card shadow-sm overflow-hidden">
          {/* ── Header strip ── */}
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 bg-primary/[0.06] border-b border-primary/10">
            <div className="flex items-center gap-4">
              <span className="font-mono text-base font-bold text-foreground">{formState.toNumber}</span>
              <Separator orientation="vertical" className="h-5" />
              <span className="text-sm font-medium text-foreground">{formState.branchName}</span>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={handleCancelForm}>
                Cancel
              </Button>
              <Button variant="outline" size="sm" onClick={handleSaveDraft} disabled={formSaving}>
                <Save className="w-4 h-4 mr-1" />
                {formSaving ? "Saving..." : t("to.saveDraft")}
              </Button>
              <Button
                size="sm"
                className="bg-warning hover:bg-warning/90 text-warning-foreground"
                onClick={handleSend}
                disabled={!hasLinesWithQty || formSending}
              >
                <Send className="w-4 h-4 mr-1" />
                {formSending ? t("to.sending") : t("to.sendTO")}
              </Button>
            </div>
          </div>

          {/* ── Secondary metadata bar ── */}
          <div className="flex flex-wrap items-center gap-4 px-5 py-2.5 bg-muted/30 border-b text-sm">
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">{t("to.deliveryDate")}:</span>
              <DatePicker
                value={formState.deliveryDate ? new Date(formState.deliveryDate + "T00:00:00") : undefined}
                onChange={(d) => {
                  if (d) setFormState((prev) => (prev ? { ...prev, deliveryDate: toLocalDateStr(d) } : prev));
                }}
                required
              />
            </div>
            <Separator orientation="vertical" className="h-4" />
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">{t("to.colTrRef")}:</span>
              <span className="font-mono text-xs">{formState.trNumber || "—"}</span>
            </div>
            <Separator orientation="vertical" className="h-4" />
            <div className="flex items-center gap-1.5 flex-1 min-w-[160px]">
              <span className="text-muted-foreground">{t("col.notes")}:</span>
              <Input
                value={formState.notes}
                onChange={(e) => setFormState((prev) => (prev ? { ...prev, notes: e.target.value } : prev))}
                placeholder={t("tr.notesPlaceholder")}
                className="h-8 text-sm flex-1"
              />
            </div>
          </div>

          {/* ── SKU Sheet ── */}
          <div className="p-5 space-y-3">
            <div className="flex items-end justify-between">
              <div>
                <p className="text-sm font-semibold">{t("to.itemsFor").replace("{branch}", formState.branchName)}</p>
                <p className="text-xs text-muted-foreground">
                  {formState.trId ? t("to.preloadedHint") : t("to.addItemsHint")}
                </p>
              </div>
            </div>

            <div className={tableTokens.wrapper}>
              <div className="overflow-y-auto max-h-[65vh]">
                <table className={tableTokens.base}>
                  <colgroup>
                    <col style={{ width: 90 }} />
                    <col />
                    <col style={{ width: 100 }} />
                    <col style={{ width: 80 }} />
                    <col style={{ width: 100 }} />
                    <col style={{ width: 60 }} />
                    <col style={{ width: 100 }} />
                    <col style={{ width: 50 }} />
                  </colgroup>
                  <thead className="sticky top-0 z-[5]">
                    <tr className={tableTokens.headerRow}>
                      <th className={tableTokens.headerCell}>{t("tr.colSkuCode")}</th>
                      <th className={tableTokens.headerCell}>{t("tr.colSkuName")}</th>
                      <th className={`${tableTokens.headerCell} text-right`}>{t("tr.colRequested")}</th>
                      <th
                        className={`${tableTokens.headerCell} !bg-foreground !text-background font-semibold text-right`}
                      >
                        PACKS
                      </th>
                      <th className={`${tableTokens.headerCell} text-right`}>WEIGHT (g)</th>
                      <th className={`${tableTokens.headerCell} text-center`}>UOM</th>
                      <th className={tableTokens.headerCell}>{t("col.note")}</th>
                      <th className={tableTokens.headerCell}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {formState.lines.map((line, idx) => {
                      const packSize = skus.find((s) => s.id === line.skuId)?.packSize ?? 0;
                      const requestedPacks = packSize > 0 ? Math.round(line.plannedQty / packSize) : 0;
                      const currentPacks = packSize > 0 ? Math.round(line.actualQty / packSize) : 0;
                      const isExpanded = expandedLines[line.id] || false;
                      const lineLots = lotLines[line.id] || [];
                      const assignedPacks = lineLots.reduce((s, l) => s + l.packs, 0);
                      const skuRecords = prodRecordsMap[line.skuId] || [];

                      // Inline lot summary
                      const lotSummary = (() => {
                        if (packSize === 0) return null;
                        if (skuRecords.length === 0) {
                          return currentPacks > 0 ? (
                            <span className="text-warning flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3" /> No production records
                            </span>
                          ) : null;
                        }
                        const activeLots = lineLots.filter((l) => l.packs > 0);
                        if (activeLots.length === 0) {
                          return currentPacks > 0 ? (
                            <span className="text-muted-foreground italic">No lots assigned</span>
                          ) : null;
                        }
                        const parts = activeLots.map((l) => {
                          const d = new Date(l.productionDate + "T00:00:00");
                          return `${d.getDate()}/${d.getMonth() + 1}×${l.packs}`;
                        });
                        const colorCls =
                          assignedPacks === currentPacks
                            ? "text-success"
                            : assignedPacks < currentPacks
                              ? "text-warning"
                              : "text-destructive";
                        return <span className={`${colorCls} font-mono`}>{parts.join(", ")}</span>;
                      })();

                      return (
                        <React.Fragment key={line.id}>
                          <tr className={`${tableTokens.dataRow}`}>
                            <td className={`${tableTokens.dataCell} font-mono text-xs align-middle`}>{line.skuCode}</td>
                            <td className={`${tableTokens.truncatedCell} align-middle`} title={line.skuName}>
                              <div className="truncate">{line.skuName}</div>
                              {lotSummary && <div className="text-xs mt-0.5">{lotSummary}</div>}
                            </td>
                            {/* REQUESTED — packs primary, grams secondary */}
                            <td className={`${tableTokens.dataCell} text-right align-middle`}>
                              {line.trLineId ? (
                                packSize > 0 ? (
                                  <div>
                                    <span className="font-mono text-sm">{formatNumber(requestedPacks, 0)}</span>
                                    <div className="text-xs text-muted-foreground">
                                      {formatNumber(line.plannedQty, 0)}g
                                    </div>
                                  </div>
                                ) : (
                                  <div>
                                    <span className="font-mono text-sm text-muted-foreground">
                                      {formatNumber(line.plannedQty, 0)}g
                                    </span>
                                    <div className="text-xs text-muted-foreground mt-0.5 invisible">·</div>
                                  </div>
                                )
                              ) : (
                                <div>
                                  <span className="text-muted-foreground">—</span>
                                  <div className="text-xs text-muted-foreground mt-0.5 invisible">·</div>
                                </div>
                              )}
                            </td>
                            {/* PACKS — primary amber input */}
                            <td className={`${tableTokens.dataCell} text-right align-middle`}>
                              {canEdit ? (
                                packSize > 0 ? (
                                  <div>
                                    <input
                                      ref={(el) => {
                                        if (el) qtyRefs.current[line.id] = el;
                                      }}
                                      type="number"
                                      inputMode="numeric"
                                      min={0}
                                      step={1}
                                      defaultValue={currentPacks || ""}
                                      onBlur={(e) => {
                                        const packs = Math.round(Number(e.target.value) || 0);
                                        const grams = packs * packSize;
                                        handleLineUpdate(line.id, "actualQty", grams);

                                        // FIFO auto-fill lots if empty
                                        const currentLots = lotLines[line.id] || [];
                                        const hasManualLots = currentLots.some((l) => l.packs > 0);
                                        const records = prodRecordsMap[line.skuId] || [];
                                        if (packs > 0 && !hasManualLots && records.length > 0) {
                                          let remaining = packs;
                                          const newLotLines: LotLineLocal[] = [];
                                          for (const record of records) {
                                            if (remaining <= 0) break;
                                            const allocate = remaining;
                                            newLotLines.push({
                                              productionRecordId: record.id,
                                              productionDate: record.productionDate,
                                              packs: allocate,
                                              packWeightG: packSize,
                                            });
                                            remaining -= allocate;
                                          }
                                          setLotLines((prev) => ({ ...prev, [line.id]: newLotLines }));
                                          for (let i = 0; i < newLotLines.length; i++) {
                                            handleLotLineSave(line.id, i, newLotLines[i]);
                                          }
                                        }
                                      }}
                                      onKeyDown={(e) => {
                                        if (e.key === "Tab") {
                                          e.preventDefault();
                                          const nextIdx = e.shiftKey ? idx - 1 : idx + 1;
                                          if (nextIdx >= 0 && nextIdx < formState.lines.length) {
                                            const nextId = formState.lines[nextIdx].id;
                                            qtyRefs.current[nextId]?.focus();
                                            qtyRefs.current[nextId]?.select();
                                          }
                                        }
                                      }}
                                      className="h-8 w-full text-sm font-mono text-right px-2 rounded-md border-2 border-primary/40 bg-amber-50 focus:border-primary focus:ring-0 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                      style={{ textAlign: "right" }}
                                      key={`packs-${line.id}`}
                                    />
                                    <div className="text-xs text-muted-foreground mt-0.5 invisible">·</div>
                                  </div>
                                ) : (
                                  <div>
                                    <input
                                      ref={(el) => {
                                        if (el) qtyRefs.current[line.id] = el;
                                      }}
                                      type="number"
                                      inputMode="numeric"
                                      min={0}
                                      step={1}
                                      defaultValue={line.actualQty || ""}
                                      onBlur={(e) => handleLineUpdate(line.id, "actualQty", Number(e.target.value) || 0)}
                                      onKeyDown={(e) => {
                                        if (e.key === "Tab") {
                                          e.preventDefault();
                                          const nextIdx = e.shiftKey ? idx - 1 : idx + 1;
                                          if (nextIdx >= 0 && nextIdx < formState.lines.length) {
                                            const nextId = formState.lines[nextIdx].id;
                                            qtyRefs.current[nextId]?.focus();
                                            qtyRefs.current[nextId]?.select();
                                          }
                                        }
                                      }}
                                      placeholder="g"
                                      className="h-8 w-full text-sm font-mono text-right px-2 rounded-md border-2 border-primary/40 bg-amber-50 focus:border-primary focus:ring-0 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                      style={{ textAlign: "right" }}
                                      key={`g-${line.id}`}
                                    />
                                    <div className="text-xs text-muted-foreground mt-0.5 invisible">·</div>
                                  </div>
                                )
                              ) : (
                                <span className="font-mono">
                                  {packSize > 0 ? formatNumber(currentPacks, 0) : formatNumber(line.actualQty, 0)}
                                </span>
                              )}
                            </td>
                            {/* WEIGHT (g) — secondary amber input */}
                            <td className={`${tableTokens.dataCell} text-right align-middle`}>
                              {canEdit && packSize > 0 ? (
                                <div>
                                  <input
                                    type="number"
                                    inputMode="numeric"
                                    min={0}
                                    step={1}
                                    defaultValue={line.actualQty || ""}
                                    onBlur={(e) => {
                                      const grams = Number(e.target.value) || 0;
                                      if (grams > 0) {
                                        handleLineUpdate(line.id, "actualQty", grams);
                                      }
                                    }}
                                    placeholder="override"
                                    className="h-8 w-full text-sm font-mono text-right px-2 rounded-md border border-input bg-amber-50/60 opacity-80 focus:border-primary focus:ring-0 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                    style={{ textAlign: "right" }}
                                    key={`wt-${line.id}`}
                                  />
                                  <div className="text-xs text-muted-foreground mt-0.5">
                                    est. {formatNumber(currentPacks * packSize, 0)}g
                                  </div>
                                </div>
                              ) : packSize === 0 ? (
                                <span className="text-muted-foreground text-xs">—</span>
                              ) : (
                                <span className="font-mono text-sm">{formatNumber(line.actualQty, 0)}</span>
                              )}
                            </td>
                            <td className={`${tableTokens.dataCell} text-center align-middle`}>
                              <UnitLabel unit={line.uom} />
                            </td>
                            <td className={`${tableTokens.dataCell} align-middle`}>
                              {canEdit ? (
                                <Input
                                  defaultValue={line.note}
                                  onBlur={(e) => handleLineUpdate(line.id, "note", e.target.value)}
                                  className="h-8 text-xs"
                                  placeholder="Note..."
                                />
                              ) : (
                                <span className="text-xs text-muted-foreground">{line.note || ""}</span>
                              )}
                            </td>
                            <td className={`${tableTokens.dataCell} text-center align-middle`}>
                              <div className="flex items-center justify-center gap-0.5">
                                {packSize > 0 && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7"
                                    onClick={() => handleToggleExpand(line.id, line.skuId)}
                                    title="Lot assignment"
                                  >
                                    {isExpanded ? (
                                      <ChevronUp className="w-3.5 h-3.5" />
                                    ) : (
                                      <ChevronDown className="w-3.5 h-3.5" />
                                    )}
                                  </Button>
                                )}
                                {canEdit && !line.trLineId && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 text-destructive hover:text-destructive"
                                    onClick={() => handleDeleteLine(line.id)}
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </Button>
                                )}
                              </div>
                            </td>
                          </tr>

                          {/* ── Lot assignment sub-row ── */}
                          {isExpanded && (
                            <tr>
                              <td colSpan={8} className="p-0">
                                <div className="bg-muted/30 px-5 py-3 space-y-2">
                                  <div className="flex items-center justify-between">
                                    <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                                      <Package className="w-3.5 h-3.5" />
                                      Lot Assignment
                                    </span>
                                    {(() => {
                                      const y = currentPacks;
                                      if (y === 0)
                                        return (
                                          <span className="text-xs text-muted-foreground">
                                            Enter packs above to track lots
                                          </span>
                                        );
                                      const colorCls =
                                        assignedPacks < y
                                          ? "text-warning"
                                          : assignedPacks === y
                                            ? "text-success"
                                            : "text-destructive";
                                      return (
                                        <span className={`text-xs font-mono font-medium ${colorCls}`}>
                                          {assignedPacks} / {y} packs assigned
                                        </span>
                                      );
                                    })()}
                                  </div>

                                  {lineLots.map((lot, lotIdx) => {
                                    const selRecord = skuRecords.find((r) => r.id === lot.productionRecordId);
                                    return (
                                      <div key={lotIdx} className="flex items-center gap-3 text-sm">
                                        {/* Production date selector */}
                                        <select
                                          className="h-8 rounded-md border border-input bg-background px-2 text-xs min-w-[180px]"
                                          defaultValue={lot.productionRecordId}
                                          onChange={(e) => {
                                            const rec = skuRecords.find((r) => r.id === e.target.value);
                                            if (!rec) return;
                                            const updated: LotLineLocal = {
                                              ...lot,
                                              productionRecordId: rec.id,
                                              productionDate: rec.productionDate,
                                              packWeightG: packSize,
                                            };
                                            setLotLines((prev) => {
                                              const arr = [...(prev[line.id] || [])];
                                              arr[lotIdx] = updated;
                                              return { ...prev, [line.id]: arr };
                                            });
                                            handleLotLineSave(line.id, lotIdx, updated);
                                          }}
                                        >
                                          {skuRecords.map((r) => (
                                            <option key={r.id} value={r.id}>
                                              {new Date(r.productionDate + "T00:00:00").toLocaleDateString("en-GB", {
                                                day: "2-digit",
                                                month: "short",
                                                year: "numeric",
                                              })}{" "}
                                              — {r.batchesProduced} batches
                                            </option>
                                          ))}
                                        </select>

                                        {/* Packs input */}
                                        <input
                                          type="number"
                                          inputMode="numeric"
                                          min={0}
                                          step={1}
                                          defaultValue={lot.packs || ""}
                                          placeholder="Packs"
                                          onBlur={(e) => {
                                            const packs = Math.round(Number(e.target.value) || 0);
                                            const updated: LotLineLocal = { ...lot, packs };
                                            setLotLines((prev) => {
                                              const arr = [...(prev[line.id] || [])];
                                              arr[lotIdx] = updated;
                                              return { ...prev, [line.id]: arr };
                                            });
                                            handleLotLineSave(line.id, lotIdx, updated);
                                          }}
                                          className="h-8 w-16 text-sm font-mono text-right px-2 rounded-md border border-input bg-amber-50 focus:border-primary focus:ring-0 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                          style={{ textAlign: "right" }}
                                          key={`lot-packs-${line.id}-${lotIdx}-${lot.id || "new"}`}
                                        />

                                        {/* Pack weight display */}
                                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                                          ~{formatNumber(lot.packWeightG, 0)}g/pack
                                        </span>

                                        {/* Total g */}
                                        <span className="text-xs font-mono text-muted-foreground whitespace-nowrap">
                                          = {formatNumber(lot.packs * lot.packWeightG, 0)}g
                                        </span>

                                        {/* Delete */}
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-6 w-6 text-destructive hover:text-destructive"
                                          onClick={() => handleDeleteLotLine(line.id, lotIdx)}
                                        >
                                          <Trash2 className="w-3 h-3" />
                                        </Button>
                                      </div>
                                    );
                                  })}

                                  {skuRecords.length === 0 && (
                                    <span className="text-xs text-muted-foreground">
                                      No production records found for this SKU
                                    </span>
                                  )}

                                  {/* Add lot button */}
                                  {skuRecords.length > 0 && (
                                    <button
                                      onClick={() => handleAddLotLine(line.id, line.skuId)}
                                      className="w-full border border-dashed border-muted-foreground/30 text-muted-foreground hover:border-primary/40 hover:text-primary rounded-md py-1.5 text-xs transition-colors flex items-center justify-center gap-1"
                                    >
                                      <Plus className="w-3 h-3" /> Add lot
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Add item (standalone only) */}
            {canEdit && !formState.trId && (
              <div className="flex items-center gap-2">
                {skuSearchOpen ? (
                  <div className="flex-1 max-w-[400px]">
                    <SearchableSelect
                      value=""
                      onValueChange={handleAddItem}
                      options={[
                        ...smSkus
                          .filter((s) => bomSkuIds.has(s.id) && !formState.lines.some((l) => l.skuId === s.id))
                          .map((s) => ({ value: s.id, label: `${s.skuId} — ${s.name}`, sublabel: s.skuId })),
                        ...distributableRmSkus
                          .filter((s) => !formState.lines.some((l) => l.skuId === s.id))
                          .map((s) => ({ value: s.id, label: `${s.skuId} — ${s.name} (RM)`, sublabel: s.skuId })),
                      ]}
                      placeholder="Search SKU..."
                      triggerClassName="h-9"
                    />
                  </div>
                ) : (
                  <button
                    onClick={() => setSkuSearchOpen(true)}
                    className="w-full border-2 border-dashed border-primary/40 text-primary hover:border-primary/60 hover:bg-accent rounded-md py-2 text-sm transition-colors flex items-center justify-center gap-1"
                  >
                    <Plus className="w-4 h-4" /> {t("to.addItem")}
                  </button>
                )}
                {skuSearchOpen && (
                  <Button variant="ghost" size="sm" onClick={() => setSkuSearchOpen(false)}>
                    Cancel
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══ SECTION C: TO History ═══ */}
      <div className="space-y-4">
        {/* Divider + label */}
        <div className="pt-2">
          <Separator className="mb-3" />
          <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">{t("to.history")}</span>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-sm text-muted-foreground">{t("col.branch")}</label>
            <Select value={filterBranch || "__all__"} onValueChange={(v) => setFilterBranch(v === "__all__" ? "" : v)}>
              <SelectTrigger className="w-[200px] h-9">
                <SelectValue placeholder="All branches" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All branches</SelectItem>
                {activeBranches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.branchName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm text-muted-foreground">{t("col.status")}</label>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-[180px] h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["All", "Draft", "Sent", "Received", "Partially Received", "Cancelled"].map((s) => (
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
          <Button variant="outline" className="h-9" onClick={handleFilterApply}>
            {t("btn.filter")}
          </Button>
        </div>

        {/* History table */}
        <div className={tableTokens.wrapper}>
          <div className="overflow-y-auto max-h-[65vh]">
            <table className={tableTokens.base}>
              <colgroup>
                <col style={{ width: 150 }} />
                <col style={{ width: 110 }} />
                <col />
                <col style={{ width: 130 }} />
                <col style={{ width: 60 }} />
                <col style={{ width: 110 }} />
                <col style={{ width: 130 }} />
                <col style={{ width: 90 }} />
              </colgroup>
              <thead className="sticky top-0 z-[5]">
                <tr className={tableTokens.headerRow}>
                  <th className={thSortable} onClick={() => handleSort("toNumber")}>
                    <span className={`inline-flex items-center ${sortKey === "toNumber" ? "text-foreground" : ""}`}>
                      {t("to.colToNumber")}
                      <SortIcon col="toNumber" />
                    </span>
                  </th>
                  <th className={thSortable} onClick={() => handleSort("date")}>
                    <span className={`inline-flex items-center ${sortKey === "date" ? "text-foreground" : ""}`}>
                      {t("col.date")}
                      <SortIcon col="date" />
                    </span>
                  </th>
                  <th className={thSortable} onClick={() => handleSort("branch")}>
                    <span className={`inline-flex items-center ${sortKey === "branch" ? "text-foreground" : ""}`}>
                      {t("col.branch")}
                      <SortIcon col="branch" />
                    </span>
                  </th>
                  <th className={tableTokens.headerCell}>{t("to.colTrRef")}</th>
                  <th className={`${tableTokens.headerCell} text-right`}>{t("tr.colItems")}</th>
                  <th className={`${tableTokens.headerCell} text-right`}>{t("to.totalValue")}</th>
                  <th className={thSortable} onClick={() => handleSort("status")}>
                    <span className={`inline-flex items-center ${sortKey === "status" ? "text-foreground" : ""}`}>
                      {t("col.status")}
                      <SortIcon col="status" />
                    </span>
                  </th>
                  <th className={`${tableTokens.headerCell} text-center`}>{t("col.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {historyLoading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i} className={tableTokens.dataRow}>
                      {Array.from({ length: 8 }).map((_, j) => (
                        <td key={j} className={tableTokens.dataCell}>
                          <Skeleton className="h-4 w-full" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : sortedHistory.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center py-8 text-muted-foreground text-sm">
                      {t("to.noResults")}
                    </td>
                  </tr>
                ) : (
                  sortedHistory.map((to) => (
                    <tr key={to.id} className={tableTokens.dataRow}>
                      <td
                        className={`${tableTokens.dataCell} font-mono text-xs cursor-pointer text-primary hover:underline`}
                        onClick={() => handleViewDetail(to)}
                      >
                        {to.toNumber}
                      </td>
                      <td className={tableTokens.dataCell}>{to.deliveryDate}</td>
                      <td className={tableTokens.truncatedCell} title={to.branchName}>
                        {to.branchName}
                      </td>
                      <td className={`${tableTokens.dataCell} font-mono text-xs text-muted-foreground`}>{to.trRef}</td>
                      <td className={tableTokens.dataCellMono}>{to.itemCount}</td>
                      <td className={tableTokens.dataCellMono}>฿{formatNumber(to.totalValue, 0)}</td>
                      <td className={tableTokens.dataCell}>
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${toStatusBadge[to.status] || ""}`}
                        >
                          {to.status}
                        </span>
                      </td>
                      <td className={`${tableTokens.dataCell} text-center`}>
                        <div className="flex items-center justify-center gap-1">
                          {canEdit && to.status === "Draft" && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => handleEditDraft(to)}
                              title="Edit draft"
                            >
                              <Pencil className="w-4 h-4" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => handleViewDetail(to)}
                            title="View"
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                          {isManagement && to.status !== "Cancelled" && to.status !== "Received" && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={() => cancelTO(to.id)}
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

      {/* ═══ TO Detail Modal ═══ */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto print:max-w-full print:max-h-full print:overflow-visible">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <span className="font-mono">{detailTO?.toNumber}</span>
              {detailTO && (
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${toStatusBadge[detailTO.status] || ""}`}
                >
                  {detailTO.status}
                </span>
              )}
            </DialogTitle>
          </DialogHeader>

          {detailTO && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">{t("tr.detailBranch")} </span>
                  <span className="font-medium">{detailTO.branchName}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t("to.detailDeliveryDate")} </span>
                  <span>{detailTO.deliveryDate}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t("to.detailTrRef")} </span>
                  <span className="font-mono">{detailTO.trRef}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t("to.detailTotalValue")} </span>
                  <span className="font-mono font-semibold">฿{formatNumber(detailTO.totalValue, 2)}</span>
                </div>
              </div>

              {detailLoading ? (
                <div className="text-center py-6 text-muted-foreground text-sm">{t("tr.loadingLines")}</div>
              ) : (
                <div className={tableTokens.wrapper}>
                  <table className={tableTokens.base}>
                    <colgroup>
                      <col style={{ width: 90 }} />
                      <col />
                      <col style={{ width: 90 }} />
                      <col style={{ width: 90 }} />
                      <col style={{ width: 60 }} />
                      <col style={{ width: 90 }} />
                    </colgroup>
                    <thead>
                      <tr className={tableTokens.headerRow}>
                        <th className={tableTokens.headerCell}>{t("tr.colSkuCode")}</th>
                        <th className={tableTokens.headerCell}>{t("tr.colSkuName")}</th>
                        <th className={`${tableTokens.headerCell} text-right`}>{t("tr.colRequested")}</th>
                        <th className={`${tableTokens.headerCell} text-right`}>{t("to.colActual")}</th>
                        <th className={`${tableTokens.headerCell} text-center`}>UOM</th>
                        <th className={`${tableTokens.headerCell} text-right`}>{t("to.colLineValue")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detailLines.map((l) => {
                        const detailPackSize = skus.find((s) => s.id === l.skuId)?.packSize ?? 0;
                        return (
                          <tr key={l.id} className={tableTokens.dataRow}>
                            <td className={`${tableTokens.dataCell} font-mono text-xs`}>{l.skuCode}</td>
                            <td className={tableTokens.truncatedCell} title={l.skuName}>
                              {l.skuName}
                            </td>
                            <td className={`${tableTokens.dataCellMono} text-muted-foreground`}>
                              {detailPackSize > 0 ? (
                                <div>
                                  <span>{Math.round(l.plannedQty / detailPackSize)} packs</span>
                                  <div className="text-xs text-muted-foreground">{formatNumber(l.plannedQty, 0)}g</div>
                                </div>
                              ) : (
                                formatNumber(l.plannedQty, 0) + "g"
                              )}
                            </td>
                            <td className={`${tableTokens.dataCellMono} font-medium`}>
                              {detailPackSize > 0 ? (
                                <div>
                                  <span>{Math.round(l.actualQty / detailPackSize)} packs</span>
                                  <div className="text-xs text-muted-foreground">{formatNumber(l.actualQty, 0)}g</div>
                                </div>
                              ) : (
                                formatNumber(l.actualQty, 0) + "g"
                              )}
                            </td>
                            <td className={`${tableTokens.dataCell} text-center`}>
                              <UnitLabel unit={l.uom} />
                            </td>
                            <td className={tableTokens.dataCellMono}>฿{formatNumber(l.actualQty * l.unitCost, 2)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="flex justify-end gap-2 print:hidden">
                {canEdit && detailTO.status === "Draft" && detailLines.some((l) => l.actualQty > 0) && (
                  <Button
                    className="bg-warning hover:bg-warning/90 text-warning-foreground"
                    onClick={handleSendFromDetail}
                    disabled={formSending}
                  >
                    <Send className="w-4 h-4 mr-1" />
                    {formSending ? t("to.sending") : t("to.sendTO")}
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
    </div>
  );
}
