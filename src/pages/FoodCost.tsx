import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as XLSX from "xlsx";
import { Download } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useFoodCost, isClosedMonth, type FoodCostLoader, type FoodCostMasters } from "@/hooks/use-food-cost";
import { AttentionBox, DayView, IngredientSheet, IngredientView, MenuView, baht, n0, pctTone, signedBaht } from "@/components/food-cost/FoodCostViews";
import { StockCard } from "@/components/StockCard";
import { SegmentedTabs } from "@/components/SegmentedTabs";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = FoodCostMasters & {
  /** Dev demo only: example rows instead of the database */
  loader?: FoodCostLoader;
};
type View = "menus" | "ingredients" | "days";

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const monthRange = (y: number, m: number) => ({ from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) });
const thai = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("th-TH", { day: "numeric", month: "short" });
const monthLabel = (from: string) => new Date(`${from}T00:00:00`).toLocaleDateString("th-TH", { month: "short", year: "2-digit" });

/**
 * Food cost: what the recipes say sales should have cost, and (one branch, a month
 * that has ended) what was really used from the counts. Opens on the latest month
 * and works it out at once; problems come first, each one tap from where it's fixed.
 */
export default function FoodCostPage(props: Props) {
  const { isStoreManager, isManagement, profile } = useAuth();
  const navigate = useNavigate();
  const now = new Date();
  const today = iso(now);

  // Months to pick: this one and the three before. The first week of a month
  // opens on the month just closed (month-end review), otherwise this month.
  const months = useMemo(() => [0, 1, 2, 3].map((k) => monthRange(now.getFullYear(), now.getMonth() - k)), [today]); // eslint-disable-line react-hooks/exhaustive-deps
  const [period, setPeriod] = useState(() => (now.getDate() <= 7 ? months[1] : months[0]));
  const [custom, setCustom] = useState(false);

  const branches = useMemo(() => props.branches.filter((b) => b.status === "Active"), [props.branches]);
  // A store manager sees their own branch only (none set = nothing to show)
  const own = isStoreManager ? (profile?.branch_id ? [profile.branch_id] : []) : null;
  const [branch, setBranch] = useState<string>(own?.[0] ?? (branches.length === 1 ? branches[0].id : "all"));
  // "All" also counts branches closed since (their sales in the period still happened);
  // for an area manager the list is already their own branches
  const branchIds = own ?? (branch === "all" ? props.branches.map((b) => b.id) : [branch]);

  const [view, setView] = useState<View>("menus");
  const [sheetFor, setSheetFor] = useState<string | null>(null);
  const [historyFor, setHistoryFor] = useState<string | null>(null);

  const { result, loading, error } = useFoodCost(props, period.from, period.to, branchIds, props.loader);
  const std = result?.std;
  const actual = result?.actual ?? null;
  const closed = isClosedMonth(period.from, period.to, today);
  const periodText = custom ? `${period.from} – ${period.to}` : monthLabel(period.from);
  const branchText = branchIds.length === 1 ? branches.find((b) => b.id === branchIds[0])?.branchName ?? "" : "ทุกสาขา";

  const openMenu = (code: string) => navigate(`/cost-center#${encodeURIComponent(code)}`);
  const openProduct = (skuId: string) => {
    const code = props.skus.find((s) => s.id === skuId)?.skuId;
    if (code) navigate(`/cost-center#p/${encodeURIComponent(code)}`);
  };
  const sheetRow = sheetFor ? std?.skus.find((s) => s.skuId === sheetFor) ?? null : null;
  const sheetActual = sheetFor ? actual?.rows.find((r) => r.skuId === sheetFor) ?? null : null;
  const historySku = historyFor ? props.skus.find((s) => s.id === historyFor) : undefined;

  const pct = (cost: number) => (std && std.revenue > 0 ? (cost / std.revenue) * 100 : 0);
  const chip = (on: boolean) => cn("inline-flex min-h-[40px] items-center gap-1.5 rounded-full border px-3.5 text-sm", on ? "border-primary bg-primary font-semibold text-primary-foreground" : "border-border bg-card");

  const exportExcel = () => {
    if (!std) return;
    const wb = XLSX.utils.book_new();
    const menus = std.menus.map((m) => ({ รหัส: m.code, เมนู: m.name, หมวด: m.category, ขายได้: m.qty, ยอดขาย: Math.round(m.revenue * 100) / 100, ต้นทุนตามสูตร: Math.round(m.stdCost * 100) / 100, "% ต้นทุน": Math.round(m.pct * 10) / 10, "ต้นทุน/ที่": Math.round(m.perServing * 100) / 100 }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(menus), "เมนู");
    const rows = (actual?.rows ?? std.skus).map((r) => {
      const a = actual ? (r as (typeof actual.rows)[number]) : null;
      return {
        รหัส: r.code,
        วัตถุดิบ: r.name,
        ประเภท: r.type,
        หน่วย: r.uom,
        ตามสูตร: Math.round(r.stdQty * 100) / 100,
        "ปรับจากสูตร": r.correction ? Math.round(r.correction.qty * 100) / 100 : "",
        "฿/หน่วย มาตรฐาน": r.stdPrice,
        ต้นทุนตามสูตร: Math.round(r.stdCost * 100) / 100,
        ...(a
          ? {
              ยกมา: a.opening?.qty ?? "",
              รับเข้า: Math.round(a.received * 100) / 100,
              ปิดช่วง: a.closing?.qty ?? "",
              ใช้จริง: a.actQty != null ? Math.round(a.actQty * 100) / 100 : "",
              "฿/หน่วย จริง": Math.round(a.actPrice * 10000) / 10000,
              ต้นทุนจริง: a.actCost != null ? Math.round(a.actCost * 100) / 100 : "",
              ต่างเพราะราคา: a.priceVar != null ? Math.round(a.priceVar * 100) / 100 : "",
              ต่างรวม: a.totalVar != null ? Math.round(a.totalVar * 100) / 100 : "",
            }
          : {}),
      };
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "วัตถุดิบ");
    XLSX.writeFile(wb, `ต้นทุนอาหาร-${branchText}-${period.from}-${period.to}.xlsx`);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-bold">ต้นทุนอาหาร</h1>
          <p className="text-sm text-muted-foreground">ต้นทุนตามสูตรจากยอดขาย · ต้นทุนจริงจากการนับสต๊อก (สาขาเดียว เดือนที่จบแล้ว)</p>
        </div>
        <Button variant="outline" className="h-10" onClick={exportExcel} disabled={!std}>
          <Download className="h-4 w-4" /> ส่งออก Excel
        </Button>
      </div>

      {/* Period and branch: picking one works it out straight away */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-10 text-sm text-muted-foreground">เดือน</span>
          {months.map((m, i) => (
            <button
              key={m.from}
              type="button"
              className={chip(!custom && period.from === m.from && period.to === m.to)}
              onClick={() => {
                setCustom(false);
                setPeriod(m);
              }}
            >
              {monthLabel(m.from)}
              {i === 0 ? <span className="text-xs opacity-80">· ยังไม่จบ</span> : ""}
            </button>
          ))}
          <button type="button" className={chip(custom)} onClick={() => setCustom(true)}>
            เลือกช่วงเอง
          </button>
          {custom && (
            <span className="flex flex-wrap items-center gap-2">
              <input type="date" aria-label="ตั้งแต่" value={period.from} max={period.to} onChange={(e) => e.target.value && setPeriod((p) => ({ ...p, from: e.target.value }))} className="h-10 rounded-xl border border-border bg-card px-3 text-base sm:text-sm" />
              <span className="text-sm text-muted-foreground">ถึง</span>
              <input type="date" aria-label="ถึง" value={period.to} min={period.from} onChange={(e) => e.target.value && setPeriod((p) => ({ ...p, to: e.target.value }))} className="h-10 rounded-xl border border-border bg-card px-3 text-base sm:text-sm" />
            </span>
          )}
        </div>
        {!own && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-10 text-sm text-muted-foreground">สาขา</span>
            {branches.length > 1 && (
              <button type="button" className={chip(branch === "all")} onClick={() => setBranch("all")}>
                {isManagement ? "ทุกสาขา" : "ทุกสาขาที่ดูแล"}
              </button>
            )}
            {branches.map((b) => (
              <button key={b.id} type="button" className={chip(branch === b.id)} onClick={() => setBranch(b.id)}>
                {b.branchName}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      {branchIds.length === 0 && <p className="rounded-xl bg-secondary px-3 py-2 text-sm text-muted-foreground">บัญชีนี้ยังไม่มีสาขาที่ดูได้ ติดต่อผู้ดูแลระบบให้ตั้งสาขา</p>}

      {branchIds.length === 0 ? null : !std ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-[92px] animate-pulse rounded-2xl bg-secondary" />
          ))}
        </div>
      ) : (
        <div className={cn("flex flex-col gap-4 transition-opacity", loading && "opacity-50")}>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 [&>*]:min-w-0">
            <div className="rounded-2xl border border-border bg-card px-4 py-3">
              <div className="text-sm text-muted-foreground">ยอดขาย</div>
              <div className="break-all font-mono text-xl font-semibold sm:text-2xl">{baht(std.revenue)}</div>
              <div className="text-xs text-muted-foreground">{std.bills ? `เฉลี่ยบิลละ ${baht(std.revenue / std.bills)}` : "หักส่วนลด ไม่รวม VAT/SC"}</div>
            </div>
            <div className="rounded-2xl border border-border bg-card px-4 py-3">
              <div className="text-sm text-muted-foreground">ต้นทุนตามสูตร</div>
              <div className="break-all font-mono text-xl font-semibold sm:text-2xl">{baht(std.stdCost)}</div>
              <div className="text-xs text-muted-foreground">
                <b className={cn("font-mono", pctTone(pct(std.stdCost)))}>{pct(std.stdCost).toFixed(1)}%</b> ของยอดขาย
              </div>
            </div>
            <div className={cn("rounded-2xl bg-card px-4 py-3", actual ? "border-[1.5px] border-foreground" : "border border-border")}>
              <div className="text-sm text-muted-foreground">ต้นทุนจริง (จากนับสต๊อก)</div>
              {actual ? (
                <>
                  <div className="break-all font-mono text-xl font-semibold sm:text-2xl">{baht(actual.actCost)}</div>
                  <div className="text-xs text-muted-foreground">
                    <b className={cn("font-mono", pctTone(pct(actual.actCost)))}>{pct(actual.actCost).toFixed(1)}%</b> ของยอดขาย
                  </div>
                </>
              ) : (
                <>
                  <div className="text-xl font-semibold text-muted-foreground">—</div>
                  <div className="text-xs text-muted-foreground">{branchIds.length > 1 ? "เลือกสาขาเดียว" : closed ? "ไม่มียอดนับ" : custom ? "เลือกทั้งเดือนที่จบแล้ว" : "รอจบเดือน + นับปิดเดือน"}</div>
                </>
              )}
            </div>
            <div className="rounded-2xl border border-border bg-card px-4 py-3">
              <div className="text-sm text-muted-foreground">จริงต่างจากสูตร</div>
              {actual ? (
                <>
                  <div className={cn("break-all font-mono text-xl font-semibold sm:text-2xl", actual.totalVar < 0 ? "text-success" : "text-destructive")}>{signedBaht(actual.totalVar)}</div>
                  <div className="text-xs text-muted-foreground">
                    ราคา {signedBaht(actual.priceVar)} · ใช้ {signedBaht(actual.usageVar)}
                  </div>
                </>
              ) : (
                <>
                  <div className="text-xl font-semibold text-muted-foreground">—</div>
                  <div className="text-xs text-muted-foreground">{periodText} · {branchText}</div>
                </>
              )}
            </div>
          </div>
          {actual && (
            <p className="-mt-2 text-xs text-muted-foreground">
              มียอดนับ {actual.withCounts}/{actual.rows.length} วัตถุดิบ · ยกมาจากยอดนับ {thai(result!.openingDate)} · ปิดช่วงจากยอดนับ {thai(result!.closingDate)} (ไม่มีตรงวันใช้วันใกล้สุด ±3 วัน)
            </p>
          )}

          <AttentionBox items={result!.attention} onSku={setSheetFor} onMenu={openMenu} />

          <SegmentedTabs<View>
            tabs={[
              { key: "menus", label: `เมนู ${std.menus.length}` },
              { key: "ingredients", label: `วัตถุดิบ ${std.skus.length}` },
              { key: "days", label: "รายวัน" },
            ]}
            value={view}
            onChange={setView}
          />
          {view === "menus" ? <MenuView rows={std.menus} onOpen={openMenu} /> : view === "ingredients" ? <IngredientView rows={std.skus} actual={actual?.rows ?? null} onOpen={setSheetFor} /> : <DayView days={std.days} />}
        </div>
      )}

      {sheetRow && (
        <IngredientSheet
          row={sheetRow}
          actual={sheetActual}
          period={`${branchText} · ${periodText}`}
          onClose={() => setSheetFor(null)}
          onOpenProduct={() => openProduct(sheetRow.skuId)}
          onHistory={branchIds.length === 1 ? () => setHistoryFor(sheetRow.skuId) : undefined}
        />
      )}
      {historySku && branchIds.length === 1 && (
        <StockCard
          skuId={historySku.id}
          skuType={historySku.type as "RM" | "SM"}
          sku={historySku}
          skus={props.skus}
          currentStock={sheetActual?.closing?.qty ?? 0}
          stockValue={0}
          onClose={() => setHistoryFor(null)}
          context="branch"
          branchId={branchIds[0]}
          disableMismatchCheck
        />
      )}
      {std && !std.revenue && !loading && <p className="text-center text-sm text-muted-foreground">ไม่มียอดขายในช่วงนี้ · ยอดขาย {n0(0)} บาท</p>}
    </div>
  );
}
