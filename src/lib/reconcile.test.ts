import { describe, expect, it } from "vitest";
import {
  branchDaysOf,
  buildReconcile,
  cellText,
  monthsBack,
  parseRcHash,
  rcHash,
  cellsOf,
  daysLine,
  daysText,
  kitchenRows,
  labelOf,
  onlyOff,
  reconcilePeriod,
  servingFor,
  skuConverter,
  sortRows,
  toTsv,
  verdictOf,
  type Cell,
  type RcCount,
  type RcSale,
  type RcSku,
} from "@/lib/reconcile";
import { overRecipeAndWaste } from "@/lib/team-score";

const sku = (id: string, over: Partial<RcSku> = {}): RcSku => ({ id, code: id.toUpperCase(), name: `ของ ${id}`, purchaseUom: "ก.", usageUom: "ก.", converter: 1, ...over });
const SKUS = new Map([["a", sku("a")], ["b", sku("b", { purchaseUom: "แพ็ค", usageUom: "ก.", converter: 500 })]]);

/** One count row; submitted late in the evening (after the day's sales came in) */
const cnt = (day: string, skuId: string, o: Partial<RcCount> = {}, branch = "b1"): RcCount => ({
  branch_id: branch,
  count_date: day,
  sku_id: skuId,
  physical_count: 10,
  variance: 0,
  waste: 0,
  expected_usage: 100,
  is_submitted: true,
  submitted_at: `${day}T22:00:00+07:00`,
  received_from_ck: 0,
  received_external: 0,
  ...o,
});
const sale = (day: string, o: Partial<RcSale> = {}, branch = "b1"): RcSale => ({ branch_id: branch, sale_date: day, created_at: `${day}T15:00:00+07:00`, net_amount: 1000, menu_code: "MN-1", qty: 10, ...o });

const P = { from: "2026-11-01", to: "2026-11-07" };
const week = ["2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"];

describe("periods", () => {
  it("week = the 7 completed days ending yesterday, stepping back by 7", () => {
    expect(reconcilePeriod("week", "2026-11-08")).toEqual({ kind: "week", from: "2026-11-01", to: "2026-11-07", ongoing: false });
    expect(reconcilePeriod("week", "2026-11-08", 1)).toMatchObject({ from: "2026-10-25", to: "2026-10-31" });
  });
  it("month = calendar month; the current one runs to yesterday and is ongoing", () => {
    expect(reconcilePeriod("month", "2026-11-08")).toEqual({ kind: "month", from: "2026-11-01", to: "2026-11-07", ongoing: true });
    expect(reconcilePeriod("month", "2026-11-08", 1)).toEqual({ kind: "month", from: "2026-10-01", to: "2026-10-31", ongoing: false });
    expect(reconcilePeriod("month", "2026-03-15", 1)).toMatchObject({ from: "2026-02-01", to: "2026-02-28" });
    // On the 1st nothing of the month has ended yet
    expect(reconcilePeriod("month", "2026-11-01")).toMatchObject({ from: "2026-11-01", to: "2026-11-01", ongoing: true });
  });
});

