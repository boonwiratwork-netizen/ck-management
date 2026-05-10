import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-agent-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ALLOWED_TABLES = new Set([
  "skus",
  "sales_entries",
  "menu_bom",
  "bom_headers",
  "bom_lines",
  "goods_receipts",
  "stock_adjustments",
  "production_records",
  "production_plans",
  "transfer_orders",
  "transfer_order_lines",
  "transfer_order_lot_lines",
  "transfer_requests",
  "transfer_request_lines",
  "branch_receipts",
  "daily_stock_counts",
  "branches",
  "menus",
  "menu_modifier_rules",
  "menu_categories",
  "prices",
  "suppliers",
  "suppliers_safe",
  "stock_count_sessions",
  "stock_count_lines",
  "stock_opening_balances",
  "sku_categories",
  "bom_byproducts",
  "bom_steps",
  "branch_forecasts",
  "branch_menu_overrides",
  "deliveries",
  "purchase_requests",
  "purchase_request_lines",
  "global_settings",
]);

interface ReadRequest {
  table: string;
  filters?: Record<string, unknown>;
  select?: string;
  order?: { column: string; ascending?: boolean };
  limit?: number;
  offset?: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    // Optional shared-secret gate for the agent (set AGENT_READ_KEY in secrets to enable)
    const requiredKey = Deno.env.get("AGENT_READ_KEY");
    if (requiredKey) {
      const provided =
        req.headers.get("x-agent-key") ??
        req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
      if (provided !== requiredKey) {
        return json({ error: "Unauthorized" }, 401);
      }
    }

    const body = (await req.json()) as ReadRequest;
    const { table, filters = {}, select = "*", order, limit, offset } = body;

    if (!table || typeof table !== "string") {
      return json({ error: "Missing 'table'" }, 400);
    }
    if (!ALLOWED_TABLES.has(table)) {
      return json(
        { error: `Table '${table}' is not allowed`, allowed: [...ALLOWED_TABLES] },
        403
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    let query = supabase.from(table).select(select, { count: "exact" });

    // Apply filters. Supports:
    //   { col: value }                         -> eq
    //   { col: { op: "gte", value: ... } }     -> any PostgREST operator
    //   { col: { in: [...] } }                 -> in
    for (const [col, raw] of Object.entries(filters)) {
      if (raw === null) {
        query = query.is(col, null);
        continue;
      }
      if (typeof raw === "object" && !Array.isArray(raw)) {
        const f = raw as Record<string, unknown>;
        if ("in" in f && Array.isArray(f.in)) {
          query = query.in(col, f.in as never[]);
          continue;
        }
        if ("op" in f && "value" in f) {
          const op = String(f.op);
          const value = f.value as never;
          // @ts-ignore dynamic operator dispatch
          if (typeof query[op] === "function") {
            // @ts-ignore
            query = query[op](col, value);
            continue;
          }
        }
        return json({ error: `Unsupported filter for '${col}'` }, 400);
      }
      query = query.eq(col, raw as never);
    }

    if (order?.column) {
      query = query.order(order.column, { ascending: order.ascending ?? true });
    }
    if (typeof limit === "number") {
      const start = offset ?? 0;
      query = query.range(start, start + limit - 1);
    } else if (typeof offset === "number") {
      query = query.range(offset, offset + 999);
    }

    const { data, error, count } = await query;
    if (error) return json({ error: error.message }, 400);

    return json({ table, count, rows: data ?? [] }, 200);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
