import { useEffect, useRef } from "react";

/**
 * The daily pages' last-seen data, kept in memory while the app is open (never on the
 * device: a reload or sign-out starts clean). Going back to a page shows what it showed
 * last at once, and the page reads again behind it (with a "กำลังอัปเดต…" note) — it used
 * to sit on a skeleton for 0.3–0.9 s re-reading everything from scratch.
 *
 * Safety: each kept copy names the tables it was worked out from. ANY database write to
 * one of those tables (from any page; seen by the fetch wrapper in base-cache.ts) throws
 * the copy away, so a page opened after a save never shows a pre-save number — it loads
 * fresh instead. A database function call throws everything away (it may touch any
 * table), except the few that only hand out a number.
 *
 * The page that is open when a write happens keeps its copy when it closes (useKeepLastSeen):
 * that is the page that saved, and what it shows already includes its own save.
 */

export interface Seen<T> {
  value: T;
  /** When it was kept (ms) */
  at: number;
}

interface Entry {
  value: unknown;
  at: number;
  tables: readonly string[];
}

const entries = new Map<string, Entry>();

/** Keep what a page shows for `key` (page + branch + day…), worked out from `tables` */
export function keep(key: string, tables: readonly string[], value: unknown, now = Date.now()) {
  entries.set(key, { value, at: now, tables });
}

/** What the page showed last for `key`, or null (never shown, or a write since threw it away) */
export function lastSeen<T>(key: string | null | undefined): Seen<T> | null {
  if (!key) return null;
  const e = entries.get(key);
  return e ? { value: e.value as T, at: e.at } : null;
}

/** A write to these tables happened (or "all": unknown which) — drop every copy made from them */
export function forgetTables(tables: readonly string[] | "all") {
  if (tables === "all") {
    entries.clear();
    shared.clear();
    return;
  }
  const hit = new Set(tables);
  for (const [k, e] of entries) if (e.tables.some((t) => hit.has(t))) entries.delete(k);
  for (const [k, s] of shared) if (s.tables.some((t) => hit.has(t))) shared.delete(k);
}

let cacheUser: string | null = null;

/**
 * The signed-in person as the session says (every auth event, including expiry and a sign-out
 * in another tab): no session, or a different person, drops everything kept for the last one.
 */
export function cacheForUser(userId: string | null) {
  if (userId === null || (cacheUser !== null && cacheUser !== userId)) clearPageCache();
  cacheUser = userId;
}

/** Sign-out: nothing of this user stays */
export function clearPageCache() {
  entries.clear();
  shared.clear();
}

/** Database functions that change no page data (they only hand out the next document number) */
const READ_ONLY_FUNCTIONS = new Set(["next_doc_number"]);

/**
 * Which tables a request writes: null = not a write (or not to the database tables),
 * "all" = a database function that may write anywhere.
 */
export function writtenTables(url: string, method: string): string[] | "all" | null {
  const m = method.toUpperCase();
  if (m === "GET" || m === "HEAD") return null;
  const at = url.indexOf("/rest/v1/");
  if (at < 0) return null;
  const path = url.slice(at + "/rest/v1/".length).split(/[?#]/)[0];
  if (path.startsWith("rpc/")) return READ_ONLY_FUNCTIONS.has(path.slice(4)) ? null : "all";
  return path ? [decodeURIComponent(path)] : "all";
}

// ── Master reads shared by every page (recipes, menus, rules, product names) ──

interface SharedRead {
  value: Promise<unknown>;
  at: number;
  tables: readonly string[];
}
const shared = new Map<string, SharedRead>();

/** Master data is refreshed after this long even without a write seen here (another device may have changed it) */
export const MASTER_MAX_AGE_MS = 5 * 60_000;

/**
 * One read of master data for the whole app: handed out again while younger than `maxAgeMs`
 * and no write to `tables` was seen. A read that fails is dropped (the next ask reads again).
 */
export function sharedRead<T>(key: string, tables: readonly string[], load: () => Promise<T>, maxAgeMs = MASTER_MAX_AGE_MS, now = Date.now()): Promise<T> {
  const had = shared.get(key);
  if (had && now - had.at <= maxAgeMs) return had.value as Promise<T>;
  const value = load();
  const entry: SharedRead = { value, at: now, tables };
  shared.set(key, entry);
  value.catch(() => {
    if (shared.get(key) === entry) shared.delete(key);
  });
  return value;
}

/**
 * Keep a page's data under `key` whenever it changes, and once more when the page closes
 * (so the page that saved keeps its own post-save copy). `key` must be the key the shown
 * value is FOR (not the one being loaded); null = nothing shown yet, keep nothing.
 */
export function useKeepLastSeen(key: string | null, tables: readonly string[], value: unknown) {
  const latest = useRef<{ key: string | null; value: unknown; tables: readonly string[] }>({ key, value, tables });
  latest.current = { key, value, tables };
  useEffect(() => {
    if (key) keep(key, tables, value);
  }, [key, value]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(
    () => () => {
      const l = latest.current;
      if (l.key) keep(l.key, l.tables, l.value);
    },
    [],
  );
}

/**
 * For a hook that knows when its value is loaded for `key` (`fresh`): until then the kept
 * copy for `key` (if any) is shown instead, flagged `kept`. A fresh value is kept for next
 * time unless `keepIt` is false (a read that partly failed is shown, not kept).
 */
export function useKept<T>(key: string | null, tables: readonly string[], value: T, fresh: boolean, keepIt = true): { value: T; kept: boolean } {
  useKeepLastSeen(fresh && keepIt ? key : null, tables, value);
  if (fresh || !key) return { value, kept: false };
  const seen = lastSeen<T>(key);
  return seen ? { value: seen.value, kept: true } : { value, kept: false };
}

// ── Which tables each page's data is worked out from (the invalidation map) ──

/** The usage engine's master tables (lib/usage-context-db.ts) */
export const USAGE_TABLES = ["menus", "menu_bom", "menu_modifier_rules", "modifier_rule_menus", "sp_bom", "skus"] as const;
