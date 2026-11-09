import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { FakeNetwork, net } from "./fake-network";

/**
 * A recipe line's delivery amount (menu_bom.delivery_qty) through the real client: read and
 * written with the line, and before the migration (no column: PGRST204) the line still
 * saves — a filled delivery amount is reported as not saved.
 */
vi.mock("@/integrations/supabase/client", async () => ({ supabase: (await import("./fake-network")).net.client }));
const toasts = vi.hoisted(() => {
  const log: [string, string][] = [];
  const mk = (k: string) => (m: unknown) => void log.push([k, String(m)]);
  return { log, toast: Object.assign(mk("toast"), { success: mk("success"), error: mk("error"), info: mk("info"), warning: mk("warning") }) };
});
vi.mock("sonner", () => ({ toast: toasts.toast }));

import { useMenuBomData } from "@/hooks/use-menu-bom-data";

const MISSING = { kind: "refuse" as const, status: 400, code: "PGRST204", message: "Could not find the 'delivery_qty' column of 'menu_bom' in the schema cache" };
const names = (r: { body?: unknown }) => !!r.body && typeof r.body === "object" && "delivery_qty" in (r.body as object);
const row = (id: string, extra: Record<string, unknown> = {}) => ({ id, menu_id: "m1", sku_id: "s-" + id, qty_per_serving: 300, uom: "g", yield_pct: 100, effective_qty: 300, cost_per_serving: 1, branch_id: null, created_at: "2026-11-01", ...extra });

beforeEach(() => {
  net.reset();
  toasts.log.length = 0;
  try {
    localStorage.clear();
  } catch {
    // no storage in this environment
  }
});

describe("useMenuBomData with the delivery amount", () => {
  it("reads it (absent column = null), writes it on update", async () => {
    net.seed("menu_bom", [row("l1", { delivery_qty: 240 }), row("l2")]);
    const h = renderHook(() => useMenuBomData());
    await waitFor(() => expect(h.result.current.lines).toHaveLength(2));
    expect(h.result.current.lines.map((l) => l.deliveryQty)).toEqual([240, null]);

    await act(async () => {
      expect(await h.result.current.updateLine("l2", { qtyPerServing: 300, deliveryQty: 200 })).toBe(true);
    });
    const [patch] = net.sent("menu_bom", "PATCH");
    expect(patch.body).toMatchObject({ qty_per_serving: 300, delivery_qty: 200 });
    expect(h.result.current.lines.find((l) => l.id === "l2")?.deliveryQty).toBe(200);
  });

  it("a new line without a delivery amount never names the column", async () => {
    net.seed("menu_bom", []);
    net.fault(MISSING, (r) => FakeNetwork.to("menu_bom", "POST")(r) && names(r));
    const h = renderHook(() => useMenuBomData());
    await waitFor(() => expect(h.result.current.loading).toBe(false));
    await act(async () => {
      expect(await h.result.current.addLine({ menuId: "m1", skuId: "s", qtyPerServing: 1, uom: "g", yieldPct: 100, effectiveQty: 1, costPerServing: 0, branchId: null, deliveryQty: null })).toBe(true);
    });
    expect(toasts.log.filter(([k]) => k === "error")).toEqual([]);
  });

  it("before the migration: the line still saves, a filled delivery amount is reported as not saved", async () => {
    net.seed("menu_bom", [row("l1")]);
    net.fault(MISSING, (r) => FakeNetwork.to("menu_bom", "PATCH")(r) && names(r));
    const h = renderHook(() => useMenuBomData());
    await waitFor(() => expect(h.result.current.lines).toHaveLength(1));
    await act(async () => {
      expect(await h.result.current.updateLine("l1", { qtyPerServing: 280, deliveryQty: 200 })).toBe(true);
    });
    expect(h.result.current.lines[0].qtyPerServing).toBe(280);
    expect(h.result.current.lines[0].deliveryQty).toBeNull();
    expect(toasts.log).toContainEqual(["error", expect.stringContaining("ปริมาณเดลิเวอรี")]);
  });
});

