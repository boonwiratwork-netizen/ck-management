import { Button } from "@/components/ui/button";

interface SaveBarProps {
  /** Number of rows changed but not saved yet; the bar hides at 0 */
  pending: number;
  saving?: boolean;
  onSave: () => void;
  onDiscard?: () => void;
}

/** Sticky bar that keeps unsaved work visible and one tap away from saving */
export function SaveBar({ pending, saving = false, onSave, onDiscard }: SaveBarProps) {
  if (pending <= 0 && !saving) return null;
  return (
    <div className="sticky bottom-0 z-30 mt-4 flex items-center gap-3 rounded-2xl bg-primary px-4 py-3 text-primary-foreground shadow-raised pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-brand" aria-hidden="true" />
      <span className="flex-1 text-sm font-medium">
        {saving ? "กำลังบันทึก…" : `มี ${pending.toLocaleString()} รายการยังไม่บันทึก`}
      </span>
      {onDiscard && !saving && (
        <Button variant="ghost" size="sm" className="text-primary-foreground hover:bg-white/10 hover:text-primary-foreground" onClick={onDiscard}>
          ยกเลิก
        </Button>
      )}
      <Button variant="brand" size="sm" loading={saving} onClick={onSave}>
        บันทึก
      </Button>
    </div>
  );
}
