import { describe, expect, it } from "vitest";
import { buildUsageContext } from "../../../supabase/functions/_shared/sale-usage.ts";
import { amount, branchStock, kitchenStock, ruleCost, ruleCosts, transfers, type FullStore, type StockStore } from "../../../supabase/functions/line-bot/tools-stock.ts";
import { kitchenStockFor } from "../../../supabase/functions/_shared/kitchen-stock.ts";
import type { Masters } from "../../../supabase/functions/line-bot/tools.ts";
import type { FcSale } from "../../../supabase/functions/_shared/food-cost.ts";

const MENUS = [
  { id: "mR", code: "MN-001", name: "Standard ชิโอะ ราเมน", brand: "Sendo", category: "Ramen", price: 300, active: true },
  { id: "mS", code: "MN-075", name: "Delivery Set A", brand: "Sendo", category: "Set", price: 399, active: true },
];
const SKUS = [
  { id: "duck", code: "SM-0005", name: "อกเป็ดชาชู ซูวีด์ รมควัน", type: "SM", uom: "g", purchaseUom: "g", converter: 1, active: true },
  { id: "pork", code: "RM-0041", name: "สันคอหมู ไม่บั้ง", type: "RM", uom: "g", purchaseUom: "kg", converter: 1000, active: true },
  { id: "coke", code: "RM-0300", name: "โค้ก ซีโร่ กระป๋อง", type: "RM", uom: "ชิ้น", purchaseUom: "ชิ้น", converter: 1, active: true },
];
const BRANCHES = [
  { id: "b1", name: "Thaniya", brand: "Sendo", active: true },
  { id: "b2", name: "Shiro", brand: "Sendo", active: true },
];

function masters(): Masters {
  const ctx = buildUsageContext({
    menus: MENUS.map((m) => ({ id: m.id, menuCode: m.code })),
    bomLines: [{ menuId: "mR", skuId: "duck", effectiveQty: 50, deliveryEffectiveQty: null, deliveryOnly: false, branchId: null }],
    rules: [{ id: "r1", ruleType: "add", keyword: "โค้กซีโร่", skuId: "coke", swapSkuId: null, submenuId: null, qtyPerMatch: 1, isActive: true, branchIds: [], menuIds: [] }],
    spLines: [],
    skus: SKUS.map((s) => ({ id: s.id, type: s.type })),
  });
  return {
    menus: MENUS,
    skus: SKUS,
    branches: BRANCHES,
    bom: [{ menuId: "mR", skuId: "duck", qtyPerServing: 50, effectiveQty: 50, branchId: null, deliveryOnly: false }],
    stdPrice: new Map([["duck", 0.5], ["pork", 0.2], ["coke", 12]]),
    priceAt: () => undefined,
    priceChanges: [],
    ctx,
    today: "2026-11-25",
  };
}

const dayUse = (q: number, days: string[]) => Object.fromEntries(days.map((d) => [d, q]));
const WEEK = ["2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22", "2026-11-23", "2026-11-24", "2026-11-25"];

