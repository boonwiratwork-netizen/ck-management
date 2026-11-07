import { useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { useCkPeriod } from "@/hooks/use-ck-production";
import { kitchenResult, type KitchenResult } from "@/lib/reconcile-kitchen";
import { onlyOff, type RcPeriod, type RcRow, type RcSku } from "@/lib/reconcile";
import { ReconcileTable } from "@/components/reconcile/ReconcileTable";

/**
 * ครัวกลาง scope. The kitchen counts once a month, so it is compared by month only, with the
 * kitchen dashboard's own month cost (hooks/use-ck-production.ts — recipe vs what really left
 * stock between the two month counts, per raw material). No closing count yet = nothing to
 * compare: said so, never estimated from today's balances.
 */

const NO_LIVE: { skuId: string; currentStock: number }[] = [];

interface Props {
  period: RcPeriod;
  skus: RcSku[];
  price: (id: string) => number;
  onlyOffRows: boolean;
  onEditRecipe: (code: string) => void;
  /** Rows ready for the copy button */
  onRows: (rows: RcRow[]) => void;
  /** Dev demo: a made-up result instead of reading */
  demo?: KitchenResult;
}

function KitchenLive(props: Omit<Props, "demo">) {
  const { data, loading, error } = useCkPeriod(props.period.from, props.period.to, NO_LIVE, true);
  const result = useMemo(() => kitchenResult(data, loading, error, props.skus, props.price, props.period.ongoing), [data, loading, error, props.skus, props.price, props.period.ongoing]);
  return <KitchenView {...props} result={result} />;
}

export function KitchenReconcile(props: Props) {
  return props.demo ? <KitchenView {...props} result={props.demo} /> : <KitchenLive {...props} />;
}

function KitchenView({ result, onlyOffRows, onEditRecipe, onRows }: Omit<Props, "demo"> & { result: KitchenResult }) {
  const shown = result.kind === "rows" ? (onlyOffRows ? onlyOff(result.rows) : result.rows) : [];
  // Hand the shown rows up for "คัดลอกเป็นตาราง"
  useEffect(() => onRows(shown), [result, onlyOffRows]); // eslint-disable-line react-hooks/exhaustive-deps
  if (result.kind === "loading") return <div className="h-40 animate-pulse rounded-xl bg-secondary" aria-label="กำลังโหลด" />;
  if (result.kind === "error") return <p className="rounded-xl bg-destructive/10 px-3 py-3 text-sm text-destructive">โหลดข้อมูลครัวไม่สำเร็จ ลองเปิดใหม่อีกครั้ง</p>;
  if (result.kind === "note") return <KitchenNote text={result.text} />;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[13px] text-muted-foreground">
        ครัวกลาง นับ {thShort(result.opening)} และ {thShort(result.closing)}
        {result.uncounted > 0 && <span className="whitespace-nowrap"> · ไม่ได้นับ {result.uncounted} รายการ (ไม่แสดง)</span>}
      </p>
      {shown.length === 0 ? (
        <p className="rounded-xl bg-secondary px-3 py-3 text-sm text-muted-foreground">{onlyOffRows ? "ไม่มีวัตถุดิบที่ห่างจากสูตรเกิน 10%" : "ไม่มีวัตถุดิบให้เทียบในเดือนนี้"}</p>
      ) : (
        <ReconcileTable rows={shown} columns={[{ id: "ck", name: "ครัวกลาง" }]} kitchen onEditRecipe={onEditRecipe} />
      )}
    </div>
  );
}

function KitchenNote({ text }: { text: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-secondary px-3 py-3 text-sm">
      <p>{text}</p>
      <Link to="/dashboard" className="self-start font-semibold text-brand">
        ไปภาพรวมครัวกลาง ›
      </Link>
    </div>
  );
}

const thShort = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("th-TH", { day: "numeric", month: "short", timeZone: "UTC" });
