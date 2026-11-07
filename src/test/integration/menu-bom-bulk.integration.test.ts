import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { FakeNetwork, net, settles } from "./fake-network";

/**
 * "ใช้ในเมนู" bulk save (useMenuBomData.updateLines) through the real client: each line is
 * its own PATCH with yield/effective/cost only (qty_per_serving is never sent from a bulk yield
 * change; a single-line edit of the qty does send it), a line row security filtered out (200, no
 * rows — e.g. ck_manager before the policy migration) or refused counts as NOT saved, the
 * result says how many of how many, and only the saved lines change on screen.
 */
vi.mock("@/integrations/supabase/client", async () => ({ supabase: (await import("./fake-network")).net.client }));
const toasts = vi.hoisted(() => {
  const log: [string, string][] = [];
  const mk = (k: string) => (m: unknown) => void log.push([k, String(m)]);
  return { log, toast: Object.assign(mk("toast"), { success: mk("success"), error: mk("error"), info: mk("info"), warning: mk("warning") }) };
});
vi.mock("sonner", () => ({ toast: toasts.toast }));

import { NOT_UPDATED, useMenuBomData } from "@/hooks/use-menu-bom-data";
import { NO_ANSWER } from "@/lib/write-timeout";
import { lineValues } from "@/lib/usage-matrix";

const row = (id: string, yieldPct = 35, qty = 7) => ({ id, menu_id: `m-${id}`, sku_id: "onion", qty_per_serving: qty, uom: "ก.", yield_pct: yieldPct, effective_qty: qty / (yieldPct / 100), cost_per_serving: 0, branch_id: null, created_at: "2026-01-01" });
/** A bulk yield change, as the matrix sends it: no qty */
const change = (id: string, yieldPct: number, qty = 7) => {
  const { qtyPerServing: _qty, ...rest } = lineValues(qty, yieldPct, 0.1);
  return { id, ...rest };
};

beforeEach(() => {
  net.reset();
  toasts.log.length = 0;
  try {
    localStorage.clear();
  } catch {
    // no storage in this environment
  }
});

async function loaded() {
  const h = renderHook(() => useMenuBomData());
  await waitFor(() => expect(h.result.current.loading).toBe(false));
  return h;
}

describe("menu recipe bulk yield save", () => {
  it("writes each line's yield, effective qty and cost (never its qty); all saved", async () => {
    net.seed("menu_bom", [row("a"), row("b"), row("c", 100)]);
    const h = await loaded();
    let r!: Awaited<ReturnType<typeof h.result.current.updateLines>>;
    await act(async () => {
      r = await settles(h.result.current.updateLines([change("a", 100), change("b", 100)]));
    });
    expect(r.saved.sort()).toEqual(["a", "b"]);
    expect(r.failed).toEqual([]);
    const patches = net.sent("menu_bom", "PATCH");
    expect(patches).toHaveLength(2);
    expect(patches[0].body).toEqual({ yield_pct: 100, effective_qty: 7, cost_per_serving: expect.closeTo(0.7, 6) });
    expect(patches.every((p) => !("qty_per_serving" in (p.body as object)))).toBe(true);
    expect(patches[0].prefer).toContain("return=representation");
    expect(net.tables.menu_bom.find((x) => x.id === "c")?.yield_pct).toBe(100);
    expect(net.tables.menu_bom.find((x) => x.id === "a")?.yield_pct).toBe(100);
    expect(h.result.current.lines.find((l) => l.id === "a")).toMatchObject({ qtyPerServing: 7, yieldPct: 100, effectiveQty: 7 });
    // Only the lines asked for: never a write to bom_lines / sp_bom
    expect(net.writes.every((w) => w.target === "menu_bom")).toBe(true);
  });

  it("a qty someone changed meanwhile is not put back by a bulk yield change", async () => {
    net.seed("menu_bom", [row("a")]);
    const h = await loaded();
    // Someone else sets the qty to 9 after this screen loaded 7
    net.tables.menu_bom.find((x) => x.id === "a")!.qty_per_serving = 9;
    await act(async () => {
      await settles(h.result.current.updateLines([change("a", 100)]));
    });
    expect(net.tables.menu_bom.find((x) => x.id === "a")?.qty_per_serving).toBe(9);
  });

  it("a single-line edit of the qty does write the qty", async () => {
    net.seed("menu_bom", [row("a")]);
    const h = await loaded();
    await act(async () => {
      await settles(h.result.current.updateLines([{ id: "a", ...lineValues(8, 100, 0.1) }]));
    });
    expect(net.sent("menu_bom", "PATCH")[0].body).toMatchObject({ qty_per_serving: 8, yield_pct: 100, effective_qty: 8 });
    expect(h.result.current.lines.find((l) => l.id === "a")).toMatchObject({ qtyPerServing: 8 });
  });

  it("partial failure: filtered-out and refused lines are reported, not claimed as saved", async () => {
    net.seed("menu_bom", [row("a"), row("b"), row("c"), row("d")]);
    const h = await loaded();
    net.fault({ kind: "filtered" }, (q) => q.target === "menu_bom" && q.method === "PATCH" && q.query.id?.[0] === "eq.b");
    net.fault({ kind: "refuse", code: "42501", message: "permission denied" }, (q) => q.target === "menu_bom" && q.method === "PATCH" && q.query.id?.[0] === "eq.c");
    let r!: Awaited<ReturnType<typeof h.result.current.updateLines>>;
    await act(async () => {
      r = await settles(h.result.current.updateLines(["a", "b", "c", "d"].map((id) => change(id, 90))));
    });
    expect(r.saved.sort()).toEqual(["a", "d"]);
    expect(r.failed).toEqual(expect.arrayContaining([{ id: "b", reason: NOT_UPDATED }, { id: "c", reason: "permission denied" }]));
    expect(r.failed).toHaveLength(2);
    // Screen: saved lines changed, failed ones stay as they were
    const y = (id: string) => h.result.current.lines.find((l) => l.id === id)?.yieldPct;
    expect([y("a"), y("b"), y("c"), y("d")]).toEqual([90, 35, 35, 90]);
  });

  it("everything filtered out (no right to edit): nothing saved, nothing changed on screen", async () => {
    net.seed("menu_bom", [row("a"), row("b")]);
    const h = await loaded();
    net.fault({ kind: "filtered" }, FakeNetwork.to("menu_bom", "PATCH"));
    let r!: Awaited<ReturnType<typeof h.result.current.updateLines>>;
    await act(async () => {
      r = await settles(h.result.current.updateLines([change("a", 100), change("b", 100)]));
    });
    expect(r.saved).toEqual([]);
    expect(r.failed.map((f) => f.reason)).toEqual([NOT_UPDATED, NOT_UPDATED]);
    expect(h.result.current.lines.map((l) => l.yieldPct)).toEqual([35, 35]);
  });

  it("no answer: the time limit ends the wait and the line says so (no endless spinner)", async () => {
    net.seed("menu_bom", [row("a"), row("b")]);
    const h = await loaded();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      net.fault({ kind: "stall" }, (q) => q.target === "menu_bom" && q.method === "PATCH" && q.query.id?.[0] === "eq.b");
      let r!: Awaited<ReturnType<typeof h.result.current.updateLines>>;
      await act(async () => {
        const p = h.result.current.updateLines([change("a", 100), change("b", 100)]);
        await vi.advanceTimersByTimeAsync(21_000);
        r = await settles(p);
      });
      expect(r.saved).toEqual(["a"]);
      expect(r.failed).toEqual([{ id: "b", reason: NO_ANSWER }]);
    } finally {
      vi.useRealTimers();
    }
  });
});
