// LINE Messaging API: check a webhook really came from LINE, read a photo, answer.
// Plain fetch + WebCrypto (Deno and Node 18+).

/** X-Line-Signature = base64(HMAC-SHA256(channel secret, raw body)) */
export async function verifySignature(body: string, signature: string | null, secret: string): Promise<boolean> {
  if (!signature || !secret) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  let bin = "";
  for (const b of mac) bin += String.fromCharCode(b);
  const expected = btoa(bin);
  // Same length compare without stopping at the first difference
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

const API = "https://api.line.me/v2/bot";

async function call(token: string, path: string, body: unknown): Promise<{ ok: boolean; status: number; text: string }> {
  const r = await fetch(`${API}${path}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  return { ok: r.ok, status: r.status, text: r.ok ? "" : (await r.text()).slice(0, 500) };
}

/** Answer with the reply token (free); if it has run out, push to the group instead */
export async function answer(token: string, replyToken: string | undefined, groupId: string, messages: unknown[]): Promise<{ ok: boolean; via: "reply" | "push"; error?: string }> {
  const msgs = messages.slice(0, 5);
  if (replyToken) {
    const r = await call(token, "/message/reply", { replyToken, messages: msgs });
    if (r.ok) return { ok: true, via: "reply" };
    console.warn("[line-bot] reply failed", r.status, r.text);
    // A card LINE refused (400) leaves the token unused: the text alone, still by reply (free)
    const textOnly = msgs.filter((m) => (m as { type?: string }).type === "text");
    if (r.status === 400 && textOnly.length && textOnly.length < msgs.length) {
      const t = await call(token, "/message/reply", { replyToken, messages: textOnly });
      if (t.ok) return { ok: true, via: "reply", error: `cards refused: ${r.text}` };
    }
  }
  // The token ran out (a slow answer): push, which counts against the account's monthly quota
  const p = await call(token, "/message/push", { to: groupId, messages: msgs });
  if (p.ok) return { ok: true, via: "push" };
  const textOnly = msgs.filter((m) => (m as { type?: string }).type === "text");
  if (textOnly.length && textOnly.length < msgs.length) {
    const q = await call(token, "/message/push", { to: groupId, messages: textOnly });
    if (q.ok) return { ok: true, via: "push", error: `cards refused: ${p.text}` };
  }
  return { ok: false, via: "push", error: `${p.status} ${p.text}` };
}

/** A photo sent to the group (LINE keeps it for a while), as base64 for Gemini */
export async function getImage(token: string, messageId: string): Promise<{ mimeType: string; data: string } | null> {
  const r = await fetch(`https://api-data.line.me/v2/bot/message/${encodeURIComponent(messageId)}/content`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const buf = new Uint8Array(await r.arrayBuffer());
  // Gemini takes ~20 MB per request: base64 grows a third
  if (buf.length > 7_000_000) return null;
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { mimeType: r.headers.get("content-type") ?? "image/jpeg", data: btoa(bin) };
}

export interface LineMention {
  index: number;
  length: number;
  isSelf?: boolean;
  type?: string;
}

/**
 * Is the bot being asked? An @mention of it (LINE's picker doesn't list bots on every app),
 * or the message starting with "บอท" (Thai runs on without a space) or "bot" / "livetoeat"
 * followed by a space. Returns the question without the call.
 */
const CALL = /^\s*@?\s*(?:บอท|(?:bot|livetoeat)(?=[\s:,.!?]|$))[\s:,.!?]*/i;
export function askedBot(text: string, mentionees: LineMention[] = []): { asked: boolean; question: string } {
  const mentioned = mentionees.some((m) => m.isSelf);
  const rest = stripMentions(text, mentionees);
  const called = CALL.test(rest);
  return { asked: mentioned || called, question: called ? rest.replace(CALL, "").trim() : rest };
}

/** The question without the @mentions in it */
export function stripMentions(text: string, mentionees: LineMention[] = []): string {
  let out = text;
  for (const m of [...mentionees].sort((a, b) => b.index - a.index)) out = out.slice(0, m.index) + out.slice(m.index + m.length);
  return out.replace(/\s+/g, " ").trim();
}

// A question about a photo sent earlier. Not a bare "นี้": "เดือนนี้", "วันนี้" are about time,
// and would pull in a photo someone sent for something else.
// Not "ภาพรวม" (overview) or "รูปแบบ" (format), and "pic" only as a word ("Red Spicy Ramen").
export const IMAGE_WORDS = /ภาพ(?!รวม)|รูป(?!แบบ)|ในบิล|ตามนี้|ข้างบน|ด้านบน|ข้างล่าง|ด้านล่าง|ที่ส่งไป|ที่ส่งมา|(?:เมนู|จาน|อัน|บิล|สูตร|ตัว|รายการ|ชาม|เซ็ต|เซท|เซต|ใบ|ตาราง|ชุด|ไฟล์)\s*นี้|\b(?:image|photo|pic|picture)s?\b/i;