function fake(over: Partial<StockStore> = {}, sales: FcSale[] = []): FullStore {
  const stock: StockStore = {
    // Thaniya: duck counted 1,000 g on 20 Nov, 500 g came from the kitchen on 22 Nov, 100 g a day used
    branchStock: async (branchId) =>
      branchId === "b1"
        ? {
            counts: [{ sku_id: "duck", count_date: "2026-11-20", physical_count: 1000 }],
            receipts: [{ sku_id: "duck", receipt_date: "2026-11-22", qty_received: 500, transfer_order_id: "to1" }],
            adjustments: [],
            waste: [],
            usageByDay: { duck: dayUse(100, WEEK) },
            sellingDays: 7,
            unanchoredFrom: "2026-10-22",
          }
        : { counts: [], receipts: [], adjustments: [], waste: [], usageByDay: {}, sellingDays: 0, unanchoredFrom: "2026-10-22" },
    kitchenStock: async () => ({ duck: 3000, pork: 5000, coke: 0 }),
    // Pork: 2,800 g went into production over the last 28 days → 100 g a day
    kitchenAdjustments: async () => [{ sku_id: "pork", adjustment_date: "2026-11-10", quantity: -2800, reason: "Production: 1 batches of x [rec a]" }],
    // Branches sold 10 ramen a day for the week → 500 g duck a day
    branchWeek: async () => ({ sales: WEEK.map((d) => ({ branch_id: "b1", sale_date: d, menu_code: "MN-001", menu_name: "Standard ชิโอะ ราเมน", qty: 10 })), waste: [] }),
    kitchenLastCount: async () => "2026-11-15",
    transfers: async () => ({
      orders: [
        { id: "to1", branch_id: "b1", delivery_date: "2026-11-22", status: "Received" },
        { id: "to2", branch_id: "b2", delivery_date: "2026-11-23", status: "Sent" },
        { id: "to3", branch_id: "b2", delivery_date: "2026-11-23", status: "Draft" },
      ],
      lines: [
        { to_id: "to1", sku_id: "duck", planned_qty: 600, actual_qty: 500, unit_cost: 0.5, line_value: 250 },
        { to_id: "to2", sku_id: "duck", planned_qty: 400, actual_qty: 0, unit_cost: 0.5, line_value: 0 },
        { to_id: "to3", sku_id: "duck", planned_qty: 999, actual_qty: 0, unit_cost: 0.5, line_value: 0 },
      ],
    }),
    ...over,
  };
  return { masters: async () => masters(), sales: async () => sales, corrections: async () => [], stock };
}

