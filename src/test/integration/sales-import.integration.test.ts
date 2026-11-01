import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { FakeNetwork, net, settles } from "./fake-network";

/**
 * Sales import save (useSalesData.saveImport → writeDay), what Sales.tsx runs under withBusy,
 * through the real client: rows go in chunks of 50, a failed chunk takes the day's new rows
 * back out, and every outcome settles with the failed day named.
 */
vi.mock("@/integrations/supabase/client", async () => ({ supabase: (await import("./fake-network")).net.client }));
const toasts = vi.hoisted(() => {
  const log: [string, string][] = [];
  const mk = (k: string) => (m: unknown) => void log.push([k, String(m)]);
  return { log, toast: Object.assign(mk("toast"), { success: mk("success"), error: mk("error"), info: mk("info"), warning: mk("warning") }) };
});
vi.mock("sonner", () => ({ toast: toasts.toast }));

import { useSalesData, type ImportWrite } from "@/hooks/use-sales-data";
import type { SalesInsertRow } from "@/lib/sales-import";

const DAY = "2026-10-31";
const row = (i: number): SalesInsertRow => ({ branch_id: "b-1", sale_date: DAY, receipt_no: `R${i}`, menu_code: "MN-001", menu_name: "ข้าวหน้าไก่", order_type: "Dine in", qty: 1, unit_price: 120, net_amount: 120, channel: "" });
const addDay = (n: number): ImportWrite => ({ date: DAY, insert: Array.from({ length: n }, (_, i) => row(i)), update: [], deleteIds: [], kept: 0 });

async function mount() {
  const h = renderHook(() => useSalesData({ branchId: "b-1", from: "2026-10-01", to: "2026-10-31", day: null }));
  await waitFor(() => expect(h.result.current.daysLoading).toBe(false));
  net.requests = [];
  return h;
}

beforeEach(() => {
  net.reset();
  toasts.log.length = 0;
});

describe("sales import save", () => {
  it("60 lines go in as 2 inserts (50 + 10), all counted", async () => {
    const h = await mount();
    expect(await act(() => settles(h.result.current.saveImport([addDay(60)])))).toEqual({ inserted: 60, failedDay: null });
    const inserts = net.sent("sales_entries", "POST");
    expect(inserts.map((r) => (r.body as unknown[]).length)).toEqual([50, 10]);
    expect(inserts[0].prefer).toContain("return=representation");
    expect(net.tables.sales_entries).toHaveLength(60);
  });

  it("replace: deletes the unmatched saved rows and updates the changed ones", async () => {
    net.seed("sales_entries", [{ id: "old-1", ...row(90) }, { id: "old-2", ...row(91) }]);
    const h = await mount();
    const w: ImportWrite = { date: DAY, insert: [row(1)], deleteIds: ["old-1"], update: [{ id: "old-2", patch: { order_type: "Delivery", qty: 2, unit_price: 120, net_amount: 240, channel: "" } }], kept: 0 };
    expect(await act(() => settles(h.result.current.saveImport([w])))).toEqual({ inserted: 2, failedDay: null });
    expect(net.sent("sales_entries", "DELETE")[0].query).toMatchObject({ id: ["in.(old-1)"] });
    expect(net.tables.sales_entries.find((r) => r.id === "old-2")).toMatchObject({ qty: 2, net_amount: 240 });
  });

  it("second chunk refused: the first chunk is taken back out, the day named as failed", async () => {
    const h = await mount();
    let n = 0;
    net.fault({ kind: "refuse", message: "duplicate key value" }, (r) => r.target === "sales_entries" && r.method === "POST" && ++n === 2);
    expect(await act(() => settles(h.result.current.saveImport([addDay(60)])))).toEqual({ inserted: 0, failedDay: DAY });
    expect(net.sent("sales_entries", "DELETE")).toHaveLength(1);
    expect(net.tables.sales_entries).toHaveLength(0);
    expect(toasts.log).toContainEqual(["error", expect.stringContaining("duplicate key value")]);
  });

  it("dropped connection: settles with the day named as failed", async () => {
    net.fault({ kind: "fail" }, FakeNetwork.to("sales_entries", "POST"));
    const h = await mount();
    expect(await act(() => settles(h.result.current.saveImport([addDay(3)])))).toEqual({ inserted: 0, failedDay: DAY });
    expect(net.sent("sales_entries", "POST")).toHaveLength(1);
    expect(toasts.log.filter((t) => t[0] === "error")).toHaveLength(1);
  });
});
