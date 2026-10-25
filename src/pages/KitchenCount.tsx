import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { endOfMonth, format, subMonths } from "date-fns";
import { HelpCircle } from "lucide-react";
import type { SKU } from "@/types/sku";
import type { BOMHeader, BOMLine } from "@/types/bom";
import type { useStockCountData } from "@/hooks/use-stock-count-data";
import { countSheetHtml, type SheetGroup } from "@/lib/count-sheet";
import { CountHome, CountReview, CountSheet, TYPES, isBigDiff, type CountType, type SessionSummary } from "@/components/kitchen-count/CountViews";
import { GuideTour, useGuide, type GuideStep } from "@/components/GuideTour";
import { loadCountDayEvents } from "@/lib/count-day-moves";
import type { CountDayEvent, CountTiming } from "@/lib/count-anchor";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { thaiDay } from "@/components/sales/SalesDays";
import { toast } from "sonner";

const GUIDE: GuideStep[] = [
  {
    title: "นับสต๊อกครัว 3 ขั้น",
    body: (
      <>
        <b>1 พิมพ์ใบนับไปนับ</b> → <b>2 ใส่ตัวเลขตาม SM · RM · PK</b> → <b>3 ตรวจแล้วนับเสร็จ</b>
      </>
    ),
  },
  { target: "kc-due", title: "นับสิ้นเดือน", body: "พิมพ์ใบนับ A4 ไปนับได้ ลำดับในใบตรงกับในจอ" },
  { target: "kc-start", title: "ขั้น 1: แตะ “เริ่มนับ”", body: "ระบบเก็บยอดในระบบ ณ ตอนนี้ไว้เทียบ", until: "click" },
  { target: "kc-types", title: "เลือก SM · RM · PK", body: "ตัวเลขบอกว่านับไปกี่ตัวแล้ว กรองตามช่องเก็บได้" },
  { target: "kc-lines", title: "ขั้น 2: ใส่ตัวเลขที่นับได้", body: "กด Enter ไปตัวถัดไป · บันทึกให้เองทันที · ช่องว่าง = ยังไม่นับ", until: "enter" },
  { target: "kc-review", title: "ขั้น 3: แตะ “ตรวจแล้วนับเสร็จ”", body: "หน้าถัดไปบอกตัวที่ต่างมาก ให้เช็คก่อนจบ" },
];

interface Props {
  skus: SKU[];
  stockCountData: ReturnType<typeof useStockCountData>;
  getStdUnitPrice: (skuId: string) => number;
  bomHeaders: BOMHeader[];
  bomLines: BOMLine[];
  /** Management or CK manager (as before: count, confirm and delete) */
  canEdit: boolean;
  /** Dev demo only: stands in for reading the count day's movements */
  loadDayEvents?: typeof loadCountDayEvents;
}

const iso = (d: Date) => format(d, "yyyy-MM-dd");

/** A count within 3 days of a month end closes that month (counted on the 30th or the 1st still counts) */
const closes = (date: string, monthEnd: string) => Math.abs(new Date(date + "T00:00:00").getTime() - new Date(monthEnd + "T00:00:00").getTime()) <= 3 * 86400000;

/** The month-end count to do: last month's if it isn't done yet early in the month, else this month's */
function dueDateFor(done: string[]): string {
  const now = new Date();
  const prev = iso(endOfMonth(subMonths(now, 1)));
  if (now.getDate() <= 5 && !done.some((d) => closes(d, prev))) return prev;
  return iso(endOfMonth(now));
}

/**
 * The central kitchen's stock count (replaces StockCount): monthly, by SM / RM /
 * PK, from a printed A4 sheet. Hash: "" home, "c/<date>" counting, "r/<date>" review.
 */
