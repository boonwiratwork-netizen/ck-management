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
