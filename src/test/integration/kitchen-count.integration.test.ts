import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { FakeNetwork, net, settles } from "./fake-network";

/**
 * KitchenCount "นับเสร็จ" (useStockCountData.confirmSession), wired as Index wires it,
 * through the real client: lock the session Draft → Completed, read its lines, write the
 * RM/PK count differences (SM is anchored by the count itself, no adjustment).
 */
vi.mock("@/integrations/supabase/client", async () => ({ supabase: (await import("./fake-network")).net.client }));
const toasts = vi.hoisted(() => {
  const log: [string, string][] = [];
  const mk = (k: string) => (m: unknown) => void log.push([k, String(m)]);
  return { log, toast: Object.assign(mk("toast"), { success: mk("success"), error: mk("error"), info: mk("info"), warning: mk("warning") }) };
});
vi.mock("sonner", () => ({ toast: toasts.toast }));

import { useStockCountData } from "@/hooks/use-stock-count-data";
import { useKitchenItemStock } from "@/hooks/use-kitchen-item-stock";
import { useSmStockData } from "@/hooks/use-sm-stock-data";

const NONE: never[] = [];
const price = () => 0;

async function mount() {
  const h = renderHook(() => {
    const rm = useKitchenItemStock("RM", NONE, NONE, false);
    const pk = useKitchenItemStock("PK", NONE, NONE, false);
    const sm = useSmStockData(NONE, NONE, NONE, NONE, NONE, NONE, NONE, NONE, false);
    return useStockCountData({
      skus: NONE,
      rmStockBalances: NONE,
      smStockBalances: NONE,
      pkStockBalances: NONE,
      addRmAdjustment: rm.addAdjustment,
      addSmAdjustment: sm.addAdjustment,
      addPkAdjustment: pk.addAdjustment,
      addRmAdjustments: rm.addAdjustments,
      addPkAdjustments: pk.addAdjustments,
      getStdUnitPrice: price,
    });
  });
  await waitFor(() => expect(h.result.current.sessions).toHaveLength(1));
  net.requests = [];
  return h;
}

beforeEach(() => {
  net.reset();
  toasts.log.length = 0;
  net.seed("stock_count_sessions", [{ id: "s1", count_date: "2026-10-31", status: "Draft", deleted_at: null, created_at: "2026-10-31T10:00:00Z" }]);
  net.seed("stock_count_lines", [
    { id: "c1", session_id: "s1", sku_id: "rm-1", type: "RM", system_qty: 1000, physical_qty: 900, variance: -100, note: null },
    { id: "c2", session_id: "s1", sku_id: "pk-1", type: "PK", system_qty: 50, physical_qty: 60, variance: 10, note: null },
    { id: "c3", session_id: "s1", sku_id: "sm-1", type: "SM", system_qty: 300, physical_qty: 250, variance: -50, note: null },
  ]);
});

describe("KitchenCount confirm (confirmSession)", () => {
  it("locks the session, writes the RM and PK differences (one insert each), no SM adjustment", async () => {
    const h = await mount();
    expect(await act(() => settles(h.result.current.confirmSession("s1", "before")))).toBe(true);
    const lock = net.sent("stock_count_sessions", "PATCH")[0];
    expect(lock.body).toMatchObject({ status: "Completed", count_timing: "before" });
    expect(lock.query).toMatchObject({ id: ["eq.s1"], status: ["eq.Draft"] });
    const inserts = net.sent("stock_adjustments", "POST").map((r) => r.body as { sku_id: string; quantity: number; stock_type: string; reason: string }[]);
    expect(inserts.flat()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sku_id: "rm-1", quantity: -100, stock_type: "RM", reason: "Stock Count 2026-10-31 [count s1]" }),
        expect.objectContaining({ sku_id: "pk-1", quantity: 10, stock_type: "PK" }),
      ]),
    );
    expect(inserts.flat().some((r) => r.sku_id === "sm-1")).toBe(false);
    expect(h.result.current.sessions[0].status).toBe("Completed");
  });

  it("finished on another device meanwhile (0 rows locked): settles false, writes nothing", async () => {
    const h = await mount();
    // just now: it may still be writing its adjustments, so this press writes none
    Object.assign(net.tables.stock_count_sessions[0], { status: "Completed", completed_at: new Date().toISOString() });
    expect(await act(() => settles(h.result.current.confirmSession("s1", "before")))).toBe(false);
    expect(net.sent("stock_adjustments", "POST")).toHaveLength(0);
  });

  it("lock refused or dropped: settles false with a message", async () => {
    const h = await mount();
    net.fault({ kind: "refuse" }, FakeNetwork.to("stock_count_sessions", "PATCH"), true);
    expect(await act(() => settles(h.result.current.confirmSession("s1", "before")))).toBe(false);
    net.fault({ kind: "fail" }, FakeNetwork.to("stock_count_sessions", "PATCH"), true);
    expect(await act(() => settles(h.result.current.confirmSession("s1", "before")))).toBe(false);
    expect(toasts.log.filter((t) => t[0] === "error")).toHaveLength(2);
    expect(net.sent("stock_adjustments", "POST")).toHaveLength(0);
  });

  it("adjustments refused: finished, but 'partial' with the products named", async () => {
    net.fault({ kind: "refuse" }, FakeNetwork.to("stock_adjustments", "POST"));
    const h = await mount();
    expect(await act(() => settles(h.result.current.confirmSession("s1", "before")))).toBe("partial");
    expect(toasts.log).toContainEqual(["error", expect.stringContaining("ปรับสต๊อกไม่ได้ 2 รายการ")]);
  });

  it("adjustments dropped: 'partial', not written twice", async () => {
    net.fault({ kind: "fail" }, FakeNetwork.to("stock_adjustments", "POST"));
    const h = await mount();
    expect(await act(() => settles(h.result.current.confirmSession("s1", "before")))).toBe("partial");
    expect(net.sent("stock_adjustments", "POST")).toHaveLength(2);
  });
});
