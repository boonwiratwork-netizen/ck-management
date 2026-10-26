import { useCallback, useRef, useState } from "react";

/**
 * Whether an element has at least `minPx` of width — the room it really has, not
 * the screen's. A table sitting next to the side menu and a left panel on a 1280px
 * laptop (or Windows zoom 125–150%) gets ~600px even though the screen counts as
 * "desktop"; tables that switched on screen width squeezed their name column to
 * nothing. Use it to pick table vs cards from the space the table actually gets.
 *
 * Returns a callback ref, so it keeps working when the element comes and goes
 * (an empty list, then rows again).
 */
export function useFitsWidth<T extends HTMLElement = HTMLDivElement>(minPx: number) {
  // First paint before measuring: a fair guess from the screen (the side menu is 256px)
  const [fits, setFits] = useState(() => typeof window !== "undefined" && window.innerWidth - 256 >= minPx);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback(
    (el: T | null) => {
      observer.current?.disconnect();
      observer.current = null;
      if (!el || typeof ResizeObserver === "undefined") return;
      const ro = new ResizeObserver(([entry]) => {
        // A hidden parent reports 0: keep the last answer rather than flip to cards
        if (entry.contentRect.width > 0) setFits(entry.contentRect.width >= minPx);
      });
      ro.observe(el);
      observer.current = ro;
    },
    [minPx],
  );
  return [ref, fits] as const;
}
