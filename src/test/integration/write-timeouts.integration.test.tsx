import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { FakeNetwork, net, settles } from "./fake-network";

/**
 * Every daily write has a time limit (lib/write-timeout.ts): a write that gets no answer
 * settles as "may have landed" — never retried blindly, read back where it can be — and a
 * write that row security filtered out (200, 0 rows) is a failure, never "saved".
 * Through the real client; fake timers push the limit forward.
 */
vi.mock("@/integrations/supabase/client", async () => ({ supabase: (await import("./fake-network")).net.client }));
const toasts = vi.hoisted(() => {
  const log: [string, string][] = [];
  const mk = (k: string) => (m: unknown) => void log.push([k, String(m)]);
  return { log, toast: Object.assign(mk("toast"), { success: mk("success"), error: mk("error"), info: mk("info"), warning: mk("warning") }) };
});
vi.mock("sonner", () => ({ toast: toasts.toast }));

import { NO_ANSWER, WRITE_TIMEOUT_MS } from "@/lib/write-timeout";
import { useTransferOrder, type TOLine } from "@/hooks/use-transfer-order";
import { useStockCountData } from "@/hooks/use-stock-count-data";
import { useKitchenItemStock } from "@/hooks/use-kitchen-item-stock";
import { useSmStockData } from "@/hooks/use-sm-stock-data";
import { useProductionData } from "@/hooks/use-production-data";
import { useSalesData } from "@/hooks/use-sales-data";
import { useRequestData, type RequestItem } from "@/hooks/use-request-data";
import { useDailyStockCount } from "@/hooks/use-daily-stock-count";
import { useReceiveData } from "@/hooks/use-receive-data";
import { AdjustSheet } from "@/components/kitchen-stock/AdjustSheet";
import { MoveSheet } from "@/components/store-stock/MoveSheet";
import type { ReceiptRow } from "@/lib/receive-rows";
import type { SKU } from "@/types/sku";
import type { Branch } from "@/types/branch";
import type { BOMHeader, BOMLine } from "@/types/bom";

const NONE: never[] = [];
const errors = () => toasts.log.filter((t) => t[0] === "error").map((t) => t[1]);

/** Start `work` under fake timers, run past the write time limit (a few rounds: read-backs follow), return its result */
async function pastTheLimit<T>(work: () => Promise<T>): Promise<T> {
  vi.useFakeTimers();
  let p!: Promise<T>;
  await act(async () => {
    p = work();
  });
  for (let i = 0; i < 3; i++) await act(() => vi.advanceTimersByTimeAsync(WRITE_TIMEOUT_MS + 1000));
  return settles(p);
}

beforeEach(() => {
  net.reset();
  toasts.log.length = 0;
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Transfer send: no answer on the claim", () => {
  const line = (id: string, skuId: string, qty: number): TOLine => ({ id, skuId, skuCode: skuId, skuName: skuId, plannedQty: qty, actualQty: qty, uom: "g", unitCost: 0.1, lineValue: qty * 0.1, note: "", trLineId: null, packsCount: 2 });
  const lines = [line("l1", "rm-1", 500)];
  beforeEach(() => {
    net.seed("transfer_orders", [{ id: "to-1", to_number: "TO-1", status: "Draft", tr_id: null, sent_at: null, delivery_date: "2026-11-01" }]);
    net.seed("transfer_order_lines", [{ id: "l1", to_id: "to-1", sku_id: "rm-1", sku_type: "RM", actual_qty: 0 }]);
  });
  async function mount() {
    const h = renderHook(() => useTransferOrder());
    await waitFor(() => expect(h.result.current.pendingLoading).toBe(false));
    return h;
  }

  it("didn't land: settles, reads back, says not sent (nothing taken out)", async () => {
    const h = await mount();
    net.fault({ kind: "stall" }, FakeNetwork.to("transfer_orders", "PATCH"), true);
    const res = await pastTheLimit(() => h.result.current.sendTO("to-1", lines));
    expect(res.error).toMatch(/ยังไม่ได้ส่ง/);
    expect(net.sent("stock_adjustments", "POST")).toHaveLength(0);
  });

  it("landed, reply lost: reads back Sent and finishes the send (lines + stock) once", async () => {
    const h = await mount();
    net.fault({ kind: "stall", landed: true }, FakeNetwork.to("transfer_orders", "PATCH"), true);
    expect(await pastTheLimit(() => h.result.current.sendTO("to-1", lines))).toEqual({});
    expect(net.tables.transfer_order_lines[0].actual_qty).toBe(500);
    expect(net.tables.stock_adjustments).toEqual([expect.objectContaining({ sku_id: "rm-1", quantity: -500 })]);
  });
});

