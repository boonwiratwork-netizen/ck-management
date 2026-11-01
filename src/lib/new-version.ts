/**
 * After a release, an open tab may ask for page code that no longer exists. Reload once to
 * pick up the new version (not again within the same tab session for 10 s after it loads, so
 * a code file that really is missing can't reload forever). Returns whether it is reloading.
 */
const KEY = "ck-reloaded-for-new-version";

export function reloadForNewVersion(reload: () => void = () => window.location.reload()): boolean {
  try {
    if (sessionStorage.getItem(KEY)) return false;
    sessionStorage.setItem(KEY, "1");
  } catch {
    return false; // can't guard against a loop: don't reload
  }
  reload();
  return true;
}

/** Called once the page has loaded: a later failure may reload again */
export function clearReloadGuard() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // nothing to clear
  }
}

/** A page module that arrived without its component (Vite hands back undefined after a swallowed load error) */
export const isMissingPage = (m: unknown) => !m || typeof (m as { default?: unknown }).default === "undefined";

/**
 * For lazy(): the page's code, or — if its file is gone (rejected, or came back empty) — the
 * once-only new-version reload. When that already happened, the error goes on to the page's
 * error screen (PageErrorBoundary) instead of a white page.
 */
export function pageLoader<T extends { default: unknown }>(load: () => Promise<T>, reload?: () => void): () => Promise<T> {
  return async () => {
    let m: T | undefined;
    try {
      m = await load();
    } catch (e) {
      if (reloadForNewVersion(reload)) return new Promise<T>(() => undefined); // reloading
      throw e;
    }
    if (isMissingPage(m)) {
      if (reloadForNewVersion(reload)) return new Promise<T>(() => undefined);
      throw new Error("page code missing");
    }
    return m as T;
  };
}
