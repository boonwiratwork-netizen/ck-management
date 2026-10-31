import { describe, expect, it } from "vitest";
import { afterCount, type CountAnchor } from "./count-anchor";
import { claimOutcome, declineAnswer, distributionDate, distributionDeltas, distributionReasons, isDelivered, isWaiting, overReceived, planLineEdits, receiveAnswer, receiveSent, returnSent, waitingOrders, wasSent, type Claim, type DistributionRow, type ReceiveSteps } from "./transfer-stock";

const TO = { id: "8b0c1d2e-0000-4000-8000-000000000001", toNumber: "TO-2026-10-031" };
const REASON = `Distribution: ${TO.toNumber}`;
const line = (sku_id: string, sku_type: string, actual_qty: number) => ({ sku_id, sku_type, actual_qty });
const row = (sku_id: string, quantity: number, adjustment_date = "2026-10-29", stock_type = "RM"): DistributionRow => ({ sku_id, quantity, stock_type, adjustment_date });

/** The kitchen RM/PK balance rule (kitchen-stock.ts): count + adjustments dated after it, count rows left out */
const rmBalance = (count: number, anchor: CountAnchor, rows: DistributionRow[]) => count + rows.filter((r) => afterCount(anchor, r.adjustment_date)).reduce((s, r) => s + Number(r.quantity), 0);

describe("an order's RM/PK deduction", () => {
  it("is found by its number, and by its id (the March 2026 fallback)", () => {
    expect(distributionReasons(TO)).toEqual([REASON, `Distribution: ${TO.id}`]);
  });

  it("sent: RM and PK lines out by what was packed; SM (read from its lines) and empty lines not", () => {
    const out = distributionDeltas([line("garlic", "RM", 500), line("cup", "PK", 20), line("soup", "SM", 8000), line("salt", "RM", 0)], [], "2026-10-29", REASON);
    expect(out).toEqual([
      { sku_id: "garlic", quantity: -500, stock_type: "RM", adjustment_date: "2026-10-29", reason: REASON },
      { sku_id: "cup", quantity: -20, stock_type: "PK", adjustment_date: "2026-10-29", reason: REASON },
    ]);
  });

  it("edited: only the difference is added (nothing deleted first), on the day it went out", () => {
    const sent = [row("garlic", -500), row("cup", -20, "2026-10-29", "PK")];
    expect(distributionDeltas([line("garlic", "RM", 400), line("cup", "PK", 20)], sent, "2026-10-29", REASON)).toEqual([{ sku_id: "garlic", quantity: 100, stock_type: "RM", adjustment_date: "2026-10-29", reason: REASON }]);
    // Saved again with nothing changed: nothing to write
    expect(distributionDeltas([line("garlic", "RM", 500), line("cup", "PK", 20)], sent, "2026-10-29", REASON)).toEqual([]);
    // A line set to 0 gives its stock back
    expect(distributionDeltas([line("garlic", "RM", 500), line("cup", "PK", 0)], sent, "2026-10-29", REASON)).toEqual([{ sku_id: "cup", quantity: 20, stock_type: "PK", adjustment_date: "2026-10-29", reason: REASON }]);
  });

  it("a save repeated after a failure adds only what is still missing", () => {
    const half = [row("garlic", -500), row("garlic", 100)]; // the first try got its row in
    expect(distributionDeltas([line("garlic", "RM", 400)], half, "2026-10-29", REASON)).toEqual([]);
    expect(distributionDeltas([line("garlic", "RM", 300)], half, "2026-10-29", REASON)).toEqual([{ sku_id: "garlic", quantity: 100, stock_type: "RM", adjustment_date: "2026-10-29", reason: REASON }]);
  });

  it("belongs on the day it was sent (Bangkok), never the day of an edit", () => {
    // Sent 01:30 on 31 Oct in Bangkok = 30 Oct in UTC
    expect(distributionDate([row("garlic", -1, "2026-11-02")], "2026-10-30T18:30:00Z", "2026-10-30", "2026-11-05")).toBe("2026-10-31");
    // No send time (sent before Oct 2026, never re-read): the day already on its rows
    expect(distributionDate([row("a", -1, "2026-10-12"), row("b", -1, "2026-10-10")], null, "2026-10-09", "2026-11-05")).toBe("2026-10-10");
    expect(distributionDate([], null, "2026-10-09", "2026-11-05")).toBe("2026-10-09");
    expect(distributionDate([], null, null, "2026-11-05")).toBe("2026-11-05");
  });

  it("an edit after a kitchen count leaves the balance on the count (it used to take it out a second time)", () => {
    // Sent 29 Oct (500 g out), counted 30 Oct (the 500 g already gone: 1,200 g left), edited 31 Oct to 400 g
    const anchor: CountAnchor = { count_date: "2026-10-30", timing: "after" };
    const sent = [row("garlic", -500, "2026-10-29")];
    const now = [...sent, ...distributionDeltas([line("garlic", "RM", 400)], sent, distributionDate(sent, "2026-10-29T03:00:00Z", "2026-10-29", "2026-10-31"), REASON)];
    expect(rmBalance(1200, anchor, now)).toBe(1200);
    // The old way: deleted and written again as today's 400 g
    expect(rmBalance(1200, anchor, [row("garlic", -400, "2026-10-31")])).toBe(800);
  });
});

