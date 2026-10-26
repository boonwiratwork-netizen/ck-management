import { useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ClipboardList, Pencil, Plus, Upload } from "lucide-react";
import type { POSMappingProfile } from "@/hooks/use-sales-entry-data";
import type { DayMode, DayPlan, ReadResult } from "@/lib/sales-import";
import { isReadable } from "@/lib/sales-import";
import { POSProfileModal } from "@/components/POSProfileModal";
import { ActionFooter, baht } from "@/components/receive/parts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { thaiDay } from "./SalesDays";
import { cn } from "@/lib/utils";

/** Paste box + file button. The text is only read when "ตรวจข้อมูล" is pressed. */
export function ImportCard({ busy, onCheck, onProfiles }: { busy: boolean; onCheck: (text: string, source: "paste" | "csv", fileName?: string) => void; onProfiles: () => void }) {
  const [text, setText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const readFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => onCheck(String(ev.target?.result ?? ""), "csv", file.name);
    reader.readAsText(file);
  };
  return (
    <section data-tour="import" className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-card">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-soft">
          <ClipboardList className="h-5 w-5 text-brand" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold">นำยอดขายจาก POS เข้า</h2>
          <p className="text-sm text-muted-foreground">วางได้หลายวันพร้อมกัน ระบบดูรูปแบบ POS ให้เอง</p>
        </div>
      </div>
      <label className="block">
        <span className="sr-only">ข้อมูลจาก POS</span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            readFile(e.dataTransfer.files?.[0]);
          }}
          placeholder="กดค้างแล้ววาง หรือ Ctrl+V · ลากไฟล์ CSV มาวางก็ได้"
          rows={4}
          className="w-full resize-none rounded-xl border border-dashed border-input bg-background px-3 py-2.5 font-mono text-base md:text-sm"
        />
      </label>
      <div className="flex gap-2">
        <Button variant="outline" className="h-11 flex-1" onClick={() => fileRef.current?.click()}>
          <Upload className="h-4 w-4" /> เลือกไฟล์ CSV
        </Button>
        <Button data-tour="check" variant="brand" className="h-11 flex-1 text-[15px]" loading={busy} disabled={!text.trim()} onClick={() => onCheck(text, "paste")}>
          ตรวจข้อมูล
        </Button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          readFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <button type="button" onClick={onProfiles} className="self-start text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
        รูปแบบ POS ที่ตั้งไว้
      </button>
    </section>
  );
}

