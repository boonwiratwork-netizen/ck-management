import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FakeNetwork, net, settles } from "./fake-network";

/**
 * The branch "ย้ายของ / ปรับยอด" sheet, rendered, with its real writer (move_branch_stock
 * through the real client). Clicking confirm must send, and the button must stop spinning
 * whatever the network does.
 */
vi.mock("@/integrations/supabase/client", async () => ({ supabase: (await import("./fake-network")).net.client }));
const toasts = vi.hoisted(() => {
  const log: [string, string][] = [];
  const mk = (k: string) => (m: unknown) => void log.push([k, String(m)]);
  return { log, toast: Object.assign(mk("toast"), { success: mk("success"), error: mk("error"), info: mk("info"), warning: mk("warning") }) };
});
vi.mock("sonner", () => ({ toast: toasts.toast }));

import { MoveSheet } from "@/components/store-stock/MoveSheet";
import { DB_CALL_TIMEOUT_MS } from "@/lib/transfer-stock-db";
import type { SKU } from "@/types/sku";
import type { Branch } from "@/types/branch";

const sku = { id: "sku-1", skuId: "SM-001", name: "ซอสเทริยากิ", type: "SM", usageUom: "g" } as SKU;
const branch = (id: string, name: string): Branch => ({ id, branchName: name, brandName: "Sendo", location: "", status: "Active", avgSellingPrice: null });
const from = branch("b-1", "Sendo สยาม");
const other = branch("b-2", "Sendo อารีย์");

let onSaved: ReturnType<typeof vi.fn>;
let onClose: ReturnType<typeof vi.fn>;
function open() {
  onSaved = vi.fn();
  onClose = vi.fn();
  render(<MoveSheet sku={sku} balance={1000} branch={from} branches={[from, other]} onClose={onClose} onSaved={onSaved} />);
  fireEvent.change(screen.getByLabelText("จำนวน"), { target: { value: "250" } });
  return screen.getByRole("button", { name: /ยืนยันย้าย/ });
}
/** Click and wait until the button stops spinning (fails on a hang) */
async function confirm(button: HTMLElement) {
  await act(async () => {
    fireEvent.click(button);
  });
  await settles(
    (async () => {
      while (button.getAttribute("aria-busy")) await act(() => new Promise((r) => setTimeout(r, 5)));
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

describe("MoveSheet save", () => {
  it("sends move_branch_stock with both sides, stops spinning, says done and closes", async () => {
    net.rpcs.move_branch_stock = () => 2;
    const button = open();
    await confirm(button);
    const sent = net.sent("move_branch_stock", "POST");
    expect(sent).toHaveLength(1);
    const rows = (sent[0].body as { p_rows: { branch_id: string; quantity: number }[] }).p_rows;
    expect(rows.map((r) => [r.branch_id, r.quantity])).toEqual([["b-1", -250], ["b-2", 250]]);
    expect(button).not.toHaveAttribute("aria-busy");
    expect(toasts.log).toContainEqual(["success", expect.stringContaining("Sendo อารีย์")]);
    expect(onSaved).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("before the migration: falls back to one stock_adjustments insert of both rows", async () => {
    const button = open();
    await confirm(button);
    const insert = net.sent("stock_adjustments", "POST");
    expect(insert).toHaveLength(1);
    expect((insert[0].body as unknown[]).length).toBe(2);
    expect(toasts.log.map((t) => t[0])).toEqual(["success"]);
  });

  it("refused: stops spinning, says nothing was saved, stays open", async () => {
    net.fault({ kind: "refuse", code: "P0001", message: "ไม่ใช่สาขาของบัญชีนี้" }, FakeNetwork.to("move_branch_stock"));
    const button = open();
    await confirm(button);
    expect(net.sent("move_branch_stock")).toHaveLength(1);
    expect(button).not.toHaveAttribute("aria-busy");
    expect(toasts.log).toEqual([["error", expect.stringContaining("ไม่ใช่สาขาของบัญชีนี้")]]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("dropped connection: stops spinning, says it may have saved (refresh before saving again)", async () => {
    net.fault({ kind: "fail" }, FakeNetwork.to("move_branch_stock"));
    const button = open();
    await confirm(button);
    expect(net.sent("move_branch_stock")).toHaveLength(1);
    expect(button).not.toHaveAttribute("aria-busy");
    expect(toasts.log).toEqual([["error", expect.stringContaining("ไม่แน่ใจว่าบันทึกแล้วหรือยัง")]]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("no answer: the time limit ends the spinning", async () => {
    net.fault({ kind: "stall" }, FakeNetwork.to("move_branch_stock"));
    const button = open();
    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(button);
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(net.stalled).toHaveLength(1);
    expect(button).toHaveAttribute("aria-busy", "true");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DB_CALL_TIMEOUT_MS);
    });
    expect(button).not.toHaveAttribute("aria-busy");
    expect(toasts.log).toEqual([["error", expect.stringContaining("ไม่แน่ใจว่าบันทึกแล้วหรือยัง")]]);
  });
});
