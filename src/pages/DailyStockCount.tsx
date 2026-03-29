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
import { supabase } from "@/integrations/supabase/client";
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
  GripVertical,
  Printer,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

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

/* ── Sortable row wrapper for arrange mode ── */
function SortableArrangeRow({ skuId, sku }: { skuId: string; sku: SKU }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: skuId });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : undefined,
  };
  return (
    <tr ref={setNodeRef} style={style} className="border-b border-table-border bg-background">
      <td className="w-8 px-1 py-1.5" {...attributes} {...listeners}>
        <GripVertical className="w-4 h-4 text-muted-foreground cursor-grab" />
      </td>
      <td className="font-mono text-xs px-2 py-1.5">{sku.skuId}</td>
      <td className="max-w-[150px] truncate px-2 py-1.5 text-sm" title={sku.name}>
        {sku.name}
      </td>
      <td className="px-2 py-1.5">
        <span
          className={`inline-flex px-1.5 py-0.5 rounded text-xs font-semibold ${
            sku.type === "RM"
              ? "bg-warning/15 text-warning"
              : sku.type === "SM"
                ? "bg-info/15 text-info"
                : "bg-muted text-muted-foreground"
          }`}
        >
          {sku.type}
        </span>
      </td>
      <td className="px-2 py-1.5 text-sm text-muted-foreground text-center">{sku.usageUom}</td>
      {/* Placeholder cells for remaining columns — muted */}
      <td className="px-2 py-1.5 opacity-40 text-right text-sm">—</td>
      <td className="px-2 py-1.5 opacity-40 text-right text-sm">—</td>
      <td className="px-2 py-1.5 opacity-40 text-right text-sm">—</td>
      <td className="px-2 py-1.5 opacity-40 text-right text-sm">—</td>
      <td className="px-2 py-1.5 opacity-40 text-right text-sm">—</td>
      <td className="px-2 py-1.5 opacity-40 text-right text-sm">—</td>
      <td className="px-2 py-1.5 opacity-40 text-right text-sm">—</td>
    </tr>
  );
}

