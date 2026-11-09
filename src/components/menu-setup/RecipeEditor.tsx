import { useMemo, useState } from "react";
import { Plus, Trash2, Pencil, AlertTriangle, Bike, RotateCcw } from "lucide-react";
import type { Menu } from "@/types/menu";
import type { MenuBomLine } from "@/types/menu-bom";
import type { SKU } from "@/types/sku";
import type { Price } from "@/types/price";
import type { Branch } from "@/types/branch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/SearchableSelect";
import { FieldError } from "@/components/form/FieldError";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { activeUnitCost, effectiveQty, lineCost } from "@/lib/menu-health";
import { deliveryCost, deliveryDiffCount, deliveryQtyToSave, deliveryRows, hasDeliveryRecipe, type DeliveryRow } from "@/lib/delivery-recipe";
import { SegmentedTabs } from "@/components/SegmentedTabs";
import { cn } from "@/lib/utils";
import { skuOptions } from "./sku-options";

export interface RecipeActions {
  addLine: (data: Omit<MenuBomLine, "id">) => Promise<boolean>;
  updateLine: (id: string, data: Partial<Omit<MenuBomLine, "id">>) => Promise<boolean>;
  deleteLine: (id: string) => Promise<boolean>;
  /** A line's note for the shop (menu_bom.spec_note): saved on its own, true = saved */
  saveSpecNote?: (id: string, note: string) => Promise<boolean>;
}

/** Which recipe the สูตร tab shows: the shop's, or what delivery orders use */
export type RecipeView = "shop" | "delivery";

interface RecipeEditorProps {
  menu: Menu;
  /** Shop recipe lines (no delivery-only lines) */
  sharedLines: MenuBomLine[];
  branchLines: Record<string, MenuBomLine[]>;
  /** This menu's delivery-only lines (shared and per branch) */
  deliveryOnlyLines?: MenuBomLine[];
  /** Controlled view (the health check opens the delivery view); uncontrolled when absent */
  view?: RecipeView;
  onViewChange?: (v: RecipeView) => void;
  /** Active branches of this menu's brand */
  branches: Branch[];
  skus: SKU[];
  prices: Price[];
  actions: RecipeActions;
  canEdit: boolean;
  /** The menu also takes another menu's recipe through a rule */
  hasLinked?: boolean;
}

