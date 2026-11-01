import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeNetwork, net, settles } from "./fake-network";

/**
 * callDbFunction and syncDistribution through the REAL supabase-js client (fake network):
 * the request must reach the network, and every outcome — answer, refusal, dropped
 * connection, no answer at all — must settle.
 */
vi.mock("@/integrations/supabase/client", async () => ({ supabase: (await import("./fake-network")).net.client }));

import { DB_CALL_TIMEOUT_MS, callDbFunction, syncDistribution } from "@/lib/transfer-stock-db";

const FUNCTIONS: [string, Record<string, unknown>][] = [
  ["receive_transfer_order", { p_to_id: "to-1", p_status: "Received", p_rows: [{ sku_id: "s1", qty_received: 5 }] }],
  ["decline_transfer_order", { p_to_id: "to-1", p_reason: "ของเสีย" }],
  ["move_branch_stock", { p_rows: [{ sku_id: "s1", branch_id: "b1", quantity: -3 }, { sku_id: "s1", branch_id: "b2", quantity: 3 }] }],
  ["sync_transfer_distribution", { p_to_id: "to-1" }],
];

beforeEach(() => net.reset());
afterEach(() => vi.useRealTimers());

describe("the real client is what the app gets", () => {
  it("a detached rpc throws before sending — the 31 Oct bug — so this harness would catch it", async () => {
    const detached = net.client.rpc as unknown as (f: string, a: unknown) => PromiseLike<unknown>;
    expect(() => detached("receive_transfer_order", {})).toThrow(/rest/);
    expect(net.requests).toHaveLength(0);
  });
});

describe.each(FUNCTIONS)("callDbFunction(%s)", (fn, args) => {
  it("sends one POST to /rest/v1/rpc/<fn> with the arguments, and returns the answer", async () => {
    net.rpcs[fn] = () => ({ result: "saved", rows: [] });
    const res = await settles(callDbFunction(fn, args));
    expect(res).toEqual({ kind: "answer", value: { result: "saved", rows: [] } });
    expect(net.requests).toHaveLength(1);
    expect(net.requests[0]).toMatchObject({ method: "POST", path: `rest/v1/rpc/${fn}`, rpc: true, body: args, apikey: "dummy-anon-key" });
  });

  it("not installed (PGRST202) = unavailable", async () => {
    const res = await settles(callDbFunction(fn, args));
    expect(res).toEqual({ kind: "unavailable" });
    expect(net.sent(fn, "POST")).toHaveLength(1);
  });

  it("a 4xx refusal settles as refused with the database's message", async () => {
    net.fault({ kind: "refuse", status: 400, code: "P0001", message: "ใบนี้รับไปแล้ว" }, FakeNetwork.to(fn));
    const res = await settles(callDbFunction(fn, args));
    expect(res).toEqual({ kind: "refused", message: "ใบนี้รับไปแล้ว" });
    expect(net.sent(fn)).toHaveLength(1);
  });

  it("a dropped connection (fetch rejects) settles as unknown", async () => {
    net.fault({ kind: "fail" }, FakeNetwork.to(fn));
    const res = await settles(callDbFunction(fn, args));
    expect(res.kind).toBe("unknown");
    expect(net.sent(fn)).toHaveLength(1);
  });

  it("no answer at all settles as unknown once the time limit passes", async () => {
    net.fault({ kind: "stall" }, FakeNetwork.to(fn));
    vi.useFakeTimers();
    const p = callDbFunction(fn, args);
    await vi.advanceTimersByTimeAsync(5000);
    expect(net.stalled).toHaveLength(1); // it did go out
    await vi.advanceTimersByTimeAsync(DB_CALL_TIMEOUT_MS);
    const res = await settles(p);
    expect(res.kind).toBe("unknown");
  });
});

describe("syncDistribution (the kitchen's RM/PK deduction for a sent order)", () => {
  const to = { id: "to-1", toNumber: "TO-2611-001", sentAt: "2026-11-01T03:00:00Z", deliveryDate: "2026-11-01" };

  it("with the database function: one rpc, nothing else", async () => {
    net.rpcs.sync_transfer_distribution = () => 2;
    expect(await settles(syncDistribution(to))).toBeNull();
    expect(net.requests.map((r) => r.target)).toEqual(["sync_transfer_distribution"]);
  });

  it("without it: reads the lines and inserts the deduction rows itself", async () => {
    net.seed("transfer_order_lines", [{ id: "l1", to_id: "to-1", sku_id: "rm-1", sku_type: "RM", actual_qty: 500 }]);
    expect(await settles(syncDistribution(to))).toBeNull();
    const insert = net.sent("stock_adjustments", "POST");
    expect(insert).toHaveLength(1);
    expect(insert[0].body).toEqual([expect.objectContaining({ sku_id: "rm-1", quantity: -500, reason: "Distribution: TO-2611-001" })]);
    expect(insert[0].prefer).toContain("return=representation");
  });

  it("refused insert, dropped connection: an error text, never a hang", async () => {
    net.seed("transfer_order_lines", [{ id: "l1", to_id: "to-1", sku_id: "rm-1", sku_type: "RM", actual_qty: 500 }]);
    net.fault({ kind: "refuse" }, FakeNetwork.to("stock_adjustments", "POST"));
    expect(await settles(syncDistribution(to))).toMatch(/permission denied/);
    net.reset();
    net.fault({ kind: "fail" }, FakeNetwork.to("sync_transfer_distribution"));
    expect(await settles(syncDistribution(to))).toMatch(/Failed to fetch/);
  });
});
