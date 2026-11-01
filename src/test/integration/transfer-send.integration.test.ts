import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { FakeNetwork, net, settles } from "./fake-network";

/**
 * The kitchen's "ส่ง" on a transfer order (useTransferOrder.sendTO) through the real
 * client: claim Draft → Sent, write each line, take RM/PK out (sync_transfer_distribution
 * or the app's own insert), close the request. Every failure settles with a message.
 */
vi.mock("@/integrations/supabase/client", async () => ({ supabase: (await import("./fake-network")).net.client }));
const toasts = vi.hoisted(() => {
  const log: [string, string][] = [];
  const mk = (k: string) => (m: unknown) => void log.push([k, String(m)]);
  return { log, toast: Object.assign(mk("toast"), { success: mk("success"), error: mk("error"), info: mk("info"), warning: mk("warning") }) };
});
vi.mock("sonner", () => ({ toast: toasts.toast }));

import { useTransferOrder, type TOLine } from "@/hooks/use-transfer-order";

const line = (id: string, skuId: string, qty: number): TOLine => ({ id, skuId, skuCode: skuId, skuName: skuId, plannedQty: qty, actualQty: qty, uom: "g", unitCost: 0.1, lineValue: qty * 0.1, note: "", trLineId: null, packsCount: 2 });
const lines = [line("l1", "sm-1", 1000), line("l2", "rm-1", 500)];

function seedDraft() {
  net.seed("transfer_orders", [{ id: "to-1", to_number: "TO-2611-001", status: "Draft", tr_id: "tr-1", sent_at: null, delivery_date: "2026-11-01" }]);
  net.seed("transfer_order_lines", [
    { id: "l1", to_id: "to-1", sku_id: "sm-1", sku_type: "SM", actual_qty: 0 },
    { id: "l2", to_id: "to-1", sku_id: "rm-1", sku_type: "RM", actual_qty: 0 },
  ]);
  net.seed("transfer_requests", [{ id: "tr-1", status: "Submitted" }]);
}
async function mount() {
  const h = renderHook(() => useTransferOrder());
  await waitFor(() => expect(h.result.current.pendingLoading).toBe(false));
  net.requests = [];
  return h;
}

beforeEach(() => {
  net.reset();
  toasts.log.length = 0;
});

describe("sendTO", () => {
  it("claims the draft, writes every line, runs the distribution, closes the request", async () => {
    seedDraft();
    net.rpcs.sync_transfer_distribution = () => 1;
    const h = await mount();
    const res = await act(() => settles(h.result.current.sendTO("to-1", lines, "หมายเหตุ", "2026-11-01")));
    expect(res).toEqual({});
    const claim = net.sent("transfer_orders", "PATCH")[0];
    expect(claim.body).toMatchObject({ status: "Sent", total_value: 150, notes: "หมายเหตุ" });
    expect(claim.query).toMatchObject({ id: ["eq.to-1"], status: ["eq.Draft"] });
    expect(net.sent("transfer_order_lines", "PATCH")).toHaveLength(2);
    expect(net.tables.transfer_order_lines.map((l) => l.actual_qty)).toEqual([1000, 500]);
    expect(net.sent("sync_transfer_distribution", "POST")[0].body).toEqual({ p_to_id: "to-1" });
    expect(net.tables.transfer_requests[0].status).toBe("Fulfilled");
    expect(toasts.log).toEqual([]);
  });

  it("without the database function: the RM line's deduction is inserted by the app", async () => {
    seedDraft();
    const h = await mount();
    expect(await act(() => settles(h.result.current.sendTO("to-1", lines)))).toEqual({});
    const insert = net.sent("stock_adjustments", "POST");
    expect(insert).toHaveLength(1);
    expect(insert[0].body).toEqual([expect.objectContaining({ sku_id: "rm-1", quantity: -500, reason: "Distribution: TO-2611-001" })]);
  });

  it("already sent elsewhere (0 rows claimed): settles with a message, writes no lines", async () => {
    seedDraft();
    net.tables.transfer_orders[0].status = "Sent";
    const h = await mount();
    expect(await act(() => settles(h.result.current.sendTO("to-1", lines)))).toEqual({ error: "ใบนี้ถูกส่งไปแล้ว" });
    expect(net.sent("transfer_order_lines", "PATCH")).toHaveLength(0);
  });

  it("claim refused or dropped: settles with the error", async () => {
    seedDraft();
    const h = await mount();
    net.fault({ kind: "refuse", message: "permission denied for table transfer_orders" }, FakeNetwork.to("transfer_orders", "PATCH"), true);
    expect((await act(() => settles(h.result.current.sendTO("to-1", lines)))).error).toMatch(/permission denied/);
    // Dropped: read back — still a Draft, so it says not sent
    net.fault({ kind: "fail" }, FakeNetwork.to("transfer_orders", "PATCH"), true);
    expect((await act(() => settles(h.result.current.sendTO("to-1", lines)))).error).toMatch(/ยังไม่ได้ส่ง/);
  });

  it("a line refused: the order goes back to Draft, nothing taken out", async () => {
    seedDraft();
    const h = await mount();
    net.fault({ kind: "refuse" }, (r) => r.target === "transfer_order_lines" && r.method === "PATCH" && r.query.id?.[0] === "eq.l2");
    const res = await act(() => settles(h.result.current.sendTO("to-1", lines)));
    expect(res.error).toMatch(/ยังไม่ได้ส่ง/);
    expect(net.tables.transfer_orders[0].status).toBe("Draft");
    expect(net.sent("sync_transfer_distribution")).toHaveLength(0);
    expect(net.sent("stock_adjustments", "POST")).toHaveLength(0);
  });

  it("distribution dropped after sending: still sent, says the deduction failed", async () => {
    seedDraft();
    net.fault({ kind: "fail" }, FakeNetwork.to("sync_transfer_distribution"));
    const h = await mount();
    expect(await act(() => settles(h.result.current.sendTO("to-1", lines)))).toEqual({});
    expect(toasts.log).toContainEqual(["error", expect.stringContaining("หักสต๊อกวัตถุดิบ")]);
  });
});
