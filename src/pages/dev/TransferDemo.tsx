import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { SKU } from "@/types/sku";
import type { PendingTR, TOHistoryRow, TOLine } from "@/hooks/use-transfer-order";
import { packsOf, reconcileLots, visibleRecords, type LotLine, type ProdRecord } from "@/lib/transfer-lines";
import { DeclineDialog, PackSheet, useSendCheck, type LotsApi, type PackForm } from "@/components/transfer/PackSheet";
import { ReviewSend, SentDone, TransferHistory, TransferHome, sentMessage, type Kind, type OrderDetail } from "@/components/transfer/TransferViews";
import { GuideTour } from "@/components/GuideTour";

/**
 * Dev-only harness (route exists only under `npm run dev`): the transfer order
 * screens on a copy of TO-2026-10-023's lines. Nothing is written anywhere.
 */
const sku = (id: string, name: string, type: string, packSize: number, uom = "ก."): SKU =>
  ({ id, skuId: id, name, type, packSize, packUnit: packSize > 1 ? "แพ็ค" : "", usageUom: uom, purchaseUom: uom, status: "Active", isDistributable: true, converter: 1 }) as unknown as SKU;
const SKUS = [
  sku("sm1", "มะเขือเทศอบแห้ง", "SM", 50),
  sku("sm2", "อกเป็ดชาชู ซูวีด์ รมควัน", "SM", 400),
  sku("sm3", "สันคอหมูชาชู ซูวีด์ รมควัน", "SM", 350),
  sku("sm4", "อกไก่ชาชู ซูวีด์", "SM", 350),
  sku("sm5", "ซุปทงคตสึ", "SM", 3000),
  sku("rm1", "ทาเระ ชิโอะ", "RM", 5500),
  sku("pk1", "ชามกระดาษ Eco พร้อมฝา PP 850 ml", "PK", 50, "ชิ้น"),
  sku("pk2", "ถ้วยน้ำจิ้ม PET ฝาพับ 2 Oz", "PK", 50, "ชิ้น"),
];
const line = (id: string, skuId: string, planned: number, actual: number, packs: number | null): TOLine => {
  const s = SKUS.find((x) => x.id === skuId)!;
  return { id, skuId, skuCode: skuId, skuName: s.name, plannedQty: planned, actualQty: actual, uom: s.usageUom, unitCost: 0.6, lineValue: actual * 0.6, note: "", trLineId: `tr-${id}`, packsCount: packs };
};
const LINES: TOLine[] = [
  line("l1", "sm1", 50, 50, 1),
  line("l2", "sm2", 2000, 2020, 5),
  line("l3", "sm3", 1400, 1400, 4),
  line("l4", "sm4", 1750, 1880, 5),
  line("l5", "sm5", 9000, 9000, 3),
  line("l6", "rm1", 5500, 5500, 1),
  line("l7", "pk1", 50, 50, 1),
  line("l8", "pk2", 50, 50, 1),
];
const rec = (id: string, date: string, out: number): ProdRecord => ({ id, productionDate: date, actualOutputG: out, batchesProduced: 2 });
const RECORDS: Record<string, ProdRecord[]> = {
  sm1: [rec("r1", "2026-09-01", 500)],
  sm2: [rec("r2", "2026-10-16", 800), rec("r3", "2026-10-22", 1200)],
  sm3: [rec("r4", "2026-10-02", 3000), rec("r5", "2026-10-21", 1050)],
  sm4: [rec("r6", "2026-10-15", 2000)],
  sm5: [rec("r7", "2026-10-14", 12000)],
};
const STOCK: Record<string, number> = { sm1: 400, sm2: 2400, sm3: 1050, sm4: 2100, sm5: 12000, rm1: 20000, pk1: 500, pk2: 500 };
const PENDING: PendingTR[] = [
  { trId: "t1", trNumber: "TR-2026-10-016", branchId: "b1", branchName: "Shiro", requestedDate: "2026-10-24", requiredDate: new Date().toISOString().slice(0, 10), createdAt: "2026-10-24T11:30:00Z", itemCount: 9, lines: [], draft: null },
  { trId: "t2", trNumber: "TR-2026-10-017", branchId: "b2", branchName: "Thaniya", requestedDate: "2026-10-25", requiredDate: "2026-10-27", createdAt: "2026-10-25T00:50:00Z", itemCount: 9, lines: [], draft: null },
  { trId: "t3", trNumber: "TR-2026-10-015", branchId: "b2", branchName: "Thaniya", requestedDate: "2026-10-24", requiredDate: "2026-10-26", createdAt: "2026-10-24T01:10:00Z", itemCount: 11, lines: [], draft: { toId: "d", toNumber: "TO-2026-10-024", createdAt: "2026-10-25T01:12:00Z" } },
];
const row = (id: string, branch: string, status: string, k: number, b: number, day: string): TOHistoryRow => ({
  id, toNumber: id, deliveryDate: day, branchId: branch, branchName: branch, trId: null, trRef: "TR-2026-10-0xx", itemCount: 10, totalValue: 9364, status, createdAt: `${day}T02:00:00Z`, updatedAt: `${day}T02:09:00Z`, notes: "", hasLineNotes: false, kitchenShort: k, branchShort: b, receipts: status === "Sent" ? 0 : 5,
});
const today = new Date().toISOString().slice(0, 10);
const HISTORY = [row("TO-2026-10-023", "Shiro", "Received", 0, 0, today), row("TO-2026-10-022", "Thaniya", "Partially Received", 0, 1, today), row("TO-2026-10-020", "Shiro", "Sent", 1, 0, today)];

