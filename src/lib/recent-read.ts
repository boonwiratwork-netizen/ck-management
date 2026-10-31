/**
 * A read started a moment ago, handed out again instead of reading the same thing twice
 * (the count page reads a sheet's opening while it opens; "เริ่มนับ" a minute later can use
 * that one). Only within `maxAgeMs` of starting, for the same key; a read that failed is
 * dropped so the next ask reads again.
 */
export interface RecentRead<T> {
  key: string;
  at: number;
  value: Promise<T>;
}
export type RecentSlot<T> = { current: RecentRead<T> | null };

/** Start the read for `key` now (and keep it for a later `recentRead`) */
export function startRead<T>(slot: RecentSlot<T>, key: string, start: () => Promise<T>, now = Date.now()): Promise<T> {
  const value = start();
  const entry: RecentRead<T> = { key, at: now, value };
  slot.current = entry;
  value.catch(() => {
    if (slot.current === entry) slot.current = null;
  });
  return value;
}

/** The read for `key` started within `maxAgeMs`, else a new one */
export function recentRead<T>(slot: RecentSlot<T>, key: string, maxAgeMs: number, start: () => Promise<T>, now = Date.now()): Promise<T> {
  const had = slot.current;
  if (had && had.key === key && now - had.at <= maxAgeMs) return had.value;
  return startRead(slot, key, start, now);
}
