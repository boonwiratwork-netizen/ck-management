import { useEffect, useRef, useCallback } from "react";

/**
 * Silently refreshes data when the user returns to the tab after it has been
 * inactive for longer than `staleAfterMs`.
 *
 * Usage: useVisibilityRefresh([() => someHook.refresh()])
 * Add to any page component that needs auto-refresh on tab focus.
 * Default stale time: 5 minutes.
 */
export function useVisibilityRefresh(
  callbacks: (() => void | Promise<void>)[],
  staleAfterMs: number = 5 * 60 * 1000,
) {
  const lastRefresh = useRef(Date.now());

  const refreshIfStale = useCallback(() => {
    if (Date.now() - lastRefresh.current < staleAfterMs) return;
    lastRefresh.current = Date.now();
    callbacks.forEach((cb) => cb());
  }, [callbacks, staleAfterMs]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") refreshIfStale();
    };
    const onFocus = () => refreshIfStale();

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
    };
  }, [refreshIfStale]);
}
