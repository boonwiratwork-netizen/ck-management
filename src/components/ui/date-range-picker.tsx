import * as React from "react";
import { format, isSameDay, isAfter, isBefore, startOfDay } from "date-fns";
import { CalendarIcon, ChevronDown, X } from "lucide-react";

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
  // pendingStart = user clicked first day, waiting for second click
  const [pendingStart, setPendingStart] = React.useState<Date | undefined>(undefined);
  const [hoverDate, setHoverDate] = React.useState<Date | undefined>(undefined);

  const strip = (d: Date) => startOfDay(d);

  // Display text in trigger button
  const display = React.useMemo(() => {
    if (pendingStart) {
      const previewEnd = hoverDate && !isBefore(hoverDate, pendingStart) ? hoverDate : undefined;
      if (previewEnd) {
        return `${format(pendingStart, "d MMM yyyy")} – ${format(previewEnd, "d MMM yyyy")}`;
      }
      return `${format(pendingStart, "d MMM yyyy")} – ...`;
    }
    if (from && to) {
      if (isSameDay(from, to)) return format(from, "d MMM yyyy");
      return `${format(from, "d MMM yyyy")} – ${format(to, "d MMM yyyy")}`;
    }
    if (from) return format(from, "d MMM yyyy");
    return placeholder;
  }, [from, to, pendingStart, hoverDate, placeholder]);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setPendingStart(undefined);
      setHoverDate(undefined);
    }
  };

  // Core click logic: Option A — Smart Single/Range
  const handleDayClick = (day: Date) => {
    const clicked = strip(day);

    if (!pendingStart) {
      // First click — set anchor, wait for second
      setPendingStart(clicked);
      return;
    }

    // Second click
    if (isSameDay(clicked, pendingStart)) {
      // Same day twice → single day
      onChange({ from: clicked, to: clicked });
    } else if (isBefore(clicked, pendingStart)) {
      // Clicked before anchor → swap
      onChange({ from: clicked, to: pendingStart });
    } else {
      // Clicked after anchor → normal range
      onChange({ from: pendingStart, to: clicked });
    }

    setPendingStart(undefined);
    setHoverDate(undefined);
    setOpen(false);
  };

  const handleClear = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onChange({ from: undefined, to: undefined });
    setPendingStart(undefined);
    setHoverDate(undefined);
    setOpen(false);
  };

  // Compute custom modifiers for range highlight using mode="single"
  // We own all the state — DayPicker just renders what we tell it
  const modifiers = React.useMemo(() => {
    const start = pendingStart ?? from;
    const end = pendingStart
      ? (hoverDate && !isBefore(hoverDate, pendingStart) ? hoverDate : undefined)
      : to;

    if (!start) return {};

    return {
      range_start: start,
      range_end: end ?? start,
      range_middle: end && !isSameDay(start, end)
        ? { after: start, before: end }
        : undefined,
    };
  }, [pendingStart, hoverDate, from, to]);

  const modifiersClassNames = {
    range_start: "bg-orange-500 !text-white rounded-full",
    range_end: "bg-orange-500 !text-white rounded-full",
    range_middle: "bg-orange-100 text-orange-900 rounded-none",
  };

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
            !from && !pendingStart && "text-muted-foreground",
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
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") handleClear(e);
              }}
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
          mode="single"
          selected={pendingStart ?? from}
          onSelect={(day) => { if (day) handleDayClick(day); }}
          numberOfMonths={2}
          initialFocus
          className="p-3 pointer-events-auto"
          modifiers={modifiers}
          modifiersClassNames={modifiersClassNames}
          onDayMouseEnter={(day) => { if (pendingStart) setHoverDate(strip(day)); }}
          onDayMouseLeave={() => setHoverDate(undefined)}
        />
      </PopoverContent>
    </Popover>
  );

  if (!label) return trigger;

  const labelEl = <label className="text-sm text-muted-foreground whitespace-nowrap">{label}</label>;

  if (labelPosition === "left") {
    return (
      <div className="flex items-center gap-2">
        {labelEl}
        {trigger}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {labelEl}
      {trigger}
    </div>
  );
}

DateRangePicker.displayName = "DateRangePicker";

export { DateRangePicker };
