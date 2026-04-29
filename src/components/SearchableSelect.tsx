import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Input } from '@/components/ui/input';
import { Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Option {
  value: string;
  label: string;
  sublabel?: string;
  /** Render this entry as a non-selectable group header */
  isGroupHeader?: boolean;
  /** Render the option text in muted/gray style */
  muted?: boolean;
  /** Optional badge text to show next to the label */
  badge?: string;
}

interface SearchableSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: Option[];
  placeholder?: string;
  className?: string;
  triggerClassName?: string;
  disabled?: boolean;
}

export function SearchableSelect({
  value,
  onValueChange,
  options,
  placeholder = 'Select...',
  className,
  triggerClassName,
  disabled = false,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [pos, setPos] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 220 });
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selected = options.find(o => o.value === value);

  const filtered = useMemo(() => {
    if (!search) return options;
    const q = search.toLowerCase();
    return options.filter(o =>
      o.isGroupHeader ||
      o.label.toLowerCase().includes(q) ||
      (o.sublabel && o.sublabel.toLowerCase().includes(q))
    );
  }, [options, search]);

  const updatePosition = useCallback(() => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPos({
        top: rect.bottom + window.scrollY + 4,
        left: rect.left + window.scrollX,
        width: Math.max(rect.width, 220),
      });
    }
  }, []);

  useEffect(() => {
    if (open) {
      updatePosition();
      inputRef.current?.focus();
    }
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const handleScroll = () => updatePosition();
    // Listen on capture phase to catch scroll on any ancestor
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleScroll);
    return () => {
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleScroll);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (
        triggerRef.current && !triggerRef.current.contains(target) &&
        dropdownRef.current && !dropdownRef.current.contains(target)
      ) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  return (
    <div className={cn('relative', className)}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => { if (!disabled) { setOpen(!open); setSearch(''); } }}
        className={cn(
          'flex items-center justify-between w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background hover:bg-accent/50 transition-colors disabled:cursor-not-allowed disabled:opacity-50',
          triggerClassName
        )}
      >
        <span className={cn('truncate', !selected && 'text-muted-foreground')}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </button>
      {open && createPortal(
        <div
          ref={dropdownRef}
          className="fixed z-[9999] rounded-md border bg-popover shadow-md"
          style={{ top: pos.top, left: pos.left, width: pos.width, position: 'absolute' }}
        >
          <div className="p-1.5">
            <Input
              ref={inputRef}
              placeholder="Search..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <div className="max-h-[220px] overflow-y-auto p-1">
            {filtered.length === 0 && (
              <p className="py-4 text-center text-xs text-muted-foreground">No results found</p>
            )}
            {filtered.map((o, idx) => {
              if (o.isGroupHeader) {
                return (
                  <div
                    key={`group-${idx}-${o.label}`}
                    className="px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-t mt-1 first:mt-0 first:border-t-0 select-none"
                  >
                    {o.label}
                  </div>
                );
              }
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => { onValueChange(o.value); setOpen(false); setSearch(''); }}
                  className={cn(
                    'flex items-center w-full rounded-sm px-2 py-1.5 text-xs hover:bg-accent cursor-pointer',
                    value === o.value && 'bg-accent'
                  )}
                >
                  <Check className={cn('mr-1.5 h-3 w-3 shrink-0', value === o.value ? 'opacity-100' : 'opacity-0')} />
                  <span className={cn('truncate', o.muted && 'text-muted-foreground')}>{o.label}</span>
                  {o.badge && (
                    <span className="ml-2 shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {o.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