export default function TransferDemo() {
  const location = useLocation();
  const navigate = useNavigate();
  const view = location.hash.slice(1);
  const go = (v: string) => navigate({ hash: v ? `#${v}` : "" });
  const [form, setForm] = useState<PackForm>({ toId: "d", toNumber: "TO-2026-10-024", branchId: "b1", branchName: "Shiro", deliveryDate: today, notes: "", trId: "t1", trNumber: "TR-2026-10-016", requiredDate: today, lines: LINES, declined: [] });
  const [lots, setLots] = useState<Record<string, LotLine[]>>(() => {
    const out: Record<string, LotLine[]> = {};
    for (const l of LINES) {
      const s = SKUS.find((x) => x.id === l.skuId)!;
      if (s.type !== "SM") continue;
      out[l.id] = reconcileLots([], visibleRecords(RECORDS[l.skuId], STOCK[l.skuId], new Set()), packsOf(l, s.packSize), s.packSize).next;
    }
    out.l3 = [{ productionRecordId: "r5", productionDate: "2026-10-21", packs: 3, packWeightG: 350 }];
    return out;
  });
  const [declining, setDeclining] = useState<TOLine | null>(null);
  const [kind, setKind] = useState<Kind>("all");
  const skuOf = (id: string) => SKUS.find((s) => s.id === id);
  const api: LotsApi = useMemo(
    () => ({
      stock: STOCK,
      lots,
      loading: false,
      isLotLine: (id) => skuOf(id)?.type === "SM",
      visibleFor: (lineId, skuId) => visibleRecords(RECORDS[skuId] || [], STOCK[skuId], new Set((lots[lineId] || []).map((l) => l.productionRecordId))),
      setLotPacks: (lineId, _skuId, r, packs) =>
        setLots((p) => {
          const cur = p[lineId] || [];
          const has = cur.find((l) => l.productionRecordId === r.id);
          const next = has ? cur.map((l) => (l === has ? { ...l, packs } : l)).filter((l) => l.packs > 0) : [...cur, { productionRecordId: r.id, productionDate: r.productionDate, packs, packWeightG: 0 }];
          return { ...p, [lineId]: next };
        }),
      fillToPacks: (l, packs) => setLots((p) => ({ ...p, [l.id]: reconcileLots(p[l.id] || [], visibleRecords(RECORDS[l.skuId] || [], STOCK[l.skuId], new Set()), packs, 0).next })),
    }),
    [lots],
  );
  const check = useSendCheck(form, skuOf, api);
  const setLine = (id: string, patch: Partial<TOLine>) => setForm((f) => ({ ...f, lines: f.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) }));
  const detail: OrderDetail = { lines: LINES, receivedBySku: new Map([["sm1", 50], ["sm2", 2020], ["sm3", 1400], ["sm4", 1750], ["sm5", 6000], ["rm1", 5500], ["pk1", 50], ["pk2", 50]]), declined: [{ name: "น้ำมันชิโอะ", qty: 1000, uom: "ก.", reason: "ของหมด" }] };

  let work: React.ReactNode = null;
  if (view === "pack")
    work = (
      <PackSheet
        form={form}
        skuOf={skuOf}
        lots={api}
        check={check}
        busy={false}
        onPacks={(l, n) => {
          const ps = skuOf(l.skuId)!.packSize;
          setLine(l.id, { packsCount: n, actualQty: n * ps });
          api.fillToPacks(l, n);
        }}
        onQty={(l, q) => setLine(l.id, { actualQty: q })}
        onWeight={(l, g) => setLine(l.id, { actualQty: g })}
        onNote={(l, note) => setLine(l.id, { note })}
        onDecline={setDeclining}
        onRestore={(d) => setForm((f) => ({ ...f, declined: f.declined.filter((x) => x !== d), lines: [...f.lines, line(d.line.id.replace("tr-", ""), d.line.skuId, d.line.requestedQty, d.line.requestedQty, null)] }))}
        onAdd={() => undefined}
        onBack={() => go("")}
        onDiscard={() => undefined}
        onNext={() => go("review")}
      />
    );
  else if (view === "review")
    work = <ReviewSend packSizeOf={(id) => skuOf(id)?.packSize ?? 0} form={form} check={check} busy={false} onNotes={(n) => setForm((f) => ({ ...f, notes: n }))} onFix={() => go("pack")} onFillLots={() => undefined} onSend={() => go("done")} onBack={() => go("pack")} />;
  else if (view === "done")
    work = (
      <SentDone
        toNumber="TO-2026-10-024"
        branchName="Shiro"
        count={form.lines.length}
        value={9364}
        declined={form.declined.map((d) => ({ name: d.line.skuName, reason: d.reason }))}
        message={sentMessage({ branchName: "Shiro", date: today, toNumber: "TO-2026-10-024", lines: [], declined: [] })}
        next={PENDING[1]}
        onNext={() => go("pack")}
        onHome={() => go("")}
        onPrint={() => undefined}
      />
    );
  else if (view === "history")
    work = (
      <TransferHistory
        packSizeOf={(id) => skuOf(id)?.packSize ?? 0}
        rows={HISTORY}
        loading={false}
        branches={[{ id: "Shiro", name: "Shiro" }, { id: "Thaniya", name: "Thaniya" }]}
        branchIds={[]}
        onBranches={() => undefined}
        range={{ from: "", to: "", label: "30 วัน" }}
        onRange={() => undefined}
        kind={kind}
        onKind={setKind}
        staleDrafts={[row("TO-2026-04-018", "Thaniya", "Draft", 0, 0, "2026-04-22")]}
        can={{ editSent: true, cancel: true, discard: true }}
        loadDetail={async () => detail}
        onEditSent={() => undefined}
        onCancel={() => undefined}
        onDiscardDrafts={() => undefined}
        onPrint={() => undefined}
        onBack={() => go("")}
        openId="TO-2026-10-022"
      />
    );

  return (
    <div className="min-h-screen bg-background">
      <div className={`page-shell grid grid-cols-1 gap-6 ${view === "pack" || view === "review" ? "" : "split:grid-cols-[340px_minmax(0,1fr)]"}`}>
        <div className={work ? (view === "pack" || view === "review" ? "hidden" : "hidden split:block") : ""}>
          <TransferHome pending={PENDING} loading={false} drafts={[]} recent={HISTORY} canEdit onStart={() => go("pack")} onOpenDraft={() => go("pack")} onOpenRecent={() => go("history")} onHistory={() => go("history")} onStandalone={() => undefined} />
        </div>
        <div className={work ? "" : "hidden split:block"}>{work}</div>
      </div>
      {declining && (
        <DeclineDialog
          line={declining}
          onCancel={() => setDeclining(null)}
          onConfirm={(reason) => {
            const l = declining;
            setDeclining(null);
            setForm((f) => ({ ...f, lines: f.lines.filter((x) => x.id !== l.id), declined: [...f.declined, { reason, line: { id: l.trLineId!, skuId: l.skuId, skuCode: l.skuCode, skuName: l.skuName, uom: l.uom, requestedQty: l.plannedQty, skuType: "SM" } }] }));
          }}
        />
      )}
      <GuideTour steps={[]} open={false} onClose={() => undefined} />
    </div>
  );
}