/** The check-before-save screen: one block per day, unreadable pastes stopped */
export function CheckView({
  reads,
  pick,
  onPick,
  plans,
  modes,
  onMode,
  saving,
  onSave,
  onAgain,
}: {
  reads: ReadResult[];
  pick: number;
  onPick: (i: number) => void;
  plans: DayPlan[];
  modes: Record<string, DayMode>;
  onMode: (date: string, m: DayMode) => void;
  saving: boolean;
  onSave: () => void;
  onAgain: () => void;
}) {
  const [showSkipped, setShowSkipped] = useState(false);
  const read = reads[pick];
  const others = reads.map((r, i) => ({ r, i })).filter(({ i }) => i !== pick);

  if (!isReadable(read)) {
    const sample = read?.rows.slice(0, 3) ?? [];
    return (
      <div className="flex flex-col gap-4">
        <Title sub={read ? `อ่านแบบ ${read.profile.name}` : undefined} />
        <section className="flex flex-col gap-2 rounded-2xl border-[1.5px] border-warning bg-card p-4">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-warning-soft">
              <AlertTriangle className="h-5 w-5 text-warning" />
            </span>
            <h3 className="text-[17px] font-bold">ข้อมูลนี้อ่านไม่ออก</h3>
          </div>
          {read && read.rows.length > 0 ? (
            <p className="text-[15px] leading-relaxed">
              อ่านได้ {read.rows.length} แถว แต่มีรหัสเมนูที่ระบบรู้จักแค่ {read.known} แถว ช่องรหัสเมนูได้คำว่า <b>“{sample[0]?.menuCode}”</b>
            </p>
          ) : (
            <p className="text-[15px] leading-relaxed">ไม่พบแถวที่มีวันที่ รหัสเมนู และจำนวน</p>
          )}
          <p className="text-sm leading-relaxed text-muted-foreground">น่าจะคัดลอกมาผิดหน้าใน POS ให้เปิดรายงานยอดขายรายเมนูแล้วคัดลอกใหม่ ระบบจะไม่บันทึกข้อมูลนี้</p>
        </section>
        {sample.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-border bg-card text-sm">
            <div className="grid grid-cols-[1fr_1fr_80px] gap-2 bg-secondary px-3 py-2 font-semibold text-muted-foreground">
              <span>รหัสเมนู</span>
              <span>ชื่อเมนู</span>
              <span className="text-right">ยอด</span>
            </div>
            {sample.map((r, k) => (
              <div key={k} className="grid grid-cols-[1fr_1fr_80px] gap-2 border-t border-border px-3 py-2">
                <span className="break-words">{r.menuCode}</span>
                <span className="break-words">{r.menuName}</span>
                <span className="text-right font-mono">{r.netAmount.toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {others.map(({ r, i }) => (
            <Button key={r.profile.id} variant="outline" className="h-12 flex-1" onClick={() => onPick(i)}>
              ลองอ่านแบบ {r.profile.name}
            </Button>
          ))}
          <Button variant="default" className="h-12 flex-1" onClick={onAgain}>
            วางใหม่
          </Button>
        </div>
      </div>
    );
  }

  const writing = plans.filter((p) => (modes[p.date] ?? "add") !== "skip");
  const count = writing.reduce((s, p) => s + (modes[p.date] === "replace" ? p.rows.length : p.newRows.length), 0);
  const total = writing.reduce((s, p) => s + (modes[p.date] === "replace" ? p.total : p.newRows.reduce((t, r) => t + r.netAmount, 0)), 0);

  return (
    <div className="flex flex-col gap-3">
      <Title sub={`อ่านแบบ ${read.profile.name}`} />
      {others.length > 0 && (
        <div className="-mt-1 flex flex-wrap gap-1.5 text-sm">
          <span className="self-center text-muted-foreground">อ่านแบบ</span>
          {reads.map((r, i) => (
            <button
              key={r.profile.id}
              type="button"
              aria-pressed={i === pick}
              onClick={() => onPick(i)}
              className={cn("min-h-[36px] rounded-full border px-3", i === pick ? "border-primary bg-primary font-semibold text-primary-foreground" : "border-border bg-card")}
            >
              {r.profile.name}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2 rounded-xl bg-success-soft px-3 py-2.5 text-sm text-success">
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        อ่านได้ {read.rows.length} แถว{read.known === read.rows.length ? " · รู้จักรหัสเมนูทุกแถว" : ` · รู้จักรหัสเมนู ${read.known} แถว`}
      </div>

      <h3 className="mt-1 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">วันที่อยู่ในข้อมูลนี้</h3>
      <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
        {plans.map((p) => {
          const mode = modes[p.date] ?? "add";
          const had = p.existing.length > 0;
          return (
            <li key={p.date} className={cn("flex flex-col gap-2.5 px-4 py-3", had && "bg-warning-soft/40")}>
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-semibold">{thaiDay(p.date)}</div>
                  <div className={cn("text-sm", had ? "text-warning" : "text-muted-foreground")}>
                    {had
                      ? `มีในระบบแล้ว ${p.existing.length} รายการ · ข้อมูลนี้ ${p.rows.length} รายการ${p.newRows.length ? ` (ใหม่ ${p.newRows.length})` : ""}`
                      : `${p.bills} บิล · ${p.rows.length} รายการ · ใหม่ทั้งหมด`}
                  </div>
                </div>
                <span className={cn("font-mono text-[15px] font-semibold", mode === "skip" && "text-muted-foreground line-through")}>{baht(p.total)}</span>
              </div>
              {had && (
                <fieldset className="flex flex-col gap-1.5">
                  <legend className="sr-only">วันที่ {thaiDay(p.date)} ทำอย่างไร</legend>
                  {p.newRows.length > 0 ? (
                    <Choice name={p.date} checked={mode === "add"} onChange={() => onMode(p.date, "add")}>
                      เพิ่มเฉพาะที่ยังไม่มี ({p.newRows.length} รายการ)
                    </Choice>
                  ) : (
                    <Choice name={p.date} checked={mode === "skip"} onChange={() => onMode(p.date, "skip")}>
                      ข้าม วันนี้มีครบแล้ว
                    </Choice>
                  )}
                  {p.newRows.length > 0 && (
                    <Choice name={p.date} checked={mode === "skip"} onChange={() => onMode(p.date, "skip")}>
                      ข้ามวันนี้
                    </Choice>
                  )}
                  <Choice name={p.date} checked={mode === "replace"} onChange={() => onMode(p.date, "replace")}>
                    ใช้ข้อมูลนี้แทนทั้งวัน
                    <span className="block text-xs text-muted-foreground">ลบของเดิม {p.existing.length} รายการ ({baht(p.existingTotal)}) แล้วใส่ {p.rows.length} รายการนี้</span>
                  </Choice>
                </fieldset>
              )}
            </li>
          );
        })}
      </ul>

      {read.skipped.length > 0 && (
        <div className="rounded-xl border border-border bg-card">
          <button type="button" aria-expanded={showSkipped} onClick={() => setShowSkipped(!showSkipped)} className="flex min-h-[48px] w-full items-center gap-2 px-3 text-left text-sm">
            <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
            <span className="flex-1">{read.skipped.length} แถวไม่มีรหัสเมนู ไม่ถูกนับ ถ้าเป็นของขายจริงให้กด “เพิ่มเอง”</span>
            <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", showSkipped && "rotate-180")} />
          </button>
          {showSkipped && (
            <ul className="divide-y divide-border border-t border-border text-sm">
              {read.skipped.map((r, k) => (
                <li key={k} className="flex gap-3 px-3 py-2">
                  <span className="shrink-0 text-muted-foreground">{r.saleDate}</span>
                  <span className="shrink-0 font-mono">{r.receiptNo}</span>
                  <span className="min-w-0 break-words">{r.menuName}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <ActionFooter
        tour="sales-save"
        title={count ? `บันทึก ${writing.length} วัน · ${count.toLocaleString()} รายการ` : "ไม่มีอะไรต้องบันทึก"}
        sub={count ? baht(total) : "ทุกวันมีครบแล้ว"}
        action="บันทึก"
        busy={saving}
        disabled={!count}
        onAction={onSave}
      />
    </div>
  );
}

function Title({ sub }: { sub?: string }) {
  return (
    <div>
      <h2 className="text-xl font-bold">ตรวจก่อนบันทึก</h2>
      {sub && <p className="text-sm text-muted-foreground">{sub}</p>}
    </div>
  );
}

function Choice({ name, checked, onChange, children }: { name: string; checked: boolean; onChange: () => void; children: React.ReactNode }) {
  return (
    <label className={cn("flex min-h-[44px] cursor-pointer items-center gap-3 rounded-xl border bg-card px-3 py-2 text-sm", checked ? "border-[1.5px] border-foreground" : "border-border")}>
      <input type="radio" name={`mode-${name}`} checked={checked} onChange={onChange} className="h-[18px] w-[18px] shrink-0 accent-[hsl(var(--brand))]" />
      <span>{children}</span>
    </label>
  );
}

/** The saved POS formats (column positions); editing reuses the old form */
export function ProfilesDialog({
  open,
  onClose,
  profiles,
  onSave,
  onDelete,
}: {
  open: boolean;
  onClose: () => void;
  profiles: POSMappingProfile[];
  onSave: (p: Omit<POSMappingProfile, "id"> & { id?: string }) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState<POSMappingProfile | null | "new">(null);
  return (
    <>
      <Dialog open={open && editing === null} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>รูปแบบ POS ที่ตั้งไว้</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">ระบบลองอ่านทุกแบบแล้วเลือกแบบที่อ่านรหัสเมนูได้มากที่สุดให้เอง แก้ที่นี่เมื่อ POS เปลี่ยนตำแหน่งคอลัมน์</p>
          <ul className="divide-y divide-border rounded-xl border border-border">
            {profiles.map((p) => (
              <li key={p.id} className="flex items-center gap-2 px-3 py-2">
                <span className="flex-1 text-[15px]">{p.name}</span>
                <Button variant="ghost" size="icon" aria-label={`แก้ ${p.name}`} onClick={() => setEditing(p)}>
                  <Pencil className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
          <Button variant="outline" className="h-11" onClick={() => setEditing("new")}>
            <Plus className="h-4 w-4" /> เพิ่มรูปแบบใหม่
          </Button>
        </DialogContent>
      </Dialog>
      <POSProfileModal
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        profile={editing === "new" ? null : editing}
        onSave={onSave}
        onDelete={onDelete}
      />
    </>
  );
}
