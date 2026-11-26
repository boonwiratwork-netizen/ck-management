import { describe, expect, it } from "vitest";
import { buildUsageContext } from "../../../supabase/functions/_shared/sale-usage.ts";
import { calc, calculate, classifyMenus, menuEngineering, ingredientUsage, namedPeriod, periodOf, compareItems, foodCost, gramsPerPiece, ingredientInMenus, itemFilter, matchSku, previousPeriod, priceForFc, priceMovers, recipeWhatIf, ingredientPrice, matchByName, matchMenus, menuCost, resolveBranches, resolvePeriod, scenario, similarity, type Masters, type Store } from "../../../supabase/functions/line-bot/tools.ts";
import { toFlex } from "../../../supabase/functions/line-bot/cards.ts";
import { askedBot, IMAGE_WORDS, stripMentions, verifySignature } from "../../../supabase/functions/line-bot/line.ts";
import type { FcSale } from "../../../supabase/functions/_shared/food-cost.ts";

// A small shop: ramen R (100 g noodle + 50 g pork), gyoza G (6 pcs), pork topping "2 ชิ้น"
const MENUS = [
  { id: "mR", code: "MN-001", name: "Standard ชิโอะ ราเมน", brand: "Sendo", category: "Ramen", price: 300, active: true },
  { id: "mG", code: "MN-060", name: "เกี๊ยวซ่า", brand: "Sendo", category: "App", price: 100, active: true },
  { id: "mT", code: "MN-025", name: "อกเป็ดชาชู 2 ชิ้น (ท็อปปิ้ง)", brand: "Sendo", category: "Top", price: 60, active: true },
  { id: "mS", code: "MN-002", name: "Standard โชยุ ราเมน", brand: "Sendo", category: "Ramen", price: 300, active: true },
  { id: "mD", code: "MN-008", name: "มินิชาชูด้ง ข้าวโคชิฮิคาริ", brand: "Sendo", category: "Appetizer", price: 139, active: true },
  // A Line Man alias (no recipe of its own; its cost comes by an option rule in real data)
  { id: "mRL", code: "MN-001L", name: "Standard Shio Ramen (Line Man)", brand: "Sendo", category: "Ramen", price: 339, active: true },
];
const SKUS = [
  { id: "noodle", code: "SM-0001", name: "เส้นราเมน", type: "SM", uom: "g", purchaseUom: "g", active: true },
  { id: "duck", code: "SM-0005", name: "อกเป็ดชาชู ซูวีด์ รมควัน", type: "SM", uom: "g", purchaseUom: "g", active: true },
  { id: "gyoza", code: "SM-0020", name: "เกี๊ยวซ่า สูตร #1", type: "SM", uom: "ชิ้น", purchaseUom: "แพ็ค", active: true },
  { id: "rice", code: "RM-0100", name: "ข้าวญี่ปุ่น โคชิฮิคาริ", type: "RM", uom: "g", purchaseUom: "kg", active: true },
  { id: "fish", code: "RM-0200", name: "น้ำปลา", type: "RM", uom: "ml", purchaseUom: "ml", active: true },
  { id: "soy", code: "RM-0201", name: "น้ำซุป", type: "RM", uom: "ml", purchaseUom: "ml", active: true },
  { id: "salt", code: "RM-0300", name: "เกลือทะเล", type: "RM", uom: "kg", purchaseUom: "kg", active: true },
];
const BOM = [
  { menuId: "mR", skuId: "noodle", qty: 100 },
  { menuId: "mR", skuId: "duck", qty: 50 },
  { menuId: "mG", skuId: "gyoza", qty: 6 },
  { menuId: "mT", skuId: "duck", qty: 40 },
  { menuId: "mS", skuId: "noodle", qty: 100 },
  { menuId: "mD", skuId: "rice", qty: 55 },
  { menuId: "mD", skuId: "duck", qty: 20 },
];
const PRICE = new Map([["noodle", 0.1], ["duck", 0.5], ["gyoza", 3], ["rice", 0.045], ["fish", 0.08], ["soy", 0.02], ["salt", 20]]);
const BRANCHES = [{ id: "b1", name: "Thaniya", brand: "Sendo", active: true }, { id: "b2", name: "Shiro", brand: "Sendo", active: true }, { id: "b0", name: "Sendo Old", brand: "Sendo", active: false }];

