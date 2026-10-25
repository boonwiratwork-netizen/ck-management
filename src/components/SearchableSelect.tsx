import { useState, useRef, useEffect, useMemo, useCallback, useDeferredValue } from 'react';
import { createPortal } from 'react-dom';
import { Input } from '@/components/ui/input';
import { Check, ChevronsUpDown, Search } from 'lucide-react';
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

// Fixed row height lets the list render only the rows in view, so
// opening a dropdown with thousands of SKUs stays instant.
const ROW_H = 36;
const LIST_H = 288;
const OVERSCAN = 6;

export function SearchableSelect({
  value,
  onValueChange,
  options,
  placeholder = 'เลือก…',
  className,
  triggerClassName,
  disabled = false,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [active, setActive] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; up: boolean }>({ top: 0, left: 0, width: 260, up: false });
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selected = options.find(o => o.value === value);

  // Every word must appear in the label or sublabel ("ทาเระ โชยุ", "RM-0018")
  const matchOptions = useCallback((text: string) => {
    const words = text.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return options;
    return options.filter(o => {
      if (o.isGroupHeader) return false;
      const hay = `${o.label} ${o.sublabel ?? ''}`.toLowerCase();
      return words.every(w => hay.includes(w));
    });
  }, [options]);
  const filtered = useMemo(() => matchOptions(deferredSearch), [matchOptions, deferredSearch]);

  const selectable = useCallback((i: number) => !!filtered[i] && !filtered[i].isGroupHeader, [filtered]);

  const close = useCallback(() => {
    setOpen(false);
    setSearch('');
    triggerRef.current?.focus();
  }, []);

  const choose = useCallback((o: Option) => {
    onValueChange(o.value);
    close();
  }, [onValueChange, close]);

  const updatePosition = useCallback(() => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const need = LIST_H + 64;
      // Open upwards when there isn't room below (e.g. last rows, sticky save bar)
      const up = window.innerHeight - rect.bottom < need && rect.top > need;
      setPos({
        top: up ? rect.top + window.scrollY - 4 : rect.bottom + window.scrollY + 4,
        left: rect.left + window.scrollX,
        width: Math.max(rect.width, 260),
        up,
      });
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    // preventScroll: the panel is positioned in the same frame, so focusing must not jump the page
    inputRef.current?.focus({ preventScroll: true });
    // Start on the selected item so it is visible right away
    const idx = Math.max(0, options.findIndex(o => o.value === value));
    setActive(idx);
    const top = Math.max(0, idx * ROW_H - LIST_H / 2);
    setScrollTop(top);
    requestAnimationFrame(() => { if (listRef.current) listRef.current.scrollTop = top; });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setActive(0);
    setScrollTop(0);
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [deferredSearch]);

  useEffect(() => {
    if (!open) return;
    const handleScroll = () => updatePosition();
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
        setSearch('');
      }
    }
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const moveActive = (dir: 1 | -1) => {
    let i = active;
    for (let step = 0; step < filtered.length; step++) {
      i = Math.min(filtered.length - 1, Math.max(0, i + dir));
      if (selectable(i)) break;
    }
    setActive(i);
    const list = listRef.current;
    if (list) {
      if (i * ROW_H < list.scrollTop) list.scrollTop = i * ROW_H;
      else if ((i + 1) * ROW_H > list.scrollTop + LIST_H) list.scrollTop = (i + 1) * ROW_H - LIST_H;
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveActive(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveActive(-1); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      // Typed fast: the drawn list may still be for the previous text, so pick from the current text
      const list = search === deferredSearch ? filtered : matchOptions(search);
      const o = search === deferredSearch ? list[active] : list.find(x => !x.isGroupHeader);
      if (o && !o.isGroupHeader) choose(o);
    } else if (e.key === 'Escape') {
      // Close the list only; don't also cancel the row/form the dropdown sits in
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };

  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const last = Math.min(filtered.length, Math.ceil((scrollTop + LIST_H) / ROW_H) + OVERSCAN);
  const visible = filtered.slice(first, last);

  return (
    <div className={cn('relative', className)}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => { if (!disabled) { if (!open) updatePosition(); setOpen(!open); setSearch(''); } }}
        onKeyDown={e => { if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) { e.preventDefault(); updatePosition(); setOpen(true); } }}
        className={cn(
          'flex min-h-10 items-center justify-between w-full rounded-xl border border-input bg-card px-3 py-2 text-sm ring-offset-background hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors disabled:cursor-not-allowed disabled:opacity-50',
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
          className="z-[9999] rounded-2xl border border-border bg-popover shadow-card"
          style={{ top: pos.top, left: pos.left, width: pos.width, position: 'absolute', transform: pos.up ? 'translateY(-100%)' : undefined }}
          onKeyDown={onKeyDown}
        >
          <div className="relative p-2">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={inputRef}
              placeholder="พิมพ์ชื่อหรือรหัส…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-10 rounded-xl pl-8 text-base md:text-sm"
              aria-label="ค้นหา"
            />
          </div>
          {filtered.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">ไม่พบรายการ</p>
          ) : (
            <div
              ref={listRef}
              role="listbox"
              className="overflow-y-auto px-1 pb-1"
              style={{ maxHeight: LIST_H }}
              onScroll={e => setScrollTop(e.currentTarget.scrollTop)}
            >
              <div style={{ height: filtered.length * ROW_H, position: 'relative' }}>
                {visible.map((o, k) => {
                  const idx = first + k;
                  const style = { position: 'absolute' as const, top: idx * ROW_H, left: 0, right: 0, height: ROW_H };
                  if (o.isGroupHeader) {
                    return (
                      <div
                        key={`group-${idx}-${o.label}`}
                        style={style}
                        className="flex items-end px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground select-none"
                      >
                        {o.label}
                      </div>
                    );
                  }
                  return (
                    <button
                      key={o.value}
                      type="button"
                      role="option"
                      aria-selected={value === o.value}
                      style={style}
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => choose(o)}
                      className={cn(
                        'flex items-center w-full rounded-lg px-2 text-sm cursor-pointer text-left',
                        idx === active && 'bg-secondary',
                        value === o.value && 'font-semibold'
                      )}
                    >
                      <Check className={cn('mr-2 h-4 w-4 shrink-0 text-brand', value === o.value ? 'opacity-100' : 'opacity-0')} />
                      <span className={cn('truncate', o.muted && 'text-muted-foreground')}>{o.label}</span>
                      {o.sublabel && <span className="ml-2 truncate text-xs text-muted-foreground">{o.sublabel}</span>}
                      {o.badge && (
                        <span className="ml-auto shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                          {o.badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
