import { Fragment, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { tableMinWidth } from "@/lib/design-tokens";
import { cellText, LABEL_TEXT, thDay, type Cell, type Label, type RcRow } from "@/lib/reconcile";
import { cn } from "@/lib/utils";

/**
 * The reconcile table: one row per item, one column per branch (or one "ครัวกลาง" column).
 * Phone first: the item column stays put while branch columns scroll inside the box; a tap
 * opens the item's details as a row under it.
 */

export interface RcColumn {
  id: string;
  name: string;
}

/** A branch column: "ใช้เกิน 24%" over "+1,024 ก." fits in 88px; wider on a big screen (a long branch name) */
const BR_COL = 88;
const BR_COL_WIDE = 140;
const NAME_MIN = 160;
/** Two branch columns still fit a 375px phone without scrolling */
const RC_MIN = tableMinWidth([88, 88], 160);

const LABEL_TONE: Record<Label, string> = {
  bad: "bg-destructive-soft text-destructive",
  bom: "bg-warning-soft text-warning",
  shop: "bg-brand-soft text-brand-soft-foreground",
  near: "bg-success-soft text-success",
  kitchen: "bg-warning-soft text-warning",
};

const VERDICT_TONE: Record<Cell["verdict"], string> = {
  short: "text-destructive",
  over: "text-warning",
  near: "text-success",
  bad: "text-muted-foreground",
};

const n0 = (v: number) => Math.round(v).toLocaleString("th-TH");
const qty = (v: number, unit: string) => `${n0(v)} ${unit}`.trim();
const thb = (v: number) => `฿${n0(Math.max(0, v))}`;

export function LabelPill({ label }: { label: Label }) {
  return <span className={cn("inline-block rounded-lg px-2 py-0.5 text-xs font-semibold leading-snug", LABEL_TONE[label])}>{LABEL_TEXT[label]}</span>;
}

interface Props {
  rows: RcRow[];
  columns: RcColumn[];
  /** Kitchen scope: no waste/receipt per item (the kitchen's cost doesn't split them out) */
  kitchen?: boolean;
  onEditRecipe: (skuCode: string) => void;
}

export function ReconcileTable({ rows, columns, kitchen, onEditRecipe }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [boxWidth, setBoxWidth] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const set = () => setBoxWidth(el.clientWidth);
    set();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const wide = boxWidth >= 640;
  const minWidth = Math.max(RC_MIN, tableMinWidth(columns.map(() => (wide ? BR_COL_WIDE : BR_COL)), NAME_MIN));

  return (
    <div ref={box} className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full table-fixed border-separate border-spacing-0 text-sm" style={{ minWidth: Math.max(RC_MIN, minWidth) }}>
        <colgroup>
          <col />
          {columns.map((c) => (
            <col key={c.id} style={{ width: wide ? "140px" : "88px" }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 z-10 border-b border-border bg-card px-3 py-2 text-left text-[13px] font-semibold text-muted-foreground">
              วัตถุดิบ
            </th>
            {columns.map((c) => (
              <th key={c.id} scope="col" title={c.name} className="border-b border-border px-1.5 py-2 text-right align-bottom text-[13px] font-semibold leading-snug text-muted-foreground">
                <span className="line-clamp-2 break-words">{c.name}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isOpen = open === r.sku.id;
            return (
              <Fragment key={r.sku.id}>
                <tr className={cn(isOpen && "bg-secondary/60")}>
                  <td className={cn("sticky left-0 z-10 border-b border-secondary p-0 align-top", isOpen ? "bg-secondary" : "bg-card")}>
                    {/* The toggle is a real button (keyboard + screen reader); the number cells stay plain */}
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      onClick={() => setOpen(isOpen ? null : r.sku.id)}
                      className="flex w-full items-start gap-1 px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    >
                      {isOpen ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
                      <span className="min-w-0">
                        <span className="block break-words text-sm font-semibold leading-snug">{r.sku.name}</span>
                        <span className="mt-1 block">
                          <LabelPill label={r.label} />
                        </span>
                      </span>
                    </button>
                  </td>
                  {columns.map((c) => {
                    const cell = r.cells.get(c.id);
                    const t = cellText(cell, r.unit);
                    return (
                      <td key={c.id} className="border-b border-secondary px-1.5 py-2 text-right align-top">
                        {!t || !cell ? (
                          <span className="text-xs text-muted-foreground">ไม่มีข้อมูล</span>
                        ) : (
                          <>
                            <span className={cn("block whitespace-nowrap text-[13px] font-semibold", VERDICT_TONE[cell.verdict])}>{t.head}</span>
                            {t.sub && <span className="block whitespace-nowrap font-mono text-xs tabular-nums text-muted-foreground">{t.sub}</span>}
                          </>
                        )}
                      </td>
                    );
                  })}
                </tr>
                {isOpen && (
                  <tr>
                    <td colSpan={columns.length + 1} className="border-b border-border bg-secondary/40 p-0">
                      {/* Pinned to the visible width of the box, so it never scrolls sideways with the columns */}
                      <div className="sticky left-0" style={{ width: boxWidth || undefined }}>
                        <Details row={r} columns={columns} kitchen={kitchen} onEditRecipe={onEditRecipe} />
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Details({ row, columns, kitchen, onEditRecipe }: { row: RcRow; columns: RcColumn[]; kitchen?: boolean; onEditRecipe: (code: string) => void }) {
  const u = row.unit;
  return (
    <div className="flex flex-col gap-3 px-3 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-[13px] text-muted-foreground">
          ห่างจากสูตรรวม <b className="font-mono tabular-nums text-foreground">{thb(row.gapBaht)}</b>
        </span>
        {row.price > 0 && (
          <span className="whitespace-nowrap text-[13px] text-muted-foreground">
            ราคา <span className="font-mono tabular-nums">{row.price.toLocaleString("th-TH", { maximumFractionDigits: 3 })}</span> บาท/{u}
          </span>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {columns.map((c) => {
          const cell = row.cells.get(c.id);
          const serving = row.serving.find((s) => s.branchId === c.id);
          return (
            <section key={c.id} className="rounded-lg border border-border bg-card px-3 py-2.5">
              <h4 className="break-words text-sm font-semibold">{c.name}</h4>
              {!cell ? (
                <p className="mt-1 text-[13px] text-muted-foreground">ไม่มีวันที่นับเทียบได้ในช่วงนี้</p>
              ) : (
                <dl className="mt-1.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[13px]">
                  <dt className="text-muted-foreground">ตามสูตร</dt>
                  <dd className="text-right font-mono tabular-nums">{qty(cell.recipe, u)}</dd>
                  <dt className="text-muted-foreground">ใช้จริง</dt>
                  <dd className={cn("text-right font-mono font-semibold tabular-nums", VERDICT_TONE[cell.verdict])}>{qty(cell.used, u)}</dd>
                  {!kitchen && (
                    <>
                      <dt className="text-muted-foreground">ของเสีย</dt>
                      <dd className="text-right font-mono tabular-nums">{qty(cell.waste, u)}</dd>
                      <dt className="text-muted-foreground">รับเข้า</dt>
                      <dd className="text-right font-mono tabular-nums">{qty(cell.received, u)}</dd>
                    </>
                  )}
                  <dt className="text-muted-foreground">{kitchen ? "นับต้น–ปลาย" : "นับ"}</dt>
                  <dd className="text-right">
                    {cell.firstCount === cell.lastCount ? thDay(cell.lastCount) : `${thDay(cell.firstCount)} – ${thDay(cell.lastCount)}`}
                    {!kitchen && <span className="whitespace-nowrap text-muted-foreground"> ({cell.counts} ครั้ง)</span>}
                  </dd>
                </dl>
              )}
              {serving && (
                <div className="mt-2 border-t border-secondary pt-2 text-[13px]">
                  <p className="break-words font-medium">
                    {serving.menuName} <span className="whitespace-nowrap font-normal text-muted-foreground">(ขาย {n0(serving.sold)} จาน)</span>
                  </p>
                  <dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
                    <dt className="text-muted-foreground">สูตรต่อจาน</dt>
                    <dd className="text-right font-mono tabular-nums">{qty(serving.perServing, u)}</dd>
                    <dt className="text-muted-foreground">ใส่จริงประมาณ</dt>
                    <dd className="text-right font-mono font-semibold tabular-nums">{serving.actualPerServing === null ? "ดูไม่ได้" : qty(serving.actualPerServing, u)}</dd>
                  </dl>
                </div>
              )}
            </section>
          );
        })}
      </div>
      <button type="button" onClick={() => onEditRecipe(row.sku.code)} className="self-start rounded-full py-1 text-sm font-semibold text-brand">
        แก้สูตรวัตถุดิบนี้ ›
      </button>
    </div>
  );
}
