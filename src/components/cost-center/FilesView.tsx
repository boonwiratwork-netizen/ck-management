import { useMemo, useRef, useState } from "react";
import { Download, FileSpreadsheet, Upload } from "lucide-react";
import { DATASETS, summarize, type Dataset, type ImportContext, type PreviewRow, type Verdict } from "@/lib/import-datasets";
import { readRows, writeRows } from "@/lib/import-file";
import type { ImportSaves } from "@/hooks/use-import-saves";
import { EditSheet } from "@/components/settings/EditSheet";
import { Button } from "@/components/ui/button";
import { toLocalDateStr, cn } from "@/lib/utils";
import { toast } from "sonner";

interface Props {
  ctx: ImportContext;
  saves: ImportSaves;
  /** Which files this role may import (the database decides the same: menus and recipes are management only) */
  canImport: (key: Dataset["key"]) => boolean;
  /** Every recipe in one Excel file (management) */
  onExportAll?: () => void;
}

const VERDICT: Record<Verdict, { label: string; cls: string }> = {
  new: { label: "ใหม่", cls: "bg-brand-soft text-brand-soft-foreground" },
  change: { label: "เปลี่ยน", cls: "bg-warning-soft text-warning" },
  same: { label: "เหมือนเดิม", cls: "bg-secondary text-muted-foreground" },
  skip: { label: "ข้าม", cls: "bg-secondary text-muted-foreground" },
  error: { label: "มีปัญหา", cls: "bg-destructive/10 text-destructive" },
};

/**
 * Bulk changes by file, for the six things that have them (replaces the import
 * buttons of six old pages): a template, today's data in the same columns, and an
 * import that shows every row sorted before anything is saved.
 */
export function FilesView({ ctx, saves, canImport, onExportAll }: Props) {
  const [importing, setImporting] = useState<Dataset | null>(null);
  const today = toLocalDateStr(new Date());
  // Counts once per data change, not on every render
  const counts = useMemo(() => Object.fromEntries(DATASETS.map((d) => [d.key, d.current(ctx).length])), [ctx]);
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
      <div className="flex items-center gap-2 px-4 py-3">
        <FileSpreadsheet className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
        <h3 className="flex-1 text-base font-semibold">นำเข้า/ส่งออกไฟล์</h3>
        <span className="text-xs text-muted-foreground">Excel หรือ CSV</span>
      </div>
      <ul className="divide-y divide-border border-t border-border">
        {DATASETS.map((d) => (
          <li key={d.key} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
            <span className="min-w-[140px] flex-1">
              <span className="block font-medium">{d.label}</span>
              <span className="block text-xs text-muted-foreground">
                <span className="font-mono">{counts[d.key].toLocaleString()}</span> {d.unit}
              </span>
            </span>
            <Button variant="ghost" className="h-10" onClick={() => writeRows(`แม่แบบ_${d.label}.xlsx`, d.columns.map((c) => c.name), [d.example])}>
              แม่แบบ
            </Button>
            <Button variant="ghost" className="h-10" onClick={() => writeRows(`${d.label}_${today}.xlsx`, [...d.columns.map((c) => c.name), ...(d.exportOnly ?? [])], d.current(ctx))}>
              <Download className="h-4 w-4" /> ส่งออก
            </Button>
            {canImport(d.key) && (
              <Button variant="outline" className="h-10" onClick={() => setImporting(d)}>
                <Upload className="h-4 w-4" /> นำเข้า
              </Button>
            )}
          </li>
        ))}
        {onExportAll && (
          <li className="flex flex-wrap items-center gap-2 px-4 py-2.5">
            <span className="min-w-[140px] flex-1">
              <span className="block font-medium">สูตรทั้งหมด (SM · SP · เมนู)</span>
              <span className="block text-xs text-muted-foreground">ไฟล์สรุปสำหรับอ่าน มีต้นทุนทุกสูตร · นำเข้ากลับไม่ได้</span>
            </span>
            <Button variant="ghost" className="h-10" onClick={onExportAll}>
              <Download className="h-4 w-4" /> ส่งออก
            </Button>
          </li>
        )}
      </ul>
      <p className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground">ส่งออกแล้วแก้ใน Excel นำเข้ากลับได้ · ก่อนบันทึกจะเห็นทุกแถวว่าใหม่ เปลี่ยน หรือมีปัญหา</p>
      {importing && <ImportSheet dataset={importing} ctx={ctx} save={saves[importing.key]} onClose={() => setImporting(null)} />}
    </section>
  );
}