describe("stock, run rate, option rules, transfers", () => {
  it("store stock: the store page's balance and days left; an order for N days", async () => {
    const r = await branchStock(fake(), { item: "อกเป็ด", branch: "Thaniya", cover_days: 7 });
    // 1,000 + 500 − 100 × 5 days after the count (21–25) = 1,000; 100 a day → 10 days
    expect((r.data as { rows: unknown[] }).rows[0]).toMatchObject({ branch: "Thaniya", balance: "1 กก.", per_day: "100 ก.", days_left: 10, order_for_cover: "0 ก." });
  });

  it("store stock with no item: only what runs out soon", async () => {
    const soon = await branchStock(fake(), { low_within_days: 12 });
    expect((soon.data as { rows: { item: string }[] }).rows.map((x) => x.item)).toEqual(["อกเป็ดชาชู ซูวีด์ รมควัน"]);
    const none = await branchStock(fake(), {});
    expect((none.data as { rows: unknown[] }).rows).toEqual([]);
  });

  it("kitchen stock: made items by the branches' week, raw materials by the kitchen's 28 days", async () => {
    const r = await kitchenStock(fake(), { cover_days: 7 });
    const rows = (r.data as { rows: { item: string; per_day: string; days_left: number | null; order_for_cover?: string }[] }).rows;
    // duck: 3,000 g ÷ 500 g a day = 6 days (< 7: listed); order 7 × 500 − 3,000 = 500 g
    expect(rows.find((x) => x.item.startsWith("อกเป็ด"))).toMatchObject({ per_day: "500 ก.", days_left: 6, order_for_cover: "500 ก." });
    // pork: 5,000 ÷ 100 = 50 days: not near running out
    expect(rows.find((x) => x.item.startsWith("สันคอ"))).toBeUndefined();
    const one = await kitchenStock(fake(), { item: "สันคอ" });
    expect((one.data as { rows: { per_day: string; days_left: number }[] }).rows[0]).toMatchObject({ per_day: "100 ก.", days_left: 50 });
  });

  it("option rules: each rule's cost from the engine with and without it", async () => {
    const sales: FcSale[] = [
      { sale_date: "2026-11-10", branch_id: "b1", menu_code: "MN-075", menu_name: "Delivery Set A + โค้กซีโร่", qty: 3, net_amount: 1200, receipt_no: null },
      { sale_date: "2026-11-10", branch_id: "b1", menu_code: "MN-001", menu_name: "Standard ชิโอะ ราเมน", qty: 5, net_amount: 1500, receipt_no: null },
    ];
    const r = await ruleCost(fake({}, sales), { query: "โค้กซีโร่" });
    expect((r.data as { rules: unknown[] }).rules[0]).toMatchObject({ times: 3, cost: 36, per_time: 12 });
    const none = await ruleCost(fake({}, sales), { query: "ไม่มีกฎนี้" });
    expect(none.data).toMatchObject({ found: false });
  });

  it("transfers: sent and received only; what's still on its way counts its plan", async () => {
    const r = await transfers(fake(), { item: "อกเป็ด" });
    const d = r.data as { total_value: number; by_branch: { branch: string; value: number }[]; items: { sent: string; asked: string }[] };
    // to1 500 g × 0.5 = 250; to2 sent, nothing typed yet → planned 400 × 0.5 = 200; the draft left out
    expect(d.total_value).toBe(450);
    expect(d.by_branch).toEqual([{ branch: "Thaniya", value: 250, orders: 1 }, { branch: "Shiro", value: 200, orders: 1 }]);
    expect(d.items[0]).toMatchObject({ sent: "900 ก.", asked: "1 กก." });
  });

  it("rules: a keyword with a stray space still matches; plates counted even when the cost doesn't move", () => {
    const m = masters();
    const ctx = { ...m.ctx, rules: [{ ...m.ctx.rules[0], keyword: "โค้กซีโร่ " }, { id: "r2", ruleType: "add", keyword: "ฟรีน้ำ", skuId: "free", swapSkuId: null, submenuId: null, qtyPerMatch: 1, isActive: true, branchIds: [], menuIds: [] }] };
    const sales = [
      { sale_date: "2026-11-10", branch_id: "b1", menu_code: "MN-075", menu_name: "Delivery Set A + โค้กซีโร่", qty: 2 },
      { sale_date: "2026-11-10", branch_id: "b1", menu_code: "MN-075", menu_name: "Delivery Set A + โค้กซีโร่", qty: 1 },
      { sale_date: "2026-11-10", branch_id: "b1", menu_code: "MN-001", menu_name: "Standard ชิโอะ ราเมน ฟรีน้ำ", qty: 4 },
    ];
    const out = ruleCosts(m, ctx, sales, null);
    expect(out.find((x) => x.rule.id === "r1")).toMatchObject({ times: 3, cost: 36 });
    // an item with no price: no cost, but the 4 plates it applied to are still counted
    expect(out.find((x) => x.rule.id === "r2")).toMatchObject({ times: 4, cost: 0 });
  });

  it("an item not counted in 5 weeks: nothing on hand, so the order covers the whole need", async () => {
    const unknown = fake({
      branchStock: async () => ({ counts: [], receipts: [{ sku_id: "duck", receipt_date: "2026-11-01", qty_received: 5000, transfer_order_id: "t" }], adjustments: [], waste: [], usageByDay: { duck: dayUse(300, WEEK) }, sellingDays: 7, unanchoredFrom: "2026-10-22" }),
    });
    const r = await branchStock(unknown, { item: "อกเป็ด", branch: "Thaniya", cover_days: 3 });
    expect((r.data as { rows: { balance: string; order_for_cover: string }[] }).rows[0]).toMatchObject({ balance: "ไม่รู้ (ไม่ได้นับ)", order_for_cover: "900 ก." });
  });

  it("kitchen stock for the bot fails the answer when a read fails (never a silent 'หมด')", async () => {
    const failing = { from: () => ({ select: () => ({ eq: () => ({ is: () => ({ order: () => ({ range: async () => ({ data: null, error: { message: "URI too long" } }) }) }) }) }) }) };
    await expect(kitchenStockFor(failing, [{ id: "duck", type: "SM" }], ["duck"], { strict: true })).rejects.toThrow(/kitchen stock read failed/);
  });

  it("amounts read naturally", () => {
    expect(amount(1500, "g")).toBe("1.5 กก.");
    expect(amount(20, "g")).toBe("20 ก.");
    expect(amount(3, "ชิ้น")).toBe("3 ชิ้น");
  });
});
