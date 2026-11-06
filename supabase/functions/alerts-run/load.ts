// alerts-run: reads only what the evaluated rules need (each rule lists its needs).
// Service-role client: row security doesn't apply, so every read is filtered by date here.

import { shiftDay } from "../_shared/day-math.ts";
import { monthStartOf, weekStartOf } from "../_shared/team-score.ts";
import type { AlertData, DataNeed } from "../_shared/alerts/types.ts";
import type { TransferLine } from "../_shared/team-score.ts";
import { bkkDay } from "../_shared/alerts/time.ts";
import { COUNT_WINDOW_DAYS } from "../_shared/month-count.ts";

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

/** Every row of a query, 1,000 at a time (PostgREST's default cap), stable order by id */
export async function all<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(`read failed: ${JSON.stringify(error)}`);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

/**
 * The first day read: the start of last month or 4 weeks back, whichever is earlier — the
 * same span the management home page reads (lib/admin-home.ts readFromFor), so the team
 * score's over-recipe windows and the month-close checks see the same rows.
 */
export function readFromFor(today: string): string {
  const fourWeeks = shiftDay(today, -28);
  const lastMonth = monthStartOf(shiftDay(monthStartOf(today), -1));
  return fourWeeks < lastMonth ? fourWeeks : lastMonth;
}

/**
 * `priceSince`: prices are read as the last change before it plus every change since (and
 * today's standard price) — alerts_prices() in the database, not the whole history.
 */
