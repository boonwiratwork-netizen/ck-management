/**
 * Base data (SKUs, prices, recipes, menus, branches, suppliers…) changes a few
 * times a week but used to be downloaded on every app open — ~20 requests that
 * queue on the small database for ~2.5 s before any page could start.
 *
 * Now each base list is saved on this device per signed-in user: the saved copy
 * shows at once, the fresh copy loads in the background and replaces it. While
 * any fresh copy is still loading, database WRITES wait for it (see
 * installWriteGuard), so nothing is saved against yesterday's prices or recipes.
 */

const PREFIX = "ck-base-v1";
const AUTH_KEY_RE = /^sb-.+-auth-token$/;

type Listener = () => void;
const listeners = new Set<Listener>();
let pending = 0;
let everLoaded = false;
let waiters: (() => void)[] = [];

function emit() {
  for (const l of listeners) l();
  if (pending === 0) {
    const w = waiters;
    waiters = [];
    w.forEach((r) => r());
  }
}

/** Signed-in user's id from the saved Supabase session (sync, no network) */
function scope(): string | null {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && AUTH_KEY_RE.test(k)) {
        const id = JSON.parse(localStorage.getItem(k) || "null")?.user?.id;
        if (id) return id;
      }
    }
  } catch {
    // storage blocked: no device copy
  }
  return null;
}

function read<T>(key: string): T[] | null {
  const s = scope();
  if (!s) return null;
  try {
    const raw = localStorage.getItem(`${PREFIX}:${s}:${key}`);
    return raw ? (JSON.parse(raw) as T[]) : null;
  } catch {
    return null;
  }
}

function write(key: string, rows: unknown[]) {
  const s = scope();
  if (!s) return;
  try {
    localStorage.setItem(`${PREFIX}:${s}:${key}`, JSON.stringify(rows));
  } catch {
    // full or blocked: the app still works, it just won't open faster next time
  }
}

/**
 * Load one base list: apply the device copy now (if any), then the fresh rows.
 * `fetch` is the same Supabase query the hook always ran; `apply` gets raw rows.
 * Returns the fresh query result so callers keep their error handling.
 */
export async function loadWithDeviceCopy<T>(
  key: string,
  fetch: () => PromiseLike<{ data: T[] | null; error: unknown }>,
  apply: (rows: T[], fromDevice: boolean) => void,
): Promise<{ data: T[] | null; error: unknown }> {
  const saved = read<T>(key);
  if (saved) {
    apply(saved, true);
    everLoaded = true;
  }
  pending++;
  emit();
  try {
    const res = await fetch();
    if (!res.error && res.data) {
      apply(res.data, false);
      write(key, res.data);
      everLoaded = true;
    }
    return res;
  } finally {
    pending--;
    emit();
  }
}

/** Remove every saved base list (on sign-out) */
export function clearDeviceCopies() {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(`${PREFIX}:`)) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    // nothing to clear
  }
}

/** For the loading bar / skeleton: is fresh data still on its way, has anything shown yet */
export function subscribeBaseStatus(l: Listener) {
  listeners.add(l);
  return () => listeners.delete(l);
}
export const baseStatus = () => (pending > 0 ? (everLoaded ? "refreshing" : "first-load") : "fresh");

/** Resolves when no fresh base list is loading (or after `maxMs`, so a dead request can't block saving forever) */
export function whenBaseFresh(maxMs = 10_000): Promise<void> {
  if (pending === 0) return Promise.resolve();
  return new Promise((resolve) => {
    waiters.push(resolve);
    setTimeout(resolve, maxMs);
  });
}

/**
 * Hold Supabase writes (POST/PATCH/PUT/DELETE to /rest/v1) until fresh base data
 * is in. Must run before the Supabase client is created, because the client keeps
 * a reference to fetch — main.tsx imports this first.
 */
export function installWriteGuard() {
  if (typeof window === "undefined" || (window as { __ckWriteGuard?: boolean }).__ckWriteGuard) return;
  (window as { __ckWriteGuard?: boolean }).__ckWriteGuard = true;
  const original = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (method !== "GET" && method !== "HEAD" && url.includes("/rest/v1/") && !url.includes("/rest/v1/rpc/")) {
      await whenBaseFresh();
    }
    return original(input, init);
  };
}
