import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, HelpCircle } from "lucide-react";
import type { Branch } from "@/types/branch";
import { useAuth } from "@/hooks/use-auth";
import { useTransferRequest } from "@/hooks/use-transfer-request";
import { usePurchaseRequest } from "@/hooks/use-purchase-request";
import { useBranchRmStock } from "@/hooks/use-branch-rm-stock";
import { useRequestData, type RequestItem } from "@/hooks/use-request-data";
import { lineMessage, suggestedPacks, statusLabel } from "@/lib/request-lines";
import { RequestForm } from "@/components/request/RequestForm";
import { RequestDetail, RequestHome, RequestList, RequestSent, SupplierPick, numberOf, type AnyRequest } from "@/components/request/RequestViews";
import { GuideTour, useGuide, type GuideStep } from "@/components/GuideTour";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const LAST_BRANCH_KEY = "ck-request-branch";

const GUIDE: GuideStep[] = [
  {
    title: "ขอเบิก 3 ขั้น",
    body: (
      <>
        <b>1 แตะเริ่มขอเบิก</b> → <b>2 ใส่ตามที่แนะนำ</b> → <b>3 ส่งคำขอ แล้วคัดลอกข้อความไปไลน์</b> คำแนะนำนี้จะพาทำทีละขั้น
      </>
    ),
  },
  { target: "req-sent", title: "ติดตามใบที่ส่งไปแล้ว", body: "รอครัวกลาง → ครัวกลางรับเรื่องแล้ว → ได้ของแล้ว แตะที่ใบเพื่อดูหรือยกเลิก" },
  { target: "req-go", title: "ขั้น 1: แตะ “เริ่มขอเบิก”", body: "ตัวเลขสีส้มด้านบนคือจำนวนรายการที่ควรสั่ง วันส่งตั้งเป็นพรุ่งนี้ให้แล้ว", until: "click" },
  { target: "req-fill", title: "ขั้น 2: แตะ “ใส่ตามที่แนะนำ”", body: "ระบบคิดจำนวนให้พอขายถึงรอบส่งถัดไป หักของที่ขอไปแล้วแต่ยังไม่มาให้แล้ว", until: "click" },
  {
    target: "req-lines",
    title: "แก้จำนวนได้",
    body: (
      <>
        กด − / + ทางขวาของแต่ละรายการ · <b className="text-destructive">หมดแล้ว</b> · <b className="text-warning">พอขาย N วัน</b> · <b className="text-info">กำลังมา</b> = ขอไปแล้ว
      </>
    ),
  },
  { target: "req-send", title: "ขั้น 3: แตะ “ส่งคำขอ”", body: "ส่งแล้วจะมีข้อความให้กดคัดลอก ไปวางในไลน์กลุ่มครัวกลาง" },

];

/**
 * Requests from the branch (replaces TransferRequest): ask the kitchen for
 * tomorrow, follow what was sent, and the rare supplier order. Hash screens:
 * "" home, "new", "sup", "sup/<id>", "sent", "history", "r/<number>".
 */
