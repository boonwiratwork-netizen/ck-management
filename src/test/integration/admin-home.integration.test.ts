import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { FakeNetwork, net } from "./fake-network";

/**
 * หน้าแรกผู้บริหาร's data hook through the real client: which reads go out (one per branch
 * for the big tables, one for the rest, the order lines in a second wave — no read per
 * row), that a failed read is an error and not zeros, and that a revisit shows the kept
 * copy at once.
 */
vi.mock("@/integrations/supabase/client", async () => ({ supabase: (await import("./fake-network")).net.client }));

import { useAdminHome } from "@/hooks/use-admin-home";
import { clearPageCache } from "@/lib/page-cache";
import type { AdminMasters } from "@/lib/admin-home";

const TODAY = "2026-11-06";
const NOW = Date.parse("2026-11-06T10:00:00+07:00");
const masters: AdminMasters = {
  skus: [{ id: "s", skuId: "RM-1", name: "หมู", type: "RM", category: "", status: "Active", specNote: "", packSize: 1, packUnit: "", purchaseUom: "ก.", usageUom: "ก.", converter: 1, storageCondition: "Chilled", shelfLife: 0, vat: false, supplier1: "", supplier2: "", leadTime: 0, isDistributable: false }],
  prices: [{ id: "p", skuId: "s", supplierId: "x", pricePerPurchaseUom: 0, pricePerUsageUom: 0.2, vat: false, isActive: true, effectiveDate: "", note: "" }],
  menus: [],
  menuBomLines: [],
  modifierRules: [],
  spBomLines: [],
  branches: [
    { id: "b1", branchName: "Thaniya", brandName: "Sendo", location: "", status: "Active", avgSellingPrice: null },
    { id: "b2", branchName: "Shiro", brandName: "Shiro", location: "", status: "Active", avgSellingPrice: null },
  ],
};
const opts = { today: TODAY, nowMs: NOW };

beforeEach(() => {
  net.reset();
  clearPageCache();
  // Yesterday b1 closed on time, b2 never finished
  net.seed("daily_stock_counts", [
    { id: "c1", branch_id: "b1", count_date: "2026-11-05", sku_id: "s", physical_count: 5, variance: 0, waste: 0, expected_usage: 0, is_submitted: true, submitted_at: "2026-11-05T14:00:00Z" },
    { id: "c2", branch_id: "b2", count_date: "2026-11-05", sku_id: "s", physical_count: 5, variance: 0, waste: 0, expected_usage: 0, is_submitted: false, submitted_at: null },
  ]);
  net.seed("sales_entries", [{ id: "e1", branch_id: "b1", sale_date: "2026-11-05", created_at: "2026-11-05T15:00:00Z", net_amount: 500, menu_code: "X", menu_name: "X", qty: 1, receipt_no: "1" }]);
  net.seed("transfer_orders", [
    { id: "t1", branch_id: "b1", to_number: "TO-1", status: "Received", sent_at: "2026-11-04T01:00:00Z", delivery_date: "2026-11-04", total_value: 100 },
    { id: "t2", branch_id: "b2", to_number: "TO-2", status: "Sent", sent_at: "2026-11-03T01:00:00Z", delivery_date: "2026-11-03", total_value: 4003 },
  ]);
  net.seed("transfer_order_lines", [{ id: "l1", to_id: "t1", sku_id: "s", tr_line_id: "r", planned_qty: 10, actual_qty: 10, packs_count: null, unit_cost: 1, uom: "ก." }]);
  net.seed("branch_receipts", [{ id: "r1", transfer_order_id: "t1", created_at: "2026-11-04T05:00:00Z", receipt_date: "2026-11-04" }]);
});

