import { toast } from "sonner";

/**
 * Registers the service worker (production builds only) and shows a one-tap
 * "new version" prompt when a deploy is waiting, so installed phones don't keep
 * running an old build.
 */
export function registerPwa() {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;

  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");

      const promptUpdate = (worker: ServiceWorker) => {
        toast("มีเวอร์ชันใหม่", {
          description: "กดอัปเดตเพื่อใช้เวอร์ชันล่าสุด",
          duration: Infinity,
          action: { label: "อัปเดต", onClick: () => worker.postMessage("SKIP_WAITING") },
        });
      };

      if (reg.waiting && navigator.serviceWorker.controller) promptUpdate(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const worker = reg.installing;
        worker?.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) promptUpdate(worker);
        });
      });

      // Reload only when a new version replaces an old one, not on the very first install
      const hadController = !!navigator.serviceWorker.controller;
      let reloaded = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (reloaded || !hadController) return;
        reloaded = true;
        window.location.reload();
      });

      // Check for a new deploy when the app comes back to the foreground
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") reg.update().catch(() => {});
      });
    } catch {
      // App works the same without the service worker
    }
  });
}
