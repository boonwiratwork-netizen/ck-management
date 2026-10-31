import { useEffect, useRef, useState } from "react";
import { bangkokDate, followDay } from "@/lib/day-follow";

/**
 * Today's date in Bangkok, kept current on a page left open: checked again when the tab
 * comes back into view and once a minute (the count page's pattern, DailyCount.tsx).
 */
export function useToday(): string {
  const [today, setToday] = useState(() => bangkokDate());
  useEffect(() => {
    const check = () => {
      const now = bangkokDate();
      setToday((t) => (t === now ? t : now));
    };
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    const timer = setInterval(check, 60_000);
    return () => {
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
      clearInterval(timer);
    };
  }, []);
  return today;
}

/**
 * The day a page saves on: today, following it to the next day on a page left open
 * overnight, unless the user picked another day (lib/day-follow.ts). `hold(day)` true keeps
 * the day for now (a bill typed in before midnight still belongs to that day); it moves on
 * once hold says false.
 */
export function useWorkDay(hold?: (day: string) => boolean) {
  const today = useToday();
  const [day, setDay] = useState(today);
  // The today `day` was last compared with
  const seen = useRef(today);
  const holding = seen.current !== today && !!hold?.(day);
  useEffect(() => {
    if (seen.current === today || holding) return;
    const was = seen.current;
    seen.current = today;
    setDay((d) => followDay(d, was, today));
  }, [today, holding]);
  return { day, setDay, today };
}