export default function KitchenCountPage({ skus, stockCountData, getStdUnitPrice, bomHeaders, bomLines, canEdit, loadDayEvents = loadCountDayEvents }: Props) {
  const { sessions, createSession, updateLine, confirmSession, softDeleteSession, getLinesForSession, refreshSystemQty } = stockCountData;
  const location = useLocation();
  const navigate = useNavigate();
  const view = decodeURIComponent(location.hash.slice(1));
  const go = (v: string, replace = false) => navigate({ pathname: location.pathname, hash: v ? `#${v}` : "" }, { replace });
  const guide = useGuide("kitchen-count-v1");

  const skuMap = useMemo(() => new Map(skus.map((s) => [s.id, s])), [skus]);
  const skuOf = (id: string) => skuMap.get(id);
  // RM used in the recipe of an active SM ("เฉพาะของครัว", as before)
  const ckRmIds = useMemo(() => {
    const activeSm = new Set(skus.filter((s) => s.type === "SM" && s.status === "Active").map((s) => s.id));
    const headerIds = new Set(bomHeaders.filter((h) => activeSm.has(h.smSkuId)).map((h) => h.id));
    return new Set(bomLines.filter((l) => headerIds.has(l.bomHeaderId)).map((l) => l.rmSkuId));
  }, [skus, bomHeaders, bomLines]);
  // What a new count holds (same rule as the count itself)
  const candidates = useMemo(() => {
    const smWithBom = new Set(bomHeaders.map((h) => h.smSkuId));
    const rmInBom = new Set(bomLines.map((l) => l.rmSkuId));
    return skus.filter((s) => s.status === "Active" && ((s.type === "RM" && (rmInBom.has(s.id) || s.isDistributable)) || (s.type === "SM" && smWithBom.has(s.id)) || s.type === "PK"));
  }, [skus, bomHeaders, bomLines]);
  const totals = useMemo(() => Object.fromEntries(TYPES.map((t) => [t, candidates.filter((s) => s.type === t).length])) as Record<CountType, number>, [candidates]);

  const summaries = useMemo<SessionSummary[]>(
    () =>
      [...sessions]
        .sort((a, b) => b.date.localeCompare(a.date))
        .map((session) => {
          const ls = getLinesForSession(session.id);
          const counted = ls.filter((l) => l.physicalQty !== null);
          return { session, counted: counted.length, total: ls.length, value: counted.reduce((s, l) => s + l.variance * getStdUnitPrice(l.skuId), 0), big: ls.filter(isBigDiff).length };
        }),
    [sessions, getLinesForSession, getStdUnitPrice],
  );
  const dueDate = dueDateFor(sessions.filter((s) => s.status === "Completed").map((s) => s.date));
  // The month's count, if one was made near the month end (else none yet)
  const due = summaries.find((s) => s.session.date === dueDate) ?? summaries.find((s) => closes(s.session.date, dueDate)) ?? null;

  const openDate = view.startsWith("c/") || view.startsWith("r/") ? view.slice(2) : null;
  const session = openDate ? sessions.find((s) => s.date === openDate) ?? null : null;
  const lines = session ? getLinesForSession(session.id) : [];

  // ── Printing the A4 sheet ──
  const print = () => {
    const source: { skuId: string; type: string }[] = session ? lines.map((l) => ({ skuId: l.skuId, type: l.type })) : candidates.map((s) => ({ skuId: s.id, type: s.type }));
    const groups: SheetGroup[] = TYPES.map((t) => ({
      type: t,
      items: source
        .filter((x) => x.type === t)
        .map((x) => {
          const s = skuOf(x.skuId);
          return { code: s?.skuId ?? "", name: s?.name ?? "", unit: s?.usageUom ?? "", storage: s?.storageCondition ?? "" };
        }),
    }));
    const html = countSheetHtml({ title: "นับสต๊อกครัวกลาง", dateText: thaiDay(session?.date ?? dueDate), groups }).replace("</body>", "<script>window.onload=function(){window.print()}</script></body>");
    const w = window.open("", "_blank", "width=900,height=1000");
    if (!w) {
      toast.error("เบราว์เซอร์บล็อกหน้าต่างพิมพ์ ลองอนุญาตป๊อปอัป");
      return;
    }
    w.document.write(html);
    w.document.close();
  };

  // ── Actions ──
  const [busy, setBusy] = useState(false);
  const open = async (date: string) => {
    if (!sessions.some((s) => s.date === date)) {
      if (!canEdit) return;
      setBusy(true);
      const id = await createSession(date, "");
      setBusy(false);
      if (!id) return;
    }
    go(`c/${date}`);
  };
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [refreshed, setRefreshed] = useState<Set<string>>(new Set());

  // The count day's movements, read when the review opens (asked about before finishing)
  const reviewing = !!session && view.startsWith("r/") && session.status === "Draft";
  const [dayEvents, setDayEvents] = useState<{ date: string; events: CountDayEvent[] } | null>(null);
  const [timing, setTiming] = useState<CountTiming | null>(null);
  useEffect(() => {
    if (!reviewing || !session) return;
    let cancelled = false;
    setDayEvents(null);
    setTiming(null);
    loadDayEvents(session.date, skuOf).then((events) => {
      // A failed read doesn't hold the count up: it finishes as before (no question)
      if (!cancelled) setDayEvents({ date: session.date, events: events ?? [] });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewing, session?.date]);
  const events = dayEvents && session && dayEvents.date === session.date ? dayEvents.events : undefined;

  let work: React.ReactNode;
  if (openDate && !session) work = <Empty text="ไม่พบใบนับของวันนี้" onBack={() => go("", true)} />;
  else if (session && view.startsWith("r/") && canEdit && session.status === "Draft")
    work = (
      <CountReview
        session={session}
        lines={lines}
        skuOf={skuOf}
        priceOf={getStdUnitPrice}
        busy={busy}
        events={events}
        timing={timing}
        onTiming={setTiming}
        onBack={() => go(`c/${session.date}`, true)}
        onFix={() => go(`c/${session.date}`, true)}
        onConfirm={async () => {
          if (busy || events === undefined || (events.length > 0 && !timing)) return;
          setBusy(true);
          // Nothing moved on the count day (or the list couldn't be read): "after" — what's
          // entered from now on is added, nothing before it
          const ok = await confirmSession(session.id, events.length ? timing : "after");
          setBusy(false);
          if (!ok) return;
          toast.success("นับเสร็จแล้ว สต๊อกในระบบเปลี่ยนตามที่นับ");
          go("", true);
        }}
      />
    );
  else if (session)
    work = (
      <CountSheet
        session={session}
        lines={lines}
        skuOf={skuOf}
        ckRmIds={ckRmIds}
        priceOf={getStdUnitPrice}
        canEdit={canEdit}
        canDelete={canEdit}
        onBack={() => go("", true)}
        onCount={(l, v) => updateLine(l.id, v)}
        onNote={(l, note) => updateLine(l.id, l.physicalQty, note)}
        refreshed={refreshed.has(session.id)}
        onRefresh={async () => {
          if (busy) return;
          setBusy(true);
          const ok = await refreshSystemQty(session.id);
          setBusy(false);
          if (ok) {
            setRefreshed((p) => new Set(p).add(session.id));
            toast.success("อัปเดตยอดระบบแล้ว");
          }
        }}
        onPrint={print}
        onReview={() => go(`r/${session.date}`)}
        onDelete={() => setConfirmDelete(true)}
      />
    );
  else
    work = (
      <CountHome
        dueDate={dueDate}
        due={due}
        summaries={summaries}
        totals={totals}
        canEdit={canEdit}
        busy={busy}
        onStart={() => open(dueDate)}
        onOpen={(d) => go(`c/${d === dueDate && due ? due.session.date : d}`)}
        onPrint={print}
        onOther={open}
      />
    );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <h1 className="mr-auto text-2xl font-bold">นับสต๊อกครัวกลาง</h1>
        <Button
          variant="outline"
          className="h-10"
          onClick={() => {
            go("", true);
            guide.start();
          }}
        >
          <HelpCircle className="h-4 w-4" /> วิธีใช้
        </Button>
      </div>
      {work}
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`ลบใบนับ ${session ? thaiDay(session.date) : ""}?`}
        description={session?.status === "Completed" ? "ตัวเลขที่ปรับจากการนับครั้งนี้จะถูกคืนกลับ" : "ตัวเลขที่ใส่ไว้ในใบนี้จะหายไป"}
        confirmLabel="ลบ"
        cancelLabel="ไม่ใช่"
        variant="destructive"
        onConfirm={async () => {
          setConfirmDelete(false);
          if (!session) return;
          await softDeleteSession(session.id);
          toast.success("ลบใบนับแล้ว");
          go("", true);
        }}
      />
      <GuideTour steps={GUIDE} open={guide.open} onClose={guide.close} />
    </div>
  );
}

function Empty({ text, onBack }: { text: string; onBack: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
      {text}
      <Button variant="outline" className="h-10" onClick={onBack}>
        กลับ
      </Button>
    </div>
  );
}
