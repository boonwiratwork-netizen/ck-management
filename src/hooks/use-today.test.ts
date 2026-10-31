import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useWorkDay } from "./use-today";

// 23:50 on 31 Oct in Bangkok
const EVENING = new Date("2026-10-31T16:50:00Z");
// 07:30 on 1 Nov in Bangkok, the tablet woken up
const MORNING = new Date("2026-11-01T00:30:00Z");

const wake = () => act(() => {
  vi.setSystemTime(MORNING);
  document.dispatchEvent(new Event("visibilitychange"));
});

describe("a page left open overnight", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(EVENING);
  });
  afterEach(() => vi.useRealTimers());

  it("saves the next morning's work on the new day", () => {
    const { result } = renderHook(() => useWorkDay());
    expect(result.current.day).toBe("2026-10-31");
    wake();
    expect(result.current.today).toBe("2026-11-01");
    expect(result.current.day).toBe("2026-11-01");
  });

  it("moves on by itself within a minute of midnight too", () => {
    const { result } = renderHook(() => useWorkDay());
    act(() => {
      vi.setSystemTime(new Date("2026-10-31T17:00:30Z"));
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current.day).toBe("2026-11-01");
  });

  it("keeps a day the user picked", () => {
    const { result } = renderHook(() => useWorkDay());
    act(() => result.current.setDay("2026-10-29"));
    wake();
    expect(result.current.day).toBe("2026-10-29");
  });

  it("keeps the day while held (a bill typed before midnight), then catches up", () => {
    let typed = true;
    const { result, rerender } = renderHook(() => useWorkDay(() => typed));
    wake();
    expect(result.current.day).toBe("2026-10-31");
    typed = false; // the bill was saved or left
    rerender();
    expect(result.current.day).toBe("2026-11-01");
  });
});
