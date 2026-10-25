import { useMemo, useState } from "react";
import { Copy, Pencil, Plus, Search, Trash2 } from "lucide-react";
import type { DaySummary, SaleLine } from "@/hooks/use-sales-data";
import { shortName } from "@/lib/sales-import";
import { baht } from "@/components/receive/parts";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { thaiDay } from "./SalesDays";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export type Patch = Partial<Omit<SaleLine, "id" | "branch_id" | "receipt_no">>;

/** One day's bills: search, copy to Excel, edit or delete lines (bulk delete for management) */
export function SalesDay({
  date,
  today,
  lines,
  loading,
  summary,
  branchName,
  canEdit,
  canBulk,
  onUpdate,
  onDelete,
  onAdd,
}: {
  date: string;
  today: string;
  lines: SaleLine[];
  loading: boolean;
  summary?: DaySummary;
  branchName: string;
  canEdit: boolean;
  canBulk: boolean;
  onUpdate: (id: string, patch: Patch) => Promise<boolean>;
  onDelete: (ids: string[]) => Promise<boolean>;
  onAdd: () => void;
}) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<SaleLine | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<{ ids: string[]; text: string } | null>(null);

  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return lines.filter((l) => words.every((w) => `${l.receipt_no} ${l.menu_code} ${l.menu_name} ${l.channel}`.toLowerCase().includes(w)));
  }, [lines, query]);
  const bills = useMemo(() => {
    const m = new Map<string, SaleLine[]>();
    for (const l of shown) m.set(l.receipt_no, [...(m.get(l.receipt_no) ?? []), l]);
    return [...m.entries()];
  }, [shown]);
  const total = lines.reduce((s, l) => s + l.net_amount, 0);
  const billCount = new Set(lines.map((l) => l.receipt_no)).size;

  const copy = () => {
    // Same columns as the old "Copy to Clipboard"
    const head = ["Date", "Receipt No", "Menu Code", "Menu Name", "Order Type", "Qty", "Unit Price", "Net Amount", "Channel", "Branch"];
    const rows = shown.map((e) =>
      [e.sale_date, e.receipt_no, e.menu_code, `"${e.menu_name.replace(/"/g, '""')}"`, e.order_type, e.qty, e.unit_price.toFixed(2), e.net_amount.toFixed(2), e.channel, branchName].join("\t"),
    );
    navigator.clipboard.writeText([head.join("\t"), ...rows].join("\n")).then(() => toast.success(`คัดลอก ${shown.length} รายการแล้ว วางใน Excel ได้เลย`));
  };
  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto min-w-0">
          <h2 className="text-xl font-bold">{thaiDay(date)}</h2>
          <p className="text-sm text-muted-foreground">
            {loading && !lines.length ? "กำลังโหลด…" : lines.length ? (
              <>
                {billCount} บิล · {lines.length} รายการ · <span className="font-mono font-semibold text-foreground">{baht(total, 2)}</span>
              </>
            ) : (
              "ยังไม่มียอดขาย"
            )}
          </p>
        </div>
        {lines.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="h-10" onClick={copy}>
              <Copy className="h-4 w-4" /> คัดลอกไป Excel
            </Button>
            {canBulk && (
              <Button
                variant={selecting ? "default" : "outline"}
                className="h-10"
                onClick={() => {
                  setSelecting(!selecting);
                  setPicked(new Set());
                }}
              >
                {selecting ? "เลิกเลือก" : "เลือกหลายรายการ"}
              </Button>
            )}
          </div>
        )}
      </div>

      {!loading && !lines.length && (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">{date < today ? "วันนี้ยังไม่มียอดขายในระบบ วางข้อมูลจาก POS ของวันนี้ในช่องนำยอดขายเข้า" : "ยังไม่มียอดขายของวันนี้"}</p>
          {canEdit && (
            <Button variant="outline" className="h-11" onClick={onAdd}>
              <Plus className="h-4 w-4" /> เพิ่มรายการเอง
            </Button>
          )}
        </div>
      )}

      {lines.length > 0 && (
        <label className="relative block">
          <span className="sr-only">ค้นเมนูหรือเลขบิล</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ค้นเมนูหรือเลขบิล…" className="h-11 pl-9" />
        </label>
      )}

      {selecting && (
        <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 shadow-card">
          <span className="mr-auto text-sm">
            เลือก {picked.size} รายการ · <span className="font-mono">{baht(lines.filter((l) => picked.has(l.id)).reduce((s, l) => s + l.net_amount, 0), 2)}</span>
          </span>
          <Button variant="ghost" className="h-10" onClick={() => setPicked(new Set(shown.map((l) => l.id)))}>
            เลือกทั้งหมด
          </Button>
          <Button
            variant="destructive"
            className="h-10"
            disabled={!picked.size}
            onClick={() => setConfirm({ ids: [...picked], text: `ลบ ${picked.size} รายการของ ${thaiDay(date)} ออกจากระบบ ยอดขายและการตัดสต๊อกของวันนั้นจะเปลี่ยนตาม` })}
          >
            <Trash2 className="h-4 w-4" /> ลบที่เลือก
          </Button>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {bills.map(([bill, items]) => (
          <section key={bill} className="overflow-hidden rounded-2xl border border-border bg-card">
            <div className="flex items-center gap-2 border-b border-border bg-secondary/50 px-4 py-2 text-sm">
              <span className="font-mono font-semibold">{bill || "—"}</span>
              <span className="text-muted-foreground">· {items[0].channel || "—"}</span>
              <span className="ml-auto font-mono font-semibold">{baht(items.reduce((s, l) => s + l.net_amount, 0), 2)}</span>
            </div>
            <ul className="divide-y divide-border">
              {items.map((l) => {
                const n = shortName(l.menu_name);
                return (
                  <li key={l.id} className="flex items-center gap-3 px-4 py-2.5">
                    {selecting && <Checkbox checked={picked.has(l.id)} onCheckedChange={() => toggle(l.id)} aria-label={`เลือก ${n.base}`} className="h-5 w-5" />}
                    <div className="min-w-0 flex-1">
                      <div className="text-[15px]">{n.base}</div>
                      <div className="text-xs text-muted-foreground">
                        <span className="font-mono">{l.menu_code}</span>
                        {n.options && ` · ${n.options}`}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="font-mono text-[15px]">{baht(l.net_amount, 2)}</div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {l.qty} × {l.unit_price.toLocaleString()}
                      </div>
                    </div>
                    {canEdit && !selecting && (
                      <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0" aria-label={`แก้ ${n.base}`} onClick={() => setEditing(l)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
        {lines.length > 0 && !bills.length && <p className="p-6 text-center text-sm text-muted-foreground">ไม่พบรายการที่ค้น</p>}
      </div>

      <EditDialog
        line={editing}
        onClose={() => setEditing(null)}
        onSave={async (patch) => {
          if (!editing) return;
          if (await onUpdate(editing.id, patch)) {
            toast.success("แก้ไขแล้ว");
            setEditing(null);
          }
        }}
        onDelete={() => editing && setConfirm({ ids: [editing.id], text: `ลบ ${shortName(editing.menu_name).base} (บิล ${editing.receipt_no}) ออกจากระบบ` })}
      />
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="ลบรายการขาย"
        description={confirm?.text ?? ""}
        confirmLabel="ลบ"
        cancelLabel="ยกเลิก"
        onConfirm={async () => {
          if (!confirm) return;
          if (await onDelete(confirm.ids)) {
            toast.success(`ลบ ${confirm.ids.length} รายการแล้ว`);
            setPicked(new Set());
            setEditing(null);
          }
          setConfirm(null);
        }}
      />
    </div>
  );
}

/** The old edit form, in Thai: every field the old dialog had */
export function EditDialog({ line, onClose, onSave, onDelete }: { line: SaleLine | null; onClose: () => void; onSave: (p: Patch) => Promise<void>; onDelete: () => void }) {
  const [draft, setDraft] = useState<Patch>({});
  const [saving, setSaving] = useState(false);
  const v = { ...line, ...draft } as SaleLine;
  const field = (label: string, k: keyof Patch, type: "text" | "number" | "date" = "text", wide = false) => (
    <label className={cn("flex flex-col gap-1 text-sm", wide && "col-span-2")}>
      <span className="text-muted-foreground">{label}</span>
      <Input
        type={type}
        inputMode={type === "number" ? "decimal" : undefined}
        value={String(v[k] ?? "")}
        onChange={(e) => setDraft((d) => ({ ...d, [k]: type === "number" ? Number(e.target.value) || 0 : e.target.value }))}
        className={cn("h-11 text-base", type === "number" && "text-right font-mono")}
      />
    </label>
  );
  return (
    <Dialog
      open={line !== null}
      onOpenChange={(o) => {
        if (!o) {
          setDraft({});
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>แก้รายการขาย</DialogTitle>
        </DialogHeader>
        {line && (
          <div className="grid grid-cols-2 gap-3">
            {field("วันที่ขาย", "sale_date", "date")}
            {field("ประเภทออเดอร์", "order_type")}
            {field("รหัสเมนู", "menu_code")}
            {field("ช่องทาง", "channel")}
            {field("ชื่อเมนู (ตามบิล)", "menu_name", "text", true)}
            {field("จำนวน", "qty", "number")}
            {field("ราคา/หน่วย", "unit_price", "number")}
            {field("ยอดสุทธิ", "net_amount", "number", true)}
          </div>
        )}
        <DialogFooter className="flex-row gap-2 sm:justify-between">
          <Button variant="ghost" className="h-11 text-destructive hover:text-destructive" onClick={onDelete}>
            <Trash2 className="h-4 w-4" /> ลบ
          </Button>
          <Button
            variant="brand"
            className="h-11 min-w-[96px]"
            loading={saving}
            disabled={!Object.keys(draft).length}
            onClick={async () => {
              setSaving(true);
              await onSave(draft);
              setSaving(false);
              setDraft({});
            }}
          >
            บันทึก
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
