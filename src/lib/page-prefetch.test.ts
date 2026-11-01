import { describe, expect, it, vi } from "vitest";
import { prefetchOrder, prefetchPages, shouldSkipPrefetch } from "./page-prefetch";
import type { PageChunk } from "@/pages/page-chunks";

describe("which pages' code is fetched ahead", () => {
  it("a store manager: the phone bar's daily pages first, then the rest of the sidebar, never the open one or a kitchen page", () => {
    const order = prefetchOrder("store_manager", "store");
    expect(order.slice(0, 3)).toEqual(["Receive", "DailyCount", "Request"]);
    expect(order).toEqual(expect.arrayContaining(["Sales", "StoreStock", "FoodCost", "CostCenter"]));
    expect(order).not.toContain("StoreOverview");
    expect(order).not.toContain("Produce");
    expect(order).not.toContain("Transfer");
    expect(new Set(order).size).toBe(order.length);
  });

  it("management gets the kitchen and the branch pages; RM/SM/PK stock is one download", () => {
    const order = prefetchOrder("management", "receipt");
    expect(order.slice(0, 3)).toEqual(["StoreOverview", "CostCenter", "Transfer"]);
    expect(order).toEqual(expect.arrayContaining(["Produce", "KitchenCount", "KitchenStock", "Dashboard", "DailyCount", "Settings"]));
    expect(order).not.toContain("KitchenReceive");
    expect(order.filter((c) => c === "KitchenStock")).toHaveLength(1);
  });

  it("nobody signed in: nothing", () => {
    expect(prefetchOrder(null, null)).toEqual([]);
  });

  it("skips on data saver and 2G", () => {
    expect(shouldSkipPrefetch({ saveData: true })).toBe(true);
    expect(shouldSkipPrefetch({ effectiveType: "2g" })).toBe(true);
    expect(shouldSkipPrefetch({ effectiveType: "slow-2g" })).toBe(true);
    expect(shouldSkipPrefetch({ effectiveType: "4g" })).toBe(false);
    expect(shouldSkipPrefetch(undefined)).toBe(false);
    const load = vi.fn(async () => undefined);
    prefetchPages("store_manager", "store", { load, idle: (run) => (run(), () => undefined), connection: { saveData: true } });
    expect(load).not.toHaveBeenCalled();
  });
});

describe("fetching them", () => {
  /** An idle queue the test runs by hand */
  const manualIdle = () => {
    const waiting: (() => void)[] = [];
    return { idle: (run: () => void) => (waiting.push(run), () => waiting.splice(waiting.indexOf(run), 1)), step: () => waiting.shift()?.(), waiting };
  };
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it("one at a time, each when the browser is idle, until the list is done", async () => {
    const q = manualIdle();
    const loaded: PageChunk[] = [];
    let finish!: (m: unknown) => void;
    const load = vi.fn((c: PageChunk) => {
      loaded.push(c);
      return new Promise<unknown>((r) => (finish = r));
    });
    prefetchPages("store_manager", "store", { load, idle: q.idle, connection: null });
    expect(load).not.toHaveBeenCalled(); // nothing before idle
    q.step();
    expect(loaded).toEqual(["Receive"]);
    expect(q.waiting).toHaveLength(0); // the next waits for this one
    finish({ default: () => null });
    await flush();
    q.step();
    expect(loaded).toEqual(["Receive", "DailyCount"]);
  });

  it("stops when told (sign-out) and after a failed download (a release mid-way: no reload)", async () => {
    const q = manualIdle();
    const flag = window as { __ckPrefetching?: number };
    const before = flag.__ckPrefetching ?? 0;
    const load = vi.fn(async () => {
      throw new Error("chunk gone");
    });
    prefetchPages("store_manager", "store", { load, idle: q.idle, connection: null });
    q.step();
    await flush();
    expect(q.waiting).toHaveLength(0);
    expect(load).toHaveBeenCalledTimes(1);
    // main.tsx's "new version: reload" is held off only while a prefetch runs
    expect(flag.__ckPrefetching).toBe(before);

    const q2 = manualIdle();
    const stop = prefetchPages("store_manager", "store", { load: vi.fn(async () => ({ default: () => null })), idle: q2.idle, connection: null });
    stop();
    expect(q2.waiting).toHaveLength(0);
  });

  it("a module that comes back empty (a swallowed load error) stops it too", async () => {
    const q = manualIdle();
    const load = vi.fn(async () => undefined);
    prefetchPages("store_manager", "store", { load, idle: q.idle, connection: null });
    q.step();
    await flush();
    expect(q.waiting).toHaveLength(0);
    expect(load).toHaveBeenCalledTimes(1);
  });
});
