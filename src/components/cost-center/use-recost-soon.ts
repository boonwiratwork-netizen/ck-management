import { useEffect, useRef } from "react";

/**
 * Several boxes saved in a row → one recost once typing stops (800 ms). Leaving the
 * recipe before the wait is up still recosts: a change is never dropped.
 */
export function useRecostSoon(changedNow: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const pending = useRef<(() => void) | null>(null);
  pending.current = pending.current && changedNow;
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      pending.current?.();
    },
    [],
  );
  return () => {
    clearTimeout(timer.current);
    pending.current = changedNow;
    timer.current = setTimeout(() => {
      pending.current = null;
      changedNow();
    }, 800);
  };
}
