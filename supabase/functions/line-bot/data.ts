// The bot's reads, with the service-role client: the same tables and rules the Food Cost
// page uses (hooks/use-food-cost.ts, lib/usage-context-db.ts), loaded once per question.

import { buildUsageContext, deliveryEffective } from "../_shared/sale-usage.ts";
import { usageContextOn, bangkokDay, type RecipeCopy, type UsageInput } from "../_shared/recipe-history.ts";
import { buildPriceAt } from "../_shared/price-at.ts";
import type { FcSale, UsageCorrection } from "../_shared/food-cost.ts";
import type { Masters } from "./tools.ts";
import type { FullStore, BranchStockInput } from "./tools-stock.ts";
import { anchorWindow, pickAnchors, usageReadFrom, type AdjustmentMove, type ReceiptMove, type SheetCountRow, type WasteRow } from "../_shared/branch-stock.ts";
import { dailyUseWindow, sellingDays, type BranchSaleRow, type BranchWasteRow } from "../_shared/daily-use.ts";
import { kitchenStockFor } from "../_shared/kitchen-stock.ts";
import { addSaleUsage } from "../_shared/sale-usage.ts";
import { shiftDay } from "../_shared/day-math.ts";

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

/** Every row, 1,000 at a time, stable order by id; a failed page fails the read */
async function all<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(`read failed: ${JSON.stringify(error)}`);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}
/** A table that may not exist yet (history tables): none rather than a failure */
async function maybe<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  try {
    return await all(build);
  } catch {
    return [];
  }
}

const n = (v: unknown) => Number(v) || 0;

/** The count day: before 05:00 Bangkok it's still yesterday's sheet (lib/stock-count.ts businessDate) */
function countDay(today: string): string {
  const h = new Date(Date.now() + 7 * 3_600_000).getUTCHours();
  return h < 5 ? shiftDay(today, -1) : today;
}

