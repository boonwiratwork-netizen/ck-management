// Edge function: foodstory-probe
// One question: does a FoodStory owner-web login copied from a browser still work when used
// from this server (another machine, another network)? The answer decides whether sales can
// be pulled every night without a computer left on (FoodStory's login has a CAPTCHA, so the
// server can't log in by itself).
//
// The login is the browser's Cookie header, kept in the Edge Function secret
// FOODSTORY_COOKIE (set by a person in Lovable Cloud › Secrets). It is never returned, logged
// or stored anywhere else. Called with x-report-key like the report functions.

import { corsHeaders, jsonResponse, requireReportKey } from "../_shared/report-utils.ts";

const BASE = "https://owner.foodstory.co";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const denied = requireReportKey(req);
  if (denied) return denied;

  const cookie = Deno.env.get("FOODSTORY_COOKIE")?.trim().replace(/^cookie:\s*/i, "");
  if (!cookie) return jsonResponse({ result: "no_cookie", note: "ยังไม่ได้ใส่ FOODSTORY_COOKIE" });

  const headers = { Cookie: cookie, "User-Agent": UA, Accept: "text/html,application/json" };
  try {
    // A logged-out request is sent to the login page (a redirect); a logged-in one gets the report page
    const page = await fetch(`${BASE}/th/salebyoption`, { headers, redirect: "manual" });
    const location = page.headers.get("location") ?? "";
    const html = page.status === 200 ? await page.text() : "";
    const loggedIn = page.status === 200 && /ออกจากระบบ|logout/i.test(html) && !/type=["']password["']/i.test(html);

    // And one data call the report page itself makes, to see the data side answers too
    let branches: { status: number; count: number | null } | null = null;
    if (loggedIn) {
      const b = await fetch(`${BASE}/api/get_branch`, { headers: { ...headers, Accept: "application/json", "X-Requested-With": "XMLHttpRequest" }, redirect: "manual" });
      let count: number | null = null;
      try {
        const j = await b.json();
        count = Array.isArray(j) ? j.length : Array.isArray(j?.data) ? j.data.length : null;
      } catch {
        count = null;
      }
      branches = { status: b.status, count };
    }

    return jsonResponse({
      result: loggedIn ? "logged_in" : "not_logged_in",
      page_status: page.status,
      // Only where it was sent (e.g. /login), never the cookie
      redirected_to: location ? new URL(location, BASE).pathname : null,
      branches,
      checked_at: new Date().toISOString(),
    });
  } catch (e) {
    return jsonResponse({ result: "error", message: e instanceof Error ? e.message : String(e) }, 502);
  }
});
