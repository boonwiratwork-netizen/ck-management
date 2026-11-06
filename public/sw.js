// CK Manager service worker: makes the app installable and quick to reopen.
// Only same-origin GETs are handled; Supabase/API calls always go to the network,
// so stock and money numbers are never served from cache.
// v3: the saved page only. v2 also kept every build file ever opened (892 files, 56 MB on the
// office laptop) and answered each one from that pile: opening a page waited 1.5-2.7 s for
// files the browser itself already had. Activating v3 deletes v2.
const CACHE = "ck-shell-v3";

// Keep the store small: the saved page plus the newest 300 build files (a build is ~60)
const KEEP = 300;
const touched = new Set();
function trim() {
  return caches.open(CACHE).then((c) =>
    c.keys().then((keys) => {
      const files = keys.filter((k) => new URL(k.url).pathname !== "/");
      return Promise.all(files.slice(0, Math.max(0, files.length - KEEP)).map((k) => c.delete(k)));
    }),
  );
}

self.addEventListener("install", () => {
  // Wait for the page to ask (update prompt) before taking over
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// What this worker can do: the app asks before switching notifications on, so it never
// subscribes through an older worker that has no push handler (it asks to update first)
const SW_VERSION = "ck-sw-4";
const SW_PUSH = true;

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
  if (event.data && event.data.type === "version" && event.ports && event.ports[0]) event.ports[0].postMessage({ version: SW_VERSION, push: SW_PUSH });
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Page navigations: network first so a new deploy shows up. On a weak signal,
  // open from the saved copy after 2.5 s (the network answer still refreshes it
  // for next time); offline, use the saved copy straight away.
  if (req.mode === "navigate") {
    let stored = Promise.resolve();
    const network = fetch(req).then((res) => {
      // Keep only a good page as the saved copy
      if (res.ok) {
        const copy = res.clone();
        stored = caches.open(CACHE).then((c) => c.put("/", copy));
      }
      return res;
    });
    // Registered now, so saving still finishes when the saved copy answered first
    event.waitUntil(network.then(() => stored, () => undefined));
    const saved = () => caches.match("/");
    const slow = new Promise((resolve) => setTimeout(resolve, 2500)).then(saved);
    event.respondWith(
      Promise.race([network.catch(saved), slow.then((r) => r || network)])
        .then((r) => r || network)
        .catch(() => saved().then((r) => r || Response.error())),
    );
    return;
  }

  // Build files (/assets/, hashed, never change) and icons. Online: not answered here — the
  // browser's own cache answers in a few ms, while answering from this worker's store cost
  // 1.5-2.7 s a file (v2). A copy is still saved in the background (first open of a new build
  // only) so the app opens offline. Offline: from that copy.
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/")) {
    if (self.navigator.onLine) {
      event.waitUntil(
        caches.open(CACHE).then((c) =>
          c.match(req).then((hit) => {
            // Still in use: moved to the newest end once per worker start, so trimming keeps it
            if (hit) return touched.has(req.url) ? undefined : (touched.add(req.url), c.delete(req).then(() => c.put(req, hit)));
            return fetch(req).then((res) => (res.ok ? c.put(req, res).then(trim) : undefined));
          }),
        ).catch(() => undefined),
      );
      return;
    }
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
  }
});

// ─── Push alerts (supabase/functions/alerts-run) ───
// A push carries { title, body, url, tag }. Shown as a notification; a newer one with the
// same tag (the same case) replaces the older one instead of stacking up.
self.addEventListener("push", (event) => {
  let p = {};
  try {
    p = event.data ? event.data.json() : {};
  } catch {
    p = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(p.title || "CK Manager", {
      body: p.body || "",
      tag: p.tag || undefined,
      renotify: !!p.tag,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: p.url || "/alerts" },
    }),
  );
});

// Tapping it: an open window of the app goes to the link (and comes to the front); none
// open → a new one. Only links inside the app are followed.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const raw = (event.notification.data && event.notification.data.url) || "/alerts";
  const target = new URL(raw, self.location.origin);
  const url = target.origin === self.location.origin ? target.href : new URL("/alerts", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const win = list.find((c) => new URL(c.url).origin === self.location.origin);
      if (win) return win.focus().then((w) => (w || win).navigate(url)).catch(() => self.clients.openWindow(url));
      return self.clients.openWindow(url);
    }),
  );
});