function masters(): Masters {
  const ctx = buildUsageContext({
    menus: MENUS.map((m) => ({ id: m.id, menuCode: m.code })),
    bomLines: BOM.map((l) => ({ menuId: l.menuId, skuId: l.skuId, effectiveQty: l.qty, deliveryEffectiveQty: null, deliveryOnly: false, branchId: null })),
    rules: [],
    spLines: [],
    skus: SKUS.map((s) => ({ id: s.id, type: s.type })),
  });
  return {
    menus: MENUS,
    skus: SKUS,
    branches: BRANCHES,
    bom: BOM.map((l) => ({ menuId: l.menuId, skuId: l.skuId, qtyPerServing: l.qty, branchId: null, deliveryOnly: false })),
    stdPrice: PRICE,
    priceAt: () => undefined,
    priceChanges: [{ skuId: "duck", day: "2026-11-10", price: 0.5 }],
    ctx,
    today: "2026-11-25",
  };
}
const sale = (code: string, qty: number, net: number, o: Partial<FcSale> = {}): FcSale => ({ sale_date: "2026-11-10", branch_id: "b1", menu_code: code, menu_name: MENUS.find((m) => m.code === code)?.name ?? code, qty, net_amount: net, receipt_no: null, channel: "หน้าร้าน", ...o });
// 10 ramen (cost 35 each, sold 300), 10 gyoza (cost 18, sold 100), 2 ramen on LINE MAN at 300
const SALES = [sale("MN-001", 10, 3000), sale("MN-060", 10, 1000), sale("MN-001", 2, 600, { channel: "LINE MAN เดลิเวอรี", order_type: "Delivery" })];
const store = (sales = SALES): Store => ({ masters: async () => masters(), sales: async () => sales, corrections: async () => [] });

describe("matching names and periods", () => {
  it("Thai names match by letter pairs; a code matches exactly", () => {
    expect(similarity("อกเป็ดชาชู", "อกเป็ดชาชู ซูวีด์ รมควัน")).toBeGreaterThan(0.75);
    expect(matchByName(SKUS, "SM-0005")[0].item.id).toBe("duck");
    expect(matchByName(SKUS, "ข้าวญี่ปุ่นสุก")[0].item.id).toBe("rice");
    expect(matchByName(SKUS, "ซอสทรัฟเฟิล")).toEqual([]);
  });
  it("default period = this month so far; on the 1st, last month; dates after today pulled back", () => {
    expect(resolvePeriod("2026-11-25")).toEqual({ from: "2026-11-01", to: "2026-11-25" });
    expect(resolvePeriod("2026-12-01")).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(resolvePeriod("2026-11-25", "2026-10-01", "2026-12-31")).toEqual({ from: "2026-10-01", to: "2026-11-25" });
  });
  it("branches by name or Thai name; unknown says so and uses all", () => {
    expect(resolveBranches(masters(), "ธนิยะ").ids).toEqual(["b1"]);
    // "All" counts a closed branch too (its sales in the period still happened), as the Food Cost page does
    expect(resolveBranches(masters(), null).ids).toEqual(["b1", "b2", "b0"]);
    expect(resolveBranches(masters(), "สีลม").unknown).toBe("สีลม");
    expect(resolveBranches(masters(), "Mall").unknown).toBe("Mall");
  });
});

