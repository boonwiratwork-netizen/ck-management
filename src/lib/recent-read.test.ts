import { describe, expect, it, vi } from "vitest";
import { recentRead, startRead, type RecentSlot } from "./recent-read";

describe("a read reused for a moment", () => {
  it("same key within the age: the same read; later, another key or after a failure: a new one", async () => {
    const slot: RecentSlot<number> = { current: null };
    const start = vi.fn(() => Promise.resolve(7));
    const a = startRead(slot, "b1|2026-10-31", start, 1_000);
    expect(recentRead(slot, "b1|2026-10-31", 120_000, start, 60_000)).toBe(a);
    expect(start).toHaveBeenCalledTimes(1);
    // Too old, or another branch/day: read again
    recentRead(slot, "b1|2026-10-31", 120_000, start, 200_000);
    recentRead(slot, "b2|2026-10-31", 120_000, start, 200_001);
    expect(start).toHaveBeenCalledTimes(3);

    const failing = vi.fn(() => Promise.reject(new Error("network")));
    const bad = startRead(slot, "b3|2026-10-31", failing, 0);
    await expect(bad).rejects.toThrow("network");
    expect(slot.current).toBeNull();
    recentRead(slot, "b3|2026-10-31", 120_000, start, 1);
    expect(start).toHaveBeenCalledTimes(4);
  });
});
