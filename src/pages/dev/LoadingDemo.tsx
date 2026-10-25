import { useEffect } from "react";
import { BaseLoadingBar, BasePageSkeleton, useBaseStatus } from "@/components/BaseLoading";
import { loadWithDeviceCopy } from "@/lib/base-cache";

/** Dev-only: the loading bar + first-open skeleton, with a base load that never finishes */
export default function LoadingDemo() {
  const status = useBaseStatus();
  useEffect(() => {
    loadWithDeviceCopy("demo", () => new Promise(() => undefined), () => undefined);
  }, []);
  return (
    <div className="min-h-screen bg-background">
      <div className="h-14 border-b border-border bg-card" />
      <BaseLoadingBar />
      <div className="page-shell">
        <div className="mb-2 text-xs text-muted-foreground">status: {status}</div>
        <BasePageSkeleton />
      </div>
    </div>
  );
}
