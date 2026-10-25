import { useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import type { SKU } from "@/types/sku";
import type { Branch } from "@/types/branch";
import { branchTransferRow, kitchenAdHocRow, packsFromQty, qtyFromPacks, type ReceiptRow } from "@/lib/receive-rows";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ActionFooter, NoteField, PackStepper, RemoveButton, SkuPicker, WeightField, baht, packHint } from "./parts";
import { cn } from "@/lib/utils";

export interface PricedSku {
  sku: SKU;
  stdUnitPrice: number;
}

/**
 * Kitchen goods that arrived without a transfer order (SM + distributable RM/PK of
 * the brand, priced at BOM cost / standard as before). Warns when the same goods
 * were just received through a transfer order.
 */
export function ReceiveKitchenAdHoc({
  branchId,
  receiptDate,
  items,
  findDoubles,
  onSave,
}: {
  branchId: string;
  receiptDate: string;
  items: PricedSku[];
  findDoubles: (lines: { skuId: string; qty: number }[]) => Promise<string[]>;
  onSave: (rows: ReceiptRow[]) => Promise<boolean>;
}) {
  const [qty, setQty] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [dupText, setDupText] = useState<string | null>(null);

  const rows = items
    .filter((i) => (qty[i.sku.id] ?? 0) > 0)
    .map((i) => kitchenAdHocRow({ branchId, receiptDate, sku: i.sku, qty: qty[i.sku.id], stdUnitPrice: i.stdUnitPrice, note: notes[i.sku.id] ?? "" }));
  const total = rows.reduce((s, r) => s + r.actualTotal, 0);
  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const m = items.filter((i) => words.every((w) => `${i.sku.name} ${i.sku.skuId}`.toLowerCase().includes(w)));
    return [...m.filter((i) => (qty[i.sku.id] ?? 0) > 0), ...m.filter((i) => !(qty[i.sku.id] > 0))];
  }, [items, query, qty]);

  const doSave = async (skip: boolean) => {
    if (!rows.length) return;
    setSaving(true);
    if (!skip) {
      const dups = await findDoubles(rows.map((r) => ({ skuId: r.skuId, qty: r.qtyReceived })));
      if (dups.length) {
        setDupText(`ของเหล่านี้เพิ่งรับผ่านใบโอนไปแล้ว:\n${dups.join("\n")}\n\nถ้าเป็นของชุดเดียวกัน ไม่ต้องบันทึกซ้ำ ให้กดยกเลิก`);
        setSaving(false);
        return;
      }
    }
    await onSave(rows);
    setSaving(false);
  };

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="text-sm text-muted-foreground">ครัวกลาง · ไม่มีใบโอน</div>
        <h2 className="text-xl font-bold">รับของครัวกลาง</h2>
        <p className="mt-1 text-sm text-muted-foreground">ใช้เมื่อของมาโดยไม่มีใบโอน ถ้ามีใบโอนให้รับจากใบโอนในหน้าแรก จะได้ไม่นับซ้ำ</p>
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ค้นสินค้า…" className="h-11 pl-9" aria-label="ค้นสินค้า" />
      </div>
      <ul className="flex flex-col gap-2">
        {shown.map(({ sku, stdUnitPrice }) => {
          const q = qty[sku.id] ?? 0;
          return (
            <li key={sku.id} className={cn("flex flex-col gap-2 rounded-2xl border border-border bg-card p-3", q > 0 && "shadow-card")}>
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className={cn("truncate text-[15px]", q > 0 ? "font-semibold" : "text-muted-foreground")}>{sku.name}</div>
                  <div className="truncate text-sm text-muted-foreground">
                    <span className="font-mono">{sku.skuId}</span>
                    {packHint(sku) && ` · ${packHint(sku)}`}
                    {q > 0 && ` · ${baht(q * stdUnitPrice)}`}
                  </div>
                </div>
                <PackStepper label={`จำนวน ${sku.name}`} value={packsFromQty(sku, q)} onChange={(v) => setQty((p) => ({ ...p, [sku.id]: qtyFromPacks(sku, v) }))} />
              </div>
              {q > 0 && (
                <div className="flex flex-wrap items-center gap-x-4">
                  <WeightField sku={sku} qty={q} onChange={(v) => setQty((p) => ({ ...p, [sku.id]: v }))} />
                  <div className="min-w-0 flex-1"><NoteField value={notes[sku.id] ?? ""} onChange={(v) => setNotes((p) => ({ ...p, [sku.id]: v }))} /></div>
                </div>
              )}
            </li>
          );
        })}
        {shown.length === 0 && <li className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">ไม่มีสินค้าครัวกลางของแบรนด์นี้</li>}
      </ul>
      <ActionFooter title={`${rows.length} รายการ · ${baht(total)}`} sub="ราคาตามต้นทุนครัวกลาง" action="บันทึก" busy={saving} disabled={!rows.length} onAction={() => doSave(false)} />
      <ConfirmDialog
        open={dupText !== null}
        onOpenChange={(o) => !o && setDupText(null)}
        title="อาจรับของซ้ำ"
        description={dupText ?? ""}
        confirmLabel="ไม่ซ้ำ บันทึกต่อ"
        cancelLabel="ยกเลิก"
        variant="warning"
        onConfirm={() => {
          setDupText(null);
          doSave(true);
        }}
      />
    </div>
  );
}

