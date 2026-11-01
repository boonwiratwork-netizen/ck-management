import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { cacheForUser, clearPageCache, forgetTables, keep, lastSeen, sharedRead, useKeepLastSeen, useKept, writtenTables } from "./page-cache";
import { installWriteGuard } from "./base-cache";
import { supabaseBranchStockLoader, useBranchStock, type BranchStockData } from "@/hooks/use-branch-stock";
import { RefreshNote } from "@/components/RefreshNote";
import type { SKU } from "@/types/sku";

beforeEach(() => clearPageCache());

describe("which tables a request writes", () => {
  it("reads write nothing; table writes name their table; functions drop everything but the number one", () => {
    expect(writtenTables("https://x.supabase.co/rest/v1/branch_receipts?select=*", "GET")).toBeNull();
    expect(writtenTables("https://x.supabase.co/rest/v1/branch_receipts?select=*", "HEAD")).toBeNull();
    expect(writtenTables("https://x.supabase.co/rest/v1/branch_receipts?select=*", "POST")).toEqual(["branch_receipts"]);
    expect(writtenTables("https://x.supabase.co/rest/v1/daily_stock_counts?id=eq.1", "PATCH")).toEqual(["daily_stock_counts"]);
    expect(writtenTables("https://x.supabase.co/rest/v1/rpc/receive_transfer_order", "POST")).toBe("all");
    expect(writtenTables("https://x.supabase.co/rest/v1/rpc/next_doc_number", "POST")).toBeNull();
    expect(writtenTables("https://x.supabase.co/auth/v1/token", "POST")).toBeNull();
  });
});

describe("kept copies are dropped by any write to their tables", () => {
  it("through the app's fetch: a write drops the copies made from that table only, reads drop nothing", async () => {
    window.fetch = vi.fn(async () => new Response("[]")) as typeof fetch;
    installWriteGuard();
    keep("count|b1|2026-11-01", ["daily_stock_counts", "branch_receipts"], [1]);
    keep("transfer-queue", ["transfer_orders"], [2]);
    await window.fetch("https://x.supabase.co/rest/v1/branch_receipts?select=*");
    expect(lastSeen("count|b1|2026-11-01")).not.toBeNull();
    await window.fetch("https://x.supabase.co/rest/v1/branch_receipts", { method: "POST" });
    expect(lastSeen("count|b1|2026-11-01")).toBeNull();
    expect(lastSeen("transfer-queue")?.value).toEqual([2]);
    // A database function may write anywhere
    await window.fetch("https://x.supabase.co/rest/v1/rpc/decline_transfer_order", { method: "POST" });
    expect(lastSeen("transfer-queue")).toBeNull();
  });

  it("a write that fails still drops them (it may have landed)", async () => {
    window.fetch = vi.fn(async () => {
      throw new TypeError("network");
    }) as typeof fetch;
    (window as { __ckWriteGuard?: boolean }).__ckWriteGuard = false;
    installWriteGuard();
    keep("receive|b1|x", ["branch_receipts"], [1]);
    await expect(window.fetch("https://x.supabase.co/rest/v1/branch_receipts", { method: "POST" })).rejects.toThrow();
    expect(lastSeen("receive|b1|x")).toBeNull();
  });
});

describe("master data shared across pages", () => {
  it("is read once, again when older than its limit, after a write to its tables, or after a failure", async () => {
    const load = vi.fn(async () => "rows");
    await sharedRead("usage", ["menu_bom"], load, 1000, 0);
    await sharedRead("usage", ["menu_bom"], load, 1000, 500);
    expect(load).toHaveBeenCalledTimes(1);
    await sharedRead("usage", ["menu_bom"], load, 1000, 2000);
    expect(load).toHaveBeenCalledTimes(2);
    forgetTables(["menu_bom"]);
    await sharedRead("usage", ["menu_bom"], load, 1000, 2001);
    expect(load).toHaveBeenCalledTimes(3);
    const failing = vi.fn(async () => {
      throw new Error("x");
    });
    await expect(sharedRead("other", ["skus"], failing)).rejects.toThrow();
    await expect(sharedRead("other", ["skus"], failing)).rejects.toThrow();
    expect(failing).toHaveBeenCalledTimes(2);
  });
});

describe("useKept", () => {
  it("shows the kept copy only until the hook's own value is loaded for that key", () => {
    keep("k", ["t"], "old");
    const { result, rerender } = renderHook(({ v, fresh }) => useKept("k", ["t"], v, fresh), { initialProps: { v: "", fresh: false } });
    expect(result.current).toEqual({ value: "old", kept: true });
    rerender({ v: "new", fresh: true });
    expect(result.current).toEqual({ value: "new", kept: false });
    expect(lastSeen("k")?.value).toBe("new");
  });

  it("the page that saved keeps its own (post-save) copy when it closes; others stay dropped", () => {
    keep("other-page", ["t"], "pre-save");
    const open = renderHook(() => useKeepLastSeen("p", ["t"], "post-save"));
    forgetTables(["t"]);
    expect(lastSeen("p")).toBeNull();
    open.unmount();
    expect(lastSeen("p")?.value).toBe("post-save");
    expect(lastSeen("other-page")).toBeNull();
  });

  it("never keeps a value marked not to keep (a read that partly failed)", () => {
    renderHook(() => useKept("k2", ["t"], "partial", true, false));
    expect(lastSeen("k2")).toBeNull();
  });
});

