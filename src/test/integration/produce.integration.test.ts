import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { FakeNetwork, net, settles } from "./fake-network";

/**
 * Produce "บันทึก" (useProductionData.addRecord → writeProductionMoves → bulk-write), wired
 * as Index wires it: the RM writers come from useKitchenItemStock. Through the real client.
 */
vi.mock("@/integrations/supabase/client", async () => ({ supabase: (await import("./fake-network")).net.client }));
const toasts = vi.hoisted(() => {
  const log: [string, string][] = [];
  const mk = (k: string) => (m: unknown) => void log.push([k, String(m)]);
  return { log, toast: Object.assign(mk("toast"), { success: mk("success"), error: mk("error"), info: mk("info"), warning: mk("warning") }) };
});
vi.mock("sonner", () => ({ toast: toasts.toast }));

import { useProductionData } from "@/hooks/use-production-data";
import { useKitchenItemStock } from "@/hooks/use-kitchen-item-stock";
import type { BOMHeader, BOMLine } from "@/types/bom";
import { WRITE_TIMEOUT_MS } from "@/lib/write-timeout";

const NONE: never[] = [];
const headers: BOMHeader[] = [{ id: "h1", smSkuId: "sm-1", productionType: "CK", bomMode: "simple", batchSize: 1000, yieldPercent: 1 }];
const lines: BOMLine[] = [
  { id: "bl1", bomHeaderId: "h1", rmSkuId: "rm-1", qtyPerBatch: 600, yieldPercent: 1 },
  { id: "bl2", bomHeaderId: "h1", rmSkuId: "sm-base", qtyPerBatch: 400, yieldPercent: 1 },
];

function mount() {
  return renderHook(() => {
    const rm = useKitchenItemStock("RM", NONE, NONE, false);
    return useProductionData(headers, lines, rm.addAdjustment, NONE, false, rm.addAdjustments);
  });
}
const record = { smSkuId: "sm-1", productionDate: "2026-11-01", actualOutputG: 1000 };

beforeEach(() => {
  net.reset();
  toasts.log.length = 0;
  net.seed("skus", [
    { id: "rm-1", type: "RM" },
    { id: "sm-base", type: "SM" },
  ]);
});

