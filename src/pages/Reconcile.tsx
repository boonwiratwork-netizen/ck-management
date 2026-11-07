import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Copy } from "lucide-react";
import { useReconcile, type ReconcileLoader, type ReconcileMasters } from "@/hooks/use-reconcile";
import { daysWhy, onlyOff, periodText, reconcilePeriod, toTsv, type RcRow, type RcSku } from "@/lib/reconcile";
import { ReconcileTable } from "@/components/reconcile/ReconcileTable";
import { KitchenReconcile } from "@/components/reconcile/KitchenReconcile";
import type { KitchenResult } from "@/lib/reconcile-kitchen";
import { bangkokDate } from "@/lib/day-follow";
import { cn } from "@/lib/utils";

/**
 * กระทบยอด: per item, how far each branch's real use was from its recipes over a week or a
 * month (lib/reconcile.ts has the rules), and the kitchen's month from its own cost.
 * Management + kitchen manager (Index.tsx canAccessTab).
 */

interface Props {
  masters: ReconcileMasters;
  /** Dev demo only: rows from here instead of the database, a fixed today, a made-up kitchen */
  demo?: { loader: ReconcileLoader; today: string; kitchen: KitchenResult };
}

type Kind = "week" | "month";
type Scope = "branches" | "kitchen";

