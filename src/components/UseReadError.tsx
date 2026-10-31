/** The kitchen's daily-use read failed: days left and daily need are unknown, not 0 (Kitchen Stock, Production) */
export function UseReadError({ onRetry }: { onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-2 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
      <span className="min-w-0 flex-1">โหลดยอดใช้ต่อวันของสาขาไม่สำเร็จ วันคงเหลือและที่ต้องใช้ต่อวันยังไม่ขึ้น (ไม่ใช่ว่าไม่ได้ใช้)</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="min-h-[40px] rounded-full border border-destructive px-4 text-sm font-semibold">
          ลองใหม่
        </button>
      )}
    </div>
  );
}