describe("window judging (the team score's rule, per item)", () => {
  it("daily counts: each row over its own one-day window; used = recipe − Σ difference", () => {
    const counts = week.map((d) => cnt(d, "a", { variance: d === "2026-10-31" ? -999 : -10 }));
    const sales = week.map((d) => sale(d));
    const c = cellsOf(counts, sales, P, SKUS).get("a")!;
    // 31 Oct is before the period: only the previous count, never judged
    expect(c.counts).toBe(7);
    expect(c.recipe).toBe(700);
    expect(c.diff).toBe(-70);
    expect(c.used).toBe(770);
    // Exactly 10% over is already off
    expect(c.verdict).toBe("short");
  });

  it("a weekly-counted item is judged over the whole window since its previous count", () => {
    const counts = week.map((d) => cnt(d, "a", { physical_count: d === "2026-10-31" || d === "2026-11-07" ? 5 : null, variance: d === "2026-11-07" ? -300 : 0 }));
    const sales = week.map((d) => sale(d));
    const c = cellsOf(counts, sales, P, SKUS).get("a")!;
    expect(c.counts).toBe(1);
    expect(c.recipe).toBe(700); // 1–7 Nov expected use
    expect(c.used).toBe(1000);
    expect(c.firstCount).toBe("2026-11-07");
  });

  it("the first count of an item (no previous count read) isn't judged", () => {
    const counts = [cnt("2026-11-03", "a", { variance: -50 })];
    expect(cellsOf(counts, [sale("2026-11-03")], P, SKUS).size).toBe(0);
  });

  it("a sales day with no count sheet in the window: the item isn't judged (Shiro, Nov 2026)", () => {
    const days = week.filter((d) => d !== "2026-11-04");
    const counts = days.map((d) => cnt(d, "a", { variance: -10 }));
    const sales = week.map((d) => sale(d));
    const c = cellsOf(counts, sales, P, SKUS).get("a")!;
    // 5 Nov's window (since 3 Nov) runs over 4 Nov, which had sales and no sheet
    expect(c.counts).toBe(5);
    expect(c.firstCount).toBe("2026-11-01");
    expect(c.lastCount).toBe("2026-11-07");
  });

  it("a day counted before its sales came in isn't judged", () => {
    const counts = week.map((d) => cnt(d, "a", { variance: -10, submitted_at: d === "2026-11-03" ? "2026-11-03T08:00:00+07:00" : `${d}T22:00:00+07:00` }));
    const sales = week.map((d) => sale(d, { created_at: d === "2026-11-03" ? "2026-11-03T20:00:00+07:00" : `${d}T15:00:00+07:00` }));
    expect(cellsOf(counts, sales, P, SKUS).get("a")!.counts).toBe(6);
  });

  it("agrees with the team score's over-recipe on the same rows (one formula)", () => {
    const counts = week.flatMap((d, i) => [cnt(d, "a", { variance: -(i * 7) % 23 }), cnt(d, "b", { variance: (i * 11) % 17, expected_usage: 40 + i })]);
    const sales = week.filter((d) => d !== "2026-11-05").map((d) => sale(d));
    const cells = cellsOf(counts, sales, P, SKUS);
    const team = overRecipeAndWaste({ counts, sales, tos: [], firstReceipt: new Map(), priceOn: () => 1 }, new Set(week.slice(1)));
    const recipe = [...cells.values()].reduce((t, c) => t + c.recipe, 0);
    const over = [...cells.values()].reduce((t, c) => t + (c.used - c.recipe), 0);
    expect(recipe).toBeCloseTo(team.recipe);
    expect(over).toBeCloseTo(team.over);
    expect([...cells.values()].reduce((t, c) => t + c.counts, 0)).toBe(team.judgedRows);
  });

  it("waste and receipts are their own numbers; outside receipts × converter only when the units differ", () => {
    const counts = [cnt("2026-11-01", "b"), cnt("2026-11-02", "b", { waste: 30, received_external: 2, received_from_ck: 100 }), cnt("2026-11-02", "a", { received_external: 2 }), cnt("2026-11-01", "a")];
    const sales = [sale("2026-11-01"), sale("2026-11-02")];
    const cells = cellsOf(counts, sales, P, SKUS);
    expect(cells.get("b")!.received).toBe(100 + 2 * 500);
    expect(cells.get("b")!.waste).toBe(30);
    // Waste is not part of "used"
    expect(cells.get("b")!.used).toBe(100);
    expect(cells.get("a")!.received).toBe(2);
    expect(skuConverter(sku("x", { purchaseUom: "ก.", usageUom: "ก.", converter: 1000 }))).toBe(1);
    expect(skuConverter(sku("x", { purchaseUom: "กก.", usageUom: "ก.", converter: 1000 }))).toBe(1000);
    expect(skuConverter(undefined)).toBe(1);
  });
});

describe("branch days", () => {
  it("usable days, and which days had sales but no sheet / were counted early / had no sales", () => {
    const sheetDays = ["2026-11-01", "2026-11-03", "2026-11-04", "2026-11-06", "2026-11-07"];
    const counts = sheetDays.map((d) => cnt(d, "a", { submitted_at: d === "2026-11-04" ? "2026-11-04T09:00:00+07:00" : `${d}T22:00:00+07:00` }));
    const sales = ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"].map((d) => sale(d, { created_at: d === "2026-11-04" ? "2026-11-04T20:00:00+07:00" : `${d}T15:00:00+07:00` }));
    const d = branchDaysOf("b1", counts, sales, P);
    expect(d).toMatchObject({ total: 7, usable: 3, noSheet: ["2026-11-02", "2026-11-05"], early: ["2026-11-04"], noSales: ["2026-11-07"] });
    expect(daysLine("Shiro", d)).toBe("Shiro ข้อมูล 3/7 วัน (ไม่มีใบนับ 2, 5 พ.ย. · นับก่อนลงยอดขาย 4 พ.ย. · ไม่มียอดขาย 7 พ.ย.)");
    expect(daysLine("Thaniya", { branchId: "x", total: 7, usable: 7, noSheet: [], early: [], noSales: [] })).toBe("Thaniya ข้อมูล 7/7 วัน");
  });
  it("day lists across months and long lists", () => {
    expect(daysText(["2026-10-30", "2026-11-02"])).toBe("30 ต.ค., 2 พ.ย.");
    expect(daysText(["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"])).toBe("1, 2, 3, 4 พ.ย. +2");
  });
});

