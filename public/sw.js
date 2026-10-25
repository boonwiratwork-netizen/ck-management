// CK Manager service worker: makes the app installable and quick to reopen.
// Only same-origin GETs are handled; Supabase/API calls always go to the network,
// so stock and money numbers are never served from cache.
const CACHE = "ck-shell-v2";

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

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
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

  // Hashed build assets never change: cache first
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
});
