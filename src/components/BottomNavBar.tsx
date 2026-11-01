import { Menu } from "lucide-react";
import { cn } from "@/lib/utils";

export interface BottomNavItem {
  key: string;
  label: string;
  icon: React.ElementType;
  /** The middle cell's main job: a raised round button instead of a plain cell */
  featured?: boolean;
}

interface BottomNavBarProps {
  items: BottomNavItem[];
  activeKey: string;
  onSelect: (key: string) => void;
  /** Opens the full menu (sidebar drawer) */
  onMore: () => void;
  className?: string;
}

/**
 * Phone-only bottom bar: the 4 jobs a role does every day + "เมนู" for the rest.
 * Thumb-sized targets (≥56px tall), safe-area aware for installed PWAs.
 */
export function BottomNavBar({ items, activeKey, onSelect, onMore, className }: BottomNavBarProps) {
  const cells = [...items.slice(0, 4)];
  const moreActive = !cells.some((i) => i.key === activeKey);
  return (
    <nav
      aria-label="เมนูลัด"
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 grid border-t border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/85",
        "pb-[env(safe-area-inset-bottom)]",
        className,
      )}
      style={{ gridTemplateColumns: `repeat(${cells.length + 1}, minmax(0, 1fr))` }}
    >
      {cells.map((item) => {
        const active = item.key === activeKey;
        if (item.featured) {
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onSelect(item.key)}
              aria-current={active ? "page" : undefined}
              className={cn("relative flex min-h-[56px] flex-col items-center justify-end gap-1 px-1 pb-1.5 text-[12px] leading-tight", active ? "font-semibold text-foreground" : "text-muted-foreground")}
            >
              {/* Lifted above the bar's top edge, ringed in the bar's own colour so it reads as one piece */}
              <span
                className={cn(
                  "absolute -top-5 flex h-12 w-12 items-center justify-center rounded-full border-4 border-card shadow-md transition-colors",
                  active ? "bg-brand text-brand-foreground" : "bg-brand-soft text-brand",
                )}
                aria-hidden="true"
              >
                <item.icon className="h-[22px] w-[22px]" strokeWidth={2.25} />
              </span>
              {/* The middle cell's name is shown whole (it may run into the cells' padding) */}
              <span className="whitespace-nowrap">{item.label}</span>
            </button>
          );
        }
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => onSelect(item.key)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex min-h-[56px] flex-col items-center justify-center gap-1 px-1 text-[12px] leading-tight transition-colors",
              active ? "font-semibold text-foreground" : "text-muted-foreground",
            )}
          >
            {/* Active: a soft pill behind the icon (no bar on top) */}
            <span className={cn("flex h-7 w-12 items-center justify-center rounded-full transition-colors", active && "bg-brand-soft")} aria-hidden="true">
              <item.icon className={cn("h-[22px] w-[22px]", active && "text-brand")} strokeWidth={active ? 2.25 : 1.75} />
            </span>
            <span className="max-w-full truncate">{item.label}</span>
          </button>
        );
      })}
      <button
        type="button"
        onClick={onMore}
        className={cn(
          "flex min-h-[56px] flex-col items-center justify-center gap-1 px-1 text-[12px] leading-tight",
          moreActive ? "font-semibold text-foreground" : "text-muted-foreground",
        )}
      >
        <span className={cn("flex h-7 w-12 items-center justify-center rounded-full", moreActive && "bg-brand-soft")} aria-hidden="true">
          <Menu className={cn("h-[22px] w-[22px]", moreActive && "text-brand")} strokeWidth={moreActive ? 2.25 : 1.75} />
        </span>
        <span>เมนู</span>
      </button>
    </nav>
  );
}
