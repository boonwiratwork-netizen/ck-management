import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/**
 * A REAL supabase-js client over a FAKE network. Unit tests that mock the client with
 * hand-written objects can't see a call that never reaches the network (31 Oct: a detached
 * `supabase.rpc` threw "reading 'rest'" before sending and every receive button spun forever).
 * Here every request goes through the real client — auth header, PostgREST URL building,
 * error mapping — into `fakeFetch`, which writes it down and answers from small in-memory
 * tables and rpc handlers the test sets up.
 *
 * Use from a test file:
 *   vi.mock("@/integrations/supabase/client", async () => ({ supabase: (await import("@/test/integration/fake-network")).net.client }));
 */

export type Row = Record<string, unknown>;

export interface Recorded {
  method: string;
  /** "rest/v1/<table>" or "rest/v1/rpc/<fn>" */
  path: string;
  /** table name, or the rpc function name */
  target: string;
  rpc: boolean;
  query: Record<string, string[]>;
  body: unknown;
  prefer: string | null;
  apikey: string | null;
  /** .single() / .maybeSingle() ask for one object (application/vnd.pgrst.object+json) */
  accept: string | null;
}

/** What a matching request gets instead of the normal answer */
export type Fault =
  | { kind: "refuse"; status?: number; code?: string; message?: string }
  | { kind: "fail"; message?: string }
  /** Never answers; `landed`: the write is applied first (the reply is what got lost) */
  | { kind: "stall"; landed?: boolean }
  /** Row security filtered it out: 200, nothing touched, no rows back */
  | { kind: "filtered" };

type RpcHandler = (args: Row, req: Recorded) => unknown;

const BASE = "http://fake-supabase.test";

/** In-memory auth storage (no localStorage, no Lovable broker) */
function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

let idSeq = 0;

/** PostgREST filter value -> test against a row's value (only the operators the app uses) */
function matches(row: Row, col: string, expr: string): boolean {
  const v = row[col];
  const dot = expr.indexOf(".");
  let op = expr.slice(0, dot);
  let arg = expr.slice(dot + 1);
  let negate = false;
  if (op === "not") {
    negate = true;
    const d2 = arg.indexOf(".");
    op = arg.slice(0, d2);
    arg = arg.slice(d2 + 1);
  }
  const s = v === null || v === undefined ? null : String(v);
  let ok: boolean;
  switch (op) {
    case "eq": ok = s === arg; break;
    case "neq": ok = s !== arg; break;
    case "is": ok = arg === "null" ? s === null : s === arg; break;
    case "in": {
      const list = arg.replace(/^\(|\)$/g, "").split(",").map((x) => x.replace(/^"|"$/g, ""));
      ok = s !== null && list.includes(s);
      break;
    }
    case "gte": ok = s !== null && s >= arg; break;
    case "lte": ok = s !== null && s <= arg; break;
    case "gt": ok = s !== null && s > arg; break;
    case "lt": ok = s !== null && s < arg; break;
    default: ok = true; // like/or/… : not modelled, let the row through
  }
  return negate ? !ok : ok;
}

const RESERVED = new Set(["select", "order", "limit", "offset", "on_conflict", "columns", "or", "and"]);

export class FakeNetwork {
  requests: Recorded[] = [];
  tables: Record<string, Row[]> = {};
  rpcs: Record<string, RpcHandler> = {};
  /** First matching fault rule wins; `once` rules are removed after use */
  private faults: { when: (r: Recorded) => boolean; fault: Fault; once: boolean }[] = [];
  /** Requests waiting forever (stalled) — counted so a test can see the write was sent */
  stalled: Recorded[] = [];
  readonly client: SupabaseClient<Database>;

  constructor() {
    // Same options as src/integrations/supabase/client.ts, dummy URL/key, in-memory session
    this.client = createClient<Database>(BASE, "dummy-anon-key", {
      auth: { storage: memoryStorage(), persistSession: true, autoRefreshToken: true },
      global: { fetch: (input, init) => this.fetch(input, init) },
    });
  }

  reset() {
    this.requests = [];
    this.tables = {};
    this.rpcs = {};
    this.faults = [];
    this.stalled = [];
  }

  /** Make matching requests fail. `when` defaults to "every request". */
  fault(fault: Fault, when: (r: Recorded) => boolean = () => true, once = false) {
    this.faults.push({ when, fault, once });
  }
  /** Shorthand matchers */
  static to = (target: string, method?: string) => (r: Recorded) => r.target === target && (!method || r.method === method);
  static writes = (r: Recorded) => r.method !== "GET" && r.method !== "HEAD";

  /** Requests other than reads */
  get writes() {
    return this.requests.filter(FakeNetwork.writes);
  }
  sent(target: string, method?: string) {
    return this.requests.filter(FakeNetwork.to(target, method));
  }

  seed(table: string, rows: Row[]) {
    this.tables[table] = rows.map((r) => ({ ...r }));
  }

