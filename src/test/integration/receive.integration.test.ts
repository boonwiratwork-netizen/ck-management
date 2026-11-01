import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { FakeNetwork, net, settles } from "./fake-network";

/**
 * Branch receive and decline of a transfer order (use-receive-data, what
 * ReceiveTransferOrder calls) through the real client: the database function first,
 * the app's own steps when it isn't installed, and every failure settles.
 */
vi.mock("@/integrations/supabase/client", async () => ({ supabase: (await import("./fake-network")).net.client }));
const toasts = vi.hoisted(() => {
  const log: [string, string][] = [];
  const mk = (k: string) => (m: unknown) => void log.push([k, String(m)]);
  return { log, toast: Object.assign(mk("toast"), { success: mk("success"), error: mk("error"), info: mk("info"), warning: mk("warning") }) };
});
vi.mock("sonner", () => ({ toast: toasts.toast }));

import { useReceiveData, type PendingTO } from "@/hooks/use-receive-data";
import { DB_CALL_TIMEOUT_MS } from "@/lib/transfer-stock-db";
import type { ReceiptRow } from "@/lib/receive-rows";

const order: PendingTO = {
  id: "to-1",
  toNumber: "TO-2611-001",
  deliveryDate: "2026-11-01",
  trId: "tr-1",
  lines: [{ id: "line-1", skuId: "sm-1", plannedQty: 2000, actualQty: 2000, uom: "g", unitCost: 0.2, notes: "", sentPacks: 4 }],
};
const rows: ReceiptRow[] = [
  {
    branchId: "b-1",
    receiptDate: "2026-11-01",
    skuId: "sm-1",
    supplierName: "Central Kitchen",
    qtyReceived: 2000,
    uom: "g",
    actualUnitPrice: 0.2,
    actualTotal: 400,
    stdUnitPrice: 0.2,
    stdTotal: 400,
    priceVariance: 0,
    notes: "",
    transferOrderId: "to-1",
  } as ReceiptRow,
];
const byLine = new Map([["line-1", 2000]]);

async function mount() {
  const h = renderHook(() => useReceiveData({ branchId: "b-1", historyBranchIds: ["b-1"], historyFrom: "2026-10-01", historyTo: "2026-11-30" }));
  await waitFor(() => expect(h.result.current.loading).toBe(false));
  net.requests = []; // only what the action sends from here
  return h;
}

beforeEach(() => {
  net.reset();
  toasts.log.length = 0;
});
afterEach(() => vi.useRealTimers());

