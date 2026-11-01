import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { FakeNetwork, net, settles } from "./fake-network";

/**
 * The kitchen's "ปรับยอด" sheet, rendered, saving through the same writer KitchenStock gives
 * it (useKitchenItemStock.addAdjustment for RM/PK; SM's is checked at hook level).
 */
vi.mock("@/integrations/supabase/client", async () => ({ supabase: (await import("./fake-network")).net.client }));
const toasts = vi.hoisted(() => {
  const log: [string, string][] = [];
  const mk = (k: string) => (m: unknown) => void log.push([k, String(m)]);
  return { log, toast: Object.assign(mk("toast"), { success: mk("success"), error: mk("error"), info: mk("info"), warning: mk("warning") }) };
});
vi.mock("sonner", () => ({ toast: toasts.toast }));

import { AdjustSheet } from "@/components/kitchen-stock/AdjustSheet";
import { useKitchenItemStock } from "@/hooks/use-kitchen-item-stock";
import { useSmStockData } from "@/hooks/use-sm-stock-data";
import type { SKU } from "@/types/sku";

const NONE: never[] = [];
const sku = { id: "rm-1", skuId: "RM-001", name: "แป้งสาลี", type: "RM", usageUom: "g" } as SKU;

let onClose: ReturnType<typeof vi.fn>;
function open() {
  const stock = renderHook(() => useKitchenItemStock("RM", NONE, NONE, false));
  onClose = vi.fn();
  render(<AdjustSheet sku={sku} stock={5000} anchor={null} onSave={(adj) => stock.result.current.addAdjustment(adj)} onClose={onClose} />);
  fireEvent.click(screen.getByRole("button", { name: "Workshop" }));
  fireEvent.change(screen.getByRole("textbox", { name: /จำนวน/ }), { target: { value: "300" } });
  return screen.getByRole("button", { name: /ตัดออก 300/ });
}
async function save(button: HTMLElement) {
  await act(async () => {
    fireEvent.click(button);
  });
  await settles(
    (async () => {
      while (button.isConnected && button.getAttribute("aria-busy")) await act(() => new Promise((r) => setTimeout(r, 5)));
    })(),
  );
}

beforeEach(() => {
  net.reset();
  toasts.log.length = 0;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("kitchen AdjustSheet save", () => {
  it("inserts one RM adjustment (−300, Workshop), stops spinning and closes", async () => {
    const button = open();
    await save(button);
    const insert = net.sent("stock_adjustments", "POST");
    expect(insert).toHaveLength(1);
    expect(insert[0].body).toMatchObject({ sku_id: "rm-1", quantity: -300, reason: "Workshop", stock_type: "RM" });
    expect(button).not.toHaveAttribute("aria-busy");
    expect(onClose).toHaveBeenCalled();
  });

  it("refused: stops spinning, says so, stays open", async () => {
    net.fault({ kind: "refuse" }, FakeNetwork.to("stock_adjustments"));
    const button = open();
    await save(button);
    expect(net.sent("stock_adjustments", "POST")).toHaveLength(1);
    expect(button).not.toHaveAttribute("aria-busy");
    expect(toasts.log).toEqual([["error", expect.stringContaining("บันทึกปรับยอดไม่ได้")]]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("dropped connection: stops spinning, says it may have saved (check first), stays open", async () => {
    net.fault({ kind: "fail" }, FakeNetwork.to("stock_adjustments"));
    const button = open();
    await save(button);
    expect(button).not.toHaveAttribute("aria-busy");
    expect(toasts.log).toEqual([["error", expect.stringContaining("ไม่แน่ใจว่าบันทึกแล้วหรือยัง")]]);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("SM adjustment writer (useSmStockData.addAdjustment)", () => {
  it("inserts with stock_type SM; refused/dropped settle false", async () => {
    // Stable empty lists: new [] every render would re-run its effects without end
    const h = renderHook(() => useSmStockData(NONE, NONE, NONE, NONE, NONE, NONE, NONE, NONE, false));
    const adj = { skuId: "sm-1", date: "2026-11-01", quantity: -100, reason: "ส่งเทสสูตร" };
    expect(await act(() => settles(h.result.current.addAdjustment(adj)))).toBe(true);
    expect(net.sent("stock_adjustments", "POST")[0].body).toMatchObject({ sku_id: "sm-1", quantity: -100, stock_type: "SM" });
    net.fault({ kind: "refuse" }, FakeNetwork.to("stock_adjustments"), true);
    expect(await act(() => settles(h.result.current.addAdjustment(adj)))).toBe(false);
    net.fault({ kind: "fail" }, FakeNetwork.to("stock_adjustments"), true);
    expect(await act(() => settles(h.result.current.addAdjustment(adj)))).toBe(false);
  });
});
