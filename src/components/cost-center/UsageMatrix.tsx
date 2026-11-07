import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { X } from "lucide-react";
import type { SKU } from "@/types/sku";
import type { Price } from "@/types/price";
import type { Menu } from "@/types/menu";
import type { Branch } from "@/types/branch";
import type { MenuBomLine } from "@/types/menu-bom";
import type { MenuBomBulkResult, UpdateMenuBomLines } from "@/hooks/use-menu-bom-data";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRowsOrThrow } from "@/lib/fetch-all";
import { tableMinWidth } from "@/lib/design-tokens";
import { MAX_PICKS, activePrice, buildMatrix, bulkYieldPreview, editProblem, lastWeek, lineValues, pickableSkus, soldByMenuCode, type MatrixRow } from "@/lib/usage-matrix";
import { SearchableSelect } from "@/components/SearchableSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { baht } from "./parts";
import { unitText } from "@/lib/reconcile";

interface Props {
  skus: SKU[];
  prices: Price[];
  menus: Menu[];
  branches: Branch[];
  lines: MenuBomLine[];
  /** Picked item codes (from the URL: #usage/RM-0027,RM-0030) */
  codes: string[];
  onCodesChange: (codes: string[]) => void;
  /** Management and the kitchen manager; anyone else sees the table only */
  canEdit: boolean;
  /** Writes menu recipe lines (absent = read-only) */
  updateLines?: UpdateMenuBomLines;
  onOpenMenu: (m: Menu) => void;
  /** Dev harness only: sold in the week per menu code, instead of reading sales */
  demoSold?: Record<string, number>;
}

/** Column widths (px): one per picked item, the week's sales, and room for the menu name */
const SKU_W = 132;
const SOLD_W = 112;
const MENU_MIN = 160;
/** The table with one item picked; more items add SKU_W each (see matrixMin) */
const MATRIX_MIN_ONE = tableMinWidth([132, 112], 160);
const matrixMin = (n: number) => tableMinWidth([SOLD_W, ...Array.from({ length: n }, () => SKU_W)], MENU_MIN);

const fmt = (n: number, digits = 2) => n.toLocaleString("th-TH", { maximumFractionDigits: digits });

type Editing = { line: MenuBomLine; menu: Menu };
type Bulk = {
  skuId: string;
  value: string;
  result?: MenuBomBulkResult;
  busy?: boolean;
  /** This save's own token: its result lands only on the panel that started it */
  run?: object;
};

/**
 * "ใช้ในเมนู": pick up to 6 items, see every menu recipe line that uses them in one
 * table, and change the amount / yield there — one line at a time, or one item's
 * yield across every menu at once. Only menu recipes are touched (never kitchen or
 * shop prep recipes). The database keeps each line's old version (recipe history).
 */
