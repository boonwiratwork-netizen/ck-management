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
  const from = (table: string) => {
    const q: Query = { table, op: "select", filters: [] };
    const run = () => {
      fake.calls.push(q);
      const a = fake.answer(q);
      return Promise.resolve({ data: a.data ?? null, error: a.error ?? null, count: a.count ?? null });
    };
    const b = {
      select(cols?: string, opts?: { head?: boolean }) {
        q.cols = cols;
        if (opts?.head) q.head = true;
        return b;
      },
      update(p: unknown) {
        q.op = "update";
        q.payload = p;
        return b;
      },
      insert(p: unknown) {
        q.op = "insert";
        q.payload = p;
        return b;
      },
      delete() {
        q.op = "delete";
        return b;
      },
      eq: (c: string, v: unknown) => (q.filters.push(["eq", c, v]), b),
      is: (c: string, v: unknown) => (q.filters.push(["is", c, v]), b),
      in: (c: string, v: unknown) => (q.filters.push(["in", c, v]), b),
      order: () => b,
      maybeSingle: () => run(),
      then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => run().then(ok, bad),
    };
    return b;
  };
  return { supabase: { from, rpc: (fn: string, args: unknown) => (fake.calls.push({ table: `rpc:${fn}`, op: "select", payload: args, filters: [] }), Promise.resolve({ data: null, error: null, ...fake.rpc(fn, args) })) } };
});

import { callTransferFunction, moveOrder, orderState, releaseClaim, removeDistribution, syncDistribution } from "./transfer-stock-db";

const TO = { id: "8b0c1d2e-0000-4000-8000-000000000001", toNumber: "TO-2026-10-031" };
const filter = (q: Query, col: string) => q.filters.find((f) => f[1] === col)?.[2];

beforeEach(() => {
  fake.calls.length = 0;
  fake.answer = () => ({});
  fake.rpc = () => ({ error: { code: "PGRST202", message: "Could not find the function public.x" } });
});

describe("calling the migration's functions", () => {
  it("not installed → the app's own steps; refused or no reply → read the order back; else the answer", async () => {
    expect(await callTransferFunction("receive_transfer_order", {})).toEqual({ kind: "unavailable" });
    fake.rpc = () => ({ error: { message: "TypeError: Failed to fetch" } });
    expect(await callTransferFunction("receive_transfer_order", {})).toEqual({ kind: "unknown", message: "TypeError: Failed to fetch" });
    fake.rpc = () => ({ data: { result: "saved", rows: [] } });
    expect(await callTransferFunction("receive_transfer_order", { p_to_id: TO.id })).toEqual({ kind: "answer", value: { result: "saved", rows: [] } });
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
    fake.rpc = () => ({ error: { message: "ใบโอนไม่ได้ส่งอยู่" } });
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