export default function RequestPage({ branches }: { branches: Branch[] }) {
  const { isManagement, isStoreManager, profile, user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const view = decodeURIComponent(location.hash.slice(1));
  const go = (v: string, replace = false) => navigate({ pathname: location.pathname, hash: v ? `#${v}` : "" }, { replace });
  const guide = useGuide("request-v3");

  // ── Branch (management and area managers pick; store managers have theirs) ──
  const activeBranches = useMemo(() => branches.filter((b) => b.status === "Active"), [branches]);
  const lockedBranch = isStoreManager && profile?.branch_id ? profile.branch_id : null;
  const [picked, setPicked] = useState<string>(() => {
    try {
      return localStorage.getItem(LAST_BRANCH_KEY) || "";
    } catch {
      return "";
    }
  });
  const branchId = lockedBranch ?? (activeBranches.some((b) => b.id === picked) ? picked : activeBranches[0]?.id ?? null);
  const branch = branches.find((b) => b.id === branchId);
  const canCreate = isStoreManager || isManagement;

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

  const tr = useTransferRequest(branchId, profileId);
  const pr = usePurchaseRequest(branchId);
  const req = useRequestData(branchId, branch?.brandName ?? null);
  const supplierId = view.startsWith("sup/") ? view.slice(4) : null;
  const rm = useBranchRmStock(supplierId ? branchId : null, supplierId);
  useEffect(() => {
    if (view.startsWith("sup")) req.loadSuppliers();
  }, [view, req.loadSuppliers]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Products ──
  const kitchenItems = useMemo<RequestItem[]>(
    () =>
      tr.lines.map((l) => ({
        skuId: l.skuId,
        code: l.skuCode,
        name: l.skuName,
        packSize: l.packSize || 1,
        uom: l.uom,
        packUnit: "แพ็ค",
        stockOnHand: l.stockOnHand,
        avgDailyUsage: l.avgDailyUsage,
        peakDailyUsage: l.peakDailyUsage,
        rop: l.rop,
        parstock: l.parstock,
        suggestedQty: l.suggestedQty,
        skuType: l.skuType,
      })),
    [tr.lines],
  );
  const supplierItems = useMemo<RequestItem[]>(
    () =>
      rm.rmSkuList
        .map((s) => {
          const st = rm.rmStock[s.skuId];
          return {
            skuId: s.skuId,
            code: s.skuCode,
            name: s.skuName,
            packSize: s.packSize || 1,
            uom: s.usageUom,
            purchaseUom: s.purchaseUom,
            packUnit: s.packUnit,
            stockOnHand: st?.stockOnHand ?? 0,
            avgDailyUsage: st?.avgDailyUsage ?? 0,
            peakDailyUsage: st?.peakDailyUsage ?? 0,
            rop: st?.rop ?? 0,
            parstock: st?.parstock ?? 0,
            suggestedQty: st?.suggestedOrder ?? 0,
            skuType: "RM" as const,
          };
        })
        .sort((a, b) => a.code.localeCompare(b.code)),
    [rm.rmSkuList, rm.rmStock],
  );
  const needCount = kitchenItems.filter((i) => suggestedPacks(i, req.pending.get(i.skuId)?.qty ?? 0) > 0).length;

  // ── Requests already sent ──
  const all = useMemo<AnyRequest[]>(
    () =>
      [...tr.history.map((row) => ({ kind: "tr" as const, row })), ...pr.history.map((row) => ({ kind: "pr" as const, row }))].sort((a, b) =>
        b.row.createdAt.localeCompare(a.row.createdAt),
      ),
    [tr.history, pr.history],
  );
  const openReq = view.startsWith("r/") ? all.find((r) => numberOf(r) === view.slice(2)) : undefined;
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // ── Sending ──
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ number: string; count: number; date: string; message: string } | null>(null);
  const supplier = req.suppliers.find((s) => s.id === supplierId);
  const send = async (kind: "tr" | "pr", date: string, notes: string, items: { item: RequestItem; packs: number }[]) => {
    setBusy(true);
    const res =
      kind === "tr"
        ? await req.submitKitchen({ profileId, requiredDate: date, notes, items })
        : await req.submitSupplier({ profileId, supplierId: supplierId!, requiredDate: date, notes, items });
    setBusy(false);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    (kind === "tr" ? tr.fetchHistory : pr.fetchHistory)();
    setSent({
      number: res.number,
      count: items.length,
      date,
      message: lineMessage({
        branch: branch?.branchName ?? "",
        date,
        notes,
        alwaysPacks: kind === "pr",
        items: items.map(({ item, packs }) => ({ name: item.name, packSize: item.packSize, uom: item.uom, packs, packUnit: item.packUnit })),
      }),
    });
    go("sent", true);
  };

  const detailLoader = useCallback(() => (openReq ? (openReq.kind === "tr" ? tr.fetchTRDetail(openReq.row.id) : pr.fetchPRDetail(openReq.row.id)) : Promise.resolve([])), [openReq?.row.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Screens ──
  let work: React.ReactNode = null;
  if (!branchId) work = <Empty text="ยังไม่มีสาขาที่เปิดอยู่" />;
  else if (view === "new")
    work = canCreate ? (
      <RequestForm
        key={branchId}
        title="ขอเบิกจากครัวกลาง"
        subtitle={branch ? `${branch.branchName} · ${branch.brandName}` : ""}
        items={kitchenItems}
        pending={req.pending}
        loading={tr.isLoading}
        busy={busy}
        onSubmit={(d, n, items) => send("tr", d, n, items)}
      />
    ) : (
      <Empty text="บัญชีนี้ส่งคำขอไม่ได้" />
    );
  else if (view === "sup") work = <SupplierPick suppliers={req.suppliers} onPick={(s) => go(`sup/${s.id}`)} />;
  else if (supplierId)
    work = (
      <RequestForm
        key={`${branchId}-${supplierId}`}
        title={supplier?.name ?? "สั่งซื้อจากซัพพลายเออร์"}
        subtitle="สั่งซื้อจากซัพพลายเออร์"
        items={supplierItems}
        pending={req.pending}
        loading={rm.loading}
        busy={busy}
        onSubmit={(d, n, items) => send("pr", d, n, items)}
      />
    );
  else if (view === "sent" && sent) work = <RequestSent {...sent} onDone={() => go("", true)} />;
  else if (openReq)
    work = (
      <RequestDetail
        key={numberOf(openReq)}
        r={openReq}
        loadLines={detailLoader}
        canEdit={canCreate}
        message={(lines) =>
          lineMessage({
            branch: `${openReq.row.branchName || branch?.branchName || ""} — ${branch?.brandName ?? ""}`,
            date: openReq.row.requiredDate,
            notes: openReq.kind === "pr" ? openReq.row.notes : undefined,
            alwaysPacks: openReq.kind === "pr",
            items: lines.map((l) => ({
              name: l.skuName,
              packSize: l.packSize,
              uom: l.uom,
              packs: Math.round(l.requestedQty / Math.max(1, l.packSize)),
              packUnit: "packUnit" in l ? l.packUnit : "แพ็ค",
            })),
          })
        }
        onCancel={async () => {
          await (openReq.kind === "tr" ? tr.cancelTR(openReq.row.id) : pr.cancelPR(openReq.row.id));
          req.reloadPending();
        }}
      />
    );
  else if (view === "history") {
    const filtered = statusFilter === "all" ? all : all.filter((r) => r.row.status === statusFilter);
    work = (
      <div className="flex flex-col gap-3">
        <h2 className="text-xl font-bold">ประวัติคำขอ</h2>
        <div className="flex flex-wrap gap-1.5">
          {["all", "Submitted", "Acknowledged", "Fulfilled", "Cancelled"].map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={statusFilter === s}
              onClick={() => setStatusFilter(s)}
              className={cn("min-h-[40px] rounded-full border px-4 text-sm", statusFilter === s ? "border-primary bg-primary font-semibold text-primary-foreground" : "border-border bg-card")}
            >
              {s === "all" ? `ทั้งหมด ${all.length}` : statusLabel[s].text}
            </button>
          ))}
        </div>
        <RequestList items={filtered} onOpen={(r) => go(`r/${numberOf(r)}`)} empty={tr.historyLoading ? "กำลังโหลด…" : "ไม่มีใบในสถานะนี้"} />
      </div>
    );
  }

  const isHome = view === "" || (view === "sent" && !sent) || (view.startsWith("r/") && !openReq && !tr.historyLoading);
  const isForm = view === "new" || !!supplierId;
  return (
    <div className="flex flex-col gap-4">
      <div className={cn("flex flex-wrap items-end gap-3", !isHome && "hidden split:flex")}>
        <div className="mr-auto">
          <h1 className="text-2xl font-bold">ขอเบิก</h1>
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
                  setPicked(b.id);
                  try {
                    localStorage.setItem(LAST_BRANCH_KEY, b.id);
                  } catch {
                    // remembered only on this device; fine without
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
        <Button variant="outline" className="h-10" onClick={() => { go("", true); guide.start(); }}>
          <HelpCircle className="h-4 w-4" /> วิธีใช้
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-6 split:grid-cols-[360px_minmax(0,1fr)]">
        <div className={cn("min-w-0", !isHome && "hidden split:block")}>
          {branchId ? (
            <RequestHome
              needCount={needCount}
              loading={tr.isLoading}
              canCreate={canCreate}
              recent={all.slice(0, 5)}
              onNew={() => go("new")}
              onOpen={(r) => go(`r/${numberOf(r)}`)}
              onHistory={() => go("history")}
              onSupplier={() => go("sup")}
            />
          ) : (
            <Empty text="ยังไม่มีสาขาที่เปิดอยู่" />
          )}
        </div>
        <div className={cn("min-w-0", isHome && "hidden split:block")}>
          {!isHome && (
            <button type="button" onClick={() => go("")} className="-ml-2 mb-2 inline-flex min-h-[44px] items-center gap-1 rounded-full px-2 text-sm text-muted-foreground hover:text-foreground split:hidden">
              <ArrowLeft className="h-4 w-4" /> ขอเบิก
            </button>
          )}
          {work ?? (
            <div className="hidden min-h-[320px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-card p-8 text-center split:flex">
              <p className="font-medium">กด “เริ่มขอเบิก” หรือเลือกใบทางซ้าย</p>
            </div>
          )}
        </div>
      </div>

      <GuideTour steps={GUIDE} open={guide.open} onClose={guide.close} />
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">{text}</div>;
}