describe("receive a transfer order", () => {
  it("receive_transfer_order gets the order, status and rows; settles with the count", async () => {
    net.rpcs.receive_transfer_order = (a) => ({ result: "saved", rows: (a.p_rows as unknown[]).map((r, i) => ({ ...(r as object), id: `r${i}` })) });
    const h = await mount();
    const n = await act(() => settles(h.result.current.receiveTransferOrder(order, rows, byLine)));
    expect(n).toBe(1);
    const call = net.sent("receive_transfer_order", "POST");
    expect(call).toHaveLength(1);
    expect(call[0].body).toMatchObject({ p_to_id: "to-1", p_status: "Received", p_rows: [expect.objectContaining({ sku_id: "sm-1", qty_received: 2000, transfer_order_id: "to-1" })] });
    expect(toasts.log.filter((t) => t[0] === "error")).toEqual([]);
  });

  it("before the migration: claims the order, inserts the receipts, closes the request", async () => {
    net.seed("transfer_orders", [{ id: "to-1", status: "Sent" }]);
    net.seed("transfer_requests", [{ id: "tr-1", status: "Submitted" }]);
    const h = await mount();
    const n = await act(() => settles(h.result.current.receiveTransferOrder(order, rows, byLine)));
    expect(n).toBe(1);
    expect(net.sent("branch_receipts", "POST")).toHaveLength(1);
    expect(net.tables.transfer_orders[0].status).toBe("Received");
    expect(net.tables.transfer_requests[0].status).toBe("Fulfilled");
  });

  it("refused: settles, nothing counted, the reason is shown", async () => {
    net.fault({ kind: "refuse", code: "P0001", message: "รับเกินที่ส่ง" }, FakeNetwork.to("receive_transfer_order"));
    const h = await mount();
    const n = await act(() => settles(h.result.current.receiveTransferOrder(order, rows, byLine)));
    expect(n).toBe(0);
    expect(net.sent("receive_transfer_order")).toHaveLength(1);
    expect(toasts.log).toContainEqual(["error", expect.stringContaining("รับเกินที่ส่ง")]);
  });

  it("dropped connection: reads the order back and settles (nothing saved = error)", async () => {
    net.fault({ kind: "fail" }, FakeNetwork.to("receive_transfer_order"));
    const h = await mount();
    const n = await act(() => settles(h.result.current.receiveTransferOrder(order, rows, byLine)));
    expect(n).toBe(0);
    expect(net.sent("branch_receipts", "HEAD").length + net.sent("branch_receipts", "GET").length).toBeGreaterThan(0);
    expect(toasts.log).toContainEqual(["error", expect.stringContaining("รับของไม่สำเร็จ")]);
  });

  it("dropped connection after it saved: reads back, says already received", async () => {
    net.fault({ kind: "fail" }, FakeNetwork.to("receive_transfer_order"));
    net.seed("transfer_orders", [{ id: "to-1", status: "Received" }]);
    net.seed("branch_receipts", [{ id: "r1", transfer_order_id: "to-1" }]);
    const h = await mount();
    await act(() => settles(h.result.current.receiveTransferOrder(order, rows, byLine)));
    expect(toasts.log).toContainEqual(["info", expect.stringContaining("รับเข้าสต๊อกแล้ว")]);
  });

  it("no answer: settles after the time limit", async () => {
    net.fault({ kind: "stall" }, FakeNetwork.to("receive_transfer_order"));
    const h = await mount();
    vi.useFakeTimers();
    let settled = false;
    const p = h.result.current.receiveTransferOrder(order, rows, byLine).then((n) => ((settled = true), n));
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(net.stalled).toHaveLength(1);
    expect(settled).toBe(false);
    await act(() => vi.advanceTimersByTimeAsync(DB_CALL_TIMEOUT_MS));
    expect(await settles(p)).toBe(0);
    expect(toasts.log).toContainEqual(["error", expect.stringContaining("ระบบไม่ตอบ")]);
  });
});

describe("decline a transfer order", () => {
  it("decline_transfer_order gets the order and reason", async () => {
    net.rpcs.decline_transfer_order = () => ({ result: "declined" });
    const h = await mount();
    expect(await act(() => settles(h.result.current.declineTransferOrder(order, "ของเสีย")))).toBe(true);
    expect(net.sent("decline_transfer_order", "POST")[0].body).toEqual({ p_to_id: "to-1", p_reason: "ของเสีย" });
  });

  it("before the migration: moves Sent → Declined and removes the kitchen deduction", async () => {
    net.seed("transfer_orders", [{ id: "to-1", status: "Sent" }]);
    net.seed("stock_adjustments", [{ id: "a1", branch_id: null, reason: "Distribution: TO-2611-001", sku_id: "rm-1", quantity: -5 }]);
    const h = await mount();
    expect(await act(() => settles(h.result.current.declineTransferOrder(order, "ของเสีย")))).toBe(true);
    expect(net.tables.transfer_orders[0]).toMatchObject({ status: "Declined", decline_reason: "ของเสีย" });
    expect(net.sent("stock_adjustments", "DELETE")).toHaveLength(1);
    expect(net.tables.stock_adjustments).toEqual([]);
  });

  it("refused / dropped / no answer: each settles false with a message", async () => {
    const h = await mount();
    net.fault({ kind: "refuse", code: "42501", message: "permission denied" }, FakeNetwork.to("decline_transfer_order"), true);
    expect(await act(() => settles(h.result.current.declineTransferOrder(order, "")))).toBe(false);
    net.fault({ kind: "fail" }, FakeNetwork.to("decline_transfer_order"), true);
    expect(await act(() => settles(h.result.current.declineTransferOrder(order, "")))).toBe(false);
    net.fault({ kind: "stall" }, FakeNetwork.to("decline_transfer_order"), true);
    vi.useFakeTimers();
    const p = h.result.current.declineTransferOrder(order, "");
    await act(() => vi.advanceTimersByTimeAsync(DB_CALL_TIMEOUT_MS + 1000));
    expect(await settles(p)).toBe(false);
    expect(net.sent("decline_transfer_order")).toHaveLength(3);
    expect(toasts.log.filter((t) => t[0] === "error")).toHaveLength(3);
  });
});