/** Copy text: the clipboard API inside the tap; an old browser falls back to a hidden textarea */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // falls through to the textarea
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export default function Reconcile({ masters, demo }: Props) {
  const navigate = useNavigate();
  const today = demo?.today ?? bangkokDate();
  const [kind, setKind] = useState<Kind>("week");
  const [back, setBack] = useState(0);
  const [scope, setScope] = useState<Scope>("branches");
  const [offOnly, setOffOnly] = useState(false);
  const [kitchenShown, setKitchenShown] = useState<RcRow[]>([]);

  const period = useMemo(() => reconcilePeriod(kind, today, back), [kind, today, back]);
  const { view, loading, error, retry, noBranches, price } = useReconcile(masters, period, demo?.loader);
  const skus = useMemo<RcSku[]>(() => masters.skus.map((s) => ({ id: s.id, code: s.skuId, name: s.name, purchaseUom: s.purchaseUom, usageUom: s.usageUom, converter: s.converter })), [masters.skus]);

  const branchRows = useMemo(() => (view ? (offOnly ? onlyOff(view.rows) : view.rows) : []), [view, offOnly]);
  const columns = useMemo(() => (view ? view.branches.filter((b) => view.rows.some((r) => r.cells.has(b.id))).map((b) => ({ id: b.id, name: b.name })) : []), [view]);

  // Item codes that sit in at least one menu recipe (menu_bom). Others are used through a
  // shop-prep recipe or a modifier rule, which the "ใช้ในเมนู" grid doesn't show.
  const inMenuRecipe = useMemo(() => {
    const ids = new Set(masters.menuBomLines.map((l) => l.skuId));
    return new Set(masters.skus.filter((s) => ids.has(s.id)).map((s) => s.skuId));
  }, [masters.menuBomLines, masters.skus]);
  // Kitchen recipes live on the product page; branch items in a menu recipe open the usage grid
  const editRecipe = useCallback(
    (code: string) => navigate(scope === "branches" && inMenuRecipe.has(code) ? `/cost-center#usage/${encodeURIComponent(code)}` : `/cost-center#p/${encodeURIComponent(code)}`),
    [navigate, scope, inMenuRecipe],
  );

  const copy = () => {
    const rows = scope === "kitchen" ? kitchenShown : branchRows;
    const cols = scope === "kitchen" ? [{ id: "ck", name: "ครัวกลาง" }] : columns;
    if (!rows.length) {
      toast.error("ยังไม่มีแถวให้คัดลอก");
      return;
    }
    // Started inside the tap (the clipboard only works from a user action)
    copyText(toTsv(rows, cols)).then((ok) => (ok ? toast.success(`คัดลอก ${rows.length} แถวแล้ว วางในชีทได้เลย`) : toast.error("เครื่องนี้คัดลอกไม่ได้ ลองเปิดในคอมพิวเตอร์")));
  };

  const setPeriodKind = (k: Kind) => {
    setKind(k);
    setBack(0);
  };

  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-3">
      <div>
        <h1 className="text-2xl font-bold leading-snug tracking-tight">กระทบยอด</h1>
        <p className="text-[13px] text-muted-foreground">สูตร เทียบกับที่ใช้จริง รายวัตถุดิบ</p>
      </div>

      <div className="grid grid-cols-2 rounded-xl bg-secondary p-[3px]" role="group" aria-label="ช่วงเวลา">
        {(["week", "month"] as const).map((k) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => setPeriodKind(k)} className={cn("h-[38px] rounded-[10px] text-sm", kind === k ? "bg-card font-semibold text-foreground shadow-sm" : "text-muted-foreground")}>
            {k === "week" ? "สัปดาห์" : "เดือน"}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <button type="button" aria-label="ช่วงก่อนหน้า" onClick={() => setBack((b) => b + 1)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-card">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <p className="min-w-0 flex-1 text-center text-sm font-semibold">
          <span className="whitespace-nowrap">{kind === "week" ? `7 วัน ${periodText(period)}` : monthName(period.from)}</span>
          {period.ongoing && <span className="ml-1.5 whitespace-nowrap rounded-full bg-warning-soft px-2 py-0.5 text-xs font-semibold text-warning">ยังไม่จบ</span>}
        </p>
        <button type="button" aria-label="ช่วงถัดไป" disabled={back === 0} onClick={() => setBack((b) => Math.max(0, b - 1))} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-card disabled:opacity-40">
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(["branches", "kitchen"] as const).map((s) => (
          <button key={s} type="button" aria-pressed={scope === s} onClick={() => setScope(s)} className={cn("h-9 rounded-full border px-4 text-sm", scope === s ? "border-foreground bg-foreground font-semibold text-background" : "border-border bg-card text-muted-foreground")}>
            {s === "branches" ? "สาขา" : "ครัวกลาง"}
          </button>
        ))}
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <button type="button" aria-pressed={offOnly} onClick={() => setOffOnly((v) => !v)} className={cn("h-9 whitespace-nowrap rounded-full border px-3 text-sm", offOnly ? "border-brand bg-brand-soft font-semibold text-brand-soft-foreground" : "border-border bg-card text-muted-foreground")}>
          เฉพาะที่ห่างเกิน 10%
        </button>
      </div>

      {scope === "kitchen" ? (
        kind === "week" ? (
          <div className="flex flex-col gap-2 rounded-xl bg-secondary px-3 py-3 text-sm">
            <p>ครัวกลางนับเดือนละครั้ง เลยเทียบได้เป็นรายเดือน</p>
            <button
              type="button"
              onClick={() => {
                // The last month the kitchen closed (this month has no closing count yet)
                setKind("month");
                setBack(reconcilePeriod("month", today).ongoing ? 1 : 0);
              }}
              className="self-start font-semibold text-brand"
            >
              ดูแบบเดือน ›
            </button>
          </div>
        ) : (
          <>
            <CopyButton onCopy={copy} />
            <KitchenReconcile period={period} skus={skus} price={price} onlyOffRows={offOnly} onEditRecipe={editRecipe} onRows={setKitchenShown} demo={demo?.kitchen} />
          </>
        )
      ) : (
        <>
          {error && (
            <div role="alert" className="flex flex-wrap items-center gap-2 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <span className="min-w-0 flex-1">โหลดข้อมูลไม่สำเร็จ ตัวเลขยังไม่ขึ้น (ไม่ใช่ว่าเป็นศูนย์)</span>
              <button type="button" onClick={retry} className="min-h-[40px] rounded-full border border-destructive px-4 text-sm font-semibold">
                ลองใหม่
              </button>
            </div>
          )}
          {noBranches && <p className="rounded-xl bg-secondary px-3 py-3 text-sm text-muted-foreground">ยังไม่มีสาขาที่เปิดอยู่</p>}
          {!view ? (
            !error && !noBranches && <div className="h-48 animate-pulse rounded-xl bg-secondary" aria-label="กำลังโหลด" />
          ) : (
            <>
              <ul className={cn("flex flex-col gap-1 text-[13px]", loading && "opacity-60")}>
                {view.branches.map((b) => {
                  const d = view.days.find((x) => x.branchId === b.id);
                  if (!d) return null;
                  const bad = d.usable < d.total;
                  return (
                    <li key={b.id} className={cn("break-words", bad ? "text-foreground" : "text-muted-foreground")}>
                      <span className="font-semibold">{b.name}</span> <span className="whitespace-nowrap">ข้อมูล <span className="font-mono tabular-nums">{d.usable}/{d.total}</span> วัน</span>
                      {daysWhy(d).map((w) => (
                        <span key={w} className="whitespace-nowrap text-muted-foreground">
                          {" · "}
                          {w}
                        </span>
                      ))}
                    </li>
                  );
                })}
              </ul>
              <CopyButton onCopy={copy} />
              {branchRows.length === 0 ? (
                <p className="rounded-xl bg-secondary px-3 py-3 text-sm text-muted-foreground">{offOnly ? "ไม่มีวัตถุดิบที่ห่างจากสูตรเกิน 10%" : "ไม่มีวัตถุดิบที่นับเทียบได้ในช่วงนี้"}</p>
              ) : (
                <div className={cn(loading && "opacity-60")}>
                  <ReconcileTable rows={branchRows} columns={columns} onEditRecipe={editRecipe} />
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function CopyButton({ onCopy }: { onCopy: () => void }) {
  return (
    <button type="button" onClick={onCopy} className="inline-flex h-10 items-center gap-1.5 self-end rounded-full border border-border bg-card px-4 text-sm font-semibold">
      <Copy className="h-4 w-4" />
      คัดลอกเป็นตาราง
    </button>
  );
}

const monthName = (from: string) => new Date(`${from}T00:00:00Z`).toLocaleDateString("th-TH", { month: "long", year: "numeric", timeZone: "UTC" });