describe("KitchenCount confirm", () => {
  beforeEach(() => {
    net.seed("stock_count_sessions", [{ id: "s1", count_date: "2026-10-31", status: "Draft", deleted_at: null, created_at: "2026-10-31T10:00:00Z" }]);
    net.seed("stock_count_lines", [{ id: "c1", session_id: "s1", sku_id: "rm-1", type: "RM", system_qty: 1000, physical_qty: 900, variance: -100, note: null }]);
  });
  async function mount() {
    const h = renderHook(() => {
      const rm = useKitchenItemStock("RM", NONE, NONE, false);
      const pk = useKitchenItemStock("PK", NONE, NONE, false);
      return useStockCountData({ skus: NONE, rmStockBalances: NONE, smStockBalances: NONE, pkStockBalances: NONE, addRmAdjustment: rm.addAdjustment, addSmAdjustment: rm.addAdjustment, addPkAdjustment: pk.addAdjustment, addRmAdjustments: rm.addAdjustments, addPkAdjustments: pk.addAdjustments, getStdUnitPrice: () => 0 });
    });
    await waitFor(() => expect(h.result.current.sessions).toHaveLength(1));
    return h;
  }

  it("lines can't be read: the session is NOT locked (never done without its adjustments)", async () => {
    const h = await mount();
    net.fault({ kind: "refuse" }, FakeNetwork.to("stock_count_lines", "GET"), true);
    expect(await act(() => settles(h.result.current.confirmSession("s1", "before")))).toBe(false);
    expect(net.sent("stock_count_sessions", "PATCH")).toHaveLength(0);
    expect(net.tables.stock_count_sessions[0].status).toBe("Draft");
  });

  it("lock landed, reply lost: read back as ours, adjustments written", async () => {
    const h = await mount();
    net.fault({ kind: "stall", landed: true }, FakeNetwork.to("stock_count_sessions", "PATCH"), true);
    expect(await pastTheLimit(() => h.result.current.confirmSession("s1", "before"))).toBe(true);
    expect(net.tables.stock_adjustments).toEqual([expect.objectContaining({ sku_id: "rm-1", quantity: -100 })]);
  });

  it("lock didn't land: settles false, says not finished, no adjustments", async () => {
    const h = await mount();
    net.fault({ kind: "stall" }, FakeNetwork.to("stock_count_sessions", "PATCH"), true);
    expect(await pastTheLimit(() => h.result.current.confirmSession("s1", "before"))).toBe(false);
    expect(errors()).toContainEqual(expect.stringContaining("ยังไม่ได้นับเสร็จ"));
    expect(net.sent("stock_adjustments", "POST")).toHaveLength(0);
  });
});