const cell = (recipe: number, used: number, branchId = "b1"): Cell => ({ branchId, recipe, used, diff: recipe - used, waste: 0, received: 0, counts: 1, firstCount: "", lastCount: "", pct: recipe > 0 ? (used - recipe) / recipe : 0, verdict: verdictOf(recipe, used) });

describe("labels", () => {
  it("verdicts: bad numbers, near within ±10%, short/over", () => {
    expect(verdictOf(100, -5)).toBe("bad");
    expect(verdictOf(100, 301)).toBe("bad");
    expect(verdictOf(100, 300)).toBe("short");
    expect(verdictOf(100, 0)).toBe("bad");
    expect(verdictOf(100, 109)).toBe("near");
    expect(verdictOf(100, 91)).toBe("near");
    expect(verdictOf(100, 110)).toBe("short");
    expect(verdictOf(100, 75)).toBe("over");
  });
  it("น่าจะเป็น", () => {
    expect(labelOf([cell(100, 124, "b1"), cell(100, -3, "b2")])).toBe("bad");
    expect(labelOf([cell(100, 124, "b1"), cell(100, 130, "b2")])).toBe("bom");
    expect(labelOf([cell(100, 80, "b1"), cell(100, 70, "b2")])).toBe("bom");
    expect(labelOf([cell(100, 124, "b1"), cell(100, 75, "b2")])).toBe("shop");
    expect(labelOf([cell(100, 124, "b1"), cell(100, 102, "b2")])).toBe("shop");
    // One branch with data, off: can't tell it's the recipe
    expect(labelOf([cell(100, 124)])).toBe("shop");
    expect(labelOf([cell(100, 105, "b1"), cell(100, 96, "b2")])).toBe("near");
    expect(labelOf([cell(100, 124)], "kitchen")).toBe("kitchen");
    expect(onlyOff([{ label: "near" }, { label: "shop" }] as never)).toEqual([{ label: "shop" }]);
  });
  it("cell words", () => {
    expect(cellText(cell(4267, 5291), "ก.")).toEqual({ head: "ใช้เกิน 24%", sub: "+1,024 ก." });
    expect(cellText(cell(5772, 4329), "ก.")).toEqual({ head: "ใช้น้อย 25%", sub: "−1,443 ก." });
    expect(cellText(cell(100, 103), "ก.")).toEqual({ head: "ใกล้สูตร", sub: "" });
    expect(cellText(cell(100, -20), "ก.")!.head).toBe("นับผิด");
    expect(cellText(undefined, "ก.")).toBeNull();
  });
});

