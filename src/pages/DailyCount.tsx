import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, GripVertical, HelpCircle, Printer, Unlock } from "lucide-react";
import type { SKU } from "@/types/sku";
import type { MenuBomLine } from "@/types/menu-bom";
import type { ModifierRule } from "@/types/modifier-rule";
import type { SpBomLine } from "@/types/sp-bom";
import type { Menu } from "@/types/menu";
import type { Branch } from "@/types/branch";
import type { TabKey } from "@/components/AppSidebar";
import { useAuth } from "@/hooks/use-auth";
import { useDailyStockCount } from "@/hooks/use-daily-stock-count";
import { useCountStatus } from "@/hooks/use-count-status";
import { supabase } from "@/integrations/supabase/client";
import { ZONES, businessDate, isBigDifference, isDormant, monthEndWindow, orderLines, zoneOf } from "@/lib/stock-count";
import { CountSheet, type SheetLine } from "@/components/count/CountSheet";
import { CountHome, CountReview, CountStrip } from "@/components/count/CountScreens";
import { CountArrange, CountPrint } from "@/components/count/CountExtras";
import { StockCard } from "@/components/StockCard";
import { GuideTour, useGuide, type GuideStep } from "@/components/GuideTour";
import { thaiDay } from "@/components/sales/SalesDays";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useBaseStatus } from "@/components/BaseLoading";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Props {
  skus: SKU[];
  menuBomLines: MenuBomLine[];
  modifierRules: ModifierRule[];
  spBomLines: SpBomLine[];
  menus: Menu[];
  branches: Branch[];
  menuBomLoading?: boolean;
  onNavigate: (tab: TabKey) => void;
  /** Dev harness only: in-memory stand-ins for the database layer */
  demo?: { dsc: ReturnType<typeof useDailyStockCount>; status: ReturnType<typeof useCountStatus>; customOrder?: string[] | null };
}

const LAST_BRANCH_KEY = "ck-count-branch";

/** Learn by doing it once: check → start → count one product → finish */
const GUIDE: GuideStep[] = [
  {
    title: "นับสต๊อกแบบใหม่ 3 ขั้น",
    body: (
      <>
        <b>1 เช็คก่อนนับ</b> → <b>2 นับทีละโซน</b> → <b>3 กด “นับเสร็จ”</b> ทุกวัน คำแนะนำนี้จะพาทำจริงทีละขั้น
      </>
    ),
  },
  { target: "count-check", title: "ขั้น 1: เช็คก่อนนับ", body: "ต้องมีเครื่องหมายถูกที่ “ยอดขายวันนี้” ก่อน ถ้ายังไม่มี กด “ไปนำเข้า” แล้วค่อยกลับมานับ ไม่งั้นคงเหลือจะไม่ถูก" },
  {
    target: "count-open",
    title: "ปิดวันที่ค้างก่อน",
    body: "มีวันที่ยังไม่ได้กด “นับเสร็จ” ค้างอยู่ แตะปุ่มส้ม “ปิดวันที่ค้างทั้งหมด” ก่อน แล้วจึงเริ่มนับวันนี้ได้",
  },
  { target: "count-start", title: "เริ่มนับ", body: "แตะ “เริ่มนับ” (หรือ “นับต่อ”)", until: "click" },
  { target: "count-zones", title: "ขั้น 2: นับทีละโซน", body: "ช่องแช่แข็ง → ตู้เย็น → ของแห้ง ตัวเลขใต้ชื่อโซนบอกว่านับไปแล้วกี่ตัว ถ้าเคยจัดลำดับเองไว้ จะเรียงตามลำดับเดิม" },
  {
    target: "count-box",
    title: "ใส่ยอดที่นับได้",
    body: "พิมพ์ยอดที่นับได้ตามหน่วยที่เขียนในช่อง แล้วกด Enter (บนมือถือคือปุ่ม “ถัดไป”) ระบบไปตัวถัดไปและบันทึกให้เอง",
    until: "enter",
  },
  {
    target: "count-list",
    title: "อ่านตัวเลขในแต่ละรายการ",
    body: (
      <>
        ใต้ช่องบอก <b>ขาด/เกิน</b> ทันที สีส้ม = ต่างมาก ลองนับซ้ำ · ช่องใต้ชื่อคือที่มาของคงเหลือ: ยกมา + รับ (ช่องเขียว = วันนี้มีของเข้า) − ใช้ (ตัด BOM) − ของเสีย · ของทิ้งวันนี้กด “+ ของเสีย”
      </>
    ),
  },
  {
    title: "ขั้น 3: กด “นับเสร็จ” ทุกวัน",
    body: "นับตัวสุดท้ายแล้วกด Enter ระบบพาไปหน้าตรวจเอง กด “นับเสร็จ” เป็นอันจบ ถ้าลืมกด วันรุ่งขึ้นจะเริ่มนับไม่ได้จนกว่าจะปิดวันที่ค้าง",
  },
];

