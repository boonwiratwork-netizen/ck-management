import { useEffect, useState } from "react";

/**
 * Draw long lists a page at a time. History tables held every row ever saved
 * (Branch Receipt: ~2,800 rows ≈ 8,500 buttons/tooltips), which made the whole
 * page slow to open and to type in. Totals should still use the full list.
 * Goes back to the first page whenever the list itself changes (new filter/sort).
 */
export function useProgressiveList<T>(items: T[], step = 100) {
  const [limit, setLimit] = useState(step);
  useEffect(() => setLimit(step), [items, step]);
  return {
    visible: items.length > limit ? items.slice(0, limit) : items,
    shown: Math.min(limit, items.length),
    total: items.length,
    hasMore: items.length > limit,
    showMore: () => setLimit((l) => l + step),
    showAll: () => setLimit(items.length),
  };
}
