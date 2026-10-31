import { describe, expect, it } from "vitest";
import { perBranchRows } from "./per-branch";

describe("a read per branch", () => {
  it("asks for every branch at once and joins them; one failed page fails it all", async () => {
    const asked: string[] = [];
    const rows = await perBranchRows(["b1", "b2"], async (id) => {
      asked.push(id);
      return { data: [{ branch_id: id }], error: null };
    });
    expect(asked).toEqual(["b1", "b2"]);
    expect(rows).toEqual([{ branch_id: "b1" }, { branch_id: "b2" }]);
    await expect(perBranchRows(["b1", "b2"], async (id) => (id === "b2" ? { data: null, error: new Error("timeout") } : { data: [{ id }], error: null }))).rejects.toThrow("timeout");
    expect(await perBranchRows([], async () => ({ data: [], error: null }))).toEqual([]);
  });
});
