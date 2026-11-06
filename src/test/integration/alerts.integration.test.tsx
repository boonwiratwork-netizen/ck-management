import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { FakeNetwork, net, settles } from "./fake-network";

/**
 * Push alerts screen through the real client: reads of cases / digests / settings, the two
 * case buttons (rpc), a person's rule switch and management's settings — each write counts
 * the rows that came back (filtered by row security = not saved), and the screen tells.
 */
vi.mock("@/integrations/supabase/client", async () => ({ supabase: (await import("./fake-network")).net.client }));
const toasts = vi.hoisted(() => {
  const log: [string, string][] = [];
  const mk = (k: string) => (m: unknown) => void log.push([k, String(m)]);
  return { log, toast: Object.assign(mk("toast"), { success: mk("success"), error: mk("error"), info: mk("info"), warning: mk("warning") }) };
});
vi.mock("sonner", () => ({ toast: toasts.toast }));
const auth = vi.hoisted(() => ({ value: { user: { id: "u1" }, isManagement: true } }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => auth.value }));

import AlertsInbox, { IOS_HINT } from "@/pages/AlertsInbox";
import { ackCase, readAlerts, saveRuleConfig, setRulePref } from "@/lib/alerts/alerts-db";
import { parseConfig } from "../../../supabase/functions/_shared/alerts/config.ts";

const NOW = Date.parse("2026-11-09T10:00:00+07:00");
const caseRow = (o: Record<string, unknown>) => ({
  key: "to_unreceived:t1", rule: "to_unreceived", tier: "morning", title: "TO-001 ส่งแล้ว Sendo สยาม ยังไม่กดรับ", detail: "4 วัน · มูลค่า ฿1,500", severity: "high", status: "open",
  scope: { branchId: "b1", toId: "t1" }, link: { page: "transfer" }, habit_key: null, habit_day: null, habit_label: null,
  opened_at: "2026-11-05T02:00:00Z", changed_at: "2026-11-05T02:00:00Z", last_seen_at: "2026-11-09T01:00:00Z", closed_at: null,
  last_value: 4, notified_value: 4, baseline: null, baseline_candidate: null, acknowledged_at: null, acknowledged_by: null, ...o,
});

function seed() {
  net.seed("alert_settings", [{ rule: "_global", enabled: true, tier: "morning", thresholds: { daily_cap: 5, vapid_public_key: "BPub" }, worsen_step: null, worsen_mode: null }]);
  net.seed("alert_cases", [
    caseRow({}),
    caseRow({ key: "price_rise:s1", rule: "price_rise", title: "หมูสามชั้น ราคาขึ้น 30%", detail: "0.200 → 0.260 บาท/g", severity: "medium", link: { page: "price", skuCode: "RM-001" }, baseline_candidate: 0.26, opened_at: "2026-11-09T01:00:00Z" }),
    caseRow({ key: "count_diff:b1:2026-11-08", rule: "count_problem", title: "Sendo สยาม นับ diff ฿1,600", severity: "medium", link: { page: "count", branchId: "b1", date: "2026-11-08" }, status: "closed", closed_at: "2026-11-09T01:00:00Z" }),
  ]);
  net.seed("alert_digests", [{ id: "d1", kind: "morning", for_day: "2026-11-09", user_id: "u1", title: "สรุปเช้า 9 พ.ย.", body: "", lines: [{ section: "new", text: "TO-001 ส่งแล้ว", key: "to_unreceived:t1" }], pushed: true, created_at: "2026-11-09T01:00:00Z" }]);
  net.seed("alert_recipient_prefs", [{ user_id: "u1", rule: "weekly_cost", enabled: false }]);
  net.seed("push_subscriptions", []);
}

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname + l.hash}</p>;
}
const page = (path = "/alerts") =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/alerts" element={<AlertsInbox nowMs={NOW} />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );

// jsdom has no ResizeObserver (SegmentedTabs measures its edges with one)
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= function () {};

beforeEach(() => {
  net.reset();
  toasts.log.length = 0;
  localStorage.clear();
  auth.value = { user: { id: "u1" }, isManagement: true };
  seed();
});
afterEach(() => cleanup());

describe("alerts: reads and writes", () => {
  it("reads settings, cases (open + last 7 days), this person's digests, switches and devices", async () => {
    const r = await settles(readAlerts("u1", NOW));
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.data.config.global.vapidPublicKey).toBe("BPub");
    expect(r.data.off.has("weekly_cost")).toBe(true);
    expect(net.sent("alert_digests", "GET")[0].query.user_id).toEqual(["eq.u1"]);
    expect(net.sent("alert_recipient_prefs", "GET")[0].query.user_id).toEqual(["eq.u1"]);
  });
  it("tables not there yet (migration not run): told apart", async () => {
    net.fault({ kind: "refuse", status: 404, code: "PGRST205", message: "Could not find the table 'public.alert_cases' in the schema cache" }, FakeNetwork.to("alert_cases"));
    expect((await settles(readAlerts("u1", NOW))).kind).toBe("missing");
  });
  it("รับทราบ: the rpc's row count decides — 0 = not saved", async () => {
    net.rpcs.alert_case_ack = (a) => (a.p_key === "to_unreceived:t1" ? 1 : 0);
    expect(await settles(ackCase("to_unreceived:t1"))).toEqual({ ok: true });
    const r = await settles(ackCase("gone"));
    expect(r.ok).toBe(false);
  });
  it("a switch filtered out by row security is not saved", async () => {
    net.fault({ kind: "filtered" }, FakeNetwork.to("alert_recipient_prefs", "POST"));
    expect((await settles(setRulePref("u1", "to_short", false))).ok).toBe(false);
  });
  it("management's rule settings: one row, by rule, with who changed it", async () => {
    const r = parseConfig([]).rules.get("to_short")!;
    expect(await settles(saveRuleConfig("u1", { ...r, thresholds: { ...r.thresholds, short_pct: 15 } }))).toEqual({ ok: false, message: expect.any(String) }); // no such row seeded
    net.seed("alert_settings", [{ rule: "to_short" }]);
    expect(await settles(saveRuleConfig("u1", { ...r, thresholds: { ...r.thresholds, short_pct: 15 } }))).toEqual({ ok: true });
    const patch = net.sent("alert_settings", "PATCH").pop()!;
    expect(patch.query.rule).toEqual(["eq.to_short"]);
    expect(patch.body).toMatchObject({ thresholds: { short_pct: 15, lookback_hours: 48 }, updated_by: "u1" });
  });
});

