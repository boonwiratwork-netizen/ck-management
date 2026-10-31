import { describe, expect, it, vi } from "vitest";
import { bulkResult, writeAllOrEach, writeManyOrEach } from "./bulk-write";

describe("many rows at once, else one by one", () => {
  it("one request when it goes in", async () => {
    const one = vi.fn(async () => true);
    expect(await writeAllOrEach([1, 2, 3], async () => "ok", one)).toEqual([]);
    expect(one).not.toHaveBeenCalled();
  });

  it("refused → each row on its own; the ones that still fail come back (a partial save is reported)", async () => {
    const one = vi.fn(async (n: number) => n !== 2);
    expect(await writeAllOrEach([1, 2, 3], async () => "none", one)).toEqual([2]);
    expect(one).toHaveBeenCalledTimes(3);
    // A thrown row write counts as not in
    expect(await writeAllOrEach([1, 2], async () => "none", async (n) => (n === 1 ? Promise.reject(new Error("x")) : true))).toEqual([1]);
    // A thrown bulk write may have landed: not retried, all reported
    const again = vi.fn(async () => true);
    expect(await writeAllOrEach([1, 2], async () => Promise.reject(new Error("network")), again)).toEqual([1, 2]);
    expect(again).not.toHaveBeenCalled();
  });

  it("an answer short of rows is not written again (it could double them): all reported", async () => {
    const one = vi.fn(async () => true);
    expect(await writeAllOrEach(["a", "b"], async () => "unknown", one)).toEqual(["a", "b"]);
    expect(one).not.toHaveBeenCalled();
    expect(await writeAllOrEach([], async () => "none", one)).toEqual([]);
  });

  it("reads an insert's answer", () => {
    expect(bulkResult(2, { data: [{}, {}], error: null })).toBe("ok");
    expect(bulkResult(2, { data: null, error: { message: "x" }, status: 400 })).toBe("none");
    // No answer (dropped connection): may have landed, never retried row by row
    expect(bulkResult(2, { data: null, error: { message: "Failed to fetch" }, status: 0 })).toBe("unknown");
    expect(bulkResult(2, { data: null, error: { message: "x" } })).toBe("unknown");
    expect(bulkResult(2, { data: [{}], error: null })).toBe("unknown");
  });
});

describe("a finished kitchen count's adjustments", () => {
  it("one insert; refused → row by row; still failing → returned (the count says partial, not done)", async () => {
    const adjs = [{ skuId: "garlic" }, { skuId: "salt" }, { skuId: "box" }];
    const one = vi.fn(async (a: { skuId: string }) => a.skuId !== "salt");
    expect(await writeManyOrEach(adjs, async () => "ok", one)).toEqual([]);
    expect(await writeManyOrEach(adjs, async () => "none", one)).toEqual([{ skuId: "salt" }]);
    expect(one).toHaveBeenCalledTimes(3);
  });

  it("without a many-rows writer: one after another; a writer that returns nothing counts as in", async () => {
    const order: string[] = [];
    const missing = await writeManyOrEach([{ skuId: "a" }, { skuId: "b" }, { skuId: "c" }], undefined, async (a) => {
      order.push(a.skuId);
      if (a.skuId === "b") return false;
      if (a.skuId === "c") throw new Error("network");
    });
    expect(order).toEqual(["a", "b", "c"]);
    expect(missing).toEqual([{ skuId: "b" }, { skuId: "c" }]);
  });
});
