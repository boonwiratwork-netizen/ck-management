import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { FakeNetwork, net, settles } from "./fake-network";

/**
 * "สเปค / หมายเหตุสำหรับหน้าร้าน" on a recipe line through the real client: the note is
 * written to menu_bom/bom_lines.spec_note on its own, a filtered-out update (row security)
 * counts as not saved, and before the migration (no column: PGRST204) the screen says what
 * is missing — the recipe itself still reads and saves.
 */
vi.mock("@/integrations/supabase/client", async () => ({ supabase: (await import("./fake-network")).net.client }));
const toasts = vi.hoisted(() => {
  const log: [string, string][] = [];
  const mk = (k: string) => (m: unknown) => void log.push([k, String(m)]);
  return { log, toast: Object.assign(mk("toast"), { success: mk("success"), error: mk("error"), info: mk("info"), warning: mk("warning") }) };
});
vi.mock("sonner", () => ({ toast: toasts.toast }));

import { saveLineSpecNote } from "@/lib/recipe-note-db";
import { useMenuBomData } from "@/hooks/use-menu-bom-data";

const MISSING = { kind: "refuse" as const, status: 400, code: "PGRST204", message: "Could not find the 'spec_note' column of 'menu_bom' in the schema cache" };

beforeEach(() => {
  net.reset();
  toasts.log.length = 0;
  try {
    localStorage.clear();
  } catch {
    // no storage in this environment
  }
});

