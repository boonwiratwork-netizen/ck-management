import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { SKU } from "@/types/sku";
import { BOMStep } from "@/types/bom";
import { BomByproduct } from "@/types/byproduct";
import { BOMHeader, BOMLine } from "@/types/bom";
import { ProductionPlan, ProductionRecord, PlanStatus, EMPTY_PRODUCTION_RECORD } from "@/types/production";
import { StockBalance } from "@/types/stock";
import { SMStockBalance } from "@/hooks/use-sm-stock-data";
import { MenuBomLine } from "@/types/menu-bom";
import { Menu } from "@/types/menu";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Badge } from "@/components/ui/badge";
import { StatusDot } from "@/components/ui/status-dot";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ChevronLeft, ChevronRight, Save, ChevronDown, Trash2, Pencil, CalendarDays, PlayCircle, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn, toLocalDateStr } from "@/lib/utils";
import { useLanguage } from "@/hooks/use-language";
import { useAuth } from "@/hooks/use-auth";
import { useNavigate } from "react-router-dom";
import { table, buttons, progressBar } from "@/lib/design-tokens";
import { usePlanningAgent } from "@/hooks/use-planning-agent";
import { PlanningAgentPanel } from "@/components/PlanningAgentPanel";


interface ProductionPageProps {
  productionData: {
    plans: ProductionPlan[];
    records: ProductionRecord[];
    addPlan: (data: {
      smSkuId: string;
      targetQtyKg: number;
      status: PlanStatus;
      weekDate: string;
    }) => string | Promise<string>;
    updatePlan: (
      id: string,
      data: Partial<{ smSkuId: string; targetQtyKg: number; status: PlanStatus; weekDate: string }>,
    ) => void | Promise<void>;
    deletePlan: (id: string) => void | Promise<void>;
    addRecord: (
      data: Omit<ProductionRecord, "id" | "smSkuId"> & { smSkuId?: string },
    ) => string | undefined | Promise<string | undefined>;
    updateRecord: (
      id: string,
      data: { productionDate: string; actualOutputG: number; batchesProduced: number },
    ) => void | Promise<void>;
    deleteRecord: (id: string) => void | Promise<void>;
    getRecordsForPlan: (planId: string) => ProductionRecord[];
    getTotalProducedForPlan: (planId: string) => number;
    getOutputPerBatch: (smSkuId: string) => number;
  };
  skus: SKU[];
  bomHeaders: BOMHeader[];
  stockBalances: StockBalance[];
  bomLines: BOMLine[];
  bomSteps: BOMStep[];
  smStockBalances: SMStockBalance[];
  isStockDataReady: boolean;
  menuBomLines: MenuBomLine[];
  menus: Menu[];
  bomByproducts: BomByproduct[];
  refreshProductionRecords?: () => Promise<void>;
}

/* ─── Week helpers ─── */
function getSmartWeekStart(): string {
  const today = new Date();
  const day = today.getDay();
  if (day === 5 || day === 6) {
    const nextMon = new Date(today);
    nextMon.setDate(today.getDate() + (8 - day));
    return toLocalDateStr(nextMon);
  }
  const diff = day === 0 ? -6 : 1 - day;
  const mon = new Date(today);
  mon.setDate(today.getDate() + diff);
  return toLocalDateStr(mon);
}

function getWeekEndDate(ws: string): string {
  const d = new Date(ws);
  d.setDate(d.getDate() + 6);
  return toLocalDateStr(d);
}