export async function loadData(db: Db, needs: Set<DataNeed>, nowMs: number, baselines: AlertData["baselines"], priceLookbackDays: number): Promise<AlertData> {
  const today = bkkDay(nowMs);
  const from = readFromFor(today);
  const has = (n: DataNeed) => needs.has(n);

  const [branches, skus] = await Promise.all([
    all<{ id: string; branch_name: string; brand_name: string }>((a, b) => db.from("branches").select("id, branch_name, brand_name").eq("status", "Active").order("id").range(a, b)),
    all<{ id: string; sku_id: string; name: string; type: string; pack_size: number; usage_uom: string }>((a, b) => db.from("skus").select("id, sku_id, name, type, pack_size, usage_uom").order("id").range(a, b)),
  ]);

  const data: AlertData = {
    nowMs,
    today,
    branches: branches.map((b) => ({ id: b.id, name: b.branch_name, brand: b.brand_name })),
    skus: skus.map((s) => ({ id: s.id, code: s.sku_id, name: s.name, type: s.type, packSize: Number(s.pack_size) || 0, uom: s.usage_uom })),
    tos: [],
    toLines: [],
    receipts: [],
    counts: [],
    salesDaily: [],
    priceChanges: [],
    stdPrice: new Map(),
    plans: [],
    production: [],
    kitchenMonth: { sessions: [], lines: [], producedSm: [], recipeRm: new Map() },
    foodCostMonthly: [],
    newItems: [],
    baselines,
  };

  const jobs: Promise<void>[] = [];
  if (has("tos") || has("toLines") || has("receipts"))
    jobs.push(
      (async () => {
        data.tos = await all<AlertData["tos"][number]>((a, b) =>
          db.from("transfer_orders").select("id, branch_id, to_number, status, sent_at, delivery_date, total_value, decline_reason, updated_at").or(`delivery_date.gte.${from},status.eq.Sent,updated_at.gte.${shiftDay(today, -3)}`).order("id").range(a, b),
        );
        if (has("toLines")) {
          const ids = data.tos.filter((t) => t.sent_at && t.status !== "Draft" && Date.parse(t.sent_at) >= nowMs - 8 * 86_400_000).map((t) => t.id);
          for (let i = 0; i < ids.length; i += 100) {
            const part = ids.slice(i, i + 100);
            data.toLines.push(...(await all<TransferLine>((a, b) => db.from("transfer_order_lines").select("id, to_id, sku_id, tr_line_id, planned_qty, actual_qty, packs_count, unit_cost, uom").in("to_id", part).order("id").range(a, b))));
          }
        }
      })(),
    );
  if (has("receipts"))
    jobs.push(
      (async () => {
        data.receipts = await all<AlertData["receipts"][number]>((a, b) => db.from("branch_receipts").select("id, transfer_order_id, created_at").not("transfer_order_id", "is", null).gte("receipt_date", shiftDay(from, -7)).order("id").range(a, b));
      })(),
    );
  if (has("counts"))
    jobs.push(
      (async () => {
        const rows = await all<Record<string, unknown>>((a, b) =>
          db.from("daily_stock_counts").select("id, branch_id, count_date, sku_id, physical_count, variance, waste, expected_usage, is_submitted, submitted_at").gte("count_date", from).lte("count_date", today).order("id").range(a, b),
        );
        data.counts = rows.map((c) => ({
          branch_id: String(c.branch_id),
          count_date: String(c.count_date),
          sku_id: String(c.sku_id),
          physical_count: c.physical_count === null ? null : Number(c.physical_count),
          variance: Number(c.variance) || 0,
          waste: Number(c.waste) || 0,
          expected_usage: Number(c.expected_usage) || 0,
          is_submitted: !!c.is_submitted,
          submitted_at: (c.submitted_at as string) ?? null,
        }));
      })(),
    );
  if (has("salesDaily"))
    jobs.push(
      (async () => {
        // Summed in the database (alerts_sales_daily): one row per branch and day instead of every sales line
        const { data: rows, error } = await db.rpc("alerts_sales_daily", { p_from: from, p_to: today });
        if (error) throw new Error(`alerts_sales_daily: ${JSON.stringify(error)}`);
        data.salesDaily = (rows ?? []).map((r: Record<string, unknown>) => ({ branch_id: String(r.branch_id), sale_date: String(r.sale_date), first_created_at: String(r.first_created_at), net_amount: Number(r.net_amount) || 0 }));
      })(),
    );
  if (has("prices"))
    jobs.push(
      (async () => {
        // The earlier of the read start (prices on past count days) and the rules' look-back
        const since = Math.min(Date.parse(`${from}T00:00:00+07:00`), nowMs - priceLookbackDays * 86_400_000);
        const { data: rows, error } = await db.rpc("alerts_prices", { p_since: new Date(since).toISOString() });
        if (error) throw new Error(`alerts_prices: ${JSON.stringify(error)}`);
        for (const r of (rows ?? []) as { kind: string; sku_id: string; price: number; valid_from: string }[]) {
          if (r.kind === "standard") data.stdPrice.set(r.sku_id, Number(r.price) || 0);
          else data.priceChanges.push({ sku_id: r.sku_id, price_per_usage_uom: Number(r.price), valid_from: r.valid_from });
        }
      })(),
    );
  if (has("plans"))
    jobs.push(
      (async () => {
        data.plans = await all<AlertData["plans"][number]>((a, b) => db.from("weekly_plan_lines").select("id, week_start, sku_id, planned_qty_uom").gte("week_start", weekStartOf(shiftDay(today, -7))).order("id").range(a, b));
      })(),
    );
  if (has("production"))
    jobs.push(
      (async () => {
        data.production = await all<AlertData["production"][number]>((a, b) => db.from("production_records").select("id, sm_sku_id, production_date, actual_output_g").gte("production_date", weekStartOf(shiftDay(today, -7))).order("id").range(a, b));
      })(),
    );
  if (has("kitchenMonth"))
    jobs.push(
      (async () => {
        // Last month's kitchen count, judged by the shared ≥50%-of-RM rule (_shared/month-count.ts)
        const end = shiftDay(monthStartOf(today), -1);
        const start = monthStartOf(end);
        const [sessions, produced, headers, bomLines] = await Promise.all([
          all<{ id: string; count_date: string; status: string }>((a, b) => db.from("stock_count_sessions").select("id, count_date, status").eq("status", "Completed").is("deleted_at", null).gte("count_date", shiftDay(end, -COUNT_WINDOW_DAYS)).lte("count_date", shiftDay(end, COUNT_WINDOW_DAYS)).order("id").range(a, b)),
          all<{ sm_sku_id: string }>((a, b) => db.from("production_records").select("id, sm_sku_id").gte("production_date", start).lte("production_date", end).order("id").range(a, b)),
          all<{ id: string; sm_sku_id: string }>((a, b) => db.from("bom_headers").select("id, sm_sku_id").order("id").range(a, b)),
          all<{ bom_header_id: string; rm_sku_id: string }>((a, b) => db.from("bom_lines").select("id, bom_header_id, rm_sku_id").order("id").range(a, b)),
        ]);
        const lines: AlertData["kitchenMonth"]["lines"] = [];
        for (const s of sessions)
          lines.push(...(await all<{ session_id: string; sku_id: string; physical_qty: number | null }>((a, b) => db.from("stock_count_lines").select("id, session_id, sku_id, physical_qty").eq("session_id", s.id).eq("type", "RM").order("id").range(a, b))));
        const isRm = new Set(data.skus.filter((x) => x.type === "RM").map((x) => x.id));
        const smOf = new Map(headers.map((h) => [h.id, h.sm_sku_id]));
        const recipeRm = new Map<string, string[]>();
        for (const l of bomLines) {
          const sm = smOf.get(l.bom_header_id);
          if (!sm || !isRm.has(l.rm_sku_id)) continue;
          recipeRm.set(sm, [...(recipeRm.get(sm) ?? []), l.rm_sku_id]);
        }
        data.kitchenMonth = { sessions, lines, producedSm: [...new Set(produced.map((p) => p.sm_sku_id))], recipeRm };
      })(),
    );
  if (has("foodCostMonthly"))
    jobs.push(
      (async () => {
        data.foodCostMonthly = await all<AlertData["foodCostMonthly"][number]>((a, b) =>
          db.from("food_cost_menu_monthly").select("id, branch_id, month, revenue, std_cost, has_recipe_cost, is_closed_month, computed_at").gte("month", monthStartOf(shiftDay(monthStartOf(today), -1))).order("id").range(a, b),
        );
      })(),
    );
  if (has("newItems"))
    jobs.push(
      (async () => {
        const since = new Date(nowMs - 31 * 86_400_000).toISOString();
        const [menus, newSkus] = await Promise.all([
          all<{ menu_name: string; created_at: string }>((a, b) => db.from("menus").select("id, menu_name, created_at").gte("created_at", since).order("id").range(a, b)),
          all<{ name: string; created_at: string }>((a, b) => db.from("skus").select("id, name, created_at").eq("type", "RM").gte("created_at", since).order("id").range(a, b)),
        ]);
        data.newItems = [...menus.map((m) => ({ kind: "menu" as const, name: m.menu_name, created_at: m.created_at })), ...newSkus.map((s) => ({ kind: "sku" as const, name: s.name, created_at: s.created_at }))];
      })(),
    );
  await Promise.all(jobs);
  return data;
}
