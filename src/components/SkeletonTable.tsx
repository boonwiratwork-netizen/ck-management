import { Skeleton } from '@/components/ui/skeleton';

interface SkeletonTableProps {
  columns?: number;
  rows?: number;
}

export function SkeletonTable({ columns = 6, rows = 8 }: SkeletonTableProps) {
  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-table-header">
              {Array.from({ length: columns }).map((_, i) => (
                <th key={i} className="px-4 py-3">
                  <Skeleton className="h-3 w-20" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }).map((_, rowIdx) => (
              <tr key={rowIdx} className="border-b border-table-border">
                {Array.from({ length: columns }).map((_, colIdx) => (
                  <td key={colIdx} className="px-4 py-3">
                    <Skeleton className={`h-4 ${colIdx === 0 ? 'w-16' : colIdx === 1 ? 'w-32' : 'w-20'}`} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
