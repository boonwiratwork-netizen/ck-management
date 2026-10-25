import { useEffect, useMemo, useRef, useState } from "react";
import { Minus, Plus, Search, X, Trash2, PencilLine } from "lucide-react";
import type { SKU } from "@/types/sku";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { isPacksMode } from "@/lib/receive-rows";
import { cn } from "@/lib/utils";

export const baht = (n: number, digits = 0) =>
  `฿${n.toLocaleString("th-TH", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

/** "4 ถุง" in pack mode, else "250 ก." — what staff count */
export function packLabel(sku: SKU | undefined, qty: number): string {
  if (!sku) return qty.toLocaleString();
  if (isPacksMode(sku)) return `${Math.round(qty / (sku.packSize || 1)).toLocaleString()} ${sku.packUnit}`;
  return `${qty.toLocaleString()} ${sku.usageUom || sku.purchaseUom || ""}`.trim();
}

/** "1 ถุง = 2,000 ก." for pack-mode SKUs */
export function packHint(sku: SKU | undefined): string {
  if (!sku || !isPacksMode(sku)) return "";
  return `1 ${sku.packUnit} = ${(sku.packSize || 1).toLocaleString()} ${sku.purchaseUom || sku.usageUom || ""}`.trim();
}

/**
 * Count in packs (or usage units when the SKU has no pack): − / number / +.
 * Typing is free; the value is committed on blur or Enter so fast typists aren't
 * re-rendered on every key.
 */
export function PackStepper({
  value,
  onChange,
  step = 1,
  label,
  className,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  label: string;
  className?: string;
}) {
  const [text, setText] = useState(value ? String(value) : "");
  useEffect(() => setText(value ? String(value) : ""), [value]);
  const commit = (raw: string) => {
    const n = Math.max(0, Number(raw.replace(/,/g, "")) || 0);
    if (n !== value) onChange(n);
    else setText(value ? String(value) : "");
  };
  return (
    <div className={cn("flex h-11 shrink-0 items-center overflow-hidden rounded-xl border border-border bg-card", className)}>
      <button type="button" aria-label={`ลด ${label}`} className="flex h-11 w-10 items-center justify-center text-foreground active:bg-secondary" onClick={() => onChange(Math.max(0, +(value - step).toFixed(3)))}>
        <Minus className="h-4 w-4" />
      </button>
      <input
        aria-label={label}
        inputMode="decimal"
        value={text}
        placeholder="0"
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        onFocus={(e) => e.target.select()}
        className="h-11 w-12 border-0 bg-transparent text-center font-mono text-base tabular-nums outline-none"
      />
      <button type="button" aria-label={`เพิ่ม ${label}`} className="flex h-11 w-10 items-center justify-center text-foreground active:bg-secondary" onClick={() => onChange(+(value + step).toFixed(3))}>
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}

/** Search-and-pick a product. Bottom sheet on phones, centred panel on larger screens (plain div, not Sheet). */
export function SkuPicker({
  open,
  title,
  skus,
  initialQuery = "",
  onPick,
  onClose,
}: {
  open: boolean;
  title: string;
  skus: SKU[];
  initialQuery?: string;
  onPick: (sku: SKU) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState(initialQuery);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) {
      setQ(initialQuery);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open, initialQuery]);
  const list = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return skus.filter((s) => words.every((w) => `${s.name} ${s.skuId}`.toLowerCase().includes(w))).slice(0, 80);
  }, [q, skus]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/30 md:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-label={title}
        className="flex max-h-[85dvh] w-full flex-col rounded-t-2xl bg-card shadow-raised md:max-w-lg md:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border p-3">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นชื่อหรือรหัส…" className="h-11 pl-9" aria-label="ค้นสินค้า" />
          </div>
          <button type="button" aria-label="ปิด" onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-xl hover:bg-secondary">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-4 pt-3 text-sm font-semibold">{title}</div>
        <ul className="flex-1 divide-y divide-border overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
          {list.map((s) => (
            <li key={s.id}>
              <button type="button" onClick={() => onPick(s)} className="flex min-h-[52px] w-full items-center gap-3 px-4 py-2 text-left hover:bg-secondary/60">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px]">{s.name}</span>
                  <span className="block text-sm text-muted-foreground">
                    <span className="font-mono">{s.skuId}</span>
                    {packHint(s) && ` · ${packHint(s)}`}
                  </span>
                </span>
              </button>
            </li>
          ))}
          {list.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted-foreground">ไม่พบสินค้า</li>}
        </ul>
      </div>
    </div>
  );
}

/** Optional per-line note: a small link until used, then an inline field */
export function NoteField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(!!value);
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="flex min-h-[36px] items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <PencilLine className="h-4 w-4" /> หมายเหตุ
      </button>
    );
  return (
    <Input
      autoFocus={!value}
      defaultValue={value}
      onBlur={(e) => onChange(e.target.value)}
      placeholder="เช่น ถุงรั่ว 1 แพ็ค"
      className="h-10"
      aria-label="หมายเหตุ"
    />
  );
}

export function RemoveButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Button type="button" variant="ghost" size="icon" className="h-11 w-11 shrink-0 text-muted-foreground hover:text-destructive" aria-label={label} onClick={onClick}>
      <Trash2 className="h-4 w-4" />
    </Button>
  );
}

/** Dark sticky footer: summary + main action (same look as the SaveBar) */
export function ActionFooter({ title, sub, action, onAction, busy, disabled }: { title: React.ReactNode; sub?: React.ReactNode; action: string; onAction: () => void; busy?: boolean; disabled?: boolean }) {
  return (
    <div className="sticky bottom-[calc(64px+env(safe-area-inset-bottom))] z-30 mt-4 md:bottom-4">
      <div className="flex items-center gap-3 rounded-2xl bg-primary py-3 pl-4 pr-3 text-primary-foreground shadow-raised">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold">{title}</div>
          {sub && <div className="truncate text-sm text-primary-foreground/70">{sub}</div>}
        </div>
        <Button variant="brand" className="h-12 min-w-[104px] text-base" loading={busy} disabled={disabled} onClick={onAction}>
          {action}
        </Button>
      </div>
    </div>
  );
}

/**
 * Pack items can carry their real weighed amount (the old page's weight box):
 * 3 bags that weigh 2,600 g are stored as 2,600, not 3 × 1,000.
 */
export function WeightField({ sku, qty, onChange }: { sku: SKU | undefined; qty: number; onChange: (qty: number) => void }) {
  const exact = !!sku && isPacksMode(sku) && qty % (sku.packSize || 1) !== 0;
  const [open, setOpen] = useState(exact);
  if (!sku || !isPacksMode(sku)) return null;
  const unit = sku.purchaseUom || sku.usageUom || "";
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="flex min-h-[36px] items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        ชั่งจริง
      </button>
    );
  return (
    <label className="flex items-center gap-2 text-sm text-muted-foreground">
      ชั่งจริง
      <Input
        inputMode="decimal"
        defaultValue={qty || ""}
        key={qty}
        onBlur={(e) => {
          const v = Math.max(0, Number(e.target.value) || 0);
          if (v > 0 && v !== qty) onChange(v);
        }}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        className="h-10 w-28 text-right font-mono"
        aria-label={`น้ำหนักจริง (${unit})`}
      />
      {unit}
    </label>
  );
}
