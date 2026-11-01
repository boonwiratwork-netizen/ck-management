import "./lib/install-write-guard";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { registerPwa } from "./lib/pwa";
import { clearReloadGuard, reloadForNewVersion } from "./lib/new-version";

// After a publish, an open tab may ask for page code that no longer exists.
// Reload once to pick up the new version instead of showing a blank screen.
window.addEventListener("vite:preloadError", (event) => {
  // While pages are fetched ahead of time (lib/page-prefetch.ts) no reload starts from here: the
  // failed import is left to fail (never swallowed — a swallowed one hands back an empty module),
  // the prefetch stops, and a page someone opens reloads through its own loader (pageLoader)
  if ((window as Window & { __ckPrefetching?: number }).__ckPrefetching) return;
  if (reloadForNewVersion()) event.preventDefault();
});
window.addEventListener("load", () => setTimeout(clearReloadGuard, 10_000));

createRoot(document.getElementById("root")!).render(<App />);

registerPwa();
