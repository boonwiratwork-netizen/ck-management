import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import type { Branch } from "@/types/branch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Choices, EditSheet, Field } from "./EditSheet";

interface Props {
  branches: Branch[];
  canEdit: boolean;
  addBranch: (data: Omit<Branch, "id">) => Promise<boolean>;
  updateBranch: (id: string, data: Partial<Omit<Branch, "id">>) => Promise<boolean>;
}

type Draft = Pick<Branch, "branchName" | "brandName" | "location" | "status">;

/**
 * Branches: name, brand (which menus the branch sees), where, open or closed.
 * No delete: a branch carries its sales and counts, so it is closed instead.
 * Menus per branch live in Cost Center › สาขา.
 */
export function BranchesTab({ branches, canEdit, addBranch, updateBranch }: Props) {
  const [editing, setEditing] = useState<Branch | "new" | null>(null);
  const sorted = useMemo(() => [...branches].sort((a, b) => (a.status === b.status ? a.branchName.localeCompare(b.branchName) : a.status === "Active" ? -1 : 1)), [branches]);
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <h2 className="font-semibold">{branches.length} สาขา</h2>
        {canEdit && (
          <Button variant="brand" className="h-10" onClick={() => setEditing("new")}>
            <Plus className="h-4 w-4" /> เพิ่มสาขา
          </Button>
        )}
      </div>
      <ul className="divide-y divide-border border-t border-border">
        {sorted.map((b) => (
          <li key={b.id}>
            <button type="button" disabled={!canEdit} onClick={() => setEditing(b)} className="flex min-h-[56px] w-full items-center gap-3 px-4 py-2 text-left enabled:hover:bg-secondary/50">
              <span className="min-w-0 flex-1">
                <span className={cn("block font-medium", b.status !== "Active" && "text-muted-foreground")}>{b.branchName}</span>
                <span className="block text-sm text-muted-foreground">
                  {b.brandName || "ไม่มีแบรนด์"}
                  {b.location && ` · ${b.location}`}
                </span>
              </span>
              <span className={cn("shrink-0 rounded-full px-2.5 py-0.5 text-xs", b.status === "Active" ? "bg-success-soft text-success" : "bg-secondary text-muted-foreground")}>{b.status === "Active" ? "เปิดอยู่" : "ปิดแล้ว"}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">เปิด/ปิดเมนูรายสาขา ทำที่ Cost Center › สาขา</p>
      {editing && (
        <BranchSheet
          branch={editing === "new" ? null : editing}
          brands={[...new Set(branches.map((b) => b.brandName).filter(Boolean))].sort()}
          onClose={() => setEditing(null)}
          onSave={async (d) => {
            const ok = editing === "new" ? await addBranch({ ...d, avgSellingPrice: null }) : await updateBranch(editing.id, d);
            if (ok) {
              toast.success(editing === "new" ? `เพิ่มสาขา ${d.branchName} แล้ว` : `บันทึก ${d.branchName} แล้ว`);
              setEditing(null);
            }
          }}
        />
      )}
    </section>
  );
}

function BranchSheet({ branch, brands, onClose, onSave }: { branch: Branch | null; brands: string[]; onClose: () => void; onSave: (d: Draft) => Promise<void> }) {
  const [d, setD] = useState<Draft>(branch ? { branchName: branch.branchName, brandName: branch.brandName, location: branch.location, status: branch.status } : { branchName: "", brandName: brands[0] ?? "", location: "", status: "Active" });
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const missing = !d.branchName.trim() || !d.brandName.trim();
  const save = async () => {
    setTried(true);
    if (missing) return;
    setBusy(true);
    await onSave({ ...d, branchName: d.branchName.trim(), brandName: d.brandName.trim(), location: d.location.trim() });
    setBusy(false);
  };
  return (
    <EditSheet
      title={branch ? branch.branchName : "เพิ่มสาขา"}
      onClose={onClose}
      footer={
        <Button variant="brand" className="h-12 text-base" loading={busy} onClick={save}>
          บันทึก
        </Button>
      }
    >
      <Field label="ชื่อสาขา">
        <Input value={d.branchName} onChange={(e) => setD({ ...d, branchName: e.target.value })} className="h-12 text-base" aria-invalid={tried && !d.branchName.trim()} />
      </Field>
      <Field label="แบรนด์" hint="แบรนด์คุมว่าสาขาเห็นเมนูไหน · เลือกที่มี หรือพิมพ์แบรนด์ใหม่">
        {brands.length > 0 && <Choices options={brands.map((b) => ({ key: b, label: b }))} picked={[d.brandName]} onPick={(b) => setD({ ...d, brandName: b })} />}
        <Input value={d.brandName} onChange={(e) => setD({ ...d, brandName: e.target.value })} placeholder="ชื่อแบรนด์" className="h-12 text-base" aria-invalid={tried && !d.brandName.trim()} />
      </Field>
      <Field label="ที่ตั้ง">
        <Input value={d.location} onChange={(e) => setD({ ...d, location: e.target.value })} placeholder="เช่น Silom" className="h-12 text-base" />
      </Field>
      <Field label="สถานะ" hint={d.status === "Inactive" ? "ปิดแล้ว: ไม่ขึ้นในหน้าวันนี้ · ยอดขายและสต๊อกเก่าอยู่ครบ" : undefined}>
        <Choices
          options={[
            { key: "Active", label: "เปิดอยู่" },
            { key: "Inactive", label: "ปิดสาขา" },
          ]}
          picked={[d.status]}
          onPick={(s) => setD({ ...d, status: s as Draft["status"] })}
        />
      </Field>
      {tried && missing && <p className="text-sm text-destructive">ใส่ชื่อสาขาและแบรนด์ก่อน</p>}
    </EditSheet>
  );
}
