import * as React from "react";
import { format } from "date-fns";
import { CalendarIcon, ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export interface DatePickerProps {
  value: Date | undefined;
  onChange: (date: Date | undefined) => void;
  placeholder?: string;
  defaultToday?: boolean;
  minDate?: Date;
  maxDate?: Date;
  align?: "start" | "center" | "end";
  disabled?: boolean;
  className?: string;
  label?: string;
  labelPosition?: "above" | "left";
  required?: boolean;
}

function DatePicker({
  value,
  onChange,
  placeholder = "Select date",
  defaultToday = false,
  minDate,
  maxDate,
  align = "start",
  disabled = false,
  className,
  label,
  labelPosition = "above",
  required = false,
}: DatePickerProps) {
  const initialized = React.useRef(false);

  React.useEffect(() => {
    if (defaultToday && !initialized.current && value === undefined) {
      initialized.current = true;
      const now = new Date();
      onChange(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const trigger = (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          disabled={disabled}
          className={cn(
            "min-w-[200px] justify-start text-left font-normal",
            "border-input focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0",
            !value && "text-muted-foreground",
            className,
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
          <span className="flex-1 truncate">
            {value ? format(value, "d MMM yyyy") : placeholder}
          </span>
          <ChevronDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="z-50 w-auto p-0" align={align}>
        <Calendar
          mode="single"
          selected={value}
          onSelect={(day) => {
            if (!day) { onChange(undefined); return; }
            const normalized = new Date(day.getFullYear(), day.getMonth(), day.getDate());
            onChange(normalized);
          }}
          disabled={(date) => {
            if (minDate && date < minDate) return true;
            if (maxDate && date > maxDate) return true;
            return false;
          }}
          initialFocus
          className="p-3 pointer-events-auto"
        />
      </PopoverContent>
    </Popover>
  );

  if (!label) return trigger;

  const labelEl = (
    <label className="text-sm text-muted-foreground whitespace-nowrap">
      {label}{required && <span className="text-destructive ml-0.5">*</span>}
    </label>
  );

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

DatePicker.displayName = "DatePicker";

export { DatePicker };
