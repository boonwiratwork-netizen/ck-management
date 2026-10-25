/**
 * Per-row save queue for count boxes. Every edit is merged into the row's
 * queued patch (kept on the device) and sent one request at a time per row; a
 * patch leaves the queue only when the database has exactly that value. So a
 * phone without internet, an expired sign-in or a slow request never loses a
 * count, and an older value can never land after a newer one.
 */

export type Patch = Record<string, unknown>;
export type SaveState = "saving" | "waiting";

export class SaveQueue {
  private queue: Record<string, Patch>;
  private inflight = new Set<string>();

  constructor(
    private send: (rowId: string, patch: Patch) => Promise<{ error: { message: string } | null }>,
    private onState: (rowId: string, state: SaveState | undefined) => void,
    private onFailure: (message: string, offline: boolean) => void,
    private storageKey = "ck-count-queue",
  ) {
    this.queue = this.read();
  }

  private read(): Record<string, Patch> {
    try {
      return JSON.parse(localStorage.getItem(this.storageKey) || "{}");
    } catch {
      return {};
    }
  }
  private persist() {
    try {
      if (Object.keys(this.queue).length) localStorage.setItem(this.storageKey, JSON.stringify(this.queue));
      else localStorage.removeItem(this.storageKey);
    } catch {
      // storage blocked: kept in memory until the page closes
    }
  }

  /** Rows with an edit not yet confirmed by the database */
  pending(): string[] {
    return [...new Set([...Object.keys(this.queue), ...this.inflight])];
  }
  isPending(rowId: string): boolean {
    return rowId in this.queue || this.inflight.has(rowId);
  }
  /** The unsent edit for a row (to lay over values read back from the database) */
  get(rowId: string): Patch | undefined {
    return this.queue[rowId];
  }

  enqueue(rowId: string, patch: Patch): Promise<void> {
    this.queue = { ...this.queue, [rowId]: { ...this.queue[rowId], ...patch } };
    this.persist();
    return this.pump(rowId);
  }

  private async pump(rowId: string): Promise<void> {
    if (this.inflight.has(rowId)) return;
    this.inflight.add(rowId);
    try {
      for (;;) {
        const patch = this.queue[rowId];
        if (!patch) return this.onState(rowId, undefined);
        const sent = JSON.stringify(patch);
        this.onState(rowId, "saving");
        const { error } = await this.send(rowId, patch);
        if (error) {
          this.onState(rowId, "waiting");
          const offline = (typeof navigator !== "undefined" && navigator.onLine === false) || /fetch|network|load failed/i.test(error.message ?? "");
          this.onFailure(error.message, offline);
          return;
        }
        if (JSON.stringify(this.queue[rowId]) === sent) {
          const rest = { ...this.queue };
          delete rest[rowId];
          this.queue = rest;
          this.persist();
          return this.onState(rowId, undefined);
        }
        // A newer edit arrived while this one was on its way: send that too
      }
    } finally {
      this.inflight.delete(rowId);
    }
  }

  /**
   * Send what is waiting (only these rows when given, e.g. one sheet); true when
   * the database has every one of those edits
   */
  async flush(only?: string[]): Promise<boolean> {
    const mine = (id: string) => !only || only.includes(id);
    for (const rowId of Object.keys(this.queue).filter(mine)) await this.pump(rowId);
    for (let i = 0; i < 40 && [...this.inflight].some(mine); i++) await new Promise((r) => setTimeout(r, 100));
    return this.pending().filter(mine).length === 0;
  }
}
