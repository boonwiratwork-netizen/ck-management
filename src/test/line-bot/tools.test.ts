import { describe, expect, it } from "vitest";
import { buildUsageContext } from "../../../supabase/functions/_shared/sale-usage.ts";
import { compareItems, foodCost, gramsPerPiece, ingredientInMenus, itemFilter, ingredientPrice, matchByName, matchMenus, menuCost, resolveBranches, resolvePeriod, scenario, similarity, type Masters, type Store } from "../../../supabase/functions/line-bot/tools.ts";
import { toFlex } from "../../../supabase/functions/line-bot/cards.ts";
import { askedBot, stripMentions, verifySignature } from "../../../supabase/functions/line-bot/line.ts";
import type { FcSale } from "../../../supabase/functions/_shared/food-cost.ts";

// A small shop: ramen R (100 g noodle + 50 g pork), gyoza G (6 pcs), pork topping "2 ชิ้น"
const MENUS = [
  { id: "mR", code: "MN-001", name: "Standard ชิโอะ ราเมน", brand: "Sendo", category: "Ramen", price: 300, active: true },
  { id: "mG", code: "MN-060", name: "เกี๊ยวซ่า", brand: "Sendo", category: "App", price: 100, active: true },
  { id: "mT", code: "MN-025", name: "อกเป็ดชาชู 2 ชิ้น (ท็อปปิ้ง)", brand: "Sendo", category: "Top", price: 60, active: true },
  { id: "mS", code: "MN-002", name: "Standard โชยุ ราเมน", brand: "Sendo", category: "Ramen", price: 300, active: true },
  { id: "mD", code: "MN-008", name: "มินิชาชูด้ง ข้าวโคชิฮิคาริ", brand: "Sendo", category: "Appetizer", price: 139, active: true },
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