describe("moving an order on from Sent", () => {
  it("reads why a move matched nothing", () => {
    expect(claimOutcome("Sent")).toEqual({ kind: "blocked" });
    expect(claimOutcome("Cancelled")).toEqual({ kind: "taken", status: "Cancelled" });
    expect(claimOutcome(undefined)).toEqual({ kind: "taken", status: null });
    expect(claimOutcome("Received", "Received")).toEqual({ kind: "blocked" });
    expect(["Draft", "Sent", "Received", "Partially Received", "Cancelled", "Declined"].map(isDelivered)).toEqual([false, true, true, true, false, false]);
  });

  it("an order waits while nothing is in the branch's stock: sent, or a receive that didn't finish", () => {
    expect(isWaiting({ status: "Sent", receipts: 0 })).toBe(true);
    expect(isWaiting({ status: "Received", receipts: 0 })).toBe(true);
    expect(isWaiting({ status: "Sent", receipts: 4 })).toBe(false); // received before store managers could close it
    expect(isWaiting({ status: "Cancelled", receipts: 0 })).toBe(false);
    const o = (id: string, status: string, receipts: number, delivery_date: string) => ({ id, status, receipts, delivery_date });
    const list = waitingOrders([o("a", "Sent", 0, "2026-09-01"), o("b", "Received", 0, "2026-10-25"), o("c", "Received", 0, "2026-10-01"), o("d", "Partially Received", 2, "2026-10-30"), o("e", "Sent", 1, "2026-10-30")], "2026-10-17");
    expect(list.map((x) => x.id)).toEqual(["a", "b"]);
  });

  /** A fake database: the order's status and its receipts, with every call written down */
  const fakeOrder = (start: { status: string | null; receipts?: number; canMove?: boolean; saveOk?: boolean; lostReply?: boolean; releaseOk?: boolean }) => {
    const o = { status: start.status, receipts: start.receipts ?? 0, calls: [] as string[] };
    const steps: ReceiveSteps = {
      read: async () => ({ status: o.status, receipts: o.receipts }),
      move: async (from, to) => {
        o.calls.push(`move ${from}→${to}`);
        if (o.status !== from) return { kind: "taken", status: o.status };
        if (start.canMove === false) return { kind: "blocked" };
        o.status = to;
        return { kind: "ok" };
      },
      release: async (s) => {
        o.calls.push(`release ${s}`);
        if (start.releaseOk === false || o.status !== s) return false;
        o.status = "Sent";
        return true;
      },
      save: async () => {
        o.calls.push("save");
        if (start.lostReply) o.receipts += 3; // saved, but the reply never came
        if (start.saveOk === false || start.lostReply) return 0;
        o.receipts += 3;
        return 3;
      },
    };
    return { o, steps };
  };

  it("receive: claims before saving; an order cancelled meanwhile is not received (it used to flip back to Received)", async () => {
    const ok = fakeOrder({ status: "Sent" });
    expect(await receiveSent(ok.steps, "Received")).toEqual({ kind: "saved", count: 3, closed: true });
    expect(ok.o.calls).toEqual(["move Sent→Received", "save"]);

    const cancelled = fakeOrder({ status: "Cancelled" });
    expect(await receiveSent(cancelled.steps, "Received")).toEqual({ kind: "taken", status: "Cancelled" });
    expect(cancelled.o.calls).toEqual([]);
    expect(cancelled.o.status).toBe("Cancelled");
  });

  it("receive on two screens: the second one saves nothing", async () => {
    const { o, steps } = fakeOrder({ status: "Sent" });
    await receiveSent(steps, "Received");
    expect(await receiveSent(steps, "Partially Received")).toEqual({ kind: "already" });
    expect(o.receipts).toBe(3);
  });

  it("a save whose reply got lost counts as saved, because the database has its receipts", async () => {
    const { o, steps } = fakeOrder({ status: "Sent", lostReply: true });
    expect(await receiveSent(steps, "Received")).toEqual({ kind: "already" });
    expect(o.calls).not.toContain("release Received");
    expect(o.status).toBe("Received");
  });

  it("a save that failed gives the claim back; if that fails too, the order still waits and the next try finishes it", async () => {
    const back = fakeOrder({ status: "Sent", saveOk: false });
    expect(await receiveSent(back.steps, "Received")).toEqual({ kind: "failed" });
    expect(back.o.status).toBe("Sent");

    const stuck = fakeOrder({ status: "Sent", saveOk: false, releaseOk: false });
    expect(await receiveSent(stuck.steps, "Received")).toEqual({ kind: "failed" });
    expect(stuck.o.status).toBe("Received"); // marked received, nothing saved
    // Later (even after a reload): read from the database, moved on from where it is, saved
    const retry = { ...stuck.steps, save: async () => ((stuck.o.receipts += 2), 2) };
    expect(await receiveSent(retry, "Partially Received")).toEqual({ kind: "saved", count: 2, closed: true });
    expect(stuck.o.calls.slice(-1)).toEqual(["move Received→Partially Received"]);
  });

  it("an account that can't change orders yet saves as before, but never over receipts already in", async () => {
    const first = fakeOrder({ status: "Sent", canMove: false });
    expect(await receiveSent(first.steps, "Received")).toEqual({ kind: "saved", count: 3, closed: false });
    expect(first.o.status).toBe("Sent");
    expect(await receiveSent(first.steps, "Received")).toEqual({ kind: "already" });
    expect(first.o.receipts).toBe(3);
  });

  it("reads the database function's answers", () => {
    expect(receiveAnswer({ result: "saved", status: "Received", rows: [{}, {}] }, 3)).toEqual({ kind: "saved", count: 2, closed: true });
    expect(receiveAnswer({ result: "already", status: "Received", rows: [{}] }, 3)).toEqual({ kind: "already" });
    expect(receiveAnswer({ result: "taken", status: "Cancelled" }, 3)).toEqual({ kind: "taken", status: "Cancelled" });
    expect(receiveAnswer({ result: "gone" }, 3)).toEqual({ kind: "taken", status: null });
    expect(declineAnswer({ result: "declined" })).toEqual({ kind: "done", stockError: null });
    expect(declineAnswer({ result: "already" })).toEqual({ kind: "already" });
    expect(declineAnswer({ result: "received", status: "Sent" })).toEqual({ kind: "received" });
    expect(declineAnswer({ result: "taken", status: "Cancelled" })).toEqual({ kind: "taken", status: "Cancelled" });
  });

  it("decline and cancel: refused once anything was received; the kitchen's stock comes back only after the move", async () => {
    const calls: string[] = [];
    const steps = (state: { status: string; receipts: number }, claim: Claim, stockError: string | null = null) => ({
      read: async () => state,
      move: async (from: string) => (calls.push(`move ${from}`), claim),
      returnStock: async () => (calls.push("return stock"), stockError),
    });
    expect(await returnSent(steps({ status: "Sent", receipts: 2 }, { kind: "ok" }))).toEqual({ kind: "received" });
    expect(await returnSent(steps({ status: "Received", receipts: 0 }, { kind: "ok" }))).toEqual({ kind: "done", stockError: null }); // an unfinished receive can still be declined
    expect(calls).toEqual(["move Received", "return stock"]);
    expect(await returnSent(steps({ status: "Declined", receipts: 0 }, { kind: "ok" }))).toEqual({ kind: "taken", status: "Declined" });
    expect(await returnSent(steps({ status: "Sent", receipts: 0 }, { kind: "taken", status: "Received" }))).toEqual({ kind: "taken", status: "Received" });
    expect(calls).toEqual(["move Received", "return stock", "move Sent"]);
    expect(await returnSent(steps({ status: "Sent", receipts: 0 }, { kind: "ok" }, "no access"))).toEqual({ kind: "done", stockError: "no access" });
  });

  it("a line set to 0 after sending means not sent: its plan goes to 0 and its request line is declined, as at sending", () => {
    const stored = [
      { id: "a", skuId: "soup", actualQty: 8000, plannedQty: 8000, trLineId: "tr-a" },
      { id: "b", skuId: "cup", actualQty: 50, plannedQty: 50, trLineId: "tr-b" },
      { id: "z", skuId: "tare", actualQty: 0, plannedQty: 2000, trLineId: "tr-z" }, // an old 0 (list Z): left as it is
      { id: "k", skuId: "oil", actualQty: 0, plannedQty: 0, trLineId: "tr-k" }, // set to 0 earlier
    ];
    const plan = planLineEdits(stored, [{ id: "a", actualQty: 0 }, { id: "b", actualQty: 50 }, { id: "z", actualQty: 0 }, { id: "k", actualQty: 300 }], new Map());
    expect([...plan.planned]).toEqual([["a", 0], ["k", "requested"]]);
    expect(plan.decline).toEqual(["tr-a"]);
    expect(plan.undecline).toEqual(["tr-k"]);
    expect(plan.refused).toEqual([]);
  });

  it("…but not on a product the branch already has from the order (its stock would come back to the kitchen too)", () => {
    const stored = [{ id: "a", skuId: "soup", actualQty: 8000, plannedQty: 8000, trLineId: "tr-a" }];
    expect(planLineEdits(stored, [{ id: "a", actualQty: 0 }], new Map([["soup", 7900]])).refused).toEqual(["a"]);
    expect(planLineEdits(stored, [{ id: "a", actualQty: 7000 }], new Map([["soup", 7900]])).refused).toEqual([]);
  });

  it("not-sent lines are left off the receive screen; a receipt of more than 3× what was sent is a typing slip", () => {
    expect([{ actualQty: 0, plannedQty: 0 }, { actualQty: 0, plannedQty: 500 }, { actualQty: 400, plannedQty: 0 }].map(wasSent)).toEqual([false, true, true]);
    const lines = [{ id: "a", actualQty: 8000, plannedQty: 8000 }, { id: "b", actualQty: 0, plannedQty: 500 }];
    expect(overReceived(lines, new Map([["a", 80000], ["b", 500]]))).toEqual(["a"]);
    expect(overReceived(lines, new Map([["a", 24000], ["b", 1500]]))).toEqual([]);
  });
});
