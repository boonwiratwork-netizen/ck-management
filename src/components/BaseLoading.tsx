import { useSyncExternalStore } from "react";
import { baseStatus, subscribeBaseStatus } from "@/lib/base-cache";
import { Skeleton } from "@/components/ui/skeleton";

export const useBaseStatus = () => useSyncExternalStore(subscribeBaseStatus, baseStatus);

/** Thin bar under the header while the latest base data is still coming in */
export function BaseLoadingBar() {
  const status = useBaseStatus();
  if (status === "fresh") return null;
  return (
    <div role="status" aria-label="กำลังโหลดข้อมูลล่าสุด" className="sticky top-0 z-30 h-[3px] w-full overflow-hidden bg-brand/15">
      <div className="h-full w-2/5 animate-load-slide bg-brand" />
    </div>
  );
}

/** Stand-in page for the very first open on this device (nothing saved yet) */
export function BasePageSkeleton() {
  return (
    <div aria-busy="true" aria-label="กำลังโหลด" className="flex flex-col gap-4">
      <div className="text-sm text-muted-foreground">กำลังโหลดข้อมูล ครั้งแรกบนเครื่องนี้อาจใช้เวลาสักครู่</div>
      <Skeleton className="h-8 w-48" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-24 rounded-2xl" />
      </div>
      <Skeleton className="h-11 w-full" />
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} className="h-14 w-full rounded-xl" />
      ))}
    </div>
  );
}
