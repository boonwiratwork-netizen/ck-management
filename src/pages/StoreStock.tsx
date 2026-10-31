import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { Download, Search } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useBranchStock, type BranchStockLoader, type BranchStockRow } from "@/hooks/use-branch-stock";
import { useFitsWidth } from "@/hooks/use-fits-width";
import { StockCard } from "@/components/StockCard";
import { MoveSheet } from "@/components/store-stock/MoveSheet";
import { Button } from "@/components/ui/button";
import type { SKU } from "@/types/sku";
import type { Branch } from "@/types/branch";
import { cn, toLocalDateStr } from "@/lib/utils";

interface Props {
  skus: SKU[];
  branches: Branch[];
  /** Area managers look but don't move stock */
  readOnly?: boolean;
  /** Dev demo only */
  loader?: BranchStockLoader;
  write?: (rows: unknown[]) => Promise<boolean>;
}

type Filter = "all" | "low" | "negative";
const LOW_DAYS = 2;
const STORAGE: Record<string, string> = { Frozen: "แช่แข็ง", Chilled: "แช่เย็น", Ambient: "ของแห้ง" };
const n0 = (n: number) => Math.round(n).toLocaleString("th-TH");
const baht = (n: number) => `฿${Math.round(n).toLocaleString("th-TH")}`;
const thaiDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("th-TH", { day: "numeric", month: "short" });

/**
 * A branch's stock: the latest finished count, plus what came in, less what sales
 * used and waste, ± moves — the count sheet's formula. Moves to another branch or
 * back to the kitchen write both sides at once.
 */