describe("useMenuBomData with delivery-only lines", () => {
  const MISSING_ONLY = { kind: "refuse" as const, status: 400, code: "PGRST204", message: "Could not find the 'delivery_only' column of 'menu_bom' in the schema cache" };
  const namesOnly = (r: { body?: unknown }) => !!r.body && typeof r.body === "object" && "delivery_only" in (r.body as object);
  const add = { menuId: "m1", skuId: "box", qtyPerServing: 1, uom: "pc", yieldPct: 100, effectiveQty: 1, costPerServing: 3, branchId: null, deliveryOnly: true, deliveryQty: null };

  it("reads delivery_only (absent column = false) and inserts a delivery-only line with it", async () => {
    net.seed("menu_bom", [row("l1", { delivery_only: true }), row("l2")]);
    const h = renderHook(() => useMenuBomData());
    await waitFor(() => expect(h.result.current.lines).toHaveLength(2));
    expect(h.result.current.lines.map((l) => l.deliveryOnly)).toEqual([true, false]);
    await act(async () => {
      expect(await h.result.current.addLine(add)).toBe(true);
    });
    const [post] = net.sent("menu_bom", "POST");
    expect(post.body).toMatchObject({ sku_id: "box", delivery_only: true });
    expect(h.result.current.lines.find((l) => l.skuId === "box")?.deliveryOnly).toBe(true);
  });

  it("before the migration a delivery-only line is refused with a Thai message, never saved as a shop line", async () => {
    net.seed("menu_bom", []);
    net.fault(MISSING_ONLY, (r) => FakeNetwork.to("menu_bom", "POST")(r) && namesOnly(r));
    const h = renderHook(() => useMenuBomData());
    await waitFor(() => expect(h.result.current.loading).toBe(false));
    await act(async () => {
      expect(await h.result.current.addLine(add)).toBe(false);
    });
    expect(net.sent("menu_bom", "POST")).toHaveLength(1);
    expect(h.result.current.lines).toEqual([]);
    expect(toasts.log).toContainEqual(["error", expect.stringContaining("เฉพาะเดลิเวอรี")]);
  });

  it("an import replaces the shop recipe and keeps the delivery-only lines", async () => {
    net.seed("menu_bom", [row("l1"), row("l2", { delivery_only: true })]);
    const h = renderHook(() => useMenuBomData());
    await waitFor(() => expect(h.result.current.lines).toHaveLength(2));
    await act(async () => {
      expect(await h.result.current.replaceShared("m1", [{ skuId: "s-new", qtyPerServing: 5, uom: "g", yieldPct: 100, effectiveQty: 5, costPerServing: 1 }])).toBe(true);
    });
    // The database filter keeps delivery-only lines, also ones this screen hasn't loaded
    const [del] = net.sent("menu_bom", "DELETE");
    expect(del.query.delivery_only).toEqual(["eq.false"]);
    expect(h.result.current.lines.map((l) => l.skuId).sort()).toEqual(["s-l2", "s-new"]);
  });

  it("an import without the delivery_only column still replaces the recipe (plain delete)", async () => {
    net.seed("menu_bom", [row("l1")]);
    net.fault({ kind: "refuse", status: 400, code: "42703", message: "column menu_bom.delivery_only does not exist" }, (r) => FakeNetwork.to("menu_bom", "DELETE")(r) && "delivery_only" in r.query);
    const h = renderHook(() => useMenuBomData());
    await waitFor(() => expect(h.result.current.lines).toHaveLength(1));
    await act(async () => {
      expect(await h.result.current.replaceShared("m1", [{ skuId: "s-new", qtyPerServing: 5, uom: "g", yieldPct: 100, effectiveQty: 5, costPerServing: 1 }])).toBe(true);
    });
    const dels = net.sent("menu_bom", "DELETE");
    expect(dels).toHaveLength(2);
    expect(dels[1].query.delivery_only).toBeUndefined();
    expect(h.result.current.lines.map((l) => l.skuId)).toEqual(["s-new"]);
  });

  it("an import that lists an item already delivery-only is refused before anything is written", async () => {
    net.seed("menu_bom", [row("l1"), row("l2", { delivery_only: true })]);
    const h = renderHook(() => useMenuBomData());
    await waitFor(() => expect(h.result.current.lines).toHaveLength(2));
    await act(async () => {
      expect(await h.result.current.replaceShared("m1", [{ skuId: "s-l2", qtyPerServing: 1, uom: "pc", yieldPct: 100, effectiveQty: 1, costPerServing: 1 }])).toBe(false);
    });
    expect(net.sent("menu_bom", "POST")).toHaveLength(0);
    expect(toasts.log).toContainEqual(["error", expect.stringContaining("ตัดซ้ำ")]);
  });
});