describe("tools", () => {
  it("menu_cost: one plate through the engine, and FC at a new price", async () => {
    const r = await menuCost(store(), { query: "standard ชิโอะ", new_price: 250 });
    expect(r.data).toMatchObject({ cost_per_plate: 35, food_cost_pct: 14 });
  });

  it("food_cost: the Food Cost page's numbers for the period", async () => {
    const r = await foodCost(store(), {});
    // revenue 4,600; cost 12×35 + 10×18 = 600
    expect(r.data).toMatchObject({ revenue: 4600, recipe_cost: 600, food_cost_pct: 13 });
    expect(r.card?.headline).toBe("13.0%");
  });

  it("scenario: new shop price on the shop sales only, cost unchanged, break-even volume", async () => {
    const r = await scenario(store(), { menu_prices: [{ menu: "Standard ชิโอะ", new_price: 240 }] });
    const d = r.data as { now: { revenue: number; gross_after_ingredients: number }; scenario: { revenue: number; recipe_cost: number }; change_in_gross_after_ingredients: number; break_even_volume_pct_on_repriced: number };
    // shop ramen 3,000 × 240/300 = 2,400 (−600); delivery 600 unchanged
    expect(d.scenario.revenue).toBe(4000);
    expect(d.scenario.recipe_cost).toBe(600);
    expect(d.change_in_gross_after_ingredients).toBe(-600);
    // repriced ramen after the change: revenue 2,400 + 600 = 3,000, cost 420 → GP 2,580; need +600 → 23.3%
    expect(d.break_even_volume_pct_on_repriced).toBe(23.3);
  });

  it("scenario: volume up and an ingredient dearer, together", async () => {
    const r = await scenario(store(), { ingredient_prices: [{ item: "อกเป็ด", change_pct: 10 }], volume: [{ menus: ["เกี๊ยวซ่า"], change_pct: 50 }] });
    const d = r.data as { scenario: { revenue: number; recipe_cost: number } };
    // duck +10%: 12 ramen × 50 g × 0.05 = +30; gyoza ×1.5: revenue +500, cost +90
    expect(d.scenario.revenue).toBe(5100);
    expect(d.scenario.recipe_cost).toBe(720);
  });

  it("scenario: a whole category up 10% (ราเมน → every Ramen menu sold), rounded to the baht", async () => {
    const r = await scenario(store(), { menu_prices: [{ category: "ราเมน", change_pct: 10 }] });
    const d = r.data as { repriced_menus: { code: string; new_price: number }[]; scenario: { revenue: number } };
    expect(d.repriced_menus).toEqual([expect.objectContaining({ code: "MN-001", new_price: 330 })]);
    // shop ramen 3,000 × 1.1 = 3,300; gyoza and delivery unchanged
    expect(d.scenario.revenue).toBe(4900);
  });

  it("scenario: price, recipe and volume in one go (recipe on every plate, delivery too)", async () => {
    const r = await scenario(store(), {
      menu_prices: [{ category: "ราเมน", change_pct: 10 }],
      recipe_changes: [{ menu: "Standard ชิโอะ", changes: [{ item: "อกเป็ด", action: "set_qty", qty: 30, unit: "g" }] }],
      volume: [{ group: "all", change_pct: 20 }],
    });
    const d = r.data as { scenario: { revenue: number; recipe_cost: number }; recipe_changes_done: string[] };
    // duck 50 → 30 g: −10 a plate × 12 plates (10 shop + 2 delivery) → 600 − 120 = 480; then everything × 1.2
    expect(d.scenario.recipe_cost).toBe(576);
    expect(d.scenario.revenue).toBe(5880);
    expect(d.recipe_changes_done[0]).toMatch(/Standard ชิโอะ/);
  });

  it("scenario: a recipe change alone, and the Line Man alias plates follow the menu", async () => {
    const sales = [...SALES, sale("MN-001L", 3, 900, { menu_name: "Standard Shio Ramen (Line Man)", channel: "LINE MAN เดลิเวอรี" })];
    const r = await scenario(store(sales), { recipe_changes: [{ menu: "Standard ชิโอะ", changes: [{ item: "อกเป็ด", action: "remove" }] }] });
    // −25 a plate × 15 plates
    expect((r.data as { now: { recipe_cost: number }; scenario: { recipe_cost: number } }).scenario.recipe_cost).toBe(600 - 375);
  });

  it("scenario: a new menu not in the system, costed from its items, added to the whole shop", async () => {
    const r = await scenario(store(), {
      new_menus: [
        { name: "ข้าวหน้าแซลมอน", price: 200, plates_per_day: 5, items: [{ name: "อกเป็ดชาชู", qty: 100, unit: "g" }, { name: "เส้นราเมน", qty: 100, unit: "g" }, { name: "แซลมอนนอร์เวย์", qty: 80, unit: "g", stated_cost: 40 }] },
        { name: "เมนูลอง", price: 100, plates_per_day: 2, items: [{ name: "ทรัฟเฟิลขาว", qty: 5, unit: "g" }] },
      ],
    });
    const d = r.data as { scenario: { revenue: number; recipe_cost: number }; new_menus: { name: string; cost_per_plate: number; food_cost_pct: number }[]; assumptions: string[] };
    // 50 + 10 + 40 stated = 100 a plate; sales on 1 day → 5 plates
    expect(d.new_menus).toEqual([expect.objectContaining({ name: "ข้าวหน้าแซลมอน", cost_per_plate: 100, food_cost_pct: 50 })]);
    // a menu whose cost isn't known stays out of the totals (at ฿0 it would lower the shop's FC)
    expect(d.scenario.revenue).toBe(4600 + 1000);
    expect(d.scenario.recipe_cost).toBe(600 + 500);
    expect(d.assumptions.join(" ")).toMatch(/เมนูลอง: ยังไม่ได้รวม.*ทรัฟเฟิลขาว/);
    const bare = await scenario(store(), { new_menus: [{ name: "X", price: 200, plates_per_day: 10 }] });
    expect((bare.data as { scenario: { revenue: number } }).scenario.revenue).toBe(4600);
    const quiet = await scenario(store([]), { new_menus: [{ name: "X", price: 200, plates_per_day: 10, cost: 60 }] });
    expect((quiet.data as { assumptions: string[] }).assumptions.join(" ")).toMatch(/ไม่มียอดขาย/);
  });

  it("scenario: a recipe change and a price change on the same item cost the item once, at its new price", async () => {
    const out = await scenario(store(), {
      recipe_changes: [{ menu: "Standard ชิโอะ", changes: [{ item: "อกเป็ด", action: "remove" }] }],
      ingredient_prices: [{ item: "อกเป็ด", change_pct: 20 }],
    });
    // ramen without duck: 10 noodle × 12 = 120; gyoza 180 → 300 (duck's price rise no longer in the ramen)
    expect((out.data as { scenario: { recipe_cost: number } }).scenario.recipe_cost).toBe(300);
    const less = await scenario(store(), {
      recipe_changes: [{ menu: "Standard ชิโอะ", changes: [{ item: "อกเป็ด", action: "set_qty", qty: 30, unit: "g" }] }],
      ingredient_prices: [{ item: "อกเป็ด", change_pct: 50 }],
    });
    // 30 g at 0.75 = 22.5 + 10 noodle = 32.5 a plate × 12 = 390; + gyoza 180
    expect((less.data as { scenario: { recipe_cost: number } }).scenario.recipe_cost).toBe(570);
  });

  it("scenario: the same change said twice (a group, then the menu) is made once", async () => {
    const twice = { item: "อกเป็ด", action: "set_qty" as const, qty: 30, unit: "g" };
    const r = await scenario(store(), { recipe_changes: [{ menu: "Standard", changes: [twice] }, { menu: "Standard ชิโอะ", changes: [twice] }] });
    expect((r.data as { scenario: { recipe_cost: number } }).scenario.recipe_cost).toBe(480);
  });

  it("scenario: break-even counts only the repriced menus' own profit", async () => {
    const r = await scenario(store(), { menu_prices: [{ menu: "Standard ชิโอะ", new_price: 240 }], recipe_changes: [{ menu: "เกี๊ยวซ่า", changes: [{ item: "เกี๊ยว", action: "remove" }] }] });
    expect((r.data as { break_even_volume_pct_on_repriced: number }).break_even_volume_pct_on_repriced).toBe(23.3);
  });

  it("compare_items: a new dish's FC at its price, and the price for a target FC", async () => {
    const r = await compareItems(store(), { dish: "ราเมนใหม่", selling_price: 200, target_fc: 30, items: [{ name: "อกเป็ดชาชู", qty: 100, unit: "g" }, { name: "เส้นราเมน", qty: 100, unit: "g" }] });
    expect(r.data).toMatchObject({ estimated_total: 60, food_cost_pct: 30, price_for_target_fc: 200 });
    // 0.3 meant as 30%
    const frac = await compareItems(store(), { selling_price: 200, target_fc: 0.3, items: [{ name: "อกเป็ดชาชู", qty: 100, unit: "g" }] });
    expect(frac.data).toMatchObject({ target_fc: 30, price_for_target_fc: 167 });
    // an item that can't be priced: no FC from a part of the dish
    const part = await compareItems(store(), { selling_price: 200, target_fc: 30, items: [{ name: "อกเป็ดชาชู", qty: 100, unit: "g" }, { name: "ทรัฟเฟิลขาว", qty: 5, unit: "g" }] });
    expect(part.data).toMatchObject({ food_cost_pct: null, price_for_target_fc: null, not_costed: ["ทรัฟเฟิลขาว"] });
    expect(part.card?.notes?.join(" ")).toMatch(/ยังคิด FC ไม่ได้/);
  });

  it("scenario: a menu that can't be found is listed, never guessed", async () => {
    const r = await scenario(store(), { menu_prices: [{ menu: "White Crema", new_price: 289 }] });
    expect((r.data as { not_found: string[] }).not_found).toEqual(["White Crema"]);
  });

  it("compare_items: pieces → grams from a '2 ชิ้น' menu; unknown items left to the stated cost", async () => {
    expect(gramsPerPiece(masters(), "duck")).toEqual({ grams: 20, from: "อกเป็ดชาชู 2 ชิ้น (ท็อปปิ้ง) (MN-025)" });
    const r = await compareItems(store(), {
      dish: "ข้าวหน้าเป็ด",
      items: [
        { name: "อกเป็ดชาชู", qty: 6, unit: "ชิ้น", stated_cost: 35.52 },
        { name: "ข้าวญี่ปุ่นสุก", qty: 180, unit: "g", stated_cost: 8.1 },
        { name: "ซอสทรัฟเฟิล", qty: 25, unit: "g", stated_cost: 5 },
      ],
    });
    const d = r.data as { items: { status: string; system_cost?: number; warning?: string | null }[]; estimated_total: number };
    expect(d.items.map((i) => i.status)).toEqual(["ok", "ok", "not_in_system"]);
    expect(d.items[0].system_cost).toBe(60); // 6 × 20 g × 0.5
    // cooked rice: 180 g cooked = 90 g raw (house yield ×2) × 0.045
    expect(d.items[1].system_cost).toBe(4.05);
    expect(d.estimated_total).toBe(69.05);
  });

  it("ingredient_price: a cooked quantity is costed raw by the house yield, worked out by the tool", async () => {
    const r = await ingredientPrice(store(), { query: "ข้าวญี่ปุ่น", qty: 180, unit: "g", cooked: true });
    expect((r.data as { cost_for_qty: unknown }).cost_for_qty).toMatchObject({ qty_in_system_unit: 90, cost: 4.05 });
    expect(r.card).toBeUndefined();
  });

  it("ingredient_in_menus: which menus use rice, raw and ≈cooked, filtered to ด้ง", async () => {
    const r = await ingredientInMenus(store(), { query: "ข้าวญี่ปุ่น", menus: "ด้ง" });
    expect((r.data as { menus: unknown[] }).menus).toEqual([{ code: "MN-008", name: "มินิชาชูด้ง ข้าวโคชิฮิคาริ", qty: 55, cooked_qty: 110, cost: 2.48 }]);
  });

  it("a group name means every menu in it: menu_cost and scenario", async () => {
    expect(matchMenus(MENUS, "Standard").map((x) => x.code)).toEqual(["MN-001", "MN-002"]);
    expect(matchMenus(MENUS, "Standard ชิโอะ").map((x) => x.code)).toEqual(["MN-001"]);
    const c = await menuCost(store(), { query: "Standard" });
    expect((c.data as { menus: { code: string }[] }).menus.map((x) => x.code)).toEqual(["MN-001", "MN-002"]);
    const sales = [...SALES, sale("MN-002", 10, 3000)];
    const r = await scenario(store(sales), { menu_prices: [{ menu: "Standard", new_price: 270 }] });
    expect((r.data as { repriced_menus: { code: string }[] }).repriced_menus.map((x) => x.code).sort()).toEqual(["MN-001", "MN-002"]);
  });

  it("English menu words, any order, shop menu before the Line Man alias; protein-only cost summed by the tool", async () => {
    const pool = [...MENUS, { id: "mSL", code: "MN-002L", name: "Signature Shoyu Ramen (Line Man)", brand: "Sendo", category: "Ramen", price: 389, active: true }, { id: "mSig", code: "MN-005", name: "Signature โชยุ ราเมน", brand: "Sendo", category: "Signature Ramen", price: 389, active: true }];
    expect(matchMenus(pool, "Shoyu Signature").map((x) => x.code)).toEqual(["MN-005"]);
    expect(itemFilter("โปรตีน")!.test("อกเป็ดชาชู ซูวีด์")).toBe(true);
    expect(itemFilter("protein")!.test("เส้นราเมน")).toBe(false);
    const r = await menuCost(store(), { query: "Standard ชิโอะ", only: "protein" });
    // ramen: 50 g duck × 0.5 = 25 of the plate's 35
    expect(r.data).toMatchObject({ only_cost: 25, cost_per_plate: 35 });
    const g = await menuCost(store(), { query: "ราเมน", only: "โปรตีน" });
    expect((g.data as { menus: { code: string; only_cost: number }[] }).menus.map((x) => [x.code, x.only_cost])).toEqual([["MN-001", 25], ["MN-002", 0]]);
    // Item by item per serving, and the per-menu table after it
    expect((g.data as { items_per_serving: unknown[] }).items_per_serving).toEqual([{ item: "อกเป็ดชาชู ซูวีด์ รมควัน", in_menus: 1, qty: "50 ก.", cost: "25.00" }]);
    expect(g.moreCards?.length).toBe(1);
  });

  it("compare_items: a generic name asks, an unknown unit is never guessed, a kg item takes grams right", async () => {
    const r = await compareItems(store(), {
      items: [
        { name: "น้ำ", qty: 300, unit: "ml", stated_cost: 5 },
        { name: "อกเป็ดชาชู", qty: 2, unit: "ช้อนโต๊ะ", stated_cost: 5 },
        { name: "เกลือทะเล", qty: 10, unit: "g", stated_cost: 1 },
      ],
    });
    const d = r.data as { items: { status: string; system_cost?: number }[] };
    expect(d.items.map((i) => i.status)).toEqual(["ambiguous", "unit_unknown", "ok"]);
    expect(d.items[2].system_cost).toBe(0.2); // 10 g = 0.01 kg × ฿20/kg
  });
});

