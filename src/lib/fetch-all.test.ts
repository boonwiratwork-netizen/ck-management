import { describe, it, expect } from "vitest";
import { fetchAllRows, fetchAllRowsOrThrow } from "./fetch-all";

describe("fetchAllRows", () => {
  it("keeps paging past 1,000 rows", async () => {
    const rows = Array.from({ length: 2345 }, (_, i) => i);
    const res = await fetchAllRows(async (a, b) => ({ data: rows.slice(a, b + 1), error: null }));
    expect(res.data).toHaveLength(2345);
  });
  it("asks for 10,000 at a time and still gets everything from a server that stops at 1,000", async () => {
    const rows = Array.from({ length: 3000 }, (_, i) => i);
    const asked: [number, number][] = [];
    const capped = async (a: number, b: number) => (asked.push([a, b]), { data: rows.slice(a, Math.min(b, a + 999) + 1), error: null });
    expect((await fetchAllRows(capped)).data).toEqual(rows);
    expect(asked[0]).toEqual([0, 9999]);
    // 3 full pages of 1,000, then the empty one that says it's the end
    expect(asked.map((x) => x[0])).toEqual([0, 1000, 2000, 3000]);
  });
  it("one request when everything fits", async () => {
    let calls = 0;
    const rows = Array.from({ length: 4321 }, (_, i) => i);
    expect((await fetchAllRows(async (a, b) => (calls++, { data: rows.slice(a, b + 1), error: null }))).data).toHaveLength(4321);
    expect(calls).toBe(1);
  });
  it("stops and reports an error", async () => {
    const res = await fetchAllRows(async (a) => (a === 0 ? { data: Array(1000).fill(1), error: null } : { data: null, error: "boom" }));
    expect(res.error).toBe("boom");
    expect(res.data).toHaveLength(1000);
  });
  it("OrThrow fails the read when a later page fails (no partial rows)", async () => {
    await expect(fetchAllRowsOrThrow(async (a) => (a === 0 ? { data: Array(1000).fill(1), error: null } : { data: null, error: "boom" }))).rejects.toBe("boom");
    await expect(fetchAllRowsOrThrow(async (a, b) => ({ data: [1, 2, 3].slice(a, b + 1), error: null }))).resolves.toEqual([1, 2, 3]);
  });
});