function ImportSheet({ dataset, ctx, save, onClose }: { dataset: Dataset; ctx: ImportContext; save: ImportSaves[keyof ImportSaves]; onClose: () => void }) {
  const file = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState<Verdict | "all">("all");

  const pick = async (f: File) => {
    setName(f.name);
    setBusy(true);
    try {
      const rows = await readRows(f);
      const head = new Set(Object.keys(rows[0] ?? {}));
      setMissing(dataset.columns.filter((c) => c.required && !head.has(c.name)).map((c) => c.name));
      setPreview(dataset.check(rows, ctx));
    } catch {
      toast.error("อ่านไฟล์ไม่ได้ · ใช้ไฟล์ Excel (.xlsx) หรือ CSV");
      setPreview(null);
    } finally {
      setBusy(false);
    }
  };
  const sum = preview ? summarize(preview) : null;
  const rows = sum?.toSave.flatMap((p) => p.rows) ?? [];
  const confirm = async () => {
    if (!sum || !rows.length) return;
    setBusy(true);
    const res = await save(rows);
    setBusy(false);
    if (res.saved) toast.success(`บันทึก${dataset.label} ${res.saved.toLocaleString()} ${dataset.unit === "บรรทัด" ? "บรรทัด" : "รายการ"}แล้ว${res.failed ? ` · ไม่สำเร็จ ${res.failed}` : ""}`, res.note ? { description: res.note } : undefined);
    else toast.error(`บันทึก${dataset.label}ไม่สำเร็จ`);
    if (res.saved) onClose();
  };
  const shown = (preview ?? []).filter((p) => show === "all" || p.verdict === show);

  return (
    <EditSheet
      title={`นำเข้า › ${dataset.label}`}
      onClose={onClose}
      footer={
        preview && sum ? (
          <div className="flex gap-2">
            <Button variant="outline" className="h-12" onClick={() => (setPreview(null), setName(""))}>
              เลือกไฟล์ใหม่
            </Button>
            <Button variant="brand" className="h-12 flex-1 text-base" loading={busy} disabled={!rows.length || missing.length > 0} onClick={confirm}>
              {missing.length ? "ไฟล์ขาดคอลัมน์" : rows.length ? `บันทึก ${sum.new + sum.change} (ใหม่ ${sum.new} · เปลี่ยน ${sum.change})` : "ไม่มีอะไรต้องบันทึก"}
            </Button>
          </div>
        ) : null
      }
    >
      <input
        ref={file}
        type="file"
        accept=".xlsx,.xls,.csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) pick(f);
        }}
      />
      {!preview ? (
        <>
          <button type="button" disabled={busy} onClick={() => file.current?.click()} className="flex min-h-[120px] flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border bg-secondary/40 px-4 text-center hover:bg-secondary">
            <Upload className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
            <span className="font-medium">{busy ? "กำลังอ่านไฟล์…" : "เลือกไฟล์ Excel หรือ CSV"}</span>
            <span className="text-sm text-muted-foreground">แถวแรกเป็นชื่อคอลัมน์ ตามแม่แบบ</span>
          </button>
          <details className="rounded-xl border border-border px-3 py-2 text-sm">
            <summary className="min-h-[32px] cursor-pointer font-medium">คอลัมน์ในไฟล์</summary>
            <ul className="mt-1 flex flex-col gap-1">
              {dataset.columns.map((c) => (
                <li key={c.name}>
                  <span className="font-mono">{c.name}</span>
                  {c.required && <span className="text-destructive"> *</span>} <span className="text-muted-foreground">· {c.hint}</span>
                </li>
              ))}
            </ul>
          </details>
        </>
      ) : (
        <>
          <p className="break-all text-sm text-muted-foreground">
            {name} · {preview.length.toLocaleString()} รายการ
          </p>
          {missing.length > 0 && <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">ไฟล์ไม่มีคอลัมน์ {missing.join(", ")} · ใช้แม่แบบ หรือไฟล์ที่ส่งออกจากที่นี่</p>}
          <div className="flex flex-wrap gap-1.5">
            {(["all", "new", "change", "same", "skip", "error"] as const).map((v) => {
              const n = v === "all" ? preview.length : sum![v];
              if (v !== "all" && !n) return null;
              return (
                <button key={v} type="button" aria-pressed={show === v} onClick={() => setShow(v)} className={cn("min-h-[36px] rounded-full px-3 text-sm", show === v ? "bg-foreground text-background" : v === "all" ? "bg-secondary" : VERDICT[v].cls)}>
                  {v === "all" ? "ทั้งหมด" : VERDICT[v].label} <span className="font-mono">{n}</span>
                </button>
              );
            })}
          </div>
          <ul className="max-h-[45dvh] divide-y divide-border overflow-y-auto rounded-xl border border-border">
            {shown.map((p, i) => (
              <li key={`${p.line}-${i}`} className="flex items-start gap-2 px-3 py-2 text-sm">
                <span className="w-8 shrink-0 pt-0.5 font-mono text-xs text-muted-foreground">{p.line}</span>
                <span className="min-w-0 flex-1">
                  <span className="block break-words">{p.title}</span>
                  {(p.detail || p.was || p.now) && (
                    <span className={cn("block break-words text-xs", p.verdict === "error" ? "text-destructive" : "text-muted-foreground")}>
                      {p.was && p.now ? `${p.was} → ${p.now}` : p.now ?? p.was}
                      {p.detail && `${p.was || p.now ? " · " : ""}${p.detail}`}
                    </span>
                  )}
                </span>
                <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs", VERDICT[p.verdict].cls)}>{VERDICT[p.verdict].label}</span>
              </li>
            ))}
          </ul>
          {sum!.error > 0 && <p className="text-xs text-muted-foreground">แถวที่มีปัญหาจะไม่บันทึก แก้ในไฟล์แล้วนำเข้าอีกครั้งได้</p>}
        </>
      )}
    </EditSheet>
  );
}
