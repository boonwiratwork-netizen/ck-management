import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { FakeNetwork, net, settles } from "./fake-network";

/**
 * Request submit (useRequestData.submitKitchen / submitSupplier, what Request.tsx runs under
 * withBusy) through the real client: number from next_doc_number, the head, then its lines;
 * a failed lines insert cancels the empty head. Every outcome settles.
 */
vi.mock("@/integrations/supabase/client", async () => ({ supabase: (await import("./fake-network")).net.client }));
const toasts = vi.hoisted(() => {
  const log: [string, string][] = [];
  const mk = (k: string) => (m: unknown) => void log.push([k, String(m)]);
  return { log, toast: Object.assign(mk("toast"), { success: mk("success"), error: mk("error"), info: mk("info"), warning: mk("warning") }) };
});
vi.mock("sonner", () => ({ toast: toasts.toast }));

import { useRequestData, type RequestItem } from "@/hooks/use-request-data";

const item: RequestItem = { skuId: "sm-1", code: "SM-001", name: "ซอส", packSize: 500, uom: "g", packUnit: "ถุง", purchaseUom: "ถุง", stockOnHand: 200, avgDailyUsage: 300, peakDailyUsage: 400, rop: 600, parstock: 1200, suggestedQty: 1000, skuType: "SM" };
const kitchen = { profileId: "p-1", requiredDate: "2026-11-02", notes: "ด่วน", items: [{ item, packs: 3 }] };

async function mount() {
  const h = renderHook(() => useRequestData("b-1", "Sendo"));
  // the pending-lines read on open has gone out and come back
  await waitFor(() => expect(net.sent("purchase_request_lines", "GET").length).toBeGreaterThan(0));
  await act(() => new Promise((r) => setTimeout(r, 0)));
  net.requests = [];
  return h;
}

beforeEach(() => {
  net.reset();
  toasts.log.length = 0;
  net.rpcs.next_doc_number = (a) => `${a.p_type}-2611-0001`;
});

describe("request submit", () => {
  it("kitchen request: number, head, lines (packs × pack size)", async () => {
    const h = await mount();
    expect(await act(() => settles(h.result.current.submitKitchen(kitchen)))).toEqual({ number: "TR-2611-0001" });
    expect(net.sent("next_doc_number", "POST")[0].body).toMatchObject({ p_type: "TR" });
    expect(net.sent("transfer_requests", "POST")[0].body).toMatchObject({ tr_number: "TR-2611-0001", branch_id: "b-1", status: "Submitted", required_date: "2026-11-02" });
    const lines = net.sent("transfer_request_lines", "POST")[0].body as { tr_id: string; requested_qty: number }[];
    expect(lines).toEqual([expect.objectContaining({ tr_id: net.tables.transfer_requests[0].id, sku_id: "sm-1", requested_qty: 1500 })]);
  });

  it("supplier order: PR number, head and lines with the supplier", async () => {
    const h = await mount();
    expect(await act(() => settles(h.result.current.submitSupplier({ ...kitchen, supplierId: "sup-1" })))).toEqual({ number: "PR-2611-0001" });
    expect(net.sent("purchase_request_lines", "POST")[0].body).toEqual([expect.objectContaining({ supplier_id: "sup-1", requested_qty: 1500, uom: "ถุง" })]);
  });

  it("number refused or dropped: settles with an error, nothing inserted", async () => {
    const h = await mount();
    net.fault({ kind: "refuse" }, FakeNetwork.to("next_doc_number"), true);
    expect(await act(() => settles(h.result.current.submitKitchen(kitchen)))).toHaveProperty("error");
    net.fault({ kind: "fail" }, FakeNetwork.to("next_doc_number"), true);
    expect(await act(() => settles(h.result.current.submitKitchen(kitchen)))).toHaveProperty("error");
    expect(net.sent("transfer_requests", "POST")).toHaveLength(0);
  });

  it("lines refused: the empty head is cancelled, settles with the error", async () => {
    net.fault({ kind: "refuse", message: "permission denied for table transfer_request_lines" }, FakeNetwork.to("transfer_request_lines", "POST"));
    const h = await mount();
    const res = await act(() => settles(h.result.current.submitKitchen(kitchen)));
    expect(res).toEqual({ error: "permission denied for table transfer_request_lines" });
    expect(net.tables.transfer_requests[0].status).toBe("Cancelled");
  });

  it("head insert dropped: settles with an error", async () => {
    net.fault({ kind: "fail" }, FakeNetwork.to("transfer_requests", "POST"));
    const h = await mount();
    expect(await act(() => settles(h.result.current.submitKitchen(kitchen)))).toEqual({ error: expect.stringContaining("ไม่แน่ใจว่าบันทึกแล้วหรือยัง") });
  });
});
