import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * A short "what's new" walkthrough shown once per page update: each step dims the
 * page, rings one part of it (found by its `data-tour` name) and explains it in
 * Thai. Steps whose part isn't on screen (e.g. phone vs computer layout) are skipped.
 * Seen-state is per device; the page's "วิธีใช้" button replays it.
 */

export interface GuideStep {
  /** `data-tour` value of the part to ring; none = a centred card */
  target?: string;
  title: string;
  body: React.ReactNode;
}

const seenKey = (id: string) => `ck-guide-${id}`;

export function useGuide(id: string) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let seen = false;
    try {
      seen = !!localStorage.getItem(seenKey(id));
    } catch {
      // storage blocked: show it, just can't remember
    }
    if (seen) return;
    // Let the page draw first so the parts can be found
    const t = setTimeout(() => setOpen(true), 600);
    return () => clearTimeout(t);
  }, [id]);
  const close = useCallback(() => {
    setOpen(false);
    try {
      localStorage.setItem(seenKey(id), new Date().toISOString());
    } catch {
      // fine
    }
  }, [id]);
  return { open, start: () => setOpen(true), close };
}

const visible = (el: Element | null): el is HTMLElement => {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
};
// The same part may exist twice (phone and computer layouts): use the one on screen
const find = (target?: string) => (target ? ([...document.querySelectorAll(`[data-tour="${target}"]`)].find(visible) ?? null) : null);

export function GuideTour({ steps, open, onClose }: { steps: GuideStep[]; open: boolean; onClose: () => void }) {
  const [shown, setShown] = useState<GuideStep[]>([]);
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // Decide the steps when it opens (the layout decides which parts exist)
  useEffect(() => {
    if (!open) return;
    setShown(steps.filter((s) => !s.target || visible(find(s.target))));
    setI(0);
  }, [open, steps]);

  const step = shown[i];
  const measure = useCallback(() => {
    const el = find(step?.target);
    setRect(visible(el) ? el.getBoundingClientRect() : null);
  }, [step]);

  useLayoutEffect(() => {
    if (!open || !step) return;
    const el = find(step.target);
    if (visible(el)) el.scrollIntoView({ block: "center", behavior: "instant" as ScrollBehavior });
    measure();
    cardRef.current?.focus();
  }, [open, step, measure]);

  useEffect(() => {
    if (!open) return;
    let frame = 0;
    const onMove = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, measure, onClose]);

  if (!open || !step) return null;

  const pad = 6;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cardW = Math.min(360, vw - 32);
  // Card under the ringed part when it fits, else above, else centred
  let cardStyle: React.CSSProperties = { width: cardW, left: (vw - cardW) / 2, top: Math.max(16, vh / 2 - 120) };
  if (rect) {
    const left = Math.min(Math.max(16, rect.left + rect.width / 2 - cardW / 2), vw - cardW - 16);
    const below = rect.bottom + pad + 12;
    cardStyle = below + 220 < vh ? { width: cardW, left, top: below } : { width: cardW, left, bottom: Math.max(16, vh - rect.top + pad + 12) };
  }
  const last = i === shown.length - 1;

  return createPortal(
    <div className="fixed inset-0 z-[90]" aria-live="polite">
      {rect ? (
        <>
          {/* Four dark panels around the part (a huge box-shadow didn't paint everywhere on phones) */}
          {[
            { left: 0, top: 0, width: vw, height: Math.max(0, rect.top - pad) },
            { left: 0, top: rect.bottom + pad, width: vw, height: Math.max(0, vh - rect.bottom - pad) },
            { left: 0, top: rect.top - pad, width: Math.max(0, rect.left - pad), height: rect.height + pad * 2 },
            { left: rect.right + pad, top: rect.top - pad, width: Math.max(0, vw - rect.right - pad), height: rect.height + pad * 2 },
          ].map((s, k) => (
            <div key={k} aria-hidden="true" className="fixed bg-[rgba(15,15,20,.55)]" style={s} />
          ))}
          <div
            aria-hidden="true"
            className="pointer-events-none fixed rounded-2xl ring-2 ring-brand"
            style={{ left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }}
          />
        </>
      ) : (
        <div aria-hidden="true" className="fixed inset-0 bg-[rgba(15,15,20,.55)]" />
      )}
      {/* Clicks outside the card do nothing: the page underneath stays as it is */}
      <div className="fixed inset-0" />
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="guide-title"
        tabIndex={-1}
        className="fixed flex flex-col gap-3 rounded-2xl bg-card p-4 text-card-foreground shadow-raised outline-none animate-scale-in"
        style={cardStyle}
      >
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold text-brand">
              {i + 1} / {shown.length}
            </div>
            <h2 id="guide-title" className="text-[17px] font-bold leading-snug">
              {step.title}
            </h2>
          </div>
          <button type="button" aria-label="ปิดคำแนะนำ" onClick={onClose} className="-mr-2 -mt-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="text-[15px] leading-relaxed text-foreground/90">{step.body}</div>
        <div className="flex items-center gap-2 pt-1">
          <div className="mr-auto flex gap-1" aria-hidden="true">
            {shown.map((_, j) => (
              <span key={j} className={cn("h-1.5 rounded-full transition-all", j === i ? "w-5 bg-brand" : "w-1.5 bg-border")} />
            ))}
          </div>
          {i > 0 && (
            <Button variant="ghost" className="h-11" onClick={() => setI(i - 1)}>
              ย้อนกลับ
            </Button>
          )}
          <Button variant="brand" className="h-11 min-w-[96px]" onClick={() => (last ? onClose() : setI(i + 1))}>
            {last ? "เข้าใจแล้ว" : "ถัดไป"}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