export function supabaseStore(db: Db, today: string): FullStore {
  let masters: Promise<Masters> | null = null;
  // One read per period per question (a scenario after food_cost reuses the same sales)
  const sales = new Map<string, Promise<FcSale[]>>();
  return {
    masters: () => (masters ??= loadMasters(db, today)),
    sales: (branchIds, from, to) => {
      const key = `${[...branchIds].sort().join(",")}|${from}|${to}`;
      let p = sales.get(key);
      if (!p) {
        p = all<FcSale>((a, b) =>
          db.from("sales_entries").select("id, sale_date, branch_id, menu_code, menu_name, qty, net_amount, receipt_no, order_type, channel").in("branch_id", branchIds).gte("sale_date", from).lte("sale_date", to).order("id").range(a, b),
        );
        sales.set(key, p);
      }
      return p;
    },
    corrections: async (branchIds, from, to) => {
      const rows = await maybe<{ branch_id: string; sku_id: string; date_from: string; date_to: string; qty: number; reason: string | null; id: string }>((a, b) =>
        db.from("usage_corrections").select("id, branch_id, sku_id, date_from, date_to, qty, reason").in("branch_id", branchIds).lte("date_from", to).gte("date_to", from).order("id").range(a, b),
      );
      return rows.map((c): UsageCorrection => ({ id: c.id, branchId: c.branch_id, skuId: c.sku_id, dateFrom: c.date_from, dateTo: c.date_to, qty: n(c.qty), reason: c.reason ?? "" }));
    },
    stock: {
      // One branch's stock inputs: the store stock page's read (hooks/use-branch-stock.ts loadBranchStock)
      branchStock: async (branchId, products): Promise<BranchStockInput> => {
        const m = await (masters ??= loadMasters(db, today));
        const window = anchorWindow(today);
        const [rows, receipts, adjustments] = await Promise.all([
          all<SheetCountRow>((a, b) => db.from("daily_stock_counts").select("id, sku_id, count_date, physical_count, calculated_balance").eq("branch_id", branchId).gte("count_date", window.from).lte("count_date", today).order("id").range(a, b)),
          all<ReceiptMove>((a, b) => db.from("branch_receipts").select("id, sku_id, receipt_date, qty_received, transfer_order_id").eq("branch_id", branchId).gte("receipt_date", window.from).lte("receipt_date", today).order("id").range(a, b)),
          all<AdjustmentMove>((a, b) => db.from("stock_adjustments").select("id, sku_id, adjustment_date, quantity, reason").eq("branch_id", branchId).gte("adjustment_date", window.from).lte("adjustment_date", shiftDay(today, 1)).order("id").range(a, b)),
        ]);
        const cd = countDay(today);
        const anchors = pickAnchors(rows, cd < today ? cd : today).filter((a) => !products || products.has(a.sku_id));
        const week = dailyUseWindow(today);
        const from = usageReadFrom(anchors, products, week.from);
        const [waste, sales] = await Promise.all([
          all<WasteRow>((a, b) => db.from("daily_stock_counts").select("id, sku_id, count_date, waste").eq("branch_id", branchId).gt("waste", 0).gte("count_date", from).lte("count_date", today).order("id").range(a, b)),
          all<{ sale_date: string; menu_code: string; menu_name: string | null; qty: number; order_type: string | null; channel: string | null }>((a, b) =>
            db.from("sales_entries").select("id, sale_date, menu_code, menu_name, qty, order_type, channel").eq("branch_id", branchId).gte("sale_date", from).lte("sale_date", today).order("id").range(a, b),
          ),
        ]);
        // Sales → usage per item per day (lib/usage-context-db.ts usageOf)
        const usageByDay: Record<string, Record<string, number>> = {};
        for (const x of sales)
          addSaleUsage(m.ctx, { menu_code: x.menu_code, menu_name: x.menu_name, qty: x.qty, branch_id: branchId, order_type: x.order_type, channel: x.channel }, (id, q) => {
            if (products && !products.has(id)) return;
            const d = (usageByDay[id] ??= {});
            d[x.sale_date] = (d[x.sale_date] || 0) + q;
          });
        const own = <T extends { sku_id: string }>(r: T[]) => (products ? r.filter((x) => products.has(x.sku_id)) : r);
        return { counts: anchors, receipts: own(receipts), adjustments: own(adjustments), waste: own(waste), usageByDay, sellingDays: sellingDays(sales, week), unanchoredFrom: window.from };
      },
      kitchenStock: async (ids) => {
        const m = await (masters ??= loadMasters(db, today));
        const skus = m.skus.map((s) => ({ id: s.id, type: s.type, converter: s.converter }));
        // Strict (a failed read fails the answer) and in parts: hundreds of ids would make the
        // request address too long, and a refused read must never read as "หมด"
        const parts: string[][] = [];
        for (let i = 0; i < ids.length; i += 60) parts.push(ids.slice(i, i + 60));
        const maps = await Promise.all(parts.map((p) => kitchenStockFor(db, skus, p, { strict: true })));
        return Object.assign({}, ...maps);
      },
      // The kitchen's own rows of the window, filtered here (no long id list in the request)
      kitchenAdjustments: async (ids, from, to) => {
        if (!ids.length) return [];
        const want = new Set(ids);
        const rows = await all<{ sku_id: string; adjustment_date: string; quantity: number; reason: string | null }>((a, b) =>
          db.from("stock_adjustments").select("id, sku_id, adjustment_date, quantity, reason").is("branch_id", null).gt("adjustment_date", from).lte("adjustment_date", to).order("id").range(a, b),
        );
        return rows.filter((r) => want.has(r.sku_id));
      },
      // The kitchen's SM demand: every branch's week (hooks/use-sm-daily-usage.ts loadSmUse)
      branchWeek: async (from, to) => {
        const [sales, waste, draws] = await Promise.all([
          all<BranchSaleRow>((a, b) => db.from("sales_entries").select("id, branch_id, sale_date, menu_code, menu_name, qty, order_type, channel").gte("sale_date", from).lte("sale_date", to).order("id").range(a, b)),
          all<BranchWasteRow>((a, b) => db.from("daily_stock_counts").select("id, branch_id, sku_id, count_date, waste").gt("waste", 0).gte("count_date", from).lte("count_date", to).order("id").range(a, b)),
          all<{ branch_id: string; sku_id: string; adjustment_date: string; quantity: number }>((a, b) =>
            db.from("stock_adjustments").select("id, branch_id, sku_id, adjustment_date, quantity").not("branch_id", "is", null).like("reason", "WIP: ใช้ทำ%").gte("adjustment_date", from).lte("adjustment_date", to).order("id").range(a, b),
          ),
        ]);
        return { sales, waste: [...waste, ...draws.map((d) => ({ branch_id: d.branch_id, sku_id: d.sku_id, count_date: d.adjustment_date, waste: -n(d.quantity) }))] };
      },
      kitchenLastCount: async () => {
        const { data } = await db.from("stock_count_sessions").select("count_date").eq("status", "Completed").is("deleted_at", null).order("count_date", { ascending: false }).limit(1);
        return data?.[0]?.count_date ?? null;
      },
      transfers: async (branchIds, from, to) => {
        const orders = await all<{ id: string; branch_id: string; delivery_date: string; status: string }>((a, b) =>
          db.from("transfer_orders").select("id, branch_id, delivery_date, status").in("branch_id", branchIds).gte("delivery_date", from).lte("delivery_date", to).order("id").range(a, b),
        );
        const ids = orders.map((o) => o.id);
        const lines = [];
        for (let i = 0; i < ids.length; i += 100) {
          const part = ids.slice(i, i + 100);
          lines.push(...(await all<{ to_id: string; sku_id: string; planned_qty: number; actual_qty: number; unit_cost: number; line_value: number }>((a, b) =>
            db.from("transfer_order_lines").select("id, to_id, sku_id, planned_qty, actual_qty, unit_cost, line_value").in("to_id", part).order("id").range(a, b),
          )));
        }
        return { orders, lines };
      },
    },
  };
}

