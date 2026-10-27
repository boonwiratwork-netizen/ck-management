import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { addDays, endOfMonth, format, startOfMonth, subMonths } from "date-fns";
import { HelpCircle } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useBranchData } from "@/hooks/use-branch-data";
import { useSkuData } from "@/hooks/use-sku-data";
import { useTransferOrder, type PendingTR, type TOHistoryRow, type TOLine } from "@/hooks/use-transfer-order";
import { useTransferLots } from "@/hooks/use-transfer-lots";
import { packsAfterWeight, packsOf } from "@/lib/transfer-lines";
import { DeclineDialog, PackSheet, isPackLine, useSendCheck, type PackForm } from "@/components/transfer/PackSheet";
import { ReviewSend, SentDone, TransferHistory, TransferHome, printSlip, sentMessage, type Kind, type OrderDetail, type SlipLine } from "@/components/transfer/TransferViews";
import { SkuPicker } from "@/components/receive/parts";
import { GuideTour, useGuide, type GuideStep } from "@/components/GuideTour";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const GUIDE: GuideStep[] = [
  {
    title: "โอนสินค้า 3 ขั้น",
    body: (
      <>
        <b>1 แตะเริ่มจัดของ</b> → <b>2 ใส่จำนวนแพ็คที่หยิบจริง</b> → <b>3 ตรวจแล้วส่ง</b> ทุกช่องบันทึกให้เองทันที ไม่ต้องกดบันทึกร่าง
      </>
    ),
  },
  { target: "to-queue", title: "ใบขอเบิกที่รอจัดส่ง", body: "เรียงตามวันที่สาขาต้องการ ใบที่ต้องการวันนี้มีแถบแดง" },
  { target: "to-start", title: "ขั้น 1: แตะ “เริ่มจัดของ”", body: "ระบบใส่จำนวนตามที่สาขาขอไว้ให้แล้ว", until: "click" },
  {
    target: "to-lines",
    title: "ขั้น 2: ใส่จำนวนที่หยิบจริง",
    body: (
      <>
        <b>ส่งกี่แพ็ค</b> กด − / + หรือพิมพ์ · <b>น้ำหนักจริง</b> ใส่เฉพาะตอนชั่งแล้วไม่ตรง · กด Enter ไปช่องถัดไป · ของไม่มีให้กด <b>ส่งไม่ได้</b> แล้วเลือกเหตุผล
      </>
    ),
  },
  { target: "to-lot", title: "ล็อตเลือกให้แล้ว", body: "ระบบหยิบจากล็อตเก่าสุดที่ยังเหลือให้ แตะเพื่อแก้เฉพาะตอนหยิบจริงไม่ตรง" },
  { target: "to-review", title: "ขั้น 3: แตะ “ตรวจแล้วส่ง”", body: "หน้าถัดไปสรุปเรื่องที่ต้องดู แล้วกด “ส่งให้สาขา”", until: "click" },
  { target: "to-send", title: "ส่งให้สาขา", body: "ส่งแล้วพิมพ์ใบโอนแนบไปกับของได้ สาขาจะเห็นในหน้ารับของทันที" },
];

const today = () => format(new Date(), "yyyy-MM-dd");
type RangeKey = "7" | "30" | "this" | "last";
function rangeOf(k: RangeKey) {
  const now = new Date();
  if (k === "7") return { from: format(addDays(now, -6), "yyyy-MM-dd"), to: format(now, "yyyy-MM-dd"), label: "7 วัน" };
  if (k === "30") return { from: format(addDays(now, -29), "yyyy-MM-dd"), to: format(now, "yyyy-MM-dd"), label: "30 วัน" };
  if (k === "this") return { from: format(startOfMonth(now), "yyyy-MM-dd"), to: format(now, "yyyy-MM-dd"), label: "เดือนนี้" };
  const last = subMonths(now, 1);
  return { from: format(startOfMonth(last), "yyyy-MM-dd"), to: format(endOfMonth(last), "yyyy-MM-dd"), label: "เดือนก่อน" };
}

/**
 * The central kitchen sends what branches asked for (replaces TransferOrder).
 * Screens by hash: "" home, "pack", "review", "done", "history".
 */