/**
 * Daily count (replaces DailyStockCount): check sales and receipts first, count
 * zone by zone (or in the person's own saved order), review big differences,
 * finish. Hash screens: "" home, "count", "dormant", "review", "arrange".
 */
export default function DailyCountPage({ skus, menuBomLines, modifierRules, spBomLines, menus, branches, menuBomLoading = false, onNavigate, demo }: Props) {
  const { isManagement, isStoreManager, profile, user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const view = decodeURIComponent(location.hash.slice(1));
  const go = (v: string, replace = false) => navigate({ pathname: location.pathname, hash: v ? `#${v}` : "" }, { replace });
  const guide = useGuide("count-v2");
  // The dev harness has no sign-in; it acts as management
  const canEdit = !!demo || isManagement || isStoreManager;

  // ── Branch & day ──
  const activeBranches = useMemo(() => branches.filter((b) => b.status === "Active"), [branches]);
  const lockedBranch = isStoreManager && profile?.branch_id ? profile.branch_id : null;
  const [picked, setPicked] = useState(() => {
    try {
      return localStorage.getItem(LAST_BRANCH_KEY) || "";
    } catch {
      return "";
    }
  });
  const branchId = lockedBranch ?? (activeBranches.some((b) => b.id === picked) ? picked : activeBranches[0]?.id ?? null);
  const branch = branches.find((b) => b.id === branchId);
  const [today, setToday] = useState(() => businessDate(new Date()));
  const [date, setDate] = useState(today);
  // A page left open overnight moves on to the new count day (unless another day was picked)
  useEffect(() => {
    const check = () => {
      const now = businessDate(new Date());
      if (now === today) return;
      setDate((d) => (d === today ? now : d));
      setToday(now);
    };
    document.addEventListener("visibilitychange", check);
    const t = setInterval(check, 60_000);
    return () => {
      document.removeEventListener("visibilitychange", check);
      clearInterval(t);
    };
  }, [today]);
  const monthEnd = monthEndWindow(date);

  const liveDsc = useDailyStockCount({ skus, menuBomLines, modifierRules, spBomLines, menus, branches });
  const liveStatus = useCountStatus(demo ? null : branchId, date);
  const dsc = demo?.dsc ?? liveDsc;
  const { status, loading: statusLoading, reload: reloadStatus } = demo?.status ?? liveStatus;
  // Wait for the fresh recipes and menus (not just this device's saved copy): a sheet
  // worked out without them would show, and save, the wrong usage
  const baseFresh = useBaseStatus() === "fresh";
  const baseReady = (!!demo || baseFresh) && !menuBomLoading && menus.length > 0 && skus.length > 0;
  useEffect(() => {
    if (branchId && baseReady) dsc.loadSheet(branchId, date);
  }, [branchId, date, baseReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── The person's own order (the old จัดลำดับแถว), never changed by this page ──
  const [customOrder, setCustomOrder] = useState<string[] | null>(null);
  useEffect(() => {
    if (demo) return setCustomOrder(demo.customOrder ?? null);
    if (!branchId || !user?.id) return setCustomOrder(null);
    supabase
      .from("user_sort_preferences")
      .select("sku_order")
      .eq("user_id", user.id)
      .eq("branch_id", branchId)
      .maybeSingle()
      .then(({ data }) => setCustomOrder(Array.isArray(data?.sku_order) ? (data!.sku_order as string[]) : null));
  }, [branchId, user?.id, demo]);

  // ── Lines ──
  const skuMap = useMemo(() => new Map(skus.map((s) => [s.id, s])), [skus]);
  const conv = useCallback((s: SKU) => (s.purchaseUom === s.usageUom ? 1 : s.converter || 1), []);
  const all = useMemo<SheetLine[]>(
    () =>
      dsc.rows
        .map((row) => {
          const sku = skuMap.get(row.skuId);
          return sku ? { row, sku, received: row.receivedFromCk + row.receivedExternal * conv(sku) } : null;
        })
        .filter((l): l is SheetLine => !!l),
    [dsc.rows, skuMap, conv],
  );
  const dormantOf = (l: SheetLine) => isDormant({ ...l.row, received: l.received });
  const ordered = useMemo(() => orderLines(all, skuMap, customOrder, (l) => l.sku.id), [all, skuMap, customOrder]);
  const active = ordered.filter((l) => !dormantOf(l));
  const dormant = ordered.filter(dormantOf);
  const hasSheet = dsc.rows.length > 0;
  const finished = hasSheet && dsc.rows.every((r) => r.isSubmitted);
  const salesIn = status.salesLines > 0;
  const zoneProgress = ZONES.map((z) => ({
    zone: z.key,
    counted: active.filter((l) => zoneOf(l.sku) === z.key && l.row.physicalCount !== null).length,
    total: active.filter((l) => zoneOf(l.sku) === z.key).length,
  })).filter((z) => z.total > 0);

  // ── Actions ──
  const [starting, setStarting] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [cardSku, setCardSku] = useState<string | null>(null);
  const [printOpen, setPrintOpen] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);

  const start = async () => {
    if (!branchId) return;
    if (!hasSheet) {
      setStarting(true);
      await dsc.generateSheet(branchId, date);
      setStarting(false);
    }
    go("count");
  };
  const finish = async () => {
    if (!branchId) return;
    setFinishing(true);
    const ok = await dsc.submitSheet(branchId, date);
    setFinishing(false);
    if (ok) {
      toast.success(`นับเสร็จแล้ว ${thaiDay(date)}`);
      reloadStatus();
      go("", true);
    }
  };
  const closeOpenDays = async () => {
    if (!branchId) return;
    if (await dsc.finishDays(branchId, status.openDays.map((d) => d.date))) {
      toast.success("ปิดวันที่ค้างแล้ว");
      reloadStatus();
    }
  };
  // Month-end days count for food cost: closing one that isn't fully counted needs a clear yes
  const [monthEndWarn, setMonthEndWarn] = useState<string[] | null>(null);
  const finishOpenDays = async () => {
    const short = status.openDays.filter((d) => monthEndWindow(d.date) && d.counted < d.total).map((d) => d.date);
    if (short.length) return setMonthEndWarn(short);
    await closeOpenDays();
  };
  const saveOrder = async (order: string[]) => {
    if (!user?.id || !branchId) return;
    setSavingOrder(true);
    const { data: existing } = await supabase.from("user_sort_preferences").select("id").eq("user_id", user.id).eq("branch_id", branchId).maybeSingle();
    const { error } = existing
      ? await supabase.from("user_sort_preferences").update({ sku_order: order, updated_at: new Date().toISOString() }).eq("id", existing.id)
      : await supabase.from("user_sort_preferences").insert({ user_id: user.id, branch_id: branchId, sku_order: order });
    setSavingOrder(false);
    if (error) return toast.error("บันทึกลำดับไม่สำเร็จ");
    setCustomOrder(order);
    toast.success("บันทึกลำดับแล้ว");
    go("count", true);
  };
  const resetOrder = async () => {
    if (!user?.id || !branchId) return;
    await supabase.from("user_sort_preferences").delete().eq("user_id", user.id).eq("branch_id", branchId);
    setCustomOrder(null);
    toast.success("กลับไปเรียงตามโซนแล้ว");
    go("count", true);
  };

  // ── Screens ──
  const locked = finished;
  let work: React.ReactNode = null;
  if (!branchId) work = <Empty text="ยังไม่มีสาขาที่เปิดอยู่" />;
  else if (dsc.loading && !hasSheet) work = <Empty text="กำลังคำนวณใบนับ…" />;
  else if ((view === "count" || view === "dormant") && !hasSheet) work = <Empty text="ยังไม่ได้เริ่มนับวันนี้" />;
  else if (view === "count" || view === "dormant")
    work = (
      <CountSheet
        key={`${branchId}-${date}-${view}`}
        lines={view === "dormant" ? dormant : active}
        zoned={view === "count" && !customOrder}
        locked={locked}
        salesIn={salesIn}
        saveState={dsc.saveState}
        onCount={dsc.updatePhysicalCount}
        onWaste={dsc.updateWaste}
        onOpenCard={setCardSku}
        onZoneChange={() => branchId && dsc.refreshCounts(branchId, date)}
        onDone={() => go("review")}
      />
    );
  else if (view === "review")
    work = (
      <CountReview
        lines={active.map((l) => ({ ...l, big: isBigDifference(l.row, l.sku.packSize || 1) }))}
        dormant={dormant}
        monthEnd={!!monthEnd}
        salesIn={salesIn}
        locked={locked}
        busy={finishing}
        onCount={dsc.updatePhysicalCount}
        onZeroDormant={() => dsc.setZero(dormant.filter((l) => l.row.physicalCount === null).map((l) => l.row.id))}
        onFinish={finish}
        onBack={() => go("count")}
      />
    );
  else if (view === "arrange")
    work = (
      <CountArrange
        skus={ordered.map((l) => l.sku)}
        initial={ordered.map((l) => l.sku.id)}
        saving={savingOrder}
        onSave={saveOrder}
        onCancel={() => go("count")}
        onReset={resetOrder}
        hasCustom={!!customOrder}
      />
    );

  const isHome = view === "";
  const cardRow = cardSku ? dsc.rows.find((r) => r.skuId === cardSku) : undefined;
  const cardSkuObj = cardSku ? skuMap.get(cardSku) : undefined;

  return (
    <div className="flex flex-col gap-4">
      <div className={cn("flex flex-wrap items-end gap-3", !isHome && "hidden lg:flex")}>
        <div className="mr-auto">
          <h1 className="text-2xl font-bold">นับสต๊อก</h1>
          <p className="text-sm text-muted-foreground">
            {branch ? `${branch.branchName} · ` : ""}
            {thaiDay(date)}
            {date !== today && <span className="ml-1 font-semibold text-warning">(ไม่ใช่วันนี้)</span>}
          </p>
        </div>
        {!lockedBranch && activeBranches.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            {activeBranches.map((b) => (
              <button
                key={b.id}
                type="button"
                aria-pressed={b.id === branchId}
                onClick={() => {
                  setPicked(b.id);
                  try {
                    localStorage.setItem(LAST_BRANCH_KEY, b.id);
                  } catch {
                    // remembered only on this device
                  }
                  go("", true);
                }}
                className={cn("min-h-[40px] rounded-full border px-4 text-sm", b.id === branchId ? "border-primary bg-primary font-semibold text-primary-foreground" : "border-border bg-card")}
              >
                {b.branchName}
              </button>
            ))}
          </div>
        )}
        <label className="flex flex-col text-sm">
          <span className="text-muted-foreground">วันที่นับ</span>
          <Input type="date" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} className="h-10 w-[160px]" />
        </label>
        {hasSheet && (
          <Button variant="outline" className="h-10" onClick={() => setPrintOpen(true)}>
            <Printer className="h-4 w-4" /> พิมพ์ใบนับ
          </Button>
        )}
        {hasSheet && canEdit && (
          <Button variant="outline" className="h-10" onClick={() => go("arrange")}>
            <GripVertical className="h-4 w-4" /> จัดลำดับ
          </Button>
        )}
        {finished && isManagement && (
          <Button variant="outline" className="h-10" onClick={() => branchId && dsc.unlockSheet(branchId, date).then(reloadStatus)}>
            <Unlock className="h-4 w-4" /> ปลดล็อก
          </Button>
        )}
        <Button variant="outline" className="h-10" onClick={guide.start}>
          <HelpCircle className="h-4 w-4" /> วิธีใช้
        </Button>
      </div>

      {/* Side by side only on wide screens (split = 1440px): below that the panel and the
          count are one at a time, so the table gets the room (a 1280px laptop has ~960px) */}
      <div className={"grid grid-cols-1 gap-6 split:grid-cols-[320px_minmax(0,1fr)]"}>
        <div className={cn("min-w-0 max-w-2xl split:max-w-none", !isHome && "hidden split:block")}>
          {branchId && (
            <CountHome
              date={date}
              status={status}
              statusLoading={statusLoading}
              hasSheet={hasSheet}
              finished={finished}
              zoneProgress={zoneProgress}
              dormantCount={dormant.length}
              monthEnd={monthEnd}
              canEdit={canEdit}
              starting={starting || (dsc.loading && !hasSheet) || !baseReady}
              onStart={start}
              onGoSales={() => onNavigate("sales-entry")}
              onGoReceive={() => onNavigate("branch-receipt")}
              onFinishOpenDays={finishOpenDays}
              onOpenDay={(d) => {
                setDate(d);
                go("review");
              }}
              onShowDormant={() => go("dormant")}
            />
          )}
        </div>
        <div className={cn("min-w-0", isHome && "hidden lg:block")}>
          {/* Under 1440px the left panel folds into this bar so the table keeps every column */}
          {!isHome && (
            <>
              <button type="button" onClick={() => go("")} className="-ml-2 mb-2 inline-flex min-h-[44px] items-center gap-1 rounded-full px-2 text-sm text-muted-foreground hover:text-foreground lg:hidden">
                <ArrowLeft className="h-4 w-4" /> นับสต๊อก · {thaiDay(date)}
              </button>
              {branchId && (
                <div className="hidden lg:block split:hidden">
                  <CountStrip
                    date={date}
                    status={status}
                    statusLoading={statusLoading}
                    zoneProgress={zoneProgress}
                    hasSheet={hasSheet}
                    onGoSales={() => onNavigate("sales-entry")}
                    onGoReceive={() => onNavigate("branch-receipt")}
                    onOpenPanel={() => go("")}
                  />
                </div>
              )}
            </>
          )}
          {work ?? (
            <div className="hidden min-h-[320px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-card p-8 text-center split:flex">
              <p className="font-medium">{finished ? "วันนี้นับเสร็จแล้ว" : hasSheet ? "กด “นับต่อ” ทางซ้าย" : "เช็คให้ครบ แล้วกด “เริ่มนับ” ทางซ้าย"}</p>
            </div>
          )}
        </div>
      </div>

      {cardSkuObj && (
        <StockCard
          skuId={cardSkuObj.id}
          skuType={cardSkuObj.type as "RM" | "SM"}
          sku={cardSkuObj}
          skus={skus}
          currentStock={cardRow?.calculatedBalance ?? 0}
          stockValue={0}
          onClose={() => setCardSku(null)}
          context="branch"
          branchId={branchId ?? undefined}
          disableMismatchCheck
        />
      )}
      <CountPrint open={printOpen} onClose={() => setPrintOpen(false)} branchName={branch?.branchName ?? ""} date={date} rows={ordered.map((l) => l.row)} skuMap={skuMap} />
      <GuideTour steps={GUIDE} open={guide.open} onClose={guide.close} />
      <ConfirmDialog
        open={monthEndWarn !== null}
        onOpenChange={(o) => !o && setMonthEndWarn(null)}
        title="วันปิดเดือนยังนับไม่ครบ"
        description={`${(monthEndWarn ?? []).map(thaiDay).join(", ")} อยู่ในช่วงปิดเดือน แต่ยังนับไม่ครบทุกตัว ถ้าปิดไป ต้นทุนอาหารของเดือนนี้จะคลาด ถ้ายังเป็นวันนี้อยู่ ให้กลับไปนับให้ครบก่อน`}
        confirmLabel="ปิดไปเลย"
        cancelLabel="กลับไปนับ"
        variant="warning"
        onConfirm={async () => {
          setMonthEndWarn(null);
          await closeOpenDays();
        }}
      />
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">{text}</div>;
}
