import { describe, expect, it } from "vitest";
import { canCancel, freshPending, lineMessage, lineState, requestFigures, suggestedPacks } from "./request-lines";

const f = (stock: number, avg: number, rop: number, par: number, pack = 100) => ({ stockOnHand: stock, avgDailyUsage: avg, rop, parstock: par, packSize: pack });

describe("line situation (same thresholds as the old table)", () => {
  it("names each case", () => {
    expect(lineState(f(0, 0, 0, 0)).kind).toBe("nodata");
    expect(lineState(f(0, 67, 100, 244)).kind).toBe("out");
    expect(lineState(f(158, 26, 200, 376))).toEqual({ kind: "low", coverDays: 158 / 26 });
    expect(lineState(f(500, 26, 200, 376)).kind).toBe("ok");
    // below reorder point, but what is coming lifts it back above → กำลังมา
    expect(lineState(f(150, 15, 200, 260), 200).kind).toBe("coming");
  });
});

describe("request figures (from the branch stock page's own numbers)", () => {
  const fig = (balance: number, anchorDate: string | null = "2026-10-21") => ({ balance, anchorDate, dailyUse: 1000, peakDailyUse: 1500 });

  it("orders to parstock from the shared balance", () => {
    // lead time 1: rop = 1000 + 500, parstock = 1000 + 1500
    expect(requestFigures(fig(800), { leadTime: 1 })).toEqual({ stockOnHand: 800, stockKnown: true, avgDailyUsage: 1000, peakDailyUsage: 1500, rop: 1500, parstock: 2500, suggestedOrder: 1700, status: "low" });
    expect(requestFigures(fig(3000), { leadTime: 1 }).status).toBe("sufficient");
  });

  it("takes a book shortfall as nothing left, not stock owed", () => {
    // −400 on the stock page: order parstock, not parstock + 400
    const r = requestFigures(fig(-400), { leadTime: 1 });
    expect(r.stockOnHand).toBe(0);
    expect(r.stockKnown).toBe(true);
    expect(r.suggestedOrder).toBe(2500);
    expect(r.status).toBe("critical");
  });

  it("a product on no sheet in 5 weeks is unknown: never 5 weeks of receipts as stock, the suggestion assumes none", () => {
    // 80 kg of soup received over 5 weeks, nothing counted or listed: not "sufficient, order 0"
    const r = requestFigures(fig(80000, null), { leadTime: 1 });
    expect(r).toMatchObject({ stockKnown: false, stockOnHand: 0, suggestedOrder: 2500 });
    // a system figure from a sheet is an anchor: known
    expect(requestFigures(fig(1200, "2026-10-29"), { leadTime: 1 }).stockKnown).toBe(true);
  });

  it("has no usage data without a figure", () => {
    expect(requestFigures(undefined, { leadTime: 2 })).toMatchObject({ stockOnHand: 0, stockKnown: false, avgDailyUsage: 0, suggestedOrder: 0, status: "no-data" });
  });
});

describe("suggested packs", () => {
  it("matches the old parstock suggestion when nothing is coming", () => {
    // old: ceil((parstock - stock) / pack)
    expect(suggestedPacks(f(158, 26, 200, 376))).toBe(3);
    expect(suggestedPacks(f(0, 67, 100, 244, 1000))).toBe(1);
    expect(suggestedPacks(f(500, 26, 200, 376))).toBe(0);
    expect(suggestedPacks(f(0, 0, 0, 0))).toBe(0);
  });
  it("takes off what is already coming", () => {
    expect(suggestedPacks(f(158, 26, 200, 376), 200)).toBe(1);
    expect(suggestedPacks(f(158, 26, 200, 376), 300)).toBe(0);
  });
});

describe("pending requests", () => {
  it("counts only requests still due, adds them up, keeps the earliest date", () => {
    const m = freshPending(
      [
        { skuId: "a", qty: 100, requiredDate: "2026-10-26" },
        { skuId: "a", qty: 50, requiredDate: "2026-10-24" },
        { skuId: "b", qty: 300, requiredDate: "2026-10-20" }, // stuck since 19 Oct
      ],
      "2026-10-25",
    );
    expect(m.get("a")).toEqual({ qty: 150, due: "2026-10-24" });
    expect(m.has("b")).toBe(false);
  });
});

describe("LINE message", () => {
  it("keeps the old wording", () => {
    expect(
      lineMessage({
        branch: "Thaniya",
        date: "2026-10-26",
        items: [
          { name: "หมูสันนอก", packSize: 1000, uom: "ก.", packs: 1, packUnit: "แพ็ค" },
          { name: "ไข่", packSize: 1, uom: "ฟอง", packs: 30, packUnit: "แพ็ค" },
        ],
      }),
    ).toBe(["📦 [Thaniya] - สั่งวัตถุดิบ", "วันส่งสินค้า: 2026-10-26", "", "🧾 รายการ:", "- หมูสันนอก — 1,000 ก. x 1 แพ็ค", "- ไข่ — 30 ฟอง", "", "🙏 ถ้าคอนเฟิร์ม ฝากยืนยันออเดอร์ด้วยนะคะ"].join("\n"));
  });
  it("supplier orders always show packs and the note", () => {
    expect(lineMessage({ branch: "Shiro", date: "2026-10-26", notes: "ก่อน 10 โมง", alwaysPacks: true, items: [{ name: "ไข่", packSize: 1, uom: "ฟอง", packs: 2, packUnit: "แผง" }] })).toContain(
      "หมายเหตุ: ก่อน 10 โมง\n\n🧾 รายการ:\n- ไข่ — 1 ฟอง x 2 แผง",
    );
  });
});

it("cancel only before the goods arrive", () => {
  expect(["Submitted", "Acknowledged", "Fulfilled", "Cancelled"].map(canCancel)).toEqual([true, true, false, false]);
});
