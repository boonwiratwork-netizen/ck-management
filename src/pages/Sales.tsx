import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { addDays, format } from "date-fns";
import { ArrowLeft, HelpCircle, Plus } from "lucide-react";
import type { Branch } from "@/types/branch";
import type { Menu } from "@/types/menu";
import type { ModifierRule } from "@/types/modifier-rule";
import { useAuth } from "@/hooks/use-auth";
import { useSalesData, type SalesData } from "@/hooks/use-sales-data";
import { dayWrites, defaultMode, isReadable, planDays, readWithEachFormat, type DayMode, type DayPlan, type ReadResult } from "@/lib/sales-import";
import { DayStrip, MonthCalendar, RecentDays } from "@/components/sales/SalesDays";
import { CheckView, ImportCard, ProfilesDialog } from "@/components/sales/SalesImport";
import { SalesDay } from "@/components/sales/SalesDay";
import { SalesManual } from "@/components/sales/SalesManual";
import { GuideTour, useGuide, type GuideStep } from "@/components/GuideTour";
import { baht } from "@/components/receive/parts";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Props {
  branches: Branch[];
  menus: Menu[];
  modifierRules: ModifierRule[];
  /** Dev harness only: an in-memory stand-in for the database layer */
  demoData?: SalesData;
}

const LAST_BRANCH_KEY = "ck-sales-branch";

const GUIDE: GuideStep[] = [
  {
    title: "หน้ายอดขายแบบใหม่",
    body: "ทำงานเหมือนเดิม คือเอายอดขายจาก POS เข้าระบบวันละครั้ง แต่ดูง่ายขึ้นและกันพลาดมากขึ้น ใช้เวลาอ่านไม่ถึงนาที",
  },
  {
    target: "days",
    title: "ดูว่าวันไหนยังไม่มียอด",
    body: (
      <>
        จุดเขียว = มียอดแล้ว · <b className="text-warning">กรอบส้ม “ขาด”</b> = วันที่ผ่านมาแล้วแต่ยังไม่มียอดในระบบ ให้เอายอดวันนั้นเข้าด้วย ไม่งั้นสต๊อกและต้นทุนอาหารจะคลาด กดที่วันเพื่อดูรายการของวันนั้น
      </>
    ),
  },
  {
    target: "import",
    title: "วางยอดจาก POS ที่นี่",
    body: "คัดลอกรายงานยอดขายจาก POS แล้ววาง หรือเลือกไฟล์ CSV ไม่ต้องเลือกรูปแบบ POS แล้ว ระบบดูให้เอง วางหลายวันพร้อมกันก็ได้",
  },
  {
    target: "check",
    title: "กดตรวจก่อน แล้วค่อยบันทึก",
    body: "ระบบสรุปยอดแยกรายวันให้ดูก่อน วันที่มีในระบบแล้วจะข้ามให้เอง ไม่บันทึกซ้ำ ถ้าวางผิดหน้า ระบบจะบอกและไม่บันทึก",
  },
  {
    target: "add",
    title: "ขายนอก POS กด “เพิ่มเอง”",
    body: "ใช้กับของที่ไม่ได้ขายผ่าน POS หรือแถวที่ POS ไม่มีรหัสเมนู เลือกเมนู ตัวเลือก จำนวน แล้วบันทึก",
  },
  {
    target: "saved",
    title: "แก้หรือลบรายการ",
    body: "กดที่วัน แล้วกดปุ่มดินสอที่รายการที่ต้องการแก้ ปุ่มลบอยู่ในหน้าต่างแก้ไข",
  },
  {
    title: "ดูคำแนะนำนี้อีกครั้งได้",
    body: "กดปุ่ม “วิธีใช้” มุมขวาบนของหน้านี้เมื่อไหร่ก็ได้",
  },
];

/**
 * Sales: bring the POS export in once a day, see which days are missing, look back
 * at any day's bills. The URL hash holds the screen: "" home, "day/<date>",
 * "check" (after reading a paste), "add" (manual entry).
 */