describe("a daily page coming back (branch stock)", () => {
  const sku = { id: "s1", skuId: "RM-1", name: "หมู", type: "RM", purchaseUom: "kg", usageUom: "g", converter: 1000, packSize: 1, status: "Active" } as unknown as SKU;
  const data: BranchStockData = {
    counts: [{ sku_id: "s1", count_date: "2026-10-31", physical_count: 500 }],
    receipts: [],
    adjustments: [],
    waste: [],
    usageByDay: {},
    sellingDays: 0,
    prices: new Map([["s1", 0.2]]),
  };
  // One list for every render, as the app passes it (a new array each render would re-read)
  const skus = [sku];
  afterEach(() => vi.restoreAllMocks());

  it("shows the last rows at once with the refresh note, then the fresh ones", async () => {
    vi.spyOn(supabaseBranchStockLoader, "load").mockResolvedValue(data);
    const first = renderHook(() => useBranchStock("b1", skus));
    await waitFor(() => expect(first.result.current.rows).not.toBeNull());
    first.unmount();

    let finish!: (d: BranchStockData) => void;
    vi.spyOn(supabaseBranchStockLoader, "load").mockReturnValue(new Promise((r) => (finish = r)));
    const again = renderHook(() => useBranchStock("b1", skus));
    // No skeleton: the kept rows are up while the read runs, flagged as refreshing
    expect(again.result.current.rows).toHaveLength(1);
    expect(again.result.current.refreshing).toBe(true);
    render(createElement(RefreshNote, { refreshing: again.result.current.refreshing }));
    expect(screen.getByRole("status").textContent).toContain("กำลังอัปเดต");
    await act(async () => finish(data));
    expect(again.result.current.refreshing).toBe(false);
  });

  it("a failed refresh says the rows on screen are the earlier ones", async () => {
    vi.spyOn(supabaseBranchStockLoader, "load").mockResolvedValue(data);
    const first = renderHook(() => useBranchStock("b1", skus));
    await waitFor(() => expect(first.result.current.rows).not.toBeNull());
    first.unmount();

    vi.spyOn(supabaseBranchStockLoader, "load").mockRejectedValue(new Error("offline"));
    const again = renderHook(() => useBranchStock("b1", skus));
    await waitFor(() => expect(again.result.current.error).not.toBeNull());
    expect(again.result.current.rows).toHaveLength(1);
    render(createElement(RefreshNote, { refreshing: false, failed: !!again.result.current.error && !!again.result.current.rows }));
    expect(screen.getByRole("alert").textContent).toContain("ตัวเลขที่เห็นเป็นของรอบก่อน");
  });

  it("after a save to its tables (anywhere) it opens on a full read, never the pre-save rows", async () => {
    vi.spyOn(supabaseBranchStockLoader, "load").mockResolvedValue(data);
    const first = renderHook(() => useBranchStock("b1", skus));
    await waitFor(() => expect(first.result.current.rows).not.toBeNull());
    first.unmount();

    // e.g. a receipt saved on the receive page
    forgetTables(writtenTables("https://x.supabase.co/rest/v1/branch_receipts", "POST")!);
    vi.spyOn(supabaseBranchStockLoader, "load").mockReturnValue(new Promise(() => undefined));
    const again = renderHook(() => useBranchStock("b1", skus));
    expect(again.result.current.rows).toBeNull();
    expect(again.result.current.refreshing).toBe(false);
  });

  it("another branch never shows this branch's kept rows", async () => {
    vi.spyOn(supabaseBranchStockLoader, "load").mockResolvedValue(data);
    const first = renderHook(() => useBranchStock("b1", skus));
    await waitFor(() => expect(first.result.current.rows).not.toBeNull());
    first.unmount();
    vi.spyOn(supabaseBranchStockLoader, "load").mockReturnValue(new Promise(() => undefined));
    const other = renderHook(() => useBranchStock("b2", skus));
    expect(other.result.current.rows).toBeNull();
  });
});

describe("kept copies belong to one signed-in person", () => {
  it("dropped when the session is gone (expiry, sign-out in another tab) or another person signs in; a token refresh keeps them", () => {
    cacheForUser("u1");
    keep("today|b1|2026-11-01", ["sales_entries"], 1);
    cacheForUser("u1"); // token refreshed: same person
    expect(lastSeen("today|b1|2026-11-01")).not.toBeNull();
    cacheForUser(null);
    expect(lastSeen("today|b1|2026-11-01")).toBeNull();
    cacheForUser("u1");
    keep("today|b1|2026-11-01", ["sales_entries"], 1);
    cacheForUser("u2");
    expect(lastSeen("today|b1|2026-11-01")).toBeNull();
  });
});
