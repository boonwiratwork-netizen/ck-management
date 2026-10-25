import { describe, expect, it } from "vitest";
import { branchShortCount, checkBeforeSend, isShort, kitchenShortCount, packsOf, reconcileLots, transferBadges, visibleRecords, type LotLine, type ProdRecord } from "./transfer-lines";

const rec = (id: string, date: string, out: number): ProdRecord => ({ id, productionDate: date, actualOutputG: out, batchesProduced: 1 });
const RECORDS = [rec("a", "2026-09-01", 2000), rec("b", "2026-10-16", 800), rec("c", "2026-10-22", 1200)];

describe("10% rule", () => {
  it("weighing differences up to 10% count as complete", () => {
    expect(isShort(1750, 1880)).toBe(false); // 7% under
    expect(isShort(6000, 9000)).toBe(true);
    expect(isShort(0, 0)).toBe(false);
    expect(isShort(900, 1000)).toBe(false); // exactly 10%
  });
});

describe("packs on a line", () => {
  it("prefers the typed pack count over the weight", () => {
    expect(packsOf({ packsCount: 5, actualQty: 2020 }, 400)).toBe(5);
    expect(packsOf({ packsCount: null, actualQty: 2020 }, 400)).toBe(5);
    expect(packsOf({ packsCount: null, actualQty: 50 }, 0)).toBe(0);
  });
});

describe("lots still in the kitchen", () => {
  it("hides runs older than the current stock covers, oldest first", () => {
    expect(visibleRecords(RECORDS, 1500, new Set()).map((r) => r.id)).toEqual(["b", "c"]);
  });
  it("keeps a lot already picked, shows all when stock is unknown or none fit", () => {
    expect(visibleRecords(RECORDS, 1500, new Set(["a"])).map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(visibleRecords(RECORDS, undefined, new Set()).length).toBe(3);
    expect(visibleRecords(RECORDS, 0, new Set()).length).toBe(3);
  });
});

describe("lots follow the packs", () => {
  const lot = (id: string | undefined, rid: string, date: string, packs: number): LotLine => ({ id, productionRecordId: rid, productionDate: date, packs, packWeightG: 400 });
  it("first fill goes to the oldest visible lot", () => {
    const visible = visibleRecords(RECORDS, 1500, new Set());
    expect(reconcileLots([], visible, 5, 400).next).toEqual([lot(undefined, "b", "2026-10-16", 5)]);
  });
  it("fewer packs come off the newest lot first", () => {
    const r = reconcileLots([lot("x", "b", "2026-10-16", 2), lot("y", "c", "2026-10-22", 3)], RECORDS, 1, 400);
    expect(r.next).toEqual([lot("x", "b", "2026-10-16", 1)]);
    expect(r.removed.map((l) => l.id)).toEqual(["y"]);
  });
  it("more packs go to an unused lot, else the newest one", () => {
    expect(reconcileLots([lot("x", "b", "2026-10-16", 2)], [RECORDS[1], RECORDS[2]], 4, 400).next[1]).toEqual(lot(undefined, "c", "2026-10-22", 2));
    expect(reconcileLots([lot("x", "b", "2026-10-16", 2)], [RECORDS[1]], 4, 400).next).toEqual([lot("x", "b", "2026-10-16", 4)]);
  });
});

describe("check before sending", () => {
  const skus: Record<string, { type: string; packSize: number }> = { sm: { type: "SM", packSize: 350 }, pk: { type: "PK", packSize: 50 } };
  const line = (id: string, skuId: string, planned: number, actual: number, packs: number | null, tr = true) => ({ id, skuId, skuName: id, plannedQty: planned, actualQty: actual, packsCount: packs, trLineId: tr ? `t-${id}` : null });
  it("flags over-stock, lot gaps (SM only), short and changed lines", () => {
    const res = checkBeforeSend(
      [line("pork", "sm", 1400, 1400, 4), line("cup", "pk", 50, 50, 1), line("duck", "sm", 1750, 1880, 5), line("soup", "sm", 9000, 6000, 2)],
      (id) => skus[id],
      { sm: 1050 },
      { pork: [{ productionRecordId: "r", productionDate: "2026-10-21", packs: 3, packWeightG: 350 }], duck: [{ productionRecordId: "r", productionDate: "2026-10-15", packs: 5, packWeightG: 350 }], soup: [{ productionRecordId: "r", productionDate: "2026-10-14", packs: 2, packWeightG: 350 }] },
    );
    expect(res.overStock.map((x) => x.lineId)).toEqual(["pork", "duck", "soup"]);
    expect(res.lotMismatch).toEqual([{ lineId: "pork", skuName: "pork", packs: 4, assigned: 3 }]); // the PK cup never needs a lot
    expect(res.short.map((x) => x.lineId)).toEqual(["soup"]);
    expect(res.changed.map((x) => x.lineId)).toEqual(["duck"]);
  });
});

describe("the two shortfall labels", () => {
  const lines = [
    { skuId: "duck", trLineId: "t1", plannedQty: 1750, actualQty: 1880 },
    { skuId: "soup", trLineId: "t2", plannedQty: 9000, actualQty: 9000 },
    { skuId: "cup", trLineId: null, plannedQty: 0, actualQty: 50 },
  ];
  it("kitchen short counts declined lines and lines sent short", () => {
    expect(kitchenShortCount(lines.map((l) => ({ ...l, packsCount: null, packSize: 0 })), 1)).toBe(1);
    expect(kitchenShortCount([{ trLineId: "t", plannedQty: 1000, actualQty: 800, packsCount: null, packSize: 0 }], 0)).toBe(1);
  });
  it("pack items compare packs: all packs sent but lighter is not short", () => {
    // ขอ 3 แพ็ค (3,300 ก.) ส่ง 3 แพ็ค หนัก 2,180 ก.
    expect(kitchenShortCount([{ trLineId: "t", plannedQty: 3300, actualQty: 2180, packsCount: 3, packSize: 1100 }], 0)).toBe(0);
    // ขอ 5 แพ็ค ส่ง 4
    expect(kitchenShortCount([{ trLineId: "t", plannedQty: 2000, actualQty: 1605, packsCount: 4, packSize: 400 }], 0)).toBe(1);
  });
  it("branch short compares with what the kitchen sent, not what was asked", () => {
    expect(branchShortCount(lines, new Map([["duck", 1750], ["soup", 6000], ["cup", 50]]))).toBe(1);
    expect(branchShortCount(lines, new Map([["duck", 1750], ["soup", 9000]]))).toBe(1); // cup never arrived
  });
  it("badges", () => {
    expect(transferBadges({ status: "Sent", kitchenShort: 1, branchShort: 0 }).map((b) => b.text)).toEqual(["ครัวกลางส่งไม่ครบ 1", "รอสาขารับ"]);
    expect(transferBadges({ status: "Partially Received", kitchenShort: 0, branchShort: 0 }).map((b) => b.text)).toEqual(["สาขารับครบ"]);
    expect(transferBadges({ status: "Received", kitchenShort: 0, branchShort: 2 }).map((b) => b.text)).toEqual(["สาขารับไม่ครบ 2"]);
  });
});