async function loadMasters(db: Db, today: string): Promise<Masters> {
  const q = (table: string, cols: string, f?: (x: Db) => Db) => (a: number, b: number) => {
    let x = db.from(table).select(cols);
    if (f) x = f(x);
    return x.order("id").range(a, b);
  };
  const [menus, skus, branches, bom, rules, ruleMenus, sp, prices, history, copies] = await Promise.all([
    all<{ id: string; menu_code: string; menu_name: string; brand_name: string; category: string; selling_price: number; status: string }>(q("menus", "id, menu_code, menu_name, brand_name, category, selling_price, status")),
    all<{ id: string; sku_id: string; name: string; type: string; usage_uom: string; purchase_uom: string; status: string; converter: number }>(q("skus", "id, sku_id, name, type, usage_uom, purchase_uom, status, converter")),
    // Every branch: "all branches" counts closed ones too, as the Food Cost page does (pages/FoodCost.tsx)
    all<{ id: string; branch_name: string; brand_name: string; status: string }>(q("branches", "id, branch_name, brand_name, status")),
    // "*": delivery_qty / delivery_only / yield_pct as the app reads them (lib/usage-context-db.ts)
    all<{ menu_id: string; sku_id: string; effective_qty: number; qty_per_serving: number; branch_id: string | null; yield_pct?: number | null; delivery_qty?: number | null; delivery_only?: boolean | null }>(q("menu_bom", "*")),
    all<{ id: string; rule_type: string; keyword: string; sku_id: string | null; swap_sku_id: string | null; submenu_id: string | null; qty_per_match: number; is_active: boolean; branch_ids: string[] | null }>(
      q("menu_modifier_rules", "id, rule_type, keyword, sku_id, swap_sku_id, submenu_id, qty_per_match, is_active, branch_ids", (x) => x.eq("is_active", true)),
    ),
    all<{ rule_id: string; menu_id: string }>(q("modifier_rule_menus", "id, rule_id, menu_id")),
    all<{ sp_sku_id: string; ingredient_sku_id: string; qty_per_batch: number; batch_yield_qty: number }>(q("sp_bom", "id, sp_sku_id, ingredient_sku_id, qty_per_batch, batch_yield_qty")),
    // Newest first: the first active row of an item is its standard price (hooks/use-price-data.ts)
    all<{ sku_id: string; price_per_usage_uom: number; is_active: boolean; created_at: string }>((a, b) =>
      db.from("prices").select("id, sku_id, price_per_usage_uom, is_active, created_at").eq("is_active", true).order("created_at", { ascending: false }).order("id").range(a, b),
    ),
    maybe<{ sku_id: string; price_per_usage_uom: number; valid_from: string }>((a, b) => db.from("price_history").select("id, sku_id, price_per_usage_uom, valid_from").order("valid_from").order("id").range(a, b)),
    maybe<{ id: string; kind: RecipeCopy["kind"]; owner_id: string | null; snapshot: unknown; valid_from: string; created_at: string }>((a, b) =>
      db.from("recipe_history").select("id, kind, owner_id, snapshot, valid_from, created_at").neq("kind", "sm").order("valid_from").order("id").range(a, b),
    ),
  ]);

  const menusByRule = new Map<string, string[]>();
  for (const rm of ruleMenus) menusByRule.set(rm.rule_id, [...(menusByRule.get(rm.rule_id) ?? []), rm.menu_id]);
  const input: UsageInput = {
    menus: menus.map((m) => ({ id: m.id, menuCode: m.menu_code })),
    bomLines: bom.map((l) => ({ menuId: l.menu_id, skuId: l.sku_id, effectiveQty: n(l.effective_qty), deliveryEffectiveQty: deliveryEffective(l.delivery_qty, l.yield_pct ?? 100), deliveryOnly: l.delivery_only === true, branchId: l.branch_id })),
    rules: rules.map((r) => ({ id: r.id, ruleType: r.rule_type, keyword: r.keyword, skuId: r.sku_id || null, swapSkuId: r.swap_sku_id, submenuId: r.submenu_id, qtyPerMatch: n(r.qty_per_match), isActive: r.is_active, branchIds: r.branch_ids ?? [], menuIds: menusByRule.get(r.id) ?? [] })),
    spLines: sp.map((l) => ({ spSkuId: l.sp_sku_id, ingredientSkuId: l.ingredient_sku_id, qtyPerBatch: n(l.qty_per_batch), batchYieldQty: n(l.batch_yield_qty) || 1 })),
    skus: skus.map((s) => ({ id: s.id, type: s.type })),
  };
  const stdPrice = new Map<string, number>();
  for (const p of prices) if (!stdPrice.has(p.sku_id)) stdPrice.set(p.sku_id, n(p.price_per_usage_uom));
  const changes = history.map((h) => ({ skuId: h.sku_id, pricePerUsageUom: n(h.price_per_usage_uom), validFrom: h.valid_from }));
  const recipeCopies: RecipeCopy[] = copies.map((c) => ({ id: c.id, kind: c.kind, ownerId: c.owner_id, snapshot: c.snapshot, validFrom: c.valid_from, createdAt: c.created_at }));
  return {
    menus: menus.map((m) => ({ id: m.id, code: m.menu_code, name: m.menu_name, brand: m.brand_name, category: m.category ?? "", price: n(m.selling_price), active: m.status === "Active" })),
    skus: skus.map((s) => ({ id: s.id, code: s.sku_id, name: s.name, type: s.type, uom: s.usage_uom, purchaseUom: s.purchase_uom, converter: Number(s.converter) || 1, active: s.status === "Active" })),
    branches: branches.map((b) => ({ id: b.id, name: b.branch_name, brand: b.brand_name, active: b.status === "Active" })),
    bom: bom.map((l) => ({ menuId: l.menu_id, skuId: l.sku_id, qtyPerServing: n(l.qty_per_serving), effectiveQty: n(l.effective_qty), branchId: l.branch_id, deliveryOnly: l.delivery_only === true })),
    stdPrice,
    priceAt: buildPriceAt(changes, bangkokDay),
    priceChanges: changes.map((c) => ({ skuId: c.skuId, day: bangkokDay(c.validFrom), price: c.pricePerUsageUom })),
    ctx: buildUsageContext(input),
    ctxAt: recipeCopies.length ? usageContextOn(input, recipeCopies, bangkokDay) : undefined,
    today,
  };
}