/** Goods moved in from another branch: pick the branch, add products, priced at standard */
export function ReceiveFromBranch({
  branchId,
  receiptDate,
  sourceBranches,
  itemsFor,
  onSave,
}: {
  branchId: string;
  receiptDate: string;
  sourceBranches: Branch[];
  /** Products of the source branch's brand with standard prices (old page's list) */
  itemsFor: (sourceBranchId: string) => PricedSku[];
  onSave: (rows: ReceiptRow[]) => Promise<boolean>;
}) {
  const [source, setSource] = useState("");
  const [lines, setLines] = useState<{ sku: SKU; std: number; qty: number; note: string }[]>([]);
  const [picker, setPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const items = useMemo(() => (source ? itemsFor(source) : []), [source, itemsFor]);
  const from = sourceBranches.find((b) => b.id === source);

  const rows = lines
    .filter((l) => l.qty > 0)
    .map((l) => branchTransferRow({ branchId, receiptDate, fromBranchName: from?.branchName ?? "", sku: l.sku, qty: l.qty, stdUnitPrice: l.std, note: l.note }));

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="text-sm text-muted-foreground">ย้ายของระหว่างสาขา</div>
        <h2 className="text-xl font-bold">รับจากสาขาอื่น</h2>
      </div>
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">จากสาขา</legend>
        <div className="flex flex-wrap gap-2">
          {sourceBranches.map((b) => (
            <button
              key={b.id}
              type="button"
              aria-pressed={source === b.id}
              onClick={() => {
                setSource(b.id);
                setLines([]);
              }}
              className={cn("min-h-[44px] rounded-full border px-4 text-sm", source === b.id ? "border-primary bg-primary font-semibold text-primary-foreground" : "border-border bg-card")}
            >
              {b.branchName}
            </button>
          ))}
        </div>
      </fieldset>
      {source && (
        <>
          <ul className="flex flex-col gap-2">
            {lines.map((l, i) => (
              <li key={l.sku.id} className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-3 shadow-card">
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-semibold">{l.sku.name}</div>
                    <div className="truncate text-sm text-muted-foreground">{packHint(l.sku) || l.sku.usageUom} · {baht(l.qty * l.std)}</div>
                  </div>
                  <PackStepper label={`จำนวน ${l.sku.name}`} value={packsFromQty(l.sku, l.qty)} onChange={(v) => setLines((p) => p.map((x, j) => (j === i ? { ...x, qty: qtyFromPacks(x.sku, v) } : x)))} />
                  <RemoveButton label={`ลบ ${l.sku.name}`} onClick={() => setLines((p) => p.filter((_, j) => j !== i))} />
                </div>
                <div className="flex flex-wrap items-center gap-x-4">
                  <WeightField sku={l.sku} qty={l.qty} onChange={(qty) => setLines((p) => p.map((x, j) => (j === i ? { ...x, qty } : x)))} />
                  <div className="min-w-0 flex-1"><NoteField value={l.note} onChange={(note) => setLines((p) => p.map((x, j) => (j === i ? { ...x, note } : x)))} /></div>
                </div>
              </li>
            ))}
          </ul>
          <Button variant="outline" className="h-12 border-dashed" onClick={() => setPicker(true)}>
            <Plus className="h-4 w-4" /> เพิ่มสินค้า
          </Button>
          <SkuPicker
            open={picker}
            title={`สินค้าของ ${from?.branchName ?? ""}`}
            skus={items.map((i) => i.sku).filter((s) => !lines.some((l) => l.sku.id === s.id))}
            onPick={(sku) => {
              const it = items.find((i) => i.sku.id === sku.id)!;
              setLines((p) => [...p, { sku, std: it.stdUnitPrice, qty: qtyFromPacks(sku, 1), note: "" }]);
              setPicker(false);
            }}
            onClose={() => setPicker(false)}
          />
        </>
      )}
      <ActionFooter
        title={`${rows.length} รายการ · ${baht(rows.reduce((s, r) => s + r.actualTotal, 0))}`}
        sub={from ? `จาก ${from.branchName} · ราคามาตรฐาน` : "เลือกสาขาต้นทางก่อน"}
        action="บันทึก"
        busy={saving}
        disabled={!rows.length}
        onAction={async () => {
          setSaving(true);
          await onSave(rows);
          setSaving(false);
        }}
      />
    </div>
  );
}
