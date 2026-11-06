import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { deviceStateOf, keyBytes, sameKey, type PushEnv } from "./push-device";

const env = (o: Partial<PushEnv> = {}): PushEnv => ({ userAgent: "Mozilla/5.0 (Linux; Android 14)", maxTouchPoints: 5, standalone: true, hasServiceWorker: true, hasPushManager: true, permission: "default", ...o });

describe("this device", () => {
  it("iPhone in Safari: add to the home screen first; installed: fine", () => {
    const ios = { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" };
    expect(deviceStateOf(env({ ...ios, standalone: false }), false)).toBe("ios-needs-install");
    expect(deviceStateOf(env({ ...ios, standalone: true }), false)).toBe("off");
  });
  it("no switching on while an update waits or the running worker has no push handler", () => {
    expect(deviceStateOf(env(), false, false)).toBe("needs-update");
    expect(deviceStateOf(env(), false, true)).toBe("off");
    // already on: shown as on (it keeps working); switching off is always allowed
    expect(deviceStateOf(env({ permission: "granted" }), true, false)).toBe("on");
  });
  it("blocked and unsupported", () => {
    expect(deviceStateOf(env({ permission: "denied" }), false)).toBe("blocked");
    expect(deviceStateOf(env({ hasPushManager: false }), false)).toBe("unsupported");
  });
  it("a subscription made with another server key is told apart (then renewed)", () => {
    const k = keyBytes("BGUdHa-_");
    expect(sameKey(k.slice().buffer, k)).toBe(true);
    expect(sameKey(keyBytes("BGUdHb-_").buffer, k)).toBe(false);
    expect(sameKey(null, k)).toBe(false);
  });
});

describe("push addresses the database accepts (alert_push_endpoint_ok)", () => {
  const sql = readFileSync(resolve(__dirname, "../../../supabase/migrations/20261107120000_push_alerts.sql"), "utf8");
  const pattern = new RegExp(/p_endpoint ~ '([^']+)'/.exec(sql)![1]);
  it("https on the browsers' push services only", () => {
    for (const ok of ["https://fcm.googleapis.com/fcm/send/abc", "https://web.push.apple.com/QK", "https://updates.push.services.mozilla.com/wpush/v2/x", "https://db5p.notify.windows.com/w/?token=x"]) expect(pattern.test(ok)).toBe(true);
    for (const bad of ["http://fcm.googleapis.com/fcm/send/abc", "https://evil.example.com/fcm.googleapis.com/", "https://fcm.googleapis.com.evil.com/x", "https://web.push.apple.com.evil/x", "javascript:alert(1)"]) expect(pattern.test(bad)).toBe(false);
  });
});