describe("the upgrade: questions near the ones that failed", () => {
  it("recipe what-if: take an item out, change an amount, swap; per plate, FC and this month", async () => {
    const r = await recipeWhatIf(store(), { menu: "Standard ชิโอะ", changes: [{ item: "อกเป็ด", action: "set_qty", qty: 30, unit: "g" }] });
    const m0 = (r.data as { menus: { cost_before: number; cost_after: number; plates_sold_this_month: number; change_this_month: number }[] }).menus[0];
    // 50 g → 30 g duck at 0.5: 35 → 25 per plate; 12 plates sold → −120
    expect(m0).toMatchObject({ cost_before: 35, cost_after: 25, plates_sold_this_month: 12, change_this_month: -120 });
    const out = await recipeWhatIf(store(), { menu: "Standard ชิโอะ", changes: [{ item: "เส้น", action: "remove" }, { item: "ซอสบาร์บีคิว", action: "remove" }] });
    const m1 = (out.data as { menus: { cost_after: number; not_done: string[] }[] }).menus[0];
    expect(m1.cost_after).toBe(25);
    expect(m1.not_done[0]).toMatch(/ไม่มี "ซอสบาร์บีคิว"/);
    const sw = await recipeWhatIf(store(), { menu: "Standard ชิโอะ", changes: [{ item: "อกเป็ด", action: "replace", replace_with: "เกลือทะเล" }] });
    // same 50 (g) of salt at ฿20/kg = 1.00, plus 10 noodle
    expect((sw.data as { menus: { cost_after: number }[] }).menus[0].cost_after).toBe(11);
  });

  it("target FC → the price to sell at, rounded up", async () => {
    expect(priceForFc(35, 30)).toBe(117);
    const r = await menuCost(store(), { query: "Standard ชิโอะ", target_fc: 30 });
    expect(r.data).toMatchObject({ price_for_target_fc: 117 });
  });

  it("food_cost: highest FC first (≥5 plates), only a group, plates sold", async () => {
    const r = await foodCost(store(), { sort: "fc_high" });
    expect((r.data as { menus: { code: string }[] }).menus.map((x) => x.code)).toEqual(["MN-060", "MN-001"]);
    const g = await foodCost(store(), { menus: "ราเมน", sort: "qty" });
    expect(g.data).toMatchObject({ only_menus_qty: 12, only_menus_revenue: 3600 });
  });

  it("food_cost: side by side for branches and against last month's same days", async () => {
    const b = await foodCost(store(), { compare: "branches" });
    expect((b.data as { rows: { label: string }[] }).rows.map((x) => x.label)).toEqual(["Thaniya", "Shiro", "Sendo Old"]);
    expect(previousPeriod({ from: "2026-11-01", to: "2026-11-25" })).toEqual({ from: "2026-10-01", to: "2026-10-25" });
    expect(previousPeriod({ from: "2026-03-01", to: "2026-03-31" })).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(previousPeriod({ from: "2026-11-10", to: "2026-11-16" })).toEqual({ from: "2026-11-03", to: "2026-11-09" });
  });

  it("price movers: what moved and what it cost over the period's usage", async () => {
    const m = masters();
    // history: duck 0.4 until 1 Nov, 0.5 after
    const moved: Store = { ...store(), masters: async () => ({ ...m, priceAt: (id, day) => (id === "duck" ? (day < "2026-11-01" ? 0.4 : 0.5) : undefined) }) };
    const r = await priceMovers(moved, { days: 30 });
    const it = (r.data as { items: { item: string; change_pct: number; cost_effect_in_period: number }[] }).items[0];
    // duck 0.4 → 0.5 (+25%); used 12 × 50 g = 600 g → +60
    expect(it).toMatchObject({ item: "อกเป็ดชาชู ซูวีด์ รมควัน (SM-0005)", change_pct: 25, cost_effect_in_period: 60 });
  });

  it("recipe what-if sees sub-recipes as one line and keeps the recipe's yield", async () => {
    const m = masters();
    // Ramen gets a sauce (SP: 10 g sauce = 5 g salt-ish item at 0.02 + ...) and the duck is served 40 g at 80% yield (50 g taken)
    const ctx = buildUsageContext({
      menus: MENUS.map((x) => ({ id: x.id, menuCode: x.code })),
      bomLines: [
        { menuId: "mR", skuId: "noodle", effectiveQty: 100, deliveryEffectiveQty: null, deliveryOnly: false, branchId: null },
        { menuId: "mR", skuId: "duck", effectiveQty: 50, deliveryEffectiveQty: null, deliveryOnly: false, branchId: null },
        { menuId: "mR", skuId: "bbq", effectiveQty: 15, deliveryEffectiveQty: null, deliveryOnly: false, branchId: null },
      ],
      rules: [],
      spLines: [{ spSkuId: "bbq", ingredientSkuId: "soy", qtyPerBatch: 100, batchYieldQty: 100 }],
      skus: [...SKUS, { id: "bbq", type: "SP" }].map((x) => ({ id: x.id, type: x.type })),
    });
    const withSauce: Masters = {
      ...m,
      skus: [...m.skus, { id: "bbq", code: "SP-0001", name: "ซอสบาร์บีคิว", type: "SP", uom: "g", purchaseUom: "g", active: true }],
      bom: [
        { menuId: "mR", skuId: "noodle", qtyPerServing: 100, effectiveQty: 100, branchId: null, deliveryOnly: false },
        { menuId: "mR", skuId: "duck", qtyPerServing: 40, effectiveQty: 50, branchId: null, deliveryOnly: false },
        { menuId: "mR", skuId: "bbq", qtyPerServing: 15, effectiveQty: 15, branchId: null, deliveryOnly: false },
      ],
      ctx,
    };
    const st: Store = { ...store(), masters: async () => withSauce };
    // plate: noodle 10 + duck 25 + sauce 15 × 0.02 = 0.30 → 35.30
    const out = await recipeWhatIf(st, { menu: "Standard ชิโอะ", changes: [{ item: "ซอสบาร์บีคิว", action: "remove" }] });
    expect((out.data as { menus: { cost_before: number; cost_after: number }[] }).menus[0]).toMatchObject({ cost_before: 35.3, cost_after: 35 });
    // duck served 40 → 20 g: at 80% yield takes 25 g → 12.50 (was 25)
    const less = await recipeWhatIf(st, { menu: "Standard ชิโอะ", changes: [{ item: "duck", action: "set_qty", qty: 20, unit: "g" }] });
    expect((less.data as { menus: { cost_after: number }[] }).menus[0].cost_after).toBe(22.8);
  });

  it("Line Man aliases count as the same menu's plates; groups that match nothing say so", async () => {
    const sales = [...SALES, sale("MN-001L", 3, 900, { menu_name: "Standard Shio Ramen (Line Man)", channel: "LINE MAN เดลิเวอรี" })];
    const r = await recipeWhatIf(store(sales), { menu: "Standard ชิโอะ", changes: [{ item: "อกเป็ด", action: "remove" }] });
    expect((r.data as { menus: { plates_sold_this_month: number }[] }).menus[0].plates_sold_this_month).toBe(15);
    const none = await foodCost(store(), { menus: "พิซซ่า" });
    expect(none.data).toMatchObject({ found: false });
  });

  it("FC rankings skip menus without a recipe cost; a 0.3 target means 30%; previous period only within one month", async () => {
    const sales = [...SALES, ...Array.from({ length: 6 }, () => sale("MN-999", 1, 50, { menu_name: "น้ำเปล่า" }))];
    const lo = await foodCost(store(sales), { sort: "fc_low" });
    expect((lo.data as { menus: { code: string }[] }).menus.map((x) => x.code)).not.toContain("MN-999");
    expect(priceForFc(30.000000000000004, 30)).toBe(100);
    expect(priceForFc(35, 0.3)).toBe(117);
    expect(previousPeriod({ from: "2026-10-01", to: "2026-11-15" })).toEqual({ from: "2026-08-16", to: "2026-09-30" });
  });

  it("English ingredient names", () => {
    expect(matchSku(SKUS, "fish sauce").length).toBeGreaterThanOrEqual(0);
    expect(matchSku(SKUS, undefined)).toEqual([]);
    expect(matchSku(SKUS, "duck breast")[0].item.id).toBe("duck");
    expect(matchSku(SKUS, "japanese rice")[0].item.id).toBe("rice");
  });
});

