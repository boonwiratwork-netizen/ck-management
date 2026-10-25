import { beforeEach, describe, expect, it } from "vitest";
import { SaveQueue, type Patch } from "./save-queue";

/** A fake database whose requests finish when the test says so */
function setup() {
  const db: Record<string, Patch> = {};
  const calls: { rowId: string; patch: Patch; resolve: (fail?: string) => void }[] = [];
  const states: Record<string, string | undefined> = {};
  const failures: string[] = [];
  const q = new SaveQueue(
    (rowId, patch) =>
      new Promise((res) =>
        calls.push({
          rowId,
          patch,
          resolve: (fail) => {
            if (!fail) db[rowId] = { ...db[rowId], ...patch };
            res({ error: fail ? { message: fail } : null });
          },
        }),
      ),
    (rowId, s) => (states[rowId] = s),
    (m) => failures.push(m),
  );
  const tick = () => new Promise((r) => setTimeout(r, 0));
  return { db, calls, states, failures, q, tick };
}

describe("count save queue", () => {
  beforeEach(() => localStorage.clear());

  it("a slow earlier save never overwrites a newer edit", async () => {
    const { db, calls, q, tick } = setup();
    const first = q.enqueue("r1", { physical_count: 5 });
    await tick();
    q.enqueue("r1", { physical_count: 50 }); // typed again while 5 is on its way
    expect(calls.length).toBe(1); // never two requests for one product at once
    calls[0].resolve();
    await tick();
    await tick();
    expect(calls.length).toBe(2); // 50 is sent after 5 lands
    expect(calls[1].patch).toEqual({ physical_count: 50 });
    calls[1].resolve();
    await first;
    expect(db.r1).toEqual({ physical_count: 50 });
    expect(q.pending()).toEqual([]);
  });

  it("keeps a value when there is no internet and sends it later", async () => {
    const { db, calls, states, q, tick } = setup();
    const p = q.enqueue("r1", { physical_count: 1950 });
    await tick();
    calls[0].resolve("TypeError: Failed to fetch");
    await p;
    expect(states.r1).toBe("waiting");
    expect(JSON.parse(localStorage.getItem("ck-count-queue")!)).toEqual({ r1: { physical_count: 1950 } });
    const f = q.flush();
    await tick();
    calls[1].resolve();
    expect(await f).toBe(true);
    expect(db.r1).toEqual({ physical_count: 1950 });
    expect(localStorage.getItem("ck-count-queue")).toBeNull();
  });

  it("an error that isn't the internet (expired sign-in) still keeps the value and blocks finishing", async () => {
    const { calls, failures, q, tick } = setup();
    const p = q.enqueue("r1", { physical_count: 7 });
    await tick();
    calls[0].resolve("JWT expired");
    await p;
    expect(failures).toEqual(["JWT expired"]);
    expect(q.isPending("r1")).toBe(true);
    const f = q.flush();
    await tick();
    calls[1].resolve("JWT expired");
    expect(await f).toBe(false); // นับเสร็จ refuses while a count isn't saved
  });

  it("merges waste and count edits for the same product", async () => {
    const { db, calls, q, tick } = setup();
    const p = q.enqueue("r1", { physical_count: 10, variance: 2 });
    await tick();
    calls[0].resolve("Failed to fetch");
    await p;
    q.enqueue("r1", { waste: 3, calculated_balance: 5, variance: 5 });
    await tick();
    calls[1].resolve();
    await tick();
    expect(db.r1).toEqual({ physical_count: 10, waste: 3, calculated_balance: 5, variance: 5 });
  });
});
