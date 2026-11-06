import { useEffect, useMemo, useRef, useState } from "react";
import { ClipboardCopy, CornerDownRight, FileDown, ImageDown, MessageSquareText, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { table as tbl, tableMinWidth } from "@/lib/design-tokens";
import { fmtBaht, fmtPct, fmtQty, parseCount, footerNotes, headerLines, NO_PRICE, sheetFileName, toHtmlTable, toLineText, toTsv, type RecipeSheet, type SheetRow } from "@/lib/recipe-sheet";

// วัตถุดิบ (auto) · ใช้ต่อ · หน่วย · Yield · รวม · เตรียม · ขนาด/แพ็ค · ราคา/แพ็ค · สั่ง · ยอดสั่ง · สเปค · ซัพฯ
const SHEET_TABLE_MIN_W = tableMinWidth([84, 56, 72, 84, 96, 108, 92, 84, 100, 200, 140]);
/** Width the image is drawn at, whatever the screen: the whole table, legible in LINE */
const IMAGE_WIDTH = 1400;

/** Last number typed, per device (not saved anywhere else) */
const storeKey = (kind: "menu" | "sm") => `ck:recipe-sheet:${kind === "menu" ? "portions" : "batches"}`;
function readLast(kind: "menu" | "sm"): string {
  try {
    const v = Number(localStorage.getItem(storeKey(kind)));
    return v > 0 ? String(v) : "1";
  } catch {
    return "1";
  }
}
function writeLast(kind: "menu" | "sm", v: number) {
  try {
    localStorage.setItem(storeKey(kind), String(v));
  } catch {
    // Private mode / blocked storage: the number just isn't remembered
  }
}

type Busy = null | "image" | "pdf" | "table" | "text";

/** Toasts go on top: at the default bottom-right they sit over the action buttons (and hovering keeps them there) */
const AT_TOP = { position: "top-center" as const };

interface Props {
  kind: "menu" | "sm";
  /** The sheet for this many portions (menu) or production runs (SM) */
  build: (multiplier: number) => RecipeSheet;
  onClose: () => void;
}

/**
 * "ส่งสูตรให้หน้าร้าน": the recipe as a prep + order sheet for a shop, on a slide-over.
 * Send it as a picture (phone: the share sheet, so LINE and the group can be picked;
 * computer: a JPEG download, or a PDF), or copy it as a table / as LINE text.
 */
export function RecipeSheetPanel({ kind, build, onClose }: Props) {
  const [text, setText] = useState(() => readLast(kind));
  const parsed = parseCount(text);
  const valid = parsed !== null;
  // While the box holds something unusable the table keeps the last good count (said in red)
  // and nothing can be sent or copied — never a quiet fallback to 1
  const [lastGood, setLastGood] = useState(() => parseCount(readLast(kind)) ?? 1);
  const n = parsed ?? lastGood;
  useEffect(() => {
    if (parsed !== null) setLastGood(parsed);
  }, [parsed]);
  const sheet = useMemo(() => build(n), [build, n]);
  const [busy, setBusy] = useState<Busy>(null);
  const imageNode = useRef<HTMLDivElement>(null);
  // The picture is made ahead (after typing stops), so tapping "ส่งเป็นภาพ" opens the
  // share sheet straight away (iOS refuses a share that comes long after the tap) and a
  // computer's first download doesn't wait for the fonts (~several seconds the first time)
  const ready = useRef<{ key: string; file: File } | null>(null);
  const sheetKey = useMemo(() => toTsv(sheet), [sheet]);
  const fileName = sheetFileName(sheet, "jpg");

  useEffect(() => {
    if (valid) writeLast(kind, n);
  }, [kind, n, valid]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const makeImage = async (): Promise<File> => {
    const { renderSheet, canvasBlob } = await import("@/lib/recipe-sheet-export");
    if (!imageNode.current) throw new Error("ยังไม่พร้อม ลองอีกครั้ง");
    const r = await renderSheet(imageNode.current);
    const blob = await canvasBlob(r.canvas, "image/jpeg");
    return new File([blob], fileName, { type: "image/jpeg" });
  };

  useEffect(() => {
    if (!valid) return;
    let cancelled = false;
    const t = setTimeout(() => {
      makeImage()
        .then((file) => {
          if (!cancelled) ready.current = { key: sheetKey, file };
        })
        .catch(() => {
          // Made again on tap
        });
    }, 1200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetKey, valid]);

  const run = async (what: Exclude<Busy, null>, work: () => Promise<void>, failText: string) => {
    if (busy || !valid) return;
    setBusy(what);
    try {
      await work();
    } catch (e) {
      // The person closed the share sheet: nothing went wrong
      if (e instanceof DOMException && e.name === "AbortError") return;
      toast.error(`${failText}: ${e instanceof Error ? e.message : String(e)}`, AT_TOP);
    } finally {
      setBusy(null);
    }
  };

  const sendImage = () =>
    run(
      "image",
      async () => {
        const { canShareFile, downloadBlob } = await import("@/lib/recipe-sheet-export");
        const cached = ready.current?.key === sheetKey ? ready.current.file : null;
        const file = cached ?? (await makeImage());
        if (canShareFile(file)) {
          try {
            await navigator.share({ files: [file], title: `สูตร ${sheet.title}` });
            return;
          } catch (e) {
            if (e instanceof DOMException && e.name === "AbortError") return;
            // Too long after the tap (the picture took a while): it's ready now
            if (e instanceof DOMException && e.name === "NotAllowedError") {
              ready.current = { key: sheetKey, file };
              toast.info("ภาพพร้อมแล้ว กด “ส่งเป็นภาพ” อีกครั้งเพื่อเลือก LINE", AT_TOP);
              return;
            }
            throw e;
          }
        }
        downloadBlob(file, file.name);
        toast.success("บันทึกภาพแล้ว", AT_TOP);
      },
      "ทำภาพไม่สำเร็จ",
    );

  const savePdf = () =>
    run(
      "pdf",
      async () => {
        const { renderSheet, sheetPdf, downloadBlob } = await import("@/lib/recipe-sheet-export");
        const node = imageNode.current;
        if (!node) throw new Error("ยังไม่พร้อม ลองอีกครั้ง");
        const top = node.getBoundingClientRect().top;
        const edges = [...node.querySelectorAll("tr, [data-sheet-block]")].map((el) => el.getBoundingClientRect().bottom - top);
        const r = await renderSheet(node);
        downloadBlob(await sheetPdf(r, edges), sheetFileName(sheet, "pdf"));
        toast.success("บันทึก PDF แล้ว", AT_TOP);
      },
      "ทำ PDF ไม่สำเร็จ",
    );

  const copyAsTable = () =>
    run(
      "table",
      async () => {
        const { copyTable } = await import("@/lib/recipe-sheet-export");
        const how = await copyTable(toHtmlTable(sheet), sheetKey);
        toast.success(how === "table" ? "คัดลอกตารางแล้ว วางใน Google Sheets/Docs ได้เลย" : "คัดลอกแล้ว (เป็นข้อความคั่นแท็บ)", AT_TOP);
      },
      "คัดลอกไม่สำเร็จ",
    );

  const copyAsText = () =>
    run(
      "text",
      async () => {
        const { copyText } = await import("@/lib/recipe-sheet-export");
        await copyText(toLineText(sheet));
        toast.success("คัดลอกข้อความแล้ว วางในไลน์ได้เลย", AT_TOP);
      },
      "คัดลอกไม่สำเร็จ",
    );

  const [title, meta, how] = headerLines(sheet);

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/30" onClick={onClose} aria-hidden="true" />
      <div role="dialog" aria-modal="true" aria-label="ส่งสูตรให้หน้าร้าน" className="fixed inset-y-0 right-0 z-[70] flex w-full max-w-[1180px] flex-col border-l bg-background text-foreground shadow-xl">
        <div className="flex items-start gap-3 border-b px-4 pb-3 pt-4">
          <div className="min-w-0 flex-1">
            <p className="text-sm text-muted-foreground">ส่งสูตรให้หน้าร้าน</p>
            <h2 className="break-words text-lg font-semibold leading-snug">{sheet.title}</h2>
            <p className="text-sm text-muted-foreground">
              <span className="font-mono">{sheet.code}</span> · {meta}
            </p>
          </div>
          <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0" onClick={onClose} aria-label="ปิด">
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium">{kind === "menu" ? "จำนวน portion" : "จำนวนรอบผลิต"}</span>
              <Input value={text} onChange={(e) => setText(e.target.value)} inputMode="decimal" className={cn("h-11 w-32 text-right font-mono text-[16px]", !valid && "border-destructive")} aria-invalid={!valid} />
            </label>
            {valid ? (
              <p className="pb-2 text-sm text-muted-foreground">{how}</p>
            ) : (
              <p role="alert" className="pb-2 text-sm font-semibold text-destructive">
                ใส่จำนวน 1–10,000 ก่อน · ตอนนี้ส่งหรือคัดลอกไม่ได้ (ตารางยังแสดงที่ {fmtQty(lastGood)})
              </p>
            )}
          </div>

          <div className="mt-3 overflow-hidden rounded-lg border">
            <SheetTable sheet={sheet} />
          </div>
          <SheetNotes sheet={sheet} className="mt-2" />
        </div>

        <div className="grid grid-cols-2 gap-2 border-t bg-background px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:flex md:flex-wrap md:justify-end">
          <Button variant="brand" className="h-11" loading={busy === "image"} disabled={!valid || (!!busy && busy !== "image")} onClick={sendImage}>
            <ImageDown /> ส่งเป็นภาพ
          </Button>
          <Button variant="outline" className="h-11" loading={busy === "pdf"} disabled={!valid || (!!busy && busy !== "pdf")} onClick={savePdf}>
            <FileDown /> บันทึกเป็น PDF
          </Button>
          <Button variant="outline" className="h-11" loading={busy === "table"} disabled={!valid || (!!busy && busy !== "table")} onClick={copyAsTable}>
            <ClipboardCopy /> คัดลอกเป็นตาราง
          </Button>
          <Button variant="outline" className="h-11" loading={busy === "text"} disabled={!valid || (!!busy && busy !== "text")} onClick={copyAsText}>
            <MessageSquareText /> คัดลอกเป็นข้อความ
          </Button>
        </div>
      </div>

      {/* The picture: the whole table at desktop width, off screen (phones included), always in light colours */}
      <div ref={imageNode} aria-hidden="true" data-export-node className="force-light pointer-events-none fixed top-0 bg-card p-8 text-foreground" style={{ left: -20000, width: IMAGE_WIDTH }}>
        <div data-sheet-block className="mb-4 flex flex-col gap-1">
          <div className="text-2xl font-bold">{title}</div>
          <div className="text-base text-muted-foreground">{meta}</div>
          <div className="text-base">{how}</div>
        </div>
        <div className="overflow-hidden rounded-lg border">
          <SheetTable sheet={sheet} large />
        </div>
        <SheetNotes sheet={sheet} className="mt-3 text-base" />
      </div>
    </>
  );
}

function SheetNotes({ sheet, className }: { sheet: RecipeSheet; className?: string }) {
  const [rounding, ...rest] = footerNotes(sheet);
  return (
    <div data-sheet-block className={cn("flex flex-col gap-0.5 text-sm", className)}>
      <p className="text-muted-foreground">{rounding}</p>
      {rest.map((t) => (
        <p key={t} className="font-medium text-warning">
          {t}
        </p>
      ))}
    </div>
  );
}

const dash = <span className="text-muted-foreground">—</span>;

/** The sheet's table: on screen (scrolls in its own box) and in the picture (large) */
function SheetTable({ sheet, large = false }: { sheet: RecipeSheet; large?: boolean }) {
  const cell = large ? "px-2 py-2 text-[15px]" : tbl.dataCellCompact;
  const num = cn(cell, "text-right font-mono tabular-nums");
  const head = cn(large ? "px-2 py-2 text-[13px]" : "px-2 py-2 text-xs", "font-medium text-muted-foreground align-bottom");
  const perLabel = sheet.unitLabel === "รอบ" ? "ใช้ต่อรอบ" : "ใช้ต่อ portion";
  const rows = sheet.groups.reduce((s, g) => s + g.rows.length, 0);
  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed border-collapse" style={{ minWidth: SHEET_TABLE_MIN_W }}>
        <colgroup>
          <col />
          <col style={{ width: "84px" }} />
          <col style={{ width: "56px" }} />
          <col style={{ width: "72px" }} />
          <col style={{ width: "84px" }} />
          <col style={{ width: "96px" }} />
          <col style={{ width: "108px" }} />
          <col style={{ width: "92px" }} />
          <col style={{ width: "84px" }} />
          <col style={{ width: "100px" }} />
          <col style={{ width: "200px" }} />
          <col style={{ width: "140px" }} />
        </colgroup>
        <thead>
          <tr className={tbl.headerRow}>
            <th className={cn(head, "text-left")}>วัตถุดิบ</th>
            <th className={cn(head, "text-right")}>{perLabel}</th>
            <th className={cn(head, "text-left")}>หน่วย</th>
            <th className={cn(head, "text-right")}>Yield (%)</th>
            <th className={cn(head, "text-right")}>รวมที่ใช้</th>
            <th className={cn(head, "text-right")}>เตรียมก่อน Yield</th>
            <th className={cn(head, "text-right")}>ขนาด/แพ็ค</th>
            <th className={cn(head, "text-right")}>ราคา/แพ็ค</th>
            <th className={cn(head, "text-right")}>สั่ง (แพ็ค)</th>
            <th className={cn(head, "text-right")}>ยอดสั่ง</th>
            <th className={cn(head, "text-left")}>สเปค / หมายเหตุ</th>
            <th className={cn(head, "text-left")}>ซัพพลายเออร์</th>
          </tr>
        </thead>
        <tbody>
          {rows === 0 && (
            <tr>
              <td colSpan={12} className={tbl.emptyState}>
                No recipe lines found.
              </td>
            </tr>
          )}
          {sheet.groups.map((g, gi) => (
            <GroupRows key={g.title ?? gi} title={g.title} rows={g.rows} cell={cell} num={num} />
          ))}
        </tbody>
        <tfoot>
          <tr className={tbl.footerRow}>
            <td colSpan={9} className={cn(cell, "font-semibold")}>
              ยอดสั่งรวม{sheet.noPriceCount > 0 && <span className="font-normal text-muted-foreground"> · ไม่รวม {sheet.noPriceCount} รายการที่ไม่มีราคา</span>}
            </td>
            <td className={cn(num, "font-semibold")}>{fmtBaht(sheet.total)}</td>
            <td colSpan={2} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function GroupRows({ title, rows, cell, num }: { title: string | null; rows: SheetRow[]; cell: string; num: string }) {
  return (
    <>
      {title && (
        <tr className="border-b border-table-border bg-secondary/60">
          <td colSpan={12} className={cn(cell, "font-semibold")}>
            {title}
          </td>
        </tr>
      )}
      {rows.map((r) => {
        const priced = r.kind === "buy";
        return (
          <tr key={r.key} className={cn("border-b border-table-border align-top", r.kind === "shop" && "bg-secondary/30")}>
            <td className={cn(cell, "break-words")}>
              <div className={cn("flex items-start gap-1.5", r.indent && "pl-4")}>
                {r.indent && <CornerDownRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
                <div className="min-w-0">
                  <div className="font-medium">{r.name}</div>
                  {r.code && <div className="font-mono text-[11px] text-muted-foreground">{r.code}</div>}
                </div>
              </div>
            </td>
            <td className={num}>{r.perUnit > 0 ? fmtQty(r.perUnit) : dash}</td>
            <td className={cell}>{r.uom || dash}</td>
            <td className={num}>{fmtPct(r.yieldPct)}</td>
            <td className={num}>{r.total > 0 ? fmtQty(r.total) : dash}</td>
            <td className={cn(num, "font-semibold")}>{r.prep > 0 ? fmtQty(r.prep) : dash}</td>
            <td className={num}>
              {r.packSize === null ? (
                dash
              ) : (
                <>
                  {fmtQty(r.packSize)} <span className="text-muted-foreground">{r.purchaseUom}</span>
                </>
              )}
            </td>
            <td className={cn(num, priced && r.pricePerPack === null && "font-sans font-semibold text-destructive")}>{!priced ? dash : r.pricePerPack === null ? NO_PRICE : fmtBaht(r.pricePerPack)}</td>
            <td className={cn(num, "font-semibold")}>
              {r.kind === "shop" ? (
                dash
              ) : !r.orderOnRow ? (
                <span className="font-sans text-[11px] font-normal text-muted-foreground">รวมแถวบน</span>
              ) : r.order ? (
                <>
                  {fmtQty(r.order.qty)} <span className="font-normal text-muted-foreground">{r.order.unit}</span>
                  {r.itemRows > 1 && <div className="font-sans text-[11px] font-normal text-muted-foreground">รวม {r.itemRows} แถว</div>}
                </>
              ) : (
                dash
              )}
            </td>
            <td className={cn(num, priced && r.orderOnRow && r.pricePerPack === null && "font-sans font-semibold text-destructive")}>
              {!priced || !r.orderOnRow ? dash : r.pricePerPack === null ? NO_PRICE : r.amount === null ? dash : fmtBaht(r.amount)}
            </td>
            <td className={cn(cell, "break-words")}>{r.note || dash}</td>
            <td className={cn(cell, "break-words", r.kind !== "buy" && "font-medium text-primary")}>{r.supplier}</td>
          </tr>
        );
      })}
    </>
  );
}
