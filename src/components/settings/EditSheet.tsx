import { useEffect, useRef } from "react";
import { X } from "lucide-react";

/**
 * The edit panel the settings tabs share: a sheet from the bottom on a phone, a
 * centred panel on a computer (same shape as the Cost Center sheets). Escape or a
 * tap outside closes it; nothing is saved until the sheet's own save button.
 */
export function EditSheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => panel.current?.focus(), []);
  return (
    <div className="fixed inset-0 z-[45] flex items-end justify-center bg-black/30 md:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={panel}
        tabIndex={-1}
        // A confirm dialog opened from inside renders elsewhere in the page: its Escape
        // closes the dialog only, not this sheet
        onKeyDown={(e) => e.key === "Escape" && e.currentTarget.contains(e.target as Node) && onClose()}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90dvh] w-full flex-col gap-4 overflow-y-auto rounded-t-2xl bg-card p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-raised outline-none md:max-w-md md:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-bold">{title}</h2>
          <button type="button" aria-label="ปิด" onClick={onClose} className="-mr-2 -mt-1 flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
        {footer}
      </div>
    </div>
  );
}

/** One labelled field */
export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

/** A row of choice buttons (one or many picked) */
export function Choices<T extends string>({ options, picked, onPick, disabled }: { options: { key: T; label: string }[]; picked: T[]; onPick: (k: T) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = picked.includes(o.key);
        return (
          <button
            key={o.key}
            type="button"
            aria-pressed={on}
            disabled={disabled}
            onClick={() => onPick(o.key)}
            className={on ? "min-h-[44px] rounded-xl border-[1.5px] border-foreground bg-card px-3 text-[15px] font-semibold" : "min-h-[44px] rounded-xl border border-border bg-card px-3 text-[15px] text-muted-foreground hover:text-foreground"}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