export default function SalesPage({ branches, menus, modifierRules, demoData }: Props) {
  const { isManagement, isStoreManager, profile } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const view = decodeURIComponent(location.hash.slice(1));
  const go = (v: string, replace = false) => navigate({ pathname: location.pathname, hash: v ? `#${v}` : "" }, { replace });
  const guide = useGuide("sales-v2");

  // ── Branch ──
  const activeBranches = useMemo(() => branches.filter((b) => b.status === "Active"), [branches]);
  const lockedBranch = isStoreManager && profile?.branch_id ? profile.branch_id : null;
  const [pickedBranch, setPickedBranch] = useState<string>(() => {
    try {
      return localStorage.getItem(LAST_BRANCH_KEY) || "";
    } catch {
      return "";
    }
  });
  const branchId =
    lockedBranch ??
    (activeBranches.length === 0 ? pickedBranch : activeBranches.some((b) => b.id === pickedBranch) ? pickedBranch : activeBranches[0].id);
  const branch = branches.find((b) => b.id === branchId);
  // The dev harness has no sign-in; it acts as management
  const canEdit = !!demoData || isManagement || isStoreManager;
  const canBulk = !!demoData || isManagement;

  // ── Dates ──
  const today = format(new Date(), "yyyy-MM-dd");
  const [month, setMonth] = useState(today.slice(0, 7));
  const stripFrom = format(addDays(new Date(), -13), "yyyy-MM-dd");
  // Totals cover the 14-day strip and the month on screen, always up to today
  const from = `${month}-01` < stripFrom ? `${month}-01` : stripFrom;
  const day = view.startsWith("day/") ? view.slice(4) : null;
  const [latest, setLatest] = useState<string | null>(null);
  // With nothing picked, computers show the newest saved day on the right
  const openDay = day ?? (view === "" ? latest : null);

  const live = useSalesData({ branchId: demoData ? null : branchId || null, from, to: today, day: openDay });
  const data = demoData ?? live;
  const newest = latestDay(data.days);
  if (newest !== latest) setLatest(newest);

  // ── Import ──
  const [reads, setReads] = useState<ReadResult[]>([]);
  const [pick, setPick] = useState(0);
  const [plans, setPlans] = useState<DayPlan[]>([]);
  const [modes, setModes] = useState<Record<string, DayMode>>({});
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [profilesOpen, setProfilesOpen] = useState(false);
  // Bumped after a save so the paste box starts empty again
  const [importKey, setImportKey] = useState(0);
  const menuCodes = useMemo(() => new Set(menus.map((m) => m.menuCode)), [menus]);

  const planFor = async (r: ReadResult | undefined) => {
    if (!isReadable(r)) {
      setPlans([]);
      return true;
    }
    const existing = await data.existingOn([...new Set(r!.rows.map((x) => x.saleDate))]);
    if (!existing) return false;
    const p = planDays(r!.rows, existing);
    setPlans(p);
    setModes(Object.fromEntries(p.map((d) => [d.date, defaultMode(d)])));
    return true;
  };
  const check = async (text: string, source: "paste" | "csv") => {
    if (!data.profiles.length) {
      toast.error("ยังไม่มีรูปแบบ POS ให้ตั้งรูปแบบก่อน");
      setProfilesOpen(true);
      return;
    }
    setChecking(true);
    const r = readWithEachFormat(text, data.profiles, menuCodes, source);
    setReads(r);
    setPick(0);
    const ok = await planFor(r[0]);
    setChecking(false);
    if (ok) go("check");
  };
  const save = async () => {
    if (!branchId) return;
    setSaving(true);
    const writes = plans.map((p) => ({ date: p.date, ...dayWrites(branchId, p, modes[p.date] ?? "add") })).filter((w) => w.insert.length || w.deleteIds.length);
    const res = await data.saveImport(writes);
    setSaving(false);
    await data.reloadDays();
    if (!res.failedDay) {
      toast.success(`บันทึกยอดขาย ${res.inserted.toLocaleString()} รายการแล้ว`);
      setReads([]);
      setPlans([]);
      setImportKey((k) => k + 1);
      go("", true);
    }
  };

  // ── Screens ──
  const brandMenus = useMemo(() => menus.filter((m) => m.status === "Active" && (!branch || m.brandName === branch.brandName)), [menus, branch]);
  const workOpen = view !== "";
  let work: React.ReactNode;
  if (!branchId) work = <Empty text="ยังไม่มีสาขาที่เปิดอยู่" />;
  else if (view === "check")
    work = reads.length ? (
      <CheckView
        reads={reads}
        pick={pick}
        onPick={async (i) => {
          setPick(i);
          setChecking(true);
          await planFor(reads[i]);
          setChecking(false);
        }}
        plans={plans}
        modes={modes}
        onMode={(d, m) => setModes((x) => ({ ...x, [d]: m }))}
        saving={saving || checking}
        onSave={save}
        onAgain={() => go("", true)}
      />
    ) : (
      <Empty text="ยังไม่ได้วางข้อมูล กลับไปวางข้อมูลจาก POS ก่อน" />
    );
  else if (view === "add")
    work = canEdit ? (
      <SalesManual
        key={branchId}
        branchId={branchId}
        menus={brandMenus}
        rules={modifierRules}
        today={today}
        defaultDate={day ?? today}
        onSave={async (row) => {
          const ok = await data.addLine(row);
          if (ok) {
            toast.success("เพิ่มแล้ว");
            data.reloadDays();
          }
          return ok;
        }}
      />
    ) : (
      <Empty text="บัญชีนี้เพิ่มรายการเองไม่ได้" />
    );
  else {
    const d = openDay ?? today;
    work = (
      <SalesDay
        key={`${branchId}-${d}`}
        date={d}
        today={today}
        lines={openDay ? data.lines : []}
        loading={openDay ? data.linesLoading : data.daysLoading}
        summary={data.days.get(d)}
        branchName={branch?.branchName ?? ""}
        canEdit={canEdit}
        canBulk={canBulk}
        onUpdate={async (id, patch) => {
          const ok = await data.updateLine(id, patch);
          if (ok) {
            data.reloadDays();
            if (patch.sale_date && patch.sale_date !== d) data.reloadLines();
          }
          return ok;
        }}
        onDelete={async (ids) => {
          const ok = await data.deleteLines(ids);
          if (ok) data.reloadDays();
          return ok;
        }}
        onAdd={() => go("add")}
      />
    );
  }

  const todaySum = data.days.get(today);
  return (
    <div className="flex flex-col gap-4">
      <div className={cn("flex flex-wrap items-end gap-3", workOpen && "hidden lg:flex")}>
        <div className="mr-auto">
          <h1 className="text-2xl font-bold">ยอดขาย</h1>
          <p className="text-sm text-muted-foreground">{branch ? `${branch.branchName} · ${branch.brandName}` : "เลือกสาขา"}</p>
        </div>
        {!lockedBranch && activeBranches.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            {activeBranches.map((b) => (
              <button
                key={b.id}
                type="button"
                aria-pressed={b.id === branchId}
                onClick={() => {
                  setPickedBranch(b.id);
                  try {
                    localStorage.setItem(LAST_BRANCH_KEY, b.id);
                  } catch {
                    // remembered only on this device; fine without
                  }
                  setReads([]);
                  go("", true);
                }}
                className={cn("min-h-[40px] rounded-full border px-4 text-sm", b.id === branchId ? "border-primary bg-primary font-semibold text-primary-foreground" : "border-border bg-card")}
              >
                {b.branchName}
              </button>
            ))}
          </div>
        )}
        <Button variant="outline" className="h-10" onClick={guide.start}>
          <HelpCircle className="h-4 w-4" /> วิธีใช้
        </Button>
        {canEdit && (
          <Button data-tour="add" variant="outline" className="h-10" onClick={() => go("add")}>
            <Plus className="h-4 w-4" /> เพิ่มเอง
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[380px_minmax(0,1fr)]">
        <div className={cn("flex min-w-0 flex-col gap-4", workOpen && "hidden lg:flex")}>
          {branchId ? (
            <>
              <div className="lg:hidden">
                <DayStrip today={today} days={data.days} loading={data.daysLoading} selected={day} onPick={(d) => go(`day/${d}`)} />
              </div>
              <ImportCard key={importKey} busy={checking} onCheck={check} onProfiles={() => setProfilesOpen(true)} />
              {todaySum && (
                <p className="px-1 text-sm text-muted-foreground">
                  วันนี้บันทึกแล้ว {todaySum.lines} รายการ · <span className="font-mono">{baht(todaySum.total)}</span>
                </p>
              )}
              <div className="hidden lg:block">
                <MonthCalendar month={month} onMonth={setMonth} today={today} days={data.days} loading={data.daysLoading} selected={day} onPick={(d) => go(`day/${d}`)} />
              </div>
              <div className="lg:hidden">
                <RecentDays days={data.days} onPick={(d) => go(`day/${d}`)} />
              </div>
            </>
          ) : (
            <Empty text="ยังไม่มีสาขาที่เปิดอยู่" />
          )}
        </div>
        <div data-tour="saved" className={cn("min-w-0", !workOpen && "hidden lg:block")}>
          {workOpen && (
            <button type="button" onClick={() => go("")} className="-ml-2 mb-2 inline-flex min-h-[44px] items-center gap-1 rounded-full px-2 text-sm text-muted-foreground hover:text-foreground lg:hidden">
              <ArrowLeft className="h-4 w-4" /> ยอดขาย
            </button>
          )}
          {work}
        </div>
      </div>

      <ProfilesDialog open={profilesOpen} onClose={() => setProfilesOpen(false)} profiles={data.profiles} onSave={data.saveProfile} onDelete={data.deleteProfile} />
      <GuideTour steps={GUIDE} open={guide.open && !workOpen} onClose={guide.close} />
    </div>
  );
}

const latestDay = (days: Map<string, unknown>) => [...days.keys()].sort().pop() ?? null;

function Empty({ text }: { text: string }) {
  return <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">{text}</div>;
}

