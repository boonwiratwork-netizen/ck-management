import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { addDays, format } from "date-fns";
import { HelpCircle } from "lucide-react";
import type { SKU } from "@/types/sku";
import type { BOMHeader, BOMLine, BOMStep } from "@/types/bom";
import type { BomByproduct } from "@/types/byproduct";
import type { ProductionRecord } from "@/types/production";
import { getWeekStart } from "@/types/production";
import type { SMStockBalance } from "@/hooks/use-sm-stock-data";
import type { useProductionData } from "@/hooks/use-production-data";
import { usePlanningAgent } from "@/hooks/use-planning-agent";
import { useAuth } from "@/hooks/use-auth";
import { indirectNeed } from "@/lib/production";
import { EditRecordDialog, PlanView, ProdSide, RecordView, type ProdRow } from "@/components/production/ProductionViews";
import { PlanningAgentPanel } from "@/components/PlanningAgentPanel";
import { ByproductDialog, type ByproductAsk } from "@/components/production/ByproductDialog";
import { GuideTour, useGuide, type GuideStep } from "@/components/GuideTour";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const GUIDE: GuideStep[] = [
  {
    title: "การผลิต 2 อย่าง",
    body: (
      <>
        <b>บันทึกผลผลิต</b> ทุกวันหลังผลิตเสร็จ · <b>วางแผน</b> สัปดาห์ละครั้ง
      </>
    ),
  },
  { target: "prod-day", title: "วันที่ผลิต", body: "ปกติเป็นวันนี้ ถ้าบันทึกของเมื่อวานให้เปลี่ยนก่อน" },
  {
    target: "prod-lines",
    title: "ขั้น 1: ใส่น้ำหนักที่ผลิตได้ แล้วกด Enter",
    body: "Enter = บันทึกเลย · เรียงจากของที่ใกล้หมดก่อน · ผลิตไม่เต็มชุดก็ใส่ได้",
    until: "enter",
  },
  { target: "prod-mode", title: "ขั้น 2: แตะ “วางแผน”", body: "วางแผนสัปดาห์ละครั้ง", until: "click" },
  { target: "prod-fill", title: "แตะ “ใส่ตามแนะนำ”", body: "ระบบคิดให้พอใช้ตามเป้า แก้ตัวเลขทีละแถวได้", until: "click" },
  { target: "prod-save", title: "ขั้น 3: บันทึกแผน", body: "บันทึกแล้วแผนไปโผล่ในหน้าบันทึกผลผลิตของสัปดาห์นั้น" },
];

interface Props {
  productionData: ReturnType<typeof useProductionData>;
  skus: SKU[];
  bomHeaders: BOMHeader[];
  bomLines: BOMLine[];
  bomSteps: BOMStep[];
  smStockBalances: SMStockBalance[];
  isStockDataReady?: boolean;
  /** Daily SM need from sales, the same figure as the SM Stock page */
  smDailyUsage: Record<string, number>;
  refreshProductionRecords?: () => void;
  /** Recipe by-products (น้ำสต๊อก → น้ำมันไก่ + น้ำสต๊อกโทริ ไพตัน) */
  byproducts?: BomByproduct[];
  /** Dev harness only: act as a kitchen manager without signing in */
  demoCanEdit?: boolean;
}

const iso = (d: Date) => format(d, "yyyy-MM-dd");

/** Weekly plan lines (grams per SM) for a week */
function useWeekPlan(weekStart: string) {
  const [plan, setPlan] = useState<Record<string, number>>({});
  const [saved, setSaved] = useState<Record<string, number>>({});
  const [loaded, setLoaded] = useState<string | null>(null);
  useEffect(() => {
    let stale = false;
    // Don't show the previous week's plan while this one loads
    setPlan({});
    setSaved({});
    supabase
      .from("weekly_plan_lines" as never)
      .select("sku_id, planned_qty_uom")
      .eq("week_start", weekStart)
      .then(({ data }: { data: { sku_id: string; planned_qty_uom: number }[] | null }) => {
        if (stale) return;
        const m: Record<string, number> = {};
        for (const r of data || []) m[r.sku_id] = Number(r.planned_qty_uom) || 0;
        setPlan(m);
        setSaved(m);
        setLoaded(weekStart);
      });
    return () => {
      stale = true;
    };
  }, [weekStart]);
  const dirty = loaded === weekStart && JSON.stringify(Object.entries(plan).filter(([, v]) => v > 0).sort()) !== JSON.stringify(Object.entries(saved).filter(([, v]) => v > 0).sort());
  return { plan, setPlan, saved, setSaved, dirty, ready: loaded === weekStart };
}