describe("Produce save (addRecord)", () => {
  it("saves the record, then takes the ingredients out: RM and SM rows in one insert each", async () => {
    const h = mount();
    const res = await act(() => settles(h.result.current.addRecord(record)));
    expect(res?.stockShort).toEqual([]);
    expect(net.sent("production_plans", "POST")).toHaveLength(1);
    expect(net.sent("production_records", "POST")[0].body).toMatchObject({ sm_sku_id: "sm-1", actual_output_g: 1000, production_date: "2026-11-01" });
    const inserts = net.sent("stock_adjustments", "POST").map((r) => r.body as { sku_id: string; quantity: number; stock_type: string; reason: string }[]);
    expect(inserts).toHaveLength(2);
    const all = inserts.flat();
    expect(all).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sku_id: "rm-1", quantity: -600, stock_type: "RM" }),
        expect.objectContaining({ sku_id: "sm-base", quantity: -400, stock_type: "SM" }),
      ]),
    );
    expect(all.every((r) => r.reason.startsWith("Production:"))).toBe(true);
  });

  const taken = () => net.sent("stock_adjustments", "POST").flatMap((r) => r.body as { sku_id: string; quantity: number }[]).map((r) => [r.sku_id, r.quantity]).sort();

  it("a pot over the recipe (1,100 g of a 1,000 g batch) takes one batch, not 1.1", async () => {
    const h = mount();
    await act(() => settles(h.result.current.addRecord({ ...record, actualOutputG: 1100 })));
    expect(taken()).toEqual([["rm-1", -600], ["sm-base", -400]]);
    expect(net.sent("production_records", "POST")[0].body).toMatchObject({ actual_output_g: 1100, deduct_batches: 1 });
  });

  it("a small batch (100 g, under half the recipe) takes its share, not a whole batch", async () => {
    const h = mount();
    await act(() => settles(h.result.current.addRecord({ ...record, actualOutputG: 100 })));
    expect(taken()).toEqual([["rm-1", -60], ["sm-base", -40]]);
    expect(net.sent("production_records", "POST")[0].body).toMatchObject({ deduct_batches: 0.1 });
  });

  it("batches typed by hand win (1,500 g as 1.5 batches, not 2)", async () => {
    const h = mount();
    await act(() => settles(h.result.current.addRecord({ ...record, actualOutputG: 1500, batches: 1.5 })));
    expect(taken()).toEqual([["rm-1", -900], ["sm-base", -600]]);
  });

  it("before the migration (no deduct_batches column): saved without it, stock still by batches", async () => {
    net.fault({ kind: "refuse", code: "PGRST204", message: "Could not find the 'deduct_batches' column of 'production_records' in the schema cache" }, FakeNetwork.to("production_records", "POST"), true);
    const h = mount();
    const res = await act(() => settles(h.result.current.addRecord({ ...record, actualOutputG: 1100 })));
    expect(res?.stockShort).toEqual([]);
    const posts = net.sent("production_records", "POST");
    expect(posts).toHaveLength(2);
    expect(posts[1].body).not.toHaveProperty("deduct_batches");
    expect(taken()).toEqual([["rm-1", -600], ["sm-base", -400]]);
  });

  it("record insert refused or dropped: settles undefined with a message, takes nothing out", async () => {
    const h = mount();
    net.fault({ kind: "refuse" }, FakeNetwork.to("production_records", "POST"), true);
    expect(await act(() => settles(h.result.current.addRecord(record)))).toBeUndefined();
    net.fault({ kind: "fail" }, FakeNetwork.to("production_records", "POST"), true);
    expect(await act(() => settles(h.result.current.addRecord(record)))).toBeUndefined();
    expect(net.sent("stock_adjustments", "POST")).toHaveLength(0);
    expect(toasts.log.filter((t) => t[0] === "error")).toHaveLength(2);
  });

  it("stock insert refused: tried row by row, the products still out are named (never 'saved')", async () => {
    net.fault({ kind: "refuse" }, FakeNetwork.to("stock_adjustments", "POST"));
    const h = mount();
    const res = await act(() => settles(h.result.current.addRecord(record)));
    expect(res?.stockShort.sort()).toEqual(["rm-1", "sm-base"]);
    // bulk (2) + one-by-one (2)
    expect(net.sent("stock_adjustments", "POST")).toHaveLength(4);
  });

  it("stock insert dropped: not written again (could double), named as not moved", async () => {
    net.fault({ kind: "fail" }, FakeNetwork.to("stock_adjustments", "POST"));
    const h = mount();
    const res = await act(() => settles(h.result.current.addRecord(record)));
    expect(res?.stockShort.sort()).toEqual(["rm-1", "sm-base"]);
    expect(net.sent("stock_adjustments", "POST")).toHaveLength(2);
  });
});