describe("false-proofing and the next use cases", () => {
  it("periods in words are worked out by the tool; Thai-calendar years are read as such", () => {
    // 25 Nov 2026 is a Wednesday
    expect(namedPeriod("2026-11-25", "yesterday")).toEqual({ from: "2026-11-24", to: "2026-11-24" });
    expect(namedPeriod("2026-11-25", "this_week")).toEqual({ from: "2026-11-23", to: "2026-11-25" });
    expect(namedPeriod("2026-11-25", "last_week")).toEqual({ from: "2026-11-16", to: "2026-11-22" });
    expect(namedPeriod("2026-11-25", "last_month")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(namedPeriod("2026-03-10", "last_month")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(periodOf("2026-11-25", { from: "2569-11-01", to: "2569-11-10" })).toEqual({ from: "2026-11-01", to: "2026-11-10" });
  });

  it("the card says when sales stop short, when there are none, and when a branch isn't known", async () => {
    const r = await foodCost(store(), { branch: "สีลม" });
    const notes = r.card!.notes!.join(" | ");
    expect(notes).toMatch(/ยอดขายในระบบมีถึง 10 พ.ย./);
    expect(notes).toMatch(/ไม่รู้จักสาขา "สีลม"/);
    const none = await foodCost(store([]), {});
    expect(none.card!.notes!.join(" ")).toMatch(/ยังไม่มียอดขาย/);
  });

  it("today's sales arriving tomorrow is not 'missing'; a branch two days behind is, by name", async () => {
    const m = masters();
    const fresh = [sale("MN-001", 1, 300, { sale_date: "2026-11-24" }), sale("MN-001", 1, 300, { sale_date: "2026-11-24", branch_id: "b2" })];
    const r = await foodCost(store(fresh), {});
    expect(r.card!.notes!.join(" ")).not.toMatch(/มีถึง/);
    const behind = [sale("MN-001", 1, 300, { sale_date: "2026-11-24" }), sale("MN-001", 1, 300, { sale_date: "2026-11-22", branch_id: "b2" })];
    const r2 = await foodCost(store(behind), {});
    expect(r2.card!.notes!.join(" ")).toMatch(/Shiro: ยอดขายในระบบมีถึง 22 พ.ย./);
    expect(m.today).toBe("2026-11-25");
  });

  it("menu engineering counts a dish and its Line Man alias as one; FC by day for one group", async () => {
    const sales = [...SALES, sale("MN-001L", 5, 1500, { channel: "LINE MAN เดลิเวอรี" })];
    const e = await menuEngineering(store(sales), {});
    expect((e.data as { menus: { code: string; plates: number }[] }).menus.find((x) => x.code === "MN-001")?.plates).toBe(17);
    expect((e.data as { menus: { code: string }[] }).menus.map((x) => x.code)).not.toContain("MN-001L");
    const d = await foodCost(store(), { by_day: true, menus: "เกี๊ยวซ่า" });
    expect((d.data as { days: { revenue: number }[] }).days[0].revenue).toBe(1000);
  });

  it("ขีด / โล are units too", async () => {
    const r = await compareItems(store(), { items: [{ name: "อกเป็ดชาชู", qty: 1, unit: "ขีด", stated_cost: 50 }] });
    expect((r.data as { items: { system_cost: number }[] }).items[0].system_cost).toBe(50);
  });

  it("menu engineering: stars, plowhorses, puzzles, dogs", () => {
    const out = classifyMenus([
      { code: "A", name: "ขายดีกำไรดี", qty: 100, revenue: 30000, stdCost: 9000 },
      { code: "B", name: "ขายดีกำไรน้อย", qty: 100, revenue: 15000, stdCost: 9000 },
      { code: "C", name: "ขายน้อยกำไรดี", qty: 10, revenue: 4000, stdCost: 800 },
      { code: "D", name: "ขายน้อยกำไรน้อย", qty: 10, revenue: 1000, stdCost: 700 },
      { code: "E", name: "ไม่มีสูตร", qty: 50, revenue: 5000, stdCost: 0 },
    ]);
    expect(Object.fromEntries(out.map((x) => [x.code, x.cls]))).toEqual({ A: "star", B: "plowhorse", C: "puzzle", D: "dog" });
  });

  it("ingredient usage by recipe for a period, and food cost day by day", async () => {
    const r = await ingredientUsage(store(), { query: "อกเป็ด" });
    // 12 ramen × 50 g = 600 g = 0.6 kg, ฿300
    expect(r.data).toMatchObject({ used_by_recipe: "600 ก.", cost: 300 });
    const d = await foodCost(store(), { by_day: true });
    expect((d.data as { days: { day: string; revenue: number }[] }).days).toEqual([expect.objectContaining({ day: "2026-11-10", revenue: 4600 })]);
  });
});

describe("LINE plumbing", () => {
  it("cards become a Flex bubble within LINE's limits", () => {
    const f = toFlex({ title: "t", columns: ["a", "b", "c"], rows: Array.from({ length: 30 }, () => ["x", "1", "2"]), notes: ["n"] });
    expect(f.type).toBe("flex");
    expect(JSON.stringify(f).length).toBeLessThan(30_000);
  });
  it("mentions are taken out of the question", () => {
    expect(stripMentions("@ต้นทุนบอท ถ้า Standard 289", [{ index: 0, length: 10, isSelf: true }])).toBe("ถ้า Standard 289");
  });
  it("called by @mention or by starting with บอท / bot; ordinary messages left alone", () => {
    expect(askedBot("บอท food cost เดือนนี้")).toEqual({ asked: true, question: "food cost เดือนนี้" });
    expect(askedBot("บอทต้นทุนเป็ดเท่าไหร่")).toEqual({ asked: true, question: "ต้นทุนเป็ดเท่าไหร่" });
    expect(askedBot("@บอท ถ้า Standard 289")).toEqual({ asked: true, question: "ถ้า Standard 289" });
    expect(askedBot("Bot: food cost")).toEqual({ asked: true, question: "food cost" });
    expect(askedBot("bottle of sauce").asked).toBe(false);
    expect(askedBot("ส่งผิดกลุ่ม").asked).toBe(false);
    expect(askedBot("@Livetoeat ต้นทุน", [{ index: 0, length: 10, isSelf: true }])).toEqual({ asked: true, question: "ต้นทุน" });
  });
  it("a wrong signature is refused, the right one accepted", async () => {
    const body = '{"events":[]}';
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("s3cret"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)))));
    expect(await verifySignature(body, sig, "s3cret")).toBe(true);
    expect(await verifySignature(body, sig, "other")).toBe(false);
    expect(await verifySignature(body, null, "s3cret")).toBe(false);
  });
});

