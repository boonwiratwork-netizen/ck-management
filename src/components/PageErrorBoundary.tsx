import { Component, type ReactNode } from "react";
import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Catches a page that failed to load or crashed, so the app shows a way out instead of a white
 * screen (no other boundary sits above the pages). Opening another page (`resetKey`) clears it.
 */
export class PageErrorBoundary extends Component<{ resetKey: string; children: ReactNode }, { failed: boolean; key: string }> {
  state = { failed: false, key: this.props.resetKey };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  static getDerivedStateFromProps(props: { resetKey: string }, state: { failed: boolean; key: string }) {
    return props.resetKey !== state.key ? { failed: false, key: props.resetKey } : null;
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="page-shell">
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card p-8 text-center">
          <p className="font-medium">โหลดหน้านี้ไม่สำเร็จ</p>
          <p className="text-sm text-muted-foreground">อาจมีเวอร์ชันใหม่ หรือเน็ตหลุด</p>
          <Button variant="outline" className="h-11" onClick={() => window.location.reload()}>
            <RotateCw className="h-4 w-4" /> โหลดใหม่
          </Button>
        </div>
      </div>
    );
  }
}
