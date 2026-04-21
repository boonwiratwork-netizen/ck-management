import * as React from "react";
import { format } from "date-fns";
import { CalendarIcon, ChevronDown } from "lucide-react";
import type { DateRange } from "react-day-picker";

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
  const [hoverDate, setHoverDate] = React.useState<Date | undefined>(undefined);

  const display = React.useMemo(() => {
    if (from && to) return `${format(from, "d MMM yyyy")} – ${format(to, "d MMM yyyy")}`;
    if (from) return `${format(from, "d MMM yyyy")} – ...`;
    return placeholder;
  }, [from, to, placeholder]);

  const handleSelect = (range: DateRange | undefined) => {
    const next = {
      from: range?.from ? new Date(range.from.getFullYear(), range.from.getMonth(), range.from.getDate()) : undefined,
      to: range?.to ? new Date(range.to.getFullYear(), range.to.getMonth(), range.to.getDate()) : undefined,
    };
    onChange(next);
    if (next.from && next.to) {
      setOpen(false);
    }
  };

  const trigger = (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          disabled={disabled}
          className={cn(
            "h-10 min-w-[260px] max-w-[320px] justify-start text-left font-normal",
            "border-input focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0",
            !from && "text-muted-foreground",
            className,
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
          <span className="flex-1 truncate">{display}</span>
          <ChevronDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="z-50 w-auto p-0" align={align}>
        <Calendar
          mode="range"
          selected={{ from, to }}
          onSelect={handleSelect}
          numberOfMonths={2}
          initialFocus
          className="p-3 pointer-events-auto"
          modifiers={{
            hoverRange: from && !to && hoverDate && hoverDate > from ? { from: from, to: hoverDate } : false,
          }}
          modifiersClassNames={{
            hoverRange: "bg-primary/15 text-foreground rounded-none",
          }}
          onDayMouseEnter={(day) => setHoverDate(day)}
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
