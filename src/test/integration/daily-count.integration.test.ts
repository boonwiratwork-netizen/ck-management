import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { FakeNetwork, net, settles } from "./fake-network";

/**
 * Branch DailyCount through the real client: a typed count saves (the per-row save queue),
 * and "นับเสร็จ" (submitSheet) first flushes every count, then closes the sheet. A count
 * that couldn't be sent keeps "นับเสร็จ" from claiming success, and nothing hangs.
 */
vi.mock("@/integrations/supabase/client", async () => ({ supabase: (await import("./fake-network")).net.client }));
const toasts = vi.hoisted(() => {
  const log: [string, string][] = [];
  const mk = (k: string) => (m: unknown) => void log.push([k, String(m)]);
  return { log, toast: Object.assign(mk("toast"), { success: mk("success"), error: mk("error"), info: mk("info"), warning: mk("warning") }) };
});
vi.mock("sonner", () => ({ toast: toasts.toast }));

import { useDailyStockCount } from "@/hooks/use-daily-stock-count";

const NONE: never[] = [];
const props = { skus: NONE, menuBomLines: NONE, modifierRules: NONE, spBomLines: NONE, menus: NONE, branches: NONE };
const DAY = "2026-11-01";

async function mount() {
  const h = renderHook(() => useDailyStockCount(props));
  await act(() => settles(h.result.current.loadSheet("b-1", DAY)));
  await waitFor(() => expect(h.result.current.rows).toHaveLength(2));
  net.requests = [];
  return h;
}
const countPatches = () => net.sent("daily_stock_counts", "PATCH").filter((r) => "physical_count" in (r.body as object));

beforeEach(() => {
  net.reset();
  toasts.log.length = 0;
  localStorage.clear(); // the save queue keeps unsent counts on the device
  net.seed("daily_stock_counts", [
    { id: "d1", branch_id: "b-1", count_date: DAY, sku_id: "sm-1", opening_balance: 100, received_from_ck: 0, received_external: 0, expected_usage: 0, waste: 0, calculated_balance: 100, physical_count: null, variance: 0, is_submitted: false, created_at: "2026-11-01T01:00:00Z" },
    { id: "d2", branch_id: "b-1", count_date: DAY, sku_id: "sm-2", opening_balance: 50, received_from_ck: 0, received_external: 0, expected_usage: 0, waste: 0, calculated_balance: 50, physical_count: null, variance: 0, is_submitted: false, created_at: "2026-11-01T01:00:01Z" },
  ]);
});
afterEach(() => vi.useRealTimers());

describe("DailyCount save of a count", () => {
  it("a typed count reaches the row (PATCH daily_stock_counts?id=eq.d1) and settles", async () => {
    const h = await mount();
    await act(() => settles(h.result.current.updatePhysicalCount("d1", 80)));
    const p = countPatches();
    expect(p).toHaveLength(1);
    expect(p[0].query).toMatchObject({ id: ["eq.d1"] });
    expect(p[0].body).toMatchObject({ physical_count: 80, variance: -20 });
    expect(net.tables.daily_stock_counts[0].physical_count).toBe(80);
    expect(h.result.current.saveState.d1).toBeUndefined(); // no "saving" left behind
  });

  it("refused or dropped: settles, the count waits on the device (shown as waiting)", async () => {
    const h = await mount();
    net.fault({ kind: "refuse" }, FakeNetwork.to("daily_stock_counts", "PATCH"), true);
    await act(() => settles(h.result.current.updatePhysicalCount("d1", 80)));
    expect(h.result.current.saveState.d1).toBe("waiting");
    net.fault({ kind: "fail" }, FakeNetwork.to("daily_stock_counts", "PATCH"), true);
    await act(() => settles(h.result.current.updatePhysicalCount("d2", 40)));
    expect(h.result.current.saveState.d2).toBe("waiting");
    expect(countPatches()).toHaveLength(2);
  });
});

describe("DailyCount นับเสร็จ (submitSheet)", () => {
  it("closes the sheet: PATCH is_submitted for the branch and day", async () => {
    const h = await mount();
    await act(() => settles(h.result.current.updatePhysicalCount("d1", 80)));
    expect(await act(() => settles(h.result.current.submitSheet("b-1", DAY)))).toBe(true);
    const submit = net.sent("daily_stock_counts", "PATCH").find((r) => (r.body as { is_submitted?: boolean }).is_submitted);
    expect(submit?.query).toMatchObject({ branch_id: ["eq.b-1"], count_date: [`eq.${DAY}`] });
    expect(net.tables.daily_stock_counts.every((r) => r.is_submitted)).toBe(true);
    expect(h.result.current.rows.every((r) => r.isSubmitted)).toBe(true);
  });

  it("a count still unsent is sent first; if it can't be, the sheet is NOT closed", async () => {
    const h = await mount();
    net.fault({ kind: "fail" }, FakeNetwork.to("daily_stock_counts", "PATCH"));
    await act(() => settles(h.result.current.updatePhysicalCount("d1", 80)));
    expect(await act(() => settles(h.result.current.submitSheet("b-1", DAY)))).toBe(false);
    expect(net.tables.daily_stock_counts.some((r) => r.is_submitted)).toBe(false);
    expect(toasts.log).toContainEqual(["error", expect.stringContaining("ยังมียอดนับที่ยังไม่บันทึก")]);
  });

  it("the close itself refused or dropped: settles false with a message", async () => {
    const h = await mount();
    const closing = (r: Parameters<Parameters<typeof net.fault>[1]>[0]) => r.target === "daily_stock_counts" && r.method === "PATCH" && !!(r.body as { is_submitted?: boolean }).is_submitted;
    net.fault({ kind: "refuse" }, closing, true);
    expect(await act(() => settles(h.result.current.submitSheet("b-1", DAY)))).toBe(false);
    net.fault({ kind: "fail" }, closing, true);
    expect(await act(() => settles(h.result.current.submitSheet("b-1", DAY)))).toBe(false);
    expect(toasts.log.filter((t) => t[0] === "error" && t[1].includes("กดนับเสร็จไม่สำเร็จ"))).toHaveLength(2);
  });

  it("a count stuck in flight: นับเสร็จ gives up waiting (~4 s) instead of spinning", async () => {
    const h = await mount();
    net.fault({ kind: "stall" }, FakeNetwork.to("daily_stock_counts", "PATCH"), true);
    vi.useFakeTimers();
    let p!: Promise<boolean>;
    await act(async () => {
      void h.result.current.updatePhysicalCount("d1", 80);
      p = h.result.current.submitSheet("b-1", DAY);
    });
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(net.stalled).toHaveLength(1);
    expect(await settles(p)).toBe(false);
  });
});