export default function DailyStockCountPage({
  skus,
  menuBomLines,
  modifierRules,
  spBomLines,
  menus,
  branches,
}: DailyStockCountPageProps) {
  const { isManagement, isStoreManager, profile, user } = useAuth();
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

  // Arrange mode state
  const [arrangeMode, setArrangeMode] = useState(false);
  const [arrangeOrder, setArrangeOrder] = useState<string[]>([]);
  const [customSkuOrder, setCustomSkuOrder] = useState<string[] | null>(null);
  const [savingOrder, setSavingOrder] = useState(false);

  // Print state
  const [printModalOpen, setPrintModalOpen] = useState(false);
  const [printScope, setPrintScope] = useState<"today" | "month">("today");

  const handleSort = useCallback(
    (key: SortKey) => {
      if (arrangeMode) return; // disabled in arrange mode
      setSortKey((prev) => {
        if (prev === key) {
          setSortDir((d) => (d === "asc" ? "desc" : "asc"));
          return key;
        }
        setSortDir("asc");
        return key;
      });
    },
    [arrangeMode],
  );

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

  // Load custom order preference on branch change
  useEffect(() => {
    if (!selectedBranch || !user?.id) {
      setCustomSkuOrder(null);
      return;
    }
    supabase
      .from("user_sort_preferences")
      .select("sku_order")
      .eq("user_id", user.id)
      .eq("branch_id", selectedBranch)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.sku_order && Array.isArray(data.sku_order)) {
          setCustomSkuOrder(data.sku_order as string[]);
        } else {
          setCustomSkuOrder(null);
        }
      });
  }, [selectedBranch, user?.id]);

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
      // Custom order takes priority
      if (customSkuOrder && customSkuOrder.length > 0) {
        const idxA = customSkuOrder.indexOf(a.skuId);
        const idxB = customSkuOrder.indexOf(b.skuId);
        const posA = idxA >= 0 ? idxA : 999999;
        const posB = idxB >= 0 ? idxB : 999999;
        if (posA !== posB) return posA - posB;
        // Both not in custom order → fall back to skuCode
        const skuA = skuMap.get(a.skuId);
        const skuB = skuMap.get(b.skuId);
        return (skuA?.skuId ?? "").localeCompare(skuB?.skuId ?? "");
      }

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
    [skuMap, sortKey, sortDir, customSkuOrder],
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

  // ── Arrange mode logic ──
  const allBranchSkus = useMemo(() => {
    // Use rows from the loaded count sheet — already branch-filtered by generateSheet/loadSheet
    // Both active and unused rows combined = full branch-relevant SKU population
    if (rows.length === 0) return [];
    const allRows = [...activeRows, ...unusedRows];
    return allRows.map((r) => skuMap.get(r.skuId)).filter((s): s is SKU => !!s);
  }, [rows.length, activeRows, unusedRows, skuMap]);

  const enterArrangeMode = useCallback(() => {
    // Build initial order: if customSkuOrder exists, use it; else default type→skuCode
    const skuIds = allBranchSkus.map((s) => s.id);
    if (customSkuOrder && customSkuOrder.length > 0) {
      const ordered: string[] = [];
      // First: items in customSkuOrder that exist in allBranchSkus
      const skuIdSet = new Set(skuIds);
      for (const id of customSkuOrder) {
        if (skuIdSet.has(id)) ordered.push(id);
      }
      // Then: remaining items not in customSkuOrder
      for (const id of skuIds) {
        if (!ordered.includes(id)) ordered.push(id);
      }
      setArrangeOrder(ordered);
    } else {
      // Default sort: type order then skuCode
      const sorted = [...allBranchSkus].sort((a, b) => {
        const ta = TYPE_ORDER[a.type] ?? 9;
        const tb = TYPE_ORDER[b.type] ?? 9;
        if (ta !== tb) return ta - tb;
        return a.skuId.localeCompare(b.skuId);
      });
      setArrangeOrder(sorted.map((s) => s.id));
    }
    setArrangeMode(true);
  }, [allBranchSkus, customSkuOrder]);

  const cancelArrangeMode = useCallback(() => {
    setArrangeMode(false);
    setArrangeOrder([]);
  }, []);

  const saveArrangeOrder = useCallback(async () => {
    if (!user?.id || !selectedBranch) return;
    setSavingOrder(true);
    try {
      // Check if preference exists
      const { data: existing } = await supabase
        .from("user_sort_preferences")
        .select("id")
        .eq("user_id", user.id)
        .eq("branch_id", selectedBranch)
        .maybeSingle();

      if (existing) {
        await supabase
          .from("user_sort_preferences")
          .update({ sku_order: arrangeOrder as unknown as any, updated_at: new Date().toISOString() })
          .eq("id", existing.id);
      } else {
        await supabase
          .from("user_sort_preferences")
          .insert({ user_id: user.id, branch_id: selectedBranch, sku_order: arrangeOrder as unknown as any });
      }

      setCustomSkuOrder(arrangeOrder);
      setArrangeMode(false);
      setArrangeOrder([]);
      toast.success("บันทึกลำดับแล้ว");
    } catch {
      toast.error("ไม่สามารถบันทึกลำดับได้");
    } finally {
      setSavingOrder(false);
    }
  }, [user?.id, selectedBranch, arrangeOrder]);

  const resetOrder = useCallback(async () => {
    if (!user?.id || !selectedBranch) return;
    await supabase.from("user_sort_preferences").delete().eq("user_id", user.id).eq("branch_id", selectedBranch);
    setCustomSkuOrder(null);
    toast.success("รีเซ็ตเป็นลำดับเริ่มต้นแล้ว");
  }, [user?.id, selectedBranch]);

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setArrangeOrder((prev) => {
        const oldIndex = prev.indexOf(active.id as string);
        const newIndex = prev.indexOf(over.id as string);
        return arrayMove(prev, oldIndex, newIndex);
      });
    }
  }, []);

  const canArrange = (isManagement || isStoreManager) && !!selectedBranch;

  const thClass = "px-2 py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground whitespace-nowrap";

  // Sortable header helper
  const renderSortableHeader = (key: SortKey, label: string, extraClass = "") => {
    const isActive = sortKey === key;
    const disabled = arrangeMode || !!customSkuOrder;
    const Icon = isActive && !customSkuOrder ? (sortDir === "asc" ? ChevronUp : ChevronDown) : null;
    return (
      <span
        className={`inline-flex items-center select-none ${disabled ? "text-muted-foreground/50 cursor-default" : "cursor-pointer"} ${isActive && !disabled ? "text-foreground" : "text-muted-foreground"} ${extraClass}`}
        onClick={() => !disabled && handleSort(key)}
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
            <Button variant="outline" onClick={handleGenerate} disabled={!selectedBranch || generating}>
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
            {canArrange && !arrangeMode && (
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={enterArrangeMode} disabled={!selectedBranch}>
                  <GripVertical className="w-4 h-4" /> จัดลำดับแถว
                </Button>
                {customSkuOrder && (
                  <>
                    <Badge variant="outline" className="bg-warning/10 text-warning border-warning/30 text-xs">
                      ลำดับกำหนดเอง
                    </Badge>
                    <button
                      type="button"
                      onClick={resetOrder}
                      className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline transition-colors"
                    >
                      รีเซ็ตลำดับ
                    </button>
                  </>
            )}
            {rows.length > 0 && !arrangeMode && (
              <Button variant="outline" onClick={() => setPrintModalOpen(true)}>
                <Printer className="w-4 h-4" /> พิมพ์ใบนับ
              </Button>
            )}
              </div>
            )}
            {rows.length > 0 && !isSubmitted && !arrangeMode && (
              <Button
                onClick={handleSubmit}
                disabled={!hasAnyPhysicalCount}
                className="gap-2 bg-warning hover:bg-warning/90 text-warning-foreground"
              >
                <Lock className="w-4 h-4" /> {t("btn.submitCount")}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Submitted banner */}
      {isSubmitted && !arrangeMode && (
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

      {/* ── Arrange mode view ── */}
      {arrangeMode ? (
        <>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-auto max-h-[70vh]">
                <div className="px-4 py-2 border-b bg-muted/50">
                  <p className="text-xs text-muted-foreground">
                    ลากแถวเพื่อจัดลำดับ SKU ตามตำแหน่งในครัว · ลำดับนี้จะใช้กับทุกวันสำหรับสาขานี้
                  </p>
                </div>
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <table className="w-full table-fixed text-xs">
                    <colgroup>
                      <col style={{ width: 32 }} />
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
                        <th className={thClass}></th>
                        <th className={`${thClass} text-muted-foreground/50`}>{t("col.skuCode")}</th>
                        <th className={`${thClass} text-muted-foreground/50`}>{t("col.skuName")}</th>
                        <th className={`${thClass} text-muted-foreground/50`}>{t("col.type")}</th>
                        <th className={`${thClass} text-muted-foreground/50`}>{t("dsc.colUnit")}</th>
                        <th className={`${thClass} opacity-40`}>{t("col.opening")}</th>
                        <th className={`${thClass} opacity-40`}>{t("dsc.colReceived")}</th>
                        <th className={`${thClass} opacity-40`}>{t("col.expUsage")}</th>
                        <th className={`${thClass} opacity-40`}>{t("col.waste")}</th>
                        <th className={`${thClass} opacity-40`}>{t("col.calcBalance")}</th>
                        <th className={`${thClass} opacity-40`}>{t("col.physical")}</th>
                        <th className={`${thClass} opacity-40`}>{t("col.variance")}</th>
                      </tr>
                    </thead>
                    <SortableContext items={arrangeOrder} strategy={verticalListSortingStrategy}>
                      <tbody>
                        {arrangeOrder.map((skuId) => {
                          const sku = skuMap.get(skuId);
                          if (!sku) return null;
                          return <SortableArrangeRow key={skuId} skuId={skuId} sku={sku} />;
                        })}
                      </tbody>
                    </SortableContext>
                  </table>
                </DndContext>
              </div>
            </CardContent>
          </Card>

          {/* Floating action bar */}
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[80] flex items-center gap-3 bg-background border border-border rounded-lg shadow-lg px-5 py-3">
            <Button onClick={saveArrangeOrder} disabled={savingOrder} className="gap-2">
              {savingOrder && <Loader2 className="w-4 h-4 animate-spin" />}
              บันทึกลำดับ
            </Button>
            <Button variant="ghost" onClick={cancelArrangeMode} disabled={savingOrder}>
              ยกเลิก
            </Button>
          </div>
        </>
      ) : loading ? (
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
                        <div className="text-xs font-normal text-muted-foreground">{t("dsc.usageUomSuffix")}</div>
                      </th>
                      <th className={`text-right ${thClass}`}>
                        <div>{t("dsc.colReceived")}</div>
                        <div className="text-xs font-normal text-muted-foreground">{t("dsc.usageUomSuffix")}</div>
                      </th>
                      <th className={`text-right ${thClass}`}>
                        <div>{t("col.expUsage")}</div>
                        <div className="text-xs font-normal text-muted-foreground">{t("dsc.usageUomSuffix")}</div>
                      </th>
                      <th className={`text-right ${thClass}`}>
                        <div>{t("col.waste")}</div>
                        <div className="text-xs font-normal text-muted-foreground">{t("dsc.usageUomSuffix")}</div>
                      </th>
                      <th className={`text-right ${thClass}`}>
                        <div>{t("col.calcBalance")}</div>
                        <div className="text-xs font-normal text-muted-foreground">{t("dsc.usageUomSuffix")}</div>
                      </th>
                      <th className={`text-right ${thClass} !bg-foreground !text-background font-semibold`}>
                        <div>{t("col.physical")}</div>
                        <div className="text-xs font-normal opacity-60">{t("dsc.usageUomSuffix")}</div>
                      </th>
                      <th className={`text-right ${thClass}`}>
                        <div>{t("col.variance")}</div>
                        <div className="text-xs font-normal text-muted-foreground">{t("dsc.usageUomSuffix")}</div>
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
                              className={`inline-flex px-1.5 py-0.5 rounded text-xs font-semibold ${
                                sku.type === "RM"
                                  ? "bg-warning/15 text-warning"
                                  : sku.type === "SM"
                                    ? "bg-info/15 text-info"
                                    : sku.type === "SP"
                                      ? "bg-primary/15 text-primary"
                                      : "bg-muted text-muted-foreground"
                              }`}
                            >
                              {sku.type}
                            </span>
                          </td>
                          <td className="px-2 py-1 text-sm text-muted-foreground text-center">{sku.usageUom}</td>
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
                                className="h-8 text-xs w-[80px] font-mono text-right pr-2 text-right"
                                placeholder="0"
                                style={{ textAlign: "right" }}
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
                                className="h-8 text-xs w-[80px] font-mono text-right pr-2 text-right"
                                placeholder="0"
                                style={{ textAlign: "right" }}
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
                                className={`inline-flex px-1.5 py-0.5 rounded text-xs font-semibold ${
                                  sku.type === "RM" ? "bg-warning/15 text-warning" : "bg-info/15 text-info"
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

      {/* Print options modal */}
      <Dialog open={printModalOpen} onOpenChange={setPrintModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>พิมพ์ใบนับสต็อก</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setPrintScope("today")}
              className={`rounded-lg border-2 p-4 text-left transition-colors ${printScope === "today" ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/40"}`}
            >
              <div className="font-semibold text-sm">วันนี้</div>
              <div className="text-xs text-muted-foreground mt-1">เฉพาะ SKU ที่มีการเคลื่อนไหววันนี้</div>
              <Badge variant="secondary" className="mt-2 text-xs">{activeRows.length} รายการ</Badge>
            </button>
            <button
              type="button"
              onClick={() => setPrintScope("month")}
              className={`rounded-lg border-2 p-4 text-left transition-colors ${printScope === "month" ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/40"}`}
            >
              <div className="font-semibold text-sm">สิ้นเดือน</div>
              <div className="text-xs text-muted-foreground mt-1">ทุก SKU ที่มีการเคลื่อนไหวในเดือนนี้</div>
              <Badge variant="secondary" className="mt-2 text-xs">{activeRows.length + unusedRows.length} รายการ</Badge>
            </button>
          </div>
          <Button
            className="w-full mt-2"
            onClick={() => {
              setPrintModalOpen(false);
              setTimeout(() => window.print(), 300);
            }}
          >
            <Printer className="w-4 h-4" /> พิมพ์
          </Button>
        </DialogContent>
      </Dialog>

      {/* ── Print-only layout ── */}
      <div className="print-stock-sheet hidden print:block">
        <div className="print-header">
          <div className="print-header-row">
            <span className="print-branch">{branches.find(b => b.id === selectedBranch)?.branchName ?? ""}</span>
            <span className="print-date">
              วันที่: {selectedDate ? `${selectedDate.slice(8, 10)}/${selectedDate.slice(5, 7)}/${selectedDate.slice(0, 4)}` : ""}
            </span>
          </div>
          <div className="print-title">
            {printScope === "today" ? "ใบนับสต็อกประจำวัน" : "ใบนับสต็อกสิ้นเดือน"}
          </div>
          <div className="print-meta">
            พิมพ์เมื่อ: {new Date().toLocaleString("th-TH")}
          </div>
        </div>
        <table className="print-table">
          <thead>
            <tr>
              <th style={{ width: "var(--col-sku)" }}>รหัส SKU</th>
              <th style={{ width: "var(--col-name)" }}>ชื่อ SKU</th>
              <th style={{ width: "var(--col-type)" }}>ประเภท</th>
              <th style={{ width: "var(--col-unit)" }}>หน่วย</th>
              <th style={{ width: "var(--col-balance)" }}>คงเหลือ</th>
              <th style={{ width: "var(--col-waste)" }}>ของเสีย</th>
              <th style={{ width: "var(--col-count)" }}>นับจริง</th>
            </tr>
          </thead>
          <tbody>
            {(printScope === "today" ? activeRows : [...activeRows, ...unusedRows]).map((row, idx) => {
              const sku = skuMap.get(row.skuId);
              if (!sku) return null;
              return (
                <tr key={row.id} className={idx % 2 === 1 ? "alt-row" : ""}>
                  <td className="mono">{sku.skuId}</td>
                  <td>{sku.name}</td>
                  <td className="center">{sku.type}</td>
                  <td className="center">{sku.usageUom}</td>
                  <td className="right">{Math.round(Math.max(0, row.calculatedBalance))}</td>
                  <td><div className="write-box" /></td>
                  <td><div className="write-box" /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
