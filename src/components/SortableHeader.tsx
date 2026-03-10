import { ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import { SortDir } from '@/hooks/use-sortable-table';

interface SortableHeaderProps {
  label: string;
  sortKey: string;
  activeSortKey: string | null;
  sortDir: SortDir;
  onSort: (key: string) => void;
  className?: string;
}

export function SortableHeader({ label, sortKey, activeSortKey, sortDir, onSort, className = '' }: SortableHeaderProps) {
  const isActive = activeSortKey === sortKey;

  return (
    <span
      className={`inline-flex items-center cursor-pointer select-none ${className}`}
      onClick={() => onSort(sortKey)}
    >
      {label}
      {!isActive && <ArrowUpDown className="w-3 h-3 ml-1 opacity-30" />}
      {isActive && sortDir === 'asc' && <ArrowUp className="w-3 h-3 ml-1 text-primary" />}
      {isActive && sortDir === 'desc' && <ArrowDown className="w-3 h-3 ml-1 text-primary" />}
    </span>
  );
}
