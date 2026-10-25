import { useMemo, useState } from "react";
import { Plus, Trash2, Pencil, AlertTriangle } from "lucide-react";
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

export interface RecipeActions {
  addLine: (data: Omit<MenuBomLine, "id">) => Promise<boolean>;
  updateLine: (id: string, data: Partial<Omit<MenuBomLine, "id">>) => Promise<boolean>;
  deleteLine: (id: string) => Promise<boolean>;
}

interface RecipeEditorProps {
  menu: Menu;
  sharedLines: MenuBomLine[];
  branchLines: Record<string, MenuBomLine[]>;
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
export function RecipeEditor({ menu, sharedLines, branchLines, branches, skus, prices, actions, canEdit, hasLinked = false }: RecipeEditorProps) {
  // "new:<branchId|shared>" while adding, a line id while editing
  const [editing, setEditing] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<MenuBomLine | null>(null);
  const skuById = useMemo(() => new Map(skus.map((s) => [s.id, s])), [skus]);

  const blocks: { key: string; branchId: string | null; title: string; hint: string; lines: MenuBomLine[] }[] = [
    { key: "shared", branchId: null, title: "สูตรกลาง", hint: "ใช้ทุกสาขา", lines: sharedLines },
    ...branches.map((b) => ({
      key: b.id,
      branchId: b.id,
      title: `เพิ่มเฉพาะ ${b.branchName}`,
      hint: "ตัดเพิ่มจากสูตรกลาง เฉพาะสาขานี้",
      lines: branchLines[b.id] ?? [],
    })),
  ];
  // Branch-only lines of branches that don't sell this brand: shown so they can be removed
  const strayIds = Object.keys(branchLines).filter((id) => !branches.some((b) => b.id === id));
  for (const id of strayIds)
    blocks.push({ key: id, branchId: id, title: "สาขาที่ไม่ได้ขายแบรนด์นี้", hint: "ไม่ถูกใช้ ลบทิ้งได้", lines: branchLines[id] });

  return (
    <div className="flex flex-col gap-4">
      {blocks.map((block) => {
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
                {block.branchId ? "ไม่มีบรรทัดเฉพาะสาขา" : hasLinked ? "ไม่มีวัตถุดิบเพิ่มจากสูตรต้นทาง" : "ยังไม่มีวัตถุดิบ — ขายเมนูนี้แล้วจะไม่ตัดของ"}
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
                      scopeLines={block.lines}
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
                        <div className="truncate text-[15px] font-medium">{skuById.get(line.skuId)?.name ?? "วัตถุดิบที่ถูกลบไปแล้ว"}</div>
                        <div className="text-sm text-muted-foreground">
                          <span className="font-mono">{skuById.get(line.skuId)?.skuId ?? "—"}</span>
                          {line.yieldPct !== 100 && <span> · yield {line.yieldPct}%</span>}
                          {activeUnitCost(prices, line.skuId) <= 0 && <span className="text-warning"> · ไม่มีราคา</span>}
                        </div>
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
                    scopeLines={block.lines}
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
      })}

      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(open) => !open && setToDelete(null)}
        title="ลบวัตถุดิบออกจากสูตร"
        description={`ลบ "${toDelete ? skuById.get(toDelete.skuId)?.name ?? "" : ""}" ออกจากสูตร ${menu.menuCode}?\nยอดขายหลังจากนี้จะไม่ตัดวัตถุดิบนี้`}
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
}

function LineForm({ menu, line, branchId, sharedLines, scopeLines, skus, prices, actions, onDone, onDelete }: LineFormProps) {
  const [skuId, setSkuId] = useState(line?.skuId ?? "");
  const [qty, setQty] = useState(line ? String(line.qtyPerServing) : "");
  const [yieldPct, setYieldPct] = useState(line ? String(line.yieldPct) : "100");
  const [saving, setSaving] = useState(false);
  const [tried, setTried] = useState(false);

  const options = useMemo(() => {
    const groups: { type: SKU["type"]; label: string }[] = [
      { type: "SM", label: "ของจากครัวกลาง (SM)" },
      { type: "RM", label: "วัตถุดิบ (RM)" },
      { type: "SP", label: "เตรียมที่ร้าน (SP)" },
    ];
    return groups.flatMap((g) => {
      const items = skus
        .filter((s) => s.type === g.type && (s.status === "Active" || s.id === line?.skuId))
        .map((s) => ({ value: s.id, label: s.name, sublabel: s.skuId, badge: activeUnitCost(prices, s.id) > 0 ? undefined : "ไม่มีราคา" }));
      return items.length ? [{ value: `g-${g.type}`, label: g.label, isGroupHeader: true }, ...items] : [];
    });
  }, [skus, prices, line?.skuId]);

  const sku = skus.find((s) => s.id === skuId);
  const qtyNum = Number(qty);
  const yieldNum = Number(yieldPct);
  const dupInScope = !!skuId && scopeLines.some((l) => l.skuId === skuId && l.id !== line?.id);
  const alsoShared = !!skuId && branchId !== null && sharedLines.some((l) => l.skuId === skuId);

  const errors = {
    sku: !skuId ? "เลือกวัตถุดิบ" : dupInScope ? "มีวัตถุดิบนี้ในส่วนนี้แล้ว — แก้บรรทัดเดิมแทน" : null,
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
    const ok = line ? await actions.updateLine(line.id, data) : await actions.addLine({ ...data, menuId: menu.id });
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
            สูตรกลางมีวัตถุดิบนี้แล้ว — สาขานี้จะตัดทั้งสองบรรทัดบวกกัน
          </p>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1.5 block text-sm font-medium">ปริมาณต่อจาน{sku ? ` (${sku.usageUom})` : ""}</label>
          <Input type="number" inputMode="decimal" min={0} step="any" value={qty} onChange={(e) => setQty(e.target.value)} className="h-11 text-right font-mono" autoFocus={!!line} />
          <FieldError message={tried ? errors.qty : null} />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium">yield %</label>
          <Input type="number" inputMode="decimal" min={1} max={100} step="any" value={yieldPct} onChange={(e) => setYieldPct(e.target.value)} className="h-11 text-right font-mono" />
          <FieldError message={tried ? errors.yield : null} />
        </div>
      </div>
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
