import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { FakeNetwork, net } from "./fake-network";

/**
 * "ไม่ทราบล็อต" on a transfer line (useTransferLots.markUnknown) through the real client:
 * the row is saved with no production record and the unknown-lot date, read back as the
 * unknown lot, lets the line pass the check before sending, and never counts as "taken"
 * from a real lot on another order.
 */
vi.mock("@/integrations/supabase/client", async () => ({ supabase: (await import("./fake-network")).net.client }));
const toasts = vi.hoisted(() => {
  const log: [string, string][] = [];
  const mk = (k: string) => (m: unknown) => void log.push([k, String(m)]);
  return { log, toast: Object.assign(mk("toast"), { success: mk("success"), error: mk("error"), info: mk("info"), warning: mk("warning") }) };
});
vi.mock("sonner", () => ({ toast: toasts.toast }));

import { useTransferLots } from "@/hooks/use-transfer-lots";
import type { TOLine } from "@/hooks/use-transfer-order";
import type { SKU } from "@/types/sku";
import { UNKNOWN_LOT_DATE, checkBeforeSend } from "@/lib/transfer-lines";
import { WRITE_TIMEOUT_MS } from "@/lib/write-timeout";

const SKUS = [{ id: "oil", skuId: "SM-OIL", name: "น้ำมันราเมนเหลือง", type: "SM", packSize: 400, status: "Active", converter: 1 } as unknown as SKU];
const line: TOLine = { id: "l1", skuId: "oil", skuCode: "SM-OIL", skuName: "น้ำมันราเมนเหลือง", plannedQty: 400, actualQty: 400, uom: "g", unitCost: 0, lineValue: 0, note: "", trLineId: "t1", packsCount: 1 };
const skuInfo = () => ({ type: "SM", packSize: 400 });

async function mount() {
  const h = renderHook(() => useTransferLots("to-1", [line], SKUS));
  await waitFor(() => expect(h.result.current.loading).toBe(false));
  return h;
}

beforeEach(() => {
  net.reset();
  toasts.log.length = 0;
  net.seed("transfer_orders", [{ id: "to-1", status: "Draft" }]);
});