function getISOWeekNumber(dateStr: string): number {
  const date = new Date(dateStr);
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function getCurrentWeekMonday(): string {
  const today = new Date();
  const day = today.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const mon = new Date(today);
  mon.setDate(today.getDate() + diff);
  return toLocalDateStr(mon);
}

function getNextWeekMonday(): string {
  const d = new Date(getCurrentWeekMonday());
  d.setDate(d.getDate() + 7);
  return toLocalDateStr(d);
}

/* ─── Number formatting helpers ─── */
const fmtG = (v: number) => Math.round(v).toLocaleString();
const fmtDays = (v: number) => v.toFixed(1);

/* ─── Row types ─── */
interface PlanRow {
  sku: SKU;
  hasBom: boolean;
  forecastWeek: number;
  dailyNeed: number;
  stockNow: number;
  target: number;
  coverNow: number;
  produceTarget: number;
  suggestedBatches: number;
  plannedBatches: number;
  outputPerBatch: number;
  planG: number;
  stockAfter: number;
  coverAfter: number;
  coverNowColor: "red" | "amber" | "green";
  coverAfterColor: "red" | "amber" | "green";
  producedG: number;
}

function getCoverColor(cover: number, target: number, dailyNeed: number): "red" | "amber" | "green" {
  if (dailyNeed <= 0) return "green";
  if (cover < target * 0.5) return "red";
  if (cover < target) return "amber";
  return "green";
}

export default function ProductionPage({
  productionData,
  skus,
  bomHeaders,
  stockBalances,
  bomLines,
  bomSteps,
  smStockBalances,
  isStockDataReady,
  menuBomLines,
  menus,
  bomByproducts,
  refreshProductionRecords,
}: ProductionPageProps) {
  const { addRecord, updateRecord, deleteRecord, getOutputPerBatch, records } = productionData;
  const { t } = useLanguage();
  const { isManagement } = useAuth();
  const navigate = useNavigate();

  const [weekStart, setWeekStart] = useState(getSmartWeekStart);
  const [globalTarget, setGlobalTarget] = useState(7);
  const [planBatches, setPlanBatches] = useState<Record<string, number>>({});
  const [skuTargets, setSkuTargets] = useState<Record<string, number>>({});
  const [salesData, setSalesData] = useState<{ menuCode: string; qty: number }[]>([]);
  const [saving, setSaving] = useState(false);
  const [loadedWeek, setLoadedWeek] = useState<string | null>(null);
  const [mode, setMode] = useState<"planning" | "recording">("planning");
  const [planLocked, setPlanLocked] = useState(false);
  const [savedWeek, setSavedWeek] = useState<number | null>(null);
  const [suggestedInitialized, setSuggestedInitialized] = useState(false);

  // 2A — showUnplanned state
  const [showUnplanned, setShowUnplanned] = useState(false);

  // Record modal
  const [recordModalOpen, setRecordModalOpen] = useState(false);
  const [recordSkuId, setRecordSkuId] = useState<string | null>(null);
  const [recordForm, setRecordForm] = useState({
    productionDate: toLocalDateStr(new Date()),
    actualOutputG: 0,
    notes: "",
  });
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null);

  // Dialogs
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);
  const [criticalWarning, setCriticalWarning] = useState<number | null>(null);

  // Collapsibles
  const [noBomOpen, setNoBomOpen] = useState(false);

  // Planning Agent
  const [agentOpen, setAgentOpen] = useState(false);
  const planningAgent = usePlanningAgent({
    smStockBalances: smStockBalances.map(s => ({ skuId: s.skuId, currentStock: s.currentStock })),
    getOutputPerBatch,
  });

  const planInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const smSkus = useMemo(() => skus.filter((s) => s.type === "SM" && s.status === "Active"), [skus]);
  const weekEnd = getWeekEndDate(weekStart);
  const weekNumber = getISOWeekNumber(weekStart);

  // ─── Mode toggle with week defaulting ───
  const handleModeSwitch = (newMode: "planning" | "recording") => {
    const newWeek = newMode === "planning" ? getNextWeekMonday() : getCurrentWeekMonday();
    setMode(newMode);
    setWeekStart(newWeek);
  };

  // ─── Data fetching ───
  useEffect(() => {
    supabase
      .from("global_settings" as any)
      .select("*")
      .eq("key", "cover_days_target")
      .single()
      .then(({ data }: any) => {
        if (data) setGlobalTarget(Number(data.value) || 7);
      });
  }, []);

  useEffect(() => {
    supabase
      .from("skus")
      .select("id, cover_days_target" as any)
      .not("cover_days_target", "is", null)
      .then(({ data }: any) => {
        if (data) {
          const map: Record<string, number> = {};
          data.forEach((r: any) => {
            if (r.cover_days_target != null) map[r.id] = Number(r.cover_days_target);
          });
          setSkuTargets(map);
        }
      });
  }, []);

  useEffect(() => {
    const today = new Date();
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(today.getDate() - 7);
    supabase
      .from("sales_entries")
      .select("menu_code, qty")
      .gte("sale_date", toLocalDateStr(sevenDaysAgo))
      .lte("sale_date", toLocalDateStr(today))
      .then(({ data }) => {
        if (data) setSalesData(data.map((r: any) => ({ menuCode: r.menu_code, qty: Number(r.qty) })));
      });
  }, []);

  // Fetch saved plan for week — 2A: reset showUnplanned
  useEffect(() => {
    setPlanLocked(false);
    setSavedWeek(null);
    setSuggestedInitialized(false);
    setShowUnplanned(false);
    supabase
      .from("weekly_plan_lines" as any)
      .select("*")
      .eq("week_start", weekStart)
      .then(({ data }: any) => {
        const map: Record<string, number> = {};
        if (data && data.length > 0) {
          (data as any[]).forEach((r) => {
            map[r.sku_id] = Number(r.planned_batches);
          });
          setPlanLocked(true);
          setSavedWeek(getISOWeekNumber(weekStart));
        }
        setPlanBatches(map);
        setLoadedWeek(weekStart);
      });
  }, [weekStart]);

  // ─── Forecast calculation (unchanged logic) ───
  const directForecast = useMemo(() => {
    const menuCodeToId = new Map(menus.map((m) => [m.menuCode, m.id]));
    const smSkuIds = new Set(smSkus.map((s) => s.id));
    const usage: Record<string, number> = {};
    salesData.forEach((sale) => {
      const menuId = menuCodeToId.get(sale.menuCode);
      if (!menuId) return;
      menuBomLines
        .filter((l) => l.menuId === menuId && smSkuIds.has(l.skuId))
        .forEach((line) => {
          usage[line.skuId] = (usage[line.skuId] || 0) + line.effectiveQty * sale.qty;
        });
    });
    return usage;
  }, [salesData, menus, menuBomLines, smSkus]);

  const { totalForecast } = useMemo(() => {
    const smSkuIds = new Set(smSkus.map((s) => s.id));
    const parentChildMap = new Map<string, { childSmId: string; qtyPerBatch: number }[]>();

    bomHeaders.forEach((header) => {
      if (!smSkuIds.has(header.smSkuId)) return;
      bomLines
        .filter((l) => l.bomHeaderId === header.id)
        .forEach((line) => {
          if (smSkuIds.has(line.rmSkuId)) {
            const existing = parentChildMap.get(header.smSkuId) || [];
            existing.push({ childSmId: line.rmSkuId, qtyPerBatch: line.qtyPerBatch });
            parentChildMap.set(header.smSkuId, existing);
          }
        });
    });

    const indirect: Record<string, number> = {};
    const visited = new Set<string>();

    const computeIndirect = (parentId: string, parentWeeklyForecast: number, depth: number) => {
      if (depth > 3 || visited.has(parentId)) return;
      visited.add(parentId);
      const children = parentChildMap.get(parentId) || [];
      const outputPerBatch = getOutputPerBatch(parentId);
      if (outputPerBatch <= 0) {
        visited.delete(parentId);
        return;
      }
      const batchesNeeded = parentWeeklyForecast / outputPerBatch;
      children.forEach(({ childSmId, qtyPerBatch }) => {
        const childDemand = batchesNeeded * qtyPerBatch;
        indirect[childSmId] = (indirect[childSmId] || 0) + childDemand;
        computeIndirect(childSmId, childDemand, depth + 1);
      });
      visited.delete(parentId);
    };

    smSkus.forEach((sku) => {
      const direct = directForecast[sku.id] || 0;
      if (direct > 0) computeIndirect(sku.id, direct, 0);
    });

    const total: Record<string, number> = {};
    smSkus.forEach((sku) => {
      total[sku.id] = (directForecast[sku.id] || 0) + (indirect[sku.id] || 0);
    });

    return { totalForecast: total };
  }, [directForecast, smSkus, bomHeaders, bomLines, getOutputPerBatch]);

  // Production records for selected week per SKU
  const weekRecordsBySku = useMemo(() => {
    const map: Record<string, number> = {};
    records.forEach((r) => {
      if (r.productionDate >= weekStart && r.productionDate <= weekEnd) {
        map[r.smSkuId] = (map[r.smSkuId] || 0) + r.actualOutputG;
      }
    });
    return map;
  }, [records, weekStart, weekEnd]);

  const weekRecords = useMemo(() => {
    return records
      .filter((r) => r.productionDate >= weekStart && r.productionDate <= weekEnd)
      .sort((a, b) => b.productionDate.localeCompare(a.productionDate));
  }, [records, weekStart, weekEnd]);

  // ─── Build rows with CORRECT formulas ───
  const rows = useMemo((): PlanRow[] => {
    return smSkus
      .map((sku) => {
        const hasBom = bomHeaders.some((h) => h.smSkuId === sku.id);
        const forecastWeek = totalForecast[sku.id] || 0;
        const dailyNeed = forecastWeek / 7;
        const stockNow = smStockBalances.find((b) => b.skuId === sku.id)?.currentStock ?? 0;
        const target = skuTargets[sku.id] ?? globalTarget;
        const outputPerBatch = getOutputPerBatch(sku.id);
        const producedG = weekRecordsBySku[sku.id] || 0;

        const coverNow = dailyNeed > 0 ? stockNow / dailyNeed : Infinity;
        const produceTarget = dailyNeed > 0 ? Math.max(0, dailyNeed * target - stockNow) : 0;
        const suggestedBatches =
          outputPerBatch > 0 && produceTarget > 0 ? Math.ceil(produceTarget / outputPerBatch) : 0;
        const plannedBatches = planBatches[sku.id] ?? 0;
        const planG = plannedBatches * outputPerBatch;
        const stockAfter = stockNow + planG;
        const coverAfter = dailyNeed > 0 ? stockAfter / dailyNeed : Infinity;
        const coverNowColor = getCoverColor(coverNow, target, dailyNeed);

        return {
          sku,
          hasBom,
          forecastWeek,
          dailyNeed,
          stockNow,
          target,
          coverNow,
          produceTarget,
          suggestedBatches,
          plannedBatches,
          outputPerBatch,
          planG,
          stockAfter,
          coverAfter,
          coverNowColor,
          coverAfterColor: getCoverColor(coverAfter, target, dailyNeed),
          producedG,
        };
      })
      .sort((a, b) => a.sku.skuId.localeCompare(b.sku.skuId));
  }, [
    smSkus,
    bomHeaders,
    totalForecast,
    smStockBalances,
    planBatches,
    skuTargets,
    globalTarget,
    getOutputPerBatch,
    weekRecordsBySku,
  ]);

  const bomRows = useMemo(() => rows.filter((r) => r.hasBom), [rows]);
  const noBomRows = useMemo(() => rows.filter((r) => !r.hasBom), [rows]);

  // 2C — Plan-aware displayed rows for Planning table
  const displayedBomRows = useMemo(() => {
    if (!planLocked) return bomRows;
    return bomRows.filter((r) => (planBatches[r.sku.id] ?? 0) > 0 || (weekRecordsBySku[r.sku.id] ?? 0) > 0);
  }, [bomRows, planLocked, planBatches, weekRecordsBySku]);

  // 1E — Recording rows: stable sort by SKU code only, with plan-aware filtering
  const recordingRows = useMemo(() => {
    const inScope = (r: PlanRow) =>
      !planLocked || (planBatches[r.sku.id] ?? 0) > 0 || (weekRecordsBySku[r.sku.id] ?? 0) > 0;
    return [...rows].filter((r) => r.hasBom && inScope(r)).sort((a, b) => a.sku.skuId.localeCompare(b.sku.skuId));
  }, [rows, planLocked, planBatches, weekRecordsBySku]);

  // 2B — Unplanned rows for expandable section
  const unplannedRows = useMemo(() => {
    if (!planLocked) return [];
    return [...rows]
      .filter((r) => r.hasBom && (planBatches[r.sku.id] ?? 0) === 0 && (weekRecordsBySku[r.sku.id] ?? 0) === 0)
      .sort((a, b) => a.sku.skuId.localeCompare(b.sku.skuId));
  }, [rows, planLocked, planBatches, weekRecordsBySku]);

  // ─── Handlers ───
  const prevWeek = () => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() - 7);
    setWeekStart(toLocalDateStr(d));
  };
  const nextWeek = () => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 7);
    setWeekStart(toLocalDateStr(d));
  };

  const handlePlanChange = useCallback((skuId: string, val: string) => {
    setPlanBatches((prev) => ({ ...prev, [skuId]: Number(val) || 0 }));
  }, []);

  const handlePlanKeyDown = (e: React.KeyboardEvent, skuId: string) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const currentRows = planLocked ? displayedBomRows : bomRows;
      const idx = currentRows.findIndex((r) => r.sku.id === skuId);
      const next = e.shiftKey ? idx - 1 : idx + 1;
      if (next >= 0 && next < currentRows.length) {
        planInputRefs.current[currentRows[next].sku.id]?.focus();
      }
    }
  };

  const saveGlobalTarget = async (value: number) => {
    setGlobalTarget(value);
    if (!planLocked) {
      setSuggestedInitialized(false);
      setPlanBatches({});
    }
    await supabase
      .from("global_settings" as any)
      .update({ value: String(value) } as any)
      .eq("key", "cover_days_target");
  };

  // Save plan
  const doSavePlan = async () => {
    setSaving(true);
    const planRows = smSkus
      .filter((s) => (planBatches[s.id] || 0) > 0)
      .map((s) => ({
        week_start: weekStart,
        sku_id: s.id,
        planned_batches: planBatches[s.id] || 0,
      }));
    await supabase
      .from("weekly_plan_lines" as any)
      .delete()
      .eq("week_start", weekStart);
    if (planRows.length > 0) {
      const { error } = await supabase.from("weekly_plan_lines" as any).insert(planRows as any);
      if (error) {
        toast.error("Failed to save: " + error.message);
        setSaving(false);
        return;
      }
    }
    setPlanLocked(true);
    setSavedWeek(weekNumber);
    toast.success(t("prod.planSaved") + " " + weekNumber + " " + t("prod.planSavedSuffix"));
    setSaving(false);
  };

  const handleSavePlan = () => {
    const criticalCount = bomRows.filter((r) => r.coverAfterColor === "red" && r.plannedBatches === 0).length;
    if (criticalCount > 0) {
      setCriticalWarning(criticalCount);
      return;
    }
    doSavePlan();
  };

  const unlockPlan = () => {
    setPlanLocked(false);
    setSavedWeek(null);
  };

  // Record modal
  const openRecordModal = (skuId: string) => {
    const row = rows.find((r) => r.sku.id === skuId);
    const remaining = row ? Math.max(0, Math.round(row.planG - row.producedG)) : 0;
    setRecordSkuId(skuId);
    setRecordForm({ productionDate: toLocalDateStr(new Date()), actualOutputG: remaining, notes: "" });
    setEditingRecordId(null);
    setRecordModalOpen(true);
  };

  const openEditRecordModal = (record: ProductionRecord) => {
    setRecordSkuId(record.smSkuId);
    setRecordForm({ productionDate: record.productionDate, actualOutputG: record.actualOutputG, notes: "" });
    setEditingRecordId(record.id);
    setRecordModalOpen(true);
  };

  // Single-confirm save record
  const doSaveRecord = async () => {
    if (!recordSkuId) return;
    if (recordForm.actualOutputG <= 0) {
      toast.error("Enter actual output");
      return;
    }

    setSaving(true);
    const outputPerBatch = getOutputPerBatch(recordSkuId);
    const batchesProduced = outputPerBatch > 0 ? Math.round(recordForm.actualOutputG / outputPerBatch) : 0;

    if (editingRecordId) {
      await updateRecord(editingRecordId, {
        productionDate: recordForm.productionDate,
        actualOutputG: recordForm.actualOutputG,
        batchesProduced,
      });
      toast.success(t("prod.recordUpdated"));
      setRecordModalOpen(false);
      setEditingRecordId(null);
      setSaving(false);
      return;
    }

    let plan = productionData.plans.find((p) => p.smSkuId === recordSkuId && p.weekStartDate === weekStart);
    let planId = plan?.id;

    if (!planId) {
      const result = await productionData.addPlan({
        smSkuId: recordSkuId,
        targetQtyKg: 0,
        status: "In Progress",
        weekDate: weekStart,
      });
      planId = typeof result === "string" ? result : "";
    }
    if (!planId) {
      toast.error("Failed to create plan");
      return;
    }

    await addRecord({
      ...EMPTY_PRODUCTION_RECORD,
      planId,
      smSkuId: recordSkuId,
      productionDate: recordForm.productionDate,
      batchesProduced,
      actualOutputG: recordForm.actualOutputG,
    });
    if (refreshProductionRecords) refreshProductionRecords();
    toast.success(t("prod.recordSaved"));
    setRecordModalOpen(false);
    setSaving(false);
  };

  const handleDeleteRecordConfirm = () => {
    if (!deleteConfirm) return;
    deleteRecord(deleteConfirm.id);
    toast.success("Record deleted");
    setDeleteConfirm(null);
  };

  // ─── Helpers ───
  const formatDate = (d: string) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const getSkuName = (id: string) => skus.find((s) => s.id === id)?.name ?? "—";
  const getSkuCode = (id: string) => skus.find((s) => s.id === id)?.skuId ?? "";
  const getSkuUom = (id: string) => skus.find((s) => s.id === id)?.usageUom ?? "g";

  const recordSku = recordSkuId ? skus.find((s) => s.id === recordSkuId) : null;
  const recordRow = recordSkuId ? rows.find((r) => r.sku.id === recordSkuId) : null;

  // FIX 2 — Simplified cover display: pure number with color only
  const coverDisplayFn = (cover: number, color: "red" | "amber" | "green", dailyNeed: number) => {
    if (dailyNeed <= 0) return <span className="text-muted-foreground">—</span>;
    const colorClass = color === "red" ? "text-destructive" : color === "amber" ? "text-warning" : "text-success";
    return <span className={cn("font-mono text-xs font-semibold tabular-nums", colorClass)}>{fmtDays(cover)}</span>;
  };

  return (
    <TooltipProvider>
      <div className="space-y-3">
        {/* ═══ PAGE HEADER ═══ */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          {/* Left: title */}
          <div className="min-w-0">
            <h2 className="text-2xl font-heading font-bold">{t("prod.title")}</h2>
            <p className="text-sm text-muted-foreground mt-0.5">{t("prod.subtitle")}</p>
          </div>

          {/* Center: week selector */}
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={prevWeek}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold whitespace-nowrap min-w-[220px] text-center">
                Week {weekNumber} · {formatDate(weekStart)} – {formatDate(weekEnd)}
              </span>
              {(() => {
                const curMon = getCurrentWeekMonday();
                const nextMon = getNextWeekMonday();
                if (weekStart === curMon)
                  return (
                    <Badge
                      variant="outline"
                      className="text-xs text-success border-success/30 bg-success/5 whitespace-nowrap"
                    >
                      {t("prod.thisWeek")}
                    </Badge>
                  );
                if (weekStart === nextMon)
                  return (
                    <Badge
                      variant="outline"
                      className="text-xs text-warning border-warning/30 bg-warning/5 whitespace-nowrap"
                    >
                      {t("prod.nextWeek")}
                    </Badge>
                  );
                return null;
              })()}
              {planLocked && savedWeek === weekNumber && (
                <Badge
                  variant="outline"
                  className="text-xs text-success border-success/30 bg-success/5 whitespace-nowrap"
                >
                  ✓ {t("prod.savedBadge")}
                </Badge>
              )}
            </div>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={nextWeek}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>

          {/* Right: target + mode toggle + save/edit (fixed-width container) */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-muted-foreground whitespace-nowrap">{t("prod.targetCoverDays")}</label>
              <input
                type="number"
                className="h-8 w-14 text-sm text-right font-mono px-1.5 border rounded-md bg-background"
                defaultValue={globalTarget}
                key={`gt-${globalTarget}`}
                onBlur={(e) => saveGlobalTarget(Number(e.target.value) || 7)}
                onFocus={(e) => e.target.select()}
              />
            </div>

            {/* Mode toggle in page header */}
            <div className={buttons.modeToggleWrapper}>
              <button
                className={mode === "planning" ? buttons.modeToggleActive : buttons.modeToggleInactive}
                onClick={() => handleModeSwitch("planning")}
              >
                <CalendarDays className="w-3.5 h-3.5 mr-1.5 inline" /> Planning
              </button>
              <button
                className={mode === "recording" ? buttons.modeToggleActive : buttons.modeToggleInactive}
                onClick={() => handleModeSwitch("recording")}
              >
                <PlayCircle className="w-3.5 h-3.5 mr-1.5 inline" /> Recording
              </button>
            </div>

            {/* Fixed-width container to prevent reflow */}
            <div className="w-28 flex justify-end">
              {mode === "planning" && !planLocked && (
                <Button onClick={handleSavePlan} disabled={saving || !isStockDataReady} size="sm" className="h-8">
                  <Save className="w-3.5 h-3.5 mr-1" />
                  {saving ? t("prod.saving") : t("prod.savePlan")}
                </Button>
              )}
              {mode === "planning" && planLocked && (
                <Button variant="outline" size="sm" className="h-8 text-xs" onClick={unlockPlan}>
                  {t("prod.editPlan")}
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* ═══ PLANNING MODE ═══ */}
        {mode === "planning" && loadedWeek === weekStart && (
          <>
            <div className={table.wrapper}>
              <table className={table.base}>
                {/* 1A — Planning colgroup (11 cols), Name=220px */}
                <colgroup>
                  <col style={{ width: "28px" }} />
                  <col style={{ width: "72px" }} />
                  <col style={{ width: "220px" }} />
                  <col style={{ width: "48px" }} />
                  <col style={{ width: "68px" }} />
                  <col style={{ width: "85px" }} />
                  <col style={{ width: "68px" }} />
                  <col style={{ width: "78px" }} />
                  <col style={{ width: "85px" }} />
                  <col style={{ width: "85px" }} />
                  <col style={{ width: "85px" }} />
                </colgroup>
                <thead className="sticky top-0 z-[5]">
                  <tr className={table.headerRow}>
                    <th className={table.headerCellCenter}></th>
                    <th className={table.headerCell}>{t("prod.colCode")}</th>
                    <th className={table.headerCell}>{t("prod.colName")}</th>
                    {/* 1C — UOM header centered */}
                    <th className={table.headerCellCenter}>UOM</th>
                    <th className={table.headerCellNumeric}>g/batch</th>
                    <th className={table.headerCellNumeric}>{t("prod.colStockNow")}</th>
                    <th className={table.headerCellNumeric}>SUGGEST</th>
                    <th className="px-2 py-2 text-xs font-medium uppercase tracking-wide text-center bg-primary/5 border-x border-primary/20 font-semibold text-primary">
                      {t("prod.colPlanBatch")}
                    </th>
                    <th className={table.headerCellNumeric}>{t("prod.colPlanG")}</th>
                    <th className={table.headerCellNumeric}>COVER DAY NOW</th>
                    <th className={table.headerCellNumeric}>COVER DAY AFTER</th>
                  </tr>
                </thead>
                <tbody>
                  {/* 2C — Use displayedBomRows instead of bomRows */}
                  {displayedBomRows.map((row) => {
                    const isSufficient = row.produceTarget === 0;

                    // FIX 6 — Status dot: use coverAfterColor only when CK manager explicitly entered a value
                    const hasExplicitPlan = planBatches[row.sku.id] !== undefined && planBatches[row.sku.id] > 0;
                    const dotColor = hasExplicitPlan ? row.coverAfterColor : row.coverNowColor;

                    const borderClass = hasExplicitPlan
                      ? row.coverAfterColor === "green"
                        ? table.productionRowDone
                        : table.productionRowInProgress
                      : "";

                    // 2C — Ad-hoc produced row (weekRecordsBySku > 0 but not planned)
                    const isAdHoc =
                      planLocked && (planBatches[row.sku.id] ?? 0) === 0 && (weekRecordsBySku[row.sku.id] ?? 0) > 0;

                    return (
                      <tr
                        key={row.sku.id}
                        className={cn(
                          table.dataRow,
                          isAdHoc ? table.dataRowLocked : "",
                          isSufficient && !isAdHoc && "opacity-60",
                          !isAdHoc && borderClass,
                        )}
                      >
                        {/* STATUS DOT */}
                        <td className={table.dataCellCompactCenter}>
                          <StatusDot status={dotColor} />
                        </td>

                        {/* CODE */}
                        <td className={cn(table.dataCellCompact, "font-mono truncate")}>{row.sku.skuId}</td>

                        {/* NAME */}
                        <td className={table.truncatedCellCompact}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="truncate block">
                                {row.sku.name}
                                {isAdHoc && (
                                  <Badge
                                    variant="secondary"
                                    className="ml-1.5 text-[10px] px-1.5 py-0 font-normal text-muted-foreground"
                                  >
                                    Ad-hoc
                                  </Badge>
                                )}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-xs">
                              <p>{row.sku.name}</p>
                            </TooltipContent>
                          </Tooltip>
                        </td>

                        {/* 1C — UOM centered */}
                        <td className={table.dataCellCompactCenter}>
                          <span className="text-xs font-medium text-primary">{row.sku.usageUom || "g"}</span>
                        </td>

                        {/* g/BATCH */}
                        <td className={table.dataCellCompactMono}>
                          {row.outputPerBatch > 0 ? fmtG(row.outputPerBatch) : "—"}
                        </td>

                        {/* STOCK NOW — pure number */}
                        <td className={table.dataCellCompactMono}>{fmtG(row.stockNow)}</td>

                        {/* SUGGEST */}
                        <td className={table.dataCellCompactMono}>
                          <span className="text-muted-foreground">
                            {row.suggestedBatches > 0 ? row.suggestedBatches : "—"}
                          </span>
                        </td>

                        {/* PLAN (batches) - PRIMARY INPUT */}
                        <td className="px-0.5 py-0.5 bg-background border-x border-primary/10">
                          {isAdHoc ? (
                            <div className="h-8 flex items-center justify-center font-mono text-muted-foreground">
                              —
                            </div>
                          ) : !isStockDataReady && !planLocked ? (
                            <div className="h-8 flex items-center justify-center text-muted-foreground font-mono text-sm">
                              ...
                            </div>
                          ) : planLocked ? (
                            <div className="h-8 flex items-center justify-center font-semibold font-mono">
                              {row.plannedBatches || "—"}
                            </div>
                          ) : (
                            <input
                              ref={(el) => {
                                planInputRefs.current[row.sku.id] = el;
                              }}
                              type="number"
                              className="h-8 w-full text-sm text-center font-semibold font-mono border-2 border-primary/30 rounded bg-background focus:border-primary focus:ring-1 focus:ring-primary/50 outline-none"
                              defaultValue={planBatches[row.sku.id] > 0 ? planBatches[row.sku.id] : ""}
                              key={`${row.sku.id}-${weekStart}-${planLocked}-${globalTarget}`}
                              onBlur={(e) => handlePlanChange(row.sku.id, e.target.value)}
                              onFocus={(e) => e.target.select()}
                              onKeyDown={(e) => handlePlanKeyDown(e, row.sku.id)}
                              min={0}
                            />
                          )}
                        </td>

                        {/* PLAN (g) — pure number */}
                        <td className={cn(table.dataCellCompactMono, "text-muted-foreground")}>
                          {row.planG > 0 ? fmtG(row.planG) : "—"}
                        </td>

                        {/* COVER DAY NOW */}
                        <td className={table.dataCellCompactMono}>
                          {coverDisplayFn(row.coverNow, row.coverNowColor, row.dailyNeed)}
                        </td>

                        {/* COVER DAY AFTER */}
                        <td className={table.dataCellCompactMono}>
                          {coverDisplayFn(row.coverAfter, row.coverAfterColor, row.dailyNeed)}
                        </td>
                      </tr>
                    );
                  })}

                  {displayedBomRows.length === 0 && (
                    <tr>
                      <td colSpan={10} className={table.emptyState}>
                        No active SM SKUs with BOM found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* No BOM section */}
            {noBomRows.length > 0 && (
              <Collapsible open={noBomOpen} onOpenChange={setNoBomOpen}>
                <CollapsibleTrigger asChild>
                  <button className="flex items-center gap-2 text-sm font-medium text-warning hover:text-foreground transition-colors w-full py-2">
                    <ChevronDown className={cn("w-4 h-4 transition-transform", noBomOpen && "rotate-180")} />
                    <StatusDot status="amber" size="sm" className="mr-1" />
                    {noBomRows.length} {t("prod.noBomItems")}
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className={table.wrapper}>
                    <table className={table.base}>
                      <colgroup>
                        <col style={{ width: "100px" }} />
                        <col style={{ width: "250px" }} />
                        <col style={{ width: "120px" }} />
                      </colgroup>
                      <thead>
                        <tr className={table.headerRow}>
                          <th className={table.headerCell}>{t("prod.colCode")}</th>
                          <th className={table.headerCell}>{t("prod.colName")}</th>
                          <th className={table.headerCell}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {noBomRows.map((row) => (
                          <tr key={row.sku.id} className={table.dataRow}>
                            <td className={cn(table.dataCellCompact, "font-mono")}>{row.sku.skuId}</td>
                            <td className={table.truncatedCellCompact}>{row.sku.name}</td>
                            <td className={table.dataCellCompact}>
                              <Button
                                variant="link"
                                size="sm"
                                className="h-6 px-0 text-xs text-primary"
                                onClick={() => navigate("/bom")}
                              >
                                {t("prod.setupBom")} →
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}
          </>
        )}

        {/* ═══ RECORDING MODE ═══ */}
        {mode === "recording" && loadedWeek === weekStart && (
          <>
            <div className={table.wrapper}>
              <table className={table.base}>
                {/* 1A, 1B — Recording colgroup (9 cols), Name=220px, Actions=100px */}
                <colgroup>
                  <col style={{ width: "28px" }} />
                  <col style={{ width: "72px" }} />
                  <col style={{ width: "220px" }} />
                  <col style={{ width: "48px" }} />
                  <col style={{ width: "85px" }} />
                  <col style={{ width: "85px" }} />
                  <col style={{ width: "100px" }} />
                  <col style={{ width: "140px" }} />
                  <col style={{ width: "100px" }} />
                </colgroup>
                <thead className="sticky top-0 z-[5]">
                  <tr className={table.headerRow}>
                    <th className={table.headerCellCenter}></th>
                    <th className={table.headerCell}>{t("prod.colCode")}</th>
                    <th className={table.headerCell}>{t("prod.colName")}</th>
                    {/* 1C — UOM header centered */}
                    <th className={table.headerCellCenter}>UOM</th>
                    <th className={table.headerCellNumeric}>{t("prod.colPlanG_exec")}</th>
                    <th className={table.headerCellNumeric}>{t("prod.colProduced")}</th>
                    <th className={table.headerCellNumeric}>{t("prod.colRemaining")}</th>
                    <th className={table.headerCellCenter}>Progress</th>
                    <th className={table.headerCellCenter}>{t("prod.colActions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {/* 2D — Empty state when no plan saved */}
                  {mode === "recording" && !planLocked && recordingRows.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-12 text-center">
                        <p className="text-sm text-muted-foreground mb-3">No plan saved for this week yet.</p>
                        <Button variant="outline" size="sm" onClick={() => handleModeSwitch("planning")}>
                          <CalendarDays className="w-3.5 h-3.5 mr-1.5" />
                          Go to Planning
                        </Button>
                      </td>
                    </tr>
                  ) : recordingRows.length === 0 ? (
                    <tr>
                      <td colSpan={9} className={table.emptyState}>
                        No active SM SKUs found.
                      </td>
                    </tr>
                  ) : (
                    recordingRows.map((row) => {
                      const hasPlan = row.planG > 0;
                      const remaining = hasPlan ? row.planG - row.producedG : 0;
                      const done = hasPlan && remaining <= 0;

                      // GROUP 3 — Ad-hoc batch completion styling
                      const isAdHocDone = !hasPlan && row.producedG > 0;
                      const progressPct = isAdHocDone
                        ? 100
                        : hasPlan
                          ? Math.min(100, Math.round((row.producedG / row.planG) * 100))
                          : 0;

                      const dotColor: "red" | "amber" | "green" =
                        done || isAdHocDone ? "green" : row.producedG > 0 ? "amber" : "red";

                      const productionRowClass =
                        done || isAdHocDone
                          ? table.productionRowDone
                          : row.producedG > 0
                            ? table.productionRowInProgress
                            : table.productionRowNotStarted;

                      return (
                        <tr key={row.sku.id} className={cn(table.dataRow, productionRowClass)}>
                          <td className={table.dataCellCompactCenter}>
                            <StatusDot status={dotColor} />
                          </td>
                          <td className={cn(table.dataCellCompact, "font-mono truncate")}>{row.sku.skuId}</td>
                          <td className={table.truncatedCellCompact}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="truncate block">{row.sku.name}</span>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-xs">
                                <p>{row.sku.name}</p>
                              </TooltipContent>
                            </Tooltip>
                          </td>
                          {/* 1C — UOM centered */}
                          <td className={table.dataCellCompactCenter}>
                            <span className="text-xs font-medium text-primary">{row.sku.usageUom || "g"}</span>
                          </td>
                          {/* Plan g — pure number */}
                          <td className={table.dataCellCompactMono}>
                            {hasPlan ? fmtG(row.planG) : <span className="text-muted-foreground">—</span>}
                          </td>
                          {/* Produced — pure number */}
                          <td className={table.dataCellCompactMono}>
                            {row.producedG > 0 ? fmtG(row.producedG) : <span className="text-muted-foreground">—</span>}
                          </td>
                          {/* Remaining — GROUP 3 updated */}
                          <td className={table.dataCellCompactMono}>
                            {done || isAdHocDone ? (
                              <span className="text-success font-semibold">Done</span>
                            ) : hasPlan && remaining > 0 ? (
                              <span className="text-destructive font-semibold">{fmtG(remaining)}</span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          {/* Progress — 1D: no label, GROUP 3: ad-hoc shows full green */}
                          <td className={table.dataCellCompact}>
                            {hasPlan || isAdHocDone ? (
                              <div className={cn(progressBar.track, progressBar.trackCompact)}>
                                <div
                                  className={cn(
                                    "h-full rounded-full",
                                    progressPct === 0
                                      ? progressBar.fillNotStarted
                                      : progressPct >= 100
                                        ? progressBar.fillComplete
                                        : progressBar.fillInProgress,
                                  )}
                                  style={{ width: `${progressPct}%` }}
                                />
                              </div>
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </td>
                          {/* Action — outline style */}
                          <td className={table.dataCellCompactCenter}>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-3 text-xs whitespace-nowrap text-primary border-primary/40 hover:bg-primary/5"
                              onClick={() => openRecordModal(row.sku.id)}
                            >
                              <PlayCircle className="w-3 h-3 mr-1" />
                              {t("prod.record")}
                            </Button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* 2E — Expandable unplanned section */}
            {planLocked && unplannedRows.length > 0 && (
              <Collapsible open={showUnplanned} onOpenChange={setShowUnplanned}>
                <CollapsibleTrigger asChild>
                  <button className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors w-full py-2">
                    <ChevronDown className={cn("w-4 h-4 transition-transform", showUnplanned && "rotate-180")} />
                    <StatusDot status="amber" size="sm" />
                    {unplannedRows.length} unplanned SKUs — tap to add ad-hoc batch
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className={table.wrapper}>
                    <table className={table.base}>
                      <colgroup>
                        <col style={{ width: "28px" }} />
                        <col style={{ width: "72px" }} />
                        <col style={{ width: "220px" }} />
                        <col style={{ width: "48px" }} />
                        <col style={{ width: "85px" }} />
                        <col style={{ width: "85px" }} />
                        <col style={{ width: "100px" }} />
                        <col style={{ width: "140px" }} />
                        <col style={{ width: "100px" }} />
                      </colgroup>
                      <tbody>
                        {unplannedRows.map((row) => (
                          <tr key={row.sku.id} className={table.dataRowLocked}>
                            <td className={table.dataCellCompactCenter}>
                              <StatusDot status="amber" size="sm" />
                            </td>
                            <td className={cn(table.dataCellCompact, "font-mono")}>{row.sku.skuId}</td>
                            <td className={table.truncatedCellCompact} title={row.sku.name}>
                              {row.sku.name}
                            </td>
                            <td className={table.dataCellCompactCenter}>
                              <span className="text-xs font-medium text-primary">{row.sku.usageUom || "g"}</span>
                            </td>
                            <td className={table.dataCellCompactMono}>—</td>
                            <td className={table.dataCellCompactMono}>—</td>
                            <td className={table.dataCellCompactMono}>—</td>
                            <td className={table.dataCellCompact}>—</td>
                            <td className={table.dataCellCompactCenter}>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-3 text-xs whitespace-nowrap text-primary border-primary/40 hover:bg-primary/5"
                                onClick={() => openRecordModal(row.sku.id)}
                              >
                                <PlayCircle className="w-3 h-3 mr-1" />
                                {t("prod.record")}
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}
          </>
        )}

        {/* ═══ PRODUCTION HISTORY — always visible ═══ */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">
              {t("prod.historyTitle")} · Week {weekNumber}
            </h3>
            <Badge variant="outline" className="text-xs">
              {weekRecords.length}
            </Badge>
          </div>
          {weekRecords.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No production records for this week.</p>
          ) : (
            <div className={table.wrapper}>
              <table className={table.base}>
                {/* History colgroup (5 cols) */}
                <colgroup>
                  <col style={{ width: "90px" }} />
                  <col style={{ width: "72px" }} />
                  <col />
                  <col style={{ width: "110px" }} />
                  <col style={{ width: "56px" }} />
                </colgroup>
                <thead>
                  <tr className={table.headerRow}>
                    <th className={table.headerCell}>{t("prod.dateLabel")}</th>
                    <th className={table.headerCell}>{t("prod.colCode")}</th>
                    <th className={table.headerCell}>{t("prod.colName")}</th>
                    <th className={table.headerCellNumeric}>{t("prod.colProduced")}</th>
                    <th className={table.headerCell}></th>
                  </tr>
                </thead>
                <tbody>
                  {weekRecords.map((rec) => (
                    <tr key={rec.id} className={table.dataRow}>
                      <td className={table.dataCellCompact}>{rec.productionDate}</td>
                      <td className={cn(table.dataCellCompact, "font-mono")}>{getSkuCode(rec.smSkuId)}</td>
                      <td className={table.truncatedCellCompact} title={getSkuName(rec.smSkuId)}>
                        {getSkuName(rec.smSkuId)}
                      </td>
                      <td className={table.dataCellCompactMono}>{fmtG(rec.actualOutputG)}</td>
                      <td className={table.dataCellCompactCenter}>
                        {isManagement && (
                          <span className="inline-flex gap-0.5">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-6 w-6"
                              onClick={() => openEditRecordModal(rec)}
                              title="Edit"
                            >
                              <Pencil className="w-3 h-3" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-6 w-6"
                              onClick={() =>
                                setDeleteConfirm({
                                  id: rec.id,
                                  name: `${getSkuCode(rec.smSkuId)} on ${rec.productionDate}`,
                                })
                              }
                              title="Delete"
                            >
                              <Trash2 className="w-3 h-3 text-destructive" />
                            </Button>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ═══ RECORD MODAL — SINGLE CONFIRM ═══ */}
      <Dialog open={recordModalOpen} onOpenChange={setRecordModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingRecordId ? t("prod.editRecordTitle") : t("prod.recordTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground">SM SKU</label>
              <div className="h-10 flex items-center px-3 rounded-md border bg-muted/50 text-sm">
                {recordSku ? `${recordSku.skuId} — ${recordSku.name}` : "—"}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Recording for Week {weekNumber} · {formatDate(weekStart)} – {formatDate(weekEnd)}
              </p>
            </div>

            {/* Running total */}
            {recordRow && (
              <div className="rounded-lg bg-muted/50 border p-3 text-sm">
                <p className="font-medium">
                  {t("prod.runningTotal")} {fmtG(recordRow.producedG)} {t("prod.gUnit")} {t("prod.of")}{" "}
                  {fmtG(recordRow.planG)} {t("prod.gUnit")}
                  {recordRow.planG > 0 && ` (${((recordRow.producedG / recordRow.planG) * 100).toFixed(0)}%)`}
                </p>
              </div>
            )}

            <DatePicker
              value={recordForm.productionDate ? new Date(recordForm.productionDate + "T00:00:00") : undefined}
              onChange={(d) =>
                setRecordForm((f) => ({ ...f, productionDate: d ? toLocalDateStr(d) : toLocalDateStr(new Date()) }))
              }
              defaultToday
              label="Date"
              required
              labelPosition="above"
              align="start"
            />
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t("prod.actualOutputLabel")}</label>
              <Input
                type="number"
                step="1"
                value={recordForm.actualOutputG || ""}
                onChange={(e) => setRecordForm((f) => ({ ...f, actualOutputG: Number(e.target.value) }))}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t("prod.notesLabel")}</label>
              <Input
                value={recordForm.notes}
                onChange={(e) => setRecordForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRecordModalOpen(false)}>
              {t("btn.cancel")}
            </Button>
            <Button onClick={doSaveRecord} disabled={saving}>
              {saving ? "Saving..." : t("prod.record")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Critical warning dialog */}
      <ConfirmDialog
        open={criticalWarning !== null}
        onOpenChange={(open) => !open && setCriticalWarning(null)}
        title={t("prod.criticalWarningTitle")}
        description={`${criticalWarning} ${t("prod.criticalWarningMsg")}`}
        confirmLabel={t("prod.continueBtn")}
        cancelLabel={t("btn.cancel")}
        variant="warning"
        onConfirm={() => {
          setCriticalWarning(null);
          doSavePlan();
        }}
      />

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!deleteConfirm}
        onOpenChange={(open) => !open && setDeleteConfirm(null)}
        title={t("prod.deleteRecord")}
        description={`${t("prod.deleteConfirm")} "${deleteConfirm?.name}"?`}
        confirmLabel={t("btn.delete")}
        onConfirm={handleDeleteRecordConfirm}
      />

      {/* Planning Agent floating button */}
      {mode === "planning" && (
        <button
          onClick={() => setAgentOpen(true)}
          className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-lg hover:bg-primary/90 transition-colors"
        >
          <Sparkles className="w-4 h-4" />
          วางแผน AI
        </button>
      )}

      {/* Planning Agent panel */}
      <PlanningAgentPanel
        open={agentOpen}
        onClose={() => setAgentOpen(false)}
        branches={planningAgent.branches}
        suggestions={planningAgent.suggestions}
        smSkusByBrand={planningAgent.smSkusByBrand}
        isLoading={planningAgent.isLoading}
        weekStart={weekStart}
        onRecalculate={planningAgent.recalculateWithOverrides}
        onApplyPlan={(plan) => setPlanBatches(prev => ({ ...prev, ...plan }))}
        onRefetch={planningAgent.refetch}
      />
    </TooltipProvider>
  );
}
