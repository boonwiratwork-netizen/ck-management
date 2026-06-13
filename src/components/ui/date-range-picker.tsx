import * as React from "react";
import { format, isSameDay, isBefore, startOfDay } from "date-fns";
import { CalendarIcon, ChevronDown, X } from "lucide-react";
import { DateRange } from "react-day-picker";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export interface DateRangePickerProps {
  from: Date | undefined;
  to: Date | undefined;
  onChange: (range: { from: Date | undefined; to: Date | undefined }) => void;
  placeholder?: string;
  align?: "start" | "center" | "end";
  disabled?: boolean;
  className?: string;
  label?: string;
  labelPosition?: "above" | "left";
}

function DateRangePicker({
  from,
  to,
  onChange,
  placeholder = "Select range",
  align = "start",
  disabled = false,
  className,
  label,
  labelPosition = "above",
}: DateRangePickerProps) {
  const [open, setOpen] = React.useState(false);
  // null = no pending; Date = first click anchor
  const [anchor, setAnchor] = React.useState<Date | null>(null);
  const [hover, setHover] = React.useState<Date | null>(null);

  const strip = (d: Date) => startOfDay(d);

  // What the trigger button shows
  const display = React.useMemo(() => {
    if (anchor) {
      const previewEnd = hover && !isBefore(hover, anchor) ? hover : null;
      if (previewEnd) return `${format(anchor, "d MMM yyyy")} – ${format(previewEnd, "d MMM yyyy")}`;
      return `${format(anchor, "d MMM yyyy")} – ...`;
    }
    if (from && to) {
      if (isSameDay(from, to)) return format(from, "d MMM yyyy");
      return `${format(from, "d MMM yyyy")} – ${format(to, "d MMM yyyy")}`;
    }
    if (from) return format(from, "d MMM yyyy");
    return placeholder;
  }, [from, to, anchor, hover, placeholder]);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) { setAnchor(null); setHover(null); }
  };

  // DayPicker v8 mode="range" calls onSelect with the new DateRange every click.
  // We intercept it here and apply our Option-A logic instead.
  const handleSelect = (range: DateRange | undefined) => {
    // DayPicker passes the day that was just clicked as range.to (second click)
    // or range.from (first click when resetting).
    // We bypass DayPicker's internal range logic entirely via anchor state.
    const clicked = range?.to ? strip(range.to) : range?.from ? strip(range.from) : null;
    if (!clicked) return;

    if (!anchor) {
      // First click — set anchor, stay open
      setAnchor(clicked);
      return;
    }

    // Second click
    if (isSameDay(clicked, anchor)) {
      onChange({ from: clicked, to: clicked });         // single day
    } else if (isBefore(clicked, anchor)) {
      onChange({ from: clicked, to: anchor });          // swap
    } else {
      onChange({ from: anchor, to: clicked });          // normal range
    }
    setAnchor(null);
    setHover(null);
    setOpen(false);
  };

  const handleClear = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onChange({ from: undefined, to: undefined });
    setAnchor(null);
    setHover(null);
    setOpen(false);
  };

  // What the Calendar highlights — preview during anchor state, confirmed otherwise
  const calendarSelected: DateRange = anchor
    ? {
        from: anchor,
        to: hover && !isBefore(hover, anchor) ? hover : undefined,
      }
    : { from, to };

  const hasValue = !!(from || to);

  const trigger = (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          disabled={disabled}
          className={cn(
            "h-10 min-w-[260px] max-w-[320px] justify-start text-left font-normal",
            "border-input focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0",
            !from && !anchor && "text-muted-foreground",
            className,
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
          <span className="flex-1 truncate">{display}</span>
          {hasValue && !disabled ? (
            <span
              role="button"
              tabIndex={0}
              aria-label="Clear date range"
              onClick={handleClear}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleClear(e); }}
              onPointerDown={(e) => e.stopPropagation()}
              className="ml-2 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm opacity-60 hover:opacity-100"
            >
              <X className="h-3.5 w-3.5" />
            </span>
          ) : (
            <ChevronDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="z-50 w-auto p-0" align={align}>
        <Calendar
          mode="range"
          selected={calendarSelected}
          onSelect={handleSelect}
          disabled={false}
          numberOfMonths={2}
          initialFocus
          className="p-3 pointer-events-auto"
          onDayMouseEnter={(day) => { if (anchor) setHover(strip(day)); }}
          onDayMouseLeave={() => setHover(null)}
          classNames={{
            day_selected:
              "bg-orange-500 text-white hover:bg-orange-500 hover:text-white focus:bg-orange-500 focus:text-white rounded-full",
            day_range_start:
              "bg-orange-500 text-white hover:bg-orange-500 hover:text-white rounded-full",
            day_range_end:
              "bg-orange-500 text-white hover:bg-orange-500 hover:text-white rounded-full",
            day_range_middle:
              "aria-selected:bg-orange-100 aria-selected:text-orange-900 aria-selected:rounded-none",
          }}
        />
      </PopoverContent>
    </Popover>
  );

  if (!label) return trigger;
  const labelEl = <label className="text-sm text-muted-foreground whitespace-nowrap">{label}</label>;
  if (labelPosition === "left") return <div className="flex items-center gap-2">{labelEl}{trigger}</div>;
  return <div className="flex flex-col gap-1">{labelEl}{trigger}</div>;
}

DateRangePicker.displayName = "DateRangePicker";

export { DateRangePicker };
