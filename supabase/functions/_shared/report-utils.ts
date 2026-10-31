// Shared helpers for the daily LINE report Edge Functions.

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Shared-secret gate. These functions run with verify_jwt = false, so without
// this anyone with the URL could read sales/stock figures or trigger LINE pushes.
// The only legitimate callers — the pg_cron jobs and the notify_to_sent() DB
// trigger — send header x-report-key, read from Vault secret "report_key",
// which must hold the same value as the REPORT_KEY Edge Function secret.
// Returns the error Response to send back, or null if the request may proceed.
export function requireReportKey(req: Request): Response | null {
  const expected = Deno.env.get("REPORT_KEY");
  // Fail closed: a missing secret must never mean "open to everyone".
  if (!expected) return jsonResponse({ error: "REPORT_KEY not configured" }, 500);
  const given = req.headers.get("x-report-key") ?? "";
  if (!timingSafeEqual(given, expected)) return jsonResponse({ error: "unauthorized" }, 401);
  return null;
}

// Compare without bailing out at the first differing byte, so response timing
// doesn't leak how much of a guessed key was right.
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < y.length; i++) diff |= (x[i] ?? 0) ^ y[i];
  return diff === 0;
}

export function toBangkokDateStr(d: Date): string {
  const bkk = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  return bkk.toISOString().slice(0, 10);
}

export function formatThaiDate(dateStr: string): string {
  const months = [
    "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
    "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
  ];
  const [y, m, d] = dateStr.split("-").map(Number);
  return `${d} ${months[m - 1]} ${y}`;
}

export function formatBaht(n: number): string {
  return n.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export function formatNum(n: number): string {
  return n.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export async function pushLineMessage(text: string): Promise<{ ok: boolean; error?: string }> {
  const token = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN");
  const groupId = Deno.env.get("LINE_GROUP_ID");
  if (!token || !groupId) {
    return { ok: false, error: "LINE_CHANNEL_ACCESS_TOKEN / LINE_GROUP_ID not configured" };
  }
  const resp = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ to: groupId, messages: [{ type: "text", text }] }),
  });
  if (!resp.ok) {
    const txt = await resp.text();
    return { ok: false, error: `LINE push failed [${resp.status}]: ${txt.slice(0, 500)}` };
  }
  return { ok: true };
}