describe("ไม่ทราบล็อต", () => {
  it("no production record: nothing is filled; choosing it saves a row with no record and reads back as the unknown lot", async () => {
    const h = await mount();
    expect(h.result.current.lots.l1 ?? []).toEqual([]);
    expect(net.sent("transfer_order_lot_lines", "POST")).toHaveLength(0); // never filled automatically
    expect(checkBeforeSend([line], skuInfo, {}, h.result.current.lots).lotMismatch).toHaveLength(1);

    act(() => h.result.current.markUnknown(line, 1));
    await waitFor(() => expect(net.sent("transfer_order_lot_lines", "POST")).toHaveLength(1));
    expect(net.sent("transfer_order_lot_lines", "POST")[0].body).toMatchObject({ to_line_id: "l1", production_record_id: null, production_date: UNKNOWN_LOT_DATE, packs: 1, pack_weight_g: 400 });
    expect(await act(() => h.result.current.settle())).toBe(true);
    h.unmount();

    // Opened again: read back from the database
    const again = await mount();
    expect(again.result.current.lots.l1).toEqual([expect.objectContaining({ productionRecordId: "", productionDate: UNKNOWN_LOT_DATE, packs: 1 })]);
    const check = checkBeforeSend([line], skuInfo, {}, again.result.current.lots);
    expect(check.lotMismatch).toEqual([]);
    expect(check.unknownLot).toEqual([{ lineId: "l1", skuName: "น้ำมันราเมนเหลือง", packs: 1 }]);
    expect(again.result.current.visibleFor("l1", "oil")).toEqual([]);
    expect(net.sent("transfer_order_lot_lines", "POST")).toHaveLength(1); // nothing written twice
  });

  it("an unknown-lot row on another order takes nothing from a real lot", async () => {
    net.seed("production_records", [{ id: "rec-1", sm_sku_id: "oil", production_date: "2026-11-01", actual_output_g: 2000, batches_produced: 1 }]);
    net.seed("transfer_order_lot_lines", [{ id: "x1", to_line_id: "other", production_record_id: null, production_date: UNKNOWN_LOT_DATE, packs: 3, pack_weight_g: 400 }]);
    const h = await mount();
    expect(h.result.current.records.oil).toEqual([expect.objectContaining({ id: "rec-1", remainingG: 2000 })]);
    // The automatic fill picked the real lot, not the unknown one
    expect(h.result.current.lots.l1).toEqual([expect.objectContaining({ productionRecordId: "rec-1", packs: 1 })]);
  });

  it("an old no-record row and ไม่ทราบล็อต on the same line stay two lots (never merged)", async () => {
    net.seed("transfer_order_lot_lines", [{ id: "old", to_line_id: "l1", production_record_id: null, production_date: "2026-10-03", packs: 1, pack_weight_g: 400 }]);
    const h = await mount();
    act(() => h.result.current.markUnknown({ ...line, packsCount: 2, actualQty: 800 }, 2));
    await waitFor(() => expect(net.sent("transfer_order_lot_lines", "POST")).toHaveLength(1));
    expect(await act(() => h.result.current.settle())).toBe(true);
    expect(net.sent("transfer_order_lot_lines", "PATCH")).toHaveLength(0); // the old row is untouched
    h.unmount();
    const again = await mount();
    expect(again.result.current.lots.l1).toEqual([
      expect.objectContaining({ id: "old", productionRecordId: "", productionDate: "2026-10-03", packs: 1 }),
      expect.objectContaining({ productionRecordId: "", productionDate: UNKNOWN_LOT_DATE, packs: 1 }),
    ]);
  });

  it("a refused save: the line is marked not saved, a message shows, and sending is held until it lands", async () => {
    const h = await mount();
    net.fault({ kind: "refuse" }, FakeNetwork.to("transfer_order_lot_lines", "POST"), true);
    act(() => h.result.current.markUnknown(line, 1));
    await waitFor(() => expect(h.result.current.unsaved.has("l1")).toBe(true));
    expect(toasts.log.some(([k, m]) => k === "error" && m.includes("บันทึกล็อตไม่ได้"))).toBe(true);
    expect(net.tables.transfer_order_lot_lines ?? []).toHaveLength(0);
    // settle (before sending) retries; now it lands
    expect(await act(() => h.result.current.settle())).toBe(true);
    expect(h.result.current.unsaved.size).toBe(0);
    expect(net.tables.transfer_order_lot_lines).toHaveLength(1);
  });

  it("an update that answers 0 rows is not taken as saved", async () => {
    net.seed("transfer_order_lot_lines", [{ id: "u1", to_line_id: "l1", production_record_id: null, production_date: UNKNOWN_LOT_DATE, packs: 1, pack_weight_g: 400 }]);
    const h = await mount();
    net.fault({ kind: "filtered" }, FakeNetwork.to("transfer_order_lot_lines", "PATCH"));
    act(() => h.result.current.setUnknownPacks("l1", 2));
    await waitFor(() => expect(h.result.current.unsaved.has("l1")).toBe(true));
    expect(await act(() => h.result.current.settle())).toBe(false);
  });

  it("an insert with no answer that did land is found by its id, not inserted again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const h = await mount();
      net.fault({ kind: "stall", landed: true }, FakeNetwork.to("transfer_order_lot_lines", "POST"), true);
      act(() => h.result.current.markUnknown(line, 1));
      await waitFor(() => expect(net.stalled).toHaveLength(1));
      await act(() => vi.advanceTimersByTimeAsync(WRITE_TIMEOUT_MS + 1000));
      expect(await act(() => h.result.current.settle())).toBe(true);
      expect(net.tables.transfer_order_lot_lines).toHaveLength(1);
      expect(h.result.current.unsaved.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