describe("saving a recipe line's note", () => {
  it("menu_bom: writes spec_note (trimmed) for that line only and reads the row back", async () => {
    net.seed("menu_bom", [{ id: "l1", menu_id: "m1", sku_id: "s1" }, { id: "l2", menu_id: "m1", sku_id: "s2" }]);
    const r = await settles(saveLineSpecNote("menu_bom", "l1", "  หั่นเต๋า 1 ซม.  "));
    expect(r).toEqual({ kind: "ok", note: "หั่นเต๋า 1 ซม." });
    const [patch] = net.sent("menu_bom", "PATCH");
    expect(patch.body).toEqual({ spec_note: "หั่นเต๋า 1 ซม." });
    expect(patch.query.id).toEqual(["eq.l1"]);
    expect(patch.prefer).toContain("return=representation");
    expect(net.tables.menu_bom.find((x) => x.id === "l2")?.spec_note).toBeUndefined();
  });

  it("bom_lines: an empty note clears it (null, not '')", async () => {
    net.seed("bom_lines", [{ id: "b1", bom_header_id: "h", rm_sku_id: "s", spec_note: "เก่า" }]);
    expect(await settles(saveLineSpecNote("bom_lines", "b1", "   "))).toEqual({ kind: "ok", note: "" });
    expect(net.tables.bom_lines[0].spec_note).toBeNull();
  });

  it("row security filtered the update out (200, no rows): not saved", async () => {
    net.seed("bom_lines", [{ id: "b1" }]);
    net.fault({ kind: "filtered" }, FakeNetwork.to("bom_lines", "PATCH"));
    expect(await settles(saveLineSpecNote("bom_lines", "b1", "x"))).toEqual({ kind: "not-saved" });
  });

  it("column not there yet (migration not run): told apart from other errors", async () => {
    net.seed("menu_bom", [{ id: "l1" }]);
    net.fault(MISSING, FakeNetwork.to("menu_bom", "PATCH"));
    expect(await settles(saveLineSpecNote("menu_bom", "l1", "x"))).toEqual({ kind: "missing-column" });
    net.reset();
    net.seed("menu_bom", [{ id: "l1" }]);
    net.fault({ kind: "refuse", code: "42501" }, FakeNetwork.to("menu_bom", "PATCH"));
    expect(await settles(saveLineSpecNote("menu_bom", "l1", "x"))).toMatchObject({ kind: "error" });
  });

  it("no answer: the time limit ends the wait (no endless spinner)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      net.seed("menu_bom", [{ id: "l1" }]);
      net.fault({ kind: "stall" }, FakeNetwork.to("menu_bom", "PATCH"));
      const p = saveLineSpecNote("menu_bom", "l1", "x");
      await vi.advanceTimersByTimeAsync(21_000);
      expect(await settles(p)).toMatchObject({ kind: "error" });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("useMenuBomData with the note", () => {
  it("reads lines with and without the column, saves a note into its line", async () => {
    // One row as after the migration, one as before (no spec_note key at all)
    net.seed("menu_bom", [
      { id: "l1", menu_id: "m1", sku_id: "s1", qty_per_serving: 10, uom: "g", yield_pct: 100, effective_qty: 10, cost_per_serving: 1, branch_id: null, spec_note: "เดิม", created_at: "2026-11-01" },
      { id: "l2", menu_id: "m1", sku_id: "s2", qty_per_serving: 5, uom: "g", yield_pct: 100, effective_qty: 5, cost_per_serving: 1, branch_id: null, created_at: "2026-11-02" },
    ]);
    const h = renderHook(() => useMenuBomData());
    await waitFor(() => expect(h.result.current.loading).toBe(false));
    await waitFor(() => expect(h.result.current.lines).toHaveLength(2));
    expect(h.result.current.lines.map((l) => l.specNote)).toEqual(["เดิม", ""]);

    let ok: boolean | undefined;
    await act(async () => {
      ok = await h.result.current.saveSpecNote("l2", "ไม่เอาก้าน");
    });
    expect(ok).toBe(true);
    expect(h.result.current.lines.find((l) => l.id === "l2")?.specNote).toBe("ไม่เอาก้าน");
    expect(toasts.log.filter(([k]) => k === "error")).toEqual([]);
  });

  it("before the migration: the recipe still reads, the note says what's missing and nothing changes", async () => {
    net.seed("menu_bom", [{ id: "l1", menu_id: "m1", sku_id: "s1", qty_per_serving: 10, uom: "g", yield_pct: 100, effective_qty: 10, cost_per_serving: 1, branch_id: null, created_at: "2026-11-01" }]);
    // Only a write that names spec_note fails (as PostgREST would): other columns save
    net.fault(MISSING, (r) => FakeNetwork.to("menu_bom", "PATCH")(r) && !!r.body && typeof r.body === "object" && "spec_note" in (r.body as object));
    const h = renderHook(() => useMenuBomData());
    await waitFor(() => expect(h.result.current.lines).toHaveLength(1));
    let ok: boolean | undefined;
    await act(async () => {
      ok = await h.result.current.saveSpecNote("l1", "x");
    });
    expect(ok).toBe(false);
    expect(h.result.current.lines[0].specNote).toBe("");
    expect(toasts.log).toContainEqual(["error", expect.stringContaining("ยังไม่มีช่องนี้")]);
    // The recipe line itself still saves (the note is a separate write)
    await act(async () => {
      expect(await h.result.current.updateLine("l1", { qtyPerServing: 12 })).toBe(true);
    });
  });

  it("recipe import (replaceShared) keeps each item's note; without the column it saves the recipe anyway", async () => {
    const row = (id: string, sku: string, note?: string) => ({ id, menu_id: "m1", sku_id: sku, qty_per_serving: 10, uom: "g", yield_pct: 100, effective_qty: 10, cost_per_serving: 1, branch_id: null, created_at: "2026-11-01", ...(note !== undefined && { spec_note: note }) });
    net.seed("menu_bom", [row("l1", "s1", "หั่นเต๋า"), row("l2", "s2", "")]);
    const h = renderHook(() => useMenuBomData());
    await waitFor(() => expect(h.result.current.lines).toHaveLength(2));
    const next = [{ skuId: "s1", qtyPerServing: 12, uom: "g", yieldPct: 100, effectiveQty: 12, costPerServing: 1 }, { skuId: "s3", qtyPerServing: 5, uom: "g", yieldPct: 100, effectiveQty: 5, costPerServing: 1 }];
    await act(async () => {
      expect(await h.result.current.replaceShared("m1", next)).toBe(true);
    });
    expect(net.sent("menu_bom", "POST")[0].body).toEqual([expect.objectContaining({ sku_id: "s1", spec_note: "หั่นเต๋า" }), expect.objectContaining({ sku_id: "s3", spec_note: null })]);
    expect(h.result.current.lines.find((l) => l.skuId === "s1")?.specNote).toBe("หั่นเต๋า");

    // Before the migration: the insert naming spec_note fails, the retry without it saves
    net.fault(MISSING, (r) => FakeNetwork.to("menu_bom", "POST")(r) && Array.isArray(r.body) && "spec_note" in (r.body as object[])[0], true);
    await act(async () => {
      expect(await h.result.current.replaceShared("m1", next)).toBe(true);
    });
    const posts = net.sent("menu_bom", "POST");
    expect(posts.at(-1)!.body).toEqual([expect.not.objectContaining({ spec_note: expect.anything() }), expect.anything()]);
  });
});