describe("alerts screen", () => {
  it("ยังค้าง: open cases, urgent first, with their age; closed ones not listed; price cases offer ใช้ราคานี้เป็นปกติ", async () => {
    page();
    await screen.findByText("TO-001 ส่งแล้ว Sendo สยาม ยังไม่กดรับ");
    expect(screen.getByText("ค้างมา 4 วัน")).toBeTruthy();
    expect(screen.getByText("วันนี้")).toBeTruthy();
    expect(screen.queryByText("Sendo สยาม นับ diff ฿1,600")).toBeNull();
    expect(screen.getAllByRole("button", { name: /ใช้ราคานี้เป็นปกติ/ })).toHaveLength(1);
    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items[0]).toContain("TO-001");
  });

  it("รับทราบ sends the case key and reads again; a refusal is shown", async () => {
    let n = 1;
    net.rpcs.alert_case_ack = () => n;
    page();
    await screen.findByText("TO-001 ส่งแล้ว Sendo สยาม ยังไม่กดรับ");
    fireEvent.click(screen.getAllByRole("button", { name: /รับทราบ/ })[0]);
    await waitFor(() => expect(net.sent("alert_case_ack").length).toBe(1));
    expect(net.sent("alert_case_ack")[0].body).toEqual({ p_key: "to_unreceived:t1" });
    await waitFor(() => expect(toasts.log.some((t) => t[0] === "success")).toBe(true));
    n = 0;
    await waitFor(() => expect(screen.getAllByRole("button", { name: /รับทราบ/ })[0]).toBeTruthy());
    fireEvent.click(screen.getAllByRole("button", { name: /รับทราบ/ })[0]);
    await waitFor(() => expect(toasts.log.some((t) => t[0] === "error")).toBe(true));
  });

  it("the case's button goes to its page", async () => {
    page();
    fireEvent.click(await screen.findByRole("button", { name: /ดูใบโอน/ }));
    expect((await screen.findByTestId("where")).textContent).toBe("/transfer-order#history");
  });

  it("opened from a push (#go/<key>): straight to that case's page, branch remembered", async () => {
    page("/alerts#go/" + encodeURIComponent("count_diff:b1:2026-11-08"));
    expect((await screen.findByTestId("where")).textContent).toBe("/daily-stock-count");
    expect(localStorage.getItem("ck-count-branch")).toBe("b1");
  });

  it("ล่าสุด: this person's digests and recent cases", async () => {
    page();
    await screen.findByText("TO-001 ส่งแล้ว Sendo สยาม ยังไม่กดรับ");
    fireEvent.click(screen.getByRole("tab", { name: "ล่าสุด" }));
    expect(await screen.findByText("สรุปเช้า 9 พ.ย.")).toBeTruthy();
    expect(screen.getByText("Sendo สยาม นับ diff ฿1,600")).toBeTruthy();
  });

  it("ตั้งค่า: iPhone in Safari is told to add the app to the home screen; per-rule switches write this person's row", async () => {
    const ua = vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)");
    page();
    await screen.findByText("TO-001 ส่งแล้ว Sendo สยาม ยังไม่กดรับ");
    fireEvent.click(screen.getByRole("tab", { name: "ตั้งค่า" }));
    expect(await screen.findByText(IOS_HINT)).toBeTruthy();
    expect((screen.getByRole("switch", { name: "Food cost / waste / ของใหม่ รายสัปดาห์" }) as HTMLButtonElement).getAttribute("aria-checked")).toBe("false");
    fireEvent.click(screen.getByRole("switch", { name: "ครัวส่งไม่ครบตามที่ขอ" }));
    await waitFor(() => expect(net.sent("alert_recipient_prefs", "POST").length).toBe(1));
    expect(net.sent("alert_recipient_prefs", "POST")[0].body).toMatchObject({ user_id: "u1", rule: "to_short", enabled: false });
    expect(screen.getByRole("region", { name: "เวลาและจำนวน" })).toBeTruthy();
    ua.mockRestore();
  });

  it("the kitchen manager sees no global settings", async () => {
    auth.value = { user: { id: "u1" }, isManagement: false };
    page();
    await screen.findByText("TO-001 ส่งแล้ว Sendo สยาม ยังไม่กดรับ");
    fireEvent.click(screen.getByRole("tab", { name: "ตั้งค่า" }));
    await screen.findByText("เรื่องที่อยากรับ");
    expect(screen.queryByRole("region", { name: "เวลาและจำนวน" })).toBeNull();
  });
});