describe("table", () => {
  it("sorted by the baht gap (Σ |used − recipe| × price), biggest first", () => {
    const rows = [
      { sku: { name: "ก" }, gapBaht: 10 },
      { sku: { name: "ข" }, gapBaht: 300 },
      { sku: { name: "ค" }, gapBaht: 40 },
    ];
    expect(sortRows(rows).map((r) => r.sku.name)).toEqual(["ข", "ค", "ก"]);
  });

  it("builds rows per item with a column per branch, priced at the active price", () => {
    const counts = [...week.map((d) => cnt(d, "a", { variance: -30 })), ...week.map((d) => cnt(d, "a", { variance: 25 }, "b2")), ...week.map((d) => cnt(d, "b", { variance: -1, expected_usage: 10 }))];
    const sales = [...week.map((d) => sale(d)), ...week.map((d) => sale(d, {}, "b2"))];
    const v = buildReconcile({
      period: { kind: "week", ...P, ongoing: false },
      branches: [
        { id: "b1", name: "Thaniya", brandName: "X" },
        { id: "b2", name: "Shiro", brandName: "Y" },
      ],
      counts,
      sales,
      skus: [...SKUS.values()],
      price: (id) => (id === "a" ? 0.5 : 0.1),
      menus: [{ id: "m1", menuCode: "MN-1", menuName: "ราเมน", brandName: "X" }],
      bomLines: [{ menuId: "m1", skuId: "a", effectiveQty: 60, branchId: null }],
    });
    expect(v.rows.map((r) => r.sku.id)).toEqual(["a", "b"]);
    const a = v.rows[0];
    expect(a.cells.get("b1")!.verdict).toBe("short");
    expect(a.cells.get("b2")!.verdict).toBe("over");
    expect(a.label).toBe("shop");
    expect(a.gapBaht).toBeCloseTo((210 + 175) * 0.5);
    // Thaniya sells the menu: its per-serving recipe and about what really went in
    expect(a.serving).toEqual([{ branchId: "b1", menuName: "ราเมน", perServing: 60, actualPerServing: 60 * (910 / 700), sold: 70 }]);
    expect(v.days.map((d) => d.usable)).toEqual([7, 7]);
    const tsv = toTsv(v.rows, v.branches);
    expect(tsv.split("\n")[0]).toBe(["วัตถุดิบ", "รหัส", "หน่วย", "น่าจะเป็น", "ห่างจากสูตร (บาท)", "Thaniya ตามสูตร", "Thaniya ใช้จริง", "Thaniya ใช้เกินสูตร %", "Thaniya ของเสีย", "Shiro ตามสูตร", "Shiro ใช้จริง", "Shiro ใช้เกินสูตร %", "Shiro ของเสีย"].join("\t"));
    expect(tsv.split("\n")[1].split("\t").slice(0, 9)).toEqual(["ของ a", "A", "ก.", "หน้าร้าน", "193", "700", "910", "30", "0"]);
    // b only counted at Thaniya: Shiro's columns are empty
    expect(tsv.split("\n")[2].split("\t").slice(9)).toEqual(["", "", "", ""]);
  });

  it("per serving: the branch's own recipe line wins over the shared one; other brands' menus don't count", () => {
    const br = { id: "b1", name: "T", brandName: "X" };
    const menus = [
      { id: "m1", menuCode: "MN-1", menuName: "ราเมน", brandName: "X" },
      { id: "m2", menuCode: "MN-2", menuName: "ข้าว", brandName: "X" },
      { id: "m3", menuCode: "MN-3", menuName: "อื่น", brandName: "Y" },
    ];
    const lines = [
      { menuId: "m1", skuId: "a", effectiveQty: 60, branchId: null },
      { menuId: "m1", skuId: "a", effectiveQty: 70, branchId: "b1" },
      { menuId: "m2", skuId: "a", effectiveQty: 30, branchId: null },
      { menuId: "m3", skuId: "a", effectiveQty: 99, branchId: null },
    ];
    const sales = [sale("2026-11-02", { menu_code: "MN-1", qty: 5 }), sale("2026-11-02", { menu_code: "MN-2", qty: 3 }), sale("2026-11-02", { menu_code: "MN-3", qty: 50 })];
    expect(servingFor("a", br, sales, menus, lines, cell(100, 120), P)).toMatchObject({ menuName: "ราเมน", perServing: 70, actualPerServing: 84, sold: 5 });
    // A bad number gives no "really put in"
    expect(servingFor("a", br, sales, menus, lines, cell(100, -1), P)!.actualPerServing).toBeNull();
    expect(servingFor("a", br, [], menus, lines, undefined, P)).toBeNull();
  });
});

describe("kitchen", () => {
  it("per raw material from the kitchen cost: recipe summed over what was made; uncounted and kitchen-made left out", () => {
    const rows = kitchenRows({
      lines: [
        { skuId: "a", isRm: true, expected: 1000, actual: 600 },
        { skuId: "a", isRm: true, expected: 500, actual: 300 },
        { skuId: "b", isRm: true, expected: 200, actual: 200 },
        { skuId: "s", isRm: false, expected: 50, actual: null },
      ],
      rmUsed: new Map([["a", 1800], ["b", 400]]),
      uncounted: new Set(["b"]),
      skus: [...SKUS.values(), sku("s")],
      price: () => 1,
      opening: "2026-09-30",
      closing: "2026-10-31",
    });
    expect(rows).toHaveLength(1);
    const c = rows[0].cells.get("ck")!;
    expect(c).toMatchObject({ recipe: 1500, used: 1800, verdict: "short" });
    expect(rows[0].label).toBe("kitchen");
    expect(rows[0].gapBaht).toBe(300);
  });
});

describe("ลิงก์เข้ากระทบยอด", () => {
  it("reads month, kitchen and item in any order; bad parts ignored", () => {
    expect(parseRcHash("#m/2026-10/s/kitchen/sku/RM-0009")).toEqual({ month: "2026-10", kitchen: true, sku: "RM-0009" });
    expect(parseRcHash("sku/RM-1/m/2026-9")).toEqual({ month: null, kitchen: false, sku: "RM-1" });
    expect(parseRcHash("")).toEqual({ month: null, kitchen: false, sku: null });
  });
  it("writes what it reads", () => {
    const l = { month: "2026-10", kitchen: true, sku: "SM-0008" };
    expect(parseRcHash(rcHash(l))).toEqual(l);
    expect(rcHash({ month: "2026-10" })).toBe("m/2026-10");
  });
  it("months back", () => {
    expect(monthsBack("2026-11-08", "2026-10")).toBe(1);
    expect(monthsBack("2027-01-02", "2026-11")).toBe(2);
    expect(monthsBack("2026-11-08", "2026-12")).toBe(0);
  });
});
