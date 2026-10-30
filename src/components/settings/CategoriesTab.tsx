import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import type { SkuCategory } from "@/hooks/use-sku-categories";
import type { SKU } from "@/types/sku";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { toast } from "sonner";
import { EditSheet, Field } from "./EditSheet";

interface Props {
  categories: SkuCategory[];
  skus: SKU[];
  canEdit: boolean;
  addCategory: (code: string, nameEn: string, nameTh: string) => Promise<SkuCategory | null>;
  updateCategory: (id: string, nameEn: string, nameTh: string) => Promise<boolean>;
  deleteCategory: (id: string) => Promise<boolean>;
}

/**
 * Product categories, most used first. The code can't change (products point at
 * it); a category can be deleted only when no product uses it.
 */
export function CategoriesTab({ categories, skus, canEdit, addCategory, updateCategory, deleteCategory }: Props) {
  const [editing, setEditing] = useState<SkuCategory | "new" | null>(null);
  const used = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of skus) m.set(s.category, (m.get(s.category) ?? 0) + 1);
    return m;
  }, [skus]);
  const sorted = useMemo(() => [...categories].sort((a, b) => (used.get(b.code) ?? 0) - (used.get(a.code) ?? 0) || a.code.localeCompare(b.code)), [categories, used]);
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <h2 className="font-semibold">{categories.length} หมวด</h2>
        {canEdit && (
          <Button variant="brand" className="h-10" onClick={() => setEditing("new")}>
            <Plus className="h-4 w-4" /> เพิ่มหมวด
          </Button>
        )}
      </div>
      <ul className="divide-y divide-border border-t border-border">
        {sorted.map((c) => {
          const n = used.get(c.code) ?? 0;
          return (
            <li key={c.id}>
              <button type="button" disabled={!canEdit} onClick={() => setEditing(c)} className="flex min-h-[52px] w-full items-center gap-3 px-4 py-2 text-left enabled:hover:bg-secondary/50">
                <span className="w-12 shrink-0 font-mono text-sm text-muted-foreground">{c.code}</span>
                <span className="min-w-0 flex-1">
                  <span className="block">{c.nameTh || c.nameEn}</span>
                  {c.nameTh && c.nameEn !== c.nameTh && <span className="block text-sm text-muted-foreground">{c.nameEn}</span>}
                </span>
                <span className={n ? "font-mono text-sm" : "text-sm text-muted-foreground"}>{n ? `${n} สินค้า` : "ไม่มีสินค้า"}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {editing && (
        <CategorySheet
          category={editing === "new" ? null : editing}
          usedBy={editing === "new" ? 0 : (used.get(editing.code) ?? 0)}
          onClose={() => setEditing(null)}
          onSave={async (code, en, th) => {
            const ok = editing === "new" ? !!(await addCategory(code, en, th)) : await updateCategory(editing.id, en, th);
            if (ok) {
              toast.success("บันทึกหมวดแล้ว");
              setEditing(null);
            }
          }}
          onDelete={
            editing !== "new"
              ? async () => {
                  if (await deleteCategory(editing.id)) {
                    toast.success(`ลบหมวด ${editing.code} แล้ว`);
                    setEditing(null);
                  }
                }
              : undefined
          }
        />
      )}
    </section>
  );
}

function CategorySheet({ category, usedBy, onClose, onSave, onDelete }: { category: SkuCategory | null; usedBy: number; onClose: () => void; onSave: (code: string, en: string, th: string) => Promise<void>; onDelete?: () => Promise<void> }) {
  const [code, setCode] = useState(category?.code ?? "");
  const [th, setTh] = useState(category?.nameTh ?? "");
  const [en, setEn] = useState(category?.nameEn ?? "");
  const [busy, setBusy] = useState(false);
  const [askDelete, setAskDelete] = useState(false);
  const save = async () => {
    setBusy(true);
    await onSave(code, en, th);
    setBusy(false);
  };
  return (
    <EditSheet
      title={category ? `หมวด ${category.code}` : "เพิ่มหมวด"}
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-2">
          <Button variant="brand" className="h-12 text-base" loading={busy} onClick={save}>
            บันทึก
          </Button>
          {onDelete && (
            <Button variant="ghost" className="h-11 text-destructive" disabled={usedBy > 0} onClick={() => setAskDelete(true)}>
              {usedBy > 0 ? `ลบไม่ได้ · มีสินค้า ${usedBy} ตัวในหมวดนี้` : "ลบหมวดนี้"}
            </Button>
          )}
        </div>
      }
    >
      <Field label="รหัส" hint={category ? "แก้ไม่ได้ สินค้าผูกกับรหัสนี้" : "2 ตัวอักษร เช่น BV"}>
        <Input value={code} disabled={!!category} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={4} className="h-12 font-mono text-base" />
      </Field>
      <Field label="ชื่อไทย">
        <Input value={th} onChange={(e) => setTh(e.target.value)} className="h-12 text-base" />
      </Field>
      <Field label="ชื่ออังกฤษ">
        <Input value={en} onChange={(e) => setEn(e.target.value)} className="h-12 text-base" />
      </Field>
      <ConfirmDialog
        open={askDelete}
        onOpenChange={setAskDelete}
        title="ลบหมวดนี้?"
        description={`ลบหมวด ${category?.code ?? ""} ${category?.nameTh ?? ""} · ไม่มีสินค้าในหมวดนี้`}
        confirmLabel="ลบ"
        cancelLabel="ไม่ลบ"
        variant="destructive"
        onConfirm={async () => {
          setAskDelete(false);
          await onDelete?.();
        }}
      />
    </EditSheet>
  );
}
