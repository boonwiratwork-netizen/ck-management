/**
 * A time limit for database writes. supabase-js has none of its own: on a stuck connection a
 * write's promise never settles and its button spins for good. Pass `writeTimeout()` to the
 * query's `.abortSignal(...)`; once it fires the request is dropped and the write comes back
 * with an error that has no database code — "no answer": it may or may not have landed, so it
 * is never written again automatically (read back where a read-back exists, else tell the
 * person to check before saving again: NO_ANSWER).
 */
export const WRITE_TIMEOUT_MS = 20_000;

/** A signal that aborts after `ms` (AbortController + setTimeout: works on old Safari, which has no AbortSignal.timeout) */
export function writeTimeout(ms = WRITE_TIMEOUT_MS): AbortSignal {
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

/** What the person is told when a write got no answer */
export const NO_ANSWER = "ระบบไม่ตอบ ไม่แน่ใจว่าบันทึกแล้วหรือยัง: กด F5 รีเฟรชหน้า แล้วดูยอดก่อนบันทึกซ้ำ";

type WriteError = { code?: string | null; message?: string | null } | null | undefined;

/**
 * No answer from the database: a dropped connection or the time limit (supabase-js reports
 * both with an empty code). An answer always carries one (P0001, 42501, PGRST…).
 */
export const noAnswer = (e: WriteError) => !!e && !e.code;

/** The text for a failed write: the database's reason, or NO_ANSWER when it didn't answer */
export const writeError = (e: WriteError) => (noAnswer(e) ? NO_ANSWER : e?.message || "");

/**
 * An id made on the device for a row about to be inserted, so a write that got no answer can
 * be looked up afterwards (did it land?). crypto.randomUUID where there is one, else built from
 * getRandomValues (older Safari).
 */
export function newRowId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
