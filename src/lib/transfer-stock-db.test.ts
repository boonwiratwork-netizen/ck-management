import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The database wrappers against a fake Supabase client: every request is written down and
 * answered by the test, so what is asked (and what a 0-row answer is taken to mean) can be checked.
 */
type Query = { table: string; op: "select" | "update" | "insert" | "delete"; payload?: unknown; filters: [string, string, unknown][]; cols?: string; head?: boolean };
type Answer = { data?: unknown; error?: { code?: string; message?: string } | null; count?: number | null };

const fake = vi.hoisted(() => ({
  calls: [] as Query[],
  answer: (_q: Query): Answer => ({}),
  rpc: (_fn: string, _args: unknown): Answer => ({ error: { code: "PGRST202", message: "Could not find the function" } }),
}));

vi.mock("@/integrations/supabase/client", () => {
  // Every method needs its object as "this", like supabase-js (it reads this.rest, this.url…):
  // a detached call (`const f = supabase.from; f("x")`, `.then(q.eq)`) throws as it would live
  const own = (self: unknown, name: string) => {
    if (!self) throw new TypeError(`Cannot read properties of undefined (reading '${name}')`);
  };
  const builder = (table: string) => {
    const q: Query = { table, op: "select", filters: [] };
    const run = () => {
      fake.calls.push(q);
      const a = fake.answer(q);
      return Promise.resolve({ data: a.data ?? null, error: a.error ?? null, count: a.count ?? null });
    };
    const b = {
      select(cols?: string, opts?: { head?: boolean }) {
        own(this, "select");
        q.cols = cols;
        if (opts?.head) q.head = true;
        return this;
      },
      update(p: unknown) {
        own(this, "update");
        q.op = "update";
        q.payload = p;
        return this;
      },
      insert(p: unknown) {
        own(this, "insert");
        q.op = "insert";
        q.payload = p;
        return this;
      },
      delete() {
        own(this, "delete");
        q.op = "delete";
        return this;
      },
      eq(c: string, v: unknown) {
        own(this, "eq");
        q.filters.push(["eq", c, v]);
        return this;
      },
      is(c: string, v: unknown) {
        own(this, "is");
        q.filters.push(["is", c, v]);
        return this;
      },
      in(c: string, v: unknown) {
        own(this, "in");
        q.filters.push(["in", c, v]);
        return this;
      },
      order() {
        own(this, "order");
        return this;
      },
      maybeSingle() {
        own(this, "maybeSingle");
        return run();
      },
      then(ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) {
        own(this, "then");
        return run().then(ok, bad);
      },
    };
    return b;
  };
  return {
    supabase: {
      from(this: unknown, table: string) {
        own(this, "rest");
        return builder(table);
      },
      // rpc needs its client as "this" like the real one (supabase-js reads this.rest): a detached call throws
      rpc(this: { from?: unknown } | undefined, fn: string, args: unknown) {
        if (!this?.from) throw new TypeError("Cannot read properties of undefined (reading 'rest')");
        return (fake.calls.push({ table: `rpc:${fn}`, op: "select", payload: args, filters: [] }), Promise.resolve({ data: null, error: null, ...fake.rpc(fn, args) }));
      },
    },
  };
});

import { callDbFunction, moveOrder, orderState, releaseClaim, removeDistribution, syncDistribution } from "./transfer-stock-db";

const TO = { id: "8b0c1d2e-0000-4000-8000-000000000001", toNumber: "TO-2026-10-031" };
const filter = (q: Query, col: string) => q.filters.find((f) => f[1] === col)?.[2];

beforeEach(() => {
  fake.calls.length = 0;
  fake.answer = () => ({});
  fake.rpc = () => ({ error: { code: "PGRST202", message: "Could not find the function public.x" } });
});

describe("the fake client", () => {
  it("throws on a detached call, as the real one does (so a lost `this` fails here, not live)", async () => {
    type Loose = { from(t: string): { select(c: string): { eq(c: string, v: unknown): unknown } } };
    const supabase = (await import("@/integrations/supabase/client")).supabase as unknown as Loose;
    const from = supabase.from;
    expect(() => from("transfer_orders")).toThrow(TypeError);
    const eq = supabase.from("transfer_orders").select("id").eq;
    expect(() => eq("id", 1)).toThrow(TypeError);
  });
});

describe("calling the migration's functions", () => {
  it("not installed → the app's own steps; the database refused → not saved; no answer → read back; else the answer", async () => {
    expect(await callDbFunction("receive_transfer_order", {})).toEqual({ kind: "unavailable" });
    fake.rpc = () => ({ error: { code: "22023", message: "การย้ายของต้องบันทึกสองฝั่งเท่ากัน" } });
    expect(await callDbFunction("move_branch_stock", {})).toEqual({ kind: "refused", message: "การย้ายของต้องบันทึกสองฝั่งเท่ากัน" });
    fake.rpc = () => ({ error: { message: "TypeError: Failed to fetch" } });
    expect(await callDbFunction("receive_transfer_order", {})).toEqual({ kind: "unknown", message: "TypeError: Failed to fetch" });
    fake.rpc = () => ({ data: { result: "saved", rows: [] } });
    expect(await callDbFunction("receive_transfer_order", { p_to_id: TO.id })).toEqual({ kind: "answer", value: { result: "saved", rows: [] } });
  });
});