describe("the calculator and the photo words", () => {
  it("sums with brackets, %, commas and ×; anything else is refused, never guessed", async () => {
    expect(calc("(85.2 + 18) / 399 * 100")).toBeCloseTo(25.8647, 3);
    expect(calc("1,200 × 30")).toBe(36000);
    expect(calc("300 * 0.1 - -5")).toBe(35);
    expect(calc(".5 * 2")).toBe(1);
    // % is refused (people mean 289 + 10% = 317.9); a comma only as thousands
    expect(() => calc("289 + 10%")).toThrow(/ทศนิยม/);
    expect(() => calc("(1,2)")).toThrow();
    expect(() => calc("85.20,18")).toThrow();
    expect(calc("-(2 + 3) * 4")).toBe(-20);
    expect(() => calc("85 บาท + 18")).toThrow(/อ่านไม่ออก/);
    expect(() => calc("1/0")).toThrow(/ศูนย์/);
    expect(() => calc("(1 + 2")).toThrow(/วงเล็บ/);
    expect(() => calc("process.exit()")).toThrow();
    const r = await calculate(store(), { expression: "(85.2 + 18) / 399 * 100", about: "FC เซ็ต" });
    expect(r.data).toMatchObject({ result: 25.864662, shown: 25.86, about: "FC เซ็ต" });
    // a per-gram price stays exact for the next step
    expect((await calculate(store(), { expression: "85 / 1000" })).data).toMatchObject({ result: 0.085 });
    expect((await calculate(store(), { expression: "ราเมน + 18" })).data).toMatchObject({ error: expect.stringMatching(/คิดไม่ได้/) });
  });

  it("'เดือนนี้' / 'วันนี้' don't pull in a photo; 'เมนูนี้' / 'ในรูป' do", () => {
    for (const q of ["FC เดือนนี้เท่าไหร่", "วันนี้ขายได้เท่าไหร่", "สัปดาห์นี้ของใกล้หมดไหม", "ขอภาพรวม food cost เดือนนี้", "ต้นทุน Red Spicy Ramen", "รูปแบบการคิด"]) expect(IMAGE_WORDS.test(q)).toBe(false);
    for (const q of ["เมนูนี้ต้นทุนเท่าไหร่", "ต้นทุนในรูปถูกไหม", "จานนี้ FC เท่าไหร่", "อันนี้คิดยังไง", "ใบนี้ถูกไหม", "เซทนี้ FC เท่าไหร่", "ตามภาพข้างล่าง", "เช็คอันที่ส่งไป", "see the pic"]) expect(IMAGE_WORDS.test(q)).toBe(true);
  });
});
