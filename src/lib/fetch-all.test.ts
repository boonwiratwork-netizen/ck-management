import { describe, it, expect } from "vitest";
import { fetchAllRows, fetchAllRowsOrThrow } from "./fetch-all";

describe("fetchAllRows", () => {
  it("keeps paging past 1,000 rows", async () => {
    const rows = Array.from({ length: 2345 }, (_, i) => i);
    const res = await fetchAllRows(async (a, b) => ({ data: rows.slice(a, b + 1), error: null }));
    expect(res.data).toHaveLength(2345);
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
