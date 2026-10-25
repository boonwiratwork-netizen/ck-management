import { Button } from "@/components/ui/button";

interface ShowMoreRowsProps {
  shown: number;
  total: number;
  hasMore: boolean;
  onMore: () => void;
  onAll: () => void;
  step?: number;
}

/** Footer under a long list: how many are drawn, and buttons to draw more */
export function ShowMoreRows({ shown, total, hasMore, onMore, onAll, step = 100 }: ShowMoreRowsProps) {
  if (!hasMore) return null;
  return (
    <div className="flex flex-wrap items-center justify-center gap-2 border-t border-border bg-card px-4 py-3">
      <span className="text-sm text-muted-foreground">
        แสดง {shown.toLocaleString()} จาก {total.toLocaleString()} แถว
      </span>
      <Button variant="outline" className="h-10" onClick={onMore}>
        แสดงอีก {Math.min(step, total - shown).toLocaleString()}
      </Button>
      <Button variant="ghost" className="h-10" onClick={onAll}>
        แสดงทั้งหมด
      </Button>
    </div>
  );
}
