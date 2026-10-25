import "./lib/install-write-guard";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { registerPwa } from "./lib/pwa";

// After a publish, an open tab may ask for page code that no longer exists.
// Reload once to pick up the new version instead of showing a blank screen.
window.addEventListener("vite:preloadError", (event) => {
  const key = "ck-reloaded-for-new-version";
  if (sessionStorage.getItem(key)) return;
  sessionStorage.setItem(key, "1");
  event.preventDefault();
  window.location.reload();
});
window.addEventListener("load", () => setTimeout(() => sessionStorage.removeItem("ck-reloaded-for-new-version"), 10_000));

createRoot(document.getElementById("root")!).render(<App />);

registerPwa();