/**
 * Central-kitchen production (replaces Production): record what was made each day,
 * and plan the week. Hash: "" recording, "plan" planning.
 */
export default function ProducePage({ productionData, skus, bomHeaders, bomLines, smStockBalances, isStockDataReady = true, smDailyUsage, refreshProductionRecords, byproducts = [], demoCanEdit }: Props) {
  const { records, addRecord, updateRecordWithDelta, deleteRecord, getOutputPerBatch } = productionData;
  const { isManagement, role } = useAuth();
  const canEdit = demoCanEdit || isManagement || role === "ck_manager";
  const location = useLocation();
  const navigate = useNavigate();
  const mode = location.hash === "#plan" ? "plan" : "record";
  const setMode = (m: "record" | "plan") => navigate({ pathname: location.pathname, hash: m === "plan" ? "#plan" : "" }, { replace: true });
  const guide = useGuide("production-v1");

  const today = iso(new Date());
  const thisWeek = getWeekStart(today);
  const [day, setDay] = useState(today);
  const recordWeek = getWeekStart(day);
  const [planWeek, setPlanWeek] = useState(() => iso(addDays(new Date(thisWeek + "T00:00:00"), 7)));

  const skuOf = useMemo(() => new Map(skus.map((s) => [s.id, s])), [skus]);
  const nameOf = (id: string) => skuOf.get(id)?.name ?? "—";
  const hasBom = useMemo(() => new Set(bomHeaders.map((h) => h.smSkuId)), [bomHeaders]);
  const smSkus = useMemo(() => skus.filter((s) => s.type === "SM" && s.status === "Active"), [skus]);
  const stockOf = useMemo(() => new Map(smStockBalances.map((b) => [b.skuId, b.currentStock])), [smStockBalances]);
  // SM inside other SM: planning a parent adds need to the child
  const childrenOf = useMemo(() => {
    const smIds = new Set(smSkus.map((s) => s.id));
    const m = new Map<string, { childId: string; qtyPerBatch: number }[]>();
    for (const h of bomHeaders) {
      if (!smIds.has(h.smSkuId)) continue;
      for (const l of bomLines) if (l.bomHeaderId === h.id && smIds.has(l.rmSkuId)) m.set(h.smSkuId, [...(m.get(h.smSkuId) || []), { childId: l.rmSkuId, qtyPerBatch: l.qtyPerBatch }]);
    }
    return m;
  }, [smSkus, bomHeaders, bomLines]);

  // ── Targets: global days, and per-product where set (as before) ──
  const [globalTarget, setGlobalTarget] = useState(7);
  const [skuTargets, setSkuTargets] = useState<Record<string, number>>({});
  useEffect(() => {
    supabase
      .from("global_settings" as never)
      .select("value")
      .eq("key", "cover_days_target")
      .maybeSingle()
      .then(({ data }: { data: { value: string } | null }) => data && setGlobalTarget(Number(data.value) || 7));
    supabase
      .from("skus")
      .select("id, cover_days_target" as never)
      .not("cover_days_target", "is", null)
      .then(({ data }) => {
        const m: Record<string, number> = {};
        for (const r of (data || []) as unknown as { id: string; cover_days_target: number }[]) m[r.id] = Number(r.cover_days_target);
        setSkuTargets(m);
      });
  }, []);
  const saveTarget = async (n: number) => {
    setGlobalTarget(n);
    const { error } = await supabase.from("global_settings" as never).update({ value: String(n) } as never).eq("key", "cover_days_target");
    if (error) toast.error("บันทึกเป้าไม่ได้: " + error.message);
  };

  const recordPlan = useWeekPlan(recordWeek);
  const planPlan = useWeekPlan(planWeek);

  const rowsFor = (weekStart: string, plan: Record<string, number>): ProdRow[] => {
    const end = iso(addDays(new Date(weekStart + "T00:00:00"), 6));
    const made = new Map<string, number>();
    for (const r of records) if (r.productionDate >= weekStart && r.productionDate <= end) made.set(r.smSkuId, (made.get(r.smSkuId) || 0) + r.actualOutputG);
    const indirect = indirectNeed(plan, getOutputPerBatch, childrenOf);
    return smSkus
      .filter((s) => hasBom.has(s.id))
      .map((sku) => ({
        sku,
        perBatch: getOutputPerBatch(sku.id),
        plan: plan[sku.id] || 0,
        made: made.get(sku.id) || 0,
        dailyNeed: (smDailyUsage[sku.id] || 0) + (indirect[sku.id] || 0),
        stock: stockOf.get(sku.id) ?? 0,
        target: skuTargets[sku.id] ?? globalTarget,
        hasBom: true,
      }));
  };
  const recordRows = useMemo(() => rowsFor(recordWeek, recordPlan.saved), [recordWeek, recordPlan.saved, records, smSkus, smDailyUsage, stockOf, skuTargets, globalTarget, childrenOf]); // eslint-disable-line react-hooks/exhaustive-deps
  const planRows = useMemo(() => rowsFor(planWeek, planPlan.plan), [planWeek, planPlan.plan, records, smSkus, smDailyUsage, stockOf, skuTargets, globalTarget, childrenOf]); // eslint-disable-line react-hooks/exhaustive-deps
  const weekPlanned = recordRows.filter((r) => r.plan > 0);
  const weekDone = weekPlanned.filter((r) => r.made >= r.plan).length;
  const dayRecords = useMemo(() => records.filter((r) => r.productionDate === day).sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")), [records, day]);
  const extraSkus = useMemo(() => smSkus.filter((s) => hasBom.has(s.id)), [smSkus, hasBom]);
  const noBom = useMemo(() => smSkus.filter((s) => !hasBom.has(s.id)), [smSkus, hasBom]);

  // ── Recording ──
  const [busy, setBusy] = useState<string | null>(null);
  // Tracked by-products per recipe, and which recipe each by-product comes from
  const tracked = useMemo(() => byproducts.filter((b) => b.tracksInventory && b.skuId), [byproducts]);
  const parentOfBp = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of tracked) {
      const h = bomHeaders.find((x) => x.id === b.bomHeaderId);
      if (h) m.set(b.skuId!, h.smSkuId);
    }
    return m;
  }, [tracked, bomHeaders]);
  // A pending save waits for a dialog (by-products as weighed, or "already came in?")
  const waiting = useRef<((ok: boolean) => void) | null>(null);
  const [bpAsk, setBpAsk] = useState<(ByproductAsk & { skuId: string; notes: string }) | null>(null);
  const [dupAsk, setDupAsk] = useState<{ skuId: string; grams: number; notes: string; parent: string } | null>(null);
  const wait = () => new Promise<boolean>((resolve) => (waiting.current = resolve));
  // The confirm button also closes the dialog: don't treat that close as "cancel"
  const dupConfirmed = useRef(false);
  const settle = (ok: boolean) => {
    waiting.current?.(ok);
    waiting.current = null;
  };

  const save = async (skuId: string, grams: number, notes: string, byproductQty?: Record<string, number>) => {
    setBusy(skuId);
    const id = await addRecord({ smSkuId: skuId, productionDate: day, actualOutputG: grams, notes, byproductQty });
    setBusy(null);
    if (!id) return false;
    refreshProductionRecords?.();
    toast.success(`บันทึก ${nameOf(skuId)} แล้ว`);
    return true;
  };
  const askByproducts = (skuId: string, grams: number, notes: string) => {
    const header = bomHeaders.find((h) => h.smSkuId === skuId);
    const items = header ? tracked.filter((b) => b.bomHeaderId === header.id) : [];
    if (!items.length) return save(skuId, grams, notes);
    const perOut = getOutputPerBatch(skuId);
    const share = perOut > 0 ? grams / perOut : 0;
    setBpAsk({ skuId, notes, name: nameOf(skuId), grams, items: items.map((b) => ({ skuId: b.skuId!, name: nameOf(b.skuId!), expected: b.outputQty * share, uom: skus.find((s) => s.id === b.skuId)?.usageUom || "ก." })) });
    return wait();
  };
  const onRecord = async (skuId: string, grams: number, notes: string) => {
    // A by-product already went into stock with its parent pot today: ask before adding it twice
    const parent = parentOfBp.get(skuId);
    if (parent && records.some((r) => r.smSkuId === parent && r.productionDate === day)) {
      setDupAsk({ skuId, grams, notes, parent });
      return wait();
    }
    return askByproducts(skuId, grams, notes);
  };
  const [editing, setEditing] = useState<ProductionRecord | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [pendingWeek, setPendingWeek] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ProductionRecord | null>(null);

  // ── Planning ──
  const [saving, setSaving] = useState(false);
  const savePlan = async () => {
    setSaving(true);
    // The week's lines are replaced as a whole (as before)
    const rows = Object.entries(planPlan.plan)
      .filter(([, g]) => g > 0)
      .map(([sku_id, g]) => ({ week_start: planWeek, sku_id, planned_qty_uom: g }));
    const { error: delErr } = await supabase.from("weekly_plan_lines" as never).delete().eq("week_start", planWeek);
    const { error } = delErr ? { error: delErr } : rows.length ? await supabase.from("weekly_plan_lines" as never).insert(rows as never) : { error: null };
    setSaving(false);
    if (error) {
      toast.error("บันทึกแผนไม่ได้: " + error.message);
      return;
    }
    planPlan.setSaved(planPlan.plan);
    if (planWeek === recordWeek) recordPlan.setSaved(planPlan.plan);
    toast.success("บันทึกแผนแล้ว");
  };

  const [agentOpen, setAgentOpen] = useState(false);
  const agent = usePlanningAgent({ smStockBalances: smStockBalances.map((s) => ({ skuId: s.skuId, currentStock: s.currentStock })), getOutputPerBatch });

  const weekLabel = `${format(new Date(recordWeek + "T00:00:00"), "d/M")} – ${format(addDays(new Date(recordWeek + "T00:00:00"), 6), "d/M")}`;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <h1 className="mr-auto text-2xl font-bold">การผลิต</h1>
        <Button
          variant="outline"
          className="h-10"
          onClick={() => {
            setMode("record");
            guide.start();
          }}
        >
          <HelpCircle className="h-4 w-4" /> วิธีใช้
        </Button>
      </div>
      <div className={cn("grid grid-cols-1 gap-6", mode === "record" && "split:grid-cols-[320px_minmax(0,1fr)]")}>
        <div className={cn("min-w-0", mode === "plan" && "split:hidden")}>
          <ProdSide
            mode={mode}
            onMode={setMode}
            weekLabel={weekLabel}
            done={weekDone}
            planned={weekPlanned.length}
            dayRecords={dayRecords}
            day={day}
            nameOf={nameOf}
            canEdit={canEdit}
            canDelete={isManagement}
            onEdit={setEditing}
            onDelete={setDeleting}
          />
        </div>
        <div className="min-w-0">
          {mode === "plan" ? (
            <>
              <button type="button" onClick={() => setMode("record")} className="-ml-2 mb-2 hidden min-h-[44px] items-center rounded-full px-2 text-sm text-muted-foreground hover:text-foreground split:inline-flex">
                ‹ บันทึกผลผลิต
              </button>
              <PlanView
                weekStart={planWeek}
                thisWeek={thisWeek}
                onWeek={(ws) => (planPlan.dirty ? setPendingWeek(ws) : setPlanWeek(ws))}
                target={globalTarget}
                onTarget={saveTarget}
                rows={planRows}
                noBom={noBom}
                plan={planPlan.plan}
                onPlan={(id, g) => planPlan.setPlan((p) => ({ ...p, [id]: g }))}
                dirty={planPlan.dirty}
                saving={saving}
                canEdit={canEdit}
                onSave={savePlan}
                onAgent={() => setAgentOpen(true)}
                onSetupBom={() => navigate("/bom")}
                stockReady={isStockDataReady}
              />
            </>
          ) : (
            <RecordView day={day} onDay={setDay} rows={recordRows} extraSkus={extraSkus} dayRecords={dayRecords} canEdit={canEdit} busy={busy} onRecord={onRecord} onGoPlan={() => { setPlanWeek(recordWeek); setMode("plan"); }} />
          )}
        </div>
      </div>

      {editing && (
        <EditRecordDialog
          r={editing}
          name={nameOf(editing.smSkuId)}
          busy={editBusy}
          onCancel={() => setEditing(null)}
          onSave={async (d, grams, notes) => {
            if (editBusy) return;
            setEditBusy(true);
            const ok = await updateRecordWithDelta(editing.id, { productionDate: d, actualOutputG: grams, notes });
            setEditBusy(false);
            if (ok) {
              setEditing(null);
              refreshProductionRecords?.();
              toast.success("แก้แล้ว");
            }
          }}
        />
      )}
      {bpAsk && (
        <ByproductDialog
          ask={bpAsk}
          busy={busy === bpAsk.skuId}
          onCancel={() => {
            setBpAsk(null);
            settle(false);
          }}
          onSave={async (qty) => {
            const ok = await save(bpAsk.skuId, bpAsk.grams, bpAsk.notes, qty);
            setBpAsk(null);
            settle(ok);
          }}
        />
      )}
      <ConfirmDialog
        open={!!dupAsk}
        onOpenChange={(o) => {
          if (o) return;
          if (dupConfirmed.current) {
            dupConfirmed.current = false;
            return;
          }
          if (dupAsk) {
            setDupAsk(null);
            settle(false);
          }
        }}
        title={`${dupAsk ? nameOf(dupAsk.skuId) : ""} เข้าสต๊อกแล้ววันนี้`}
        description={dupAsk ? `ผลิต${nameOf(dupAsk.parent)}วันนี้ ${nameOf(dupAsk.skuId)}เข้าสต๊อกพร้อมหม้อนั้นแล้ว\nลงแยกอีกจะนับซ้ำ · บันทึกต่อเฉพาะถ้าเป็นอีกหม้อจริงๆ` : ""}
        confirmLabel="เป็นอีกหม้อ บันทึกต่อ"
        cancelLabel="ไม่บันทึก"
        variant="default"
        onConfirm={async () => {
          const d = dupAsk;
          dupConfirmed.current = true;
          setDupAsk(null);
          if (!d) return;
          // Resolve the waiting save once the next step (by-products, if any) is done
          const resolve = waiting.current;
          waiting.current = null;
          const ok = await askByproducts(d.skuId, d.grams, d.notes);
          resolve?.(ok);
        }}
      />
      <ConfirmDialog
        open={!!pendingWeek}
        onOpenChange={(o) => !o && setPendingWeek(null)}
        title="ยังไม่ได้บันทึกแผน"
        description="เปลี่ยนสัปดาห์แล้วตัวเลขที่ใส่ไว้จะหาย"
        confirmLabel="เปลี่ยนสัปดาห์"
        cancelLabel="อยู่ต่อ"
        onConfirm={() => {
          const w = pendingWeek;
          setPendingWeek(null);
          if (w) setPlanWeek(w);
        }}
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`ลบ ${deleting ? nameOf(deleting.smSkuId) : ""}?`}
        description="วัตถุดิบที่หักไปจะคืนกลับเข้าสต๊อก"
        confirmLabel="ลบ"
        cancelLabel="ไม่ใช่"
        variant="destructive"
        onConfirm={async () => {
          const r = deleting;
          setDeleting(null);
          if (r && (await deleteRecord(r.id))) {
            refreshProductionRecords?.();
            toast.success("ลบแล้ว");
          }
        }}
      />
      <PlanningAgentPanel
        open={agentOpen}
        onClose={() => setAgentOpen(false)}
        branches={agent.branches}
        suggestions={agent.suggestions}
        menusByBrand={agent.menusByBrand}
        menuBomByMenuId={agent.menuBomByMenuId}
        isLoading={agent.isLoading}
        weekStart={planWeek}
        onRecalculate={agent.recalculateWithOverrides}
        onApplyPlan={(p) => planPlan.setPlan((prev) => ({ ...prev, ...p }))}
        onRefetch={agent.refetch}
      />
      <GuideTour steps={GUIDE} open={guide.open} onClose={guide.close} />
    </div>
  );
}
