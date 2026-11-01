import { bottomNavFor, sidebarTabsFor, type TabKey } from "@/components/AppSidebar";
import type { AppRole } from "@/hooks/use-auth";
import { chunkForTab, pageChunks, type PageChunk } from "@/pages/page-chunks";
import { isMissingPage } from "@/lib/new-version";

/**
 * After a release every page's code is a new file, downloaded on the first tap (2–3 s on
 * the live site). Once the app is idle after sign-in, fetch the pages this role uses ahead
 * of time: the phone bar's daily pages first, then the rest of its sidebar; one at a time,
 * so it never competes with what the person is opening. Skipped on data saver / 2G.
 */

/** Which pages' code to fetch for `role`, in order, not counting the one already open */
export function prefetchOrder(role: AppRole | null, openTab: TabKey | null): PageChunk[] {
  if (!role) return [];
  const tabs = [...bottomNavFor(role).map((i) => i.key), ...sidebarTabsFor(role)];
  const open = openTab ? chunkForTab[openTab] : null;
  const out: PageChunk[] = [];
  for (const t of tabs) {
    const c = chunkForTab[t];
    if (c && c !== open && !out.includes(c)) out.push(c);
  }
  return out;
}

type Connection = { saveData?: boolean; effectiveType?: string };

/** The person asked to save data, or the connection is 2G: download nothing extra */
export function shouldSkipPrefetch(conn: Connection | undefined | null): boolean {
  if (!conn) return false;
  return !!conn.saveData || conn.effectiveType === "slow-2g" || conn.effectiveType === "2g";
}

export interface PrefetchEnv {
  /** Fetch one page's code (default: its import from page-chunks.ts) */
  load?: (chunk: PageChunk) => Promise<unknown>;
  /** Wait until the browser is idle (default: requestIdleCallback, else ~2 s) */
  idle?: (run: () => void) => () => void;
  connection?: Connection | null;
}

const browserIdle = (run: () => void): (() => void) => {
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
  if (w.requestIdleCallback) {
    const id = w.requestIdleCallback(run, { timeout: 5000 });
    return () => w.cancelIdleCallback?.(id);
  }
  const t = setTimeout(run, 2000);
  return () => clearTimeout(t);
};

/** Start fetching; returns a stop function (sign-out, role change) */
export function prefetchPages(role: AppRole | null, openTab: TabKey | null, env: PrefetchEnv = {}): () => void {
  const conn = env.connection !== undefined ? env.connection : (navigator as Navigator & { connection?: Connection }).connection;
  if (shouldSkipPrefetch(conn)) return () => undefined;
  const queue = prefetchOrder(role, openTab);
  const load = env.load ?? ((c: PageChunk) => pageChunks[c]());
  const idle = env.idle ?? browserIdle;
  let stopped = false;
  let cancelWait: () => void = () => undefined;
  const next = () => {
    if (stopped || queue.length === 0) return;
    cancelWait = idle(() => {
      if (stopped) return;
      const chunk = queue.shift()!;
      // A failed download (offline, a release mid-way) is fine: the page loads on tap as before.
      // While it runs, main.tsx doesn't treat a failed download as "new version, reload now" —
      // that reload is for a page someone opened, not for this (stop instead)
      const flag = window as Window & { __ckPrefetching?: number };
      flag.__ckPrefetching = (flag.__ckPrefetching ?? 0) + 1;
      load(chunk)
        .then(
          // A module without its page (a load error swallowed somewhere) is a failure too
          (m) => (m === undefined || isMissingPage(m) ? (stopped = true) : next()),
          () => {
            stopped = true;
          },
        )
        .finally(() => {
          flag.__ckPrefetching = Math.max(0, (flag.__ckPrefetching ?? 1) - 1);
        });
    });
  };
  next();
  return () => {
    stopped = true;
    cancelWait();
  };
}