describe("useAdminHome", () => {
  it("holds the view until prices are loaded (never priced at ฿0 by a missing load)", async () => {
    const h = renderHook(({ m }) => useAdminHome(m, "week", undefined, opts), { initialProps: { m: { ...masters, prices: [] } } });
    await waitFor(() => expect(net.sent("sales_entries", "GET").length).toBe(2));
    await new Promise((r) => setTimeout(r, 50));
    expect(h.result.current.view).toBeNull();
    expect(h.result.current.loading).toBe(true);
    h.rerender({ m: masters });
    await waitFor(() => expect(h.result.current.view).not.toBeNull());
  });

  it("month-end count is judged by the kitchen cost read: ≥50% of the RM items in the month's production recipes", async () => {
    // October: one kitchen item made from two RM items; the month-end session counted one of them (50%)
    net.seed("skus", [
      { id: "sm", type: "SM", converter: 1 },
      { id: "rm1", type: "RM", converter: 1 },
      { id: "rm2", type: "RM", converter: 1 },
    ]);
    net.seed("bom_headers", [{ id: "h", sm_sku_id: "sm", bom_mode: "simple", batch_size: 1000, yield_percent: 1, production_type: "CK" }]);
    net.seed("bom_lines", [
      { id: "bl1", bom_header_id: "h", rm_sku_id: "rm1", qty_per_batch: 500, yield_percent: 1, step_id: null, qty_type: null, percent_of_input: null },
      { id: "bl2", bom_header_id: "h", rm_sku_id: "rm2", qty_per_batch: 500, yield_percent: 1, step_id: null, qty_type: null, percent_of_input: null },
    ]);
    net.seed("production_records", [{ id: "pr", sm_sku_id: "sm", production_date: "2026-10-10", actual_output_g: 1000, created_at: "2026-10-10T05:00:00Z" }]);
    net.seed("stock_count_sessions", [{ id: "ss1", count_date: "2026-10-31", status: "Completed", deleted_at: null, completed_at: "2026-10-31T10:00:00Z", count_timing: null }]);
    net.seed("stock_count_lines", [{ id: "x1", session_id: "ss1", sku_id: "rm1", type: "RM", physical_qty: 3 }]);
    const h = renderHook(() => useAdminHome(masters, "week", undefined, opts));
    await waitFor(() => expect(h.result.current.view!.teams.find((t) => t.id === "ck")!.metrics.find((m) => m.id === "monthCount")!.display).toBe("ครบ"), { timeout: 3000 });
    // The page reads no count lines of its own (one source with the kitchen page)
    expect(net.sent("stock_count_lines", "GET").every((r) => r.query.session_id?.[0].startsWith("eq."))).toBe(true);

    // Under half (the session counted nothing of October's RM items): ไม่ครบ
    clearPageCache();
    net.seed("stock_count_lines", [{ id: "x2", session_id: "ss1", sku_id: "other", type: "RM", physical_qty: 3 }]);
    const h2 = renderHook(() => useAdminHome(masters, "week", undefined, opts));
    await waitFor(() => expect(h2.result.current.view!.teams.find((t) => t.id === "ck")!.metrics.find((m) => m.id === "monthCount")!.display).toBe("ไม่ครบ"), { timeout: 3000 });
  });

  it("reads once: big tables per branch side by side, the rest once each, order lines by id in a second wave", async () => {
    const h = renderHook(() => useAdminHome(masters, "week", undefined, opts));
    await waitFor(() => expect(h.result.current.view).not.toBeNull());
    const gets = (t: string) => net.sent(t, "GET");
    expect(gets("sales_entries")).toHaveLength(2);
    expect(gets("daily_stock_counts")).toHaveLength(2);
    expect(gets("transfer_orders")).toHaveLength(1);
    expect(gets("branch_receipts")).toHaveLength(1);
    expect(gets("transfer_order_lines")).toHaveLength(1);
    expect(gets("transfer_order_lines")[0].query.to_id[0]).toContain("t1");
    expect(gets("weekly_plan_lines")).toHaveLength(1);
    // The page's bills read (the kitchen month cost reads its own, one per closed month)
    expect(gets("goods_receipts").filter((r) => /supplier_id.*created_at/.test(r.query.select?.[0] ?? ""))).toHaveLength(1);
    expect(net.writes).toHaveLength(0);

    const v = h.result.current.view!;
    const b1 = v.teams.find((t) => t.id === "b1")!;
    const b2 = v.teams.find((t) => t.id === "b2")!;
    expect(b1.metrics.find((m) => m.id === "receive")!.display).toBe("1/1");
    expect(b2.metrics.find((m) => m.id === "receive")!.display).toBe("0/1");
    // Only yesterday has a sheet and sales; the 6 days before had neither → closed, not judged
    expect(b1.metrics.find((m) => m.id === "countOnTime")!.display).toBe("1/1");
    expect(v.attention.some((a) => a.key === "to-t2")).toBe(true);
    expect(v.teams.find((t) => t.id === "ck")!.metrics.find((m) => m.id === "fill")!.display).toBe("100%");
  });

  it("a failed read is an error, never zeros", async () => {
    net.fault({ kind: "refuse" }, FakeNetwork.to("sales_entries"));
    const h = renderHook(() => useAdminHome(masters, "week", undefined, opts));
    await waitFor(() => expect(h.result.current.error).toBe(true));
    expect(h.result.current.view).toBeNull();
  });

  it("a revisit shows the kept copy at once, then reads again behind it", async () => {
    const first = renderHook(() => useAdminHome(masters, "week", undefined, opts));
    await waitFor(() => expect(first.result.current.view).not.toBeNull());
    first.unmount();
    net.requests = [];
    const again = renderHook(() => useAdminHome(masters, "month", undefined, opts));
    // First render: already there (no skeleton), refreshing behind it
    expect(again.result.current.view).not.toBeNull();
    expect(again.result.current.view!.period.kind).toBe("month");
    await waitFor(() => expect(again.result.current.loading).toBe(false));
    expect(net.sent("sales_entries", "GET").length).toBeGreaterThan(0);
  });
});
