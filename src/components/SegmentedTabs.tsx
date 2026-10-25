import { cn } from "@/lib/utils";

interface SegmentedTabsProps<T extends string> {
  tabs: { key: T; label: string }[];
  value: T;
  onChange: (key: T) => void;
  className?: string;
}

/**
 * Pill tabs. On a phone they stay on one line and swipe sideways instead of
 * wrapping into a second row.
 */
export function SegmentedTabs<T extends string>({ tabs, value, onChange, className }: SegmentedTabsProps<T>) {
  return (
    <div className={cn("-mx-4 max-w-[100vw] overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:px-0 [&::-webkit-scrollbar]:hidden", className)}>
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
  );
}
