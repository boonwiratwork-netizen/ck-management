import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Hand, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * A short walkthrough that takes staff through the real work on a page: each
 * step dims the page and rings one part of it (found by its `data-tour` name).
 * "Read" steps explain and wait for ถัดไป; "do" steps wait until the person
 * actually taps the ringed button (or presses Enter in the ringed box), so they
 * learn by doing it once. Shown once per device; the page's "วิธีใช้" replays it.
 */

export interface GuideStep {
  /** `data-tour` value of the part to ring; none = a centred card */
  target?: string;
  title: string;
  body: React.ReactNode;
  /**
   * What moves the guide on: "next" (default) the ถัดไป button, "click" a tap on
   * the ringed part, "enter" Enter (or ถัดไป on a phone keyboard) inside it
   */
  until?: "next" | "click" | "enter";
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

/** How long a step waits for its part to appear (the screen after a tap may still be drawing) */
const WAIT_MS = 2500;

export function GuideTour({ steps, open, onClose }: { steps: GuideStep[]; open: boolean; onClose: () => void }) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [ready, setReady] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) setI(0);
  }, [open]);

  const step = steps[i];
  const doStep = !!step && (step.until === "click" || step.until === "enter");
  const advance = useCallback(() => (i >= steps.length - 1 ? onClose() : setI(i + 1)), [i, steps.length, onClose]);

  const measure = useCallback(() => {
    const el = find(step?.target);
    if (!visible(el)) return setRect(null);
    // Keep the ring on screen (a long list would otherwise ring off the edges)
    const r = el.getBoundingClientRect();
    const top = Math.max(8, r.top);
    const bottom = Math.min(window.innerHeight - 8, r.bottom);
    setRect(new DOMRect(r.left, top, r.width, Math.max(0, bottom - top)));
  }, [step]);

  // Find the step's part, waiting a little for a screen that is still drawing;
  // a part that never shows (it belongs to the other layout) skips the step
  useLayoutEffect(() => {
    if (!open || !step) return;
    setReady(false);
    if (!step.target) {
      setRect(null);
      setReady(true);
      return;
    }
    const started = Date.now();
    let timer = 0;
    const look = () => {
      const el = find(step.target);
      if (visible(el)) {
        el.scrollIntoView({ block: el.getBoundingClientRect().height > window.innerHeight * 0.6 ? "start" : "center", behavior: "instant" as ScrollBehavior });
        measure();
        setReady(true);
        if (step.until !== "enter") cardRef.current?.focus();
        else (el.matches("input") ? el : el.querySelector("input"))?.focus();
      } else if (Date.now() - started < WAIT_MS) timer = window.setTimeout(look, 120);
      else advance();
    };
    look();
    return () => clearTimeout(timer);
  }, [open, step, measure, advance]);

  // "Do" steps: move on when the person taps the part / presses Enter in it
  useEffect(() => {
    if (!open || !ready || !doStep || !step?.target) return;
    const inside = (e: Event) => {
      const el = find(step.target);
      return !!el && el.contains(e.target as Node);
    };
    const onClick = (e: MouseEvent) => {
      // After the page has handled the tap (it may open the next screen)
      if (step.until === "click" && inside(e)) setTimeout(advance, 150);
    };
    const onKey = (e: KeyboardEvent) => {
      if (step.until === "enter" && e.key === "Enter" && inside(e)) setTimeout(advance, 150);
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, ready, doStep, step, advance]);

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

  if (!open || !step || !ready) return null;

  const pad = 6;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cardW = Math.min(360, vw - 32);
  // Card under the ringed part when it fits, else above, else pinned to the bottom
  let cardStyle: React.CSSProperties = { width: cardW, left: (vw - cardW) / 2, top: Math.max(16, vh / 2 - 120) };
  if (rect) {
    const left = Math.min(Math.max(16, rect.left + rect.width / 2 - cardW / 2), vw - cardW - 16);
    const below = rect.bottom + pad + 12;
    const above = rect.top - pad - 12;
    cardStyle =
      below + 220 < vh
        ? { width: cardW, left, top: below }
        : above - 220 > 0
          ? { width: cardW, left, bottom: vh - above }
          : { width: cardW, left: (vw - cardW) / 2, bottom: 16 };
  }
  const last = i === steps.length - 1;

  return createPortal(
    // The container lets taps through; only the dark panels and the card catch them,
    // so on a "do" step the ringed part itself can be tapped
    <div className="pointer-events-none fixed inset-0 z-[90]" aria-live="polite">
      {rect ? (
        <>
          {/* Four dark panels around the part (a huge box-shadow didn't paint everywhere on phones) */}
          {[
            { left: 0, top: 0, width: vw, height: Math.max(0, rect.top - pad) },
            { left: 0, top: rect.bottom + pad, width: vw, height: Math.max(0, vh - rect.bottom - pad) },
            { left: 0, top: rect.top - pad, width: Math.max(0, rect.left - pad), height: rect.height + pad * 2 },
            { left: rect.right + pad, top: rect.top - pad, width: Math.max(0, vw - rect.right - pad), height: rect.height + pad * 2 },
          ].map((s, k) => (
            <div key={k} aria-hidden="true" className="pointer-events-auto fixed bg-[rgba(15,15,20,.55)]" style={s} />
          ))}
          <div
            aria-hidden="true"
            className={cn("fixed rounded-2xl ring-2 ring-brand", doStep ? "pointer-events-none animate-pulse ring-4" : "pointer-events-auto")}
            style={{ left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }}
          />
        </>
      ) : (
        <div aria-hidden="true" className="pointer-events-auto fixed inset-0 bg-[rgba(15,15,20,.55)]" />
      )}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="guide-title"
        tabIndex={-1}
        className="pointer-events-auto fixed flex flex-col gap-3 rounded-2xl bg-card p-4 text-card-foreground shadow-raised outline-none animate-scale-in"
        style={cardStyle}
      >
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold text-brand">
              ขั้นที่ {i + 1} จาก {steps.length}
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
        {doStep && (
          <div className="flex items-center gap-2 rounded-xl bg-brand-soft px-3 py-2 text-sm font-semibold text-brand">
            <Hand className="h-4 w-4 shrink-0" />
            {step.until === "enter" ? "ลองพิมพ์ในช่องที่ไฮไลต์ แล้วกด Enter" : "ลองแตะที่ปุ่มที่ไฮไลต์"}
          </div>
        )}
        <div className="flex items-center gap-2 pt-1">
          <div className="mr-auto flex gap-1" aria-hidden="true">
            {steps.map((_, j) => (
              <span key={j} className={cn("h-1.5 rounded-full transition-all", j === i ? "w-5 bg-brand" : j < i ? "w-1.5 bg-brand/50" : "w-1.5 bg-border")} />
            ))}
          </div>
          {doStep ? (
            <Button variant="ghost" className="h-11" onClick={advance}>
              ข้ามขั้นนี้
            </Button>
          ) : (
            <>
              {i > 0 && (
                <Button variant="ghost" className="h-11" onClick={() => setI(i - 1)}>
                  ย้อนกลับ
                </Button>
              )}
              <Button variant="brand" className="h-11 min-w-[96px]" onClick={advance}>
                {last ? "เข้าใจแล้ว" : "ถัดไป"}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