const baht = (n: number) => `฿${n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * The recipe of one menu: one shared block used by every branch, then one block
 * per branch for lines only that branch uses. Each line opens into a small form;
 * the unit always comes from the SKU so it can't be typed wrong.
 */
interface Block {
  key: string;
  branchId: string | null;
  title: string;
  hint: string;
  /** Shop lines of the block */
  lines: MenuBomLine[];
  /** Delivery-only lines of the block (same branch_id) */
  deliveryOnly: MenuBomLine[];
}

export function RecipeEditor({ menu, sharedLines, branchLines, deliveryOnlyLines = [], view: viewProp, onViewChange, branches, skus, prices, actions, canEdit, hasLinked = false }: RecipeEditorProps) {
  // "new:<branchId|shared>" while adding, a line id while editing
  const [editing, setEditing] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<MenuBomLine | null>(null);
  const [ownView, setOwnView] = useState<RecipeView>("shop");
  const view = viewProp ?? ownView;
  const setView = (v: RecipeView) => {
    setEditing(null);
    if (onViewChange) onViewChange(v);
    else setOwnView(v);
  };
  const skuById = useMemo(() => new Map(skus.map((s) => [s.id, s])), [skus]);

  const onlyFor = (branchId: string | null) => deliveryOnlyLines.filter((l) => (l.branchId ?? null) === branchId);
  const blocks: Block[] = [
    { key: "shared", branchId: null, title: "สูตรกลาง", hint: "ใช้ทุกสาขา", lines: sharedLines, deliveryOnly: onlyFor(null) },
    ...branches.map((b) => ({
      key: b.id,
      branchId: b.id,
      title: `เพิ่มเฉพาะ ${b.branchName}`,
      hint: "ตัดเพิ่มจากสูตรกลาง เฉพาะสาขานี้",
      lines: branchLines[b.id] ?? [],
      deliveryOnly: onlyFor(b.id),
    })),
  ];
  // Branch-only lines of branches that don't sell this brand: shown so they can be removed.
  // Only the lines this view shows count (delivery-only lines aren't in the shop view).
  const branchIdsOfView = view === "delivery" ? [...Object.keys(branchLines), ...deliveryOnlyLines.map((l) => l.branchId).filter((id): id is string => !!id)] : Object.keys(branchLines);
  const strayIds = [...new Set(branchIdsOfView)].filter((id) => !branches.some((b) => b.id === id));
  for (const id of strayIds)
    blocks.push({ key: id, branchId: id, title: "สาขาที่ไม่ได้ขายแบรนด์นี้", hint: "ไม่ถูกใช้ ลบทิ้งได้", lines: branchLines[id] ?? [], deliveryOnly: onlyFor(id) });
  // Shared lines of both kinds: a branch line of an item the central recipe has adds up
  const sharedAll = [...sharedLines, ...onlyFor(null)];

  return (
    <div className="flex flex-col gap-4">
      {/* หน้าร้าน | เดลิเวอรี: two recipes of the same menu */}
      <SegmentedTabs<RecipeView>
        tabs={[
          { key: "shop", label: "หน้าร้าน" },
          { key: "delivery", label: "เดลิเวอรี" },
        ]}
        value={view}
        onChange={setView}
        className="[&_[role=tab]]:min-h-[44px] [&_[role=tab]]:flex-1 [&_[role=tablist]]:flex [&_[role=tablist]]:w-full"
      />

      {view === "delivery" ? (
        <DeliveryView
          menu={menu}
          blocks={blocks}
          strayIds={strayIds}
          sharedAll={sharedAll}
          skus={skus}
          prices={prices}
          actions={actions}
          canEdit={canEdit}
          hasLinked={hasLinked}
          editing={editing}
          setEditing={setEditing}
          onDelete={setToDelete}
        />
      ) : (
      blocks.map((block) => {
        const subtotal = block.lines.reduce((s, l) => s + lineCost(l, prices), 0);
        const adding = editing === `new:${block.key}`;
        return (
          <section key={block.key} className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
            <header className="flex items-center gap-3 border-b border-border px-4 py-3">
              <div className="min-w-0 flex-1">
                <h4 className="text-base font-semibold">{block.title}</h4>
                <p className="text-sm text-muted-foreground">{block.hint}</p>
              </div>
              {block.lines.length > 0 && <span className="font-mono text-sm tabular-nums text-muted-foreground">{baht(subtotal)}</span>}
            </header>

            {block.lines.length === 0 && !adding && (
              <p className="px-4 py-4 text-sm text-muted-foreground">
                {block.branchId ? "ไม่มีแถวเฉพาะสาขา" : hasLinked ? "ไม่มีวัตถุดิบเพิ่มจากสูตรต้นทาง" : "ยังไม่มีวัตถุดิบ ขายแล้วสต๊อกจะไม่ลด"}
              </p>
            )}

            <ul className="divide-y divide-border">
              {block.lines.map((line) =>
                editing === line.id ? (
                  <li key={line.id} className="bg-secondary/60 p-4">
                    <LineForm
                      menu={menu}
                      line={line}
                      branchId={line.branchId ?? null}
                      sharedLines={sharedLines}
                      scopeLines={[...block.lines, ...block.deliveryOnly]}
                      skus={skus}
                      prices={prices}
                      actions={actions}
                      onDone={() => setEditing(null)}
                      onDelete={() => setToDelete(line)}
                    />
                  </li>
                ) : (
                  <li key={line.id}>
                    <button
                      type="button"
                      disabled={!canEdit}
                      onClick={() => setEditing(line.id)}
                      className="flex min-h-[56px] w-full items-center gap-3 px-4 py-2.5 text-left transition-colors enabled:hover:bg-secondary/60 disabled:cursor-default"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="break-words text-[15px] font-medium">{skuById.get(line.skuId)?.name ?? "วัตถุดิบที่ถูกลบไปแล้ว"}</div>
                        <div className="text-sm text-muted-foreground">
                          <span className="font-mono">{skuById.get(line.skuId)?.skuId ?? "—"}</span>
                          {line.yieldPct !== 100 && <span> · yield {line.yieldPct}%</span>}
                          {activeUnitCost(prices, line.skuId) <= 0 && <span className="text-warning"> · ไม่มีราคา</span>}
                        </div>
                        {line.specNote && <div className="break-words text-sm text-muted-foreground">สเปค: {line.specNote}</div>}
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="font-mono text-[15px] tabular-nums">
                          {line.qtyPerServing.toLocaleString()} <span className="text-sm text-muted-foreground">{skuById.get(line.skuId)?.usageUom ?? line.uom}</span>
                        </div>
                        <div className="font-mono text-sm tabular-nums text-muted-foreground">{baht(lineCost(line, prices))}</div>
                      </div>
                      {canEdit && <Pencil className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
                    </button>
                  </li>
                ),
              )}
              {adding && (
                <li className="bg-secondary/60 p-4">
                  <LineForm
                    menu={menu}
                    branchId={block.branchId}
                    sharedLines={sharedLines}
                    scopeLines={[...block.lines, ...block.deliveryOnly]}
                    skus={skus}
                    prices={prices}
                    actions={actions}
                    onDone={() => setEditing(null)}
                  />
                </li>
              )}
            </ul>

            {canEdit && !adding && !strayIds.includes(block.key) && (
              <div className="border-t border-border p-2">
                <Button variant="ghost" className="h-11 w-full justify-start text-[15px]" onClick={() => setEditing(`new:${block.key}`)}>
                  <Plus className="h-4 w-4" /> เพิ่มวัตถุดิบ{block.branchId ? "เฉพาะสาขา" : ""}
                </Button>
              </div>
            )}
          </section>
        );
      })
      )}

      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(open) => !open && setToDelete(null)}
        title={toDelete?.deliveryOnly ? "ลบวัตถุดิบออกจากสูตรเดลิเวอรี" : "ลบวัตถุดิบออกจากสูตร"}
        description={
          toDelete?.deliveryOnly
            ? `ลบ "${skuById.get(toDelete.skuId)?.name ?? ""}" ออกจากสูตรเดลิเวอรี ${menu.menuCode}?\nออเดอร์เดลิเวอรีหลังจากนี้จะไม่ใช้วัตถุดิบนี้`
            : `ลบ "${toDelete ? skuById.get(toDelete.skuId)?.name ?? "" : ""}" ออกจากสูตร ${menu.menuCode}?\nยอดขายหลังจากนี้จะไม่ใช้วัตถุดิบนี้`
        }
        confirmLabel="ลบ"
        variant="destructive"
        onConfirm={async () => {
          if (toDelete && (await actions.deleteLine(toDelete.id))) setEditing(null);
          setToDelete(null);
        }}
      />
    </div>
  );
}

interface LineFormProps {
  menu: Menu;
  line?: MenuBomLine;
  branchId: string | null;
  sharedLines: MenuBomLine[];
  /** Lines in the same block, to stop the same SKU being added twice */
  scopeLines: MenuBomLine[];
  skus: SKU[];
  prices: Price[];
  actions: RecipeActions;
  onDone: () => void;
  onDelete?: () => void;
  /** A line of the delivery recipe only (menu_bom.delivery_only): its amount is the delivery amount */
  deliveryOnly?: boolean;
}

function LineForm({ menu, line, branchId, sharedLines, scopeLines, skus, prices, actions, onDone, onDelete, deliveryOnly = false }: LineFormProps) {
  const [skuId, setSkuId] = useState(line?.skuId ?? "");
  const [qty, setQty] = useState(line ? String(line.qtyPerServing) : "");
  const [yieldPct, setYieldPct] = useState(line ? String(line.yieldPct) : "100");
  const [saving, setSaving] = useState(false);
  const [tried, setTried] = useState(false);
  // Bumped when a note didn't save, so the box shows the saved note again
  const [noteGen, setNoteGen] = useState(0);

  // Delivery-only lines are often packaging (box, sauce cup): PK is offered there
  const options = useMemo(() => skuOptions(skus, prices, line?.skuId, deliveryOnly), [skus, prices, line?.skuId, deliveryOnly]);

  const sku = skus.find((s) => s.id === skuId);
  const qtyNum = Number(qty);
  const yieldNum = Number(yieldPct);
  // The same item twice in a block: the shop recipe and the delivery-only lines share the
  // block, so a delivery-only line of the item blocks a shop line of it (and the other way)
  const dup = skuId ? scopeLines.find((l) => l.skuId === skuId && l.id !== line?.id) : undefined;
  const alsoShared = !!skuId && branchId !== null && sharedLines.some((l) => l.skuId === skuId);

  const errors = {
    sku: !skuId
      ? "เลือกวัตถุดิบ"
      : !dup
        ? null
        : !!dup.deliveryOnly === deliveryOnly
          ? "มีวัตถุดิบนี้ในส่วนนี้แล้ว — แก้บรรทัดเดิมแทน"
          : dup.deliveryOnly
            ? "มีวัตถุดิบนี้ในสูตรเดลิเวอรีแล้ว (เดลิเวอรีเท่านั้น) — ลบที่สูตรเดลิเวอรีก่อน"
            : "สูตรหน้าร้านมีวัตถุดิบนี้แล้ว — แตะแถวนั้นเพื่อตั้งปริมาณเดลิเวอรี",
    qty: !(qtyNum > 0) ? "ใส่ปริมาณมากกว่า 0" : null,
    yield: !(yieldNum > 0 && yieldNum <= 100) ? "ใส่ 1–100" : null,
  };
  const valid = !errors.sku && !errors.qty && !errors.yield;
  const preview = valid ? effectiveQty(qtyNum, yieldNum) * activeUnitCost(prices, skuId) : null;

  const save = async () => {
    setTried(true);
    if (!valid || !sku) return;
    setSaving(true);
    const eff = effectiveQty(qtyNum, yieldNum);
    const data = {
      skuId,
      qtyPerServing: qtyNum,
      uom: sku.usageUom,
      yieldPct: yieldNum,
      effectiveQty: eff,
      costPerServing: eff * activeUnitCost(prices, skuId),
      branchId,
    };
    // The shop amount never touches the delivery amount: a line without one follows the shop.
    // A different item, though, drops the old item's delivery amount.
    const ok = line
      ? await actions.updateLine(line.id, line.skuId !== skuId && line.deliveryQty != null ? { ...data, deliveryQty: null } : data)
      : await actions.addLine({ ...data, menuId: menu.id, ...(deliveryOnly && { deliveryOnly: true, deliveryQty: null }) });
    setSaving(false);
    if (ok) onDone();
  };

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      onKeyDown={(e) => e.key === "Escape" && onDone()}
    >
      <div>
        <label className="mb-1.5 block text-sm font-medium">วัตถุดิบ</label>
        <SearchableSelect value={skuId} onValueChange={setSkuId} options={options} placeholder="ค้นชื่อหรือรหัส…" triggerClassName="h-11 w-full text-[15px]" />
        <FieldError message={tried || skuId ? errors.sku : null} />
        {alsoShared && !errors.sku && (
          <p className="mt-1.5 flex items-start gap-1.5 text-sm text-warning">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            สูตรกลางมีวัตถุดิบนี้แล้ว — {deliveryOnly ? "เดลิเวอรีของสาขานี้" : "สาขานี้"}จะตัดทั้งสองบรรทัดบวกกัน
          </p>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1.5 block text-sm font-medium">{deliveryOnly ? "เดลิเวอรีต่อจาน" : "ปริมาณต่อจาน"}{sku ? ` (${sku.usageUom})` : ""}</label>
          <Input type="number" inputMode="decimal" min={0} step="any" value={qty} onChange={(e) => setQty(e.target.value)} className="h-11 text-right font-mono" autoFocus={!!line} />
          <FieldError message={tried ? errors.qty : null} />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium">yield %</label>
          <Input type="number" inputMode="decimal" min={1} max={100} step="any" value={yieldPct} onChange={(e) => setYieldPct(e.target.value)} className="h-11 text-right font-mono" />
          <FieldError message={tried ? errors.yield : null} />
        </div>
      </div>
      {deliveryOnly && <p className="-mt-1 text-sm text-muted-foreground">ใช้กับออเดอร์เดลิเวอรีเท่านั้น หน้าร้านไม่ตัด</p>}
      {/* Notes go to the shop with the central recipe only: a branch's own lines aren't on the sheet */}
      {line && !line.branchId && !deliveryOnly && actions.saveSpecNote && (
        <div>
          <label htmlFor={`spec-${line.id}`} className="mb-1.5 block text-sm font-medium">
            สเปค / หมายเหตุสำหรับหน้าร้าน
          </label>
          <Input
            id={`spec-${line.id}`}
            key={`spec-${line.id}-${noteGen}-${line.specNote ?? ""}`}
            defaultValue={line.specNote ?? ""}
            maxLength={300}
            placeholder={sku?.specNote ? `ว่าง = ใช้สเปคสินค้า: ${sku.specNote}` : "เช่น หั่นเต๋า 1 ซม. · ไม่เอาหนัง"}
            onBlur={(e) => {
              const next = e.target.value.trim();
              if (next !== (line.specNote ?? "").trim()) void actions.saveSpecNote!(line.id, next).then((ok) => !ok && setNoteGen((g) => g + 1));
            }}
            className="h-11 text-[16px]"
          />
          <p className="mt-1 text-xs text-muted-foreground">บันทึกเองเมื่อออกจากช่อง · ขึ้นในใบ “ส่งสูตรให้หน้าร้าน”</p>
        </div>
      )}
      {preview !== null && (
        <p className="text-sm text-muted-foreground">
          {preview > 0 ? (
            <>
              ต้นทุนบรรทัดนี้ <span className="font-mono text-foreground">{baht(preview)}</span>
            </>
          ) : (
            <span className="text-warning">วัตถุดิบนี้ยังไม่มีราคา — ต้นทุนเมนูจะต่ำกว่าจริง</span>
          )}
        </p>
      )}
      <div className="flex items-center gap-2">
        {onDelete && (
          <Button type="button" variant="ghost" className="h-11 px-3 text-destructive hover:text-destructive" onClick={onDelete}>
            <Trash2 className="h-4 w-4" /> ลบ
          </Button>
        )}
        <div className="ml-auto flex gap-2">
          <Button type="button" variant="outline" className="h-11" onClick={onDone}>
            ยกเลิก
          </Button>
          <Button type="submit" variant="brand" className="h-11 min-w-[96px]" loading={saving}>
            บันทึก
          </Button>
        </div>
      </div>
    </form>
  );
}

// ───────────────────────── Delivery recipe ─────────────────────────

interface DeliveryViewProps {
  menu: Menu;
  blocks: Block[];
  strayIds: string[];
  sharedAll: MenuBomLine[];
  skus: SKU[];
  prices: Price[];
  actions: RecipeActions;
  canEdit: boolean;
  hasLinked: boolean;
  editing: string | null;
  setEditing: (v: string | null) => void;
  onDelete: (line: MenuBomLine) => void;
}

/**
 * The recipe as delivery orders use it. Rows that follow the shop are plain; a delivery
 * amount shows struck shop amount → bold delivery amount; 0 = "ไม่ใช้"; delivery-only rows
 * carry a tag. Nothing is written until a row is saved: the "create" button only opens
 * the list (it starts as a copy of the shop recipe, which is what "no amount" means).
 */
function DeliveryView({ menu, blocks, strayIds, sharedAll, skus, prices, actions, canEdit, hasLinked, editing, setEditing, onDelete }: DeliveryViewProps) {
  const [started, setStarted] = useState(false);
  const skuById = useMemo(() => new Map(skus.map((s) => [s.id, s])), [skus]);
  const rowsByBlock = blocks.map((b) => deliveryRows(b.lines, b.deliveryOnly, prices));
  const diff = rowsByBlock.reduce((s, rows) => s + deliveryDiffCount(rows), 0);
  const has = hasDeliveryRecipe(blocks.flatMap((b) => [...b.lines, ...b.deliveryOnly]));

  if (!has && !started)
    return (
      <section className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card px-5 py-8 text-center shadow-card">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-secondary">
          <Bike className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
        </span>
        <div>
          <p className="text-[15px] font-semibold">สูตรเดลิเวอรียังเท่าหน้าร้าน</p>
          <p className="mt-0.5 text-sm text-muted-foreground">ออเดอร์เดลิเวอรีตัดตามสูตรหน้าร้าน</p>
        </div>
        {canEdit && (
          <Button variant="outline" className="h-auto min-h-[44px] w-full max-w-sm whitespace-normal text-[15px]" onClick={() => setStarted(true)}>
            <Plus className="h-4 w-4 shrink-0" /> สร้างสูตรเดลิเวอรี (คัดลอกจากหน้าร้าน)
          </Button>
        )}
      </section>
    );

  const uomOf = (l: MenuBomLine) => skuById.get(l.skuId)?.usageUom ?? l.uom;
  const nameOf = (l: MenuBomLine) => skuById.get(l.skuId)?.name ?? "วัตถุดิบที่ถูกลบไปแล้ว";

  return (
    <>
      <div className="px-1">
        <h4 className="text-base font-semibold">สูตรเดลิเวอรี</h4>
        <p className="text-sm text-muted-foreground">
          ออเดอร์เดลิเวอรีตัดตามสูตรนี้ · {diff > 0 ? `ต่างจากร้าน ${diff.toLocaleString()} แถว` : "ยังเท่าหน้าร้านทุกแถว"}
        </p>
        {!has && <p className="mt-1 text-sm text-muted-foreground">แตะแถวเพื่อตั้งปริมาณเดลิเวอรี · ยังไม่บันทึกอะไรจนกว่าจะแก้แถว</p>}
      </div>
      {blocks.map((block, i) => {
        const rows = rowsByBlock[i];
        const adding = editing === `dnew:${block.key}`;
        const scope = [...block.lines, ...block.deliveryOnly];
        return (
          <section key={block.key} className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
            <header className="flex items-center gap-3 border-b border-border px-4 py-3">
              <div className="min-w-0 flex-1">
                <h4 className="text-base font-semibold">{block.title}</h4>
                <p className="text-sm text-muted-foreground">{block.hint}</p>
              </div>
              {rows.length > 0 && <span className="font-mono text-sm tabular-nums text-muted-foreground">{baht(deliveryCost(rows))}</span>}
            </header>

            {rows.length === 0 && !adding && (
              <p className="px-4 py-4 text-sm text-muted-foreground">
                {block.branchId ? "ไม่มีแถวเฉพาะสาขา" : hasLinked ? "ไม่มีวัตถุดิบเพิ่มจากสูตรต้นทาง" : "ยังไม่มีวัตถุดิบ"}
              </p>
            )}

            <ul className="divide-y divide-border">
              {rows.map((row) =>
                editing === `d:${row.line.id}` ? (
                  <li key={row.line.id} className="bg-secondary/60 p-4">
                    {row.kind === "only" ? (
                      <LineForm
                        menu={menu}
                        line={row.line}
                        branchId={row.line.branchId ?? null}
                        sharedLines={sharedAll}
                        scopeLines={scope}
                        skus={skus}
                        prices={prices}
                        actions={actions}
                        onDone={() => setEditing(null)}
                        onDelete={() => onDelete(row.line)}
                        deliveryOnly
                      />
                    ) : (
                      <DeliveryAmountForm line={row.line} name={nameOf(row.line)} uom={uomOf(row.line)} prices={prices} actions={actions} onDone={() => setEditing(null)} />
                    )}
                  </li>
                ) : (
                  <li key={row.line.id} className={cn(row.kind === "changed" && "bg-success-soft", row.kind === "only" && "bg-brand-soft/40")}>
                    <DeliveryRowButton row={row} name={nameOf(row.line)} code={skuById.get(row.line.skuId)?.skuId ?? "—"} uom={uomOf(row.line)} canEdit={canEdit} onClick={() => setEditing(`d:${row.line.id}`)} />
                  </li>
                ),
              )}
              {adding && (
                <li className="bg-secondary/60 p-4">
                  <LineForm
                    menu={menu}
                    branchId={block.branchId}
                    sharedLines={sharedAll}
                    scopeLines={scope}
                    skus={skus}
                    prices={prices}
                    actions={actions}
                    onDone={() => setEditing(null)}
                    deliveryOnly
                  />
                </li>
              )}
            </ul>

            {canEdit && !adding && !strayIds.includes(block.key) && (
              <div className="border-t border-border p-2">
                <Button variant="ghost" className="h-11 w-full justify-start text-[15px]" onClick={() => setEditing(`dnew:${block.key}`)}>
                  <Plus className="h-4 w-4" /> เพิ่มวัตถุดิบ{block.branchId ? "เฉพาะสาขา" : ""}
                </Button>
              </div>
            )}
          </section>
        );
      })}
    </>
  );
}

function DeliveryRowButton({ row, name, code, uom, canEdit, onClick }: { row: DeliveryRow; name: string; code: string; uom: string; canEdit: boolean; onClick: () => void }) {
  const { line, kind } = row;
  return (
    <button
      type="button"
      disabled={!canEdit}
      onClick={onClick}
      className="flex min-h-[56px] w-full items-center gap-3 px-4 py-2.5 text-left transition-colors enabled:hover:bg-secondary/60 disabled:cursor-default"
    >
      <div className="min-w-0 flex-1">
        <div className={cn("break-words text-[15px] font-medium", kind === "off" && "text-muted-foreground line-through")}>
          {name}
          {kind === "only" && <span className="ml-1.5 inline-block whitespace-nowrap rounded-full bg-brand-soft px-2 py-0.5 align-middle text-xs font-medium text-brand-soft-foreground no-underline">เดลิเวอรีเท่านั้น</span>}
        </div>
        <div className="text-sm text-muted-foreground">
          <span className="font-mono">{code}</span>
          {line.yieldPct !== 100 && <span> · yield {line.yieldPct}%</span>}
        </div>
      </div>
      <div className="shrink-0 text-right">
        {kind === "off" ? (
          <div className="text-[15px] text-muted-foreground">ไม่ใช้</div>
        ) : (
          <div className="font-mono text-[15px] tabular-nums">
            {kind === "changed" && <span className="mr-1.5 text-sm text-muted-foreground line-through">{row.shopQty!.toLocaleString()}</span>}
            <span className={cn(kind === "changed" && "font-semibold text-success", kind === "only" && "font-semibold")}>{row.deliveryQty.toLocaleString()}</span>{" "}
            <span className="text-sm text-muted-foreground">{uom}</span>
          </div>
        )}
        {kind !== "off" && <div className="font-mono text-sm tabular-nums text-muted-foreground">{baht(row.cost)}</div>}
      </div>
      {canEdit && <Pencil className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
    </button>
  );
}

/**
 * A shop line's delivery amount: blank = same as the shop (follows it when the shop amount
 * changes), 0 = not used for delivery. Yield stays the shop line's.
 */
function DeliveryAmountForm({ line, name, uom, prices, actions, onDone }: { line: MenuBomLine; name: string; uom: string; prices: Price[]; actions: RecipeActions; onDone: () => void }) {
  const [typed, setTyped] = useState(line.deliveryQty != null ? String(line.deliveryQty) : "");
  const [saving, setSaving] = useState<"save" | "reset" | null>(null);
  const [tried, setTried] = useState(false);
  const next = deliveryQtyToSave(typed, line.qtyPerServing);
  const error = next === undefined ? "ใส่ 0 ขึ้นไป หรือเว้นว่าง" : null;
  const shown = next === undefined ? null : next ?? line.qtyPerServing;
  const write = async (value: number | null, kind: "save" | "reset") => {
    if (value === (line.deliveryQty ?? null)) return onDone();
    setSaving(kind);
    const ok = await actions.updateLine(line.id, { deliveryQty: value });
    setSaving(null);
    if (ok) onDone();
  };

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        setTried(true);
        if (next !== undefined) void write(next, "save");
      }}
      onKeyDown={(e) => e.key === "Escape" && onDone()}
    >
      <div>
        <div className="break-words text-[15px] font-medium">{name}</div>
        <div className="text-sm text-muted-foreground">
          หน้าร้าน <span className="font-mono">{line.qtyPerServing.toLocaleString()}</span> {uom}
          {line.yieldPct !== 100 && <span> · yield {line.yieldPct}%</span>}
        </div>
      </div>
      <div>
        <label htmlFor={`dq-${line.id}`} className="mb-1.5 block text-sm font-medium">
          เดลิเวอรีต่อจาน ({uom})
        </label>
        <Input
          id={`dq-${line.id}`}
          type="number"
          inputMode="decimal"
          min={0}
          step="any"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={`เท่าร้าน (${line.qtyPerServing.toLocaleString()})`}
          className="h-11 text-right font-mono text-[16px]"
          autoFocus
        />
        <FieldError message={tried ? error : null} />
        <p className="mt-1 text-sm text-muted-foreground">ว่าง = เท่าหน้าร้าน · 0 = ไม่ใช้กับเดลิเวอรี</p>
      </div>
      {shown !== null && (
        <p className="text-sm text-muted-foreground">
          {shown === 0 ? (
            "ออเดอร์เดลิเวอรีไม่ตัดวัตถุดิบนี้"
          ) : (
            <>
              ต้นทุนเดลิเวอรีบรรทัดนี้ <span className="font-mono text-foreground">{baht(lineCost({ ...line, qtyPerServing: shown }, prices))}</span>
            </>
          )}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {line.deliveryQty != null && (
          <Button type="button" variant="ghost" className="h-11 px-3" loading={saving === "reset"} onClick={() => void write(null, "reset")}>
            <RotateCcw className="h-4 w-4" /> ใช้เท่าหน้าร้าน
          </Button>
        )}
        <div className="ml-auto flex gap-2">
          <Button type="button" variant="outline" className="h-11" onClick={onDone}>
            ยกเลิก
          </Button>
          <Button type="submit" variant="brand" className="h-11 min-w-[96px]" loading={saving === "save"}>
            บันทึก
          </Button>
        </div>
      </div>
    </form>
  );
}