export default function StoreStockPage({ skus, branches, readOnly, loader, write }: Props) {
  const { isStoreManager, profile } = useAuth();
  const active = useMemo(() => branches.filter((b) => b.status === "Active"), [branches]);
  // A store manager sees their own branch (none set = nothing to show)
  const own = isStoreManager ? profile?.branch_id ?? null : undefined;
  const [picked, setPicked] = useState<string | null>(null);
  const branchId = own !== undefined ? own : picked ?? active[0]?.id ?? null;
  const branch = branches.find((b) => b.id === branchId) ?? null;

  const { rows, loading, error, reload } = useBranchStock(branchId, skus, loader);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [historyFor, setHistoryFor] = useState<BranchStockRow | null>(null);
  const [moveFor, setMoveFor] = useState<BranchStockRow | null>(null);
  const [measure, wide] = useFitsWidth(900);

  const list = rows ?? [];
  const low = list.filter((r) => r.daysLeft !== null && r.balance > 0 && r.daysLeft < LOW_DAYS).sort((a, b) => a.daysLeft! - b.daysLeft!);
  const negative = list.filter((r) => r.known && r.balance < -0.5);
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = list
    .filter((r) => (filter === "low" ? low.includes(r) : filter === "negative" ? negative.includes(r) : true))
    .filter((r) => words.every((w) => `${r.sku.skuId} ${r.sku.name}`.toLowerCase().includes(w)))
    // Fewest days left first; items not used sit at the bottom by name
    .sort((a, b) => (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity) || a.sku.name.localeCompare(b.sku.name, "th"));
  const totalValue = list.reduce((t, r) => t + r.value, 0);
  const lastCount = list.reduce<string | null>((m, r) => (r.countDate && (!m || r.countDate > m) ? r.countDate : m), null);
  // Weighted days left per storage: Σ stock ÷ Σ daily use (CLAUDE.md cover day)
  const cover = (k: string) => {
    const g = list.filter((r) => (r.sku.storageCondition || "Ambient") === k && r.known && r.balance > 0 && r.dailyUse > 0);
    const use = g.reduce((t, r) => t + r.dailyUse, 0);
    return use > 0 ? g.reduce((t, r) => t + r.balance, 0) / use : null;
  };

  const chip = (on: boolean, tone?: "bad") =>
    cn("inline-flex min-h-[40px] items-center gap-1.5 rounded-full border px-3.5 text-sm", on ? "border-primary bg-primary font-semibold text-primary-foreground" : tone === "bad" ? "border-destructive/40 bg-card text-destructive" : "border-border bg-card");
  const daysCell = (r: BranchStockRow) =>
    r.daysLeft === null ? <span className="text-muted-foreground">—</span> : r.balance <= 0 ? <span className="font-semibold text-destructive">หมด</span> : <span className={cn(r.daysLeft < LOW_DAYS ? "font-semibold text-destructive" : r.daysLeft < 4 ? "text-warning" : "")}>{r.daysLeft >= 100 ? "100+" : r.daysLeft.toFixed(1)} วัน</span>;

  const exportExcel = () => {
    const data = shown.map((r) => ({ รหัส: r.sku.skuId, ชื่อ: r.sku.name, ช่องเก็บ: STORAGE[r.sku.storageCondition] ?? r.sku.storageCondition, คงเหลือ: r.known ? Math.round(r.balance * 100) / 100 : "ไม่รู้ยอด", หน่วย: r.sku.usageUom, ใช้ต่อวัน: Math.round(r.dailyUse * 10) / 10, พอขาย_วัน: r.daysLeft !== null ? Math.round(r.daysLeft * 10) / 10 : "", มูลค่า: Math.round(r.value * 100) / 100, นับล่าสุด: r.countDate ?? "ไม่ได้นับเกิน 5 สัปดาห์" }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), "สต๊อกสาขา");
    XLSX.writeFile(wb, `สต๊อกสาขา-${branch?.branchName ?? ""}-${toLocalDateStr(new Date())}.xlsx`);
  };

  if (own === null) return <p className="rounded-2xl border border-border bg-card p-6 text-center text-muted-foreground">บัญชีนี้ยังไม่ได้ตั้งสาขา ติดต่อผู้ดูแลระบบ</p>;

  return (
    <div ref={measure} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-bold">สต๊อกสาขา{branch && own !== undefined ? ` · ${branch.branchName}` : ""}</h1>
          <p className="text-sm text-muted-foreground">คงเหลือ = นับล่าสุด + รับ − ใช้ตามยอดขาย − ของเสีย ± ย้าย/ปรับยอด (สูตรเดียวกับหน้านับสต๊อก)</p>
        </div>
        <Button variant="outline" className="h-10" onClick={exportExcel} disabled={!rows}>
          <Download className="h-4 w-4" /> ส่งออก Excel
        </Button>
      </div>

      {own === undefined && active.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">สาขา</span>
          {active.map((b) => (
            <button key={b.id} type="button" className={chip(b.id === branchId)} onClick={() => setPicked(b.id)}>
              {b.branchName}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <span className="min-w-0 flex-1">{error}</span>
          <button type="button" onClick={reload} className="min-h-[40px] rounded-full border border-destructive px-4 text-sm font-semibold">
            ลองใหม่
          </button>
        </div>
      )}

      {!rows ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[88px] animate-pulse rounded-2xl bg-secondary" />
          ))}
        </div>
      ) : (
        <div className={cn("flex flex-col gap-4 transition-opacity", loading && "opacity-50")}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 [&>*]:min-w-0">
            <div className="rounded-2xl border border-border bg-card px-4 py-3">
              <div className="text-sm text-muted-foreground">มูลค่าสต๊อก {branch?.branchName}</div>
              <div className="break-all font-mono text-2xl font-semibold">{baht(totalValue)}</div>
              <div className="text-xs text-muted-foreground">{list.length} รายการ · ไม่นับยอดติดลบ{list.some((r) => !r.known) ? ` · ไม่รู้ยอด ${list.filter((r) => !r.known).length} รายการ ไม่นับ` : ""}</div>
            </div>
            <div className="rounded-2xl border border-border bg-card px-4 py-3">
              <div className="text-sm text-muted-foreground">พอขาย (เฉลี่ยตามช่องเก็บ)</div>
              <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1">
                {(["Frozen", "Chilled", "Ambient"] as const).map((k) => (
                  <div key={k}>
                    <div className="text-xs text-muted-foreground">{STORAGE[k]}</div>
                    <div className="font-mono text-lg font-semibold">{cover(k) != null ? `${cover(k)!.toFixed(1)} วัน` : "—"}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-2xl border border-border bg-card px-4 py-3">
              <div className="text-sm text-muted-foreground">นับล่าสุด</div>
              <div className="text-xl font-semibold">{lastCount ? new Date(`${lastCount}T00:00:00`).toLocaleDateString("th-TH", { weekday: "short", day: "numeric", month: "short" }) : "ไม่ได้นับเกิน 5 สัปดาห์"}</div>
              <div className="text-xs text-muted-foreground">ใช้ต่อวัน = เฉลี่ยวันที่มียอดขาย 7 วันล่าสุด รวมของเสีย</div>
            </div>
          </div>

          {(low.length > 0 || negative.length > 0) && (
            <section className="overflow-hidden rounded-2xl border border-border bg-card">
              <h2 className="px-4 pt-3 text-base font-bold">เรื่องที่ควรดู</h2>
              {low.length > 0 && (
                <button type="button" onClick={() => setFilter("low")} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-secondary/50">
                  <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-destructive" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">
                      ใกล้หมด · พอขายไม่ถึง {LOW_DAYS} วัน ({low.length})
                    </span>
                    <span className="block break-words text-sm text-muted-foreground">
                      {low
                        .slice(0, 4)
                        .map((r) => `${r.sku.name} ${r.daysLeft!.toFixed(1)} วัน`)
                        .join(" · ")}
                      {low.length > 4 ? " · …" : ""} · ขอเบิกที่หน้าขอเบิก
                    </span>
                  </span>
                </button>
              )}
              {negative.length > 0 && (
                <button type="button" onClick={() => setFilter("negative")} className="flex w-full items-start gap-3 border-t border-border px-4 py-3 text-left hover:bg-secondary/50">
                  <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-warning" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">ติดลบ ({negative.length}) · ใช้มากกว่าที่ระบบเห็นว่ามี</span>
                    <span className="block break-words text-sm text-muted-foreground">ของเข้าไม่ได้บันทึก หรือสูตรใช้มากเกิน · นับจริงแล้วยอดจะถูกเอง</span>
                  </span>
                </button>
              )}
            </section>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <label className="relative">
              <span className="sr-only">ค้นหา</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ค้นรหัส หรือชื่อ…" className="h-10 w-[220px] max-w-full rounded-xl border border-border bg-card pl-9 pr-3 text-base sm:text-sm" />
            </label>
            <button type="button" className={chip(filter === "all")} onClick={() => setFilter("all")}>
              ทั้งหมด {list.length}
            </button>
            <button type="button" className={chip(filter === "low", "bad")} onClick={() => setFilter("low")}>
              ใกล้หมด {low.length}
            </button>
            <button type="button" className={chip(filter === "negative", "bad")} onClick={() => setFilter("negative")}>
              ติดลบ {negative.length}
            </button>
          </div>

          {!shown.length ? (
            <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">ไม่มีรายการ</p>
          ) : wide ? (
            <div className="overflow-hidden rounded-2xl border border-border bg-card">
              <table className="w-full table-fixed text-sm">
                <colgroup>
                  <col />
                  <col style={{ width: "140px" }} />
                  <col style={{ width: "110px" }} />
                  <col style={{ width: "110px" }} />
                  <col style={{ width: "100px" }} />
                  <col style={{ width: "100px" }} />
                  <col style={{ width: readOnly ? "100px" : "210px" }} />
                </colgroup>
                <thead className="bg-secondary/60 text-left text-[13px] text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2.5 font-medium">สินค้า</th>
                    <th className="px-3 py-2.5 text-right font-medium">คงเหลือ</th>
                    <th className="px-3 py-2.5 text-right font-medium">ใช้ต่อวัน</th>
                    <th className="px-3 py-2.5 text-right font-medium">พอขาย</th>
                    <th className="px-3 py-2.5 font-medium">ช่องเก็บ</th>
                    <th className="px-3 py-2.5 font-medium">นับล่าสุด</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.sku.id} className="border-t border-border">
                      <td className="break-words px-3 py-2.5">
                        <span className="font-semibold">{r.sku.name}</span> <span className="font-mono text-xs text-muted-foreground">{r.sku.skuId}</span>
                      </td>
                      <td className={cn("px-3 py-2.5 text-right font-mono tabular-nums", r.known && r.balance < -0.5 && "text-destructive")}>
                        {r.known ? n0(r.balance) : "—"} <span className="font-sans text-xs text-muted-foreground">{r.sku.usageUom}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">{r.dailyUse > 0 ? n0(r.dailyUse) : <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">{daysCell(r)}</td>
                      <td className="px-3 py-2.5 text-muted-foreground">{STORAGE[r.sku.storageCondition] ?? r.sku.storageCondition ?? "—"}</td>
                      <td className="px-3 py-2.5">{r.countDate ? thaiDate(r.countDate) : <span className="text-warning">ไม่ได้นับเกิน 5 สัปดาห์</span>}</td>
                      <td className="px-2 py-2">
                        <div className="flex justify-end gap-1.5">
                          <Button variant="outline" className="h-9 px-3 text-sm" onClick={() => setHistoryFor(r)}>
                            ประวัติ
                          </Button>
                          {!readOnly && (
                            <Button variant="outline" className="h-9 px-3 text-sm" onClick={() => setMoveFor(r)}>
                              ย้าย/ปรับยอด
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <ul className="overflow-hidden rounded-2xl border border-border bg-card">
              {shown.map((r, i) => (
                <li key={r.sku.id} className={cn("flex items-start gap-3 px-4 py-3", i > 0 && "border-t border-border")}>
                  <button type="button" onClick={() => setHistoryFor(r)} className="min-w-0 flex-1 text-left">
                    <span className="block break-words font-semibold">{r.sku.name}</span>
                    <span className="block text-[13px] text-muted-foreground">
                      <span className={cn("font-mono", r.known && r.balance < -0.5 && "text-destructive")}>
                        {r.known ? n0(r.balance) : "—"} {r.sku.usageUom}
                      </span>
                      {r.dailyUse > 0 && ` · ใช้วันละ ${n0(r.dailyUse)}`} · {r.countDate ? `นับ ${thaiDate(r.countDate)}` : "ไม่ได้นับเกิน 5 สัปดาห์"}
                    </span>
                  </button>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <b className="font-mono tabular-nums">{daysCell(r)}</b>
                    {!readOnly && (
                      <button type="button" onClick={() => setMoveFor(r)} className="min-h-[32px] text-sm font-semibold text-brand">
                        ย้าย/ปรับ
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">ติดลบโชว์ตามจริง (ไม่ปัดเป็น 0) · {wide ? "กดประวัติ" : "แตะชื่อ"} = ดูของเข้า-ออกรายวัน</p>
        </div>
      )}

      {historyFor && branchId && (
        <StockCard
          skuId={historyFor.sku.id}
          skuType={historyFor.sku.type as "RM" | "SM"}
          sku={historyFor.sku}
          skus={skus}
          currentStock={historyFor.known ? historyFor.balance : 0}
          stockValue={historyFor.value}
          onClose={() => setHistoryFor(null)}
          context="branch"
          branchId={branchId}
          disableMismatchCheck
        />
      )}
      {moveFor && branch && <MoveSheet sku={moveFor.sku} balance={moveFor.known ? moveFor.balance : null} branch={branch} branches={branches} onClose={() => setMoveFor(null)} onSaved={reload} write={write} />}
    </div>
  );
}
