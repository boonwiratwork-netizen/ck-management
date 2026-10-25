import { Menu } from "lucide-react";
import { cn } from "@/lib/utils";

export interface BottomNavItem {
  key: string;
  label: string;
  icon: React.ElementType;
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
            {active && <span className="absolute top-0 h-[3px] w-8 rounded-b-full bg-brand" aria-hidden="true" />}
            <item.icon className={cn("h-[22px] w-[22px]", active && "text-brand")} aria-hidden="true" />
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
        <Menu className="h-[22px] w-[22px]" aria-hidden="true" />
        <span>เมนู</span>
      </button>
    </nav>
  );
}
