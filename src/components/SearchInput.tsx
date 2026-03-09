import { useState, useRef, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  totalCount?: number;
  filteredCount?: number;
  entityName?: string;
  noResultsMessage?: string;
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'Search...',
  className,
  autoFocus = false,
  totalCount,
  filteredCount,
  entityName = 'items',
  noResultsMessage,
}: SearchInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus();
    }
  }, [autoFocus]);

  const showCount = totalCount !== undefined && filteredCount !== undefined;
  const hasNoResults = showCount && filteredCount === 0 && value.trim().length > 0;

  return (
    <div className={cn('space-y-1', className)}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <Input
          ref={inputRef}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="pl-9 pr-8"
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded-sm hover:bg-muted transition-colors"
          >
            <X className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        )}
      </div>
      {showCount && !hasNoResults && (
        <p className="text-helper text-muted-foreground">
          Showing {filteredCount} of {totalCount} {entityName}
        </p>
      )}
      {hasNoResults && (
        <p className="text-helper text-muted-foreground">
          No results for "{value}" ·{' '}
          <button
            type="button"
            onClick={() => onChange('')}
            className="text-primary hover:underline"
          >
            Clear search
          </button>
        </p>
      )}
    </div>
  );
}