export function UsageMatrix({ skus, prices, menus, branches, lines, codes, onCodesChange, canEdit, updateLines, onOpenMenu, demoSold }: Props) {
  const editable = canEdit && !!updateLines;
  const skuByCode = useMemo(() => new Map(skus.map((s) => [s.skuId, s])), [skus]);
  const skuById = useMemo(() => new Map(skus.map((s) => [s.id, s])), [skus]);
  const branchName = useMemo(() => new Map(branches.map((b) => [b.id, b.branchName])), [branches]);
  const picked = codes.map((c) => skuByCode.get(c)).filter((s): s is SKU => !!s);
  const pickable = useMemo(() => pickableSkus(skus, lines), [skus, lines]);
  const options = pickable
    .filter((p) => !codes.includes(p.sku.skuId))
    .map((p) => ({
      value: p.sku.skuId,
      label: p.sku.name,
      sublabel: `${p.sku.skuId} · ใช้ใน ${p.menuCount} เมนู`,
    }));

  // The week's sales (all branches), read once when the tab opens
  const [sold, setSold] = useState<Record<string, number> | null>(demoSold ?? null);
  const [soldFailed, setSoldFailed] = useState(false);
  useEffect(() => {
    if (demoSold) return;
    let cancelled = false;
    const { from, to } = lastWeek();
    fetchAllRowsOrThrow<{ menu_code: string; qty: number }>(
      (a, b) => supabase.from("sales_entries").select("id, menu_code, qty").gte("sale_date", from).lte("sale_date", to).order("id").range(a, b) as never,
    )
      .then((rows) => !cancelled && setSold(soldByMenuCode(rows)))
      .catch(() => !cancelled && setSoldFailed(true));
    return () => {
      cancelled = true;
    };
  }, [demoSold]);

  const pickedKey = picked.map((s) => s.id).join(",");
  const rows = useMemo(() => buildMatrix(menus, lines, pickedKey ? pickedKey.split(",") : [], sold), [menus, lines, pickedKey, sold]);
  const activeRows = rows.filter((r) => r.active);
  const closedRows = rows.filter((r) => !r.active);

  const [editing, setEditing] = useState<Editing | null>(null);
  const [bulk, setBulk] = useState<Bulk | null>(null);
  // A line edited elsewhere / picked away: close what no longer applies
  useEffect(() => {
    if (editing && !picked.some((s) => s.id === editing.line.skuId)) setEditing(null);
    if (bulk && !picked.some((s) => s.id === bulk.skuId)) setBulk(null);
  }, [codes.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const add = (code: string) => code && codes.length < MAX_PICKS && !codes.includes(code) && onCodesChange([...codes, code]);
  const remove = (code: string) => onCodesChange(codes.filter((c) => c !== code));

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-card">
        <div className="flex flex-col gap-1">
          <h3 className="text-base font-semibold">วัตถุดิบใช้ในเมนูไหน</h3>
          <p className="text-sm text-muted-foreground">เลือกได้ {MAX_PICKS} ตัว · ดูทุกเมนูที่ใช้ แล้วแก้จากตารางได้เลย</p>
        </div>
        {codes.length < MAX_PICKS ? (
          <SearchableSelect value="" onValueChange={add} options={options} placeholder="ค้นชื่อหรือรหัสวัตถุดิบ…" triggerClassName="h-12 text-[16px]" />
        ) : (
          <p className="text-sm text-muted-foreground">ครบ {MAX_PICKS} ตัวแล้ว · เอาออกก่อนถึงเลือกเพิ่มได้</p>
        )}
        {picked.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {picked.map((s) => (
              <span key={s.id} className="inline-flex h-10 max-w-full items-center gap-1 rounded-full bg-brand-soft pl-3 pr-1 text-sm font-medium text-brand-soft-foreground">
                <span className="min-w-0 truncate">{s.name}</span>
                <button
                  type="button"
                  aria-label={`เอา ${s.name} ออก`}
                  onClick={() => remove(s.skuId)}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-background/60"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
        )}
      </section>

      {picked.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">เลือกวัตถุดิบด้านบน เพื่อดูว่าใช้ในเมนูไหนบ้าง</p>
      ) : (
        <section className="flex flex-col gap-2">
          <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-card">
            <table
              className="w-full table-fixed border-separate border-spacing-0 text-sm"
              style={{
                minWidth: Math.max(MATRIX_MIN_ONE, matrixMin(picked.length)),
              }}
            >
              <colgroup>
                <col />
                {picked.map((s) => (
                  <col key={s.id} style={{ width: "132px" }} />
                ))}
                <col style={{ width: "112px" }} />
              </colgroup>
              <thead>
                <tr className="bg-table-header align-bottom">
                  <th className="sticky left-0 z-10 border-b border-r border-border bg-table-header px-3 py-2 text-left text-[13px] font-semibold">เมนู · {rows.length}</th>
                  {picked.map((s) => (
                    <th key={s.id} className="border-b border-border px-2 py-2 text-right align-bottom font-normal">
                      <span className="line-clamp-2 break-words text-[13px] font-semibold">{s.name}</span>
                      <span className="block whitespace-nowrap text-xs text-muted-foreground">ต่อจาน ({unitText(s.usageUom)})</span>
                      {editable && (
                        <button
                          type="button"
                          onClick={() => (setEditing(null), setBulk({ skuId: s.id, value: "" }))}
                          className="mt-1 inline-flex min-h-[32px] items-center whitespace-nowrap rounded-lg border border-border bg-card px-2 text-xs font-semibold text-foreground hover:bg-secondary"
                        >
                          ตั้ง yield ทุกเมนู
                        </button>
                      )}
                    </th>
                  ))}
                  <th className="whitespace-nowrap border-b border-border py-2 pl-2 pr-3 text-right align-bottom text-[13px] font-semibold">ขาย/สัปดาห์</th>
                </tr>
              </thead>
              <tbody>
                {activeRows.map((r) => (
                  <Row
                    key={r.menu.id}
                    row={r}
                    picked={picked}
                    branchName={branchName}
                    editable={editable}
                    editingId={editing?.line.id ?? null}
                    onEdit={(line) => (setBulk(null), setEditing({ line, menu: r.menu }))}
                    onOpenMenu={onOpenMenu}
                    soldFailed={soldFailed}
                  />
                ))}
                {closedRows.length > 0 && (
                  <tr>
                    <td colSpan={picked.length + 2} className="border-b border-border bg-secondary px-3 py-2 text-[13px] font-semibold text-muted-foreground">
                      <span className="sticky left-3">เมนูที่ปิดขาย · {closedRows.length}</span>
                    </td>
                  </tr>
                )}
                {closedRows.map((r) => (
                  <Row
                    key={r.menu.id}
                    row={r}
                    picked={picked}
                    branchName={branchName}
                    editable={editable}
                    editingId={editing?.line.id ?? null}
                    onEdit={(line) => (setBulk(null), setEditing({ line, menu: r.menu }))}
                    onOpenMenu={onOpenMenu}
                    soldFailed={soldFailed}
                  />
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={picked.length + 2} className="p-6 text-center text-sm text-muted-foreground">
                      ไม่มีเมนูไหนใช้
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-[13px] text-muted-foreground">
            {soldFailed ? "โหลดยอดขายไม่ได้ · ตัวเลขสูตรยังถูกต้อง" : "ขาย 7 วันที่ผ่านมา ทุกสาขา · เมนูชุดอาจนับได้น้อยกว่าจริง"}
            {editable ? " · แตะช่องเพื่อแก้" : " · แก้ได้เฉพาะผู้บริหารและผู้จัดการครัว"}
          </p>
        </section>
      )}

      {editing && updateLines && (
        <LineEditor
          key={editing.line.id}
          editing={editing}
          sku={skuById.get(editing.line.skuId)}
          price={activePrice(prices, editing.line.skuId)}
          branch={editing.line.branchId ? (branchName.get(editing.line.branchId) ?? "สาขาเดียว") : null}
          updateLines={updateLines}
          onClose={() => setEditing(null)}
        />
      )}
      {bulk && updateLines && (
        <BulkYield bulk={bulk} setBulk={setBulk} sku={skuById.get(bulk.skuId)} lines={lines} menus={menus} price={activePrice(prices, bulk.skuId)} branchName={branchName} updateLines={updateLines} />
      )}
    </div>
  );
}

function Row({
  row,
  picked,
  branchName,
  editable,
  editingId,
  onEdit,
  onOpenMenu,
  soldFailed,
}: {
  row: MatrixRow;
  picked: SKU[];
  branchName: Map<string, string>;
  editable: boolean;
  editingId: string | null;
  onEdit: (l: MenuBomLine) => void;
  onOpenMenu: (m: Menu) => void;
  soldFailed: boolean;
}) {
  const muted = !row.active;
  return (
    <tr className={cn("align-top", muted && "text-muted-foreground")}>
      <td className="sticky left-0 z-10 border-b border-r border-border bg-card px-3 py-2">
        <button type="button" onClick={() => onOpenMenu(row.menu)} className="block w-full text-left hover:underline">
          <span className="line-clamp-2 break-words text-sm font-medium">{row.menu.menuName}</span>
          <span className="block whitespace-nowrap text-xs text-muted-foreground">{row.menu.menuCode}</span>
        </button>
      </td>
      {picked.map((s) => {
        const cell = row.cells[s.id] ?? [];
        return (
          <td key={s.id} className="border-b border-border px-1 py-1">
            <div className="flex flex-col gap-1">
              {cell.map((l) => {
                const tag = l.branchId ? `เฉพาะ ${branchName.get(l.branchId) ?? "สาขาเดียว"}` : cell.length > 1 ? "ทุกสาขา" : null;
                const body = (
                  <>
                    {tag && <span className="block break-words text-xs leading-snug text-muted-foreground">{tag}</span>}
                    <span className="block whitespace-nowrap font-mono text-sm tabular-nums">
                      {fmt(l.qtyPerServing)} {unitText(l.uom)}
                    </span>
                    {l.yieldPct !== 100 && <span className={cn("block whitespace-nowrap text-xs tabular-nums", muted ? "" : "text-warning")}>yield {fmt(l.yieldPct, 1)}%</span>}
                  </>
                );
                return editable ? (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => onEdit(l)}
                    aria-label={`แก้ ${s.name} ใน ${row.menu.menuName}`}
                    className={cn("min-h-[44px] w-full rounded-lg px-2 py-1 text-right hover:bg-secondary", editingId === l.id && "bg-brand-soft ring-1 ring-brand")}
                  >
                    {body}
                  </button>
                ) : (
                  <div key={l.id} className="px-2 py-1 text-right">
                    {body}
                  </div>
                );
              })}
            </div>
          </td>
        );
      })}
      <td className="border-b border-border py-2 pl-2 pr-3 text-right font-mono text-sm tabular-nums">{row.soldWeek === null ? (soldFailed ? "" : "…") : fmt(row.soldWeek, 0)}</td>
    </tr>
  );
}

/** Under the table on a computer; a sheet from the bottom on a phone (over the bottom bar, under confirm pop-ups) */
function Dock({ title, sub, onClose, closeDisabled, footer, children }: { title: string; sub: string; onClose: () => void; closeDisabled?: boolean; footer: React.ReactNode; children: React.ReactNode }) {
  return (
    <>
      <div className="fixed inset-0 z-[44] bg-black/30 md:hidden" onClick={closeDisabled ? undefined : onClose} aria-hidden="true" />
      <section
        role="dialog"
        aria-label={title}
        className="fixed inset-x-0 bottom-0 z-[45] flex max-h-[85dvh] flex-col rounded-t-2xl bg-card shadow-raised md:sticky md:bottom-4 md:z-20 md:mx-auto md:max-h-[70vh] md:w-full md:max-w-2xl md:rounded-2xl md:border md:border-border"
      >
        <div className="flex items-start justify-between gap-3 px-4 pt-4">
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">{sub}</p>
            <h3 className="break-words text-lg font-bold">{title}</h3>
          </div>
          <Button variant="ghost" className="h-10 shrink-0 px-3" onClick={onClose} disabled={closeDisabled}>
            ปิด
          </Button>
        </div>
        {/* Only the middle scrolls: the title and the buttons stay in view */}
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-3">{children}</div>
        <div className="flex gap-2 border-t border-border px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">{footer}</div>
      </section>
    </>
  );
}

const num = (v: string) => (v.trim() === "" ? NaN : Number(v.replace(/,/g, "")));
const field = "h-12 w-full text-right font-mono text-[17px]";

function LineEditor({
  editing,
  sku,
  price,
  branch,
  updateLines,
  onClose,
}: {
  editing: Editing;
  sku: SKU | undefined;
  price: number;
  branch: string | null;
  updateLines: UpdateMenuBomLines;
  onClose: () => void;
}) {
  const { line, menu } = editing;
  const [qty, setQty] = useState(String(line.qtyPerServing));
  const [yieldPct, setYieldPct] = useState(String(line.yieldPct));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const q = num(qty);
  const y = num(yieldPct);
  const invalid = editProblem(q, y);
  const next = invalid ? null : lineValues(q, y, price);
  const same = q === line.qtyPerServing && y === line.yieldPct;

  const save = async () => {
    if (!next || same) return;
    setBusy(true);
    setProblem(null);
    try {
      const r = await updateLines([{ id: line.id, ...next }]);
      if (r.saved.length === 1) {
        toast.success(`บันทึกแล้ว · ${menu.menuName}`);
        onClose();
      } else setProblem(r.failed[0]?.reason ?? "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dock
      title={`${sku?.name ?? "วัตถุดิบ"} ใน ${menu.menuName}`}
      sub={branch ? `แก้สูตรเมนู · เฉพาะ ${branch}` : "แก้สูตรเมนู · ทุกสาขา"}
      onClose={onClose}
      closeDisabled={busy}
      footer={
        <>
          <Button variant="outline" className="h-12 px-5" onClick={onClose} disabled={busy}>
            ยกเลิก
          </Button>
          <Button className="h-12 flex-1 text-[16px]" loading={busy} disabled={!!invalid || same} onClick={save}>
            บันทึก
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold">ใช้ต่อจาน ({unitText(line.uom)})</span>
          <Input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" className={field} aria-label="ใช้ต่อจาน" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold">yield %</span>
          <Input value={yieldPct} onChange={(e) => setYieldPct(e.target.value)} inputMode="decimal" className={field} aria-label="yield %" />
        </label>
      </div>
      <p className="text-[13px] text-muted-foreground">
        เดิม {fmt(line.qtyPerServing)} {unitText(line.uom)} · yield {fmt(line.yieldPct, 1)}%
      </p>
      {invalid ? (
        <p className="text-sm font-semibold text-destructive">{invalid}</p>
      ) : (
        next && (
          <div className="flex flex-col gap-1 rounded-xl bg-secondary px-3 py-2.5 text-sm">
            <span>
              ระบบหักสต๊อก{" "}
              <b className="whitespace-nowrap font-mono tabular-nums">
                {fmt(next.effectiveQty)} {unitText(line.uom)}
              </b>{" "}
              ต่อจาน
            </span>
            <span>
              ต้นทุน <b className={cn("whitespace-nowrap font-mono tabular-nums", !price && "text-destructive")}>{price ? baht(next.costPerServing) : "ไม่มีราคา"}</b> ต่อจาน
            </span>
          </div>
        )
      )}
      {problem && <p className="text-sm font-semibold text-destructive">ไม่ได้บันทึก · {problem}</p>}
      <p className="text-xs text-muted-foreground">มีผลตั้งแต่วันนี้ ต้นทุนวันก่อนไม่เปลี่ยน</p>
    </Dock>
  );
}

function BulkYield({
  bulk,
  setBulk,
  sku,
  lines,
  menus,
  price,
  branchName,
  updateLines,
}: {
  bulk: Bulk;
  setBulk: Dispatch<SetStateAction<Bulk | null>>;
  sku: SKU | undefined;
  lines: MenuBomLine[];
  menus: Menu[];
  price: number;
  branchName: Map<string, string>;
  updateLines: UpdateMenuBomLines;
}) {
  const y = num(bulk.value);
  const valid = Number.isFinite(y) && y >= 1 && y <= 100;
  // Frozen once saved: the list shows what was sent, not what's left
  const [sent, setSent] = useState<ReturnType<typeof bulkYieldPreview> | null>(null);
  const preview = useMemo(() => (valid ? bulkYieldPreview(lines, menus, bulk.skuId, y, price) : []), [valid, lines, menus, bulk.skuId, y, price]);
  const result = bulk.result;
  const failedReason = new Map(result?.failed.map((f) => [f.id, f.reason]) ?? []);
  // After a save the lines that didn't go through come first, next to the count
  const list = sent ? [...sent].sort((a, b) => Number(failedReason.has(b.line.id)) - Number(failedReason.has(a.line.id))) : preview;
  // Not while saving: the panel stays until the result is in
  const close = () => !bulk.busy && setBulk(null);

  const run = async () => {
    if (!preview.length) return;
    const changes = preview;
    setSent(changes);
    const token = {};
    setBulk({ ...bulk, busy: true, run: token });
    let r: MenuBomBulkResult;
    try {
      // Yield and what follows from it only: qty_per_serving is never written from here
      r = await updateLines(changes.map((c) => ({ id: c.line.id, yieldPct: c.next.yieldPct, effectiveQty: c.next.effectiveQty, costPerServing: c.next.costPerServing })));
    } catch (e) {
      r = {
        saved: [],
        failed: changes.map((c) => ({
          id: c.line.id,
          reason: e instanceof Error ? e.message : "บันทึกไม่สำเร็จ",
        })),
      };
    }
    // Only onto the panel that started this save: one closed or swapped meanwhile stays so
    setBulk((cur) => (cur?.run === token ? { ...cur, busy: false, result: r } : cur));
    if (!r.failed.length) toast.success(`เปลี่ยน yield แล้ว ${r.saved.length} แถว`);
  };

  return (
    <Dock
      title={`ตั้ง yield ${sku?.name ?? ""} ทุกเมนู`}
      sub="เปลี่ยนเฉพาะสูตรเมนู · สูตรครัวกลางไม่เปลี่ยน"
      onClose={close}
      closeDisabled={bulk.busy}
      footer={
        <>
          {result ? (
            <Button className="h-12 flex-1 text-[16px]" onClick={close}>
              ปิด
            </Button>
          ) : (
            <>
              <Button variant="outline" className="h-12 px-5" onClick={close} disabled={bulk.busy}>
                ยกเลิก
              </Button>
              <Button className="h-12 flex-1 text-[16px]" loading={bulk.busy} disabled={!valid || list.length === 0} onClick={run}>
                ยืนยัน เปลี่ยน {list.length} แถว
              </Button>
            </>
          )}
        </>
      }
    >
      {!result && (
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold">yield ใหม่ %</span>
          <Input
            value={bulk.value}
            onChange={(e) => (setSent(null), setBulk({ ...bulk, value: e.target.value }))}
            inputMode="decimal"
            className={field}
            aria-label="yield ใหม่ %"
            disabled={bulk.busy}
            autoFocus
          />
          {bulk.value.trim() !== "" && !valid && <span className="text-sm font-semibold text-destructive">yield ต้องอยู่ระหว่าง 1–100%</span>}
        </label>
      )}
      {result && (
        <div className={cn("rounded-xl px-3 py-2.5 text-sm font-semibold", result.failed.length ? "bg-destructive-soft text-destructive" : "bg-success-soft text-success")}>
          {result.failed.length
            ? `บันทึกแล้ว ${result.saved.length} จาก ${result.saved.length + result.failed.length} แถว · ไม่สำเร็จ ${result.failed.length}`
            : `เปลี่ยนแล้วครบ ${result.saved.length} แถว`}
        </div>
      )}
      {valid && list.length === 0 && !result && <p className="text-sm text-muted-foreground">ทุกเมนูเป็น {fmt(y, 1)}% อยู่แล้ว ไม่มีอะไรต้องเปลี่ยน</p>}
      <p className="text-xs text-muted-foreground">มีผลตั้งแต่วันนี้ ต้นทุนวันก่อนไม่เปลี่ยน</p>
      {list.length > 0 && (
        <div className="flex flex-col gap-1">
          {!result && <p className="text-sm font-semibold">จะเปลี่ยน {list.length} แถว</p>}
          <ul className="divide-y divide-border rounded-xl border border-border">
            {list.map((c) => {
              const failed = failedReason.get(c.line.id);
              const ok = result && !failed;
              return (
                <li key={c.line.id} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 px-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className={cn("block break-words text-sm", c.menu?.status !== "Active" && "text-muted-foreground")}>{c.menu?.menuName ?? "เมนูที่ไม่พบ"}</span>
                    {(c.line.branchId || c.menu?.status !== "Active") && (
                      <span className="block text-xs text-muted-foreground">
                        {[c.line.branchId && `เฉพาะ ${branchName.get(c.line.branchId) ?? "สาขาเดียว"}`, c.menu?.status !== "Active" && "ปิดขาย"].filter(Boolean).join(" · ")}
                      </span>
                    )}
                    {failed && <span className="block text-xs font-semibold text-destructive">ไม่สำเร็จ · {failed}</span>}
                  </span>
                  <span className={cn("whitespace-nowrap font-mono text-sm tabular-nums", ok && "text-success")}>
                    {fmt(c.oldYield, 1)}% → {fmt(c.newYield, 1)}%
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Dock>
  );
}
