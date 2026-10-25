import { beforeEach, describe, expect, it, vi } from "vitest";
import { baseStatus, clearDeviceCopies, installWriteGuard, loadWithDeviceCopy } from "./base-cache";

const signIn = (id: string) => localStorage.setItem("sb-test-auth-token", JSON.stringify({ user: { id } }));

describe("device copy of base data", () => {
  beforeEach(() => localStorage.clear());

  it("shows the saved copy first, then the fresh rows, and saves them", async () => {
    signIn("u1");
    await loadWithDeviceCopy("skus", async () => ({ data: [{ id: "a" }], error: null }), () => undefined);
    const seen: [string[], boolean][] = [];
    await loadWithDeviceCopy("skus", async () => ({ data: [{ id: "b" }], error: null }), (rows, dev) => seen.push([rows.map((r) => r.id), dev]));
    expect(seen).toEqual([[["a"], true], [["b"], false]]);
  });

  it("keeps the saved copy when the fresh load fails", async () => {
    signIn("u1");
    await loadWithDeviceCopy("skus", async () => ({ data: [{ id: "a" }], error: null }), () => undefined);
    await loadWithDeviceCopy("skus", async () => ({ data: null, error: "x" }), () => undefined);
    const seen: string[][] = [];
    await loadWithDeviceCopy("skus", async () => ({ data: null, error: "x" }), (rows) => seen.push(rows.map((r: { id: string }) => r.id)));
    expect(seen).toEqual([["a"]]);
  });

  it("never shows one user's copy to another, and sign-out clears it", async () => {
    signIn("u1");
    await loadWithDeviceCopy("skus", async () => ({ data: [{ id: "a" }], error: null }), () => undefined);
    signIn("u2");
    localStorage.removeItem("sb-test-auth-token");
    localStorage.setItem("sb-test-auth-token", JSON.stringify({ user: { id: "u2" } }));
    const fromDevice = vi.fn();
    await loadWithDeviceCopy("skus", async () => ({ data: [], error: null }), (_r, dev) => dev && fromDevice());
    expect(fromDevice).not.toHaveBeenCalled();
    clearDeviceCopies();
    expect(Object.keys(localStorage).filter((k) => k.startsWith("ck-base-v1"))).toEqual([]);
  });

  it("holds database writes until fresh base data is in, reads go straight through", async () => {
    const calls: string[] = [];
    window.fetch = vi.fn(async (u: RequestInfo | URL, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${String(u)}`);
      return new Response("[]");
    }) as typeof fetch;
    installWriteGuard();
    let finish!: () => void;
    const pending = loadWithDeviceCopy("prices", () => new Promise((r) => (finish = () => r({ data: [], error: null }))), () => undefined);
    expect(baseStatus()).not.toBe("fresh");
    const write = window.fetch("https://x.supabase.co/rest/v1/branch_receipts", { method: "POST" });
    await window.fetch("https://x.supabase.co/rest/v1/skus");
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toEqual(["GET https://x.supabase.co/rest/v1/skus"]);
    finish();
    await pending;
    await write;
    expect(calls[1]).toBe("POST https://x.supabase.co/rest/v1/branch_receipts");
    expect(baseStatus()).toBe("fresh");
  });
});