describe("kitchen AdjustSheet", () => {
  it("no answer: stops spinning, says it may have saved, stays open", async () => {
    const stock = renderHook(() => useKitchenItemStock("RM", NONE, NONE, false));
    const onClose = vi.fn();
    render(<AdjustSheet sku={{ id: "rm-1", name: "แป้ง", type: "RM", usageUom: "g" } as SKU} stock={500} anchor={null} onSave={(a) => stock.result.current.addAdjustment(a)} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Workshop" }));
    fireEvent.change(screen.getByRole("textbox", { name: /จำนวน/ }), { target: { value: "30" } });
    const button = screen.getByRole("button", { name: /ตัดออก 30/ });
    net.fault({ kind: "stall" }, FakeNetwork.to("stock_adjustments"));
    await pastTheLimit(async () => fireEvent.click(button));
    expect(button).not.toHaveAttribute("aria-busy");
    expect(errors()).toEqual([expect.stringContaining(NO_ANSWER)]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("SM writer: no answer settles false", async () => {
    const h = renderHook(() => useSmStockData(NONE, NONE, NONE, NONE, NONE, NONE, NONE, NONE, false));
    net.fault({ kind: "stall" }, FakeNetwork.to("stock_adjustments"));
    expect(await pastTheLimit(() => h.result.current.addAdjustment({ skuId: "sm-1", date: "2026-11-01", quantity: -1, reason: "x" }))).toBe(false);
  });
});

describe("Produce save", () => {
  const headers: BOMHeader[] = [{ id: "h1", smSkuId: "sm-1", productionType: "CK", bomMode: "simple", batchSize: 1000, yieldPercent: 1 }];
  const bom: BOMLine[] = [{ id: "bl1", bomHeaderId: "h1", rmSkuId: "rm-1", qtyPerBatch: 600, yieldPercent: 1 }];
  const mount = () =>
    renderHook(() => {
      const rm = useKitchenItemStock("RM", NONE, NONE, false);
      return useProductionData(headers, bom, rm.addAdjustment, NONE, false, rm.addAdjustments);
    });
  const record = { smSkuId: "sm-1", productionDate: "2026-11-01", actualOutputG: 1000 };
  beforeEach(() => net.seed("skus", [{ id: "rm-1", type: "RM" }]));

  it("record insert gets no answer and isn't there: settles, says not saved, takes nothing out", async () => {
    const h = mount();
    net.fault({ kind: "stall" }, FakeNetwork.to("production_records", "POST"));
    expect(await pastTheLimit(() => h.result.current.addRecord(record))).toBeUndefined();
    expect(errors()).toContainEqual(expect.stringContaining("ยังไม่ได้บันทึกผลผลิต"));
    expect(net.sent("stock_adjustments", "POST")).toHaveLength(0);
  });

  it("stock insert landed but no answer: named as not moved, not written again", async () => {
    const h = mount();
    net.fault({ kind: "stall", landed: true }, FakeNetwork.to("stock_adjustments", "POST"));
    const res = await pastTheLimit(() => h.result.current.addRecord(record));
    expect(res?.stockShort).toEqual(["rm-1"]);
    expect(net.sent("stock_adjustments", "POST")).toHaveLength(1);
    expect(net.tables.stock_adjustments).toHaveLength(1);
  });
});

describe("sales import", () => {
  it("no answer: the day is named as failed with 'check before saving again'", async () => {
    const h = renderHook(() => useSalesData({ branchId: "b-1", from: "2026-10-01", to: "2026-10-31", day: null }));
    await waitFor(() => expect(h.result.current.daysLoading).toBe(false));
    net.fault({ kind: "stall" }, FakeNetwork.to("sales_entries", "POST"));
    const row = { branch_id: "b-1", sale_date: "2026-10-31", receipt_no: "R1", menu_code: "M", menu_name: "M", order_type: "", qty: 1, unit_price: 1, net_amount: 1, channel: "" };
    expect(await pastTheLimit(() => h.result.current.saveImport([{ date: "2026-10-31", insert: [row], update: [], deleteIds: [], kept: 0 }]))).toEqual({ inserted: 0, failedDay: "2026-10-31" });
    expect(errors()).toContainEqual(expect.stringContaining(NO_ANSWER));
  });
});

describe("request submit", () => {
  it("no answer on the head: settles with 'check before saving again'", async () => {
    net.rpcs.next_doc_number = () => "TR-1";
    const h = renderHook(() => useRequestData("b-1", "Sendo"));
    const item = { skuId: "sm-1", code: "", name: "", packSize: 1, uom: "g", packUnit: "", stockOnHand: 0, avgDailyUsage: 0, peakDailyUsage: 0, rop: 0, parstock: 0, suggestedQty: 0, skuType: "SM" } as RequestItem;
    net.fault({ kind: "stall" }, FakeNetwork.to("transfer_requests", "POST"));
    expect(await pastTheLimit(() => h.result.current.submitKitchen({ profileId: null, requiredDate: "2026-11-02", notes: "", items: [{ item, packs: 1 }] }))).toEqual({ error: NO_ANSWER });
  });
});

describe("DailyCount", () => {
  const DAY = "2026-11-01";
  const props = { skus: NONE, menuBomLines: NONE, modifierRules: NONE, spBomLines: NONE, menus: NONE, branches: NONE };
  beforeEach(() =>
    net.seed("daily_stock_counts", [{ id: "d1", branch_id: "b-1", count_date: DAY, sku_id: "sm-1", opening_balance: 100, received_from_ck: 0, received_external: 0, expected_usage: 0, waste: 0, calculated_balance: 100, physical_count: null, variance: 0, is_submitted: false, created_at: "2026-11-01T01:00:00Z" }]),
  );
  async function mount() {
    const h = renderHook(() => useDailyStockCount(props));
    await act(() => settles(h.result.current.loadSheet("b-1", DAY)));
    await waitFor(() => expect(h.result.current.rows).toHaveLength(1));
    return h;
  }

  it("count save filtered out by row security (0 rows): waiting + told, not saved", async () => {
    const h = await mount();
    net.fault({ kind: "filtered" }, FakeNetwork.to("daily_stock_counts", "PATCH"), true);
    await act(() => settles(h.result.current.updatePhysicalCount("d1", 80)));
    expect(h.result.current.saveState.d1).toBe("waiting");
    expect(errors()).toContainEqual(expect.stringContaining("บันทึกยอดนับแถวนี้ไม่ได้"));
  });

  it("count save with no answer: settles as waiting (sent again later: it only sets the value)", async () => {
    const h = await mount();
    net.fault({ kind: "stall" }, FakeNetwork.to("daily_stock_counts", "PATCH"), true);
    await pastTheLimit(() => h.result.current.updatePhysicalCount("d1", 80));
    expect(h.result.current.saveState.d1).toBe("waiting");
  });

  it("นับเสร็จ filtered out (0 rows): false and said, never 'done'", async () => {
    const h = await mount();
    net.fault({ kind: "filtered" }, FakeNetwork.to("daily_stock_counts", "PATCH"), true);
    expect(await act(() => settles(h.result.current.submitSheet("b-1", DAY)))).toBe(false);
    expect(errors()).toContainEqual(expect.stringContaining("ปิดใบนับนี้ไม่ได้"));
    expect(h.result.current.rows[0].isSubmitted).toBe(false);
  });

  it("นับเสร็จ with no answer: settles false, asks to press again", async () => {
    const h = await mount();
    net.fault({ kind: "stall" }, FakeNetwork.to("daily_stock_counts", "PATCH"), true);
    expect(await pastTheLimit(() => h.result.current.submitSheet("b-1", DAY))).toBe(false);
    expect(errors()).toContainEqual(expect.stringContaining("ลองกดนับเสร็จอีกครั้ง"));
  });
});

describe("receipts and branch moves", () => {
  it("supplier receipt insert with no answer: 0 saved, 'check before saving again'", async () => {
    const h = renderHook(() => useReceiveData({ branchId: "b-1", historyBranchIds: ["b-1"], historyFrom: "2026-10-01", historyTo: "2026-11-30" }));
    await waitFor(() => expect(h.result.current.loading).toBe(false));
    net.fault({ kind: "stall" }, FakeNetwork.to("branch_receipts", "POST"));
    const row = { branchId: "b-1", receiptDate: "2026-11-01", skuId: "rm-1", supplierName: "Makro", qtyReceived: 1, uom: "kg", actualUnitPrice: 1, actualTotal: 1, stdUnitPrice: 1, stdTotal: 1, priceVariance: 0, notes: "", transferOrderId: null } as unknown as ReceiptRow;
    expect(await pastTheLimit(() => h.result.current.saveRows([row]))).toBe(0);
    expect(errors()).toContainEqual(expect.stringContaining(NO_ANSWER));
  });

  it("MoveSheet before the migration, insert with no answer: 'may have saved', not 'nothing saved'", async () => {
    const branch = (id: string): Branch => ({ id, branchName: id, brandName: "Sendo", location: "", status: "Active", avgSellingPrice: null });
    render(<MoveSheet sku={{ id: "s", name: "s", type: "SM", usageUom: "g" } as SKU} balance={10} branch={branch("b-1")} branches={[branch("b-1"), branch("b-2")]} onClose={() => {}} onSaved={() => {}} />);
    fireEvent.change(screen.getByLabelText("จำนวน"), { target: { value: "5" } });
    const button = screen.getByRole("button", { name: /ยืนยันย้าย/ });
    net.fault({ kind: "stall" }, FakeNetwork.to("stock_adjustments", "POST"));
    await pastTheLimit(async () => fireEvent.click(button));
    expect(button).not.toHaveAttribute("aria-busy");
    expect(errors()).toEqual([expect.stringContaining("ไม่แน่ใจว่าบันทึกแล้วหรือยัง")]);
  });
});

describe("writes that landed but got no answer", () => {
  const headers: BOMHeader[] = [{ id: "h1", smSkuId: "sm-1", productionType: "CK", bomMode: "simple", batchSize: 1000, yieldPercent: 1 }];
  const bom: BOMLine[] = [{ id: "bl1", bomHeaderId: "h1", rmSkuId: "rm-1", qtyPerBatch: 600, yieldPercent: 1 }];
  const production = (loadRecords: boolean) =>
    renderHook(() => {
      const rm = useKitchenItemStock("RM", NONE, NONE, false);
      return useProductionData(headers, bom, rm.addAdjustment, NONE, loadRecords, rm.addAdjustments);
    });
  const record = { smSkuId: "sm-1", productionDate: "2026-11-01", actualOutputG: 1000 };
  const moved = () => net.sent("stock_adjustments", "POST").flatMap((r) => r.body as { sku_id: string; quantity: number }[]).map((a) => [a.sku_id, a.quantity]);
  async function savedRecord() {
    net.seed("production_records", [{ id: "rec-1", plan_id: "p1", production_date: "2026-11-01", sm_sku_id: "sm-1", batches_produced: 1, actual_output_g: 1000, notes: null, created_at: "2026-11-01T03:00:00Z" }]);
    net.seed("stock_adjustments", [{ id: "a1", sku_id: "rm-1", quantity: -600, reason: "Production: 1 batches of sm-1 [rec rec-1]" }]);
    const h = production(true);
    await waitFor(() => expect(h.result.current.records).toHaveLength(1));
    return h;
  }
  beforeEach(() => net.seed("skus", [{ id: "rm-1", type: "RM" }]));

  it("production insert landed: found by its own id, RM taken out once", async () => {
    const h = production(false);
    net.fault({ kind: "stall", landed: true }, FakeNetwork.to("production_records", "POST"), true);
    const res = await pastTheLimit(() => h.result.current.addRecord(record));
    expect(res?.stockShort).toEqual([]);
    expect(net.tables.production_records).toHaveLength(1);
    expect(res?.id).toBe(net.tables.production_records[0].id);
    expect(moved()).toEqual([["rm-1", -600]]);
  });

  it("production insert landed only after the read-back: saving again reuses the id — one record, RM out once", async () => {
    const h = production(false);
    net.fault({ kind: "stall" }, FakeNetwork.to("production_records", "POST"), true);
    expect(await pastTheLimit(() => h.result.current.addRecord(record))).toBeUndefined();
    vi.useRealTimers();
    // ...and now the first insert lands
    net.tables.production_records.push({ ...(net.stalled[0].body as object) });
    const res = await act(() => settles(h.result.current.addRecord(record)));
    expect(net.tables.production_records).toHaveLength(1);
    expect(res?.id).toBe((net.stalled[0].body as { id: string }).id);
    expect(moved()).toEqual([["rm-1", -600]]);
  });

  it("production update landed: the difference is written (1000 → 2000 g = 2 batches: −600)", async () => {
    const h = await savedRecord();
    net.fault({ kind: "stall", landed: true }, FakeNetwork.to("production_records", "PATCH"), true);
    expect(await pastTheLimit(() => h.result.current.updateRecordWithDelta("rec-1", { productionDate: "2026-11-01", actualOutputG: 2000 }))).toEqual({ stockShort: [] });
    expect(moved()).toEqual([["rm-1", -600]]);
  });

  it("production update didn't land: not saved, nothing written", async () => {
    const h = await savedRecord();
    net.fault({ kind: "stall" }, FakeNetwork.to("production_records", "PATCH"), true);
    expect(await pastTheLimit(() => h.result.current.updateRecordWithDelta("rec-1", { productionDate: "2026-11-01", actualOutputG: 1500 }))).toBe(false);
    expect(moved()).toEqual([]);
    expect(errors()).toContainEqual(expect.stringContaining("ยังไม่ได้แก้"));
  });

  it("production delete landed: the RM comes back (+600)", async () => {
    const h = await savedRecord();
    net.fault({ kind: "stall", landed: true }, FakeNetwork.to("production_records", "DELETE"), true);
    expect(await pastTheLimit(() => h.result.current.deleteRecord("rec-1"))).toEqual({ stockShort: [] });
    expect(moved()).toEqual([["rm-1", 600]]);
  });

  it("production delete didn't land: not deleted, nothing given back", async () => {
    const h = await savedRecord();
    net.fault({ kind: "stall" }, FakeNetwork.to("production_records", "DELETE"), true);
    expect(await pastTheLimit(() => h.result.current.deleteRecord("rec-1"))).toBe(false);
    expect(moved()).toEqual([]);
  });

  it("kitchen confirm lock landed after the read-back: the next press writes the missing adjustments once", async () => {
    net.seed("stock_count_sessions", [{ id: "s1", count_date: "2026-10-31", status: "Draft", deleted_at: null, created_at: "2026-10-31T10:00:00Z" }]);
    net.seed("stock_count_lines", [
      { id: "c1", session_id: "s1", sku_id: "rm-1", type: "RM", system_qty: 1000, physical_qty: 900, variance: -100, note: null },
      { id: "c2", session_id: "s1", sku_id: "pk-1", type: "PK", system_qty: 50, physical_qty: 60, variance: 10, note: null },
    ]);
    // One of the two is already in (written by whoever got there first)
    net.seed("stock_adjustments", [
      { id: "x1", sku_id: "rm-1", quantity: -100, reason: "Stock Count 2026-10-31 [count s1]", adjustment_date: "2026-10-31", branch_id: null, stock_type: "RM" },
      // a deleted session of the same day: its rows must not count as this session's
      { id: "x2", sku_id: "pk-1", quantity: 10, reason: "Stock Count 2026-10-31 [count s-old]", adjustment_date: "2026-10-31", branch_id: null, stock_type: "PK" },
    ]);
    const h = renderHook(() => {
      const rm = useKitchenItemStock("RM", NONE, NONE, false);
      const pk = useKitchenItemStock("PK", NONE, NONE, false);
      return useStockCountData({ skus: NONE, rmStockBalances: NONE, smStockBalances: NONE, pkStockBalances: NONE, addRmAdjustment: rm.addAdjustment, addSmAdjustment: rm.addAdjustment, addPkAdjustment: pk.addAdjustment, addRmAdjustments: rm.addAdjustments, addPkAdjustments: pk.addAdjustments, getStdUnitPrice: () => 0 });
    });
    await waitFor(() => expect(h.result.current.sessions).toHaveLength(1));
    net.fault({ kind: "stall" }, FakeNetwork.to("stock_count_sessions", "PATCH"), true);
    expect(await pastTheLimit(() => h.result.current.confirmSession("s1", "before"))).toBe(false);
    vi.useRealTimers();
    // ...and now this device's lock lands, with the stamp it sent
    Object.assign(net.tables.stock_count_sessions[0], { status: "Completed", completed_at: (net.stalled[0].body as { completed_at: string }).completed_at });
    expect(await act(() => settles(h.result.current.confirmSession("s1", "before")))).toBe(true);
    expect(net.tables.stock_adjustments.map((a) => [a.sku_id, a.quantity, a.reason])).toEqual([
      ["rm-1", -100, "Stock Count 2026-10-31 [count s1]"],
      ["pk-1", 10, "Stock Count 2026-10-31 [count s-old]"],
      ["pk-1", 10, "Stock Count 2026-10-31 [count s1]"],
    ]);
    expect(h.result.current.sessions[0].status).toBe("Completed");
  });

  it("kitchen confirm completed by another device (any clock, even long ago): says so, writes nothing", async () => {
    net.seed("stock_count_sessions", [{ id: "s1", count_date: "2026-10-31", status: "Draft", deleted_at: null, created_at: "2026-10-31T10:00:00Z" }]);
    net.seed("stock_count_lines", [{ id: "c1", session_id: "s1", sku_id: "rm-1", type: "RM", system_qty: 1000, physical_qty: 900, variance: -100, note: null }]);
    const h = renderHook(() => {
      const rm = useKitchenItemStock("RM", NONE, NONE, false);
      return useStockCountData({ skus: NONE, rmStockBalances: NONE, smStockBalances: NONE, pkStockBalances: NONE, addRmAdjustment: rm.addAdjustment, addSmAdjustment: rm.addAdjustment, addPkAdjustment: rm.addAdjustment, addRmAdjustments: rm.addAdjustments, getStdUnitPrice: () => 0 });
    });
    await waitFor(() => expect(h.result.current.sessions).toHaveLength(1));
    Object.assign(net.tables.stock_count_sessions[0], { status: "Completed", completed_at: "2026-10-01T00:00:00.000Z" });
    expect(await act(() => settles(h.result.current.confirmSession("s1", "before")))).toBe(false);
    expect(net.sent("stock_adjustments", "POST")).toHaveLength(0);
    expect(toasts.log).toContainEqual(["info", expect.stringContaining("อีกเครื่อง")]);
  });

  it("transfer claim landed after the read-back: the next press takes the RM out once, a third adds nothing", async () => {
    net.seed("transfer_orders", [{ id: "to-1", to_number: "TO-1", status: "Draft", tr_id: null, sent_at: null, delivery_date: "2026-11-01" }]);
    net.seed("transfer_order_lines", [{ id: "l1", to_id: "to-1", sku_id: "rm-1", sku_type: "RM", actual_qty: 500 }]);
    const h = renderHook(() => useTransferOrder());
    await waitFor(() => expect(h.result.current.pendingLoading).toBe(false));
    const lines: TOLine[] = [{ id: "l1", skuId: "rm-1", skuCode: "", skuName: "", plannedQty: 500, actualQty: 500, uom: "g", unitCost: 0, lineValue: 0, note: "", trLineId: null, packsCount: null }];
    net.fault({ kind: "stall" }, FakeNetwork.to("transfer_orders", "PATCH"), true);
    expect((await pastTheLimit(() => h.result.current.sendTO("to-1", lines))).error).toMatch(/ยังไม่ได้ส่ง/);
    vi.useRealTimers();
    // ...and now the claim lands
    Object.assign(net.tables.transfer_orders[0], { status: "Sent", sent_at: "2026-11-01T03:00:00Z" });
    expect(await act(() => settles(h.result.current.sendTO("to-1", lines)))).toEqual({ error: "ใบนี้ถูกส่งไปแล้ว" });
    expect(await act(() => settles(h.result.current.sendTO("to-1", lines)))).toEqual({ error: "ใบนี้ถูกส่งไปแล้ว" });
    expect(net.tables.stock_adjustments).toEqual([expect.objectContaining({ sku_id: "rm-1", quantity: -500, reason: "Distribution: TO-1" })]);
  });
});

describe("production edit read-back covers every changed column", () => {
  it("an output edit that landed (actual_output_g + batches_produced) is read as saved", async () => {
    net.seed("skus", [{ id: "rm-1", type: "RM" }]);
    net.seed("production_records", [{ id: "rec-1", plan_id: "p1", production_date: "2026-11-01", sm_sku_id: "sm-1", batches_produced: 1, actual_output_g: 1000, notes: null, created_at: "2026-11-01T03:00:00Z" }]);
    net.seed("stock_adjustments", [{ id: "a1", sku_id: "rm-1", quantity: -600, reason: "Production: 1 batches of sm-1 [rec rec-1]" }]);
    const headers: BOMHeader[] = [{ id: "h1", smSkuId: "sm-1", productionType: "CK", bomMode: "simple", batchSize: 1000, yieldPercent: 1 }];
    const bom: BOMLine[] = [{ id: "bl1", bomHeaderId: "h1", rmSkuId: "rm-1", qtyPerBatch: 600, yieldPercent: 1 }];
    const h = renderHook(() => {
      const rm = useKitchenItemStock("RM", NONE, NONE, false);
      return useProductionData(headers, bom, rm.addAdjustment, NONE, true, rm.addAdjustments);
    });
    await waitFor(() => expect(h.result.current.records).toHaveLength(1));
    net.fault({ kind: "stall", landed: true }, FakeNetwork.to("production_records", "PATCH"), true);
    expect(await pastTheLimit(() => h.result.current.updateRecordWithDelta("rec-1", { productionDate: "2026-11-01", actualOutputG: 1500 }))).toEqual({ stockShort: [] });
    expect(net.tables.production_records[0]).toMatchObject({ actual_output_g: 1500 });
    const readBack = net.sent("production_records", "GET").at(-1)!;
    // Every column (deduct_batches too, which may not exist before its migration)
    expect(readBack.query.select[0]).toBe("*");
  });
});