describe("moving an order on (without the function)", () => {
  it("matches only while the order is still where it was; 0 rows is read back, not taken as done", async () => {
    let status = "Sent";
    fake.answer = (q) => (q.op === "update" ? { data: [] } : { data: { status } });
    expect(await moveOrder(TO.id, "Sent", { status: "Received" })).toEqual({ kind: "blocked" }); // row security filtered it
    const upd = fake.calls[0];
    expect(upd.filters).toEqual([["eq", "id", TO.id], ["eq", "status", "Sent"]]);
    status = "Cancelled";
    expect(await moveOrder(TO.id, "Sent", { status: "Received" })).toEqual({ kind: "taken", status: "Cancelled" });
    fake.answer = (q) => (q.op === "update" ? { data: [{ id: TO.id }] } : {});
    expect(await moveOrder(TO.id, "Sent", { status: "Received" })).toEqual({ kind: "ok" });
    fake.answer = () => ({ error: { message: "boom" } });
    expect(await moveOrder(TO.id, "Sent", { status: "Received" })).toEqual({ kind: "error", message: "boom" });
  });

  it("reads status and receipts together", async () => {
    fake.answer = (q) => (q.table === "branch_receipts" ? { count: 4 } : { data: { status: "Sent" } });
    expect(await orderState(TO.id)).toEqual({ status: "Sent", receipts: 4 });
    fake.answer = (q) => (q.table === "branch_receipts" ? { error: { message: "x" } } : { data: { status: "Sent" } });
    expect(await orderState(TO.id)).toBeNull();
  });

  describe("giving a claim back", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());
    it("tries again after an error, stops when the order isn't its to give back", async () => {
      let tries = 0;
      fake.answer = () => (++tries === 1 ? { error: { message: "network" } } : { data: [{ id: TO.id }] });
      const p = releaseClaim(TO.id, "Received");
      await vi.advanceTimersByTimeAsync(400);
      expect(await p).toBe(true);
      expect(tries).toBe(2);
      fake.answer = () => ({ data: [] });
      expect(await releaseClaim(TO.id, "Received")).toBe(false);
    });
  });
});

describe("an order's RM/PK rows", () => {
  it("found by both tags; removed only when every row went (row security can't hide a half removal)", async () => {
    fake.answer = (q) => (q.op === "select" ? { data: filter(q, "reason") === `Distribution: ${TO.toNumber}` ? [{ id: "a1" }, { id: "a2" }] : [] } : { data: [{ id: "a1" }] });
    expect(await removeDistribution(TO)).toBe("บัญชีนี้ไม่มีสิทธิ์คืนสต๊อกครัว");
    expect(fake.calls.filter((q) => q.op === "select").map((q) => filter(q, "reason"))).toEqual([`Distribution: ${TO.toNumber}`, `Distribution: ${TO.id}`]);
    expect(filter(fake.calls.find((q) => q.op === "delete")!, "id")).toEqual(["a1", "a2"]);
    fake.answer = (q) => (q.op === "select" ? { data: filter(q, "reason") === `Distribution: ${TO.toNumber}` ? [{ id: "a1" }, { id: "a2" }] : [] } : { data: [{ id: "a1" }, { id: "a2" }] });
    expect(await removeDistribution(TO)).toBeNull();
    fake.calls.length = 0;
    fake.answer = () => ({ data: [] });
    expect(await removeDistribution(TO)).toBeNull();
    expect(fake.calls.some((q) => q.op === "delete")).toBe(false);
  });

  it("synced by the database function when it is there", async () => {
    fake.rpc = () => ({ data: 1 });
    expect(await syncDistribution({ ...TO, sentAt: "2026-10-29T03:00:00Z" })).toBeNull();
    expect(fake.calls.map((q) => q.table)).toEqual(["rpc:sync_transfer_distribution"]);
    fake.rpc = () => ({ error: { code: "P0001", message: "ใบโอนไม่ได้ส่งอยู่" } });
    expect(await syncDistribution(TO)).toBe("ใบโอนไม่ได้ส่งอยู่");
  });

  it("else here: only the difference, on the day it was sent, and every row must land", async () => {
    fake.answer = (q) => {
      if (q.table === "transfer_order_lines") return { data: [{ sku_id: "garlic", sku_type: "RM", actual_qty: 400 }] };
      if (q.op === "select") return { data: filter(q, "reason") === `Distribution: ${TO.toNumber}` ? [{ id: "r1", sku_id: "garlic", quantity: -500, stock_type: "RM", adjustment_date: "2026-10-31" }] : [] };
      return { data: [{ id: "new" }] };
    };
    // Sent 10:00 on 29 Oct in Bangkok; the rows carry an edit day (31 Oct) from the old edit
    expect(await syncDistribution({ ...TO, sentAt: "2026-10-29T03:00:00Z", deliveryDate: "2026-10-29" })).toBeNull();
    const ins = fake.calls.find((q) => q.op === "insert")!;
    expect(ins.payload).toEqual([{ sku_id: "garlic", quantity: 100, stock_type: "RM", adjustment_date: "2026-10-29", reason: `Distribution: ${TO.toNumber}` }]);
    fake.answer = (q) => (q.table === "transfer_order_lines" ? { data: [{ sku_id: "garlic", sku_type: "RM", actual_qty: 400 }] } : q.op === "select" ? { data: [] } : { data: [] });
    expect(await syncDistribution(TO)).toBe("บันทึกไม่ครบทุกรายการ");
  });
});
