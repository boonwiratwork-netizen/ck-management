import { useState, useMemo, useCallback } from "react";

export type SortDir = "asc" | "desc" | null;

export interface SortState {
  key: string;
  dir: SortDir;
}

export function useSortableTable<T>(
  data: T[],
  comparators: Record<string, (a: T, b: T) => number>,
  initialSortKey?: string,
  initialSortDir?: SortDir,
) {
  const [sortKey, setSortKey] = useState<string | null>(initialSortKey ?? null);
  const [sortDir, setSortDir] = useState<SortDir>(initialSortDir ?? null);

  const handleSort = useCallback(
    (key: string) => {
      if (sortKey !== key) {
        setSortKey(key);
        setSortDir("asc");
      } else if (sortDir === "asc") {
        setSortDir("desc");
      } else {
        setSortKey(null);
        setSortDir(null);
      }
    },
    [sortKey, sortDir],
  );

  const sorted = useMemo(() => {
    if (!sortKey || !sortDir || !comparators[sortKey]) return data;
    const cmp = comparators[sortKey];
    return [...data].sort((a, b) => {
      const result = cmp(a, b);
      return sortDir === "desc" ? -result : result;
    });
  }, [data, sortKey, sortDir, comparators]);

  return { sorted, sortKey, sortDir, handleSort };
}