describe("Produce edit / delete of a saved record", () => {
  async function mountLoaded() {
    net.seed("production_records", [{ id: "rec-1", plan_id: "p1", production_date: "2026-11-01", sm_sku_id: "sm-1", batches_produced: 1, actual_output_g: 1000, notes: null, created_at: "2026-11-01T03:00:00Z" }]);
    net.seed("stock_adjustments", [
      { id: "a1", sku_id: "rm-1", quantity: -600, reason: "Production: 1 batches of sm-1 [rec rec-1]" },
      { id: "a2", sku_id: "sm-base", quantity: -400, reason: "Production: 1 batches of sm-1 [rec rec-1]" },
    ]);
    const h = renderHook(() => {
      const rm = useKitchenItemStock("RM", NONE, NONE, false);
      return useProductionData(headers, lines, rm.addAdjustment, NONE, true, rm.addAdjustments);
    });
    await waitFor(() => expect(h.result.current.records).toHaveLength(1));
    net.requests = [];
    return h;
  }
  const edit = { productionDate: "2026-11-01", actualOutputG: 1500 };

  /** supabase-js retries a dropped READ (GET) 3 times, 1 + 2 + 4 s apart, then gives up: run that out */
  async function withRetriesRunOut<T>(work: () => Promise<T>): Promise<T> {
    vi.useFakeTimers();
    try {
      const p = work();
      await act(() => vi.advanceTimersByTimeAsync(10_000));
      return await settles(p);
    } finally {
      vi.useRealTimers();
    }
  }

  const addedNow = () => net.sent("stock_adjustments", "POST").flatMap((r) => r.body as { sku_id: string; quantity: number }[]).map((r) => [r.sku_id, r.quantity]).sort();

  it("output 1000 → 1500 g (rounds to 2 batches): takes out only the difference, one more batch", async () => {
    const h = await mountLoaded();
    expect(await act(() => settles(h.result.current.updateRecordWithDelta("rec-1", edit)))).toEqual({ stockShort: [] });
    expect(addedNow()).toEqual([["rm-1", -600], ["sm-base", -400]]);
    expect(net.tables.production_records[0]).toMatchObject({ actual_output_g: 1500, deduct_batches: 2 });
  });

  it("output 1000 → 1100 g: still one batch, the output is saved and no stock moves", async () => {
    const h = await mountLoaded();
    expect(await act(() => settles(h.result.current.updateRecordWithDelta("rec-1", { productionDate: "2026-11-01", actualOutputG: 1100 })))).toEqual({ stockShort: [] });
    expect(addedNow()).toEqual([]);
    expect(net.tables.production_records[0]).toMatchObject({ actual_output_g: 1100, deduct_batches: 1 });
  });

  it("batches set by hand on an edit (1 → 1.5): takes out the half batch more", async () => {
    const h = await mountLoaded();
    expect(await act(() => settles(h.result.current.updateRecordWithDelta("rec-1", { productionDate: "2026-11-01", actualOutputG: 1000, batches: 1.5 })))).toEqual({ stockShort: [] });
    expect(addedNow()).toEqual([["rm-1", -300], ["sm-base", -200]]);
    expect(net.tables.production_records[0]).toMatchObject({ deduct_batches: 1.5 });
  });

  async function mountWith(rec: Record<string, unknown>, adjs: Record<string, unknown>[]) {
    net.seed("production_records", [{ id: "rec-1", plan_id: "p1", production_date: "2026-11-01", sm_sku_id: "sm-1", batches_produced: 1, notes: null, created_at: "2026-11-01T03:00:00Z", ...rec }]);
    net.seed("stock_adjustments", adjs);
    const h = renderHook(() => {
      const rm = useKitchenItemStock("RM", NONE, NONE, false);
      return useProductionData(headers, lines, rm.addAdjustment, NONE, true, rm.addAdjustments);
    });
    await waitFor(() => expect(h.result.current.records).toHaveLength(1));
    net.requests = [];
    return h;
  }

  it("an old untagged record (whole batch, 1,100 g) moved to another day: the same batch, no extra", async () => {
    const h = await mountWith({ actual_output_g: 1100 }, []);
    expect(await act(() => settles(h.result.current.updateRecordWithDelta("rec-1", { productionDate: "2026-11-02", actualOutputG: 1100 })))).toEqual({ stockShort: [] });
    const rows = net.sent("stock_adjustments", "POST").flatMap((r) => r.body as { sku_id: string; quantity: number; adjustment_date: string }[]);
    const net1 = (d: string) => rows.filter((r) => r.sku_id === "rm-1" && r.adjustment_date === d).reduce((t, r) => t + r.quantity, 0);
    expect(net1("2026-11-01")).toBeCloseTo(600, 6);
    expect(net1("2026-11-02")).toBeCloseTo(-600, 6);
    expect(net.tables.production_records[0]).toMatchObject({ deduct_batches: 1 });
  });

  it("a record saved before the column (reason says 1 batch for 1,100 g): 1,100 → 1,200 g moves nothing", async () => {
    const h = await mountWith({ actual_output_g: 1100 }, [
      { id: "a1", sku_id: "rm-1", quantity: -600, reason: "Production: 1 batches of sm-1 [rec rec-1]", created_at: "2026-11-01T03:00:01Z" },
      { id: "a2", sku_id: "sm-base", quantity: -400, reason: "Production: 1 batches of sm-1 [rec rec-1]", created_at: "2026-11-01T03:00:01Z" },
    ]);
    expect(await act(() => settles(h.result.current.updateRecordWithDelta("rec-1", { productionDate: "2026-11-01", actualOutputG: 1200 })))).toEqual({ stockShort: [] });
    expect(addedNow()).toEqual([]);
  });

  it("a record of the exact-share days (1.1 batches for 1,100 g): an output edit brings it to 1 batch", async () => {
    const h = await mountWith({ actual_output_g: 1100 }, [
      { id: "a1", sku_id: "rm-1", quantity: -660, reason: "Production: 1.10 batches of sm-1 [rec rec-1]", created_at: "2026-11-01T03:00:01Z" },
      { id: "a2", sku_id: "sm-base", quantity: -440, reason: "Production: 1.10 batches of sm-1 [rec rec-1]", created_at: "2026-11-01T03:00:01Z" },
    ]);
    expect(await act(() => settles(h.result.current.updateRecordWithDelta("rec-1", { productionDate: "2026-11-01", actualOutputG: 1050 })))).toEqual({ stockShort: [] });
    const got = addedNow() as [string, number][];
    expect(got.map(([k]) => k)).toEqual(["rm-1", "sm-base"]);
    expect(got[0][1]).toBeCloseTo(60, 6);
    expect(got[1][1]).toBeCloseTo(40, 6);
  });

  it("a note-only edit of an older record moves nothing (not re-read by the new rule)", async () => {
    const h = await mountLoaded();
    expect(await act(() => settles(h.result.current.updateRecordWithDelta("rec-1", { productionDate: "2026-11-01", actualOutputG: 1000, notes: "ok" })))).toEqual({ stockShort: [] });
    expect(net.sent("stock_adjustments", "POST")).toHaveLength(0);
    expect(net.tables.production_records[0].deduct_batches ?? null).toBeNull();
  });

  for (const fault of [{ kind: "refuse" }, { kind: "fail" }] as const) {
    it(`what's out can't be read (${fault.kind}): the edit stops, record unchanged, nothing written`, async () => {
      const h = await mountLoaded();
      net.fault(fault, FakeNetwork.to("stock_adjustments", "GET"));
      expect(await withRetriesRunOut(() => h.result.current.updateRecordWithDelta("rec-1", edit))).toBe(false);
      expect(net.writes).toEqual([]);
      expect(net.tables.production_records[0].actual_output_g).toBe(1000);
      expect(toasts.log).toContainEqual(["error", expect.stringContaining("ยังไม่ได้แก้")]);
    });
  }

  it("the recipe's types can't be read: the edit stops (SM would go out as RM)", async () => {
    const h = await mountLoaded();
    net.fault({ kind: "refuse" }, FakeNetwork.to("skus", "GET"));
    expect(await act(() => settles(h.result.current.updateRecordWithDelta("rec-1", edit)))).toBe(false);
    expect(net.writes).toEqual([]);
  });

  it("the read stalls: the time limit stops the edit, nothing written", async () => {
    const h = await mountLoaded();
    net.fault({ kind: "stall" }, FakeNetwork.to("stock_adjustments", "GET"));
    vi.useFakeTimers();
    try {
      const p = h.result.current.updateRecordWithDelta("rec-1", edit);
      await act(() => vi.advanceTimersByTimeAsync(WRITE_TIMEOUT_MS + 1000));
      expect(await settles(p)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
    expect(net.writes).toEqual([]);
    expect(toasts.log).toContainEqual(["error", expect.stringContaining("ยังไม่ได้แก้")]);
  });

  it("delete: a failed read stops it (nothing deleted, nothing given back by a guess)", async () => {
    const h = await mountLoaded();
    net.fault({ kind: "fail" }, FakeNetwork.to("stock_adjustments", "GET"));
    expect(await withRetriesRunOut(() => h.result.current.deleteRecord("rec-1"))).toBe(false);
    expect(net.writes).toEqual([]);
    expect(net.tables.production_records).toHaveLength(1);
  });

  it("new record whose recipe can't be read: saved, every ingredient named as not moved, no guessed deduction", async () => {
    net.fault({ kind: "refuse" }, FakeNetwork.to("skus", "GET"));
    const h = mount();
    const res = await act(() => settles(h.result.current.addRecord(record)));
    expect(res?.stockShort.sort()).toEqual(["rm-1", "sm-base"]);
    expect(net.sent("stock_adjustments", "POST")).toHaveLength(0);
  });
});
