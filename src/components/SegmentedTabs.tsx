import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface SegmentedTabsProps<T extends string> {
  tabs: { key: T; label: string }[];
  value: T;
  onChange: (key: T) => void;
  className?: string;
}

/**
 * Pill tabs. On a phone they stay on one line and swipe sideways instead of
 * wrapping. A frosted fade with an arrow sits on any edge that has more tabs
 * behind it, so people can tell the row scrolls; the selected tab scrolls into view.
 */
export function SegmentedTabs<T extends string>({ tabs, value, onChange, className }: SegmentedTabsProps<T>) {
  const scroller = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const left = el.scrollLeft > 4;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
    setEdges((e) => (e.left === left && e.right === right ? e : { left, right }));
  }, []);

  useEffect(() => {
    measure();
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, tabs.length]);

  // Keep the selected tab visible (e.g. after a link opens a later tab)
  useEffect(() => {
    const el = scroller.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    el?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [value]);

  const nudge = (dir: 1 | -1) => scroller.current?.scrollBy({ left: dir * 160, behavior: "smooth" });

  return (
    <div className={cn("relative -mx-4 max-w-[100vw] md:mx-0", className)}>
      <div
        ref={scroller}
        onScroll={measure}
        className="overflow-x-auto px-4 [scrollbar-width:none] md:px-0 [&::-webkit-scrollbar]:hidden"
      >
        <div role="tablist" className="inline-flex flex-nowrap gap-1 rounded-full border border-border bg-card p-1 shadow-card">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={value === t.key}
              onClick={() => onChange(t.key)}
              className={cn(
                "min-h-[40px] shrink-0 whitespace-nowrap rounded-full px-4 text-sm transition-colors md:px-5",
                value === t.key ? "bg-primary font-semibold text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {(["left", "right"] as const).map((side) =>
        edges[side] ? (
          <button
            key={side}
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            onClick={() => nudge(side === "left" ? -1 : 1)}
            className={cn(
              "absolute inset-y-0 flex w-12 items-center bg-background/60 backdrop-blur-md",
              side === "left" ? "left-0 justify-start pl-1" : "right-0 justify-end pr-1",
            )}
            // Frosted glass that fades out toward the tabs
            style={{
              WebkitMaskImage: `linear-gradient(to ${side === "left" ? "right" : "left"}, black 45%, transparent)`,
              maskImage: `linear-gradient(to ${side === "left" ? "right" : "left"}, black 45%, transparent)`,
            }}
          >
            {side === "left" ? <ChevronLeft className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          </button>
        ) : null,
      )}
    </div>
  );
}
