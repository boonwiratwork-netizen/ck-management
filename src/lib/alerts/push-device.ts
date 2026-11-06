/**
 * This device and Web Push: can it get notifications, is it switched on, switch it on/off.
 * The browser keeps the subscription; the database keeps a copy (push_subscriptions) so
 * alerts-run can reach it. iPhone/iPad: only once the app is added to the home screen
 * (iOS 16.4+), never in Safari itself.
 */

export type DeviceState =
  /** Push isn't available here: no service worker / PushManager (old browser, dev build) */
  | "unsupported"
  /** iPhone/iPad in Safari: add to the home screen first */
  | "ios-needs-install"
  /** The person blocked notifications for the app (only the phone's settings can undo it) */
  | "blocked"
  /** A new version of the app is waiting, or the running worker has no push handler: update first */
  | "needs-update"
  | "off"
  | "on";

export interface PushEnv {
  userAgent: string;
  maxTouchPoints: number;
  standalone: boolean;
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  permission: NotificationPermission | "unsupported";
}

export function readEnv(): PushEnv {
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  let standalone = false;
  try {
    standalone = window.matchMedia?.("(display-mode: standalone)").matches || (nav as Navigator & { standalone?: boolean })?.standalone === true;
  } catch {
    standalone = false;
  }
  return {
    userAgent: nav?.userAgent ?? "",
    maxTouchPoints: nav?.maxTouchPoints ?? 0,
    standalone,
    hasServiceWorker: !!nav && "serviceWorker" in nav,
    hasPushManager: typeof window !== "undefined" && "PushManager" in window,
    permission: typeof Notification === "undefined" ? "unsupported" : Notification.permission,
  };
}

/** iPhone, iPad (iPadOS says it is a Mac, but has touch) */
export const isIos = (e: Pick<PushEnv, "userAgent" | "maxTouchPoints">) => /iPhone|iPad|iPod/.test(e.userAgent) || (/Macintosh/.test(e.userAgent) && e.maxTouchPoints > 1);

/** What this device can do. `workerReady` = the running worker handles pushes and no update is waiting (workerStatus) */
export function deviceStateOf(e: PushEnv, subscribed: boolean, workerReady = true): DeviceState {
  if (isIos(e) && !e.standalone) return "ios-needs-install";
  if (!e.hasServiceWorker || !e.hasPushManager || e.permission === "unsupported") return "unsupported";
  if (e.permission === "denied") return "blocked";
  if (!workerReady && !subscribed) return "needs-update";
  return subscribed && e.permission === "granted" ? "on" : "off";
}

/** A short name for the device, shown in the device list ("iPhone", "Android", "Mac"…) */
export function deviceLabel(ua: string): string {
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua) || /Macintosh/.test(ua)) return /Mobile|iPad/.test(ua) ? "iPad" : "Mac";
  if (/Android/.test(ua)) return "Android";
  if (/Windows/.test(ua)) return "Windows";
  return "อุปกรณ์";
}

/** VAPID public key (base64url) → the bytes PushManager.subscribe wants */
export function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  // The worker is registered by lib/pwa.ts on load (production builds); wait at most 5 s
  return Promise.race([navigator.serviceWorker.ready, new Promise<null>((r) => setTimeout(() => r(null), 5000))]);
}

/** The running worker's answer to "version" (public/sw.js); null = no answer (an older worker) */
export function askWorkerVersion(worker: ServiceWorker, ms = 2000): Promise<{ version: string; push: boolean } | null> {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    const t = setTimeout(() => resolve(null), ms);
    ch.port1.onmessage = (ev) => {
      clearTimeout(t);
      resolve(ev.data && typeof ev.data === "object" ? ev.data : null);
    };
    try {
      worker.postMessage({ type: "version" }, [ch.port2]);
    } catch {
      clearTimeout(t);
      resolve(null);
    }
  });
}

/**
 * Can this device subscribe now? Not while a new version waits (the subscription would sit
 * on the worker about to be replaced) or while the running worker has no push handler.
 */
export async function workerStatus(): Promise<"ready" | "update-waiting" | "old-worker" | "none"> {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (!reg) return "none";
    if (reg.waiting) return "update-waiting";
    const v = reg.active ? await askWorkerVersion(reg.active) : null;
    return v?.push === true ? "ready" : "old-worker";
  } catch {
    return "none";
  }
}

/** อัปเดตแอปก่อน: let the waiting version take over (lib/pwa.ts reloads the page), or look for one */
export async function applyUpdate(): Promise<void> {
  const reg = await navigator.serviceWorker?.getRegistration();
  if (reg?.waiting) reg.waiting.postMessage("SKIP_WAITING");
  else await reg?.update();
}

/** Same bytes (the subscription's server key vs the current VAPID key) */
export function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a) return false;
  const x = new Uint8Array(a);
  return x.length === b.length && x.every((v, i) => v === b[i]);
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  try {
    const reg = await registration();
    return (await reg?.pushManager.getSubscription()) ?? null;
  } catch {
    return null;
  }
}

export interface SubscriptionKeys {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export function keysOf(sub: PushSubscription): SubscriptionKeys | null {
  const j = sub.toJSON();
  if (!j.endpoint || !j.keys?.p256dh || !j.keys?.auth) return null;
  return { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth };
}

/**
 * Ask permission (must follow a tap: iOS refuses otherwise) and subscribe. Throws with a
 * Thai message the screen can show.
 */
export async function subscribeDevice(publicKey: string): Promise<SubscriptionKeys> {
  if (!publicKey) throw new Error("ระบบแจ้งเตือนยังไม่พร้อม (ยังไม่ได้ตั้งค่ากุญแจที่เซิร์ฟเวอร์)");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error(perm === "denied" ? "เครื่องนี้ปิดการแจ้งเตือนของแอปไว้ เปิดได้ที่การตั้งค่าของเครื่อง" : "ยังไม่ได้อนุญาตการแจ้งเตือน");
  const reg = await registration();
  if (!reg) throw new Error("แอปยังโหลดไม่ครบ ลองปิดแล้วเปิดแอปใหม่");
  if (reg.waiting) throw new Error("มีแอปเวอร์ชันใหม่รออยู่ อัปเดตแอปก่อน");
  const key = keyBytes(publicKey);
  let sub = await reg.pushManager.getSubscription();
  // Made with another server key (keys were changed): it can't receive our pushes — renew it
  if (sub && !sameKey(sub.options?.applicationServerKey, key)) {
    await sub.unsubscribe().catch(() => false);
    sub = null;
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  const k = keysOf(sub);
  if (!k) throw new Error("เครื่องนี้รับการแจ้งเตือนไม่ได้");
  return k;
}

/** Unsubscribe in the browser; returns the endpoint that was dropped (to delete its row) */
export async function unsubscribeDevice(): Promise<string | null> {
  const sub = await currentSubscription();
  if (!sub) return null;
  const endpoint = sub.endpoint;
  await sub.unsubscribe().catch(() => false);
  return endpoint;
}
