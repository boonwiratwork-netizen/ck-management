import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The small note over a page showing its last-seen data while it reads again
 * (lib/page-cache.ts). If that read fails it says so — the numbers on screen are then
 * the earlier ones, never presented as fresh.
 */
export function RefreshNote({ refreshing, failed, onRetry, className }: { refreshing: boolean; failed?: boolean; onRetry?: () => void; className?: string }) {
  if (failed)
    return (
      <div role="alert" className={cn("flex flex-wrap items-center gap-2 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive", className)}>
        <span className="min-w-0 flex-1">อัปเดตไม่สำเร็จ ตัวเลขที่เห็นเป็นของรอบก่อน อาจไม่ใช่ล่าสุด</span>
        {onRetry && (
          <button type="button" onClick={onRetry} className="min-h-[40px] rounded-full border border-destructive px-4 text-sm font-semibold">
            ลองใหม่
          </button>
        )}
      </div>
    );
  if (!refreshing) return null;
  return (
    <div role="status" className={cn("inline-flex items-center gap-1.5 self-start rounded-full bg-secondary px-3 py-1 text-xs text-muted-foreground", className)}>
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      กำลังอัปเดต…
    </div>
  );
}