export default function TransferPage({ getBomCostPerGram, refreshSmStock }: { getBomCostPerGram: (skuId: string) => number; refreshSmStock?: () => void }) {
  const { isManagement, isCkManager, user } = useAuth();
  const { branches } = useBranchData();
  const { skus } = useSkuData();
  const to = useTransferOrder(getBomCostPerGram);
  const location = useLocation();
  const navigate = useNavigate();
  const view = decodeURIComponent(location.hash.slice(1));
  const go = (v: string, replace = false) => navigate({ pathname: location.pathname, hash: v ? `#${v}` : "" }, { replace });
  const guide = useGuide("transfer-v1");
  const canEdit = isManagement || isCkManager;

  const skuMap = useMemo(() => new Map(skus.map((s) => [s.id, s])), [skus]);
  const skuOf = useCallback((id: string) => skuMap.get(id), [skuMap]);
  const activeBranches = useMemo(() => branches.filter((b) => b.status === "Active"), [branches]);

  const [profileId, setProfileId] = useState<string | null>(null);
  useEffect(() => {
    if (!user) return;
    supabase
      .from("profiles")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => data && setProfileId(data.id));
  }, [user]);

  // ─── The order being packed ───
  const [form, setForm] = useState<PackForm | null>(null);
  const lots = useTransferLots(form?.toId ?? null, form?.lines ?? [], skus, !!form?.isEditingSent);
  const emptyForm: PackForm = { toId: "", toNumber: "", branchId: "", branchName: "", deliveryDate: today(), notes: "", lines: [], declined: [] };
  const check = useSendCheck(form ?? emptyForm, skuOf, lots);
  const [busy, setBusy] = useState(false);
  const [declining, setDeclining] = useState<TOLine | null>(null);
  const [adding, setAdding] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [done, setDone] = useState<{ toNumber: string; branchName: string; count: number; value: number; declined: { name: string; reason: string }[]; slip: Parameters<typeof printSlip>[0] } | null>(null);
  const setLine = (id: string, patch: Partial<TOLine>) => setForm((f) => (f ? { ...f, lines: f.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) } : f));

  // Leaving the pack screens without an order (reload, back button) goes home
  useEffect(() => {
    if ((view === "pack" || view === "review") && !form) go("", true);
    if (view === "done" && !done) go("", true);
  }, [view, form, done]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = async (base: Omit<PackForm, "declined" | "lines">, lines: TOLine[], trId?: string | null) => {
    const declined = trId ? await to.fetchDeclined(trId) : [];
    setForm({ ...base, lines, declined });
    go("pack");
  };

  const start = async (tr: PendingTR) => {
    if (busy) return; // a second tap must not start a second order
    setBusy(true);
    const res = await to.createTO({ trId: tr.trId, branchId: tr.branchId, deliveryDate: today(), profileId: profileId || undefined, trLines: tr.lines });
    if ("error" in res) {
      setBusy(false);
      toast.error(res.error);
      return;
    }
    await open(
      { toId: res.toId, toNumber: res.toNumber, branchId: tr.branchId, branchName: tr.branchName, deliveryDate: today(), notes: "", trId: tr.trId, trNumber: tr.trNumber, requiredDate: tr.requiredDate },
      res.lines,
      tr.trId,
    );
    setBusy(false);
  };

  const openDraft = async (row: { id: string; toNumber: string; branchId: string; branchName: string; trId: string | null }) => {
    const lines = await to.fetchTODetail(row.id);
    await open({ toId: row.id, toNumber: row.toNumber, branchId: row.branchId, branchName: row.branchName, deliveryDate: today(), notes: "", trId: row.trId ?? undefined }, lines, row.trId);
  };

  const editSent = async (row: TOHistoryRow) => {
    const lines = await to.fetchTODetail(row.id);
    await open(
      { toId: row.id, toNumber: row.toNumber, branchId: row.branchId, branchName: row.branchName, deliveryDate: row.deliveryDate, notes: row.notes, trId: row.trId ?? undefined, trNumber: row.trRef !== "—" ? row.trRef : undefined, isEditingSent: true },
      lines,
      row.trId,
    );
  };

  // ─── Typing on a line (saved straight away; a sent order is saved with its button) ───
  const save = (line: TOLine, actualQty: number, packsCount: number | null | undefined) => {
    setLine(line.id, { actualQty, lineValue: actualQty * line.unitCost, ...(packsCount !== undefined ? { packsCount } : {}) });
    if (form && !form.isEditingSent) to.updateTOLine(form.toId, line.id, actualQty, packsCount, line.unitCost);
  };
  const onPacks = (line: TOLine, packs: number) => {
    const ps = skuOf(line.skuId)?.packSize ?? 0;
    save(line, packs * ps, packs);
    lots.followPacks({ ...line, packsCount: packs, actualQty: packs * ps }, packs);
  };
  const onQty = (line: TOLine, qty: number) => {
    const ps = skuOf(line.skuId)?.packSize ?? 0;
    const packs = ps === 1 ? qty : undefined;
    save(line, qty, packs);
    // An SM counted in units still keeps its lots in step
    if (ps > 0) lots.followPacks({ ...line, actualQty: qty, packsCount: packs ?? line.packsCount }, packsOf({ actualQty: qty, packsCount: packs ?? null }, ps));
  };
  // The real weight never changes the pack count (5 packs weighing 2,005 g stay 5)
  const onWeight = (line: TOLine, grams: number) => save(line, grams, packsAfterWeight(line, skuOf(line.skuId)?.packSize ?? 0));
  const onNote = (line: TOLine, note: string) => {
    setLine(line.id, { note });
    if (form && !form.isEditingSent) to.updateTOLineNote(form.toId, line.id, note);
  };

  const decline = async (line: TOLine, reason: string) => {
    setDeclining(null);
    if (!form) return;
    await lots.settle(); // a lot save still on its way would block removing the line
    const ok = await to.deleteTOLine(form.toId, line.id, line.trLineId, reason, profileId);
    if (!ok) return;
    const t = skuOf(line.skuId)?.type;
    setForm((f) =>
      f
        ? {
            ...f,
            lines: f.lines.filter((l) => l.id !== line.id),
            declined: line.trLineId
              ? [...f.declined, { reason, line: { id: line.trLineId, skuId: line.skuId, skuCode: line.skuCode, skuName: line.skuName, uom: line.uom, requestedQty: line.plannedQty, skuType: t === "RM" ? "RM" : t === "PK" ? "PK" : "SM" } }]
              : f.declined,
          }
        : f,
    );
  };
  const [restoring, setRestoring] = useState<string | null>(null);
  const restore = async (d: PackForm["declined"][number]) => {
    if (!form || restoring) return;
    setRestoring(d.line.id);
    const line = await to.restoreTOLine(form.toId, d.line);
    setRestoring(null);
    if (line) setForm((f) => (f ? { ...f, lines: [...f.lines, line], declined: f.declined.filter((x) => x.line.id !== d.line.id) } : f));
  };

  // Products the kitchen can add: SM with a recipe, and RM/PK it hands out
  const [bomSkuIds, setBomSkuIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    supabase
      .from("bom_headers")
      .select("sm_sku_id")
      .then(({ data }) => data && setBomSkuIds(new Set(data.map((r: any) => r.sm_sku_id))));
  }, []);
  const addable = useMemo(
    () =>
      skus.filter(
        (s) =>
          s.status === "Active" &&
          ((s.type === "SM" && bomSkuIds.has(s.id)) || ((s.type === "RM" || s.type === "PK") && s.isDistributable)) &&
          !form?.lines.some((l) => l.skuId === s.id),
      ),
    [skus, bomSkuIds, form?.lines],
  );
  const add = async (skuId: string) => {
    setAdding(false);
    if (!form) return;
    const s = skuOf(skuId);
    if (!s) return;
    const line = await to.addTOLine(form.toId, s.id, s.skuId, s.name, s.usageUom);
    if (line) setForm((f) => (f ? { ...f, lines: [...f.lines, line] } : f));
  };

  // ─── Review → send ───
  const toReview = async () => {
    if (!form) return;
    if (form.isEditingSent) {
      setBusy(true);
      const ok = (await to.saveTOEdits(form.toId, form.lines)) && (await lots.commit());
      setBusy(false);
      if (ok) {
        refreshSmStock?.();
        setForm(null);
        go("history", true);
      }
      return;
    }
    go("review");
  };

  const slipOf = (f: PackForm): Parameters<typeof printSlip>[0] => ({
    toNumber: f.toNumber,
    branchName: f.branchName,
    date: f.deliveryDate,
    notes: f.notes,
    lines: f.lines
      .filter((l) => l.actualQty > 0)
      .map((l) => {
        const sku = skuOf(l.skuId);
        return { name: l.skuName, packs: isPackLine(sku) ? packsOf(l, sku!.packSize) : null, qty: l.actualQty, uom: l.uom, note: l.note };
      }),
    declined: f.declined.map((d) => ({ name: d.line.skuName, reason: d.reason })),
  });

  const send = async () => {
    if (!form || busy) return;
    setBusy(true);
    if (!(await lots.settle())) {
      setBusy(false);
      toast.error("บันทึกล็อตไม่ได้ ลองเปิดล็อตแล้วกดเติมอีกครั้ง");
      return;
    }
    // A line left at 0 isn't sent: a requested one counts as "ส่งไม่ได้" so the
    // branch sees it (a 0 on a sent order would read as the full request)
    let f = form;
    for (const l of form.lines.filter((x) => x.actualQty <= 0)) {
      const reason = "ครัวใส่ 0 ไม่ได้ส่ง";
      if (!(await to.deleteTOLine(form.toId, l.id, l.trLineId, reason, profileId))) {
        setBusy(false);
        return;
      }
      const t = skuOf(l.skuId)?.type;
      f = {
        ...f,
        lines: f.lines.filter((x) => x.id !== l.id),
        declined: l.trLineId
          ? [...f.declined, { reason, line: { id: l.trLineId, skuId: l.skuId, skuCode: l.skuCode, skuName: l.skuName, uom: l.uom, requestedQty: l.plannedQty, skuType: t === "RM" ? "RM" : t === "PK" ? "PK" : "SM" } }]
          : f.declined,
      };
    }
    if (f !== form) setForm(f);
    const res = await to.sendTO(f.toId, f.lines, f.notes, today());
    setBusy(false);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    f = { ...f, deliveryDate: today() };
    setDone({
      toNumber: f.toNumber,
      branchName: f.branchName,
      count: f.lines.filter((l) => l.actualQty > 0).length,
      value: f.lines.reduce((s, l) => s + l.actualQty * l.unitCost, 0),
      declined: f.declined.map((d) => ({ name: d.line.skuName, reason: d.reason })),
      slip: slipOf(f),
    });
    setForm(null);
    refreshSmStock?.();
    go("done", true);
  };

  const discardCurrent = async () => {
    setConfirmDiscard(false);
    if (!form) return;
    const n = await to.discardDrafts([form.toId]);
    if (n) {
      toast.success("ทิ้งใบนี้แล้ว");
      setForm(null);
      go("", true);
    }
  };

  // ─── Standalone order ───
  const [standalone, setStandalone] = useState<{ branchId: string; notes: string } | null>(null);
  const createStandalone = async () => {
    if (!standalone?.branchId) return;
    setBusy(true);
    const res = await to.createTO({ branchId: standalone.branchId, deliveryDate: today(), notes: standalone.notes, profileId: profileId || undefined });
    setBusy(false);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    const b = branches.find((x) => x.id === standalone.branchId);
    setStandalone(null);
    await open({ toId: res.toId, toNumber: res.toNumber, branchId: standalone.branchId, branchName: b?.branchName ?? "", deliveryDate: today(), notes: standalone.notes }, [], null);
    setAdding(true);
  };

  // ─── History ───
  const [branchIds, setBranchIds] = useState<string[]>([]);
  const [rangeKey, setRangeKey] = useState<RangeKey>("30");
  const [kind, setKind] = useState<Kind>("all");
  const range = rangeOf(rangeKey);
  const { fetchHistory } = to;
  const homeView = view === "";
  useEffect(() => {
    // Home always shows the last few days for every branch
    if (homeView) fetchHistory({ dateFrom: rangeOf("7").from });
    else if (view === "history") fetchHistory({ branchIds, dateFrom: range.from, dateTo: range.to });
  }, [homeView, view === "history", branchIds.join(","), rangeKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const [openId, setOpenId] = useState<string | undefined>();

  const recent = useMemo(() => {
    const since = format(addDays(new Date(), -2), "yyyy-MM-dd");
    return to.toHistory.filter((r) => r.status !== "Draft" && r.status !== "Cancelled" && r.updatedAt.slice(0, 10) >= since).slice(0, 6);
  }, [to.toHistory]);
  const standaloneDrafts = to.drafts.filter((d) => !d.trId);
  const staleDrafts = to.drafts.filter((d) => d.createdAt.slice(0, 10) < format(addDays(new Date(), -2), "yyyy-MM-dd"));

  const loadDetail = useCallback(
    async (row: TOHistoryRow): Promise<OrderDetail> => {
      const [lines, receipts, declined] = await Promise.all([
        to.fetchTODetail(row.id),
        supabase.from("branch_receipts").select("sku_id, qty_received").eq("transfer_order_id", row.id).order("id"),
        row.trId ? to.fetchDeclined(row.trId) : Promise.resolve([]),
      ]);
      const received = new Map<string, number>();
      for (const r of receipts.data || []) received.set(r.sku_id, (received.get(r.sku_id) || 0) + (Number(r.qty_received) || 0));
      return {
        lines,
        receivedBySku: row.status === "Received" || row.status === "Partially Received" ? received : null,
        declined: declined.map((d) => ({ name: d.line.skuName, qty: d.line.requestedQty, uom: d.line.uom, reason: d.reason })),
      };
    },
    [to.fetchTODetail, to.fetchDeclined], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const printRow = (row: TOHistoryRow, d: OrderDetail) =>
    printSlip({
      toNumber: row.toNumber,
      branchName: row.branchName,
      date: row.deliveryDate,
      notes: row.notes,
      lines: d.lines.map<SlipLine>((l) => {
        const sku = skuOf(l.skuId);
        return { name: l.skuName, packs: isPackLine(sku) ? packsOf(l, sku!.packSize) : null, qty: l.actualQty, uom: l.uom, note: l.note };
      }),
      declined: d.declined.map((x) => ({ name: x.name, reason: x.reason })),
    });
  const [cancelRow, setCancelRow] = useState<TOHistoryRow | null>(null);
  const [deleteRow, setDeleteRow] = useState<TOHistoryRow | null>(null);
  const reloadHistory = () => fetchHistory({ branchIds, dateFrom: range.from, dateTo: range.to });

  // ─── Screens ───
  let work: React.ReactNode = null;
  if (view === "pack" && form)
    work = (
      <PackSheet
        form={form}
        skuOf={skuOf}
        lots={lots}
        check={check}
        busy={busy}
        onPacks={onPacks}
        onQty={onQty}
        onWeight={onWeight}
        onNote={onNote}
        onDecline={setDeclining}
        onRestore={restore}
        restoring={restoring}
        onAdd={() => setAdding(true)}
        onBack={() => {
          setForm(null);
          go(form.isEditingSent ? "history" : "", true);
        }}
        onDiscard={() => setConfirmDiscard(true)}
        onNext={toReview}
      />
    );
  else if (view === "review" && form)
    work = (
      <ReviewSend
        packSizeOf={(id) => skuOf(id)?.packSize ?? 0}
        form={form}
        check={check}
        busy={busy}
        onNotes={(n) => setForm((f) => (f ? { ...f, notes: n } : f))}
        onNotesDone={(n) => to.updateTOHeader(form.toId, { notes: n })}
        onFix={(lineId) => {
          go("pack", true);
          setTimeout(() => {
            const el = document.getElementById(`to-line-${lineId}`) ?? document.getElementById(`to-line-m-${lineId}`);
            const visibleEl = [document.getElementById(`to-line-${lineId}`), document.getElementById(`to-line-m-${lineId}`)].find((e) => e && e.getBoundingClientRect().height > 0) ?? el;
            visibleEl?.scrollIntoView({ block: "center" });
            visibleEl?.querySelector("input")?.focus();
          }, 50);
        }}
        onFillLots={() => {
          for (const m of check.lotMismatch) {
            const l = form.lines.find((x) => x.id === m.lineId);
            if (l) lots.fillToPacks(l, m.packs);
          }
        }}
        onSend={send}
        onBack={() => go("pack", true)}
      />
    );
  else if (view === "done" && done) {
    const next = to.pendingTRs.find((p) => !p.draft) ?? to.pendingTRs[0];
    work = (
      <SentDone
        {...done}
        message={sentMessage(done.slip)}
        next={canEdit ? next : undefined}
        onNext={() => next && start(next)}
        onHome={() => go("", true)}
        onPrint={() => printSlip(done.slip)}
      />
    );
  } else if (view === "history")
    work = (
      <TransferHistory
        packSizeOf={(id) => skuOf(id)?.packSize ?? 0}
        rows={to.toHistory}
        loading={to.historyLoading}
        branches={activeBranches.map((b) => ({ id: b.id, name: b.branchName }))}
        branchIds={branchIds}
        onBranches={setBranchIds}
        range={range}
        onRange={setRangeKey}
        kind={kind}
        onKind={setKind}
        staleDrafts={staleDrafts.map((d) => ({ ...d, deliveryDate: "", trRef: "—", totalValue: 0, status: "Draft", updatedAt: d.createdAt, notes: "", hasLineNotes: false, kitchenShort: 0, branchShort: 0 }))}
        can={{ editSent: isCkManager || isManagement, cancel: isManagement, remove: isCkManager || isManagement, discard: canEdit }}
        loadDetail={loadDetail}
        onEditSent={editSent}
        onCancel={setCancelRow}
        onDelete={setDeleteRow}
        onDiscardDrafts={async () => {
          const n = await to.discardDrafts(staleDrafts.map((d) => d.id));
          if (n) toast.success(`ทิ้งใบที่จัดค้างไว้ ${n} ใบแล้ว`);
        }}
        onPrint={printRow}
        onBack={() => go("")}
        openId={openId}
      />
    );

  const isHome = !work;
  // Packing and checking use the whole width (the product table needs it)
  const wide = (view === "pack" || view === "review") && !!form;
  return (
    <div className="flex flex-col gap-4">
      <div className={cn("flex flex-wrap items-end gap-3", !isHome && "hidden", !isHome && !wide && "lg:flex")}>
        <div className="mr-auto">
          <h1 className="text-2xl font-bold">โอนสินค้าให้สาขา</h1>
          <p className="text-sm text-muted-foreground">ครัวกลาง · {format(new Date(), "d/M/yyyy")}</p>
        </div>
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

      <div className={cn("grid grid-cols-1 gap-6", !wide && "split:grid-cols-[340px_minmax(0,1fr)]")}>
        <div className={cn("min-w-0", !isHome && "hidden", !isHome && !wide && "split:block")}>
          <TransferHome
            pending={to.pendingTRs}
            loading={to.pendingLoading}
            drafts={standaloneDrafts.map((d) => ({ ...d, deliveryDate: "", trRef: "—", totalValue: 0, status: "Draft", updatedAt: d.createdAt, notes: "", hasLineNotes: false, kitchenShort: 0, branchShort: 0 }))}
            recent={recent}
            canEdit={canEdit}
            onStart={start}
            busy={busy}
            onOpenDraft={openDraft}
            onOpenRecent={(r) => {
              setOpenId(r.id);
              setBranchIds([]);
              setRangeKey("7");
              go("history");
            }}
            onHistory={() => {
              setOpenId(undefined);
              go("history");
            }}
            onStandalone={() => setStandalone({ branchId: "", notes: "" })}
            activeToId={form?.toId}
          />
        </div>
        <div className={cn("min-w-0", isHome && "hidden lg:block")}>
          {work ?? (
            <div className="hidden min-h-[320px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-card p-8 text-center split:flex">
              <p className="font-medium">กด “เริ่มจัดของ” ที่ใบขอเบิกทางซ้าย</p>
              <p className="text-sm text-muted-foreground">หรือดูใบโอนทั้งหมดเพื่อเช็คว่าสาขารับครบหรือยัง</p>
            </div>
          )}
        </div>
      </div>

      {declining && <DeclineDialog line={declining} onCancel={() => setDeclining(null)} onConfirm={(r) => decline(declining, r)} />}
      <SkuPicker open={adding} title="เพิ่มสินค้าในใบโอน" skus={addable} onPick={(s) => add(s.id)} onClose={() => setAdding(false)} />
      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title="ทิ้งใบนี้?"
        description="ใบนี้ยังไม่ได้ส่ง ทิ้งแล้วใบขอเบิกจะกลับไปรอในคิว"
        confirmLabel="ทิ้งใบนี้"
        cancelLabel="ยกเลิก"
        variant="destructive"
        onConfirm={discardCurrent}
      />
      <ConfirmDialog
        open={!!cancelRow}
        onOpenChange={(o) => !o && setCancelRow(null)}
        title={`ยกเลิกใบ ${cancelRow?.toNumber ?? ""}?`}
        description="สาขาจะไม่เห็นใบนี้ในหน้ารับของ และใบขอเบิกจะกลับไปรอในคิว"
        confirmLabel="ยกเลิกใบนี้"
        cancelLabel="ไม่ใช่"
        variant="destructive"
        onConfirm={async () => {
          const r = cancelRow;
          setCancelRow(null);
          if (r && (await to.cancelTO(r.id))) reloadHistory();
        }}
      />
      <ConfirmDialog
        open={!!deleteRow}
        onOpenChange={(o) => !o && setDeleteRow(null)}
        title={`ลบใบ ${deleteRow?.toNumber ?? ""}?`}
        description="ลบแล้วคืนสต๊อกวัตถุดิบ/บรรจุภัณฑ์ที่หักไป และใบขอเบิกจะกลับไปรอในคิว"
        confirmLabel="ลบ"
        cancelLabel="ไม่ใช่"
        variant="destructive"
        onConfirm={async () => {
          const r = deleteRow;
          setDeleteRow(null);
          if (r && (await to.deleteTO(r.id))) {
            refreshSmStock?.();
            reloadHistory();
          }
        }}
      />
      {standalone && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 md:items-center" onClick={() => setStandalone(null)}>
          <div role="dialog" aria-label="โอนเองโดยไม่มีใบขอเบิก" className="flex w-full flex-col gap-3 rounded-t-2xl bg-card p-4 shadow-raised md:max-w-md md:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold">โอนเองโดยไม่มีใบขอเบิก</h2>
            <p className="text-sm text-muted-foreground">ส่งให้สาขาไหน</p>
            <div className="flex flex-wrap gap-2">
              {activeBranches.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  aria-pressed={standalone.branchId === b.id}
                  onClick={() => setStandalone({ ...standalone, branchId: b.id })}
                  className={cn("min-h-[44px] rounded-full border px-4 text-sm", standalone.branchId === b.id ? "border-primary bg-primary font-semibold text-primary-foreground" : "border-border bg-card")}
                >
                  {b.branchName}
                </button>
              ))}
            </div>
            <Input value={standalone.notes} onChange={(e) => setStandalone({ ...standalone, notes: e.target.value })} placeholder="หมายเหตุ (ถ้ามี)" className="h-11" />
            <div className="flex gap-2 pb-[env(safe-area-inset-bottom)]">
              <Button variant="outline" className="h-12 flex-1" onClick={() => setStandalone(null)}>
                ยกเลิก
              </Button>
              <Button variant="brand" className="h-12 flex-[2]" disabled={!standalone.branchId} loading={busy} onClick={createStandalone}>
                เริ่มจัดของ
              </Button>
            </div>
          </div>
        </div>
      )}

      <GuideTour steps={GUIDE} open={guide.open} onClose={guide.close} />
    </div>
  );
}