  private async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    const path = url.pathname.replace(/^\//, "");
    const rpc = path.startsWith("rest/v1/rpc/");
    const target = rpc ? path.slice("rest/v1/rpc/".length) : path.startsWith("rest/v1/") ? path.slice("rest/v1/".length) : path;
    const query: Record<string, string[]> = {};
    url.searchParams.forEach((v, k) => (query[k] ??= []).push(v));
    let body: unknown = undefined;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    const req: Recorded = { method, path, target, rpc, query, body, prefer: headers.get("Prefer"), apikey: headers.get("apikey"), accept: headers.get("Accept") };
    this.requests.push(req);

    const rule = this.faults.find((f) => f.when(req));
    if (rule) {
      if (rule.once) this.faults.splice(this.faults.indexOf(rule), 1);
      const f = rule.fault;
      if (f.kind === "fail") throw new TypeError(f.message ?? "Failed to fetch");
      if (f.kind === "filtered") return json(200, req.prefer?.includes("return=representation") ? [] : undefined);
      if (f.kind === "stall") {
        if (f.landed) this.answer(req);
        this.stalled.push(req);
        return new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        });
      }
      return json(f.status ?? 403, { code: f.code ?? "42501", message: f.message ?? "permission denied for table " + target, details: null, hint: null });
    }

    return this.answer(req);
  }

  private answer(req: Recorded): Response {
    const { path, target, rpc, body } = req;
    if (!path.startsWith("rest/v1/")) return json(404, { message: "not faked: " + path });
    if (rpc) {
      const h = this.rpcs[target];
      // What PostgREST says for a function that isn't installed
      if (!h) return json(404, { code: "PGRST202", message: `Could not find the function public.${target}`, details: null, hint: null });
      return json(200, h((body ?? {}) as Row, req) ?? null);
    }
    return this.table(req);
  }

  /** Rows as PostgREST sends them: one object when .single() asked for it (406 unless exactly one) */
  private rowsOut(req: Recorded, status: number, rows: Row[], headers: Record<string, string> = {}): Response {
    if (!req.accept?.includes("vnd.pgrst.object")) return json(status, rows, headers);
    if (rows.length !== 1) return json(406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: `The result contains ${rows.length} rows`, hint: null });
    return json(status, rows[0], headers);
  }

  private table(req: Recorded): Response {
    const rows = (this.tables[req.target] ??= []);
    const filters = Object.entries(req.query).filter(([k]) => !RESERVED.has(k));
    const hit = (r: Row) => filters.every(([c, vs]) => vs.every((v) => matches(r, c, v)));
    const wantsRows = !!req.prefer?.includes("return=representation");
    const wantsCount = /count=(exact|planned|estimated)/.test(req.prefer ?? "");
    const range = (n: number) => ({ "Content-Range": n === 0 ? `*/${n}` : `0-${n - 1}/${n}` });

    switch (req.method) {
      case "GET":
      case "HEAD": {
        // Only the selected columns come back (embedded selects "a(b)" and "*" return whole rows)
        const sel = req.query.select?.[0];
        const cols = sel && !sel.includes("*") && !sel.includes("(") ? sel.split(",").map((c) => c.trim()) : null;
        const found = rows.filter(hit).map((r) => (cols ? Object.fromEntries(cols.map((c) => [c, r[c] ?? null])) : r));
        return req.method === "HEAD" ? new Response(null, { status: 200, headers: wantsCount ? range(found.length) : {} }) : this.rowsOut(req, 200, found, wantsCount ? range(found.length) : {});
      }
      case "POST": {
        const list = (Array.isArray(req.body) ? req.body : [req.body]) as Row[];
        const upsert = !!req.prefer?.includes("resolution=merge-duplicates");
        const keys = req.query.on_conflict?.[0]?.split(",") ?? ["id"];
        const out: Row[] = [];
        for (const r of list) {
          const prev = upsert ? rows.find((x) => keys.every((k) => r[k] !== undefined && String(x[k]) === String(r[k]))) : undefined;
          if (prev) {
            Object.assign(prev, r);
            out.push(prev);
          } else {
            // The primary key is unique, as in the database
            if (r.id !== undefined && rows.some((x) => String(x.id) === String(r.id))) return json(409, { code: "23505", message: `duplicate key value violates unique constraint "${req.target}_pkey"`, details: null, hint: null });
            const row = { id: `id-${++idSeq}`, created_at: new Date().toISOString(), ...r };
            rows.push(row);
            out.push(row);
          }
        }
        return wantsRows ? this.rowsOut(req, 201, out) : json(201, undefined);
      }
      case "PATCH": {
        const found = rows.filter(hit);
        found.forEach((r) => Object.assign(r, req.body as Row));
        return wantsRows ? this.rowsOut(req, 200, found) : json(200, undefined);
      }
      case "DELETE": {
        const found = rows.filter(hit);
        this.tables[req.target] = rows.filter((r) => !found.includes(r));
        return json(200, wantsRows ? found : undefined);
      }
    }
    return json(405, { message: "method" });
  }
}

export const net = new FakeNetwork();

// Taken before any test installs fake timers
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;

/**
 * Await a promise but give up (and fail the test) after `ms` of REAL time — "never hangs" is
 * asserted, not just hoped for. Use fake timers to push the code's own timeouts forward.
 */
export async function settles<T>(p: Promise<T>, ms = 3000): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const hang = new Promise<never>((_, reject) => {
    t = realSetTimeout(() => reject(new Error(`did not settle within ${ms} ms (hang)`)), ms);
  });
  try {
    return await Promise.race([p, hang]);
  } finally {
    realClearTimeout(t);
  }
}
